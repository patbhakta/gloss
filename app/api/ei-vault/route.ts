import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/clerk-shim";
import { db } from "@/lib/db";
/** A block id, in the reader's own alphabet. */
const uid = () => Math.random().toString(36).slice(2, 8);

export const runtime = "nodejs";

type Datapoint = {
  id: string;
  title: string;
  kicker: string;
  clip: string;
  clipName: string;
  values: { label: string; score: number }[];
};

/**
 * The emotional-intelligence baseline: a shelf of voice readings from the
 * Hume prosody atlas. Every limbic starts from the same generalized readings
 * — how emotion *sounds* — and interprets them for itself. One datapoint,
 * one text: the clip playable on the left, the machine's values as an
 * editable note on the right.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to shelve the baseline." }, { status: 401 });

  const raw = await readFile(path.join(process.cwd(), "data/ei-vault.json"), "utf8");
  const points = JSON.parse(raw) as Datapoint[];

  const existing = (await db().query("select id from articles where user_id = $1 and id = any($2)", [userId, points.map((p) => p.id)])) as unknown as { id: string }[];
  const have = new Set(existing.map((r) => r.id));
  const fresh = points.filter((p) => !have.has(p.id));

  for (const p of fresh) {
    const lead = p.values[0];
    const blocks = [
      { id: uid(), type: "quote", runs: [{ text: `A voice carrying ${lead.label} — ${Math.round(lead.score * 100)} parts in a hundred. The atlas heard it; your limbic reads it.` }] },
      { id: uid(), type: "h3", runs: [{ text: "The clip" }] },
      { id: uid(), type: "p", runs: [{ text: "Play the reading and hear it for yourself. What the machine measured is shelved as a note on the right — yours to keep, edit, or disagree with." }] },
      { id: uid(), type: "media", src: p.clip, kind: "audio" },
    ];
    const note = `Voice reading (prosody): ${p.values.map((v) => `${v.label} ${v.score.toFixed(2)}`).join(", ")}`;
    await db().query(
      `insert into articles (user_id, id, article_id, data, doc, deleted, updated_at) values ($1, $2, $2, $3, $4, false, now())
       on conflict (user_id, id) do update set data = excluded.data, doc = excluded.doc, deleted = false, updated_at = now()`,
      [
        userId,
        p.id,
        JSON.stringify({ title: p.title, author: "Hume prosody atlas", published: "", sourceUrl: "", topic: "emotional-intelligence", addedBy: "agent", words: 90, addedAt: Date.now() }),
        JSON.stringify({ v: 3, title: p.title, author: "Hume prosody atlas", blocks: blocks }),
      ],
    );
    // the reading as a margin note, anchored to the clip block
    await db().query(
      `insert into highlights (user_id, id, article_id, data, deleted, updated_at) values ($1, $2, $3, $4, false, now())
       on conflict (user_id, id) do update set data = excluded.data, deleted = false, updated_at = now()`,
      [
        userId,
        `${p.id}-reading`,
        p.id,
        JSON.stringify({ id: `${p.id}-reading`, articleId: p.id, note, color: "yellow", createdAt: Date.now(), anchor: { start: { b: blocks[3].id, o: 0 }, end: { b: blocks[3].id, o: 8 }, quote: "▶ clip" } }),
      ],
    );
  }

  return Response.json({ ok: true, shelved: fresh.length, skipped: have.size });
}
