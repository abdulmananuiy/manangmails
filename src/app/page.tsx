import { getSetting, receiverStatusLabel } from "@/lib/db";
import CopyButton from "@/components/CopyButton";
import { listPublicAddresses, PUBLIC_POOL_SIZE } from "@/lib/public-pool";

export const dynamic = "force-dynamic";

export default async function Home() {
  const status = await receiverStatusLabel().catch(() => "NOT_CONFIGURED" as const);
  const domain = (await getSetting("domain").catch(() => null)) ?? "yourdomain.com";
  const publicAddresses = await listPublicAddresses().catch(() => []);
  const preview = publicAddresses.slice(0, 8);
  const receiving =
    status === "CONNECTED" ? (
      <span className="badge ok">Receiving: CONNECTED</span>
    ) : status === "ERROR" ? (
      <span className="badge bad">Receiving: ERROR</span>
    ) : (
      <span className="badge warn">Receiving: NOT CONFIGURED</span>
    );

  return (
    <>
      <div className="card">
        <h1>Your own private email platform</h1>
        <p>
          Sign up with a username and password, generate addresses on your own
          domain — for example <code>randomname@{domain}</code> — and read
          incoming mail in a Gmail-style inbox with OTP detection.
        </p>
        <p>
          {receiving}{" "}
          {status !== "CONNECTED" && (
            <span className="muted">
              No mail receiver is connected yet. Generated addresses cannot
              receive mail until a receiver (self-hosted mail server or an
              inbound email provider) is connected in Admin → Receiver.
            </span>
          )}
        </p>
        <p>
          <a href="/signup">
            <button type="button">Create account</button>
          </a>{" "}
          <a href="/login">
            <button type="button" className="secondary">
              Log in
            </button>
          </a>
        </p>
      </div>

      <div className="card">
        <h2>How it works</h2>
        <ol>
          <li>Create an account and generate a random address on your domain.</li>
          <li>
            Mail sent to that address is accepted by your mail receiver and
            delivered to the platform&apos;s secure inbound API.
          </li>
          <li>
            The message is stored in your inbox, OTP codes are detected
            automatically, and you can save addresses for later use.
          </li>
        </ol>
        <p className="muted">
          Passwords are stored only as secure hashes and are never shown to
          administrators. This platform receives email; it never asks for or
          stores passwords belonging to other services.
        </p>
      </div>

      <div className="card">
        <h2>Ready-made addresses — no login needed</h2>
        {publicAddresses.length === 0 ? (
          <p className="muted">
            {PUBLIC_POOL_SIZE} ready-made public addresses are being set up —
            check back soon.
          </p>
        ) : (
          <>
            <p className="muted">
              {publicAddresses.length} addresses are ready to use right now.
              Copy any one and use it — mail sent to it appears in its public
              inbox. Anyone with the link can read a public inbox, so never
              use one for anything private.
            </p>
            <table>
              <tbody>
                {preview.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <code>{a.full_address}</code>
                    </td>
                    <td>
                      <CopyButton text={a.full_address} />{" "}
                      <a href={`/public/${a.local_part}`}>Open inbox →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p>
          <a href="/public">
            See all {publicAddresses.length || PUBLIC_POOL_SIZE} public
            addresses →
          </a>
        </p>
      </div>
    </>
  );
}
