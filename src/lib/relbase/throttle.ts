/**
 * Limitador simple para respetar el rate limit de Relbase (v2: 300 req/min
 * por empresa). Encola llamadas y las espacía; vive dentro de una sola
 * invocacion de route handler (no persiste entre requests), que es la razon
 * por la que la generacion masiva se hace en lotes chicos desde el cliente
 * en vez de un solo request largo.
 */
export function createThrottledQueue(maxPerSecond: number) {
  const minIntervalMs = 1000 / maxPerSecond;
  let lastCallAt = 0;
  // Encadena solo los turnos de partida, no las llamadas: cada una sale a su
  // hora y no espera a que termine la anterior. Antes la cola esperaba la
  // respuesta, y con ~400 ms por llamada el ritmo real quedaba en ~2,5/s y
  // pedir varias paginas en paralelo no servia de nada (25-oct-2026).
  let turnos: Promise<void> = Promise.resolve();

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const turno = turnos.then(async () => {
      const wait = Math.max(0, lastCallAt + minIntervalMs - Date.now());
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      lastCallAt = Date.now();
    });
    turnos = turno;
    return turno.then(fn);
  }

  return { schedule };
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    baseDelayMs?: number;
    isRetryable?: (err: unknown) => boolean;
    /** Espera impuesta por el error (ej. Retry-After); si no hay, backoff exponencial. */
    delayMs?: (err: unknown) => number | undefined;
  } = {}
): Promise<T> {
  const { retries = 3, baseDelayMs = 500, isRetryable = () => true, delayMs } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryable(err)) throw err;
      const delay = delayMs?.(err) ?? baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
