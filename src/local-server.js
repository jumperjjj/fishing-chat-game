const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

class LocalServer {
  constructor({ database, port = 8766 }) {
    this.db = database;
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.engine = null;
    this.twitch = null;

    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.registerRoutes();
  }

  setEngine(engine) { this.engine = engine; }
  setTwitch(twitch) { this.twitch = twitch; }

  broadcast(data) {
    const json = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(json);
    }
  }

  registerRoutes() {
    this.app.get('/api/status', (_req, res) => {
      const settings = this.db.getSettings();
      res.json({
        ok: true,
        version: '0.1.0',
        overlayUrl: `http://127.0.0.1:${this.port}/overlay.html`,
        settings
      });
    });

    this.app.get('/api/items', (_req, res) => {
      const items = this.db.listItems();
      const withChance = this.engine ? this.engine.getChanceMap(items.filter((i) => i.enabled)) : items;
      const chanceById = new Map(withChance.map((item) => [item.id, item.chance]));
      res.json(items.map((item) => ({ ...item, chance: chanceById.get(item.id) || 0 })));
    });

    this.app.post('/api/items', (req, res) => {
      if (!req.body?.name) return res.status(400).json({ error: 'Nome é obrigatório.' });
      const id = this.db.addItem(req.body);
      res.json({ ok: true, id });
    });

    this.app.put('/api/items/:id', (req, res) => {
      if (!req.body?.name) return res.status(400).json({ error: 'Nome é obrigatório.' });
      this.db.updateItem(req.params.id, req.body);
      res.json({ ok: true });
    });

    this.app.post('/api/settings', (req, res) => {
      const allowed = ['command', 'cooldown_seconds', 'fishing_seconds', 'overlay_enabled', 'twitch_client_id'];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) this.db.setSetting(key, req.body[key]);
      }
      res.json({ ok: true, settings: this.db.getSettings() });
    });

    this.app.post('/api/test-fish', async (req, res) => {
      if (!this.engine) return res.status(503).json({ error: 'Motor não iniciado.' });
      const settings = this.db.getSettings();
      const user = {
        id: req.body?.userId || 'test-user',
        login: req.body?.login || 'pescador_teste',
        displayName: req.body?.displayName || 'Pescador Teste'
      };
      const result = await this.engine.fish({
        channelId: settings.active_channel_id || 'local-test',
        user,
        bypassCooldown: true
      });
      res.json(result);
    });

    this.app.get('/api/leaderboard', (_req, res) => {
      const channelId = this.db.getSetting('active_channel_id', 'local-test');
      res.json(this.db.getLeaderboard(channelId));
    });

    this.app.post('/api/twitch/device', async (req, res) => {
      try {
        const clientId = String(req.body?.clientId || this.db.getSetting('twitch_client_id', '')).trim();
        if (!clientId) return res.status(400).json({ error: 'Informe o Client ID da Twitch.' });
        this.db.setSetting('twitch_client_id', clientId);
        const device = await this.twitch.startDeviceAuth(clientId);
        res.json(device);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, '127.0.0.1', () => resolve(this.port));
    });
  }

  stop() {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

module.exports = { LocalServer };
