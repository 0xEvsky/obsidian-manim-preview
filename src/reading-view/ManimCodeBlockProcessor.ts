import { App, MarkdownPostProcessorContext, MarkdownView, Plugin, TFile } from 'obsidian';
import { ManimExecutor } from '../execution/ManimExecutor';
import { ManimSettings, ManimResult } from '../types';

export class ManimCodeBlockProcessor {
  private app: App;
  private plugin: Plugin;
  private executor: ManimExecutor;
  private settings: ManimSettings;
  private activeViews: Map<string, HTMLVideoElement> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(app: App, plugin: Plugin, executor: ManimExecutor, settings: ManimSettings) {
    this.app = app;
    this.plugin = plugin;
    this.executor = executor;
    this.settings = settings;
  }

  updateSettings(settings: ManimSettings): void {
    this.settings = settings;
  }

  /**
   * Register the code block processor with Obsidian
   */
  register(): void {
    this.plugin.registerMarkdownCodeBlockProcessor('manim', async (source, el, ctx) => {
      await this.processCodeBlock(source, el, ctx);
    });
  }

  /**
   * Process a single manim code block
   */
  private async processCodeBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    // Create container for the preview
    const container = el.createDiv({ cls: 'manim-preview-container' });

    // Add render button
    const buttonContainer = container.createDiv({ cls: 'manim-preview-controls' });
    const renderButton = buttonContainer.createEl('button', {
      cls: 'manim-render-button',
      text: 'Render',
    });

    // Status area
    const statusEl = container.createDiv({ cls: 'manim-preview-status' });

    // Video container (initially hidden)
    const videoContainer = container.createDiv({ cls: 'manim-preview-video-container' });
    videoContainer.style.display = 'none';

    // Error container (initially hidden)
    const errorContainer = container.createDiv({ cls: 'manim-preview-error-container' });
    errorContainer.style.display = 'none';

    // Generate unique ID for this code block
    const blockId = this.generateBlockId(source, ctx);

    // Check for cached result
    const sourceHash = this.hashString(source);
    const cached = this.executor.getCached(sourceHash, undefined, this.settings.quality);

    if (cached && cached.videoPath) {
      this.showVideo(videoContainer, cached.videoPath, cached.sceneName);
      videoContainer.style.display = 'block';
      renderButton.textContent = 'Re-render';
    }

    // Handle render button click
    renderButton.addEventListener('click', async () => {
      await this.renderAndShow(
        source,
        videoContainer,
        statusEl,
        errorContainer,
        renderButton,
        blockId
      );
    });

    // Auto-render if enabled and no cached result
    if (this.settings.autoRender && (!cached || !cached.videoPath)) {
      this.debounceRender(
        source,
        videoContainer,
        statusEl,
        errorContainer,
        renderButton,
        blockId
      );
    }
  }

  /**
   * Render manim code and show result
   */
  private async renderAndShow(
    source: string,
    videoContainer: HTMLElement,
    statusEl: HTMLElement,
    errorContainer: HTMLElement,
    renderButton: HTMLButtonElement,
    blockId: string
  ): Promise<void> {
    // Show loading state
    renderButton.disabled = true;
    renderButton.textContent = 'Rendering...';
    statusEl.setText('Rendering animation...');
    statusEl.style.display = 'block';
    errorContainer.style.display = 'none';
    videoContainer.style.display = 'none';

    try {
      const result = await this.executor.execute({
        source,
        quality: this.settings.quality,
        outputDir: this.executor.getCacheDir(),
        timeoutMs: this.settings.renderTimeoutMs,
        manimPath: this.settings.manimPath,
        pythonPath: this.settings.pythonPath,
      });

      if (result.error) {
        this.showError(errorContainer, result.error);
        statusEl.style.display = 'none';
      } else if (result.videoPath) {
        this.showVideo(videoContainer, result.videoPath, result.sceneName);
        videoContainer.style.display = 'block';
        statusEl.style.display = 'none';
        renderButton.textContent = 'Re-render';
      }
    } catch (error: any) {
      this.showError(errorContainer, error.message);
      statusEl.style.display = 'none';
    } finally {
      renderButton.disabled = false;
    }
  }

  /**
   * Debounced auto-render
   */
  private debounceRender(
    source: string,
    videoContainer: HTMLElement,
    statusEl: HTMLElement,
    errorContainer: HTMLElement,
    renderButton: HTMLButtonElement,
    blockId: string
  ): void {
    // Clear existing timer for this block
    const existingTimer = this.debounceTimers.get(blockId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(blockId);
      this.renderAndShow(source, videoContainer, statusEl, errorContainer, renderButton, blockId);
    }, this.settings.debounceMs);

    this.debounceTimers.set(blockId, timer);
  }

  /**
   * Display video player
   */
  private showVideo(container: HTMLElement, videoPath: string, sceneName?: string): void {
    container.empty();

    // Convert absolute path to file:// URL for video element
    const videoUrl = `file://${videoPath.replace(/\\/g, '/')}`;

    const video = container.createEl('video', {
      cls: 'manim-preview-video',
      attr: {
        controls: true,
        src: videoUrl,
        style: `max-width: ${this.settings.previewWidth}px; width: 100%;`,
      },
    });

    // Add scene name label if available
    if (sceneName) {
      const label = container.createDiv({ cls: 'manim-preview-label' });
      label.setText(`Scene: ${sceneName}`);
    }
  }

  /**
   * Display error message
   */
  private showError(container: HTMLElement, error: string): void {
    container.empty();
    container.style.display = 'block';

    const errorTitle = container.createDiv({ cls: 'manim-error-title' });
    errorTitle.setText('Render Failed');

    const errorContent = container.createEl('pre', { cls: 'manim-error-content' });
    errorContent.setText(error);
  }

  /**
   * Generate a unique ID for a code block
   */
  private generateBlockId(source: string, ctx: MarkdownPostProcessorContext): string {
    const file = ctx.sourcePath || 'unknown';
    const line = ctx.getSectionInfo()?.lineStart || 0;
    return `${file}:${line}:${this.hashString(source).substring(0, 8)}`;
  }

  /**
   * Simple string hash
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Cleanup on unload
   */
  cleanup(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}