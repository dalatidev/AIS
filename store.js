/* =====================================================================
   A.I.S. — Camada de dados (store) v2
   Detecta ambiente (servidor vs estático). Gerencia:
   Fluxos, Credenciais, Pastas, Execuções, Import/Export.
   ===================================================================== */
(() => {
  "use strict";
  const TOK_KEY="ais.token", MODE_KEY="ais.mode";
  const uid=()=>"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const token=()=>localStorage.getItem(TOK_KEY)||"";

  /* === localStorage helpers === */
  const ls={
    _g(k){try{return JSON.parse(localStorage.getItem(k))||{};}catch{return{};}},
    _s(k,v){localStorage.setItem(k,JSON.stringify(v));}
  };

  /* === Local backend === */
  function localCRUD(key){
    return {
      async list(sortFn){const v=Object.values(ls._g(key));return sortFn?v.sort(sortFn):v;},
      async get(id){return ls._g(key)[id]||null;},
      async create(obj){const d=ls._g(key);const id=obj.id||uid();const now=Date.now();
        d[id]={...obj,id,createdAt:obj.createdAt||now,updatedAt:now};ls._s(key,d);return d[id];},
      async update(id,patch){const d=ls._g(key);if(!d[id])return null;
        d[id]={...d[id],...patch,id,updatedAt:Date.now()};ls._s(key,d);return d[id];},
      async remove(id){const d=ls._g(key);delete d[id];ls._s(key,d);return true;},
      async duplicate(id){const d=ls._g(key);if(!d[id])return null;const nid=uid();
        d[nid]={...structuredClone(d[id]),id:nid,name:(d[id].name||"")+" (cópia)",createdAt:Date.now(),updatedAt:Date.now()};
        ls._s(key,d);return d[nid];}
    };
  }
  const localFlows=localCRUD("ais.flows");
  const localCreds=localCRUD("ais.credentials");
  const localFolders=localCRUD("ais.folders");

  /* === Server (API) backend === */
  async function api(method,url,body){
    const r=await fetch(url,{method,headers:{"Content-Type":"application/json","X-AIS-Token":token()},
      body:body?JSON.stringify(body):undefined});
    if(r.status===401){const e=new Error("unauthorized");e.code=401;throw e;}
    if(!r.ok)throw new Error("api "+r.status);
    return r.status===204?null:r.json();
  }
  function serverCRUD(base){
    return {
      async list(){return api("GET",base);},
      async get(id){try{return await api("GET",base+"/"+id);}catch{return null;}},
      async create(obj){return api("POST",base,obj);},
      async update(id,patch){return api("PUT",base+"/"+id,patch);},
      async remove(id){await api("DELETE",base+"/"+id);return true;},
      async duplicate(id){const f=await this.get(id);if(!f)return null;
        const c=await this.create({...f,name:(f.name||"")+" (cópia)"});
        if(f.nodes)await this.update(c.id,{nodes:f.nodes,edges:f.edges});return this.get(c.id);}
    };
  }
  const serverFlows=serverCRUD("/api/flows");
  const serverCreds=serverCRUD("/api/credentials");
  const serverFolders=serverCRUD("/api/folders");

  /* === Detecção === */
  async function detect(){
    try{const r=await fetch("/api/ping",{cache:"no-store"});
      if(r.ok){const j=await r.json();if(j&&j.ok)return"server";}}catch{}
    return"local";
  }

  /* === Store principal === */
  const S={
    mode:"local",
    ready:null,

    async init(){
      if(this.ready)return this.ready;
      this.ready=(async()=>{
        this.mode=await detect();
        localStorage.setItem(MODE_KEY,this.mode);
        return this.mode;
      })();
      return this.ready;
    },
    isServer(){return this.mode==="server";},
    hasToken(){return!!token();},
    setToken(t){localStorage.setItem(TOK_KEY,t||"");},
    clearToken(){localStorage.removeItem(TOK_KEY);},
    async checkAuth(){if(this.mode!=="server")return true;
      try{await api("GET","/api/flows");return true;}catch(e){return e.code!==401;}},

    // Flows
    _fb(){return this.mode==="server"?serverFlows:localFlows;},
    list(...a){return this._fb().list(...a);},
    get(...a){return this._fb().get(...a);},
    create(name,extra){return this._fb().create({name:name||"Fluxo sem título",nodes:[],edges:[],...extra});},
    update(...a){return this._fb().update(...a);},
    remove(...a){return this._fb().remove(...a);},
    duplicate(...a){return this._fb().duplicate(...a);},

    // Credentials
    _cb(){return this.mode==="server"?serverCreds:localCreds;},
    listCredentials(){return this._cb().list();},
    getCredential(id){return this._cb().get(id);},
    createCredential(obj){return this._cb().create(obj);},
    updateCredential(id,p){return this._cb().update(id,p);},
    removeCredential(id){return this._cb().remove(id);},

    // Folders
    _flb(){return this.mode==="server"?serverFolders:localFolders;},
    listFolders(){return this._flb().list();},
    createFolder(obj){return this._flb().create(obj);},
    updateFolder(id,p){return this._flb().update(id,p);},
    removeFolder(id){return this._flb().remove(id);},

    // Executions (global, server only)
    async listAllExecutions(){
      if(this.mode!=="server")return[];
      try{return await api("GET","/api/all-executions");}catch{return[];}
    },
    async listFlowExecutions(flowId){
      if(this.mode!=="server")return[];
      try{return await api("GET","/api/executions/"+flowId);}catch{return[];}
    },

    // Import / Export
    async exportFlow(id){
      if(this.mode==="server"){
        try{return await api("GET",`/api/flows/${id}/export`);}catch{}
      }
      const f=await this.get(id);
      return f?{ais_export:true,version:1,flow:f}:null;
    },
    async importFlow(data){
      const src=data.flow||data;
      if(this.mode==="server"){
        try{return await api("POST","/api/flows/import",data);}catch{}
      }
      return localFlows.create({...src,name:(src.name||"Importado")+" (importado)"});
    },
  };

  window.AISStore=S;
})();
