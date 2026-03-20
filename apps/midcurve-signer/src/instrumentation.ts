/**
 * Next.js Instrumentation
 *
 * Runs once on server startup. Used to eagerly initialize the operator key
 * so it's ready before any signing requests arrive.
 */

export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { OperatorKeyService } = await import('@/services/operator-key-service');
    await OperatorKeyService.getInstance().initialize();
  }
}
