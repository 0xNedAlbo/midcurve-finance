/**
 * Next.js Instrumentation Hook
 *
 * Runs once when the Next.js server starts. Kicks off `initAppConfig()`
 * as a background task so that DB-backed config is loaded and downstream
 * singletons (EvmConfig, etc.) are initialized before data routes are hit.
 *
 * The 503 middleware gates `/api/v1/*` until `isAppConfigReady()` is true.
 */

export async function register(): Promise<void> {
  // Only run on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initAppConfig } = await import('@midcurve/services');
    // Fire-and-forget — the 503 middleware gates requests until ready
    initAppConfig().catch((err) => {
      console.error('[instrumentation] Failed to initialize AppConfig:', err);
    });
  }
}
