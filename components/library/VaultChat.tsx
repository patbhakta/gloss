"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, X } from "lucide-react";

type Source = { id: string; title: string; snippet: string; blockId?: string };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[] };

/**
 * Chat with the whole library: the answer comes only from the reader's own
 * texts, each claim citing the text it was drawn from. This is the onboarding
 * layer - the same conversation, later, over WhatsApp/SMS/iMessage.
 */
export function VaultChat({ seed, onClose }: { seed: string; onClose: () => void }) {
  const [q, setQ] = useState(seed);
  const asked = useRef(seed);
  const [busy, setBusy] = useState(false);
  const [guard, setGuard] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  // A seeded question from the search box asks itself once.
  useEffect(() => {
    if (asked.current) ask(asked.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setTurns((t) => [...t, { role: "user", content: text }]);
    setBusy(true);
    setGuard([]);
    const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.content }));
    // Seed an empty assistant turn that fills in as the stream arrives.
    setTurns((t) => [...t, { role: "assistant", content: "", sources: [] }]);
    const append = (fn: (prev: string) => string, sources?: Source[]) =>
      setTurns((t) => t.map((x, i) => (i === t.length - 1 && x.role === "assistant" ? { ...x, content: fn(x.content), sources: sources ?? x.sources } : x)));
    try {
      const r = await fetch("/api/vault-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, history }),
      });
      const ctype = r.headers.get("content-type") ?? "";
      if (!ctype.includes("x-ndjson")) {
        // Early-exit path: plain JSON with a complete answer.
        const d = await r.json();
        append(() => d.answer || d.error || "No answer.", d.sources);
        return;
      }
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let got = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { sources?: Source[]; delta?: string; done?: boolean; empty?: boolean; error?: string };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.sources) append((c) => c, ev.sources as Source[]);
          else if (typeof ev.delta === "string" && ev.delta) { got += ev.delta; append(() => got); }
          else if (typeof ev.error === "string" && ev.error) { const msg = ev.error; append(() => msg); }
          else if (ev.empty && !got) append(() => "The model returned an empty answer. Try again.");
        }
      }
      if (!got) append(() => "The library did not answer. Try again in a moment.");
    } catch {
      append(() => "The library did not answer. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80]" role="presentation">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]" style={{ animation: "fade 0.2s both" }} onClick={onClose} />
      <section role="dialog" aria-modal aria-label="Ask the library" className="add-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-[13px] font-medium text-ink-1">The library answers from your texts only</span>
        <button type="button" aria-label="Close chat" onClick={onClose} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-sunk">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <p className="pt-6 text-center text-[13px] text-ink-3">Ask about anything on the shelf. Answers cite the text they came from.</p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
            <div className={t.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-sm bg-ink-1 px-3 py-2 text-[13px] leading-relaxed text-paper" : "max-w-full text-[13px] leading-relaxed text-ink-1"}>
              {t.content}
              {t.role === "assistant" && t.sources && t.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.sources.map((s) => (
                    <a
                      key={s.id}
                      href={`/read/${s.id}#block-${s.blockId}`}
                      className="flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink-2 transition hover:bg-sunk"
                      title={s.snippet}
                    >
                      <BookOpen size={10} aria-hidden /> {s.title.slice(0, 34)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && !(turns.length > 0 && turns[turns.length - 1].role === "assistant" && turns[turns.length - 1].content) && (
          <p className="text-[12px] text-ink-3">Reading the shelf…</p>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex items-center gap-2 border-t border-edge px-2.5 py-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask your library…"
          aria-label="Ask your library"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-1 outline-none placeholder:text-ink-4"
          autoFocus
        />
        <button type="submit" disabled={!q.trim() || busy} aria-label="Send" className="grid size-7 shrink-0 place-items-center rounded-full bg-ink-1 text-paper disabled:opacity-30">
          <ArrowUp size={14} />
        </button>
      </form>
      </section>
    </div>
  );
}
