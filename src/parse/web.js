'use strict';

// Dependency extraction for HTML and stylesheets. Only dependency-bearing
// attributes and CSS constructs are considered, avoiding arbitrary strings.

function analyzeHTML(src) {
  const imports = [];
  const seen = new Set();
  const add = (specifier, kind, offset) => {
    if (!specifier || /^(?:https?:|data:|mailto:|tel:|javascript:|#)/i.test(specifier)) return;
    const clean = specifier.split(/[?#]/)[0].trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    imports.push({ specifier: clean, names: null, kind, startLine: src.slice(0, offset).split(/\r?\n/).length });
  };

  const attrRe = /\b(src|href|action|poster|data-src)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRe.exec(src))) add(match[2], `html-${match[1].toLowerCase()}`, match.index);

  const srcsetRe = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  while ((match = srcsetRe.exec(src))) {
    for (const item of match[1].split(',')) add(item.trim().split(/\s+/)[0], 'html-srcset', match.index);
  }
  return { language: 'HTML', symbols: [], imports, inheritance: [], calls: [], exports: [], routes: [] };
}

function analyzeCSS(src, lang) {
  const imports = [];
  const seen = new Set();
  const add = (specifier, kind, offset) => {
    const clean = specifier.trim().replace(/^['"]|['"]$/g, '').split(/[?#]/)[0];
    if (!clean || /^(?:https?:|data:|#)/i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    imports.push({ specifier: clean, names: null, kind, startLine: src.slice(0, offset).split(/\r?\n/).length });
  };
  let match;
  const importRe = /@import\s+(?:url\(\s*)?(["'][^"']+["']|[^\s;)]+)\s*\)?/gi;
  while ((match = importRe.exec(src))) add(match[1], 'css-import', match.index);
  const urlRe = /url\(\s*(["'][^"']+["']|[^)]+)\s*\)/gi;
  while ((match = urlRe.exec(src))) add(match[1], 'css-url', match.index);
  return { language: lang, symbols: [], imports, inheritance: [], calls: [], exports: [], routes: [] };
}

function analyze(src, lang) {
  return lang === 'HTML' ? analyzeHTML(src) : analyzeCSS(src, lang);
}

module.exports = { analyze };
