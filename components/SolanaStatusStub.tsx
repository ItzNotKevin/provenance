import { Text, View } from "react-native";

/** Devnet status readout for empty screens. Self-contained — safe to delete this file and its one usage. */
export default function SolanaStatusStub() {
  return (
    <View className="border border-hairline bg-surface w-full max-w-xs mt-10">
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-hairline">
        <View className="w-1.5 h-1.5 rounded-full bg-verdict-green" />
        <Text className="font-mono text-[10px] text-accent uppercase tracking-widest">
          Solana Devnet · Live
        </Text>
      </View>
      <View className="px-4 py-3 gap-1">
        <Text className="font-mono-medium text-[10px] tracking-widest text-on-surface-variant uppercase">
          Program
        </Text>
        <Text className="font-mono text-xs text-primary" selectable>
          EoWd…jZ8g
        </Text>
      </View>
    </View>
  );
}
