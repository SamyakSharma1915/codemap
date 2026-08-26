'use strict';

const fs = require('fs');
const path = require('path');
const { Scanner } = require('./scanner');
const { languageForFile } = require('./langs');
const { detectProject } = require('./detector');
const { parseFile } = require('./parse');
const { analyzeProject } = require('./analyzer');
const { Cache } = require('./cache');
const { buildFilesystemGraph, buildDependencyGraph, buildArchitectureGraph, layout } = require('./graph');
const { gatherGitInfo, isGitRepo, getStatus } = require('./git');

function cacheDirFor(rootDir) {
  const dot = path.join(rootDir, '.codemap');
  try {
    if (!fs.existsSync(dot)) fs.mkdirSync(dot, { recursive: true });
  } catch {}
  return dot;
}

// Full pipeline: scan -> parse (incremental, parallel) -> analyze.
function buildModel(rootDir, opts = {}) {
  const root = path.resolve(rootDir || '.');
  const cache = opts.cache === false ? null : new Cache(cacheDirFor(root)).load();

  const scanner = new Scanner(root, opts);
  const { root: tree, stats } = scanner.scan();

  // attach language to each file node
  (function walk(node) {
    for (const c of node.children || []) {
      if (!c.isDir) c.language = languageForFile(c.name, c.path);
      if (c.isDir) walk(c);
    }
  })(tree);

  const start = Date.now();
  const fileAnalyses = new Map();
  let parsed = 0;
  let cachedHits = 0;
  let errors = 0;

  // collect files
  const fileList = [];
  (function collect(node) {
    for (const c of node.children || []) {
      if (c.isDir) collect(c);
      else fileList.push(c);
    }
  })(tree);

  const concurrency = opts.concurrency || Math.min(8, require('os').cpus().length || 4);
  const queue = [...fileList];
  let idx = 0;

  function worker() {
    return new Promise((resolve) => {
      function next() {
        while (idx < queue.length) {
          const f = queue[idx++];
          const fp = path.join(root, f.path.split('/').join(path.sep));
          let stat;
          try {
            stat = fs.statSync(fp);
          } catch {
            errors++;
            continue;
          }
          const lang = f.language;
          let analysis = null;
          if (cache) analysis = cache.get(fp, stat);
          if (analysis) {
            cachedHits++;
          } else {
            analysis = parseFile(fp, { language: lang });
            analysis.loc = (() => {
              try { return fs.readFileSync(fp, 'utf8').split(/\r?\n/).length; } catch { return 0; }
            })();
            parsed++;
            if (cache) cache.put(fp, stat, analysis);
          }
          f.analysis = analysis;
          f.metrics = { loc: analysis.loc, size: f.size };
          fileAnalyses.set(f.path, analysis);
        }
        resolve();
      }
      next();
    });
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  return Promise.all(workers).then(() => {
    if (cache) cache.save();
    const project = detectProject(root, tree);
    const model = analyzeProject(tree, fileAnalyses, root);

    // attach parsed symbols to file nodes
    for (const f of model.files) {
      f.analysis = fileAnalyses.get(f.path);
      if (!f.metrics) {
        f.metrics = {
          loc: f.analysis ? f.analysis.loc : 0,
          size: f.size,
          functions: f.analysis ? (f.analysis.symbols || []).filter((s) => ['function', 'method', 'fn'].includes(s.kind)).length : 0,
          classes: f.analysis ? (f.analysis.symbols || []).filter((s) => ['class', 'struct', 'interface', 'trait', 'enum', 'impl'].includes(s.kind)).length : 0,
          imports: f.analysis ? (f.analysis.imports || []).length : 0,
        };
      }
      if (f.analysis && f.analysis.error) errors++;
    }

    const timing = { scanMs: 0, parseMs: Date.now() - start, cached: cachedHits, parsed, errors };

    // git info (best-effort, local only)
    let git = null;
    if (opts.git !== false && isGitRepo(root)) {
      try {
        git = gatherGitInfo(root);
      } catch {
        git = null;
      }
    }

    return { root: tree, project, model, timing, stats, git, cacheStats: cache ? cache.stats() : null };
  });
}

function buildGraphs(model) {
  const fileGraph = buildFilesystemGraph(model.root, model);
  const depGraph = buildDependencyGraph(model.model, model);
  const archGraph = buildArchitectureGraph(model.model, model);
  return {
    filesystem: layout(fileGraph, { nodeW: 150, nodeH: 52 }),
    dependency: layout(depGraph, { nodeW: 210, nodeH: 62, gapX: 70, gapY: 100 }),
    architecture: layout(archGraph, { nodeW: 190, nodeH: 58, gapX: 60, gapY: 90 }),
  };
}

module.exports = { buildModel, buildGraphs, cacheDirFor };
