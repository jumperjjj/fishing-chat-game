const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let settings = {};
let itemCache = [];
let playersCache = [];
let editingItemId = null;
let creatingItem = false;
let editorImageData = '';
let editorRemoveImage = false;
let editingRankUserId = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Erro ${response.status}`);
  return body;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function escapeAttr(value) { return escapeHtml(value); }

function formatChance(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function formatNumber(value) { return Number(value || 0).toLocaleString('pt-BR'); }

function rarityClass(rarity) {
  const key = String(rarity || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return `rarity-${key}`;
}

function updateChanceSummary(total) {
  const rounded = Math.round(Number(total || 0) * 100) / 100;
  $('#chanceTotal').textContent = formatChance(rounded);
  const ok = Math.abs(rounded - 100) <= 0.01;
  $('#chanceTotal').className = ok ? 'chance-ok' : 'chance-bad';
  $('#chanceHint').textContent = ok ? 'Pronto para pescar.' : `Ajuste ${formatChance(Math.abs(100 - rounded))} para chegar a 100%.`;
  $('#chanceHint').className = ok ? 'chance-hint ok' : 'chance-hint';
}

async function loadStatus() {
  const data = await api('/api/status');
  settings = data.settings || {};

  $('#clientId').value = settings.twitch_client_id || '';
  $('#targetChannel').value = settings.target_channel_login || '';
  $('#expectedBotLogin').value = settings.expected_bot_login || 'fishingbotjjj';
  $('#command').value = settings.command || '!pescar';
  $('#cooldown').value = settings.cooldown_seconds || '120';
  $('#fishingSeconds').value = settings.fishing_seconds || '4';
  $('#chatResultEnabled').checked = settings.chat_result_enabled !== '0';
  $('#chatCooldownEnabled').checked = settings.chat_cooldown_enabled !== '0';
  $('#resultTemplate').value = settings.chat_result_template || '@{user} pescou {item} ({raridade}) e ganhou {ouro} de Ouro! 🎣';
  $('#cooldownTemplate').value = settings.chat_cooldown_template || '@{user}, sua linha precisa descansar. Lance novamente em {tempo}. 🎣';

  $('#overlaySound').checked = settings.overlay_sound_enabled !== '0';
  $('#overlayShowImage').checked = settings.overlay_show_image !== '0';
  $('#overlayBg').value = settings.overlay_bg_color || '#07131d';
  $('#overlayText').value = settings.overlay_text_color || '#ffffff';
  $('#overlayAccent').value = settings.overlay_accent_color || '#70e0c5';
  $('#overlayGold').value = settings.overlay_gold_color || '#ffd45f';
  $('#overlayOpacity').value = settings.overlay_opacity || '90';
  $('#overlayX').value = settings.overlay_x || '50';
  $('#overlayY').value = settings.overlay_y || '86';
  $('#overlayScale').value = settings.overlay_scale || '100';
  $('#overlayImageSize').value = settings.overlay_image_size || '72';
  $('#overlayRadius').value = settings.overlay_radius || '16';
  $('#overlayAnimation').value = settings.overlay_animation || 'pop';
  $('#overlayUrl').textContent = data.overlayUrl;

  $('#summaryPlayers').textContent = formatNumber(data.summary?.players || 0);
  $('#summaryCatches').textContent = formatNumber(data.summary?.catches || 0);
  $('#summaryItems').textContent = formatNumber(data.summary?.items || 0);
  $('#quickCommand').textContent = settings.command || '!pescar';
  $('#quickCooldown').textContent = `${settings.cooldown_seconds || 120}s`;

  if (settings.bot_user_name && settings.active_channel_name && settings.active_channel_id !== 'local-test') {
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${settings.bot_user_name} → ${settings.active_channel_name}`;
  }

  updateCooldownExample();
  updateOverlayPreview();
}

function itemRowsHtml() {
  if (!itemCache.length) return '<tr><td colspan="6" class="muted">Nenhum item cadastrado.</td></tr>';
  return itemCache.map((item) => `
    <tr class="item-row" data-id="${item.id}">
      <td class="thumb-cell">${item.image_path ? `<img class="item-thumb" src="${escapeAttr(item.image_path)}" alt="" />` : '<div class="item-thumb placeholder">🎣</div>'}</td>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td><span class="rarity-pill ${rarityClass(item.rarity)}">${escapeHtml(item.rarity)}</span></td>
      <td>${formatChance(item.chance)}</td>
      <td>${formatNumber(item.gold_min)}–${formatNumber(item.gold_max)}</td>
      <td class="actions-cell"><button class="small edit-item" data-id="${item.id}">Editar</button></td>
    </tr>
  `).join('');
}

async function loadItems({ preserveEditor = false } = {}) {
  const data = await api('/api/items');
  itemCache = data.items || [];
  updateChanceSummary(data.chanceTotal);
  $('#itemsBody').innerHTML = itemRowsHtml();
  $$('.edit-item').forEach((button) => button.addEventListener('click', () => openItemEditor(Number(button.dataset.id))));

  if (preserveEditor && (creatingItem || editingItemId)) insertItemEditor();
  updateOverlayPreview();
}

function editorTemplate(item) {
  const currentImage = editorImageData || (!editorRemoveImage ? item?.image_path : '');
  return `
    <tr class="inline-editor-row">
      <td colspan="6">
        <div class="inline-editor">
          <div class="inline-editor-top">
            <div class="image-editor-block">
              <div class="editor-image-preview">${currentImage ? `<img id="editorImagePreview" src="${escapeAttr(currentImage)}" alt="" />` : '<span id="editorImageEmpty">SEM IMAGEM</span>'}</div>
              <div class="image-actions">
                <label class="file-button">Escolher imagem<input id="itemImageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label>
                <button id="removeItemImage" class="small" type="button">Remover</button>
                <span class="muted tiny">Redimensionada automaticamente para até 160×160.</span>
              </div>
            </div>
            <button id="closeInlineEditor" class="icon-button" title="Fechar">×</button>
          </div>

          <div class="inline-fields">
            <div class="field span-2"><label>Nome</label><input id="itemName" value="${escapeAttr(item?.name || '')}" placeholder="Ex.: Sardinha" /></div>
            <div class="field"><label>Raridade</label>
              <select id="itemRarity">
                ${['Lixo','Incomum','Raro','Épico','Lendário','Mítico'].map((rarity) => `<option ${item?.rarity === rarity ? 'selected' : ''}>${rarity}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Chance (%)</label><input id="itemChance" type="number" min="0" max="100" step="0.01" value="${Number(item?.chance || 0)}" /></div>
            <div class="field"><label>Ouro mín.</label><input id="itemGoldMin" type="number" min="0" value="${Number(item?.gold_min ?? 10)}" /></div>
            <div class="field"><label>Ouro máx.</label><input id="itemGoldMax" type="number" min="0" value="${Number(item?.gold_max ?? 20)}" /></div>
          </div>

          <label>Mensagem própria do bot <span class="muted">(opcional)</span></label>
          <textarea id="itemMessageTemplate" rows="2" placeholder="Vazio = usa a mensagem padrão dos Comandos">${escapeHtml(item?.message_template || '')}</textarea>
          <div class="inline-vars"><span>Variáveis:</span> <code>{user}</code> <code>{item}</code> <code>{raridade}</code> <code>{ouro}</code> <code>{ouro_total}</code> <code>{pescarias}</code></div>
          <div class="row compact-row">
            <button id="saveItem" class="primary">Salvar</button>
            ${item ? '<button id="deleteItem" class="danger">Excluir</button>' : ''}
            <button id="cancelItem">Cancelar</button>
          </div>
        </div>
      </td>
    </tr>`;
}

function insertItemEditor() {
  $$('.inline-editor-row').forEach((row) => row.remove());
  const item = editingItemId ? itemCache.find((entry) => Number(entry.id) === Number(editingItemId)) : null;
  const html = editorTemplate(item);
  if (creatingItem) {
    $('#itemsBody').insertAdjacentHTML('afterbegin', html);
  } else {
    const target = $(`.item-row[data-id="${editingItemId}"]`);
    if (target) target.insertAdjacentHTML('afterend', html);
  }
  attachItemEditorEvents(item);
  $('.inline-editor-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openItemEditor(id = null) {
  editingItemId = id;
  creatingItem = !id;
  editorImageData = '';
  editorRemoveImage = false;
  insertItemEditor();
  setTimeout(() => $('#itemName')?.focus(), 60);
}

function closeItemEditor() {
  editingItemId = null;
  creatingItem = false;
  editorImageData = '';
  editorRemoveImage = false;
  $('.inline-editor-row')?.remove();
}

async function compressImage(file) {
  if (!file) return '';
  if (file.size > 8 * 1024 * 1024) throw new Error('Escolha uma imagem de até 8 MB.');
  const bitmap = await createImageBitmap(file);
  const max = 160;
  const scale = Math.min(max / bitmap.width, max / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = max;
  canvas.height = max;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, max, max);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, Math.round((max - width) / 2), Math.round((max - height) / 2), width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

function attachItemEditorEvents(item) {
  $('#closeInlineEditor')?.addEventListener('click', closeItemEditor);
  $('#cancelItem')?.addEventListener('click', closeItemEditor);
  $('#itemImageInput')?.addEventListener('change', async (event) => {
    try {
      editorImageData = await compressImage(event.target.files?.[0]);
      editorRemoveImage = false;
      const box = $('.editor-image-preview');
      box.innerHTML = `<img id="editorImagePreview" src="${escapeAttr(editorImageData)}" alt="" />`;
    } catch (error) { showEvent(error.message); }
  });
  $('#removeItemImage')?.addEventListener('click', () => {
    editorImageData = '';
    editorRemoveImage = true;
    $('.editor-image-preview').innerHTML = '<span id="editorImageEmpty">SEM IMAGEM</span>';
  });
  $('#saveItem')?.addEventListener('click', async () => {
    try {
      const payload = {
        name: $('#itemName').value.trim(),
        rarity: $('#itemRarity').value,
        chance: Number($('#itemChance').value),
        goldMin: Number($('#itemGoldMin').value),
        goldMax: Number($('#itemGoldMax').value),
        messageTemplate: $('#itemMessageTemplate').value.trim(),
        imageData: editorImageData || undefined,
        removeImage: editorRemoveImage
      };
      if (!payload.name) throw new Error('Informe o nome do item.');
      if (payload.goldMax < payload.goldMin) throw new Error('O Ouro máximo não pode ser menor que o mínimo.');

      if (editingItemId) {
        await api(`/api/items/${editingItemId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showEvent(`${payload.name} atualizado.`);
      } else {
        await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
        showEvent(`${payload.name} adicionado.`);
      }
      closeItemEditor();
      await loadItems();
      await loadStatus();
    } catch (error) { showEvent(error.message); }
  });
  $('#deleteItem')?.addEventListener('click', async () => {
    if (!item || !confirm(`Excluir "${item.name}"? O histórico antigo será preservado.`)) return;
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      showEvent(`${item.name} excluído do catálogo.`);
      closeItemEditor();
      await loadItems();
      await loadStatus();
    } catch (error) { showEvent(error.message); }
  });
}

async function loadPlayers() {
  playersCache = await api('/api/players');
  for (const select of [$('#collectionPlayer'), $('#achievementPlayer')]) {
    const previous = select.value;
    select.innerHTML = playersCache.length
      ? playersCache.map((player) => `<option value="${escapeAttr(player.twitch_user_id)}">${escapeHtml(player.display_name || player.login)}</option>`).join('')
      : '<option value="">Nenhum jogador</option>';
    if (playersCache.some((p) => p.twitch_user_id === previous)) select.value = previous;
  }
}

async function loadCollection(userId = $('#collectionPlayer')?.value) {
  if (!userId) {
    $('#collectionGrid').innerHTML = '<div class="empty-state">Ainda não há jogadores com pescarias.</div>';
    $('#collectionCount').textContent = '0 / 0';
    $('#collectionBar').style.width = '0%';
    return;
  }
  const data = await api(`/api/collection?userId=${encodeURIComponent(userId)}`);
  const total = Number(data.summary?.total || 0);
  const discovered = Number(data.summary?.discovered || 0);
  const pct = total ? Math.round((discovered / total) * 100) : 0;
  $('#collectionCount').textContent = `${discovered} / ${total} (${pct}%)`;
  $('#collectionBar').style.width = `${pct}%`;
  $('#collectionGrid').innerHTML = (data.items || []).map((item) => {
    const found = Number(item.quantity || 0) > 0;
    return `<div class="collection-card ${found ? 'found' : 'locked'}">
      <div class="collection-image">${found && item.image_path ? `<img src="${escapeAttr(item.image_path)}" alt="" />` : found ? '🎣' : '?'}</div>
      <div><strong>${found ? escapeHtml(item.name) : '???'}</strong><span class="rarity-pill ${found ? rarityClass(item.rarity) : ''}">${found ? escapeHtml(item.rarity) : 'Não descoberto'}</span></div>
      <b>${found ? `×${formatNumber(item.quantity)}` : ''}</b>
    </div>`;
  }).join('');
}

async function loadAchievements(userId = $('#achievementPlayer')?.value) {
  if (!userId) {
    $('#achievementsGrid').innerHTML = '<div class="empty-state">Ainda não há jogadores.</div>';
    return;
  }
  const data = await api(`/api/achievements?userId=${encodeURIComponent(userId)}`);
  $('#achievementsGrid').innerHTML = data.achievements.map((achievement) => `
    <div class="achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'}">
      <div class="achievement-icon">${achievement.unlocked ? '🏆' : '🔒'}</div>
      <div><strong>${escapeHtml(achievement.name)}</strong><p>${escapeHtml(achievement.description)}</p></div>
    </div>
  `).join('');
}

async function loadRanking() {
  const rows = await api('/api/leaderboard');
  $('#rankingBody').innerHTML = rows.length ? rows.map((row, i) => `
    <tr class="rank-row" data-user-id="${escapeAttr(row.twitch_user_id)}">
      <td>${i + 1}</td><td><strong>${escapeHtml(row.display_name || row.login)}</strong></td><td>${formatNumber(row.gold)}</td><td>${formatNumber(row.total_catches)}</td>
      <td class="actions-cell"><button class="small edit-rank" data-id="${escapeAttr(row.twitch_user_id)}">Editar</button> <button class="small danger reset-rank" data-id="${escapeAttr(row.twitch_user_id)}">Resetar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="muted">Nenhuma pescaria registrada.</td></tr>';

  $$('.edit-rank').forEach((button) => button.addEventListener('click', () => openRankEditor(button.dataset.id, rows)));
  $$('.reset-rank').forEach((button) => button.addEventListener('click', async () => {
    const player = rows.find((entry) => entry.twitch_user_id === button.dataset.id);
    if (!player || !confirm(`Resetar apenas Ouro e Pescarias de ${player.display_name || player.login}? A coleção será mantida.`)) return;
    await api(`/api/leaderboard/${encodeURIComponent(player.twitch_user_id)}/reset`, { method: 'POST', body: '{}' });
    showEvent(`Ranking de ${player.display_name || player.login} resetado.`);
    await refreshPlayerData();
  }));
}

function openRankEditor(userId, rows) {
  editingRankUserId = userId;
  $$('.rank-editor-row').forEach((row) => row.remove());
  const player = rows.find((entry) => entry.twitch_user_id === userId);
  const target = $(`.rank-row[data-user-id="${CSS.escape(userId)}"]`);
  if (!player || !target) return;
  target.insertAdjacentHTML('afterend', `
    <tr class="rank-editor-row"><td colspan="5"><div class="rank-editor-inline">
      <strong>Editando ${escapeHtml(player.display_name || player.login)}</strong>
      <label>Ouro <input id="rankGold" type="number" min="0" value="${Number(player.gold)}" /></label>
      <label>Pescarias <input id="rankCatches" type="number" min="0" value="${Number(player.total_catches)}" /></label>
      <button id="saveRank" class="primary small">Salvar</button><button id="cancelRank" class="small">Cancelar</button>
    </div></td></tr>`);
  $('#cancelRank').addEventListener('click', () => $('.rank-editor-row')?.remove());
  $('#saveRank').addEventListener('click', async () => {
    await api(`/api/leaderboard/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify({
      gold: Number($('#rankGold').value), totalCatches: Number($('#rankCatches').value)
    }) });
    showEvent(`Ranking de ${player.display_name || player.login} atualizado.`);
    await refreshPlayerData();
  });
}

async function refreshPlayerData() {
  await Promise.all([loadRanking(), loadPlayers(), loadStatus()]);
  await loadCollection();
  await loadAchievements();
}

function showEvent(message) { $('#eventLog').textContent = message; }

function updateCooldownExample() {
  if (!$('#cooldownTemplate')) return;
  const tpl = $('#cooldownTemplate').value || '';
  $('#cooldownExample').textContent = tpl
    .replaceAll('{user}', 'JumperJJJ')
    .replaceAll('{tempo}', '1 min 40 s')
    .replaceAll('{item}', 'Sardinha')
    .replaceAll('{raridade}', 'Incomum')
    .replaceAll('{ouro}', '17')
    .replaceAll('{ouro_total}', '2.350')
    .replaceAll('{pescarias}', '91');
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '#000000').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padEnd(6, '0').slice(0, 6);
  const num = parseInt(normalized, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

function overlayControlValues() {
  return {
    bg: $('#overlayBg').value,
    text: $('#overlayText').value,
    accent: $('#overlayAccent').value,
    gold: $('#overlayGold').value,
    opacity: Number($('#overlayOpacity').value),
    x: Number($('#overlayX').value),
    y: Number($('#overlayY').value),
    scale: Number($('#overlayScale').value),
    imageSize: Number($('#overlayImageSize').value),
    radius: Number($('#overlayRadius').value),
    animation: $('#overlayAnimation').value,
    showImage: $('#overlayShowImage').checked
  };
}

function updateOverlayPreview() {
  if (!$('#previewFishingCard')) return;
  const v = overlayControlValues();
  $('#overlayOpacityValue').textContent = `${v.opacity}%`;
  $('#overlayScaleValue').textContent = `${v.scale}%`;
  $('#overlayImageSizeValue').textContent = `${v.imageSize}px`;
  $('#overlayRadiusValue').textContent = `${v.radius}px`;
  $('#overlayXValue').textContent = `${v.x}%`;
  $('#overlayYValue').textContent = `${v.y}%`;

  const card = $('#previewFishingCard');
  card.style.left = `${v.x}%`;
  card.style.top = `${v.y}%`;
  card.style.transform = `translate(-50%, -50%) scale(${v.scale / 100})`;
  card.style.background = hexToRgba(v.bg, v.opacity / 100);
  card.style.color = v.text;
  card.style.borderColor = `${v.accent}77`;
  card.style.borderRadius = `${v.radius}px`;
  card.dataset.animation = v.animation;
  $('.preview-rarity').style.color = v.accent;
  $('.preview-gold').style.color = v.gold;

  const img = $('#previewItemImage');
  img.style.width = `${v.imageSize}px`;
  img.style.height = `${v.imageSize}px`;
  const sample = itemCache.find((item) => item.image_path)?.image_path || '';
  if (v.showImage && sample) {
    img.src = sample;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }
}

$$('.nav').forEach((button) => button.addEventListener('click', async () => {
  $$('.nav').forEach((x) => x.classList.remove('active'));
  $$('.page').forEach((x) => x.classList.remove('active'));
  button.classList.add('active');
  $(`#page-${button.dataset.page}`).classList.add('active');
  if (button.dataset.page === 'items') await loadItems();
  if (button.dataset.page === 'ranking') await loadRanking();
  if (button.dataset.page === 'collection') { await loadPlayers(); await loadCollection(); }
  if (button.dataset.page === 'achievements') { await loadPlayers(); await loadAchievements(); }
  if (button.dataset.page === 'overlay') updateOverlayPreview();
}));

$('#newItem').addEventListener('click', () => openItemEditor());
$('#collectionPlayer').addEventListener('change', () => loadCollection());
$('#achievementPlayer').addEventListener('change', () => loadAchievements());
$('#cooldownTemplate').addEventListener('input', updateCooldownExample);

$('#saveCommandSettings').addEventListener('click', async () => {
  const data = await api('/api/settings', { method: 'POST', body: JSON.stringify({
    command: $('#command').value.trim() || '!pescar',
    chat_result_enabled: $('#chatResultEnabled').checked ? '1' : '0',
    chat_cooldown_enabled: $('#chatCooldownEnabled').checked ? '1' : '0',
    chat_result_template: $('#resultTemplate').value.trim(),
    chat_cooldown_template: $('#cooldownTemplate').value.trim()
  }) });
  settings = data.settings;
  $('#quickCommand').textContent = settings.command;
  showEvent('Comandos e mensagens salvos.');
});

$('#saveGameSettings').addEventListener('click', async () => {
  const data = await api('/api/settings', { method: 'POST', body: JSON.stringify({
    cooldown_seconds: $('#cooldown').value,
    fishing_seconds: $('#fishingSeconds').value
  }) });
  settings = data.settings;
  $('#quickCooldown').textContent = `${settings.cooldown_seconds}s`;
  showEvent('Configurações do jogo salvas.');
});

$('#testFish').addEventListener('click', async () => {
  showEvent('Pescador Teste está pescando…');
  try {
    const result = await api('/api/test-fish', { method: 'POST', body: '{}' });
    if (result.ok) showEvent(`${result.user.displayName} pescou ${result.item.name} (${result.item.rarity}) e ganhou ${result.item.goldAwarded} de Ouro.`);
    await refreshPlayerData();
  } catch (error) { showEvent(error.message); }
});

$('#copyOverlay').addEventListener('click', async () => {
  const url = await window.desktop.copyOverlayUrl();
  showEvent(`URL copiada: ${url}`);
});
$('#openOverlay').addEventListener('click', () => window.desktop.openExternal($('#overlayUrl').textContent));

const overlayInputs = ['#overlayBg','#overlayText','#overlayAccent','#overlayGold','#overlayOpacity','#overlayX','#overlayY','#overlayScale','#overlayImageSize','#overlayRadius','#overlayAnimation','#overlayShowImage'];
overlayInputs.forEach((selector) => $(selector).addEventListener('input', updateOverlayPreview));

$('#resetOverlay').addEventListener('click', () => {
  $('#overlayBg').value = '#07131d'; $('#overlayText').value = '#ffffff'; $('#overlayAccent').value = '#70e0c5'; $('#overlayGold').value = '#ffd45f';
  $('#overlayOpacity').value = 90; $('#overlayX').value = 50; $('#overlayY').value = 86; $('#overlayScale').value = 100; $('#overlayImageSize').value = 72; $('#overlayRadius').value = 16; $('#overlayAnimation').value = 'pop'; $('#overlayShowImage').checked = true;
  updateOverlayPreview();
});

$('#saveOverlaySettings').addEventListener('click', async () => {
  const v = overlayControlValues();
  const data = await api('/api/settings', { method: 'POST', body: JSON.stringify({
    overlay_sound_enabled: $('#overlaySound').checked ? '1' : '0',
    overlay_show_image: v.showImage ? '1' : '0',
    overlay_bg_color: v.bg,
    overlay_text_color: v.text,
    overlay_accent_color: v.accent,
    overlay_gold_color: v.gold,
    overlay_opacity: String(v.opacity),
    overlay_x: String(v.x),
    overlay_y: String(v.y),
    overlay_scale: String(v.scale),
    overlay_image_size: String(v.imageSize),
    overlay_radius: String(v.radius),
    overlay_animation: v.animation
  }) });
  settings = data.settings;
  showEvent('Overlay salvo.');
});

$('#connectTwitch').addEventListener('click', async () => {
  try {
    const clientId = $('#clientId').value.trim();
    const targetChannelLogin = $('#targetChannel').value.trim().replace(/^@/, '');
    const expectedBotLogin = $('#expectedBotLogin').value.trim().replace(/^@/, '').toLowerCase();
    if (!clientId) throw new Error('Informe o Client ID da aplicação Twitch.');
    if (!targetChannelLogin) throw new Error('Informe o canal da live.');
    if (!expectedBotLogin) throw new Error('Informe a conta do bot esperada.');

    await api('/api/settings', { method: 'POST', body: JSON.stringify({ twitch_client_id: clientId, target_channel_login: targetChannelLogin, expected_bot_login: expectedBotLogin }) });
    const device = await api('/api/twitch/device', { method: 'POST', body: JSON.stringify({ clientId }) });
    $('#deviceBox').classList.remove('hidden');
    $('#deviceCode').textContent = device.user_code;
    $('#openTwitchAuth').onclick = () => window.desktop.openExternal(device.verification_uri);
    $('#deviceProgress').textContent = `Autorize a conta ${expectedBotLogin}. Aguardando…`;
    window.desktop.openExternal(device.verification_uri);
    const result = await window.desktop.completeTwitchDeviceAuth({
      clientId, deviceCode: device.device_code, interval: device.interval, expiresIn: device.expires_in, targetChannelLogin
    });
    $('#deviceProgress').textContent = 'Autorizado!';
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${result.identity.bot.display_name} → ${result.identity.channel.display_name}`;
    showEvent(`Conectado: ${result.identity.bot.display_name} está ouvindo ${result.identity.channel.display_name}.`);
  } catch (error) {
    $('#deviceProgress').textContent = error.message;
    showEvent(error.message);
  }
});

const ws = new WebSocket(`ws://${location.host}/ws`);
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'fishing:start') showEvent(`${data.user.displayName} está pescando…`);
  if (data.type === 'fishing:result') {
    showEvent(`${data.user.displayName} pescou ${data.item.name} (${data.item.rarity}) • +${data.item.goldAwarded} Ouro • total ${data.player.gold}`);
    refreshPlayerData();
  }
  if (data.type === 'fishing:cooldown') showEvent(`${data.user.displayName}: aguarde ${data.remainingSeconds}s.`);
  if (data.type === 'fishing:error') showEvent(data.message);
  if (data.type === 'twitch:error') showEvent(data.message);
  if (data.type === 'twitch:connected') {
    $('#twitchStatus').className = 'status online';
    $('#twitchStatus').textContent = `● Bot ${data.identity.bot.display_name} → ${data.identity.channel.display_name}`;
  }
  if (data.type === 'settings:updated') settings = data.settings || settings;
});

Promise.all([loadStatus(), loadItems(), loadPlayers(), loadRanking()]).then(async () => {
  await loadCollection();
  await loadAchievements();
  updateOverlayPreview();
}).catch((error) => showEvent(error.message));
