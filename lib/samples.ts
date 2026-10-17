import type { Article } from "./article";

/**
 * No bundled texts ship with the reader (2026-10-17): the shelf is the
 * reader's own material, never ours. A limbic fills from its agent, pasted
 * links, or the emotional-intelligence baseline.
 */
export const SAMPLES: Article[] = [];

export const sampleById = (id: string) => SAMPLES.find((a) => a.id === id) ?? null;

/** Starter questions per sample, where the age of the text is the interesting part. */
export const SAMPLE_QUESTIONS: Record<string, string[]> = {};
