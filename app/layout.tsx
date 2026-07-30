import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life Command Centre",
  description: "A calm, visual system for turning plans into daily action."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
