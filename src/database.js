const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_ITEMS = [
  { name: 'Sardinha', rarity: 'Comum', chance: 30, goldMin: 10, goldMax: 20 },
  { name: 'Tilápia', rarity: 'Comum', chance: 25, goldMin: 15, goldMax: 30 },
  { name: 'Bota Velha', rarity: 'Comum', chance: 20, goldMin: 1, goldMax: 5 },
  { name: 'Baiacu', rarity: 'Incomum', chance: 12, goldMin: 50, goldMax: 90 },
  { name: 'Lula', rarity: 'Raro', chance: 7, goldMin: 150, goldMax: 300 },
  { name: 'Peixe-Lua', rarity: 'Épico', chance: 4, goldMin: 800, goldMax: 1200 },
  { name: 'Tubarão Dourado', rarity: 'Lendário', chance: 1.5, goldMin: 8000, goldMax: 12000 },
  { name: 'Leviatã', rarity: 'Mítico', chance: 0.5, goldMin: 50000, goldMax: 100000 }
];

class GameDatabase {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'fishing-game.db');
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
        rarity TEXT NOT NULL DEFAULT 'Comum',
        weight INTEGER NOT NULL DEFAULT 100,
        gold INTEGER NOT NULL DEFAULT 0,
        image_path TEXT NOT NULL DEFAULT '',
        counts_for_collection INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        chance REAL NOT NULL DEFAULT 0,
        gold_min INTEGER NOT NULL DEFAULT 0,
        gold_max INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
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

    // Migração para bancos criados nas versões 0.1.x.
    const columns = new Set(this.db.prepare('PRAGMA table_info(items)').all().map((row) => row.name));
    const addColumn = (name, sql) => {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE items ADD COLUMN ${sql};`);
    };
    addColumn('chance', 'chance REAL NOT NULL DEFAULT 0');
    addColumn('gold_min', 'gold_min INTEGER NOT NULL DEFAULT 0');
    addColumn('gold_max', 'gold_max INTEGER NOT NULL DEFAULT 0');
    addColumn('deleted', 'deleted INTEGER NOT NULL DEFAULT 0');

    const items = this.db.prepare('SELECT id, name, weight, gold, chance, gold_min, gold_max FROM items').all();
    if (items.length) {
      const chanceTotal = items.reduce((sum, item) => sum + Number(item.chance || 0), 0);
      if (chanceTotal <= 0.0001) {
        const defaultByName = new Map(DEFAULT_ITEMS.map((item) => [item.name, item]));
        const looksLikeOldSeed = items.length === DEFAULT_ITEMS.length && items.every((item) => defaultByName.has(item.name));
        const updateChance = this.db.prepare('UPDATE items SET chance = ? WHERE id = ?');

        if (looksLikeOldSeed) {
          // A v0.1.x usava pesos e gerava números como 37,665%. Ao migrar o catálogo padrão,
          // trocamos pelos percentuais simples da v0.2.0.
          const updateDefault = this.db.prepare('UPDATE items SET chance = ?, gold_min = ?, gold_max = ? WHERE id = ?');
          for (const item of items) {
            const preset = defaultByName.get(item.name);
            updateDefault.run(preset.chance, preset.goldMin, preset.goldMax, item.id);
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
      chat_result_enabled: '1',
      twitch_client_id: '',
      target_channel_login: '',
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
      SELECT id, name, rarity, chance, gold_min, gold_max, image_path, counts_for_collection, created_at
      FROM items
      WHERE deleted = 0
      ORDER BY id ASC
    `).all();
  }

  getFishingItems() {
    return this.db.prepare(`
      SELECT id, name, rarity, chance, gold_min, gold_max, image_path, counts_for_collection
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
      INSERT INTO items (name, rarity, chance, gold_min, gold_max, type, weight, gold, image_path, counts_for_collection, enabled, deleted)
      VALUES (?, ?, ?, ?, ?, 'Peixe', 0, ?, ?, 1, 1, 0)
    `).run(
      String(item.name || '').trim(),
      item.rarity || 'Comum',
      chance,
      min,
      max,
      min,
      item.image_path || ''
    );
    return Number(result.lastInsertRowid);
  }

  updateItem(id, item) {
    const chance = this.normalizeChance(item.chance);
    const { min, max } = this.normalizeGoldRange(item.goldMin, item.goldMax);
    this.db.prepare(`
      UPDATE items SET
        name = ?, rarity = ?, chance = ?, gold_min = ?, gold_max = ?, gold = ?, image_path = ?
      WHERE id = ? AND deleted = 0
    `).run(
      String(item.name || '').trim(),
      item.rarity || 'Comum',
      chance,
      min,
      max,
      min,
      item.image_path || '',
      Number(id)
    );
  }

  deleteItem(id) {
    this.db.prepare('UPDATE items SET deleted = 1, chance = 0, enabled = 0 WHERE id = ?').run(Number(id));
  }

  normalizeChance(value) {
    const chance = Number(value);
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) {
      throw new Error('A chance precisa estar entre 0% e 100%.');
    }
    return Math.round(chance * 100) / 100;
  }

  normalizeGoldRange(minValue, maxValue) {
    const min = Math.max(0, Math.floor(Number(minValue) || 0));
    const max = Math.max(0, Math.floor(Number(maxValue) || 0));
    if (max < min) throw new Error('O Ouro máximo não pode ser menor que o Ouro mínimo.');
    return { min, max };
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
    return this.db.prepare(`
      SELECT * FROM players WHERE channel_id = ? AND twitch_user_id = ?
    `).get(channelId, userId);
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

    this.db.prepare(`
      INSERT INTO catches (channel_id, twitch_user_id, item_id, gold_awarded)
      VALUES (?, ?, ?, ?)
    `).run(channelId, user.id, item.id, goldAwarded);

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

  getLeaderboard(channelId, limit = 10) {
    return this.db.prepare(`
      SELECT twitch_user_id, login, display_name, gold, total_catches
      FROM players WHERE channel_id = ?
      ORDER BY gold DESC, total_catches DESC
      LIMIT ?
    `).all(channelId, Number(limit));
  }

  getCollection(channelId, userId) {
    return this.db.prepare(`
      SELECT i.id, i.name, i.rarity, c.quantity, c.first_caught_at, c.last_caught_at
      FROM collection c
      JOIN items i ON i.id = c.item_id
      WHERE c.channel_id = ? AND c.twitch_user_id = ?
      ORDER BY i.id ASC
    `).all(channelId, userId);
  }

  close() {
    this.db.close();
  }
}

module.exports = { GameDatabase };
