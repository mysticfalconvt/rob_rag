/**
 * Next.js instrumentation hook
 * This runs once when the server starts
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run on the server side, not during build
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      console.log('[Instrumentation] Skipping initialization during build');
      return;
    }

    console.log('[Instrumentation] Initializing application on server startup...');

    try {
      // Initialize plugins
      const { initializePlugins } = await import('./lib/plugins');
      initializePlugins();

      // Start background scheduler
      const { backgroundScheduler } = await import('./lib/scheduler');
      backgroundScheduler.start();

      // Don't initialize Matrix client here - let it initialize lazily
      // This avoids the "multiple entrypoints" error with matrix-js-sdk
      console.log('[Instrumentation] Core services started (Matrix will initialize on first use)');
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize application:', error);
    }
  }
}
