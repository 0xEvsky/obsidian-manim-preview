import { StateField, StateEffect, EditorView, Decoration, DecorationSet, RangeSetBuilder } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { ManimExecutor } from '../execution/ManimExecutor';
import { ManimSettings, ManimResult } from '../types';
import { ManimWidget } from './ManimWidget';

// State effects for communicating with the field
export const setManimResultEffect = StateEffect.define<{
  blockId: string;
  result: ManimResult;
  currentScene: string;
}>();

export const setManimRenderingEffect = StateEffect.define<{
  blockId: string;
  isRendering: boolean;
}>();

export const clearManimResultEffect = StateEffect.define<string>(); // blockId

interface ManimDecorationData {
  blockId: string;
  result: ManimResult | null;
  isRendering: boolean;
  currentScene: string;
  scenes: string[];
  from: number;
  to: number;
}

export class ManimLivePreviewField {
  private executor: ManimExecutor;
  private settings: ManimSettings;
  private plugin: any; // Obsidian Plugin reference
  private pendingRenders: Map<string, Promise<void>> = new Map();
  private sceneSelections: Map<string, string> = new Map(); // blockId -> scene
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  public readonly field: StateField<DecorationSet>;

  constructor(executor: ManimExecutor, settings: ManimSettings, plugin: any) {
    this.executor = executor;
    this.settings = settings;
    this.plugin = plugin;

    this.field = StateField.define<DecorationSet>({
      create: () => Decoration.none,
      update: (decorations, transaction) => {
        let builder = new RangeSetBuilder<Decoration>();

        // Check if we need to rebuild (doc changed or effects)
        const hasDocChange = transaction.docChanged;
        const hasEffects = transaction.effects.some(e =>
          e.is(setManimResultEffect) ||
          e.is(setManimRenderingEffect) ||
          e.is(clearManimResultEffect)
        );

        if (!hasDocChange && !hasEffects) {
          return decorations;
        }

        // Process effects first to update our internal state
        for (const effect of transaction.effects) {
          if (effect.is(setManimResultEffect)) {
            const { blockId, result, currentScene } = effect.value;
            // We'll handle this in the decoration building below
          } else if (effect.is(setManimRenderingEffect)) {
            // Rendering state change
          } else if (effect.is(clearManimResultEffect)) {
            // Clear result for block
          }
        }

        // Iterate through the document to find manim code blocks
        const doc = transaction.newDoc;
        syntaxTree(doc).iterate({
          enter: (node) => {
            if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
              this.processCodeBlock(doc, node, builder);
            }
          }
        });

        return builder.finish();
      },
      provide: (f) => EditorView.decorations.from(f)
    });
  }

  private processCodeBlock(doc: any, node: any, builder: RangeSetBuilder<Decoration>): void {
    // Get the code block content
    const blockText = doc.sliceString(node.from, node.to);
    const lines = blockText.split('\n');

    // Check if this is a manim code block
    const firstLine = lines[0].trim();
    if (!firstLine.startsWith('```manim')) {
      return;
    }

    // Extract source (everything between ```manim and ```)
    const sourceLines = lines.slice(1, -1);
    const source = sourceLines.join('\n');

    if (!source.trim()) {
      return;
    }

    // Generate block ID
    const blockId = `manim:${this.hashString(source)}:${node.from}`;

    // Extract scenes
    const sceneInfo = this.extractSceneInfo(source);
    const scenes = sceneInfo.scenes;
    const preferredScene = sceneInfo.preferredScene;

    // Get current scene selection
    const currentScene = this.sceneSelections.get(blockId) || preferredScene || scenes[0] || '';

    // Check for cached result
    const sourceHash = this.hashString(source);
    const cached = this.executor.getCached(sourceHash, currentScene, this.settings.quality);

    // Create widget if we have a result
    if (cached && (cached.videoPath || cached.error)) {
      const widget = new ManimWidget(
        cached,
        this.settings.previewWidth,
        async (sceneName) => this.triggerRender(blockId, source, sceneName || currentScene),
        (sceneName) => this.onSceneChange(blockId, sceneName),
        currentScene,
        scenes
      );

      const deco = Decoration.replace({
        widget,
        block: true
      }).range(node.from, node.to);

      builder.add(deco);
    }
  }

  private async triggerRender(blockId: string, source: string, sceneName: string): Promise<void> {
    // Prevent duplicate renders
    if (this.pendingRenders.has(blockId)) {
      return;
    }

    const renderPromise = this.doRender(blockId, source, sceneName);
    this.pendingRenders.set(blockId, renderPromise);

    try {
      await renderPromise;
    } finally {
      this.pendingRenders.delete(blockId);
    }
  }

  private async doRender(blockId: string, source: string, sceneName: string): Promise<void> {
    // Dispatch rendering started effect
    this.plugin.app.workspace.getActiveViewOfType(any)?.editor?.view?.dispatch({
      effects: setManimRenderingEffect.of({ blockId, isRendering: true })
    });

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

      // Dispatch result effect
      this.plugin.app.workspace.getActiveViewOfType(any)?.editor?.view?.dispatch({
        effects: setManimResultEffect.of({ blockId, result, currentScene: sceneName })
      });
    } catch (error: any) {
      // Dispatch error result
      const errorResult: ManimResult = {
        id: blockId,
        source,
        sourceHash: this.hashString(source),
        scenes: this.extractSceneInfo(source).scenes,
        error: error.message,
        timestamp: Date.now(),
        fromCache: false,
      };

      this.plugin.app.workspace.getActiveViewOfType(any)?.editor?.view?.dispatch({
        effects: setManimResultEffect.of({ blockId, result: errorResult, currentScene: sceneName })
      });
    }
  }

  private onSceneChange(blockId: string, sceneName: string): void {
    this.sceneSelections.set(blockId, sceneName);
    // Trigger re-render with new scene
    // The widget will be recreated on next decoration update
  }

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

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  updateSettings(settings: ManimSettings): void {
    this.settings = settings;
  }
}