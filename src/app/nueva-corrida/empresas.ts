export interface EmpresaOpcion {
  codigo: string;
  nombre: string;
}

// TODO: reemplazar por una consulta a la tabla `empresas` (activo = true) en
// cuanto exista el proyecto Supabase, para poder agregar empresas sin tocar
// codigo (ver CLAUDE.md).
export const EMPRESAS: EmpresaOpcion[] = [
  { codigo: "CERQ", nombre: "Cermaq" },
  { codigo: "MTX", nombre: "Multiexport" },
  { codigo: "YDR", nombre: "Yadran" },
];
