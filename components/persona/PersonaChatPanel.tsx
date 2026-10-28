"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, MessageCircle, X } from "lucide-react";
import { LIMBICS } from "@/lib/limbics";

type Turn = { role: "user" | "assistant"; content: string };
const name = (id: string) => LIMBICS.find((l) => l.id === id)?.label ?? id;

export function PersonaChatPanel({ initialPersona, onClose }: { initialPersona: string; onClose: () => void }) {
  const [persona, setPersona] = useState(initialPersona || "chandler");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const load = async (id: string) => {
    document.cookie = `limbic=${id}; path=/; max-age=31536000; SameSite=Lax`;
    const r = await fetch("/api/persona-chat", { headers: { "X-Tenant-ID": id }, cache: "no-store" });
    const data = await r.json(); setTurns(Array.isArray(data.turns) ? data.turns : []);
  };
  useEffect(() => { void load(persona); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); const text = q.trim(); if (!text || busy) return;
    setQ(""); setTurns((old) => [...old, { role: "user", content: text }]); setBusy(true);
    try {
      const r = await fetch("/api/persona-chat", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-ID": persona }, body: JSON.stringify({ q: text }) });
      const data = await r.json();
      if (Array.isArray(data.turns)) setTurns(data.turns); else setTurns((old) => [...old, { role: "assistant", content: data.error || "I lost my train of thought. Try again." }]);
    } catch { setTurns((old) => [...old, { role: "assistant", content: "I couldn't connect. Try again in a moment." }]); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[80]" role="presentation">
    <div className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]" onClick={onClose} />
    <section role="dialog" aria-modal aria-label={`Talk with ${name(persona)}`} className="add-panel">
      <header className="flex items-center justify-between border-b border-rule px-4 py-3"><div><div className="flex items-center gap-2 text-[14px] font-medium text-ink"><MessageCircle size={15} /> Talk with {name(persona)}</div><p className="mt-0.5 text-[11px] text-ink-3">A conversation held in Gloss</p></div><button type="button" aria-label="Close chat" onClick={onClose} className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-sunk"><X size={15} /></button></header>
      <div className="border-b border-rule px-4 py-2"><label className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">Persona <select aria-label="Persona" value={persona} disabled={busy} onChange={(e) => { const id = e.target.value; setPersona(id); void load(id); }} className="ml-2 rounded border border-rule bg-bg px-2 py-1 text-[13px] normal-case tracking-normal text-ink">{LIMBICS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label></div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">{!turns.length && <p className="pt-8 text-center font-serif text-[20px] italic text-ink-3">Start a conversation.</p>}{turns.map((t, i) => <div key={i} className={t.role === "user" ? "flex justify-end" : ""}><div className={t.role === "user" ? "max-w-[84%] rounded-2xl rounded-br-sm bg-ink px-3 py-2 text-[14px] leading-relaxed text-bg" : "max-w-[90%] font-serif text-[17px] leading-[1.45] text-ink"}>{t.content}</div></div>)}{busy && <p role="status" className="text-[12px] text-ink-3">Thinking…</p>}<div ref={endRef} /></div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-rule px-3 py-3"><input value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} autoFocus aria-label="Message" placeholder={`Say something to ${name(persona)}…`} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4" /><button type="submit" disabled={busy || !q.trim()} aria-label="Send" className="grid size-8 place-items-center rounded-full bg-ink text-bg disabled:opacity-30"><ArrowUp size={15} /></button></form>
    </section>
  </div>;
}
