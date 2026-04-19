import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Launch a Chromium instance configured for public-portal scraping.
// Headless by default; pass { headless: false } when debugging to watch the run.
export async function launchBrowser({ headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// When a run fails, dump a screenshot + full HTML to ./debug so selector drift
// is debuggable without re-running the whole flow.
export async function captureFailure(page, label) {
  const dir = join(process.cwd(), 'scraper', 'debug');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${label}-${stamp}`;
  try {
    await page.screenshot({ path: join(dir, `${base}.png`), fullPage: true });
    const html = await page.content();
    await writeFile(join(dir, `${base}.html`), html, 'utf8');
    return { screenshot: `${base}.png`, html: `${base}.html` };
  } catch {
    return null;
  }
}

export async function withRetry(fn, { attempts = 3, baseDelayMs = 2000, label = 'op' } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        console.warn(`[retry] ${label} failed (${error.message}); retry ${i + 1} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
