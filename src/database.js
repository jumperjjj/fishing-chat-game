const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_ITEMS = [
  { name: 'Sardinha', rarity: 'Incomum', chance: 30, goldMin: 10, goldMax: 20 },
  { name: 'Tilápia', rarity: 'Incomum', chance: 25, goldMin: 15, goldMax: 30 },
  { name: 'Bota Velha', rarity: 'Lixo', chance: 20, goldMin: 1, goldMax: 5 },
  { name: 'Baiacu', rarity: 'Incomum', chance: 12, goldMin: 50, goldMax: 90 },
  { name: 'Lula', rarity: 'Raro', chance: 7, goldMin: 150, goldMax: 300 },
  { name: 'Peixe-Lua', rarity: 'Épico', chance: 4, goldMin: 800, goldMax: 1200 },
  { name: 'Tubarão Dourado', rarity: 'Lendário', chance: 1.5, goldMin: 8000, goldMax: 12000 },
  { name: 'Leviatã', rarity: 'Mítico', chance: 0.5, goldMin: 50000, goldMax: 100000 }
];

class GameDatabase {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.dbPath = path.join(userDataPath, 'fishing-game.db');
    this.imagesPath = path.join(userDataPath, 'item-images');
    fs.mkdirSync(this.imagesPath, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seed();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        login TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS players (
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        login TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        gold INTEGER NOT NULL DEFAULT 0,
        total_catches INTEGER NOT NULL DEFAULT 0,
        last_fished_at INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, twitch_user_id)
      );

      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'Peixe',
        rarity TEXT NOT NULL DEFAULT 'Incomum',
        weight INTEGER NOT NULL DEFAULT 100,
        gold INTEGER NOT NULL DEFAULT 0,
        image_path TEXT NOT NULL DEFAULT '',
        counts_for_collection INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        chance REAL NOT NULL DEFAULT 0,
        gold_min INTEGER NOT NULL DEFAULT 0,
        gold_max INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        message_template TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS catches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        gold_awarded INTEGER NOT NULL,
        caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS collection (
        channel_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        first_caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, twitch_user_id, item_id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      );
    `);

    const columns = new Set(this.db.prepare('PRAGMA table_info(items)').all().map((row) => row.name));
    const addColumn = (name, sql) => {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE items ADD COLUMN ${sql};`);
    };
    addColumn('chance', 'chance REAL NOT NULL DEFAULT 0');
    addColumn('gold_min', 'gold_min INTEGER NOT NULL DEFAULT 0');
    addColumn('gold_max', 'gold_max INTEGER NOT NULL DEFAULT 0');
    addColumn('deleted', 'deleted INTEGER NOT NULL DEFAULT 0');
    addColumn('message_template', "message_template TEXT NOT NULL DEFAULT ''");

    const items = this.db.prepare('SELECT id, name, rarity, weight, gold, chance, gold_min, gold_max FROM items').all();
    if (items.length) {
      const chanceTotal = items.reduce((sum, item) => sum + Number(item.chance || 0), 0);
      if (chanceTotal <= 0.0001) {
        const defaultByName = new Map(DEFAULT_ITEMS.map((item) => [item.name, item]));
        const looksLikeOldSeed = items.length === DEFAULT_ITEMS.length && items.every((item) => defaultByName.has(item.name));
        const updateChance = this.db.prepare('UPDATE items SET chance = ? WHERE id = ?');

        if (looksLikeOldSeed) {
          const updateDefault = this.db.prepare('UPDATE items SET chance = ?, gold_min = ?, gold_max = ?, rarity = ? WHERE id = ?');
          for (const item of items) {
            const preset = defaultByName.get(item.name);
            updateDefault.run(preset.chance, preset.goldMin, preset.goldMax, preset.rarity, item.id);
          }
        } else {
          const totalWeight = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0);
          for (const item of items) {
            const chance = totalWeight > 0 ? (Math.max(0, Number(item.weight || 0)) / totalWeight) * 100 : 0;
            updateChance.run(Math.round(chance * 100) / 100, item.id);
          }
        }
      }

      const updateGoldRange = this.db.prepare(`
        UPDATE items SET
          gold_min = CASE WHEN gold_min = 0 THEN gold ELSE gold_min END,
          gold_max = CASE WHEN gold_max = 0 THEN gold ELSE gold_max END
        WHERE id = ?
      `);
      for (const item of items) updateGoldRange.run(item.id);

      // v0.3.0: removemos a raridade "Comum" do editor.
      // Preservamos conteúdo personalizado, mas migramos o seed antigo para uma classificação válida.
      const oldDefaultNames = new Set(DEFAULT_ITEMS.map((item) => item.name));
      const updateRarity = this.db.prepare('UPDATE items SET rarity = ? WHERE id = ?');
      for (const item of items) {
        if (item.rarity === 'Comum' && oldDefaultNames.has(item.name)) {
          const preset = DEFAULT_ITEMS.find((entry) => entry.name === item.name);
          updateRarity.run(preset?.rarity || 'Incomum', item.id);
        }
      }
    }
  }

  seed() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM items').get().count;
    if (count === 0) {
      const insert = this.db.prepare(`
        INSERT INTO items (name, rarity, chance, gold_min, gold_max, type, weight, gold, enabled, deleted)
        VALUES (?, ?, ?, ?, ?, 'Peixe', 0, ?, 1, 0)
      `);
      for (const item of DEFAULT_ITEMS) {
        insert.run(item.name, item.rarity, item.chance, item.goldMin, item.goldMax, item.goldMin);
      }
    }

    const defaults = {
      command: '!pescar',
      cooldown_seconds: '120',
      fishing_seconds: '4',
      overlay_enabled: '1',
      overlay_sound_enabled: '1',
      overlay_show_image: '1',
      overlay_bg_color: '#07131d',
      overlay_text_color: '#ffffff',
      overlay_accent_color: '#70e0c5',
      overlay_gold_color: '#ffd45f',
      overlay_opacity: '90',
      overlay_x: '50',
      overlay_y: '86',
      overlay_scale: '100',
      overlay_image_size: '72',
      overlay_radius: '16',
      overlay_animation: 'pop',
      chat_result_enabled: '1',
      chat_cooldown_enabled: '1',
      chat_result_template: '@{user} pescou {item} ({raridade}) e ganhou {ouro} de Ouro! 🎣',
      chat_cooldown_template: '@{user}, sua linha precisa descansar. Lance novamente em {tempo}. 🎣',
      twitch_client_id: '',
      target_channel_login: '',
      expected_bot_login: 'fishingbotjjj',
      bot_user_id: '',
      bot_user_login: '',
      bot_user_name: '',
      active_channel_id: 'local-test',
      active_channel_login: 'modo_teste',
      active_channel_name: 'Modo Teste'
    };

    const insertSetting = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);
  }

  getImagesPath() { return this.imagesPath; }

  getSetting(key, fallback = '') {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  listItems() {
    return this.db.prepare(`
      SELECT id, name, rarity, chance, gold_min, gold_max, image_path, message_template, counts_for_collection, created_at
      FROM items
      WHERE deleted = 0
      ORDER BY id ASC
    `).all();
  }

  getFishingItems() {
    return this.db.prepare(`
      SELECT id, name, rarity, chance, gold_min, gold_max, image_path, message_template, counts_for_collection
      FROM items
      WHERE deleted = 0 AND chance > 0
      ORDER BY id ASC
    `).all();
  }

  getChanceTotal() {
    const row = this.db.prepare('SELECT COALESCE(SUM(chance), 0) AS total FROM items WHERE deleted = 0').get();
    return Number(row.total || 0);
  }

  addItem(item) {
    const chance = this.normalizeChance(item.chance);
    const { min, max } = this.normalizeGoldRange(item.goldMin, item.goldMax);
    const result = this.db.prepare(`
      INSERT INTO items (name, rarity, chance, gold_min, gold_max, type, weight, gold, image_path, message_template, counts_for_collection, enabled, deleted)
      VALUES (?, ?, ?, ?, ?, 'Peixe', 0, ?, '', ?, 1, 1, 0)
    `).run(
      String(item.name || '').trim(),
      this.normalizeRarity(item.rarity),
      chance,
      min,
      max,
      min,
      String(item.messageTemplate || '').trim()
    );
    const id = Number(result.lastInsertRowid);
    if (item.imageData) this.saveItemImage(id, item.imageData);
    return id;
  }

  updateItem(id, item) {
    const itemId = Number(id);
    const chance = this.normalizeChance(item.chance);
    const { min, max } = this.normalizeGoldRange(item.goldMin, item.goldMax);
    this.db.prepare(`
      UPDATE items SET
        name = ?, rarity = ?, chance = ?, gold_min = ?, gold_max = ?, gold = ?, message_template = ?
      WHERE id = ? AND deleted = 0
    `).run(
      String(item.name || '').trim(),
      this.normalizeRarity(item.rarity),
      chance,
      min,
      max,
      min,
      String(item.messageTemplate || '').trim(),
      itemId
    );
    if (item.removeImage) this.removeItemImage(itemId);
    if (item.imageData) this.saveItemImage(itemId, item.imageData);
  }

  normalizeRarity(value) {
    const allowed = new Set(['Lixo', 'Incomum', 'Raro', 'Épico', 'Lendário', 'Mítico']);
    return allowed.has(value) ? value : 'Incomum';
  }

  deleteItem(id) {
    this.db.prepare('UPDATE items SET deleted = 1, chance = 0, enabled = 0 WHERE id = ?').run(Number(id));
  }

  normalizeChance(value) {
    const chance = Number(value);
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) throw new Error('A chance precisa estar entre 0% e 100%.');
    return Math.round(chance * 100) / 100;
  }

  normalizeGoldRange(minValue, maxValue) {
    const min = Math.max(0, Math.floor(Number(minValue) || 0));
    const max = Math.max(0, Math.floor(Number(maxValue) || 0));
    if (max < min) throw new Error('O Ouro máximo não pode ser menor que o Ouro mínimo.');
    return { min, max };
  }

  saveItemImage(itemId, dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/(?:webp|png|jpeg));base64,(.+)$/);
    if (!match) throw new Error('Imagem inválida. Use PNG, JPG ou WEBP.');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 700 * 1024) throw new Error('A imagem processada precisa ter no máximo 700 KB.');

    const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'webp';
    const previous = this.db.prepare('SELECT image_path FROM items WHERE id = ?').get(Number(itemId));
    const filename = `item-${Number(itemId)}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(this.imagesPath, filename), buffer);
    this.db.prepare('UPDATE items SET image_path = ? WHERE id = ?').run(`/item-images/${filename}`, Number(itemId));
    this.deleteImageFile(previous?.image_path);
    return `/item-images/${filename}`;
  }

  removeItemImage(itemId) {
    const previous = this.db.prepare('SELECT image_path FROM items WHERE id = ?').get(Number(itemId));
    this.db.prepare("UPDATE items SET image_path = '' WHERE id = ?").run(Number(itemId));
    this.deleteImageFile(previous?.image_path);
  }

  deleteImageFile(webPath) {
    const filename = String(webPath || '').split('/').pop();
    if (!filename) return;
    const fullPath = path.join(this.imagesPath, filename);
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {}
  }

  ensurePlayer(channelId, user) {
    this.db.prepare(`
      INSERT INTO players (channel_id, twitch_user_id, login, display_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, twitch_user_id) DO UPDATE SET
        login = excluded.login,
        display_name = excluded.display_name,
        updated_at = CURRENT_TIMESTAMP
    `).run(channelId, user.id, user.login || '', user.displayName || user.login || '');
    return this.getPlayer(channelId, user.id);
  }

  getPlayer(channelId, userId) {
    return this.db.prepare('SELECT * FROM players WHERE channel_id = ? AND twitch_user_id = ?').get(channelId, userId);
  }

  listPlayers(channelId) {
    return this.db.prepare(`
      SELECT twitch_user_id, login, display_name, gold, total_catches, last_fished_at
      FROM players WHERE channel_id = ?
      ORDER BY gold DESC, total_catches DESC, display_name COLLATE NOCASE ASC
    `).all(channelId);
  }

  markFishingStarted(channelId, user) {
    this.ensurePlayer(channelId, user);
    const now = Date.now();
    this.db.prepare(`
      UPDATE players SET last_fished_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(now, channelId, user.id);
    return now;
  }

  applyCatch(channelId, user, item, goldAwarded) {
    this.ensurePlayer(channelId, user);
    this.db.prepare(`
      UPDATE players
      SET gold = gold + ?, total_catches = total_catches + 1, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(goldAwarded, channelId, user.id);

    this.db.prepare('INSERT INTO catches (channel_id, twitch_user_id, item_id, gold_awarded) VALUES (?, ?, ?, ?)')
      .run(channelId, user.id, item.id, goldAwarded);

    if (item.counts_for_collection) {
      this.db.prepare(`
        INSERT INTO collection (channel_id, twitch_user_id, item_id, quantity)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(channel_id, twitch_user_id, item_id) DO UPDATE SET
          quantity = quantity + 1,
          last_caught_at = CURRENT_TIMESTAMP
      `).run(channelId, user.id, item.id);
    }
    return this.getPlayer(channelId, user.id);
  }

  getLeaderboard(channelId, limit = 100) {
    return this.db.prepare(`
      SELECT twitch_user_id, login, display_name, gold, total_catches
      FROM players WHERE channel_id = ?
      ORDER BY gold DESC, total_catches DESC
      LIMIT ?
    `).all(channelId, Number(limit));
  }

  updatePlayerStats(channelId, userId, stats) {
    const gold = Math.max(0, Math.floor(Number(stats.gold) || 0));
    const totalCatches = Math.max(0, Math.floor(Number(stats.totalCatches) || 0));
    this.db.prepare(`
      UPDATE players SET gold = ?, total_catches = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(gold, totalCatches, channelId, userId);
    return this.getPlayer(channelId, userId);
  }

  resetPlayerRank(channelId, userId) {
    this.db.prepare(`
      UPDATE players SET gold = 0, total_catches = 0, last_fished_at = 0, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(channelId, userId);
    return this.getPlayer(channelId, userId);
  }

  getCollection(channelId, userId) {
    return this.db.prepare(`
      SELECT i.id, i.name, i.rarity, i.image_path, i.chance, i.gold_min, i.gold_max,
             COALESCE(c.quantity, 0) AS quantity, c.first_caught_at, c.last_caught_at
      FROM items i
      LEFT JOIN collection c
        ON c.item_id = i.id AND c.channel_id = ? AND c.twitch_user_id = ?
      WHERE i.deleted = 0
      ORDER BY i.id ASC
    `).all(channelId, userId);
  }

  getCollectionSummary(channelId, userId) {
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM items WHERE deleted = 0 AND counts_for_collection = 1').get().count;
    const discovered = this.db.prepare(`
      SELECT COUNT(*) AS count FROM collection c
      JOIN items i ON i.id = c.item_id
      WHERE c.channel_id = ? AND c.twitch_user_id = ? AND c.quantity > 0 AND i.deleted = 0 AND i.counts_for_collection = 1
    `).get(channelId, userId).count;
    return { total: Number(total), discovered: Number(discovered) };
  }

  getAchievements(channelId, userId) {
    const player = this.getPlayer(channelId, userId) || { gold: 0, total_catches: 0 };
    const summary = this.getCollectionSummary(channelId, userId);
    const pct = summary.total ? (summary.discovered / summary.total) * 100 : 0;
    const defs = [
      ['primeira', 'Primeira Pescaria', 'Faça sua primeira pescaria.', player.total_catches >= 1],
      ['amador', 'Pescador Amador', 'Complete 50 pescarias.', player.total_catches >= 50],
      ['profissional', 'Pescador Profissional', 'Complete 250 pescarias.', player.total_catches >= 250],
      ['veterano', 'Pescador Veterano', 'Complete 1.000 pescarias.', player.total_catches >= 1000],
      ['rico', 'Baú de Ouro', 'Acumule 10.000 de Ouro.', player.gold >= 10000],
      ['colecionador25', 'Colecionador I', 'Descubra 25% da coleção.', pct >= 25],
      ['colecionador50', 'Colecionador II', 'Descubra 50% da coleção.', pct >= 50],
      ['mestre', 'Mestre da Coleção', 'Complete 100% da coleção.', summary.total > 0 && summary.discovered >= summary.total]
    ];
    return { player, summary, achievements: defs.map(([id, name, description, unlocked]) => ({ id, name, description, unlocked })) };
  }

  close() { this.db.close(); }
}

module.exports = { GameDatabase };
