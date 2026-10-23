'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fromJson,fromRecord,fromCardText,merge}=require('../scripts/lora-extract');

test('normalizes exported JSON and exact syntax without users or favorites',()=>{
  const result=fromJson({results:[{id:38639,name:'Mazaku Style',base_model:'Illustrious',filename:'Mazaku_Style.safetensors',trigger_words:['m4z4ku'],favorite:true,user:{name:'private'}},{id:38638,name:'Camo // Breeze In The Clouds (by sickmer)',lora_syntax:'<lora:test_IL_2:1>',baseModel:{name:'Illustrious'},triggerWords:'c4m0'}]});
  assert.equal(result.length,2);
  assert.equal(result[0].lora_syntax,'<lora:Mazaku_Style:1>');
  assert.deepEqual(result[0].trigger_words,['m4z4ku']);
  assert.equal(result[0].base_model,'Illustrious');
  assert.equal(result[0].favorite,undefined);
  assert.equal(result[0].user,undefined);
  assert.equal(result[1].lora_syntax,'<lora:test_IL_2:1>');
});

test('extracts LoRA details from a rendered card text',()=>{
  const card=`Mazaku Style\n♡\nIllustrious\nAdded: Oct 22nd 2026\n(35 uses)\nNo ratings\nPrompt Syntax\n<lora:Mazaku_Style:1>\nTrigger Words\nm4z4ku\nCopy Full Prompt`;
  const found=fromCardText('38639','Mazaku Style',card);
  assert.deepEqual(found,{id:'38639',name:'Mazaku Style',base_model:'Illustrious',lora_syntax:'<lora:Mazaku_Style:1>',trigger_words:['m4z4ku']});
});

test('preserves unusual tokens and multiline trigger phrases',()=>{
  const card=`Baloo (Talespin) 𝔸ℕ𝕀𝕄𝔸\nAnima\nPrompt Syntax\n<lora:Talespin_Baloo_Anima(bal00):1>\nTrigger Words\nbal00\npilot hat\nmasterpiece\nCopy Full Prompt\nView on CivitAI`;
  const result=fromCardText('38633','Baloo (Talespin) 𝔸ℕ𝕀𝕄𝔸',card,'https://civitai.com/models/123');
  assert.equal(result.lora_syntax,'<lora:Talespin_Baloo_Anima(bal00):1>');
  assert.deepEqual(result.trigger_words,['bal00','pilot hat','masterpiece']);
  assert.equal(result.base_model,'Anima');
  assert.equal(result.civitai_url,'https://civitai.com/models/123');
});

test('chooses actual syntax over derived syntax when merging DOM and API',()=>{
  const api=fromRecord({id:42,name:'Test LoRA',filename:'guess.safetensors',baseModel:'Pony',trigger_words:['x']});
  const dom=fromCardText('42','Test LoRA',`Test LoRA\nPony\nPrompt Syntax\n<lora:actual-model:0.75>\nTrigger Words\nx\ny\nCopy Full Prompt`);
  const result=merge(api,dom);
  assert.equal(result.lora_syntax,'<lora:actual-model:0.75>');
  assert.deepEqual(result.trigger_words,['x','y']);
  assert.ok(!result.syntax_derived_from_filename);
});

test('does not treat image records as LoRAs or accept arbitrary text',()=>{
  assert.deepEqual(fromJson({images:[{id:1,name:'Photo',filename:'photo.png'}],other:[{name:'not-a-lora',filename:'bad.png'}]}),[]);
  assert.equal(fromRecord({id:1,name:'Empty model'}),null);
});
