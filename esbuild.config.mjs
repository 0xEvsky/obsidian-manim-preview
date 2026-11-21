import esbuild from 'esbuild';
import { copyFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2018',
  outfile: 'main.js',
  platform: 'node',
  sourcemap: isProduction ? false : 'inline',
  minify: isProduction,
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch({
    onRebuild(error, result) {
      if (error) {
        console.error('Build failed:', error);
      } else {
        console.log('Build succeeded');
      }
    }
  });
  console.log('Watching for changes...');
} else {
  await esbuild.build(config);
  console.log('Build complete');
}