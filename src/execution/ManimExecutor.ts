import { App, TFile, Vault } from 'obsidian';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname, basename, extname } from 'path';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { v4 as uuidv4 } from 'crypto';
import {
  ManimSettings,
  ManimResult,
  ManimExecutionOptions,
  QUALITY_FLAGS
} from '../types';

const execFileAsync = promisify(execFile);

/**
 * Simple hash function for cache keys
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract scene class names from Python source code
 */
function extractSceneNames(source: string): string[] {
  const scenes: string[] = [];
  const lines = source.split('\n');

  for (const line of lines) {
    // Match class definitions that inherit from Scene
    const match = line.match(/^\s*class\s+(\w+)\s*\(\s*(?:Scene|.*Scene)\s*\)/);
    if (match) {
      scenes.push(match[1]);
    }
  }

  return scenes;
}

/**
 * Find the output video file from manim render
 */
function findOutputVideo(outputDir: string, sceneName: string): string | null {
  const mediaDir = join(outputDir, 'media', 'videos');

  if (!existsSync(mediaDir)) {
    return null;
  }

  // Find the scene directory
  const sceneDirs = readdirSync(mediaDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const sceneDir of sceneDirs) {
    const qualityDirs = ['480p15', '720p30', '1080p60', '2160p60'];

    for (const qualityDir of qualityDirs) {
      const videoPath = join(mediaDir, sceneDir, qualityDir, `${sceneName}.mp4`);
      if (existsSync(videoPath)) {
        return videoPath;
      }
    }

    // Also check for any mp4 in the scene directory
    try {
      const files = readdirSync(join(mediaDir, sceneDir), { recursive: true });
      const mp4Files = files.filter(f => f.endsWith('.mp4'));
      if (mp4Files.length > 0) {
        return join(mediaDir, sceneDir, mp4Files[0]);
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

export class ManimExecutor {
  private app: App;
  private settings: ManimSettings;
  private cacheDir: string;
  private pendingRenders: Map<string, AbortController> = new Map();
  private renderCache: Map<string, ManimResult> = new Map();

  constructor(app: App, settings: ManimSettings) {
    this.app = app;
    this.settings = settings;
    this.cacheDir = join(this.app.vault.adapter.getBasePath(), settings.cacheDir);
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  updateSettings(settings: ManimSettings): void {
    this.settings = settings;
    this.cacheDir = join(this.app.vault.adapter.getBasePath(), settings.cacheDir);
    this.ensureCacheDir();
  }

  /**
   * Execute manim rendering for the given source code
   */
  async execute(options: ManimExecutionOptions): Promise<ManimResult> {
    const sourceHash = hashString(options.source);
    const cacheKey = `${sourceHash}-${options.sceneName || 'first'}-${options.quality}`;

    // Check cache first
    const cached = this.renderCache.get(cacheKey);
    if (cached && existsSync(cached.videoPath || '')) {
      return { ...cached, fromCache: true };
    }

    // Check for pending render of same source
    if (this.pendingRenders.has(cacheKey)) {
      // Wait for the existing render to complete
      // For now, we'll just execute anyway - in future could await the existing promise
    }

    const abortController = new AbortController();
    this.pendingRenders.set(cacheKey, abortController);

    try {
      const result = await this.runManim(options, sourceHash, cacheKey);

      // Cache successful result
      if (result.videoPath && !result.error) {
        this.renderCache.set(cacheKey, result);
      }

      return result;
    } finally {
      this.pendingRenders.delete(cacheKey);
    }
  }

  /**
   * Run the manim command
   */
  private async runManim(
    options: ManimExecutionOptions,
    sourceHash: string,
    cacheKey: string
  ): Promise<ManimResult> {
    const scenes = extractSceneNames(options.source);
    const sceneName = options.sceneName || scenes[0];

    if (!sceneName) {
      return {
        id: cacheKey,
        source: options.source,
        sourceHash,
        scenes,
        error: 'No Scene class found in source code',
        timestamp: Date.now(),
        fromCache: false,
      };
    }

    // Create temp file for the source
    const tempDir = join(this.cacheDir, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = join(tempDir, `scene_${sourceHash}.py`);

    // Write source to temp file
    await this.writeTempFile(tempFile, options.source);

    try {
      // Build manim command
      const { command, args } = this.buildManimCommand(
        tempFile,
        sceneName,
        options.quality,
        options.outputDir
      );

      // Execute manim
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: options.timeoutMs,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        signal: this.pendingRenders.get(cacheKey)?.signal,
      });

      // Find output video
      const videoPath = findOutputVideo(options.outputDir, sceneName);

      if (!videoPath || !existsSync(videoPath)) {
        return {
          id: cacheKey,
          source: options.source,
          sourceHash,
          sceneName,
          scenes,
          error: `Render completed but video not found. Stdout: ${stdout}\nStderr: ${stderr}`,
          timestamp: Date.now(),
          fromCache: false,
        };
      }

      // Copy to cache with stable name
      const cachedVideoPath = join(this.cacheDir, `${cacheKey}.mp4`);
      await this.copyFile(videoPath, cachedVideoPath);

      return {
        id: cacheKey,
        source: options.source,
        sourceHash,
        videoPath: cachedVideoPath,
        sceneName,
        scenes,
        timestamp: Date.now(),
        fromCache: false,
      };
    } catch (error: any) {
      let errorMessage = error.message;

      if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
        errorMessage = `Render timed out after ${options.timeoutMs}ms`;
      } else if (error.stderr) {
        errorMessage = `${error.message}\nStderr: ${error.stderr}`;
      }

      return {
        id: cacheKey,
        source: options.source,
        sourceHash,
        sceneName,
        scenes,
        error: errorMessage,
        timestamp: Date.now(),
        fromCache: false,
      };
    } finally {
      // Cleanup temp file
      try {
        if (existsSync(tempFile)) {
          rmSync(tempFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Build the manim command based on settings
   */
  private buildManimCommand(
    sourceFile: string,
    sceneName: string,
    quality: 'low' | 'medium' | 'high' | '4k',
    outputDir: string
  ): { command: string; args: string[] } {
    const manimPath = this.settings.manimPath;
    const pythonPath = this.settings.pythonPath;
    const qualityFlag = QUALITY_FLAGS[quality];

    if (manimPath && manimPath !== 'manim') {
      // Custom manim executable
      return {
        command: manimPath,
        args: [
          'render',
          sourceFile,
          sceneName,
          qualityFlag,
          '--format=mp4',
          `--media_dir=${outputDir}`,
        ],
      };
    } else {
      // Use python -m manim
      return {
        command: pythonPath,
        args: [
          '-m', 'manim',
          'render',
          sourceFile,
          sceneName,
          qualityFlag,
          '--format=mp4',
          `--media_dir=${outputDir}`,
        ],
      };
    }
  }

  /**
   * Write source code to temp file
   */
  private async writeTempFile(filePath: string, content: string): Promise<void> {
    const { writeFile } = await import('fs/promises');
    await writeFile(filePath, content, 'utf-8');
  }

  /**
   * Copy file from source to destination
   */
  private async copyFile(src: string, dest: string): Promise<void> {
    const { copyFile } = await import('fs/promises');
    await copyFile(src, dest);
  }

  /**
   * Clear all cached renders
   */
  async clearCache(): Promise<void> {
    try {
      if (existsSync(this.cacheDir)) {
        rmSync(this.cacheDir, { recursive: true, force: true });
        this.ensureCacheDir();
      }
      this.renderCache.clear();
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  /**
   * Get cached result if available
   */
  getCached(sourceHash: string, sceneName: string | undefined, quality: string): ManimResult | undefined {
    const cacheKey = `${sourceHash}-${sceneName || 'first'}-${quality}`;
    return this.renderCache.get(cacheKey);
  }

  /**
   * Cancel a pending render
   */
  cancelRender(sourceHash: string, sceneName: string | undefined, quality: string): void {
    const cacheKey = `${sourceHash}-${sceneName || 'first'}-${quality}`;
    const controller = this.pendingRenders.get(cacheKey);
    if (controller) {
      controller.abort();
      this.pendingRenders.delete(cacheKey);
    }
  }

  /**
   * Cancel all pending renders
   */
  cancelAllRenders(): void {
    for (const controller of this.pendingRenders.values()) {
      controller.abort();
    }
    this.pendingRenders.clear();
  }

  /**
   * Get the cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }
}