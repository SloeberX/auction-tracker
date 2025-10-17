export async function sendDiscordEmbed(webhook, { title, url, description, image, price, endsAt }) {
  if (!webhook) return false;
  const embed = {
    title: title || 'New lot',
    url: url || undefined,
    description: description || undefined,
    timestamp: new Date().toISOString(),
    color: 0x4f8cff,
    fields: []
  };
  if (typeof price === 'number') embed.fields.push({ name: 'Price', value: `€ ${price.toFixed(2)}`, inline: true });
  if (endsAt) embed.fields.push({ name: 'Ends', value: new Date(endsAt).toLocaleString(), inline: true });
  if (image) embed.image = { url: image };

  const payload = { content: '', embeds: [embed] };
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return r.ok;
  } catch {
    return false;
  }
}
