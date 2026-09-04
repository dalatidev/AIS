# A.I.S. — Automacao Inteligente e Simplificada

Editor de automacao visual inspirado no n8n. Intuitivo, bonito, simples e **totalmente responsivo** (celular e desktop). Paleta: azul, preto e branco.

## Dois modos, mesmo codigo

O A.I.S. detecta sozinho onde esta rodando:

- **Site estatico (ex.: Vercel):** os fluxos ficam salvos no navegador (`localStorage`). Zero configuracao.
- **Com servidor local (ex.: celular via Termux):** os fluxos ficam salvos no servidor e **sincronizam entre aparelhos**. O acesso e protegido por token, e o servidor **so aceita conexoes da rede local e do Tailscale** — nada e exposto a internet.

O front pergunta ao servidor (`/api/ping`) e decide o modo.

## Seguranca: local primeiro

Esta versao e **local por padrao**. Para usar de fora de casa, o caminho recomendado e uma **VPN (Tailscale)**: seus aparelhos se comportam como se estivessem na sua rede, criptografado, sem abrir portas no roteador.

Uma ressalva honesta: a VPN cobre voce *acessando* o sistema de longe, mas nao faz servicos externos (Stripe, GitHub, etc.) *enviarem* webhooks para voce — para isso, mais tarde, seria preciso expor so a rota de webhook. Ate la, o modo local cobre tudo. Detalhes no TERMUX.md.

## Telas

- **`index.html`** — Painel de fluxos: cards com abrir, renomear, duplicar, excluir; busca; botao **Nova linha**.
- **`editor.html`** — Editor de canvas: grade, pan e zoom (mouse, pinca no celular, botoes). Le o fluxo por `?id=`, salva e renomeia. Ainda **sem nodulos** — serao adicionados um a um.

## Rodar como site estatico

```bash
npx serve .
```

## Rodar com servidor local

```bash
npm start        # http://localhost:8080, mostra o token
```

Hospedar no celular: veja **[TERMUX.md](TERMUX.md)**.

## Deploy na Vercel

Importe o repositorio, preset **Other**, sem build. Deploy. Funciona em modo estatico.

## Estrutura

```
index.html       -> painel de fluxos (inicial)
editor.html      -> editor de canvas
store.js         -> camada de dados (API se houver servidor, senao localStorage)
server/server.js -> servidor Node (estaticos + API + trava de IP + token)
data/            -> fluxos (flows.json) e token (config.json), criados no 1o start
package.json     -> scripts
vercel.json      -> config de deploy estatico
TERMUX.md        -> guia de hospedagem local no celular
```

## API do servidor (resumo)

| Metodo | Rota | Protegido | Uso |
|---|---|---|---|
| GET | `/api/ping` | nao | deteccao de ambiente |
| GET | `/api/flows` | token | listar |
| GET | `/api/flows/:id` | token | ler um |
| POST | `/api/flows` | token | criar |
| PUT | `/api/flows/:id` | token | atualizar |
| DELETE | `/api/flows/:id` | token | excluir |

Todas as conexoes passam pela trava de rede local. O token vai no cabecalho `X-AIS-Token`.

## Proximos passos

Criar os nodulos um a um.
