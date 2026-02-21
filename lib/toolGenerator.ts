import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { dataSourceRegistry, DataSourcePlugin } from "./dataSourceRegistry";

/**
 * Generate LangChain tools from all registered plugins
 */
export function generateToolsFromPlugins(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];

  for (const plugin of dataSourceRegistry.getAll()) {
    const pluginTools = generateToolsForPlugin(plugin);
    tools.push(...pluginTools);
  }

  return tools;
}

/**
 * Generate LangChain tools for a specific plugin
 */
function generateToolsForPlugin(
  plugin: DataSourcePlugin,
): DynamicStructuredTool[] {
  const toolDefs = plugin.getAvailableTools();

  return toolDefs.map((toolDef) => {
    // Build Zod schema from tool parameters
    const schemaFields: Record<string, z.ZodTypeAny> = {};

    for (const param of toolDef.parameters) {
      let field: z.ZodTypeAny;

      // Map parameter types to Zod types
      switch (param.type) {
        case "string":
          field = z.string().describe(param.description);
          break;
        case "number":
          field = z.number().describe(param.description);
          break;
        case "boolean":
          field = z.boolean().describe(param.description);
          break;
        case "array":
          field = z.array(z.string()).describe(param.description);
          break;
        default:
          field = z.any().describe(param.description);
      }

      // Make optional if not required
      if (!param.required) {
        field = field.optional();
      }

      schemaFields[param.name] = field;
    }

    const schema = z.object(schemaFields);

    // Create the tool
    return new DynamicStructuredTool({
      name: toolDef.name,
      description: toolDef.description,
      schema,
      func: async (params, config) => {
        try {
          // Check if this tool has custom execution
          if (toolDef.hasCustomExecution && plugin.executeTool) {
            // Extract original query and userId from config if available
            const originalQuery = (config as any)?.configurable?.originalQuery;
            const userId = (config as any)?.configurable?.userId;
            return await plugin.executeTool(toolDef.name, { ...params, userId }, originalQuery);
          }

          // Call the plugin's queryByMetadata method
          const results = await plugin.queryByMetadata(params);

          // Format results for LLM
          if (results.length === 0) {
            return `No results found matching the criteria. Count: 0`;
          }

          // For large result sets (>20), return compact format with just count and titles
          // For smaller sets, include full details
          const COMPACT_THRESHOLD = 20;

          if (results.length > COMPACT_THRESHOLD) {
            // Compact format: just count and list of titles
            const titleList = results
              .slice(0, 50) // Only show first 50 titles to save tokens
              .map((result, index) => {
                const metadata = result.metadata;
                let title = `${index + 1}. ${metadata.fileName || "Unknown"}`;

                if (plugin.name === "goodreads" && metadata.bookAuthor) {
                  title += ` by ${metadata.bookAuthor}`;
                }

                return title;
              })
              .join("\n");

            const preview =
              results.length > 50
                ? `\n\n(Showing first 50 of ${results.length} results)`
                : "";

            return `ACCURATE DATABASE COUNT: ${results.length} matching results.\n\nSample titles:${preview}\n${titleList}`;
          }

          // Detailed format for smaller result sets
          const formattedResults = results
            .map((result, index) => {
              const metadata = result.metadata;
              let entry = `[${index + 1}] ${metadata.fileName || "Unknown"}`;

              // Add source-specific metadata formatting
              if (plugin.name === "goodreads") {
                if (metadata.userRating) {
                  entry += ` - Rating: ${metadata.userRating}/5`;
                }
                if (metadata.bookAuthor) {
                  entry += ` by ${metadata.bookAuthor}`;
                }
                if (metadata.dateRead) {
                  const date = new Date(metadata.dateRead);
                  entry += ` (read ${date.toLocaleDateString()})`;
                }
              } else if (plugin.name === "paperless") {
                if (metadata.correspondent) {
                  entry += ` - From: ${metadata.correspondent}`;
                }
                if (metadata.tags) {
                  entry += ` - Tags: ${metadata.tags}`;
                }
                if (metadata.documentDate) {
                  const date = new Date(metadata.documentDate);
                  entry += ` (${date.toLocaleDateString()})`;
                }
              } else if (plugin.name === "files") {
                if (metadata.fileType) {
                  entry += ` (${metadata.fileType})`;
                }
                if (metadata.source) {
                  entry += ` - Source: ${metadata.source}`;
                }
              }

              // Add content preview (first 150 chars)
              const preview =
                result.content.length > 150
                  ? result.content.substring(0, 150) + "..."
                  : result.content;
              entry += `\nContent: ${preview}`;

              return entry;
            })
            .join("\n\n");

          // Return a simple, clear format emphasizing the count
          return `Found ${results.length} matching results.\n\n${formattedResults}`;
        } catch (error) {
          return JSON.stringify({
            success: false,
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
            message: "Failed to execute metadata query.",
          });
        }
      },
    });
  });
}

/**
 * Get tools for configured plugins only
 */
export async function generateToolsForConfiguredPlugins(): Promise<
  DynamicStructuredTool[]
> {
  const configuredPlugins = await dataSourceRegistry.getConfiguredPlugins();

  const tools: DynamicStructuredTool[] = [];

  for (const plugin of configuredPlugins) {
    const pluginTools = generateToolsForPlugin(plugin);
    tools.push(...pluginTools);
  }

  return tools;
}
