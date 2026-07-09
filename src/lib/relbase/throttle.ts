/**
 * Limitador simple para respetar el rate limit de Relbase v1 (7 req/seg,
 * PRD seccion 6.4). Encola llamadas y las espacía; vive dentro de una sola
 * invocacion de route handler (no persiste entre requests), que es la razon
 * por la que la generacion masiva se hace en lotes chicos desde el cliente
 * en vez de un solo request largo.
 */
export function createThrottledQueue(maxPerSecond: number) {
  const minIntervalMs = 1000 / maxPerSecond;
  let lastCallAt = 0;
  let chain: Promise<unknown> = Promise.resolve();

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const now = Date.now();
      const wait = Math.max(0, lastCallAt + minIntervalMs - now);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      lastCallAt = Date.now();
      return fn();
    };

    const result = chain.then(run, run);
    // Evita que un rechazo interrumpa las llamadas siguientes en la cola.
    chain = result.catch(() => undefined);
    return result;
  }

  return { schedule };
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; isRetryable?: (err: unknown) => boolean } = {}
): Promise<T> {
  const { retries = 3, baseDelayMs = 500, isRetryable = () => true } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
