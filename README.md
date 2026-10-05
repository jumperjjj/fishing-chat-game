# Fishing Chat Game — v0.1.1

Base inicial de um jogo de pescaria interativo para Twitch.

## Arquitetura

- Electron: aplicativo desktop.
- Twitch EventSub WebSocket: leitura do chat.
- OAuth Device Code Flow: login para aplicativo Electron sem Client Secret embutido.
- SQLite local (`node:sqlite`): progresso fica no PC do streamer.
- Express + WebSocket local: painel/overlay.
- OBS Browser Source: `http://127.0.0.1:8766/overlay.html` em 1920×1080.

## Rodar localmente

```bash
npm install
npm start
```

O banco é criado automaticamente no diretório `userData` do Electron, fora da pasta de instalação.

## Estado atual

- Banco local com separação por `channel_id + twitch_user_id`.
- Catálogo inicial de itens.
- Peso/chance automática.
- Ouro, total de pescarias, coleção e histórico.
- Cooldown.
- Teste de pescaria sem Twitch.
- Overlay dinâmico para OBS.
- Device Code Flow e EventSub preparados para Client ID Twitch.
- Editor inicial para adicionar itens.
- Ranking local por ouro.

## Próximos passos

1. Registrar o aplicativo na Twitch e informar o Client ID.
2. Testar conexão real com `!pescar`.
3. Persistir/renovar tokens com Electron `safeStorage`.
4. Adicionar edição completa de itens e imagens.
5. Coleção, conquistas e painel de estatísticas.
6. Fila visual do overlay e estilos/animações.
7. GitHub Actions + electron-builder para gerar instalador `.exe`.


## v0.1.1
- Separa a conta do bot do canal da live.
- Device Code pede user:bot, user:read:chat e user:write:chat.
- Informe o login do canal da live antes de conectar.
