// Canon chunking (ai-architecture §3 / architecture §4.4): recursive ~500-char
// chunks, 20% overlap, TITLE-PREPENDED. Splits on paragraph/sentence boundaries
// where possible so a chunk is coherent, then packs to the target size.

export interface Chunk {
  index: number;
  text: string; // title-prepended, embedded + tsvector'd
}

const TARGET = 500;
const OVERLAP = Math.round(TARGET * 0.2); // 100 chars

/** Split body into ~TARGET windows honoring sentence boundaries, with OVERLAP. */
function windows(body: string): string[] {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  // Sentence-ish units: split on paragraph breaks then sentence terminators.
  const units: string[] = [];
  for (const para of normalized.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const sentences = trimmed.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [trimmed];
    for (const s of sentences) {
      const t = s.trim();
      if (t) units.push(t);
    }
  }

  const out: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current.length === 0) {
      current = unit;
    } else if (current.length + 1 + unit.length <= TARGET) {
      current += ' ' + unit;
    } else {
      out.push(current);
      // Start the next window with a tail overlap of the previous one.
      const tail = current.slice(Math.max(0, current.length - OVERLAP));
      const tailAtWord = tail.replace(/^\S*\s/, '');
      current = (tailAtWord ? tailAtWord + ' ' : '') + unit;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/** Chunk a titled document. Each chunk is title-prepended. */
export function chunkDocument(title: string, body: string): Chunk[] {
  return windows(body).map((w, index) => ({
    index,
    text: `${title}\n\n${w}`,
  }));
}
