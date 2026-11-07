/* Original implementation. MIT license, see LICENSE. Browser + CommonJS. */
(function (root) {
  'use strict';
  const MAX_BYTES = 1024 * 1024;
  const MAX_NODES = 50000;
  const MAX_DEPTH = 100;
  const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const escapePointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  function parse(text, label = 'Input') {
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error(`${label}: exceeds the 1 MiB limit.`);
    let value;
    try { value = JSON.parse(text); } catch (error) { throw new Error(`${label}: invalid JSON. ${error.message}`); }
    const stack = [[value, 0]];
    let nodes = 0;
    while (stack.length) {
      const [item, depth] = stack.pop();
      if (++nodes > MAX_NODES) throw new Error(`${label}: exceeds the 50,000 node limit.`);
      if (depth > MAX_DEPTH) throw new Error(`${label}: exceeds the 100 level nesting limit.`);
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error(`${label}: number outside the finite JavaScript range.`);
      if (Number.isInteger(item) && !Number.isSafeInteger(item)) throw new Error(`${label}: integer outside JavaScript's safe range. Encode large IDs as strings.`);
      if (item !== null && typeof item === 'object') for (const child of Object.values(item)) stack.push([child, depth + 1]);
    }
    return value;
  }
  function diff(before, after, structureOnly = false) {
    const changes = [];
    function visit(a, b, path) {
      const at = type(a), bt = type(b);
      if (at !== bt) { changes.push({kind: 'type', path, before: a, after: b}); return; }
      if (at === 'object' || at === 'array') {
        const keys = at === 'array' ? Array.from({length: Math.max(a.length, b.length)}, (_, i) => String(i)) : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
        for (const key of keys) {
          const childPath = `${path}/${escapePointer(key)}`;
          if (!Object.hasOwn(a, key)) changes.push({kind: 'added', path: childPath, after: b[key]});
          else if (!Object.hasOwn(b, key)) changes.push({kind: 'removed', path: childPath, before: a[key]});
          else visit(a[key], b[key], childPath);
        }
      } else if (!structureOnly && a !== b) changes.push({kind: 'changed', path, before: a, after: b});
    }
    visit(before, after, '');
    return changes;
  }
  function markdown(changes, structureOnly) {
    // Encode HTML and Markdown delimiters so untrusted keys cannot become active markup.
    const safe = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&').replace(/\r?\n/g, ' ');
    const lines = ['# JSON Diff Lens report', '', `Mode: ${structureOnly ? 'structure only' : 'all changes'}. ${changes.length} change(s).`, '', 'Arrays compared by position; object key order ignored.', '', 'Contains original data and field names. Review before sharing.', ''];
    for (const c of changes) {
      lines.push(`## ${c.kind.toUpperCase()} — ${safe(c.path || '(root)')}`, '');
      if (Object.hasOwn(c, 'before')) lines.push(`Before (${type(c.before)}): ${safe(JSON.stringify(c.before))}`, '');
      if (Object.hasOwn(c, 'after')) lines.push(`After (${type(c.after)}): ${safe(JSON.stringify(c.after))}`, '');
    }
    if (!changes.length) lines.push('No differences in this mode.', '');
    return lines.join('\n');
  }
  const api = {parse, diff, type, markdown, MAX_BYTES};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiffLens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
