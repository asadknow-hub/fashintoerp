import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fashinto ERP",
  description: "Inventory, orders and customer chats in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
