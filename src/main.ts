import { App, Plugin, PluginSettingTab, TFile, WorkspaceLeaf } from 'obsidian';
import { ManimSettings, DEFAULT_SETTINGS } from './types';
import { SettingsManager } from './settings/Settings';
import { ManimSettingTab } from './settings/SettingsTab';
import { ManimExecutor } from './execution/ManimExecutor';
import { ManimCodeBlockProcessor } from './reading-view/ManimCodeBlockProcessor';

export class ManimPlugin extends Plugin {
  settingsManager!: SettingsManager;
  executor!: ManimExecutor;
  codeBlockProcessor!: ManimCodeBlockProcessor;

  async onload(): Promise<void> {
    console.log('Loading Manim Preview plugin');

    // Load styles
    this.loadStyles();

    // Initialize settings
    this.settingsManager = new SettingsManager(this);
    await this.settingsManager.load();

    // Initialize executor
    this.executor = new ManimExecutor(this.app, this.settingsManager.getAll());

    // Initialize code block processor
    this.codeBlockProcessor = new ManimCodeBlockProcessor(
      this.app,
      this,
      this.executor,
      this.settingsManager.getAll()
    );
    this.codeBlockProcessor.register();

    // Register settings tab
    this.addSettingTab(new ManimSettingTab(this.app, this));

    // Add commands
    this.addCommands();

    // Add keyboard shortcut for forcing render in Reading View
    this.registerDomEvent(document, 'keydown', this.handleKeyDown.bind(this));

    // Handle settings changes
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        // Layout changed - could refresh views if needed
      })
    );

    console.log('Manim Preview plugin loaded');
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Ctrl+Enter (or Cmd+Enter on Mac) to force render the nearest manim block
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const target = event.target as HTMLElement;
      // Check if we're in a manim code block or its preview
      const container = target.closest('.manim-preview-container');
      if (container) {
        const renderButton = container.querySelector('.manim-render-button') as HTMLButtonElement;
        if (renderButton && !renderButton.disabled) {
          event.preventDefault();
          renderButton.click();
        }
      }
    }
  }

  private loadStyles(): void {
    const styleEl = document.createElement('style');
    styleEl.textContent = `
/* Manim Preview Plugin Styles */

/* Container for manim preview */
.manim-preview-container {
  margin: 1rem 0;
  padding: 0.75rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
  transition: all 0.2s ease;
}

.manim-preview-container:hover {
  border-color: var(--background-modifier-border-hover);
}

/* Controls bar */
.manim-preview-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.manim-render-button {
  padding: 0.375rem 0.875rem;
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  background-color: var(--background-primary);
  color: var(--text-normal);
  cursor: pointer;
  transition: all 0.15s ease;
}

.manim-render-button:hover:not(:disabled) {
  background-color: var(--background-modifier-hover);
  border-color: var(--interactive-accent);
}

.manim-render-button:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}

.manim-render-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.manim-render-button.manim-rendering {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
}

/* Status message */
.manim-preview-status {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  display: none;
}

.manim-preview-status.manim-loading {
  display: block;
  color: var(--text-normal);
}

/* Video container */
.manim-preview-video-container {
  margin-top: 0.75rem;
  overflow-x: auto;
}

.manim-preview-video {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-s);
  background-color: var(--background-primary);
  box-shadow: var(--shadow-s);
}

/* Preview label */
.manim-preview-label {
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  display: inline-block;
}

/* Error container */
.manim-preview-error-container {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background-color: rgba(var(--color-red-rgb, 255, 0, 0), 0.1);
  border: 1px solid var(--color-red, #e03e3e);
  border-radius: var(--radius-s);
  display: none;
}

.manim-preview-error-container.manim-has-error {
  display: block;
}

.manim-error-title {
  font-weight: 600;
  color: var(--color-red, #e03e3e);
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.manim-error-content {
  margin: 0;
  padding: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-normal);
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-monospace);
}

/* Scene selector (for multiple scenes) */
.manim-scene-selector {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  background-color: var(--background-primary);
  color: var(--text-normal);
  cursor: pointer;
  min-width: 150px;
}

.manim-scene-selector:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}

/* Render hint */
.manim-render-hint {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin: auto 0;
  padding: 0 0.25rem;
}

/* Reading view specific adjustments */
.markdown-reading-view .manim-preview-container {
  margin: 1.5rem 0;
}

/* Live preview specific adjustments */
.cm-editor .manim-preview-container {
  margin: 0.75rem 0;
}

/* Dark mode adjustments */
.theme-dark .manim-preview-error-container {
  background-color: rgba(var(--color-red-rgb, 255, 0, 0), 0.15);
  border-color: var(--color-red, #f56565);
}

/* Animation for loading state */
@keyframes manim-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.manim-render-button.manim-rendering {
  animation: manim-pulse 1.5s ease-in-out infinite;
}

/* Scrollbar styling for error content */
.manim-error-content::-webkit-scrollbar {
  height: 6px;
}

.manim-error-content::-webkit-scrollbar-track {
  background: var(--background-secondary);
  border-radius: 3px;
}

.manim-error-content::-webkit-scrollbar-thumb {
  background: var(--background-modifier-border);
  border-radius: 3px;
}

.manim-error-content::-webkit-scrollbar-thumb:hover {
  background: var(--background-modifier-border-hover);
}

/* Print styles */
@media print {
  .manim-preview-controls,
  .manim-preview-status {
    display: none !important;
  }

  .manim-preview-video {
    max-width: 100%;
    page-break-inside: avoid;
  }
}
    `;
    document.head.appendChild(styleEl);
  }

  onunload(): void {
    console.log('Unloading Manim Preview plugin');
    this.codeBlockProcessor.cleanup();
    this.executor.cancelAllRenders();
  }

  private addCommands(): void {
    // Command to manually render all manim blocks in current note
    this.addCommand({
      id: 'render-all-manim-blocks',
      name: 'Render all Manim blocks in current note',
      editorCallback: (editor, view) => {
        this.renderAllBlocksInView(view);
      },
      hotkeys: [
        {
          modifiers: ['Mod', 'Shift'],
          key: 'm',
        },
      ],
    });

    // Command to clear cache
    this.addCommand({
      id: 'clear-manim-cache',
      name: 'Clear Manim render cache',
      callback: async () => {
        await this.executor.clearCache();
        new Notice('Manim cache cleared');
      },
    });

    // Command to open settings
    this.addCommand({
      id: 'open-manim-settings',
      name: 'Open Manim Preview settings',
      callback: () => {
        this.app.setting.openTabById('obsidian-manim-preview');
      },
    });
  }

  private async renderAllBlocksInView(view: any): void {
    if (!view || view.getViewType() !== 'markdown') {
      new Notice('Open a Markdown note to render Manim blocks');
      return;
    }

    const markdownView = view as any; // MarkdownView
    const editor = markdownView.editor;
    const content = editor.getValue();

    // Find all manim code blocks
    const blocks = this.findManimBlocks(content);

    if (blocks.length === 0) {
      new Notice('No Manim code blocks found in this note');
      return;
    }

    new Notice(`Found ${blocks.length} Manim block(s). Use the Render buttons below each block.`);
  }

  private findManimBlocks(content: string): Array<{ source: string; startLine: number; endLine: number }> {
    const blocks: Array<{ source: string; startLine: number; endLine: number }> = [];
    const lines = content.split('\n');
    let inManimBlock = false;
    let blockStart = 0;
    let blockLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```manim')) {
        inManimBlock = true;
        blockStart = i;
        blockLines = [];
      } else if (inManimBlock && trimmed === '```') {
        inManimBlock = false;
        blocks.push({
          source: blockLines.join('\n'),
          startLine: blockStart,
          endLine: i,
        });
      } else if (inManimBlock) {
        blockLines.push(line);
      }
    }

    return blocks;
  }
}