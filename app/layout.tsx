import type { Metadata } from "next"; import "./globals.css";
export const metadata:Metadata={title:"Study Studio",description:"複数形式に対応した試験対策アプリ"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>}
