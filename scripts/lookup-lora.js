#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATALOG = path.join(__dirname, '..', 'references', 'loras.json');
const GENERIC = new Set(['male', 'female', 'solo', 'duo', 'furry', 'anthro', 'feral',
  'animal', 'disney', 'cartoon', 'style', 'young', 'dog', 'cat', 'fox', 'wolf', '1boy', '1girl']);

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[_./:()[\]{}<>-]+/g, ' ').replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}
function family(value) {
  const s = normalize(value);
  if (!s) return '';
  if (/illustrious|\bil\b/.test(s)) return 'illustrious';
  if (/noobai|noob ai/.test(s)) return 'noobai';
  if (/pony/.test(s)) return 'pony';
  if (/animagine/.test(s)) return 'animagine';
  if (/anima/.test(s)) return 'anima';
  if (/flux/.test(s)) return 'flux';
  if (/sdxl|sd xl/.test(s)) return 'sdxl';
  if (/sd 1 5|sd15/.test(s)) return 'sd15';
  return s;
}
function baseName(value) {
  return String(value ?? '').replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .split('(')[0].trim().replace(/\s+/g, ' ');
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function searchAliases(entry) {
  const keys = [baseName(entry.name), entry.name, ...(entry.aliases || [])];
  const combined = /(?:\band\b|&|multiple characters|\bduo\b)/i.test(entry.name || '');
  if (!combined) {
    for (const trigger of entry.trigger_words || []) {
      const norm = normalize(trigger);
      if (norm.length >= 5 && !norm.includes(' ') && !GENERIC.has(norm)) keys.push(trigger);
    }
  }
  return unique(keys.map(normalize));
}
// Prefer catalog-provided character identifiers. If absent, infer only from
// short, explicit name lists in the LoRA title (e.g. "Timon and Pumbaa").
// Never interpret a franchise name in parentheses as a character list.
function charactersFor(record) {
  const declared = ['characters', 'duo_characters', 'multi_characters', 'character_names']
    .flatMap(key => Array.isArray(record[key]) ? record[key] : []);
  const uniqueNames = unique(declared.map(value => String(value || '').trim()));
  if (uniqueNames.length >= 2) return uniqueNames;
  const title = baseName(record.name);
  if (/\b(concept|styles?|backgrounds?|artists?|poses?|actions?|objects?|fetish|meme)\b/i.test(title)) return [];
  const parts = title.split(/\s*(?:,|\band\b|&)\s*/i).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 8 ||
      parts.some(part => part.split(/\s+/).length > 3 || !/[\p{L}\p{N}]/u.test(part))) return [];
  return unique(parts);
}
function allCharacterMatches(record, queries) {
  const names = charactersFor(record).map(normalize);
  if (names.length < 2) return false;
  // Exact identity matching prevents an "Adult Simba" multi-LoRA from being
  // silently substituted for a requested "Young Simba" variant.
  return queries.every(query => names.includes(normalize(baseName(query))));
}
function combinedOptions(candidates, queries, limit) {
  const clean = unique(queries.map(value => normalize(baseName(value))));
  if (clean.length < 2) return [];
  return candidates.filter(record => allCharacterMatches(record, clean))
    // Favor an adapter trained on exactly the requested cast over a larger one.
    // The larger multi-LoRA is still valid if there is no more specific option.
    .sort((a, b) => charactersFor(a).length - charactersFor(b).length ||
       a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(record => ({...publicRecord(record), covered_characters:queries.slice(),
      catalog_characters:charactersFor(record)}));
}
function matchScore(record, query) {
  let best = 0;
  for (const alias of record._search) {
    if (query === alias) best = Math.max(best, 10000 + alias.length);
    else if (query.length >= 3 && (` ${query} `).includes(` ${alias} `))
      best = Math.max(best, 7000 + alias.length);
    else if (query.length >= 3 && (` ${alias} `).includes(` ${query} `))
      best = Math.max(best, 3000 + query.length);
  }
  // For multiword queries, match words in the full title, but rank below phrase matches.
  if (!best && query.length >= 5) {
    const terms = query.split(' ').filter(t => t.length > 2);
    const title = normalize(record.name);
    if (terms.length && terms.every(t => (` ${title} `).includes(` ${t} `))) best = 1000 + terms.length;
  }
  return best;
}
function parseArgs(argv) {
  let model = null, catalog = DEFAULT_CATALOG, limit = 5;
  const queries = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' && argv[i + 1]) model = argv[++i];
    else if (a === '--catalog' && argv[i + 1]) catalog = argv[++i];
    else if (a === '--limit' && argv[i + 1]) limit = Math.min(30, Math.max(1, Number(argv[++i]) || 5));
    else if (a === '--help') { console.log('Usage: node scripts/lookup-lora.js [--model Illustrious] [--catalog PATH] [--limit 5] "character" [more queries]'); process.exit(0); }
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else if (a.trim()) queries.push(a.trim());
  }
  if (!queries.length) throw new Error('Provide one or more character, style, or concept names.');
  return { model, catalog, limit, queries };
}
function publicRecord(record) {
  const { _search, ...data } = record;
  return data;
}
function main() {
  const { model, catalog, limit, queries } = parseArgs(process.argv.slice(2));
  const parsed = JSON.parse(fs.readFileSync(catalog, 'utf8'));
  const all = Array.isArray(parsed) ? parsed : parsed.loras;
  if (!Array.isArray(all)) throw new Error('Catalog must be an array or an object containing a loras array.');
  const filter = family(model);
  const candidates = all.filter(r => r && r.name && (!filter || family(r.base_model) === filter))
    .map(r => ({...r, _search: searchAliases(r)}));
  const results = queries.map(q => {
    const needle = normalize(q);
    return {query:q, matches:candidates.map(record => ({record, score:matchScore(record,needle)}))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score-a.score || a.record.name.localeCompare(b.record.name))
      .slice(0, limit).map(x => ({score:x.score, ...publicRecord(x.record)}))};
  });
  // Recommend a single combined adapter only when it covers EVERY requested
  // character, not merely any two of a three-or-more character scene.
  const preferred_combined = combinedOptions(candidates, queries, limit);
  console.log(JSON.stringify({catalog_complete: parsed.complete === true,
    catalog_count: all.length, searched_count:candidates.length, requested_base_model:model,
    preferred_combined,
    multi_character: {requested_characters:queries.length > 1 ? queries : [],
      recommended: preferred_combined[0] || null,
      note: 'A compatible single LoRA covering the full requested cast is preferred over stacking separate character LoRAs; other LoRAs are not automatically added.'},
    results}, null, 2));
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
