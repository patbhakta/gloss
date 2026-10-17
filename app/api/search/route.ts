import { auth } from "@/lib/clerk-shim";
import { searchTexts } from "@/lib/textsearch";

export const runtime = "nodejs";

/** Search the reader's own texts: literal and semantic. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to search." }, { status: 401 });
  const { q } = (await req.json()) as { q?: string };
  return Response.json(await searchTexts(userId, q ?? ""));
}
