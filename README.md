# Fishing Chat Game — v0.2.0

Aplicativo desktop local para jogo de pescaria interativo no chat da Twitch.

## Arquitetura

- Electron: aplicativo desktop.
- Twitch EventSub WebSocket: leitura do chat.
- Twitch Helix Chat Messages: FishingBotJJJ responde os resultados no chat.
- OAuth Device Code Flow: login sem Client Secret embutido no `.exe`.
- SQLite local (`node:sqlite`): progresso fica no PC do streamer e é separado por canal + usuário Twitch.
- Express + WebSocket local: painel e overlay.
- OBS Browser Source: `http://127.0.0.1:8766/overlay.html` em 1920×1080.

## v0.2.0

- Editor completo: adicionar, editar e excluir peixes/itens.
- Removidos do painel: Tipo, Peso e Ativo.
- Chance direta em porcentagem, com total visível; o catálogo deve somar 100%.
- Ouro por faixa mínima/máxima e valor sorteado a cada captura.
- Migração automática do catálogo padrão v0.1.x para chances simples (30%, 25%, etc.).
- Overlay menor.
- Som sintetizado de lançamento/fisgada e resultado no overlay, com opção de ligar/desligar.
- FishingBotJJJ envia no chat: `@usuario pescou ITEM (RARIDADE) e ganhou X de Ouro! 🎣`.
- Exclusão do catálogo preserva histórico e coleção já conquistados.

## Rodar localmente

```bash
npm install
npm start
```

## Gerar instalador

```bash
npm run dist -- --publish never
```

O banco é criado no diretório `userData` do Electron, fora da pasta de instalação.
