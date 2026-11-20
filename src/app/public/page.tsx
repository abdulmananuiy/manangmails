// /public — the ready-made public address pool. No login needed:
// anyone can see the addresses, copy one, and open its public inbox.
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import { receiverStatusLabel } from "@/lib/db";
import { listPublicAddresses, PUBLIC_POOL_SIZE } from "@/lib/public-pool";

export const dynamic = "force-dynamic";

export default async function PublicAddressesPage() {
  const addresses = await listPublicAddresses();
  const status = await receiverStatusLabel().catch(() => "NOT_CONFIGURED" as const);
  return (
    <>
      <h1>Public addresses — no login needed</h1>
      <p className="muted">
        {addresses.length} of {PUBLIC_POOL_SIZE} ready-made addresses. Pick any
        one, copy it, and use it wherever you need an address — mail sent to
        it shows up in its public inbox below. Anyone with the link can read
        that inbox, so never use a public address for anything private.
      </p>
      {status !== "CONNECTED" && (
        <div className="banner warn">
          <b>Receiving: NOT CONFIGURED.</b> These addresses are real database
          records, but they cannot receive mail yet — the domain is still
          waiting for registration approval and no mail receiver is connected.
          Do not share them as working inboxes until receiving is connected.
        </div>
      )}
      <div className="card">
        {addresses.length === 0 ? (
          <p className="muted">
            The public pool is being set up — no addresses yet. Check back
            soon.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Messages</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {addresses.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.full_address}</code>
                  </td>
                  <td>{a.message_count}</td>
                  <td>
                    <CopyButton text={a.full_address} />{" "}
                    <Link href={`/public/${a.local_part}`}>Open inbox →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
