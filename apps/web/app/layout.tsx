import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: "OpenDeviceIO — an open format for hardware device I/O",
    template: "%s · OpenDeviceIO"
  },
  description:
    "OpenDeviceIO (ODIO) is an open, machine-readable format for describing a hardware device's I/O, power, physical, and compliance characteristics — so design tools can import accurate device data instead of re-keying PDFs.",
  // Canonical and og:url values resolve against this, on every host
  // (preview deployments included).
  metadataBase: new URL(SITE_URL)
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
