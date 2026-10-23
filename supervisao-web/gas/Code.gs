const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const CFG = {
  salesSpreadsheetId: SCRIPT_PROPS.getProperty('SALES_SPREADSHEET_ID'),
  auxiliarySpreadsheetId: SCRIPT_PROPS.getProperty('AUXILIARY_SPREADSHEET_ID'),
  coverageSpreadsheetId: '1EtA9ET6gAzII96N6Iya34jvMU3CusTlNSbAZ5tCk1f8',
  cacheSpreadsheetId: SCRIPT_PROPS.getProperty('CACHE_SPREADSHEET_ID'),
  years: ['2024', '2025', '2026'],
  cacheSheetName: 'DATASET',
  maxPageSize: 10000
};

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!token || !constantTimeEqual_(String(body.token || ''), token)) return json_({ ok: false, message: 'Acesso não autorizado.' }, 401);
    if (body.action === 'info') return json_(datasetInfo_());
    if (body.action === 'refresh') return json_(refreshDataset_());
    if (body.action === 'page') return json_(datasetPage_(body.offset, body.limit));
    if (body.action === 'validate') return json_(validateSources_());
    return json_({ ok: false, message: 'Ação inválida.' }, 400);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, message: String(err && err.message ? err.message : err) }, 500);
  }
}

function json_(value, status) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ status: status || 200 }, value))).setMimeType(ContentService.MimeType.JSON);
}
function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function norm_(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(); }
function code_(v) { const m = String(v == null ? '' : v).match(/^\s*(\d+)/); return m ? Number(m[1]) : null; }
function num_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function dateIso_(v) {
  let y, m, d;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = Utilities.formatDate(v, 'America/Fortaleza', 'yyyy-MM-dd').split('-');
    y = Number(p[0]); m = Number(p[1]); d = Number(p[2]);
  } else {
    const s = String(v == null ? '' : v).trim();
    let q = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (q) { d = Number(q[1]); m = Number(q[2]); y = Number(q[3]); }
    else { q = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (!q) return null; y = Number(q[1]); m = Number(q[2]); d = Number(q[3]); }
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString() : null;
}
function headerIndex_(headers) { const map = {}; headers.forEach((h, i) => { map[String(h || '').trim()] = i; }); return map; }
function cell_(row, index, name) { return index[name] == null ? null : row[index[name]]; }
function readAuxiliary_() {
  const ss = SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId);
  const rcaSheet = ss.getSheetByName('RCA'), clientSheet = ss.getSheetByName('CLIENTES'), goalSheet = ss.getSheetByName('METAS'), routeSheet = ss.getSheetByName('ROTAS');
  if (!rcaSheet || !clientSheet || !goalSheet || !routeSheet) throw new Error('A base auxiliar precisa ter as abas RCA, CLIENTES, METAS e ROTAS.');
  const rcaValues = rcaSheet.getDataRange().getValues(), rcaIx = headerIndex_(rcaValues.shift() || []), rcaMap = new Map();
  rcaValues.forEach(row => {
    const c = code_(cell_(row, rcaIx, 'COD_RCA')), name = String(cell_(row, rcaIx, 'RCA') || '').trim();
    if (c != null && name) rcaMap.set(c, { code: c, name: name, supervisor: String(cell_(row, rcaIx, 'SUPERVISOR') || '').trim(), active: norm_(cell_(row, rcaIx, 'ATIVO') || 'S') === 'S' });
  });
  const clientValues = clientSheet.getDataRange().getValues(), clientIx = headerIndex_(clientValues.shift() || []), clients = [];
  clientValues.forEach(row => { const c = code_(cell_(row, clientIx, 'CODCLI')); if (c != null) clients.push([c, { code: c, name: String(cell_(row, clientIx, 'CLIENTE') || c).trim(), rca: code_(cell_(row, clientIx, 'COD_RCA')) }]); });
  const routeValues = routeSheet.getDataRange().getValues(), routeIx = headerIndex_(routeValues.shift() || []), routeMap = new Map();
  ['COD_RCA', 'PRACA', 'ROTA'].forEach(name => { if (routeIx[name] == null) throw new Error('A aba ROTAS não contém a coluna ' + name + '.'); });
  routeValues.forEach(row => {
    const rca = code_(cell_(row, routeIx, 'COD_RCA')), city = norm_(cell_(row, routeIx, 'PRACA')), route = String(cell_(row, routeIx, 'ROTA') || '').trim();
    if (rca != null && city && route) routeMap.set(rca + '|' + city, route);
  });
  const goalValues = goalSheet.getDataRange().getValues(), goalIx = headerIndex_(goalValues.shift() || []), goals = [];
  goalValues.forEach(row => {
    const key = String(cell_(row, goalIx, 'MES') || '').trim(), match = key.match(/^(20\d{2})-(0?[1-9]|1[0-2])$/), rca = code_(cell_(row, goalIx, 'COD_RCA'));
    if (!match || rca == null) return;
    const person = rcaMap.get(rca) || {};
    goals.push({ monthKey: match[1] + '-' + String(Number(match[2])).padStart(2, '0'), year: Number(match[1]), month: Number(match[2]), rca: rca, rcaName: person.name || '', supervisor: person.supervisor || '', department: String(cell_(row, goalIx, 'DEPARTAMENTO') || '').trim(), value: num_(cell_(row, goalIx, 'META')) });
  });
  return { rcas: Array.from(rcaMap.values()), rcaMap: rcaMap, clients: clients, goals: goals, routeMap: routeMap };
}
function buildSnapshotRecords_() {
  const aux = readAuxiliary_(), source = SpreadsheetApp.openById(CFG.salesSpreadsheetId), records = [];
  aux.rcas.forEach(r => records.push(JSON.stringify({ type: 'rca', value: r })));
  aux.goals.forEach(g => records.push(JSON.stringify({ type: 'goal', value: g })));
  aux.clients.forEach(c => records.push(JSON.stringify({ type: 'client', value: c })));
  let latest = null, validCount = 0;
  CFG.years.forEach(year => {
    const sheet = source.getSheetByName(year);
    if (!sheet) throw new Error('A aba anual ' + year + ' não foi encontrada na base de vendas.');
    const values = sheet.getDataRange().getValues();
    if (!values.length) return;
    const ix = headerIndex_(values.shift());
    ['Posição', 'Data Pedido', 'Cod/Vend.', 'Cod/Cliente', 'Cod/Produto', 'Pedidos Enviados'].forEach(name => { if (ix[name] == null) throw new Error('A aba ' + year + ' não contém a coluna ' + name + '.'); });
    values.forEach(row => {
      if (norm_(cell_(row, ix, 'Posição')) !== 'FECHADO') return;
      const iso = dateIso_(cell_(row, ix, 'Data Pedido'));
      if (!iso) return;
      const orderDate = new Date(iso), orderYear = orderDate.getUTCFullYear();
      if (String(orderYear) !== year) return;
      const rcaCode = code_(cell_(row, ix, 'Cod/Vend.')), rca = aux.rcaMap.get(rcaCode) || {}, clientCode = code_(cell_(row, ix, 'Cod/Cliente'));
      const rawProduct = String(cell_(row, ix, 'Cod/Produto') || '').trim(), productCode = code_(rawProduct);
      const productName = rawProduct.replace(/^\s*\d+\s*-\s*/, '').trim() || (productCode == null ? 'Sem descrição' : 'Produto ' + productCode);
      const city = String(cell_(row, ix, 'MUNICENT') || '').trim(), region = aux.routeMap.get(String(rcaCode) + '|' + norm_(city)) || '';
      const sale = { date: iso, year: orderYear, month: orderDate.getUTCMonth() + 1, monthKey: orderYear + '-' + String(orderDate.getUTCMonth() + 1).padStart(2, '0'), rca: rcaCode, rcaName: rca.name || String(rcaCode == null ? '' : rcaCode), supervisor: rca.supervisor || '', department: String(cell_(row, ix, 'DEPARTAMENTO') || '').trim(), client: clientCode, product: productCode, productName: productName, order: String(cell_(row, ix, 'NUMPED') || '').trim(), city: city, uf: norm_(cell_(row, ix, 'ESTENT')), region: region, value: num_(cell_(row, ix, 'Pedidos Enviados')), marginPct: null };
      records.push(JSON.stringify({ type: 'sale', value: sale })); validCount++; if (!latest || iso > latest) latest = iso;
    });
  });
  if (!validCount || !latest) throw new Error('Não foram encontradas vendas fechadas com Data Pedido válida.');
  records.push(JSON.stringify({ type: 'meta', value: { latest: latest, validCount: validCount } }));
  return { records: records, latest: latest, validCount: validCount };
}
function refreshDataset_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Já existe uma atualização de bases em andamento.');
  try {
    const started = Date.now(), snapshot = buildSnapshotRecords_(), cache = SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
    let sheet = cache.getSheetByName(CFG.cacheSheetName); if (!sheet) sheet = cache.insertSheet(CFG.cacheSheetName);
    sheet.clearContents(); sheet.getRange(1, 1).setValue('NDJSON');
    const chunkSize = 10000;
    for (let i = 0; i < snapshot.records.length; i += chunkSize) { const rows = snapshot.records.slice(i, i + chunkSize).map(value => [value]); sheet.getRange(i + 2, 1, rows.length, 1).setValues(rows); }
    const updatedAt = new Date().toISOString(), props = PropertiesService.getScriptProperties();
    // Keep source spreadsheet IDs, the cache ID, and any API credentials intact.
    props.setProperties({ SNAPSHOT_UPDATED_AT: updatedAt, SNAPSHOT_LATEST_DATE: snapshot.latest, SNAPSHOT_SALES_COUNT: String(snapshot.validCount), SNAPSHOT_RECORD_COUNT: String(snapshot.records.length) }, false);
    return { ok: true, latest: snapshot.latest, salesCount: snapshot.validCount, recordCount: snapshot.records.length, updatedAt: updatedAt, durationMs: Date.now() - started };
  } finally { lock.releaseLock(); }
}
function datasetInfo_() {
  const p = PropertiesService.getScriptProperties(), updatedAt = p.getProperty('SNAPSHOT_UPDATED_AT'), recordCount = Number(p.getProperty('SNAPSHOT_RECORD_COUNT') || 0);
  return { ok: true, exists: !!updatedAt && recordCount > 0, updatedAt: updatedAt, latest: p.getProperty('SNAPSHOT_LATEST_DATE'), salesCount: Number(p.getProperty('SNAPSHOT_SALES_COUNT') || 0), recordCount: recordCount };
}
function compactSnapshotRecord_(raw) {
  const item = JSON.parse(String(raw || '{}')), v = item.value || {};
  switch (item.type) {
    case 'sale': return [0, v.date, v.rca, v.department, v.client, v.product, v.productName, v.order, v.city, v.uf, v.region, v.value];
    case 'rca': return [1, v.code, v.name, v.supervisor, v.active];
    case 'goal': return [2, v.monthKey, v.year, v.month, v.rca, v.rcaName, v.supervisor, v.department, v.value];
    case 'client': return [3, v[0], v[1] && v[1].name, v[1] && v[1].rca];
    case 'meta': return [4, v.latest];
    default: return null;
  }
}
function datasetPage_(offset, limit) {
  const info = datasetInfo_(); if (!info.exists) throw new Error('A base processada ainda não foi criada.');
  const start = Math.max(0, Math.floor(Number(offset) || 0)), size = Math.max(1, Math.min(CFG.maxPageSize, Math.floor(Number(limit) || CFG.maxPageSize)));
  if (start >= info.recordCount) return { ok: true, offset: start, nextOffset: start, done: true, records: [] };
  const count = Math.min(size, info.recordCount - start), sheet = SpreadsheetApp.openById(CFG.cacheSpreadsheetId).getSheetByName(CFG.cacheSheetName);
  const records = sheet.getRange(start + 2, 1, count, 1).getValues().map(row => compactSnapshotRecord_(row[0])).filter(Boolean), nextOffset = start + count;
  return { ok: true, offset: start, nextOffset: nextOffset, done: nextOffset >= info.recordCount, records: records };
}
function validateSources_() {
  const sales = SpreadsheetApp.openById(CFG.salesSpreadsheetId), aux = SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId);
  return { ok: true, years: CFG.years.map(year => { const sheet = sales.getSheetByName(year); return { year: year, exists: !!sheet, rowsIncludingHeader: sheet ? sheet.getLastRow() : 0 }; }), auxiliarySheets: ['RCA', 'CLIENTES', 'METAS', 'ROTAS'].map(name => ({ name: name, exists: !!aux.getSheetByName(name) })), cacheSpreadsheetId: CFG.cacheSpreadsheetId };
}
function installProperties() {
  return validateSources_();
}

const AUTH = {
  usersUrl: 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/main/supervisao/usuarios.json',
  sessionTtlSeconds: 21600,
  pbkdf2Iterations: 200000
};
const UI_BUNDLE_URL = 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/6dd79b30628cada3d278c7544e7a7e4aa851abdd/supervisao-web/gas/gas-app.html';

function doGet() {
  const response = UrlFetchApp.fetch(UI_BUNDLE_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Não foi possível carregar a interface do dashboard.');
  return HtmlService.createHtmlOutput(response.getContentText()).setTitle('Dashboard de Supervisão • Rebanho');
}
function authorizeDashboard() {
  const response = UrlFetchApp.fetch(AUTH.usersUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Não foi possível autorizar a leitura do cadastro de usuários.');
  const info = datasetInfo_();
  return { ok: true, usersSource: 'ready', dataset: info.exists, salesCount: info.salesCount || 0 };
}


function coverageData_() {
  const cache = CacheService.getScriptCache(), key = 'DASH_COVERAGE_MATRIX_V1';
  const cached = cache.get(key);
  if (cached) { try { return JSON.parse(cached); } catch (err) { cache.remove(key); } }
  if (!CFG.coverageSpreadsheetId) throw new Error('A planilha de cobertura não foi configurada.');
  const ss = SpreadsheetApp.openById(CFG.coverageSpreadsheetId), sheet = ss.getSheetByName('MATRIZ_CIDADES');
  if (!sheet) throw new Error('A aba MATRIZ_CIDADES não foi encontrada na planilha de cobertura.');
  const values = sheet.getDataRange().getDisplayValues(), index = headerIndex_(values.shift() || []);
  const pick = (row, name) => String(cell_(row, index, name) || '').trim();
  const cities = values.map(row => ({
    uf: pick(row, 'ESTADO (UF)').toUpperCase(),
    city: pick(row, 'CIDADE'),
    nutrition: pick(row, 'NUTRIÇÃO'),
    animalHealth: pick(row, 'SAÚDE ANIMAL'),
    poultry: pick(row, 'AVES'),
    swine: pick(row, 'SUÍNOS'),
    nutritionRoute: pick(row, 'ROTA COMERCIAL - NUTRIÇÃO'),
    animalHealthRoute: pick(row, 'ROTA COMERCIAL - SAÚDE ANIMAL'),
    deliveryRoute: pick(row, 'ROTA DE ENTREGA'),
    status: pick(row, 'STATUS'),
    notes: pick(row, 'OBSERVAÇÕES'),
    region: pick(row, 'REGIONAL COMERCIAL (MAPA)')
  })).filter(row => row.uf && row.city);
  const result = { ok: true, cities: cities, updatedAt: null, count: cities.length };
  const serialized = JSON.stringify(result);
  try { if (Utilities.newBlob(serialized).getBytes().length < 95000) cache.put(key, serialized, 300); }
  catch (err) { console.warn('A matriz foi lida, mas não coube no cache temporário.', err); }
  return result;
}

function dashboardApi(action, payload, token) {
  try {
    action = String(action || ''); payload = payload || {};
    if (action === 'login') return loginDashboard_(payload);
    if (action === 'session') {
      const user = sessionUser_(token);
      return user ? { ok: true, authenticated: true, user: user } : { ok: true, authenticated: false };
    }
    if (action === 'logout') {
      if (token) CacheService.getScriptCache().remove('DASH_SESSION_' + token);
      return { ok: true };
    }
    const user = sessionUser_(token);
    if (!user) throw new Error('Sua sessão expirou. Entre novamente.');
    if (action === 'info') return Object.assign({ ok: true }, datasetInfo_());
    if (action === 'page') return datasetPage_(payload.offset, payload.limit);
    if (action === 'coverage') {
      if (payload.force === true) CacheService.getScriptCache().remove('DASH_COVERAGE_MATRIX_V1');
      return coverageData_();
    }
    if (action === 'refresh') {
      if (['ADMIN', 'GERENTE'].indexOf(user.perfil) < 0) throw new Error('Seu perfil não pode atualizar as bases.');
      return refreshDataset_();
    }
    throw new Error('Ação inválida.');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, message: String(err && err.message ? err.message : err) };
  }
}

function loginDashboard_(payload) {
  const login = String(payload.login || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!login || !password || password.length > 256) throw new Error('Usuário ou senha inválidos.');
  const cache = CacheService.getScriptCache(), throttleKey = 'DASH_LOGIN_FAIL_' + digestHex_(login).slice(0, 24);
  const attempts = Number(cache.get(throttleKey) || 0);
  if (attempts >= 8) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  const users = loadUsers_(), record = users[login];
  if (!record || record.ativo !== true || !verifyPassword_(password, record)) {
    cache.put(throttleKey, String(attempts + 1), 600);
    throw new Error('Usuário ou senha inválidos.');
  }
  cache.remove(throttleKey);
  const user = { login: login, nome: String(record.nome || login), perfil: String(record.perfil || 'RCA').toUpperCase(), cod_rca: record.cod_rca == null ? null : record.cod_rca, supervisor: String(record.supervisor || '') };
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('DASH_SESSION_' + token, JSON.stringify(user), AUTH.sessionTtlSeconds);
  return { ok: true, token: token, user: user };
}
function sessionUser_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const value = CacheService.getScriptCache().get('DASH_SESSION_' + token);
  if (!value) return null;
  try { return JSON.parse(value); } catch (err) { return null; }
}
function loadUsers_() {
  const cache = CacheService.getScriptCache(), cached = cache.get('DASH_USERS_JSON');
  if (cached) return JSON.parse(cached);
  const response = UrlFetchApp.fetch(AUTH.usersUrl, { muteHttpExceptions: true, followRedirects: true });
  if (response.getResponseCode() !== 200) throw new Error('Não foi possível validar o usuário no cadastro de acesso.');
  const users = JSON.parse(response.getContentText());
  if (!users || typeof users !== 'object') throw new Error('Cadastro de usuários inválido.');
  cache.put('DASH_USERS_JSON', JSON.stringify(users), 300);
  return users;
}
function verifyPassword_(password, record) {
  const algorithm = String(record.senha_algo || '').toLowerCase(), expected = String(record.senha_hash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  if (algorithm === 'sha256') return constantTimeEqual_(digestHex_(password), expected);
  if (algorithm === 'pbkdf2_sha256') {
    const salt = hexBytes_(String(record.salt || ''));
    if (!salt.length) return false;
    const passwordBytes = Utilities.newBlob(password).getBytes(), block = salt.concat([0, 0, 0, 1]);
    let u = Utilities.computeHmacSha256Signature(block, passwordBytes), result = u.slice();
    for (let i = 1; i < AUTH.pbkdf2Iterations; i++) {
      u = Utilities.computeHmacSha256Signature(u, passwordBytes);
      for (let j = 0; j < result.length; j++) result[j] = result[j] ^ u[j];
    }
    return constantTimeEqual_(bytesHex_(result), expected);
  }
  return false;
}
function digestHex_(value) {
  return bytesHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8));
}
function bytesHex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function hexBytes_(hex) {
  if (!/^(?:[a-f0-9]{2})*$/i.test(hex)) return [];
  const out = [];
  for (let i = 0; i < hex.length; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16); out.push(value > 127 ? value - 256 : value);
  }
  return out;
}
