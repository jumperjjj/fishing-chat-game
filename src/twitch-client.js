const { EventEmitter } = require('events');

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const HELIX_USERS = 'https://api.twitch.tv/helix/users';
const EVENTSUB_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';

class TwitchClient extends EventEmitter {
  constructor(database) {
    super();
    this.db = database;
    this.ws = null;
    this.token = null;
    this.identity = null;
    this.sessionId = null;
  }

  async startDeviceAuth(clientId) {
    const scopes = 'user:read:chat user:write:chat';
    const response = await fetch(DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scopes })
    });
    if (!response.ok) throw new Error(`Falha ao iniciar login Twitch (${response.status})`);
    return response.json();
  }

  async pollDeviceToken(clientId, deviceCode, intervalSeconds = 5, expiresIn = 1800) {
    const deadline = Date.now() + expiresIn * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, intervalSeconds) * 1000));
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          scopes: 'user:read:chat user:write:chat',
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      const body = await response.json().catch(() => ({}));
      if (response.ok && body.access_token) return body;
      if (body.message === 'authorization_pending') continue;
      if (body.message) throw new Error(body.message);
    }
    throw new Error('Tempo de autorização expirou.');
  }

  async validateToken(accessToken) {
    const response = await fetch(VALIDATE_URL, {
      headers: { Authorization: `OAuth ${accessToken}` }
    });
    if (!response.ok) throw new Error('Token Twitch inválido.');
    return response.json();
  }

  async loadIdentity(clientId, accessToken) {
    const response = await fetch(HELIX_USERS, {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) throw new Error(`Não foi possível ler o usuário Twitch (${response.status})`);
    const data = await response.json();
    if (!data.data?.[0]) throw new Error('Usuário Twitch não encontrado.');
    return data.data[0];
  }

  async connect({ clientId, accessToken }) {
    this.token = accessToken;
    await this.validateToken(accessToken);
    this.identity = await this.loadIdentity(clientId, accessToken);

    this.db.setSetting('active_channel_id', this.identity.id);
    this.db.setSetting('active_channel_login', this.identity.login);
    this.db.setSetting('active_channel_name', this.identity.display_name);

    this.openEventSubSocket(clientId);
    return this.identity;
  }

  openEventSubSocket(clientId, url = EVENTSUB_WS) {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.addEventListener('message', async (message) => {
      try {
        const data = JSON.parse(message.data);
        const type = data.metadata?.message_type;

        if (type === 'session_welcome') {
          this.sessionId = data.payload.session.id;
          await this.subscribeToChat(clientId);
          this.emit('connected', this.identity);
        }

        if (type === 'notification' && data.metadata?.subscription_type === 'channel.chat.message') {
          const event = data.payload.event;
          this.emit('chatMessage', {
            text: event.message?.text || '',
            user: {
              id: event.chatter_user_id,
              login: event.chatter_user_login,
              displayName: event.chatter_user_name
            }
          });
        }

        if (type === 'session_reconnect') {
          const reconnectUrl = data.payload.session.reconnect_url;
          this.openEventSubSocket(clientId, reconnectUrl);
        }
      } catch (error) {
        this.emit('error', error);
      }
    });

    socket.addEventListener('error', (error) => this.emit('error', error));
    socket.addEventListener('close', () => {
      if (this.ws === socket) this.emit('disconnected');
    });
  }

  async subscribeToChat(clientId) {
    const body = {
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: this.identity.id,
        user_id: this.identity.id
      },
      transport: {
        method: 'websocket',
        session_id: this.sessionId
      }
    };

    const response = await fetch(EVENTSUB_URL, {
      method: 'POST',
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha ao assinar chat EventSub (${response.status}): ${text}`);
    }
  }

  disconnect() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.sessionId = null;
    this.identity = null;
  }
}

module.exports = { TwitchClient };
