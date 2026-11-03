/**
 * Cambia la contraseña de una cuenta de la app de guías desde el computador.
 *   npx tsx scripts/cambiar-clave.mts correo@dilogic.cl
 * En una terminal normal pide la clave nueva sin mostrarla; si no se puede escribir
 * (p. ej. con el "!" de Claude Code), genera una y la muestra una sola vez.
 */
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

process.loadEnvFile(".env.local");

const correo = (process.argv[2] ?? "").trim().toLowerCase();
if (!correo.includes("@")) {
  console.error("Uso: npx tsx scripts/cambiar-clave.mts correo@dilogic.cl");
  process.exit(1);
}

function preguntarOculto(texto: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlx = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(texto);
    rlx._writeToOutput = () => {};
    rl.question("", (r) => {
      rl.close();
      process.stdout.write("\n");
      resolve(r);
    });
  });
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let usuario: { id: string; email?: string } | undefined;
for (let page = 1; !usuario; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  usuario = data.users.find((u) => u.email?.toLowerCase() === correo);
  if (data.users.length < 200) break;
}
if (!usuario) {
  console.error(`No existe una cuenta con el correo ${correo}.`);
  process.exit(1);
}

// Sin terminal interactiva (p. ej. el "!" de Claude Code) no se puede escribir la
// clave: se genera una aleatoria y se muestra una sola vez.
const interactivo = process.stdin.isTTY === true;
let clave: string;
if (interactivo) {
  clave = await preguntarOculto("Clave nueva (mínimo 8 caracteres): ");
  const repetida = await preguntarOculto("Repítela: ");
  if (clave.length < 8 || clave !== repetida) {
    console.error("Las claves no coinciden o son muy cortas. No se cambió nada.");
    process.exit(1);
  }
} else {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  clave = Array.from(randomBytes(12), (b) => letras[b % letras.length]).join("");
}

const { error } = await supabase.auth.admin.updateUserById(usuario.id, { password: clave });
if (error) throw error;
console.log(`Clave cambiada para ${correo}. Ya puedes entrar a la app de guías.`);
if (!interactivo) console.log(`Clave nueva: ${clave}`);
