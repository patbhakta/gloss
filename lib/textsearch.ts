import { db } from "@/lib/db";
import { embed } from "@/lib/embedding-index";

/** Document-first retrieval. articles.doc is truth; para_embeds is optional. */
export type Hit = { articleId: string; blockId: string; snippet: string; score?: number };
export type NoteHit = { id: string; articleId: string; blockId: string; text: string };
export type SummaryHit = { articleId: string; title: string; text: string; score?: number };
export type SearchResult = { literal: Hit[]; semantic: Hit[]; notes: NoteHit[]; summaries: SummaryHit[]; topScore?: number };
type BlockRow = { articleId: string; blockId: string; text: string };
type SourceBlock = { id: string; type?: string; runs?: { text?: string }[]; rows?: unknown[][] };
type ArticleRow = { id: string; data?: Record<string, unknown>; doc?: { blocks?: SourceBlock[] } };

const STOP = new Set("a an and are as at be by for from had has have how i in is it of on or that the their this to was what when where with you".split(" "));

function blockText(block: SourceBlock): string {
  if (block.type === "table" && block.rows) return block.rows.map(row => row.map(cell => String(cell ?? "")).join(" | ")).join("\n");
  return (block.runs ?? []).map(run => run.text ?? "").join("");
}

function snippet(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, 300).trim();
  const start = Math.max(0, at - 100);
  return `${start ? "…" : ""}${text.slice(start, start + 300).trim()}`;
}

function score(text: string, query: string): number {
  const hay = text.toLowerCase();
  const q = query.toLowerCase();
  const words = q.match(/[a-z0-9']+/g)?.filter(word => word.length > 2 && !STOP.has(word)) ?? [];
  const matched = words.filter(word => hay.includes(word)).length;
  return (hay.includes(q) ? 1000 : 0) + matched * 10 + (words.length ? matched / words.length : 0);
}

async function fuzzyArticleScores(userId: string, query: string): Promise<Map<string, number>> {
  try {
    const rows = await db().query(
      `select id, similarity(coalesce(data->>'title', '') || ' ' || coalesce(doc::text, ''), $2) as fuzzy
       from articles where user_id = $1 and not deleted and doc is not null
       and similarity(coalesce(data->>'title', '') || ' ' || coalesce(doc::text, ''), $2) >= 0.18
       order by fuzzy desc limit 100`,
      [userId, query],
    ) as unknown as { id: string; fuzzy: number }[];
    return new Map(rows.map(row => [row.id, Number(row.fuzzy)]));
  } catch {
    // pg_trgm is optional on existing installations. Literal retrieval stays
    // authoritative if the extension has not been migrated yet.
    return new Map();
  }
}

async function optionalSemantic(userId: string, query: string, candidates: Hit[]): Promise<Map<string, number>> {
  if (process.env.PERSONA_CHAT_SEMANTIC_RERANK !== "1") return new Map();
  const qv = await embed(query);
  if (!qv) return new Map();
  const stored = await db().query("select article_id, block_id, text, vec from para_embeds where user_id = $1", [userId]) as unknown as { article_id: string; block_id: string; text: string; vec: number[] | null }[];
  const cosine = (a: number[], b: number[]) => {
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
  };
  const allowed = new Set(candidates.map(candidate => `${candidate.articleId}/${candidate.blockId}`));
  return new Map(stored.filter(row => row.vec?.length && allowed.has(`${row.article_id}/${row.block_id}`))
    .map(row => [`${row.article_id}/${row.block_id}`, cosine(qv, row.vec!)] as const));
}

export async function searchTexts(userId: string, q: string): Promise<SearchResult> {
  const query = q.trim();
  if (query.length < 2) return { literal: [], semantic: [], notes: [], summaries: [] };
  const articles = await db().query("select id, data, doc from articles where user_id = $1 and not deleted and doc is not null", [userId]) as unknown as ArticleRow[];
  const briefs = await db().query("select id, data from briefs where user_id = $1 and not deleted", [userId]) as unknown as { id: string; data?: { gist?: string; claims?: { text?: string }[] } }[];
  const briefByArticle = new Map(briefs.map(row => [row.id, row.data ?? {}]));
  const summaries = articles.map(article => {
    const data = article.data ?? {};
    const brief = briefByArticle.get(article.id) ?? {};
    const distilled = [
      data.title, data.dek, data.scene, data.topic,
      ...(Array.isArray(data.tags) ? data.tags : []),
      ...(Array.isArray(data.emotions) ? data.emotions : []),
      brief.gist, ...(brief.claims ?? []).map(claim => claim.text),
    ].filter(value => typeof value === "string" && value.trim()).join(". ");
    return { articleId: article.id, title: String(data.title ?? "Library source"), text: distilled, score: score(distilled, query) };
  }).filter(summary => summary.score > 0).sort((a, b) => b.score - a.score).slice(0, 100);
  const summaryScores = new Map(summaries.map(summary => [summary.articleId, summary.score]));
  const rows: BlockRow[] = [];
  for (const article of articles) for (const block of article.doc?.blocks ?? []) {
    const text = blockText(block);
    if (text.trim()) rows.push({ articleId: article.id, blockId: block.id, text });
  }
  const fuzzy = await fuzzyArticleScores(userId, query);
  const ranked = rows.map(row => ({ row, score: score(row.text, query) + (fuzzy.get(row.articleId) ?? 0) * 25 + (summaryScores.get(row.articleId) ?? 0) * 0.01 }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
  let literal = ranked.map(({ row, score: value }) => ({ articleId: row.articleId, blockId: row.blockId, snippet: snippet(row.text, query), score: value }));
  const semanticScores = await optionalSemantic(userId, query, literal);
  if (semanticScores.size) literal = [...literal].sort((a, b) =>
    ((b.score ?? 0) + (semanticScores.get(`${b.articleId}/${b.blockId}`) ?? 0) * 0.25) -
    ((a.score ?? 0) + (semanticScores.get(`${a.articleId}/${a.blockId}`) ?? 0) * 0.25));

  // Highlights with a written note are the personal/emotional layer. Always
  // return them, including notes that do not contain query words.
  const noteRows = await db().query("select id, article_id, data from highlights where user_id = $1 and not deleted and coalesce(data->>'note', '') <> '' order by updated_at asc", [userId]) as unknown as { id: string; article_id: string; data?: { note?: string; anchor?: { start?: { b?: string } } } }[];
  const notes = noteRows.map(row => ({ id: row.id, articleId: row.article_id, blockId: row.data?.anchor?.start?.b ?? "", text: row.data?.note?.trim() ?? "" }))
    .filter(note => note.text)
    .sort((a, b) => score(b.text, query) - score(a.text, query));
  return { literal, semantic: [], notes, summaries, topScore: literal[0]?.score };
}
