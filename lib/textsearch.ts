import { db } from "@/lib/db";

/**
 * Search across a reader's own texts: literal (substring, honest) and
 * semantic (in-house embeddings, cosine at read time). Flat rows in
 * para_embeds, no vector store — the table is disposable and rebuildable
 * from the docs (MD = truth, vectors derived).
 */

type Row = { article_id: string; block_id: string; text: string; vec: number[] | null };

export type Hit = { articleId: string; blockId: string; snippet: string; score?: number };

const EMBED_URL = "http://127.0.0.1:1234/v1/embeddings";
const EMBED_MODEL = "text-embedding-nomic-embed-text-v1.5";

export async function embed(input: string): Promise<number[] | null> {
  try {
    const r = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { embedding?: number[] }[] };
    return j.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function cos(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + text.slice(start, start + 140).trim();
}

export async function searchTexts(userId: string, q: string): Promise<{ literal: Hit[]; semantic: Hit[] }> {
  const query = q.trim();
  if (query.length < 2) return { literal: [], semantic: [] };
  const paras = (await db().query(
    "select article_id, block_id, text, vec from para_embeds where user_id = $1",
    [userId],
  )) as unknown as Row[];

  const literal: Hit[] = paras
    .filter((p) => p.text.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)
    .map((p) => ({ articleId: p.article_id, blockId: p.block_id, snippet: snippet(p.text, query) }));

  const qv = await embed(query);
  const semantic: Hit[] = qv
    ? paras
        .filter((p) => p.vec)
        .map((p) => ({ p, s: cos(qv, p.vec!) }))
        .filter((x) => x.s > 0.42)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((x) => ({ articleId: x.p.article_id, blockId: x.p.block_id, snippet: snippet(x.p.text, query), score: Math.round(x.s * 100) }))
    : [];

  return { literal, semantic };
}
