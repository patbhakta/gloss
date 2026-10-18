import { auth } from "@/lib/clerk-shim";
import { db } from "@/lib/db";
import { searchTexts } from "@/lib/textsearch";
import { DEFAULT_MODEL, streamChat, type ChatMessage } from "@/lib/together";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Chat with the whole library: retrieval over every text the reader owns
 * (literal + semantic, the same lane the shelf search uses), then an answer
 * composed ONLY from the retrieved passages, each citing the text it came
 * from. No web, no outside knowledge - the vault is the world.
 *
 * Streams NDJSON: {"sources":[...]} first, then {"delta":"..."} chunks as the
 * answer is written, then {"done":true}. Early exits (no hits, bad body)
 * return plain JSON for the client's fallback path.
 */

type Body = { q?: string; history?: { role: "user" | "assistant"; content: string }[] };

const SYSTEM = [
  "You answer questions about the reader's personal library of texts.",
  "Use ONLY the passages provided. Each passage names its text in a [Source] line.",
  "Cite the text you draw from inline, like (Title).",
  "If the passages do not contain the answer, say plainly that the library",
  "doesn't cover it - never invent, never pad with outside knowledge.",
  "Keep the voice plain and concrete. Short paragraphs. No headings unless asked.",
].join(" ");

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to chat." }, { status: 401 });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const q = (body.q ?? "").trim().slice(0, 500);
  if (!q) return Response.json({ error: "A question is required." }, { status: 400 });
  const history = (body.history ?? []).slice(-8).filter((m) => m && (m.role === "user" || m.role === "assistant"));

  // 1. Retrieve: the proven shelf-search lane, both literal and semantic.
  const { literal, semantic } = await searchTexts(userId, q);
  const seen = new Set<string>();
  const hits = [...semantic, ...literal].filter((h) => (seen.has(h.articleId + h.blockId) ? false : (seen.add(h.articleId + h.blockId), true))).slice(0, 8);
  if (hits.length === 0) {
    return Response.json({
      answer: "Nothing in your texts matches that. The library only answers from what's on the shelf - try other wording, or it may just not be in there yet.",
      sources: [],
    });
  }

  // 2. Widen each hit to its block plus neighbours, and name its text.
  const ids = [...new Set(hits.map((h) => h.articleId))];
  const artsFull = (await db().query(
    "select id, data, doc from articles where user_id = $1 and id = any($2::text[]) and deleted = false",
    [userId, ids],
  )) as unknown as { id: string; data: { title?: string }; doc?: { blocks?: { id: string; runs?: { text?: string }[] }[] } }[];
  const titleOf = new Map(artsFull.map((a) => [a.id, a.data?.title ?? a.id]));
  const blocksOf = new Map(artsFull.map((a) => [a.id, (a.doc?.blocks ?? []).map((b) => ({ id: b.id, text: (b.runs ?? []).map((r) => r.text ?? "").join("") }))]));

  // Notes pinned to lines (delivery descriptions, EI machine readings) are
  // part of the truth the reader sees - the chat must see them too.
  const notesByArticle = new Map<string, Map<string, string[]>>();
  try {
    const hl = (await db().query(
      "select article_id, data from highlights where user_id = $1 and article_id = any($2::text[]) and deleted = false",
      [userId, ids],
    )) as unknown as { article_id: string; data: { note?: string; anchor?: { start?: { b?: string } } } }[];
    for (const h of hl) {
      const b = h.data?.anchor?.start?.b;
      const note = (h.data?.note ?? "").trim();
      if (!b || !note) continue;
      if (!notesByArticle.has(h.article_id)) notesByArticle.set(h.article_id, new Map());
      const m = notesByArticle.get(h.article_id)!;
      if (!m.has(b)) m.set(b, []);
      m.get(b)!.push(note);
    }
  } catch {
    /* notes are enrichment - never fail the answer over them */
  }

  const passages: string[] = [];
  const sources: { id: string; title: string; snippet: string }[] = [];
  for (const h of hits) {
    const blocks = blocksOf.get(h.articleId) ?? [];
    const at = blocks.findIndex((b) => b.id === h.blockId);
    const window = at < 0 ? [] : blocks.slice(Math.max(0, at - 1), at + 2).map((b) => {
      const notes = notesByArticle.get(h.articleId)?.get(b.id) ?? [];
      return notes.length ? `${b.text} [notes: ${notes.join("; ")}]` : b.text;
    }).filter(Boolean);
    const text = window.join("\n").slice(0, 1200);
    if (!text) continue;
    const title = titleOf.get(h.articleId) ?? h.articleId;
    passages.push(`[Source: ${title}]\n${text}`);
    if (!sources.some((s) => s.id === h.articleId)) sources.push({ id: h.articleId, title, snippet: h.snippet });
  }
  if (passages.length === 0) {
    return Response.json({ answer: "I found the texts but could not open their pages for this one. Try again in a moment.", sources: [] });
  }

  // 3. Compose on the subscription lane, streaming NDJSON to the client.
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...history.map((m) => ({ role: m.role, content: m.content } as ChatMessage)),
    { role: "user", content: `${q}\n\nPassages from the reader's library:\n\n${passages.join("\n\n---\n\n")}` },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ sources });
      let answer = "";
      try {
        for await (const ev of streamChat({ messages, model: DEFAULT_MODEL })) {
          if (ev.type === "content" && ev.text) {
            answer += ev.text;
            send({ delta: ev.text });
          } else if (ev.type === "error") {
            send({ error: ev.text || "The model did not answer." });
          }
        }
        send({ done: true, empty: !answer.trim() });
      } catch (e) {
        send({ error: "The model did not answer. Try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
