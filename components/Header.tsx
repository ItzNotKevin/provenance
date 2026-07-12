import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getDeviceIdentity, truncatePubkey } from "@/lib/deviceKey";

/** Shared top app bar: logo + wordmark left, live device-identity chip right. */
export default function Header() {
  const insets = useSafeAreaInsets();
  const [pubkeyHex, setPubkeyHex] = useState<string>("");

  useEffect(() => {
    getDeviceIdentity().then((id) => setPubkeyHex(id.publicKeyHex));
  }, []);

  return (
    <View
      className="flex-row items-center justify-between border-b border-hairline bg-surface px-4 pb-2 gap-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <View className="flex-row items-center gap-2">
        <Image
          source={require("../assets/logo.png")}
          style={{ width: 18, height: 20 }}
          resizeMode="contain"
        />
        <Text className="font-mono-bold text-sm text-primary uppercase tracking-tighter">
          PROVENANCE
        </Text>
      </View>
      {!!pubkeyHex && (
        <View className="flex-row items-center gap-1.5 border border-muted px-2.5 py-1.5">
          <View className="w-1.5 h-1.5 rounded-full bg-accent" />
          <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
            {truncatePubkey(pubkeyHex)}
          </Text>
        </View>
      )}
    </View>
  );
}
