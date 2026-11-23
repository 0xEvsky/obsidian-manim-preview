import { App } from 'obsidian';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import {
  ManimSettings,
  ManimResult,
  ManimExecutionOptions,
  QUALITY_FLAGS
} from '../types';

const execFileAsync = promisify(execFile);

// DataAdapter doesn't have getBasePath in types, but it exists at runtime
interface DataAdapterWithBasePath {
  getBasePath(): string;
}

// Type guard for adapter with getBasePath
function hasGetBasePath(adapter: any): adapter is DataAdapterWithBasePath {
  return typeof adapter.getBasePath === 'function';
}

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
 * Map quality setting to manim output directory name
 */
function qualityToDirName(quality: 'low' | 'medium' | 'high' | '4k'): string {
  switch (quality) {
    case 'low': return '480p15';
    case 'medium': return '720p30';
    case 'high': return '1080p60';
    case '4k': return '2160p60';
  }
}

/**
 * Find the output video file from manim render
 * Searches for the requested quality first, then falls back to other qualities
 */
function findOutputVideo(
  outputDir: string,
  sceneName: string,
  format: string,
  quality: 'low' | 'medium' | 'high' | '4k'
): string | null {
  // When using --media_dir=outputDir, manim outputs to outputDir/videos/ (not outputDir/media/videos/)
  const searchDirs = format === 'gif'
    ? [join(outputDir, 'videos'), join(outputDir, 'images')]
    : [join(outputDir, 'videos')];

  // Determine the requested quality directory
  const requestedQualityDir = qualityToDirName(quality);
  // Fallback order: requested quality first, then others in descending order
  const qualityDirs = ['2160p60', '1080p60', '720p30', '480p15'].filter(
    (d) => d === requestedQualityDir || d !== requestedQualityDir
  );
  // Ensure requested quality is first
  const orderedQualityDirs = [requestedQualityDir, ...qualityDirs.filter((d) => d !== requestedQualityDir)];

  for (const mediaDir of searchDirs) {
    if (!existsSync(mediaDir)) continue;

    // Find the scene directory
    const sceneDirs = readdirSync(mediaDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const sceneDir of sceneDirs) {
      // Search requested quality first, then fall back
      for (const qualityDir of orderedQualityDirs) {
        const ext = format === 'gif' ? '.gif' : format === 'png' ? '.png' : '.mp4';
        const videoPath = join(mediaDir, sceneDir, qualityDir, `${sceneName}${ext}`);
        if (existsSync(videoPath)) {
          return videoPath;
        }
      }

      // Also check for any matching file in the scene directory (recursive)
      try {
        const files = readdirSync(join(mediaDir, sceneDir), { recursive: true });
        const ext = format === 'gif' ? '.gif' : format === 'png' ? '.png' : '.mp4';
        const matchedFiles = files.filter(f => String(f).endsWith(ext));
        if (matchedFiles.length > 0) {
          return join(mediaDir, sceneDir, String(matchedFiles[0]));
        }
      } catch {
        // Ignore
      }
    }
  }

  return null;
}

/**
 * Parse manim stdout for progress information
 */
function parseProgress(stdout: string): { progress: number; message: string } | null {
  // Manim outputs progress like:
  // "  10%|██▌       | 10/100 [00:02<00:18,  4.98it/s]"
  // "File ready at '/path/to/video.mp4'"

  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Progress bar pattern
    const progressMatch = line.match(/(\d+)%\|.*?\|\s*(\d+)\/(\d+)/);
    if (progressMatch) {
      const percent = parseInt(progressMatch[1], 10);
      const current = parseInt(progressMatch[2], 10);
      const total = parseInt(progressMatch[3], 10);
      return {
        progress: percent,
        message: `Rendering frame ${current}/${total} (${percent}%)`
      };
    }

    // File ready message
    if (line.startsWith('File ready at')) {
      return { progress: 100, message: 'Render complete' };
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
  private progressCallbacks: Map<string, (progress: number, message: string) => void> = new Map();
  private cacheDirAbs: string;  // Absolute path for filesystem operations
  private cacheDirRel: string;  // Relative path from vault root for adapter

  constructor(app: App, settings: ManimSettings) {
    this.app = app;
    this.settings = settings;
    const adapter = this.app.vault.adapter;
    if (!hasGetBasePath(adapter)) {
      throw new Error('Vault adapter does not have getBasePath method');
    }
    const vaultBase = adapter.getBasePath();
    this.cacheDirRel = settings.cacheDir;
    this.cacheDirAbs = join(vaultBase, this.cacheDirRel);
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDirAbs)) {
      mkdirSync(this.cacheDirAbs, { recursive: true });
    }
  }

  updateSettings(settings: ManimSettings): void {
    this.settings = settings;
    const adapter = this.app.vault.adapter;
    if (!hasGetBasePath(adapter)) {
      throw new Error('Vault adapter does not have getBasePath method');
    }
    const vaultBase = adapter.getBasePath();
    this.cacheDirRel = settings.cacheDir;
    this.cacheDirAbs = join(vaultBase, this.cacheDirRel);
    this.ensureCacheDir();
  }

  /**
   * Execute manim rendering for the given source code
   */
  async execute(options: ManimExecutionOptions): Promise<ManimResult> {
    const sourceHash = hashString(options.source);
    const format = options.format || 'mp4';
    const cacheKey = `${sourceHash}-${options.sceneName || 'first'}-${options.quality}-${format}`;

    // Check cache first
    const cached = this.renderCache.get(cacheKey);
    if (cached && cached.videoPath) {
      // Use absolute path for existsSync check since videoPath is relative to vault root
      const absoluteVideoPath = join(this.cacheDirAbs, cached.videoPath.split('/').pop() || '');
      if (existsSync(absoluteVideoPath)) {
        return { ...cached, fromCache: true };
      }
    }

    // Check for pending render of same source
    if (this.pendingRenders.has(cacheKey)) {
      // Wait for the existing render to complete
      // For now, we'll just execute anyway
    }

    const abortController = new AbortController();
    this.pendingRenders.set(cacheKey, abortController);

    // Register progress callback if provided
    if (options.onProgress) {
      this.progressCallbacks.set(cacheKey, options.onProgress);
    }

    try {
      const result = await this.runManim(options, sourceHash, cacheKey);

      // Cache successful result
      if (result.videoPath && !result.error) {
        this.renderCache.set(cacheKey, result);
      }

      return result;
    } finally {
      this.pendingRenders.delete(cacheKey);
      this.progressCallbacks.delete(cacheKey);
    }
  }

  /**
   * Run the manim command with progress tracking
   */
  private async runManim(
    options: ManimExecutionOptions,
    sourceHash: string,
    cacheKey: string
  ): Promise<ManimResult> {
    const scenes = extractSceneNames(options.source);
    const sceneName = options.sceneName || scenes[0];
    const format = options.format || 'mp4';

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
    const tempDir = join(this.cacheDirAbs, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = join(tempDir, `scene_${sourceHash}.py`);

    // Write source to temp file
    this.writeTempFile(tempFile, options.source);

    try {
      // Build manim command
      const { command, args } = this.buildManimCommand(
        tempFile,
        sceneName,
        options.quality,
        options.outputDir,
        format,
        options.saveLastFrame,
        options.transparent
      );

      // Execute manim with spawn for progress tracking
      const result = await this.runManimWithProgress(command, args, options, cacheKey);

      // Find output video - pass quality to ensure correct quality directory is used
      const videoPath = findOutputVideo(options.outputDir, sceneName, format, options.quality);

      if (!videoPath || !existsSync(videoPath)) {
        return {
          id: cacheKey,
          source: options.source,
          sourceHash,
          sceneName,
          scenes,
          error: `Render completed but ${format} not found. ${result.stdout}\nStderr: ${result.stderr}`,
          timestamp: Date.now(),
          fromCache: false,
        };
      }

      // Determine cached file extension
      const ext = format === 'gif' ? '.gif' : format === 'png' ? '.png' : '.mp4';
      const cachedVideoPathAbs = join(this.cacheDirAbs, `${cacheKey}${ext}`);
      const cachedVideoPathRel = join(this.cacheDirRel, `${cacheKey}${ext}`);
      copyFileSync(videoPath, cachedVideoPathAbs);

      return {
        id: cacheKey,
        source: options.source,
        sourceHash,
        videoPath: cachedVideoPathRel,
        sceneName,
        scenes,
        timestamp: Date.now(),
        fromCache: false,
      };
    } catch (error: any) {
      let errorMessage = error.message;

      if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
        errorMessage = `Render timed out after ${options.timeoutMs}ms`;
      }
      // Don't append stderr to error message - Manim writes progress to stderr even on success
      // Only include stderr if it contains actual error indicators
      else if (error.stderr && this.looksLikeRealError(error.stderr)) {
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
   * Run manim with spawn to capture progress
   */
  private runManimWithProgress(
    command: string,
    args: string[],
    options: ManimExecutionOptions,
    cacheKey: string
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(command, args, {
        timeout: options.timeoutMs,
        signal: this.pendingRenders.get(cacheKey)?.signal,
      });

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Parse progress and call callback
        const progress = parseProgress(chunk);
        if (progress && options.onProgress) {
          options.onProgress(progress.progress, progress.message);
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const error = new Error(`Manim exited with code ${code}`) as any;
          error.code = code;
          error.stderr = stderr;
          reject(error);
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Build the manim command based on settings and options
   */
  private buildManimCommand(
    sourceFile: string,
    sceneName: string,
    quality: 'low' | 'medium' | 'high' | '4k',
    outputDir: string,
    format: string,
    saveLastFrame?: boolean,
    transparent?: boolean
  ): { command: string; args: string[] } {
    const manimPath = this.settings.manimPath;
    const pythonPath = this.settings.pythonPath;
    const qualityFlag = QUALITY_FLAGS[quality];

    const baseArgs = [
      'render',
      sourceFile,
      sceneName,
      qualityFlag,
      `--format=${format}`,
      `--media_dir=${outputDir}`,
    ];

    if (saveLastFrame) {
      baseArgs.push('-s');
    }

    if (transparent) {
      baseArgs.push('-t');
    }

    if (manimPath && manimPath !== 'manim') {
      // Custom manim executable
      return {
        command: manimPath,
        args: baseArgs,
      };
    } else {
      // Use python -m manim
      return {
        command: pythonPath,
        args: ['-m', 'manim', ...baseArgs],
      };
    }
  }

  /**
   * Write source code to temp file
   */
  private writeTempFile(filePath: string, content: string): void {
    writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Clear all cached renders
   */
  async clearCache(): Promise<void> {
    try {
      if (existsSync(this.cacheDirAbs)) {
        rmSync(this.cacheDirAbs, { recursive: true, force: true });
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
  getCached(sourceHash: string, sceneName: string | undefined, quality: string, format: string): ManimResult | undefined {
    const cacheKey = `${sourceHash}-${sceneName || 'first'}-${quality}-${format}`;
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
   * Check if stderr contains actual error content (not just progress bars)
   */
  private looksLikeRealError(stderr: string): boolean {
    const errorIndicators = [
      'Error:',
      'Traceback',
      'Exception:',
      'ModuleNotFoundError',
      'ImportError',
      'SyntaxError',
      'RuntimeError',
      'ValueError',
      'FileNotFoundError',
      'PermissionError',
      'FFmpeg',
      'ffmpeg',
      'command not found',
      'No such file',
    ];
    return errorIndicators.some(indicator => stderr.includes(indicator));
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
   * Get the cache directory path (absolute, for manim --media_dir)
   */
  getCacheDir(): string {
    return this.cacheDirAbs;
  }
}