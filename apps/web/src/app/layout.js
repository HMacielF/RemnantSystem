import localFont from "next/font/local";
import { Geist_Mono, Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

const neuethingSans = localFont({
  variable: "--font-neuething-sans",
  display: "swap",
  src: [
    { path: "./fonts/NeuethingSans-RegularSemiExpanded.otf", weight: "400", style: "normal" },
    { path: "./fonts/NeuethingSans-MediumSemiExpanded.otf", weight: "500", style: "normal" },
    { path: "./fonts/NeuethingSans-SemiBoldSemiExpanded.otf", weight: "600", style: "normal" },
    { path: "./fonts/NeuethingSans-BoldSemiExpanded.otf", weight: "700", style: "normal" },
    { path: "./fonts/NeuethingSans-EtraBoldSemiExpanded.otf", weight: "800", style: "normal" },
    { path: "./fonts/NeuethingSans-BlackSemiExpanded.otf", weight: "900", style: "normal" },
  ],
});

// Keep the active display stack explicit so the rest of the app has a clear,
// predictable set of heading weights to use.
const stolzDisplay = localFont({
  variable: "--font-stolzl-display",
  display: "swap",
  src: [
    { path: "./fonts/StolzlDisplay-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/StolzlDisplay-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/StolzlDisplay-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/StolzlDisplay-Bold.ttf", weight: "700", style: "normal" },
  ],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
});

export const metadata = {
  title: "Remnant System",
  description: "Stone inventory, hold requests, and management tools.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${neuethingSans.variable} ${stolzDisplay.variable} ${geistMono.variable} ${inter.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
