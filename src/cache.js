'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CACHE_VERSION = 2;

// Incremental cache. Stores per-file parse results keyed by mtime+size+hash
// so rescans only reparse files that changed.

class Cache {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'codemap-cache.json');
    this.data = { version: CACHE_VERSION, files: {} };
    this.loaded = false;
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (this.data.version !== CACHE_VERSION) this.data = { version: CACHE_VERSION, files: {} };
      }
    } catch {
      this.data = { version: CACHE_VERSION, files: {} };
    }
    this.loaded = true;
    return this;
  }

  key(filePath, stat) {
    const h = crypto.createHash('sha1');
    h.update(filePath);
    h.update(String(stat.mtimeMs));
    h.update(String(stat.size));
    return h.digest('hex');
  }

  get(filePath, stat) {
    if (!this.loaded) this.load();
    const k = this.key(filePath, stat);
    const entry = this.data.files[k];
    return entry || null;
  }

  put(filePath, stat, analysis) {
    if (!this.loaded) this.load();
    const k = this.key(filePath, stat);
    this.data.files[k] = analysis;
    if (Object.keys(this.data.files).length > 200000) {
      const keys = Object.keys(this.data.files);
      for (let i = 0; i < keys.length - 150000; i++) delete this.data.files[keys[i]];
    }
  }

  save() {
    if (!this.loaded) return;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // non-fatal
    }
  }

  clean() {
    try {
      if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    } catch {}
  }

  stats() {
    if (!this.loaded) this.load();
    return { files: Object.keys(this.data.files).length };
  }
}

module.exports = { Cache };
