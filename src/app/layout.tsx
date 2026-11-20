import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Private Email Platform",
  description:
    "Your own private, Gmail-style email platform on your own domain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            ✉️ Private Email Platform
          </a>
          <nav>
            <a href="/public">Public addresses</a>
            <a href="/dashboard">Dashboard</a>
            <a href="/dashboard/inbox">Inbox</a>
            <a href="/dashboard/addresses">My Addresses</a>
            <a href="/dashboard/otp">OTP Messages</a>
            <a href="/dashboard/settings">Settings</a>
            <a href="/admin">Admin</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Private Email Platform — your mail, your domain, your database.
        </footer>
      </body>
    </html>
  );
}
