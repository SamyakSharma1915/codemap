'use strict';

// Conservative fallback adapter for any other language/config file.
// Extracts only things it can see with confidence: named top-level defs,
// quoted string references, markdown headings, JSON/YAML/TOML keys.

function analyze(src, lang) {
  const symbols = [];
  const imports = [];
  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;

    // Markdown headings
    if (lang === 'Markdown' && /^#{1,3}\s/.test(line)) {
      symbols.push({ kind: 'heading', name: line.replace(/^#+\s*/, ''), startLine: lineNo, endLine: lineNo });
      continue;
    }

    // JSON/YAML/TOML top-level keys
    if (['JSON', 'YAML', 'TOML', 'XML'].includes(lang)) {
      const keyMatch = line.match(/^["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*:/);
      if (keyMatch) {
        symbols.push({ kind: 'config-key', name: keyMatch[1], startLine: lineNo, endLine: lineNo });
        continue;
      }
    }

    // SQL tables / create table
    if (lang === 'SQL') {
      const tbl = line.match(/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/i);
      if (tbl) {
        symbols.push({ kind: 'table', name: tbl[1], startLine: lineNo, endLine: lineNo });
      }
      const sel = line.match(/^\s*FROM\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/i);
      if (sel) imports.push({ specifier: sel[1], names: null, kind: 'reference', startLine: lineNo });
      continue;
    }

    // Generic "name = ..." definitions (config languages)
    if (['Makefile', 'CMake', 'Dockerfile', 'Gradle'].includes(lang)) {
      const eq = line.match(/^([A-Za-z_][A-Za-z0-9_.]*(?:-[A-Za-z0-9_]+)*)\s*(=|:|=|::=)/);
      if (eq && !line.startsWith('#')) {
        symbols.push({ kind: 'config-key', name: eq[1], startLine: lineNo, endLine: lineNo });
      }
    }
  }

  // Quoted string references: only for source-like languages we can't parse
  // precisely. Config/data formats (JSON/YAML/TOML/XML/Markdown/Text) are
  // intentionally excluded — strings there are data, not references.
  const NO_REF_LANGS = new Set(['JSON', 'YAML', 'TOML', 'XML', 'Markdown', 'Text', 'CSS', 'SCSS']);
  if (!NO_REF_LANGS.has(lang)) {
    const refRe = /['"]([A-Za-z0-9_./@-]+)['"]/g;
    let m;
    let guard = 0;
    while ((m = refRe.exec(src)) && guard++ < 400) {
      const spec = m[1];
      if (/^(node_modules|dist|build)\b/.test(spec)) continue;
      if (spec.includes('.') || spec.includes('/')) {
        imports.push({ specifier: spec, names: null, kind: 'reference', startLine: 1, uncertain: true });
      }
    }
  }

  return { language: lang, symbols, imports, inheritance: [], calls: [], exports: [], routes: [] };
}

module.exports = { analyze };
