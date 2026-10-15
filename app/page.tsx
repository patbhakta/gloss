import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = { title: "Huible", alternates: { canonical: "/" } };

export default async function Home() {
  const { userId } = await auth();
  return <Landing signedIn={Boolean(userId)} />;
}
