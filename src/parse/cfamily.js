'use strict';

const { Tokenizer, computePairs } = require('./tokenizer');

// Generic brace-language adapter (C/C++/Java/C#/Go/Rust/Kotlin/Swift/etc).
// Uses the tokenizer and brace matching. Conservative: only records constructs
// it can name with confidence.

const FUNCTION_KEYWORDS = new Set(['fn', 'func', 'function', 'def']);
const TYPE_KEYWORDS = {
  C: new Set(['typedef', 'struct', 'enum', 'union']),
  Cpp: new Set(['class', 'struct', 'enum', 'union', 'interface', 'namespace']),
  Java: new Set(['class', 'interface', 'enum']),
  Go: new Set(['type', 'func']),
  Rust: new Set(['struct', 'enum', 'trait', 'impl', 'type', 'fn', 'mod']),
  'C#': new Set(['class', 'interface', 'enum', 'struct', 'namespace', 'record']),
  Kotlin: new Set(['class', 'interface', 'enum', 'object', 'data', 'sealed', 'fun']),
  Swift: new Set(['class', 'struct', 'enum', 'protocol', 'func']),
  Zig: new Set(['fn']),
};

function analyze(src, lang) {
  const tok = new Tokenizer(src);
  const tokens = tok.tokenize();
  const pairs = computePairs(tokens);
  const symbols = [];
  const imports = [];
  const inheritance = [];

  const isCpp = /C\+\+|C|Objective-C/.test(lang);
  const typeKw = TYPE_KEYWORDS[lang] || TYPE_KEYWORDS.Cpp;

  // include / import scanning
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.value === 'include' && tokens[i + 1] && tokens[i + 1].value === '<') {
      let end = i + 2;
      let spec = '';
      while (tokens[end] && tokens[end].value !== '>') {
        spec += tokens[end].value;
        end++;
      }
      spec = spec.replace(/\.h+$/, ''); // system headers: <stdio.h> -> stdio
      imports.push({ specifier: spec, names: null, kind: 'include', startLine: t.line });
      i = end;
      continue;
    }
    if (t.value === 'include' && tokens[i + 1] && tokens[i + 1].type === 'string') {
      imports.push({ specifier: tokens[i + 1].value.replace(/["']/g, ''), names: null, kind: 'include', startLine: t.line });
      i += 1;
      continue;
    }
    if (t.value === 'import' && tokens[i + 1] && tokens[i + 1].type === 'string') {
      imports.push({ specifier: tokens[i + 1].value.replace(/["']/g, ''), names: null, kind: 'import', startLine: t.line });
      i += 1;
      continue;
    }
    if (t.value === 'import' && tokens[i + 1] && tokens[i + 1].value === '"') {
      // Go / Rust block import handled via tokens
    }
  }

  // Go import "path" and import ( "a" "b" )
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === 'import' && tokens[i + 1] && tokens[i + 1].type === 'string') {
      imports.push({ specifier: tokens[i + 1].value.replace(/"/g, ''), names: null, kind: 'import', startLine: tokens[i].line });
      i++;
    }
  }

  const scopeStack = [{ type: 'file', name: null, isType: false, brace: -1 }];

  // detect keywords that open a scope with a name
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // pop scopes whose closing brace we've just passed
    while (scopeStack.length > 1 && scopeStack[scopeStack.length - 1].brace === i) scopeStack.pop();

    if (t.value === 'using' && tokens[i + 1] && tokens[i + 1].value === 'namespace') {
      let j = i + 2;
      let ns = '';
      while (tokens[j] && tokens[j].value !== ';') { ns += tokens[j].value; j++; }
      if (ns) imports.push({ specifier: ns, names: null, kind: 'namespace', startLine: t.line });
      continue;
    }

    if (t.value === 'fn' || t.value === 'func' || t.value === 'function') {
      // Rust: fn name(...) ; Go: func name(...) / func (r *Type) Name(...) ; Zig: fn name
      let j = i + 1;
      let receiverType = null;
      if (tokens[j] && tokens[j].value === '(') {
        // Go receiver: func (r *Type) Name(...)
        let k = j;
        while (tokens[k] && tokens[k].value !== ')') {
          if (tokens[k].type === 'ident' && k > j) receiverType = tokens[k].value;
          k++;
        }
        j = k + 1;
      }
      const nameTok = tokens[j];
      if (nameTok && (nameTok.type === 'ident' || nameTok.type === 'keyword')) {
        let end = j;
        for (let k = j; k < tokens.length; k++) {
          if (tokens[k].value === '{') { end = pairs[k]; break; }
          if (tokens[k].value === ';') { end = k; break; }
          if (tokens[k].value === '=>') { end = k; break; }
        }
        if (tokens[end] && tokens[end].value === ';' && tokens[j + 1] && tokens[j + 1].value !== '(') {
          continue; // trait method without body (fn run(&self);) - handled by type-body scan
        }
        const scope = scopeStack[scopeStack.length - 1];
        const isMethod = scope.isType || receiverType;
        symbols.push({
          kind: isMethod ? 'method' : 'function',
          name: nameTok.value,
          startLine: t.line,
          endLine: tokens[end] ? tokens[end].line : t.line,
          parent: scope.isType ? scope.name : (receiverType || null),
        });
        i = end;
      }
      continue;
    }

    // class/struct/interface/enum/trait/impl Name ... {
    if (typeKw.has(t.value) && t.value !== 'impl' && t.value !== 'mod' && t.value !== 'namespace') {
      let j = i + 1;
      if (tokens[j] && (tokens[j].value === 'final' || tokens[j].value === 'public' || tokens[j].value === 'abstract')) j++;
      const nameTok = tokens[j];
      if (!nameTok || nameTok.type !== 'ident') continue;
      const name = nameTok.value;
      let k = j + 1;
      let base = null;
      // skip generic params <...>
      if (tokens[k] && tokens[k].value === '<') {
        let d = 0;
        while (tokens[k] && !(tokens[k].value === '>' && d === 0)) {
          if (tokens[k].value === '<') d++;
          if (tokens[k].value === '>') d--;
          k++;
        }
        k++;
      }
      if (tokens[k] && (tokens[k].value === ':' || tokens[k].value === 'extends' || tokens[k].value === 'implements' || tokens[k].value === ':')) {
        k++;
        if (tokens[k] && tokens[k].type === 'ident') {
          base = tokens[k].value;
          if (lang === 'Rust') base = null; // Rust:  -> for lifetimes; impl is separate
        }
      }
      // find opening brace
      let end = k;
      let found = false;
      for (; k < tokens.length; k++) {
        if (tokens[k].value === '{') { end = pairs[k]; found = true; break; }
        if (tokens[k].value === ';' && !found) { end = k; break; }
      }
      // skip pure forward declarations / typedef aliases (no body)
      if (!found) {
        if (t.value === 'struct' || t.value === 'union' || t.value === 'enum' || t.value === 'class') {
          i = end;
          continue;
        }
      }
      if (base && base !== 'I') inheritance.push({ from: name, to: base, startLine: t.line });
      // Go: `type Engine struct/interface` — derive kind from what follows the name
      let kindName = t.value === 'struct' ? 'struct' : t.value === 'enum' ? 'enum' : t.value === 'interface' ? 'interface' : t.value === 'trait' ? 'trait' : 'class';
      if (lang === 'Go' && t.value === 'type') {
        const after = tokens[j + 1];
        if (after && after.value === 'struct') kindName = 'struct';
        else if (after && after.value === 'interface') kindName = 'interface';
        else if (after && after.value === 'map') kindName = 'type';
      }
      symbols.push({ kind: kindName, name, startLine: t.line, endLine: tokens[end] ? tokens[end].line : t.line, base });
      if (tokens[end] && tokens[end].value === '}') {
        scopeStack.push({ type: 'type', name, isType: true, brace: i });
        // scan type body for methods like: <rettype> <name>(...) { ... }
        for (let k = i + 1; k < end; k++) {
          const c = tokens[k];
          // ignore declarations we've already handled / control flow / modifiers-only
          if (c.type !== 'ident' && c.type !== 'keyword') continue;
          if (['class', 'struct', 'enum', 'union', 'interface', 'trait', 'impl', 'fn', 'func', 'if', 'for', 'while', 'switch', 'case', 'return', 'typedef', 'using', 'namespace', 'public', 'private', 'protected', 'static', 'const', 'final', 'abstract', 'virtual', 'override', 'template', 'typename', 'sizeof'].includes(c.value)) continue;
          // lookahead: identifier ( [params] ) { or ;  (method/function in body)
          if (c.type === 'ident') {
            let m = k + 1;
            let generics = 0;
            // method name may be preceded by type words (Java: void initialize) — we catch by scanning
            // for ident followed by ( then ) then { at same depth
            let candidate = null;
            let depth = 0;
            while (m < end && m < k + 6) {
              const tok = tokens[m];
              if (tok.type === 'ident') {
                candidate = tok.value;
                const next = tokens[m + 1];
                if (next && next.value === '(') {
                  // find matching close paren then check for {
                  let close = m + 1;
                  let d = 0;
                  for (let q = m + 1; q < end; q++) {
                    if (tokens[q].value === '(') d++;
                    if (tokens[q].value === ')') { d--; if (d === 0) { close = q; break; } }
                  }
                  const after = tokens[close + 1];
                  if (after && after.value === '{') {
                    const mEnd = pairs[close + 1];
                    symbols.push({ kind: 'method', name: candidate, startLine: c.line, endLine: tokens[mEnd] ? tokens[mEnd].line : c.line, parent: name });
                    k = mEnd;
                    candidate = null;
                    break;
                  } else if (after && after.value === ';') {
                    symbols.push({ kind: 'method', name: candidate, startLine: c.line, endLine: c.line, parent: name });
                    k = close;
                    candidate = null;
                    break;
                  }
                }
              }
              m++;
            }
            if (candidate) {
              // nothing matched; skip
            }
            if (candidate === null && m >= end) continue;
          }
        }
      }
      scopeStack.pop(); // type scope ends
      i = end;
      continue;
    }

    // C-style function: <rettype> <name>(...) { ... }  (C, C++, C#)
    // Detect via: identifier, then '(' after an identifier chain and a '{' body.
    if (t.type === 'ident' && tokens[i + 1] && tokens[i + 1].value === '(' && !scopeStack[scopeStack.length - 1].isType) {
      // only if this ident is not preceded by control-flow keyword or a '.' or '#'
      const prev = tokens[i - 1];
      const prevIsControl = prev && (prev.type === 'keyword' || prev.value === ')' || prev.value === ']' || prev.value === '.' || prev.value === ';' || prev.value === '{');
      if (!prevIsControl) {
        // look ahead: name( ... ) then { or ;
        let close = -1;
        let d = 0;
        for (let q = i; q < tokens.length; q++) {
          if (tokens[q].value === '(') d++;
          if (tokens[q].value === ')') { d--; if (d === 0) { close = q; break; } }
          if (q > i + 400) break;
        }
        if (close !== -1) {
          const after = tokens[close + 1];
          if (after && after.value === '{') {
            const end = pairs[close + 1];
            symbols.push({ kind: 'function', name: t.value, startLine: t.line, endLine: tokens[end] ? tokens[end].line : t.line });
            i = end;
            continue;
          }
        }
      }
    }

    // impl Block for Type { }  (Rust)
    if (t.value === 'impl') {
      let j = i + 1;
      let implName = null;
      let firstIdent = null;
      for (; j < tokens.length; j++) {
        if (tokens[j].value === 'for') {
          implName = tokens[j + 1] && tokens[j + 1].type === 'ident' ? tokens[j + 1].value : null;
          break;
        }
        if (tokens[j].type === 'ident' && !firstIdent) firstIdent = tokens[j].value;
        if (tokens[j].value === '{' || tokens[j].value === ';') {
          if (!implName) implName = firstIdent; // inherent impl: impl Engine { }
          break;
        }
      }
      if (implName) {
        const open = j; // impl's opening brace was found by the scan loop
        const close = pairs[open];
        if (close !== undefined) {
          symbols.push({ kind: 'impl', name: implName, startLine: t.line, endLine: tokens[close] ? tokens[close].line : t.line });
          scopeStack.push({ type: 'type', name: implName, isType: false, brace: close });
          i = open; // continue scanning the impl body so its methods are found
        }
      }
      continue;
    }

    // Go: type Foo struct { } / type Foo interface { }
    if (t.value === 'type' && lang === 'Go') {
      const nameTok = tokens[i + 1];
      if (nameTok && nameTok.type === 'ident') {
        const kindTok = tokens[i + 2];
        symbols.push({
          kind: kindTok && kindTok.value === 'interface' ? 'interface' : 'type',
          name: nameTok.value,
          startLine: t.line,
          endLine: t.line + 1,
        });
      }
    }
  }

  return { language: lang, symbols, imports, inheritance, calls: [], exports: [], routes: [] };
}

module.exports = { analyze };
