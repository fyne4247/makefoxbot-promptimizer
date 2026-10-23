#!/usr/bin/env node
'use strict';
// Existing simple output: {"query": ["canonical tag", ...]}.
// Optional --explain: returns category, popularity, direct tag implications,
// from the official e621 exports.
const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'references');
const GENERATIVE_CATEGORIES = new Set([0, 5, 8]);
const CATEGORY_NAMES = {
  0: 'general', 1: 'artist', 2: 'rating', 3: 'copyright',
  4: 'character', 5: 'species', 6: 'invalid', 7: 'meta', 8: 'lore',
};

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_./:()[\]{}<>-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function toDisplayName(name) {
  return String(name).replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/_/g, ' ');
}
function lowerBound(rows, key) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function exactRow(rows, name) {
  const i = lowerBound(rows, name);
  return i < rows.length && rows[i][0] === name ? rows[i] : null;
}
function optionalJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
function parseOptions(args) {
  const out = {terms: [], explain: false, limit: 12, dataDir: DEFAULT_DATA_DIR};
  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    if (arg === '--explain') out.explain = true;
    else if (arg === '--data-dir') out.dataDir = args[++i];
    else if (arg === '--limit') out.limit = Number(args[++i]);
    else if (arg === '--help') { out.help = true; }
    else if (arg.startsWith('--')) throw Error(`Unknown option: ${arg}`);
    else out.terms.push(arg);
  }
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 100) {
    throw Error('--limit must be between 1 and 100');
  }
  if (!out.dataDir) throw Error('Missing --data-dir argument');
  return out;
}
function loadData(dataDir) {
  const tags = JSON.parse(fs.readFileSync(path.join(dataDir, 'tags.json'), 'utf8'));
  const aliases = JSON.parse(fs.readFileSync(path.join(dataDir, 'aliases.json'), 'utf8'));
  const implicationPath = path.join(dataDir, 'implications.json');
  return {
    tags, aliases,
    implications: optionalJson(implicationPath, {}),
    hasImplications: fs.existsSync(implicationPath),
  };
}
function resolveAlias(name, aliases) {
  let cur = name;
  const seen = new Set([cur]);
  for (let i = 0; i < 20 && aliases[cur]; i++) {
    if (seen.has(aliases[cur])) break;
    cur = aliases[cur];
    seen.add(cur);
  }
  return cur;
}
function lookup(term, data, limit=12) {
  const q = normalize(term);
  if (!q) return [];
  const key = q.replace(/ /g, '_');
  const selected = new Map();
  const push = (name, matchType) => {
    const canonical = resolveAlias(name, data.aliases);
    const row = exactRow(data.tags, canonical);
    if (!row || selected.has(row[0])) return;
    selected.set(row[0], {name: row[0], category: row[1], postCount: row[2], matchType});
  };
  const ex = exactRow(data.tags, key);
  if (ex) push(ex[0], 'exact');
  if (!ex && data.aliases[key]) push(key, 'alias');
  const start = lowerBound(data.tags, key);
  const matches = [];
  for (let i = start; i < data.tags.length; i++) {
    const row = data.tags[i];
    if (!row[0].startsWith(key)) break;
    if (row[0].length !== key.length && row[0][key.length] !== '_') continue;
    // Artist, character and copyright tags remain available for exact lookup
    // and implication traversal, but do not crowd generic suggestions.
    if (!GENERATIVE_CATEGORIES.has(row[1])) continue;
    matches.push(row);
  }
  matches.sort((a,b)=>b[2]-a[2] || a[0].localeCompare(b[0]));
  for (const row of matches) {
    push(row[0], 'prefix');
    if (selected.size >= limit) break;
  }
  return [...selected.values()].slice(0,limit).map(item=>({
    ...item, tag: toDisplayName(item.name),
    impliedTags: (data.implications[item.name] || [])
      .map(t=>resolveAlias(t, data.aliases)).filter((t,i,arr)=>arr.indexOf(t)===i)
      .map(toDisplayName),
  }));
}
function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help || options.terms.length === 0) {
    process.stdout.write('Usage: node scripts/lookup-tag.js [--explain] [--limit N] [--data-dir DIR] <term> [term...]\n');
    return;
  }
  const data = loadData(options.dataDir);
  const result = {};
  for (const term of options.terms) {
    const matches = lookup(term, data, options.limit);
    result[term] = options.explain ? matches.map(m=>({
      tag: m.tag,
      category: CATEGORY_NAMES[m.category] || 'unknown',
      post_count: m.postCount,
      match_type: m.matchType,
      implications: data.hasImplications ? m.impliedTags : null,
    })) : matches.map(m=>m.tag);
  }
  const doc = options.explain ? {sources: {
    tag_implications_available: data.hasImplications,
  }, results: result} : result;
  process.stdout.write(JSON.stringify(doc, null, 2)+'\n');
}
try { main(); }
catch(e) { process.stderr.write(e.message+'\n'); process.exitCode = 1; }
