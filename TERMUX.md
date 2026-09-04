# Hospedar o A.I.S. no celular (Termux) — modo 100% local

O A.I.S. roda como um servidor Node.js leve, sem dependências externas. O celular vira o servidor: os fluxos ficam salvos nele e sincronizam entre seus aparelhos.

Esta configuração é **local por padrão**: o servidor só aceita conexões da sua **rede local** (Wi-Fi de casa) e do **Tailscale** (sua VPN). Nada é exposto à internet, nenhuma porta é aberta no roteador. Para acessar de fora de casa, você entra pela VPN.

---

## 1. Instalar o Termux

Instale pela **F-Droid** (a versão da Play Store é desatualizada):
https://f-droid.org/packages/com.termux/

```bash
pkg update && pkg upgrade -y
```

## 2. Instalar Node e Git

```bash
pkg install nodejs git -y
node --version   # v18 ou maior
```

## 3. Baixar o A.I.S.

Troque pela URL do seu repositório:

```bash
git clone https://github.com/SEU_USUARIO/ais.git
cd ais
```

## 4. Ligar o servidor

```bash
npm start
```

Na primeira vez ele gera um **token de acesso** e mostra:

```
  A.I.S. rodando 🚀  (modo local)

  Local:      http://localhost:8080
  Rede local: http://192.168.0.12:8080

  Token de acesso (guarde-o):
  Xy8kP2c...

  🔒 Só aceita conexões da rede local e do Tailscale.
```

Em qualquer aparelho **no mesmo Wi-Fi**, abra `http://SEU_IP_DA_REDE:8080`. Na primeira vez o site pede o **token** — cole o do terminal.

## 5. Acessar de fora de casa (Tailscale)

O Tailscale cria uma rede privada entre seus aparelhos. Quando você está longe, seu celular/notebook age como se estivesse na sua rede — criptografado, sem expor nada publicamente.

**No celular servidor (Termux):**

```bash
pkg install tailscale -y
tailscaled &          # inicia o serviço em segundo plano
tailscale up          # faz login (abre uma URL para autenticar)
tailscale ip -4       # mostra o IP Tailscale, tipo 100.101.102.103
```

**Nos outros aparelhos** (celular pessoal, notebook): instale o app do Tailscale e entre na **mesma conta**.

Pronto. De qualquer lugar, acesse `http://IP_TAILSCALE_DO_SERVIDOR:8080`. O servidor já reconhece a faixa do Tailscale e aceita a conexão.

> **Importante — sobre receber webhooks externos:** a VPN cobre voce *acessando* o A.I.S. de longe e seus aparelhos conversando entre si. Ela **nao** faz servicos de terceiros (Stripe, GitHub, formularios de site) alcancarem seu servidor — eles nao entram na sua VPN. Se um dia voce precisar receber esses envios, ai sim sera necessario expor so a rota de webhook publicamente (via tunel) ou usar um relay. Ate la, o modo local cobre tudo com seguranca.

## 6. Manter ligado (opcional)

Para o Android nao pausar o Termux com a tela apagada:

```bash
pkg install termux-services -y
termux-wake-lock
```

Solte depois com `termux-wake-unlock`.

---

## Perguntas rapidas

**Onde ficam meus fluxos?**
Em `data/flows.json`, na pasta do projeto. Copie esse arquivo para ter backup.

**Perdi o token.**
Esta em `data/config.json`. Para trocar, apague esse arquivo e rode `npm start` de novo, ou fixe o seu:

```bash
AIS_TOKEN="uma-senha-bem-grande" npm start
```

**Mudar a porta:**

```bash
PORT=3000 npm start
```

**Preciso mesmo da trava de IP? Posso desligar?**
Pode, mas nao e recomendado. A trava recusa conexoes de fora da rede local/VPN. So desligue se souber o que esta fazendo:

```bash
AIS_ALLOW_ALL=1 npm start
```

**Isso substitui a Vercel?**
Nao precisa escolher. Na Vercel o A.I.S. funciona como site estatico (fluxos no navegador). No Termux funciona com servidor local (fluxos no celular, sincronizados via rede/VPN). O mesmo codigo detecta onde esta.
