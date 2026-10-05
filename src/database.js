const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_ITEMS = [
  { name: 'Sardinha', type: 'Peixe', rarity: 'Comum', weight: 1000, gold: 10 },
  { name: 'Tilápia', type: 'Peixe', rarity: 'Comum', weight: 800, gold: 20 },
  { name: 'Bota Velha', type: 'Lixo', rarity: 'Comum', weight: 450, gold: 2 },
  { name: 'Baiacu', type: 'Peixe', rarity: 'Incomum', weight: 280, gold: 75 },
  { name: 'Lula', type: 'Peixe', rarity: 'Raro', weight: 90, gold: 200 },
  { name: 'Peixe-Lua', type: 'Peixe', rarity: 'Épico', weight: 30, gold: 1000 },
  { name: 'Tubarão Dourado', type: 'Peixe', rarity: 'Lendário', weight: 4, gold: 10000 },
  { name: 'Leviatã', type: 'Criatura', rarity: 'Mítico', weight: 1, gold: 100000 }
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
  }

  seed() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM items').get().count;
    if (count === 0) {
      const insert = this.db.prepare(`
        INSERT INTO items (name, type, rarity, weight, gold)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of DEFAULT_ITEMS) {
        insert.run(item.name, item.type, item.rarity, item.weight, item.gold);
      }
    }

    const defaults = {
      command: '!pescar',
      cooldown_seconds: '120',
      fishing_seconds: '4',
      overlay_enabled: '1',
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
    return this.db.prepare('SELECT * FROM items ORDER BY id ASC').all();
  }

  getEnabledItems() {
    return this.db.prepare('SELECT * FROM items WHERE enabled = 1 AND weight > 0 ORDER BY id ASC').all();
  }

  addItem(item) {
    const result = this.db.prepare(`
      INSERT INTO items (name, type, rarity, weight, gold, image_path, counts_for_collection, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.name,
      item.type || 'Peixe',
      item.rarity || 'Comum',
      Math.max(1, Number(item.weight) || 1),
      Number(item.gold) || 0,
      item.image_path || '',
      item.counts_for_collection === false ? 0 : 1,
      item.enabled === false ? 0 : 1
    );
    return Number(result.lastInsertRowid);
  }

  updateItem(id, item) {
    this.db.prepare(`
      UPDATE items SET
        name = ?, type = ?, rarity = ?, weight = ?, gold = ?,
        image_path = ?, counts_for_collection = ?, enabled = ?
      WHERE id = ?
    `).run(
      item.name,
      item.type || 'Peixe',
      item.rarity || 'Comum',
      Math.max(1, Number(item.weight) || 1),
      Number(item.gold) || 0,
      item.image_path || '',
      item.counts_for_collection === false ? 0 : 1,
      item.enabled === false ? 0 : 1,
      Number(id)
    );
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

  applyCatch(channelId, user, item) {
    this.ensurePlayer(channelId, user);

    this.db.prepare(`
      UPDATE players
      SET gold = gold + ?, total_catches = total_catches + 1, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND twitch_user_id = ?
    `).run(item.gold, channelId, user.id);

    this.db.prepare(`
      INSERT INTO catches (channel_id, twitch_user_id, item_id, gold_awarded)
      VALUES (?, ?, ?, ?)
    `).run(channelId, user.id, item.id, item.gold);

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
      SELECT i.id, i.name, i.type, i.rarity, c.quantity, c.first_caught_at, c.last_caught_at
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
