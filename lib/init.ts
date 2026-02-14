/**
 * Application initialization
 * Call this to set up data source plugins and other startup tasks
 */

import { initializePlugins } from "./plugins";
import { backgroundScheduler } from "./scheduler";
import { matrixClient } from "./matrix/client";
import { initializeMessageHandler } from "./matrix/messageHandler";

let initialized = false;
let matrixInitialized = false;
let matrixInitializing = false;

/**
 * Initialize the application (core services only)
 * Safe to call multiple times - will only run once
 */
export function initializeApp(): void {
  if (initialized) {
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

  initialized = true;
  console.log("[Init] Application initialization complete (Matrix will initialize on first use)");
}

/**
 * Initialize Matrix client
 * Safe to call multiple times - will only run once
 */
export function initializeMatrix(): void {
  if (matrixInitialized || matrixInitializing || typeof window !== 'undefined') {
    if (matrixInitializing) {
      console.log("[Init] Matrix initialization already in progress, skipping");
    }
    return;
  }

  matrixInitializing = true;
  console.log("[Init] Initializing Matrix client...");

  // Initialize Matrix client (with delay for database readiness)
  setTimeout(async () => {
    try {
      await matrixClient.initialize();

      // Initialize message handler when client reaches PREPARED state
      matrixClient.onReady(() => {
        console.log("[Init] Matrix client is ready, initializing message handler...");
        initializeMessageHandler();
        matrixInitialized = true;
        matrixInitializing = false;
      });
    } catch (error) {
      console.error("[Init] Failed to initialize Matrix client:", error);
      matrixInitializing = false; // Allow retry
    }
  }, 5000); // 5 second delay
}

/**
 * Check if app has been initialized
 */
export function isInitialized(): boolean {
  return initialized;
}
