import { Text, View } from "react-native";

/** Shared top app bar: wordmark left, bordered registry chip right. */
export default function Header() {
  return (
    <View className="h-12 border-b border-hairline bg-surface flex-row items-center justify-between px-4">
      <Text className="font-mono-bold text-sm text-primary uppercase tracking-tighter">
        <Text className="text-accent">◆</Text> VERIFY.SYSTEM
      </Text>
      <View className="border border-accent/40 px-2 py-1">
        <Text className="font-mono text-[10px] text-accent uppercase tracking-widest">
          REGISTRY: SOLANA
        </Text>
      </View>
    </View>
  );
}
