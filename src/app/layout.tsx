import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "lyco",
  description: "personal accountability",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#161826",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <h1 className="sr-only">lyco</h1>
        {children}
      </body>
    </html>
  );
}
