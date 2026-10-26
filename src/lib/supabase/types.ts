// Refleja supabase/migrations/0001_init.sql. Reemplazar por los tipos
// generados con `supabase gen types typescript` en cuanto exista el proyecto.

export type EstadoCorrida =
  | "pendiente"
  | "validando"
  | "generando"
  | "completada"
  | "completada_con_errores"
  | "error";

export type EstadoGuia = "pendiente" | "generada" | "error";

// Nota: `type` (no `interface`) a proposito. El SDK de Supabase exige que
// cada Row estructuralmente extienda Record<string, unknown>, y una interface
// (a diferencia de un type literal) no satisface ese chequeo aunque tenga las
// mismas propiedades.
export type Empresa = {
  id: string;
  nombre: string;
  codigo_interno: string;
  activo: boolean;
  // Destino de la guia (PRD): fijos por empresa, confirmados contra guias
  // reales + GET /clientes de Relbase (09-jul-2026).
  relbase_customer_id: number | null;
  dispatch_address: string | null;
  dispatch_city_id: number | null;
  dispatch_commune_id: number | null;
  relbase_ware_house_id: number | null;
  created_at: string;
};

export type EstadoConexionRelbase = "conectada" | "revocada";

// Conexion OAuth2 con Relbase v2 (0013). Fila unica; tokens cifrados.
export type ConexionRelbase = {
  id: boolean;
  access_token: string;
  refresh_token: string;
  access_token_expira_en: string;
  scope: string;
  estado: EstadoConexionRelbase;
  ultimo_error: string | null;
  conectado_por: string | null;
  conectado_en: string;
  renovado_en: string | null;
  renovacion_bloqueada_hasta: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductoCatalogo = {
  id: string;
  empresa_id: string;
  sku: string;
  product_id_relbase: number | null;
  precio: number | null;
  descripcion: string | null;
  // Nota corta de unidad/empaque (ej. "1 lt. Bot."), atributo "description"
  // de Relbase — separado del nombre del producto (arriba).
  descripcion_relbase: string | null;
  familia: string | null;
  activo: boolean;
  ultima_sincronizacion: string | null;
  // Estado del codigo en Relbase (0014): la sincronizacion bloquea y
  // reactiva segun lo que ve alla.
  nombre_relbase: string | null;
  habilitado_relbase: boolean | null;
  motivo_bloqueo: string | null;
  bloqueado_por: "relbase" | "manual" | null;
  created_at: string;
};

export type OrigenSincronizacion = "manual" | "automatica";

export type SincronizacionCatalogo = {
  id: string;
  origen: OrigenSincronizacion;
  iniciada_en: string;
  terminada_en: string | null;
  estado: "en_curso" | "ok" | "error";
  resumen: unknown;
  error: string | null;
  created_at: string;
};

// Ventas (0016): copia de las guias tipo 52 de Relbase con sus productos.
export type VentaGuia = {
  dte_id: number;
  folio: number;
  fecha: string;
  sii_status: string | null;
  anulada: boolean; // generada: sii_status = 'cancel'
  customer_id: number | null;
  contacto: string | null;
  type_transfer: number | null;
  monto_neto: number;
  monto_total: number;
  lineas_cargadas: boolean;
  actualizado_en: string;
  created_at: string;
};

export type VentaLinea = {
  dte_id: number;
  linea: number;
  product_id: number | null;
  codigo: string | null;
  nombre: string | null;
  empresa: string;
  familia: string | null;
  cantidad: number;
  precio: number;
  descuento: number | null;
  monto_neto: number;
};

export type SincronizacionVentas = {
  id: string;
  origen: "manual" | "automatica" | "carga_inicial";
  desde: string;
  iniciada_en: string;
  terminada_en: string | null;
  estado: "en_curso" | "ok" | "parcial" | "error";
  resumen: unknown;
  error: string | null;
  created_at: string;
};

// Guias manuales (0017): una fila por emision desde "Guia manual".
/** Memoria de la guia manual (0018): texto del cliente -> producto con que se emitio. */
export type MemoriaListado = {
  texto: string;
  texto_original: string;
  codigo: string;
  product_id: number | null;
  veces: number;
  usuario: string | null;
  actualizado_en: string;
  created_at: string;
};

export type GuiaManual = {
  id: string;
  idempotency_key: string;
  estado: "emitiendo" | "emitida" | "error";
  customer_id: number;
  cliente_rut: string | null;
  cliente_nombre: string | null;
  opcion_precio: string;
  monto_neto: number;
  payload: unknown;
  dte_id: number | null;
  folio: string | null;
  mensaje_error: string | null;
  usuario_id: string | null;
  usuario: string | null;
  created_at: string;
  emitida_en: string | null;
};

export type TraspasoFactura = {
  id: string;
  proveedor_rut: string;
  folio: string;
  fecha_factura: string | null;
  neto: number;
  total: number;
  empresa_id: string;
  centro: string;
  corrida_id: string | null;
  created_at: string;
};

export type Corrida = {
  id: string;
  empresa_id: string;
  usuario: string;
  /** Null en las corridas anteriores a la autenticacion. */
  usuario_id: string | null;
  archivo_original_nombre: string;
  fecha_ejecucion: string;
  total_filas: number;
  total_exitosas: number;
  total_error: number;
  estado: EstadoCorrida;
  // Evita que reenviar el formulario emita un segundo juego de DTEs
  // (ver supabase/migrations/0010_idempotencia_corridas.sql).
  idempotency_key: string | null;
  created_at: string;
};

export type GuiaGenerada = {
  id: string;
  corrida_id: string;
  sku: string;
  product_id_relbase: number | null;
  cantidad: number;
  categoria: string | null;
  centro: string | null;
  folio_relbase: string | null;
  // Id del DTE en Relbase: lo pide GET /dtes/{id}, unica via para recuperar el
  // PDF de una guia ya emitida. El folio no sirve para eso.
  dte_id_relbase: number | null;
  estado: EstadoGuia;
  mensaje_error: string | null;
  fecha_generacion: string | null;
  created_at: string;
  pdf_path: string | null;
  // Eliminacion logica: la guia deja de verse en el historial de la app, pero
  // el DTE sigue emitido en Relbase/SII y la fila se conserva para trazabilidad
  // (ver supabase/migrations/0007_eliminacion_guias.sql).
  eliminado_en: string | null;
  eliminado_por: string | null;
};

export type RolPerfil = "admin" | "operador";
export type EstadoPerfil = "pendiente" | "activo" | "bloqueado";

export type Perfil = {
  id: string;
  email: string;
  nombre: string | null;
  rol: RolPerfil;
  estado: EstadoPerfil;
  created_at: string;
  activado_en: string | null;
};

export interface Database {
  public: {
    Tables: {
      perfiles: {
        Row: Perfil;
        Insert: Partial<Perfil>;
        Update: Partial<Perfil>;
        Relationships: [];
      };
      empresas: {
        Row: Empresa;
        Insert: Partial<Empresa>;
        Update: Partial<Empresa>;
        Relationships: [];
      };
      relbase_conexion: {
        Row: ConexionRelbase;
        Insert: Partial<ConexionRelbase>;
        Update: Partial<ConexionRelbase>;
        Relationships: [];
      };
      productos_catalogo: {
        Row: ProductoCatalogo;
        Insert: Partial<ProductoCatalogo>;
        Update: Partial<ProductoCatalogo>;
        Relationships: [];
      };
      sincronizaciones_catalogo: {
        Row: SincronizacionCatalogo;
        Insert: Partial<SincronizacionCatalogo>;
        Update: Partial<SincronizacionCatalogo>;
        Relationships: [];
      };
      ventas_guias: {
        Row: VentaGuia;
        Insert: Partial<VentaGuia>;
        Update: Partial<VentaGuia>;
        Relationships: [];
      };
      ventas_lineas: {
        Row: VentaLinea;
        Insert: Partial<VentaLinea>;
        Update: Partial<VentaLinea>;
        Relationships: [];
      };
      sincronizaciones_ventas: {
        Row: SincronizacionVentas;
        Insert: Partial<SincronizacionVentas>;
        Update: Partial<SincronizacionVentas>;
        Relationships: [];
      };
      memoria_listados: {
        Row: MemoriaListado;
        Insert: Partial<MemoriaListado>;
        Update: Partial<MemoriaListado>;
        Relationships: [];
      };
      guias_manuales: {
        Row: GuiaManual;
        Insert: Partial<GuiaManual>;
        Update: Partial<GuiaManual>;
        Relationships: [];
      };
      traspasos_factura: {
        Row: TraspasoFactura;
        Insert: Partial<TraspasoFactura>;
        Update: Partial<TraspasoFactura>;
        Relationships: [];
      };
      corridas: {
        Row: Corrida;
        Insert: Partial<Corrida>;
        Update: Partial<Corrida>;
        Relationships: [];
      };
      guias_generadas: {
        Row: GuiaGenerada;
        Insert: Partial<GuiaGenerada>;
        Update: Partial<GuiaGenerada>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      tomar_renovacion_relbase: {
        Args: { p_segundos?: number };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
