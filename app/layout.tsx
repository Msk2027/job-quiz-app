import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  // ★ここに「ブラウザのタブ」に表示したい名前を入れる
  title: "消費者行動論絶対取るぞ",
  description: "自作の試験対策アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={inter.className}>{children}</body>
    </html>
  );
}