/**
 * Weather (read-only) plugin — Open-Meteo (free, no API key).
 * Geocodes a place name, then fetches current conditions / daily forecast.
 * All tools use hasCustomExecution (live API, nothing indexed).
 */

import type {
  DataSourceCapabilities,
  DataSourcePlugin,
  MetadataField,
  QueryParams,
  ScanResult,
  ToolDefinition,
} from "../dataSourceRegistry";
import prisma from "../prisma";
import type { SearchResult } from "../retrieval";

const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

interface WeatherConfig {
  defaultLocation: string | null;
  units: "imperial" | "metric";
}

// WMO weather interpretation codes → human text.
const WMO_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "slight snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "slight rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "slight snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with slight hail",
  99: "thunderstorm with heavy hail",
};

function describeCode(code: number): string {
  return WMO_CODES[code] ?? `code ${code}`;
}

// US state abbreviations → full names, for disambiguating "City, ST" queries
// (Open-Meteo geocoding matches on the city name and reports the full state).
const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

export class WeatherPlugin implements DataSourcePlugin {
  name = "weather";
  displayName = "Weather";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: false,
    supportsSemanticSearch: false,
    supportsScanning: false,
    requiresAuthentication: false,
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
        name: "weather_current",
        description:
          "Get current weather conditions for a location (temperature, feels-like, humidity, wind, conditions). Use for 'what's the weather' / 'is it raining'.",
        parameters: [
          {
            name: "location",
            type: "string",
            required: false,
            description:
              "City/place name (e.g. 'Burlington, VT') or a US ZIP code (e.g. '05401'). If omitted, uses the configured default location.",
          },
        ],
        hasCustomExecution: true,
      },
      {
        name: "weather_forecast",
        description:
          "Get a daily weather forecast for a location (high/low temps, chance of precipitation, conditions).",
        parameters: [
          {
            name: "location",
            type: "string",
            required: false,
            description:
              "City/place name or US ZIP code. If omitted, uses the configured default location.",
          },
          {
            name: "days",
            type: "number",
            required: false,
            description: "Number of days to forecast (default 3, max 7).",
          },
        ],
        hasCustomExecution: true,
      },
    ];
  }

  async executeTool(
    toolName: string,
    params: QueryParams,
    _originalQuery?: string,
  ): Promise<string> {
    const config = await this.getConfig();
    if (!config) {
      return "Weather is not enabled. Turn it on in Settings.";
    }

    try {
      switch (toolName) {
        case "weather_current":
          return await this.executeCurrent(config, params);
        case "weather_forecast":
          return await this.executeForecast(config, params);
        default:
          return `Unknown weather tool: ${toolName}`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[WeatherPlugin] Error executing ${toolName}:`, error);
      return `Error executing ${toolName}: ${errorMsg}`;
    }
  }

  async scan(_options?: any): Promise<ScanResult> {
    return { indexed: 0, deleted: 0 };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getConfig()) !== null;
  }

  // --- Private helpers ---

  private async getConfig(): Promise<WeatherConfig | null> {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });
      if (settings?.weatherEnabled) {
        return {
          defaultLocation: settings.weatherDefaultLocation || null,
          units: settings.weatherUnits === "metric" ? "metric" : "imperial",
        };
      }
    } catch (error) {
      console.error("[WeatherPlugin] Error loading config:", error);
    }
    return null;
  }

  private units(config: WeatherConfig) {
    return config.units === "metric"
      ? {
          temp: "celsius",
          wind: "kmh",
          precip: "mm",
          tUnit: "°C",
          wUnit: "km/h",
        }
      : {
          temp: "fahrenheit",
          wind: "mph",
          precip: "inch",
          tUnit: "°F",
          wUnit: "mph",
        };
  }

  private async resolveLocation(
    config: WeatherConfig,
    location?: string,
  ): Promise<
    { name: string; latitude: number; longitude: number } | { error: string }
  > {
    const query = (location || config.defaultLocation || "").trim();
    if (!query) {
      return {
        error:
          "No location given and no default location is configured. Ask which city or ZIP, or set a default in Settings.",
      };
    }

    // US ZIP code (5-digit, optional +4) → resolve via Zippopotam (reliable).
    const zip = query.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
    if (zip) {
      const byZip = await this.geocodeZip(zip[1]);
      if (byZip) return byZip;
      // fall through to name geocoding if the ZIP wasn't found
    }

    // Build (city, hint) candidates in priority order.
    const candidates: { city: string; hint: string }[] = [];
    if (query.includes(",")) {
      const [city, ...rest] = query.split(",");
      candidates.push({ city: city.trim(), hint: rest.join(",").trim() });
    }
    candidates.push({ city: query, hint: "" });
    const tokens = query.split(/\s+/);
    if (tokens.length > 1) {
      candidates.push({
        city: tokens.slice(0, -1).join(" "),
        hint: tokens[tokens.length - 1],
      });
      candidates.push({ city: tokens[0], hint: tokens.slice(1).join(" ") });
    }

    for (const cand of candidates) {
      const results = await this.geocodeName(cand.city);
      if (results.length > 0) {
        const hit = this.pickByHint(results, cand.hint);
        const label = [hit.name, hit.admin1, hit.country_code]
          .filter(Boolean)
          .join(", ");
        return {
          name: label,
          latitude: hit.latitude,
          longitude: hit.longitude,
        };
      }
    }

    return { error: `Could not find a location matching "${query}".` };
  }

  private async geocodeName(city: string): Promise<any[]> {
    const res = await fetch(
      `${GEOCODE_API}?name=${encodeURIComponent(city)}&count=5&language=en&format=json`,
    );
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = await res.json();
    return data?.results || [];
  }

  private async geocodeZip(
    zip: string,
  ): Promise<{ name: string; latitude: number; longitude: number } | null> {
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) return null;
      const data = await res.json();
      const place = data?.places?.[0];
      if (!place) return null;
      return {
        name: `${place["place name"]}, ${place["state abbreviation"]} ${zip}`,
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
      };
    } catch {
      return null;
    }
  }

  /** Pick the geocoding result best matching a region hint (state/country). */
  private pickByHint(results: any[], hint: string): any {
    if (!hint) return results[0];
    const tokens = hint
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (US_STATES[t.toUpperCase()] || t).toLowerCase());
    const match = results.find((r) => {
      const admin1 = (r.admin1 || "").toLowerCase();
      const cc = (r.country_code || "").toLowerCase();
      const country = (r.country || "").toLowerCase();
      return tokens.some(
        (n) =>
          admin1 === n ||
          admin1.includes(n) ||
          cc === n ||
          country.includes(n) ||
          (n === "usa" && cc === "us"),
      );
    });
    return match || results[0];
  }

  private async executeCurrent(
    config: WeatherConfig,
    params: QueryParams,
  ): Promise<string> {
    const loc = await this.resolveLocation(config, params.location);
    if ("error" in loc) return loc.error;
    const u = this.units(config);

    const url =
      `${FORECAST_API}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
      `&temperature_unit=${u.temp}&wind_speed_unit=${u.wind}&precipitation_unit=${u.precip}&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
    const data = await res.json();
    const c = data.current || {};

    return (
      `**Current weather — ${loc.name}**\n` +
      `- Conditions: ${describeCode(c.weather_code)}\n` +
      `- Temperature: ${c.temperature_2m}${u.tUnit} (feels like ${c.apparent_temperature}${u.tUnit})\n` +
      `- Humidity: ${c.relative_humidity_2m}%\n` +
      `- Wind: ${c.wind_speed_10m} ${u.wUnit}\n` +
      `- Precipitation: ${c.precipitation} ${u.precip}`
    );
  }

  private async executeForecast(
    config: WeatherConfig,
    params: QueryParams,
  ): Promise<string> {
    const loc = await this.resolveLocation(config, params.location);
    if ("error" in loc) return loc.error;
    const u = this.units(config);
    const days = Math.min(7, Math.max(1, Number(params.days) || 3));

    const url =
      `${FORECAST_API}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=${u.temp}&precipitation_unit=${u.precip}&timezone=auto&forecast_days=${days}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
    const data = await res.json();
    const d = data.daily || {};
    const dates: string[] = d.time || [];
    if (dates.length === 0) return `No forecast available for ${loc.name}.`;

    const lines = dates.map((date, i) => {
      const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString(
        undefined,
        {
          weekday: "short",
          month: "short",
          day: "numeric",
        },
      );
      return (
        `- **${dayLabel}**: ${describeCode(d.weather_code?.[i])}, ` +
        `high ${d.temperature_2m_max?.[i]}${u.tUnit} / low ${d.temperature_2m_min?.[i]}${u.tUnit}, ` +
        `${d.precipitation_probability_max?.[i] ?? 0}% chance of precip`
      );
    });

    return `**${days}-day forecast — ${loc.name}**\n${lines.join("\n")}`;
  }
}

export const weatherPlugin = new WeatherPlugin();
