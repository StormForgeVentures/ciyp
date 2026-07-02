/**
 * Voyage embedder port — ASYMMETRIC input types are STRUCTURAL (PRD-002b FR-6).
 *
 * There is deliberately NO generic `embed()` export: index-time and query-time
 * embeddings MUST carry different Voyage `input_type`s (`document` vs `query`) or dense
 * recall silently degrades. Exposing only `embedForIndex` / `embedForQuery` makes the
 * wrong pairing unrepresentable (decision #20: index + query embedder MUST be the same
 * model — enforced by the shared `EMBED_MODEL`).
 *
 * The low-level caller is injectable so unit tests capture the outbound `input_type`
 * without a network hop (AC-6) and never spend Voyage tokens. The default caller reads
 * the committed on-disk fixture cache first (a seeded text costs ZERO Voyage tokens),
 * matching the seed pipeline's cache so a re-run is free.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export type VoyageInputType = 'document' | 'query';
export const EMBED_DIM = 1024;
/** Index + query MUST share this model (decision #20). Overridable per-deploy. */
export const EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL?.trim() || 'voyage-3-large';

/** The low-level batched embed call. Injectable — the seam AC-6 captures. */
export type VoyageCaller = (
  texts: string[],
  inputType: VoyageInputType,
) => Promise<number[][]>;

// The seed pipeline commits fixtures under packages/db/fixtures/embeddings, keyed by
// sha256(model|input_type|dim|text). We read the SAME cache so cached texts cost $0.
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '../../../../packages/db/fixtures/embeddings');

function fixturePath(inputType: VoyageInputType, text: string): string {
  const hash = createHash('sha256')
    .update(`${EMBED_MODEL}|${inputType}|${EMBED_DIM}|${text}`)
    .digest('hex');
  return resolve(FIXTURE_DIR, `${hash}.json`);
}

function readFixture(path: string): number[] | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { embedding: number[] };
    return Array.isArray(parsed.embedding) && parsed.embedding.length === EMBED_DIM
      ? parsed.embedding
      : null;
  } catch {
    return null;
  }
}

let tokensSpent = 0;
/** Voyage tokens spent this process — asserted `=== 0` in the spend-0 discipline. */
export function voyageTokensSpent(): number {
  return tokensSpent;
}

/** The default caller: fixture-cache first, real Voyage only for misses; writes back. */
export const defaultVoyageCaller: VoyageCaller = async (texts, inputType) => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const out: (number[] | null)[] = texts.map(() => null);
  const misses: { idx: number; text: string; path: string }[] = [];
  texts.forEach((text, idx) => {
    const p = fixturePath(inputType, text);
    const cached = readFixture(p);
    if (cached) out[idx] = cached;
    else misses.push({ idx, text, path: p });
  });

  if (misses.length > 0) {
    const key = process.env.VOYAGE_API_KEY;
    if (!key || key.trim() === '') {
      throw new Error(
        `Voyage embed cache miss for ${misses.length} text(s) and no VOYAGE_API_KEY — ` +
          `refusing a synthetic vector (never-ship-mock). Seed the fixture or inject a caller.`,
      );
    }
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: misses.map((m) => m.text),
        input_type: inputType,
        output_dimension: EMBED_DIM,
      }),
    });
    if (!res.ok) throw new Error(`Voyage API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as {
      data: { embedding: number[]; index: number }[];
      usage?: { total_tokens?: number };
    };
    tokensSpent += json.usage?.total_tokens ?? 0;
    json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach((d, j) => {
        const m = misses[j];
        if (!m) return;
        out[m.idx] = d.embedding;
        writeFileSync(m.path, JSON.stringify({ model: EMBED_MODEL, embedding: d.embedding }));
      });
  }

  return out.map((e, i) => {
    if (!e) throw new Error(`No embedding produced for input ${i}`);
    return e;
  });
};

export interface Embedder {
  /** INDEX side — `input_type: 'document'`. Corpus ingestion (PRD-005). */
  embedForIndex(texts: string[]): Promise<number[][]>;
  /** QUERY side — `input_type: 'query'`. Retrieval (the dense leg). */
  embedForQuery(text: string): Promise<number[]>;
}

/** Build the embedder over an injectable caller (default: fixture-cached Voyage). */
export function createEmbedder(caller: VoyageCaller = defaultVoyageCaller): Embedder {
  return {
    async embedForIndex(texts) {
      if (texts.length === 0) return [];
      return caller(texts, 'document');
    },
    async embedForQuery(text) {
      const [v] = await caller([text], 'query');
      if (!v) throw new Error('embedForQuery: no embedding returned');
      return v;
    },
  };
}

/** pgvector literal for a float array. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
