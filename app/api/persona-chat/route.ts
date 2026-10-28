import { authApi } from "@/lib/clerk-shim";
import { getPersonaConversation, personaChat } from "@/lib/persona-chat";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await authApi();
  if (!userId) return Response.json({ error: "Choose a persona." }, { status: 401 });
  return Response.json({ turns: await getPersonaConversation(userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { userId } = await authApi();
  if (!userId) return Response.json({ error: "Choose a persona." }, { status: 401 });
  let body: { q?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Body must be JSON." }, { status: 400 }); }
  const q = (body.q ?? "").trim().slice(0, 500);
  if (!q) return Response.json({ error: "A message is required." }, { status: 400 });
  return personaChat(userId, q);
}
