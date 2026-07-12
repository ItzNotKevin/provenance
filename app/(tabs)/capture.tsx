import { useEffect, useRef, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as MediaLibrary from "expo-media-library";
import { Ionicons } from "@expo/vector-icons";
import RegistrationFrame from "@/components/RegistrationFrame";
import LedgerRow from "@/components/LedgerRow";
import { GhostButton } from "@/components/Buttons";
import { sha256Bytes, attestPhoto, type CaptureManifest } from "@/lib/registry";
import { getDeviceIdentity, signManifest, truncatePubkey } from "@/lib/deviceKey";
import { canonicalManifestBytes } from "@/lib/manifest";

type Phase = "viewfinder" | "anchoring" | "anchored";
type FlashMode = "off" | "on" | "auto";

const FLASH_CYCLE: Record<FlashMode, FlashMode> = { off: "on", on: "auto", auto: "off" };

const CHECKLIST_STEPS = [
  "SHA-256 COMPUTED",
  "MANIFEST SIGNED",
  "ANCHORING TO SOLANA...",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function WebFallback() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <RegistrationFrame className="border border-hairline bg-surface p-8 items-center gap-4">
        <Ionicons name="phone-portrait-outline" size={32} color="#fca5a5" />
        <Text className="font-mono-bold text-lg text-primary uppercase text-center tracking-widest">
          CAPTURE REQUIRES{"\n"}THE DEVICE APP
        </Text>
        <Text className="font-sans text-sm text-on-surface-variant text-center">
          Attestations are signed with a hardware-stored key.
        </Text>
      </RegistrationFrame>
    </View>
  );
}

export default function CaptureScreen() {
  if (Platform.OS === "web") {
    return <WebFallback />;
  }
  return <NativeCapture />;
}

function NativeCapture() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pubkeyHex, setPubkeyHex] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("viewfinder");
  const [checklistStep, setChecklistStep] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [anchorResult, setAnchorResult] = useState<{
    txSignature: string;
    explorerUrl: string;
    sha256: string;
    timestamp: string;
  } | null>(null);

  const [zoom, setZoom] = useState(0);
  const [flashMode, setFlashMode] = useState<FlashMode>("off");
  const [afLocked, setAfLocked] = useState(false);
  const [flashToast, setFlashToast] = useState(false);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const [focusReticle, setFocusReticle] = useState<{ x: number; y: number; locked: boolean } | null>(
    null
  );

  const afLockedRef = useRef(false);
  const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reticleFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomHudFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    afLockedRef.current = afLocked;
  }, [afLocked]);

  useEffect(() => {
    getDeviceIdentity().then((id) => setPubkeyHex(id.publicKeyHex));
    // Requested up front so it's already resolved by the time the shutter is
    // tapped. Full (not write-only) permission: capture reads back the saved
    // asset's localUri to hash the exact bytes iOS actually stored (see
    // handleShutter) — not just adds a new one.
    MediaLibrary.requestPermissionsAsync().catch(() => {});
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (reticleFadeTimer.current) clearTimeout(reticleFadeTimer.current);
      if (zoomHudFadeTimer.current) clearTimeout(zoomHudFadeTimer.current);
      if (flashToastTimer.current) clearTimeout(flashToastTimer.current);
    };
  }, []);

  function touchDistance(touches: { pageX: number; pageY: number }[]) {
    const [a, b] = touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  }

  function cycleFlash() {
    setFlashMode((m) => FLASH_CYCLE[m]);
    setFlashToast(true);
    if (flashToastTimer.current) clearTimeout(flashToastTimer.current);
    flashToastTimer.current = setTimeout(() => setFlashToast(false), 900);
  }

  function handleViewfinderGrant(e: GestureResponderEvent) {
    const touches = e.nativeEvent.touches;
    if (touches.length >= 2) {
      pinchStateRef.current = { distance: touchDistance(touches), zoom };
      return;
    }
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (reticleFadeTimer.current) clearTimeout(reticleFadeTimer.current);

    if (afLockedRef.current) {
      // Tapping anywhere while locked releases the lock, matching iOS.
      setAfLocked(false);
      setFocusReticle(null);
      return;
    }

    const { locationX, locationY } = e.nativeEvent;
    setFocusReticle({ x: locationX, y: locationY, locked: false });
    longPressTimer.current = setTimeout(() => {
      setAfLocked(true);
      setFocusReticle({ x: locationX, y: locationY, locked: true });
    }, 500);
  }

  function handleViewfinderMove(e: GestureResponderEvent) {
    const touches = e.nativeEvent.touches;

    if (touches.length >= 2) {
      // A second finger just landed — this is definitely a pinch, not a tap/hold.
      // The second touch arrives via a move event, not a fresh grant, so the
      // single-finger long-press timer from the first touch must be killed here.
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      if (reticleFadeTimer.current) clearTimeout(reticleFadeTimer.current);
      setFocusReticle(null);

      if (!pinchStateRef.current) {
        pinchStateRef.current = { distance: touchDistance(touches), zoom };
        return;
      }
      const scale = touchDistance(touches) / pinchStateRef.current.distance;
      const next = Math.min(1, Math.max(0, pinchStateRef.current.zoom + (scale - 1) * 0.75));
      setZoom(next);
      setZoomHudVisible(true);
      if (zoomHudFadeTimer.current) clearTimeout(zoomHudFadeTimer.current);
      zoomHudFadeTimer.current = setTimeout(() => setZoomHudVisible(false), 900);
      return;
    }

    // Single finger drifting before the long-press fires — treat as a drag,
    // not a hold-to-lock, so it doesn't lock focus at the original touch point.
    if (longPressTimer.current && focusReticle) {
      const { locationX, locationY } = e.nativeEvent;
      const moved = Math.hypot(locationX - focusReticle.x, locationY - focusReticle.y);
      if (moved > 12) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        setFocusReticle(null);
      }
    }
  }

  function handleViewfinderRelease() {
    pinchStateRef.current = null;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (!afLockedRef.current) {
      reticleFadeTimer.current = setTimeout(() => setFocusReticle(null), 600);
    }
  }

  async function handleShutter() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
    if (!photo) return;
    setPhotoUri(photo.uri);
    setAnchorError(null);
    setPhase("anchoring");
    setChecklistStep(0);

    try {
      // Save to the camera roll BEFORE hashing, then hash back whatever iOS/Android
      // actually stored (not the pre-save temp file). Photos-library writes can get
      // silently re-encoded on import (confirmed empirically — a save produced a file
      // ~1/3 the size of the original capture) — attesting the post-save bytes means
      // the certificate always matches the artifact that actually persists and gets
      // shared/re-verified later, instead of a temp file nobody will ever see again.
      let hashSourceUri = photo.uri;
      try {
        const asset = await MediaLibrary.createAssetAsync(photo.uri);
        const info = await MediaLibrary.getAssetInfoAsync(asset.id);
        if (info.localUri) {
          hashSourceUri = info.localUri;
        }
      } catch (err) {
        console.warn("Could not save to library — hashing the unsaved capture instead:", err);
      }

      setPhotoUri(hashSourceUri);
      const bytes = await loadBytes(hashSourceUri);
      const sha256 = await sha256Bytes(bytes);
      console.log("[capture] attested sha256:", sha256, "bytes length:", bytes.length, "source:", hashSourceUri);
      setChecklistStep(1);
      await sleep(300);

      const unixSeconds = Math.floor(Date.now() / 1000);
      const manifest: CaptureManifest = {
        sha256,
        timestamp: new Date(unixSeconds * 1000).toISOString(),
        devicePubkey: pubkeyHex,
      };
      const manifestBytes = canonicalManifestBytes(sha256, unixSeconds, pubkeyHex);
      const signature = await signManifest(manifestBytes);
      setChecklistStep(2);

      const { txSignature, explorerUrl } = await attestPhoto(manifest, signature, bytes);
      setAnchorResult({
        txSignature,
        explorerUrl,
        sha256,
        timestamp: manifest.timestamp,
      });
      setPhase("anchored");
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : "Anchoring failed.");
      setPhase("viewfinder");
    }
  }

  function reset() {
    setPhase("viewfinder");
    setPhotoUri(null);
    setAnchorResult(null);
    setAnchorError(null);
  }

  if (!permission) {
    return <View className="flex-1 bg-background" />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8 gap-6">
        <RegistrationFrame className="border border-hairline bg-surface p-8 items-center gap-4">
          <Ionicons name="camera-outline" size={32} color="#c4b5fd" />
          <Text className="font-mono-bold text-lg text-primary uppercase text-center tracking-widest">
            CAMERA ACCESS REQUIRED
          </Text>
          <Text className="font-sans text-sm text-on-surface-variant text-center">
            PROVENANCE needs the camera to sign photos at the moment of capture.
          </Text>
        </RegistrationFrame>
        <GhostButton label="GRANT CAMERA ACCESS" icon="camera-outline" onPress={requestPermission} />
      </View>
    );
  }

  if (phase === "viewfinder") {
    return (
      <View className="flex-1 bg-background">
        <View
          className="flex-1 relative overflow-hidden"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleViewfinderGrant}
          onResponderMove={handleViewfinderMove}
          onResponderRelease={handleViewfinderRelease}
          onResponderTerminate={handleViewfinderRelease}
        >
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
            zoom={zoom}
            flash={flashMode}
            autofocus={afLocked ? "on" : "off"}
          />

          <View className="absolute top-4 left-4 flex-row items-center gap-2 bg-black/40 rounded-full px-3 py-1.5">
            <View className="w-1.5 h-1.5 rounded-full bg-primary" />
            <Text className="font-mono text-[10px] text-on-surface uppercase">
              {truncatePubkey(pubkeyHex || "0000000000000000")}
            </Text>
          </View>

          <Pressable
            onPress={cycleFlash}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 items-center justify-center active:opacity-70"
          >
            <Ionicons
              name={
                flashMode === "off" ? "flash-off-outline" : flashMode === "auto" ? "flash-outline" : "flash"
              }
              size={18}
              color={flashMode === "off" ? "#a1a1aa" : flashMode === "auto" ? "#c4b5fd" : "#ffffff"}
            />
          </Pressable>

          {flashToast && (
            <View
              pointerEvents="none"
              className="absolute top-16 right-4 bg-black/60 rounded-full px-3 py-1"
            >
              <Text className="font-mono text-[9px] text-primary uppercase tracking-widest">
                Flash: {flashMode}
              </Text>
            </View>
          )}

          {afLocked && (
            <View pointerEvents="none" className="absolute top-4 left-0 right-0 items-center">
              <View className="bg-black/50 rounded-full px-3 py-1">
                <Text className="font-mono text-[9px] text-accent uppercase tracking-widest">
                  AE / AF Lock
                </Text>
              </View>
            </View>
          )}

          {focusReticle && (
            <View
              pointerEvents="none"
              className={`absolute w-16 h-16 border ${
                focusReticle.locked ? "border-accent" : "border-primary"
              }`}
              style={{
                left: focusReticle.x - 32,
                top: focusReticle.y - 32,
                borderRadius: 4,
              }}
            />
          )}

          {zoomHudVisible && (
            <View
              pointerEvents="none"
              className="absolute self-center bottom-6 left-0 right-0 items-center"
            >
              <View className="bg-black/50 rounded-full w-14 h-14 items-center justify-center">
                <Text className="font-mono-medium text-xs text-primary">
                  {Math.round(zoom * 100)}%
                </Text>
              </View>
            </View>
          )}
        </View>
        <View className="items-center gap-4 py-8 bg-background">
          <Pressable
            onPress={handleShutter}
            className="w-[72px] h-[72px] rounded-full border-2 border-primary items-center justify-center active:opacity-70"
          >
            <View className="w-14 h-14 rounded-full bg-primary/10" />
          </Pressable>
          <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
            SIGNED AT CAPTURE · ANCHORED ON SOLANA
          </Text>
          {anchorError && (
            <Text className="font-mono text-[10px] text-verdict-amber text-center px-8">
              {anchorError}
            </Text>
          )}
        </View>
      </View>
    );
  }

  if (phase === "anchoring" && photoUri) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4 gap-6">
        <RegistrationFrame className="border border-hairline bg-surface aspect-square w-full overflow-hidden">
          <Image source={{ uri: photoUri }} className="w-full h-full opacity-60" resizeMode="cover" />
        </RegistrationFrame>
        <View className="border border-hairline bg-surface p-4 gap-3">
          {CHECKLIST_STEPS.map((label, i) => (
            <View key={label} className="flex-row items-center justify-between">
              <Text
                className={`font-mono text-xs uppercase ${
                  i <= checklistStep ? "text-on-surface" : "text-on-surface-variant opacity-40"
                }`}
              >
                {label}
              </Text>
              {i < checklistStep && (
                <Ionicons name="checkmark" size={14} color="#22c55e" />
              )}
            </View>
          ))}
          <View className="w-full h-[2px] bg-surface-container-high mt-2">
            <View
              className="h-full bg-verdict-green"
              style={{ width: `${((checklistStep + 1) / CHECKLIST_STEPS.length) * 100}%` }}
            />
          </View>
        </View>
      </ScrollView>
    );
  }

  if (phase === "anchored" && photoUri && anchorResult) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4 gap-6">
        <RegistrationFrame className="border border-hairline bg-surface aspect-square w-full overflow-hidden">
          <Image source={{ uri: photoUri }} className="w-full h-full" resizeMode="cover" />
        </RegistrationFrame>
        <View
          className="border border-hairline bg-surface"
          style={{ borderTopWidth: 6, borderTopColor: "#22c55e" }}
        >
          <View className="p-4 gap-4">
            <Text className="font-mono-bold text-2xl text-verdict-green uppercase tracking-widest">
              ANCHORED
            </Text>
            <View className="border border-hairline">
              <LedgerRow label="SHA-256" value={anchorResult.sha256} />
              <LedgerRow label="CAPTURED" value={anchorResult.timestamp} />
              <LedgerRow label="TRANSACTION" value={anchorResult.txSignature} last />
            </View>
            <GhostButton
              label="VIEW ON EXPLORER"
              icon="open-outline"
              onPress={() => Linking.openURL(anchorResult.explorerUrl)}
            />
          </View>
        </View>
        <GhostButton label="CAPTURE ANOTHER PHOTO" icon="refresh" onPress={reset} />
      </ScrollView>
    );
  }

  return null;
}
