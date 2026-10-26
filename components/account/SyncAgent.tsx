"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { startSync } from "@/lib/sync";

/** Runs account sync while someone is signed in. Renders nothing. */
export function SyncAgent() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const pathname = usePathname();
  useEffect(() => {
    // Persona chat reads authoritative server documents; it does not need shelf sync.
    // Its cookie switch must not push a previously mounted tenant’s local shelf.
    if (pathname === "/persona" || !isLoaded || !isSignedIn || !userId) return;
    useStore.getState().hydrate();
    const s = startSync(userId);
    return () => s.stop();
  }, [isLoaded, isSignedIn, userId, pathname]);
  return null;
}
