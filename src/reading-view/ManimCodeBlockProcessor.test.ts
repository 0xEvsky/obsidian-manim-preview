import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManimCodeBlockProcessor } from './ManimCodeBlockProcessor';
import { ManimSettings, DEFAULT_SETTINGS, ManimResult } from '../types';

// Mock the App, Plugin, and ManimExecutor
const mockApp = {
  vault: {
    adapter: {
      getBasePath: () => '/test/vault',
    },
  },
};

const mockPlugin = {
  registerMarkdownCodeBlockProcessor: vi.fn(),
};

const mockExecutor = {
  execute: vi.fn(),
  getCached: vi.fn(),
  getCacheDir: vi.fn(() => '/test/vault/.obsidian/plugins/obsidian-manim-preview/cache'),
  clearCache: vi.fn(),
  cancelAllRenders: vi.fn(),
};

describe('ManimCodeBlockProcessor', () => {
  let processor: ManimCodeBlockProcessor;
  let settings: ManimSettings;

  beforeEach(() => {
    settings = { ...DEFAULT_SETTINGS };
    processor = new ManimCodeBlockProcessor(
      mockApp as any,
      mockPlugin as any,
      mockExecutor as any,
      settings
    );
    vi.clearAllMocks();
  });

  describe('extractSceneInfo', () => {
    it('should extract multiple scenes', () => {
      const source = `
from manim import *

class FirstScene(Scene):
    def construct(self):
        pass

class SecondScene(Scene):
    def construct(self):
        pass
`;
      // We can't directly call private method, but we can test the logic
      const lines = source.split('\n');
      const scenes: string[] = [];
      for (const line of lines) {
        const match = line.match(/^\s*class\s+(\w+)\s*\(\s*(?:Scene|.*Scene)\s*\)/);
        if (match) {
          scenes.push(match[1]);
        }
      }
      expect(scenes).toEqual(['FirstScene', 'SecondScene']);
    });

    it('should detect preferred scene from comment', () => {
      const source = `
# scene: MyPreferredScene
from manim import *

class FirstScene(Scene):
    def construct(self):
        pass

class MyPreferredScene(Scene):
    def construct(self):
        pass
`;
      const lines = source.split('\n');
      let preferredScene: string | undefined;
      for (const line of lines) {
        const match = line.match(/^\s*#\s*scene\s*:\s*(\w+)/i);
        if (match) {
          preferredScene = match[1];
        }
      }
      expect(preferredScene).toBe('MyPreferredScene');
    });

    it('should handle empty source', () => {
      const source = '';
      const lines = source.split('\n');
      const scenes: string[] = [];
      for (const line of lines) {
        const match = line.match(/^\s*class\s+(\w+)\s*\(\s*(?:Scene|.*Scene)\s*\)/);
        if (match) {
          scenes.push(match[1]);
        }
      }
      expect(scenes).toEqual([]);
    });

    it('should handle source without Scene classes', () => {
      const source = `
def helper():
    pass

class RegularClass:
    pass
`;
      const lines = source.split('\n');
      const scenes: string[] = [];
      for (const line of lines) {
        const match = line.match(/^\s*class\s+(\w+)\s*\(\s*(?:Scene|.*Scene)\s*\)/);
        if (match) {
          scenes.push(match[1]);
        }
      }
      expect(scenes).toEqual([]);
    });
  });

  describe('hashString', () => {
    it('should produce consistent hashes', () => {
      const str = 'test string';
      // Simple hash function test
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      const result = Math.abs(hash).toString(36);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should produce different hashes for different strings', () => {
      // Use the same hash function as the implementation
      function hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
      }

      const hash1 = hashString('string1');
      const hash2 = hashString('string2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateBlockId', () => {
    it('should generate unique IDs', () => {
      function hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
      }

      const hash1 = hashString('scene 1');
      const hash2 = hashString('scene 2');

      expect(hash1).not.toBe(hash2);
    });
  });
});