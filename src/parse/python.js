'use strict';

// Python adapter. Real token-based parser: indentation-aware blocks, class/def
// collection, imports, decorators, inheritance, method calls.

function analyze(src) {
  const lines = src.split(/\r?\n/);
  const symbols = [];
  const imports = [];
  const inheritance = [];
  const calls = [];
  const exports = [];
  const routes = [];

  const importRe = /^\s*(from\s+([\w.]+)\s+import\s+([\w.*]+(?:,\s*[\w.*]+)*)|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))(?:\s+as\s+(\w+))?\s*(?:#.*)?$/;

  // stack of scopes: { indent, name, type, startLine }
  const stack = [{ indent: -1, name: null, type: 'module', startLine: 0 }];
  const classStack = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('"""') || trimmed.startsWith("'''")) continue;

    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const lineNo = i + 1;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    if (classStack.length && indent <= classStack[classStack.length - 1].indent) classStack.pop();

    const defMatch = trimmed.match(/^(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (defMatch) {
      const name = defMatch[2];
      const scope = stack[stack.length - 1];
      const isMethod = scope.type === 'class';
      const startLine = lineNo;
      // find end line: next line with indent <= current indent
      let endLine = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j];
        if (!t.trim() || t.trim().startsWith('#')) continue;
        const ind = t.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
        if (ind <= indent) { endLine = j + 1; break; }
        endLine = j + 1;
      }
      const sym = {
        kind: isMethod ? 'method' : 'function',
        name,
        startLine,
        endLine,
        parent: isMethod ? scope.name : null,
        signature: trimmed.slice(0, trimmed.length - (trimmed.endsWith(':') ? 1 : 0)),
      };
      // Collect decorators above
      let j = i - 1;
      const decorators = [];
      while (j >= 0 && /^\s*@/.test(lines[j])) {
        decorators.unshift(lines[j].trim());
        sym.startLine = j + 1;
        j--;
      }
      sym.decorators = decorators;
      if (decorators.some((d) => /route|app\.(get|post|put|delete|patch)|get\(|post\(/.test(d))) {
        routes.push({ symbol: name, decorators, startLine: sym.startLine });
      }
      symbols.push(sym);
      stack.push({ indent, name, type: isMethod ? 'method' : 'function', startLine });
      continue;
    }

    const classMatch = trimmed.match(/^class\s+([A-Za-z_]\w*)\s*(\(([^)]*)\))?\s*:/);
    if (classMatch) {
      const name = classMatch[1];
      const bases = (classMatch[3] || '')
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b) => b.replace(/\s+as\s+\w+$/, '').trim());
      for (const b of bases) {
        if (b && b !== 'object') inheritance.push({ from: name, to: b, startLine: lineNo });
      }
      const startLine = lineNo;
      let endLine = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j];
        if (!t.trim() || t.trim().startsWith('#')) continue;
        const ind = t.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
        if (ind <= indent) { endLine = j + 1; break; }
        endLine = j + 1;
      }
      symbols.push({ kind: 'class', name, startLine, endLine, bases, signature: trimmed.slice(0, -1) });
      stack.push({ indent, name, type: 'class', startLine });
      classStack.push({ indent, name, startLine });
      continue;
    }

    const impMatch = trimmed.match(importRe);
    if (impMatch) {
      let specifier = null;
      let kind = 'import';
      let names = null;
      if (impMatch[1]) {
        if (impMatch[2]) {
          specifier = impMatch[2];
          names = impMatch[3].split(',').map((s) => s.trim());
          kind = 'from';
        } else if (impMatch[4]) {
          specifier = impMatch[4];
          kind = 'import';
        }
      }
      const alias = impMatch[5] || null;
      if (specifier) imports.push({ specifier, names, alias, kind, startLine: lineNo });
      continue;
    }

    const globalMatch = trimmed.match(/^__all__\s*=\s*\[(.*)\]/);
    if (globalMatch) {
      for (const m of globalMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)) {
        exports.push({ name: m[1] || m[2], startLine: lineNo });
      }
    }

    // call detection: self.x( or obj.method( on its own line, or foo(
    const callMatch = trimmed.match(/^(?:self|this|[A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/);
    if (callMatch) {
      const scope = stack[stack.length - 1];
      calls.push({ from: scope && scope.type === 'function' ? scope.name : null, to: callMatch[1], startLine: lineNo });
    }
  }

  return { language: 'Python', symbols, imports, inheritance, calls, exports, routes };
}

module.exports = { analyze };
