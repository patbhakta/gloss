# Pre-launch RAG security audit — 2026-10-19

Status: partial implementation; launch blocked on trusted identity and full database integration tests.

## Implemented

- Shared input classifier at sync article/highlight writes and MCP shelving. Stored `contentGuard` is recomputed server-side; original document content is preserved. This metadata is advisory, never an authorization decision.
- Read-time scan of titles, passages and notes covers existing documents and direct-write ingestion. Known injection content bypasses the model and is returned as an exact JSON-quoted excerpt with a real-block citation.
- Hardened system prompt treats evidence as data; user question and evidence are JSON encoded. No client-supplied history enters the model. Endpoint is stateless, so follow-up questions must stand alone until tenant-owned history exists.
- Opaque citation labels correspond to blocks loaded through the tenant-scoped articles query. Every label has a source chip linking to its exact block. Stale embedding block IDs are skipped.
- Model output is buffered and citation-checked before any answer delta is emitted. Missing/unknown citations and remote links fall back to source quotations. This validates reference existence, not semantic entailment of each claim. Source chips still arrive first; token-by-token display is deferred until validation finishes.
- Originals are not destructively sanitized. Suspicious content remains quotable for research. Regex classification is defense in depth, not a proof against all possible injection attacks.

## Scoping audit

| Path / store | Finding |
| --- | --- |
| `/api/search`, `/api/vault-chat` | Pass the result of server `auth()` to `searchTexts`; body tenant IDs are ignored. |
| MCP `search_texts` | Uses server-resolved `tokenUser` identity, not tool arguments. |
| `para_embeds`, `title_embeds` reads | `where user_id = $1`; embedding writes/schema are not present in this checkout and need an owner/source audit. |
| Vault-chat article expansion and highlights | Both filter `user_id = $1`, article IDs, and live rows. Missing blocks are excluded. |
| Sync pull/push, article reads, MCP shelving | Tenant supplied server-side; composite `(user_id,id)` upserts; pull/article queries are scoped. |
| Direct EI baseline ingestion | Article/highlight upserts include `user_id`; bypasses metadata classifier but read-time scan still runs. |
| Vault-chat history | Browser-supplied history is no longer accepted as model conversation state. No server history store exists. |
| Browser caches | Main library/document storage is not demonstrably tenant-namespaced; must be tested across identity switches. |
| **Identity** | **CRITICAL: `lib/clerk-shim.ts` accepts unsigned `limbic` cookie and defaults to Pat. `proxy.ts` provides no authentication. SQL scoping cannot establish tenant isolation with this identity boundary.** |

## Verification and limits

Run `node --disable-warning=ExperimentalWarning scripts/test-rag-security.mjs` and `npm run lint`.

Six route/helper regression tests pass, including 20 distinct injection documents, all quoted intact with zero calls to the mocked model; forged history; output citation rejection before emission; shared article/block IDs in two tenant fixtures; unauthenticated boundary; Unicode normalization. The two-tenant test uses mocked SQL and identity: it proves route parameter plumbing only, not real authentication or real Postgres isolation. No production model or database calls were made.

## Required before acceptance

1. Replace unsigned-cookie identity with verified sessions and server-authorized limbic membership; fail closed when credentials/configuration are missing. Preserve deliberate tailnet testing only through an explicit non-launch mode.
2. Namespace/clear browser library, document, cover and conversation state on tenant changes; reject stale in-flight responses after switches.
3. Locate embedding ingestion jobs and verify tenant columns/keys on every write. Run real two-tenant database read/write tests, including identical object IDs and stale embeddings.
4. Run deployed authenticated route tests attempting cookie/body tenant forgery; no foreign content may appear. Review signed-in UI behavior and legitimate-document answer quality.

Do not claim the cross-tenant launch acceptance has passed based on mocked route tests.
