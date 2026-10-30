import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["500", "700", "800"] });

export const metadata: Metadata = {
  title: "Cite & Slayy · cite it right, slay the review",
  description:
    "Find the research gap, check every citation against real scholarly databases (retractions included), and get a reasoned go / no-go before you submit.",
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

// Light by default (the Slay Pop look); a saved choice wins. Applied before first paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('slayy-theme')||'light';document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
