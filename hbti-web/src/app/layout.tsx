import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HBTI — Hot Crush",
    template: "%s — Hot Crush",
  },
  description:
    "Sixteen personalities, a few little choices. Find your Hot Crush match.",
  icons: {
    icon: "/hot-crush-arrow.png",
    apple: "/hot-crush-arrow.png",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
