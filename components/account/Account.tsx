"use client";

import { useState } from "react";
import { barBtn, Popover } from "@/components/ui/Popover";

/** bhakta.us: mirrors lib/clerk-shim LIMBICS (server source of truth). */
const LIMBICS = [
  { id: "pat", label: "Pat" },
  { id: "chandler", label: "Chandler" },
] as const;

const cookieLimbic = () =>
  (typeof document !== "undefined" && document.cookie.split("; ").find((c) => c.startsWith("limbic="))?.slice(7)) || "pat";

/**
 * bhakta.us: single-user interim account chip with a limbic (persona) switcher.
 * Each limbic keeps its own shelf, highlights, notes and agent tokens.
 */
export function Account() {
  const [currentLimbic] = useState(cookieLimbic);
  const initials = LIMBICS.find((l) => l.id === currentLimbic)?.label.slice(0, 2).toUpperCase() ?? "PB";
  return (
    <Popover label="Account" tip="Account and limbic" width={264} triggerClass={barBtn} trigger={
      <span className="grid size-7 place-items-center rounded-full bg-sunk text-[12px] font-semibold text-ink-2 select-none">
        {initials}
      </span>
    }>
      {() => (
      <div className="px-1 py-0.5 text-[13px] leading-relaxed">
        <div className="font-medium text-ink">{LIMBICS.find((l) => l.id === currentLimbic)?.label}</div>
        <div className="text-[12px] text-ink-3">Each limbic keeps its own shelf, highlights and notes.</div>
        <div className="mt-2 border-t border-rule pt-2">
          <div className="mb-1 text-[11.5px] font-medium text-ink-3">Limbic</div>
          {LIMBICS.map((l) => {
            const active = l.id === currentLimbic;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  document.cookie = `limbic=${l.id}; path=/; max-age=31536000; SameSite=Lax`;
                  location.href = "/library";
                }}
                className={`inline-flex h-8 w-full items-center gap-2 rounded-full px-2.5 text-[13px] font-medium transition-colors ${active ? "bg-sunk text-ink" : "text-ink-2 hover:bg-sunk hover:text-ink"}`}
              >
                {l.label}{active ? " ·" : ""}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-3">Accounts and sync arrive with GLS-2 (Better Auth).</div>
      </div>
      )}
    </Popover>
  );
}
