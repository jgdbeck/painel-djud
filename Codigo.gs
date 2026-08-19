/**
 * Painel DJUD — API de persistência sobre uma Planilha Google.
 *
 * Este arquivo é a cópia versionada do que roda no editor do Apps Script.
 * Ao alterar aqui, cole no editor E publique uma NOVA VERSÃO da implantação
 * existente (Implantar > Gerenciar implantações > ✎ > Versão: Nova versão).
 * Criar uma implantação nova gera outra URL e o painel para de funcionar.
 *
 * Passo a passo completo de instalação: veja o README.md do repositório.
 *
 * Contrato (uma rota só, `action` no corpo — ver README para o porquê):
 *   GET  ?action=list                       -> leitura pública
 *   POST {action:'login',      pass}
 *   POST {action:'create',     pass, demanda}
 *   POST {action:'update',     pass, demanda}
 *   POST {action:'delete',     pass, id}
 *   POST {action:'replaceAll', pass, demandas}
 *
 * Resposta sempre HTTP 200 (o Apps Script não deixa escolher o status):
 *   {ok:true, data:...}  |  {ok:false, error:'...', code:'auth'|'config'|''}
 */

var SHEET_NAME = 'demandas';

/** A ordem define as colunas da planilha. `id` PRECISA ser a coluna A. */
var FIELDS = ['id', 'coord', 'titulo', 'oque', 'fonte', 'acesso', 'prio', 'comp', 'obs', 'warn', 'status', 'pct', 'produto', 'prazo'];

/* ---------------- rotas ---------------- */

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'list';
    if (action !== 'list') return fail_('Ação inválida no GET: ' + action);
    return ok_(readAll_());
  } catch (err) {
    return fail_(msg_(err));
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    var senha = PropertiesService.getScriptProperties().getProperty('SENHA');
    if (!senha) return fail_('O servidor está sem senha configurada (Propriedades do script > SENHA).', 'config');
    if (String(body.pass || '') !== senha) return fail_('Senha incorreta.', 'auth');

    if (action === 'login') return ok_(true);

    // Uma escrita por vez: sem isto, duas pessoas salvando juntas corrompem linhas.
    locked = lock.tryLock(15000);
    if (!locked) return fail_('A planilha está ocupada com outra alteração. Tente de novo.');

    if (action === 'create') return ok_(create_(body.demanda));
    if (action === 'update') return ok_(update_(body.demanda));
    if (action === 'delete') return ok_(remove_(body.id));
    if (action === 'replaceAll') return ok_(replaceAll_(body.demandas));
    return fail_('Ação desconhecida: ' + action);
  } catch (err) {
    return fail_(msg_(err));
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* ---------------- operações ---------------- */

function readAll_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(String);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim() === '') continue;   // linha vazia (sobra de exclusão)
    var o = {};
    for (var c = 0; c < head.length; c++) o[head[c]] = values[r][c];
    // A planilha devolve "1" como número e o cliente compara com ===.
    o.id = String(o.id);
    o.prio = String(o.prio);
    o.pct = Number(o.pct) || 0;
    out.push(o);
  }
  return out;
}

function create_(d) {
  if (!d) throw new Error('Demanda ausente.');
  d.id = 'd' + Date.now().toString(36);
  sheet_().appendRow(toRow_(d));
  return d;
}

function update_(d) {
  if (!d || !d.id) throw new Error('Demanda sem id.');
  var sh = sheet_();
  var r = rowOf_(sh, d.id);
  if (r < 0) throw new Error('Demanda não encontrada na planilha: ' + d.id);
  sh.getRange(r, 1, 1, FIELDS.length).setValues([toRow_(d)]);
  return d;
}

function remove_(id) {
  var sh = sheet_();
  var r = rowOf_(sh, id);
  if (r < 0) throw new Error('Demanda não encontrada na planilha: ' + id);
  sh.deleteRow(r);
  return true;
}

function replaceAll_(list) {
  // Recusa lista vazia de propósito: evita zerar a planilha por engano.
  if (!list || !list.length) throw new Error('A importação veio vazia — nada foi alterado.');
  var sh = sheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, FIELDS.length).clearContent();
  var rows = [];
  for (var i = 0; i < list.length; i++) rows.push(toRow_(list[i]));
  sh.getRange(2, 1, rows.length, FIELDS.length).setValues(rows);
  return rows.length;
}

/* ---------------- planilha ---------------- */

function ss_() {
  // Script criado pelo menu da planilha (recomendado): getActive resolve.
  // Script avulso: defina PLANILHA_ID nas Propriedades do script.
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Script não está vinculado a uma planilha. Defina PLANILHA_ID nas Propriedades do script.');
  return ss;
}

function sheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) writeHeader_(sh);
  return sh;
}

function rowOf_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function toRow_(d) {
  var row = [];
  for (var i = 0; i < FIELDS.length; i++) {
    var f = FIELDS[i], v = d[f];
    row.push(f === 'pct' ? (Number(v) || 0) : (v == null ? '' : String(v)));
  }
  return row;
}

function writeHeader_(sh) {
  sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/** Rode uma vez pelo editor (Executar > setup) para preparar a planilha. */
function setup() {
  writeHeader_(sheet_());
  var senha = PropertiesService.getScriptProperties().getProperty('SENHA');
  Logger.log(senha ? 'Aba pronta. Senha já configurada.'
                   : 'Aba pronta. FALTA definir a propriedade SENHA nas Configurações do projeto.');
}

/* ---------------- resposta ---------------- */

function ok_(data) {
  return json_({ ok: true, data: data === undefined ? null : data });
}
function fail_(error, code) {
  return json_({ ok: false, error: error, code: code || '' });
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function msg_(err) {
  return String((err && err.message) || err);
}
