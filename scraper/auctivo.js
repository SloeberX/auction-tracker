import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEBUG_DIR = path.resolve(__dirname, '..', 'public', 'debug');
function ensureDir(p){ try{ fs.mkdirSync(p,{recursive:true}); }catch{} }

function parseAmount(txt){
  const cleaned = (txt||'').replace(/[\n\t]/g,' ').replace(/[^0-9,.,\-€]/g,'').replace(/€/g,'').trim();
  if(!cleaned) return null;
  const normalized = cleaned.replace(/\./g,'').replace(/,(\d{1,2})$/, '.$1');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function mondayStart(d){
  const x = new Date(d);
  const day = x.getDay()===0 ? 7 : x.getDay(); // 1..7, Monday=1
  x.setDate(x.getDate() - (day-1));
  x.setHours(0,0,0,0);
  return x;
}
function startOfDayISO(d){ const x=new Date(d); x.setHours(0,0,0,0); return x.toISOString(); }

function parseDutchRelativeToDateISO(text, baseStr){
  if(!text) return null;
  const t = String(text).trim().toLowerCase();

  // base date from page (Europe/Amsterdam) string; fall back to now
  const base = baseStr ? new Date(baseStr) : new Date();
  // Local midnight helper
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Monday 00:00 of the week of date d (NL convention)
  const mondayStart = (d) => {
    const ds = dayStart(d);
    const dow = (ds.getDay() + 6) % 7; // Monday=0..Sunday=6
    return new Date(ds.getTime() - dow*24*3600*1000);
  };

  // absolute dd-mm-yyyy or dd-mm-yy
  const mAbs = t.match(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/);
  if (mAbs){
    let [_, dd, mm, yy] = mAbs;
    dd = Number(dd); mm = Number(mm)-1; yy = Number(yy); if (yy < 100) yy += 2000;
    const d = new Date(yy, mm, dd, 0, 0, 0, 0);
    return d.toISOString();
  }

  // vandaag / gisteren / eergisteren
  if (/\bvandaag\b/.test(t)){
    return dayStart(base).toISOString();
  }
  if (/\bgisteren\b/.test(t)){
    const d = new Date(dayStart(base).getTime() - 1*24*3600*1000);
    return d.toISOString();
  }
  if (/\beergisteren\b/.test(t)){
    const d = new Date(dayStart(base).getTime() - 2*24*3600*1000);
    return d.toISOString();
  }

  // X dagen geleden
  const mDays = t.match(/(\d+)\s*dag(?:en)?\s+geleden/);
  if (mDays){
    const n = Number(mDays[1]);
    const d = new Date(dayStart(base).getTime() - n*24*3600*1000);
    return d.toISOString();
  }

  // vorige week / X weken geleden => Monday 00:00 of that week
  if (/\bvorige\s+week\b/.test(t)){
    const curMon = mondayStart(base);
    const d = new Date(curMon.getTime() - 7*24*3600*1000);
    return d.toISOString();
  }
  const mWeeks = t.match(/(\d+)\s*weken?\s+geleden/);
  if (mWeeks){
    const n = Number(mWeeks[1]);
    const curMon = mondayStart(base);
    const d = new Date(curMon.getTime() - n*7*24*3600*1000);
    return d.toISOString();
  }

  // times like '08:19' or '08:19:53' today
  const mTime = t.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (mTime){
    const hh = Number(mTime[1]), mi = Number(mTime[2]), ss = Number(mTime[3]||'0');
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mi, ss, 0);
    return d.toISOString();
  }

  // fallback: let Date try to parse; if it yields a valid date, pass it through
  const d2 = new Date(text);
  if (!isNaN(d2.getTime())) return d2.toISOString();

  return null;
}

