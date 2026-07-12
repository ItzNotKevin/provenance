import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RegistrationFrame from "@/components/RegistrationFrame";
import HashIdenticon from "@/components/HashIdenticon";
import { recentAttestationsPage, type AttestationRecord } from "@/lib/registry";
import { getDeviceIdentity, truncatePubkey } from "@/lib/deviceKey";

const PAGE_SIZE = 20;

function truncateHash(hash: string): string {
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

export default function RegistryScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<AttestationRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [pubkeyHex, setPubkeyHex] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const pubkeyRef = useRef<string>("");

  const loadFirstPage = useCallback(async () => {
    const id = pubkeyRef.current || (await getDeviceIdentity()).publicKeyHex;
    pubkeyRef.current = id;
    setPubkeyHex(id);
    const page = await recentAttestationsPage({ devicePubkey: id, limit: PAGE_SIZE });
    cursorRef.current = page.nextCursor;
    setRecords(page.records);
  }, []);

  // Refetch whenever the Registry tab gains focus — e.g. right after capturing
  // a photo — instead of only ever loading once on first mount.
  useFocusEffect(
    useCallback(() => {
      loadFirstPage();
    }, [loadFirstPage])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || !cursorRef.current || !pubkeyRef.current) return;
    setLoadingMore(true);
    try {
      const page = await recentAttestationsPage({
        devicePubkey: pubkeyRef.current,
        before: cursorRef.current,
        limit: PAGE_SIZE,
      });
      cursorRef.current = page.nextCursor;
      setRecords((prev) => [...(prev ?? []), ...page.records]);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => r.sha256.toLowerCase().includes(q));
  }, [records, query]);

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-4 gap-3">
        <View className="gap-1">
          <Text className="font-mono-bold text-lg text-primary uppercase tracking-widest">
            My Attestations
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="hardware-chip-outline" size={11} color="#a1a1aa" />
            <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wide">
              This device · {truncatePubkey(pubkeyHex)}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center border-b border-muted">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="SEARCH BY HASH..."
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
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c4b5fd" />
          }
          onEndReachedThreshold={0.4}
          onEndReached={onEndReached}
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6 items-center">
                <ActivityIndicator color="#c4b5fd" size="small" />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/record/${item.sha256}`)}
              className="flex-row items-center py-3 border-b border-hairline active:opacity-70"
            >
              <RegistrationFrame className="w-16 h-16 border border-hairline bg-surface-container mr-4 items-center justify-center overflow-hidden">
                {item.thumbnailUri ? (
                  <Image source={{ uri: item.thumbnailUri }} className="w-full h-full" resizeMode="cover" />
                ) : (
                  <HashIdenticon hash={item.sha256} size={52} />
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
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View className="items-center py-16 gap-2">
              <Ionicons name="file-tray-outline" size={24} color="#8e9192" />
              <Text className="font-mono text-xs text-on-surface-variant uppercase text-center">
                {query ? "No matching records." : "No attestations from this device yet."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
