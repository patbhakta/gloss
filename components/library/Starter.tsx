"use client";

import { useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { normalizeUrl } from "@/lib/links";
import { importFromUrl, keep } from "@/lib/import";
import { useStore } from "@/lib/store";
import type { AddTab } from "./AddPanel";
import { MarkStack } from "./AgentMarks";

/**
 * Under a shelf that is still nearly empty: three ways to fill it. A dozen
 * classics in one click, links of your own, or an agent that shelves for you.
 */
export function Starter({ count, signedIn, onAdd }: { count: number; signedIn: boolean; onAdd: (tab: AddTab) => void }) {


  return (
    <section className="starter" aria-label="Fill your limbic">
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
