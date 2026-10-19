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

  // Literal, honest - but the query may be a whole sentence wrapping a quote:
  // any "quoted fragment" inside it is searched on its own too.
  const fragments = [query, ...query.match(/["“”']([^"“”']{6,})["“”']/g)?.map((m) => m.replace(/["“”']/g, "") ?? []) ?? []];
  const literal: Hit[] = paras
    .filter((p) => fragments.some((f) => p.text.toLowerCase().includes(f.toLowerCase())))
    .slice(0, 8)
    .map((p) => ({ articleId: p.article_id, blockId: p.block_id, snippet: snippet(p.text, fragments.find((f) => p.text.toLowerCase().includes(f.toLowerCase())) ?? query) }));

  const qv = await embed(query);
  let semantic: Hit[] = [];
  if (qv) {
    // Article-level score, tuned on the retrieval eval suite (Oct 18):
    // best paragraph similarity + 0.3 x title similarity + 0.15 x content-word
    // overlap. Titles are concrete on purpose - they carry the topic.
    const titles = (await db().query(
      "select article_id, vec from title_embeds where user_id = $1",
      [userId],
    )) as unknown as { article_id: string; vec: number[] }[];
    const titleVec = new Map(titles.map((t) => [t.article_id, Array.from(t.vec ?? [])]));
    const byArticle = new Map<string, { best: number; para: Row }>();
    for (const p of paras) {
      if (!p.vec) continue;
      const s = cos(qv, p.vec);
      const cur = byArticle.get(p.article_id);
      if (!cur || s > cur.best) byArticle.set(p.article_id, { best: s, para: p });
    }
    const words = query.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];
    const fullText = new Map<string, string>();
    for (const p of paras) fullText.set(p.article_id, (fullText.get(p.article_id) ?? "") + " " + (p.text ?? "").toLowerCase());
    const entries = [...byArticle.entries()].map(([aid, { best, para }]) => {
      const tv = titleVec.get(aid);
      const tSim = tv && tv.length ? cos(qv, tv) : 0;
      const text = fullText.get(aid) ?? "";
      const kw = words.length ? words.filter((w) => text.includes(w)).length / words.length : 0;
      return { aid, para, paraScore: best, tSim, kw };
    });
    if (!entries.length) return { literal, semantic };
    // Rank fusion (enterprise-rag pattern, adapted): combine three INDEPENDENT
    // rankings - paragraph cosine, title cosine, keyword overlap - with
    // weighted Reciprocal Rank Fusion. Ranks only, so unlike scales mix
    // without normalisation; each list's #1 is guaranteed a slot so one good
    // retriever is never buried by the other two.
    const rank = (arr: typeof entries, key: (e: (typeof entries)[number]) => number) =>
      [...arr].sort((a, b) => key(b) - key(a)).map((e) => e.aid);
    const lists: { ids: string[]; weight: number }[] = [
      { ids: rank(entries, (e) => e.paraScore), weight: 1 },
      { ids: rank(entries, (e) => e.tSim), weight: 0.5 },
      { ids: rank(entries, (e) => e.kw), weight: 0.3 },
    ];
    const K = 20; // grid-searched on the 90-question eval (Oct 19)
    const fused = new Map<string, number>();
    const listTop = new Set<string>();
    for (const l of lists) {
      l.ids.slice(0, 50).forEach((aid, i) => {
        fused.set(aid, (fused.get(aid) ?? 0) + l.weight / (K + i + 1));
      });
      if (l.ids[0]) listTop.add(l.ids[0]);
    }
    const ranked = [...fused.entries()]
      .map(([aid, score]) => ({ aid, score, e: entries.find((x) => x.aid === aid)! }))
      .filter((x) => x.e)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    // guaranteed slots: any list's #1 missing from the top-8 displaces rank 8
    for (const aid of listTop) {
      if (!ranked.some((r) => r.aid === aid)) {
        const e = entries.find((x) => x.aid === aid);
        if (e) ranked.push({ aid, score: -1, e });
      }
    }
    semantic = ranked.slice(0, 8).map((x) => ({ articleId: x.aid, blockId: x.e.para.block_id, snippet: snippet(x.e.para.text, query), score: Math.round(x.score * 1000) }));
  }

  return { literal, semantic };
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "at", "for", "with", "about", "and", "or", "is", "are", "was", "were", "be", "been", "do", "does", "did", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "that", "this", "these", "those", "it", "its", "his", "her", "their", "your", "my", "our", "you", "he", "she", "they", "we", "not", "no", "yes", "got", "get", "gets"]);
