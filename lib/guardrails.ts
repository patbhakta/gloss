/**
 * Guardrails for vault-chat: PII redaction on passages before the model sees
 * them, and citation/numeric verification on the answer after. Adapted from
 * the enterprise-rag pattern (guardrails.py) to our streaming shape: the
 * server checks the finished answer and streams a `guard` event the client
 * shows as a caveat — the answer is never silently edited.
 */

/** High-signal PII patterns. Redaction happens on the model's copy only. */
const PII: { re: RegExp; label: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, label: "[email]" },
  { re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, label: "[phone]" },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, label: "[ssn]" },
  { re: /\b(?:\d[ -]?){13,16}\b/g, label: "[card]" },
];

export function redactPII(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const { re, label } of PII) {
    out = out.replace(re, (m) => {
      found.push(label);
      return label;
    });
  }
  return { text: out, found };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Check an answer against the passages that were actually given to the model.
 * Returns issues a human can read; empty list = the answer is grounded.
 */
export function checkAnswer(answer: string, passages: string[]): string[] {
  const issues: string[] = [];
  const hay = norm(passages.join("  "));

  // Quoted fragments must exist in the cited passages (fuzzy word containment).
  for (const q of answer.match(/[“"]([^“”"]{12,160})[”"]/g) ?? []) {
    const inner = norm(q.slice(1, -1));
    if (inner.split(" ").length < 3) continue;
    const words = inner.split(" ");
    const covered = words.filter((w) => hay.includes(w)).length / words.length;
    if (covered < 0.8) issues.push(`quoted text not found in your library: “${q.slice(1, 60)}…”`);
  }

  // Numbers the answer asserts must appear in the passages (allowing format drift).
  const srcNums = new Set((passages.join(" ").match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "")));
  const ansNums = (answer.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, ""));
  const orphans = [...new Set(ansNums.filter((n) => n.length > 2 && !srcNums.has(n)))];
  if (orphans.length) issues.push(`numbers not in the cited passages: ${orphans.slice(0, 5).join(", ")}`);

  return issues;
}
