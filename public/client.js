window.__intervals = window.__intervals || {};

const elList = document.getElementById('list');
const elEmpty = document.getElementById('empty');
const elStatus = document.getElementById('status');
const modal = document.getElementById('modal');
const lotUrl = document.getElementById('lotUrl');

function openModal(){ modal.style.display='flex'; lotUrl.value=''; lotUrl.focus(); }
function closeModal(){ modal.style.display='none'; }

document.getElementById('addBtn').onclick=openModal;
document.getElementById('cancel').onclick=closeModal;
document.getElementById('save').onclick=async ()=>{
  const url = lotUrl.value.trim();
  if(!url) return;
  try{
    const r = await fetch('/api/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})}).then(r=>r.json());
    if(r.ok){ closeModal(); await refresh(); } else { alert('Add failed: '+(r.error||'unknown')); }
  }catch(e){ alert('Add failed'); }
};

async function getData(){
  try{
    const r = await fetch('/api/listings',{cache:'no-store'}).then(r=>r.json());
    return r || {};
  }catch{ return {}; }
}

function fmt(i){ return i<10?('0'+i):i; }
function countdown(iso){
  if(!iso) return '—';
  const end = new Date(iso).getTime();
  const now = Date.now();
  let s = Math.max(0, Math.floor((end-now)/1000));
  const d = Math.floor(s/86400); s%=86400;
  const h = Math.floor(s/3600); s%=3600;
  const m = Math.floor(s/60); s%=60;
  return `${d}d ${fmt(h)}:${fmt(m)}:${fmt(s)}`;
}

function render(listings){
  elList.innerHTML='';
  if(!listings || !listings.length){ elEmpty.style.display='block'; return; }
  elEmpty.style.display='none';
  for(const it of listings){
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `
      <img class="thumb" src="${it.image||''}" onerror="this.style.display='none'">
      <h3>${it.title||'Untitled'}</h3>
      <div class="row"><span class="small">Ends in</span><span class="badge" data-end="${it.endsAt||''}">--:--:--</span></div>
      <div class="row"><span class="small">Price</span><span>${it.price!=null?('€ '+it.price):'—'}</span></div>
      <div class="actions">
        <a class="btn secondary" href="${it.url}" target="_blank" rel="noopener">Open listing</a>
      </div>
    `;
    elList.appendChild(card);
  }
  // simple ticker
  setInterval(()=>{
    document.querySelectorAll('[data-end]').forEach(el=>{
      const iso = el.getAttribute('data-end'); el.textContent = countdown(iso);
    });
  }, 1000);
}

async function refresh(){
  elStatus.textContent='';
  const data = await getData();
  render(data.listings||[]);
  elStatus.textContent = 'Updated at ' + new Date().toLocaleTimeString();
}
refresh();
setInterval(refresh, 10000);
