window.__intervals = window.__intervals || {};
(async function(){
  const el = document.getElementById('app');
  async function refresh(){
    const r = await fetch('/api/listings').then(r=>r.json()).catch(()=>({}));
    el.textContent = 'Listings: ' + (r.listings ? r.listings.length : 0);
  }
  await refresh();
  setInterval(refresh, 5000);
})();