"use client";

import { useEffect, useState } from "react";

type Source = { number: number; title: string; id: string; blockId: string };
type Turn = { text: string; who: "you" | "persona"; sources?: Source[] };
const personas = ["chandler", "monica", "joey", "rachel", "phoebe", "ross"];
export default function PersonaPage() {
  const [persona, setPersona] = useState("chandler");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("persona") ?? "chandler";
    if (personas.includes(selected)) {
      document.cookie = `limbic=${selected}; Path=/; SameSite=Lax`;
      setPersona(selected);
    }
  }, []);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !message.trim()) return;
    const q = message.trim(); setMessage(""); setBusy(true);
    setTurns(t => [...t, { who: "you", text: q }]);
    try {
      const r = await fetch("/api/vault-chat", { method: "POST", headers: {
        "Content-Type": "application/json", "X-Tenant-ID": persona,
      }, body: JSON.stringify({ q, personaChat: true }) });
      const data = await r.json();
      setTurns(t => [...t, { who: "persona", text: data.answer || data.error || "Please try again.", sources: data.sources }]);
    } catch { setTurns(t => [...t, { who: "persona", text: "I couldn't connect. Please try again." }]); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
    <h1 style={{ fontSize: 28 }}>Talk with {persona[0].toUpperCase() + persona.slice(1)}</h1>
    <label>Persona <select aria-label="Persona" value={persona} disabled={busy} onChange={e => {
      const next = e.target.value;
      // Keep the existing tailnet tenant cookie consistent with the explicit request header.
      document.cookie = `limbic=${next}; Path=/; SameSite=Lax`;
      setPersona(next); setTurns([]);
      window.history.replaceState(null, "", `?persona=${next}`);
    }}>{personas.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></label>
    <p style={{ margin: "16px 0", opacity: .7 }}>A fictional character conversation grounded in their library.</p>
    <div aria-live="polite">{turns.map((t, i) => <article key={i} style={{ margin: "24px 0" }}>
      <strong>{t.who === "you" ? "You" : persona[0].toUpperCase() + persona.slice(1)}</strong>
      <p style={{ whiteSpace: "pre-wrap" }}>{t.text.split(/(\[\d+\])/).map((part, j) => /^\[\d+\]$/.test(part) ? <sup key={j}>{part}</sup> : part)}</p>
      {!!t.sources?.length && <ol aria-label="References" style={{ fontSize: 14 }}>{t.sources.map(s =>
        <li key={s.number} value={s.number}><a href={`/read/${encodeURIComponent(s.id)}#block-${encodeURIComponent(s.blockId)}`}>{s.title}</a></li>)}</ol>}
    </article>)}</div>
    {busy && <p role="status">Thinking…</p>}
    <form onSubmit={send} style={{ display: "flex", gap: 12 }}>
      <input aria-label="Message" value={message} onChange={e => setMessage(e.target.value)} disabled={busy} style={{ flex: 1, border: "1px solid #aaa", padding: 12 }} />
      <button disabled={busy || !message.trim()}>Send</button>
    </form>
  </main>;
}
