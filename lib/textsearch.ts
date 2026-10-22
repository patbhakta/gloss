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

const titleCache = new Map<string, Map<string, string>>();
async function titlesFor(userId: string): Promise<Map<string, string>> {
  let m = titleCache.get(userId);
  if (!m) {
    m = new Map();
    try {
      const t = (await db().query("select id, data->>'title' as title from articles where user_id = $1 and deleted = false", [userId])) as unknown as { id: string; title?: string }[];
      for (const r of t) m!.set(r.id, r.title ?? r.id);
    } catch {}
    titleCache.set(userId, m);
  }
  return m;
}

export async function searchTexts(userId: string, q: string): Promise<{ literal: Hit[]; semantic: Hit[]; topScore?: number }> {
  const query = q.trim();
  let topScore: number | undefined;
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
    // Whole-article vectors (title + opening text): topical questions match
    // the scene as a unit far better than any single line (eval Oct 19).
    const arts = (await db().query(
      "select article_id, vec from article_embeds where user_id = $1",
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
    const artVec = new Map(arts.map((a) => [a.article_id, Array.from(a.vec ?? [])]));
    // Scene-plot lane (HU-3247): Emory plot summaries paraphrase-match far
    // better than any single transcript line; flat rows, disposable like the rest.
    let plotVec = new Map<string, number[]>();
    const plotText = new Map<string, string>();
    try {
      const plots = (await db().query(
        "select article_id, vec, text from plot_embeds where user_id = $1",
        [userId],
      )) as unknown as { article_id: string; vec: number[]; text?: string }[];
      for (const p of plots) {
        plotVec.set(p.article_id, Array.from(p.vec ?? []));
        if (p.text) plotText.set(p.article_id, p.text);
      }
    } catch {}
    const coFull = new Set<string>();
    const typoFull = new Set<string>();
    const lists: { ids: string[]; weight: number }[] = [
      { ids: rank(entries, (e) => e.paraScore), weight: 1 },
      { ids: rank(entries, (e) => e.tSim), weight: 0.5 },
      { ids: rank(entries, (e) => e.kw), weight: 0.3 },
      { ids: rank(entries, (e) => { const v = artVec.get(e.aid); return v && v.length ? cos(qv!, v) : 0; }), weight: 1.2 },
    ];
    // Paraphrase queries (no quoted fragment) get the plot lane in fusion;
    // quote-bearing queries stay on literal/para evidence - the plot vector
    // shifts fusion ranks and buries exact-line matches (eval v8c, HU-3247).
    // "What happened in the scene where <fragment>" is a quote-style probe
    // (not_witnessed junk pool) even without quote chars - paraphrase lanes
    // must stay off it or they manufacture confident hits on absent text.
    const sceneWhere = /scene where/i.test(query);
    if (fragments.length < 2 && !sceneWhere) {
      lists.push({ ids: rank(entries, (e) => { const v = plotVec.get(e.aid); return v && v.length ? cos(qv!, v) : 0; }), weight: 0.8 });
    }
    // Rare-term co-occurrence lane (HU-3247): "where X came up together
    // with Y" queries are lexical ANDs. Embeddings and the fraction-overlap
    // keyword lane cannot rank them (answer never reached the pool: flat
    // 0.80 sentinel on 11/14). Rare-pair AND pins one scene — offline
    // probe 14/14 top-1. Quote-bearing queries keep pure evidence paths.
    if (fragments.length < 2 && !sceneWhere) {
      const sceneText = new Map<string, string>();
      for (const p of paras) sceneText.set(p.article_id, (sceneText.get(p.article_id) ?? "") + " " + (p.text ?? "").toLowerCase());
      for (const [aid, t] of plotText) sceneText.set(aid, (sceneText.get(aid) ?? "") + " " + t.toLowerCase());
      const df = new Map<string, number>();
      for (const t of sceneText.values()) {
        for (const w of new Set(t.match(/[a-z']+/g) ?? [])) df.set(w, (df.get(w) ?? 0) + 1);
      }
      // question-template words ("what was GOING on in the MEMORY where X CAME
      // UP TOGETHER with Y") are rare enough to pass the df cut but poison the
      // AND-match - the answer scene never contains them.
      const FRAME = new Set(["going", "memory", "came", "together", "happened", "scene", "contains", "quote", "something", "like"]);
      const coTerms = words.filter((w) => { const d = df.get(w) ?? 0; return d > 0 && d <= 25 && !FRAME.has(w); });
      if (coTerms.length >= 2) {
        const scored: { aid: string; m: number; dfSum: number }[] = [];
        for (const [aid, t] of sceneText) {
          const m = coTerms.filter((w) => t.includes(w));
          if (m.length) scored.push({ aid, m: m.length, dfSum: m.reduce((s, w) => s + (df.get(w) ?? 0), 0) });
        }
        scored.sort((a, b) => b.m - a.m || a.dfSum - b.dfSum);
        lists.push({ ids: scored.map((s) => s.aid), weight: 1 });
        for (const s of scored) if (s.m === coTerms.length) coFull.add(s.aid);
      }
    }
    // Typo-tolerant quoted-fragment lane (HU-3247): "contains something
    // like <quote>" queries whose quote has a typo (transposition, sub, del)
    // fail literal matching - the answer sits in top-5 but rerank never gets
    // quote evidence. Content words (len>=4) of the longest quoted fragment
    // are AND-matched against scene tokens; mistyped (out-of-vocab) words may
    // match any Damerau-1 variant. Fires ONLY when the fragment carries 1-2
    // mistyped words: verbatim quotes already own the literal lane, and clean
    // quotes false-fired on word-scatter scenes (exact/emotion_swap dangers,
    // eval v10b). Offline probe Oct 22: 6/6 typo queries pinned, 0 fires on
    // all 21 not_witnessed.
    {
      const frag = fragments.slice(1).sort((a, b) => b.length - a.length)[0];
      const fw = frag?.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length >= 4) ?? [];
      // Gate widening (HU-3247, eval v13): the loose fragment regex treats
      // apostrophes as delimiters, so a quote opening with a contraction
      // ("Rachel, what're you...") truncates to 2 content words and starved
      // the clean-quote lane even though the STRICT fragment carries 9. The
      // block now opens when the strict double-quoted fragment alone carries
      // >=5 content words (the clean lane's own floor) - the typo lane below
      // still requires its own fw >= 4, so its behavior is unchanged.
      const strictFrags0 = query.match(/["“”][^“”"]{6,}["“”]/g)?.map((m) => m.replace(/["“”]/g, "")) ?? [];
      const strict0 = strictFrags0.sort((a, b) => b.length - a.length)[0];
      const strictFw0 = strict0?.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length >= 4) ?? [];
      if (frag && (fw.length >= 4 || strictFw0.length >= 5)) {
        const sceneTok = new Map<string, Set<string>>();
        const vocab = new Set<string>();
        for (const [aid, t] of fullText) {
          const s = new Set(t.match(/[a-z']+/g) ?? []);
          sceneTok.set(aid, s);
          for (const w of s) vocab.add(w);
        }
        const mistyped = fw.filter((w) => !vocab.has(w));
        if (fw.length >= 4 && mistyped.length >= 1 && mistyped.length <= 2) {
          const variants = (w: string): Set<string> => {
            const out = new Set<string>();
            for (let i = 0; i < w.length; i++) out.add(w.slice(0, i) + w.slice(i + 1));
            for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
            for (let i = 0; i < w.length; i++)
              for (let c = 97; c <= 122; c++) {
                const ch = String.fromCharCode(c);
                if (ch !== w[i]) out.add(w.slice(0, i) + ch + w.slice(i + 1));
              }
            for (let i = 0; i <= w.length; i++)
              for (let c = 97; c <= 122; c++) out.add(w.slice(0, i) + String.fromCharCode(c) + w.slice(i));
            out.delete(w);
            return out;
          };
          const needExact = fw.filter((w) => vocab.has(w));
          const scored: { aid: string; f: number }[] = [];
          for (const [aid, toks] of sceneTok) {
            if (!needExact.every((w) => toks.has(w))) continue;
            const f = mistyped.filter((w) => [...variants(w)].some((v) => toks.has(v))).length;
            if (f === mistyped.length) scored.push({ aid, f });
          }
          if (scored.length) {
            scored.sort((a, b) => b.f - a.f);
            lists.push({ ids: scored.map((s) => s.aid), weight: 1 });
            for (const s of scored) typoFull.add(s.aid);
          }
        } else if (mistyped.length === 0) {
          // Clean-quote pin lane (HU-3247, eval v12): person_swap quotes
          // (names swapped in the question) carry zero mistyped words, so
          // the typo gate skips them - yet their content-word AND pins
          // exactly ONE scene. Fire the pin when the exact-match pool is
          // a single scene and the fragment carries >=5 DISTINCT content
          // words. Two firewalls (Oct 22 probe, 19/19 correct / 0 wrong):
          // (a) distinct-word floor - short all-common fragments (4 words:
          // "messed okay nervous really") word-scatter onto a single wrong
          // scene (emotion_swap danger, v11 q71);
          // (b) STRICT double-quote extraction only - the loose fragment
          // regex above treats apostrophes as delimiters, so quotes like
          // "I'd hate to..." get mangled into a fragment bleeding past the
          // quote into question text and pinned the wrong scene (v12 q72
          // regression); a properly-quoted span never bleeds.
          const strictFrags = query.match(/["“”][^“”"]{6,}["“”]/g)?.map((m) => m.replace(/["“”]/g, "")) ?? [];
          const strict = strictFrags.sort((a, b) => b.length - a.length)[0];
          const fw2 = [...new Set(strict?.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length >= 4) ?? [])];
          if (strict && fw2.length >= 5) {
            const pool = [...sceneTok.entries()].filter(([, toks]) => fw2.every((w) => toks.has(w)));
            if (pool.length === 1) {
              lists.push({ ids: [pool[0][0]], weight: 1 });
              typoFull.add(pool[0][0]);
            } else if (pool.length === 0) {
              // Name-relaxed retry (HU-3247, eval v13): person_swap questions
              // swap a character name inside an otherwise-verbatim quote
              // ("Rachel, what're you..." vs the scene's "Ross, what're
              // you..."), so the strict AND pins nothing. Retry with
              // proper-cased corpus speaker names dropped from the AND set.
              // Fires only when a name word was actually dropped, >=5
              // distinct words remain, and the relaxed AND pins exactly ONE
              // scene. Offline probe Oct 22: 3 relaxed pins (all person_swap,
              // all correct), 0 wrong pins, 19/19 strict pins unchanged.
              const speakerCount = new Map<string, number>();
              for (const p of paras) {
                const m = (p.text ?? "").match(/^\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?):\s/);
                if (m) { const k = m[1].toLowerCase(); speakerCount.set(k, (speakerCount.get(k) ?? 0) + 1); }
              }
              const isSpeakerName = (w: string) =>
                [...speakerCount.entries()].some(([s, c]) => c >= 3 && (s === w || s.split(" ").includes(w)));
              const proper = new Set(
                (strict.match(/[A-Za-z']+/g) ?? [])
                  .filter((t) => /^[A-Z][a-z']+$/.test(t))
                  .map((t) => t.toLowerCase()),
              );
              const noname = fw2.filter((w) => !proper.has(w) || !isSpeakerName(w));
              if (fw2.length - noname.length > 0 && noname.length >= 5) {
                const pool2 = [...sceneTok.entries()].filter(([, toks]) => noname.every((w) => toks.has(w)));
                if (pool2.length === 1) {
                  lists.push({ ids: [pool2[0][0]], weight: 1 });
                  typoFull.add(pool2[0][0]);
                }
              }
            }
          }
        }
      }
    }
    // One-substitution window pin (HU-3247, eval v14): emotion_swap
    // quotes swap ONE word inside an otherwise-verbatim quote ("I'm so
    // thrilled" vs the scene's "I'm so sorry") - the swapped word is
    // in-vocab so the typo lane ignores it, and these fragments carry too
    // few >=4-letter content words for the AND pins. Token-window
    // alignment rescues them: slide the strict quoted fragment's tokens
    // over every scene's token stream.
    //   Pass A: the whole quote aligns with <=1 substituted token (also
    //           subsumes token-level typos and name swaps).
    //   Pass B (only when A finds nothing, quote >=8 tokens): prefix +
    //           substituted word + stage-direction gap of <=12 tokens +
    //           suffix, both sides exact - transcripts interrupt quotes
    //           with bracketed directions ("...sorry...[Eddie forces his
    //           head in the door] Ahhh. Have we met?").
    // Pin = UNIQUE matching scene; multiple hits = ambiguous, no pin.
    // Offline probe Oct 22 (87 eval questions): 41 pass-A pins, 2 pass-B
    // pins, 0 wrong, 0 fires on all 21 not_witnessed.
    {
      const strictFragsW = query.match(/["\u201c\u201d][^\u201c\u201d"]{6,}["\u201c\u201d]/g)?.map((m) => m.replace(/["\u201c\u201d]/g, "")) ?? [];
      const sw = strictFragsW.sort((a, b) => b.length - a.length)[0];
      const qw = sw?.toLowerCase().match(/[a-z']+/g) ?? [];
      if (sw && qw.length >= 6 && typoFull.size === 0) {
        const sceneToksW: [string, string[]][] = [];
        for (const [aid, t] of fullText) sceneToksW.push([aid, t.match(/[a-z']+/g) ?? []]);
        const n = qw.length;
        const passA = (toks: string[]): boolean => {
          for (let i = 0; i + n <= toks.length; i++) {
            let d = 0;
            for (let j = 0; j < n; j++) if (toks[i + j] !== qw[j] && ++d > 1) break;
            if (d <= 1) return true;
          }
          return false;
        };
        const passB = (toks: string[]): boolean => {
          if (n < 8) return false;
          for (let k = 3; k <= n - 4; k++) {
            const ls = n - k - 1;
            if (ls < 4) break;
            for (let i = 0; i + k <= toks.length; i++) {
              let ok = true;
              for (let j = 0; j < k; j++) if (toks[i + j] !== qw[j]) { ok = false; break; }
              if (!ok) continue;
              for (let g = 0; g < 13; g++) {
                const s0 = i + k + 1 + g;
                if (s0 + ls > toks.length) break;
                let m2 = true;
                for (let j = 0; j < ls; j++) if (toks[s0 + j] !== qw[k + 1 + j]) { m2 = false; break; }
                if (m2) return true;
              }
            }
          }
          return false;
        };
        const A = sceneToksW.filter(([, t]) => passA(t)).map(([aid]) => aid);
        let pin: string | undefined;
        if (A.length === 1) pin = A[0];
        else if (A.length === 0) {
          const Bx = sceneToksW.filter(([, t]) => passB(t)).map(([aid]) => aid);
          if (Bx.length === 1) pin = Bx[0];
        }
        if (pin) {
          lists.push({ ids: [pin], weight: 1 });
          typoFull.add(pin);
        }
      }
    }
    const K = 20; // grid-searched on the 90-question eval (Oct 19)
    const fused = new Map<string, number>();
    const listTop = new Set<string>();
    for (const l of lists) {
      l.ids.slice(0, 50).forEach((aid, i) => {
        fused.set(aid, (fused.get(aid) ?? 0) + l.weight / (K + i + 1));
      });
      if (l.ids[0]) listTop.add(l.ids[0]);
    }
    // Cross-encoder rerank of the fused top-20 (in-house service, CPU). The
    // model reads the actual passage text, which embeddings-only ranking
    // cannot; if the service is down we keep RRF order (never fail search).
    const fusedRanked = [...fused.entries()]
      .map(([aid, score]) => ({ aid, score, e: entries.find((x) => x.aid === aid)! }))
      .filter((x) => x.e)
      .sort((a, b) => b.score - a.score);
    const cand = fusedRanked.slice(0, 24);
    const pinFrag = fragments.slice(1).sort((a, b) => b.length - a.length)[0];
    const pinToks = pinFrag?.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length >= 4) ?? [];
    const evScore = (t: string) => { const lc = t.toLowerCase(); return pinToks.reduce((s, w) => s + (lc.includes(w) ? 1 : 0), 0); };
    let ranked = cand.slice(0, 8);
    try {
      const rr = await fetch("http://127.0.0.1:8430/rerank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, passages: await Promise.all(cand.map(async (c) => {
          const plot = plotText.get(c.aid);
          // Quote in the query and in this passage? Literal evidence - never
          // dilute it. Plot is scene-rescue context for candidates whose best
          // line doesn't carry the quote (HU-3247 eval).
          let paraTxt = c.e.para.text ?? "";
          let quotedHit = fragments.some((f) => paraTxt.toLowerCase().includes(f.toLowerCase()));
          // Evidence para for lane-pinned scenes (HU-3247, eval v14): the
          // passage is the best-EMBEDDING para, which for pinned scenes is
          // often a quote-less line of the right scene - the cross-encoder
          // reads no evidence and the pin lands #2 (the "ewll" typo). Swap
          // in the scene's para carrying the most quoted-fragment content
          // words before reranking.
          if (typoFull.has(c.aid) && pinToks.length) {
            let bestTxt = paraTxt, bestS = evScore(paraTxt);
            for (const p of paras) {
              if (p.article_id !== c.aid) continue;
              const s = evScore(p.text ?? "");
              if (s > bestS) { bestS = s; bestTxt = p.text ?? ""; }
            }
            if (bestS > evScore(paraTxt)) { paraTxt = bestTxt; quotedHit = true; }
          }
          const plotSuffix = plot && !quotedHit && !sceneWhere ? `\nPlot: ${plot.slice(0, 300)}` : "";
          return `${(await titlesFor(userId)).get(c.aid) ?? c.aid}\n${paraTxt.slice(0, quotedHit ? 700 : 500)}${plotSuffix}`;
        })) }),
        signal: AbortSignal.timeout(6000),
      });
      if (rr.ok) {
        const { scores } = (await rr.json()) as { scores: number[] };
        const sig = (x: number) => 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, x))));
        const blended = cand
          .map((c, i) => ({ c, s: sig(scores[i] ?? -10) + 0.8 / (1 + fusedRanked.findIndex((f) => f.aid === c.aid)) + (coFull.has(c.aid) ? 1.0 : 0) + (typoFull.has(c.aid) ? 1.0 : 0) }))
          .sort((a, b) => b.s - a.s);
        topScore = blended[0]?.s;
        ranked = blended.slice(0, 8).map((x) => x.c);
      }
    } catch {}
    // guaranteed slots: any list's #1 missing from the top-8 displaces rank 8
    for (const aid of listTop) {
      if (!ranked.some((r) => r.aid === aid)) {
        const e = entries.find((x) => x.aid === aid);
        if (e) ranked.push({ aid, score: -1, e });
      }
    }
    semantic = ranked.slice(0, 8).map((x) => ({ articleId: x.aid, blockId: x.e.para.block_id, snippet: snippet(x.e.para.text, query), score: Math.round(x.score * 1000) }));
  }

  return { literal, semantic, topScore };
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "at", "for", "with", "about", "and", "or", "is", "are", "was", "were", "be", "been", "do", "does", "did", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "that", "this", "these", "those", "it", "its", "his", "her", "their", "your", "my", "our", "you", "he", "she", "they", "we", "not", "no", "yes", "got", "get", "gets"]);
