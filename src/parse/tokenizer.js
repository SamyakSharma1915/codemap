'use strict';

// Universal source tokenizer. Produces a flat token stream with line numbers
// that language adapters consume. Handles strings, comments, identifiers,
// numbers and operators, and records paired braces/parens/brackets offsets.

class Tokenizer {
  constructor(src) {
    this.src = src;
    this.len = src.length;
    this.pos = 0;
    this.line = 1;
    this.tokens = [];
  }

  peek(o = 0) {
    return this.pos + o < this.len ? this.src[this.pos + o] : '';
  }

  advance(n = 1) {
    for (let i = 0; i < n; i++) {
      if (this.src[this.pos] === '\n') this.line++;
      this.pos++;
    }
  }

  isIdStart(ch) {
    return /[A-Za-z_$\u00c0-\uffff]/.test(ch);
  }
  isIdPart(ch) {
    return /[A-Za-z0-9_$\u00c0-\uffff]/.test(ch);
  }

  push(type, value, line, start) {
    this.tokens.push({ type, value, line, start, end: this.pos });
  }

  tokenize() {
    const { src } = this;
    while (this.pos < this.len) {
      const ch = src[this.pos];
      const line = this.line;
      const start = this.pos;

      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }

      // Line comment
      if (ch === '/' && src[this.pos + 1] === '/') {
        while (this.pos < this.len && src[this.pos] !== '\n') this.advance();
        continue;
      }
      // '#' is a comment ONLY for line-based comment languages. But C-family
      // uses '#' for preprocessor (#include/#define). We treat '#' as a
      // comment when followed by whitespace or end-of-line (Python/Shell/YAML
      // style), and as a token otherwise so #include survives tokenization.
      if (ch === '#') {
        const next = src[this.pos + 1];
        if (next === ' ' || next === '\t' || next === undefined || next === '\n') {
          while (this.pos < this.len && src[this.pos] !== '\n') this.advance();
          continue;
        }
        this.advance();
        this.push('op', '#', line, start);
        continue;
      }
      if (ch === '-' && src[this.pos + 1] === '-') {
        while (this.pos < this.len && src[this.pos] !== '\n') this.advance();
        continue;
      }

      // Block comment
      if (ch === '/' && src[this.pos + 1] === '*') {
        this.advance(2);
        while (this.pos < this.len && !(src[this.pos] === '*' && src[this.pos + 1] === '/')) this.advance();
        this.advance(2);
        continue;
      }
      if (ch === '#' && src[this.pos + 1] === '=' && /^(py|python)$/i.test('x')) {
        // Python docstring handled elsewhere; treat #= as block only for some langs
      }

      // Strings
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        // Triple quote (python)
        if (src[this.pos + 1] === quote && src[this.pos + 2] === quote) {
          this.advance(3);
          while (this.pos < this.len && !(src[this.pos] === quote && src[this.pos + 1] === quote && src[this.pos + 2] === quote)) this.advance();
          this.advance(3);
          continue;
        }
        this.advance();
        let escaped = false;
        while (this.pos < this.len) {
          const c = src[this.pos];
          if (c === '\\' && !escaped) { escaped = true; this.advance(); continue; }
          if (c === quote && !escaped) break;
          escaped = false;
          this.advance();
        }
        this.advance();
        this.push('string', src.slice(start, this.pos), line, start);
        continue;
      }

      // Template literal with ${ }
      if (ch === '`') {
        this.advance();
        while (this.pos < this.len && src[this.pos] !== '`') {
          if (src[this.pos] === '\\') { this.advance(2); continue; }
          this.advance();
        }
        this.advance();
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch)) {
        while (this.pos < this.len && /[0-9a-fA-FxXoObB_.]/.test(src[this.pos])) this.advance();
        this.push('number', src.slice(start, this.pos), line, start);
        continue;
      }

      // Identifiers
      if (this.isIdStart(ch)) {
        while (this.pos < this.len && this.isIdPart(src[this.pos])) this.advance();
        const word = src.slice(start, this.pos);
        const type = /^(class|def|function|const|let|var|import|export|from|require|include|using|namespace|module|struct|enum|interface|trait|impl|pub|type|package|imports?|extends|implements|return|throw|new|try|catch|finally|if|else|for|while|switch|case|async|await|yield|static|public|private|protected|abstract|final|override|default|as|of)$/.test(word) ? 'keyword' : 'ident';
        this.push(type, word, line, start);
        continue;
      }

      // Operators / punctuation (longest match)
      const two = src.slice(this.pos, this.pos + 2);
      if (['==', '!=', '=>', '->', '::', '===', '!==', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '&=', '|=', '??', '?.', '?.'].includes(two)) {
        this.advance(2);
        this.push('op', two, line, start);
        continue;
      }
      this.advance();
      if ('(){}[]<>,;:'.includes(ch)) {
        this.push(ch, ch, line, start);
      } else {
        this.push('op', ch, line, start);
      }
    }
    return this.tokens;
  }
}

// Maps opening token -> matching closing token (reverse map)
const MATCH = { '(': ')', '{': '}', '[': ']' };
const CLOSE = { ')': '(', '}': '{', ']': '[' };

// Compute paired-positions: for each opening token index, the matching closing index.
function computePairs(tokens) {
  const stack = [];
  const pairs = new Array(tokens.length).fill(-1);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === '(' || t.type === '{' || t.type === '[') {
      stack.push(i);
    } else if (t.type === ')' || t.type === '}' || t.type === ']') {
      const open = stack.pop();
      if (open !== undefined) {
        pairs[open] = i;
        pairs[i] = open;
      }
    }
  }
  return pairs;
}

function tokensIn(tokens, start, end) {
  return tokens.slice(start + 1, end);
}

module.exports = { Tokenizer, computePairs, MATCH, CLOSE, tokensIn };
