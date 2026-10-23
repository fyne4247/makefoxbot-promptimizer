#!/usr/bin/env node
'use strict';

// Convert public MakeFox JSON exports / previously captured response JSON into the
// stable references/loras.json schema. No access to accounts or private API needed.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node scripts/import-loras.js SOURCE.json [--out references/loras.json] [--complete]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const input = args[0];
const output = args.includes('--out') ? args[args.indexOf('--out') + 1] :
  path.join(__dirname, '..', 'references', 'loras.json');
const markComplete = args.includes('--complete');
if (!output) throw new Error('Missing --out value');
function first(rec, keys) {
  for (const key of keys) if (rec[key] != null && rec[key] !== '') return rec[key];
  return null;
}
function text(v) { return v == null ? '' : String(v).trim(); }
function triggers(value) {
  if (Array.isArray(value)) return [...new Set(value.map(v => typeof v === 'string' ? v :
    (v && typeof v === 'object' ? first(v,['name','word','tag']) : '')).map(text).filter(Boolean))];
  if (typeof value === 'string') return value.split(/[,;\n]+/).map(text).filter(Boolean);
  return [];
}
function collect(value, out, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const x of value) collect(x,out,seen); return; }
  // Capture records with an identifiable LoRA filename or exact syntax, and a name.
  const name = first(value,['name','title','display_name','model_name']);
  const syntax = first(value,['lora_syntax','loraSyntax','syntax','prompt_token']);
  const filename = first(value,['filename','file_name','model_filename','fileName']);
  if (name && (syntax || filename)) out.push(value);
  for (const [k,v] of Object.entries(value)) {
    if (['preview','image','images','metadata','cover_image','thumbnail','user','owner'].includes(k)) continue;
    if (v && typeof v === 'object') collect(v,out,seen);
  }
}
const raw = JSON.parse(fs.readFileSync(input,'utf8'));
const found = []; collect(raw,found,new WeakSet());
const catalogBase = !Array.isArray(raw) ? first(raw,['base_model','baseModel','model_family']) : null;
const entries = new Map();
const rejected = [];
for (const item of found) {
  const name = text(first(item,['name','title','display_name','model_name']))
    .replace(/\s*\[User (?:Selected|Added)\]\s*$/i, '');
  const file = text(first(item,['filename','file_name','model_filename','fileName']));
  let syntax = text(first(item,['lora_syntax','loraSyntax','syntax','prompt_token']));
  if (!/^<lora:.+:[0-9.]+>$/.test(syntax) && file) {
    syntax = `<lora:${file.replace(/\.(safetensors|ckpt|pt)$/i,'')}:1>`;
  }
  if (!/^<lora:.+:[0-9.]+>$/.test(syntax)) {
    rejected.push({name, reason:'Missing valid LoRA token or filename'});
    continue;
  }
  const id = text(first(item,['id','lora_id','model_id'])) || syntax;
  const entry = {id, name, lora_syntax:syntax,
    base_model: text(first(item,['base_model','baseModel','model_family','baseModelName']) || catalogBase) || null,
    trigger_words:triggers(first(item,['trigger_words','triggerWords','trained_words','trainedWords','activation_tags']))};
  // Preserve non-personal cast metadata. It enables reliable multi-character
  // matching for LoRAs whose titles don't individually name the characters.
  const cast = first(item, ['characters', 'duo_characters', 'multi_characters', 'character_names']);
  if (Array.isArray(cast) && cast.length >= 2) {
    entry.characters = [...new Set(cast.map(text).filter(Boolean))];
  }
  // No favorites, hidden, selected, user info, or personalized aliases in shared schema.
  const key = `${id}::${entry.base_model || ''}`;
  if (!entries.has(key)) entries.set(key,entry);
}
if (!entries.size) throw new Error('No LoRA records found. Inspect source JSON field names and update importer; existing catalog left unchanged.');
const missingFamilies = [...entries.values()].filter(x=>!x.base_model).length;
if (markComplete && (rejected.length || missingFamilies)) throw new Error(
  `Cannot mark complete: ${rejected.length} invalid entries and ${missingFamilies} unknown base families. Existing catalog left unchanged.`);
const data = {catalog_version:1, source:'MakeFox JSON export/import (coverage unverified)',
  source_url:'https://makefox.bot/cs/lora-viewer.html', complete:markComplete,
  lora_count:entries.size,
  import_stats:{candidate_records:found.length, rejected_count:rejected.length,
    missing_base_model:missingFamilies},
  loras:[...entries.values()]};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
console.log(`Imported ${entries.size} LoRAs; rejected ${rejected.length}; unknown family ${missingFamilies}.`);
if (markComplete) console.log('Marked complete at user request. This flag does NOT independently verify site coverage.');
