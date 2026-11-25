import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Laboratório Invisível",
  description:
    "Protótipo Hack Brasil 2026: sala temporária para previsões e medições do experimento do pêndulo.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
