'use strict';

const fs = require('fs');
const path = require('path');
const { buildModel, buildGraphs, cacheDirFor } = require('./index');
const { exportJSON, exportHTML, exportSVG, exportGraphML } = require('./export');
const { startServer } = require('./server');
const pkg = require('../package.json');

const VERSION = pkg.version;
const MAX_FILES = 50000;

function printHelp() {
  console.log(`CodeMap ${VERSION} — interactive visual map of a software project.

Usage:
  codemap [dir]           Scan and open the interactive map
  codemap scan [dir]      Scan and print a summary
  codemap serve [dir]     Start local server + open the web UI
  codemap graph [dir]     Generate an SVG dependency flowchart
  codemap export [dir]    Export the map (formats: json, html, svg, graphml)
  codemap init            Create a .codemapignore file
  codemap clean [dir]     Remove the analysis cache
  codemap --help          Show this help
  codemap --version       Show version

Options:
  --port <n>        Server port (default 8787)
  --format <fmt>    Export format (json|html|svg|graphml)
  --out <file>      Export destination path
  --open            Open the browser after serving
  --no-open         Do not open the browser
  --force           Ignore cache and rescan
`);
}

async function run(argv) {
  const args = [...argv];
  const opts = {
    port: 8787,
    format: 'json',
    out: null,
    open: undefined,
    force: false,
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h' || a === 'help') { printHelp(); return; }
    if (a === '--version' || a === '-v' || a === 'version') { console.log(VERSION); return; }
    if (a === '--port') { opts.port = parseInt(args[++i], 10) || 8787; continue; }
    if (a === '--format') { opts.format = args[++i] || 'json'; continue; }
    if (a === '--out' || a === '-o') { opts.out = args[++i]; continue; }
    if (a === '--open') { opts.open = true; continue; }
    if (a === '--no-open') { opts.open = false; continue; }
    if (a === '--force') { opts.force = true; continue; }
    if (a.startsWith('-')) { console.error(`Unknown option: ${a}`); printHelp(); process.exit(1); }
    positional.push(a);
  }

  let command = 'serve';
  if (positional[0] === 'scan' || positional[0] === 'serve' || positional[0] === 'graph' ||
      positional[0] === 'export' || positional[0] === 'init' || positional[0] === 'clean') {
    command = positional.shift();
  }

  const dir = positional[0] || '.';
  const root = path.resolve(dir);

  switch (command) {
    case 'init': return cmdInit(root);
    case 'clean': return cmdClean(root);
    case 'scan': return cmdScan(root, opts);
    case 'graph': return cmdGraph(root, opts);
    case 'export': return cmdExport(root, opts);
    case 'serve':
    default: return cmdServe(root, opts);
  }
}

function cmdInit(root) {
  const file = path.join(root, '.codemapignore');
  if (fs.existsSync(file)) {
    console.log('.codemapignore already exists.');
    return;
  }
  fs.writeFileSync(file, '# CodeMap ignore patterns (one per line)\nnode_modules\ndist\nbuild\n.git\n');
  console.log('Created .codemapignore');
}

function cmdClean(root) {
  const dir = cacheDirFor(root);
  const cacheFile = path.join(dir, 'codemap-cache.json');
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
    console.log('Cleared CodeMap cache.');
  } else {
    console.log('No cache found.');
  }
}

async function cmdScan(root, opts) {
  const t0 = Date.now();
  const model = await buildModel(root, { force: opts.force });
  const ms = Date.now() - t0;
  console.log(`Project:  ${model.project.name}`);
  console.log(`Type:     ${model.project.type}${model.project.framework ? ' (' + model.project.framework + ')' : ''}`);
  console.log(`Language: ${model.project.languages.join(', ')}`);
  console.log(`Files:    ${model.model.fileCount}  (scanned ${model.stats.files}, skipped ${model.stats.skipped}, dirs ${model.stats.dirs})`);
  console.log(`Lines:    ${model.model.totalLines.toLocaleString()}`);
  console.log(`Parsed:   ${model.timing.parsed} fresh, ${model.timing.cached} cached, ${model.timing.errors} errors`);
  console.log(`Time:     ${(ms / 1000).toFixed(2)}s`);
}

async function cmdGraph(root, opts) {
  const model = await buildModel(root, { force: opts.force });
  const { dependency } = buildGraphs(model);
  if (!dependency.nodes.length) {
    console.log('No analyzable relationships found.');
    return;
  }
  const outPath = path.resolve(opts.out || path.join(process.cwd(), 'codemap-graph.svg'));
  fs.writeFileSync(outPath, exportSVG(model, { filesystem: dependency }), 'utf8');
  console.log(`Generated dependency flowchart: ${outPath}`);

  if (opts.open === true) {
    try {
      const { execFile } = require('child_process');
      const openCmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const openArgs = process.platform === 'win32' ? ['/c', 'start', '', outPath] : [outPath];
      execFile(openCmd, openArgs);
    } catch {}
  }
}

async function cmdExport(root, opts) {
  const fmt = opts.format.toLowerCase();
  const model = await buildModel(root, { force: opts.force });
  const graphs = buildGraphs(model);
  let outPath = opts.out;
  if (!outPath) outPath = path.join(process.cwd(), `codemap-export.${fmt === 'graphml' ? 'graphml' : fmt}`);
  if (outPath.toLowerCase().endsWith('.json') && fmt === 'html') outPath = outPath.replace(/\.json$/, '.html');

  switch (fmt) {
    case 'json':
      fs.writeFileSync(outPath, JSON.stringify(exportJSON(model, graphs), null, 2), 'utf8');
      break;
    case 'html':
      fs.writeFileSync(outPath, exportHTML(model, graphs), 'utf8');
      break;
    case 'svg':
      fs.writeFileSync(outPath, exportSVG(model, graphs), 'utf8');
      break;
    case 'graphml':
      fs.writeFileSync(outPath, exportGraphML(model, graphs), 'utf8');
      break;
    default:
      console.error(`Unknown format: ${fmt}. Use json, html, svg or graphml.`);
      process.exit(1);
  }
  console.log(`Exported ${fmt} to ${outPath}`);
}

async function cmdServe(root, opts) {
  if (!fs.existsSync(root)) {
    console.error(`Directory not found: ${root}`);
    process.exit(1);
  }
  const model = await buildModel(root, { force: opts.force });
  const graphs = buildGraphs(model);
  const payload = JSON.stringify(exportJSON(model, graphs));
  const url = await startServer(root, payload, model, opts);
  console.log('CodeMap is running at:');
  console.log('  ' + url);
  if (opts.open !== false) {
    try {
      const { exec } = require('child_process');
      const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${startCmd} "${url}"`);
    } catch {}
  }
}

module.exports = { run, VERSION };
