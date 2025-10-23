const elList = document.getElementById('list');
const elEmpty = document.getElementById('empty');
const elStatus = document.getElementById('status');

// add lot modal
const modal = document.getElementById('modal');
const lotUrl = document.getElementById('lotUrl');
document.getElementById('addBtn').onclick = ()=>{ modal.style.display='flex'; lotUrl.value=''; lotUrl.focus(); };
document.getElementById('cancel').onclick = ()=>{ modal.style.display='none'; };
document.getElementById('save').onclick = async ()=>{
  const url = lotUrl.value.trim();
  if(!url) return;
  try{
    const r = await fetch('/api/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const j = await r.json().catch(()=>({ok:false,error:'Bad JSON'}));
    if(!r.ok || !j.ok) throw new Error(j.error||('HTTP '+r.status));
    modal.style.display='none'; refresh();
  }catch(e){ alert('Add failed: '+(e.message||e)); }
};

// discord settings modal
const dModal = document.getElementById('discordModal');
const webhook = document.getElementById('webhook');
document.getElementById('discordBtn').onclick = async ()=>{
  dModal.style.display='flex';
  try{ const s = await fetch('/api/settings').then(r=>r.json()); webhook.value = (s.discordWebhook||''); }catch{}
};
document.getElementById('dCancel').onclick = ()=> dModal.style.display='none';
document.getElementById('dSave').onclick = async ()=>{
  try{
    const r = await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({discordWebhook:webhook.value.trim()})});
    const j = await r.json().catch(()=>({ok:false,error:'Bad JSON'}));
    if(!r.ok || !j.ok) throw new Error(j.error||('HTTP '+r.status));
    dModal.style.display='none';
  }catch(e){ alert('Failed to save: '+(e.message||e)); }
};

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

function row(t,a){
  const tr = document.createElement('tr');
  const td1 = document.createElement('td'); td1.textContent = t;
  const td2 = document.createElement('td'); td2.textContent = a;
  tr.appendChild(td1); tr.appendChild(td2);
  return tr;
}

function render(listings, history){
  elList.innerHTML='';
  if(!listings || !listings.length){ elEmpty.style.display='block'; return; }
  elEmpty.style.display='none';

  for(const it of listings){
    const card = document.createElement('div'); card.className='card';
    const hist = (history && history[it.id]) || [];
    const lastUpdated = new Date(it.updatedAt||Date.now()).toLocaleTimeString();
    const lastChange = it.lastChange ? new Date(it.lastChange).toLocaleTimeString() : '—';

    card.innerHTML = `
      <img class="thumb" src="${it.image||''}" onerror="this.style.display='none'">
      <h3>${it.title||it.url||'Untitled'}</h3>
      <div class="row"><span class="small">Open listing</span><a class="btn secondary" href="${it.url}" target="_blank" rel="noopener">Open</a></div>
      <div class="row"><span class="small">Ends in</span><span class="badge" data-end="${it.endsAt||''}">--:--:--</span></div>
      <div class="row"><span class="small">Price</span><span>${it.currentPrice!=null?('€ '+Number(it.currentPrice).toFixed(2)):'—'}</span></div>
      <div class="row small"><span>Last updated</span><span>${lastUpdated}</span></div>
      <div class="row small"><span>Last change</span><span>${lastChange}</span></div>
      <div class="actions">
        <button class="btn secondary" data-rename="${it.id}">Rename</button>
        <button class="btn secondary" data-remove="${it.id}">Remove</button>
        <button class="btn" data-ping="${it.id}">Send to Discord</button>
      </div>
      <table class="table">
        <thead><tr><td>Time</td><td>Amount</td></tr></thead>
        <tbody id="hist-${it.id}"></tbody>
      </table>
    `;
    elList.appendChild(card);
    const tb = card.querySelector('#hist-'+it.id);
    for(const b of hist){
      const t = b.timeISO ? new Date(b.timeISO).toLocaleTimeString() : '—';
      const a = '€ ' + Number(b.amount||0).toFixed(2);
      tb.appendChild(row(t,a));
    }
  }

  // countdown ticker
  setInterval(()=>{
    document.querySelectorAll('[data-end]').forEach(el=>{
      const iso = el.getAttribute('data-end'); el.textContent = countdown(iso);
    });
  }, 1000);

  // actions
  document.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-remove');
      await fetch('/api/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
      refresh();
    };
  });
  document.querySelectorAll('[data-rename]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-rename');
      const title = prompt('New title:');
      if(!title) return;
      await fetch('/api/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,title})});
      refresh();
    };
  });
  document.querySelectorAll('[data-ping]').forEach(btn=>{
    btn.onclick = async ()=>{
      try{
        const id = btn.getAttribute('data-ping');
        const r = await fetch('/api/ping-discord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
        const j = await r.json().catch(()=>({ok:false,error:'Bad JSON'}));
        if(!r.ok || !j.ok) throw new Error(j.error||('HTTP '+r.status));
      }catch(e){ alert('Discord send failed: '+(e.message||e)); }
    };
  });
}

async function refresh(){
  const r = await fetch('/api/listings',{cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
  render(r.listings||[], r.history||{});
  elStatus.textContent = 'Updated at ' + new Date().toLocaleTimeString();
}

refresh();
setInterval(refresh, 15000);
