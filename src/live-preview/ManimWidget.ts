import { WidgetType } from '@codemirror/view';
import { ManimResult } from '../types';

/**
 * CodeMirror 6 Widget for displaying Manim preview in Live Preview
 */
export class ManimWidget extends WidgetType {
  private result: ManimResult;
  private previewWidth: number;
  private onRender: (sceneName?: string) => Promise<void>;
  private onSceneChange: (sceneName: string) => void;
  private currentScene: string;
  private scenes: string[];

  constructor(
    result: ManimResult,
    previewWidth: number,
    onRender: (sceneName?: string) => Promise<void>,
    onSceneChange: (sceneName: string) => void,
    currentScene: string,
    scenes: string[]
  ) {
    super();
    this.result = result;
    this.previewWidth = previewWidth;
    this.onRender = onRender;
    this.onSceneChange = onSceneChange;
    this.currentScene = currentScene;
    this.scenes = scenes;
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof ManimWidget)) return false;
    return (
      other.result.id === this.result.id &&
      other.currentScene === this.currentScene &&
      other.previewWidth === this.previewWidth
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'manim-live-preview-widget';
    container.style.cssText = 'margin: 0.5rem 0;';

    // Controls bar
    const controls = document.createElement('div');
    controls.className = 'manim-live-preview-controls';
    controls.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; align-items: center;';

    // Scene selector (if multiple scenes)
    if (this.scenes.length > 1) {
      const sceneSelect = document.createElement('select');
      sceneSelect.className = 'manim-scene-selector';
      sceneSelect.style.cssText = 'padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); background: var(--background-primary); color: var(--text-normal);';

      for (const scene of this.scenes) {
        const option = document.createElement('option');
        option.value = scene;
        option.textContent = scene;
        if (scene === this.currentScene) {
          option.selected = true;
        }
        sceneSelect.appendChild(option);
      }

      sceneSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        this.onSceneChange(target.value);
      });

      controls.appendChild(sceneSelect);
    }

    // Render button
    const renderButton = document.createElement('button');
    renderButton.className = 'manim-render-button';
    renderButton.textContent = this.result.videoPath ? 'Re-render' : 'Render';
    renderButton.style.cssText = 'padding: 0.25rem 0.75rem; font-size: 0.8rem; font-weight: 500; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); background: var(--background-primary); color: var(--text-normal); cursor: pointer; transition: all 0.15s;';

    renderButton.addEventListener('mouseover', () => {
      if (!renderButton.disabled) {
        renderButton.style.backgroundColor = 'var(--background-modifier-hover)';
        renderButton.style.borderColor = 'var(--interactive-accent)';
      }
    });

    renderButton.addEventListener('mouseout', () => {
      if (!renderButton.disabled) {
        renderButton.style.backgroundColor = 'var(--background-primary)';
        renderButton.style.borderColor = 'var(--background-modifier-border)';
      }
    });

    renderButton.addEventListener('click', async () => {
      renderButton.disabled = true;
      renderButton.textContent = 'Rendering...';
      renderButton.style.backgroundColor = 'var(--interactive-accent)';
      renderButton.style.color = 'var(--text-on-accent)';

      try {
        await this.onRender(this.currentScene);
      } finally {
        // The widget will be recreated with new result
      }
    });

    controls.appendChild(renderButton);
    container.appendChild(controls);

    // Status/Error/Video area
    const contentArea = document.createElement('div');
    contentArea.className = 'manim-live-preview-content';

    if (this.result.error) {
      // Error state
      contentArea.style.cssText = 'padding: 0.5rem; background: rgba(var(--color-red-rgb, 255, 0, 0), 0.1); border: 1px solid var(--color-red, #e03e3e); border-radius: var(--radius-s);';

      const errorTitle = document.createElement('div');
      errorTitle.style.cssText = 'font-weight: 600; color: var(--color-red, #e03e3e); margin-bottom: 0.5rem; font-size: 0.8rem;';
      errorTitle.textContent = 'Render Failed';
      contentArea.appendChild(errorTitle);

      const errorContent = document.createElement('pre');
      errorContent.style.cssText = 'margin: 0; padding: 0.5rem; font-size: 0.7rem; line-height: 1.5; color: var(--text-normal); background: var(--background-primary); border-radius: var(--radius-s); overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--font-monospace); max-height: 200px;';
      errorContent.textContent = this.result.error;
      contentArea.appendChild(errorContent);
    } else if (this.result.videoPath) {
      // Video state
      contentArea.style.cssText = 'margin-top: 0.5rem;';

      const videoUrl = `file://${this.result.videoPath.replace(/\\/g, '/')}`;

      const video = document.createElement('video');
      video.className = 'manim-preview-video';
      video.controls = true;
      video.src = videoUrl;
      video.style.cssText = `max-width: ${this.previewWidth}px; width: 100%; border-radius: var(--radius-s); background: var(--background-primary); box-shadow: var(--shadow-s);`;

      contentArea.appendChild(video);

      if (this.result.sceneName) {
        const label = document.createElement('div');
        label.className = 'manim-preview-label';
        label.style.cssText = 'margin-top: 0.25rem; padding: 0.125rem 0.375rem; font-size: 0.7rem; font-weight: 500; color: var(--text-muted); background: var(--background-primary); border-radius: var(--radius-s); display: inline-block;';
        label.textContent = `Scene: ${this.result.sceneName}`;
        contentArea.appendChild(label);
      }
    } else {
      // No result yet - show placeholder
      contentArea.style.cssText = 'padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; background: var(--background-primary); border-radius: var(--radius-s); border: 1px dashed var(--background-modifier-border);';
      contentArea.textContent = 'Click "Render" to generate preview';
    }

    container.appendChild(contentArea);
    return container;
  }

  ignoreEvent(): boolean {
    // Allow events on interactive elements (buttons, select, video)
    return false;
  }
}