// Database access — single pg Pool over DATABASE_URL, parameterized queries only.
// No credentials are hardcoded; DATABASE_URL must come from the environment.
//
// TEST ONLY: set PG_MEM=1 to run against an in-memory Postgres emulator
// (pg-mem) instead of a real database. This is used by `npm test` when no
// local Postgres is available. It is never enabled on Vercel, and the
// production path always uses a real DATABASE_URL.
import { Pool, type QueryResultRow } from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

async function createRealPool(): Promise<Pool> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({
    connectionString,
    max: 10,
    // Vercel serverless: short idle timeout so connections are recycled.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl:
      process.env.DATABASE_SSL === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  });
  pool.on("error", (err) => {
    console.error("Unexpected pg pool error", err);
  });
  return pool;
}

async function createMemPool(): Promise<Pool> {
  // webpackIgnore keeps pg-mem out of the production server bundle; this
  // branch only ever runs when PG_MEM=1 is explicitly set (local tests).
  const { newDb, DataType } = await import(
    /* webpackIgnore: true */ "pg-mem"
  );
  const mem = newDb();
  // pg-mem implements very few native functions. Register the ones our SQL
  // uses so local tests exercise the same queries as production Postgres.
  mem.public.registerFunction({
    name: "octet_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (x: string | null) => Buffer.byteLength(x ?? ""),
  });
  mem.public.registerFunction({
    name: "length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (x: string | null) => (x ?? "").length,
  });
  const { Pool: MemPool } = mem.adapters.createPg();
  const pool = new MemPool() as unknown as Pool;
  const schemaPath = join(process.cwd(), "db", "schema.sql");
  if (existsSync(schemaPath)) {
    await pool.query(readFileSync(schemaPath, "utf8"));
  }
  return pool;
}

function getPoolAsync(): Promise<Pool> {
  // NOTE: the pool is cached on globalThis, not module scope. In Next.js dev
  // mode each route can get its own copy of this module, and a module-scoped
  // pool would give every route a different (empty) in-memory database under
  // PG_MEM. globalThis is shared across the whole Node process, so all routes
  // see the same pool — the same pattern Next.js recommends for Prisma clients.
  const g = globalThis as unknown as {
    __emailPlatformPoolPromise?: Promise<Pool>;
  };
  if (!g.__emailPlatformPoolPromise) {
    g.__emailPlatformPoolPromise =
      process.env.PG_MEM === "1" ? createMemPool() : createRealPool();
  }
  return g.__emailPlatformPoolPromise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = await getPoolAsync();
  const client = await pool.connect();
  try {
    const res = await client.query<T>(text, params as never[]);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

/** Run a callback inside a transaction. */
export async function withTransaction<T>(
  fn: (client: {
    query: <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[]
    ) => Promise<{ rows: R[]; rowCount: number }>;
  }) => Promise<T>
): Promise<T> {
  const pool = await getPoolAsync();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wrapped = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        params: unknown[] = []
      ) => {
        const res = await client.query<R>(text, params as never[]);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      },
    };
    const result = await fn(wrapped);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---- platform settings ----------------------------------------------------

const settingsCache = new Map<string, string>();
let settingsLoadedAt = 0;
const SETTINGS_TTL_MS = 30_000;

export async function getSetting(key: string): Promise<string | null> {
  const now = Date.now();
  if (now - settingsLoadedAt > SETTINGS_TTL_MS) {
    settingsCache.clear();
    settingsLoadedAt = now;
  }
  const cached = settingsCache.get(key);
  if (cached !== undefined) return cached;
  const { rows } = await query<{ setting_value: string }>(
    "SELECT setting_value FROM platform_settings WHERE setting_key = $1",
    [key]
  );
  const value = rows[0]?.setting_value ?? null;
  if (value !== null) settingsCache.set(key, value);
  return value;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const { rows } = await query<{
    setting_key: string;
    setting_value: string;
  }>("SELECT setting_key, setting_value FROM platform_settings ORDER BY setting_key");
  const out: Record<string, string> = {};
  for (const r of rows) out[r.setting_key] = r.setting_value;
  return out;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO platform_settings (setting_key, setting_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
    [key, value]
  );
  settingsCache.set(key, value);
}

/** True only when a mail receiver is actually connected (Route A or B). */
export async function isReceivingConfigured(): Promise<boolean> {
  const mode = (process.env.RECEIVER_MODE ?? "none").toLowerCase();
  if (mode === "none") return false;
  const status = await getSetting("receiver_status");
  return status === "CONNECTED";
}

export async function receiverStatusLabel(): Promise<
  "NOT_CONFIGURED" | "CONNECTED" | "ERROR"
> {
  const mode = (process.env.RECEIVER_MODE ?? "none").toLowerCase();
  if (mode === "none") return "NOT_CONFIGURED";
  const status = await getSetting("receiver_status");
  if (status === "CONNECTED") return "CONNECTED";
  if (status === "ERROR") return "ERROR";
  return "NOT_CONFIGURED";
}
