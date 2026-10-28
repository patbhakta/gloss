import { db } from "@/lib/db";
import { embed } from "@/lib/embedding-index";

/** Document-first retrieval. articles.doc is truth; para_embeds is optional. */
export type Hit = { articleId: string; blockId: string; snippet: string; score?: number };
export type NoteHit = { id: string; articleId: string; blockId: string; text: string };
export type SearchResult = { literal: Hit[]; semantic: Hit[]; notes: NoteHit[]; topScore?: number };
type BlockRow = { articleId: string; blockId: string; text: string };
type SourceBlock = { id: string; type?: string; runs?: { text?: string }[]; rows?: unknown[][] };
type ArticleRow = { id: string; doc?: { blocks?: SourceBlock[] } };

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

async function optionalSemantic(userId: string, query: string): Promise<Hit[]> {
  if (process.env.PERSONA_CHAT_SEMANTIC_RERANK !== "1") return [];
  const qv = await embed(query);
  if (!qv) return [];
  const stored = await db().query("select article_id, block_id, text, vec from para_embeds where user_id = $1", [userId]) as unknown as { article_id: string; block_id: string; text: string; vec: number[] | null }[];
  const cosine = (a: number[], b: number[]) => {
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
  };
  return stored.filter(row => row.vec?.length).map(row => ({ articleId: row.article_id, blockId: row.block_id, snippet: row.text.slice(0, 300), score: cosine(qv, row.vec!) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8);
}

export async function searchTexts(userId: string, q: string): Promise<SearchResult> {
  const query = q.trim();
  if (query.length < 2) return { literal: [], semantic: [], notes: [] };
  const articles = await db().query("select id, doc from articles where user_id = $1 and not deleted and doc is not null", [userId]) as unknown as ArticleRow[];
  const rows: BlockRow[] = [];
  for (const article of articles) for (const block of article.doc?.blocks ?? []) {
    const text = blockText(block);
    if (text.trim()) rows.push({ articleId: article.id, blockId: block.id, text });
  }
  const ranked = rows.map(row => ({ row, score: score(row.text, query) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 80);
  const literal = ranked.map(({ row, score: value }) => ({ articleId: row.articleId, blockId: row.blockId, snippet: snippet(row.text, query), score: value }));

  // Highlights with a written note are the personal/emotional layer. Always
  // return them, including notes that do not contain query words.
  const noteRows = await db().query("select id, article_id, data from highlights where user_id = $1 and not deleted and coalesce(data->>'note', '') <> '' order by updated_at asc", [userId]) as unknown as { id: string; article_id: string; data?: { note?: string; anchor?: { start?: { b?: string } } } }[];
  const notes = noteRows.map(row => ({ id: row.id, articleId: row.article_id, blockId: row.data?.anchor?.start?.b ?? "", text: row.data?.note?.trim() ?? "" }))
    .filter(note => note.text)
    .sort((a, b) => score(b.text, query) - score(a.text, query));
  const semantic = await optionalSemantic(userId, query);
  return { literal, semantic, notes, topScore: literal[0]?.score };
}
