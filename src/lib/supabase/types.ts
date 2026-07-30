// Refleja supabase/migrations/0001_init.sql. Reemplazar por los tipos
// generados con `supabase gen types typescript` en cuanto exista el proyecto.

export type VersionApi = "v1" | "v2";

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

export type CredencialRelbase = {
  id: string;
  empresa_id: string;
  token_empresa: string;
  token_usuario_integrador: string;
  version_api: VersionApi;
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
  created_at: string;
};

export type Corrida = {
  id: string;
  empresa_id: string;
  usuario: string;
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

export interface Database {
  public: {
    Tables: {
      empresas: {
        Row: Empresa;
        Insert: Partial<Empresa>;
        Update: Partial<Empresa>;
        Relationships: [];
      };
      credenciales_relbase: {
        Row: CredencialRelbase;
        Insert: Partial<CredencialRelbase>;
        Update: Partial<CredencialRelbase>;
        Relationships: [];
      };
      productos_catalogo: {
        Row: ProductoCatalogo;
        Insert: Partial<ProductoCatalogo>;
        Update: Partial<ProductoCatalogo>;
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
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
