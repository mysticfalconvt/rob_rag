/**
 * Docker/Infrastructure monitoring plugin
 * Uses Portainer REST API to query container status, stats, logs, and ports.
 * All tools use hasCustomExecution (live API queries, no indexed storage).
 */

import {
  DataSourcePlugin,
  DataSourceCapabilities,
  MetadataField,
  QueryParams,
  ToolDefinition,
  ScanResult,
} from "../dataSourceRegistry";
import { SearchResult } from "../retrieval";
import prisma from "../prisma";

interface PortainerConfig {
  url: string;
  apiKey: string;
  endpointId: number;
}

export class DockerPlugin implements DataSourcePlugin {
  name = "docker";
  displayName = "Docker / Portainer";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: false,
    supportsSemanticSearch: false,
    supportsScanning: false,
    requiresAuthentication: true,
  };

  getMetadataSchema(): MetadataField[] {
    return [];
  }

  async queryByMetadata(_params: QueryParams): Promise<SearchResult[]> {
    return [];
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "list_containers",
        description:
          `List all Docker containers. By default shows running containers. Use status parameter to filter.`,
        parameters: [
          {
            name: "status",
            type: "string",
            required: false,
            description: 'Filter by status: "running", "stopped", or "all" (default: "running")',
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "get_container_details",
        description:
          `Get detailed info for a specific Docker container including ports, environment variables, mounts, and network settings.`,
        parameters: [
          {
            name: "name",
            type: "string",
            required: true,
            description: "Container name (or partial name) to look up",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "get_container_stats",
        description:
          `Get current CPU, memory, and network usage for a specific Docker container.`,
        parameters: [
          {
            name: "name",
            type: "string",
            required: true,
            description: "Container name (or partial name) to get stats for",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "get_container_logs",
        description:
          `Get recent log output from a Docker container. Useful for debugging or checking container health.`,
        parameters: [
          {
            name: "name",
            type: "string",
            required: true,
            description: "Container name (or partial name) to get logs for",
          },
          {
            name: "lines",
            type: "number",
            required: false,
            description: "Number of recent log lines to return (default: 50)",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "list_exposed_ports",
        description:
          `List all ports exposed by running Docker containers. Optionally check if a specific port is in use.`,
        parameters: [
          {
            name: "port",
            type: "number",
            required: false,
            description: "Specific port number to check. If omitted, lists all exposed ports.",
          },
        ],
        hasCustomExecution: true,
      },
    ];
  }

  async executeTool(toolName: string, params: QueryParams, _originalQuery?: string): Promise<string> {
    const config = await this.getConfig();
    if (!config) {
      return "Portainer is not configured. Add your Portainer URL and API key in Settings.";
    }

    try {
      switch (toolName) {
        case "list_containers":
          return await this.executeListContainers(config, params);
        case "get_container_details":
          return await this.executeGetContainerDetails(config, params);
        case "get_container_stats":
          return await this.executeGetContainerStats(config, params);
        case "get_container_logs":
          return await this.executeGetContainerLogs(config, params);
        case "list_exposed_ports":
          return await this.executeListExposedPorts(config, params);
        default:
          return `Unknown docker tool: ${toolName}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[DockerPlugin] Error executing ${toolName}:`, error);
      return `Error executing ${toolName}: ${errorMsg}`;
    }
  }

  async scan(_options?: any): Promise<ScanResult> {
    return { indexed: 0, deleted: 0 };
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.getConfig();
    return config !== null;
  }

  // --- Private helpers ---

  private async getConfig(): Promise<PortainerConfig | null> {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });

      if (
        settings?.portainerUrl &&
        settings?.portainerApiKey &&
        settings?.portainerEnabled
      ) {
        return {
          url: settings.portainerUrl,
          apiKey: settings.portainerApiKey,
          endpointId: settings.portainerEndpointId || 1,
        };
      }
    } catch (error) {
      console.error("[DockerPlugin] Error loading config:", error);
    }
    return null;
  }

  private async portainerFetch(config: PortainerConfig, path: string, options?: RequestInit): Promise<Response> {
    const url = `${config.url}/api/endpoints/${config.endpointId}/docker${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "X-API-Key": config.apiKey,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Portainer API error (${res.status}): ${body || res.statusText}`);
    }

    return res;
  }

  private getContainerName(container: any): string {
    // Docker container names start with "/" in the API
    const names = container.Names || [];
    return names.length > 0 ? names[0].replace(/^\//, "") : container.Id?.substring(0, 12) || "unknown";
  }

  private async findContainerByName(config: PortainerConfig, name: string): Promise<any> {
    const res = await this.portainerFetch(config, "/containers/json?all=true");
    const containers: any[] = await res.json();

    const lowerName = name.toLowerCase();
    const match = containers.find((c) => {
      const containerName = this.getContainerName(c).toLowerCase();
      return containerName === lowerName || containerName.includes(lowerName);
    });

    if (!match) {
      throw new Error(`Container "${name}" not found. Available containers: ${containers.map((c) => this.getContainerName(c)).join(", ")}`);
    }

    return match;
  }

  private async executeListContainers(config: PortainerConfig, params: QueryParams): Promise<string> {
    const status = (params.status || "running").toLowerCase();
    const showAll = status === "all" || status === "stopped";
    const queryParam = showAll ? "?all=true" : "";

    const res = await this.portainerFetch(config, `/containers/json${queryParam}`);
    const containers: any[] = await res.json();

    // Filter for stopped-only if requested
    const filtered = status === "stopped"
      ? containers.filter((c) => c.State !== "running")
      : containers;

    if (filtered.length === 0) {
      return `No ${status} containers found.`;
    }

    const formatted = filtered.map((c, i) => {
      const name = this.getContainerName(c);
      const image = c.Image || "unknown";
      const state = c.State || "unknown";
      const statusText = c.Status || "";
      const ports = (c.Ports || [])
        .filter((p: any) => p.PublicPort)
        .map((p: any) => `${p.PublicPort}->${p.PrivatePort}/${p.Type}`)
        .join(", ");

      let entry = `${i + 1}. **${name}** (${state})`;
      entry += `\n   Image: ${image}`;
      if (statusText) entry += `\n   Status: ${statusText}`;
      if (ports) entry += `\n   Ports: ${ports}`;
      return entry;
    }).join("\n\n");

    return `Found ${filtered.length} ${status} container(s):\n\n${formatted}`;
  }

  private async executeGetContainerDetails(config: PortainerConfig, params: QueryParams): Promise<string> {
    const container = await this.findContainerByName(config, params.name);
    const res = await this.portainerFetch(config, `/containers/${container.Id}/json`);
    const details: any = await res.json();

    const name = this.getContainerName(container);
    const state = details.State || {};
    const hostConfig = details.HostConfig || {};
    const networkSettings = details.NetworkSettings || {};

    let result = `**${name}** — Container Details\n\n`;

    // State
    result += `**State:** ${state.Status || "unknown"}`;
    if (state.StartedAt) result += ` (started: ${new Date(state.StartedAt).toLocaleString()})`;
    result += "\n";

    // Image
    result += `**Image:** ${details.Config?.Image || container.Image || "unknown"}\n`;

    // Ports
    const ports = networkSettings.Ports || {};
    const portMappings = Object.entries(ports)
      .filter(([_, bindings]: [string, any]) => bindings && bindings.length > 0)
      .map(([containerPort, bindings]: [string, any]) => {
        const hostPorts = bindings.map((b: any) => `${b.HostIp || "0.0.0.0"}:${b.HostPort}`).join(", ");
        return `${hostPorts} -> ${containerPort}`;
      });
    if (portMappings.length > 0) {
      result += `**Ports:**\n${portMappings.map((p) => `  - ${p}`).join("\n")}\n`;
    }

    // Mounts
    const mounts = details.Mounts || [];
    if (mounts.length > 0) {
      result += `**Mounts:**\n`;
      for (const m of mounts) {
        result += `  - ${m.Source || m.Name} -> ${m.Destination} (${m.Mode || "rw"})\n`;
      }
    }

    // Network
    const networks = networkSettings.Networks || {};
    const networkNames = Object.keys(networks);
    if (networkNames.length > 0) {
      result += `**Networks:** ${networkNames.join(", ")}\n`;
      for (const [netName, netConfig] of Object.entries(networks) as [string, any][]) {
        if (netConfig.IPAddress) {
          result += `  - ${netName}: ${netConfig.IPAddress}\n`;
        }
      }
    }

    // Resource limits
    const memLimit = hostConfig.Memory;
    const cpuShares = hostConfig.CpuShares;
    if (memLimit || cpuShares) {
      result += `**Resource Limits:**\n`;
      if (memLimit && memLimit > 0) result += `  - Memory: ${(memLimit / 1024 / 1024).toFixed(0)} MB\n`;
      if (cpuShares && cpuShares > 0) result += `  - CPU Shares: ${cpuShares}\n`;
    }

    // Restart policy
    const restartPolicy = hostConfig.RestartPolicy;
    if (restartPolicy?.Name) {
      result += `**Restart Policy:** ${restartPolicy.Name}\n`;
    }

    // Environment variables (filter out sensitive ones)
    const env = details.Config?.Env || [];
    const safeEnv = env.filter((e: string) => {
      const key = e.split("=")[0].toLowerCase();
      return !key.includes("password") && !key.includes("secret") && !key.includes("token") && !key.includes("key") && !key.includes("credential");
    });
    if (safeEnv.length > 0) {
      result += `**Environment (${safeEnv.length} vars, sensitive filtered):**\n`;
      for (const e of safeEnv.slice(0, 20)) {
        result += `  - ${e}\n`;
      }
      if (safeEnv.length > 20) {
        result += `  ... and ${safeEnv.length - 20} more\n`;
      }
    }

    return result;
  }

  private async executeGetContainerStats(config: PortainerConfig, params: QueryParams): Promise<string> {
    const container = await this.findContainerByName(config, params.name);
    const name = this.getContainerName(container);

    // stream=false gets a single snapshot instead of streaming
    const res = await this.portainerFetch(config, `/containers/${container.Id}/stats?stream=false`);
    const stats: any = await res.json();

    let result = `**${name}** — Resource Usage\n\n`;

    // CPU
    const cpuDelta = stats.cpu_stats?.cpu_usage?.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats?.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0);
    const numCpus = stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
    let cpuPercent = 0;
    if (systemDelta > 0 && cpuDelta > 0) {
      cpuPercent = (cpuDelta / systemDelta) * numCpus * 100;
    }
    result += `**CPU:** ${cpuPercent.toFixed(2)}% (${numCpus} core${numCpus > 1 ? "s" : ""} available)\n`;

    // Memory
    const memUsage = stats.memory_stats?.usage || 0;
    const memLimit = stats.memory_stats?.limit || 0;
    const memCache = stats.memory_stats?.stats?.cache || 0;
    const memActual = memUsage - memCache;
    const memPercent = memLimit > 0 ? (memActual / memLimit) * 100 : 0;
    result += `**Memory:** ${this.formatBytes(memActual)} / ${this.formatBytes(memLimit)} (${memPercent.toFixed(1)}%)\n`;

    // Network I/O
    const networks = stats.networks || {};
    let rxBytes = 0;
    let txBytes = 0;
    for (const net of Object.values(networks) as any[]) {
      rxBytes += net.rx_bytes || 0;
      txBytes += net.tx_bytes || 0;
    }
    result += `**Network:** RX ${this.formatBytes(rxBytes)} / TX ${this.formatBytes(txBytes)}\n`;

    // Block I/O
    const blkRead = (stats.blkio_stats?.io_service_bytes_recursive || [])
      .filter((s: any) => s.op === "read" || s.op === "Read")
      .reduce((sum: number, s: any) => sum + (s.value || 0), 0);
    const blkWrite = (stats.blkio_stats?.io_service_bytes_recursive || [])
      .filter((s: any) => s.op === "write" || s.op === "Write")
      .reduce((sum: number, s: any) => sum + (s.value || 0), 0);
    if (blkRead > 0 || blkWrite > 0) {
      result += `**Block I/O:** Read ${this.formatBytes(blkRead)} / Write ${this.formatBytes(blkWrite)}\n`;
    }

    // PIDs
    const pids = stats.pids_stats?.current;
    if (pids) {
      result += `**PIDs:** ${pids}\n`;
    }

    return result;
  }

  private async executeGetContainerLogs(config: PortainerConfig, params: QueryParams): Promise<string> {
    const container = await this.findContainerByName(config, params.name);
    const name = this.getContainerName(container);
    const lines = params.lines || 50;

    const res = await this.portainerFetch(
      config,
      `/containers/${container.Id}/logs?stdout=true&stderr=true&tail=${lines}&timestamps=true`
    );
    const rawLogs = await res.text();

    // Docker log output has 8-byte header per line (stream type + size), strip it
    const cleanLogs = this.stripDockerLogHeaders(rawLogs);

    if (!cleanLogs.trim()) {
      return `No recent logs for **${name}**.`;
    }

    return `**${name}** — Last ${lines} log lines:\n\n\`\`\`\n${cleanLogs}\n\`\`\``;
  }

  private async executeListExposedPorts(config: PortainerConfig, params: QueryParams): Promise<string> {
    const res = await this.portainerFetch(config, "/containers/json");
    const containers: any[] = await res.json();

    // Build port -> container mapping
    const portMap: { port: number; protocol: string; containerName: string; containerPort: number }[] = [];

    for (const c of containers) {
      const name = this.getContainerName(c);
      for (const p of c.Ports || []) {
        if (p.PublicPort) {
          portMap.push({
            port: p.PublicPort,
            protocol: p.Type || "tcp",
            containerName: name,
            containerPort: p.PrivatePort,
          });
        }
      }
    }

    // Sort by port number
    portMap.sort((a, b) => a.port - b.port);

    // If checking a specific port
    if (params.port) {
      const targetPort = Number(params.port);
      const matches = portMap.filter((p) => p.port === targetPort);
      if (matches.length === 0) {
        return `Port ${targetPort} is **free** — not in use by any running container.`;
      }
      const users = matches.map((m) => `**${m.containerName}** (${m.port}/${m.protocol} -> ${m.containerPort})`).join(", ");
      return `Port ${targetPort} is **in use** by: ${users}`;
    }

    // List all ports
    if (portMap.length === 0) {
      return "No ports are currently exposed by any running container.";
    }

    const formatted = portMap.map((p) =>
      `  - **${p.port}**/${p.protocol} -> ${p.containerName}:${p.containerPort}`
    ).join("\n");

    return `**Exposed Ports** (${portMap.length} total):\n\n${formatted}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  private stripDockerLogHeaders(raw: string): string {
    // Docker multiplexed stream has 8-byte headers before each frame.
    // The first byte is the stream type (1=stdout, 2=stderr), bytes 4-7 are frame size.
    // In text mode the headers show as garbage characters — strip them.
    return raw
      .split("\n")
      .map((line) => {
        // If the line starts with a stream header byte (0x01 or 0x02) followed by
        // 3 null-ish bytes, strip the first 8 chars
        if (line.length > 8 && (line.charCodeAt(0) === 1 || line.charCodeAt(0) === 2)) {
          return line.substring(8);
        }
        return line;
      })
      .join("\n")
      .trim();
  }
}

// Export singleton instance
export const dockerPlugin = new DockerPlugin();
