import { getSetting, receiverStatusLabel } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const status = await receiverStatusLabel().catch(() => "NOT_CONFIGURED" as const);
  const domain = (await getSetting("domain").catch(() => null)) ?? "yourdomain.com";
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
    </>
  );
}
