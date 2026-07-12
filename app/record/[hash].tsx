import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import VerdictView from "@/components/VerdictView";
import { recentAttestations, type AttestationRecord } from "@/lib/registry";
import { getDeviceIdentity } from "@/lib/deviceKey";

export default function RecordDetailScreen() {
  const { hash } = useLocalSearchParams<{ hash: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [record, setRecord] = useState<AttestationRecord | null | undefined>(undefined);

  useEffect(() => {
    // Reached only from this device's own registry list (a personal ledger, not a
    // public feed — see lib/CLAUDE.md), so the lookup stays scoped to this device.
    getDeviceIdentity().then((id) =>
      recentAttestations(id.publicKeyHex).then((records) => {
        setRecord(records.find((r) => r.sha256 === hash) ?? null);
      })
    );
  }, [hash]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/registry");
    }
  };

  const shareProof = async () => {
    if (!record) return;
    const deepLink = Linking.createURL(`/record/${record.sha256}`);
    await Share.share({
      message: [
        "PROVENANCE attestation",
        `SHA-256: ${record.sha256}`,
        `Captured: ${record.capturedAt}`,
        `Verify: ${deepLink}`,
        `Explorer: ${record.explorerUrl}`,
      ].join("\n"),
    });
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <Stack.Screen
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          animation: "slide_from_right",
        }}
      />
      <View className="h-12 border-b border-hairline bg-surface flex-row items-center justify-between px-4">
        <Pressable
          onPress={goBack}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 24 }}
          className="flex-row items-center gap-1 active:opacity-70 py-2 pr-6"
        >
          <Ionicons name="chevron-back" size={14} color="#ffffff" />
          <Text className="font-mono text-xs text-primary uppercase">BACK</Text>
        </Pressable>
        {record && (
          <Pressable
            onPress={shareProof}
            hitSlop={{ top: 12, bottom: 12, left: 24, right: 16 }}
            className="flex-row items-center gap-1.5 active:opacity-70 py-2 pl-6"
          >
            <Text className="font-mono text-xs text-accent uppercase">SHARE PROOF</Text>
            <Ionicons name="share-outline" size={14} color="#c4b5fd" />
          </Pressable>
        )}
      </View>

      {record === undefined && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#c4b5fd" />
        </View>
      )}

      {record === null && (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="font-mono text-xs text-on-surface-variant uppercase text-center">
            RECORD NOT FOUND
          </Text>
        </View>
      )}

      {record && (
        <ScrollView contentContainerClassName="p-4 gap-6">
          <VerdictView
            verdict={{ tier: "green", record }}
            imageUri={record.thumbnailUri ?? null}
          />
        </ScrollView>
      )}
    </View>
  );
}
