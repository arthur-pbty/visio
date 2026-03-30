import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Visio - Vidéoconférence Simple",
  description: "Créez et rejoignez des visioconférences gratuitement, sans inscription",
  keywords: ["visioconférence", "vidéo", "appel", "gratuit", "sans inscription"],
  authors: [{ name: "Arthur P" }],
  openGraph: {
    title: "Visio - Vidéoconférence Simple",
    description: "Créez et rejoignez des visioconférences gratuitement, sans inscription",
    url: "https://visio.arthurp.fr",
    siteName: "Visio",
    locale: "fr_FR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
