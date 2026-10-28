/**
 * Sorting a text onto the library's shelves, on the server: one small call
 * to the fast model with the title and the opening, which picks a topic from
 * the fixed list, a few tags, and a scene for a painted cover. Never in the
 * way of an import: a failure leaves the text in Unsorted.
 */

import { cleanEmotions, cleanTags, TOPICS, topicOf, type Shelving } from "./library";
import { EXCERPT_CHARS } from "./excerpt";
import { completeJSON, DEFAULT_MODEL } from "./together";

export type ShelveInput = { title: string; author?: string; source?: string; dek?: string; excerpt?: string };

const SYSTEM = `You shelve texts in a reader's personal library.

Pick the one topic that fits best, by its key:
${TOPICS.filter((t) => t.key !== "unsorted")
  .map((t) => `- ${t.key}: ${t.hint}`)
  .join("\n")}

Then up to 3 human-readable topic tags: short lowercase words or phrases that say what the text is about (e.g. "recipe", "work", "relationship", "apartment", "speculative decoding").

Then one or two emotional bookshelf lanes from this exact list: bittersweet, hopeful, tender, joyful, playful, peaceful, curious, inspired, nostalgic, reflective, anxious, sad, angry, lonely. Choose the strongest feeling in the text, not the subject matter.

Then a scene for a wordless book-cover illustration of the text: one concrete visual metaphor with people, objects or a place, under 30 words. No text, letters, numbers, logos or screens with writing. No real people's likenesses.

Reply with JSON only: {"topic": "<key>", "tags": ["..."], "emotions": ["..."], "scene": "..."}`;

export async function classify(
  input: ShelveInput,
  opts: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<{ ok: true; shelving: Shelving; usd: number } | { ok: false; error: string }> {
  const lines = [
    `Title: ${input.title}`,
    input.author && `Author: ${input.author}`,
    input.source && `Source: ${input.source}`,
    input.dek && `Summary: ${input.dek}`,
    input.excerpt && `Opening:\n${input.excerpt.slice(0, EXCERPT_CHARS)}`,
  ].filter(Boolean);
  const r = await completeJSON<{ topic?: unknown; tags?: unknown; emotions?: unknown; scene?: unknown }>({
    model: DEFAULT_MODEL,
    apiKey: opts.apiKey,
    signal: opts.signal,
    maxTokens: 220,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: lines.join("\n") },
    ],
  });
  if (!r.ok) return r;
  const topic = topicOf(r.data.topic);
  const scene = typeof r.data.scene === "string" ? r.data.scene.replace(/\s+/g, " ").trim().slice(0, 300) : undefined;
  return { ok: true, shelving: { topic, tags: cleanTags(r.data.tags, topic), emotions: cleanEmotions(r.data.emotions), scene: scene || undefined }, usd: r.usage.costUsd };
}
