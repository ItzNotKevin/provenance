import { View } from "react-native";

// 8 rows x 4 unique columns (mirrored to 8) = 32 cells = all 32 bytes of a
// SHA-256 hash, one bit of entropy per cell with nothing left unused.
const GRID = 8;
const HALF = GRID / 2;

/**
 * Deterministic visual fingerprint of a SHA-256 hash: a symmetric 8x8 grid of
 * filled/empty cells (same idea as a GitHub commit identicon), rendered with
 * plain Views so it needs no image/SVG dependency. The chain never stores the
 * actual photo (see lib/CLAUDE.md), so this is what stands in for a thumbnail
 * — a mark of the fingerprint itself, not a fake preview of a photo we don't have.
 */
export default function HashIdenticon({ hash, size = 64 }: { hash: string; size?: number }) {
  const cell = size / GRID;
  const bytes = hash.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];

  const filled = new Set<number>();
  let byteIdx = 0;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < HALF; col++) {
      const on = (bytes[byteIdx % bytes.length] ?? 0) % 2 === 1;
      byteIdx++;
      if (on) {
        filled.add(row * GRID + col);
        filled.add(row * GRID + (GRID - 1 - col));
      }
    }
  }

  return (
    <View style={{ width: size, height: size, flexDirection: "row", flexWrap: "wrap" }}>
      {Array.from({ length: GRID * GRID }).map((_, i) => (
        <View
          key={i}
          style={{
            width: cell,
            height: cell,
            backgroundColor: filled.has(i) ? "#c4b5fd" : "transparent",
          }}
        />
      ))}
    </View>
  );
}
