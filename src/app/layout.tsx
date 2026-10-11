import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toasts";
export const metadata: Metadata = {
  title: "DATAMAT · Gestão de anúncios",
  description:
    "Operação, precificação e decisões das lojas juntas em um só lugar.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
