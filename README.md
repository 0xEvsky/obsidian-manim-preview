# Manim Preview for Obsidian

An Obsidian community plugin that integrates **Manim Community Edition** directly into your notes. Write Manim code blocks and see animated previews right inside Obsidian — no external tools required.

## Features

- 🎬 **Inline Previews** — Render Manim animations directly in your notes (Reading View)
- ⚡ **Auto-Render** — Automatically re-render when code changes (configurable debounce)
- 🎯 **Scene Selection** — Automatically detects multiple Scene classes
- 💾 **Smart Caching** — Caches renders by content hash for instant reloads
- ⚙️ **Configurable Quality** — Low/Medium/High/4K quality settings
- 🔧 **Custom Paths** — Configure Python and Manim executable paths
- 📱 **Responsive Video Player** — Native HTML5 video with controls
- 🎨 **Theme Aware** — Adapts to your Obsidian theme (light/dark)
- 🔬 **Live Preview (Experimental)** — See previews while editing in Live Preview mode

## Installation

### From Source (Development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/your/vault/.obsidian/plugins
   git clone https://github.com/yourusername/obsidian-manim-preview.git
   cd obsidian-manim-preview
   npm install
   npm run build
   ```

2. Enable the plugin in Obsidian:
   - Open Settings → Community Plugins
   - Toggle "Manim Preview" on

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create folder: `.obsidian/plugins/obsidian-manim-preview/` in your vault
3. Place the three files in that folder
4. Enable in Obsidian Settings → Community Plugins

## Prerequisites

- **Python 3.8+** installed and in PATH (or configured in settings)
- **Manim Community Edition** installed: `pip install manim`
- **FFmpeg** installed and in PATH (required by Manim for video encoding)
- **Obsidian 1.5.0+** (desktop only)

### Windows Notes

- Ensure Python and FFmpeg are in your system PATH
- If using a virtual environment, set the Python path to the venv's python.exe
- Paths with spaces are supported (automatically quoted)

## Usage

### Basic Example

Create a code block with the `manim` language identifier:

```manim
from manim import *

class CreateCircle(Scene):
    def construct(self):
        circle = Circle()
        self.play(Create(circle))
        self.wait()
```

In **Reading View**, you'll see a "Render" button below the code block. Click it to generate the animation preview.

### Multiple Scenes

If your code contains multiple Scene classes, the plugin will automatically detect them and render the first one. You can specify which scene to render by adding a comment at the top:

```manim
# scene: MyCustomScene
from manim import *

class FirstScene(Scene):
    def construct(self):
        self.play(Create(Circle()))

class MyCustomScene(Scene):
    def construct(self):
        self.play(Create(Square()))
```

### Auto-Render

Enable "Auto Render" in settings to automatically re-render when you modify the code block. The plugin debounces changes (default 1.5s) to avoid excessive rendering.

### Keyboard Shortcut

- **Ctrl+Shift+M** (Cmd+Shift+M on Mac): Render all Manim blocks in current note

## Configuration

Open Settings → Community Plugins → Manim Preview to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| **Python Executable** | Path to Python executable | `python` |
| **Manim Executable** | Path to manim (or leave empty for `python -m manim`) | `manim` |
| **Auto Render** | Automatically render on code change | `true` |
| **Debounce Delay** | Wait time before auto-render (ms) | `1500` |
| **Render Quality** | Video quality preset | `low` (480p, 15fps) |
| **Preview Width** | Maximum video width (px) | `640` |
| **Cache Directory** | Relative path for cached renders | `.obsidian/plugins/obsidian-manim-preview/cache` |
| **Render Timeout** | Max render time (ms) | `120000` |
| **Live Preview (Experimental)** | Show previews in editing view | `false` |

### Quality Presets

| Preset | Resolution | FPS | Best For |
|--------|------------|-----|----------|
| Low | 854×480 | 15 | Quick previews, iterating |
| Medium | 1280×720 | 30 | Balanced quality/speed |
| High | 1920×1080 | 60 | High-quality previews |
| 4K | 3840×2160 | 60 | Final renders |

## Commands

| Command | Description |
|---------|-------------|
| `Render all Manim blocks in current note` | Triggers render for all manim code blocks |
| `Clear Manim render cache` | Removes all cached video files |
| `Open Manim Preview settings` | Opens the plugin settings tab |

## How It Works

1. **Code Block Detection** — Registers a Markdown code block processor for ````manim```` fenced blocks
2. **Scene Extraction** — Parses Python source to find `class X(Scene)` definitions
3. **Temp File Creation** — Writes source to a temporary `.py` file
4. **Manim Execution** — Runs `manim render` (or `python -m manim render`) with configured quality
5. **Output Discovery** — Locates generated MP4 in Manim's output directory structure
6. **Caching** — Copies video to plugin cache with content-based hash filename
7. **Display** — Embeds video via HTML5 `<video>` element in Reading View

## Security Notice

⚠️ **This plugin executes Python code locally with your user permissions.**

- Only render code from trusted sources
- The plugin does **not** execute code automatically on note open
- Auto-render only triggers when you modify a code block and pause typing
- You can disable auto-render in settings
- Review code before clicking "Render" on unfamiliar notes

## Troubleshooting

### "Manim not found" / "Python not found"

1. Verify Python/Manim are installed: `python --version` and `manim --version`
2. Check the configured paths in Settings → Manim Preview
3. Use "Test Configuration" button in settings to verify

### Render Fails / No Video Output

1. Check the error message displayed below the code block
2. Ensure FFmpeg is installed: `ffmpeg -version`
3. Try rendering manually in terminal to see full output:
   ```bash
   manim -ql your_scene.py SceneName
   ```

### Video Doesn't Play

- Ensure the video file exists at the cached path
- Some corporate environments block `file://` URLs — try opening the cached file directly
- Check browser console (Ctrl+Shift+I) for errors

### Cache Issues

- Use "Clear Manim render cache" command
- Or manually delete `.obsidian/plugins/obsidian-manim-preview/cache/`

## Development

### Project Structure

```
src/
├── main.ts                    # Plugin entry point
├── types.ts                   # Shared TypeScript interfaces
├── settings/
│   ├── Settings.ts            # Settings management
│   └── SettingsTab.ts         # Settings UI
├── execution/
│   └── ManimExecutor.ts       # Manim process execution & caching
├── reading-view/
│   └── ManimCodeBlockProcessor.ts  # Reading View code block handler
└── live-preview/
    ├── ManimViewPlugin.ts     # CodeMirror 6 ViewPlugin
    ├── ManimWidget.ts         # Widget for preview UI
    └── index.ts               # Exports
```

### Build Commands

```bash
npm run dev      # Watch mode for development
npm run build    # Production build
npm run lint     # Run ESLint
npm run test     # Run tests (Vitest)
```

### Live Preview Implementation

The Live Preview integration uses CodeMirror 6 ViewPlugin with block widgets:
- Registers via `registerEditorExtension()` 
- Externalizes `@codemirror/*` in esbuild to avoid version conflicts
- Uses `Decoration.replace({ widget, block: true })` to replace code blocks
- Widgets include scene selector, render button, and video player
- Enabled via "Live Preview (Experimental)" setting (requires reload)

## Roadmap

- [x] **Milestone 1** — Proof of Concept (Reading View rendering)
- [x] **Milestone 2** — Usable Plugin (auto-render, scene selector, caching, Ctrl+Enter shortcut)
- [x] **Milestone 3** — Live Preview Integration (CodeMirror 6 ViewPlugin with block widgets)
- [ ] **Milestone 4** — Polish (theme-aware styling, keyboard shortcuts, GIF export, tests)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` and `npm run lint`
5. Submit a pull request

## License

MIT License — see LICENSE file for details.

## Acknowledgments

- [Manim Community Edition](https://github.com/ManimCommunity/manim) — The animation engine
- [Obsidian Plugin API](https://docs.obsidian.md/Plugins/) — Plugin platform
- [VS Code Manim Sideview](https://github.com/Rickaym/Manim-Sideview) — UX inspiration
- [obsidian-execute-python](https://github.com/WilliamEchols/obsidian-execute-python) — Execution patterns
- [obsidian-puml-viewer](https://github.com/AndreyKolygin/obsidian-puml-viewer) — Rendering architecture

## Support

- Report issues on [GitHub Issues](https://github.com/yourusername/obsidian-manim-preview/issues)
- Check [Manim Documentation](https://docs.manim.community/) for animation help
- Check [Obsidian Plugin Docs](https://docs.obsidian.md/Plugins/) for plugin development