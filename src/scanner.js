'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORES = [
  '.git', '.hg', '.svn',
  '.codemap',
  'node_modules', 'bower_components',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.cache',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.tox', '.venv', 'venv', 'env',
  '.coverage', '.nyc_output', 'coverage',
  'vendor', '.gradle',
  '.idea', '.vscode', '*.swp', '*.swo', '.DS_Store',
  'tmp', 'temp', '*.pyc', '*.pyo',
];

function toRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\u0000/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function defaultIgnoreRegexps() {
  return DEFAULT_IGNORES.map(toRegExp);
}

function loadUserIgnores(rootDir) {
  const regexps = defaultIgnoreRegexps();
  const ignoreFile = path.join(rootDir, '.codemapignore');
  if (!fs.existsSync(ignoreFile)) return { regexps, paths: [] };
  try {
    const lines = fs
      .readFileSync(ignoreFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const line of lines) {
      const neg = line.startsWith('!');
      const pat = neg ? line.slice(1) : line;
      regexps.push(toRegExp(pat));
      regexps[regexps.length - 1].negated = neg;
    }
    return { regexps, paths: lines };
  } catch {
    return { regexps, paths: [] };
  }
}

class Scanner {
  constructor(rootDir, opts = {}) {
    this.root = path.resolve(rootDir);
    this.opts = opts;
    this.stats = { dirs: 0, files: 0, skipped: 0, errors: [] };
  }

  isIgnored(relPath, isDir) {
    const r = relPath.replace(/\\/g, '/');
    let ignored = false;
    for (const re of this.ignores.regexps) {
      if (re.negated) {
        if (re.test(r)) ignored = false;
      } else if (re.test(r) || re.test(r.split('/').pop())) {
        if (!(isDir && re.source.includes('node_modules'))) ignored = true;
        if (isDir) ignored = true;
      }
    }
    return ignored;
  }

  scan() {
    this.ignores = loadUserIgnores(this.root);
    const rootEntry = { name: path.basename(this.root), path: '.', isDir: true, children: [], size: 0, fileCount: 0 };
    const stack = [{ fsPath: this.root, node: rootEntry }];

    while (stack.length) {
      const { fsPath, node } = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(fsPath, { withFileTypes: true });
      } catch (e) {
        this.stats.errors.push({ path: fsPath, error: String(e.message || e) });
        continue;
      }
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const ent of entries) {
        const relPath = node.path === '.' ? ent.name : node.path + '/' + ent.name;
        if (this.isIgnored(relPath, ent.isDirectory())) {
          this.stats.skipped++;
          continue;
        }
        const child = {
          name: ent.name,
          path: relPath,
          isDir: ent.isDirectory(),
          children: [],
          size: 0,
          fileCount: 0,
          modified: 0,
        };
        if (ent.isSymbolicLink()) {
          child.isSymlink = true;
          node.children.push(child);
          this.stats.files++;
          continue;
        }
        if (ent.isDirectory()) {
          this.stats.dirs++;
          child.isDir = true;
          node.children.push(child);
          stack.push({ fsPath: path.join(fsPath, ent.name), node: child });
        } else if (ent.isFile()) {
          this.stats.files++;
          let st;
          try {
            st = fs.statSync(path.join(fsPath, ent.name));
          } catch {
            st = { size: 0, mtimeMs: 0 };
          }
          child.size = st.size;
          child.modified = Math.floor(st.mtimeMs);
          child.fileCount = 1;
          node.children.push(child);
        }
      }
    }

    rollup(rootEntry);
    return { root: rootEntry, stats: this.stats };
  }
}

function rollup(node) {
  let files = 0;
  let size = 0;
  for (const c of node.children) {
    if (!c.isDir) {
      files += 1;
      size += c.size;
    } else {
      const r = rollup(c);
      files += r.files;
      size += r.size;
    }
  }
  node.fileCount = files;
  node.size = size;
  node.depth = node.path === '.' ? 0 : node.path.split(/[\\/]/).length;
  return { files, size };
}

module.exports = { Scanner, DEFAULT_IGNORES, loadUserIgnores };
