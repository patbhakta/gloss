"use client";

import { useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { normalizeUrl } from "@/lib/links";
import { importFromUrl, keep } from "@/lib/import";
import { useStore } from "@/lib/store";
import type { AddTab } from "./AddPanel";
import { MarkStack } from "./AgentMarks";

/**
 * Under a shelf that is still nearly empty: three ways to fill it. The
 * emotional-intelligence baseline from the Hume vaults, links of your own, or
 * an agent that shelves for you.
 */
export function Starter({ count, signedIn, onAdd }: { count: number; signedIn: boolean; onAdd: (tab: AddTab) => void }) {
  const [eiBusy, setEiBusy] = useState(false);
  const [eiDone, setEiDone] = useState<number | null>(null);

  const shelveBaseline = async () => {
    setEiBusy(true);
    try {
      const res = await fetch("/api/ei-vault", { method: "POST" });
      const out = res.ok ? await res.json() : null;
      setEiDone(out?.shelved ?? 0);
      setTimeout(() => window.location.reload(), 900);
    } finally {
      setEiBusy(false);
    }
  };


  return (
    <section className="starter" aria-label="Fill your limbic">
      <div className="starter-card is-classics">
        <span className="starter-icon">
          <MarkStack size={24} />
        </span>
        <span className="starter-title">{count ? "Add the baseline" : "Start with emotional intelligence"}</span>
        <span className="starter-body">Twelve voice readings from the Hume vaults — how emotion sounds, with the machine's values as notes. A generalized baseline; every limbic reads it its own way.</span>
        <button type="button" onClick={shelveBaseline} disabled={eiBusy} className="starter-btn">
          {eiBusy ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Shelving…
            </>
          ) : eiDone !== null ? (
            <>Shelved {eiDone} readings</>
          ) : (
            <>
              Shelve them <ArrowRight size={15} />
            </>
          )}
        </button>
      </div>
      <button type="button" className="starter-card" onClick={() => onAdd("links")}>
        <span className="starter-icon">
          <Link2 size={20} />
        </span>
        <span className="starter-title">Save your own links</span>
        <span className="starter-body">Paste one or many. Gloss reads each one in and sorts it onto a topic.</span>
      </button>
      <button type="button" className="starter-card" onClick={() => onAdd("agent")}>
        <span className="starter-icon is-agent">
          <MarkStack size={24} />
        </span>
        <span className="starter-title">Let your agent shelve for you</span>
        <span className="starter-body">
          Give Grok Bot, Claude or ChatGPT your library, and ask it to save the good articles from your bookmarks.{!signedIn && " Needs an account."}
        </span>
      </button>
    </section>
  );
}
