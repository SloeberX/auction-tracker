// Robust Auctivo scraper (table-only bid history, endsAt fallback, image extraction)
function parseAmount(txt){
  if (txt == null) return null;
  const m = String(txt).replace(/\s+/g,' ').match(/€\s*([\d.]+(?:,\d{1,2})?)/);
  if (!m) return null;
  return Number(m[1].replace(/\./g,'').replace(',', '.'));
}
function parseDutchRelativeToDateISO(text, baseStr){
  if(!text) return null;
  const t = String(text).trim().toLowerCase();
  const base = baseStr ? new Date(baseStr) : new Date();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mondayStart = (d) => { const ds = dayStart(d); const dow = (ds.getDay()+6)%7; return new Date(ds.getTime()-dow*86400000); };
  const mAbs = t.match(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/);
  if (mAbs){ let [_,dd,mm,yy]=mAbs; dd=+dd; mm=+mm-1; yy=+yy; if(yy<100) yy+=2000; return new Date(yy,mm,dd,0,0,0,0).toISOString(); }
  if (/\bvandaag\b/.test(t)) return dayStart(base).toISOString();
  if (/\bgisteren\b/.test(t)) return new Date(dayStart(base).getTime()-86400000).toISOString();
  if (/\beergisteren\b/.test(t)) return new Date(dayStart(base).getTime()-2*86400000).toISOString();
  const mDays=t.match(/(\d+)\s*dag(?:en)?\s+geleden/); if (mDays) return new Date(dayStart(base).getTime()-Number(mDays[1])*86400000).toISOString();
  if (/\bvorige\s+week\b/.test(t)) return new Date(mondayStart(base).getTime()-7*86400000).toISOString();
  const mWeeks=t.match(/(\d+)\s*weken?\s+geleden/); if (mWeeks) return new Date(mondayStart(base).getTime()-Number(mWeeks[1])*7*86400000).toISOString();
  const mTime=t.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (mTime){ const hh=+mTime[1], mi=+mTime[2], ss=+(mTime[3]||'0'); return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mi, ss, 0).toISOString(); }
  const d2 = new Date(text); if (!isNaN(d2.getTime())) return d2.toISOString();
  return null;
}
async function extractImage(page){
  try{ const og=await page.locator('meta[property="og:image"], meta[name="og:image"]').first().getAttribute('content'); if(og) return og.startsWith('//')?'https:'+og:og; }catch{}
  try{ const tw=await page.locator('meta[name="twitter:image"], meta[property="twitter:image"]').first().getAttribute('content'); if(tw) return tw.startsWith('//')?'https:'+tw:tw; }catch{}
  try{ const jsons=await page.locator('script[type="application/ld+json"]').allTextContents(); for(const raw of jsons){ try{ const data=JSON.parse(raw.trim()); const arr=Array.isArray(data)?data:[data]; for(const obj of arr){ const img=obj?.image||obj?.imageUrl||obj?.thumbnailUrl; if(typeof img==='string') return img.startsWith('//')?'https:'+img:img; if(Array.isArray(img)&&img.length) return String(img[0]).startsWith('//')?'https:'+String(img[0]):String(img[0]); } }catch{} } }catch{}
  try{ const l=await page.locator('link[rel="image_src"]').first().getAttribute('href'); if(l) return l.startsWith('//')?'https:'+l:l; }catch{}
  try{
    const sel=['.swiper-slide-active img','.slick-current img','.gallery img','figure img','main picture source[srcset], main picture img, main img','article picture source[srcset], article picture img, article img'].join(', ');
    const el=page.locator(sel).first();
    const srcset=await el.getAttribute('srcset').catch(()=>null);
    if (srcset){ const parts=srcset.split(',').map(s=>s.trim()); const last=parts[parts.length-1].split(' ')[0]; if(last) return last.startsWith('//')?'https:'+last:last; }
    const src=await el.getAttribute('src').catch(()=>null);
    if (src) return src.startsWith('//')?'https:'+src:src;
  }catch{}
  try{
    const all = await page.locator('img').evaluateAll(imgs => {
      const pick=[]; for(const im of imgs){ const w=im.naturalWidth||im.width||0; const h=im.naturalHeight||im.height||0; const src=im.getAttribute('src')||im.getAttribute('data-src')||''; if (w>=600 && h>=400 && src) pick.push(src); } return pick;
    });
    if (all && all.length){ const u=all[0]; return u.startsWith('//')?'https:'+u:u; }
  }catch{}
  return null;
}
export async function scrapeAuctivo({ context, url }){
  const page = await context.newPage();
  try{
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await page.waitForTimeout(300);

    let title=''; try{ title=(await page.title())||''; }catch{} if(!title){ try{ title=(await page.locator('h1').first().innerText()).trim(); }catch{} }
    const image = await extractImage(page);

    let endsAt = null;
    try{ const dt=await page.locator('time[datetime]').first().getAttribute('datetime'); if(dt) endsAt=new Date(dt).toISOString(); }catch{}
    if (!endsAt){
      try{
        const raw = await page.evaluate(()=> document.body?document.body.innerText:'' );
        const m = raw && raw.match(/\b(\d{2})-(\d{2})-(\d{4}),?\s*(\d{1,2}):(\d{2})\b/);
        if (m){ const dd=+m[1], mm=+m[2]-1, yy=+m[3], hh=+m[4], mi=+m[5]; endsAt=new Date(yy,mm,dd,hh,mi,0,0).toISOString(); }
      }catch{}
    }

    let bids=[]; let currentPrice=null;
    try{
      const result = await page.evaluate(()=>{
        function norm(t){ return (t||'').toLowerCase().replace(/\s+/g,' ').trim(); }
        function whenCell(td){
          const tm=td.querySelector('time');
          if (tm){ const dt=tm.getAttribute('datetime'); if(dt) return dt; const tt=(tm.textContent||'').trim(); if(tt) return tt; }
          const al=td.getAttribute('aria-label')||td.getAttribute('title'); if(al) return al.trim();
          const it=(td.innerText||'').trim(); if(it) return it;
          const tx=(td.textContent||'').trim(); if(tx) return tx;
          const sp=td.querySelector('span'); if(sp){ const s=(sp.innerText||sp.textContent||'').trim(); if(s) return s; }
          return '';
        }
        const tables = Array.from(document.querySelectorAll('table'));
        let target=null;
        for (const tbl of tables){
          const ths = Array.from(tbl.querySelectorAll('thead th, tr th')).map(e=>norm(e.textContent));
          const hasBod = ths.some(t=>/\bbod\b/.test(t));
          const hasDatum = ths.some(t=>/datum/.test(t));
          if (hasBod && hasDatum){ target=tbl; break; }
          const cap = norm(tbl.caption?.textContent || '');
          if (!target && /geschiedenis|bieden|bid/.test(cap)) target=tbl;
        }
        if (!target) return { rows:[], topAmountText:null };
        const rows=[];
        const trs = Array.from(target.querySelectorAll('tbody tr'));
        for (const tr of trs){
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length<2) continue;
          const amountText = (tds[0].textContent||'').trim();
          const whenText = whenCell(tds[1]);
          if (/[€]/.test(amountText)) rows.push({ amountText, whenText });
        }
        const topAmountText = rows.length ? rows[0].amountText : null;
        return { rows, topAmountText };
      });
      const baseStr = await page.evaluate(()=> new Date().toString());
      let anchorMs = null;
      for (const r of result.rows){
        const amount = parseAmount(r.amountText);
        let iso = r.whenText ? parseDutchRelativeToDateISO(r.whenText, baseStr) : null;
        let timeISO = null, dateISO = null;
        if (iso){
          const d = new Date(iso);
          if (d.getHours()===0 && d.getMinutes()===0 && d.getSeconds()===0){
            d.setHours(0,0,0,0); dateISO = d.toISOString(); anchorMs = d.getTime();
          } else { timeISO = d.toISOString(); anchorMs = d.getTime(); }
        } else if (anchorMs){
          const d = new Date(anchorMs - 86400000);
          d.setHours(0,0,0,0); dateISO = d.toISOString(); anchorMs = d.getTime();
        }
        bids.push({ amount, amountText: r.amountText, timeISO, dateISO });
      }
      if (result.topAmountText != null){
        const amtTop = parseAmount(result.topAmountText);
        if (amtTop != null) currentPrice = amtTop;
      }
      const seen=new Set();
      bids = bids.filter(b=>{ const key=`${b.amount ?? b.amountText}-${b.timeISO||b.dateISO}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0,120);
    }catch{}

    const meta = { title: title || 'Auction lot', currency:'EUR' };
    return { meta, url, image, endsAt, currentPrice, bids };
  }catch(e){
    return { meta:{ title:'Auction lot', currency:'EUR', error:String(e) }, url, image:null, endsAt:null, currentPrice:null, bids:[] };
  } finally { try{ await page.close(); }catch{} }
}
