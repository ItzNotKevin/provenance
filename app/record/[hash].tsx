import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import VerdictView from "@/components/VerdictView";
import { recentAttestations, type AttestationRecord } from "@/lib/registry";

export default function RecordDetailScreen() {
  const { hash } = useLocalSearchParams<{ hash: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [record, setRecord] = useState<AttestationRecord | null | undefined>(undefined);

  useEffect(() => {
    recentAttestations().then((records) => {
      setRecord(records.find((r) => r.sha256 === hash) ?? null);
    });
  }, [hash]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="h-12 border-b border-hairline bg-surface flex-row items-center px-4">
        <Pressable onPress={() => router.back()} className="active:opacity-70">
          <Text className="font-mono text-xs text-primary uppercase">‹ BACK</Text>
        </Pressable>
      </View>

      {record === undefined && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#ffffff" />
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
