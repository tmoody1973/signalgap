import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });

export const metadata: Metadata = {
  title: "SignalGap",
  description: "Editorial lead discovery for Milwaukee newsrooms.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${newsreader.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-surface text-ink font-ui antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
