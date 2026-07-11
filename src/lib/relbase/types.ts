export interface RelbaseCredenciales {
  tokenEmpresa: string;
  tokenUsuarioIntegrador: string;
}

export interface RelbaseProducto {
  id: number;
  name: string;
  code: string | null;
  company_id: number;
  business_id: number;
  // Confirmado contra la respuesta real de GET /productos (09-jul-2026).
  [key: string]: unknown;
}

export interface RelbaseMeta {
  code: number;
  message: string;
  current_page: number;
  next_page: number;
  prev_page: number;
  total_pages: number;
  total_count: number;
}

export interface RelbaseProductosPage {
  data: { products: RelbaseProducto[] };
  meta: RelbaseMeta;
}

export interface RelbaseDteProducto {
  product_id: number;
  price: number;
  quantity: number;
  tax_affected: boolean;
  // Sin esto, Relbase no siempre completa la descripcion impresa igual que
  // al crear la guia a mano (reportado por Hugo, 11-jul-2026): se envia
  // explicita, tomada del catalogo (productos_catalogo.descripcion).
  description?: string;
}

export interface RelbaseCrearDtePayload {
  type_document: 52;
  start_date: string; // dd-mm-yyyy
  end_date: string; // dd-mm-yyyy
  customer_id: number;
  ware_house_id: number;
  type_transfer: number; // confirmado: 6 = "Otros traslados no venta" (PRD 6.3)
  // Direccion PRINCIPAL del documento (schema oficial: api.relbase.cl/api/v1/docs.json,
  // confirmado 11-jul-2026 contra un DTE real donde estos 3 campos vienen
  // poblados). Es la que valida el mensaje de error "Address Debe ingresar
  // direccion". No usar ademas dispatch_address/dispatch_city_id/
  // dispatch_commune_id: son un campo aparte y opcional que Relbase imprime
  // en el PDF como una linea extra "Transporte: Despachar a ..." que no
  // aparece en las guias creadas a mano (confirmado 11-jul-2026, folio 39424).
  address: string;
  city_id: number;
  commune_id: number;
  // Centro de cultivo / referencia del despacho (confirmado contra guias
  // reales 09-jul-2026: es el unico dato que varia por corrida).
  contact: string;
  products: RelbaseDteProducto[];
}

export interface RelbaseCrearDteResponse {
  id: number;
  folio: number | string;
  [key: string]: unknown;
}

export interface RelbaseDteDetalle {
  id: number;
  folio: number | string;
  // URL firmada de S3, expira ~1h (confirmado 11-jul-2026): descargar de
  // inmediato, no persistir esta URL tal cual.
  pdf_file: { url: string } | null;
  [key: string]: unknown;
}

export interface RelbaseTipoTraslado {
  id: number;
  name: string;
}

export interface RelbaseTiposTrasladoResponse {
  data: { type_transfers: RelbaseTipoTraslado[] };
  meta: { code: number; message: string };
}

/** Confirmado 09-jul-2026 via GET /dtes/guias/tipos_traslado (PRD 6.3). */
export const TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA = 6;

export class RelbaseApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
    this.name = "RelbaseApiError";
  }
}
