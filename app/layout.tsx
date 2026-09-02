import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Red Court Invitational 2026 — Tournament Manager",
  description: "Official Red Court Invitational schedule, race-to-31 brackets, live scoring, and player match search.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
