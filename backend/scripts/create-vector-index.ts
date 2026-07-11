/**
 * One-time setup: creates the Atlas Vector Search index over `phashVector` (AMBER-tier ANN
 * candidate retrieval — see src/mongo.ts findAmberCandidates). Run once per cluster/collection;
 * safe to re-run (no-ops if the index already exists). Atlas builds the index asynchronously
 * in the background, so this also polls until it reports queryable (or times out) before
 * exiting, so a demo run right after setup doesn't race an empty/not-yet-ready index.
 *
 * Run: node scripts/create-vector-index.ts
 */
import { ensureVectorIndex, waitForVectorIndexReady, ensureIndexes, closeMongo } from "../src/mongo.ts";

await ensureIndexes();

const { created, name } = await ensureVectorIndex();
console.log(created ? `created vector search index "${name}"` : `vector search index "${name}" already exists`);

console.log("waiting for the index to become queryable (Atlas builds it in the background)...");
const ready = await waitForVectorIndexReady();
if (ready) {
  console.log("index is queryable — findAmberCandidates() will use $vectorSearch.");
} else {
  console.log(
    "index did not report queryable within the timeout. It may still be building — check the " +
      "Atlas UI (Search tab), or re-run this script later. findAmberCandidates() falls back to " +
      "a full collection scan automatically in the meantime, so nothing is blocked."
  );
}

await closeMongo();
