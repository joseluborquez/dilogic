export interface FilaPedido {
  fila: number; // numero de fila en el archivo original (para mostrar al usuario)
  codigo: string;
  cantidad: number;
  categoria: string | null;
}

export interface ErrorParseo {
  fila: number | null; // null = error a nivel de archivo (ej. columna faltante)
  mensaje: string;
}

export interface ResultadoParseo {
  filas: FilaPedido[];
  errores: ErrorParseo[];
}
