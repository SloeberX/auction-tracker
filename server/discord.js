import fetch from 'node-fetch';

export async function sendDiscord(webhook, payload){
  if(!webhook) return false;
  try{
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    return res.ok;
  }catch{
    return false;
  }
}

export function lotEmbed({title,url,image,price,endsAt,lastChange}){
  const fields = [];
  if (typeof price === 'number') fields.push({name:'Price', value:`€ ${price.toFixed(2)}`, inline:true});
  if (endsAt) fields.push({name:'Ends', value:new Date(endsAt).toLocaleString(), inline:true});
  if (lastChange) fields.push({name:'Last change', value:lastChange, inline:true});
  const embed = {
    title: title || 'Lot update',
    url: url || undefined,
    timestamp: new Date().toISOString(),
    color: 0x4f8cff,
    fields
  };
  if (image) embed.image = { url:image };
  return { embeds:[embed] };
}
