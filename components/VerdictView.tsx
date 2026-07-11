import { Image, Text, View } from "react-native";
import RegistrationFrame from "@/components/RegistrationFrame";
import LedgerRow from "@/components/LedgerRow";
import VerdictBlock from "@/components/VerdictBlock";
import { GhostButton } from "@/components/Buttons";
import type { Verdict } from "@/lib/registry";

/** Renders the green / amber / grey verdict outcome for a verified image. */
export default function VerdictView({
  verdict,
  imageUri,
  onReset,
}: {
  verdict: Verdict;
  imageUri: string | null;
  onReset?: () => void;
}) {
  if (verdict.tier === "green" && verdict.record) {
    const r = verdict.record;
    return (
      <View className="gap-6">
        {imageUri && (
          <RegistrationFrame className="border border-hairline bg-surface aspect-square w-full overflow-hidden">
            <Image source={{ uri: imageUri }} className="w-full h-full" resizeMode="cover" />
          </RegistrationFrame>
        )}
        <VerdictBlock
          tier="green"
          headline="✓ CRYPTOGRAPHICALLY VERIFIED"
          subline="Exact match — unmodified since capture."
        />
        <View className="border-t border-hairline">
          <LedgerRow label="SHA-256" value={r.sha256} />
          <LedgerRow label="CAPTURED" value={r.capturedAt} />
          <LedgerRow label="DEVICE KEY" value={r.devicePubkey} />
          <LedgerRow label="TRANSACTION" value={r.txSignature} last />
        </View>
        <GhostButton label="VIEW ON SOLANA EXPLORER ↗" />
        {onReset && <GhostButton label="VERIFY ANOTHER PHOTO" onPress={onReset} />}
      </View>
    );
  }

  if (verdict.tier === "amber" && verdict.record) {
    const r = verdict.record;
    return (
      <View className="gap-6">
        <VerdictBlock
          tier="amber"
          headline="CONSISTENT WITH VERIFIED CAPTURE"
          subline="Appears to be a recompressed or resized version of an attested original."
        />
        <View className="gap-2">
          <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest border-b border-hairline pb-1">
            SUBMITTED IMAGE
          </Text>
          <RegistrationFrame className="border border-hairline bg-surface aspect-[4/3] w-full overflow-hidden">
            {imageUri && (
              <Image source={{ uri: imageUri }} className="w-full h-full" resizeMode="cover" />
            )}
          </RegistrationFrame>
        </View>
        <View className="flex-row items-center justify-between border-b border-hairline pb-2">
          <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
            PERCEPTUAL DISTANCE
          </Text>
          <Text className="font-mono-bold text-xs text-verdict-amber">4/64 BITS</Text>
        </View>
        <View className="gap-2">
          <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest border-b border-hairline pb-1">
            ATTESTED ORIGINAL
          </Text>
          <RegistrationFrame className="border border-hairline bg-surface aspect-[4/3] w-full overflow-hidden">
            {r.thumbnailUri ? (
              <Image source={{ uri: r.thumbnailUri }} className="w-full h-full" resizeMode="cover" />
            ) : (
              <View className="w-full h-full items-center justify-center">
                <Text className="text-on-surface-variant text-2xl">◻</Text>
              </View>
            )}
          </RegistrationFrame>
        </View>
        <View className="border-t border-hairline">
          <LedgerRow label="SHA-256 (ATTESTED)" value={r.sha256} />
          <LedgerRow label="CAPTURED" value={r.capturedAt} />
          <LedgerRow label="DEVICE KEY" value={r.devicePubkey} />
          <LedgerRow label="TRANSACTION" value={r.txSignature} last />
        </View>
        <View className="py-4 border-l-2 border-hairline pl-3">
          <Text className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wide">
            Pixel-exact verification not possible for this file.
          </Text>
        </View>
        {onReset && <GhostButton label="VERIFY ANOTHER PHOTO" onPress={onReset} />}
      </View>
    );
  }

  return (
    <View className="gap-6">
      <RegistrationFrame className="border border-hairline bg-surface p-6 gap-4">
        <View
          className="absolute top-0 left-0 w-full"
          style={{ height: 6, backgroundColor: "#27272a" }}
        />
        <Text className="font-mono-bold text-2xl text-primary uppercase mt-4">
          NO ATTESTATION FOUND
        </Text>
        <Text className="font-sans text-sm text-on-surface-variant">
          This image does not match any record in the registry. This is not a
          judgment of authenticity.
        </Text>
        {onReset && <GhostButton label="↺ VERIFY ANOTHER PHOTO" onPress={onReset} />}
      </RegistrationFrame>
    </View>
  );
}
