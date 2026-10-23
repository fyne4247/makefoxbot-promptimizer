'use strict';

// A deliberately narrow public-catalog serializer. It excludes account, user,
// favorite, hidden, upload, voting, and authentication information.
const modelFields = ['base_model', 'baseModel', 'base_model_name', 'model_family', 'modelFamily', 'baseModelName'];
const syntaxFields = ['lora_syntax', 'loraSyntax', 'prompt_syntax', 'promptSyntax', 'syntax', 'prompt_token'];
const fileFields = ['filename', 'file_name', 'fileName', 'model_filename', 'lora_filename', 'loraFileName'];
const nameFields = ['name', 'title', 'display_name', 'displayName', 'model_name', 'modelName'];
const idFields = ['id', 'lora_id', 'loraId', 'model_id', 'modelId'];
const triggerFields = ['trigger_words', 'triggerWords', 'trained_words', 'trainedWords', 'activation_tags', 'activationTags', 'trigger', 'triggers'];
const skipKeys = new Set(['images','image','preview','previews','media','gallery','thumbnail','cover','cover_image','user','owner','account','auth','token','cookie','login','votes','ratings','review','usage']);
const clean = x => x == null ? '' : String(x).trim();
// Field names are matched case-insensitively: MakeFox's API uses PascalCase (Name, BaseModel, TriggerWords).
function first(obj, keys) {
  const lower = new Map(Object.keys(obj).map(k => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = key in obj ? key : lower.get(key.toLowerCase());
    if (actual !== undefined && obj[actual] !== undefined && obj[actual] !== null && obj[actual] !== '') return obj[actual];
  }
  return null;
}
function uniqueStrings(xs) { return [...new Set(xs.map(clean).filter(Boolean))]; }
function triggers(x) {
  if (Array.isArray(x)) return uniqueStrings(x.flatMap(y => typeof y === 'string' ? [y] : y && typeof y === 'object' ? [first(y,['name','tag','word','text'])] : []));
  if (typeof x === 'string') return uniqueStrings(x.split(/[,;\r\n]+/));
  return [];
}
function base(x) { if (!x) return null; if (typeof x === 'object') return clean(first(x,['name','title','label'])) || null; return clean(x) || null; }
function fromRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const name = clean(first(record, nameFields));
  const file = clean(first(record, fileFields));
  let syntax = clean(first(record, syntaxFields));
  const derived = !/^<lora:.+:[+-]?(?:\d+(?:\.\d*)?|\.\d+)>$/i.test(syntax);
  if (derived && file && (!/\.[a-z0-9]+$/i.test(file) || /\.(safetensors|ckpt|pt)$/i.test(file))) syntax = `<lora:${file.replace(/\.(safetensors|ckpt|pt)$/i,'')}:1>`;
  if (!name || !/^<lora:.+:[+-]?(?:\d+(?:\.\d*)?|\.\d+)>$/i.test(syntax)) return null;
  const id = clean(first(record, idFields));
  const result = {
    id: id || `token:${syntax}`,
    name,
    base_model: base(first(record,modelFields)),
    lora_syntax: syntax,
    trigger_words: triggers(first(record,triggerFields)),
  };
  if (derived) result.syntax_derived_from_filename = true;
  const href = clean(first(record, ['civitai_url','civitaiUrl','civitai_link']));
  if (/^https:\/\/(?:www\.)?civitai\.com\//i.test(href)) result.civitai_url = href;
  return result;
}
function fromJson(payload, maxObjects=100000) {
  const results = [];
  const seen = new WeakSet();
  let visited = 0;
  function walk(value) {
    if (!value || typeof value !== 'object' || seen.has(value) || visited>=maxObjects) return;
    seen.add(value); visited++;
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    const candidate = fromRecord(value);
    if (candidate) results.push(candidate);
    for (const [key, child] of Object.entries(value)) {
      if (skipKeys.has(key.toLowerCase())) continue;
      if (child && typeof child === 'object') walk(child);
    }
  }
  walk(payload);
  return results;
}
const modelNames = [
  'Illustrious XL','Illustrious','Pony','SD 1.5','NoobAI','SDXL 1.0','Anima','Flux.1 D',
  'Other','Unknown','ZImageTurbo','MiniMax H3','Chroma','LTXV 2.3','SD 1.4',
  'SDXL Lightning','Qwen','Wan Video 14B t2v','SDXL Hyper','Wan Video 14B i2v 720p',
  'SD 2.1','HiDream','SDXL 1.0 LCM','Hunyuan Video','Wan Video 1.3B t2v',
  'SDXL 0.9','ZImageBase','Flux.2 Klein 9B-base','Flux.2 Klein 9B',
  'Wan Video 2.2 TI2V-5B','Wan Video 14B i2v 480p','Flux','Illustriou',
  'SD 2.1 768','Wan Video 2.2 I2V-A14B','LTXV2'
];
function fromCardText(id, name, text, civitaiUrl=null) {
  const lines = String(text || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const syntax = String(text || '').match(/<lora:[^>\n\r]+>/i)?.[0];
  if (!id || !name || !syntax) return null;
  // Use the base-model badge closest to the title; don't classify by title words.
  let baseModel=null;
  const nameLine=lines.findIndex(x=>x===name);
  const scan=nameLine >= 0 ? lines.slice(nameLine+1,nameLine+18):lines.slice(0,25);
  for(const line of scan) if(modelNames.includes(line)) { baseModel=line; break; }
  const ti=lines.findIndex(x => /^Trigger Words$/i.test(x));
  const triggersOut=[];
  if (ti >= 0) {
    for (let i=ti+1; i<lines.length; i++) {
      const line=lines[i];
      if (/^(Copy Full Prompt|Copy Prompt|View on CivitAI|Copy Link|Prompt Syntax|Direct link:|♡\s*Favorite)/i.test(line)) break;
      triggersOut.push(line);
    }
  }
  const rec={id:String(id),name,base_model:baseModel,lora_syntax:syntax,trigger_words:uniqueStrings(triggersOut)};
  if (civitaiUrl && /^https:\/\/(?:www\.)?civitai\.com\//i.test(civitaiUrl)) rec.civitai_url=civitaiUrl;
  return rec;
}
function merge(current, incoming) {
  if (!current) return incoming;
  const result={...current};
  for (const key of ['name','base_model','lora_syntax','civitai_url']) {
    if (!result[key] && incoming[key]) result[key]=incoming[key];
  }
  if (incoming.trigger_words?.length > (result.trigger_words?.length||0)) result.trigger_words=incoming.trigger_words;
  if (result.syntax_derived_from_filename && !incoming.syntax_derived_from_filename && incoming.lora_syntax) {
    result.lora_syntax=incoming.lora_syntax;
    delete result.syntax_derived_from_filename;
  }
  return result;
}
module.exports={fromJson,fromRecord,fromCardText,merge,triggers};
