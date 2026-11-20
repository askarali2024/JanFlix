/**
 * JanFlix — tiny JSON persistence layer.
 * Each collection lives in its own JSON file inside DATA_DIR.
 * Writes are atomic (temp file + rename) so a crash never corrupts data.
 */

'use strict';

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} dataDir absolute data directory
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.imagesDir = path.join(dataDir, 'images');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    this.collections = new Map();
  }

  filePath(name) {
    return path.join(this.dataDir, `${name}.json`);
  }

  /**
   * Load a collection (or initialize with a default).
   * @param {string} name
   * @param {*} defaultValue
   */
  load(name, defaultValue) {
    try {
      const raw = fs.readFileSync(this.filePath(name), 'utf8');
      const parsed = JSON.parse(raw);
      this.collections.set(name, parsed);
      return parsed;
    } catch {
      this.collections.set(name, defaultValue);
      this.save(name);
      return defaultValue;
    }
  }

  get(name) {
    return this.collections.get(name);
  }

  set(name, value) {
    this.collections.set(name, value);
  }

  /** Atomic write of a collection to disk. */
  save(name) {
    const value = this.collections.get(name);
    if (value === undefined) return;
    const target = this.filePath(name);
    const tmp = `${target}.tmp-${Date.now()}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
}

module.exports = { JsonStore };
