import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { VerdictTier } from "@/lib/registry";

type IoniconName = keyof typeof Ionicons.glyphMap;

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

/** 6px colored top edge + icon + oversized uppercase mono headline + grey subline. */
export default function VerdictBlock({
  tier,
  icon,
  headline,
  subline,
}: {
  tier: VerdictTier;
  icon: IoniconName;
  headline: string;
  subline: string;
}) {
  return (
    <View
      className="w-full bg-surface border border-hairline"
      style={{ borderTopWidth: 6, borderTopColor: EDGE_COLOR[tier] }}
    >
      <View className="p-4 gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name={icon} size={20} color={EDGE_COLOR[tier]} />
          <Text
            className={`flex-1 font-mono-bold text-xl uppercase tracking-tight ${TEXT_CLASS[tier]}`}
          >
            {headline}
          </Text>
        </View>
        <Text className="font-sans text-sm text-on-surface-variant">
          {subline}
        </Text>
      </View>
    </View>
  );
}
