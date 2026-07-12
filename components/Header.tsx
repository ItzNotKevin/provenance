import { Image, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Shared top app bar: logo + wordmark left. */
export default function Header() {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center border-b border-hairline bg-surface px-4 pb-2 gap-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <Image
        source={require("../assets/logo.png")}
        style={{ width: 18, height: 20 }}
        resizeMode="contain"
      />
      <Text className="font-mono-bold text-sm text-primary uppercase tracking-tighter">
        PROVENANCE
      </Text>
    </View>
  );
}
