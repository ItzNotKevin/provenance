import { useEffect, useRef, useState } from "react";
import { Image, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import RegistrationFrame from "@/components/RegistrationFrame";
import LedgerRow from "@/components/LedgerRow";
import { GhostButton } from "@/components/Buttons";
import { sha256Bytes, attestPhoto, type CaptureManifest } from "@/lib/registry";
import { getDeviceIdentity, signManifest, truncatePubkey } from "@/lib/deviceKey";
import { canonicalManifestBytes } from "@/lib/manifest";

type Phase = "viewfinder" | "anchoring" | "anchored";

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
        <Text className="text-accent-red text-[32px]">◇</Text>
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

  useEffect(() => {
    getDeviceIdentity().then((id) => setPubkeyHex(id.publicKeyHex));
  }, []);

  async function handleShutter() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
    if (!photo) return;
    setPhotoUri(photo.uri);
    setAnchorError(null);
    setPhase("anchoring");
    setChecklistStep(0);

    try {
      const bytes = await loadBytes(photo.uri);
      const sha256 = await sha256Bytes(bytes);
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
          <Text className="font-mono-bold text-lg text-primary uppercase text-center tracking-widest">
            CAMERA ACCESS REQUIRED
          </Text>
          <Text className="font-sans text-sm text-on-surface-variant text-center">
            VERIFY.SYSTEM needs the camera to sign photos at the moment of capture.
          </Text>
        </RegistrationFrame>
        <GhostButton label="GRANT CAMERA ACCESS" onPress={requestPermission} />
      </View>
    );
  }

  if (phase === "viewfinder") {
    return (
      <View className="flex-1 bg-background">
        <View className="flex-1 relative overflow-hidden">
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
          <View className="absolute top-4 left-4 flex-row items-center gap-2 bg-surface border border-hairline px-2 py-1">
            <View className="w-2 h-2 rounded-full bg-primary" />
            <Text className="font-mono text-[10px] text-on-surface uppercase">
              DEVICE KEY {truncatePubkey(pubkeyHex || "0000000000000000")}
            </Text>
          </View>
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
                <Text className="font-mono text-xs text-verdict-green">✓</Text>
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
            <View className="border-t border-hairline">
              <LedgerRow label="SHA-256" value={anchorResult.sha256} />
              <LedgerRow label="CAPTURED" value={anchorResult.timestamp} />
              <LedgerRow label="TRANSACTION" value={anchorResult.txSignature} last />
            </View>
            <GhostButton
              label="VIEW ON EXPLORER ↗"
              onPress={() => Linking.openURL(anchorResult.explorerUrl)}
            />
          </View>
        </View>
        <GhostButton label="CAPTURE ANOTHER PHOTO" onPress={reset} />
      </ScrollView>
    );
  }

  return null;
}
