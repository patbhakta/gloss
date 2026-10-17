"use client";

/** A reading from the vaults: "Voice reading (prosody): sadness 0.44, joy 0.21, …" */
const PROSODY = /^Voice reading \(prosody\):\s*(.+)$/;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The clip that belongs to a block, from the live article DOM. */
export function clipSrcFor(blockId?: string): string | undefined {
  if (!blockId || typeof document === "undefined") return undefined;
  return (
    document.querySelector(`[data-block="${blockId}"] audio, [data-block="${blockId}"] video`)?.getAttribute("src") ??
    undefined
  );
}

/**
 * A machine reading as a small polaroid card: top feeling with its score,
 * the rest as quiet bars, and the clip playable right here. Works in the
 * margin and in the diary sheet.
 */
export function ReadingCard({ note, clipSrc }: { note: string; clipSrc?: string }) {
  const m = note.match(PROSODY);
  const rows = m
    ? [...m[1].matchAll(/([a-z ]+?)\s+(0\.\d+)/g)].map((x) => ({ label: x[1].trim(), value: Number(x[2]) }))
    : [];
  if (!rows.length) return <span className="whitespace-pre-line">{note}</span>;
  return (
    <span className="note-card">
      <span className="note-card-head">
        <span className="note-card-kicker">Voice reading</span>
        {rows[0] && (
          <span className="note-card-top">
            {cap(rows[0].label)} <b>{Math.round(rows[0].value * 100)}%</b>
          </span>
        )}
      </span>
      {clipSrc && (
        <span className="note-card-clip">
          <audio controls preload="none" src={clipSrc} />
        </span>
      )}
      {rows.length > 1 && (
        <span className="note-card-bars">
          {rows.slice(1).map((r) => (
            <span key={r.label} className="note-bar">
              <span className="note-bar-label">{r.label}</span>
              <span className="note-bar-track">
                <span className="note-bar-fill" style={{ width: `${Math.round(r.value * 100)}%` }} />
              </span>
              <span className="note-bar-val">{Math.round(r.value * 100)}%</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
