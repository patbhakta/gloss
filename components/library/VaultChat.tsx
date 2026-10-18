"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, MessageCircle, X } from "lucide-react";

type Source = { id: string; title: string; snippet: string };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[] };

/**
 * Chat with the whole library: the answer comes only from the reader's own
 * texts, each claim citing the text it was drawn from. This is the onboarding
 * layer - the same conversation, later, over WhatsApp/SMS/iMessage.
 */
export function VaultChat() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setTurns((t) => [...t, { role: "user", content: text }]);
    setBusy(true);
    try {
      const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.content }));
      const r = await fetch("/api/vault-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, history }),
      });
      const d = await r.json();
      setTurns((t) => [...t, { role: "assistant", content: d.answer || d.error || "No answer.", sources: d.sources }]);
    } catch {
      setTurns((t) => [...t, { role: "assistant", content: "The library did not answer. Try again in a moment." }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-edge bg-paper px-3 py-1.5 text-[13px] text-ink-2 shadow-sm transition hover:bg-sunk"
        aria-label="Chat with your library"
      >
        <MessageCircle size={14} aria-hidden /> Ask the library
      </button>
    );
  }

  return (
    <div className="pointer-events-auto flex h-[min(520px,70vh)] w-[min(400px,92vw)] flex-col overflow-hidden rounded-xl border border-edge bg-paper shadow-xl">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-[13px] font-medium text-ink-1">The library answers from your texts only</span>
        <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-sunk">
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
                      href={`/read/${s.id}`}
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
        {busy && <p className="text-[12px] text-ink-3">Reading the shelf…</p>}
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
    </div>
  );
}
