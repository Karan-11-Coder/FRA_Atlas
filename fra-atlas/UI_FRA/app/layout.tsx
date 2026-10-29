import type React from "react";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import ErrorBoundary from "@/components/error-boundary";
import ToastProvider from "@/components/toast-provider";
import AppShell from "@/components/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "FRA Atlas · ML Lab",
  description:
    "Interactive ML dashboard for Forest Rights Act claims: scheme-suitability models, explainability, and document AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <ErrorBoundary>
          <AppShell>{children}</AppShell>
          <ToastProvider />
        </ErrorBoundary>
      </body>
    </html>
  );
}
