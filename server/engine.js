/* =====================================================================
   A.I.S. — Motor de execução (server-side)
   Executa um fluxo: percorre os nós seguindo as arestas, roda cada nó,
   registra cada passo, e retorna o resultado completo.
   ===================================================================== */
"use strict";
const vm = require("vm");

class Engine {
  constructor(flow) {
    this.flow = flow;
    this.nodesMap = new Map((flow.nodes||[]).map(n=>[n.id,n]));
    this.edges = flow.edges || [];
    this.steps = [];
    this.webhookResponse = null;
  }

  async run(triggerNodeId, triggerData={}) {
    const id = "exec_" + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    const t0 = Date.now();
    try {
      await this._exec(triggerNodeId, triggerData);
      return { id, flowId:this.flow.id, status: this.steps.some(s=>s.status==="error")?"error":"success",
        startedAt:t0, finishedAt:Date.now(), steps:this.steps, webhookResponse:this.webhookResponse };
    } catch(e) {
      return { id, flowId:this.flow.id, status:"error", startedAt:t0, finishedAt:Date.now(),
        steps:this.steps, error:e.message, webhookResponse:this.webhookResponse };
    }
  }

  async _exec(nodeId, input) {
    const node = this.nodesMap.get(nodeId);
    if(!node) return;
    const step = { nodeId, nodeName:node.name, nodeType:node.type, status:"running",
      startedAt:Date.now(), input: this._safe(input), output:null, error:null };
    this.steps.push(step);
    try {
      const out = await this._run(node, input);
      step.output = this._safe(out); step.status = "success"; step.finishedAt = Date.now();
      // follow edges
      if (node.type === "if") {
        const branch = out?.__branch || "true";
        const data = out?.data ?? out;
        for (const e of this.edges.filter(e=>e.from===nodeId && (e.fromPort||"out")===branch))
          await this._exec(e.to, data);
      } else {
        for (const e of this.edges.filter(e=>e.from===nodeId))
          await this._exec(e.to, out);
      }
    } catch(e) { step.status="error"; step.error=e.message; step.finishedAt=Date.now(); }
  }

  async _run(node, input) {
    const c = node.config || {};
    switch(node.type) {
      case "webhook": case "manualTrigger": return input||{};
      case "httpRequest": return this._http(c,input);
      case "set": return this._set(c,input);
      case "if": return this._if(c,input);
      case "code": return this._code(c,input);
      case "respondWebhook": return this._respond(c,input);
      case "delay": return this._delay(c,input);
      case "note": return input;
      default: return input;
    }
  }

  async _http(c, input) {
    const url = this._interp(c.url||"",input);
    if(!url) throw new Error("URL vazia");
    const method = c.method||"GET";
    const hdrs = {}; try{Object.assign(hdrs,JSON.parse(this._interp(c.headers||"{}",input)));}catch{}
    if(!hdrs["Content-Type"]) hdrs["Content-Type"]="application/json";
    let body; if(["POST","PUT","PATCH"].includes(method)&&c.body) body=this._interp(c.body,input);
    const ctrl = new AbortController();
    const tmr = setTimeout(()=>ctrl.abort(), (c.timeout||30)*1000);
    try {
      const r = await fetch(url,{method,headers:hdrs,body:body||undefined,signal:ctrl.signal});
      clearTimeout(tmr);
      const txt = await r.text(); let js; try{js=JSON.parse(txt);}catch{js=txt;}
      return {statusCode:r.status, headers:Object.fromEntries(r.headers), body:js};
    } catch(e){ clearTimeout(tmr); throw new Error("HTTP: "+e.message); }
  }

  _set(c, input) {
    if(c.mode==="json") {
      try { return JSON.parse(this._interp(c.json||"{}",input)); }
      catch(e){ throw new Error("JSON inválido: "+e.message); }
    }
    const out = {...input};
    for(const p of (c.values||[])) { if(p.key) out[p.key]=this._interp(p.value||"",input); }
    return out;
  }

  _if(c, input) {
    const field = this._resolve(c.field||"",input);
    const val = c.value; let r = false;
    switch(c.operator){
      case "equals":    r = String(field)===String(val); break;
      case "notEquals": r = String(field)!==String(val); break;
      case "contains":  r = String(field).includes(String(val)); break;
      case "gt": r = Number(field)>Number(val); break;
      case "lt": r = Number(field)<Number(val); break;
      case "gte": r = Number(field)>=Number(val); break;
      case "lte": r = Number(field)<=Number(val); break;
      case "exists":   r = field!==undefined&&field!==null; break;
      case "notEmpty": r = field!==undefined&&field!==null&&field!==""; break;
      default: r = !!field;
    }
    return { __branch: r?"true":"false", data:input, result:r };
  }

  _code(c, input) {
    const box = { input, result:null, console:{log:()=>{}} };
    try { vm.runInNewContext(c.code||"result = input;", box, {timeout:5000}); }
    catch(e){ throw new Error("Código: "+e.message); }
    return box.result!==null? box.result : input;
  }

  _respond(c, input) {
    let body; try { body = this._interp(c.body||"",input); } catch{ body=""; }
    let hdrs = {}; try{hdrs=JSON.parse(c.headers||"{}");}catch{}
    this.webhookResponse = { statusCode:c.responseCode||200, body, headers:hdrs };
    return input;
  }

  async _delay(c, input) {
    const ms = (c.amount||1)*(c.unit==="minutes"?60000:1000);
    await new Promise(r=>setTimeout(r, Math.min(ms,300000)));
    return input;
  }

  _interp(str, data) {
    return String(str).replace(/\{\{(.+?)\}\}/g, (_,expr)=>{
      try{return String(this._resolve(expr.trim(),data))??"";} catch{return"";}
    });
  }
  _resolve(expr, data) {
    if(expr==="$input") return data;
    if(expr.startsWith("$input.")) expr=expr.slice(7);
    let v=data; for(const p of expr.split(".")){ if(v==null)return undefined; v=v[p]; }
    return v;
  }
  _safe(obj) {
    try{ const s=JSON.stringify(obj); return s.length>50000?{_truncated:true,preview:s.slice(0,500)}:JSON.parse(s); }
    catch{ return String(obj).slice(0,500); }
  }
}

module.exports = { Engine };
