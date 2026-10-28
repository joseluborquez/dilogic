import type { Metadata } from "next";
import localFont from "next/font/local";
import { Fondo } from "@/components/ui/Fondo";
import "./globals.css";

// Fuentes incluidas en el repo (licencia SIL OFL, subconjunto latin bajado de
// Google Fonts) en vez de next/font/google: esa variante las descarga en cada
// build, y cuando Google no respondia a tiempo el despliegue en Vercel fallaba
// entero (paso dos veces el 24-oct-2026).
const display = localFont({
  variable: "--font-display",
  src: "./fonts/SpaceGrotesk-latin-500-700.woff2",
  weight: "500 700",
  display: "swap",
});

const body = localFont({
  variable: "--font-body",
  src: "./fonts/Inter-latin-100-900.woff2",
  weight: "100 900",
  display: "swap",
});

const data = localFont({
  variable: "--font-data",
  src: [
    { path: "./fonts/IBMPlexMono-latin-400.woff2", weight: "400" },
    { path: "./fonts/IBMPlexMono-latin-500.woff2", weight: "500" },
    { path: "./fonts/IBMPlexMono-latin-600.woff2", weight: "600" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dilogic · Guías de despacho",
  description:
    "Generación masiva de guías de despacho en Relbase a partir de pedidos ya depurados.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} ${data.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Fondo />
        {children}
      </body>
    </html>
  );
}
