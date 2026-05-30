import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: {
    default: "OpenDeviceIO — an open format for hardware device I/O",
    template: "%s · OpenDeviceIO"
  },
  description:
    "OpenDeviceIO (ODIO) is an open, machine-readable format for describing a hardware device's I/O, power, physical, and compliance characteristics — so design tools can import accurate device data instead of re-keying PDFs.",
  metadataBase: new URL("https://opendeviceio.org")
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
