/* =====================================================================
   A.I.S. — Módulo de Credenciais (server-side)

   • Presets prontos: Spotify, Google, GitHub, Discord + genéricos
   • Tipos: bearerToken, apiKey, basicAuth, oauth2
   • OAuth2: authorize + callback + refresh automático
   • Storage: encriptação simples com chave derivada do token do servidor
   • Sem dependências externas
   ===================================================================== */
"use strict";
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

/* ---------- Presets ---------- */
const PRESETS = {
  // OAuth2 completos
  spotifyOAuth2: {
    name: "Spotify (OAuth2)",
    type: "oauth2",
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scope: "user-read-playback-state user-modify-playback-state user-read-currently-playing",
    authQueryParams: {},
    docs: "https://developer.spotify.com/dashboard",
  },
  googleOAuth2: {
    name: "Google (OAuth2)",
    type: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
    authQueryParams: { access_type: "offline", prompt: "consent" },
    docs: "https://console.cloud.google.com/apis/credentials",
  },
  githubOAuth2: {
    name: "GitHub (OAuth2)",
    type: "oauth2",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "repo user",
    authQueryParams: {},
    docs: "https://github.com/settings/developers",
  },
  discordOAuth2: {
    name: "Discord (OAuth2)",
    type: "oauth2",
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scope: "identify guilds",
    authQueryParams: {},
    docs: "https://discord.com/developers/applications",
  },
  oauth2Generic: {
    name: "OAuth2 (genérico)",
    type: "oauth2",
    authUrl: "",
    tokenUrl: "",
    scope: "",
    authQueryParams: {},
    docs: "",
  },
  bearerToken: {
    name: "Bearer Token",
    type: "bearerToken",
    docs: "",
  },
  apiKey: {
    name: "API Key (header)",
    type: "apiKey",
    docs: "",
  },
  basicAuth: {
    name: "Basic Auth",
    type: "basicAuth",
    docs: "",
  },
};

/* ---------- Encrypt / Decrypt ---------- */
// Chave derivada do token do servidor. Simples mas melhor que texto puro.
function makeKey(serverToken) {
  return crypto.createHash("sha256").update(String(serverToken || "ais-fallback-key")).digest();
}
function encrypt(text, serverToken) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", makeKey(serverToken), iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + iv.toString("base64") + ":" + tag.toString("base64") + ":" + enc.toString("base64");
}
function decrypt(payload, serverToken) {
  try {
    if (!payload || !payload.startsWith("v1:")) return payload; // texto plano antigo
    const [, ivB64, tagB64, encB64] = payload.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", makeKey(serverToken),
      Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch { return ""; }
}

// Encripta apenas campos sensíveis do objeto data
const SENSITIVE_KEYS = new Set([
  "clientSecret", "accessToken", "refreshToken", "password", "apiKey",
  "token", "secret", "bearerToken",
]);
function encryptCredentialData(data, serverToken) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (SENSITIVE_KEYS.has(k) && v) out[k] = encrypt(v, serverToken);
    else out[k] = v;
  }
  return out;
}
function decryptCredentialData(data, serverToken) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (SENSITIVE_KEYS.has(k) && typeof v === "string") out[k] = decrypt(v, serverToken);
    else out[k] = v;
  }
  return out;
}

/* ---------- HTTP helper (sem depender de fetch nativo em Node < 18) ---------- */
function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const client = u.protocol === "https:" ? https : http;
      const req = client.request(url, {
        method: opts.method || "GET",
        headers: opts.headers || {},
      }, res => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json; try { json = JSON.parse(body); } catch { json = body; }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      });
      req.on("error", reject);
      if (opts.body) req.write(opts.body);
      req.end();
    } catch (e) { reject(e); }
  });
}

/* ---------- OAuth2 flow ---------- */
// Estado de "authorize em andamento": mapeia state → { credId, credData, redirectUri, resolve }
const pendingAuth = new Map();

function buildAuthorizeUrl(cred, redirectUri, state) {
  const d = cred.data || {};
  const params = new URLSearchParams({
    client_id: d.clientId || "",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: d.scope || "",
    state,
    ...(d.authQueryParams || {}),
  });
  return `${d.authUrl}?${params.toString()}`;
}

async function exchangeCodeForToken(cred, code, redirectUri) {
  const d = cred.data || {};
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: d.clientId || "",
    client_secret: d.clientSecret || "",
  }).toString();
  const r = await httpRequest(d.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body,
  });
  if (r.status >= 400) throw new Error(`Token exchange falhou (${r.status}): ${JSON.stringify(r.body)}`);
  // GitHub retorna form-encoded se Accept não for JSON — mas Accept:json é respeitado.
  if (typeof r.body === "string" && r.body.includes("access_token=")) {
    const parsed = Object.fromEntries(new URLSearchParams(r.body));
    return parsed;
  }
  return r.body;
}

async function refreshAccessToken(cred) {
  const d = cred.data || {};
  if (!d.refreshToken) throw new Error("Sem refresh_token para renovar");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: d.refreshToken,
    client_id: d.clientId || "",
    client_secret: d.clientSecret || "",
  }).toString();
  const r = await httpRequest(d.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body,
  });
  if (r.status >= 400) throw new Error(`Refresh falhou (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body;
}

/**
 * Retorna a credencial pronta pra uso, renovando access token se expirado.
 * A credencial passada aqui deve estar decriptada.
 */
async function ensureFreshToken(cred, updateFn) {
  const d = cred.data || {};
  if (cred.type !== "oauth2") return cred;
  if (!d.accessToken) throw new Error("Credencial não conectada. Autorize primeiro.");
  const now = Date.now();
  // Se tem expiresAt e vence em menos de 60s, renova
  if (d.expiresAt && d.expiresAt - now < 60000 && d.refreshToken) {
    try {
      const tok = await refreshAccessToken(cred);
      const newData = {
        ...d,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || d.refreshToken, // alguns providers não renovam refresh
        expiresAt: tok.expires_in ? now + tok.expires_in * 1000 : null,
        tokenType: tok.token_type || d.tokenType || "Bearer",
      };
      // Persiste via callback
      if (updateFn) await updateFn(newData);
      return { ...cred, data: newData };
    } catch (e) {
      throw new Error("Renovar token falhou: " + e.message);
    }
  }
  return cred;
}

/**
 * Aplica autenticação nos headers de uma requisição HTTP.
 * cred deve estar decriptada e com token fresco.
 */
function applyAuth(cred, headers = {}) {
  const d = cred.data || {};
  const h = { ...headers };
  switch (cred.type) {
    case "bearerToken":
      if (d.token) h["Authorization"] = `Bearer ${d.token}`;
      break;
    case "apiKey":
      if (d.headerName && d.apiKey) h[d.headerName] = d.apiKey;
      break;
    case "basicAuth":
      if (d.username != null) {
        const encoded = Buffer.from(`${d.username}:${d.password || ""}`).toString("base64");
        h["Authorization"] = `Basic ${encoded}`;
      }
      break;
    case "oauth2":
      if (d.accessToken) h["Authorization"] = `${d.tokenType || "Bearer"} ${d.accessToken}`;
      break;
  }
  return h;
}

module.exports = {
  PRESETS,
  encryptCredentialData,
  decryptCredentialData,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  ensureFreshToken,
  applyAuth,
  pendingAuth,
};
