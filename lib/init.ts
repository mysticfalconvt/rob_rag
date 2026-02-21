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
    // Re-register plugins on each call to handle hot reload adding new ones
    initializePlugins();
    return;
  }

  console.log("[Init] Starting application...");
  initializePlugins();

  if (typeof window === 'undefined') {
    backgroundScheduler.start();
  }

  globalInit.__robrag_init = true;
}

/**
 * Initialize Matrix client
 * Safe to call multiple times - will only run once
 */
export function initializeMatrix(): void {
  if (globalInit.__robrag_matrixInit || globalInit.__robrag_matrixInitializing || typeof window !== 'undefined') {
    return;
  }

  globalInit.__robrag_matrixInitializing = true;

  setTimeout(async () => {
    try {
      await matrixClient.initialize();

      matrixClient.onReady(() => {
        console.log("[Init] Matrix ready");
        initializeMessageHandler();
        globalInit.__robrag_matrixInit = true;
        globalInit.__robrag_matrixInitializing = false;
      });
    } catch (error) {
      console.error("[Init] Matrix failed:", error);
      globalInit.__robrag_matrixInitializing = false;
    }
  }, 5000);
}

/**
 * Check if app has been initialized
 */
export function isInitialized(): boolean {
  return globalInit.__robrag_init;
}
