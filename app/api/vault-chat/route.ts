import { RAG_SYSTEM, inspectContent, quoteEvidence, checkedAnswer, type Evidence } from "@/lib/rag-guard";
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

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to chat." }, { status: 401 });
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 500) : "";
  if (!q) return Response.json({ error: "A question is required." }, { status: 400 });
  // Client history is not authenticated conversation state; this endpoint is stateless.

  // 1. Retrieve: the proven shelf-search lane, both literal and semantic.
  const { literal, semantic } = await searchTexts(userId, q);
  const seen = new Set<string>();
  const hits = [...semantic, ...literal].filter((h) => (seen.has(JSON.stringify([h.articleId, h.blockId])) ? false : (seen.add(JSON.stringify([h.articleId, h.blockId])), true))).slice(0, 8);
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

  const evidence: Evidence[] = [];
  const sources: { id: string; title: string; snippet: string; blockId?: string; label: string }[] = [];
  for (const h of hits) {
    const blocks = blocksOf.get(h.articleId) ?? [];
    const at = blocks.findIndex((b) => b.id === h.blockId);
    if (at < 0) continue;
    const notes = notesByArticle.get(h.articleId)?.get(h.blockId) ?? [];
    const text = [blocks[at].text, ...notes].join("\n").slice(0, 1200);
    if (!text) continue;
    const title = titleOf.get(h.articleId) ?? h.articleId;
    evidence.push({ label: `S${evidence.length + 1}`, articleId: h.articleId, blockId: h.blockId, title, text });
    sources.push({ id: h.articleId, title, snippet: text.slice(0, 140), blockId: h.blockId, label: evidence[evidence.length - 1].label });
  }
  if (evidence.length === 0) {
    return Response.json({ answer: "I found the texts but could not open their pages for this one. Try again in a moment.", sources: [] });
  }

  // Known injection payloads remain quotable data and never reach the model.
  if (evidence.some((e) => inspectContent(e.title + "\n" + e.text).suspicious)) {
    return Response.json({ answer: quoteEvidence(evidence), sources });
  }

  // 3. Compose on the subscription lane, streaming NDJSON to the client.
  const messages: ChatMessage[] = [
    { role: "system", content: RAG_SYSTEM },
    { role: "user", content: JSON.stringify({ question: q, untrustedEvidence: evidence }) },
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
            if (answer.length > 16000) throw new Error("Answer exceeds limit");
          } else if (ev.type === "error") {
            throw new Error("Model stream failed");
          }
        }
        send({ delta: checkedAnswer(answer, evidence) });
        send({ done: true, empty: false });
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
