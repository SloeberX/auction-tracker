(function(){
  function h(tag, attrs={}, children=[]){
    const el = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})){
      if (k==='class') el.className = v;
      else if (k==='style') el.setAttribute('style', v);
      else el[k] = v;
    }
    for (const c of (children||[])){
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else if (c) el.appendChild(c);
    }
    return el;
  }
  function injectCSS(){
    const css = `
    .dc-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:9999;}
    .dc-card{background:#10151C;color:#e9eef7;width:520px;max-width:92vw;padding:18px 20px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.4);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,'Noto Sans',sans-serif;}
    .dc-row{display:flex;align-items:center;gap:10px;margin:10px 0;}
    .dc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin:6px 0 10px;}
    .dc-card input[type=text], .dc-card input[type=number]{width:100%;margin-top:6px;margin-bottom:10px;padding:10px;border-radius:10px;border:1px solid #263043;background:#0b0f14;color:#e9eef7;}
    .dc-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;}
    .dc-btn{background:#1f2633;color:#dbe7ff;border:1px solid #2a3446;padding:8px 12px;border-radius:10px;cursor:pointer;}
    .dc-btn:hover{background:#2a3446;}
    .dc-primary{background:#5865f2;border-color:#5865f2;}
    .dc-primary:hover{filter:brightness(1.1);}
    .dc-floating{position:fixed;top:18px;right:18px;background:#5865f2;color:white;border:none;border-radius:10px;padding:8px 12px;cursor:pointer;z-index:9998;}
    `;
    const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
  }
  async function apiGet(url){ const r=await fetch(url); if(!r.ok) throw new Error(r.status); return r.json(); }
  async function apiPost(url, data){ const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'}, body: JSON.stringify(data||{})}); if(!r.ok) throw new Error(await r.text()); return r.json(); }
  function buildModal(){
    const modal = h('div',{class:'dc-modal', id:'dcModal'},[
      h('div',{class:'dc-card'},[
        h('h3',{innerText:'Discord Webhook'}),
        h('label',{class:'dc-row'},[ h('input',{type:'checkbox', id:'dcEnabled'}), h('span',{innerText:'Enable Discord posting'}) ]),
        h('div',{},[ h('div',{innerText:'Webhook URL'}), h('input',{id:'dcUrl', type:'text', placeholder:'https://discord.com/api/webhooks/...'} ) ]),
        h('div',{class:'dc-grid'},[
          h('label',{class:'dc-row'},[ h('input',{type:'checkbox', id:'dcPingBid', checked:true}), h('span',{innerText:'@everyone on new bid'}) ]),
          h('label',{class:'dc-row'},[ h('input',{type:'checkbox', id:'dcPing30', checked:true}), h('span',{innerText:'@everyone when < 30 min'}) ]),
        ]),
        h('div',{},[ h('div',{innerText:'Update interval (seconds)'}), h('input',{id:'dcInterval', type:'number', min:15, value:60}) ]),
        h('div',{class:'dc-actions'},[
          h('button',{class:'dc-btn dc-primary', id:'dcSave', innerText:'Save'}),
          h('button',{class:'dc-btn', id:'dcTest', innerText:'Send test'}),
          h('button',{class:'dc-btn', id:'dcClose', innerText:'Close'}),
        ])
      ])
    ]);
    document.body.appendChild(modal);
    return modal;
  }
  function attach(){
    injectCSS();
    const btn = h('button',{class:'dc-floating', id:'btnDiscord', innerText:'Discord'});
    document.body.appendChild(btn);
    const modal = buildModal();
    const $ = (id)=>document.getElementById(id);
    btn.addEventListener('click', async ()=>{
      modal.style.display='flex';
      try{
        const s = await apiGet('/api/discord/settings');
        $('dcEnabled').checked = !!s.enabled;
        $('dcUrl').value = s.webhookUrl || '';
        $('dcPingBid').checked = s.pingOnNewBid ?? true;
        $('dcPing30').checked = s.pingAt30m ?? true;
        $('dcInterval').value = s.updateIntervalSec ?? 60;
      }catch{}
    });
    $('dcClose').addEventListener('click', ()=> modal.style.display='none');
    $('dcSave').addEventListener('click', async ()=>{
      const payload = {
        enabled: $('dcEnabled').checked,
        webhookUrl: $('dcUrl').value.trim(),
        pingOnNewBid: $('dcPingBid').checked,
        pingAt30m: $('dcPing30').checked,
        updateIntervalSec: Number($('dcInterval').value || 60)
      };
      try{ await apiPost('/api/discord/settings', payload); }catch{}
      modal.style.display='none';
    });
    $('dcTest').addEventListener('click', async ()=>{
      try{ await apiPost('/api/discord/test', {}); alert('Sent!'); }catch(e){ alert('Failed: '+e); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();
})();
