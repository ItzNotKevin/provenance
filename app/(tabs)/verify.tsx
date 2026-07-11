import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import RegistrationFrame from "@/components/RegistrationFrame";
import VerdictView from "@/components/VerdictView";
import SolanaStatusStub from "@/components/SolanaStatusStub";
import { PrimaryButton, GhostButton } from "@/components/Buttons";
import { sha256Bytes, lookupHash, type Verdict } from "@/lib/registry";

type Phase = "idle" | "verifying" | "result";

const STEPS = [
  "computing SHA-256...",
  "deriving registry address...",
  "confirming on-chain...",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export default function VerifyScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUrlField, setShowUrlField] = useState(false);
  const [urlValue, setUrlValue] = useState("");

  async function runVerification(uri: string) {
    setError(null);
    setImageUri(uri);
    setPhase("verifying");
    setStepIndex(0);
    try {
      const bytes = await loadBytes(uri);
      const hash = await sha256Bytes(bytes);
      setStepIndex(1);
      await sleep(350);
      setStepIndex(2);
      const result = await lookupHash(hash);
      setVerdict(result);
      setPhase("result");
    } catch {
      setError("Could not read that image. Try another photo or URL.");
      setPhase("idle");
    }
  }

  async function handleSelectPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to verify an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      runVerification(result.assets[0].uri);
    }
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
              <Text className="text-primary text-[40px]">⌕</Text>
              <Text className="font-mono-bold text-2xl text-primary uppercase tracking-widest text-center leading-tight mt-2">
                VERIFY A{"\n"}PHOTO
              </Text>
            </View>
            <View className="w-full gap-4">
              <PrimaryButton label="SELECT PHOTO" onPress={handleSelectPhoto} />
              <GhostButton
                label={showUrlField ? "CANCEL URL ENTRY" : "OR PASTE AN IMAGE URL"}
                className="border-0 py-0"
                onPress={() => setShowUrlField((v) => !v)}
              />
              {showUrlField && (
                <View className="flex-row gap-2">
                  <TextInput
                    value={urlValue}
                    onChangeText={setUrlValue}
                    placeholder="https://…"
                    placeholderTextColor="#8e9192"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 border border-hairline px-3 py-3 font-mono text-xs text-primary"
                    onSubmitEditing={handleSubmitUrl}
                  />
                  <PrimaryButton
                    label="GO"
                    className="w-16"
                    onPress={handleSubmitUrl}
                  />
                </View>
              )}
            </View>
          </RegistrationFrame>

          {error && (
            <Text className="font-mono text-[11px] text-on-surface-variant text-center">
              {error}
            </Text>
          )}

          <View className="flex-row items-center justify-center gap-2 opacity-80">
            <Text className="text-on-surface-variant text-xs">🔒</Text>
            <Text className="font-sans text-xs text-on-surface-variant">
              Photos are checked, never published.
            </Text>
          </View>

          <View className="mt-4 pt-4 border-t border-dashed border-hairline">
            <Text className="font-mono text-[10px] text-on-surface-variant uppercase text-center opacity-70">
              VERIFICATION IS READ-ONLY · CAPTURE SIGNS WITH THIS DEVICE&apos;S KEY
            </Text>
          </View>

          <View className="items-center">
            <SolanaStatusStub />
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

          <View className="border border-hairline bg-surface p-4 gap-4">
            <View className="flex-row items-center gap-3">
              <ActivityIndicator color="#c4b5fd" />
              <Text className="font-mono text-xs text-primary uppercase tracking-widest">
                {STEPS[stepIndex]}
              </Text>
            </View>
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
