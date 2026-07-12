import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RegistrationFrame from "@/components/RegistrationFrame";
import { recentAttestations, type AttestationRecord } from "@/lib/registry";

function truncateHash(hash: string): string {
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

export default function RegistryScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<AttestationRecord[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    recentAttestations().then(setRecords);
  }, []);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.sha256.toLowerCase().includes(q) ||
        r.devicePubkey.toLowerCase().includes(q)
    );
  }, [records, query]);

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-4">
        <View className="flex-row items-center border-b border-muted">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="LOOK UP BY HASH OR DEVICE..."
            placeholderTextColor="#8e9192"
            cursorColor="#c4b5fd"
            selectionColor="#c4b5fd"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            className="flex-1 px-2 py-3 font-mono text-xs text-primary uppercase"
          />
          <Pressable
            onPress={() => Keyboard.dismiss()}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            className="px-2 py-2 active:opacity-60"
          >
            <Ionicons name="search" size={16} color="#c4b5fd" />
          </Pressable>
        </View>
      </View>

      {!records ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#c4b5fd" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.sha256}
          contentContainerClassName="px-4 pb-8"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/record/${item.sha256}`)}
              className="flex-row items-center py-3 border-b border-hairline active:opacity-70"
            >
              <RegistrationFrame className="w-16 h-16 border border-hairline bg-surface-container mr-4 overflow-hidden">
                {item.thumbnailUri ? (
                  <Image source={{ uri: item.thumbnailUri }} className="w-full h-full" resizeMode="cover" />
                ) : (
                  <View className="w-full h-full items-center justify-center">
                    <Ionicons name="image-outline" size={20} color="#8e9192" />
                  </View>
                )}
              </RegistrationFrame>
              <View className="flex-1 gap-1">
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono-medium text-xs text-accent">
                    {truncateHash(item.sha256)}
                  </Text>
                  {item.txSignature && item.txSignature !== "unknown" ? (
                    <View className="flex-row items-center gap-1 mr-2">
                      <Ionicons name="checkmark-circle" size={10} color="#86efac" />
                      <Text className="font-mono text-[9px] text-accent-green uppercase tracking-wide">
                        VERIFIED
                      </Text>
                    </View>
                  ) : (
                    <Text className="font-mono text-[9px] text-accent-orange uppercase tracking-wide mr-2">
                      UNVERIFIED
                    </Text>
                  )}
                </View>
                <Text className="font-mono text-[10px] text-on-surface">
                  {item.capturedAt}
                </Text>
                <View className="flex-row items-center gap-1">
                  <Ionicons name="hardware-chip-outline" size={10} color="#a1a1aa" />
                  <Text className="font-mono text-[10px] text-on-surface-variant">
                    {item.devicePubkey}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Text className="font-mono text-xs text-on-surface-variant uppercase">
                No matching records.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
