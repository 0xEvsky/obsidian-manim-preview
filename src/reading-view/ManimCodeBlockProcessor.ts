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

    // Format selector
    const formatSelector = buttonContainer.createEl('select', { cls: 'manim-format-selector' });
    const formats = [
      { value: 'mp4', label: 'MP4' },
      { value: 'gif', label: 'GIF' },
      { value: 'png', label: 'PNG (last frame)' },
      { value: 'webm', label: 'WebM' },
    ];
    for (const fmt of formats) {
      const option = formatSelector.createEl('option', { value: fmt.value, text: fmt.label });
      if (fmt.value === this.settings.format) {
        option.selected = true;
      }
    }

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
    const cached = this.executor.getCached(sourceHash, initialScene, this.settings.quality, this.settings.format);

    if (cached && cached.videoPath) {
      await this.showVideo(videoContainer, cached.videoPath, cached.sceneName);
      videoContainer.style.display = 'block';
      renderButton.textContent = 'Re-render';
    }

    // Handle format selector change
    formatSelector.addEventListener('change', () => {
      // Clear video since format changed
      videoContainer.style.display = 'none';
      videoContainer.empty();
      renderButton.textContent = 'Render';
    });

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
      const formatToRender = formatSelector.value;
      await this.renderAndShow(
        source,
        videoContainer,
        statusEl,
        errorContainer,
        renderButton,
        blockId,
        sceneToRender,
        formatToRender
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
    sceneName?: string,
    format?: string
  ): Promise<void> {
    // Get the parent container (the manim-preview-container)
    const parentContainer = renderButton.closest('.manim-preview-container');

    // Create progress indicator
    const progressContainer = parentContainer!.createDiv({ cls: 'manim-progress-container' });
    progressContainer.style.display = 'none';
    progressContainer.style.marginTop = '0.5rem';
    const progressBar = progressContainer.createDiv({ cls: 'manim-progress-bar' });
    progressBar.style.cssText = 'height: 4px; background: var(--background-modifier-border); border-radius: 2px; overflow: hidden;';
    const progressFill = progressBar.createDiv({ cls: 'manim-progress-fill' });
    progressFill.style.cssText = 'height: 100%; width: 0%; background: var(--interactive-accent); transition: width 0.3s ease;';
    const progressText = progressContainer.createDiv({ cls: 'manim-progress-text' });
    progressText.style.cssText = 'font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; text-align: right;';

    // Show loading state
    renderButton.disabled = true;
    renderButton.textContent = 'Rendering...';
    renderButton.classList.add('manim-rendering');
    statusEl.setText(sceneName ? `Rendering "${sceneName}"...` : 'Rendering animation...');
    statusEl.style.display = 'block';
    errorContainer.style.display = 'none';
    videoContainer.style.display = 'none';
    progressContainer.style.display = 'block';

    try {
      const result = await this.executor.execute({
        source,
        sceneName,
        quality: this.settings.quality,
        outputDir: this.executor.getCacheDir(),
        timeoutMs: this.settings.renderTimeoutMs,
        manimPath: this.settings.manimPath,
        pythonPath: this.settings.pythonPath,
        format: format as any,
        saveLastFrame: this.settings.saveLastFrame,
        transparent: this.settings.transparent,
        onProgress: (progress: number, message: string) => {
          progressFill.style.width = `${progress}%`;
          progressText.setText(message);
        },
      });

      if (result.error) {
        this.showError(errorContainer, result.error);
        statusEl.style.display = 'none';
      } else if (result.videoPath) {
        await this.showVideo(videoContainer, result.videoPath, result.sceneName);
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
      progressContainer.style.display = 'none';
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
      this.renderAndShow(source, videoContainer, statusEl, errorContainer, renderButton, blockId, sceneName, this.settings.format);
    }, this.settings.debounceMs);

    this.debounceTimers.set(blockId, timer);
  }

  /**
   * Display video/image player based on format
   */
  private async showVideo(container: HTMLElement, videoPath: string, sceneName?: string): Promise<void> {
    container.empty();

    const ext = videoPath.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'gif' ? 'image/gif' : ext === 'png' ? 'image/png' : ext === 'webm' ? 'video/webm' : 'video/mp4';
    const isImage = ext === 'gif' || ext === 'png';

    // Read file via vault adapter
    const adapter = this.app.vault.adapter;
    let mediaUrl: string;
    try {
      const arrayBuffer = await adapter.readBinary(videoPath);
      const blob = new Blob([arrayBuffer], { type: mimeType });

      if (isImage) {
        // For images (GIF/PNG), use data URL to avoid CSP issues (img-src doesn't allow blob:)
        const base64 = this.arrayBufferToBase64(arrayBuffer);
        mediaUrl = `data:${mimeType};base64,${base64}`;
      } else {
        // For videos (MP4/WebM), blob URL works fine with video elements
        mediaUrl = URL.createObjectURL(blob);
      }
    } catch (error) {
      console.error('Failed to read video file:', error);
      const errorEl = container.createDiv({ cls: 'manim-preview-error-container' });
      errorEl.setText('Failed to load video');
      return;
    }

    if (ext === 'gif') {
      const img = container.createEl('img', {
        cls: 'manim-preview-video',
        attr: {
          src: mediaUrl,
          style: `max-width: ${this.settings.previewWidth}px; width: 100%;`,
          alt: `Manim animation: ${sceneName || 'scene'}`,
        },
      });
      img.setAttribute('controls', 'false');
    } else if (ext === 'png') {
      const img = container.createEl('img', {
        cls: 'manim-preview-video',
        attr: {
          src: mediaUrl,
          style: `max-width: ${this.settings.previewWidth}px; width: 100%;`,
          alt: `Manim frame: ${sceneName || 'scene'}`,
        },
      });
      img.setAttribute('controls', 'false');
    } else {
      // Video formats (mp4, webm)
      const video = container.createEl('video', {
        cls: 'manim-preview-video',
        attr: {
          controls: true,
          src: mediaUrl,
          style: `max-width: ${this.settings.previewWidth}px; width: 100%;`,
        },
      });
      // Clean up blob URL when video element is removed
      video.addEventListener('remove', () => URL.revokeObjectURL(mediaUrl), { once: true });
    }

    // Add scene name label if available
    if (sceneName) {
      const label = container.createDiv({ cls: 'manim-preview-label' });
      label.setText(`Scene: ${sceneName}`);
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
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
    // getSectionInfo requires an element, but we don't have one here
    // Use lineStart from section info if available, otherwise 0
    const sectionInfo = ctx.getSectionInfo(document.body);
    const line = sectionInfo?.lineStart || 0;
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