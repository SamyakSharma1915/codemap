'use strict';

// Lightweight test runner (zero dependencies). Run: node test/run.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const results = [];
let failures = 0;
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

const ROOT = path.join(__dirname, '..');
const { parseSource } = require('../src/parse');

// ---------- parser unit tests ----------
test('python: functions, classes, methods, imports', () => {
  const src = `
import os
from config import load_config

class Engine:
    def __init__(self):
        self.cfg = load_config()

    def run(self, x):
        return x

def main():
    e = Engine()
    return e.run(1)
`;
  const r = parseSource(src, 'Python');
  const names = r.symbols.map((s) => s.kind + ':' + s.name);
  assert(names.includes('class:Engine'), 'class Engine found, got ' + names);
  assert(names.includes('method:__init__'), 'method __init__ found');
  assert(names.includes('method:run'));
  assert(names.includes('function:main'));
  assert(r.imports.some((i) => i.specifier === 'config'), 'from config import detected');
  assert(r.imports.some((i) => i.specifier === 'os'), 'import os detected');
});

test('python: inheritance and routes', () => {
  const src = `
class Base:
    pass

class Child(Base):
    pass

from flask import Blueprint
bp = Blueprint("x", __name__)

@bp.route("/health")
def health():
    return "ok"
`;
  const r = parseSource(src, 'Python');
  assert(r.inheritance.some((i) => i.from === 'Child' && i.to === 'Base'), 'inheritance detected');
  assert(r.symbols.some((s) => s.kind === 'function' && s.name === 'health'), 'function health');
});

test('javascript: classes, methods, arrow fns, imports', () => {
  const src = `
import { foo } from './foo.js';
import React from 'react';

export class App extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }
  async load() {
    return await foo();
  }
  render() {
    return <div/>;
  }
}

const helper = (a) => {
  return a * 2;
};

export function util(x) {
  return x;
}
`;
  const r = parseSource(src, 'TypeScript');
  const names = r.symbols.map((s) => s.kind + ':' + s.name);
  assert(names.includes('class:App'), 'class App, got ' + names.join(','));
  assert(names.includes('method:constructor'));
  assert(names.includes('method:load'));
  assert(names.includes('method:render'));
  assert(names.includes('function:helper'));
  assert(names.includes('function:util'));
  assert(r.imports.some((i) => i.specifier === './foo.js'));
  assert(r.inheritance.some((i) => i.from === 'App' && i.to === 'Component'), 'inheritance');
});

test('javascript: routes', () => {
  const src = `
import express from 'express';
const app = express();
app.get('/users', listUsers);
app.post('/users', createUser);
`;
  const r = parseSource(src, 'JavaScript');
  assert(r.routes.some((rt) => rt.method === 'GET' && rt.path === '/users'), 'GET /users route');
  assert(r.routes.some((rt) => rt.method === 'POST'), 'POST route');
});

test('javascript: side-effect, dynamic, and re-export dependencies', () => {
  const src = `
import './setup.js';
const page = import('./page.js');
export { helper } from './helper.js';
`;
  const r = parseSource(src, 'JavaScript');
  const specs = r.imports.map((i) => i.specifier);
  assert(specs.includes('./setup.js'), 'side-effect import detected');
  assert(specs.includes('./page.js'), 'dynamic import detected');
  assert(specs.includes('./helper.js'), 're-export dependency detected');
});

test('web: HTML and CSS dependencies without arbitrary strings', () => {
  const html = parseSource('<link href="styles.css"><script src="app.js"></script><img src="logo.png"><a href="about.html">About</a>', 'HTML');
  assert.deepStrictEqual(html.imports.map((i) => i.specifier), ['styles.css', 'app.js', 'logo.png', 'about.html']);
  const css = parseSource('@import "theme.css"; .hero { background:url(../img/hero.png) }', 'CSS');
  assert.deepStrictEqual(css.imports.map((i) => i.specifier), ['theme.css', '../img/hero.png']);
});

test('cfamily: C includes, structs, functions', () => {
  const src = `
#include <stdio.h>
#include "util.h"

typedef struct Engine Engine;

struct Engine {
    int running;
};

int engine_init(Engine *e) {
    return 1;
}

int main(void) { return 0; }
`;
  const r = parseSource(src, 'C');
  assert(r.imports.some((i) => i.specifier === 'util.h'), 'include util.h');
  assert(r.imports.some((i) => i.specifier === 'stdio'), 'include <stdio>');
  const kinds = r.symbols.map((s) => s.kind + ':' + s.name);
  assert(kinds.includes('struct:Engine'), 'struct Engine, got ' + kinds.join(','));
  assert(kinds.includes('function:main'));
  assert(!kinds.includes('struct:Engine2'), 'no phantom symbols');
});

test('cfamily: Go methods with receivers, types', () => {
  const src = `
package main

type Worker struct {
    id int
}

func (w *Worker) Run() {}

func New(id int) *Worker { return &Worker{id: id} }

func main() {}
`;
  const r = parseSource(src, 'Go');
  const names = r.symbols.map((s) => s.kind + ':' + s.name + ':' + (s.parent || ''));
  assert(names.includes('struct:Worker:'), 'Worker struct, got ' + names.join(','));
  assert(names.includes('method:Run:Worker'), 'Run method with receiver parent');
  assert(names.includes('function:New:'), 'New function');
});

test('cfamily: Rust traits, impl, struct', () => {
  const src = `
pub struct Engine { name: String }

impl Engine {
    pub fn new(name: &str) -> Engine { Engine { name: name.to_string() } }
    pub fn run(&self) {}
}

pub trait Runnable {
    fn run(&self);
}
`;
  const r = parseSource(src, 'Rust');
  const names = r.symbols.map((s) => s.kind + ':' + s.name);
  assert(names.includes('struct:Engine'));
  assert(names.includes('trait:Runnable'));
  assert(names.includes('impl:Engine'));
  assert(names.includes('function:new'));
});

test('cfamily: Java classes and methods', () => {
  const src = `
public class Engine {
    private String name;

    public Engine(String name) {
        this.name = name;
    }

    public void initialize() {
        Parser p = new Parser(name);
    }
}
`;
  const r = parseSource(src, 'Java');
  const names = r.symbols.map((s) => s.kind + ':' + s.name);
  assert(names.includes('class:Engine'), 'class Engine, got ' + names.join(','));
  assert(names.includes('method:Engine'));
  assert(names.includes('method:initialize'));
});

// ---------- end-to-end: build model on fixtures ----------
const { buildModel, buildGraphs } = require('../src');

test('fixture1: python project model', async () => {
  const m = await buildModel(path.join(ROOT, 'test-fixture'), { cache: false });
  assert(m.model.fileCount >= 10, 'files scanned');
  const depGraph = buildGraphs(m).dependency;
  const edges = depGraph.edges.filter((e) => e.type === 'import');
  assert(edges.length >= 5, 'import edges resolved, got ' + edges.length);
  // engine.py should have deps on config.py and parser.py
  const engine = m.model.files.find((f) => f.path === 'src/core/engine.py');
  assert(engine, 'engine.py found');
  const depPaths = [...m.model.deps.get(engine)].map((f) => f.path);
  assert(depPaths.includes('src/core/config.py'), 'engine -> config, got ' + depPaths.join(','));
  assert(depPaths.includes('src/core/parser.py'), 'engine -> parser');
});

test('fixture2: javascript project model', async () => {
  const m = await buildModel(path.join(ROOT, 'test-fixture2'), { cache: false });
  const g = buildGraphs(m).dependency;
  const edges = g.edges.filter((e) => e.type === 'import');
  assert(edges.length >= 3, 'js import edges, got ' + edges.length);
  assert(new Set(g.nodes.map((n) => n.y)).size > 1, 'dependency layout uses separate rows');
  const index = m.model.files.find((f) => f.path === 'src/index.js');
  assert(index && index.analysis.symbols.some((s) => s.kind === 'class' && s.name === 'App'), 'App class detected');
  assert(g.nodes.some((n) => n.data.kind === 'external'), 'external packages appear in dependency graph');
});

test('fixture3: c-family project model', async () => {
  const m = await buildModel(path.join(ROOT, 'test-fixture3'), { cache: false });
  const g = buildGraphs(m).dependency;
  const cEdges = g.edges.filter((e) => e.type === 'import');
  assert(cEdges.some((e) => {
    const a = g.getNode(e.from);
    const b = g.getNode(e.to);
    return a && b && a.data.path === 'src/main.c' && b.data.path === 'src/parser.h';
  }), 'main.c includes parser.h');
  const rs = m.model.files.find((f) => f.path === 'src/main.rs');
  assert(rs && rs.analysis.symbols.some((s) => s.kind === 'trait'), 'rust trait detected');
});

test('project detection', async () => {
  const m = await buildModel(path.join(ROOT, 'test-fixture'), { cache: false });
  assert(/Python/i.test(m.project.type), 'python detected, got ' + m.project.type);
  const m2 = await buildModel(path.join(ROOT, 'test-fixture2'), { cache: false });
  assert(/React/i.test(m2.project.type), 'react detected, got ' + m2.project.type);
});

test('export json/html/svg', async () => {
  const { exportJSON, exportHTML, exportSVG } = require('../src/export');
  const m = await buildModel(path.join(ROOT, 'test-fixture'), { cache: false });
  const gs = buildGraphs(m);
  const json = exportJSON(m, gs);
  assert(json.nodes.length > 10, 'json nodes');
  assert(json.meta.type, 'json meta');
  assert(json.filesystem && json.filesystem.nodes.length > 10, 'filesystem graph is available to the web UI');
  assert(json.filesystem.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), 'filesystem nodes have coordinates');
  assert.strictEqual(json.tree.isDir, true, 'serialized tree preserves directory type');
  assert(json.tree.children.some((n) => n.isDir), 'serialized child directories preserve directory type');
  const html = exportHTML(m, gs);
  assert(html.includes('CodeMap') && html.includes('const DATA'), 'html export');
  const svg = exportSVG(m, gs);
  assert(svg.includes('<svg'), 'svg export');
  assert(svg.includes('marker-end="url(#arrow)"'), 'svg graph has directional arrows');
  assert(svg.includes('<path d="M'), 'svg graph uses flowchart connectors');
});

test('cli scan command', () => {
  const out = execFileSync('node', [path.join(ROOT, 'bin', 'codemap.js'), 'scan', path.join(ROOT, 'test-fixture')], { encoding: 'utf8' });
  assert(/Files:/.test(out), 'scan output has Files');
});

// ---------- summary ----------
(async () => {
  for (const { name, fn } of queue) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log('  ok  ' + name);
    } catch (e) {
      results.push({ name, ok: false, error: e });
      failures++;
      console.log('  FAIL ' + name + '\n      ' + (e.message || e).split('\n')[0]);
    }
  }
  console.log('');
  const passed = results.length - failures;
  console.log(`${passed}/${results.length} tests passed${failures ? ', ' + failures + ' failed' : ''}`);
  process.exit(failures ? 1 : 0);
})();
