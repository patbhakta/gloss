/**
 * Postgres on Neon, over its HTTP driver: one round trip per query, no pool
 * to manage in serverless functions. Server-side only.
 *
 * bhakta.us: also supports a plain local Postgres (node-postgres pool) when
 * DATABASE_URL is not a Neon endpoint — single-user tailnet deploy keeps its
 * library in the host's Postgres next door.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Query = { text: string; params?: unknown[] };
type Sql = {
  query: (text: string, params?: unknown[]) => Query & Promise<Record<string, unknown>[]>;
  transaction: (queries: Query[]) => Promise<Record<string, unknown>[][]>;
};

let sql: Sql | null = null;

/** Local Postgres adapter with the same query()/transaction() surface the Neon driver gives. */
function localSql(): Sql {
  // Lazy import so bundling stays optional for pure-Neon deployments.
  const { Pool } = require("pg") as typeof import("pg");
  const pool = new Pool({ max: 5, connectionString: process.env.DATABASE_URL });
  const run = async (client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, q: Query) =>
    (await client.query(q.text, q.params)).rows;
  const make = (text: string, params?: unknown[]) => {
    const q: Query = { text, params };
    return Object.assign(q, {
      then: (onFulfilled: (rows: Record<string, unknown>[]) => unknown, onRejected: (e: unknown) => unknown) =>
        pool.connect().then(async (c) => {
          try { return onFulfilled(await run(c, q)); } catch (e) { return onRejected(e); } finally { c.release(); }
        }),
      catch: (onRejected: (e: unknown) => unknown) =>
        pool.connect().then(async (c) => {
          try { return await run(c, q); } catch (e) { return onRejected(e); } finally { c.release(); }
        }),
    }) as Query & Promise<Record<string, unknown>[]>;
  };
  return {
    query: make,
    transaction: async (queries: Query[]) => {
      const c = await pool.connect();
      const out: Record<string, unknown>[][] = [];
      try {
        await c.query("begin");
        for (const q of queries) out.push(await run(c, q));
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
      return out;
    },
  };
}

export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    if (/\.neon\.(tech|new)|neon\.tech/i.test(new URL(url).hostname)) {
      const n = neon(url) as unknown;
      sql = n as Sql;
    } else {
      sql = localSql();
    }
  }
  return sql;
}

/** The tables the sync route reads and writes. Names are only ever taken from this list. */
export const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const isCollection = (v: unknown): v is Collection => typeof v === "string" && (COLLECTIONS as readonly string[]).includes(v);

export type PushRow = { id: string; article_id: string; data: unknown; deleted: boolean; doc?: unknown };
export type PullRow = { id: string; articleId: string; data: unknown; deleted: boolean };

/** Rows changed since `since` in every collection, tombstones included, plus the server clock to pull from next time. */
export async function pullRows(userId: string, since: string): Promise<{ now: string; changes: Record<Collection, PullRow[]> }> {
  const sql = db();
  const [clock, ...results] = await sql.transaction([
    sql.query("select now() as now"),
    ...COLLECTIONS.map((t) =>
      sql.query(`select id, article_id, data, deleted from ${t} where user_id = $1 and updated_at > $2 order by updated_at`, [userId, since])
    ),
  ]);
  const changes = Object.fromEntries(
    COLLECTIONS.map((t, i) => [
      t,
      (results[i] as Record<string, unknown>[]).map((r) => ({ id: String(r.id), articleId: String(r.article_id), data: r.deleted ? null : r.data, deleted: Boolean(r.deleted) })),
    ])
  ) as Record<Collection, PullRow[]>;
  return { now: new Date((clock as { now: string }[])[0].now).toISOString(), changes };
}

/** Upsert every collection's rows in one transaction. The server stamps the time, so the latest write wins. */
/** Nothing saved before the shelf was reset on 2026-10-17 may come back. */
const SHELF_RESET_MS = Date.parse("2026-10-17T10:00:00Z");

export async function pushRows(userId: string, changes: Partial<Record<Collection, PushRow[]>>): Promise<Partial<Record<Collection, string[]>>> {
  // (changes is narrowed to admitted rows below)
  const sql = db();
  // Ghosts from before the shelf reset: refused outright, never inserted.
  const revert: Partial<Record<Collection, string[]>> = {};
  const admitted: Partial<Record<Collection, PushRow[]>> = {};
  for (const [t, rows] of Object.entries(changes)) {
    if (!isCollection(t) || !rows?.length) continue;
    const ok: PushRow[] = [];
    for (const r of rows) {
      const added = Number((r.data as { addedAt?: number } | undefined)?.addedAt ?? Number.POSITIVE_INFINITY);
      if (!r.deleted && t === "articles" && added < SHELF_RESET_MS) (revert[t as Collection] ??= []).push(r.id);
      else ok.push(r);
    }
    if (ok.length) admitted[t as Collection] = ok;
  }
  changes = admitted;

  const queries = Object.entries(changes)
    .filter(([t, rows]) => isCollection(t) && rows?.length)
    .map(([t, rows]) => sql.query(upsert(t as Collection), [userId, JSON.stringify(rows)]));
  // A text taken off the shelf takes its painted cover with it.
  const gone = (changes.articles ?? []).filter((r) => r.deleted).map((r) => r.id);
  if (gone.length) queries.push(sql.query("delete from covers where user_id = $1 and id = any($2::text[])", [userId, gone]));
  if (queries.length) await sql.transaction(queries);
  // The server is the referee: if a tombstone won against a pushed row, say so,
  // so the device drops the row instead of trusting a push the server refused.
  for (const [t, rows] of Object.entries(changes)) {
    if (!isCollection(t)) continue;
    const live = (rows ?? []).filter((r) => !r.deleted).map((r) => r.id);
    if (!live.length) continue;
    const res = await sql.query(`select id from ${t} where user_id = $1 and id = any($2::text[]) and deleted = true`, [userId, live]);
    const refused = (res as Record<string, unknown>[]).map((r) => String(r.id));
    if (refused.length) for (const id of refused) (revert[t as Collection] ??= []).push(id);
  }
  return revert;
}

/** One article's full text. */
export async function articleDoc(userId: string, id: string): Promise<unknown | null> {
  const rows = await db().query("select doc from articles where user_id = $1 and id = $2 and not deleted and doc is not null", [userId, id]);
  return rows.length ? rows[0].doc : null;
}

/** One statement per table: unpack the JSON array of rows and upsert them all. An article pushed without its text keeps the stored one.
 *  A tombstone always wins: a device may not push a row back to life after the
 *  server deleted it — that is the stale-device resurrection loop. */
function upsert(table: Collection): string {
  const isArticles = table === "articles";
  return `insert into ${table} (user_id, id, article_id, data, deleted, updated_at${isArticles ? ", doc" : ""})
    select $1, r.id, r.article_id, r.data, r.deleted, now()${isArticles ? ", r.doc" : ""}
    from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean${isArticles ? ", doc jsonb" : ""})
    on conflict (user_id, id) do update set
      article_id = excluded.article_id, data = excluded.data, deleted = excluded.deleted, updated_at = now()${
        isArticles ? ", doc = case when excluded.deleted then null else coalesce(excluded.doc, articles.doc) end" : ""
      }
    where not (${table}.deleted and not excluded.deleted)`;
}

/* ---------- painted covers ---------- */

export async function saveCover(userId: string, id: string, jpeg: Uint8Array): Promise<void> {
  await db().query(
    `insert into covers (user_id, id, jpeg) values ($1, $2, $3)
     on conflict (user_id, id) do update set jpeg = excluded.jpeg, created_at = now()`,
    [userId, id, Buffer.from(jpeg).toString("base64")]
  );
}

export async function loadCover(userId: string, id: string): Promise<Uint8Array | null> {
  const rows = await db().query("select jpeg from covers where user_id = $1 and id = $2", [userId, id]);
  return rows.length ? Uint8Array.from(Buffer.from(String(rows[0].jpeg), "base64")) : null;
}

/* ---------- agent tokens ---------- */

export type AgentToken = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

export async function createToken(userId: string, id: string, hash: string, label: string): Promise<void> {
  await db().query("insert into agent_tokens (id, user_id, hash, label) values ($1, $2, $3, $4)", [id, userId, hash, label]);
}

export async function listTokens(userId: string): Promise<AgentToken[]> {
  const rows = await db().query("select id, label, created_at, last_used_at from agent_tokens where user_id = $1 and not revoked order by created_at desc", [userId]);
  return rows.map((r) => ({ id: String(r.id), label: String(r.label), createdAt: new Date(String(r.created_at)).toISOString(), lastUsedAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null }));
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await db().query("update agent_tokens set revoked = true where user_id = $1 and id = $2 and not revoked returning id", [userId, id]);
  return rows.length > 0;
}

/** The reader a token belongs to, noting that it was used. Null for an unknown or revoked token. */
export async function tokenUser(hash: string): Promise<{ userId: string; label: string } | null> {
  const rows = await db().query("update agent_tokens set last_used_at = now() where hash = $1 and not revoked returning user_id, label", [hash]);
  return rows.length ? { userId: String(rows[0].user_id), label: String(rows[0].label ?? "") } : null;
}

/* ---------- the library, for an agent ---------- */

export type ShelfRow = { id: string; data: Record<string, unknown>; pct: number };

/** Every text on a reader's shelf, with how far they've read. */
export async function shelfOf(userId: string): Promise<ShelfRow[]> {
  const rows = await db().query(
    `select a.id, a.data, p.data as progress from articles a
     left join progress p on p.user_id = a.user_id and p.id = a.id and not p.deleted
     where a.user_id = $1 and not a.deleted order by a.updated_at desc`,
    [userId]
  );
  return rows.map((r) => ({ id: String(r.id), data: (r.data ?? {}) as Record<string, unknown>, pct: Number((r.progress as { pct?: number } | null)?.pct ?? 0) }));
}

/** Put one imported text on a reader's shelf, as their browser would: the next sync brings it down. */
export async function shelveForUser(userId: string, item: { id: string }, doc: unknown): Promise<void> {
  await db().query(
    `insert into articles (user_id, id, article_id, data, doc, deleted, updated_at) values ($1, $2, $2, $3, $4, false, now())
     on conflict (user_id, id) do update set data = excluded.data, doc = excluded.doc, deleted = false, updated_at = now()`,
    [userId, item.id, JSON.stringify(item), JSON.stringify(doc)]
  );
}
