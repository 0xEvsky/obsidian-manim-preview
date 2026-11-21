import { App, MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { ManimExecutor } from '../execution/ManimExecutor';
import { ManimSettings, ManimResult } from '../types';

export class ManimCodeBlockProcessor {
  private app: App;
  private plugin: Plugin;
  private executor: ManimExecutor;
  private settings: ManimSettings;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private currentSceneSelections: Map<string, string> = new Map(); // blockId -> selected scene

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

    // Extract scene info from source
    const sceneInfo = this.extractSceneInfo(source);
    const scenes = sceneInfo.scenes;
    const preferredScene = sceneInfo.preferredScene;

    // Add controls bar
    const buttonContainer = container.createDiv({ cls: 'manim-preview-controls' });

    // Scene selector (if multiple scenes)
    let sceneSelector: HTMLSelectElement | null = null;
    if (scenes.length > 1) {
      sceneSelector = buttonContainer.createEl('select', { cls: 'manim-scene-selector' });
      for (const scene of scenes) {
        const option = sceneSelector.createEl('option', { value: scene, text: scene });
        if (scene === preferredScene) {
          option.selected = true;
        }
      }
    }

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

    // Restore previous scene selection for this block
    const savedScene = this.currentSceneSelections.get(blockId);
    const initialScene = savedScene || preferredScene || scenes[0];

    // Check for cached result
    const sourceHash = this.hashString(source);
    const cached = this.executor.getCached(sourceHash, initialScene, this.settings.quality);

    if (cached && cached.videoPath) {
      this.showVideo(videoContainer, cached.videoPath, cached.sceneName);
      videoContainer.style.display = 'block';
      renderButton.textContent = 'Re-render';
    }

    // Handle scene selector change
    if (sceneSelector) {
      sceneSelector.addEventListener('change', () => {
        this.currentSceneSelections.set(blockId, sceneSelector!.value);
        // Clear video since scene changed
        videoContainer.style.display = 'none';
        videoContainer.empty();
        renderButton.textContent = 'Render';
      });
    }

    // Handle render button click
    renderButton.addEventListener('click', async () => {
      const sceneToRender = sceneSelector?.value || initialScene;
      await this.renderAndShow(
        source,
        videoContainer,
        statusEl,
        errorContainer,
        renderButton,
        blockId,
        sceneToRender
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
        blockId,
        initialScene
      );
    }

    // Add keyboard shortcut hint
    if (this.settings.autoRender) {
      const hint = buttonContainer.createDiv({ cls: 'manim-render-hint' });
      hint.setText('Auto-renders on pause (Ctrl+Enter to force)');
    }
  }

  /**
   * Extract scene information from source code
   */
  private extractSceneInfo(source: string): { scenes: string[]; preferredScene?: string } {
    const scenes: string[] = [];
    let preferredScene: string | undefined;

    const lines = source.split('\n');

    for (const line of lines) {
      // Check for scene preference comment: # scene: SceneName
      const sceneCommentMatch = line.match(/^\s*#\s*scene\s*:\s*(\w+)/i);
      if (sceneCommentMatch) {
        preferredScene = sceneCommentMatch[1];
      }

      // Match class definitions that inherit from Scene
      const classMatch = line.match(/^\s*class\s+(\w+)\s*\(\s*(?:Scene|.*Scene)\s*\)/);
      if (classMatch) {
        scenes.push(classMatch[1]);
      }
    }

    return { scenes, preferredScene };
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
    blockId: string,
    sceneName?: string
  ): Promise<void> {
    // Show loading state
    renderButton.disabled = true;
    renderButton.textContent = 'Rendering...';
    renderButton.classList.add('manim-rendering');
    statusEl.setText(sceneName ? `Rendering "${sceneName}"...` : 'Rendering animation...');
    statusEl.style.display = 'block';
    errorContainer.style.display = 'none';
    videoContainer.style.display = 'none';

    try {
      const result = await this.executor.execute({
        source,
        sceneName,
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
      renderButton.classList.remove('manim-rendering');
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
    blockId: string,
    sceneName?: string
  ): void {
    // Clear existing timer for this block
    const existingTimer = this.debounceTimers.get(blockId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(blockId);
      this.renderAndShow(source, videoContainer, statusEl, errorContainer, renderButton, blockId, sceneName);
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
    this.currentSceneSelections.clear();
  }
}