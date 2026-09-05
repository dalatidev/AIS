/* =====================================================================
   A.I.S. — Servidor (modo 100% local)
   Node.js puro (sem dependências). Feito para rodar no Termux.
   - Serve os arquivos estáticos (index.html, editor.html, ...)
   - API de fluxos salvos em disco (data/flows.json)
   - Só aceita conexões da rede local e do Tailscale (trava por IP)
   - Área de edição protegida por token
   ===================================================================== */
"use strict";

const http = require("http");
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DATA_DIR  = path.join(ROOT, "data");
const FLOWS_FILE = path.join(DATA_DIR, "flows.json");
const CREDS_FILE = path.join(DATA_DIR, "credentials.json");
const FOLDERS_FILE = path.join(DATA_DIR, "folders.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

const PORT = process.env.PORT || 8080;
// Escuta apenas na rede local por padrão. Para expor de propósito, defina HOST=0.0.0.0.
const HOST = process.env.HOST || "0.0.0.0"; // 0.0.0.0 = todas as interfaces locais (LAN + Tailscale)

// Trava de segurança: só aceita conexões de origens confiáveis.
// Confiáveis = localhost, redes privadas (LAN) e a faixa do Tailscale (CGNAT 100.64/10).
// Pode desligar com AIS_ALLOW_ALL=1 (não recomendado).
const ALLOW_ALL = process.env.AIS_ALLOW_ALL === "1";

function ipToLong(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + (+p[3]);
}
function inCidr(ip, base, bits) {
  const a = ipToLong(ip), b = ipToLong(base);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}
function isLocalOrigin(remote) {
  if (!remote) return false;
  // Normaliza IPv6-mapeado (::ffff:192.168.0.5) e loopback IPv6 (::1)
  let ip = remote.replace(/^::ffff:/i, "");
  if (ip === "::1") return true;             // loopback IPv6
  if (ip === "127.0.0.1") return true;       // loopback IPv4
  return (
    inCidr(ip, "10.0.0.0", 8) ||             // LAN privada
    inCidr(ip, "172.16.0.0", 12) ||          // LAN privada
    inCidr(ip, "192.168.0.0", 16) ||         // LAN privada (mais comum em casa)
    inCidr(ip, "169.254.0.0", 16) ||         // link-local
    inCidr(ip, "100.64.0.0", 10)             // Tailscale (CGNAT)
  );
}

/* ---------- Armazenamento simples em arquivo ---------- */
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FLOWS_FILE)) fs.writeFileSync(FLOWS_FILE, "{}");
  if (!fs.existsSync(CREDS_FILE)) fs.writeFileSync(CREDS_FILE, "{}");
  if (!fs.existsSync(FOLDERS_FILE)) fs.writeFileSync(FOLDERS_FILE, "{}");
  if (!fs.existsSync(CONFIG_FILE)) {
    // Gera um token de acesso na primeira execução.
    const token = process.env.AIS_TOKEN || crypto.randomBytes(24).toString("base64url");
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2));
  }
}
ensureData();

const readJSON  = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
const writeJSON = (f, obj) => fs.writeFileSync(f, JSON.stringify(obj, null, 2));

const config = readJSON(CONFIG_FILE, {});
const TOKEN  = config.token;

/* ---------- Utilidades HTTP ---------- */
function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-AIS-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    ...headers,
  });
  res.end(data);
}
function json(res, status, obj) { send(res, status, obj, { "Content-Type": "application/json; charset=utf-8" }); }

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 5e6) req.destroy(); }); // limite ~5MB
    req.on("end", () => resolve(raw));
  });
}

function authOK(req) {
  const t = req.headers["x-ais-token"] || "";
  // comparação em tempo constante
  const a = Buffer.from(String(t));
  const b = Buffer.from(String(TOKEN));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Tipos MIME p/ estáticos ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  // impede path traversal
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) {
      // fallback para SPA-like: serve index se for uma rota qualquer
      return send(res, 404, "Não encontrado");
    }
    const ext = path.extname(file).toLowerCase();
    send(res, 200, buf, { "Content-Type": MIME[ext] || "application/octet-stream" });
  });
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","flows",":id"]

  // Webhooks externos: agora tratados em /hook/:path
  if (parts[1] === "webhook") {
    return json(res, 301, { note: "Use /hook/:path em vez de /api/webhook/:path." });
  }

  // GET /api/webhook-test/:path — retorna últimos dados recebidos pelo webhook
  if (req.method === "GET" && parts[1] === "webhook-test" && parts.length === 3) {
    const hookPath = decodeURIComponent(parts[2]);
    const data = webhookHits.get(hookPath) || { lastHit: null, count: 0 };
    return json(res, 200, data);
  }

  // Toda a API exige token.
  if (!authOK(req)) return json(res, 401, { error: "Token inválido ou ausente." });

  const flows = readJSON(FLOWS_FILE, {});

  // GET /api/flows  -> lista
  if (req.method === "GET" && parts[1] === "flows" && parts.length === 2) {
    return json(res, 200, Object.values(flows).sort((a, b) => b.updatedAt - a.updatedAt));
  }
  // GET /api/flows/:id
  if (req.method === "GET" && parts[1] === "flows" && parts.length === 3) {
    const f = flows[parts[2]];
    return f ? json(res, 200, f) : json(res, 404, { error: "Fluxo não encontrado." });
  }
  // POST /api/flows  -> cria
  if (req.method === "POST" && parts[1] === "flows" && parts.length === 2) {
    const body = JSON.parse((await readBody(req)) || "{}");
    const id = "flow_" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
    const now = Date.now();
    flows[id] = {
      id, name: body.name || "Fluxo sem título",
      nodes: [], edges: [],
      status: body.status || "draft",   // draft | active | paused | published
      folderId: body.folderId || null,
      tags: body.tags || [],
      createdAt: now, updatedAt: now
    };
    writeJSON(FLOWS_FILE, flows);
    return json(res, 201, flows[id]);
  }
  // PUT /api/flows/:id  -> atualiza
  if (req.method === "PUT" && parts[1] === "flows" && parts.length === 3) {
    const id = parts[2];
    if (!flows[id]) return json(res, 404, { error: "Fluxo não encontrado." });
    const body = JSON.parse((await readBody(req)) || "{}");
    flows[id] = { ...flows[id], ...body, id, updatedAt: Date.now() };
    writeJSON(FLOWS_FILE, flows);
    return json(res, 200, flows[id]);
  }
  // DELETE /api/flows/:id
  if (req.method === "DELETE" && parts[1] === "flows" && parts.length === 3) {
    const id = parts[2];
    if (!flows[id]) return json(res, 404, { error: "Fluxo não encontrado." });
    delete flows[id];
    writeJSON(FLOWS_FILE, flows);
    return json(res, 200, { ok: true });
  }
  // GET /api/flows/:id/export
  if (req.method === "GET" && parts[1] === "flows" && parts[3] === "export" && parts.length === 4) {
    const f = flows[parts[2]];
    if (!f) return json(res, 404, { error: "Fluxo não encontrado." });
    return json(res, 200, { ais_export: true, version: 1, flow: f });
  }
  // POST /api/flows/import
  if (req.method === "POST" && parts[1] === "flows" && parts[2] === "import") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const src = body.flow || body;
    const id = "flow_" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
    const now = Date.now();
    flows[id] = { ...src, id, name: (src.name || "Importado") + " (importado)", createdAt: now, updatedAt: now };
    writeJSON(FLOWS_FILE, flows);
    return json(res, 201, flows[id]);
  }

  /* --- Credenciais --- */
  const creds = readJSON(CREDS_FILE, {});
  if (parts[1] === "credentials") {
    if (req.method === "GET" && parts.length === 2) return json(res, 200, Object.values(creds).sort((a,b) => b.updatedAt - a.updatedAt));
    if (req.method === "GET" && parts.length === 3) { const c = creds[parts[2]]; return c ? json(res, 200, c) : json(res, 404, { error: "Credencial não encontrada." }); }
    if (req.method === "POST" && parts.length === 2) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = "cred_" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
      const now = Date.now();
      creds[id] = { id, name: body.name || "Credencial", type: body.type || "apiKey", data: body.data || {}, createdAt: now, updatedAt: now };
      writeJSON(CREDS_FILE, creds); return json(res, 201, creds[id]);
    }
    if (req.method === "PUT" && parts.length === 3) {
      const id = parts[2]; if (!creds[id]) return json(res, 404, { error: "Credencial não encontrada." });
      const body = JSON.parse((await readBody(req)) || "{}");
      creds[id] = { ...creds[id], ...body, id, updatedAt: Date.now() };
      writeJSON(CREDS_FILE, creds); return json(res, 200, creds[id]);
    }
    if (req.method === "DELETE" && parts.length === 3) {
      const id = parts[2]; if (!creds[id]) return json(res, 404, { error: "Credencial não encontrada." });
      delete creds[id]; writeJSON(CREDS_FILE, creds); return json(res, 200, { ok: true });
    }
  }

  /* --- Pastas --- */
  const folders = readJSON(FOLDERS_FILE, {});
  if (parts[1] === "folders") {
    if (req.method === "GET" && parts.length === 2) return json(res, 200, Object.values(folders).sort((a,b) => (a.name||"").localeCompare(b.name||"")));
    if (req.method === "POST" && parts.length === 2) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = "fld_" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
      folders[id] = { id, name: body.name || "Nova pasta", color: body.color || "#3B82F6", createdAt: Date.now() };
      writeJSON(FOLDERS_FILE, folders); return json(res, 201, folders[id]);
    }
    if (req.method === "PUT" && parts.length === 3) {
      const id = parts[2]; if (!folders[id]) return json(res, 404, { error: "Pasta não encontrada." });
      const body = JSON.parse((await readBody(req)) || "{}");
      folders[id] = { ...folders[id], ...body, id };
      writeJSON(FOLDERS_FILE, folders); return json(res, 200, folders[id]);
    }
    if (req.method === "DELETE" && parts.length === 3) {
      const id = parts[2]; if (!folders[id]) return json(res, 404, { error: "Pasta não encontrada." });
      delete folders[id]; writeJSON(FOLDERS_FILE, folders);
      // Remove folderId dos fluxos nesta pasta
      for (const f of Object.values(flows)) { if (f.folderId === id) { f.folderId = null; } }
      writeJSON(FLOWS_FILE, flows);
      return json(res, 200, { ok: true });
    }
  }

  /* --- Execuções globais --- */
  if (parts[1] === "all-executions" && req.method === "GET") {
    const all = [];
    for (const [flowId, list] of executions) {
      const flowName = flows[flowId]?.name || "Fluxo removido";
      for (const ex of list) all.push({ ...ex, flowId, flowName, steps: undefined });
    }
    all.sort((a, b) => b.startedAt - a.startedAt);
    return json(res, 200, all.slice(0, 100));
  }

  // DELETE /api/all-executions  -> limpar todas as execuções
  if (parts[1] === "all-executions" && req.method === "DELETE") {
    executions.clear();
    return json(res, 200, { ok: true });
  }

  // POST /api/execute/:id  -> executa o fluxo
  // Body: { force: true } = execução de teste (ignora status)
  // Sem force = respeita status (só executa se publicado)
  if (req.method === "POST" && parts[1] === "execute" && parts.length === 3) {
    const id = parts[2];
    if (!flows[id]) return json(res, 404, { error: "Fluxo não encontrado." });
    const body = JSON.parse((await readBody(req)) || "{}");
    const flow = flows[id];

    // Se não for execução forçada (teste), exigir status active
    if (!body.force && flow.status !== "active") {
      return json(res, 403, { error: "Fluxo não está publicado. Publique o fluxo para executá-lo.", status: flow.status || "draft" });
    }

    // Encontra o nó gatilho (manualTrigger ou webhook, ou primeiro sem entrada)
    const triggerNode = (flow.nodes||[]).find(n =>
      n.type === "manualTrigger" || n.type === "webhook" || n.type === "scheduleTrigger"
    ) || (flow.nodes||[])[0];
    if (!triggerNode) return json(res, 400, { error: "Nenhum nó gatilho encontrado." });
    const engine = new Engine(flow);
    const exec = await engine.run(triggerNode.id, body.triggerData || {});
    // Gravar snapshot do fluxo no momento da execução
    exec.snapshot = { nodes: flow.nodes || [], edges: flow.edges || [] };
    storeExec(id, exec);
    return json(res, 200, exec);
  }

  // GET /api/executions/:flowId  -> lista execuções do fluxo
  if (req.method === "GET" && parts[1] === "executions" && parts.length === 3) {
    const list = executions.get(parts[2]) || [];
    return json(res, 200, list.map(e => ({
      id:e.id, status:e.status, startedAt:e.startedAt, finishedAt:e.finishedAt,
      stepCount:(e.steps||[]).length, error:e.error||null
    })));
  }

  // DELETE /api/executions/:flowId/:execId  -> deletar uma execução
  if (req.method === "DELETE" && parts[1] === "executions" && parts.length === 4) {
    const list = executions.get(parts[2]) || [];
    const idx = list.findIndex(e => e.id === parts[3]);
    if (idx === -1) return json(res, 404, { error: "Execução não encontrada." });
    list.splice(idx, 1);
    executions.set(parts[2], list);
    return json(res, 200, { ok: true });
  }

  // GET /api/executions/:flowId/:execId  -> detalhes de uma execução
  if (req.method === "GET" && parts[1] === "executions" && parts.length === 4) {
    const list = executions.get(parts[2]) || [];
    const ex = list.find(e => e.id === parts[3]);
    return ex ? json(res, 200, ex) : json(res, 404, { error: "Execução não encontrada." });
  }

  return json(res, 404, { error: "Rota não encontrada." });
}

/* ---------- Motor de execução ---------- */
const { Engine } = require("./engine");
const executions = new Map(); // flowId -> [exec, ...] (últimas 50)
const MAX_EXEC = 50;

function storeExec(flowId, exec) {
  const list = executions.get(flowId) || [];
  list.unshift(exec);
  if (list.length > MAX_EXEC) list.length = MAX_EXEC;
  executions.set(flowId, list);
}

/* ---------- Webhook hits (em memória) ---------- */
const webhookHits = new Map(); // path -> { lastHit, count }

/* ---------- Webhook handler: /hook/:path ---------- */
async function handleHook(req, res, url) {
  const hookPath = decodeURIComponent(url.pathname.slice(6)); // remove "/hook/"
  if (!hookPath) return json(res, 400, { error: "Caminho vazio." });

  const raw = await readBody(req);
  const flows = readJSON(FLOWS_FILE, {});

  // Procura o nó webhook com este caminho
  let targetNode = null, targetFlow = null;
  for (const flow of Object.values(flows)) {
    for (const node of (flow.nodes || [])) {
      if (node.type === "webhook" && node.config && node.config.path === hookPath) {
        targetNode = node; targetFlow = flow; break;
      }
    }
    if (targetNode) break;
  }

  if (!targetNode) return json(res, 404, { error: `Nenhum webhook com caminho '${hookPath}'.` });

  // Só executa se o fluxo estiver publicado (active)
  if (targetFlow.status !== "active") {
    return json(res, 503, { error: "Fluxo não está publicado.", flowId: targetFlow.id, status: targetFlow.status || "draft" });
  }

  // Verifica método
  const expMethod = targetNode.config.method || "POST";
  if (expMethod !== "ALL" && req.method !== expMethod && req.method !== "OPTIONS") {
    return json(res, 405, { error: `Método ${req.method} não permitido. Esperado: ${expMethod}.` });
  }

  // Verifica autenticação
  const auth = targetNode.config.auth || "none";
  if (auth === "basic") {
    const hdr = req.headers.authorization || "";
    const exp = "Basic " + Buffer.from((targetNode.config.basicUser || "") + ":" + (targetNode.config.basicPass || "")).toString("base64");
    if (hdr !== exp) return json(res, 401, { error: "Basic Auth inválido." });
  } else if (auth === "header") {
    const hName = (targetNode.config.headerName || "").toLowerCase();
    const hVal  = targetNode.config.headerValue || "";
    if (!hName || req.headers[hName] !== hVal) return json(res, 401, { error: "Header Auth inválido." });
  }

  // Parse body
  let parsedBody;
  try { parsedBody = JSON.parse(raw); } catch { parsedBody = raw || null; }

  // Armazena o hit
  const hit = {
    timestamp: Date.now(), method: req.method,
    headers: { ...req.headers }, query: Object.fromEntries(url.searchParams),
    body: parsedBody
  };
  const entry = webhookHits.get(hookPath) || { lastHit: null, count: 0 };
  entry.lastHit = hit; entry.count++;
  webhookHits.set(hookPath, entry);

  // Executa o fluxo a partir do nó webhook
  try {
    const engine = new Engine(targetFlow);
    const exec = await engine.run(targetNode.id, hit);
    // Gravar snapshot do fluxo no momento da execução
    exec.snapshot = { nodes: targetFlow.nodes || [], edges: targetFlow.edges || [] };
    storeExec(targetFlow.id, exec);

    // Se há um nó "Respond to Webhook", usa a resposta dele
    if (exec.webhookResponse) {
      const wr = exec.webhookResponse;
      return send(res, wr.statusCode || 200, wr.body || "", {
        "Content-Type": "application/json; charset=utf-8", ...wr.headers
      });
    }
  } catch(e) { /* ignora erros de execução; responde normalmente */ }

  // Responde com a config do nó webhook
  const code = targetNode.config.responseCode || 200;
  const mode = targetNode.config.responseData || "allEntries";
  if (mode === "noBody") return send(res, code, "", { "Content-Type": "text/plain" });
  if (mode === "firstEntry") return json(res, code, { received: true });
  return json(res, code, { received: true, echo: hit });
}

/* ---------- Servidor ---------- */
const server = http.createServer(async (req, res) => {
  // Trava de origem: recusa quem não for da rede local / Tailscale.
  const remote = req.socket.remoteAddress || "";
  if (!ALLOW_ALL && !isLocalOrigin(remote)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Acesso permitido apenas na rede local.");
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") return send(res, 204, "");

  // Webhooks: /hook/:path (público dentro da LAN, sem token — autenticação do nó)
  if (url.pathname.startsWith("/hook/")) {
    try { return await handleHook(req, res, url); }
    catch (e) { return json(res, 500, { error: "Erro no webhook.", detail: String(e.message || e) }); }
  }

  // Endpoint público que diz se o servidor exige token
  if (url.pathname === "/api/ping") {
    return json(res, 200, { ok: true, needsToken: true, name: "A.I.S." });
  }

  if (url.pathname.startsWith("/api/")) {
    try { return await handleApi(req, res, url); }
    catch (e) { return json(res, 500, { error: "Erro interno.", detail: String(e.message || e) }); }
  }

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const nets = require("os").networkInterfaces();
  const lan = [], tail = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (inCidr(net.address, "100.64.0.0", 10)) tail.push(net.address);
      else lan.push(net.address);
    }
  }
  console.log("\n  A.I.S. rodando 🚀  (modo local)\n");
  console.log(`  Local:      http://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`  Rede local: http://${ip}:${PORT}`));
  tail.forEach((ip) => console.log(`  Tailscale:  http://${ip}:${PORT}`));
  console.log(`\n  Token de acesso (guarde-o):\n  ${TOKEN}\n`);
  if (ALLOW_ALL) console.log("  ⚠  AIS_ALLOW_ALL=1 — a trava de rede local está DESLIGADA.\n");
  else console.log("  🔒 Só aceita conexões da rede local e do Tailscale.\n");
});
