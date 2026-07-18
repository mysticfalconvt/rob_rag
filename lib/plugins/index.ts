/**
 * Plugin registration and initialization
 * Import and register all data source plugins here
 */

import { dataSourceRegistry } from "../dataSourceRegistry";
import { calendarPlugin } from "./calendarPlugin";
import { dockerPlugin } from "./dockerPlugin";
import { emailPlugin } from "./emailPlugin";
import { filesPlugin } from "./filesPlugin";
import { githubPlugin } from "./githubPlugin";
import { goodreadsPlugin } from "./goodreadsPlugin";
import { paperlessPlugin } from "./paperlessPlugin";
import { todoPlugin } from "./todoPlugin";
import { weatherPlugin } from "./weatherPlugin";

/**
 * Initialize all plugins
 * Call this on app startup to register all available data sources
 */
const ALL_PLUGINS = [
  goodreadsPlugin,
  paperlessPlugin,
  filesPlugin,
  calendarPlugin,
  emailPlugin,
  dockerPlugin,
  githubPlugin,
  todoPlugin,
  weatherPlugin,
];
let pluginsLogged = false;

export function initializePlugins(): void {
  for (const plugin of ALL_PLUGINS) {
    dataSourceRegistry.register(plugin);
  }

  if (!pluginsLogged) {
    console.log(
      `[Plugins] ${dataSourceRegistry.getAll().length} plugins: ${dataSourceRegistry
        .getAll()
        .map((p) => p.name)
        .join(", ")}`,
    );
    pluginsLogged = true;
  }
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
export {
  goodreadsPlugin,
  paperlessPlugin,
  filesPlugin,
  calendarPlugin,
  emailPlugin,
  dockerPlugin,
  githubPlugin,
  todoPlugin,
  weatherPlugin,
};
