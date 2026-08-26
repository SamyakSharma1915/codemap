'use strict';

const { Tokenizer, computePairs } = require('./tokenizer');

// JavaScript / TypeScript adapter. Uses the tokenizer + brace matching to
// collect functions/classes/imports/exports/inheritance/routes/methods.

function analyze(src, lang) {
  const tok = new Tokenizer(src);
  const tokens = tok.tokenize();
  const pairs = computePairs(tokens);
  const symbols = [];
  const imports = [];
  const exports = [];
  const inheritance = [];
  const calls = [];
  const routes = [];

  const scopeStack = [{ type: 'module', name: null, brace: -1 }];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // imports: import x from 'y' | import {a,b} from 'y' | import 'y' | import * as x from 'y'
    if (t.value === 'import') {
      // dynamic import('x')
      if (tokens[i + 1] && tokens[i + 1].value === '(' && tokens[i + 2] && tokens[i + 2].type === 'string') {
        imports.push({ specifier: tokens[i + 2].value.replace(/['"`]/g, ''), names: null, kind: 'dynamic-import', startLine: t.line });
        continue;
      }
      let j = i + 1;
      let specifier = null;
      const collected = [];
      let sawFrom = false;
      while (j < tokens.length && tokens[j].value !== ';') {
        const c = tokens[j];
        if (c.value === 'from') sawFrom = true;
        else if (!sawFrom && c.type === 'string') {
          specifier = c.value.replace(/['"`]/g, '');
          break;
        }
        else if (sawFrom && c.type === 'string') {
          specifier = c.value.replace(/['"`]/g, '');
          break;
        } else if (c.type === 'ident') collected.push(c.value);
        j++;
      }
      if (specifier) imports.push({ specifier, names: collected.length ? collected : null, kind: 'import', startLine: t.line });
      i = j;
      continue;
    }

    // export handlers — leave i pointing at the declared thing if it's class/function
    if (t.value === 'export') {
      let j = i + 1;
      if (tokens[j] && tokens[j].value === 'default') j++;
      const n2 = tokens[j];
      if (n2 && (n2.value === 'class' || n2.value === 'function' || n2.value === 'async')) {
        // back up so the main loop processes class/function
        i = j - 1;
        continue;
      }
      if (n2 && (n2.value === 'const' || n2.value === 'let' || n2.value === 'var')) {
        i = j - 1;
        continue;
      }
      // export { a as b, c }
      if (n2 && n2.value === '{') {
        const end = pairs[j];
        const names = new Set();
        for (let k = j + 1; k < end; k++) {
          const c = tokens[k];
          if (c.type === 'ident') names.add(c.value);
          if (c.value === 'as') k++; // skip alias target for name collection
        }
        for (const n of names) exports.push({ name: n, startLine: t.line });
        if (tokens[end + 1] && tokens[end + 1].value === 'from' && tokens[end + 2] && tokens[end + 2].type === 'string') {
          imports.push({ specifier: tokens[end + 2].value.replace(/['"`]/g, ''), names: [...names], kind: 're-export', startLine: t.line });
        }
        i = end;
        continue;
      }
    }

    // require('x')
    if (t.value === 'require' && tokens[i + 1] && tokens[i + 1].value === '(') {
      let j = i + 2;
      if (tokens[j] && tokens[j].type === 'string') {
        imports.push({ specifier: tokens[j].value.replace(/['"`]/g, ''), names: null, kind: 'require', startLine: t.line });
        i = j + 1;
      }
      continue;
    }

    // class Foo extends Bar { ... }
    if (t.value === 'class') {
      const nameTok = tokens[i + 1];
      let name = nameTok && nameTok.type === 'ident' ? nameTok.value : null;
      if (!name) continue;
      let base = null;
      if (tokens[i + 2] && tokens[i + 2].value === 'extends') {
        const bt = tokens[i + 3];
        base = bt && bt.type === 'ident' ? bt.value : null;
      }
      let end = i;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].value === '{') { end = pairs[j]; break; }
      }
      if (base && base !== 'null') inheritance.push({ from: name, to: base, startLine: t.line });
      symbols.push({ kind: 'class', name, startLine: t.line, endLine: tokens[end] ? tokens[end].line : t.line, base });
      scopeStack.push({ type: 'class', name, brace: end });
      const bodyStart = i + 1;
      for (let k = bodyStart; k < end; k++) {
        const c = tokens[k];
        if (c.value === 'constructor' && tokens[k + 1] && tokens[k + 1].value === '(') {
          let mEnd = k;
          for (let q = k + 1; q < end; q++) {
            if (tokens[q].value === '{') { mEnd = pairs[q]; break; }
          }
          symbols.push({ kind: 'method', name: 'constructor', startLine: c.line, endLine: tokens[mEnd] ? tokens[mEnd].line : c.line, parent: name });
          k = mEnd;
          continue;
        }
        // modifier* methodName(...) {  or  get/set/async/* methodName(
        const isModifier = c.value === 'static' || c.value === 'async' || c.value === 'get' || c.value === 'set' || c.value === 'public' || c.value === 'private' || c.value === 'protected' || c.value === 'abstract' || c.value === 'readonly';
        if (c.type === 'ident' || c.type === 'keyword') {
          let j2 = k;
          if (isModifier) j2++;
          // may be *generator
          if (tokens[j2] && tokens[j2].value === '*') j2++;
          const mname = tokens[j2];
          // valid method name: ident, or string for computed
          if (mname && (mname.type === 'ident' || mname.type === 'string') && tokens[j2 + 1] && tokens[j2 + 1].value === '(') {
            // ensure not a nested function declaration
            const nameIsMethod = isModifier || /^[a-zA-Z_$]/.test(mname.value);
            if (nameIsMethod) {
              let mEnd = j2;
              for (let q = j2 + 1; q < end; q++) {
                if (tokens[q].value === '{') { mEnd = pairs[q]; break; }
              }
              symbols.push({ kind: 'method', name: mname.value, startLine: c.line, endLine: tokens[mEnd] ? tokens[mEnd].line : c.line, parent: name });
              k = mEnd;
              continue;
            }
          }
        }
      }
      scopeStack.pop(); // class scope ends with the body
      i = end;
      continue;
    }

    // function foo( / async function foo / function* foo
    if (t.value === 'function' || (t.value === 'async' && tokens[i + 1] && tokens[i + 1].value === 'function')) {
      let j = t.value === 'async' ? i + 2 : i + 1;
      if (tokens[j] && tokens[j].value === '*') j++;
      let name = null;
      if (tokens[j] && tokens[j].type === 'ident') name = tokens[j].value;
      let end = j;
      for (let k = j; k < tokens.length; k++) {
        if (tokens[k].value === '{') { end = pairs[k]; break; }
      }
      const scope = scopeStack[scopeStack.length - 1];
      if (name) {
        symbols.push({
          kind: scope.type === 'class' ? 'method' : 'function',
          name,
          startLine: t.line,
          endLine: tokens[end] ? tokens[end].line : t.line,
          parent: scope.type === 'class' ? scope.name : null,
        });
      }
      i = end;
      continue;
    }

    // const/let/var foo = (...) => { ... } or = function
    if ((t.value === 'const' || t.value === 'let' || t.value === 'var') && tokens[i + 1] && tokens[i + 1].type === 'ident') {
      const vname = tokens[i + 1].value;
      let j = i + 2;
      let arrow = -1;
      let fnDecl = -1;
      let depth = 0;
      while (j < tokens.length && tokens[j].value !== ';') {
        const c = tokens[j].value;
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') depth--;
        if (c === '=>' && depth === 0) { arrow = j; break; }
        if (c === 'function' && depth === 0) { fnDecl = j; break; }
        j++;
      }
      if (arrow !== -1 || fnDecl !== -1) {
        let end = arrow !== -1 ? arrow : fnDecl;
        for (let k = end; k < tokens.length && k < end + 400; k++) {
          if (tokens[k].value === '{') { end = pairs[k]; break; }
          if (tokens[k].value === ';') { end = k; break; }
        }
        const scope = scopeStack[scopeStack.length - 1];
        symbols.push({
          kind: scope.type === 'class' ? 'method' : 'function',
          name: vname,
          startLine: t.line,
          endLine: tokens[end] ? tokens[end].line : t.line,
          parent: scope.type === 'class' ? scope.name : null,
        });
      }
      continue;
    }

    // Routes: app.get('/x', handler) / router.get etc. (also r = Router(); r.get)
    if ((t.value === 'app' || t.value === 'router' || t.value === 'route' || t.value === 'server' || t.value === 'r') && tokens[i + 1] && tokens[i + 1].value === '.') {
      const methodTok = tokens[i + 2];
      if (methodTok && /^(get|post|put|delete|patch|use|all)$/.test(methodTok.value) && tokens[i + 3] && tokens[i + 3].value === '(') {
        const pathTok = tokens[i + 4];
        if (pathTok && pathTok.type === 'string') {
          const end = pairs[i + 3];
          const handler = tokens[end - 1] && tokens[end - 1].type === 'ident' ? tokens[end - 1].value : null;
          routes.push({ method: methodTok.value.toUpperCase(), path: pathTok.value.replace(/['"`]/g, ''), handler, startLine: t.line });
        }
      }
    }
  }

  return { language: lang, symbols, imports, exports, inheritance, calls, routes };
}

module.exports = { analyze };
