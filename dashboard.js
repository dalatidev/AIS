/* =====================================================================
   A.I.S. — Dashboard
   Sidebar + abas + métricas + lista de fluxos com status/paginação
   ===================================================================== */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };

const STATUS = {
  active:    { label: "Ativo",     cls: "active" },
  published: { label: "Publicado", cls: "published" },
  paused:    { label: "Pausado",   cls: "paused" },
  error:     { label: "Erro",      cls: "error" },
  draft:     { label: "Rascunho",  cls: "draft" },
};

let allFlows = [], allFolders = [], allCreds = [], allExecs = [];
let currentTab = "overview", currentSub = "flows";
const state = {
  q: "", sort: "updated_desc", statusFilter: "all", folderFilter: "all",
  page: 1, perPage: 20,
  credQ: "", execQ: "", execStatus: "all",
};

function timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60); if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24); if (d < 30) return `há ${d} d`;
  return new Date(ts).toLocaleDateString("pt-BR");
}
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

/* ===== Sidebar navigation ===== */
const TITLES = {
  overview:      ["Visão geral",    "Gerencie seus fluxos de trabalho, automações e recursos do A.I.S."],
  pastas:        ["Pastas",         "Organize seus fluxos por projeto ou cliente."],
  credenciais:   ["Credenciais",    "Gerencie chaves de API, tokens e autenticações."],
  documentacao:  ["Documentação",   "Guias, referências e recursos do A.I.S."],
  configuracoes: ["Configurações",  "Preferências do sistema."],
};

const TAB_IDS = ["overview","pastas","credenciais","documentacao","configuracoes"];
document.querySelectorAll(".sb-item").forEach(it => it.onclick = () => {
  document.querySelectorAll(".sb-item").forEach(x => x.classList.remove("active"));
  it.classList.add("active");
  currentTab = it.dataset.tab;
  TAB_IDS.forEach(t => {
    const el = $("tab" + t[0].toUpperCase() + t.slice(1));
    if (el) el.style.display = "none";
  });
  // Pastas e Credenciais são tabs próprias com conteúdo independente
  if (currentTab === "pastas") {
    const active = $("tabPastas");
    if (active) active.style.display = "";
    $("pageTitle").textContent = TITLES[currentTab][0];
    $("pageSub").textContent   = TITLES[currentTab][1];
    closeSidebar();
    loadAll().then(() => renderFolders());
    return;
  }
  if (currentTab === "credenciais") {
    const active = $("tabCredenciais");
    if (active) active.style.display = "";
    $("pageTitle").textContent = TITLES[currentTab][0];
    $("pageSub").textContent   = TITLES[currentTab][1];
    closeSidebar();
    renderCreds();
    return;
  }
  const active = $("tab" + currentTab[0].toUpperCase() + currentTab.slice(1));
  if (active) active.style.display = "";
  $("pageTitle").textContent = TITLES[currentTab][0];
  $("pageSub").textContent   = TITLES[currentTab][1];
  closeSidebar();
  if (currentTab === "overview") renderOverview();
});

/* ===== Sub-tabs (dentro de Overview) ===== */
document.querySelectorAll("#subtabs .tab").forEach(t => t.onclick = () => {
  document.querySelectorAll("#subtabs .tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  currentSub = t.dataset.sub;
  ["flows","execs"].forEach(s => {
    const el = $("sub" + s[0].toUpperCase() + s.slice(1));
    if (el) el.style.display = "none";
  });
  const el = $("sub" + currentSub[0].toUpperCase() + currentSub.slice(1));
  if (el) el.style.display = "";
  if (currentSub === "flows") renderFlows();
  if (currentSub === "execs") renderExecs();
});

/* ===== Mobile sidebar ===== */
function openSidebar()  { $("sidebar").classList.add("open");    $("scrim").classList.add("open"); }
function closeSidebar() { $("sidebar").classList.remove("open"); $("scrim").classList.remove("open"); }
$("hamburger").onclick = openSidebar;
$("scrim").onclick     = closeSidebar;

/* ===== Modal ===== */
function openModal(html) { $("modalContent").innerHTML = html; $("modalBg").classList.add("open"); }
function closeModal()    { $("modalBg").classList.remove("open"); }
window.closeModal = closeModal;
$("modalBg").addEventListener("click", e => { if (e.target === $("modalBg")) closeModal(); });

/* ===== Botão Criar (split) ===== */
$("btnCreateCaret").onclick = e => {
  e.stopPropagation();
  $("createMenu").classList.toggle("open");
};
$("btnCreate").addEventListener("click", e => {
  // Se clicou no botão (não na seta) → criar direto
  if (e.target.closest("#btnCreateCaret")) return;
  createFlow();
});
$("createMenu").querySelectorAll("button").forEach(b => b.onclick = e => {
  e.stopPropagation(); $("createMenu").classList.remove("open");
  const a = b.dataset.act;
  if (a === "new") createFlow();
  else if (a === "import") $("importFile").click();
  else if (a === "folder") editFolder(null);
  else if (a === "cred") editCred(null);
});
document.addEventListener("click", () => {
  $("createMenu")?.classList.remove("open");
  document.querySelectorAll(".menu.open").forEach(m => m.classList.remove("open"));
});

/* ===== Data load ===== */
async function loadAll() {
  allFlows   = await AISStore.list();
  allFolders = await AISStore.listFolders();
}

/* ===== Overview ===== */
async function renderOverview() {
  await loadAll();
  allExecs = await AISStore.listAllExecutions();
  const total  = allExecs.length;
  const failed = allExecs.filter(e => e.status === "error").length;
  const rate   = total ? ((failed / total) * 100).toFixed(1) : "0.0";
  const durs   = allExecs.filter(e => e.finishedAt).map(e => e.finishedAt - e.startedAt);
  const avg    = durs.length ? Math.round(durs.reduce((a,b) => a+b, 0) / durs.length) : 0;
  $("metricsGrid").innerHTML = `
    <div class="metric"><div class="label">Execuções</div><div class="value">${total.toLocaleString("pt-BR")}</div><div class="delta">total registrado</div></div>
    <div class="metric"><div class="label">Execuções com erro</div><div class="value">${failed}</div><div class="delta ${failed>0?"down":""}">${failed===0?"nenhuma":"últimas 100"}</div></div>
    <div class="metric"><div class="label">Taxa de erro</div><div class="value">${rate}%</div><div class="delta ${failed>0?"down":"up"}">${failed===0?"tudo ok":"acompanhe"}</div></div>
    <div class="metric"><div class="label">Total de fluxos</div><div class="value">${allFlows.length}</div><div class="delta">no seu espaço</div></div>
    <div class="metric"><div class="label">Tempo médio</div><div class="value sm">${avg?avg+" ms":"—"}</div><div class="delta">por execução</div></div>`;
  // Reset para primeira sub-aba (fluxos)
  renderFlows();
  renderFolderFilter();
}

/* ===== FLOWS list ===== */
function renderFolderFilter() {
  const el = $("filterFolder");
  el.innerHTML = `<option value="all">Todas as pastas</option>` +
    allFolders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
  el.value = state.folderFilter;
}
function statusPill(s) {
  const cfg = STATUS[s] || STATUS.draft;
  return `<span class="wf-status ${cfg.cls}"><span class="st-dot"></span>${cfg.label}</span>`;
}
function wfIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M8.4 6H15.6M7 8.2l3.5 7.6M17 8.2l-3.5 7.6"/></svg>`;
}

async function renderFlows() {
  // Aplica filtros
  let list = allFlows.slice();
  const q = state.q.toLowerCase().trim();
  if (q) list = list.filter(f => (f.name || "").toLowerCase().includes(q));
  if (state.statusFilter !== "all") list = list.filter(f => (f.status || "draft") === state.statusFilter);
  if (state.folderFilter !== "all") list = list.filter(f => f.folderId === state.folderFilter);

  // Ordenação
  if (state.sort === "updated_desc") list.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  else if (state.sort === "created_desc") list.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  else if (state.sort === "created_asc")  list.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  else if (state.sort === "az")           list.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else if (state.sort === "za")           list.sort((a,b) => (b.name||"").localeCompare(a.name||""));

  // Paginação
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / state.perPage));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.perPage;
  const pageItems = list.slice(start, start + state.perPage);

  const cont = $("flowList");
  if (!total) {
    cont.innerHTML = `<div class="empty"><div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div><h2>${q||state.statusFilter!=="all"||state.folderFilter!=="all"?"Nenhum resultado":"Nenhum fluxo por aqui"}</h2><p>${q?`Nada corresponde a "${esc(q)}".`:"Clique em <b style='color:var(--white)'>Criar fluxo</b> para começar."}</p></div>`;
    $("paging").innerHTML = ""; return;
  }
  cont.innerHTML = "";
  for (const f of pageItems) cont.appendChild(makeFlowRow(f));

  // Paginação
  renderPaging(total, totalPages);
}

function makeFlowRow(f) {
  const folder = allFolders.find(fd => fd.id === f.folderId);
  const status = f.status || "draft";
  const row = document.createElement("div");
  row.className = "wf-row";
  row.innerHTML = `
    <div class="wf-thumb">${wfIcon()}</div>
    <div class="wf-main">
      <div class="wf-name"></div>
      <div class="wf-meta"><span>Última atualização ${timeAgo(f.updatedAt)}</span><span class="sep"></span><span>Criado em ${fmtDate(f.createdAt)}</span></div>
    </div>
    ${folder ? `<span class="wf-project"><span class="folder-dot" style="width:8px;height:8px;background:${folder.color||"var(--blue)"}"></span>${esc(folder.name)}</span>` : ""}
    ${statusPill(status)}
    <div class="menu-wrap">
      <button class="icon-btn sm menu-toggle" title="Mais ações"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
      <div class="menu">
        <button data-act="open"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>Abrir</button>
        <button data-act="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Renomear</button>
        <button data-act="dup"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Duplicar</button>
        <button data-act="folder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Mover para pasta</button>
        <button data-act="export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>Exportar JSON</button>
        <div class="sep"></div>
        <button data-act="publish"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${status==="active"?'<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>':'<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/>'}</svg>${status==="active"?"Despublicar":"Publicar"}</button>
        <div class="sep"></div>
        <button data-act="del" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>Excluir</button>
      </div>
    </div>`;
  row.querySelector(".wf-name").textContent = f.name;
  row.addEventListener("click", e => {
    if (e.target.closest(".menu-wrap")) return;
    location.href = `editor.html?id=${f.id}`;
  });
  const menu = row.querySelector(".menu");
  row.querySelector(".menu-toggle").onclick = e => {
    e.stopPropagation();
    document.querySelectorAll(".menu.open").forEach(m => m !== menu && m.classList.remove("open"));
    menu.classList.toggle("open");
  };
  menu.querySelectorAll("button").forEach(b => b.onclick = async e => {
    e.stopPropagation(); menu.classList.remove("open");
    const a = b.dataset.act;
    if (a === "open") location.href = `editor.html?id=${f.id}`;
    else if (a === "rename") {
      const n = prompt("Novo nome:", f.name);
      if (n && n.trim()) { await AISStore.update(f.id, { name: n.trim() }); await refresh(); }
    }
    else if (a === "dup") { await AISStore.duplicate(f.id); await refresh(); }
    else if (a === "folder") moveToFolder(f);
    else if (a === "export") exportFlow(f.id);
    else if (a === "publish") {
      const newStatus = (f.status === "active") ? "draft" : "active";
      await AISStore.update(f.id, { status: newStatus });
      await refresh();
    }
    else if (a === "del") {
      if (confirm(`Excluir "${f.name}"?`)) { await AISStore.remove(f.id); await refresh(); }
    }
  });
  return row;
}

function renderPaging(total, totalPages) {
  const el = $("paging");
  const nums = [];
  const push = (label, page, cls) => nums.push(`<button class="pg-btn ${cls||""}" ${page==null?"disabled":""} data-p="${page??""}">${label}</button>`);
  push("‹", state.page > 1 ? state.page-1 : null);
  const window_ = 3;
  const startP = Math.max(1, state.page - window_);
  const endP   = Math.min(totalPages, state.page + window_);
  if (startP > 1) { push("1", 1); if (startP > 2) push("…", null); }
  for (let p = startP; p <= endP; p++) push(String(p), p, p === state.page ? "active" : "");
  if (endP < totalPages) { if (endP < totalPages-1) push("…", null); push(String(totalPages), totalPages); }
  push("›", state.page < totalPages ? state.page+1 : null);

  el.innerHTML = `
    <div>Total ${total}</div>
    <div class="paging-nums">${nums.join("")}</div>
    <div style="display:flex;align-items:center;gap:8px"><select class="sel" id="perPage"><option value="10">10 / página</option><option value="20">20 / página</option><option value="50">50 / página</option></select></div>`;
  $("perPage").value = String(state.perPage);
  $("perPage").onchange = e => { state.perPage = +e.target.value; state.page = 1; renderFlows(); };
  el.querySelectorAll(".pg-btn").forEach(b => b.onclick = () => {
    const p = +b.dataset.p; if (p) { state.page = p; renderFlows(); window.scrollTo({top:0,behavior:"smooth"}); }
  });
}

async function refresh() { await loadAll(); renderFolderFilter(); renderFlows(); }

async function createFlow() {
  const list = await AISStore.list();
  const f = await AISStore.create(`Fluxo ${list.length + 1}`, { status: "draft" });
  if (f) location.href = `editor.html?id=${f.id}`;
}

function moveToFolder(flow) {
  const opts = `<option value="">Nenhuma</option>` +
    allFolders.map(f => `<option value="${f.id}"${flow.folderId===f.id?" selected":""}>${esc(f.name)}</option>`).join("");
  openModal(`<h3>Mover para pasta</h3><label><span>Pasta</span><select id="mfSel">${opts}</select></label><div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="mfOk">Mover</button></div>`);
  $("mfOk").onclick = async () => {
    await AISStore.update(flow.id, { folderId: $("mfSel").value || null });
    closeModal(); await refresh();
  };
}

function changeStatus(flow) {
  const cur = flow.status || "draft";
  const opts = Object.entries(STATUS).map(([k,v]) => `<option value="${k}"${k===cur?" selected":""}>${v.label}</option>`).join("");
  openModal(`<h3>Alterar estado do fluxo</h3><label><span>Estado</span><select id="stSel">${opts}</select></label><div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="stOk">Salvar</button></div>`);
  $("stOk").onclick = async () => {
    await AISStore.update(flow.id, { status: $("stSel").value });
    closeModal(); await refresh();
  };
}

async function exportFlow(id) {
  const data = await AISStore.exportFlow(id);
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (data.flow?.name || "fluxo") + ".json";
  a.click(); URL.revokeObjectURL(a.href);
}

$("importFile").onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try { await AISStore.importFlow(JSON.parse(await file.text())); await refresh(); }
  catch (er) { alert("Erro ao importar: " + er.message); }
  e.target.value = "";
};

// Debounce da busca
let _sT;
$("searchFlows").addEventListener("input", e => {
  clearTimeout(_sT);
  _sT = setTimeout(() => { state.q = e.target.value; state.page = 1; renderFlows(); }, 180);
});
$("sortFlows").onchange     = e => { state.sort = e.target.value; renderFlows(); };
$("filterStatus").onchange  = e => { state.statusFilter = e.target.value; state.page = 1; renderFlows(); };
$("filterFolder").onchange  = e => { state.folderFilter = e.target.value; state.page = 1; renderFlows(); };

/* ===== CREDS ===== */
const CRED_TYPES = [
  { value: "apiKey", label: "API Key",       icon: "🔑" },
  { value: "basic",  label: "Basic Auth",    icon: "👤" },
  { value: "bearer", label: "Bearer Token",  icon: "🎫" },
  { value: "custom", label: "Custom Headers", icon: "📝" }
];
async function renderCreds() {
  allCreds = await AISStore.listCredentials();
  let list = allCreds.slice();
  const q = state.credQ.toLowerCase();
  if (q) list = list.filter(c => (c.name || "").toLowerCase().includes(q));
  const g = $("credGrid");
  if (!list.length) {
    g.innerHTML = `<div class="empty"><div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><h2>${q?"Sem resultados":"Nenhuma credencial"}</h2><p>Guarde chaves de API e tokens para usar nos fluxos.</p></div>`;
    return;
  }
  g.innerHTML = "";
  for (const c of list) {
    const ct = CRED_TYPES.find(t => t.value === c.type) || CRED_TYPES[0];
    const card = document.createElement("div");
    card.className = "cred-card";
    card.innerHTML = `<div class="cred-icon">${ct.icon}</div><div class="cred-info"><b></b><span>${ct.label} · ${timeAgo(c.updatedAt||c.createdAt)}</span></div><button class="btn sm ce">Editar</button><button class="btn sm danger cd">×</button>`;
    card.querySelector("b").textContent = c.name;
    card.querySelector(".ce").onclick = () => editCred(c.id);
    card.querySelector(".cd").onclick = async () => { if (confirm(`Excluir "${c.name}"?`)) { await AISStore.removeCredential(c.id); renderCreds(); } };
    g.appendChild(card);
  }
}
$("searchCreds").oninput = e => { state.credQ = e.target.value.trim(); renderCreds(); };
$("btnNewCred").onclick = () => editCred(null);
async function editCred(id) {
  const c = id ? await AISStore.getCredential(id) : null;
  const tp = c?.type || "apiKey";
  openModal(`<h3>${c?"Editar":"Nova"} credencial</h3>
    <label><span>Nome</span><input id="cName" value="${esc(c?.name||"")}" placeholder="Ex.: Google API"/></label>
    <label><span>Tipo</span><select id="cType">${CRED_TYPES.map(t=>`<option value="${t.value}"${t.value===tp?" selected":""}>${t.icon} ${t.label}</option>`).join("")}</select></label>
    <div id="cFields"></div>
    <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="cSave">Salvar</button></div>`);
  const rf = () => {
    const t = $("cType").value; const d = c?.data || {}; let h = "";
    if (t === "apiKey") h = `<label><span>Nome do header</span><input id="cf_key" value="${esc(d.key||"X-Api-Key")}"/></label><label><span>Valor</span><input id="cf_val" type="password" value="${esc(d.value||"")}"/></label>`;
    else if (t === "basic") h = `<label><span>Usuário</span><input id="cf_user" value="${esc(d.username||"")}"/></label><label><span>Senha</span><input id="cf_pass" type="password" value="${esc(d.password||"")}"/></label>`;
    else if (t === "bearer") h = `<label><span>Token</span><input id="cf_token" type="password" value="${esc(d.token||"")}"/></label>`;
    else h = `<label><span>Headers (JSON)</span><textarea id="cf_hdrs" rows="4">${esc(d.headers||"{}")}</textarea></label>`;
    $("cFields").innerHTML = h;
  };
  rf(); $("cType").onchange = rf;
  $("cSave").onclick = async () => {
    const t = $("cType").value; let data = {};
    if (t === "apiKey") data = { key: $("cf_key")?.value, value: $("cf_val")?.value };
    else if (t === "basic") data = { username: $("cf_user")?.value, password: $("cf_pass")?.value };
    else if (t === "bearer") data = { token: $("cf_token")?.value };
    else data = { headers: $("cf_hdrs")?.value || "{}" };
    const name = ($("cName").value || "Credencial").trim();
    if (c) await AISStore.updateCredential(c.id, { name, type: t, data });
    else   await AISStore.createCredential({ name, type: t, data });
    closeModal(); renderCreds();
  };
}

/* ===== EXECS ===== */
const selectedExecs = new Set();

function updateDeleteBtn() {
  const btn = $("btnDeleteSelExecs");
  btn.style.display = selectedExecs.size > 0 ? "" : "none";
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>Excluir (${selectedExecs.size})`;
}

async function renderExecs() {
  allExecs = await AISStore.listAllExecutions();
  let list = allExecs.slice();
  const q = state.execQ.toLowerCase();
  if (q) list = list.filter(e => (e.flowName || "").toLowerCase().includes(q));
  if (state.execStatus !== "all") list = list.filter(e => e.status === state.execStatus);
  const el = $("execList");
  selectedExecs.clear();
  updateDeleteBtn();
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg></div><h2>Nenhuma execução</h2><p>${AISStore.isServer()?"Execute um fluxo para ver o histórico aqui.":"Execuções ficam salvas no servidor (Termux)."}</p></div>`;
    return;
  }
  el.innerHTML = "";
  list.forEach(e => {
    const dt = new Date(e.startedAt);
    const dateStr = dt.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
    const timeStr = dt.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
    const dur = e.finishedAt ? (e.finishedAt - e.startedAt) + " ms" : "...";
    const ok = e.status === "success";
    const row = document.createElement("div"); row.className = "exec-row";
    row.innerHTML = `
      <input type="checkbox" class="exec-check" data-eid="${esc(e.id)}" data-fid="${esc(e.flowId)}"/>
      <div class="exec-dot ${ok?"ok":"err"}"></div>
      <div class="exec-info">
        <b></b>
        <div class="exec-meta">
          <span>${dateStr} ${timeStr}</span><span class="sep"></span>
          <span>${dur}</span><span class="sep"></span>
          <span>${e.stepCount||0} nós</span>
        </div>
        <span class="exec-id">${esc(e.id)}</span>
      </div>
      <span class="exec-badge ${ok?"ok":"err"}">${ok?"Sucesso":"Erro"}</span>`;
    row.querySelector("b").textContent = e.flowName || "—";
    const cb = row.querySelector(".exec-check");
    cb.onclick = (ev) => ev.stopPropagation();
    cb.onchange = () => {
      if (cb.checked) { selectedExecs.add(e.id + "|" + e.flowId); row.classList.add("selected"); }
      else { selectedExecs.delete(e.id + "|" + e.flowId); row.classList.remove("selected"); }
      updateDeleteBtn();
    };
    el.appendChild(row);
  });
}
$("searchExecs").oninput      = e => { state.execQ = e.target.value.trim(); renderExecs(); };
$("filterExecStatus").onchange = e => { state.execStatus = e.target.value; renderExecs(); };
$("btnDeleteSelExecs").onclick = async () => {
  if (!selectedExecs.size) return;
  if (!confirm(`Excluir ${selectedExecs.size} execução(ões)?`)) return;
  for (const key of selectedExecs) {
    const [execId, flowId] = key.split("|");
    await AISStore.deleteExecution(flowId, execId);
  }
  selectedExecs.clear();
  renderExecs();
};
$("btnClearExecs").onclick = async () => {
  if (!confirm("Limpar TODAS as execuções? Essa ação não pode ser desfeita.")) return;
  await AISStore.clearAllExecutions();
  selectedExecs.clear();
  renderExecs();
};

/* ===== FOLDERS ===== */
let openFolderId = null;
const folderState = { q: "", flowQ: "", flowStatus: "all" };

async function renderFolders() {
  await loadAll();
  const g = $("folderGrid");
  $("pastasListView").style.display = "";
  $("pastasDetailView").style.display = "none";
  openFolderId = null;

  let list = allFolders.slice();
  const q = folderState.q.toLowerCase();
  if (q) list = list.filter(f => (f.name || "").toLowerCase().includes(q));

  if (!list.length) {
    g.innerHTML = `<div class="empty"><div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div><h2>${q?"Nenhum resultado":"Nenhuma pasta"}</h2><p>Crie pastas para organizar seus fluxos por projeto ou cliente.</p></div>`;
    return;
  }
  g.innerHTML = "";
  list.forEach(f => {
    const cnt = allFlows.filter(fl => fl.folderId === f.id).length;
    const card = document.createElement("div"); card.className = "card-basic";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:14px;height:14px;border-radius:50%;background:${f.color||"var(--blue)"};flex:0 0 auto"></div>
        <div style="flex:1;min-width:0">
          <h3></h3>
          <div class="desc">${cnt} ${cnt===1?"fluxo":"fluxos"}</div>
        </div>
        <div class="menu-wrap">
          <button class="icon-btn sm menu-toggle" title="Mais ações"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
          <div class="menu">
            <button data-act="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Renomear</button>
            <div class="sep"></div>
            <button data-act="del" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>Excluir</button>
          </div>
        </div>
      </div>`;
    card.querySelector("h3").textContent = f.name;
    // Clicar no card abre a pasta
    card.onclick = e => {
      if (e.target.closest(".menu-wrap")) return;
      openFolder(f.id);
    };
    // Menu 3 pontos
    const menu = card.querySelector(".menu");
    card.querySelector(".menu-toggle").onclick = e => {
      e.stopPropagation();
      document.querySelectorAll(".menu.open").forEach(m => m !== menu && m.classList.remove("open"));
      menu.classList.toggle("open");
    };
    menu.querySelectorAll("button").forEach(b => b.onclick = async e => {
      e.stopPropagation(); menu.classList.remove("open");
      if (b.dataset.act === "rename") {
        const n = prompt("Novo nome:", f.name);
        if (n && n.trim()) { await AISStore.updateFolder(f.id, { name: n.trim() }); await refresh(); renderFolders(); }
      } else if (b.dataset.act === "del") {
        if (confirm(`Excluir pasta "${f.name}"? Os fluxos não serão excluídos.`)) { await AISStore.removeFolder(f.id); await refresh(); renderFolders(); }
      }
    });
    g.appendChild(card);
  });
}

function openFolder(folderId) {
  openFolderId = folderId;
  folderState.flowQ = "";
  folderState.flowStatus = "all";
  if ($("searchFolderFlows")) $("searchFolderFlows").value = "";
  if ($("filterFolderFlowStatus")) $("filterFolderFlowStatus").value = "all";
  $("pastasListView").style.display = "none";
  $("pastasDetailView").style.display = "";
  const folder = allFolders.find(f => f.id === folderId);
  $("folderDetailName").textContent = folder?.name || "Pasta";
  $("folderDetailDot").style.background = folder?.color || "var(--blue)";
  renderFolderFlows();
}

function renderFolderFlows() {
  let list = allFlows.filter(f => f.folderId === openFolderId);
  const q = folderState.flowQ.toLowerCase();
  if (q) list = list.filter(f => (f.name || "").toLowerCase().includes(q));
  if (folderState.flowStatus !== "all") list = list.filter(f => (f.status || "draft") === folderState.flowStatus);
  list.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));

  const el = $("folderFlowList");
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div><h2>${q||folderState.flowStatus!=="all"?"Nenhum resultado":"Pasta vazia"}</h2><p>Nenhum fluxo nesta pasta.</p></div>`;
    return;
  }
  el.innerHTML = "";
  for (const f of list) el.appendChild(makeFlowRow(f));
}

$("searchFolders").oninput = e => { folderState.q = e.target.value.trim(); renderFolders(); };
$("btnNewFolder").onclick = () => editFolder(null);
$("btnBackFolders").onclick = () => renderFolders();
$("searchFolderFlows").oninput = e => { folderState.flowQ = e.target.value.trim(); renderFolderFlows(); };
$("filterFolderFlowStatus").onchange = e => { folderState.flowStatus = e.target.value; renderFolderFlows(); };

async function editFolder(id) {
  const f = id ? allFolders.find(x => x.id === id) : null;
  const colors = ["#3B82F6","#8B5CF6","#10B981","#F97316","#EC4899","#EAB308","#6B7280"];
  openModal(`<h3>${f?"Editar":"Nova"} pasta</h3>
    <label><span>Nome</span><input id="fdName" value="${esc(f?.name||"")}" placeholder="Ex.: Produção"/></label>
    <label><span>Cor</span><div style="display:flex;gap:8px;flex-wrap:wrap">${colors.map(c=>`<div class="fd-color" data-c="${c}" style="width:34px;height:34px;border-radius:8px;background:${c};cursor:pointer;border:2px solid ${c===(f?.color||"#3B82F6")?"#fff":"transparent"}"></div>`).join("")}</div></label>
    <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="fdSave">Salvar</button></div>`);
  let sel = f?.color || "#3B82F6";
  document.querySelectorAll(".fd-color").forEach(el => el.onclick = () => {
    sel = el.dataset.c;
    document.querySelectorAll(".fd-color").forEach(x => x.style.borderColor = "transparent");
    el.style.borderColor = "#fff";
  });
  $("fdSave").onclick = async () => {
    const name = ($("fdName").value || "Nova pasta").trim();
    if (f) await AISStore.updateFolder(f.id, { name, color: sel });
    else   await AISStore.createFolder({ name, color: sel });
    closeModal(); await refresh(); renderFolders();
  };
}

/* ===== CONFIG: Token ===== */
(function setupTokenConfig() {
  const inp = $("cfgToken");
  const status = $("cfgTokenStatus");
  const eyeOff = $("cfgEyeOff");
  const eyeOn = $("cfgEyeOn");

  // Carregar token salvo
  const saved = localStorage.getItem("ais.token") || "";
  if (saved) inp.value = saved;

  // Mostrar/ocultar token
  $("cfgToggleVis").onclick = () => {
    if (inp.type === "password") {
      inp.type = "text";
      eyeOff.style.display = "none";
      eyeOn.style.display = "";
    } else {
      inp.type = "password";
      eyeOff.style.display = "";
      eyeOn.style.display = "none";
    }
  };

  // Botão Colar
  $("cfgPaste").onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      inp.value = text.trim();
      inp.focus();
    } catch {
      inp.focus();
      document.execCommand("paste");
    }
  };

  // Botão Conectar
  $("cfgConnect").onclick = async () => {
    const token = inp.value.trim();
    if (!token) {
      status.textContent = "Cole um token primeiro.";
      status.className = "cfg-token-status err";
      return;
    }
    status.textContent = "Verificando...";
    status.className = "cfg-token-status loading";

    AISStore.setToken(token);
    const ok = await AISStore.checkAuth();
    if (ok) {
      status.textContent = "✓ Conectado ao servidor com sucesso!";
      status.className = "cfg-token-status ok";
      $("modeDot").className = "dot server";
      $("modeText").textContent = "Servidor conectado";
    } else {
      status.textContent = "✕ Token inválido ou servidor inacessível.";
      status.className = "cfg-token-status err";
      AISStore.clearToken();
    }
  };

  // Mostrar status inicial se já conectado
  if (saved && AISStore.isServer()) {
    AISStore.checkAuth().then(ok => {
      if (ok) {
        status.textContent = "✓ Conectado";
        status.className = "cfg-token-status ok";
      }
    });
  }
})();

/* ===== INIT ===== */
(async () => {
  await AISStore.init();
  if (AISStore.isServer()) {
    $("modeDot").className = "dot server";
    $("modeText").textContent = "Servidor conectado";
    let ok = AISStore.hasToken() ? await AISStore.checkAuth() : false;
    while (!ok) {
      const t = prompt("Token de acesso do servidor A.I.S.:");
      if (t === null) break;
      AISStore.setToken(t.trim());
      ok = await AISStore.checkAuth();
      if (!ok) alert("Token inválido.");
    }
  }
  renderOverview();
})();
})();
