'use strict';

const fs = require('fs');
const path = require('path');
const { languageForFile } = require('../langs');
const python = require('./python');
const javascript = require('./javascript');
const cfamily = require('./cfamily');
const web = require('./web');
const fallback = require('./fallback');

const PARSABLE_LANGS = new Set([
  'Python', 'JavaScript', 'TypeScript', 'C', 'C++', 'C#', 'Java', 'Kotlin',
  'Go', 'Rust', 'Swift', 'Objective-C', 'Zig', 'Dart', 'Ruby', 'PHP', 'Lua',
  'Elixir', 'Erlang', 'Haskell', 'Clojure', 'OCaml', 'F#', 'VB.NET', 'Scala',
  'Shell', 'PowerShell', 'SQL', 'JSON', 'YAML', 'TOML', 'XML', 'Markdown',
  'Dockerfile', 'Makefile', 'CMake', 'Gradle', 'Vue', 'Svelte', 'Astro',
]);

function classifyLang(lang) {
  if (lang === 'Python') return 'python';
  if (['JavaScript', 'TypeScript', 'Vue', 'Svelte', 'Astro'].includes(lang)) return 'javascript';
  if (['HTML', 'CSS', 'SCSS', 'Less'].includes(lang)) return 'web';
  if (['C', 'C++', 'C#', 'Java', 'Kotlin', 'Go', 'Rust', 'Swift', 'Objective-C', 'Zig', 'Dart', 'Scala'].includes(lang)) return 'cfamily';
  return 'fallback';
}

function parseFile(filePath, opts = {}) {
  const name = path.basename(filePath);
  const lang = opts.language || languageForFile(name, filePath);
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { language: lang, symbols: [], imports: [], error: String(e.message || e) };
  }
  return parseSource(src, lang);
}

function parseSource(src, lang) {
  const kind = classifyLang(lang);
  try {
    if (kind === 'python') {
      const r = python.analyze(src);
      return r;
    }
    if (kind === 'javascript') {
      const r = javascript.analyze(src, lang);
      return r;
    }
    if (kind === 'cfamily') {
      const r = cfamily.analyze(src, lang);
      return r;
    }
    if (kind === 'web') return web.analyze(src, lang);
    return fallback.analyze(src, lang);
  } catch (e) {
    return { language: lang, symbols: [], imports: [], error: String(e.message || e), fallback: true };
  }
}

function canParse(lang) {
  return PARSABLE_LANGS.has(lang);
}

module.exports = { parseFile, parseSource, canParse, PARSABLE_LANGS, classifyLang };
