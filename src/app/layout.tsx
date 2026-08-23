import type { Metadata, Viewport } from "next";
import { AppProvider } from "@/context/AppContext";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "lyco",
  description: "personal accountability",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
