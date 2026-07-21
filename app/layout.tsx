import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./platform.css";
import { StoryTransitionProvider } from "./platform/story-transition";

const SITE_URL = new URL("https://thestoryscrolls.com");
const SITE_TITLE = "The Story Scrolls — Stories Worth Wandering Into";
const SITE_DESCRIPTION =
  "Living, illustrated reading journeys that help young and lifelong readers love books—and help new writers learn how stories work.";
const BRAND_ASSET_VERSION = "20260721b";
const SOCIAL_IMAGE_ALT =
  "An illuminated parchment tableau of a child and elder reading while two creators draw a story world into being, titled The Story Scrolls — Read, Wander, Create.";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "The Story Scrolls",
  creator: "Cory Boehne",
  category: "books",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: `/favicon.svg?v=${BRAND_ASSET_VERSION}`, type: "image/svg+xml" },
      { url: `/favicon.ico?v=${BRAND_ASSET_VERSION}`, sizes: "any" },
      {
        url: `/favicon-32x32.png?v=${BRAND_ASSET_VERSION}`,
        type: "image/png",
        sizes: "32x32",
      },
    ],
    apple: [
      {
        url: `/apple-touch-icon.png?v=${BRAND_ASSET_VERSION}`,
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  manifest: `/site.webmanifest?v=${BRAND_ASSET_VERSION}`,
  openGraph: {
    type: "website",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "The Story Scrolls",
    locale: "en_US",
    images: [
      {
        url: `/og.png?v=${BRAND_ASSET_VERSION}`,
        width: 1200,
        height: 630,
        type: "image/png",
        alt: SOCIAL_IMAGE_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: `/og.png?v=${BRAND_ASSET_VERSION}`, alt: SOCIAL_IMAGE_ALT }],
  },
  appleWebApp: {
    capable: true,
    title: "The Story Scrolls",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  robots: {
    index: true,
    follow: true,
  },
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070c13" },
    { media: "(prefers-color-scheme: light)", color: "#c39c5e" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Caveat+Brush&family=Cinzel+Decorative:wght@700&family=Homemade+Apple&family=IM+FELL+English+SC&family=Literata:opsz,wght@7..72,400;7..72,700&family=Nunito:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <StoryTransitionProvider>{children}</StoryTransitionProvider>
      </body>
    </html>
  );
}
