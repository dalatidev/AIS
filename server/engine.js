/* =====================================================================
   A.I.S. — Motor de execução v2 (inspirado no n8n)

   Novidades:
   • Padrão de items: cada nó recebe/emite [{json:{...}}, ...]
   • Expressões n8n-style: $json, $node["Nome"].json, $input.first(),
     $input.item, $now, DateTime (Luxon opcional), globais JS
   • Pinned data: pinData[nodeName] substitui execução do nó
   • Execução parcial: options.destinationNode roda só até esse nó
   • Nós desabilitados: pass-through (mantém item flow)

   Compatibilidade: se input vier como objeto legado, wrappa em items.
   ===================================================================== */
"use strict";
const vm = require("vm");

// Luxon é opcional — se não estiver instalado, seguimos sem
let DateTime, Duration;
try { ({ DateTime, Duration } = require("luxon")); } catch {}

/* ---------- Helpers de items (padrão n8n) ---------- */
function toItems(x) {
  // Já é array de items?
  if (Array.isArray(x) && x.length && x[0] && typeof x[0] === "object" && "json" in x[0]) return x;
  // Array puro? Cada elemento vira um item
  if (Array.isArray(x)) return x.map(v => ({ json: v && typeof v === "object" ? v : { value: v } }));
  // Objeto ou primitivo: um item só
  if (x == null) return [{ json: {} }];
  if (typeof x === "object") return [{ json: x }];
  return [{ json: { value: x } }];
}
function firstJson(items) { return (items && items[0] && items[0].json) || {}; }

/* ---------- Sandbox: expressões e Code ---------- */
function buildGlobals() {
  const g = {
    JSON, Math, String, Number, Boolean, Array, Object, Date, RegExp,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    undefined, null: null,
  };
  if (DateTime) { g.DateTime = DateTime; g.Duration = Duration; }
  return g;
}

class Engine {
  constructor(flow) {
    this.flow = flow;
    this.nodesMap = new Map((flow.nodes || []).map(n => [n.id, n]));
    this.nodesByName = new Map((flow.nodes || []).map(n => [n.name, n]));
    this.edges = flow.edges || [];
    this.pinData = flow.pinData || {}; // { nodeName: [{json:...}, ...] }
    this.steps = [];
    this.runData = {}; // { nodeName: items } — dados de cada nó por nome (para $node["Nome"])
    this.webhookResponse = null;
    this.stopAt = null; // partial execution
  }

  /**
   * @param {string} triggerNodeId
   * @param {*} triggerData
   * @param {{destinationNode?:string}} options
   */
  async run(triggerNodeId, triggerData = {}, options = {}) {
    const id = "exec_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const t0 = Date.now();
    this.stopAt = options.destinationNode || null;

    // Trigger data → items
    const initItems = toItems(triggerData);
    try {
      await this._exec(triggerNodeId, initItems);
      return {
        id, flowId: this.flow.id,
        status: this.steps.some(s => s.status === "error") ? "error" : "success",
        startedAt: t0, finishedAt: Date.now(),
        steps: this.steps, webhookResponse: this.webhookResponse,
        mode: this.stopAt ? "partial" : "full",
        destinationNode: this.stopAt,
      };
    } catch (e) {
      return {
        id, flowId: this.flow.id, status: "error",
        startedAt: t0, finishedAt: Date.now(),
        steps: this.steps, error: e.message,
        webhookResponse: this.webhookResponse,
      };
    }
  }

  async _exec(nodeId, inputItems) {
    const node = this.nodesMap.get(nodeId);
    if (!node) return;

    // Pinned data: se o nó tem pinData, usa em vez de executar
    const pinned = this.pinData[node.name];
    if (pinned && Array.isArray(pinned) && pinned.length) {
      const items = toItems(pinned);
      this.runData[node.name] = items;
      this.steps.push({
        nodeId, nodeName: node.name, nodeType: node.type,
        status: "pinned", startedAt: Date.now(), finishedAt: Date.now(),
        input: this._safe(inputItems), output: this._safe(items), error: null,
      });
      if (nodeId === this.stopAt) return;
      for (const e of this.edges.filter(e => e.from === nodeId)) await this._exec(e.to, items);
      return;
    }

    // Desabilitado: pass-through
    if (node.disabled) {
      this.runData[node.name] = inputItems;
      this.steps.push({
        nodeId, nodeName: node.name, nodeType: node.type,
        status: "skipped", startedAt: Date.now(), finishedAt: Date.now(),
        input: this._safe(inputItems), output: null, error: null,
      });
      if (nodeId === this.stopAt) return;
      for (const e of this.edges.filter(e => e.from === nodeId)) await this._exec(e.to, inputItems);
      return;
    }

    const step = {
      nodeId, nodeName: node.name, nodeType: node.type, status: "running",
      startedAt: Date.now(), input: this._safe(inputItems), output: null, error: null,
    };
    this.steps.push(step);

    try {
      const out = await this._run(node, inputItems);
      // Normaliza saída para items
      let outItems, branch = null;
      if (node.type === "if") {
        // IF retorna { __branch, items }
        branch = out.__branch;
        outItems = toItems(out.items);
      } else {
        outItems = toItems(out);
      }
      this.runData[node.name] = outItems;
      step.output = this._safe(outItems);
      step.status = "success";
      step.finishedAt = Date.now();
      if (branch) step.branch = branch;

      // Parou aqui? (execução parcial)
      if (nodeId === this.stopAt) return;

      // Segue edges
      if (branch) {
        for (const e of this.edges.filter(e => e.from === nodeId && (e.fromPort || "out") === branch))
          await this._exec(e.to, outItems);
      } else {
        for (const e of this.edges.filter(e => e.from === nodeId))
          await this._exec(e.to, outItems);
      }
    } catch (e) {
      step.status = "error";
      step.error = e.message;
      step.finishedAt = Date.now();
    }
  }

  async _run(node, inputItems) {
    const c = node.config || {};
    switch (node.type) {
      case "webhook":
      case "manualTrigger":
        return inputItems;
      case "httpRequest":  return this._http(c, node, inputItems);
      case "set":          return this._set(c, node, inputItems);
      case "if":           return this._if(c, node, inputItems);
      case "code":         return this._code(c, node, inputItems);
      case "respondWebhook": return this._respond(c, node, inputItems);
      case "delay":        return this._delay(c, inputItems);
      case "note":         return inputItems;
      default:             return inputItems;
    }
  }

  /* ---------- Nós ---------- */

  async _http(c, node, items) {
    // Executa por item (padrão n8n)
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const ctx = this._ctx(node, items, i);
      const url = this._interp(c.url || "", ctx);
      if (!url) throw new Error("URL vazia");
      const method = c.method || "GET";
      const hdrs = {};
      try { Object.assign(hdrs, JSON.parse(this._interp(c.headers || "{}", ctx))); } catch {}
      if (!hdrs["Content-Type"]) hdrs["Content-Type"] = "application/json";
      let body;
      if (["POST", "PUT", "PATCH"].includes(method) && c.body) body = this._interp(c.body, ctx);
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), (c.timeout || 30) * 1000);
      try {
        const r = await fetch(url, { method, headers: hdrs, body: body || undefined, signal: ctrl.signal });
        clearTimeout(tmr);
        const txt = await r.text();
        let js; try { js = JSON.parse(txt); } catch { js = txt; }
        results.push({ json: { statusCode: r.status, headers: Object.fromEntries(r.headers), body: js } });
      } catch (e) {
        clearTimeout(tmr);
        throw new Error("HTTP: " + e.message);
      }
    }
    return results;
  }

  _set(c, node, items) {
    if (c.mode === "json") {
      // JSON completo por item
      return items.map((_, i) => {
        const ctx = this._ctx(node, items, i);
        try { return { json: JSON.parse(this._interp(c.json || "{}", ctx)) }; }
        catch (e) { throw new Error("JSON inválido: " + e.message); }
      });
    }
    // Campos manuais: merge no json de cada item
    return items.map((item, i) => {
      const ctx = this._ctx(node, items, i);
      const out = { ...item.json };
      for (const p of (c.values || [])) {
        if (p.key) out[p.key] = this._interp(p.value || "", ctx);
      }
      return { json: out };
    });
  }

  _if(c, node, items) {
    // Divide items em true/false. Emite no branch com mais items;
    // se ambos têm items, engine trata via edge routing múltiplo.
    // Simplificação: um item avalia; agrupamos no fim.
    // Comportamento AIS: primeiro item define branch, todos os items seguem juntos.
    const ctx = this._ctx(node, items, 0);
    const field = this._resolve(c.field || "", ctx);
    const val = this._interp(String(c.value ?? ""), ctx);
    let r = false;
    switch (c.operator) {
      case "equals":    r = String(field) === String(val); break;
      case "notEquals": r = String(field) !== String(val); break;
      case "contains":  r = String(field).includes(String(val)); break;
      case "gt":        r = Number(field) > Number(val); break;
      case "lt":        r = Number(field) < Number(val); break;
      case "gte":       r = Number(field) >= Number(val); break;
      case "lte":       r = Number(field) <= Number(val); break;
      case "exists":    r = field !== undefined && field !== null; break;
      case "notEmpty":  r = field !== undefined && field !== null && field !== ""; break;
      default: r = !!field;
    }
    return { __branch: r ? "true" : "false", items };
  }

  _code(c, node, items) {
    const first = firstJson(items);
    const box = {
      // n8n-style aliases
      $input: {
        all: () => items,
        first: () => items[0] || { json: {} },
        last: () => items[items.length - 1] || { json: {} },
        item: items[0] || { json: {} },
      },
      $json: first,
      $node: this._nodeProxy(),
      items,        // atalho AIS
      input: first, // legado
      result: null,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      ...buildGlobals(),
      setTimeout: undefined, setInterval: undefined,
    };
    if (DateTime) box.$now = DateTime.now();
    try { vm.runInNewContext(c.code || "result = $json;", box, { timeout: 5000 }); }
    catch (e) { throw new Error("Código: " + e.message); }
    // Aceita várias formas de retorno:
    // - result = objeto → 1 item
    // - result = array de objetos → múltiplos items
    // - result = array de items ([{json:...}]) → passa direto
    if (box.result == null) return items;
    return box.result;
  }

  _respond(c, node, items) {
    const ctx = this._ctx(node, items, 0);
    let body; try { body = this._interp(c.body || "", ctx); } catch { body = ""; }
    let hdrs = {}; try { hdrs = JSON.parse(c.headers || "{}"); } catch {}
    this.webhookResponse = { statusCode: c.responseCode || 200, body, headers: hdrs };
    return items;
  }

  async _delay(c, items) {
    const ms = (c.amount || 1) * (c.unit === "minutes" ? 60000 : 1000);
    await new Promise(r => setTimeout(r, Math.min(ms, 300000)));
    return items;
  }

  /* ---------- Expression engine (n8n-style) ---------- */

  /**
   * Contexto de expressão para o item `index` do nó atual.
   */
  _ctx(node, items, index) {
    return {
      node, items, index,
      $json: (items[index] || { json: {} }).json,
      $input: {
        all: () => items,
        first: () => items[0] || { json: {} },
        last: () => items[items.length - 1] || { json: {} },
        item: items[index] || { json: {} },
      },
      $node: this._nodeProxy(),
      $item: items[index] || { json: {} },
      $itemIndex: index,
    };
  }

  /** Proxy para acessar dados de outros nós: $node["Nome"].json */
  _nodeProxy() {
    const rd = this.runData;
    return new Proxy({}, {
      get: (_, name) => {
        const items = rd[name];
        if (!items) return { json: {}, all: () => [], first: () => ({ json: {} }) };
        return {
          json: firstJson(items),
          all: () => items,
          first: () => items[0] || { json: {} },
          last: () => items[items.length - 1] || { json: {} },
        };
      }
    });
  }

  /**
   * Interpola template {{ ... }} com contexto de expressão.
   * Se a string toda é uma expressão, retorna o valor tipado (não string).
   */
  _interp(str, ctx) {
    const s = String(str);
    // String inteira é uma única expressão? → retorna valor tipado
    const match = s.match(/^\s*\{\{([\s\S]+)\}\}\s*$/);
    if (match) {
      try { return this._evalExpr(match[1].trim(), ctx); } catch { return ""; }
    }
    return s.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr) => {
      try {
        const v = this._evalExpr(expr.trim(), ctx);
        return v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
      } catch { return ""; }
    });
  }

  _evalExpr(expr, ctx) {
    // Fast path para dot-path simples sobre $json
    if (/^\$json(\.[a-zA-Z_]\w*)*$/.test(expr)) {
      let v = ctx.$json;
      for (const p of expr.slice(6).split(".").filter(Boolean)) {
        if (v == null) return undefined;
        v = v[p];
      }
      return v;
    }
    // Legado: $input.body.x → $json.body.x se input for objeto simples
    if (/^\$input(\.[a-zA-Z_]\w*)+$/.test(expr)) {
      const path = expr.slice(7).split(".");
      let v = ctx.$json;
      for (const p of path) { if (v == null) return undefined; v = v[p]; }
      return v;
    }
    // Expressão JS geral
    const sandbox = { ...ctx, ...buildGlobals() };
    return vm.runInNewContext(expr, sandbox, { timeout: 1000 });
  }

  _resolve(expr, ctx) {
    if (!expr) return undefined;
    // Se tem {{ }}, delega ao interpolador
    if (expr.includes("{{")) return this._interp(expr, ctx);
    // dot-path simples relativo ao $json
    if (/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(expr)) {
      let v = ctx.$json;
      for (const p of expr.split(".")) {
        if (v == null) return undefined;
        v = v[p];
      }
      return v;
    }
    // Expressão JS geral
    try { return this._evalExpr(expr, ctx); } catch { return undefined; }
  }

  _safe(obj) {
    try {
      const s = JSON.stringify(obj);
      return s.length > 50000 ? { _truncated: true, preview: s.slice(0, 500) } : JSON.parse(s);
    } catch { return String(obj).slice(0, 500); }
  }
}

module.exports = { Engine };
