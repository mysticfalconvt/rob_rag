/**
 * Application initialization
 * Call this to set up data source plugins and other startup tasks
 */

import { initializePlugins } from "./plugins";
import { backgroundScheduler } from "./scheduler";
import { matrixClient } from "./matrix/client";
import { initializeMessageHandler } from "./matrix/messageHandler";

// Use globalThis to survive across Next.js module instances (instrumentation vs API routes)
const globalInit = globalThis as any;
if (globalInit.__robrag_init === undefined) globalInit.__robrag_init = false;
if (globalInit.__robrag_matrixInit === undefined) globalInit.__robrag_matrixInit = false;
if (globalInit.__robrag_matrixInitializing === undefined) globalInit.__robrag_matrixInitializing = false;

/**
 * Initialize the application (core services only)
 * Safe to call multiple times - will only run once
 */
export function initializeApp(): void {
  if (globalInit.__robrag_init) {
    return;
  }

  console.log("[Init] Initializing application...");

  // Initialize data source plugins
  initializePlugins();

  // Start background scheduler
  if (typeof window === 'undefined') {
    // Server-side only
    backgroundScheduler.start();
  }

  globalInit.__robrag_init = true;
  console.log("[Init] Application initialization complete (Matrix will initialize on first use)");
}

/**
 * Initialize Matrix client
 * Safe to call multiple times - will only run once
 */
export function initializeMatrix(): void {
  if (globalInit.__robrag_matrixInit || globalInit.__robrag_matrixInitializing || typeof window !== 'undefined') {
    if (globalInit.__robrag_matrixInitializing) {
      console.log("[Init] Matrix initialization already in progress, skipping");
    }
    return;
  }

  globalInit.__robrag_matrixInitializing = true;
  console.log("[Init] Initializing Matrix client...");

  // Initialize Matrix client (with delay for database readiness)
  setTimeout(async () => {
    try {
      await matrixClient.initialize();

      // Initialize message handler when client reaches PREPARED state
      matrixClient.onReady(() => {
        console.log("[Init] Matrix client is ready, initializing message handler...");
        initializeMessageHandler();
        globalInit.__robrag_matrixInit = true;
        globalInit.__robrag_matrixInitializing = false;
      });
    } catch (error) {
      console.error("[Init] Failed to initialize Matrix client:", error);
      globalInit.__robrag_matrixInitializing = false; // Allow retry
    }
  }, 5000); // 5 second delay
}

/**
 * Check if app has been initialized
 */
export function isInitialized(): boolean {
  return globalInit.__robrag_init;
}
