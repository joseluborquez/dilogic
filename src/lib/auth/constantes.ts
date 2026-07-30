/**
 * Constantes de acceso compartidas entre servidor y navegador. Viven aparte de
 * lib/auth/sesion.ts porque ese modulo es "server-only" y el formulario de
 * login, que es un componente cliente, necesita mostrar el dominio permitido.
 */

/** Dominio unico permitido: la app emite documentos tributarios de Dilogic. */
export const DOMINIO_PERMITIDO = "dilogic.cl";

/**
 * Primer administrador. Al registrarse con este correo la cuenta queda activa
 * y con rol admin, para que exista alguien que pueda aprobar a los demas sin
 * tener que tocar la base a mano.
 */
export const EMAIL_ADMIN_INICIAL = "hugo.venegas@dilogic.cl";

export function esCorreoPermitido(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${DOMINIO_PERMITIDO}`);
}
