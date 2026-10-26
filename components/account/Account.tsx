"use client";

import { useUser } from "@/lib/clerk-client-shim";
import { LIMBICS } from "@/lib/limbics";
import { barBtn, Popover } from "@/components/ui/Popover";

/**
 * bhakta.us: single-user interim account chip with a limbic (persona) switcher.
 * Each limbic keeps its own shelf, highlights, notes and agent tokens.
 */
export function Account() {
  const { user } = useUser();
  const currentLimbic = user?.id ?? "";
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
          <select aria-label="Limbic" value={currentLimbic} disabled={!currentLimbic}
            className="h-9 w-full rounded border border-rule bg-paper px-2"
            onChange={(e) => {
              document.cookie = `limbic=${e.target.value}; path=/; max-age=31536000; SameSite=Lax`;
              location.assign("/library");
            }}>
            {!currentLimbic && <option value="">Loading…</option>}
            {LIMBICS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-3">Accounts and sync arrive with GLS-2 (Better Auth).</div>
      </div>
      )}
    </Popover>
  );
}
