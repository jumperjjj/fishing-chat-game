# Fishing Chat Game — v0.3.0

Aplicativo desktop local para jogo de pescaria interativo no chat da Twitch.

## Importante sobre Client ID e FishingBotJJJ

- O **Client ID identifica o aplicativo**, não a conta que vai falar no chat.
- Quem fala no chat é a **conta que autorizou o OAuth/Device Code**.
- Para o teste atual, autorize a conta **FishingBotJJJ**. A v0.3.0 valida isso e avisa se outra conta for autorizada.
- O Client ID é público e pode ficar embutido no app em uma versão futura.
- Para distribuir o app para terceiros usando sempre a mesma conta FishingBotJJJ sem entregar as credenciais/token dessa conta, será necessário um pequeno serviço remoto seguro. O banco do jogo pode continuar 100% local.

## Novidades v0.3.0

- Editor de itens compacto e inline: Editar abre logo abaixo do item.
- Raridades: Lixo, Incomum, Raro, Épico, Lendário e Mítico.
- Imagem por item com redimensionamento automático no navegador para até 160×160 e armazenamento local.
- Mensagem própria do bot por item, com fallback para uma mensagem padrão global.
- Variáveis: `{user}`, `{item}`, `{raridade}`, `{ouro}`, `{ouro_total}`, `{pescarias}` e `{tempo}`.
- Mensagem de cooldown no chat com tempo restante.
- Overlay com imagem do item, animação e editor visual de cor, posição, escala, opacidade e tamanho da imagem.
- Prévia 16:9 do overlay dentro do aplicativo.
- Ranking com Editar e Resetar por usuário; reset mantém a coleção.
- Coleção/Bestiário por jogador.
- Primeira base de Conquistas.
- Layout reorganizado em Visão geral, Peixes e itens, Coleção, Ranking, Conquistas, Comandos, Overlay/OBS e Configurações.

## Arquitetura

- Electron: aplicativo desktop.
- Twitch EventSub WebSocket: leitura do chat.
- Twitch Helix Send Chat Message: resposta do bot.
- OAuth Device Code Flow: login sem Client Secret embutido no `.exe`.
- SQLite local (`node:sqlite`): progresso separado por canal + usuário Twitch.
- Express + WebSocket local: painel e overlay.
- OBS Browser Source: `http://127.0.0.1:8766/overlay.html` em 1920×1080.

## Rodar localmente

```bash
npm install
npm start
```

## Gerar instalador

```bash
npm run dist -- --publish never
```

O banco e as imagens ficam no diretório `userData` do Electron, fora da pasta de instalação.
