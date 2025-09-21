async function exportHistory(id, kind){
  const url = kind === 'csv' ? `/api/listings/${encodeURIComponent(id)}/history.csv`
                             : `/api/listings/${encodeURIComponent(id)}/history.json`;
  const a = document.createElement('a');
  a.href = url; a.download='';
  document.body.appendChild(a); a.click(); a.remove();
}

async function openSettingsDialog(){
  try{
    const cur = await (await fetch('/api/settings')).json();
    const url = prompt('Discord Webhook URL:', cur.discordWebhookUrl || '');
    if (url===null) return; // cancel
    const alertNew = confirm('Ping on NEW BID? (OK=yes / Cancel=no)');
    const alert30 = confirm('Ping when <30 minutes left? (OK=yes / Cancel=no)');
    const cd = prompt('Alert cooldown (minutes):', String(cur.alertCooldownMinutes || 10));
    await fetch('/api/settings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        discordWebhookUrl: url,
        alertOnNewBid: alertNew,
        alertOn30min: alert30,
        alertCooldownMinutes: Number(cd||10)
      })
    });
    alert('Settings saved.');
  }catch(e){ alert('Failed: '+e.message); }
}
document.getElementById('btn-settings').addEventListener('click', openSettingsDialog);

const socket = io();
const cardsEl = document.getElementById('cards');
const cardMap = new Map();

document.getElementById('btn-add').addEventListener('click', async () => {
  const url = prompt('Enter lot URL:');
  if (!url) return;
  try {
    await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  } catch (e) {
    alert('Failed to add lot: ' + e.message);
  }
});

async function setCustomName(id) {
  const name = prompt('Custom name for this listing:');
  if (!name) return;
  try {
    await fetch(`/api/listings/${encodeURIComponent(id)}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
  } catch (e) {
    alert('Failed to set name: ' + e.message);
  }
}

async function removeListing(id) {
  if (!confirm('Are you sure you want to remove this listing?')) return;
  try {
    await fetch(`/api/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    alert('Failed to remove lot: ' + e.message);
  }
}

function fmtAmount(n, currency='EUR'){ try{ return new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(n);}catch{ return `${currency} ${n}`;}}

function renderCard(data){
  let card = cardMap.get(data.id);
  if(!card){
    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="thumb" src="" alt="thumbnail" onerror="this.style.display='none'"/>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px">
        <div>
          <div class="title" style="font-weight:700;margin-bottom:6px"></div>
          <div class="url" style="color:#7cc4ff"></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-rename">Rename</button>
          <button class="btn-remove">Remove</button>
          <div class="status" style="padding:4px 8px;border-radius:12px;background:#0f1b34">Loading…</div>
        </div>
      </div>
      <div style="display:flex;gap:24px;margin-top:8px">
        <div>
          <div style="color:#7a8699;font-size:12px">Ends in</div>
          <div class="countdown" style="font-size:22px">—:—:—</div>
          <div class="price-now" style="color:#7a8699;font-size:12px">Price: —</div>
        </div>
        <div>
          <div style="color:#7a8699;font-size:12px">Last updated</div>
          <div class="updated">—</div>
          <div class="last-change" style="color:#7a8699;font-size:12px">Last change: —</div>
        </div>
      </div>
      <div class="freq" style="color:#7a8699;font-size:12px;margin-top:4px"></div>
      <div style="display:flex;gap:8px;margin:8px 0 4px 0">
        <button class="btn-export-json">Export JSON</button>
        <button class="btn-export-csv">Export CSV</button>
      </div>
      <table><thead><tr><th>Time</th><th>Amount</th></tr></thead><tbody class="bids"></tbody></table>`;
    cardsEl.appendChild(card);
    cardMap.set(data.id, card);
    card.querySelector('.btn-rename').addEventListener('click', () => setCustomName(data.id));
    card.querySelector('.btn-remove').addEventListener('click', () => removeListing(data.id));
    card.querySelector('.btn-export-json').addEventListener('click', ()=>exportHistory(data.id,'json'));
    card.querySelector('.btn-export-csv').addEventListener('click', ()=>exportHistory(data.id,'csv'));
  }

  // image
  const imgEl = card.querySelector('.thumb');
  if (data.image && imgEl.src !== data.image) { imgEl.style.display='block'; imgEl.src = data.image; }

  const display = data.meta?.displayName || data.meta?.title || 'Auction lot';
  card.querySelector('.title').textContent = display;
  card.querySelector('.url').innerHTML = `<a href="${data.url}" target="_blank" rel="noopener" style="color:#7cc4ff">Open listing</a>`;
  card.querySelector('.status').textContent = data.meta?.error ? 'Scrape error' : 'Live';
  const statusEl = card.querySelector('.status'); if (statusEl) statusEl.title = data.meta?.error || '';

  if (data.lastUpdated) {
    card.querySelector('.updated').textContent =
      new Date(data.lastUpdated).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  }

  const freq = card.querySelector('.freq');
  if (data.currentInterval) {
    const sec = Math.round(data.currentInterval/1000);
    freq.textContent = `Updating every ${sec}s${sec===7?' (last 30 minutes)':''}`;
  }

  const priceEl = card.querySelector('.price-now');
  priceEl.textContent = 'Price: ' + (
    Number.isFinite(data.currentPrice)
      ? fmtAmount(data.currentPrice, data.meta?.currency || 'EUR')
      : '—'
  );

  const lastChangeEl = card.querySelector('.last-change');
  lastChangeEl.textContent = 'Last change: ' + (
    data.lastChangeAt ? new Date(data.lastChangeAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : '—'
  );

  const tbody = card.querySelector('.bids'); tbody.innerHTML='';
  (data.bids||[]).slice().forEach(b=>{
    const tr = document.createElement('tr'); const td1=document.createElement('td'); const td2=document.createElement('td');
    const src = (b.source||'').toLowerCase();
    let icon = '', tip = '';
    if (src === 'observed'){ icon = '⚡'; tip = 'Observed: detected from live price change'; }
    else if (src === 'scraped-time'){ icon = '🕒'; tip = 'Scraped: exact time from site'; }
    else if (src === 'scraped-date'){ icon = '≈'; tip = 'Approx.: date derived from relative text'; }
    else { icon = ''; tip = ''; }

    const iconEl = document.createElement('span');
    iconEl.textContent = icon ? (' ' + icon) : '';
    if (tip) iconEl.title = tip;
    iconEl.style.opacity = '0.8';

    if (b.timeISO) {
      td1.textContent = new Date(b.timeISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
      td1.appendChild(iconEl);
    } else if (b.dateISO) {
      // date-only; show '~' to indicate approximate
      td1.textContent = new Date(b.dateISO).toLocaleDateString('nl-NL', { year:'numeric', month:'2-digit', day:'2-digit' });
      const tilde = document.createElement('span'); tilde.textContent = ' ~'; tilde.title = tip || 'Approximate (date-only)';
      tilde.style.opacity = '0.6';
      td1.appendChild(tilde);
      td1.appendChild(iconEl);
    } else {
      td1.textContent = '—';
      td1.appendChild(iconEl);
    }
    td2.textContent = b.amount!=null ? fmtAmount(b.amount, data.meta?.currency || 'EUR') : (b.amountText || '—');
    tr.appendChild(td1); tr.appendChild(td2); tbody.appendChild(tr);
  });

  const countdownEl = card.querySelector('.countdown');
  const endsAt = data.endsAt ? new Date(data.endsAt).getTime() : null;
  if(endsAt){
    if(card._countdownInterval) clearInterval(card._countdownInterval);
    card._countdownInterval = setInterval(()=>{
      let diff = Math.max(0, endsAt - Date.now());
      const days  = Math.floor(diff / 86400000); diff -= days  * 86400000;
      const hours = Math.floor(diff / 3600000);  diff -= hours * 3600000;
      const mins  = Math.floor(diff / 60000);    diff -= mins  * 60000;
      const secs  = Math.floor(diff / 1000);
      const hh = String(hours).padStart(2,'0');
      const mm = String(mins).padStart(2,'0');
      const ss = String(secs).padStart(2,'0');
      countdownEl.textContent = days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
    }, 1000);
  } else {
    countdownEl.textContent='—:—:—';
  }
}

socket.on('listing:update', payload => renderCard(payload));
socket.on('listing:remove', ({id}) => {
  const card = cardMap.get(id);
  if (card) { card.remove(); cardMap.delete(id); }
});
