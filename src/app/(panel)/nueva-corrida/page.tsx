import { redirect } from "next/navigation";

// La corrida vive ahora en el inicio, debajo de las ventas (28-oct-2026). La
// ruta queda para enlaces guardados; sus acciones siguen en esta carpeta.
export default function NuevaCorridaPage() {
  redirect("/#nueva-corrida");
}
