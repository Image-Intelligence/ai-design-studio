import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from '@vercel/analytics/next';
import AgeGate from "@/components/age-gate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "AI Design Studio | Custom AI Content",
  description: "Exclusive AI-generated galleries, commissions, and custom content",
  formatDetection: { telephone: false },
  openGraph: {
    title: "AI Design Studio | Custom AI Content",
    description: "Exclusive AI-generated galleries, commissions, and custom content",
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AI Design Studio',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* iPad/iOS Safari's built-in <video> controls are implemented in JS inside
            WebKit and throw "Can't find variable: EmptyRanges" from their OWN code
            when many players initialize (feed pages). It's not from our bundle —
            swallow it before Next's dev overlay / error reporting treats it as an
            app crash. Registered first + capture so no later listener sees it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('error',function(e){if(e.message&&e.message.indexOf('EmptyRanges')!==-1){e.stopImmediatePropagation();e.preventDefault();}},true);`,
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AgeGate />
        {children}
        <Analytics />
      </body>
    </html>
  );
}

