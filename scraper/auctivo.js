// Auctivo scraper — robust endsAt (Europe/Amsterdam) + price from bid table
export async function scrapeAuctivo(context, url) {
  const page = await context.newPage();
  const out = { title: null, endsAt: null, currentPrice: null, image: null, bids: [], meta: { currency: 'EUR' } };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded').catch(()=>{});
    await page.waitForLoadState('networkidle', {timeout:3000}).catch(()=>{});
    await page.waitForTimeout(500);

    // Accept cookies if shown
    try {
      const sels = [
        'button:has-text("Accepteer")',
        'button:has-text("Alle cookies accepteren")',
        'button:has-text("Akkoord")',
        '[data-testid="uc-accept-all-button"]',
        'button[aria-label*="Accep"]'
      ];
      for (const s of sels){
        const el = page.locator(s).first();
        if (await el.isVisible().catch(()=>false)){ await el.click({timeout:500}).catch(()=>{}); break; }
      }
    } catch {}

    // Title
    try { out.title = (await page.locator('h1, h2').first().innerText()).trim(); } catch {}

    // Bids table -> bids[] and currentPrice (max)
    function parseAmount(text){
      const m = String(text||'').replace(/\s+/g,' ').match(/€\s*([\d.]+(?:,\d{1,2})?)/);
      return m ? Number(m[1].replace(/\./g,'').replace(',', '.')) : null;
    }
    try {
      const rows = page.locator('table tr');
      const n = await rows.count();
      const bids = [];
      for (let i=0;i<n;i++){
        const tds = rows.nth(i).locator('td');
        if (await tds.count() >= 2){
          const amt = parseAmount(await tds.nth(0).innerText());
          const dateText = (await tds.nth(1).innerText()).trim();
          if (Number.isFinite(amt)){
            bids.push({ amount: amt, dateISO: null, source: 'scraped-date' });
          }
        }
      }
      if (bids.length){
        out.bids = bids;
        out.currentPrice = Math.max(...bids.map(b=>b.amount));
      }
    } catch {}

    // Ends at (prefer <time datetime>, else parse "Kavel sluit: dd-mm-yyyy, HH:MM")
    try {
      let timeAttr = await page.locator('time[datetime]').first().getAttribute('datetime').catch(()=>null);
      if (timeAttr) {
        if (!(/[zZ]|[+-]\d{2}:?\d{2}$/.test(timeAttr))) {
          const iso = await page.evaluate((s) => {
            const dt = new Date(s.replace(' ', 'T'));
            return isNaN(dt) ? null : dt.toISOString();
          }, timeAttr);
          if (iso) out.endsAt = iso;
        } else {
          out.endsAt = new Date(timeAttr).toISOString();
        }
      }
      if (!out.endsAt) {
        const raw = await page.locator('body').innerText();
        const m = raw.match(/Kavel\s*sluit[^\d]*(\d{2})[\./-](\d{2})[\./-](\d{4})[^\d]*(\d{2}:\d{2})/i);
        if (m) {
          const [_, dd, mm, yyyy, hhmm] = m;
          const pad = (n) => String(n).padStart(2,'0');
          const localIso = await page.evaluate((s) => {
            const dt = new Date(s);
            return isNaN(dt) ? null : dt.toISOString();
          }, `${yyyy}-${pad(mm)}-${pad(dd)}T${hhmm}:00`);
          if (localIso) out.endsAt = localIso;
        }
      }
    } catch {}

    // Image
    try { out.image = await page.locator('meta[property="og:image"]').first().getAttribute('content'); } catch {}
    if (!out.image){ try { out.image = await page.locator('article img, .swiper-slide-active img, img').first().getAttribute('src'); } catch {} }
  } catch (e) {
    out.error = String(e?.message||e);
  } finally {
    try { await page.close(); } catch {}
  }
  return out;
}
