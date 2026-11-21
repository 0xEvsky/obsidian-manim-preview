import { Plugin } from 'obsidian';
import { ManimSettings, DEFAULT_SETTINGS } from '../types';

export class SettingsManager {
  private plugin: Plugin;
  private settings: ManimSettings;
  private changeCallbacks: (() => void)[] = [];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load(): Promise<ManimSettings> {
    const loaded = await this.plugin.loadData();
    if (loaded) {
      this.settings = { ...DEFAULT_SETTINGS, ...loaded };
    }
    return this.settings;
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.settings);
    this.notifyChange();
  }

  getAll(): ManimSettings {
    return { ...this.settings };
  }

  get<K extends keyof ManimSettings>(key: K): ManimSettings[K] {
    return this.settings[key];
  }

  async set<K extends keyof ManimSettings>(key: K, value: ManimSettings[K]): Promise<void> {
    this.settings[key] = value;
    await this.save();
  }

  async update(partial: Partial<ManimSettings>): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.save();
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  onChange(callback: () => void): () => void {
    this.changeCallbacks.push(callback);
    return () => {
      const idx = this.changeCallbacks.indexOf(callback);
      if (idx >= 0) this.changeCallbacks.splice(idx, 1);
    };
  }

  private notifyChange(): void {
    for (const cb of this.changeCallbacks) {
      try { cb(); } catch { /* ignore */ }
    }
  }
}