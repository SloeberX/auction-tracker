import { chromium } from 'playwright';
import { scrapeAuctivo } from './auctivo.js';

export async function createScraper({ headless = true } = {}) {
  const args = [];
  if ((process.env.NO_SANDBOX || '').toLowerCase() === 'true') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  args.push('--disable-dev-shm-usage');

  const browser = await chromium.launch({ headless, args });

  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36';

  const context = await browser.newContext({
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    userAgent,
    extraHTTPHeaders: { 'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8' },
    viewport: { width: 1366, height: 900 }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  async function fetch(url) {
    if (/auctivo\.net/.test(url)) return scrapeAuctivo({ context, url });
    throw new Error(`No scraper for ${new URL(url).hostname}`);
  }
  return { fetch, close: () => browser.close() };
}
