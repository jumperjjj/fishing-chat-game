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

    this.app.use(express.json({ limit: '1mb' }));
    this.app.use('/item-images', express.static(this.db.getImagesPath()));
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

  activeChannelId() {
    return this.db.getSetting('active_channel_id', 'local-test');
  }

  registerRoutes() {
    this.app.get('/api/status', (_req, res) => {
      const settings = this.db.getSettings();
      const channelId = this.activeChannelId();
      const players = this.db.listPlayers(channelId);
      res.json({
        ok: true,
        version: '0.3.0',
        overlayUrl: `http://127.0.0.1:${this.port}/overlay.html`,
        settings,
        chanceTotal: this.db.getChanceTotal(),
        summary: {
          players: players.length,
          catches: players.reduce((sum, row) => sum + Number(row.total_catches || 0), 0),
          items: this.db.listItems().length
        }
      });
    });

    this.app.get('/api/items', (_req, res) => {
      res.json({ items: this.db.listItems(), chanceTotal: this.db.getChanceTotal() });
    });

    this.app.post('/api/items', (req, res) => {
      try {
        if (!req.body?.name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
        const id = this.db.addItem(req.body);
        res.json({ ok: true, id, chanceTotal: this.db.getChanceTotal() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.put('/api/items/:id', (req, res) => {
      try {
        if (!req.body?.name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
        this.db.updateItem(req.params.id, req.body);
        res.json({ ok: true, chanceTotal: this.db.getChanceTotal() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/api/items/:id', (req, res) => {
      this.db.deleteItem(req.params.id);
      res.json({ ok: true, chanceTotal: this.db.getChanceTotal() });
    });

    this.app.post('/api/settings', (req, res) => {
      const allowed = [
        'command',
        'cooldown_seconds',
        'fishing_seconds',
        'overlay_enabled',
        'overlay_sound_enabled',
        'overlay_show_image',
        'overlay_bg_color',
        'overlay_text_color',
        'overlay_accent_color',
        'overlay_gold_color',
        'overlay_opacity',
        'overlay_x',
        'overlay_y',
        'overlay_scale',
        'overlay_image_size',
        'overlay_radius',
        'overlay_animation',
        'chat_result_enabled',
        'chat_cooldown_enabled',
        'chat_result_template',
        'chat_cooldown_template',
        'twitch_client_id',
        'target_channel_login',
        'expected_bot_login'
      ];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) this.db.setSetting(key, req.body[key]);
      }
      const settings = this.db.getSettings();
      this.broadcast({ type: 'settings:updated', settings });
      res.json({ ok: true, settings });
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
      if (!result.ok && result.reason === 'invalid_chance_total') {
        return res.status(400).json({
          error: `As chances dos itens precisam somar 100%. Total atual: ${Number(result.chanceTotal || 0).toFixed(2)}%.`
        });
      }
      res.json(result);
    });

    this.app.get('/api/leaderboard', (_req, res) => {
      res.json(this.db.getLeaderboard(this.activeChannelId(), 100));
    });

    this.app.put('/api/leaderboard/:userId', (req, res) => {
      try {
        const player = this.db.updatePlayerStats(this.activeChannelId(), req.params.userId, req.body || {});
        if (!player) return res.status(404).json({ error: 'Usuário não encontrado.' });
        res.json({ ok: true, player });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/leaderboard/:userId/reset', (req, res) => {
      const player = this.db.resetPlayerRank(this.activeChannelId(), req.params.userId);
      if (!player) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ ok: true, player });
    });

    this.app.get('/api/players', (_req, res) => {
      res.json(this.db.listPlayers(this.activeChannelId()));
    });

    this.app.get('/api/collection', (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) return res.status(400).json({ error: 'Informe o usuário.' });
      res.json({
        items: this.db.getCollection(this.activeChannelId(), userId),
        summary: this.db.getCollectionSummary(this.activeChannelId(), userId)
      });
    });

    this.app.get('/api/achievements', (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) return res.status(400).json({ error: 'Informe o usuário.' });
      res.json(this.db.getAchievements(this.activeChannelId(), userId));
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
