import { chromium } from 'playwright';
import { scrapeAuctivo } from './auctivo.js';

export async function createScraper({ headless = true } = {}) {
  const args = [];
  if ((process.env.NO_SANDBOX || '').toLowerCase() === 'true') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  args.push('--disable-dev-shm-usage');
  const browser = await chromium.launch({ headless, args });
  const context = await browser.newContext({ locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', viewport: { width: 1366, height: 900 } });
  async function fetch(url){ if (/auctivo\.net/.test(url)) return scrapeAuctivo({ context, url }); throw new Error(`No scraper for ${new URL(url).hostname}`); }
  return { fetch, close: () => browser.close() };
}
