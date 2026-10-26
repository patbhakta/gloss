"use client";

import { useSyncExternalStore } from "react";
import { LIMBICS } from "./limbics";

/**
 * bhakta.us: client-side Clerk shim. Renders children as if signed in;
 * buttons become no-ops. Keeps upstream components compiling untouched.
 */

export const LOCAL_USER = {
  id: "pat",
  firstName: "Pat",
  fullName: "Pat Bhakta",
  imageUrl: "",
};

/** The persona labels that match lib/clerk-shim LIMBICS server-side. */
const LIMBIC_LABELS: Record<string, string> = Object.fromEntries(LIMBICS.map(l => [l.id, l.label]));

/** The active limbic id, from the same `limbic` cookie the server shim reads. */
export function limbicId(): string {
  return (typeof document !== "undefined" && document.cookie.split("; ").find((c) => c.startsWith("limbic="))?.slice(7)) || "pat";
}

/** The active limbic, from the same `limbic` cookie the server shim reads. */
const subscribe = () => () => {};
const serverSnapshot = () => "";

/** SSR and first hydration agree. Do not start sync until the browser resolves its tenant. */
function useLimbicUser() {
  const id = useSyncExternalStore(subscribe, limbicId, serverSnapshot);
  if (!id) return null;
  const label = LIMBIC_LABELS[id] ?? "Pat";
  return { id, firstName: label, fullName: label, imageUrl: "" };
}

export function useUser() {
  const user = useLimbicUser();
  return { user, isSignedIn: Boolean(user), isLoaded: Boolean(user) };
}

export function useAuth() {
  const user = useLimbicUser();
  return { userId: user?.id ?? null, isSignedIn: Boolean(user), isLoaded: Boolean(user) };
}

export function useClerk() {
  return {
    openSignIn: () => {},
    openSignUp: () => {},
    signOut: () => {},
  };
}

export function SignedIn({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function SignedOut({ children }: { children?: React.ReactNode }) {
  return null;
}

export function SignInButton({ children }: { children?: React.ReactNode; mode?: string }) {
  return <>{children}</>;
}

export function SignUpButton({ children }: { children?: React.ReactNode; mode?: string }) {
  return <>{children}</>;
}

export function UserButton(_: { appearance?: unknown }) {
  return null;
}

export function Show({ children, when }: { children?: React.ReactNode; when: boolean | string }) {
  return when ? <>{children}</> : null;
}
