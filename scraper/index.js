import { chromium } from 'playwright';

export async function createScraper({ headless = true } = {}) {
  const args = [];
  if ((process.env.NO_SANDBOX || '').toLowerCase() === 'true') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  args.push('--disable-dev-shm-usage');
  const browser = await chromium.launch({ headless, args });
  const context = await browser.newContext({
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });
  async function fetch(url){ return { ok:true, url }; }
  return { fetch, close: () => browser.close() };
}
