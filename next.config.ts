import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
