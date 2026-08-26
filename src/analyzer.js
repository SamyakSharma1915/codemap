'use strict';

const path = require('path');

// Builds the analysis model from scanned tree + parsed files.
// Resolves import specifiers to real files in the project (uncertain ones are
// marked and never displayed as confirmed).

function collectFiles(tree) {
  const files = [];
  (function walk(node, parent) {
    node.parent = parent;
    for (const c of node.children || []) {
      c.parent = node;
      if (c.isDir) walk(c, node);
      else files.push(c);
    }
  })(tree);
  return files;
}

function buildPathIndex(files) {
  const idx = new Map();
  const byStem = new Map(); // lowercase filename stem -> [files]
  for (const f of files) {
    const key = f.path.replace(/\\/g, '/').toLowerCase();
    idx.set(key, f);
    const stem = key
      .replace(/\/__init__\.py$/, '')
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '');
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(f);
  }
  return { idx, byStem };
}

function resolveImport(spec, fromFile, files, isTest, index) {
  const idx = index ? index.idx : buildPathIndex(files).idx;
  const find = (cand) => {
    const hit = idx.get(cand.toLowerCase());
    return hit || null;
  };
  // Strip quotes already removed. Handle './x', '../x', bare module names.
  let s = spec;
  if (!s) return null;

  // Root-relative web paths and common JavaScript aliases.
  if (s.startsWith('/')) s = s.replace(/^\/+/, '');
  if (s.startsWith('@/') || s.startsWith('~/')) {
    const aliasPath = s.slice(2);
    for (const prefix of ['src/', 'app/', '']) {
      const aliasHit = resolveImport(prefix + aliasPath, { ...fromFile, path: '__root__' }, files, isTest, index);
      if (aliasHit && aliasHit.file) return aliasHit;
    }
  }
  if (s.startsWith('#')) return { external: s, uncertain: true };

  // Python relative modules use dots rather than path separators.
  if (fromFile.language === 'Python' && s.startsWith('.')) {
    const leading = (s.match(/^\.+/) || [''])[0].length;
    const moduleName = s.slice(leading).split('.').filter(Boolean).join('/');
    const ups = '../'.repeat(Math.max(0, leading - 1));
    s = './' + ups + moduleName;
  }

  // Python dotted module path: a.b.c -> a/b/c.py or a/b/c/__init__.py
  if (s.includes('.') && !s.startsWith('.')) {
    const asPath = s.split('.').join('/');
    const pyCands = [asPath + '.py', asPath + '/__init__.py'];
    for (const cand of pyCands) {
      const hit = find(cand);
      if (hit) return { file: hit, uncertain: false };
    }
  }

  // relative path (also covers bare module names that resolve next to the importer,
  // e.g. Python's `import config` inside src/core/)
  let base = path.posix.dirname(fromFile.path).replace(/\\/g, '/');
  if (base === '.') base = '';
  const isRelative = s.startsWith('.');
  const isWebAsset = ['HTML', 'CSS', 'SCSS', 'Less'].includes(fromFile.language);
  const relTarget = isRelative || isWebAsset ? base + '/' + s : (base ? base + '/' + s : s);
  let target = path.posix.normalize(relTarget).replace(/^\.\//, '');
  if (target.startsWith('../')) {
    // outside project
    return { external: s, uncertain: true };
  }
  const stem = target.replace(/\.[^.]+$/, '');
  const exts = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.c', '.cpp', '.h', '.hpp', '.cc', '.rs', '.go', '.java', '.cs', '.dart', '.rb', '.php', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '/index.js', '/index.ts', '/index.tsx', '/index.py', '/__init__.py', '.json'];
  // Exact match with extension first (e.g. C `#include "parser.h"` should hit parser.h)
  const exact = find(target);
  if (exact) return { file: exact, uncertain: false };
  for (const e of exts) {
    const cand = stem + e;
    const hit = find(cand);
    if (hit) return { file: hit, uncertain: false };
  }
  // directory / module
  const dir = find(stem);
  if (dir) return { file: dir, uncertain: false };

  // Python bare import: from engine import X — search project-wide for a module
  // whose basename matches (marked uncertain if we guess). Uses prebuilt index.
  if (fromFile.language === 'Python' && /^[A-Za-z_]\w*$/.test(s)) {
    const hits = index ? (index.byStem.get(s.toLowerCase()) || []) : [];
    if (hits.length === 1) return { file: hits[0], uncertain: false };
    if (hits.length > 1) return { file: hits[0], uncertain: true };
  }

  // bare module: node_modules or stdlib. Try a best-effort within repo.
  if (/^[@a-zA-Z]/.test(s)) {
    const parts = s.split('/');
    const pkg = parts[0];
    const rel = parts.slice(1).join('/');
    const candidates = [
      `node_modules/${s}`,
      `node_modules/${pkg}/package.json`,
      ...(rel ? [`packages/${s}`, `src/${s}`, s] : []),
    ];
    for (const c of candidates) {
      const hit = find(c);
      if (hit) return { file: hit, uncertain: false };
    }
  }
  return { external: s, uncertain: true };
}

function countLines(src) {
  if (!src) return 0;
  return src.split(/\r?\n/).length;
}

function estimateComplexity(symbols, src) {
  if (!src) return 0;
  let score = 0;
  score += (src.match(/\b(if|elif|else|for|while|switch|case|catch|&&|\|\||\?\?|:)\b/g) || []).length;
  score += symbols.filter((s) => s.kind === 'function' || s.kind === 'method').length;
  return score;
}

function classifyComplexity(score) {
  if (score < 20) return 'Low';
  if (score < 60) return 'Medium';
  if (score < 150) return 'High';
  return 'Very High';
}

function analyzeProject(tree, fileAnalyses, rootDir) {
  const files = collectFiles(tree);
  const byPath = new Map();
  for (const f of files) byPath.set(f.path, f);

  const langCount = {};
  let totalLines = 0;

  for (const f of files) {
    const lang = f.language;
    langCount[lang] = (langCount[lang] || 0) + 1;
    const analysis = fileAnalyses.get(f.path) || { symbols: [], imports: [], language: lang };
    const src = analysis.raw || '';
    const loc = analysis.loc || countLines(src);
    totalLines += loc;
    const metrics = {
      loc,
      size: f.size,
      functions: analysis.symbols.filter((s) => s.kind === 'function' || s.kind === 'method' || s.kind === 'fn').length,
      classes: analysis.symbols.filter((s) => ['class', 'struct', 'interface', 'trait', 'enum', 'impl', 'type'].includes(s.kind)).length,
      imports: analysis.imports.length,
      complexityScore: estimateComplexity(analysis.symbols, src),
    };
    metrics.complexity = classifyComplexity(metrics.complexityScore);
    f.analysis = analysis;
    f.metrics = metrics;
  }

  // Resolve dependencies
  const deps = new Map(); // file -> Set of files
  const dependents = new Map(); // file -> Set of files
  const externalDeps = new Map();
  for (const f of files) {
    deps.set(f, new Set());
    dependents.set(f, new Set());
    externalDeps.set(f, new Set());
  }

  const pathIndex = buildPathIndex(files);
  for (const f of files) {
    const analysis = f.analysis || {};
    for (const imp of analysis.imports || []) {
      const resolved = resolveImport(imp.specifier, f, files, undefined, pathIndex);
      if (resolved && resolved.file) {
        deps.get(f).add(resolved.file);
        dependents.get(resolved.file).add(f);
      } else if (resolved && resolved.external) {
        externalDeps.get(f).add(resolved.external);
      }
    }
  }

  // Architecture groups: infer from folder names at depth <= 2
  function archGroup(f) {
    const p = f.path.replace(/\\/g, '/').split('/');
    const first = p[0];
    const known = ['src', 'lib', 'app', 'components', 'frontend', 'backend', 'api', 'server', 'client', 'core', 'utils', 'tests', 'test', 'spec', 'docs', 'db', 'database', 'models', 'routes', 'controllers', 'services', 'config', 'scripts', 'bin', 'public', 'assets', 'styles', 'hooks', 'store', 'types', 'middleware', 'migrations'];
    if (p.length > 1 && known.includes(first)) return first;
    if (p.length > 1 && known.includes(p[1])) return p[1];
    if (p.length > 1) return first;
    return 'root';
  }
  for (const f of files) f.archGroup = archGroup(f);

  // Entry points
  const entryRe = /^(main|app|index|server|cli|run)\./;
  const entryPoints = files.filter((f) => {
    const name = f.name;
    return entryRe.test(name) && (f.depth === 1 || f.path.includes('/src/'));
  });

  // Test detection: file name or folder
  for (const f of files) {
    const isTest = /(^|[._-])test[s]?([._-]|$)|\.spec\.|_test\.|test_|\.test\./.test(f.name) || /(^|[._-])test[s]?([._-]|$)/.test(f.name);
    f.isTest = isTest || f.parent?.name === 'tests' || f.parent?.name === 'test' || f.parent?.name === '__tests__';
  }

  return {
    files,
    totalLines,
    langCount,
    deps,
    dependents,
    externalDeps,
    entryPoints,
    fileCount: files.length,
  };
}

module.exports = { analyzeProject, collectFiles, resolveImport, classifyComplexity };
