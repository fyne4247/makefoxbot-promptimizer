#!/usr/bin/env node
'use strict';

// Optional best-effort browser capture for MakeFox's publicly exposed LoRA catalog.
// The MakeFox JSON endpoint/DOM is not documented here, so extraction is NOT guaranteed.
// Captures JSON network responses during normal viewer page loads and pagination.
// Never bypasses login, access controls, or rate limits.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
let chromium;
try { ({chromium} = require('playwright')); }
catch { console.error('Install optional dependency: npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }
const argv = process.argv.slice(2);
const option = (name, defaultValue) => argv.includes(name) ? argv[argv.indexOf(name)+1] : defaultValue;
const pageLimit = Number(option('--max-pages', '500'));
const delay = Math.max(500,Number(option('--delay-ms','900')));
const out = path.resolve(option('--out','makefox-responses.json'));
const headed = argv.includes('--headed');
if (!Number.isInteger(pageLimit) || pageLimit < 1) throw new Error('--max-pages must be a positive integer');

async function main() {
  const browser = await chromium.launch({headless:!headed});
  const page = await browser.newPage();
  const responses = [];
  const pending = new Set();
  const seen = new Set();
  page.on('response', response => {
    const req = response.request();
    if (!['xhr','fetch'].includes(req.resourceType())) return;
    const contentType = response.headers()['content-type'] || '';
    if (!/json/i.test(contentType)) return;
    // Exclude duplicate request URLs per page? No: a paginated API often uses the same URL.
    const promise = response.json().then(payload => {
      const serialized = JSON.stringify(payload);
      // Skip empty repeats but retain separate URL/page payloads.
      const key = `${response.url()}::${serialized.length}::${serialized.slice(0, 250)}`;
      if (!seen.has(key)) { seen.add(key); responses.push({url:response.url(),data:payload}); }
    }).catch(() => undefined).finally(() => pending.delete(promise));
    pending.add(promise);
  });
  try {
    await page.goto('https://makefox.bot/cs/lora-viewer.html', {waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(4000);
    let visited=1;
    for (;visited<pageLimit;visited++) {
      let next = page.getByRole('button',{name:/^(next|›|→)$/i}).first();
      if (!(await next.count())) next=page.locator('button[aria-label*="next" i], button:has-text("›")').first();
      if (!(await next.count()) || !(await next.isVisible()) || (await next.isDisabled())) break;
      const before=await page.locator('body').innerText();
      try { await next.click({timeout:12000}); } catch { break; }
      await page.waitForTimeout(delay);
      const after=await page.locator('body').innerText();
      if (before === after) { console.warn('Viewer did not visibly advance. Stopping rather than looping.'); break; }
      if (visited % 25 === 0) console.log(`Visited ${visited+1} viewer pages; captured ${responses.length} JSON responses.`);
    }
    await Promise.allSettled([...pending]);
    const raw={source:'https://makefox.bot/cs/lora-viewer.html',viewer_pages_visited:visited,
      note:'Public browser-response capture; may not contain all pages or records.',responses};
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify(raw,null,2)+'\n');
    console.log(`Saved ${responses.length} JSON responses from ${visited} viewer page(s) to ${out}`);
    if (!responses.length) {
      console.warn('No JSON responses captured. Viewer may use non-JSON requests or a different protocol. Inspect DevTools Network.');
      return;
    }
    try {
      const normalized=path.join(path.dirname(out),'loras-imported.json');
      console.log(execFileSync(process.execPath,[path.join(__dirname,'import-loras.js'),out,'--out',normalized],{encoding:'utf8'}));
      console.log(`Imported catalog: ${normalized}. Verify coverage and base-model fields before replacing bundled data.`);
    } catch (err) {
      console.warn('Could not normalize responses automatically. Raw response capture is retained.');
      console.warn(err.stderr?.toString() || err.message);
    }
  } finally { await browser.close(); }
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
