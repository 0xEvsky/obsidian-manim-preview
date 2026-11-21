/**
 * Shared type definitions for the Manim Preview plugin
 */

export interface ManimSettings {
  /** Path to Python executable */
  pythonPath: string;
  /** Path to manim executable (if different from python -m manim) */
  manimPath: string;
  /** Enable automatic rendering on code change */
  autoRender: boolean;
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Render quality: 'low' | 'medium' | 'high' | '4k' */
  quality: 'low' | 'medium' | 'high' | '4k';
  /** Maximum preview width in pixels */
  previewWidth: number;
  /** Cache directory for rendered videos */
  cacheDir: string;
  /** Timeout for manim rendering in milliseconds */
  renderTimeoutMs: number;
}

export interface ManimResult {
  /** Unique identifier for this render */
  id: string;
  /** Source code that was rendered */
  source: string;
  /** Hash of source for cache invalidation */
  sourceHash: string;
  /** Path to the rendered video file */
  videoPath?: string;
  /** Scene class name that was rendered */
  sceneName?: string;
  /** All scene classes found in the source */
  scenes: string[];
  /** Error message if rendering failed */
  error?: string;
  /** Timestamp of render completion */
  timestamp: number;
  /** Whether this result is from cache */
  fromCache: boolean;
}

export interface ManimExecutionOptions {
  /** Source code to execute */
  source: string;
  /** Specific scene to render (optional, renders first if not specified) */
  sceneName?: string;
  /** Quality setting */
  quality: 'low' | 'medium' | 'high' | '4k';
  /** Output directory */
  outputDir: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Manim executable path */
  manimPath: string;
  /** Python executable path */
  pythonPath: string;
}

export interface CodeBlockInfo {
  /** The source code from the code block */
  source: string;
  /** Line number where the code block starts */
  startLine: number;
  /** Line number where the code block ends */
  endLine: number;
  /** Unique identifier for this code block */
  blockId: string;
}

/** Quality flag mapping for manim CLI */
export const QUALITY_FLAGS: Record<ManimSettings['quality'], string> = {
  low: '-ql',      // 480p, 15fps
  medium: '-qm',   // 720p, 30fps
  high: '-qh',     // 1080p, 60fps
  '4k': '-qk',     // 4k, 60fps
};

/** Default settings */
export const DEFAULT_SETTINGS: ManimSettings = {
  pythonPath: 'python',
  manimPath: 'manim',
  autoRender: true,
  debounceMs: 1500,
  quality: 'low',
  previewWidth: 640,
  cacheDir: '.obsidian/plugins/obsidian-manim-preview/cache',
  renderTimeoutMs: 120000,
};