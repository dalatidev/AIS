/* =====================================================================
   A.I.S. — Sistema de nós (v2)
   Tipos: Webhook, Manual Trigger, HTTP Request, Set, IF, Code,
          Respond to Webhook, Delay, Note
   + Edges (conexões visuais) + Painel de execuções
   ===================================================================== */
(() => {
"use strict";
const TYPES = {};
let selectedId = null, cfgOpen = false, execPanelOpen = false;
let connecting = null; // { fromId, fromPort }
let clipboardNode = null, replaceNodeId = null;
let $world, $cfgPanel, $cfgScrim, $palBody, $palEmpty, $execPanel, $edgesSvg;

const esc = s => { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; };
const uid = () => "nd_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
let saveTimer;
function save(){ if(AIS.persist) AIS.persist(); }
function saveLater(){ clearTimeout(saveTimer); saveTimer=setTimeout(save,400); }
function findNode(id){ return AIS.flow?.nodes?.find(n=>n.id===id)||null; }
function registerType(d){ TYPES[d.type]=d; }

// Expõe register cedo para os arquivos em nos/ auto-registrarem antes do init.
window.AISNodes = { register: registerType, TYPES };

/* ===== Init ===== */
function init(){
  $world=AIS.world; $edgesSvg=document.getElementById("edges");
  $cfgPanel=document.getElementById("configPanel");
  $cfgScrim=document.getElementById("configScrim");
  $execPanel=document.getElementById("execPanel");
  $palBody=document.querySelector(".palette-body");
  $palEmpty=document.getElementById("paletteEmpty");
  populatePalette(); renderAllNodes(); renderEdges();
  setupCanvasDeselect(); setupKeys(); setupPaletteSearch();
  AIS.refreshEmpty();
  // snapshot inicial pro undo
  history.stack=[snapshot()]; history.idx=0; updateUndoUI();
}

/* ===== Palette ===== */
function populatePalette(){
  const cats={}; for(const[,d]of Object.entries(TYPES)){(cats[d.category]=cats[d.category]||[]).push(d);}
  if(!Object.keys(cats).length)return; $palEmpty.style.display="none";
  const order=["Gatilhos","Ações","Dados","Lógica","Outros"];
  const sorted=order.filter(c=>cats[c]).concat(Object.keys(cats).filter(c=>!order.includes(c)));
  for(const cat of sorted){ const defs=cats[cat]; if(!defs)continue;
    const lbl=document.createElement("div"); lbl.className="pal-cat"; lbl.textContent=cat;
    $palBody.insertBefore(lbl,$palEmpty);
    for(const def of defs){
      const it=document.createElement("div"); it.className="pal-item"; it.dataset.type=def.type;
      it.dataset.search=(def.name+" "+def.desc+" "+cat).toLowerCase();
      it.innerHTML=`<div class="pal-icon" style="background:${def.color}">${def.icon}</div>
        <div class="pal-info"><b>${def.name}</b><span>${def.desc}</span></div>
        ${def.trigger?'<span class="pal-badge">Gatilho</span>':""}`;
      it.onclick=()=>{if(replaceNodeId){replaceNodeWith(replaceNodeId,def.type);replaceNodeId=null;}else{addNodeToCenter(def.type);}closePalette();};
      $palBody.insertBefore(it,$palEmpty);
    }
  }
}
function setupPaletteSearch(){
  const inp=document.getElementById("paletteSearch");
  inp.addEventListener("input",()=>{
    const q=inp.value.trim().toLowerCase(); let any=false;
    $palBody.querySelectorAll(".pal-item").forEach(el=>{const v=!q||el.dataset.search.includes(q);el.style.display=v?"":"none";if(v)any=true;});
    $palBody.querySelectorAll(".pal-cat").forEach(el=>el.style.display=q?"none":"");
    $palEmpty.style.display=any?"none":""; if(!any)$palEmpty.querySelector("b").textContent=q?"Nenhum nó encontrado":"Nenhum nó ainda";
  });
}
function closePalette(){
  document.getElementById("scrim").classList.remove("open");
  document.getElementById("palette").classList.remove("open");
  const inp=document.getElementById("paletteSearch"); inp.value=""; inp.dispatchEvent(new Event("input"));
  replaceNodeId=null;
}

/* ===== Histórico (undo/redo) ===== */
const history={stack:[],idx:-1,MAX:50};
function snapshot(){ return JSON.stringify({nodes:AIS.flow.nodes||[],edges:AIS.flow.edges||[]}); }
function pushHistory(){
  if(!AIS.flow)return;
  const snap=snapshot();
  // não empilha se igual ao topo
  if(history.stack[history.idx]===snap)return;
  history.stack=history.stack.slice(0,history.idx+1);
  history.stack.push(snap);
  if(history.stack.length>history.MAX)history.stack.shift();
  history.idx=history.stack.length-1;
  updateUndoUI();
}
function restore(snap){
  const s=JSON.parse(snap);
  AIS.flow.nodes=s.nodes;
  AIS.flow.edges=s.edges;
  // Re-render
  $world.querySelectorAll(".ais-node").forEach(el=>el.remove());
  renderAllNodes(); renderEdges();
  AIS.refreshEmpty(); save();
  updateUndoUI();
}
function undo(){ if(history.idx<=0)return false; history.idx--; restore(history.stack[history.idx]); return true; }
function redo(){ if(history.idx>=history.stack.length-1)return false; history.idx++; restore(history.stack[history.idx]); return true; }
function updateUndoUI(){
  const b=document.getElementById("btnUndo");
  if(b){ b.disabled=history.idx<=0; b.style.opacity=history.idx<=0?".4":"1"; }
}

/* ===== Auto layout ===== */
function autoLayout(){
  if(!AIS.flow||!AIS.flow.nodes||!AIS.flow.nodes.length)return;
  pushHistory();
  const nodes=AIS.flow.nodes, edges=AIS.flow.edges||[];
  const outMap=new Map(), inMap=new Map();
  for(const n of nodes){outMap.set(n.id,[]); inMap.set(n.id,[]);}
  for(const e of edges){
    if(outMap.has(e.from)) outMap.get(e.from).push(e.to);
    if(inMap.has(e.to)) inMap.get(e.to).push(e.from);
  }
  // Coluna por camadas: BFS a partir de raízes (nós sem entrada)
  const col=new Map(); const visited=new Set();
  const roots=nodes.filter(n=>!inMap.get(n.id).length).map(n=>n.id);
  // Se não há raízes (fluxo cíclico), começa por um qualquer
  const queue=roots.length?roots.slice():nodes.length?[nodes[0].id]:[];
  for(const r of queue) col.set(r,0);
  while(queue.length){
    const id=queue.shift();
    if(visited.has(id))continue;
    visited.add(id);
    const c=col.get(id)||0;
    for(const next of outMap.get(id)||[]){
      const nc=Math.max(col.get(next)||0, c+1);
      col.set(next,nc);
      if(!visited.has(next))queue.push(next);
    }
  }
  // Nós isolados ficam na coluna 0
  for(const n of nodes) if(!col.has(n.id)) col.set(n.id,0);
  // Agrupa por coluna
  const cols={}; for(const n of nodes){ const c=col.get(n.id)||0; (cols[c]=cols[c]||[]).push(n); }
  // Reposiciona
  const COL_W=280, ROW_H=110, START_X=100, START_Y=100;
  Object.keys(cols).sort((a,b)=>+a-+b).forEach(c=>{
    const list=cols[c]; const totalH=(list.length-1)*ROW_H;
    list.forEach((n,i)=>{
      n.x=START_X + (+c)*COL_W;
      n.y=START_Y + i*ROW_H - totalH/2 + 200;
    });
  });
  // Re-render
  $world.querySelectorAll(".ais-node").forEach(el=>el.remove());
  renderAllNodes(); renderEdges();
  save();
}

/* ===== Add / Remove ===== */
function addNodeToCenter(type){
  if(!AIS.flow)return; const def=TYPES[type]; if(!def)return;
  const cv=document.getElementById("canvas"),r=cv.getBoundingClientRect();
  let x=Math.round((r.width/2-AIS.view.x)/AIS.view.k-110);
  let y=Math.round((r.height/2-AIS.view.y)/AIS.view.k-30);
  for(const n of AIS.flow.nodes){if(Math.abs(n.x-x)<40&&Math.abs(n.y-y)<40){x+=50;y+=50;}}
  const node={id:uid(),type,name:def.name,x,y,config:structuredClone(def.defaults)};
  if(type==="webhook"&&!node.config.path) node.config.path=node.id.slice(3,11);
  AIS.flow.nodes.push(node); renderNode(node); AIS.refreshEmpty(); pushHistory(); save();
  setTimeout(()=>{selectNode(node.id);openConfig(node.id);},80);
}
function removeNode(id){
  if(!AIS.flow)return; const i=AIS.flow.nodes.findIndex(n=>n.id===id); if(i===-1)return;
  AIS.flow.nodes.splice(i,1);
  AIS.flow.edges=(AIS.flow.edges||[]).filter(e=>e.from!==id&&e.to!==id);
  $world.querySelector(`.ais-node[data-id="${id}"]`)?.remove();
  if(selectedId===id){selectedId=null;closeConfig();}
  renderEdges(); AIS.refreshEmpty(); pushHistory(); save();
}

/* ===== Render nodes ===== */
function renderAllNodes(){ if(!AIS.flow?.nodes)return; for(const n of AIS.flow.nodes)renderNode(n); }
function renderNode(node){
  const def=TYPES[node.type]; if(!def)return;
  const el=document.createElement("div"); el.className="ais-node"; el.dataset.id=node.id;
  if(node.disabled) el.classList.add("disabled");
  el.style.transform=`translate(${node.x}px,${node.y}px)`;
  const hasIf=node.type==="if";
  el.innerHTML=`
    <div class="node-toolbar">
      <button class="ntb" data-act="run" title="Executar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 14 9-14 9V3z"/></svg></button>
      <button class="ntb${node.disabled?' active-toggle':''}" data-act="toggle" title="${node.disabled?'Ativar':'Desativar'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg></button>
      <button class="ntb ntb-danger" data-act="del" title="Excluir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      <div class="ntb-more-wrap">
        <button class="ntb" data-act="more" title="Mais opções"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
        <div class="node-menu">
          <button data-act="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Renomear</button>
          <button data-act="replace"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>Substituir</button>
          <div class="nm-sep"></div>
          <button data-act="copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar</button>
          <button data-act="dup"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/></svg>Duplicar</button>
        </div>
      </div>
    </div>
    ${def.trigger?"":'<div class="node-port port-in" data-port="in"></div>'}
    <div class="node-body">
      <div class="node-icon" style="background:${def.color}">${def.icon}</div>
      <div class="node-info"><div class="node-name">${esc(node.name)}</div><div class="node-desc">${getSubtitle(node)}</div></div>
    </div>
    ${hasIf?`<div class="node-port port-out port-true" data-port="true" title="True"></div>
             <div class="node-port port-out port-false" data-port="false" title="False"></div>`
           :'<div class="node-port port-out" data-port="out"></div>'}`;
  setupDrag(el,node); setupPortClicks(el,node);
  const body=el.querySelector(".node-body");
  const openIt=e=>{ e.stopPropagation(); if(el.classList.contains("dragging"))return;
    selectNode(node.id); openConfig(node.id); };
  body.addEventListener("dblclick",openIt);
  let lastClickTime=0;
  body.addEventListener("click",e=>{
    e.stopPropagation(); if(el.classList.contains("dragging"))return;
    const now=Date.now();
    if(now-lastClickTime<500){ lastClickTime=0; openIt(e); }
    else lastClickTime=now;
  });
  // --- Toolbar handlers ---
  const toolbar=el.querySelector(".node-toolbar");
  const nodeMenu=el.querySelector(".node-menu");
  el.querySelectorAll(".ntb[data-act]").forEach(btn=>{
    btn.addEventListener("click",e=>{
      e.stopPropagation();
      const act=btn.dataset.act;
      if(act==="run") runFlow();
      else if(act==="toggle") toggleDisable(node.id);
      else if(act==="del"){ if(confirm("Excluir este nó?")) removeNode(node.id); }
      else if(act==="more"){
        document.querySelectorAll(".node-menu.open").forEach(m=>m.classList.remove("open"));
        document.querySelectorAll(".node-toolbar.pinned").forEach(t=>t.classList.remove("pinned"));
        nodeMenu.classList.toggle("open");
        toolbar.classList.toggle("pinned",nodeMenu.classList.contains("open"));
      }
    });
  });
  nodeMenu.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click",e=>{
      e.stopPropagation();
      nodeMenu.classList.remove("open");
      toolbar.classList.remove("pinned");
      const act=btn.dataset.act;
      if(act==="rename") renameNodePrompt(node.id);
      else if(act==="replace") startReplace(node.id);
      else if(act==="copy") copyNode(node.id);
      else if(act==="dup") duplicateNode(node.id);
    });
  });
  $world.appendChild(el);
}
// Alias para renderizar nó do snapshot (sem adicionar ao array)
function addNodeDirect(node){ renderNode(node); }
function getSubtitle(n){
  const c=n.config||{};
  switch(n.type){
    case"webhook":return `${c.method||"POST"} · /${esc(c.path||"...")}`;
    case"httpRequest":return `${c.method||"GET"} · ${esc((c.url||"...").slice(0,30))}`;
    case"set":return c.mode==="json"?"JSON":"Campos";
    case"if":return `${esc(c.field||"...")} ${c.operator||"?"} ${esc(c.value||"")}`;
    case"code":return "JavaScript";
    case"delay":return `${c.amount||1} ${c.unit==="minutes"?"min":"seg"}`;
    case"respondWebhook":return `HTTP ${c.responseCode||200}`;
    default:return"";
  }
}
function refreshNodeEl(node){
  const el=$world.querySelector(`.ais-node[data-id="${node.id}"]`);
  if(!el)return; el.querySelector(".node-name").textContent=node.name;
  el.querySelector(".node-desc").innerHTML=getSubtitle(node);
}

/* ===== Drag ===== */
function setupDrag(el,node){
  let dragging=false,sx,sy,nx,ny;
  function onDown(e){
    if(e.target.classList.contains("node-port"))return; e.stopPropagation();
    const p=e.touches?e.touches[0]:e; sx=p.clientX;sy=p.clientY;nx=node.x;ny=node.y;dragging=false;
    // Seleciona logo (não abre config — isso é só no dblclick)
    selectNode(node.id);
    const onMove=e2=>{const p2=e2.touches?e2.touches[0]:e2;const dx=(p2.clientX-sx)/AIS.view.k;const dy=(p2.clientY-sy)/AIS.view.k;
      if(!dragging&&Math.abs(dx)+Math.abs(dy)<3)return;dragging=true;el.classList.add("dragging");
      node.x=Math.round(nx+dx);node.y=Math.round(ny+dy);el.style.transform=`translate(${node.x}px,${node.y}px)`;renderEdges();};
    const onUp=()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);
      window.removeEventListener("touchmove",onMove);window.removeEventListener("touchend",onUp);
      el.classList.remove("dragging");if(dragging){pushHistory();save();}};
    window.addEventListener("mousemove",onMove);window.addEventListener("mouseup",onUp);
    window.addEventListener("touchmove",onMove,{passive:true});window.addEventListener("touchend",onUp);
  }
  el.addEventListener("mousedown",onDown);el.addEventListener("touchstart",onDown,{passive:true});
}

/* ===== Edges (conexões via arrastar) ===== */
function setupPortClicks(el,node){
  el.querySelectorAll(".node-port").forEach(port=>{
    const portId=port.dataset.port;
    const onDown=e=>{
      e.stopPropagation(); e.preventDefault();
      if(portId==="in"){
        // Se já estiver arrastando de uma saída, completa aqui
        if(connecting){completeConnection(node.id);return;}
        return; // não inicia conexão a partir de porta de entrada
      }
      // Inicia arraste a partir de porta de saída
      startConnection(node.id,portId,e);
    };
    port.addEventListener("mousedown",onDown);
    port.addEventListener("touchstart",onDown,{passive:false});
  });
}

function screenToWorld(clientX,clientY){
  const cv=document.getElementById("canvas");
  const r=cv.getBoundingClientRect();
  return {
    x:(clientX-r.left-AIS.view.x)/AIS.view.k,
    y:(clientY-r.top-AIS.view.y)/AIS.view.k
  };
}

function startConnection(fromId,fromPort,evt){
  connecting={fromId,fromPort};
  document.getElementById("canvas").classList.add("connecting-mode");

  // Cria path temporário
  const tempPath=document.createElementNS("http://www.w3.org/2000/svg","path");
  tempPath.setAttribute("class","edge temp");
  $edgesSvg.appendChild(tempPath);

  const from=getPortPos(fromId,fromPort);
  const updateTemp=(mx,my)=>{
    if(!from)return;
    const dx=Math.max(Math.abs(mx-from.x)*0.5,40);
    tempPath.setAttribute("d",`M${from.x},${from.y} C${from.x+dx},${from.y} ${mx-dx},${my} ${mx},${my}`);
  };

  // Posição inicial (para caso não haja movimento antes do up)
  const p0=evt.touches?evt.touches[0]:evt;
  const w0=screenToWorld(p0.clientX,p0.clientY);
  updateTemp(w0.x,w0.y);

  const onMove=e=>{
    const p=e.touches?e.touches[0]:e;
    const w=screenToWorld(p.clientX,p.clientY);
    // detecta hover sobre uma porta de entrada
    const el=document.elementFromPoint(p.clientX,p.clientY);
    const port=el?.closest?.(".port-in");
    if(port){
      const nid=port.closest(".ais-node")?.dataset.id;
      if(nid&&nid!==fromId){
        const tp=getPortPos(nid,"in");
        if(tp){updateTemp(tp.x,tp.y);return;}
      }
    }
    updateTemp(w.x,w.y);
  };
  const onUp=e=>{
    window.removeEventListener("mousemove",onMove);
    window.removeEventListener("mouseup",onUp);
    window.removeEventListener("touchmove",onMove);
    window.removeEventListener("touchend",onUp);
    const p=e.changedTouches?e.changedTouches[0]:e;
    const el=document.elementFromPoint(p.clientX,p.clientY);
    // aceita drop sobre porta OU sobre o corpo do nó (mais tolerante)
    let target=el?.closest?.(".port-in");
    let nid=target?.closest(".ais-node")?.dataset.id;
    if(!nid){
      const nodeEl=el?.closest?.(".ais-node");
      if(nodeEl){
        const cand=nodeEl.dataset.id;
        // só aceita se esse nó tem entrada (não é gatilho)
        const cnode=findNode(cand);
        if(cnode&&!TYPES[cnode.type]?.trigger)nid=cand;
      }
    }
    tempPath.remove();
    if(nid&&nid!==fromId)completeConnection(nid);
    else cancelConnection();
  };
  window.addEventListener("mousemove",onMove);
  window.addEventListener("mouseup",onUp);
  window.addEventListener("touchmove",onMove,{passive:false});
  window.addEventListener("touchend",onUp);
}

function completeConnection(toId){
  if(!connecting||connecting.fromId===toId)return cancelConnection();
  if(!AIS.flow.edges) AIS.flow.edges=[];
  const dup=AIS.flow.edges.some(e=>e.from===connecting.fromId&&(e.fromPort||"out")===connecting.fromPort&&e.to===toId);
  if(!dup){
    AIS.flow.edges.push({id:"e_"+Date.now().toString(36),from:connecting.fromId,fromPort:connecting.fromPort,to:toId});
    pushHistory(); save();
  }
  cancelConnection(); renderEdges();
}
function cancelConnection(){
  connecting=null;
  document.getElementById("canvas").classList.remove("connecting-mode");
  $edgesSvg.querySelectorAll(".edge.temp").forEach(p=>p.remove());
}
function getPortPos(nodeId,portType){
  const node=findNode(nodeId);const el=$world.querySelector(`.ais-node[data-id="${nodeId}"]`);
  if(!node||!el)return null;
  const body=el.querySelector(".node-body"); const w=body.offsetWidth||220; const h=body.offsetHeight||66;
  if(portType==="in")return{x:node.x,y:node.y+h/2};
  if(portType==="true")return{x:node.x+w,y:node.y+h*0.33};
  if(portType==="false")return{x:node.x+w,y:node.y+h*0.67};
  return{x:node.x+w,y:node.y+h/2};
}
function renderEdges(){
  if(!$edgesSvg)return; $edgesSvg.innerHTML="";
  for(const edge of(AIS.flow?.edges||[])){
    const fp=getPortPos(edge.from,edge.fromPort||"out"); const tp=getPortPos(edge.to,"in");
    if(!fp||!tp)continue;
    const dx=Math.max(Math.abs(tp.x-fp.x)*0.5,40);
    const d=`M${fp.x},${fp.y} C${fp.x+dx},${fp.y} ${tp.x-dx},${tp.y} ${tp.x},${tp.y}`;
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",d); path.setAttribute("class","edge "+(edge._status||""));
    path.dataset.id=edge.id;
    path.addEventListener("click",e=>{e.stopPropagation();
      if(confirm("Remover esta conexão?")){AIS.flow.edges=AIS.flow.edges.filter(x=>x.id!==edge.id);renderEdges();pushHistory();save();}
    });
    // label for IF branches
    if(edge.fromPort==="true"||edge.fromPort==="false"){
      const lbl=document.createElementNS("http://www.w3.org/2000/svg","text");
      lbl.setAttribute("x",(fp.x+20)); lbl.setAttribute("y",fp.y+(edge.fromPort==="true"?-6:6));
      lbl.setAttribute("class","edge-label"); lbl.textContent=edge.fromPort==="true"?"✓":"✗";
      $edgesSvg.appendChild(lbl);
    }
    $edgesSvg.appendChild(path);
  }
}

/* ===== Selection ===== */
function selectNode(id){deselectAll();selectedId=id;$world.querySelector(`.ais-node[data-id="${id}"]`)?.classList.add("selected");}
function deselectAll(){selectedId=null;$world.querySelectorAll(".ais-node.selected").forEach(e=>e.classList.remove("selected"));}
function setupCanvasDeselect(){
  document.getElementById("canvas").addEventListener("click",e=>{
    if(connecting){cancelConnection();return;}
    document.querySelectorAll(".node-menu.open").forEach(m=>m.classList.remove("open"));
    document.querySelectorAll(".node-toolbar.pinned").forEach(t=>t.classList.remove("pinned"));
    if(e.target.id==="canvas"||e.target.id==="grid"||e.target.id==="world"){deselectAll();closeConfig();}
  });
}

/* ===== Config Panel ===== */
function openConfig(nodeId){
  const node=findNode(nodeId);if(!node)return;const def=TYPES[node.type];if(!def)return;
  const readonly = AIS.execViewMode;
  cfgOpen=true;
  if(!readonly) closeExecPanel();
  let h=`<div class="cfg-head"><div class="cfg-head-icon" style="background:${def.color}">${def.icon}</div>
    <input class="cfg-name" value="${esc(node.name)}" spellcheck="false" ${readonly?"disabled":""}/>
    <button class="cfg-close" id="cfgClose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
  </div><div class="cfg-scroll">`;
  // Webhook URL
  if(node.type==="webhook"){
    const url=AISStore.isServer()?`${location.origin}/hook/${node.config.path||"..."}`:"";
    h+=`<div class="cfg-sec"><div class="cfg-sec-label">Webhook URL</div>
      <div class="cfg-url">${url?`<code id="cfgUrl">${esc(url)}</code><button class="cfg-url-copy" id="cfgCopy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`:'<span class="cfg-url-note">Disponível apenas com servidor</span>'}</div></div>`;
  }
  // Fields
  h+='<div class="cfg-sec"><div class="cfg-sec-label">Configurações</div>';
  for(const f of def.fields){
    if(f.showIf){const[k,v]=Object.entries(f.showIf)[0];if(node.config[k]!==v)continue;}
    h+=renderField(f,node.config[f.key],readonly);
  }
  // KV editor for Set manual mode
  if(node.type==="set"&&node.config.mode!=="json") h+='<label class="cfg-field"><span class="cfg-label">Campos</span><div id="kvEditor"></div></label>';
  h+="</div>";
  // Test (webhook) - hide in readonly
  if(!readonly && node.type==="webhook"&&AISStore.isServer()){
    h+=`<div class="cfg-sec"><div class="cfg-sec-label">Testar</div>
      <button class="btn cfg-test-btn" id="cfgTestBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/></svg>Verificar dados</button>
      <div class="cfg-test-data" id="cfgTestData">Nenhum dado recebido ainda.</div></div>`;
  }
  // Delete - hide in readonly
  if(!readonly){
    h+=`<div class="cfg-sec cfg-sec-danger"><button class="btn cfg-delete" id="cfgDelete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>Excluir nó</button></div>`;
  }
  h+="</div>";
  $cfgPanel.innerHTML=h; $cfgPanel.classList.add("open"); $cfgScrim.classList.add("open");
  document.getElementById("cfgClose").onclick=closeConfig; $cfgScrim.onclick=closeConfig;
  if(!readonly){
    const nameInp=$cfgPanel.querySelector(".cfg-name");
    nameInp.addEventListener("input",()=>{node.name=nameInp.value||def.name;refreshNodeEl(node);saveLater();});
    $cfgPanel.querySelectorAll("[data-cfg]").forEach(inp=>{const k=inp.dataset.cfg;
      const handler=()=>{node.config[k]=inp.type==="number"?Number(inp.value):inp.value;refreshNodeEl(node);saveLater();
        if(["auth","mode"].includes(k))openConfig(nodeId);
        if(k==="path"&&node.type==="webhook"){const u=document.getElementById("cfgUrl");if(u)u.textContent=`${location.origin}/hook/${node.config.path||"..."}`;}
      };inp.addEventListener("input",handler);inp.addEventListener("change",handler);
    });
    if(node.type==="set"&&node.config.mode!=="json") setupKVEditor(node);
    const testBtn=document.getElementById("cfgTestBtn"); if(testBtn)testBtn.onclick=()=>testWebhook(node);
    document.getElementById("cfgDelete").onclick=()=>{if(confirm("Excluir este nó?"))removeNode(node.id);};
  }
  const copyBtn=document.getElementById("cfgCopy"); if(copyBtn)copyBtn.onclick=copyUrl;
}
function closeConfig(){cfgOpen=false;$cfgPanel.classList.remove("open");$cfgScrim.classList.remove("open");}

function renderField(f,val,readonly){
  const v=val!==undefined?val:(f.default??"");
  const dis=readonly?"disabled":"";
  if(f.type==="select"){
    const opts=f.options.map(o=>{const ov=typeof o==="object"?o.value:o;const ol=typeof o==="object"?o.label:o;
      return`<option value="${ov}"${ov==v?" selected":""}>${esc(ol)}</option>`;}).join("");
    return`<label class="cfg-field"><span class="cfg-label">${f.label}</span><select class="cfg-input" data-cfg="${f.key}" ${dis}>${opts}</select></label>`;
  }
  if(f.type==="number")return`<label class="cfg-field"><span class="cfg-label">${f.label}</span><input type="number" class="cfg-input" data-cfg="${f.key}" value="${v}" min="${f.min??0}" max="${f.max??999}" ${dis}/></label>`;
  if(f.type==="textarea")return`<label class="cfg-field"><span class="cfg-label">${f.label}</span><textarea class="cfg-input cfg-textarea" data-cfg="${f.key}" rows="${f.rows||6}" placeholder="${f.placeholder||""}" ${dis}>${esc(String(v))}</textarea></label>`;
  return`<label class="cfg-field"><span class="cfg-label">${f.label}</span><input type="${f.type||"text"}" class="cfg-input" data-cfg="${f.key}" value="${esc(String(v))}" placeholder="${f.placeholder||""}" ${dis}/></label>`;
}
function setupKVEditor(node){
  const wrap=document.getElementById("kvEditor");if(!wrap)return;
  const vals=node.config.values||[];
  function render(){
    wrap.innerHTML=vals.map((p,i)=>`<div class="kv-row"><input class="cfg-input kv-key" value="${esc(p.key||"")}" placeholder="chave" data-i="${i}" data-f="key"/>
      <input class="cfg-input kv-val" value="${esc(p.value||"")}" placeholder="valor ou {{$input.x}}" data-i="${i}" data-f="value"/>
      <button class="kv-del" data-i="${i}">×</button></div>`).join("")+
      `<button class="btn kv-add" id="kvAdd">+ Campo</button>`;
    wrap.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{vals[+inp.dataset.i][inp.dataset.f]=inp.value;node.config.values=vals;saveLater();}));
    wrap.querySelectorAll(".kv-del").forEach(btn=>btn.addEventListener("click",()=>{vals.splice(+btn.dataset.i,1);node.config.values=vals;render();saveLater();}));
    document.getElementById("kvAdd")?.addEventListener("click",()=>{vals.push({key:"",value:""});node.config.values=vals;render();saveLater();});
  }
  render();
}

/* ===== Webhook test ===== */
async function testWebhook(node){
  const btn=document.getElementById("cfgTestBtn"),out=document.getElementById("cfgTestData");
  btn.disabled=true;btn.textContent="Verificando...";
  try{const r=await fetch("/api/webhook-test/"+encodeURIComponent(node.config.path||""),{headers:{"X-AIS-Token":localStorage.getItem("ais.token")||""}});
    const d=await r.json();
    if(d.lastHit){const w=new Date(d.lastHit.timestamp).toLocaleTimeString("pt-BR");
      out.innerHTML=`<div class="cfg-test-meta">${d.lastHit.method} · ${w} · ${d.count} total</div><pre class="cfg-test-json">${esc(JSON.stringify(d.lastHit.body,null,2))}</pre>`;
      out.classList.add("has-data");
    }else{out.textContent="Nenhum dado recebido ainda.";out.classList.remove("has-data");}
  }catch(e){out.textContent="Erro: "+e.message;}
  btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/></svg>Verificar dados';
}
function copyUrl(){const u=document.getElementById("cfgUrl");if(!u)return;
  navigator.clipboard.writeText(u.textContent).catch(()=>{});
  const b=document.getElementById("cfgCopy");if(b){b.style.color="#3ecf8e";setTimeout(()=>b.style.color="",800);}
}

/* ===== Node Toolbar Actions ===== */
function toggleDisable(id){
  const node=findNode(id); if(!node)return;
  node.disabled=!node.disabled;
  const el=$world.querySelector(`.ais-node[data-id="${id}"]`);
  if(el){
    el.classList.toggle("disabled",node.disabled);
    const btn=el.querySelector('.ntb[data-act="toggle"]');
    if(btn){ btn.classList.toggle("active-toggle",node.disabled); btn.title=node.disabled?"Ativar":"Desativar"; }
  }
  pushHistory(); save();
}
function duplicateNode(id){
  const node=findNode(id); if(!node)return;
  const newNode={id:uid(),type:node.type,name:node.name+" (cópia)",x:node.x+60,y:node.y+60,config:structuredClone(node.config),disabled:false};
  AIS.flow.nodes.push(newNode); renderNode(newNode); AIS.refreshEmpty(); pushHistory(); save();
}
function copyNode(id){
  const node=findNode(id); if(!node)return;
  clipboardNode=structuredClone(node);
}
function pasteNode(){
  if(!clipboardNode||!AIS.flow)return;
  const cv=document.getElementById("canvas"),r=cv.getBoundingClientRect();
  const newNode={...structuredClone(clipboardNode),id:uid(),name:clipboardNode.name+" (cópia)",
    x:Math.round((r.width/2-AIS.view.x)/AIS.view.k),y:Math.round((r.height/2-AIS.view.y)/AIS.view.k),disabled:false};
  AIS.flow.nodes.push(newNode); renderNode(newNode); AIS.refreshEmpty(); pushHistory(); save();
}
function renameNodePrompt(id){
  const node=findNode(id); if(!node)return;
  const n=prompt("Novo nome:",node.name);
  if(n&&n.trim()){ node.name=n.trim(); refreshNodeEl(node); pushHistory(); save(); }
}
function startReplace(id){
  replaceNodeId=id;
  document.getElementById("scrim").classList.add("open");
  document.getElementById("palette").classList.add("open");
  setTimeout(()=>document.getElementById("paletteSearch").focus(),260);
}
function replaceNodeWith(id,newType){
  const node=findNode(id); const def=TYPES[newType]; if(!node||!def)return;
  const wasTrigger=TYPES[node.type]?.trigger; const isTrigger=def.trigger;
  pushHistory();
  node.type=newType; node.name=def.name; node.config=structuredClone(def.defaults);
  if(wasTrigger!==isTrigger&&isTrigger) AIS.flow.edges=(AIS.flow.edges||[]).filter(e=>e.to!==id);
  // IF <-> non-IF: limpar edges de portas que não existem mais
  const wasIf=TYPES[node.type]?.type==="if"; // já trocou, checar pelo novo
  if(newType!=="if") AIS.flow.edges=(AIS.flow.edges||[]).filter(e=>!(e.from===id&&(e.fromPort==="true"||e.fromPort==="false")));
  const el=$world.querySelector(`.ais-node[data-id="${id}"]`); if(el) el.remove();
  renderNode(node); renderEdges(); save();
}

/* ===== Execution Panel ===== */
function openExecPanel(){
  closeConfig(); execPanelOpen=true;
  $execPanel.classList.add("open");
  loadExecList();
}
function closeExecPanel(){
  execPanelOpen=false;
  $execPanel.classList.remove("open");
  restoreOriginalFlow();
}

let execListData=[];
let execFilter="all";

// Filter buttons
document.querySelectorAll(".exec-filter").forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll(".exec-filter").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    execFilter=btn.dataset.filter;
    renderExecList();
  };
});

async function loadExecList(){
  if(!AIS.flow)return;
  if(AISStore.isServer()){
    try{
      const r=await fetch("/api/executions/"+AIS.flow.id,{headers:{"X-AIS-Token":localStorage.getItem("ais.token")||""}});
      execListData=await r.json();
    }catch{execListData=[];}
  }else{execListData=[];}
  renderExecList();
}

function renderExecList(){
  const el=document.getElementById("execListScroll");
  let list=execListData;
  if(execFilter!=="all") list=list.filter(e=>e.status===execFilter);

  if(!list.length){
    el.innerHTML=`<div class="exec-list-empty">${
      execListData.length===0
        ?(AISStore.isServer()?"Nenhuma execução ainda.":"Execuções requerem o servidor (Termux).")
        :"Nenhuma execução com esse filtro."
    }</div>`;
    return;
  }
  el.innerHTML="";
  for(const ex of list){
    const dt=new Date(ex.startedAt);
    const dateStr=dt.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}).replace(".","");
    const timeStr=dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const dur=ex.finishedAt?(ex.finishedAt-ex.startedAt)+"ms":"...";
    const ok=ex.status==="success";
    const item=document.createElement("div");
    item.className=`exec-item ${ok?"exec-ok":"exec-err"}`;
    item.dataset.id=ex.id;
    item.innerHTML=`<div class="exec-dot"></div>
      <div class="exec-info">
        <div class="exec-date">${dateStr}, ${timeStr}</div>
        <div class="exec-sub">${ok?"Sucesso":"Erro"} em ${dur}</div>
      </div>`;
    item.onclick=()=>{
      el.querySelectorAll(".exec-item").forEach(e=>e.classList.remove("active"));
      item.classList.add("active");
      showExecOnCanvas(ex.id);
    };
    el.appendChild(item);
  }
}

let originalFlow = null; // guarda o fluxo real para restaurar

async function showExecOnCanvas(execId){
  try{
    const r=await fetch(`/api/executions/${AIS.flow.id}/${execId}`,{headers:{"X-AIS-Token":localStorage.getItem("ais.token")||""}});
    const exec=await r.json();

    // Se tem snapshot, renderizar os nós daquele momento
    if(exec.snapshot && exec.snapshot.nodes){
      // Salvar fluxo original na primeira vez
      if(!originalFlow) originalFlow = { nodes:[...(AIS.flow.nodes||[])], edges:[...(AIS.flow.edges||[])] };
      AIS.execViewMode = true;
      $world.classList.add("exec-view");
      // Limpar canvas atual
      $world.querySelectorAll(".ais-node").forEach(n=>n.remove());
      document.getElementById("edges").innerHTML="";
      // Renderizar nós do snapshot
      AIS.flow.nodes = exec.snapshot.nodes;
      AIS.flow.edges = exec.snapshot.edges || [];
      for(const node of exec.snapshot.nodes){
        if(typeof addNodeDirect === "function") addNodeDirect(node);
      }
      renderEdges();
    }

    highlightExec(exec);

    const dt=new Date(exec.startedAt);
    const dateStr=dt.toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}).replace(".","");
    const timeStr=dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const total=exec.finishedAt?(exec.finishedAt-exec.startedAt):0;
    const ok=exec.status==="success";
    const errStep=(exec.steps||[]).find(s=>s.status==="error");

    const banner=document.getElementById("execDetailBanner");
    banner.classList.add("open");
    banner.innerHTML=`
      <div class="exec-banner-info">
        <div class="exec-banner-status ${ok?"ok":"err"}">${ok?"✓ Concluído com sucesso":"✗ Erro na execução"}</div>
        <div class="exec-banner-meta">
          <span>${dateStr}, ${timeStr}</span><span class="sep"></span>
          <span>${total}ms</span><span class="sep"></span>
          <span>${(exec.steps||[]).length} nós</span>
        </div>
        <div class="exec-banner-id">ID: ${esc(exec.id)}</div>
        ${errStep?`<div class="exec-banner-err"><b>Erro em: ${esc(errStep.nodeName)}</b> <span>${esc(errStep.error||"")}</span></div>`:""}
      </div>
      <button class="exec-banner-close" id="execBannerClose" title="Fechar detalhes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`;
    document.getElementById("execBannerClose").onclick=()=>restoreOriginalFlow();
  }catch(e){console.error(e);}
}

function restoreOriginalFlow(){
  document.getElementById("execDetailBanner").classList.remove("open");
  document.getElementById("execDetailBanner").innerHTML="";
  $world.querySelectorAll(".ais-node").forEach(n=>n.classList.remove("exec-success","exec-error"));
  document.getElementById("execListScroll").querySelectorAll(".exec-item").forEach(e=>e.classList.remove("active"));
  AIS.execViewMode = false;
  $world.classList.remove("exec-view");
  closeConfig();
  // Restaurar fluxo original
  if(originalFlow){
    $world.querySelectorAll(".ais-node").forEach(n=>n.remove());
    document.getElementById("edges").innerHTML="";
    AIS.flow.nodes = originalFlow.nodes;
    AIS.flow.edges = originalFlow.edges;
    for(const node of originalFlow.nodes){
      if(typeof addNodeDirect === "function") addNodeDirect(node);
    }
    renderEdges();
    originalFlow = null;
  }
}

async function runFlow(){
  try{
    if(AISStore.isServer()){
      const r=await fetch("/api/execute/"+AIS.flow.id,{method:"POST",headers:{"Content-Type":"application/json","X-AIS-Token":localStorage.getItem("ais.token")||""},body:JSON.stringify({force:true})});
      const exec=await r.json();
      highlightExec(exec);
      if(execPanelOpen) loadExecList();
    }else{
      alert("Execução requer o servidor (Termux).");
    }
  }catch(e){alert("Erro: "+e.message);}
}

function highlightExec(exec){
  $world.querySelectorAll(".ais-node").forEach(n=>n.classList.remove("exec-success","exec-error"));
  for(const s of(exec.steps||[])){
    const el=$world.querySelector(`.ais-node[data-id="${s.nodeId}"]`);
    if(el)el.classList.add(s.status==="success"?"exec-success":"exec-error");
  }
}

/* ===== Keys ===== */
function setupKeys(){
  window.addEventListener("keydown",e=>{
    const tag=document.activeElement.tagName;if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return;
    if((e.key==="Delete"||e.key==="Backspace")&&selectedId){e.preventDefault();if(confirm("Excluir este nó?"))removeNode(selectedId);}
    if(e.key==="Escape"){if(cfgOpen)closeConfig();if(execPanelOpen)closeExecPanel();cancelConnection();}
    if((e.ctrlKey||e.metaKey)&&e.key==="z"&&!e.shiftKey){e.preventDefault();undo();}
    if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.key==="z"&&e.shiftKey))){e.preventDefault();redo();}
    if((e.ctrlKey||e.metaKey)&&e.key==="v"){e.preventDefault();pasteNode();}
  });
}

/* ===== Export ===== */
// Mantém register já exposto e adiciona os métodos internos.
Object.assign(window.AISNodes, {init,TYPES,addNode:addNodeToCenter,removeNode,openConfig,closeConfig,
  openExecPanel,closeExecPanel,renderEdges,copyUrl,testWebhook,highlightExec,loadExecList,runFlow,
  undo,redo,autoLayout,toggleDisable,duplicateNode,pasteNode});
})();
