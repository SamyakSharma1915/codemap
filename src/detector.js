'use strict';

const fs = require('fs');
const path = require('path');

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectProject(rootDir, tree) {
  const root = tree || {};
  const files = [];
  (function walk(node) {
    for (const c of node.children || []) {
      files.push(c);
      if (c.isDir) walk(c);
    }
  })(root);
  const filePaths = files.filter((f) => !f.isDir).map((f) => f.path.toLowerCase());
  const has = (p) => filePaths.includes(p.toLowerCase());

  const info = {
    type: 'Generic',
    name: path.basename(rootDir),
    packageManager: null,
    framework: null,
    languages: new Set(),
    entryPoints: [],
    configFiles: [],
  };

  // Node
  const pkg = has('package.json') ? readJSON(path.join(rootDir, 'package.json')) : null;
  if (pkg) {
    info.configFiles.push('package.json');
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const d = Object.keys(allDeps).join(' ');
    if (d.includes('next')) { info.type = 'Next.js'; info.framework = 'Next.js'; }
    else if (d.includes('react')) { info.type = 'React'; info.framework = 'React'; }
    else if (d.includes('vue')) { info.type = 'Vue'; info.framework = 'Vue'; }
    else if (d.includes('svelte')) { info.type = 'Svelte'; info.framework = 'Svelte'; }
    else if (d.includes('angular')) { info.type = 'Angular'; info.framework = 'Angular'; }
    else if (d.includes('express') || d.includes('fastify')) { info.type = 'Node.js'; info.framework = 'Express'; }
    else { info.type = 'Node.js'; }
    if (has('node_modules/')) info.languages.add('JavaScript');
    if (has('package-lock.json')) info.packageManager = 'npm';
    if (has('yarn.lock')) info.packageManager = 'yarn';
    if (has('pnpm-lock.yaml')) info.packageManager = 'pnpm';
    if (pkg.main) info.entryPoints.push(pkg.main);
  }

  if (has('pyproject.toml')) { info.configFiles.push('pyproject.toml'); info.type = info.framework ? 'Python + ' + info.type : 'Python'; info.packageManager = info.packageManager || 'pip'; }
  if (has('requirements.txt')) { info.configFiles.push('requirements.txt'); info.type = info.type.startsWith('Python') ? info.type : (info.framework ? info.type + ' + Python' : 'Python'); info.packageManager = info.packageManager || 'pip'; }
  if (has('setup.py')) { info.configFiles.push('setup.py'); info.type = 'Python'; }
  if (has('cargo.toml')) { info.configFiles.push('Cargo.toml'); info.type = 'Rust'; info.packageManager = 'cargo'; }
  if (has('cmakelists.txt')) { info.configFiles.push('CMakeLists.txt'); info.type = 'C/C++'; }
  if (has('makefile')) { info.configFiles.push('Makefile'); if (info.type === 'Generic') info.type = 'C/C++'; }
  if (has('pom.xml')) { info.configFiles.push('pom.xml'); info.type = 'Java'; info.packageManager = 'Maven'; }
  if (has('build.gradle') || has('build.gradle.kts')) { info.configFiles.push('build.gradle'); info.type = 'Java/Kotlin'; info.packageManager = 'Gradle'; }
  if (has('go.mod')) { info.configFiles.push('go.mod'); info.type = 'Go'; info.packageManager = 'go'; }
  if (has('package.swift')) { info.configFiles.push('Package.swift'); info.type = 'Swift'; info.packageManager = 'SPM'; }
  if (has('pubspec.yaml')) { info.configFiles.push('pubspec.yaml'); info.type = 'Flutter/Dart'; info.packageManager = 'pub'; }
  if (has('dockerfile')) info.configFiles.push('Dockerfile');

  // Language histogram
  const counts = {};
  for (const f of files) {
    if (f.isDir) continue;
    const lang = f.language;
    counts[lang] = (counts[lang] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [lang] of sorted) info.languages.add(lang);

  // entry point heuristics
  for (const candidate of ['main.py', 'app.py', 'index.js', 'index.ts', 'main.go', 'main.c', 'main.cpp', 'main.rs', 'server.js', 'server.ts', 'src/main.py', 'src/index.js']) {
    if (has(candidate)) info.entryPoints.push(candidate);
  }

  return {
    ...info,
    languages: [...info.languages],
    languageStats: counts,
  };
}

module.exports = { detectProject };
