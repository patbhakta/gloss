"use client";

import Link from "next/link";
import { Library } from "lucide-react";
import { barBtn, Popover } from "@/components/ui/Popover";

/** bhakta.us single-user chip (matches lib/clerk-shim LOCAL_USER). */
const LOCAL_USER_NAME = "Pat Bhakta";

/**
 * bhakta.us: single-user interim account chip. Real per-persona accounts land
 * with GLS-2 (Better Auth); until then the avatar opens a working account
 * popover instead of doing nothing when clicked.
 */
export function Account() {
  return (
    <Popover label="Account" tip={LOCAL_USER_NAME} width={264} triggerClass={barBtn} trigger={
      <span className="grid size-7 place-items-center rounded-full bg-sunk text-[12px] font-semibold text-ink-2 select-none">
        PB
      </span>
    }>
      {() => (
      <div className="px-1 py-0.5 text-[13px] leading-relaxed">
        <div className="font-medium text-ink">{LOCAL_USER_NAME}</div>
        <div className="text-[12px] text-ink-3">Single-user edition · this browser keeps your shelf, highlights and notes</div>
        <div className="mt-2 border-t border-rule pt-2">
          <Link
            href="/library"
            className="inline-flex h-8 items-center gap-2 rounded-full px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-sunk hover:text-ink"
          >
            <Library size={15} />
            Limbic
          </Link>
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-3">Accounts and sync arrive with GLS-2 (Better Auth).</div>
      </div>
      )}
    </Popover>
  );
}
