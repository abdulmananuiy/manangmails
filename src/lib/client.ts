// Small client-side helper: fetch the session CSRF token, then call APIs.
export async function getCsrf(admin = false): Promise<string> {
  const res = await fetch(admin ? "/api/admin/session" : "/api/auth/session");
  if (!res.ok) throw new Error("Not signed in");
  const data = await res.json();
  return data.csrf as string;
}

export async function api(
  path: string,
  method: string,
  body?: unknown,
  admin = false
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const csrf = method === "GET" ? null : await getCsrf(admin);
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => undefined);
}
