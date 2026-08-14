/* Smoke test do Painel DJUD.
 *
 *   cd test && npm install && npm test
 *
 * Carrega o painel de verdade num DOM (jsdom) e exercita os dois modos. O modo
 * conectado roda contra uma planilha simulada, então o teste não toca no Google
 * e não precisa de senha nem de rede.
 *
 * O painel em si continua sem build e sem dependências — o Node é usado só aqui.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)})`);
const tick = () => new Promise(r => setTimeout(r, 0));

/* const/let de um <script> não viram propriedades de window; esta ponte dá
   acesso ao estado interno sem alterar o código de produção. */
const PONTE = `window.__t = {
  get DATA(){return DATA}, set DATA(v){DATA=v},
  get store(){return store}, get auth(){return auth},
  LIVE, CAN_EDIT, COORDS, PRIOS, COMPS, STATUS, F, FA,
  normalize, go, renderBoard, renderDash, openEdit, saveEdit, removeCard,
  exportJson, exportCsv, doLogin, forgetPass
};`;

async function build({ sheetApi = '', storage = null, fetchImpl = null } = {}) {
  const html = read('index.html').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://exemplo.org/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.confirm = () => true;
  w.alert = m => { throw new Error('alert() não deveria mais ser usado: ' + m); };
  const downloads = [];
  w.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:fake'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  if (fetchImpl) w.fetch = fetchImpl;
  const run = code => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  run(read('config.js').replace('SHEET_API: ""', `SHEET_API: ${JSON.stringify(sheetApi)}`));
  run(read('data.js'));
  run(read('app.js'));
  run(PONTE);
  await tick(); await tick();
  return { w, t: w.__t, dom, downloads };
}

const cards = w => w.document.querySelectorAll('#boardArea .card');
const goto = (t, s) => { t.go(s); };

/* ============ MODO DEMONSTRAÇÃO ============ */
async function demo() {
  console.log('\n== Modo demonstração (localStorage) ==');
  const { w, t, downloads } = await build();

  eq(t.DATA.length, 35, 'carregou as 35 demandas do seed');
  eq(t.LIVE, false, 'LIVE=false sem SHEET_API');
  ok(t.CAN_EDIT(), 'pode editar no modo demo');
  eq(w.document.getElementById('modeBadge').textContent, 'Modo demonstração', 'badge de modo');

  // home
  ok(w.document.getElementById('homeSummary').innerHTML.includes('iniciativas'), 'home renderiza o panorama');

  // board
  goto(t, 'demandas');
  eq(cards(w).length, 35, 'quadro renderiza 35 cards');
  eq(w.document.querySelectorAll('#boardArea .section').length, 8, 'uma seção por coordenação');

  // data-attributes substituíram as classes acentuadas
  const c1 = t.DATA.find(d => d.prio === '1');
  const node = w.document.querySelector(`.card[data-id="${c1.id}"]`);
  eq(node.querySelector('.prio').getAttribute('data-prio'), '1', 'card usa data-prio');
  ok(node.querySelector('.pill').hasAttribute('data-comp'), 'card usa data-comp');
  ok(node.querySelector('.stbadge').hasAttribute('data-status'), 'card usa data-status');
  eq(w.document.querySelectorAll('[class*="cx-"], [class*="st-N"], .p1, .pdef').length, 0, 'nenhuma classe acentuada sobrou');

  // selects gerados a partir dos enums
  eq(w.document.getElementById('mPrio').options.length, 4, 'mPrio gerado de PRIOS');
  eq(w.document.getElementById('mComp').options.length, 4, 'mComp gerado de COMPS');
  eq(w.document.getElementById('mStatus').options.length, 3, 'mStatus gerado de STATUS');
  eq(w.document.getElementById('fprio').options.length, 5, 'filtro de prioridade = todas + 4');
  eq(w.document.getElementById('fcoord').options.length, 9, 'filtro de coordenação = todas + 8');

  // filtros
  t.F.q = 'SISMAT'; t.renderBoard();
  ok(cards(w).length > 0 && cards(w).length < 35, `busca filtra (${cards(w).length} cards)`);
  t.F.q = ''; t.F.prio = '1'; t.renderBoard();
  eq(cards(w).length, t.DATA.filter(d => d.prio === '1').length, 'filtro de prioridade');
  t.F.prio = ''; t.renderBoard();

  // criar
  const set = (id, v) => { w.document.getElementById(id).value = v; };
  t.openEdit(null);
  set('mTit', 'Demanda de teste'); set('mOq', 'descrição'); set('mCoord', t.COORDS[2].full);
  set('mPrio', '2'); set('mComp', 'Alta'); set('mStatus', 'Em andamento'); set('mPct', '40');
  await t.saveEdit(); await tick();
  eq(t.DATA.length, 36, 'criar acrescenta em DATA');
  const nova = t.DATA[t.DATA.length - 1];
  ok(!!nova.id, 'a demanda criada recebeu id');
  eq(cards(w).length, 36, 'card novo aparece SEM recarregar (bug nº 1)');

  // editar
  t.openEdit(nova.id);
  set('mTit', 'Demanda renomeada'); set('mPct', '100');
  await t.saveEdit(); await tick();
  eq(t.DATA.find(d => d.id === nova.id).titulo, 'Demanda renomeada', 'edição salva o título');
  eq(t.DATA.find(d => d.id === nova.id).pct, 100, 'edição salva o pct');

  // persistência entre recargas
  const salvo = w.localStorage.getItem('djud_demandas_v3');
  ok(salvo && JSON.parse(salvo).length === 36, 'gravou no localStorage');
  const r2 = await build({ storage: { djud_demandas_v3: salvo } });
  eq(r2.t.DATA.length, 36, 'recarregar mantém os dados');
  ok(!!r2.t.DATA.find(d => d.titulo === 'Demanda renomeada'), 'o registro editado sobreviveu à recarga');

  // excluir
  await t.removeCard(nova.id); await tick();
  eq(t.DATA.length, 35, 'excluir remove de DATA');
  eq(JSON.parse(w.localStorage.getItem('djud_demandas_v3')).length, 35, 'exclusão persistiu');

  // dashboard
  goto(t, 'acomp');
  ok(w.document.getElementById('dashArea').innerHTML.includes('Execução geral'), 'dashboard renderiza');
  t.FA.prio = '1'; t.renderDash();
  ok(w.document.getElementById('dashArea').innerHTML.includes('(filtro ativo)'), 'dashboard respeita o filtro');

  // exportar: dois botões separados, um download cada
  goto(t, 'demandas');
  t.exportJson(); t.exportCsv();
  eq(downloads.length, 2, 'exportar JSON e CSV gera 1 download cada (bug nº 5)');
  const csv = await downloads[1].text();
  // Blob.text() descarta o BOM ao decodificar, então é preciso olhar os bytes.
  const bytes = new Uint8Array(await downloads[1].arrayBuffer());
  ok(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, 'CSV começa com BOM para o Excel');
  eq(csv.split('\n').length, 36, 'CSV tem cabeçalho + 35 linhas');
  const json = JSON.parse(await downloads[0].text());
  eq(json.length, 35, 'JSON exportado tem as 35 demandas');

  // reiniciar
  t.DATA = []; t.DATA = await t.store.resetSeed();
  eq(t.DATA.length, 35, 'reiniciar volta ao seed');
}

/* ============ NORMALIZE ============ */
async function normalizacao() {
  console.log('\n== normalize(): coerções vindas da planilha ==');
  const { w, t } = await build();
  const n = t.normalize({ id: 12345, prio: 1, pct: '55.6', titulo: 'x', comp: 'Inexistente', status: 'Qualquer' });
  eq(typeof n.id, 'string', 'id numérico da planilha vira string');
  eq(n.prio, '1', 'prio numérico 1 vira "1"');
  eq(typeof n.pct, 'number', 'pct vira número');
  eq(n.pct, 56, 'pct arredonda');
  eq(n.comp, 'Média', 'complexidade inválida cai no padrão');
  eq(n.status, 'Não iniciada', 'status inválido cai no padrão');
  eq(t.normalize({ pct: 999 }).pct, 100, 'pct acima de 100 é limitado');
  eq(t.normalize({ pct: -5 }).pct, 0, 'pct negativo é limitado');
}

/* ============ MODO CONECTADO (planilha) ============ */
function fakeSheet(state) {
  return async (url, opts) => {
    const body = { text: async () => '' };
    const json = obj => ({ ok: true, status: 200, json: async () => obj, ...body });
    if (!opts) { // GET list
      state.calls.push('GET list');
      return json({ ok: true, data: state.rows.slice() });
    }
    const req = JSON.parse(opts.body);
    state.calls.push(req.action);
    state.lastHeaders = opts.headers;
    if (req.pass !== state.senha) return json({ ok: false, error: 'Senha incorreta.', code: 'auth' });
    if (req.action === 'login') return json({ ok: true, data: true });
    if (req.action === 'create') { const d = Object.assign({}, req.demanda, { id: 'srv' + (++state.seq) }); state.rows.push(d); return json({ ok: true, data: d }); }
    if (req.action === 'update') {
      if (state.failUpdate) return json({ ok: false, error: 'boom' });
      const i = state.rows.findIndex(r => r.id === req.demanda.id); state.rows[i] = req.demanda; return json({ ok: true, data: req.demanda });
    }
    if (req.action === 'delete') { state.rows = state.rows.filter(r => r.id !== req.id); return json({ ok: true, data: true }); }
    if (req.action === 'replaceAll') { state.rows = req.demandas.slice(); return json({ ok: true, data: state.rows.length }); }
    return json({ ok: false, error: 'ação desconhecida' });
  };
}

async function conectado() {
  console.log('\n== Modo conectado (planilha simulada) ==');
  const state = { senha: 'frase-secreta-longa', rows: [{ id: 'd01', coord: 'DIRETORA', titulo: 'Vinda da planilha', prio: 1, comp: 'Alta', status: 'Não iniciada', pct: 0, oque: '', fonte: '', acesso: '', obs: '', warn: '' }], seq: 0, calls: [] };
  const { w, t } = await build({ sheetApi: 'https://script.google.com/macros/s/FAKE/exec', fetchImpl: fakeSheet(state) });

  eq(t.LIVE, true, 'LIVE=true com SHEET_API');
  eq(t.DATA.length, 1, 'carregou da planilha, não do seed');
  eq(t.DATA[0].prio, '1', 'prio 1 numérico da planilha virou string');
  eq(w.document.getElementById('modeBadge').textContent, 'Conectado (planilha)', 'badge de modo conectado');

  // leitura pública, sem senha
  eq(t.CAN_EDIT(), false, 'sem senha: somente leitura');
  eq(w.document.getElementById('who').textContent, 'somente leitura', 'rótulo de somente leitura');
  eq(w.document.getElementById('addBtn').style.display, 'none', 'botão Nova demanda escondido');
  eq(w.document.getElementById('impBtn').style.display, 'none', 'botão Importar escondido');
  eq(w.document.getElementById('resetBtn').style.display, 'none', 'botão Reiniciar escondido no modo conectado');
  goto(t, 'demandas');
  eq(w.document.querySelectorAll('#boardArea .card-actions').length, 0, 'cards sem lápis/lixeira');
  ok(w.document.getElementById('legend').textContent.includes('Somente leitura'), 'legenda avisa somente leitura');

  // senha errada
  w.document.getElementById('lPass').value = 'errada';
  await t.doLogin(); await tick();
  eq(t.CAN_EDIT(), false, 'senha errada não libera');
  eq(w.document.getElementById('lErr').textContent, 'Senha incorreta.', 'mensagem de senha incorreta');

  // senha certa
  w.document.getElementById('lPass').value = state.senha;
  await t.doLogin(); await tick();
  ok(t.CAN_EDIT(), 'senha certa libera a edição');
  eq(w.localStorage.getItem('djud_pass'), state.senha, 'senha guardada para as próximas visitas');
  eq(w.document.querySelectorAll('#boardArea .card-actions').length, 1, 'lápis/lixeira aparecem sem recarregar');

  // POST precisa ser "simple request" para não disparar preflight
  eq(state.lastHeaders['Content-Type'], 'text/plain;charset=utf-8', 'POST usa text/plain (sem preflight CORS)');
  ok(!('Authorization' in state.lastHeaders), 'POST não manda cabeçalho Authorization');

  // criar grava na planilha e entra em DATA com o id do servidor
  const set = (id, v) => { w.document.getElementById(id).value = v; };
  t.openEdit(null);
  set('mTit', 'Criada online'); set('mPrio', '2'); set('mComp', 'Baixa'); set('mStatus', 'Em andamento'); set('mPct', '30');
  await t.saveEdit(); await tick();
  eq(state.rows.length, 2, 'linha nova chegou na planilha');
  eq(t.DATA.length, 2, 'entrou em DATA');
  eq(t.DATA[1].id, 'srv1', 'DATA usa o id gerado pelo servidor (bug nº 1)');
  eq(w.document.querySelectorAll('#boardArea .card').length, 2, 'card novo aparece sem recarregar');

  // editar
  t.openEdit('srv1'); set('mTit', 'Editada online'); await t.saveEdit(); await tick();
  eq(state.rows.find(r => r.id === 'srv1').titulo, 'Editada online', 'edição chegou na planilha');

  // rollback quando a gravação falha
  const alvo = t.DATA.find(d => d.id === 'srv1');
  const antes = alvo.titulo;
  state.failUpdate = true;
  t.openEdit('srv1'); set('mTit', 'Não deve persistir'); await t.saveEdit(); await tick();
  eq(t.DATA.find(d => d.id === 'srv1').titulo, antes, 'edição que falhou é desfeita em DATA');
  state.failUpdate = false;

  // rollback do arrastar
  state.failUpdate = true;
  const card = t.DATA.find(d => d.id === 'srv1');
  const prio0 = card.prio;
  card.prio = '3';
  try { await t.store.update(card); } catch (e) { card.prio = prio0; }
  eq(card.prio, prio0, 'arrastar com erro volta ao valor anterior (bug nº 3)');
  state.failUpdate = false;

  // excluir
  await t.removeCard('srv1'); await tick();
  eq(state.rows.length, 1, 'linha removida da planilha');
  eq(t.DATA.length, 1, 'removida de DATA');

  // importar substitui tudo de uma vez
  const lista = [{ id: 'i1', titulo: 'A', coord: 'DIRETORA' }, { id: 'i2', titulo: 'B', coord: 'DIRETORA' }];
  t.DATA = await t.store.replaceAll(lista.map(t.normalize));
  eq(state.rows.length, 2, 'replaceAll substituiu o conteúdo da planilha (bug nº 4)');
  ok(state.calls.includes('replaceAll'), 'usou a ação replaceAll, não um create por linha');
  eq(t.DATA.length, 2, 'DATA recarregou da planilha');

  // sair volta para somente leitura
  t.forgetPass();
  eq(t.CAN_EDIT(), false, 'sair remove a permissão de editar (bug nº 2)');
  eq(w.localStorage.getItem('djud_pass'), null, 'senha apagada do navegador');

  // sessão lembrada na próxima visita
  const r3 = await build({ sheetApi: 'https://x/exec', fetchImpl: fakeSheet(state), storage: { djud_pass: state.senha } });
  ok(r3.t.CAN_EDIT(), 'senha lembrada libera a edição na volta');

  // reiniciar é bloqueado no modo conectado
  let bloqueou = false;
  try { await r3.t.store.resetSeed(); } catch (e) { bloqueou = true; }
  ok(bloqueou, 'Reiniciar é recusado no modo conectado');
}

/* ============ ESCAPE ============ */
async function seguranca() {
  console.log('\n== Escape de conteúdo ==');
  const { w, t } = await build();
  t.DATA = [t.normalize({ id: 'x', titulo: '<img src=x onerror=alert(1)>', coord: t.COORDS[0].full, oque: '"><script>bad()</script>' })];
  goto(t, 'demandas');
  const card = w.document.querySelector('.card[data-id="x"]');
  eq(card.querySelectorAll('img, script').length, 0, 'HTML no título não vira elemento');
  ok(card.querySelector('.card-title').textContent.includes('<img'), 'título aparece como texto literal');
}

(async () => {
  await demo();
  await normalizacao();
  await conectado();
  await seguranca();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nERRO NO TESTE:', e); process.exit(2); });
