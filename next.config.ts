import path from "node:path";
import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las paginas:
 * - X-Frame-Options / frame-ancestors: nadie puede incrustar la app en un
 *   iframe para engañar al usuario y hacerlo apretar "Generar guías".
 * - nosniff: el navegador no adivina el tipo de un archivo descargado.
 * - Referrer-Policy: las URLs internas (con ids de corridas) no viajan a
 *   otros sitios al seguir un enlace.
 * - HSTS: siempre HTTPS, aunque alguien escriba http://.
 */
const CABECERAS_SEGURIDAD = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // No anunciar "X-Powered-By: Next.js": no le sirve al usuario y orienta a un atacante.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: CABECERAS_SEGURIDAD }];
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // El limite por defecto (1 MB) lo alcanzan tres cosas de esta app: el
      // Excel del pedido, el Excel del catalogo al crear una empresa, y el
      // JSON de filas que viaja al generar. 4 MB deja margen sin acercarse al
      // tope de cuerpo de request de Vercel (~4,5 MB).
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
