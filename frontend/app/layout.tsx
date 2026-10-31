import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["500", "700", "800"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s · Cite & Slayy" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: "Cite & Slayy" }],
  creator: "Cite & Slayy",
  publisher: "Cite & Slayy",
  category: "education",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", url: SITE_URL, siteName: SITE_NAME, title: SITE_TITLE, description: SITE_DESCRIPTION, locale: "en_IN",
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  // Search Console / Bing ownership tokens, if set at build time (DNS verification needs neither).
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } } : {}),
  },
  icons: {
    icon: [
      { url: "/slayy-icon.svg?v=4", type: "image/svg+xml" },
      { url: "/slayy-icon-64.png?v=4", sizes: "64x64", type: "image/png" },
      { url: "/slayy-icon-192.png?v=4", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/slayy-icon-64.png?v=4",
    apple: "/slayy-icon-192.png?v=4",
  },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fff5e6" }, { media: "(prefers-color-scheme: dark)", color: "#14120f" }],
};

// Structured data so search engines can show the site name, logo and app details.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/slayy-icon-192.png`,
      email: "slayyhacks@gmail.com", contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "slayyhacks@gmail.com" } },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: SITE_NAME, alternateName: ["Cite and Slayy", "CiteSlayy", "citeslayy"],
      url: SITE_URL, publisher: { "@id": `${SITE_URL}/#org` }, inLanguage: "en" },
    { "@type": "SoftwareApplication", name: SITE_NAME, url: SITE_URL, applicationCategory: "EducationalApplication",
      operatingSystem: "Web", description: SITE_DESCRIPTION, publisher: { "@id": `${SITE_URL}/#org` },
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "Free plan with a paper preview" } },
  ],
};

// Light by default (the Slay Pop look); a saved choice wins. Applied before first paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('slayy-theme')||'light';document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
