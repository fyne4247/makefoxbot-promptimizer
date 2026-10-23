#!/usr/bin/env node
'use strict';

/**
 * Best-effort public MakeFox LoRA catalog collector.
 * Observes the site's own public data requests AND parses the rendered cards.
 * No private endpoints, authentication, or access-control bypasses.
 *
 * Prerequisites: npm install --no-save playwright && npx playwright install chromium
 * Usage: node scripts/scrape-makefox.js --out makefox-loras.json [--headed] [--chrome]
 */
const fs=require('node:fs');
const path=require('node:path');
const {fromJson,fromCardText,merge}=require('./lora-extract');
let chromium;
try { ({chromium}=require('playwright')); }
catch { console.error('Playwright is missing. Run: npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }
const argv=process.argv.slice(2);
const val=(arg,otherwise)=> { const i=argv.indexOf(arg);return i < 0 ? otherwise : argv[i+1]; };
const out=path.resolve(val('--out','makefox-loras.json'));
const reportPath=path.resolve(val('--report','makefox-scrape-report.json'));
const headed=argv.includes('--headed');
const useChrome=argv.includes('--chrome');
const maxPages=Number(val('--max-pages','10000'));
const delay=Math.max(500,Number(val('--delay-ms','650')));
if (!Number.isInteger(maxPages)||maxPages<1) throw new Error('Invalid --max-pages');
const source='https://makefox.bot/cs/lora-viewer.html';
const records=new Map();
const stats={api_responses:0,api_candidates:0,dom_candidates:0,page_errors:[],pages_visited:0,source,expected_total:null,pagination_stopped:'',started_at:new Date().toISOString()};
const key=x=>String(x.id).startsWith('token:') ? x.lora_syntax : String(x.id);
function put(x,kind) {
  if (!x || !x.lora_syntax || !x.name) return;
  let k=key(x);
  // Promote temporary filename/token-only API entries when the rendered card
  // supplies the site's stable numeric ID. Never merge two different real IDs.
  for (const [otherKey,other] of records) {
    if (otherKey===k) break;
    if (other.lora_syntax!==x.lora_syntax) continue;
    if (other.base_model && x.base_model && other.base_model!==x.base_model) continue;
    const provisionalOther=otherKey.startsWith('token:');
    const provisionalNew=k.startsWith('token:');
    if (!provisionalOther && !provisionalNew) continue;
    if (provisionalNew) { k=otherKey; x={...x,id:other.id}; }
    else { records.delete(otherKey); x=merge(other,x); }
    break;
  }
  const current=records.get(k);
  records.set(k,merge(current,x));
  if (kind==='api') stats.api_candidates++;
  if (kind==='dom') stats.dom_candidates++;
}
function publish(final=false) {
  const loras=[...records.values()].sort((a,b)=>a.name.localeCompare(b.name)||String(a.id).localeCompare(String(b.id)));
  const baseCounts={};
  for (const rec of loras) baseCounts[rec.base_model||'(unknown)']=(baseCounts[rec.base_model||'(unknown)']||0)+1;
  const missing_family=loras.filter(x=>!x.base_model).length;
  const derived_syntax=loras.filter(x=>x.syntax_derived_from_filename).length;
  const expected=stats.expected_total;
  const complete=Boolean(final && expected!==null && loras.length===expected && !missing_family && !derived_syntax && stats.pagination_stopped==='end-of-pages');
  const data={catalog_version:1,source:'MakeFox public LoRA Models Explorer (browser collection)',source_url:source,
    collected_at:new Date().toISOString(),complete,expected_site_count:expected,lora_count:loras.length,
    collection_stats:{pages_visited:stats.pages_visited,api_candidates:stats.api_candidates,dom_candidates:stats.dom_candidates,missing_base_model:missing_family,derived_syntax_count:derived_syntax},
    loras:loras.map(({syntax_derived_from_filename,...rest})=>rest)};
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n');
  fs.writeFileSync(reportPath,JSON.stringify({...stats,completed_at:new Date().toISOString(),unique_loras:loras.length,base_model_counts:baseCounts,
    missing_family,derived_syntax,complete},null,2)+'\n');
  return {complete,count:loras.length,missing_family,derived_syntax};
}
// Execute in page context: one card's anchor and exactly one model hyperlink.
function extractVisibleCards() {
  const results=[];
  const anchors=[...document.querySelectorAll('a[href*="lora-viewer.html?id="]')];
  for (const link of anchors) {
    let url;
    try { url=new URL(link.href); } catch { continue; }
    const id=url.searchParams.get('id');
    const title=(link.innerText||link.textContent||'').trim();
    if (!id || !title) continue;
    let node=link;
    let card=null;
    for (let depth=0; node?.parentElement && depth<13; depth++) {
      node=node.parentElement;
      const count=node.querySelectorAll('a[href*="lora-viewer.html?id="]').length;
      if (count>1) break;
      const t=node.innerText||'';
      if (t.includes('Prompt Syntax') && t.includes('Copy Full Prompt') && /<lora:[^>]+>/i.test(t)) { card=node; break; }
    }
    if (!card) continue;
    const civitai=card.querySelector('a[href^="https://civitai.com/"]')?.href||null;
    results.push({id,name:title,text:card.innerText,civitai});
  }
  return results;
}
function progress(text) { console.log(`[${new Date().toISOString().slice(11,19)}] ${text}`); }
async function getRange(page) {
  return page.evaluate(()=>{
    const m=document.body.innerText.match(/Showing\s+([\d,]+)\s*[–—-]\s*([\d,]+)\s+of\s+([\d,]+)\s+models/i);
    return m ? {start:Number(m[1].replaceAll(',','')),end:Number(m[2].replaceAll(',','')),total:Number(m[3].replaceAll(',',''))}:null;
  });
}
async function main() {
  const browser=await chromium.launch({headless:!headed,...(useChrome?{channel:'chrome'}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const pending=new Set();
  page.on('response',r=>{
    if (!['xhr','fetch'].includes(r.request().resourceType())) return;
    if (!r.url().startsWith('https://makefox.bot/')) return;
    if (!(r.headers()['content-type']||'').includes('json')) return;
    const task=(async()=>{
      try { const data=await r.json(); stats.api_responses++; for(const x of fromJson(data)) put(x,'api'); }
      catch { /* The site may return non-JSON errors. DOM extraction is independent. */ }
    })();
    pending.add(task); task.finally(()=>pending.delete(task));
  });
  try {
    progress('Opening public MakeFox LoRA Explorer');
    await page.goto(source,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>/Showing\s+[\d,]+\s*[–—-]\s*[\d,]+\s+of\s+[\d,]+\s+models/i.test(document.body.innerText),null,{timeout:60000});
    // 96 per page instead of 12 => fewer requests and less server traffic.
    const sizeSelect=page.locator('select').filter({has:page.locator('option[value="96"]')}).first();
    if (await sizeSelect.count()) {
      await sizeSelect.selectOption('96');
      await page.waitForFunction(()=>/Showing\s+1\s*[–—-]\s*96\s+of\s+[\d,]+\s+models/i.test(document.body.innerText),null,{timeout:40000}).catch(()=>{});
    } else progress('96-items/page selector not found; using current page size');
    let previousStart=0;
    for (let i=0;i<maxPages;i++) {
      let range=await getRange(page);
      if (!range) throw Error('Pagination count was not readable. The explorer markup may have changed.');
      if (range.start===previousStart) throw Error('Repeated pagination page detected; stopping to avoid an infinite loop.');
      previousStart=range.start;
      stats.expected_total=range.total;
      await page.waitForTimeout(delay);
      // Asynchronous request processing might still be in progress.
      await Promise.allSettled([...pending]);
      const dom=await page.evaluate(extractVisibleCards);
      for (const card of dom) put(fromCardText(card.id,card.name,card.text,card.civitai),'dom');
      stats.pages_visited++;
      if (i===0 || stats.pages_visited%10===0 || range.end===range.total) {
        progress(`Page ${stats.pages_visited}: showing ${range.start}-${range.end}/${range.total}; ${records.size} unique catalog records`);
        publish(false);
      }
      if (range.end>=range.total) { stats.pagination_stopped='end-of-pages'; break; }
      const next=page.getByRole('button',{name:'»',exact:true}).first();
      if (!(await next.count())||!(await next.isVisible())||(await next.isDisabled())) {
        stats.pagination_stopped='next-button-unavailable';
        stats.page_errors.push(`Next-page button missing/disabled at ${range.start}-${range.end}`);
        break;
      }
      try {
        await next.click({timeout:15000});
        await page.waitForFunction(before=>{
          const m=document.body.innerText.match(/Showing\s+([\d,]+)\s*[–—-]\s*[\d,]+\s+of\s+[\d,]+\s+models/i);
          return m && Number(m[1].replaceAll(',',''))>before;
        },range.start,{timeout:40000});
      } catch(e) {
        stats.page_errors.push(`Failed to advance from ${range.start}: ${e.message}`);
        stats.pagination_stopped='page-advance-error';
        break;
      }
    }
    if (!stats.pagination_stopped) stats.pagination_stopped='max-pages-reached';
    await Promise.allSettled([...pending]);
  } catch(e) {
    stats.page_errors.push(e.stack||String(e));
    stats.pagination_stopped=stats.pagination_stopped||'exception';
    console.error('Scraper stopped:',e.message);
  } finally {
    const result=publish(true);
    progress(`Saved ${result.count} records to ${out}; report ${reportPath}`);
    progress(result.complete ? 'All expected records verified.' : 'PARTIAL/UNVERIFIED: review report; never label the dataset complete.');
    await browser.close();
    if (!result.complete) process.exitCode=2;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
