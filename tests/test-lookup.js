'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const lookup=path.join(root,'scripts','lookup-lora.js');
const importer=path.join(root,'scripts','import-loras.js');
function run(program,args) {return JSON.parse(execFileSync(process.execPath,[program,...args],{encoding:'utf8'}));}
test('seed catalog contains no favorite or user selection flags',()=>{
 const doc=JSON.parse(fs.readFileSync(path.join(root,'references','loras.json'),'utf8'));
 assert.equal(typeof doc.complete,'boolean');assert.equal(doc.lora_count,doc.loras.length);assert.ok(doc.loras.length > 0);
 for(const row of doc.loras) {
  assert.equal(row.user_selected,undefined); assert.equal(row.favorite,undefined);
  assert.doesNotMatch(row.name,/\[User (Selected|Added)\]/);
  assert.match(row.lora_syntax,/^<lora:.+:[\d.]+>$/);
 }
});
test('matching is based on name and triggers without user preference boosts',()=>{
 const doc=run(lookup,['--model','Illustrious','Scar','deathwolf']);
 assert.equal(doc.results[0].matches[0].name,'Scar (The Lion King)');
 assert.equal(doc.results[1].matches[0].name,'Death (Puss in Boots)');
 assert.equal(doc.results[0].matches[0].lora_syntax,'<lora:Scar_Lion_King_IL:1>');
});
test('base model restriction prevents silent cross-family matches',()=>{
 const doc=run(lookup,['--model','Pony','Scar']);
 assert.equal(doc.searched_count,0);assert.deepEqual(doc.results[0].matches,[]);
});
test('importer accepts source records, deduplicates and strips personal fields',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'makefox-test-'));
 try {
  const input=path.join(folder,'input.json'),out=path.join(folder,'output.json');
  fs.writeFileSync(input,JSON.stringify({base_model:'Illustrious',loras:[
   {id:'99',name:'Example Wolf',filename:'ExampleWolf.safetensors',triggerWords:['wolf_test'],favorite:true,user_selected:true},
   {id:'99',name:'Example Wolf',filename:'ExampleWolf.safetensors',triggerWords:['wolf_test'],favorite:true}
  ]}));
  execFileSync(process.execPath,[importer,input,'--out',out]);
  const doc=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(doc.lora_count,1);assert.equal(doc.complete,false);
  assert.equal(doc.loras[0].lora_syntax,'<lora:ExampleWolf:1>');
  assert.deepEqual(doc.loras[0].trigger_words,['wolf_test']);
  assert.equal(doc.loras[0].favorite,undefined);
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('combined LoRA covering Simba and Scar takes priority without favoriting either',()=>{
 const doc=run(lookup,['--model','Illustrious','Simba','Scar']);
 const selected=doc.multi_character.recommended;
 assert.ok(selected);
 assert.equal(selected.id,'manual:lion-king-multi-il');
 assert.equal(selected.lora_syntax,'<lora:The_Lion_King_Lora_illustrious:1>');
 assert.deepEqual(selected.covered_characters,['Simba','Scar']);
 assert.deepEqual(doc.preferred_combined.map(r=>r.id),[selected.id]);
 assert.equal(doc.results.length,2);
});
test('recognizes multi-character LoRAs from explicit titles when cast array is absent',()=>{
 const doc=run(lookup,['--model','Illustrious','Timon','Pumbaa']);
 assert.equal(doc.multi_character.recommended.id,'34076');
 assert.deepEqual(doc.multi_character.recommended.catalog_characters,['Timon','Pumbaa']);
});
test('a two-character adapter must not be recommended for an incomplete three-character cast',()=>{
 const doc=run(lookup,['--model','Illustrious','Timon','Pumbaa','Zazu']);
 assert.equal(doc.multi_character.recommended,null);
 assert.deepEqual(doc.preferred_combined,[]);
});
test('single-character queries never trigger automatic multi-character substitution',()=>{
 const doc=run(lookup,['--model','Illustrious','Simba']);
 assert.equal(doc.multi_character.recommended,null);
 assert.deepEqual(doc.preferred_combined,[]);
});
test('prefers smaller full-cast multi LoRA and preserves exact-variant matching',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'makefox-multi-'));
 try {
  const catalog=path.join(folder,'catalog.json');
  const rows=[
   {id:'large',name:'Team Combo',base_model:'Illustrious',lora_syntax:'<lora:BigCombo:1>',characters:['Alice','Bob','Carol','Dan'],trigger_words:['alice','bob']},
   {id:'small',name:'Duo Combo',base_model:'Illustrious',lora_syntax:'<lora:SmallCombo:1>',characters:['Alice','Bob'],trigger_words:['alice','bob']},
   {id:'pony',name:'Pony Duo',base_model:'Pony',lora_syntax:'<lora:PonyCombo:1>',characters:['Alice','Bob'],trigger_words:['alice','bob']},
   {id:'single',name:'Alice',base_model:'Illustrious',lora_syntax:'<lora:Alice:1>',trigger_words:['alice']},
  ];
  fs.writeFileSync(catalog,JSON.stringify({complete:true,loras:rows}));
  const doc=run(lookup,['--catalog',catalog,'--model','Illustrious','Alice','Bob']);
  assert.deepEqual(doc.preferred_combined.map(r=>r.id),['small','large']);
  assert.equal(doc.multi_character.recommended.id,'small');
  assert.equal(doc.searched_count,3);
  const variant=run(lookup,['--catalog',catalog,'--model','Illustrious','Young Alice','Bob']);
  assert.equal(variant.multi_character.recommended,null);
 } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});
test('importer retains full-cast character arrays while stripping selection labels',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'makefox-cast-import-'));
 try {
  const input=path.join(folder,'input.json'),output=path.join(folder,'out.json');
  fs.writeFileSync(input,JSON.stringify({base_model:'Illustrious',loras:[
   {id:'combo',name:'Alice and Bob [User Added]',lora_syntax:'<lora:AliceBob:1>',duo_characters:['Alice','Bob'],user_selected:true}
  ]}));
  execFileSync(process.execPath,[importer,input,'--out',output]);
  const doc=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.deepEqual(doc.loras[0].characters,['Alice','Bob']);
  assert.equal(doc.loras[0].name,'Alice and Bob');
  assert.equal(doc.loras[0].user_selected,undefined);
  const matched=run(lookup,['--catalog',output,'--model','Illustrious','Alice','Bob']);
  assert.equal(matched.multi_character.recommended.id,'combo');
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
