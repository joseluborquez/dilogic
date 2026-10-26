export interface FilaPedido {
  fila: number; // numero de fila en el archivo original (para mostrar al usuario)
  codigo: string;
  cantidad: number;
  categoria: string | null;
  // Centro de cultivo / contacto, solo presente en archivos formato matriz
  // (una columna por centro). Null en el formato largo (una sola columna
  // "cantidad"), donde el contacto se ingresa manualmente al generar.
  centro: string | null;
  // Nombre del producto segun el archivo, si trae columna "producto",
  // "descripcion" o "nombre". Sirve para advertir un codigo equivocado.
  nombreArchivo?: string | null;
}

export interface ErrorParseo {
  fila: number | null; // null = error a nivel de archivo (ej. columna faltante)
  mensaje: string;
  // "aviso": informa algo que no se proceso (una hoja oculta) sin impedir
  // generar con el resto. Sin tipo es un error.
  tipo?: "aviso";
}

export interface ResultadoParseo {
  filas: FilaPedido[];
  errores: ErrorParseo[];
}
