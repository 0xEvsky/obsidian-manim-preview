import { ViewPlugin, EditorView, Decoration, DecorationSet, ViewUpdate, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { ManimExecutor } from '../execution/ManimExecutor';
import { ManimSettings, ManimResult } from '../types';

interface ManimBlockInfo {
  blockId: string;
  source: string;
  from: number;
  to: number;
  scenes: string[];
  preferredScene?: string;
  currentScene: string;
  currentFormat: string;
  cachedResult?: ManimResult;
  isRendering: boolean;
}

/**
 * Widget for displaying Manim preview in Live Preview
 */
class ManimLiveWidget extends WidgetType {
  private blockInfo: ManimBlockInfo;
  private settings: ManimSettings;
  private executor: ManimExecutor;
  private triggerRender: (blockId: string, sceneName: string, format: string) => void;
  private onSceneChange: (blockId: string, sceneName: string) => void;
  private onFormatChange: (blockId: string, format: string) => void;

  constructor(
    blockInfo: ManimBlockInfo,
    settings: ManimSettings,
    executor: ManimExecutor,
    triggerRender: (blockId: string, sceneName: string, format: string) => void,
    onSceneChange: (blockId: string, sceneName: string) => void,
    onFormatChange: (blockId: string, format: string) => void
  ) {
    super();
    this.blockInfo = blockInfo;
    this.settings = settings;
    this.executor = executor;
    this.triggerRender = triggerRender;
    this.onSceneChange = onSceneChange;
    this.onFormatChange = onFormatChange;
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof ManimLiveWidget)) return false;
    return other.blockInfo.blockId === this.blockInfo.blockId &&
           other.blockInfo.currentScene === this.blockInfo.currentScene &&
           other.blockInfo.currentFormat === this.blockInfo.currentFormat &&
           other.blockInfo.isRendering === this.blockInfo.isRendering;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'manim-live-preview-widget';
    container.style.cssText = 'margin: 0.5rem 0;';

    // Controls
    const controls = document.createElement('div');
    controls.className = 'manim-live-preview-controls';
    controls.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; align-items: center;';

    // Format selector
    const formatSelect = document.createElement('select');
    formatSelect.className = 'manim-format-selector';
    formatSelect.style.cssText = 'padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); background: var(--background-primary); color: var(--text-normal);';
    const formats = [
      { value: 'mp4', label: 'MP4' },
      { value: 'gif', label: 'GIF' },
      { value: 'png', label: 'PNG' },
      { value: 'webm', label: 'WebM' },
    ];
    for (const fmt of formats) {
      const option = document.createElement('option');
      option.value = fmt.value;
      option.textContent = fmt.label;
      if (fmt.value === this.blockInfo.currentFormat) {
        option.selected = true;
      }
      formatSelect.appendChild(option);
    }

    formatSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.onFormatChange(this.blockInfo.blockId, target.value);
    });

    controls.appendChild(formatSelect);

    // Scene selector
    if (this.blockInfo.scenes.length > 1) {
      const sceneSelect = document.createElement('select');
      sceneSelect.className = 'manim-scene-selector';
      sceneSelect.style.cssText = 'padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); background: var(--background-primary); color: var(--text-normal);';

      for (const scene of this.blockInfo.scenes) {
        const option = document.createElement('option');
        option.value = scene;
        option.textContent = scene;
        if (scene === this.blockInfo.currentScene) {
          option.selected = true;
        }
        sceneSelect.appendChild(option);
      }

      sceneSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        this.onSceneChange(this.blockInfo.blockId, target.value);
      });

      controls.appendChild(sceneSelect);
    }

    // Render button
    const hasVideo = this.blockInfo.cachedResult?.videoPath;
    const hasError = this.blockInfo.cachedResult?.error;
    const isRendering = this.blockInfo.isRendering;

    const renderButton = document.createElement('button');
    renderButton.className = 'manim-render-button';
    renderButton.textContent = hasVideo ? 'Re-render' : (isRendering ? 'Rendering...' : 'Render');
    renderButton.disabled = isRendering;
    renderButton.style.cssText = 'padding: 0.25rem 0.75rem; font-size: 0.8rem; font-weight: 500; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); background: var(--background-primary); color: var(--text-normal); cursor: pointer; transition: all 0.15s;';

    if (isRendering) {
      renderButton.style.backgroundColor = 'var(--interactive-accent)';
      renderButton.style.color = 'var(--text-on-accent)';
    }

    renderButton.addEventListener('click', () => {
      this.triggerRender(this.blockInfo.blockId, this.blockInfo.currentScene, this.blockInfo.currentFormat);
    });

    controls.appendChild(renderButton);
    container.appendChild(controls);

    // Progress container (shown during rendering)
    const progressContainer = document.createElement('div');
    progressContainer.className = 'manim-progress-container';
    progressContainer.style.display = isRendering ? 'block' : 'none';
    progressContainer.style.marginTop = '0.5rem';

    const progressBar = document.createElement('div');
    progressBar.className = 'manim-progress-bar';
    progressBar.style.cssText = 'height: 4px; background: var(--background-modifier-border); border-radius: 2px; overflow: hidden;';

    const progressFill = document.createElement('div');
    progressFill.className = 'manim-progress-fill';
    progressFill.style.cssText = 'height: 100%; width: 0%; background: var(--interactive-accent); transition: width 0.3s ease;';
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);

    const progressText = document.createElement('div');
    progressText.className = 'manim-progress-text';
    progressText.style.cssText = 'font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; text-align: right;';
    progressText.textContent = isRendering ? 'Starting render...' : '';
    progressContainer.appendChild(progressText);
    container.appendChild(progressContainer);

    // Content area
    const contentArea = document.createElement('div');
    contentArea.className = 'manim-live-preview-content';

    if (this.blockInfo.cachedResult?.error) {
      // Error state
      contentArea.style.cssText = 'padding: 0.5rem; background: rgba(var(--color-red-rgb, 255, 0, 0), 0.1); border: 1px solid var(--color-red, #e03e3e); border-radius: var(--radius-s);';

      const errorTitle = document.createElement('div');
      errorTitle.style.cssText = 'font-weight: 600; color: var(--color-red, #e03e3e); margin-bottom: 0.5rem; font-size: 0.8rem;';
      errorTitle.textContent = 'Render Failed';
      contentArea.appendChild(errorTitle);

      const errorContent = document.createElement('pre');
      errorContent.style.cssText = 'margin: 0; padding: 0.5rem; font-size: 0.7rem; line-height: 1.5; color: var(--text-normal); background: var(--background-primary); border-radius: var(--radius-s); overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--font-monospace); max-height: 200px;';
      errorContent.textContent = this.blockInfo.cachedResult.error;
      contentArea.appendChild(errorContent);
    } else if (this.blockInfo.cachedResult?.videoPath) {
      // Video/Image state
      contentArea.style.cssText = 'margin-top: 0.5rem;';

      const videoPath = this.blockInfo.cachedResult.videoPath;
      const ext = videoPath.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'gif' ? 'image/gif' : ext === 'png' ? 'image/png' : ext === 'webm' ? 'video/webm' : 'video/mp4';
      const isImage = ext === 'gif' || ext === 'png';

      // Create placeholder element first, then load media asynchronously
      const loadMedia = async (element: HTMLVideoElement | HTMLImageElement) => {
        try {
          const adapter = this.executor.app.vault.adapter;
          const arrayBuffer = await adapter.readBinary(videoPath);
          const blob = new Blob([arrayBuffer], { type: mimeType });

          let mediaUrl: string;
          if (isImage) {
            // For images (GIF/PNG), use data URL to avoid CSP issues (img-src doesn't allow blob:)
            const base64 = this.arrayBufferToBase64(arrayBuffer);
            mediaUrl = `data:${mimeType};base64,${base64}`;
          } else {
            // For videos (MP4/WebM), blob URL works fine with video elements
            mediaUrl = URL.createObjectURL(blob);
            // Clean up on remove
            element.addEventListener('remove', () => URL.revokeObjectURL(mediaUrl), { once: true });
          }
          element.src = mediaUrl;
        } catch (error) {
          console.error('Failed to load media:', error);
          element.style.display = 'none';
          const errorMsg = document.createElement('div');
          errorMsg.style.cssText = 'color: var(--color-red, #e03e3e); font-size: 0.8rem;';
          errorMsg.textContent = 'Failed to load video';
          contentArea.appendChild(errorMsg);
        }
      };

      if (ext === 'gif' || ext === 'png') {
        const img = document.createElement('img');
        img.className = 'manim-preview-video';
        img.alt = `Manim ${ext === 'gif' ? 'animation' : 'frame'}: ${this.blockInfo.cachedResult.sceneName || 'scene'}`;
        img.style.cssText = `max-width: ${this.settings.previewWidth}px; width: 100%; border-radius: var(--radius-s); background: var(--background-primary); box-shadow: var(--shadow-s);`;
        contentArea.appendChild(img);
        loadMedia(img);
      } else {
        const video = document.createElement('video');
        video.className = 'manim-preview-video';
        video.controls = true;
        video.style.cssText = `max-width: ${this.settings.previewWidth}px; width: 100%; border-radius: var(--radius-s); background: var(--background-primary); box-shadow: var(--shadow-s);`;
        contentArea.appendChild(video);
        loadMedia(video);
      }

      if (this.blockInfo.cachedResult.sceneName) {
        const label = document.createElement('div');
        label.className = 'manim-preview-label';
        label.style.cssText = 'margin-top: 0.25rem; padding: 0.125rem 0.375rem; font-size: 0.7rem; font-weight: 500; color: var(--text-muted); background: var(--background-primary); border-radius: var(--radius-s); display: inline-block;';
        label.textContent = `Scene: ${this.blockInfo.cachedResult.sceneName}`;
        contentArea.appendChild(label);
      }
    } else {
      // No result yet - show placeholder
      contentArea.style.cssText = 'padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; background: var(--background-primary); border-radius: var(--radius-s); border: 1px dashed var(--background-modifier-border);';
      contentArea.textContent = isRendering ? 'Rendering animation...' : 'Click "Render" to generate preview';
    }

    container.appendChild(contentArea);

    // Store references for progress updates
    (this as any)._progressFill = progressFill;
    (this as any)._progressText = progressText;

    // Register widget for progress updates
    if (!(window as any).__manimWidgets) {
      (window as any).__manimWidgets = {};
    }
    (window as any).__manimWidgets[this.blockInfo.blockId] = this;

    return container;
  }

  ignoreEvent(): boolean {
    return false;
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
}

/**
 * Create the ViewPlugin for Manim Live Preview
 * This function captures the executor and settings via closure
 */
export function createManimViewPlugin(
  executor: ManimExecutor,
  settings: ManimSettings
) {
  // Store block info for rendering (accessible from widgets via closure)
  const blockInfos = new Map<string, ManimBlockInfo>();
  const pendingRenders = new Set<string>();

  // Callback functions that widgets will use
  const triggerRender = async (blockId: string, sceneName: string, format: string): Promise<void> => {
    if (pendingRenders.has(blockId)) return;
    const blockInfo = blockInfos.get(blockId);
    if (!blockInfo) return;

    pendingRenders.add(blockId);
    blockInfo.isRendering = true;
    blockInfo.currentScene = sceneName;
    blockInfo.currentFormat = format;

    // Request view update to show rendering state
    requestAnimationFrame(() => {
      // Force a view update by dispatching a transaction
      // We'll trigger this through the view if available
    });

    try {
      const result = await executor.execute({
        source: blockInfo.source,
        sceneName,
        quality: settings.quality,
        outputDir: executor.getCacheDir(),
        timeoutMs: settings.renderTimeoutMs,
        manimPath: settings.manimPath,
        pythonPath: settings.pythonPath,
        format: format as any,
        saveLastFrame: settings.saveLastFrame,
        transparent: settings.transparent,
        onProgress: (progress: number, message: string) => {
          // Update progress in widget if available
          const widget = (window as any).__manimWidgets?.[blockId];
          if (widget) {
            if (widget._progressFill) {
              widget._progressFill.style.width = `${progress}%`;
            }
            if (widget._progressText) {
              widget._progressText.textContent = message;
            }
          }
        },
      });

      blockInfo.cachedResult = result;
      blockInfo.isRendering = false;
    } catch (error: any) {
      const errorResult: ManimResult = {
        id: blockId,
        source: blockInfo.source,
        sourceHash: '',
        scenes: blockInfo.scenes,
        error: error.message,
        timestamp: Date.now(),
        fromCache: false,
      };
      blockInfo.cachedResult = errorResult;
      blockInfo.isRendering = false;
    } finally {
      pendingRenders.delete(blockId);
    }
  };

  const onSceneChange = (blockId: string, sceneName: string): void => {
    const blockInfo = blockInfos.get(blockId);
    if (blockInfo) {
      blockInfo.currentScene = sceneName;
      // Clear cached result since scene changed
      blockInfo.cachedResult = undefined;
      // Trigger render with new scene
      triggerRender(blockId, sceneName, blockInfo.currentFormat);
    }
  };

  const onFormatChange = (blockId: string, format: string): void => {
    const blockInfo = blockInfos.get(blockId);
    if (blockInfo) {
      blockInfo.currentFormat = format;
      // Clear cached result since format changed
      blockInfo.cachedResult = undefined;
      // Trigger render with new format
      triggerRender(blockId, blockInfo.currentScene, format);
    }
  };

  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();

      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
            this.processCodeBlock(view.state.doc, node, builder);
          }
        }
      });

      return builder.finish();
    }

    processCodeBlock(doc: { sliceString: (from: number, to: number) => string }, node: { name: string; from: number; to: number }, builder: RangeSetBuilder<Decoration>): void {
      const blockText = doc.sliceString(node.from, node.to);
      const lines = blockText.split('\n');

      const firstLine = lines[0].trim();
      if (!firstLine.startsWith('```manim')) {
        return;
      }

      const sourceLines = lines.slice(1, -1);
      const source = sourceLines.join('\n');

      if (!source.trim()) {
        return;
      }

      const blockId = `manim:${this.hashString(source)}:${node.from}`;
      const sceneInfo = this.extractSceneInfo(source);
      const scenes = sceneInfo.scenes;
      const preferredScene = sceneInfo.preferredScene;
      const currentScene = preferredScene || scenes[0] || '';
      const currentFormat = settings.format || 'mp4';

      // Check cache
      const sourceHash = this.hashString(source);
      const cached = executor.getCached(sourceHash, currentScene, settings.quality, settings.format || 'mp4');

      // Store/update block info
      let blockInfo = blockInfos.get(blockId);
      if (!blockInfo) {
        blockInfo = {
          blockId,
          source,
          from: node.from,
          to: node.to,
          scenes,
          preferredScene,
          currentScene,
          currentFormat,
          cachedResult: cached,
          isRendering: false,
        };
        blockInfos.set(blockId, blockInfo);
      } else {
        // Update with latest cached result
        if (cached && !blockInfo.isRendering) {
          blockInfo.cachedResult = cached;
        }
        blockInfo.scenes = scenes;
        blockInfo.preferredScene = preferredScene;
        if (!blockInfo.currentScene || (preferredScene && preferredScene !== blockInfo.currentScene)) {
          blockInfo.currentScene = preferredScene || scenes[0] || '';
        }
        if (!blockInfo.currentFormat) {
          blockInfo.currentFormat = currentFormat;
        }
      }

      // Create decoration with widget
      const widget = new ManimLiveWidget(
        blockInfo,
        settings,
        executor,
        triggerRender,
        onSceneChange,
        onFormatChange
      );

      const deco = Decoration.replace({ widget, block: true });
      builder.add(node.from, node.to, deco);
    }

    extractSceneInfo(source: string): { scenes: string[]; preferredScene?: string } {
      const scenes: string[] = [];
      let preferredScene: string | undefined;

      const lines = source.split('\n');

      for (const line of lines) {
        const sceneCommentMatch = line.match(/^\s*#\s*scene\s*:\s*(\w+)/i);
        if (sceneCommentMatch) {
          preferredScene = sceneCommentMatch[1];
        }

        const classMatch = line.match(/^\s*class\s+(\w+)\s*\(\s*(?:Scene|.*Scene)\s*\)/);
        if (classMatch) {
          scenes.push(classMatch[1]);
        }
      }

      return { scenes, preferredScene };
    }

    hashString(str: string): string {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(36);
    }
  }, {
    decorations: (plugin) => plugin.decorations
  });
}