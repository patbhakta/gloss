"use client";

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
const LIMBIC_LABELS: Record<string, string> = { pat: "Pat", chandler: "Chandler" };

/** The active limbic id, from the same `limbic` cookie the server shim reads. */
export function limbicId(): string {
  return (typeof document !== "undefined" && document.cookie.split("; ").find((c) => c.startsWith("limbic="))?.slice(7)) || "pat";
}

/** The active limbic, from the same `limbic` cookie the server shim reads. */
function limbicUser() {
  const id = limbicId();
  const label = LIMBIC_LABELS[id] ?? "Pat";
  return { id, firstName: label, fullName: label, imageUrl: "" };
}

export function useUser() {
  const u = limbicUser();
  return { user: { ...LOCAL_USER, ...u }, isSignedIn: true, isLoaded: true };
}

export function useAuth() {
  return { userId: limbicUser().id, isSignedIn: true, isLoaded: true };
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
