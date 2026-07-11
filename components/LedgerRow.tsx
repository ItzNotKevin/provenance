import { Text, View } from "react-native";

/** Hairline-divided row: tiny uppercase mono label above a mono value. */
export default function LedgerRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      className={`w-full py-3 flex-col gap-1 ${
        last ? "" : "border-b border-hairline"
      }`}
    >
      <Text className="font-mono-medium text-[10px] tracking-widest text-on-surface-variant uppercase">
        {label}
      </Text>
      <Text
        className="font-mono text-xs text-primary"
        selectable
      >
        {value}
      </Text>
    </View>
  );
}
