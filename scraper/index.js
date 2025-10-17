import { chromium } from 'playwright';

export async function createBrowser(){
  const args = ['--disable-dev-shm-usage'];
  if((process.env.NO_SANDBOX||'true').toLowerCase()==='true'){
    args.push('--no-sandbox','--disable-setuid-sandbox');
  }
  const browser = await chromium.launch({ headless:(process.env.HEADLESS||'true')==='true', args });
  const context = await browser.newContext({
    viewport:{width:1366, height:900},
    locale:'nl-NL',
    timezoneId: process.env.TZ || 'Europe/Amsterdam',
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });
  return { browser, context };
}

export function pickScraper(url){
  if(/auctivo\.net|auctio\.nl|bva-?auctions?/i.test(url)) return 'auctivo';
  return null;
}
