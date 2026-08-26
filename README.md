<p align="center">
  <img src="assets/codemap-logo.png" alt="CodeMap logo" width="220">
</p>

<h1 align="center">CodeMap</h1>

<p align="center">
  A local-first interactive file tree, dependency flowchart, and architecture map for any software project.
</p>

CodeMap scans a project directory, detects source-code and web-asset
relationships, and turns them into navigable diagrams. The analysis stays on
your machine: no source code is uploaded and the web server listens only on
`127.0.0.1` by default.

## Features

- Interactive file-tree, dependency-graph, and architecture views
- SVG flowcharts with separate nodes and directional connectors
- Internal file dependencies and external package nodes
- Search, pan, zoom, node dragging, focus mode, and heatmaps
- File metrics, symbols, imports, complexity, and dependency details
- Source preview and editor protocol links
- Incremental analysis cache for fast rescans
- Standalone JSON, HTML, SVG, and GraphML exports
- Zero runtime dependencies

## Requirements

- Node.js 18 or newer
- npm, included with Node.js

## Installation

Clone the repository, then install CodeMap globally:

```bash
git clone https://github.com/SamyakSharma1915/codemap.git
cd codemap
npm install
npm install --global .
```

The global installation makes the `codemap` command available from any
directory:

```bash
codemap --version
```

For development, `npm link` provides the same command while keeping it linked
to your working copy:

```bash
npm install
npm link
```

You can also run the CLI without installing it globally:

```bash
node bin/codemap.js --help
```

## Quick start

Launch the interactive website:

```bash
codemap serve /path/to/project
```

Generate a dependency flowchart as an SVG image:

```bash
codemap graph /path/to/project
```

The graph command writes `codemap-graph.svg` to the current directory. Open it
automatically or select another destination with:

```bash
codemap graph /path/to/project --out project-flowchart.svg --open
```

Running CodeMap with only a directory is equivalent to `serve`:

```bash
codemap /path/to/project
```

## CLI reference

### `codemap serve [dir]`

Scans a directory, starts the local web application, and opens it in the
default browser.

```bash
codemap serve ./my-project
codemap serve ./my-project --port 9000
codemap serve ./my-project --no-open
codemap serve ./my-project --force
```

| Option | Description |
| --- | --- |
| `--port <number>` | Server port; defaults to `8787` |
| `--open` | Open the browser after startup |
| `--no-open` | Start the server without opening a browser |
| `--force` | Ignore cached analysis and rescan every file |

### `codemap graph [dir]`

Creates a dependency flowchart with files and packages represented as separate
nodes and dependencies represented by arrows.

```bash
codemap graph ./my-project
codemap graph ./my-project --out docs/dependencies.svg
codemap graph ./my-project --out map.svg --open --force
```

| Option | Description |
| --- | --- |
| `--out <file>` | SVG output path; defaults to `codemap-graph.svg` |
| `--open` | Open the generated SVG |
| `--force` | Rebuild analysis without using the cache |

### `codemap scan [dir]`

Prints project type, detected languages, file and line counts, parser results,
and scan duration without starting the website.

```bash
codemap scan ./my-project
```

### `codemap export [dir]`

Exports analysis for documentation or other tools.

```bash
codemap export ./my-project --format json --out map.json
codemap export ./my-project --format html --out map.html
codemap export ./my-project --format svg --out tree.svg
codemap export ./my-project --format graphml --out map.graphml
```

| Format | Purpose |
| --- | --- |
| `json` | Complete serialized project model and graphs |
| `html` | Standalone interactive map |
| `svg` | Portable file-tree diagram |
| `graphml` | Import into tools such as Gephi or yEd |

### `codemap init`

Creates a `.codemapignore` file in the target directory:

```bash
cd /path/to/project
codemap init
```

### `codemap clean [dir]`

Removes the incremental analysis cache:

```bash
codemap clean ./my-project
```

## Web interface

After running `codemap serve`, open `http://127.0.0.1:8787` unless another
port was selected.

### Views

| View | Description | Shortcut |
| --- | --- | --- |
| File Tree | Project folders and files | `T` |
| Graph | Full internal and external dependency flowchart | `V` |
| Dependency | Dependency relationships between files and packages | `G` |
| Architecture | Files grouped by inferred architectural area | `A` |

The **Download SVG** button exports the displayed view. Use the zoom controls
or press `R` to fit the full diagram.

### Navigation shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `T` | File Tree view |
| `V` | Graph view |
| `G` | Dependency view |
| `A` | Architecture view |
| `R` | Fit graph to viewport |
| `H` | Cycle heatmap mode |
| `X` | Open selected file preview |
| `F` | Focus selected file |
| `E` | Expand selected folder |
| `C` | Collapse selected folder |

Drag the canvas to pan, use the mouse wheel to zoom, drag nodes to adjust the
layout, click a node for details, and double-click a file to preview its source.

## Dependency detection

CodeMap displays files even when they have no outgoing dependencies. Resolved
project files are normal file nodes; external packages and unresolved modules
are purple external nodes.

Detection includes:

- JavaScript and TypeScript static imports, side-effect imports, dynamic
  imports, re-exports, and CommonJS `require()` calls
- Common JavaScript aliases such as `@/components/Button`
- Python absolute and relative imports
- C/C++ includes and language-specific imports for supported C-family parsers
- HTML `src`, `href`, `action`, `poster`, `data-src`, and `srcset` references
- CSS, SCSS, and Less `@import` and `url()` references
- Best-effort references for additional supported source languages

Remote URLs, data URLs, page fragments, email links, and telephone links are
excluded from local dependency resolution.

## Ignoring files

CodeMap automatically ignores `.git`, `.codemap`, `node_modules`, `dist`,
`build`, coverage output, virtual environments, and editor metadata.

Add project-specific patterns to `.codemapignore`, one per line:

```gitignore
# Generated documentation
docs/generated

# Large fixture directory
fixtures/archive/**
```

Create the starter file with `codemap init`.

## Cache behavior

Parsed results are stored in `<project>/.codemap/codemap-cache.json`. Entries
are keyed by file path, modification time, and size. Incompatible cache
versions are invalidated automatically.

Force fresh analysis with either command:

```bash
codemap serve ./my-project --force
codemap clean ./my-project
```

## Supported languages

CodeMap recognizes Python, JavaScript, TypeScript, C, C++, C#, Java, Kotlin,
Go, Rust, Swift, Objective-C, Zig, Dart, Ruby, PHP, Lua, Elixir, Erlang,
Haskell, Clojure, OCaml, F#, VB.NET, Scala, Shell, PowerShell, SQL, HTML, CSS,
SCSS, Less, Vue, Svelte, Astro, JSON, YAML, TOML, XML, Markdown, Dockerfile,
Makefile, CMake, and Gradle files.

Parser depth varies by language. JavaScript/TypeScript, Python, C-family, HTML,
and stylesheet formats receive specialized analysis; other formats use a
conservative fallback parser.

## Project structure

```text
assets/              Project branding
bin/                 Executable entry point
src/                 Scanner, analyzer, graph engine, server, and exporters
src/parse/           Language-specific dependency and symbol extraction
web/                 Local interactive web interface
test/                Dependency-free test runner
test-fixture*/       End-to-end language fixtures
```

## Development

Install and run all checks:

```bash
npm install
npm run check
```

Run only the tests:

```bash
npm test
```

The test runner uses Node.js directly and requires no test framework. GitHub
Actions runs checks on Node.js 18, 20, and 22.

## Troubleshooting

### The terminal prints file names instead of opening a graph

Use `graph` to generate an SVG or `serve` to open the interactive interface:

```bash
codemap graph /path/to/project --open
codemap serve /path/to/project
```

### New dependencies do not appear

Force a fresh scan, select **Graph** or **Dependency**, and press `R` to fit all
nodes:

```bash
codemap serve /path/to/project --force
```

### Port 8787 is already in use

```bash
codemap serve /path/to/project --port 9000
```

### The browser does not open

```bash
codemap serve /path/to/project --no-open
```

Open the URL printed in the terminal manually.

### A generated graph is too large

SVG remains scalable at any resolution. Open it in a browser or vector editor,
or use the website to pan, zoom, focus a node, and export the current view.

## Security and privacy

- The local server binds to `127.0.0.1`, not the public network interface.
- Source code remains on the machine running CodeMap.
- The file-preview endpoint restricts reads to the scanned project root.
- Exports may contain project paths, filenames, symbols, and package names;
  review them before publishing.

## Contributing

1. Fork the repository and create a feature branch.
2. Add or update fixtures and tests for behavior changes.
3. Run `npm run check`.
4. Open a pull request describing the change and verification performed.

Keep dependency extraction conservative: confirmed local files should resolve
to file nodes, while unresolved or third-party modules should remain external
nodes rather than being silently discarded.

## License

CodeMap is available under the [MIT License](LICENSE).
