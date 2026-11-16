import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Providers from "./providers";

const raleway = localFont({
  src: "./fonts/raleway-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-raleway",
});

export const metadata: Metadata = {
  title: "Artic",
  description: "NFT marketplace on the Arc blockchain",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={raleway.variable}>
      <head>
        <script
          // Runs before paint to avoid a flash of the wrong theme: applies the
          // saved preference, or the OS preference if the user hasn't chosen yet.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("artic-theme");if(t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.classList.add("dark");}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
