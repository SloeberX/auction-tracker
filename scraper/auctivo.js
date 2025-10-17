/**
 * Auctivo/Auction site scraper (best-effort, resilient)
 */
export async function scrapeAuctivo({context, url}){
  const page = await context.newPage();
  let data = { title:null, image:null, currentPrice:null, endsAt:null, bids:[], meta:{} };
  try{
    await page.goto(url, { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(1000);

    // Title
    try{
      const t = await page.locator('h1, h2').first().textContent();
      if (t) data.title = t.trim();
    }catch{}

    // Price (find euro amounts; prefer main price)
    try{
      const priceSel = ['[data-testid*=price]','[class*=price]','div:has-text("€")'].join(',');
      const raw = await page.locator(priceSel).first().innerText().catch(()=>null);
      const txt = raw?.replace(/\s+/g,' ').trim() || '';
      const m = txt.match(/€\s*([0-9\.,]+)/);
      if (m){
        const norm = m[1].replace(/\./g,'').replace(',', '.');
        const val = Number(norm);
        if (!Number.isNaN(val)) data.currentPrice = val;
      }
    }catch{}

    // Image
    try{
      const sel = ['meta[property="og:image"]','img[alt*=lot i],[alt*=kavel i],img'].join(',');
      const og = await page.locator('meta[property="og:image"]').getAttribute('content').catch(()=>null);
      let src = og;
      if(!src){
        src = await page.locator('img').first().getAttribute('src').catch(()=>null);
      }
      if(src && !/^https?:/.test(src)){
        const u = new URL(url);
        src = u.origin + src;
      }
      data.image = src || null;
    }catch{}

    // EndsAt: often in a time element or label "Kavel sluit"
    try{
      let iso = await page.locator('time[datetime]').first().getAttribute('datetime').catch(()=>null);
      if (!iso){
        const txt = await page.locator(':text("Kavel sluit"), :text("Sluit"), :text("Ends")').first().evaluate(el=>el.parentElement?.innerText).catch(()=>null);
        if (txt){
          // match dd-mm-yyyy HH:MM
          const m = txt.match(/(\d{2}-\d{2}-\d{4})[,\s]+(\d{2}:\d{2})/);
          if (m){
            const [d,mn,y] = m[1].split('-').map(Number);
            const [hh,mm] = m[2].split(':').map(Number);
            const dt = new Date(Date.UTC(y,mn-1,d,hh,mm));
            iso = dt.toISOString();
          }
        }
      }
      if (iso) data.endsAt = new Date(iso).toISOString();
    }catch{}

    // Bids table: collect euro amounts in descending time order (best-effort)
    try{
      const rows = await page.$$eval('table tr', trs => trs.map(tr => tr.innerText.trim()));
      const bids = [];
      for (const row of rows){
        const m = row.match(/€\s*([0-9\.,]+)/);
        if (m){
          let amt = m[1].replace(/\./g,'').replace(',','.');
          amt = Number(amt);
          if (Number.isFinite(amt)){
            bids.push({ amount:amt, timeISO:null });
          }
        }
      }
      if (bids.length) data.bids = bids;
    }catch{}

  }catch(e){
    data.meta.error = String(e?.message||e);
  }finally{
    await page.close().catch(()=>{});
  }
  return data;
}
