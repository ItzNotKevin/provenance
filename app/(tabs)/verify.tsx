import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { Ionicons } from "@expo/vector-icons";
import RegistrationFrame from "@/components/RegistrationFrame";
import VerdictView from "@/components/VerdictView";
import TerminalLog from "@/components/TerminalLog";
import { PrimaryButton } from "@/components/Buttons";
import { sha256Bytes, lookupHash, type Verdict } from "@/lib/registry";

type Phase = "idle" | "verifying" | "result";

const STEPS = [
  "Computing SHA-256",
  "Deriving registry address",
  "Confirming on-chain",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

const URL_BTN_W = 56;
const URL_ROW_H = 48;

export default function VerifyScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUrlField, setShowUrlField] = useState(false);
  const [urlValue, setUrlValue] = useState("");

  // Morphing "+ → GO" URL entry (slide-over reveal)
  const urlProgress = useRef(new Animated.Value(0)).current;
  const [urlRowWidth, setUrlRowWidth] = useState(0);
  const urlInputRef = useRef<TextInput>(null);

  function openUrlEntry() {
    setShowUrlField(true);
    Animated.timing(urlProgress, {
      toValue: 1,
      duration: 450,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start(() => urlInputRef.current?.focus());
  }

  function closeUrlEntry() {
    Keyboard.dismiss();
    setShowUrlField(false);
    setUrlValue("");
    Animated.timing(urlProgress, {
      toValue: 0,
      duration: 400,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }

  /**
   * `displayUri` renders the preview (always safe — any URI works for <Image>).
   * `hashUri`, if different, is what actually gets hashed. They diverge when the
   * picker had to re-export a preview copy but we resolved the true asset file
   * separately (see handleSelectPhoto) — hashing the re-exported copy would give
   * a different SHA-256 than the original, unforgeably-attested bytes.
   */
  async function runVerification(displayUri: string, hashUri: string = displayUri) {
    setError(null);
    setImageUri(displayUri);
    setPhase("verifying");
    setStepIndex(0);
    try {
      console.log("[verify] hashing from:", hashUri);
      const bytes = await loadBytes(hashUri);
      console.log("[verify] bytes length:", bytes.length);
      const hash = await sha256Bytes(bytes);
      console.log("[verify] computed sha256:", hash);
      setStepIndex(1);
      await sleep(350);
      setStepIndex(2);
      const result = await lookupHash(hash, bytes);
      console.log("[verify] result tier:", result.tier);
      setVerdict(result);
      setPhase("result");
    } catch (err) {
      console.log("[verify] runVerification failed:", err);
      setError("Could not read that image. Try another photo or URL.");
      setPhase("idle");
    }
  }

  async function handleSelectPhoto() {
    const pickerPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!pickerPermission.granted) {
      setError("Photo library access is required to verify an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    const picked = result.assets[0];
    console.log("[verify] picker returned uri:", picked.uri, "assetId:", picked.assetId);

    // The picker re-exports/re-compresses whatever it returns — even at quality 1,
    // it's rarely byte-identical to the original file. Resolve the real stored
    // asset via MediaLibrary and hash *that* instead, so verifying a photo you
    // just captured (or received unmodified through a byte-preserving channel,
    // e.g. AirDrop/Mail/Files) actually matches its on-chain attestation exactly.
    if (picked.assetId) {
      try {
        const libraryPermission = await MediaLibrary.requestPermissionsAsync();
        console.log("[verify] MediaLibrary permission granted:", libraryPermission.granted);
        if (libraryPermission.granted) {
          const info = await MediaLibrary.getAssetInfoAsync(picked.assetId);
          console.log("[verify] resolved asset localUri:", info.localUri);
          if (info.localUri) {
            runVerification(picked.uri, info.localUri);
            return;
          }
        }
      } catch (err) {
        console.log("[verify] MediaLibrary asset resolution failed:", err);
        // Fall through to hashing the picker's own copy below.
      }
    }

    runVerification(picked.uri);
  }

  function handleSubmitUrl() {
    if (urlValue.trim().length === 0) return;
    runVerification(urlValue.trim());
  }

  function reset() {
    setPhase("idle");
    setVerdict(null);
    setImageUri(null);
    setError(null);
    setShowUrlField(false);
    setUrlValue("");
    urlProgress.setValue(0);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-6 gap-6"
    >
      {phase === "idle" && (
        <>
          <RegistrationFrame className="border border-hairline bg-surface/50 p-8 items-center justify-center gap-8 min-h-[360px]">
            <View className="items-center gap-4">
              <Ionicons name="search-outline" size={40} color="#ffffff" />
              <Text className="font-mono-bold text-2xl text-primary uppercase tracking-widest text-center leading-tight mt-2">
                VERIFY A{"\n"}PHOTO
              </Text>
            </View>
            <View className="w-full gap-4">
              <PrimaryButton label="SELECT PHOTO" icon="image-outline" onPress={handleSelectPhoto} />
              {/* Morphing URL entry: + slides right and becomes GO, input fades in, cancel drops down */}
              <View
                style={{ height: URL_ROW_H }}
                className="w-full"
                onLayout={(e) => setUrlRowWidth(e.nativeEvent.layout.width)}
              >
                {/* URL input, revealed as the button slides away */}
                <Animated.View
                  pointerEvents={showUrlField ? "auto" : "none"}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: Math.max(0, urlRowWidth - URL_BTN_W - 8),
                    opacity: urlProgress.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0, 0, 1],
                    }),
                  }}
                >
                  <TextInput
                    ref={urlInputRef}
                    value={urlValue}
                    onChangeText={setUrlValue}
                    placeholder="https://…"
                    placeholderTextColor="#8e9192"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    className="flex-1 border border-muted px-3.5 py-2 font-mono text-xs text-primary"
                    onSubmitEditing={handleSubmitUrl}
                  />
                </Animated.View>

                {/* Hint label, fades out on open */}
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: URL_BTN_W + 12,
                    top: 0,
                    bottom: 0,
                    justifyContent: "center",
                    opacity: urlProgress.interpolate({
                      inputRange: [0, 0.4],
                      outputRange: [1, 0],
                      extrapolate: "clamp",
                    }),
                  }}
                >
                  <Text className="font-mono-medium text-xs text-on-surface-variant uppercase tracking-widest">
                    OR PASTE AN IMAGE URL
                  </Text>
                </Animated.View>

                {/* The sliding, morphing button */}
                <Animated.View
                  style={{
                    width: URL_BTN_W,
                    height: "100%",
                    transform: [
                      {
                        translateX: urlProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, Math.max(0, urlRowWidth - URL_BTN_W)],
                        }),
                      },
                    ],
                  }}
                >
                  <Pressable
                    onPress={() => (showUrlField ? handleSubmitUrl() : openUrlEntry())}
                    className="w-full h-full active:opacity-80"
                  >
                    <Animated.View
                      style={{
                        flex: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        backgroundColor: urlProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["#1c1b1c", "#ffffff"],
                        }),
                        borderColor: urlProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["#3f3f46", "#ffffff"],
                        }),
                      }}
                    >
                      <Animated.Text
                        style={{
                          position: "absolute",
                          fontSize: 22,
                          color: "#c4b5fd",
                          opacity: urlProgress.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [1, 0, 0],
                          }),
                          transform: [
                            {
                              rotate: urlProgress.interpolate({
                                inputRange: [0, 1],
                                outputRange: ["0deg", "90deg"],
                              }),
                            },
                          ],
                        }}
                      >
                        +
                      </Animated.Text>
                      <Animated.Text
                        style={{
                          fontFamily: "JetBrainsMono_500Medium",
                          fontSize: 11,
                          letterSpacing: 1,
                          color: "#0a0a0b",
                          opacity: urlProgress.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [0, 0, 1],
                          }),
                        }}
                      >
                        GO
                      </Animated.Text>
                    </Animated.View>
                  </Pressable>
                </Animated.View>
              </View>

              {/* Cancel slides down into view */}
              <Animated.View
                pointerEvents={showUrlField ? "auto" : "none"}
                style={{
                  overflow: "hidden",
                  height: urlProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 44],
                  }),
                  opacity: urlProgress.interpolate({
                    inputRange: [0, 0.6, 1],
                    outputRange: [0, 0, 1],
                  }),
                  transform: [
                    {
                      translateY: urlProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-8, 0],
                      }),
                    },
                  ],
                }}
              >
                <Pressable
                  onPress={closeUrlEntry}
                  className="w-full h-full flex-row gap-2 border border-accent-red/40 bg-accent-red/10 items-center justify-center active:opacity-70"
                >
                  <Ionicons name="close" size={14} color="#fca5a5" />
                  <Text className="font-mono-medium text-xs text-accent-red uppercase tracking-widest">
                    CANCEL URL ENTRY
                  </Text>
                </Pressable>
              </Animated.View>
            </View>
          </RegistrationFrame>

          {error && (
            <Text className="font-mono text-[11px] text-on-surface-variant text-center">
              {error}
            </Text>
          )}

          <View className="flex-row items-center justify-center gap-2 opacity-80">
            <Ionicons name="lock-closed-outline" size={12} color="#a1a1aa" />
            <Text className="font-sans text-xs text-on-surface-variant">
              Photos are checked, never published.
            </Text>
          </View>

          <View className="mt-4 pt-4 border-t border-dashed border-hairline">
            <Text className="font-mono text-[10px] text-accent uppercase text-center">
              VERIFICATION IS READ-ONLY · CAPTURE SIGNS WITH THIS DEVICE&apos;S KEY
            </Text>
          </View>
        </>
      )}

      {phase === "verifying" && imageUri && (
        <>
          <RegistrationFrame className="border border-hairline bg-surface aspect-square w-full overflow-hidden">
            <Image
              source={{ uri: imageUri }}
              className="w-full h-full opacity-40"
              resizeMode="cover"
            />
          </RegistrationFrame>

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
                Execution Sequence
              </Text>
              <ActivityIndicator size="small" color="#c4b5fd" />
            </View>
            <TerminalLog steps={STEPS} currentIndex={stepIndex} />
            <View className="w-full h-[2px] bg-surface-container-high">
              <View
                className="h-full bg-accent"
                style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
              />
            </View>
          </View>
        </>
      )}

      {phase === "result" && verdict && imageUri && (
        <VerdictView verdict={verdict} imageUri={imageUri} onReset={reset} />
      )}
    </ScrollView>
  );
}
