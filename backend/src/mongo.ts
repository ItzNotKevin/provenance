import { MongoClient, type Collection, type Db } from "mongodb";
import { MONGODB_URI } from "./config.ts";
import type { ChainAttestationRecord } from "./lookup.ts";
import { hammingDistanceHex } from "../../lib/phash.ts";
import { phashHexToVector, PHASH_VECTOR_DIMENSIONS } from "./phashVector.ts";

/**
 * Mongo is the search index, not the source of truth — every document here mirrors an
 * on-chain PhotoAttestation and is fully rebuildable by replaying the chain (see
 * scripts/reindex.ts). Nothing reads from Mongo without the chain having confirmed it first
 * (or, for /recent, being reconcilable against it) — see root CLAUDE.md "Mongo proposes,
 * chain disposes."
 */
export interface AttestationDocument {
  _id: string; // sha256, hex — content-addressed, same key as the on-chain PDA seed
  sha256: string;
  phash: string; // 16-char hex, canonical format (see lib/phash.ts)
  phashVector: number[]; // phash re-encoded as 64 elements of ±1, for $vectorSearch — see phashVector.ts
  chainAddress: string; // PDA base58
  timestamp: number; // unix seconds
  device: string; // devicePubkey, hex
  parentHash: string | null;
  slot: number;
  txSignature: string | null;
  explorerUrl: string;
  indexedAt: number; // unix ms, when this document was last written
}

const COLLECTION = "attestations";

/** Name of the Atlas Vector Search index over `phashVector` (see ensureVectorIndex). */
export const PHASH_VECTOR_INDEX_NAME = "phash_vector_index";

/** Thrown when MONGODB_URI isn't set — callers (see http.ts) treat this as "feature disabled", not a failure. */
export class MongoNotConfiguredError extends Error {}

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!MONGODB_URI) {
    throw new MongoNotConfiguredError("MONGODB_URI is not set — see backend/README.md");
  }
  if (!clientPromise) {
    clientPromise = new MongoClient(MONGODB_URI).connect();
  }
  return clientPromise;
}

async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(); // database name comes from the URI path (or the driver default)
}

async function getCollection(): Promise<Collection<AttestationDocument>> {
  const db = await getDb();
  return db.collection<AttestationDocument>(COLLECTION);
}

/** Ensures the regular (non-search) indexes this module relies on exist. Idempotent. */
export async function ensureIndexes(): Promise<void> {
  const col = await getCollection();
  await col.createIndex({ timestamp: -1 }); // /recent pagination
  await col.createIndex({ chainAddress: 1 }, { unique: true });
}

/**
 * Creates the Atlas Vector Search index over `phashVector` (AMBER-tier ANN candidate
 * retrieval — see findAmberCandidates). Distinct from ensureIndexes()'s regular indexes:
 * Atlas builds search indexes asynchronously in the background (can take from seconds to a
 * few minutes on a shared/free tier), and `createSearchIndex` errors if one of the same name
 * already exists, so this is meant to be run once via scripts/create-vector-index.ts, not on
 * every server boot. Requires an Atlas cluster with Search/Vector Search enabled (7.0+).
 */
export async function ensureVectorIndex(): Promise<{ created: boolean; name: string }> {
  const col = await getCollection();
  const existing = await col.listSearchIndexes(PHASH_VECTOR_INDEX_NAME).toArray();
  if (existing.length > 0) {
    return { created: false, name: PHASH_VECTOR_INDEX_NAME };
  }
  const name = await col.createSearchIndex({
    name: PHASH_VECTOR_INDEX_NAME,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "phashVector",
          numDimensions: PHASH_VECTOR_DIMENSIONS,
          similarity: "euclidean",
        },
      ],
    },
  });
  return { created: true, name };
}

/** Polls until the vector search index reports queryable, or the timeout elapses. */
export async function waitForVectorIndexReady(timeoutMs = 120_000): Promise<boolean> {
  const col = await getCollection();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const indexes = await col.listSearchIndexes(PHASH_VECTOR_INDEX_NAME).toArray();
    // The driver's TS types for listSearchIndexes don't declare `queryable`, even though
    // Atlas returns it at runtime — cast narrowly rather than widening the whole result type.
    if ((indexes[0] as { queryable?: boolean } | undefined)?.queryable) return true;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

/** Maps a confirmed on-chain read into the Mongo document shape. Pure — no I/O. */
export function toAttestationDocument(
  record: ChainAttestationRecord,
  extra: { txSignature: string | null }
): AttestationDocument {
  return {
    _id: record.sha256,
    sha256: record.sha256,
    phash: record.phash,
    phashVector: phashHexToVector(record.phash),
    chainAddress: record.pda,
    timestamp: record.timestamp,
    device: record.devicePubkey,
    parentHash: record.parentHash,
    slot: Number(record.slot), // lookup.ts keeps slot as a decimal string (u64-safe); fine as a number here
    txSignature: extra.txSignature,
    explorerUrl: record.explorerUrl,
    indexedAt: Date.now(),
  };
}

/**
 * Upserts one attestation document, keyed by sha256. Called two ways:
 *   1. write-through after a successful /attest (fast path, has the tx signature)
 *   2. scripts/reindex.ts scanning getProgramAccounts (rebuild path, no tx signature)
 * Upsert-by-sha256 makes both idempotent and safe to run concurrently.
 */
export async function indexAttestation(doc: AttestationDocument): Promise<void> {
  const col = await getCollection();
  await col.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
}

/**
 * Placeholder AMBER threshold (max Hamming distance out of 64 bits to call "consistent with
 * a verified capture"). ROADMAP Rung 2 calls for measuring this from a real Instagram
 * round-trip experiment (post → download → hash → compare) — not yet run. This value is
 * picked conservatively from tests/phash.test.ts's synthetic evidence: recompress/resize/
 * brightness derivatives measured ≤8, unrelated images measured ≥16. 10 sits safely between
 * them. Tighten or loosen once the real experiment lands (guidance: false-amber is the
 * unaffordable failure, so bias low).
 */
export const AMBER_HAMMING_THRESHOLD = 10;

export interface AmberCandidate {
  document: AttestationDocument;
  hammingDistance: number;
}

/**
 * AMBER-tier candidate search: finds attestations whose pHash is close (by Hamming distance)
 * to the query pHash. This only ever *proposes* candidates — per lib/CLAUDE.md's iron rule
 * ("Mongo proposes, chain disposes"), the caller must chain-confirm each one (re-read its PDA
 * via lookupAttestation) before treating it as evidence.
 *
 * Two-stage: Atlas `$vectorSearch` does fast approximate nearest-neighbor retrieval over
 * `phashVector` (Euclidean distance ≈ Hamming distance — see phashVector.ts for why that
 * correlation is exact), over-fetching candidates cheaply even as the collection grows. Then
 * every candidate's *exact* Hamming distance is recomputed and used for the real filter/sort
 * — the ANN stage is a performance optimization only, never the source of truth for "close
 * enough." Falls back to a full collection scan (still exact, just not ANN-accelerated) if
 * the vector index doesn't exist yet or the cluster doesn't support Search — correctness
 * never depends on the index being present, only speed does.
 *
 * Note: Atlas Search indexes sync asynchronously — a document written moments ago may not
 * appear in `$vectorSearch` results for a few seconds (observed ~5-10s on the M0 tier used
 * here). This never causes a false AMBER (a missing candidate just falls through to GREY),
 * only a delayed one, so it's safe for the iron rule but worth knowing for demo timing.
 */
export async function findAmberCandidates(
  queryPhashHex: string,
  opts: { maxHammingDistance?: number; limit?: number } = {}
): Promise<AmberCandidate[]> {
  const maxHammingDistance = opts.maxHammingDistance ?? AMBER_HAMMING_THRESHOLD;
  const limit = opts.limit ?? 10;
  const col = await getCollection();

  let candidates: AttestationDocument[];
  try {
    candidates = await col
      .aggregate<AttestationDocument>([
        {
          $vectorSearch: {
            index: PHASH_VECTOR_INDEX_NAME,
            path: "phashVector",
            queryVector: phashHexToVector(queryPhashHex),
            numCandidates: Math.max(limit * 20, 150),
            limit: Math.max(limit * 5, 50), // over-fetch; exact Hamming filter below narrows it
          },
        },
      ])
      .toArray();
  } catch (err) {
    console.warn(
      "$vectorSearch unavailable (index missing/not queryable/unsupported cluster tier), " +
        "falling back to a full collection scan:",
      (err as Error).message
    );
    candidates = await col.find().toArray();
  }

  return candidates
    .map((document) => ({
      document,
      hammingDistance: hammingDistanceHex(queryPhashHex, document.phash),
    }))
    .filter((c) => c.hammingDistance <= maxHammingDistance)
    .sort((a, b) => a.hammingDistance - b.hammingDistance)
    .slice(0, limit);
}

export interface RecentPage {
  records: AttestationDocument[];
  nextCursor: string | null; // pass back as `before` to page further
}

/**
 * Paginated, newest-first query for the registry list (backs recentAttestations() —
 * see lib/CLAUDE.md #3). `before` is an opaque cursor (the previous page's oldest
 * timestamp) so pagination stays stable even as new attestations land.
 */
export async function queryRecent(opts: { limit?: number; before?: number } = {}): Promise<RecentPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const col = await getCollection();

  const filter = opts.before !== undefined ? { timestamp: { $lt: opts.before } } : {};
  const records = await col
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = records.length > limit;
  const page = hasMore ? records.slice(0, limit) : records;
  const nextCursor = hasMore ? String(page[page.length - 1].timestamp) : null;

  return { records: page, nextCursor };
}

/** Closes the Mongo connection. Used by scripts and tests; the long-lived server never calls this. */
export async function closeMongo(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = null;
}
