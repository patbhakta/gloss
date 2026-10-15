/**
 * bhakta.us: Clerk shim — single-user tailnet deployment.
 * Upstream uses Clerk accounts; we run tailnet-only with one reader.
 * auth() returns a fixed local user; client hooks report signed-in with a
 * stub user. No Clerk keys needed at runtime.
 */

export const LOCAL_USER_ID = "pat";

export async function auth(): Promise<{ userId: string | null }> {
  return { userId: LOCAL_USER_ID };
}

export async function currentUser(): Promise<unknown> {
  return {
    id: LOCAL_USER_ID,
    firstName: "Pat",
    fullName: "Pat Bhakta",
    imageUrl: "",
  };
}
