/**
 * Application initialization
 * Call this to set up data source plugins and other startup tasks
 */

import { initializePlugins } from "./plugins";
import { backgroundScheduler } from "./scheduler";

let initialized = false;

/**
 * Initialize the application
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
  console.log("[Init] Application initialization complete");
}

/**
 * Check if app has been initialized
 */
export function isInitialized(): boolean {
  return initialized;
}
