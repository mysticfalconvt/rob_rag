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

  console.log(`[ToolGenerator] Generated ${tools.length} tools from plugins`);
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
      func: async (params) => {
        console.log(`[Tool] Calling ${toolDef.name} with params:`, params);

        try {
          // Call the plugin's queryByMetadata method
          const results = await plugin.queryByMetadata(params);

          // Format results for LLM
          if (results.length === 0) {
            return JSON.stringify({
              success: true,
              message: "No results found matching the criteria.",
              count: 0,
            });
          }

          // Format the results into a readable context
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

          return JSON.stringify({
            success: true,
            message: `Found ${results.length} results.`,
            count: results.length,
            results: formattedResults,
            // Include raw results for potential further processing
            _rawResults: results.map((r) => ({
              fileName: r.metadata.fileName,
              content: r.content,
              metadata: r.metadata,
            })),
          });
        } catch (error) {
          console.error(
            `[Tool] Error executing ${toolDef.name}:`,
            error,
          );
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

  console.log(
    `[ToolGenerator] Generated ${tools.length} tools from ${configuredPlugins.length} configured plugins:`,
    configuredPlugins.map((p) => p.name),
  );

  return tools;
}
