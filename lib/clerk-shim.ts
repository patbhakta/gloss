/**
 * bhakta.us: Clerk shim — single-user tailnet deployment.
 * Upstream uses Clerk accounts; we run tailnet-only with one reader.
 * auth() returns the active limbic (persona): the `limbic` cookie selects it,
 * defaulting to Pat. Each limbic keeps its own shelf, marks and notes, so a
 * persona's limbic never mixes with anyone else's. No Clerk keys at runtime.
 */

import { cookies, headers } from "next/headers";

export const LOCAL_USER_ID = "pat";

/** Personas with their own limbic (shelf, highlights, notes, agent tokens). */
export const LIMBICS = [
  { id: LOCAL_USER_ID, label: "Pat" },
  { id: "chandler", label: "Chandler" },
] as const;

export async function auth(): Promise<{ userId: string | null }> {
  const jar = await cookies();
  const limbic = jar.get("limbic")?.value ?? "";
  const userId = LIMBICS.some((l) => l.id === limbic) ? limbic : LOCAL_USER_ID;
  return { userId };
}

/**
 * API tenant resolution, strict: the `limbic` cookie or an X-Tenant-ID header,
 * validated against the persona whitelist. NO silent fallback — an unknown,
 * missing or disagreeing tenant reads as anonymous (401 at the caller), so a
 * stale cookie can never quietly read Pat's shelf. A cookie/header mismatch is
 * flagged so the caller can answer 403.
 */
export async function authApi(): Promise<{ userId: string | null; conflict?: boolean }> {
  const jar = await cookies();
  const hdrs = await headers();
  const fromCookie = jar.get("limbic")?.value ?? "";
  const fromHeader = hdrs.get("x-tenant-id")?.toLowerCase() ?? "";
  if (fromCookie && fromHeader && fromCookie !== fromHeader) return { userId: null, conflict: true };
  const t = fromHeader || fromCookie;
  return { userId: LIMBICS.some((l) => l.id === t) ? t : null };
}

export async function currentUser(): Promise<unknown> {
  return {
    id: LOCAL_USER_ID,
    firstName: "Pat",
    fullName: "Pat Bhakta",
    imageUrl: "",
  };
}
