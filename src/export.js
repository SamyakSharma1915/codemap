'use strict';

const path = require('path');

function exportJSON(model, graphs) {
  const project = model.project;
  const serializeGraph = (graph) => ({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      path: n.data.path,
      language: n.data.language,
      isTest: n.data.isTest,
      metrics: n.data.metrics,
      x: Math.round(n.x),
      y: Math.round(n.y),
    })),
    edges: graph.edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type,
      uncertain: !!e.info.uncertain,
    })),
  });
  return {
    meta: {
      tool: 'CodeMap',
      version: require('../package.json').version,
      generatedAt: new Date().toISOString(),
      root: model.root.name,
      type: project.type,
      packageManager: project.packageManager,
      framework: project.framework,
      languages: project.languages,
      entryPoints: project.entryPoints,
    },
    stats: {
      files: model.model.fileCount,
      dirs: model.stats.dirs,
      totalLines: model.model.totalLines,
      languageStats: model.model.langCount,
      parsed: model.timing.parsed,
      cached: model.timing.cached,
      errors: model.timing.errors,
    },
    git: model.git ? {
      isRepo: true,
      branches: model.git.branches,
      currentBranch: model.git.currentBranch,
      lastCommit: model.git.lastCommit,
      recentCommits: model.git.recentCommits,
      modified: model.git.status.modified,
      untracked: model.git.status.untracked,
      staged: model.git.status.staged,
    } : { isRepo: false },
    tree: serializeTree(model.root),
    nodes: graphs.filesystem.nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      path: n.data.path,
      language: n.data.language,
      isTest: n.data.isTest,
      metrics: n.data.metrics ? {
        loc: n.data.metrics.loc,
        size: n.data.metrics.size,
        functions: n.data.metrics.functions,
        classes: n.data.metrics.classes,
        imports: n.data.metrics.imports,
        complexity: n.data.metrics.complexity,
      } : undefined,
    })),
    edges: graphs.filesystem.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
    filesystem: serializeGraph(graphs.filesystem),
    dependencyGraph: serializeGraph(graphs.dependency),
    architectureGraph: serializeGraph(graphs.architecture),
  };
}

function serializeTree(node) {
  const out = {
    name: node.name,
    path: node.path,
    type: node.isDir ? 'directory' : 'file',
    isDir: !!node.isDir,
    language: node.language,
    fileCount: node.fileCount,
    size: node.size,
    modified: node.modified,
    metrics: node.metrics ? {
      loc: node.metrics.loc,
      functions: node.metrics.functions,
      classes: node.metrics.classes,
      imports: node.metrics.imports,
      complexity: node.metrics.complexity,
    } : undefined,
    isTest: node.isTest,
    symbols: node.analysis && node.analysis.symbols ? node.analysis.symbols.map((s) => ({
      kind: s.kind, name: s.name, startLine: s.startLine, endLine: s.endLine, parent: s.parent,
    })) : undefined,
  };
  if (node.children && node.children.length) {
    out.children = node.children.map(serializeTree);
  }
  return out;
}

function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function exportHTML(model, graphs) {
  const payload = JSON.stringify(exportJSON(model, graphs));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeMap — ${escapeHTML(model.project.name)}</title>
<style>
:root{--bg:#fbfcfe;--panel:#ffffff;--border:#e3e8f0;--text:#1b2430;--muted:#6b7686;--accent:#2f6fdb;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);height:100vh;overflow:hidden;}
.topbar{display:flex;align-items:center;gap:16px;height:48px;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--border);}
.topbar .logo{font-weight:700;font-size:15px;}
.topbar .logo span{color:var(--accent);}
.breadcrumbs{color:var(--muted);font-size:13px;}
.modes{display:flex;gap:4px;margin-left:auto;}
.modes button{background:none;border:1px solid var(--border);border-radius:0;padding:6px 12px;font-size:12px;color:var(--muted);cursor:pointer;}
.modes button.active{background:var(--accent);border-color:var(--accent);color:#fff;}
main{display:flex;height:calc(100vh - 48px);}
#map{flex:1;position:relative;background:var(--bg);}
#map svg{width:100%;height:100%;}
.side{width:320px;border-left:1px solid var(--border);background:var(--panel);overflow:auto;padding:16px;font-size:13px;}
.side h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;}
.side dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;}
.side dt{color:var(--muted);}
.node{fill:#fff;stroke:var(--border);stroke-width:1;cursor:pointer;}
.node:hover{stroke:var(--accent);}
.node text{font-size:11px;fill:var(--text);pointer-events:none;}
.edge{stroke-width:1.5;}
.edge.import{stroke:#4c9aff;stroke-dasharray:6 4;}
.edge.hierarchy{stroke:#9aa4b2;}
.edge.inheritance{stroke:#ff9f43;stroke-dasharray:2 2;}
.edge.test{stroke:#2ecc71;}
.edge.reference{stroke:#b087ff;stroke-dasharray:1 4;}
</style>
</head>
<body>
<div class="topbar">
  <div class="logo">Code<span>Map</span></div>
  <div class="breadcrumbs">${escapeHTML(model.project.name)}</div>
  <div class="modes">
    <button data-mode="flow" class="active">Flow</button>
    <button data-mode="dep">Dependency</button>
    <button data-mode="arch">Architecture</button>
  </div>
</div>
<main>
  <div id="map"></div>
  <div class="side" id="side"></div>
</main>
<script>
const DATA = ${payload};
const map = document.getElementById('map');
const side = document.getElementById('side');
const MODES = { flow: 'filesystem', dep: 'dependencyGraph', arch: 'architectureGraph' };
let mode = 'flow';
let svg;

function renderGraph() {
  const g = DATA[MODES[mode]];
  if (!g) return;
  const W = 1600, H = 900;
  let minX = Infinity, minY = Infinity;
  g.nodes.forEach(n => { if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y; });
  let maxX = -Infinity, maxY = -Infinity;
  g.nodes.forEach(n => { if (n.x > maxX) maxX = n.x; if (n.y > maxY) maxY = n.y; });
  const scale = Math.min(W / (maxX - minX + 300), H / (maxY - minY + 300), 1.6);
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1600 900');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const gw = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const tx = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const ty = (H - (maxY - minY) * scale) / 2 - minY * scale;
  gw.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')');
  svg.appendChild(gw);
  for (const e of g.edges) {
    const a = g.nodes.find(n => n.id === e.from);
    const b = g.nodes.find(n => n.id === e.to);
    if (!a || !b) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', a.x + 75); line.setAttribute('y1', a.y + 28);
    line.setAttribute('x2', b.x + 75); line.setAttribute('y2', b.y + 28);
    line.setAttribute('class', 'edge ' + e.type);
    gw.appendChild(line);
  }
  for (const n of g.nodes) {
    const g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('class', 'node');
    r.setAttribute('x', n.x); r.setAttribute('y', n.y);
    r.setAttribute('width', 150); r.setAttribute('height', 56);
    r.style.fill = n.kind === 'group' ? '#eef3fb' : '#fff';
    g2.appendChild(r);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', n.x + 75); t.setAttribute('y', n.y + 33);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = n.label;
    g2.appendChild(t);
    g2.addEventListener('click', () => selectNode(n));
    gw.appendChild(g2);
  }
  map.innerHTML = '';
  map.appendChild(svg);
}

function selectNode(n) {
  const meta = DATA.meta;
  const nodeData = DATA.nodes.find(x => x.path === n.path);
  const m = nodeData && nodeData.metrics ? nodeData.metrics : {};
  let html = '<h3>' + (n.path || n.label) + '</h3>';
  html += '<dl>';
  html += '<dt>Path</dt><dd>' + (n.path || '-') + '</dd>';
  if (nodeData) {
    html += '<dt>Language</dt><dd>' + (nodeData.language || '-') + '</dd>';
    html += '<dt>Lines</dt><dd>' + (m.loc || 0) + '</dd>';
    html += '<dt>Functions</dt><dd>' + (m.functions || 0) + '</dd>';
    html += '<dt>Classes</dt><dd>' + (m.classes || 0) + '</dd>';
    html += '<dt>Imports</dt><dd>' + (m.imports || 0) + '</dd>';
    html += '<dt>Complexity</dt><dd>' + (m.complexity || '-') + '</dd>';
  }
  html += '</dl>';
  side.innerHTML = html;
}

document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.modes button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  mode = b.dataset.mode;
  renderGraph();
}));

renderGraph();
</script>
</body>
</html>
`;
}

function exportSVG(model, graphs) {
  const g = graphs.filesystem;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of g.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  if (!g.nodes.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><text x="20" y="30">No nodes</text></svg>';
  const pad = 30;
  const naturalWidth = Math.round(maxX - minX + pad * 2);
  const naturalHeight = Math.round(maxY - minY + pad * 2);
  const displayWidth = Math.min(1600, naturalWidth);
  const displayHeight = Math.min(1000, naturalHeight);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="${Math.round(minX - pad)} ${Math.round(minY - pad)} ${naturalWidth} ${naturalHeight}" preserveAspectRatio="xMidYMid meet" font-family="-apple-system,Segoe UI,Roboto,sans-serif">`);
  for (const e of g.edges) {
    const a = g.getNode(e.from), b = g.getNode(e.to);
    if (!a || !b) continue;
    const color = e.type === 'import' ? '#3b82f6' : e.type === 'test' ? '#059669' : '#9aa4b2';
    const ax = a.x + a.w / 2, ay = a.y + a.h, bx = b.x + b.w / 2, by = b.y;
    const midY = ay + (by - ay) / 2;
    parts.push(`<path d="M${ax} ${ay} V${midY} H${bx} V${by}" fill="none" stroke="${color}" stroke-width="1.6" marker-end="url(#arrow)"/>`);
  }
  for (const n of g.nodes) {
    const fill = n.data.kind === 'folder' ? '#eef3fb' : '#ffffff';
    const stroke = n.data.kind === 'folder' ? '#7e93b5' : '#d3dae5';
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`);
    parts.push(`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 4}" text-anchor="middle" font-size="13" font-weight="500" fill="#1b2430">${escapeHTML(n.data.label)}</text>`);
  }
  parts.splice(1, 0, '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L8,3 z" fill="#64748b"/></marker></defs>');
  parts.push('</svg>');
  return parts.join('\n');
}

function exportGraphML(model, graphs) {
  const g = graphs.filesystem;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');
  lines.push('<key id="kind" for="node" attr.name="kind" attr.type="string"/>');
  lines.push('<key id="path" for="node" attr.name="path" attr.type="string"/>');
  lines.push('<key id="type" for="edge" attr.name="type" attr.type="string"/>');
  lines.push('<graph edgedefault="directed">');
  for (const n of g.nodes) {
    lines.push(`  <node id="${escapeHTML(n.id)}"><data key="kind">${n.data.kind}</data><data key="path">${escapeHTML(n.data.path || '')}</data></node>`);
  }
  for (const e of g.edges) {
    lines.push(`  <edge source="${escapeHTML(e.from)}" target="${escapeHTML(e.to)}"><data key="type">${e.type}</data></edge>`);
  }
  lines.push('</graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}

module.exports = { exportJSON, exportHTML, exportSVG, exportGraphML };
