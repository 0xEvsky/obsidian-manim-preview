import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { ManimPlugin } from '../main';
import { ManimSettings } from '../types';

export class ManimSettingTab extends PluginSettingTab {
  plugin: ManimPlugin;

  constructor(app: App, plugin: ManimPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Manim Preview Settings' });

    // Python executable path
    new Setting(containerEl)
      .setName('Python Executable')
      .setDesc('Path to Python executable (e.g., python, python3, or full path)')
      .addText(text => text
        .setPlaceholder('python')
        .setValue(this.plugin.settingsManager.get('pythonPath'))
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('pythonPath', value);
        }));

    // Manim executable path
    new Setting(containerEl)
      .setName('Manim Executable')
      .setDesc('Path to manim executable (e.g., manim, or full path). Leave empty to use "python -m manim"')
      .addText(text => text
        .setPlaceholder('manim')
        .setValue(this.plugin.settingsManager.get('manimPath'))
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('manimPath', value);
        }));

    // Auto-render toggle
    new Setting(containerEl)
      .setName('Auto Render')
      .setDesc('Automatically render Manim code blocks when they change')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settingsManager.get('autoRender'))
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('autoRender', value);
        }));

    // Debounce delay
    new Setting(containerEl)
      .setName('Debounce Delay (ms)')
      .setDesc('Wait time after typing stops before triggering auto-render')
      .addSlider(slider => slider
        .setLimits(500, 5000, 100)
        .setValue(this.plugin.settingsManager.get('debounceMs'))
        .setDynamicTooltip()
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('debounceMs', value);
        }));

    // Quality setting
    new Setting(containerEl)
      .setName('Render Quality')
      .setDesc('Video quality for previews (low = faster, high = better quality)')
      .addDropdown(dropdown => dropdown
        .addOption('low', 'Low (480p, 15fps) - Fastest')
        .addOption('medium', 'Medium (720p, 30fps)')
        .addOption('high', 'High (1080p, 60fps)')
        .addOption('4k', '4K (60fps) - Slowest')
        .setValue(this.plugin.settingsManager.get('quality'))
        .onChange(async (value: ManimSettings['quality']) => {
          await this.plugin.settingsManager.set('quality', value);
        }));

    // Preview width
    new Setting(containerEl)
      .setName('Preview Width (px)')
      .setDesc('Maximum width of the video preview in pixels')
      .addSlider(slider => slider
        .setLimits(320, 1280, 40)
        .setValue(this.plugin.settingsManager.get('previewWidth'))
        .setDynamicTooltip()
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('previewWidth', value);
        }));

    // Cache directory
    new Setting(containerEl)
      .setName('Cache Directory')
      .setDesc('Relative path within vault for cached renders')
      .addText(text => text
        .setPlaceholder('.obsidian/plugins/obsidian-manim-preview/cache')
        .setValue(this.plugin.settingsManager.get('cacheDir'))
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('cacheDir', value);
        }));

    // Render timeout
    new Setting(containerEl)
      .setName('Render Timeout (ms)')
      .setDesc('Maximum time to wait for manim rendering')
      .addSlider(slider => slider
        .setLimits(30000, 600000, 10000)
        .setValue(this.plugin.settingsManager.get('renderTimeoutMs'))
        .setDynamicTooltip()
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('renderTimeoutMs', value);
        }));

    // Live Preview toggle (experimental)
    new Setting(containerEl)
      .setName('Live Preview (Experimental)')
      .setDesc('Show Manim previews in editing view (Live Preview). Requires reload.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settingsManager.get('livePreview'))
        .onChange(async (value) => {
          await this.plugin.settingsManager.set('livePreview', value);
          // Refresh Live Preview extension
          await this.plugin.refreshLivePreview();
        }));

    // Test configuration button
    new Setting(containerEl)
      .setName('Test Configuration')
      .setDesc('Verify Python and Manim are accessible')
      .addButton(button => button
        .setButtonText('Test')
        .setCta()
        .onClick(async () => {
          await this.testConfiguration();
        }));

    // Clear cache button
    new Setting(containerEl)
      .setName('Clear Cache')
      .setDesc('Remove all cached render files')
      .addButton(button => button
        .setButtonText('Clear')
        .setWarning()
        .onClick(async () => {
          await this.plugin.executor.clearCache();
          new Notice('Manim cache cleared');
        }));

    // Security notice
    containerEl.createEl('hr');
    const notice = containerEl.createEl('div', { cls: 'manim-security-notice' });
    notice.createEl('strong', { text: '⚠ Security Notice' });
    notice.createEl('p', {
      text: 'This plugin executes Python code locally with your user permissions. Only render code from trusted sources. The plugin does not execute code automatically on note open - you must explicitly trigger rendering or enable auto-render with awareness of the implications.'
    });
  }

  private async testConfiguration(): Promise<void> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const pythonPath = this.plugin.settingsManager.get('pythonPath');
    const manimPath = this.plugin.settingsManager.get('manimPath');

    try {
      // Test Python
      const pythonResult = await execFileAsync(pythonPath, ['--version'], { timeout: 5000 });
      new Notice(`Python: ${pythonResult.stdout.trim()}`);

      // Test Manim
      const manimCmd = manimPath || pythonPath;
      const manimArgs = manimPath ? ['--version'] : ['-m', 'manim', '--version'];
      const manimResult = await execFileAsync(manimCmd, manimArgs, { timeout: 10000 });
      new Notice(`Manim: ${manimResult.stdout.trim()}`);
    } catch (error: any) {
      new Notice(`Configuration test failed: ${error.message}`, 5000);
    }
  }
}