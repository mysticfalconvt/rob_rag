/**
 * Next.js instrumentation hook
 * This runs once when the server starts
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return;
    }

    try {
      const { initializePlugins } = await import('./lib/plugins');
      initializePlugins();

      const { backgroundScheduler } = await import('./lib/scheduler');
      backgroundScheduler.start();

      console.log('[Init] Server startup complete');
    } catch (error) {
      console.error('[Init] Startup failed:', error);
    }
  }
}
