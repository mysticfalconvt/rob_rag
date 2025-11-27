import { SearchResult } from "./retrieval";

/**
 * Metadata field definition for a data source
 */
export interface MetadataField {
  name: string;
  displayName: string;
  type: "string" | "number" | "date" | "boolean" | "array";
  queryable: boolean; // Can this field be used in metadata queries?
  filterable: boolean; // Can this field be used for filtering?
  description?: string;
}

/**
 * Query parameters for metadata-based searches
 */
export interface QueryParams {
  [key: string]: any;
}

/**
 * Tool definition for LangChain function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
}

/**
 * Result from scanning/indexing a data source
 */
export interface ScanResult {
  indexed: number;
  updated?: number;
  deleted: number;
  errors?: string[];
}

/**
 * Data source plugin capabilities
 */
export interface DataSourceCapabilities {
  supportsMetadataQuery: boolean; // Can query by structured metadata
  supportsSemanticSearch: boolean; // Can do vector/semantic search
  supportsScanning: boolean; // Can scan/re-index data
  requiresAuthentication: boolean; // Needs credentials/config
}

/**
 * Main plugin interface that all data sources must implement
 */
export interface DataSourcePlugin {
  /** Unique identifier for this source (e.g., "goodreads", "paperless") */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /** Plugin capabilities */
  capabilities: DataSourceCapabilities;

  /**
   * Get the metadata schema for this source
   * Defines what fields are available and queryable
   */
  getMetadataSchema(): MetadataField[];

  /**
   * Query this source by metadata filters
   * Only called if supportsMetadataQuery is true
   */
  queryByMetadata(params: QueryParams): Promise<SearchResult[]>;

  /**
   * Get available LangChain tools for this source
   * Returns tool definitions that can be auto-generated for function calling
   */
  getAvailableTools(): ToolDefinition[];

  /**
   * Scan and index data from this source
   * Only called if supportsScanning is true
   */
  scan(options?: any): Promise<ScanResult>;

  /**
   * Check if this plugin is properly configured and ready to use
   */
  isConfigured(): Promise<boolean>;
}

/**
 * Registry for managing data source plugins
 */
class DataSourceRegistry {
  private plugins: Map<string, DataSourcePlugin> = new Map();

  /**
   * Register a new data source plugin
   */
  register(plugin: DataSourcePlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(
        `[DataSourceRegistry] Plugin '${plugin.name}' is already registered, overwriting`,
      );
    }
    this.plugins.set(plugin.name, plugin);
    console.log(`[DataSourceRegistry] Registered plugin: ${plugin.name}`);
  }

  /**
   * Get a plugin by name
   */
  get(name: string): DataSourcePlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   */
  getAll(): DataSourcePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all plugins that support metadata queries
   */
  getMetadataQueryablePlugins(): DataSourcePlugin[] {
    return this.getAll().filter((p) => p.capabilities.supportsMetadataQuery);
  }

  /**
   * Get all plugins that support semantic search
   */
  getSemanticSearchPlugins(): DataSourcePlugin[] {
    return this.getAll().filter((p) => p.capabilities.supportsSemanticSearch);
  }

  /**
   * Get all available metadata fields across all plugins
   */
  getAllMetadataFields(): Map<string, MetadataField[]> {
    const fields = new Map<string, MetadataField[]>();
    for (const plugin of this.getAll()) {
      fields.set(plugin.name, plugin.getMetadataSchema());
    }
    return fields;
  }

  /**
   * Get all available tools across all plugins
   */
  getAllTools(): Map<string, ToolDefinition[]> {
    const tools = new Map<string, ToolDefinition[]>();
    for (const plugin of this.getAll()) {
      const pluginTools = plugin.getAvailableTools();
      if (pluginTools.length > 0) {
        tools.set(plugin.name, pluginTools);
      }
    }
    return tools;
  }

  /**
   * Check which plugins are configured and ready
   */
  async getConfiguredPlugins(): Promise<DataSourcePlugin[]> {
    const configured: DataSourcePlugin[] = [];
    for (const plugin of this.getAll()) {
      if (await plugin.isConfigured()) {
        configured.push(plugin);
      }
    }
    return configured;
  }
}

// Singleton registry instance
export const dataSourceRegistry = new DataSourceRegistry();

/**
 * Helper to check if a source name is a registered plugin
 */
export function isRegisteredSource(sourceName: string): boolean {
  return dataSourceRegistry.get(sourceName) !== undefined;
}

/**
 * Helper to get plugin for a source, with fallback
 */
export function getSourcePlugin(
  sourceName: string,
): DataSourcePlugin | undefined {
  return dataSourceRegistry.get(sourceName);
}
