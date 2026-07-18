"use client";

import Card from "./Card";
import styles from "./PortainerConfiguration.module.css";

interface WeatherConfigurationProps {
  weatherDefaultLocation: string;
  weatherUnits: string;
  weatherEnabled: boolean;
  isTesting: boolean;
  isSaving: boolean;
  onDefaultLocationChange: (loc: string) => void;
  onUnitsChange: (units: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onTest: () => void;
  onSave: () => void;
}

export default function WeatherConfiguration({
  weatherDefaultLocation,
  weatherUnits,
  weatherEnabled,
  isTesting,
  isSaving,
  onDefaultLocationChange,
  onUnitsChange,
  onEnabledChange,
  onTest,
  onSave,
}: WeatherConfigurationProps) {
  return (
    <Card title="Weather Configuration">
      <div className={styles.formGroup}>
        <label htmlFor="weatherDefaultLocation">Default location</label>
        <input
          id="weatherDefaultLocation"
          type="text"
          value={weatherDefaultLocation}
          onChange={(e) => onDefaultLocationChange(e.target.value)}
          placeholder="Burlington, VT"
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Used when a weather question doesn't name a city. Leave blank to
          always require one. Powered by Open-Meteo — no API key needed.
        </small>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="weatherUnits">Units</label>
        <select
          id="weatherUnits"
          value={weatherUnits}
          onChange={(e) => onUnitsChange(e.target.value)}
          className={styles.input}
          disabled={isSaving}
        >
          <option value="imperial">Imperial (°F, mph)</option>
          <option value="metric">Metric (°C, km/h)</option>
        </select>
      </div>

      <div className={styles.formGroup}>
        <label>
          <input
            type="checkbox"
            checked={weatherEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={isSaving}
          />{" "}
          Enable Weather Integration
        </label>
      </div>

      <div className={styles.buttonGroup}>
        <button
          onClick={onTest}
          disabled={isTesting}
          className={styles.testButton}
          type="button"
        >
          {isTesting ? "Testing..." : "Test"}
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={styles.saveButton}
          type="button"
        >
          {isSaving ? "Saving..." : "Save Weather Settings"}
        </button>
      </div>
    </Card>
  );
}
