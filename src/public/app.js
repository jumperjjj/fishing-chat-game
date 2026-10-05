const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
let settings = {};
let itemCache = [];
let editingItemId = null;

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
  $('#chatResultEnabled').checked = settings.chat_result_enabled !== '0';
  $('#overlaySound').checked = settings.overlay_sound_enabled !== '0';
  $('#overlayUrl').textContent = data.overlayUrl;
}

function formatChance(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function updateChanceSummary(total) {
  const rounded = Math.round(Number(total || 0) * 100) / 100;
  $('#chanceTotal').textContent = formatChance(rounded);
  const ok = Math.abs(rounded - 100) <= 0.01;
  $('#chanceTotal').className = ok ? 'chance-ok' : 'chance-bad';
  $('#chanceHint').textContent = ok ? 'Pronto para pescar.' : `Ajuste ${formatChance(Math.abs(100 - rounded))} para chegar a 100%.`;
  $('#chanceHint').className = ok ? 'chance-hint ok' : 'chance-hint';
}

async function loadItems() {
  const data = await api('/api/items');
  itemCache = data.items || [];
  updateChanceSummary(data.chanceTotal);
  $('#itemsBody').innerHTML = itemCache.length ? itemCache.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${escapeHtml(item.rarity)}</td>
      <td>${formatChance(item.chance)}</td>
      <td>${Number(item.gold_min).toLocaleString('pt-BR')}–${Number(item.gold_max).toLocaleString('pt-BR')}</td>
      <td class="actions-cell"><button class="small edit-item" data-id="${item.id}">Editar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="muted">Nenhum item cadastrado.</td></tr>';

  $$('.edit-item').forEach((button) => button.addEventListener('click', () => openEditor(Number(button.dataset.id))));
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

function openEditor(id = null) {
  editingItemId = id;
  const item = id ? itemCache.find((entry) => Number(entry.id) === Number(id)) : null;
  $('#itemEditor').classList.remove('hidden');
  $('#itemEditorTitle').textContent = item ? 'Editar peixe/item' : 'Novo peixe/item';
  $('#editingBadge').classList.toggle('hidden', !item);
  $('#deleteItem').classList.toggle('hidden', !item);
  $('#itemName').value = item?.name || '';
  $('#itemRarity').value = item?.rarity || 'Comum';
  $('#itemChance').value = item ? Number(item.chance) : 0;
  $('#itemGoldMin').value = item ? Number(item.gold_min) : 10;
  $('#itemGoldMax').value = item ? Number(item.gold_max) : 20;
  $('#itemName').focus();
  $('#itemEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditor() {
  editingItemId = null;
  $('#itemEditor').classList.add('hidden');
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
    chat_result_enabled: $('#chatResultEnabled').checked ? '1' : '0',
    twitch_client_id: $('#clientId').value.trim(),
    target_channel_login: $('#targetChannel').value.trim()
  })});
  $('#eventLog').textContent = 'Configurações salvas.';
});

$('#saveOverlaySettings').addEventListener('click', async () => {
  await api('/api/settings', { method: 'POST', body: JSON.stringify({
    overlay_sound_enabled: $('#overlaySound').checked ? '1' : '0'
  })});
  $('#eventLog').textContent = 'Configurações do overlay salvas.';
});

$('#testFish').addEventListener('click', async () => {
  $('#eventLog').textContent = 'Pescador Teste está pescando…';
  try {
    const result = await api('/api/test-fish', { method: 'POST', body: '{}' });
    if (result.ok) $('#eventLog').textContent = `${result.user.displayName} pescou ${result.item.name} (${result.item.rarity}) e ganhou ${result.item.goldAwarded} de Ouro.`;
    await loadRanking();
  } catch (e) { $('#eventLog').textContent = e.message; }
});

$('#newItem').addEventListener('click', () => openEditor());
$('#cancelItem').addEventListener('click', closeEditor);

$('#saveItem').addEventListener('click', async () => {
  try {
    const payload = {
      name: $('#itemName').value.trim(),
      rarity: $('#itemRarity').value,
      chance: Number($('#itemChance').value),
      goldMin: Number($('#itemGoldMin').value),
      goldMax: Number($('#itemGoldMax').value)
    };
    if (!payload.name) throw new Error('Informe o nome do peixe/item.');
    if (payload.goldMax < payload.goldMin) throw new Error('O Ouro máximo não pode ser menor que o mínimo.');

    if (editingItemId) {
      await api(`/api/items/${editingItemId}`, { method: 'PUT', body: JSON.stringify(payload) });
      $('#eventLog').textContent = `${payload.name} atualizado.`;
    } else {
      await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
      $('#eventLog').textContent = `${payload.name} adicionado.`;
    }
    closeEditor();
    await loadItems();
  } catch (e) {
    $('#eventLog').textContent = e.message;
  }
});

$('#deleteItem').addEventListener('click', async () => {
  const item = itemCache.find((entry) => Number(entry.id) === Number(editingItemId));
  if (!item) return;
  if (!confirm(`Excluir "${item.name}"? O histórico de capturas antigas será preservado.`)) return;
  try {
    await api(`/api/items/${editingItemId}`, { method: 'DELETE' });
    $('#eventLog').textContent = `${item.name} excluído do catálogo.`;
    closeEditor();
    await loadItems();
  } catch (e) {
    $('#eventLog').textContent = e.message;
  }
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
    $('#eventLog').textContent = `${data.user.displayName} pescou ${data.item.name} (${data.item.rarity}) • +${data.item.goldAwarded} Ouro • total ${data.player.gold}`;
    loadRanking();
  }
  if (data.type === 'fishing:cooldown') $('#eventLog').textContent = `${data.user.displayName}: aguarde ${data.remainingSeconds}s.`;
  if (data.type === 'fishing:error') $('#eventLog').textContent = data.message;
  if (data.type === 'twitch:error') $('#eventLog').textContent = data.message;
  if (data.type === 'twitch:connected') {
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${data.identity.bot.display_name} → ${data.identity.channel.display_name}`;
  }
});

loadStatus();
loadItems();
loadRanking();
