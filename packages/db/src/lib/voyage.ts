import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { requireEnv, optionalEnv } from './env.js';

// Voyage embedder with a content-hash fixture cache (PRD-001c Q-3): every embedding
// is cached on disk keyed by sha256(model|input_type|dim|text) and COMMITTED, so a
// `supabase db reset && pnpm seed` re-run costs ZERO Voyage tokens unless content
// changes. Real embeddings only — no synthetic vectors (never-ship-mock).

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '../../fixtures/embeddings');

// Verified live at 1024 dims (project-state; operator-confirmed key). ai-architecture
// §2 names voyage-3.5 as the embed slot; both emit 1024-dim — reconcile at provisioning.
export const EMBED_MODEL = optionalEnv('VOYAGE_EMBED_MODEL', 'voyage-3-large');
export const EMBED_DIM = 1024;

export type VoyageInputType = 'document' | 'query';

function fixturePath(model: string, inputType: VoyageInputType, text: string): string {
  const hash = createHash('sha256')
    .update(`${model}|${inputType}|${EMBED_DIM}|${text}`)
    .digest('hex');
  return resolve(FIXTURE_DIR, `${hash}.json`);
}

function readFixture(path: string): number[] | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { embedding: number[] };
    if (Array.isArray(parsed.embedding) && parsed.embedding.length === EMBED_DIM) {
      return parsed.embedding;
    }
    return null;
  } catch {
    return null;
  }
}

let tokensSpent = 0;
export function voyageTokensSpent(): number {
  return tokensSpent;
}

async function callVoyage(
  texts: string[],
  inputType: VoyageInputType,
): Promise<number[][]> {
  const key = requireEnv('VOYAGE_API_KEY');
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: EMBED_DIM,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
    usage?: { total_tokens?: number };
  };
  tokensSpent += json.usage?.total_tokens ?? 0;
  // Voyage returns results in-order but sort by index to be safe.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Embed texts as documents, using the on-disk fixture cache. Only uncached texts
 * hit the API, batched. New embeddings are written back as fixtures. Returns
 * embeddings aligned to the input order.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const result: (number[] | null)[] = texts.map(() => null);
  const misses: { idx: number; text: string; path: string }[] = [];

  texts.forEach((text, idx) => {
    const path = fixturePath(EMBED_MODEL, 'document', text);
    const cached = readFixture(path);
    if (cached) result[idx] = cached;
    else misses.push({ idx, text, path });
  });

  const BATCH = 96; // stay under Voyage per-request input + token ceilings
  for (let i = 0; i < misses.length; i += BATCH) {
    const slice = misses.slice(i, i + BATCH);
    const vectors = await callVoyage(
      slice.map((m) => m.text),
      'document',
    );
    slice.forEach((m, j) => {
      const embedding = vectors[j]!;
      result[m.idx] = embedding;
      writeFileSync(m.path, JSON.stringify({ model: EMBED_MODEL, embedding }));
    });
  }

  return result.map((e, idx) => {
    if (!e) throw new Error(`No embedding produced for input ${idx}`);
    return e;
  });
}

/** pgvector literal for a float array: '[0.1,0.2,...]'. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
