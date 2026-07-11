import { Text, View } from "react-native";
import type { VerdictTier } from "@/lib/registry";

const EDGE_COLOR: Record<VerdictTier, string> = {
  green: "#22c55e",
  amber: "#f59e0b",
  grey: "#71717a",
};

const TEXT_CLASS: Record<VerdictTier, string> = {
  green: "text-verdict-green",
  amber: "text-verdict-amber",
  grey: "text-on-surface-variant",
};

/** 6px colored top edge + oversized uppercase mono headline + grey subline. */
export default function VerdictBlock({
  tier,
  headline,
  subline,
}: {
  tier: VerdictTier;
  headline: string;
  subline: string;
}) {
  return (
    <View
      className="w-full bg-surface border border-hairline"
      style={{ borderTopWidth: 6, borderTopColor: EDGE_COLOR[tier] }}
    >
      <View className="p-4 gap-2">
        <Text
          className={`font-mono-bold text-xl uppercase tracking-tight ${TEXT_CLASS[tier]}`}
        >
          {headline}
        </Text>
        <Text className="font-sans text-sm text-on-surface-variant">
          {subline}
        </Text>
      </View>
    </View>
  );
}
