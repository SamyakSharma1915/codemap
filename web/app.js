'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const escape = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let DATA = null;
  let treeNodes = new Map(); // path -> tree node object
  let fileNodes = new Map(); // path -> fs graph node
  let currentMode = 'flow';
  let selectedPath = null;
  let focusPath = null;
  let collapsed = new Set();
  let heat = null; // null | 'loc' | 'complexity' | 'deps' | 'dependents'
  let editor = 'vscode';

  // ---------- canvas state ----------
  const canvas = $('#map-canvas');
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let view = { x: 0, y: 0, scale: 1 };
  let graph = null; // active graph nodes/edges
  let nodeById = new Map();
  let dragState = null;
  let hoverNode = null;

  // ---------- boot ----------
  async function boot() {
    loadPrefs();
    const res = await fetch('/data');
    if (!res.ok) throw new Error(`Unable to load project data (${res.status})`);
    DATA = await res.json();
    buildTreeIndex();
    applyPrefs();
    renderTree();
    switchMode(currentMode);
    renderProjectInfo();
    wireUI();
    if (DATA.stats.files > 15000) {
      alert('This project has ' + DATA.stats.files.toLocaleString() + ' files. Large trees are collapsed automatically for performance.');
    }
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('codemap.prefs') || '{}');
      editor = p.editor || 'vscode';
      collapsed = new Set(p.collapsed || []);
    } catch {}
  }
  function applyPrefs() {
    // nothing to paint at load; heat applied per-mode
  }
  function savePrefs() {
    try {
      localStorage.setItem('codemap.prefs', JSON.stringify({ editor, collapsed: [...collapsed] }));
    } catch {}
  }

  function buildTreeIndex() {
    treeNodes = new Map();
    (function walk(n) {
      treeNodes.set(n.path, n);
      (n.children || []).forEach(walk);
    })(DATA.tree);
    fileNodes = new Map();
    for (const n of DATA.nodes) {
      if (n.kind === 'file') fileNodes.set(n.path, n);
    }
  }

  // ---------- file tree ----------
  function renderTree() {
    const el = $('.tree');
    el.innerHTML = '';
    const root = DATA.tree;
    renderTreeChildren(el, root, 0);
    updateCollapseCounts(root);
  }

  function nodeIcon(n) {
    if (n.isDir) return n.path === '.' ? '&#9723;' : '<span class="icon-folder">&#128193;</span>';
    if (n.isTest) return '<span class="badge-test">&#10003;</span>';
    const lang = (n.language || '').toLowerCase();
    const map = { python: '&#128013;', javascript: '&#128190;', typescript: '&#128190;', rust: '&#128295;', go: '&#128268;', java: '&#9749;', c: '&#128209;', 'c++': '&#128209;', json: '{ }', html: '&#60;&#62;', css: '#', markdown: 'M', sql: 'SQL' };
    for (const k of Object.keys(map)) if (lang === k) return map[k];
    return '&#128196;';
  }

  function renderTreeChildren(el, node, depth) {
    const frag = document.createDocumentFragment();
    const children = (node.children || []).slice();
    // always show a collapsed folder badge count
    for (const c of children) {
      const row = document.createElement('div');
      row.className = 'tree-node' + (c.isDir ? ' folder' : '') + (c.path === selectedPath ? ' selected' : '');
      row.style.paddingLeft = (8 + depth * 12) + 'px';
      const hasChildren = c.isDir && (c.children || []).length > 0;
      const isCollapsed = c.isDir && collapsed.has(c.path);
      const twist = document.createElement('span');
      twist.className = 'twist';
      twist.textContent = hasChildren ? (isCollapsed ? '\u25b8' : '\u25be') : '';
      if (hasChildren) {
        twist.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(c.path); });
      }
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = nodeIcon(c);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.name;
      name.title = c.path;
      const meta = document.createElement('span');
      meta.className = 'meta';
      if (c.isDir) {
        meta.textContent = isCollapsed ? (c.fileCount ? c.fileCount + ' files' : '') : (c.fileCount ? c.fileCount : '');
      } else if (c.metrics) {
        meta.textContent = c.metrics.loc ? c.metrics.loc : '';
      }
      row.append(twist, icon, name, meta);
      row.addEventListener('click', () => {
        selectNode(c.path);
        if (!c.isDir) openInfo(c.path);
      });
      row.addEventListener('dblclick', () => {
        if (c.isDir) toggleCollapse(c.path);
        else openCode(c.path);
      });
      frag.appendChild(row);
      if (c.isDir && !isCollapsed) {
        const container = document.createElement('div');
        container.className = 'tree-children';
        renderTreeChildren(container, c, depth + 1);
        frag.appendChild(container);
      }
    }
    el.appendChild(frag);
  }

  function toggleCollapse(path) {
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    savePrefs();
    renderTree();
  }

  function updateCollapseCounts(node) {
    if (node.isDir && !collapsed.has(node.path)) {
      if (node.fileCount > 300) collapsed.add(node.path);
    }
    (node.children || []).forEach(updateCollapseCounts);
  }

  // ---------- modes ----------
  const GRAPH_MODES = {
    flow: 'filesystem',
    graph: 'dependencyGraph',
    dep: 'dependencyGraph',
    arch: 'architectureGraph',
  };

  function switchMode(mode) {
    currentMode = mode;
    $$('.modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (mode === 'code') { return; }
    const key = GRAPH_MODES[mode] || GRAPH_MODES.flow;
    const g = DATA[key];
    graph = { nodes: g.nodes, edges: g.edges, key };
    nodeById = new Map();
    for (const n of g.nodes) nodeById.set(n.id, n);
    buildDepLookup();
    computeNodeSizes();
    if (mode === 'flow') applyCollapseToGraph();
    resetView();
    render();
  }

  function computeNodeSizes() {
    for (const n of graph.nodes) {
      const w = Math.max(90, Math.min(200, n.label.length * 7.4 + 34));
      const h = 46;
      n.w = w; n.h = h;
      n.cx = n.x + w / 2;
      n.cy = n.y + h / 2;
      let file = null;
      if (n.path) {
        file = fileNodes.get(n.path);
      }
      if (n.kind === 'folder') { n.fill = '#eef3fb'; n.stroke = '#7e93b5'; }
      else if (n.kind === 'group') { n.fill = '#e9effc'; n.stroke = '#2456d6'; }
      else if (n.kind === 'external') { n.fill = '#f5f3ff'; n.stroke = '#8b5cf6'; }
      else { n.fill = '#ffffff'; n.stroke = '#d3dae5'; }
      if (file && file.isTest) n.stroke = '#059669';
      if (file) {
        if (heat === 'loc') {
          const r = Math.min(2.2, Math.max(0.6, Math.log2((file.metrics?.loc || 4) + 1) / 5));
          n.w = Math.max(70, 90 * r); n.h = Math.max(34, 46 * r);
          n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2;
          n.fill = shade('loc', (file.metrics?.loc || 0));
        } else if (heat === 'complexity') {
          n.fill = shade('complexity', (file.metrics?.complexityScore || 0));
        } else if (heat === 'deps') {
          n.fill = shade('deps', depsOf(n).length);
        } else if (heat === 'dependents') {
          n.fill = shade('dependents', dependentsOf(n).length);
        }
      }
    }
  }

  function shade(metric, val) {
    const maxMap = { loc: 1500, complexity: 120, deps: 15, dependents: 30 };
    const max = maxMap[metric] || 100;
    const t = Math.min(1, val / max);
    // low = near white, high = accent blue
    const r = Math.round(240 - 200 * t);
    const g = Math.round(245 - 170 * t);
    const b = Math.round(255 - 120 * t);
    return `rgb(${r},${g},${b})`;
  }

  function applyCollapseToGraph() {
    // collapse folders: remove child folder nodes that are collapsed from graph
    const keep = new Set();
    const isCollapsedFolder = (id) => {
      const n = nodeById.get(id);
      if (!n || n.kind !== 'folder') return false;
      return collapsed.has(n.data?.path) || collapsed.has(n.path);
    };
    // remove nodes under collapsed folders
    for (const n of graph.nodes) {
      let p = n.id;
      let hidden = false;
      while (true) {
        const parent = graph.edges.find((e) => e.to === p && e.type === 'hierarchy');
        if (!parent) break;
        p = parent.from;
        if (isCollapsedFolder(p)) { hidden = true; break; }
      }
      if (!hidden) keep.add(n.id);
    }
    graph.visibleNodes = graph.nodes.filter((n) => keep.has(n.id));
    graph.visibleEdges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    nodeById = new Map();
    for (const n of graph.visibleNodes) nodeById.set(n.id, n);
  }

  // ---------- dependency lookup ----------
  let depsByPath = new Map();
  let dependentsByPath = new Map();
  function buildDepLookup() {
    depsByPath = new Map();
    dependentsByPath = new Map();
    for (const n of graph.nodes) {
      depsByPath.set(n.path, []);
      dependentsByPath.set(n.path, []);
    }
    for (const e of graph.edges) {
      if (e.type === 'hierarchy') continue;
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      if (a.path) { (depsByPath.get(a.path) || []).push({ to: b.path, type: e.type, uncertain: e.uncertain }); }
      if (b.path) { (dependentsByPath.get(b.path) || []).push({ from: a.path, type: e.type, uncertain: e.uncertain }); }
    }
  }
  function depsOf(n) { return n.path ? (depsByPath.get(n.path) || []) : []; }
  function dependentsOf(n) { return n.path ? (dependentsByPath.get(n.path) || []) : []; }

  // ---------- rendering ----------
  function fit() {
    const nodes = graph.visibleNodes || graph.nodes;
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const w = n.w || 150, h = n.h || 46;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
    }
    const pad = 80;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY), 1.4);
    view.scale = Math.max(0.05, scale);
    view.x = w / 2 - ((minX + maxX) / 2) * view.scale;
    view.y = h / 2 - ((minY + maxY) / 2) * view.scale;
  }

  function resetView() {
    fit();
    render();
  }

  function toScreen(n) {
    return { x: n.x * view.scale + view.x, y: n.y * view.scale + view.y, w: n.w * view.scale, h: n.h * view.scale };
  }

  function render() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    const nodes = graph.visibleNodes || graph.nodes;
    const edges = graph.visibleEdges || graph.edges;

    // edges
    ctx.lineWidth = 1.4 / view.scale;
    const edgeStyle = (type) => {
      switch (type) {
        case 'import': ctx.strokeStyle = '#3b82f6'; ctx.setLineDash([6, 4]); return;
        case 'inheritance': ctx.strokeStyle = '#d97706'; ctx.setLineDash([2, 2]); return;
        case 'test': ctx.strokeStyle = '#059669'; ctx.setLineDash([1, 3]); return;
        case 'reference': ctx.strokeStyle = '#8b5cf6'; ctx.setLineDash([1, 4]); return;
        default: ctx.strokeStyle = '#b6bfcc'; ctx.setLineDash([]); return;
      }
    };
    for (const e of edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      if (e.type === 'hierarchy' && graph.key === 'filesystem') {
        // vertical connector
        const ay = a.y + (a.h || 46);
        const by = b.y;
        const cx = a.x + (a.w || 150) / 2;
        const bx = b.x + (b.w || 150) / 2;
        ctx.strokeStyle = '#b6bfcc';
        ctx.setLineDash([]);
        ctx.lineWidth = 1.2 / view.scale;
        ctx.beginPath();
        ctx.moveTo(cx, ay);
        ctx.lineTo(cx, ay + (by - ay) / 2);
        ctx.lineTo(bx, ay + (by - ay) / 2);
        ctx.lineTo(bx, by);
        ctx.stroke();
        continue;
      }
      edgeStyle(e.type);
      const ax = a.x + (a.w || 150) / 2;
      const ay = a.y + (a.h || 46);
      const bx = b.x + (b.w || 150) / 2;
      const by = b.y;
      const midY = ay + (by - ay) / 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax, midY);
      ctx.lineTo(bx, midY);
      ctx.lineTo(bx, by);
      ctx.stroke();
      drawArrowhead(ctx, bx, by, Math.PI / 2);
    }
    ctx.setLineDash([]);

    // nodes
    const fontPx = 11;
    for (const n of nodes) {
      const w = n.w || 150, h = n.h || 46;
      const isSel = selectedPath && (n.path === selectedPath);
      const isFocus = focusPath && (n.path === focusPath);
      ctx.fillStyle = n.fill || '#fff';
      ctx.strokeStyle = isSel ? '#2456d6' : (isFocus ? '#d97706' : (n.stroke || '#d3dae5'));
      ctx.lineWidth = isSel || isFocus ? 2 : 1;
      ctx.fillRect(n.x, n.y, w, h);
      ctx.strokeRect(n.x, n.y, w, h);

      // folder glyph
      if (n.kind === 'folder') {
        ctx.fillStyle = '#7c91b3';
        ctx.font = `${fontPx}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('▸', n.x + 8, n.y + h / 2);
      } else if (n.isTest) {
        ctx.fillStyle = '#059669';
        ctx.font = `${fontPx}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', n.x + 8, n.y + h / 2);
      }

      ctx.fillStyle = '#1c2733';
      ctx.font = `500 ${fontPx}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
      ctx.fillText(label, n.x + 22, n.y + h / 2);

      // metric line for files
      if (n.kind === 'file' && n.metrics) {
        ctx.font = `9px sans-serif`;
        ctx.fillStyle = '#8a93a1';
        ctx.textAlign = 'right';
        const short = `${n.metrics.loc || 0}L`;
        ctx.fillText(short, n.x + w - 8, n.y + h / 2);
      }
    }
    ctx.restore();
  }

  function drawArrowhead(context, x, y, angle) {
    const size = 7 / view.scale;
    context.save();
    context.setLineDash([]);
    context.fillStyle = context.strokeStyle;
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-size, -size * 0.55);
    context.lineTo(-size, size * 0.55);
    context.closePath();
    context.fill();
    context.restore();
  }

  // ---------- interaction ----------
  function wireCanvas() {
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const ns = Math.max(0.02, Math.min(6, view.scale * factor));
      view.x = mx - ((mx - view.x) / view.scale) * ns;
      view.y = my - ((my - view.y) / view.scale) * ns;
      view.scale = ns;
      render();
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (e.button === 0 || e.button === 1) {
        const node = nodeAt(mx, my);
        if (node) {
          dragState = { node, sx: mx, sy: my, ox: node.x, oy: node.y, moved: false };
        } else {
          dragState = { pan: true, sx: mx, sy: my, vx: view.x, vy: view.y };
        }
      } else if (e.button === 2) {
        const node = nodeAt(mx, my);
        if (node) {
          selectNode(node.path || node.label);
          showContextMenu(e.clientX, e.clientY, node);
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragState) {
        const rect = canvas.getBoundingClientRect();
        const node = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (node !== hoverNode) {
          hoverNode = node;
          canvas.style.cursor = node ? 'pointer' : 'grab';
          $('.map-status').textContent = node ? (node.path || node.label) : 'Drag to pan · Scroll to zoom · Click node for details';
        }
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dx = mx - dragState.sx;
      const dy = my - dragState.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.moved = true;
      if (dragState.node) {
        dragState.node.x = dragState.ox + dx / view.scale;
        dragState.node.y = dragState.oy + dy / view.scale;
        render();
      } else if (dragState.pan) {
        view.x = dragState.vx + dx;
        view.y = dragState.vy + dy;
        render();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (dragState && dragState.node && !dragState.moved) {
        selectNode(dragState.node.path || dragState.node.label);
        openGraphNodeInfo(dragState.node);
      }
      dragState = null;
    });

    canvas.addEventListener('dblclick', (e) => {
      const rect = canvas.getBoundingClientRect();
      const node = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) {
        if (node.kind === 'folder') toggleCollapse(node.path);
        else if (node.path) openCode(node.path);
        else openGraphNodeInfo(node);
      }
    });
  }

  function nodeAt(mx, my) {
    const nodes = graph.visibleNodes || graph.nodes;
    // reverse draw order
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const s = toScreen(n);
      if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) return n;
    }
    return null;
  }

  // ---------- selection / info ----------
  function selectNode(path) {
    selectedPath = path;
    renderTree();
    render();
  }

  function openInfo(path) {
    if (!path) return;
    const file = fileNodes.get(path);
    const treeN = treeNodes.get(path);
    if (!treeN) return;
    const side = $('.info .body');
    const title = $('.info .title');
    title.textContent = treeN.name;
    $('.info').style.display = 'flex';
    let html = '';
    html += `<div class="pathline">${escape(path)}<span class="copy" data-copy="${escape(path)}">copy</span></div>`;

    if (treeN.isDir) {
      html += `<h4>Folder</h4>`;
      html += `<dl class="metrics"><dt>Files</dt><dd>${treeN.fileCount || 0}</dd><dt>Size</dt><dd>${fmtBytes(treeN.size || 0)}</dd></dl>`;
    } else {
      const m = file ? (file.metrics || {}) : {};
      html += `<h4>File</h4>`;
      html += `<dl class="metrics">
        <dt>Language</dt><dd>${escape(treeN.language || '-')}</dd>
        <dt>Lines</dt><dd>${m.loc || 0}</dd>
        <dt>Size</dt><dd>${fmtBytes(treeN.size || 0)}</dd>
        <dt>Functions</dt><dd>${m.functions || 0}</dd>
        <dt>Classes</dt><dd>${m.classes || 0}</dd>
        <dt>Imports</dt><dd>${m.imports || 0}</dd>
        <dt>Complexity</dt><dd>${escape(m.complexity || '-')}</dd>
        ${file && file.isTest ? '<dt>Role</dt><dd>Test</dd>' : ''}
      </dl>`;
      const syms = treeN.symbols || [];
      if (syms.length) {
        html += `<h4>Symbols (${syms.length})</h4><ul class="symbols">`;
        for (const s of syms.slice(0, 60)) {
          html += `<li data-sym="${escape(s.name)}" data-line="${s.startLine}"><span class="kind">${escape(s.kind)}</span>${escape(s.name)}<span class="line">:${s.startLine}</span></li>`;
        }
        if (syms.length > 60) html += `<li style="color:var(--muted)">… and ${syms.length - 60} more</li>`;
        html += `</ul>`;
      }
      const deps = depsOf(fileNodeFor(path)).filter((d) => d.to !== path);
      if (deps.length) {
        html += `<h4>Dependencies</h4><ul class="deplist">`;
        for (const d of deps.slice(0, 40)) {
          html += `<li data-path="${escape(d.to)}"><span class="mark">${d.uncertain ? '≈' : '→'}</span>${escape(d.to)}</li>`;
        }
        html += `</ul>`;
      }
      const deps2 = dependentsOf(fileNodeFor(path)).filter((d) => d.from !== path);
      if (deps2.length) {
        html += `<h4>Depended on by</h4><ul class="deplist">`;
        for (const d of deps2.slice(0, 40)) {
          html += `<li data-path="${escape(d.from)}"><span class="mark">←</span>${escape(d.from)}</li>`;
        }
        html += `</ul>`;
      }
      html += `<div class="action-row">
        <button data-action="focus" data-path="${escape(path)}">Focus this file</button>
        <button data-action="open" data-path="${escape(path)}">Open file</button>
        <button data-action="copy" data-copy="${escape(path)}">Copy path</button>
        <button data-action="deps" data-path="${escape(path)}">Show deps</button>
      </div>`;
    }
    side.innerHTML = html;
    wireSide(side);
    updateBreadcrumbs(path);
    render();
  }

  function openGraphNodeInfo(node) {
    if (node.path) {
      openInfo(node.path);
      return;
    }
    $('.info').style.display = 'flex';
    $('.info .title').textContent = node.label;
    const connections = graph.edges.filter((e) => e.from === node.id || e.to === node.id).length;
    const title = node.kind === 'external' ? 'External dependency' : 'Architecture group';
    $('.info .body').innerHTML = `<h4>${title}</h4><dl class="metrics"><dt>Name</dt><dd>${escape(node.label)}</dd><dt>Connections</dt><dd>${connections}</dd></dl>`;
  }

  function fileNodeFor(path) {
    for (const n of graph.nodes) {
      if (n.path === path) return n;
    }
    return { path, label: path.split('/').pop() };
  }

  function wireSide(side) {
    side.querySelectorAll('[data-copy]').forEach((el) => {
      el.addEventListener('click', () => copyPath(el.dataset.copy));
    });
    side.querySelectorAll('[data-path]').forEach((el) => {
      el.addEventListener('click', () => { selectNode(el.dataset.path); openInfo(el.dataset.path); });
    });
    side.querySelectorAll('[data-action="focus"]').forEach((el) => {
      el.addEventListener('click', () => setFocus(el.dataset.path));
    });
    side.querySelectorAll('[data-action="open"]').forEach((el) => {
      el.addEventListener('click', () => openCode(el.dataset.path));
    });
    side.querySelectorAll('[data-action="deps"]').forEach((el) => {
      el.addEventListener('click', () => {
        switchMode('dep');
        focusPath = el.dataset.path;
        showFocusBanner();
        render();
      });
    });
    side.querySelectorAll('[data-sym]').forEach((el) => {
      el.addEventListener('click', () => {
        const p = $('.info .title').textContent;
        const node = nodeById.get('node:' + treePathByName(p));
        if (node) {
          highlightNode(node, el.dataset.line);
        }
      });
    });
  }

  function treePathByName(name) {
    for (const [p, n] of treeNodes) {
      if (n.name === name) return p;
    }
    return null;
  }

  function highlightNode(node, line) {
    selectNode(node.path);
    const rect = canvas.getBoundingClientRect();
    view.x = rect.width / 2 - (node.x + node.w / 2) * view.scale;
    view.y = rect.height / 2 - (node.y + node.h / 2) * view.scale;
    render();
    const t = node;
    let count = 0;
    const iv = setInterval(() => {
      if (t.stroke === '#f39c12') { t.stroke = '#d3dae5'; clearInterval(iv); }
      else { t.stroke = '#f39c12'; }
      render();
      if (++count > 4) clearInterval(iv);
    }, 250);
    if (line) $('.map-status').textContent = `${node.path}:${line}`;
  }

  function copyPath(path) {
    if (navigator.clipboard) navigator.clipboard.writeText(path);
    $('.map-status').textContent = 'Copied: ' + path;
  }

  function updateBreadcrumbs(path) {
    const parts = path.split('/');
    const bc = $('.breadcrumbs');
    bc.innerHTML = '';
    let acc = '';
    parts.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '/';
        bc.appendChild(sep);
      }
      acc = acc ? acc + '/' + p : p;
      const c = document.createElement('span');
      c.className = 'crumb';
      c.textContent = p;
      c.addEventListener('click', () => {
        if (i === parts.length - 1) { selectNode(acc); openInfo(acc); }
        else {
          // find the dir node and select
          const dir = treeNodes.get(acc);
          if (dir) { selectNode(acc); openInfo(acc); }
        }
      });
      bc.appendChild(c);
    });
  }

  // ---------- context menu ----------
  function showContextMenu(x, y, node) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    const p = node.path;
    const isFolder = node.kind === 'folder';
    let html = '';
    if (!isFolder) {
      html += `<div class="item" data-act="open">Open file</div>`;
      html += `<div class="item" data-act="focus">Focus this module <span class="hint">F</span></div>`;
      html += `<div class="item" data-act="deps">Show dependencies <span class="hint">D</span></div>`;
      html += `<div class="item" data-act="dependents">Show dependents</div>`;
      html += `<div class="sep"></div>`;
    }
    html += `<div class="item" data-act="expand">Expand recursively</div>`;
    html += `<div class="item" data-act="collapse">Collapse recursively</div>`;
    html += `<div class="sep"></div>`;
    html += `<div class="item" data-act="copy">Copy path <span class="hint">C</span></div>`;
    if (!isFolder) html += `<div class="item" data-act="editor">Open in editor</div>`;
    menu.innerHTML = html;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-act]');
      if (item) handleMenuAction(item.dataset.act, node);
      menu.remove();
    });
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  function handleMenuAction(act, node) {
    const p = node.path;
    switch (act) {
      case 'open': openCode(p); break;
      case 'focus': setFocus(p); break;
      case 'deps': switchMode('dep'); focusPath = p; showFocusBanner(); render(); break;
      case 'dependents': switchMode('dep'); showDependents(p); break;
      case 'expand': expandRecursive(p); break;
      case 'collapse': collapseRecursive(p); break;
      case 'copy': copyPath(p); break;
      case 'editor': openInEditor(p); break;
    }
  }

  function expandRecursive(path) {
    if (!path) return;
    for (const [p, n] of treeNodes) {
      if (p === path || p.startsWith(path + '/')) collapsed.delete(p);
    }
    savePrefs();
    renderTree();
    applyCollapseToGraph();
    resetView();
  }

  function collapseRecursive(path) {
    for (const [p, n] of treeNodes) {
      if (p === path || p.startsWith(path + '/')) collapsed.add(p);
    }
    savePrefs();
    renderTree();
    applyCollapseToGraph();
    resetView();
  }

  function setFocus(path) {
    focusPath = path;
    showFocusBanner();
    if (currentMode !== 'flow') switchMode('flow');
    // zoom to the node
    const n = nodeById.get('node:' + path);
    if (n) highlightNode(n);
    else selectNode(path);
  }

  function showFocusBanner() {
    let b = $('.focus-banner');
    if (!b) {
      b = document.createElement('div');
      b.className = 'focus-banner';
      b.innerHTML = '<b>Focus mode:</b> <span class="fp"></span> <button class="clear">Exit focus</button>';
      $('.map-wrap').appendChild(b);
      b.querySelector('.clear').addEventListener('click', () => { focusPath = null; b.remove(); render(); });
    }
    b.querySelector('.fp').textContent = focusPath;
  }

  function showDependents(path) {
    // highlight all nodes that depend on this file
    const target = fileNodeFor(path);
    const deps = dependentsOf(target);
    const related = new Set([path]);
    for (const d of deps) related.add(d.from);
    graph.visibleNodes = graph.nodes.filter((n) => related.has(n.path));
    graph.visibleEdges = graph.edges.filter((e) => {
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      return a && b && related.has(a.path) && related.has(b.path);
    });
    resetView();
  }

  // ---------- code view ----------
  function openCode(path) {
    const file = fileNodes.get(path);
    fetch('/api/file?path=' + encodeURIComponent(path))
      .then((r) => r.ok ? r.text() : Promise.reject())
      .then((src) => {
        const cv = document.createElement('div');
        cv.className = 'codeview';
        const lines = src.split('\n');
        let html = `<div class="head"><span>${escape(path)}</span><button class="close">&times;</button></div><pre>`;
        lines.forEach((l, i) => {
          html += `<span class="ln">${i + 1}</span>${escape(l)}\n`;
        });
        html += `</pre>`;
        cv.innerHTML = html;
        cv.querySelector('.close').addEventListener('click', () => cv.remove());
        $('.map-wrap').appendChild(cv);
      });
  }

  function openInEditor(path) {
    const cmd = editor;
    const full = path; // server-relative; UI doesn't know absolute root
    let uri = '';
    switch (cmd) {
      case 'vscode': uri = 'vscode://file/' + absoluteOf(path); break;
      case 'cursor': uri = 'cursor://file/' + absoluteOf(path); break;
      case 'zed': uri = 'zed://file/' + absoluteOf(path); break;
      case 'sublime': uri = 'subl://' + absoluteOf(path); break;
      default: uri = 'vscode://file/' + absoluteOf(path);
    }
    // eslint-disable-next-line no-undef
    try { window.open(uri); } catch {}
  }
  function absoluteOf(path) {
    // best effort: strip nothing; the API returns relative. For real absolute,
    // we'd need the root injected. Keep it simple: use protocol handler with relative is invalid.
    return '/' + path;
  }

  // ---------- search ----------
  let searchResults = [];
  let searchIdx = 0;
  function wireSearch() {
    const input = $('#search');
    const results = $('.search-results');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { results.innerHTML = ''; results.style.display = 'none'; return; }
      const all = [];
      for (const [p, n] of treeNodes) {
        if (n.isDir) continue;
        if (p.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)) {
          all.push({ path: p, name: n.name, lang: n.language });
        }
        if (all.length > 200) break;
      }
      // prioritize filename match over path match
      all.sort((a, b) => (b.name.toLowerCase().includes(q) ? 1 : 0) - (a.name.toLowerCase().includes(q) ? 1 : 0));
      searchResults = all;
      searchIdx = 0;
      renderResults(all);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); searchIdx = Math.min(searchIdx + 1, searchResults.length - 1); renderResults(searchResults); }
      if (e.key === 'ArrowUp') { e.preventDefault(); searchIdx = Math.max(searchIdx - 1, 0); renderResults(searchResults); }
      if (e.key === 'Enter' && searchResults.length) {
        const r = searchResults[searchIdx];
        input.value = '';
        results.style.display = 'none';
        locateNode(r.path);
      }
      if (e.key === 'Escape') { input.value = ''; results.style.display = 'none'; }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.searchbox')) results.style.display = 'none';
    });
  }

  function renderResults(list) {
    const el = $('.search-results');
    el.style.display = 'block';
    if (!list.length) { el.innerHTML = '<div class="empty">No matches</div>'; return; }
    el.innerHTML = list.map((r, i) =>
      `<div class="item ${i === searchIdx ? 'active' : ''}" data-path="${escape(r.path)}"><span class="path">${escape(r.path)}</span><span class="lang">${escape(r.lang)}</span></div>`
    ).join('');
    el.querySelectorAll('.item').forEach((item) => {
      item.addEventListener('click', () => {
        $('#search').value = '';
        el.style.display = 'none';
        locateNode(item.dataset.path);
      });
    });
    el.scrollTop = 0;
  }

  function locateNode(path) {
    // 1. expand parents 2. find 3. center 4. highlight
    const parts = path.split('/');
    let acc = '';
    for (const p of parts.slice(0, -1)) {
      acc = acc ? acc + '/' + p : p;
      collapsed.delete(acc);
    }
    savePrefs();
    renderTree();
    if (currentMode === 'flow') {
      applyCollapseToGraph();
      computeNodeSizes();
      resetView();
    }
    selectNode(path);
    openInfo(path);
    // find in current graph
    const n = nodeById.get('node:' + path);
    if (n) highlightNode(n);
  }

  // ---------- keyboard ----------
  function wireKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
      const k = e.key.toLowerCase();
      const map = {
        f: () => selectedPath && setFocus(selectedPath),
        e: () => selectedPath && expandRecursive(selectedPath),
        c: () => selectedPath && collapseRecursive(selectedPath),
        r: () => resetView(),
        v: () => switchMode('graph'),
        g: () => switchMode('dep'),
        t: () => switchMode('flow'),
        a: () => switchMode('arch'),
        d: () => selectedPath && (switchMode('dep'), focusPath = selectedPath, showFocusBanner(), render()),
        x: () => selectedPath && openCode(selectedPath),
        h: () => toggleHeat(),
      };
      if (map[k]) map[k]();
    });
  }

  function toggleHeat() {
    const order = ['loc', 'complexity', 'deps', 'dependents', null];
    const idx = order.indexOf(heat);
    heat = order[(idx + 1) % order.length];
    computeNodeSizes();
    render();
    $('.map-status').textContent = heat ? 'Heatmap: ' + heat : 'Heatmap off';
  }

  function downloadCurrentGraph() {
    const nodes = graph.visibleNodes || graph.nodes;
    const edges = graph.visibleEdges || graph.edges;
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    const pad = 40;
    const xml = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" font-family="Arial,sans-serif">`,
      '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0L0 6L8 3z" fill="#64748b"/></marker></defs>'];
    for (const e of edges) {
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      if (!a || !b) continue;
      const ax = a.x + a.w / 2, ay = a.y + a.h, bx = b.x + b.w / 2, by = b.y;
      const midY = ay + (by - ay) / 2;
      xml.push(`<path d="M${ax} ${ay}V${midY}H${bx}V${by}" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>`);
    }
    for (const n of nodes) {
      xml.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7" fill="${n.fill}" stroke="${n.stroke}"/>`);
      xml.push(`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 4}" text-anchor="middle" font-size="11" fill="#1c2733">${escape(n.label)}</text>`);
    }
    xml.push('</svg>');
    const url = URL.createObjectURL(new Blob([xml.join('\n')], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `codemap-${currentMode}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ---------- zoom controls ----------
  function wireUI() {
    $$('.modes button').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
    $('.zoom-in').addEventListener('click', () => { view.scale = Math.min(6, view.scale * 1.3); render(); });
    $('.zoom-out').addEventListener('click', () => { view.scale = Math.max(0.02, view.scale / 1.3); render(); });
    $('.zoom-fit').addEventListener('click', () => resetView());
    $('#heat-toggle').addEventListener('click', toggleHeat);
    $('#download-graph').addEventListener('click', downloadCurrentGraph);
    $('.info .head .close').addEventListener('click', () => { $('.info').style.display = 'none'; });
    $('#editor-select').addEventListener('change', (e) => {
      editor = e.target.value;
      savePrefs();
    });
    $('#expand-all').addEventListener('click', () => {
      const total = DATA.stats.files;
      if (total > 8000) {
        if (!confirm(`Expand all ${total.toLocaleString()} files? This may be slow.`)) return;
      }
      collapsed.clear();
      savePrefs();
      renderTree();
      applyCollapseToGraph();
      resetView();
    });
    $('#collapse-all').addEventListener('click', () => {
      for (const [p, n] of treeNodes) if (n.isDir && n.path !== '.') collapsed.add(p);
      savePrefs();
      renderTree();
      applyCollapseToGraph();
      resetView();
    });
    $('#open-root').addEventListener('click', () => { openInfo('.'); });
    $('#copy-root').addEventListener('click', () => copyPath(DATA.meta.root));
  }

  function renderProjectInfo() {
    const m = DATA.meta;
    const stats = DATA.stats;
    const body = $('.info .body');
    $('.info .title').textContent = m.root;
    let html = `<h4>Project</h4>`;
    html += `<dl class="metrics"><dt>Type</dt><dd>${escape(m.type)}</dd>`;
    if (m.framework) html += `<dt>Framework</dt><dd>${escape(m.framework)}</dd>`;
    if (m.packageManager) html += `<dt>Pkg manager</dt><dd>${escape(m.packageManager)}</dd>`;
    html += `<dt>Languages</dt><dd>${escape((m.languages || []).slice(0, 6).join(', '))}</dd>`;
    html += `<dt>Files</dt><dd>${stats.files.toLocaleString()}</dd>`;
    html += `<dt>Lines</dt><dd>${(stats.totalLines || 0).toLocaleString()}</dd>`;
    html += `<dt>Entry points</dt><dd>${escape((m.entryPoints || []).slice(0, 4).join(', ') || 'auto')}</dd></dl>`;
    const langs = Object.entries(stats.languageStats || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (langs.length) {
      html += `<h4>Languages</h4><ul class="deplist">`;
      for (const [l, c] of langs) html += `<li><span class="mark">·</span>${escape(l)} <span style="margin-left:auto;color:var(--muted)">${c}</span></li>`;
      html += `</ul>`;
    }
    html += `<h4>Editor</h4><select id="editor-select" style="width:100%;padding:6px;border:1px solid var(--border-strong);background:var(--bg)">
      <option value="vscode" ${editor === 'vscode' ? 'selected' : ''}>VS Code</option>
      <option value="cursor" ${editor === 'cursor' ? 'selected' : ''}>Cursor</option>
      <option value="zed" ${editor === 'zed' ? 'selected' : ''}>Zed</option>
      <option value="sublime" ${editor === 'sublime' ? 'selected' : ''}>Sublime</option>
    </select>`;
    body.innerHTML = html;
  }

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }

  // ---------- resize ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const wrap = $('.map-wrap');
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    render();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('load', () => {
    wireCanvas();
    wireSearch();
    wireKeyboard();
    boot().then(resize).catch((err) => {
      $('.map-status').textContent = 'Unable to load CodeMap: ' + err.message;
      console.error(err);
    });
  });
})();
