import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { RizzPlusProvider } from "@/components/RizzPlusProvider";
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
  title: "Rizzuno — Live Video Chat",
  description:
    "Rizzuno is an adults-only service for random one-on-one live video and audio conversations.",
};

// Next.js's own default viewport (used whenever no explicit one is
// exported) is just `width=device-width, initial-scale=1` — no
// `viewport-fit=cover`. Without that, iOS Safari never lets the page
// extend into the notch/Dynamic Island/home-indicator safe areas, which
// means every `env(safe-area-inset-*)` value used anywhere in this app's
// CSS silently resolves to 0 — not a smaller-but-present inset, actually
// zero, indistinguishable from simply not using it at all. `viewportFit:
// "cover"` is the one thing that makes those insets real, on a fixed-
// viewport, video-first app where floating controls sit close to every
// screen edge on purpose (see MatchStage.tsx's control clusters).
// `userScalable: false` matches this app's existing non-scrollable,
// app-like posture (spec §44's "fixed viewport, like a camera, not a
// document") — pinch-zoom on a live video call was never a supported
// interaction here, and disabling it also avoids the layout jumping
// mid-gesture on exactly the screens safe-area insets matter most for.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider><RizzPlusProvider>{children}</RizzPlusProvider></AuthProvider>
      </body>
    </html>
  );
}
