/**
 * Plugin registration and initialization
 * Import and register all data source plugins here
 */

import { dataSourceRegistry } from "../dataSourceRegistry";
import { goodreadsPlugin } from "./goodreadsPlugin";
import { paperlessPlugin } from "./paperlessPlugin";
import { filesPlugin } from "./filesPlugin";
import { calendarPlugin } from "./calendarPlugin";

/**
 * Initialize all plugins
 * Call this on app startup to register all available data sources
 */
export function initializePlugins(): void {
  console.log("[Plugins] Initializing data source plugins...");

  // Register all plugins
  dataSourceRegistry.register(goodreadsPlugin);
  dataSourceRegistry.register(paperlessPlugin);
  dataSourceRegistry.register(filesPlugin);
  dataSourceRegistry.register(calendarPlugin);

  console.log(
    `[Plugins] Registered ${dataSourceRegistry.getAll().length} plugins:`,
    dataSourceRegistry.getAll().map((p) => p.name),
  );
}

/**
 * Get all registered plugins
 */
export function getAllPlugins() {
  return dataSourceRegistry.getAll();
}

/**
 * Get a specific plugin by name
 */
export function getPlugin(name: string) {
  return dataSourceRegistry.get(name);
}

// Export registry for direct access
export { dataSourceRegistry };

// Export individual plugins for direct import
export { goodreadsPlugin, paperlessPlugin, filesPlugin, calendarPlugin };
