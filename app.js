/* Painel DJUD — lógica da aplicação.
   Depende de config.js (CONFIG) e data.js (COORDS, PRIOS, COMPS, STATUS, SEED). */

const KEY = 'djud_demandas_v3';   // dados do modo demonstração
const PASSKEY = 'djud_pass';      // senha de edição do modo conectado
const LIVE = !!CONFIG.SHEET_API;

let DATA = [], PLANO = [], screen = 'home', view = 'coord', dragId = null, editing = null;
let auth = { authed: false, pass: null };
const CAN_EDIT = () => !LIVE || auth.authed;

/* ---------- helpers ---------- */
const shortOf = f => (COORDS.find(c => c.full === f) || {}).short || f;
const dotOf = f => (COORDS.find(c => c.full === f) || {}).dot || '#94A3B8';
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const avg = a => a.length ? Math.round(a.reduce((s, x) => s + (x || 0), 0) / a.length) : 0;
const el = id => document.getElementById(id);

/* Funil por onde passa TODO dado que entra em DATA: seed, planilha e importação.
   As coerções de tipo são obrigatórias porque a planilha devolve prio "1" como
   número 1, e um id numérico quebraria as comparações com ===. */
function normalize(c, i) {
  const d = Object.assign({
    id: '', coord: COORDS[0].full, titulo: '', oque: '', fonte: '', acesso: '',
    prio: 'A definir', comp: 'Média', obs: '', warn: '', status: 'Não iniciada', pct: 0,
    produto: '', prazo: 'A definir'
  }, c);
  d.id = String(d.id || 'd' + (typeof i === 'number' ? i : Date.now().toString(36)));
  d.prio = PRIOS.includes(String(d.prio)) ? String(d.prio) : 'A definir';
  d.comp = COMPS.includes(d.comp) ? d.comp : 'Média';
  d.status = STATUS.includes(d.status) ? d.status : 'Não iniciada';
  d.prazo = (typeof PRAZOS !== 'undefined' && PRAZOS.includes(d.prazo)) ? d.prazo : 'A definir';
  d.pct = Math.max(0, Math.min(100, Math.round(Number(d.pct) || 0)));
  ['coord', 'titulo', 'oque', 'fonte', 'acesso', 'obs', 'warn', 'produto'].forEach(k => d[k] = d[k] == null ? '' : String(d[k]));
  return d;
}

function normalizePlano(p) {
  const d = Object.assign({ ordem: 0, produto: '', prazo: 'A definir', prioridade: '', complexidade: '', demandas: [], fonte: '', observacao: '' }, p);
  // a planilha devolve "demandas" como texto (linhas separadas por \n); o demo já vem como array
  if (typeof d.demandas === 'string') d.demandas = d.demandas.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!Array.isArray(d.demandas)) d.demandas = [];
  d.ordem = Number(d.ordem) || 0;
  (typeof PRAZOS !== 'undefined') && (d.prazo = PRAZOS.includes(d.prazo) ? d.prazo : 'A definir');
  ['produto', 'prioridade', 'complexidade', 'fonte', 'observacao'].forEach(k => d[k] = d[k] == null ? '' : String(d[k]));
  return d;
}

/* ---------- STORE ----------
   Contrato dos dois modos: o store fala com o armazenamento e devolve o objeto
   canônico; quem chama é que altera DATA e depois chama persist(). */

const localStore = {
  async list() {
    try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r).map(normalize); } catch (e) {}
    return SEED.map(normalize);
  },
  async create(c) { c.id = 'd' + Date.now().toString(36); return c; },
  async update(c) { return c; },
  async remove(id) {},
  async replaceAll(list) { DATA = list; await this.persist(); return DATA; },
  async resetSeed() { DATA = SEED.map(normalize); await this.persist(); return DATA; },
  async listPlano() { try { const r = localStorage.getItem(KEY + '_plano'); if (r) return JSON.parse(r).map(normalizePlano); } catch (e) {} return (typeof SEED_PLANO !== 'undefined' ? SEED_PLANO : []).map(normalizePlano); },
  async savePlano(list) { PLANO = list.map(normalizePlano); try { localStorage.setItem(KEY + '_plano', JSON.stringify(PLANO)); } catch (e) {} return PLANO; },
  async persist() { try { localStorage.setItem(KEY, JSON.stringify(DATA)); } catch (e) {} }
};

/* O Apps Script não consegue responder a um preflight OPTIONS, então toda
   escrita precisa ser uma "simple request": content-type text/plain e nenhum
   cabeçalho extra (a senha vai no corpo, não em Authorization). */
async function callSheet(action, payload) {
  let r;
  try {
    if (action === 'list' || action === 'listPlano') {
      r = await fetch(CONFIG.SHEET_API + '?action=' + action);
    } else {
      r = await fetch(CONFIG.SHEET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, pass: auth.pass || '' }, payload || {}))
      });
    }
  } catch (e) {
    throw new Error('Não foi possível falar com a planilha. Verifique a conexão.');
  }
  let j;
  try { j = await r.json(); }
  catch (e) { throw new Error('Resposta inesperada do servidor. Confira a URL em config.js e se a implantação está publicada para "qualquer pessoa".'); }
  /* O Apps Script sempre responde HTTP 200, inclusive em erro — o que valeu
     está no corpo. */
  if (!j || j.ok !== true) {
    const err = new Error((j && j.error) || 'Erro no servidor.');
    err.code = (j && j.code) || '';
    throw err;
  }
  return j.data;
}

const sheetStore = {
  async list() { return (await callSheet('list')).map(normalize); },
  async create(c) { return normalize(await callSheet('create', { demanda: c })); },
  async update(c) { return normalize(await callSheet('update', { demanda: c })); },
  async remove(id) { await callSheet('delete', { id }); },
  async replaceAll(list) { await callSheet('replaceAll', { demandas: list }); return (await callSheet('list')).map(normalize); },
  async resetSeed() { throw new Error('Reiniciar não está disponível no modo conectado.'); },
  async listPlano() { return (await callSheet('listPlano')).map(normalizePlano); },
  async savePlano(list) { await callSheet('replacePlano', { plano: list }); return (await callSheet('listPlano')).map(normalizePlano); },
  async persist() {}   // a planilha já gravou
};

const store = LIVE ? sheetStore : localStore;

/* Senha recusada: derruba a sessão local e pede de novo. */
function handleErr(err) {
  if (err && err.code === 'auth') { forgetPass(); openLogin(); }
  toast(err.message || 'Erro inesperado.', true);
}

let toastT;
function toast(msg, isErr) {
  const n = el('savednote');
  n.textContent = msg || 'Salvo';
  n.classList.toggle('err', !!isErr);
  n.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => n.classList.remove('show'), isErr ? 4000 : 1400);
}

/* ---------- filtros ---------- */
const F = { q: '', coord: '', prio: '', comp: '' }, FA = { coord: '', prio: '' };
function filtered() {
  return DATA.filter(c => {
    if (F.coord && c.coord !== F.coord) return false;
    if (F.prio && c.prio !== F.prio) return false;
    if (F.comp && c.comp !== F.comp) return false;
    if (F.q) { const t = (c.titulo + ' ' + c.oque + ' ' + c.fonte).toLowerCase(); if (!t.includes(F.q.toLowerCase())) return false; }
    return true;
  });
}
function filteredA() {
  return DATA.filter(c => {
    if (FA.coord && c.coord !== FA.coord) return false;
    if (FA.prio && c.prio !== FA.prio) return false;
    return true;
  });
}

const prioRank = p => { const i = PRIOS.indexOf(p); return i < 0 ? 99 : i; };
const coordRank = f => { const i = COORDS.findIndex(c => c.full === f); return i < 0 ? 99 : i; };
/* Dentro de uma coluna de prioridade agrupa-se por coordenação, e vice-versa. */
function sortCards(l, by) {
  return l.slice().sort((a, b) => by === 'prio'
    ? (coordRank(a.coord) - coordRank(b.coord) || a.titulo.localeCompare(b.titulo, 'pt'))
    : (prioRank(a.prio) - prioRank(b.prio) || a.titulo.localeCompare(b.titulo, 'pt')));
}

/* ---------- card ---------- */
function cardEl(c) {
  const node = document.createElement('article');
  node.className = 'card'; node.dataset.id = c.id; node.tabIndex = 0;
  const canEdit = CAN_EDIT();
  node.draggable = canEdit;
  node.innerHTML = `
    <div class="card-top">
      <span class="coordchip"><span class="cdot" style="background:${dotOf(c.coord)}"></span>${esc(shortOf(c.coord))}</span>
      ${c.prazo && c.prazo !== 'A definir' ? `<span class="prazochip" data-prazo="${esc((typeof PRAZO_KIND!=='undefined'&&PRAZO_KIND[c.prazo])||'adef')}">${esc(c.prazo)}</span>` : ''}
      ${canEdit ? `<div class="card-actions"><button class="iconbtn" title="Editar" data-act="edit">✎</button><button class="iconbtn del" title="Excluir" data-act="del">🗑</button></div>` : ''}
    </div>
    <div class="card-title">${esc(c.titulo)}</div>
    ${c.oque ? `<div class="card-desc">${esc(c.oque)}</div>` : ''}
    ${c.fonte ? `<div class="card-src"><b>Fonte:</b> ${esc(c.fonte)}${c.acesso ? ` — ${esc(c.acesso)}` : ''}</div>` : ''}
    ${c.warn ? `<span class="card-warn">${esc(c.warn)}</span>` : ''}
    <div class="badges">
      <div class="prio" data-prio="${esc(c.prio)}"><span class="seal">${esc(c.prio === 'A definir' ? '—' : c.prio)}</span><span class="lbl">Prioridade<span class="v">${esc(PRIO_LABEL[c.prio] || '')}</span></span></div>
      <div class="pill" data-comp="${esc(c.comp)}"><span class="cap">Complexidade</span><span class="chip">${esc(c.comp)}</span></div>
    </div>
    <div class="exec"><span class="stbadge" data-status="${esc(c.status)}">${esc(c.status)}</span><span class="track"><span style="width:${c.pct}%"></span></span><span class="pct tabular">${c.pct}%</span></div>`;
  if (canEdit) {
    node.addEventListener('dragstart', e => { dragId = c.id; node.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    node.addEventListener('dragend', () => { dragId = null; node.classList.remove('dragging'); document.querySelectorAll('.drop-on').forEach(x => x.classList.remove('drop-on')); });
    node.querySelector('[data-act=edit]').addEventListener('click', ev => { ev.stopPropagation(); openEdit(c.id); });
    node.querySelector('[data-act=del]').addEventListener('click', ev => { ev.stopPropagation(); removeCard(c.id); });
    node.addEventListener('dblclick', () => openEdit(c.id));
  }
  return node;
}

/* `dim` é o próprio nome do campo: 'coord' | 'prio' | 'comp'. */
function wireDrop(zone, dim, val) {
  if (!CAN_EDIT()) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drop-on'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-on'); });
  zone.addEventListener('drop', async e => {
    e.preventDefault(); zone.classList.remove('drop-on');
    if (!dragId) return;
    const c = DATA.find(x => x.id === dragId);
    if (!c || c[dim] === val) return;
    const prev = c[dim];
    c[dim] = val;
    renderBoard();
    try {
      await store.update(c);
      await store.persist();
      toast('Salvo');
    } catch (err) {
      c[dim] = prev;          // não salvou: a tela não pode continuar mentindo
      renderBoard();
      handleErr(err);
    }
  });
}

/* ---------- render board ---------- */
function renderLegend() {
  el('legend').innerHTML = `
    <span class="k"><span class="prio" data-prio="1"><span class="seal" style="width:22px;height:22px;font-size:12px">1</span></span> Prioridade (1 = mais alta)</span>
    <span class="k"><span data-comp="Alta"><span class="chip" style="border:1px solid var(--cx-al-bd);padding:3px 10px;border-radius:999px;font-size:12.5px;font-weight:700">Complexidade</span></span> (palavra)</span>
    <span class="k"><span class="stbadge" data-status="Em andamento">Em andamento</span> execução + %</span>
    ${CAN_EDIT()
      ? '<span class="k" style="color:#9AA6B4">Arraste um cartão para reclassificar · clique no lápis para editar</span>'
      : '<span class="k" style="color:#9AA6B4">Somente leitura — clique em “Entrar para editar”</span>'}`;
}

function renderBoard() {
  renderLegend();
  const area = el('boardArea');
  area.innerHTML = '';
  const items = filtered();
  if (view === 'coord') {
    COORDS.forEach(co => {
      const cs = sortCards(items.filter(c => c.coord === co.full), 'coord');
      const sec = document.createElement('section');
      sec.className = 'section';
      sec.innerHTML = `<div class="section-head"><span class="cdot" style="background:${co.dot}"></span><h2>${esc(co.full)}</h2><span class="count">${cs.length}</span></div><div class="grid"></div>`;
      const grid = sec.querySelector('.grid');
      if (cs.length) cs.forEach(c => grid.appendChild(cardEl(c)));
      else grid.innerHTML = '<div class="empty">Nenhuma demanda nesta coordenação</div>';
      wireDrop(sec, 'coord', co.full);
      area.appendChild(sec);
    });
  } else {
    const vals = view === 'prio' ? PRIOS : COMPS;
    const wrap = document.createElement('div');
    wrap.className = 'cols';
    vals.forEach(v => {
      const cs = sortCards(items.filter(c => (view === 'prio' ? c.prio : c.comp) === v), view);
      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = `<div class="col-head"><span class="lbl">${esc(view === 'prio' ? 'Prioridade ' + v : v)}</span><span class="count">${cs.length}</span></div><div class="grid"></div>`;
      const grid = col.querySelector('.grid');
      if (cs.length) cs.forEach(c => grid.appendChild(cardEl(c)));
      else grid.innerHTML = '<div class="empty">Arraste demandas para esta coluna</div>';
      wireDrop(col, view, v);
      wrap.appendChild(col);
    });
    area.appendChild(wrap);
  }
}

/* ---------- dashboards ---------- */
function ringSVG(pct) {
  const r = 46, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return `<svg width="112" height="112" viewBox="0 0 112 112"><circle cx="56" cy="56" r="${r}" fill="none" stroke="#EDEFF3" stroke-width="12"/><circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--exec)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 56 56)"/><text x="56" y="52" text-anchor="middle" font-size="24" font-weight="800" fill="#1B2430">${pct}%</text><text x="56" y="70" text-anchor="middle" font-size="10" fill="#78879A">executado</text></svg>`;
}
function barRows(gs) {
  return gs.map(g => `<div class="brow"><div class="bl">${g.dot ? `<span class="dotp" style="background:${g.dot}"></span>` : ''}${esc(g.label)}</div><div class="bt"><span style="width:${g.pct}%"></span></div><div class="bv"><b>${g.pct}%</b> · ${g.n} dem.</div></div>`).join('');
}

function renderHomeSummary() {
  const n = DATA.length, exec = avg(DATA.map(c => c.pct));
  const con = DATA.filter(c => c.status === 'Concluída').length;
  const and = DATA.filter(c => c.status === 'Em andamento').length;
  const byCoord = COORDS.map(co => { const g = DATA.filter(c => c.coord === co.full); return { label: co.short, dot: co.dot, n: g.length, pct: avg(g.map(c => c.pct)) }; });
  el('homeSummary').innerHTML = `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:14px">
      <div>${ringSVG(exec)}</div>
      <div style="display:grid;grid-template-columns:repeat(3,auto);gap:8px 22px">
        <div><div class="big tabular" style="font-size:26px;font-weight:800">${n}</div><div class="lab" style="color:var(--muted);font-size:12px">iniciativas</div></div>
        <div><div class="big tabular" style="font-size:26px;font-weight:800;color:var(--st-con)">${con}</div><div class="lab" style="color:var(--muted);font-size:12px">concluídas</div></div>
        <div><div class="big tabular" style="font-size:26px;font-weight:800;color:var(--st-and)">${and}</div><div class="lab" style="color:var(--muted);font-size:12px">em andamento</div></div>
      </div>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 4px">Execução por coordenação</div>
    ${barRows(byCoord)}`;
}

function renderDash() {
  const items = filteredA(), n = items.length, overall = avg(items.map(c => c.pct));
  const cnt = s => items.filter(c => c.status === s).length;
  const nao = cnt('Não iniciada'), and = cnt('Em andamento'), con = cnt('Concluída');
  const pctOf = k => n ? Math.round(k / n * 100) : 0;
  const byPrio = PRIOS.map(p => { const g = items.filter(c => c.prio === p); return { label: 'Prioridade ' + p, n: g.length, pct: avg(g.map(c => c.pct)) }; });
  const byComp = COMPS.map(v => { const g = items.filter(c => c.comp === v); return { label: v, n: g.length, pct: avg(g.map(c => c.pct)) }; });
  const byCoord = COORDS.map(co => { const g = items.filter(c => c.coord === co.full); return { label: co.short, dot: co.dot, n: g.length, pct: avg(g.map(c => c.pct)) }; });
  el('dashArea').innerHTML = `<div class="dash">
    <div class="kpis">
      <div class="kpi"><div>${ringSVG(overall)}</div><div><div class="lab">Execução geral</div><div class="sub2">média das ${n} iniciativas${(FA.coord || FA.prio) ? ' (filtro ativo)' : ''}</div></div></div>
      <div class="kpi"><div><div class="big tabular">${n}</div><div class="lab">Iniciativas</div></div></div>
      <div class="kpi"><div><div class="big tabular" style="color:var(--st-con)">${con}</div><div class="lab">Concluídas</div><div class="sub2">${pctOf(con)}% do total</div></div></div>
      <div class="kpi"><div><div class="big tabular" style="color:var(--st-and)">${and}</div><div class="lab">Em andamento</div><div class="sub2">${nao} não iniciadas</div></div></div>
    </div>
    <div class="panel"><h3>Situação das iniciativas</h3><div class="hint">Distribuição das iniciativas por situação de execução.</div>
      <div class="statusbar"><span style="width:${pctOf(nao)}%;background:var(--st-nao)"></span><span style="width:${pctOf(and)}%;background:var(--st-and)"></span><span style="width:${pctOf(con)}%;background:var(--st-con)"></span></div>
      <div class="slegend"><span class="k"><span class="sq" style="background:var(--st-nao)"></span> Não iniciada — <b>&nbsp;${nao}</b></span><span class="k"><span class="sq" style="background:var(--st-and)"></span> Em andamento — <b>&nbsp;${and}</b></span><span class="k"><span class="sq" style="background:var(--st-con)"></span> Concluída — <b>&nbsp;${con}</b></span></div></div>
    <div class="panels"><div class="panel"><h3>Execução por prioridade</h3><div class="hint">Percentual médio de execução em cada nível de prioridade.</div>${barRows(byPrio)}</div><div class="panel"><h3>Execução por complexidade</h3><div class="hint">Percentual médio de execução em cada grau de complexidade.</div>${barRows(byComp)}</div></div>
    <div class="panel"><h3>Execução por coordenação</h3><div class="hint">Percentual médio de execução em cada coordenação.</div>${barRows(byCoord)}</div></div>`;
}

/* ---------- navegação ---------- */
/* ---------- plano de trabalho (aba plano: 1 linha por produto, estilo PDF) ---------- */
function prazoKind(p){ return (typeof PRAZO_KIND!=='undefined' && PRAZO_KIND[p]) || 'adef'; }

function planoCard(p){
  const isSep = /SEI \(separado\)/.test(p.produto) || /Extração de documentos/.test(p.produto);
  const nd = p.demandas.length;
  const unico = nd>1 ? `<span class="prod-unico">Produto único · reúne ${nd} demandas</span>` : '';
  const dem = p.demandas.map(x=>`<li>${esc(x)}</li>`).join('');
  const idx = PLANO.indexOf(p);
  const acts = CAN_EDIT() ? `<div class="card-actions pcard-actions"><button class="iconbtn" title="Editar" data-pact="edit" data-idx="${idx}">✎</button><button class="iconbtn del" title="Excluir" data-pact="del" data-idx="${idx}">🗑</button></div>` : '';
  return `<article class="pcard${isSep?' sep':''}">
    <div class="pcard-head"><h3>${esc(p.produto)}</h3><span class="prazochip" data-prazo="${prazoKind(p.prazo)}">${esc(p.prazo)}</span>${acts}</div>
    ${unico?`<div class="pcard-tagline">${unico}</div>`:''}
    <div class="dem-label"><span class="dem-label-ic">🎯</span> Iniciativas</div>
    <ul class="pcard-dem">${dem}</ul>
    <div class="pcard-meta">
      <div><span class="ml">Fonte / acesso</span><span class="mv">${esc(p.fonte||'—')}</span></div>
      <div><span class="ml">Prioridade</span><span class="mv b">${esc(p.prioridade||'—')}</span></div>
      <div><span class="ml">Complexidade</span><span class="mv b">${esc(p.complexidade||'—')}</span></div>
    </div>
    ${p.observacao?`<div class="pcard-obs"><b>Observação:</b> ${esc(p.observacao)}</div>`:''}
  </article>`;
}

function renderPlano() {
  const host = el('planoArea');
  if (LIVE && !PLANO.length) { host.innerHTML = '<div class="loading">Carregando o plano da planilha, aguarde…</div>'; }
  const HZ = [
    { prazo:'Curto prazo', kind:'curto', desc:'Prioridade alta e baixa complexidade, ou dado já disponível. Primeiras entregas.' },
    { prazo:'Médio prazo', kind:'medio', desc:'Depende de liberar um acesso (execução rápida depois) ou de consolidar uma base.' },
    { prazo:'Longo prazo', kind:'longo', desc:'Depende de bases consolidadas ou de regras ainda a definir.' },
    { prazo:'A definir', kind:'adef', desc:'Casos indefinidos — inclui o que depende da extração de documentos do SEI e acessos em articulação.' }
  ];
  const ord = PLANO.slice().sort((a,b)=> (a.ordem||0)-(b.ordem||0));
  let html = '';
  HZ.forEach(h => {
    const inHz = ord.filter(p => (p.prazo||'A definir') === h.prazo);
    if (!inHz.length) return;
    html += `<section class="horizon">
      <div class="horizon-head" data-prazo="${h.kind}">
        <span class="hz-tag">${esc(h.prazo)}</span>
        <span class="hz-desc">${esc(h.desc)}</span>
        <span class="hz-count">${inHz.length}</span>
      </div>
      <div class="horizon-body">${inHz.map(planoCard).join('')}</div></section>`;
  });
  host.innerHTML = html || '<div class="empty">A aba \u201cplano\u201d ainda não tem produtos. Rode o setupPlano no Apps Script, ou verifique a conexão.</div>';

  const addbar = el('planoAddBar');
  if (addbar) addbar.style.display = CAN_EDIT() ? '' : 'none';

  host.querySelectorAll('[data-pact=edit]').forEach(b => b.addEventListener('click', () => openPlanoEdit(+b.dataset.idx)));
  host.querySelectorAll('[data-pact=del]').forEach(b => b.addEventListener('click', () => removePlano(+b.dataset.idx)));
}

/* ---------- edição do plano (produtos) ---------- */
let editingPlano = null;
function openPlanoEdit(idx) {
  if (!CAN_EDIT()) return;
  editingPlano = (idx != null && idx >= 0) ? PLANO[idx] : null;
  el('pTitle').textContent = editingPlano ? 'Editar produto do plano' : 'Novo produto do plano';
  el('pDelete').style.display = editingPlano ? 'inline-block' : 'none';
  el('pPrazo').innerHTML = (typeof PRAZOS !== 'undefined' ? PRAZOS : ['Curto prazo','Médio prazo','Longo prazo','A definir']).map(x => `<option>${esc(x)}</option>`).join('');
  const g = editingPlano || { produto:'', prazo:'A definir', prioridade:'', complexidade:'', demandas:[], fonte:'', observacao:'', ordem:(PLANO.reduce((m,p)=>Math.max(m,p.ordem||0),0)+1) };
  el('pProduto').value = g.produto; el('pPrazo').value = g.prazo; el('pPrio').value = g.prioridade;
  el('pComp').value = g.complexidade; el('pDem').value = (g.demandas||[]).join('\n');
  el('pFonte').value = g.fonte; el('pObs').value = g.observacao; el('pOrdem').value = g.ordem || 0;
  el('planoBack').classList.add('open'); setTimeout(() => el('pProduto').focus(), 30);
}
function closePlanoEdit() { el('planoBack').classList.remove('open'); editingPlano = null; }
async function savePlanoEdit() {
  const g = {
    ordem: Number(el('pOrdem').value) || 0,
    produto: el('pProduto').value.trim() || '(sem nome)',
    prazo: el('pPrazo').value,
    prioridade: el('pPrio').value.trim(),
    complexidade: el('pComp').value.trim(),
    demandas: el('pDem').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean),
    fonte: el('pFonte').value.trim(),
    observacao: el('pObs').value.trim()
  };
  if (editingPlano) Object.assign(editingPlano, g); else PLANO.push(normalizePlano(g));
  try {
    PLANO = await store.savePlano(PLANO.map(x => x));
    toast('Plano salvo');
  } catch (err) { toast('Não foi possível salvar o plano. ' + err.message, true); }
  closePlanoEdit(); renderPlano();
}
async function removePlano(idx) {
  const p = PLANO[idx]; if (!p) return;
  if (!confirm('Excluir o produto “' + p.produto + '” do plano?')) return;
  PLANO = PLANO.filter((_, i) => i !== idx);
  try { PLANO = await store.savePlano(PLANO.map(x => x)); toast('Excluído'); }
  catch (err) { toast('Não foi possível salvar o plano. ' + err.message, true); }
  renderPlano();
}

function go(s) {
  screen = s;
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.screen === s));
  el('scr-home').classList.toggle('hidden', s !== 'home');
  el('scr-demandas').classList.toggle('hidden', s !== 'demandas');
  el('scr-acomp').classList.toggle('hidden', s !== 'acomp');
  el('scr-plano').classList.toggle('hidden', s !== 'plano');
  refreshCurrent();
}
function refreshCurrent() {
  if (screen === 'demandas') renderBoard();
  else if (screen === 'acomp') renderDash();
  else if (screen === 'plano') renderPlano();
  else renderHomeSummary();
}

/* ---------- editar ---------- */
const opts = (list, sel) => list.map(v => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

/* Todos os <option> nascem daqui — data.js é a única fonte dos enums. */
function fillSelects() {
  el('mCoord').innerHTML = COORDS.map(c => `<option value="${esc(c.full)}">${esc(c.short)} — ${esc(c.full)}</option>`).join('');
  el('mPrio').innerHTML = opts(PRIOS);
  el('mComp').innerHTML = opts(COMPS);
  el('mStatus').innerHTML = opts(STATUS);
  el('mProduto').innerHTML = '<option value="">(sem produto)</option>' + opts(PRODUTOS);
  el('mPrazo').innerHTML = opts(PRAZOS);
  const coordFilter = '<option value="">Coordenação: todas</option>' + COORDS.map(c => `<option value="${esc(c.full)}">${esc(c.short)}</option>`).join('');
  el('fcoord').innerHTML = coordFilter;
  el('afcoord').innerHTML = coordFilter;
  el('fprio').innerHTML = '<option value="">Prioridade: todas</option>' + opts(PRIOS);
  el('afprio').innerHTML = '<option value="">Prioridade: todas</option>' + opts(PRIOS);
  el('fcomp').innerHTML = '<option value="">Complexidade: todas</option>' + opts(COMPS);
}

function openEdit(id) {
  if (!CAN_EDIT()) return;
  editing = id ? DATA.find(c => c.id === id) : null;
  el('mTitle').textContent = editing ? 'Editar demanda' : 'Nova demanda';
  el('mDelete').style.display = editing ? 'inline-block' : 'none';
  const g = editing || normalize({});
  el('mTit').value = g.titulo; el('mOq').value = g.oque; el('mFonte').value = g.fonte; el('mAcesso').value = g.acesso;
  el('mCoord').value = g.coord; el('mPrio').value = g.prio; el('mComp').value = g.comp;
  el('mStatus').value = g.status; el('mPct').value = g.pct; el('mObs').value = g.obs; el('mWarn').value = g.warn;
  el('mProduto').value = g.produto || ''; el('mPrazo').value = g.prazo || 'A definir';
  el('backdrop').classList.add('open');
  setTimeout(() => el('mTit').focus(), 30);
}
function closeEdit() { el('backdrop').classList.remove('open'); editing = null; }

async function saveEdit() {
  const g = {
    coord: el('mCoord').value,
    titulo: el('mTit').value.trim() || '(sem título)',
    oque: el('mOq').value.trim(),
    fonte: el('mFonte').value.trim(),
    acesso: el('mAcesso').value.trim(),
    prio: el('mPrio').value,
    comp: el('mComp').value,
    status: el('mStatus').value,
    pct: Math.max(0, Math.min(100, +el('mPct').value || 0)),
    obs: el('mObs').value.trim(),
    warn: el('mWarn').value.trim(),
    produto: el('mProduto').value,
    prazo: el('mPrazo').value
  };
  const alvo = editing;
  try {
    if (alvo) {
      const antes = Object.assign({}, alvo);
      Object.assign(alvo, g);
      try { await store.update(alvo); await store.persist(); }
      catch (err) { Object.assign(alvo, antes); throw err; }
    } else {
      /* O id só existe depois que o store grava — é ele que devolve o objeto
         bom para entrar em DATA. */
      const criada = await store.create(normalize(g));
      DATA.push(criada);
      await store.persist();
    }
    toast('Salvo');
    closeEdit();
    refreshCurrent();
  } catch (err) { handleErr(err); }
}

async function removeCard(id) {
  const c = DATA.find(x => x.id === id);
  if (!c) return;
  if (!confirm('Excluir a demanda “' + c.titulo + '”?')) return;
  try {
    await store.remove(id);
    DATA = DATA.filter(x => x.id !== id);
    await store.persist();
    toast('Excluída');
    refreshCurrent();
  } catch (err) { handleErr(err); }
}

/* ---------- exportar / importar ---------- */
function dl(name, txt, type) {
  const b = new Blob([txt], { type }), u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  URL.revokeObjectURL(u);
}
function exportJson() { dl('demandas_djud.json', JSON.stringify(DATA, null, 1), 'application/json'); }
function exportCsv() {
  const cols = ['coord', 'titulo', 'prio', 'comp', 'status', 'pct', 'fonte', 'acesso'];
  const csv = ['coordenacao,demanda,prioridade,complexidade,status,pct,fonte,acesso']
    .concat(DATA.map(c => cols.map(k => '"' + String(c[k] == null ? '' : c[k]).replace(/"/g, '""') + '"').join(',')))
    .join('\n');
  dl('demandas_djud.csv', '﻿' + csv, 'text/csv');   // BOM: o Excel precisa dele para os acentos
}

function importFile(f) {
  const r = new FileReader();
  r.onload = async () => {
    let lista;
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d) || !d.length) throw new Error('vazio');
      lista = d.map(normalize);
    } catch (e) { toast('Arquivo inválido: esperado um JSON exportado por este painel.', true); return; }
    const onde = LIVE ? 'na planilha' : 'neste navegador';
    if (!confirm(`Importar SUBSTITUI todas as demandas salvas ${onde} pelas ${lista.length} do arquivo. Continuar?`)) return;
    try {
      DATA = await store.replaceAll(lista);
      toast(lista.length + ' demandas importadas');
      refreshCurrent();
    } catch (err) { handleErr(err); }
  };
  r.readAsText(f);
}

/* ---------- login por senha compartilhada ---------- */
function updateWho() {
  const badge = el('modeBadge');
  badge.className = 'modebadge ' + (LIVE ? 'mode-live' : 'mode-demo');
  badge.textContent = LIVE ? 'Conectado (planilha)' : 'Modo demonstração';
  const who = el('who');
  who.textContent = LIVE ? (auth.authed ? 'edição liberada' : 'somente leitura') : '';
  el('loginBtn').classList.toggle('hidden', !LIVE || auth.authed);
  el('logoutBtn').classList.toggle('hidden', !LIVE || !auth.authed);
  el('addBtn').style.display = CAN_EDIT() ? '' : 'none';
  el('impBtn').style.display = CAN_EDIT() ? '' : 'none';
  el('resetBtn').style.display = LIVE ? 'none' : '';
}
function openLogin() { el('lErr').textContent = ''; el('lPass').value = ''; el('loginBack').classList.add('open'); setTimeout(() => el('lPass').focus(), 30); }
function closeLogin() { el('loginBack').classList.remove('open'); }

async function doLogin() {
  const pass = el('lPass').value;
  const errEl = el('lErr');
  errEl.textContent = '';
  try {
    await callSheet('login', { pass });
    auth.authed = true; auth.pass = pass;
    try { localStorage.setItem(PASSKEY, pass); } catch (e) {}
    closeLogin(); updateWho(); refreshCurrent();
    toast('Edição liberada');
  } catch (err) { errEl.textContent = err.message; }
}
function forgetPass() {
  auth.authed = false; auth.pass = null;
  try { localStorage.removeItem(PASSKEY); } catch (e) {}
  updateWho(); refreshCurrent();
}

/* ---------- boot ---------- */
async function boot() {
  if (LIVE) el('boardArea').innerHTML = '<div class="loading">Carregando as demandas da planilha, aguarde…</div>';
  try {
    DATA = await store.list();
  } catch (err) {
    DATA = [];
    toast('Não foi possível carregar as demandas. ' + err.message, true);
  }
  try { PLANO = await store.listPlano(); } catch (err) { PLANO = []; }
  updateWho();
  refreshCurrent();
}

/* ---------- eventos ---------- */
document.querySelectorAll('.nav button, .cta-btn, #brandHome').forEach(b =>
  b.addEventListener('click', () => { const s = b.dataset.screen || (b.id === 'brandHome' ? 'home' : null); if (s) go(s); }));
document.querySelectorAll('.seg button').forEach(b =>
  b.addEventListener('click', () => { view = b.dataset.view; document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderBoard(); }));
el('q').addEventListener('input', e => { F.q = e.target.value; renderBoard(); });
el('fcoord').addEventListener('change', e => { F.coord = e.target.value; renderBoard(); });
el('fprio').addEventListener('change', e => { F.prio = e.target.value; renderBoard(); });
el('fcomp').addEventListener('change', e => { F.comp = e.target.value; renderBoard(); });
el('afcoord').addEventListener('change', e => { FA.coord = e.target.value; renderDash(); });
el('afprio').addEventListener('change', e => { FA.prio = e.target.value; renderDash(); });
el('addBtn').addEventListener('click', () => openEdit(null));
el('mSave').addEventListener('click', saveEdit);
el('mCancel').addEventListener('click', closeEdit);
el('planoAddBtn').addEventListener('click', () => openPlanoEdit(null));
el('pSave').addEventListener('click', savePlanoEdit);
el('pCancel').addEventListener('click', closePlanoEdit);
el('pDelete').addEventListener('click', () => { if (editingPlano) { const i = PLANO.indexOf(editingPlano); closePlanoEdit(); removePlano(i); } });
el('planoBack').addEventListener('click', e => { if (e.target.id === 'planoBack') closePlanoEdit(); });
el('mDelete').addEventListener('click', () => { if (editing) { const id = editing.id; closeEdit(); removeCard(id); } });
el('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') closeEdit(); });
/* status e % andam juntos nos dois sentidos */
el('mStatus').addEventListener('change', e => {
  const v = e.target.value, pct = el('mPct');
  if (v === 'Concluída') pct.value = 100;
  else if (v === 'Não iniciada') pct.value = 0;
  else if (+pct.value === 0 || +pct.value === 100) pct.value = 50;
});
el('mPct').addEventListener('change', e => {
  const v = Math.max(0, Math.min(100, +e.target.value || 0));
  e.target.value = v;
  el('mStatus').value = v === 100 ? 'Concluída' : v === 0 ? 'Não iniciada' : 'Em andamento';
});
el('expJsonBtn').addEventListener('click', exportJson);
el('expCsvBtn').addEventListener('click', exportCsv);
el('impBtn').addEventListener('click', () => el('impFile').click());
el('impFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
el('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reiniciar para a versão original? Descarta as alterações locais.')) return;
  try { DATA = await store.resetSeed(); refreshCurrent(); toast('Reiniciado'); }
  catch (err) { handleErr(err); }
});
el('fsBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
el('loginBtn').addEventListener('click', openLogin);
el('logoutBtn').addEventListener('click', () => { forgetPass(); toast('Voltou para somente leitura'); });
el('lSubmit').addEventListener('click', doLogin);
el('lPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
el('lCancel').addEventListener('click', closeLogin);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeEdit(); closeLogin(); } });

/* ---------- init ---------- */
fillSelects();
if (LIVE) {
  try { const p = localStorage.getItem(PASSKEY); if (p) { auth.pass = p; auth.authed = true; } } catch (e) {}
}
updateWho();
go('home');
boot();
