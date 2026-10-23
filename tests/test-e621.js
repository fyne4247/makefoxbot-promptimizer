'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || 'python3';
const updater = path.join(root,'scripts','update-e621.py');
const lookup = path.join(root,'scripts','lookup-tag.js');
function writeFixture(dir, name, text) {
  const file = path.join(dir, name+'.csv.gz');
  const data = zlib.gzipSync(text);
  fs.writeFileSync(file,data);
  return {name, file_name:name+'.csv.gz', file_size:data.length,
    checksum:crypto.createHash('sha256').update(data).digest('hex'),
    updated_at:'2026-10-22T00:00:00-04:00',
    url:'https://static1.e621.net/data/db_export/'+name+'.csv.gz'};
}
function fixtures(dir) {
 const manifest = [
  writeFixture(dir,'tags', 'id,name,category,post_count,created_at\n1,wolf,5,400,\n2,canine,5,900,\n3,fox,5,300,\n4,mammal,5,1200,\n5,blue_fur,0,500,\n6,geneticist,1,101,\n7,simba,4,40,\n8,thingy,7,500,\n9,zero,0,0,\n10,young,0,51,\n'),
  writeFixture(dir,'tag_aliases','id,antecedent_name,consequent_name,status\n1,puppy,canine,active\n2,cub,young,active\n3,doggo,canine,pending\n4,foxy,fox,active\n'),
  writeFixture(dir,'tag_implications','id,antecedent_name,consequent_name,status\n1,wolf,canine,active\n2,wolf,mammal,active\n3,wolf,canine,active\n4,wolf,fox,deleted\n5,puppy,canine,active\n'),
 ];
 const manifestFile=path.join(dir,'manifest.json');
 fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 return manifestFile;
}
function setup() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'e621-makefox-'));
 const source=path.join(dir,'source'), out=path.join(dir,'out');
 fs.mkdirSync(source); fs.mkdirSync(out);
 return {dir,source,out,manifest:fixtures(source), cleanup(){fs.rmSync(dir,{recursive:true,force:true});}};
}
function update(ctx, more=[]) {
 return spawnSync(python,[updater,'--source-dir',ctx.source,'--manifest',ctx.manifest,'--out-dir',ctx.out,...more],{encoding:'utf8'});
}
function read(ctx,name){return JSON.parse(fs.readFileSync(path.join(ctx.out,name),'utf8'));}
function lookupTerm(ctx,...args){return JSON.parse(execFileSync(process.execPath,[lookup,'--data-dir',ctx.out,...args],{encoding:'utf8'}));}

test('e621 importer reads compressed CSV and emits provenance, tags, aliases and implications',()=>{
 const ctx=setup(); try {
  const r=update(ctx);assert.equal(r.status,0,r.stderr);
  const tags=read(ctx,'tags.json');
  assert.deepEqual(tags.map(r=>r[0]),['blue_fur','canine','fox','geneticist','mammal','simba','wolf','young']);
  assert.equal(read(ctx,'aliases.json').cub,'young');
  assert.equal(read(ctx,'aliases.json').doggo,undefined);
  assert.deepEqual(read(ctx,'implications.json').wolf,['canine','mammal']);
  const meta=read(ctx,'e621-source.json');
  assert.equal(meta.datasets.tags.sha256.length,64);
  assert.equal(meta.stats.tags.retained,8);
  assert.equal(meta.stats.tag_implications.relations,3);
 } finally {ctx.cleanup();}
});

test('simple lookup remains backwards compatible; explain reports categories and implications',()=>{
 const ctx=setup();try{
  assert.equal(update(ctx).status,0);
  const simple=lookupTerm(ctx,'wolf','puppy','simba');
  assert.equal(simple.wolf[0],'wolf');
  assert.equal(simple.puppy[0],'canine');
  assert.equal(simple.simba[0],'simba');
  const detailed=lookupTerm(ctx,'--explain','wolf','puppy');
  assert.equal(detailed.sources.tag_implications_available,true);
  assert.deepEqual(detailed.results.wolf[0].implications,['canine','mammal']);
  assert.equal(detailed.results.wolf[0].category,'species');
  assert.equal(detailed.results.puppy[0].match_type,'alias');
 } finally{ctx.cleanup();}
});

test('character and artist exact lookups work but do not crowd prefix suggestions',()=>{
 const ctx=setup();try{
  assert.equal(update(ctx).status,0);
  const exact=lookupTerm(ctx,'geneticist','simba');
  assert.deepEqual(exact.geneticist,['geneticist']);
  assert.deepEqual(exact.simba,['simba']);
  const prefix=lookupTerm(ctx,'sim');
  assert.deepEqual(prefix.sim,[]);
  const detailed=lookupTerm(ctx,'--explain','simba');
  assert.equal(detailed.results.simba[0].category,'character');
  assert.equal(detailed.sources.tag_implications_available,true);
  assert.equal(Object.hasOwn(detailed.sources,'wiki_excerpts_available'),false);
  assert.deepEqual(Object.keys(read(ctx,'e621-source.json').datasets).sort(), ['tag_aliases','tag_implications','tags']);
 }finally{ctx.cleanup();}
});

test('bad checksum fails before replacing existing references',()=>{
 const ctx=setup();try{
  fs.writeFileSync(path.join(ctx.out,'tags.json'),'"untouched"\n');
  const manifest=JSON.parse(fs.readFileSync(ctx.manifest));
  manifest.find(m=>m.name==='tags').checksum='00'.repeat(32);
  fs.writeFileSync(ctx.manifest,JSON.stringify(manifest));
  const r=update(ctx);
  assert.equal(r.status,1);
  assert.match(r.stderr,/SHA-256 mismatch/);
  assert.equal(fs.readFileSync(path.join(ctx.out,'tags.json'),'utf8'),'"untouched"\n');
 }finally{ctx.cleanup();}
});

test('custom category selection includes lore and 0-post tags only if asked',()=>{
 const ctx=setup();try{
  const r=update(ctx,['--categories','0,7','--min-count','0']);
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(read(ctx,'tags.json').map(r=>r[0]),['blue_fur','thingy','young','zero']);
 }finally{ctx.cleanup();}
});
