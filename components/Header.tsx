import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Shared top app bar: wordmark left. */
export default function Header() {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="border-b border-hairline bg-surface justify-end px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <Text className="font-mono-bold text-sm text-primary uppercase tracking-tighter">
        <Text className="text-accent">◆</Text> VERIFY.SYSTEM
      </Text>
    </View>
  );
}
