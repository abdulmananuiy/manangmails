// npm test — local verification of the guide's section 16 test plan,
// everything that can be tested without a live mail receiver.
// Starts the Next.js dev server on a test port with a test DATABASE_URL,
// then exercises the HTTP APIs end to end. Exits non-zero on any failure.
//
// Required env (see .env.example):
//   DATABASE_URL, SESSION_SECRET, INBOUND_API_SECRET, SETUP_TOKEN
// The script wipes test data it creates (test users) at the end.
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

for (const f of [".env.local", ".env"]) {
  const p = join(root, f);
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
    break;
  }
}

const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const INBOUND_SECRET = process.env.INBOUND_API_SECRET || "test-inbound-secret";
const SETUP_TOKEN = process.env.SETUP_TOKEN || "test-setup-token";
// By default tests run against an in-memory Postgres emulator (pg-mem), so no
// local Postgres is needed. Set USE_REAL_DB=1 to test against DATABASE_URL.
const USE_PG_MEM = process.env.USE_REAL_DB !== "1";

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200 || r.status === 503) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}

// Minimal cookie jar.
class Jar {
  constructor() {
    this.cookies = new Map();
  }
  store(res) {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      this.cookies.set(k.trim(), v);
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function req(jar, path, method = "GET", body = undefined, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar ? { Cookie: jar.header() } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (jar) jar.store(res);
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, data };
}

async function main() {
  console.log("Starting dev server for tests…");
  const server = spawn(
    "npx",
    ["next", "dev", "-p", String(PORT)],
    {
      cwd: root,
      detached: true, // own process group so we can kill the whole tree
      env: {
        ...process.env,
        PORT: String(PORT),
        ...(USE_PG_MEM
          ? { PG_MEM: "1", DATABASE_URL: "postgres://test:test@localhost:5432/test" }
          : {}),
        INBOUND_API_SECRET: INBOUND_SECRET,
        SETUP_TOKEN: SETUP_TOKEN,
        SESSION_SECRET:
          process.env.SESSION_SECRET || "test-session-secret-min-32-chars-long!!",
      },
      stdio: "ignore",
    }
  );
  try {
    if (!(await waitForServer())) {
      console.error("Dev server did not start.");
      process.exitCode = 1;
      return;
    }
    console.log("Server up. Running tests…\n");

    const user = new Jar();
    const admin = new Jar();
    const anon = new Jar();
    const stamp = Date.now().toString(36);
    const username = `testuser_${stamp}`;
    const password = "TestPass123!";

    // 1. Health: receiving NOT CONFIGURED
    let r = await req(null, "/api/health");
    check("Health reports Receiving: NOT CONFIGURED", r.data.receiverStatus === "NOT_CONFIGURED", JSON.stringify(r.data));

    // 2. Signup with a new username
    r = await req(anon, "/api/auth/signup", "POST", { username, password });
    check("Signup with a new username succeeds (201)", r.status === 201, `status=${r.status} ${JSON.stringify(r.data)}`);

    // 3. Signup with duplicate username
    r = await req(anon, "/api/auth/signup", "POST", { username, password });
    check("Signup with duplicate username rejected (409)", r.status === 409, `status=${r.status}`);

    // 4. Login with wrong password
    r = await req(user, "/api/auth/login", "POST", { username, password: "WrongPass123!" });
    check("Login with wrong password rejected (401)", r.status === 401, `status=${r.status}`);

    // 5. Login with correct password
    r = await req(user, "/api/auth/login", "POST", { username, password });
    check("Login with correct password succeeds", r.status === 200 && !!r.data.csrf, `status=${r.status}`);
    const csrf = r.data.csrf;

    // 6. Generate address
    r = await req(user, "/api/addresses", "POST", { _csrf: csrf });
    check(
      "Generate address returns unique address on manangmails.is-a.dev",
      r.status === 201 && r.data.address?.full_address?.endsWith("@manangmails.is-a.dev"),
      `status=${r.status} ${JSON.stringify(r.data)}`
    );
    const address = r.data.address?.full_address;
    const addressId = r.data.address?.id;

    // 7. Generate several more addresses — all unique
    const seen = new Set([address]);
    let allUnique = true;
    for (let i = 0; i < 5; i++) {
      const rr = await req(user, "/api/addresses", "POST", { _csrf: csrf });
      if (rr.status !== 201 || seen.has(rr.data.address?.full_address)) allUnique = false;
      seen.add(rr.data.address?.full_address);
    }
    check("Generate 5 more addresses — all unique", allUnique, `generated ${seen.size}`);

    // 8. Inbound API: no secret -> 401
    const otpBody = {
      recipient: address,
      sender: "security@example.com",
      subject: "Your verification code",
      messageId: `<test-${stamp}-1@example.com>`,
      textBody: "Hello, your verification code is 482913. It expires in 10 minutes.",
      htmlBody: `<p>Hello, your verification code is <b>482913</b>.</p><script>alert('xss')</script><img src="https://tracker.example.com/pixel.png">`,
      receivedAt: new Date().toISOString(),
    };
    r = await req(null, "/api/inbound-email", "POST", otpBody);
    check("Inbound API without secret rejected (401)", r.status === 401, `status=${r.status}`);

    // 9. Inbound API: valid secret -> stored, OTP detected
    r = await req(null, "/api/inbound-email", "POST", otpBody, { "x-api-secret": INBOUND_SECRET });
    check(
      "Inbound API with secret stores message + detects OTP 482913",
      r.status === 200 && r.data.otpDetected === "482913",
      `status=${r.status} ${JSON.stringify(r.data)}`
    );
    const messageDbId = r.data.messageDbId;

    // 10. Replay same event -> 409 duplicate
    r = await req(null, "/api/inbound-email", "POST", otpBody, { "x-api-secret": INBOUND_SECRET });
    check("Replay of same receiver event rejected as duplicate (409)", r.status === 409, `status=${r.status}`);

    // 11. Unknown recipient -> 404
    r = await req(null, "/api/inbound-email", "POST", {
      ...otpBody,
      recipient: "nobody@manangmails.is-a.dev",
      messageId: `<test-${stamp}-2@example.com>`,
    }, { "x-api-secret": INBOUND_SECRET });
    check("Inbound API with unknown recipient rejected (404)", r.status === 404, `status=${r.status}`);

    // 12. Bare number is NOT an OTP
    r = await req(null, "/api/inbound-email", "POST", {
      recipient: address,
      sender: "newsletter@example.com",
      subject: "Weekly digest",
      messageId: `<test-${stamp}-3@example.com>`,
      textBody: "We have 123456 subscribers this week and 987654 page views.",
      receivedAt: new Date().toISOString(),
    }, { "x-api-secret": INBOUND_SECRET });
    check(
      "Bare numbers without OTP context are NOT detected as OTP",
      r.status === 200 && r.data.otpDetected === null,
      `status=${r.status} ${JSON.stringify(r.data)}`
    );

    // 13. Inbox lists the stored message; OTP page lists the code
    r = await req(user, "/api/messages");
    check(
      "Inbox lists the stored message",
      r.status === 200 && r.data.messages?.some((m) => m.id === messageDbId),
      `status=${r.status} total=${r.data.total}`
    );
    r = await req(user, "/api/otp");
    check(
      "OTP page lists detected code 482913",
      r.status === 200 && r.data.otps?.some((o) => o.code === "482913"),
      `status=${r.status}`
    );

    // 14. Message viewer: scripts stripped, remote images removed
    r = await req(user, `/api/messages/${messageDbId}`);
    const html = r.data.message?.safe_html_body ?? "";
    check(
      "Unsafe HTML sanitized (no <script>, no remote <img>)",
      r.status === 200 && !/<script/i.test(html) && !/tracker\.example\.com/.test(html) && /482913/.test(html),
      `html=${html.slice(0, 120)}`
    );

    // 15. Normal user cannot access admin APIs
    r = await req(user, "/api/admin/users");
    check("Normal user denied admin API (401)", r.status === 401, `status=${r.status}`);
    r = await req(user, "/api/admin/overview");
    check("Normal user denied admin overview (401)", r.status === 401, `status=${r.status}`);

    // 16. Admin setup + login (one-time, if no admin exists yet)
    const adminUser = `admin_${stamp}`;
    let adminCreated = false;
    r = await req(null, "/api/setup", "POST", {
      setupToken: SETUP_TOKEN,
      username: adminUser,
      password: "AdminPass123!",
    });
    const setupOk = r.status === 201 || r.status === 403; // 403 = admin already exists
    check("One-time admin setup works or is disabled (201/403)", setupOk, `status=${r.status}`);
    if (r.status === 201) {
      adminCreated = true;
      r = await req(admin, "/api/admin/login", "POST", { username: adminUser, password: "AdminPass123!" });
      check("Admin login succeeds", r.status === 200, `status=${r.status}`);
      const adminCsrf = r.data.csrf;
      r = await req(admin, "/api/admin/users");
      check("Admin can list users", r.status === 200 && Array.isArray(r.data.users), `status=${r.status}`);
      // CSRF: admin POST without token must fail
      const bad = await fetch(`${BASE}/api/admin/users`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: admin.header() },
        body: JSON.stringify({ id: 99999, status: "suspended" }),
      });
      check("Admin state-changing request without CSRF token rejected (403)", bad.status === 403, `status=${bad.status}`);
      void adminCsrf;
    } else {
      console.log("  SKIP  Admin login tests (an admin already exists; setup disabled)");
    }

    // 17. User logout then inbox denied
    await req(user, "/api/auth/logout", "POST", { _csrf: csrf });
    r = await req(user, "/api/messages");
    check("After logout, inbox is denied (401)", r.status === 401, `status=${r.status}`);

    // Cleanup: delete the test user (cascades to addresses/messages/OTPs).
    // Skipped under PG_MEM — the in-memory DB dies with the server process.
    if (!USE_PG_MEM) {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      await client.query("DELETE FROM users WHERE username = $1", [username]);
      if (adminCreated) await client.query("DELETE FROM admins WHERE username = $1", [adminUser]).catch(() => undefined);
      await client.end();
    }

    console.log(`\n${passed} passed, ${failed} failed.`);
    // Set the exit code and return (do NOT call process.exit here — it would
    // skip the finally block that kills the dev server).
    process.exitCode = failed > 0 ? 1 : 0;
    return;
  } finally {
    // Kill the whole process group (the dev server spawns child processes
    // that survive killing only the wrapper).
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
