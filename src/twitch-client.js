const { EventEmitter } = require('events');

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const HELIX_USERS = 'https://api.twitch.tv/helix/users';
const EVENTSUB_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
const SCOPES = 'user:bot user:read:chat user:write:chat';

class TwitchClient extends EventEmitter {
  constructor(database) {
    super();
    this.db = database;
    this.ws = null;
    this.token = null;
    this.botIdentity = null;
    this.channelIdentity = null;
    this.sessionId = null;
  }

  async startDeviceAuth(clientId) {
    const response = await fetch(DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scopes: SCOPES })
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
          scopes: SCOPES,
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

  async loadOwnIdentity(clientId, accessToken) {
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

  async loadUserByLogin(clientId, accessToken, login) {
    const cleanLogin = String(login || '').trim().replace(/^@/, '').toLowerCase();
    if (!cleanLogin) throw new Error('Informe o canal da live.');
    const response = await fetch(`${HELIX_USERS}?login=${encodeURIComponent(cleanLogin)}`, {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) throw new Error(`Não foi possível localizar o canal (${response.status})`);
    const data = await response.json();
    if (!data.data?.[0]) throw new Error(`Canal Twitch não encontrado: ${cleanLogin}`);
    return data.data[0];
  }

  async connect({ clientId, accessToken, targetChannelLogin }) {
    this.token = accessToken;
    await this.validateToken(accessToken);
    this.botIdentity = await this.loadOwnIdentity(clientId, accessToken);
    this.channelIdentity = await this.loadUserByLogin(clientId, accessToken, targetChannelLogin);

    this.db.setSetting('bot_user_id', this.botIdentity.id);
    this.db.setSetting('bot_user_login', this.botIdentity.login);
    this.db.setSetting('bot_user_name', this.botIdentity.display_name);
    this.db.setSetting('target_channel_login', this.channelIdentity.login);
    this.db.setSetting('active_channel_id', this.channelIdentity.id);
    this.db.setSetting('active_channel_login', this.channelIdentity.login);
    this.db.setSetting('active_channel_name', this.channelIdentity.display_name);

    this.openEventSubSocket(clientId);
    return { bot: this.botIdentity, channel: this.channelIdentity };
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
          this.emit('connected', { bot: this.botIdentity, channel: this.channelIdentity });
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
        broadcaster_user_id: this.channelIdentity.id,
        user_id: this.botIdentity.id
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
    this.botIdentity = null;
    this.channelIdentity = null;
  }
}

module.exports = { TwitchClient };
