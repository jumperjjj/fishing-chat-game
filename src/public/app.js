const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
let settings = {};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Erro ${response.status}`);
  return body;
}

async function loadStatus() {
  const data = await api('/api/status');
  settings = data.settings;
  $('#command').value = settings.command || '!pescar';
  $('#cooldown').value = settings.cooldown_seconds || '120';
  $('#fishingSeconds').value = settings.fishing_seconds || '4';
  $('#clientId').value = settings.twitch_client_id || '';
  $('#targetChannel').value = settings.target_channel_login || '';
  $('#overlayUrl').textContent = data.overlayUrl;
}

async function loadItems() {
  const items = await api('/api/items');
  $('#itemsBody').innerHTML = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.rarity)}</td>
      <td>${item.weight}</td><td>${Number(item.chance || 0).toFixed(3)}%</td><td>${Number(item.gold).toLocaleString('pt-BR')}</td><td>${item.enabled ? 'Sim' : 'Não'}</td>
    </tr>
  `).join('');
}

async function loadRanking() {
  const rows = await api('/api/leaderboard');
  $('#rankingBody').innerHTML = rows.length ? rows.map((row, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(row.display_name || row.login)}</td><td>${Number(row.gold).toLocaleString('pt-BR')}</td><td>${row.total_catches}</td></tr>
  `).join('') : '<tr><td colspan="4" class="muted">Nenhuma pescaria registrada.</td></tr>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

$$('.nav').forEach((button) => button.addEventListener('click', async () => {
  $$('.nav').forEach((x) => x.classList.remove('active'));
  $$('.page').forEach((x) => x.classList.remove('active'));
  button.classList.add('active');
  $(`#page-${button.dataset.page}`).classList.add('active');
  if (button.dataset.page === 'items') await loadItems();
  if (button.dataset.page === 'ranking') await loadRanking();
}));

$('#saveSettings').addEventListener('click', async () => {
  await api('/api/settings', { method: 'POST', body: JSON.stringify({
    command: $('#command').value.trim() || '!pescar',
    cooldown_seconds: $('#cooldown').value,
    fishing_seconds: $('#fishingSeconds').value,
    twitch_client_id: $('#clientId').value.trim(),
    target_channel_login: $('#targetChannel').value.trim()
  })});
  $('#eventLog').textContent = 'Configurações salvas.';
});

$('#testFish').addEventListener('click', async () => {
  $('#eventLog').textContent = 'Pescador Teste está pescando…';
  try {
    const result = await api('/api/test-fish', { method: 'POST', body: '{}' });
    if (result.ok) $('#eventLog').textContent = `${result.user.displayName} pescou ${result.item.name} (${result.item.rarity}) e ganhou ${result.item.gold} ouro.`;
    await loadRanking();
  } catch (e) { $('#eventLog').textContent = e.message; }
});

$('#newItem').addEventListener('click', () => $('#itemEditor').classList.remove('hidden'));
$('#cancelItem').addEventListener('click', () => $('#itemEditor').classList.add('hidden'));
$('#saveItem').addEventListener('click', async () => {
  await api('/api/items', { method: 'POST', body: JSON.stringify({
    name: $('#itemName').value.trim(), type: $('#itemType').value.trim(), rarity: $('#itemRarity').value,
    weight: Number($('#itemWeight').value), gold: Number($('#itemGold').value)
  })});
  $('#itemName').value = '';
  $('#itemEditor').classList.add('hidden');
  await loadItems();
});

$('#copyOverlay').addEventListener('click', async () => {
  const url = await window.desktop.copyOverlayUrl();
  $('#eventLog').textContent = `URL copiada: ${url}`;
});
$('#openOverlay').addEventListener('click', () => window.desktop.openExternal($('#overlayUrl').textContent));

$('#connectTwitch').addEventListener('click', async () => {
  try {
    const clientId = $('#clientId').value.trim();
    const targetChannelLogin = $('#targetChannel').value.trim();
    if (!targetChannelLogin) throw new Error('Informe o canal da live.');
    const device = await api('/api/twitch/device', { method: 'POST', body: JSON.stringify({ clientId }) });
    $('#deviceBox').classList.remove('hidden');
    $('#deviceCode').textContent = device.user_code;
    $('#openTwitchAuth').onclick = () => window.desktop.openExternal(device.verification_uri);
    $('#deviceProgress').textContent = 'Aguardando autorização…';
    window.desktop.openExternal(device.verification_uri);
    const result = await window.desktop.completeTwitchDeviceAuth({
      clientId, deviceCode: device.device_code, interval: device.interval, expiresIn: device.expires_in, targetChannelLogin
    });
    $('#deviceProgress').textContent = 'Autorizado!';
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${result.identity.bot.display_name} → ${result.identity.channel.display_name}`;
  } catch (e) {
    $('#deviceProgress').textContent = e.message;
    $('#eventLog').textContent = e.message;
  }
});

const ws = new WebSocket(`ws://${location.host}/ws`);
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'fishing:start') $('#eventLog').textContent = `${data.user.displayName} está pescando…`;
  if (data.type === 'fishing:result') {
    $('#eventLog').textContent = `${data.user.displayName} pescou ${data.item.name} (${data.item.rarity}) • +${data.item.gold} ouro • total ${data.player.gold}`;
    loadRanking();
  }
  if (data.type === 'fishing:cooldown') $('#eventLog').textContent = `${data.user.displayName}: aguarde ${data.remainingSeconds}s.`;
  if (data.type === 'twitch:connected') {
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${data.identity.bot.display_name} → ${data.identity.channel.display_name}`;
  }
});

loadStatus();
loadItems();
loadRanking();
