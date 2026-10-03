import type { Metadata, Viewport } from "next";
import { Archivo, Chivo_Mono } from "next/font/google";
import "./globals.css";
import { site } from "@/config/site";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
  weight: ["400", "500", "700", "800"],
});

const chivoMono = Chivo_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-chivo-mono",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "surf forecast",
    "swell",
    "tide",
    "reef pass",
    "wave lab",
    "WebGL",
    "surf conditions",
    "MCP",
    "open-source AI",
  ],
  authors: [{ name: site.author, url: "https://github.com/aniruddhaadak80" }],
  creator: site.author,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${site.name}: today's real swell, wind and verified tide turned into one explainable verdict per break.` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: "#0a2f36",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${chivoMono.variable}`}>
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:bg-ink focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-paper"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-6xl px-4">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}