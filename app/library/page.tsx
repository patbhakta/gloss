import type { Metadata } from "next";
import { Library } from "@/components/library/Library";
import "./library.css";

export const metadata: Metadata = { title: "Limbic", alternates: { canonical: "/library" } };

export default function LibraryPage() {
  return <Library />;
}
