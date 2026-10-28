import { db } from "@/lib/db";

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

type Block = { id?: unknown; runs?: { text?: unknown }[]; rows?: unknown[][]; type?: unknown };
type ArticleDoc = { blocks?: Block[] };

function blockText(block: Block): string {
  if (block.type === "table" && Array.isArray(block.rows)) {
    return block.rows.map((row) => row.map((cell) => String(cell ?? "")).join(" | ")).join("\n");
  }
  return (block.runs ?? []).map((run) => String(run.text ?? "")).join("");
}

function blocksOf(doc: unknown): { id: string; text: string }[] {
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as ArticleDoc).blocks)) return [];
  return (doc as ArticleDoc).blocks
    ?.map((block) => ({ id: String(block.id ?? ""), text: blockText(block) }))
    .filter((block) => block.id && block.text.trim()) ?? [];
}

/** Rebuild the disposable paragraph lane for articles changed by sync. */
export async function indexArticleEmbeds(
  userId: string,
  articles: { id: string; deleted: boolean; doc?: unknown }[],
): Promise<void> {
  for (const article of articles) {
    try {
      if (article.deleted) {
        await db().query("delete from para_embeds where user_id = $1 and article_id = $2", [userId, article.id]);
        continue;
      }
      const blocks = blocksOf(article.doc);
      const seen = new Set<string>();
      for (const block of blocks) {
        const vec = await embed(block.text);
        if (!vec) continue;
        seen.add(block.id);
        await db().query(
          `insert into para_embeds (user_id, article_id, block_id, text, vec)
           values ($1, $2, $3, $4, $5::jsonb)
           on conflict (user_id, article_id, block_id) do update
           set text = excluded.text, vec = excluded.vec, updated_at = now()`,
          [userId, article.id, block.id, block.text, JSON.stringify(vec)],
        );
      }
      // Remove rows for blocks deleted by an edit, preventing stale note text.
      await db().query(
        "delete from para_embeds where user_id = $1 and article_id = $2 and not (block_id = any($3::text[]))",
        [userId, article.id, [...seen]],
      );
    } catch {
      // Search remains available through the literal article fallback below;
      // an unavailable embedder must never make sync fail.
    }
  }
}
