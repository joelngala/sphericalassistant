#!/usr/bin/env node
// Diagnostic: loads the HOVER case search page and prints the actual form
// structure — input names, button texts, tab labels, and the current URL
// after any redirects. Use this to find the right selectors when the portal
// changes layout.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const URL = 'https://hover.hillsclerk.com/html/case/caseSearch.html';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

try {
  console.log('[diag] navigating to', URL);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
  console.log('[diag] landed at', page.url());
  console.log('[diag] title:', await page.title());

  const inputs = await page.$$eval('input', (els) =>
    els.map((el) => ({
      type: el.type,
      name: el.name || null,
      id: el.id || null,
      placeholder: el.placeholder || null,
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null,
    }))
  );
  console.log('\n[diag] INPUTS');
  console.log(JSON.stringify(inputs, null, 2));

  const buttons = await page.$$eval('button, input[type="submit"], input[type="button"]', (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      text: (el.innerText || el.value || '').trim().slice(0, 80),
      id: el.id || null,
      name: el.name || null,
      visible: el.offsetParent !== null,
    }))
  );
  console.log('\n[diag] BUTTONS');
  console.log(JSON.stringify(buttons, null, 2));

  const tabs = await page.$$eval('a, [role="tab"], li', (els) =>
    els
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').trim().slice(0, 80),
        href: el.getAttribute('href') || null,
        role: el.getAttribute('role') || null,
      }))
      .filter((x) => /case|party|citation|date|name|business/i.test(x.text))
      .slice(0, 40)
  );
  console.log('\n[diag] CANDIDATE TABS/LINKS');
  console.log(JSON.stringify(tabs, null, 2));

  const bodyPreview = (await page.evaluate(() => document.body.innerText)).slice(0, 1500);
  console.log('\n[diag] BODY PREVIEW (first 1500 chars)');
  console.log(bodyPreview);

  const debugDir = join(process.cwd(), 'debug');
  await mkdir(debugDir, { recursive: true });
  await page.screenshot({ path: join(debugDir, 'diagnose.png'), fullPage: true });
  await writeFile(join(debugDir, 'diagnose.html'), await page.content(), 'utf8');
  console.log('\n[diag] wrote debug/diagnose.png and debug/diagnose.html');
} finally {
  await browser.close();
}
