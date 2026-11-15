/* LORIANO queue: no network, database, or playback side effects. */
'use strict';
window.LorianoQueue = class LorianoQueue {
  static modes = ['shuffle', 'sequential', 'repeat'];
  constructor(ids, saved = {}, random = Math.random) {
    this.ids = [...new Set(ids.filter(id => /^[\w-]{11}$/.test(id)))];
    this.random = random;
    this.mode = LorianoQueue.modes.includes(saved.mode) ? saved.mode : 'shuffle';
    const valid = id => this.ids.includes(id);
    const oldHistory = Array.isArray(saved.history) ? saved.history : [];
    const oldCursor = Math.max(0, Math.min(oldHistory.length - 1, Number.isInteger(saved.cursor) ? saved.cursor : oldHistory.length - 1));
    const offset = Math.max(0, oldHistory.length - 2000);
    this.history = oldHistory.slice(offset).filter(valid);
    this.cursor = Math.max(0, oldHistory.slice(offset, oldCursor + 1).filter(valid).length - 1);
    this.visited = new Set(Array.isArray(saved.visited) ? saved.visited.filter(valid) : []);
    const current = valid(saved.current) ? saved.current : this.history[this.cursor];
    if (current) {
      if (this.history[this.cursor] !== current) { this.history = [current]; this.cursor = 0; }
      this.visited.add(current);
    } else if (this.ids.length) {
      this.history = []; this.cursor = -1;
      this.commit(this.mode === 'shuffle' ? this.pick(this.ids) : this.ids[0]);
    }
  }
  get current() { return this.history[this.cursor] || ''; }
  pick(ids) { return ids[Math.min(ids.length - 1, Math.floor(this.random() * ids.length))]; }
  commit(id) {
    if (!id) return null;
    this.history = this.history.slice(0, this.cursor + 1);
    this.history.push(id);
    if (this.history.length > 2000) this.history.shift();
    this.cursor = this.history.length - 1;
    this.visited.add(id);
    return id;
  }
  next() {
    if (!this.ids.length) return null;
    if (this.cursor < this.history.length - 1) {
      const id = this.history[++this.cursor]; this.visited.add(id); return id;
    }
    let id;
    if (this.mode === 'shuffle') {
      let candidates = this.ids.filter(id => !this.visited.has(id));
      if (!candidates.length) {
        this.visited = new Set(this.current ? [this.current] : []);
        candidates = this.ids.filter(id => id !== this.current);
      }
      id = this.pick(candidates.length ? candidates : this.ids);
    } else {
      const index = this.ids.indexOf(this.current) + 1;
      if (index >= this.ids.length && this.mode !== 'repeat') return null;
      id = this.ids[index % this.ids.length];
    }
    return this.commit(id);
  }
  previous() { return this.cursor > 0 ? this.history[--this.cursor] : null; }
  setMode(mode) {
    if (!LorianoQueue.modes.includes(mode)) return;
    this.mode = mode;
    this.history = this.history.slice(0, this.cursor + 1);
  }
  snapshot() {
    return { mode: this.mode, current: this.current, history: [...this.history], cursor: this.cursor, visited: [...this.visited] };
  }
};
