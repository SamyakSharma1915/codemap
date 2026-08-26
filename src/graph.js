'use strict';

// Graph engine: builds node/edge model for all modes, plus a layered
// (Sugiyama-style, simplified) layout for the flowchart mode.

const EDGE_TYPES = {
  hierarchy: { label: 'filesystem hierarchy', style: 'solid', color: '#9aa4b2' },
  import: { label: 'import', style: 'dashed', color: '#4c9aff' },
  reference: { label: 'reference', style: 'dotted', color: '#b087ff' },
  inheritance: { label: 'inheritance', style: 'double', color: '#ff9f43' },
  test: { label: 'test', style: 'dot-dash', color: '#2ecc71' },
  call: { label: 'call', style: 'solid', color: '#8d99ae' },
};

class Graph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();
  }

  addNode(id, data) {
    if (this.nodeMap.has(id)) return this.nodeMap.get(id);
    const n = { id, data, edges: [], x: 0, y: 0, w: 0, h: 0, layer: 0, degree: 0 };
    this.nodes.push(n);
    this.nodeMap.set(id, n);
    return n;
  }

  getNode(id) {
    return this.nodeMap.get(id);
  }

  addEdge(fromId, toId, type, info = {}) {
    const from = this.getNode(fromId);
    const to = this.getNode(toId);
    if (!from || !to) return;
    const key = fromId + '>' + toId + '>' + type;
    for (const e of this.edges) {
      if (e.from === fromId && e.to === toId && e.type === type) return;
    }
    const e = { from: fromId, to: toId, type, info };
    this.edges.push(e);
    from.edges.push(e);
    to.edges.push(e);
  }
}

// Layered layout (simplified Sugiyama):
//  1. remove cycle by tie-breaking on ids
//  2. assign layers (longest-path)
//  3. order within layer by barycenter heuristic
//  4. assign x/y coordinates
function layout(graph, opts = {}) {
  const nodeW = opts.nodeW || 150;
  const nodeH = opts.nodeH || 60;
  const gapX = opts.gapX || 30;
  const gapY = opts.gapY || 60;

  const indegree = new Map();
  for (const n of graph.nodes) indegree.set(n.id, 0);
  for (const e of graph.edges) indegree.set(e.to, (indegree.get(e.to) || 0) + 1);

  // Kahn's algorithm with longest-path layer assignment.
  const layers = new Map(); // id -> layer index
  const queue = [];
  for (const n of graph.nodes) {
    if (!indegree.get(n.id)) {
      queue.push(n.id);
      layers.set(n.id, 0);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    const node = graph.getNode(id);
    for (const e of node.edges) {
      if (e.from !== id) continue;
      layers.set(e.to, Math.max(layers.get(e.to) || 0, (layers.get(id) || 0) + 1));
      indegree.set(e.to, indegree.get(e.to) - 1);
      if (indegree.get(e.to) === 0) queue.push(e.to);
    }
  }

  // Cyclic components cannot be topologically ordered. Place them after the
  // deepest resolved predecessor while keeping every node visible.
  let fallbackLayer = Math.max(0, ...layers.values());
  for (const n of graph.nodes) {
    if (!layers.has(n.id)) layers.set(n.id, ++fallbackLayer);
  }

  // group by layer
  const byLayer = [];
  for (const n of graph.nodes) {
    const l = layers.get(n.id);
    n.layer = l;
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(n);
  }

  // barycenter ordering (a few passes)
  for (let pass = 0; pass < 8; pass++) {
    for (let l = 1; l < byLayer.length; l++) {
      const layer = byLayer[l];
      layer.sort((a, b) => {
        const score = (n) => {
          const preds = n.edges.filter((e) => e.to === n.id).map((e) => layers.get(e.from));
          if (!preds.length) return 0.5;
          return preds.reduce((s, x) => s + x, 0) / preds.length + n.id.length / 10000;
        };
        return score(a) - score(b);
      });
    }
  }

  // coordinates
  let xCursor = 0;
  const widths = byLayer.map((layer) => Math.max(...layer.map((n) => (n.data.label || n.id).length * 8 + 40), nodeW));
  for (let l = 0; l < byLayer.length; l++) {
    const layer = byLayer[l];
    const totalW = layer.length * nodeW + (layer.length - 1) * gapX;
    const startX = totalW / 2;
    for (let i = 0; i < layer.length; i++) {
      const n = layer[i];
      n.w = nodeW;
      n.h = nodeH;
      n.x = startX - (layer.length - 1) * (nodeW + gapX) / 2 + i * (nodeW + gapX);
      n.y = l * (nodeH + gapY);
      n.degree = n.edges.length;
    }
    if (widths[l] > xCursor) xCursor = widths[l];
  }

  // normalize to positive coords
  let minX = Infinity, minY = Infinity;
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  for (const n of graph.nodes) {
    n.x -= minX;
    n.y -= minY;
  }

  return graph;
}

// Build full-project graph (file + folder nodes with hierarchy edges)
function buildFilesystemGraph(tree, model, opts = {}) {
  const g = new Graph();
  g.addNode('root', { kind: 'folder', label: (tree.name || 'project'), path: '.' });
  (function walk(node, parentId) {
    for (const c of node.children || []) {
      const id = 'node:' + c.path;
      if (c.isDir) {
        g.addNode(id, { kind: 'folder', label: c.name, path: c.path, fileCount: c.fileCount, size: c.size });
      } else {
        g.addNode(id, { kind: 'file', label: c.name, path: c.path, language: c.language, metrics: c.metrics, isTest: c.isTest });
      }
      g.addEdge(parentId, id, 'hierarchy');
      if (c.isDir) walk(c, id);
    }
  })(tree, 'root');
  return g;
}

// Build dependency graph (file nodes + import/inheritance/test edges)
function buildDependencyGraph(model, opts = {}) {
  const g = new Graph();
  for (const f of model.files) {
    g.addNode('node:' + f.path, { kind: 'file', label: f.name, path: f.path, language: f.language, metrics: f.metrics, isTest: f.isTest });
  }
  for (const f of model.files) {
    for (const dep of model.deps.get(f) || []) {
      const type = dep.isTest || f.isTest ? 'test' : 'import';
      g.addEdge('node:' + f.path, 'node:' + dep.path, type);
    }
  }
  for (const f of model.files) {
    for (const specifier of model.externalDeps.get(f) || []) {
      const id = 'external:' + specifier;
      g.addNode(id, { kind: 'external', label: specifier, path: null, language: 'External' });
      g.addEdge('node:' + f.path, id, 'reference', { external: true });
    }
  }
  return g;
}

// Build architecture map (group nodes -> files)
function buildArchitectureGraph(model, opts = {}) {
  const g = new Graph();
  const groups = {};
  for (const f of model.files) {
    const gid = 'group:' + f.archGroup;
    if (!groups[f.archGroup]) {
      groups[f.archGroup] = true;
      g.addNode(gid, { kind: 'group', label: f.archGroup });
    }
    g.addNode('node:' + f.path, { kind: 'file', label: f.name, path: f.path, language: f.language, metrics: f.metrics, isTest: f.isTest });
    g.addEdge(gid, 'node:' + f.path, 'hierarchy');
  }
  // inter-group imports
  for (const f of model.files) {
    for (const dep of model.deps.get(f) || []) {
      if (f.archGroup !== dep.archGroup) {
        g.addEdge('group:' + f.archGroup, 'group:' + dep.archGroup, 'import');
      }
    }
  }
  return g;
}

module.exports = {
  Graph,
  layout,
  buildFilesystemGraph,
  buildDependencyGraph,
  buildArchitectureGraph,
  EDGE_TYPES,
};
