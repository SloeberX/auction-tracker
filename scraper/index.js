import { chromium } from 'playwright';
import { scrapeAuctivo } from './auctivo.js';

export async function createScraper({ headless = true } = {}) {
  const args = [];
  if ((process.env.NO_SANDBOX || '').toLowerCase() === 'true') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  args.push('--disable-dev-shm-usage');
  const browser = await chromium.launch({ headless, args });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', viewport: { width: 1366, height: 900 } });
  async function fetch(url){ try { if (/auctivo\.net/.test(url)) return scrapeAuctivo({ context, url  } catch(e){ return { title:null, endsAt:null, currentPrice:null, image:null, bids:[], meta:{}, error:String(e?.message||e) }; } }); throw new Error(`No scraper for ${new URL(url).hostname}`); }
  return { fetch, close: () => browser.close() };
}
