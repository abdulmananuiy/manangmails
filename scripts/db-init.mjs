// npm run db:init — create the database (if needed) and apply db/schema.sql.
// Reads DATABASE_URL from .env.local (if present) or the environment.
// Usage:  npm run db:init
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Minimal .env.local loader (no dependency).
for (const f of [".env.local", ".env"]) {
  const p = join(root, f);
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
    break;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");

// Connect to the target database; create it first if it does not exist.
const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, "");
async function ensureDatabase() {
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }
}

const client = new pg.Client({ connectionString: url });
try {
  await ensureDatabase();
  await client.connect();
  await client.query(schema);
  console.log("Schema applied successfully.");
} catch (err) {
  console.error("db:init failed:", err);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
