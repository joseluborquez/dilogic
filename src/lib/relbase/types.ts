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
}

export interface RelbaseCrearDtePayload {
  type_document: 52;
  start_date: string; // dd-mm-yyyy
  end_date: string; // dd-mm-yyyy
  customer_id: number;
  ware_house_id: number;
  type_transfer: number; // confirmado: 6 = "Otros traslados no venta" (PRD 6.3)
  dispatch_address: string;
  dispatch_city_id: number;
  dispatch_commune_id: number;
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
