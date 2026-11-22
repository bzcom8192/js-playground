# JavaScript Playground

A modern, interactive JavaScript playground built with React, Vite, and Monaco Editor.

## Features

### 🎨 **Monaco Editor with Full Syntax Highlighting**
- VS Code-like editing experience
- Custom color theme with proper token highlighting:
  - Keywords (`true`, `false`, `const`, etc.) in **blue**
  - Identifiers (`console`, variables) in **light blue**
  - Methods (`.log`, `.map`, etc.) in **yellow**
  - Strings in **orange**
  - Numbers in **light green**
  - Comments in **green**
- Auto-completion and IntelliSense
- Bracket matching and auto-closing

### ✅ **Real-Time ESLint Linting**
- **Client-side linting** - runs entirely in the browser
- See errors and warnings as you type (with 500ms debounce)
- Red/yellow squiggly underlines for errors/warnings
- Hover tooltips showing lint messages
- Configurable rules (see `LINTER_INFO.md` for details)

### 🎯 **Smart Console**
- **Interactive Numbers**: Click numbers to toggle between Hex/Decimal
- **Interactive Booleans**: Click to cycle through True/Yes/1
- **Smart Strings**: 
  - Color previews for hex and rgb colors
  - Clickable URLs
- **Object Inspector**: Expandable/collapsible objects and arrays

### 💾 **Code Management**
- **Auto-save**: Code persists in localStorage
- **Snapshot History**: Save and restore code snapshots
- **Export/Import**: Save sessions as JSON files
- **Reset**: Clear everything and start fresh

### ⚡ **Execution Features**
- Run code with Ctrl+Enter or Cmd+Enter
- Auto-run mode (toggleable)
- Captures `console.log`, `console.warn`, `console.error`, `console.info`
- Clear console with `console.clear()`

### 🤖 **Semicolon Acres** (second page: `#/farmer`)
A farming-automation game. Write plain JavaScript (no `await`) as the plan for a
solar-powered field bot: it ploughs, plants and harvests, the harvest pays for
upgrades in the Workshop, and later a whole crew of bots works the farm from one
program. With weather, daily contracts, hedge labyrinths, an arena and an optional
online leaderboard with replay-verified runs. Open it from the **Semicolon Acres**
link in the header, or go to `/#/farmer` (`/#/farmer?demo=1` shows a grown farm).
The in-game **Field Guide** has the full API and example programs.
The editor/keyboard-shortcut audit is in [AUDIT.md](AUDIT.md).

## Getting Started

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Tests (Semicolon Acres engine)
```bash
npm run test:farmer   # node --test, no extra dependencies
npm run test:server   # the Online server
```

### Online server (Semicolon Acres)
```bash
npm run build && npm run server   # game + API on http://127.0.0.1:4188
```
See [server/README.md](server/README.md) for the settings, the production install
(systemd + Apache) and backups.

## Linter Configuration

The playground includes a comprehensive ESLint configuration that checks for:
- Common errors (undefined variables, duplicate keys, etc.)
- Best practices (no eval, proper comparisons, etc.)
- Modern JavaScript patterns (prefer const, arrow functions, etc.)
- Code style (semicolons, spacing, etc.)

To customize linting rules, edit `src/utils/eslintConfig.js`.

See `LINTER_INFO.md` for complete documentation.

## Technology Stack

- **React 19** - UI library
- **Vite 8** - Build tool and dev server
- **Monaco Editor 0.55** - Code editor (powers VS Code)
- **Tailwind CSS 4** - Styling
- **ESLint** - Linting (client-side via `eslint-linter-browserify`)

## Project Structure

```
js-playground/
├── src/
│   ├── components/
│   │   ├── MonacoEditor.jsx       # Monaco editor wrapper with linting
│   │   ├── ObjectInspector.jsx    # Object/array viewer
│   │   ├── SmartString.jsx        # Smart string rendering
│   │   ├── NumberToggle.jsx       # Interactive numbers
│   │   ├── BooleanToggle.jsx      # Interactive booleans
│   │   └── icons/                 # SVG icons
│   ├── utils/
│   │   ├── eslintConfig.js        # ESLint rules configuration
│   │   └── linter.js              # Browser-based linting logic
│   ├── farmer/                    # Semicolon Acres page (game engine, transform, UI, tests)
│   ├── hooks/usePageShortcuts.js  # Page-level keyboard shortcuts
│   ├── App.jsx                    # Playground page
│   ├── Root.jsx / router.js       # Tiny hash router (#/ and #/farmer)
│   ├── main.jsx                   # Entry point
│   └── index.css                  # Global styles
├── public/                        # Static assets
├── LINTER_INFO.md                 # Linter documentation
└── package.json
```

## Features in Detail

### Monaco Editor Setup
- Custom tokenizer for better JavaScript syntax highlighting
- TypeScript language service for IntelliSense
- Custom dark theme matching VS Code
- Configured for optimal JavaScript editing

### ESLint Integration
- Runs in browser using `eslint-linter-browserify`
- Debounced linting (500ms after typing stops)
- Visual markers (red/yellow underlines)
- Hover tooltips with error details
- Over 60+ configured rules

### Console Features
Every console output is enhanced:
- Numbers become interactive toggles
- Booleans cycle through representations
- Colors show visual previews
- URLs become clickable links
- Objects can be expanded/collapsed

## Keyboard Shortcuts

Press **⌨** in the header (or `?` when not typing) for the full list.

- **Ctrl/Cmd + Enter**: Run code (Semicolon Acres: Run / Stop)
- **Ctrl/Cmd + S**: Save snapshot (Semicolon Acres: save code + farm)
- **Esc**: Close History / dialogs
- **Tab** (in autocomplete): Accept suggestion
- Standard Monaco shortcuts (Ctrl+F find, Ctrl+H replace, Shift+Alt+F format, Ctrl+/ comment, F1 command palette, …)

## Browser Support

Works in all modern browsers that support:
- ES2020+ JavaScript features
- Web Workers
- LocalStorage

## Contributing

Feel free to open issues or submit pull requests!

## License

MIT

---

Built with ❤️ using React + Vite + Monaco Editor
