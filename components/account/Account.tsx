"use client";

import { barBtn } from "@/components/ui/Popover";

/** bhakta.us single-user chip (matches lib/clerk-shim LOCAL_USER). */
const LOCAL_USER_NAME = "Pat Bhakta";

/**
 * bhakta.us: single-user interim account chip. Real per-persona accounts land
 * with GLS-2 (Better Auth); until then show a working avatar instead of a dead
 * "Sign in" button.
 */
export function Account() {
  return (
    <span
      className="grid size-9 place-items-center"
      data-tip={LOCAL_USER_NAME}
      title={LOCAL_USER_NAME}
    >
      <span className="grid size-7 place-items-center rounded-full bg-sunk text-[12px] font-semibold text-ink-2 select-none">
        PB
      </span>
    </span>
  );
}
