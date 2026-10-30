const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const CFG = {
  salesSpreadsheetId: SCRIPT_PROPS.getProperty('SALES_SPREADSHEET_ID'),
  auxiliarySpreadsheetId: SCRIPT_PROPS.getProperty('AUXILIARY_SPREADSHEET_ID'),
  coverageSpreadsheetId: '1EtA9ET6gAzII96N6Iya34jvMU3CusTlNSbAZ5tCk1f8',
  cacheSpreadsheetId: SCRIPT_PROPS.getProperty('CACHE_SPREADSHEET_ID'),
  years: ['2024', '2025', '2026'],
  cacheSheetName: SCRIPT_PROPS.getProperty('SNAPSHOT_SHEET_NAME') || 'DATASET',
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
    const p = new Date(v.getTime()-10800000).toISOString().slice(0,10).split('-');
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
    ['Posição', 'Data Faturamento', 'Cod/Vend.', 'Cod/Cliente', 'Cod/Produto', 'Pedidos Enviados'].forEach(name => { if (ix[name] == null) throw new Error('A aba ' + year + ' não contém a coluna ' + name + '.'); });
    values.forEach(row => {
      if (norm_(cell_(row, ix, 'Posição')) !== 'FECHADO') return;
      const iso = dateIso_(cell_(row, ix, 'Data Faturamento'));
      if (!iso) return;
      const orderDate = new Date(iso), orderYear = orderDate.getUTCFullYear();
      const rcaCode = code_(cell_(row, ix, 'Cod/Vend.')), rca = aux.rcaMap.get(rcaCode) || {}, clientCode = code_(cell_(row, ix, 'Cod/Cliente'));
      const rawProduct = String(cell_(row, ix, 'Cod/Produto') || '').trim(), productCode = code_(rawProduct);
      const productName = rawProduct.replace(/^\s*\d+\s*-\s*/, '').trim() || (productCode == null ? 'Sem descrição' : 'Produto ' + productCode);
      const city = String(cell_(row, ix, 'MUNICENT') || '').trim(), region = aux.routeMap.get(String(rcaCode) + '|' + norm_(city)) || '';
      const sale = { date: iso, year: orderYear, month: orderDate.getUTCMonth() + 1, monthKey: orderYear + '-' + String(orderDate.getUTCMonth() + 1).padStart(2, '0'), rca: rcaCode, rcaName: rca.name || String(rcaCode == null ? '' : rcaCode), supervisor: rca.supervisor || '', department: String(cell_(row, ix, 'DEPARTAMENTO') || '').trim(), client: clientCode, product: productCode, productName: productName, order: String(cell_(row, ix, 'NUMPED') || '').trim(), city: city, uf: norm_(cell_(row, ix, 'ESTENT')), region: region, value: num_(cell_(row, ix, 'Pedidos Enviados')), marginPct: null };
      records.push(JSON.stringify({ type: 'sale', value: sale })); validCount++; if (!latest || iso > latest) latest = iso;
    });
  });
  if (!validCount || !latest) throw new Error('Não foram encontradas vendas fechadas com Data Faturamento válida.');
  records.push(JSON.stringify({ type: 'meta', value: { latest: latest, validCount: validCount } }));
  return { records: records, latest: latest, validCount: validCount };
}
function refreshOpenOrdersCache_() {
  const source = SpreadsheetApp.openById(CFG.salesSpreadsheetId);
  const year = String(CFG.years[CFG.years.length - 1]);
  const sourceSheet = source.getSheetByName(year);
  if (!sourceSheet) throw new Error('A aba anual ' + year + ' não foi encontrada na base de vendas.');
  const values = sourceSheet.getDataRange().getValues();
  const cache = SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
  let cacheSheet = cache.getSheetByName('OPEN_ORDERS');
  if (!cacheSheet) cacheSheet = cache.insertSheet('OPEN_ORDERS');
  const records = [];
  const aux = readAuxiliary_();
  if (values.length) {
    const ix = headerIndex_(values.shift());
    ['Posição', 'Data Pedido', 'Cod/Vend.', 'Cod/Cliente', 'Cod/Produto', 'NUMPED', 'Pedidos Enviados'].forEach(name => {
      if (ix[name] == null) throw new Error('A aba ' + year + ' não contém a coluna ' + name + '.');
    });
    values.forEach(row => {
      const status = norm_(cell_(row, ix, 'Posição'));
      if (['PENDENTE', 'LIBERADO', 'BLOQUEADO'].indexOf(status) < 0) return;
      if (cell_(row, ix, 'Numero Nota Fiscal') || cell_(row, ix, 'Data Faturamento')) return;
      const iso = dateIso_(cell_(row, ix, 'Data Pedido'));
      if (!iso || String(new Date(iso).getUTCFullYear()) !== year) return;
      const orderDate = new Date(iso), rcaCode = code_(cell_(row, ix, 'Cod/Vend.'));
      const rca = aux.rcaMap.get(rcaCode) || {};
      const rawProduct = String(cell_(row, ix, 'Cod/Produto') || '').trim();
      const productCode = code_(rawProduct);
      const productName = rawProduct.replace(/^\s*\d+\s*-\s*/, '').trim() || (productCode == null ? 'Sem descrição' : 'Produto ' + productCode);
      const city = String(cell_(row, ix, 'MUNICENT') || '').trim();
      const region = aux.routeMap.get(String(rcaCode) + '|' + norm_(city)) || '';
      records.push(JSON.stringify({ type: 'openOrder', value: {
        date: iso, year: Number(year), month: orderDate.getUTCMonth() + 1,
        monthKey: year + '-' + String(orderDate.getUTCMonth() + 1).padStart(2, '0'),
        status: status, rca: rcaCode, rcaName: rca.name || String(rcaCode == null ? '' : rcaCode),
        supervisor: rca.supervisor || '', department: String(cell_(row, ix, 'DEPARTAMENTO') || '').trim(),
        client: code_(cell_(row, ix, 'Cod/Cliente')), product: productCode, productName: productName,
        order: String(cell_(row, ix, 'NUMPED') || '').trim(), city: city,
        uf: norm_(cell_(row, ix, 'ESTENT')), region: region, value: num_(cell_(row, ix, 'Pedidos Enviados'))
      }}));
    });
  }
  cacheSheet.clearContents();
  cacheSheet.getRange(1, 1).setValue('NDJSON');
  if (records.length) cacheSheet.getRange(2, 1, records.length, 1).setValues(records.map(value => [value]));
  const updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty('OPEN_ORDERS_UPDATED_AT', updatedAt);
  return { ok: true, count: records.length, updatedAt: updatedAt };
}

function openOrdersData_() {
  const cache = SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
  let sheet = cache.getSheetByName(PropertiesService.getScriptProperties().getProperty('OPEN_ORDERS_SHEET_NAME') || 'OPEN_ORDERS');
  if (!sheet || sheet.getLastRow() < 1) {
    refreshOpenOrdersCache_();
    sheet = cache.getSheetByName(PropertiesService.getScriptProperties().getProperty('OPEN_ORDERS_SHEET_NAME') || 'OPEN_ORDERS');
  }
  const lastRow = Math.max(0, sheet.getLastRow() - 1);
  const orders = lastRow ? sheet.getRange(2, 1, lastRow, 1).getValues().map(row => {
    try { return JSON.parse(String(row[0] || '{}')).value || null; } catch (err) { return null; }
  }).filter(Boolean) : [];
  return { ok: true, updatedAt: PropertiesService.getScriptProperties().getProperty('OPEN_ORDERS_UPDATED_AT') || null, orders: orders };
}

function refreshDataset_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Já existe uma atualização de bases em andamento.');
  try {
    const started = Date.now();
    try { refreshOpenOrdersCache_(); } catch (err) { console.warn('A carteira de pedidos não foi atualizada.', err); }
    const snapshot = buildSnapshotRecords_(), cache = SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
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
const UI_BUNDLE_URL = 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/a9ea792fe0252ac2d31387fe299148b8f178b113/supervisao-web/gas/gas-app.html';

function doGet() {
  const response = UrlFetchApp.fetch(UI_BUNDLE_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Não foi possível carregar a interface do dashboard.');
  return HtmlService.createHtmlOutput(response.getContentText()).setTitle('Dashboard de Supervisão • Rebanho').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
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
    if (action === 'openOrders') return openOrdersData_();
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



// ===== SalesSync.gs (integração Força de Vendas RBN) =====
/**
 * Integração Força de Vendas RBN -> planilha anual EXISTENTE da Supervisão.
 * Cole este arquivo no MESMO projeto Apps Script do Dashboard (Code.gs).
 *
 * Propriedades do script:
 *   VENDAS_SYNC_URL    URL HTTPS publicada da rota /api/public/vendas-sync
 *   VENDAS_SYNC_SECRET segredo de 32+ caracteres igual ao do app
 *   SALES_SPREADSHEET_ID = 1Y2lBDn35U6_T5z2uwE35ZDVcNJDjQ4Z0QWSu499LdPE
 *
 * Execute instalarGatilhosVendasRbn() uma única vez, autorizando permissões.
 * A sincronização atualiza somente as abas 2024, 2025 e 2026.
 * Não modifica o Excel BASE_VENDAS_SUPERVISAO.xlsx.
 *
 * SEGURANÇA: nunca apagar Qt Pedida, Vl Lucro ou Vl Desconto quando o app
 * exportar null. Ao reimportar, vendas coincidentes são atualizadas e novas
 * adicionadas. Itens ausentes e duplicatas permanecem intactos para revisão
 * manual.
 */

var VENDAS_RBN_CFG = {
  anos: ['2024', '2025', '2026'],
  colunas: ['ESTENT','MUNICENT','DEPARTAMENTO','SECAO','Cod/Fornecedor',
    'Cod/Produto','RAMO','Cod/Cliente','NUMPED','Numero Nota Fiscal',
    'Posição','Qt Pedida','Pedidos Enviados','Vl Lucro','Vl Desconto',
    'Data Pedido','Data Faturamento','Ano','Mês_Ano','Cod/Vend.'],
  maxItens: 30000,
  tamanhoLeitura: 4000,
  tamanhoEscrita: 2000
};

function instalarGatilhosVendasRbn() {
  var funcs = ['sincronizarVendasRbn','atualizarCacheVendasRbn'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (funcs.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizarVendasRbn').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('atualizarCacheVendasRbn').timeBased().everyMinutes(5).create();
  return {ok:true, gatilhos:funcs};
}

function rbnConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = String(p.getProperty('VENDAS_SYNC_URL') || '').replace(/\/$/, '');
  var secret = String(p.getProperty('VENDAS_SYNC_SECRET') || '');
  var sheetId = p.getProperty('SALES_SPREADSHEET_ID') ||
    '1Y2lBDn35U6_T5z2uwE35ZDVcNJDjQ4Z0QWSu499LdPE';
  if (!/^https:\/\/[^/]+\/api\/public\/vendas-sync$/.test(url)) {
    throw new Error('Configure VENDAS_SYNC_URL com a URL HTTPS completa da rota vendas-sync.');
  }
  if (secret.length < 32) throw new Error('Configure VENDAS_SYNC_SECRET com pelo menos 32 caracteres.');
  return {url:url,secret:secret,sheetId:sheetId};
}

function rbnApi_(cfg, query, body) {
  var url = cfg.url + (query ? '?' + query : '');
  var opts = {muteHttpExceptions:true,headers:{'x-sync-secret':cfg.secret}};
  if (body) {
    opts.method = 'post';
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  var response, fetchError;
  for (var attempt=0; attempt<3; attempt++) {
    try { response=UrlFetchApp.fetch(url, opts); break; }
    catch (err) { fetchError=err; if (attempt===2) throw err; Utilities.sleep(1000*(attempt+1)); }
  }
  if (!response) throw fetchError;
  var status = response.getResponseCode(), data;
  try { data = JSON.parse(response.getContentText()); }
  catch (err) { throw new Error('Resposta inválida do app (HTTP ' + status + ').'); }
  if (status < 200 || status >= 300 || data.error) {
    throw new Error('Integração HTTP ' + status + ': ' + String(data.error || 'falha').slice(0,250));
  }
  return data;
}

function rbnIso_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(v.getTime()-10800000).toISOString().slice(0,10);
  }
  var s = String(v == null ? '' : v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1]+'-'+m[2]+'-'+m[3];
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) {
    return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  }
  return '';
}
function rbnCodigo_(v) {
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d+)/);
  return m ? String(Number(m[1])) : s.toUpperCase().replace(/\s+/g,' ');
}
function rbnProduto_(v) {
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d+)\s*-/);
  if (m) return String(Number(m[1]));
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
}
function rbnChave_(row) {
  var pedido = rbnCodigo_(row[8]), produto = rbnProduto_(row[5]),
      cliente = rbnCodigo_(row[7]), data = rbnIso_(row[15]);
  return pedido + '|' + produto + '|' + cliente + '|' + data;
}
function rbnReferencia_(row) {
  return rbnIso_(row[16]) || rbnIso_(row[15]);
}
function rbnNoPeriodo_(ref, inicio, fim) {
  return !!ref && ref >= inicio && ref <= fim;
}
function rbnMesclar_(nova, antiga) {
  var out = nova.slice();
  // Os campos históricos não são perdidos se não vierem na exportação.
  [11,13,14].forEach(function(i) {
    if (out[i] === null || out[i] === undefined) out[i] = antiga[i];
  });
  return out.map(function(v) { return v == null ? '' : v; });
}
function rbnNormalizarNova_(row) {
  return row.map(function(v) { return v == null ? '' : v; });
}
function rbnMesmaLinha_(a,b) {
  return a.every(function(v,i) {
    var w=b[i];
    if ([15,16].indexOf(i)!==-1) return rbnIso_(v) === rbnIso_(w);
    return String(v == null ? '' : v).trim() === String(w == null ? '' : w).trim();
  });
}

function sincronizarVendasRbn() {
  var cfg = rbnConfig_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok:false, motivo:'Outra rotina da Supervisão está em execução.'};
  var job = null;
  try {
    var jobs = rbnApi_(cfg,'acao=jobs').jobs || [];
    // Evita tentativas infinitas: após três erros, revisar antes de reprocessar.
    job = jobs.filter(function(j) { return Number(j.tentativas || 0) < 3; }).sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));})[0];
    if (!job) return {ok:true, pendentes:0};
    rbnApi_(cfg,'',{acao:'iniciar',id:job.id});
    var result = rbnExecutarJob_(cfg,job);
    rbnApi_(cfg,'',{acao:'concluir',id:job.id,linhas:result.exportadas});
    PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_CACHE_PENDENTE','1');
    PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_ULTIMA_SYNC',JSON.stringify(result));
    return {ok:true,resultado:result};
  } catch (err) {
    if (job) {
      try { rbnApi_(cfg,'',{acao:'erro',id:job.id,mensagem:String(err).slice(0,1500)}); }
      catch (reportErr) { console.error('Falha ao registrar erro da sincronização',reportErr); }
    }
    console.error(err && err.stack ? err.stack : err);
    throw err;
  } finally { lock.releaseLock(); }
}

function rbnExecutarJob_(cfg,job) {
  const started=Date.now(),incoming=new Map(); let cursor=0,total=0;
  const inicio=job.periodo_inicio,fim=job.periodo_fim;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(inicio)||!/^\d{4}-\d{2}-\d{2}$/.test(fim))throw new Error('Período inválido.');
  do {
    const p=rbnApi_(cfg,'acao=exportar&inicio='+encodeURIComponent(inicio)+'&fim='+encodeURIComponent(fim)+'&cursor='+cursor+'&limite=1000');
    if(!Array.isArray(p.linhas))throw new Error('Exportação sem linhas.');
    p.linhas.forEach(item=>{
      const row=item.valores,year=String(item.ano);
      if(!Array.isArray(row)||row.length!==20||VENDAS_RBN_CFG.anos.indexOf(year)<0||year!==rbnIso_(row[15]).slice(0,4)||!rbnNoPeriodo_(item.data_referencia,inicio,fim))throw new Error('Item inválido na exportação.');
      const key=rbnChave_(row);if(incoming.has(key))throw new Error('Chave repetida na origem: '+key);
      incoming.set(key,{ano:year,valores:row});
    });
    total+=p.linhas.length;if(total>VENDAS_RBN_CFG.maxItens)throw new Error('Divida a sincronização por mês.');
    if(p.proximo_cursor!=null&&p.proximo_cursor<=cursor)throw new Error('Cursor não avançou.');cursor=p.proximo_cursor;
  }while(cursor!=null);
  if(!incoming.size)throw new Error('Exportação vazia: origem preservada.');
  console.log('Exportação recebida: '+total+' itens em '+Math.round((Date.now()-started)/1000)+'s.');
  const ss=SpreadsheetApp.openById(cfg.sheetId),matches=new Map(),byYear={},size=4000,marker='SUBSTITUIDO_NA_IMPORTACAO';
  const incomingYears=new Set(Array.from(incoming.values()).map(v=>v.ano));
  VENDAS_RBN_CFG.anos.forEach(year=>{
    console.log('Lendo aba '+year+' em '+Math.round((Date.now()-started)/1000)+'s.');
    const sheet=ss.getSheetByName(year);if(!sheet)throw new Error('Aba anual ausente: '+year);
    if(sheet.getRange(1,1,1,20).getDisplayValues()[0].join('|')!==VENDAS_RBN_CFG.colunas.join('|'))throw new Error('Cabeçalho divergente: '+year);
    const count=Math.max(0,sheet.getLastRow()-1),state={sheet:sheet,count:count,blocks:new Map(),changes:new Map(),append:[]};byYear[year]=state;
    if(!count)return;
    const dates=sheet.getRange(2,16,count,2).getValues();
    const hasPeriod=dates.some(d=>rbnNoPeriodo_(rbnIso_(d[1])||rbnIso_(d[0]),inicio,fim));
    if(!hasPeriod&&!incomingYears.has(year))return;
    const keys=sheet.getRange(2,6,count,4).getValues(),needed=new Set();
    for(let i=0;i<count;i++){
      const key=rbnCodigo_(keys[i][3])+'|'+rbnProduto_(keys[i][0])+'|'+rbnCodigo_(keys[i][2])+'|'+rbnIso_(dates[i][0]);
      if(incoming.has(key)||rbnNoPeriodo_(rbnIso_(dates[i][1])||rbnIso_(dates[i][0]),inicio,fim))needed.add(Math.floor(i/size));
    }
    Array.from(needed).sort((a,b)=>a-b).forEach(k=>{
      const first=2+k*size,rows=sheet.getRange(first,1,Math.min(size,count-k*size),20).getValues();state.blocks.set(k,rows);
      rows.forEach((row,j)=>{
        const rowNum=first+j,key=rbnChave_(row),ref=rbnReferencia_(row);
        if(incoming.has(key)) {if(!matches.has(key))matches.set(key,[]);matches.get(key).push({ano:year,row:rowNum,valores:row});}
        else if(rbnNoPeriodo_(ref,inicio,fim)&&norm_(row[10])!==marker)state.changes.set(rowNum,{row:rowNum,old:row,valores:row.slice(),reason:'Ausente da importação canônica completa'});
      });
    });
  });
  console.log('Leitura concluída em '+Math.round((Date.now()-started)/1000)+'s.');
  const archive=[],summary={id:job.id,inicio:inicio,fim:fim,exportadas:total,atualizadas:0,novas:0,removidas:0,revisar:0,concluidaEm:null};
  function retire(found,reason){if(norm_(found.valores[10])===marker)return;byYear[found.ano].changes.set(found.row,{row:found.row,old:found.valores,valores:found.valores.slice(),reason:reason});}
  incoming.forEach((item,key)=>{
    const found=matches.get(key)||[];
    const selected=found.find(x=>x.ano===item.ano&&norm_(x.valores[10])!==marker)||found.find(x=>x.ano===item.ano)||found[0];
    const merged=selected?rbnMesclar_(item.valores,selected.valores):rbnNormalizarNova_(item.valores);
    if(selected&&selected.ano===item.ano){if(!rbnMesmaLinha_(merged,selected.valores)){byYear[item.ano].changes.set(selected.row,{row:selected.row,valores:merged});summary.atualizadas++;}}
    else {byYear[item.ano].append.push(merged);summary.novas++;}
    found.forEach(x=>{if(x!==selected||x.ano!==item.ano)retire(x,'Chave substituída/duplicada na importação');});
  });
  VENDAS_RBN_CFG.anos.forEach(year=>byYear[year].changes.forEach(c=>{if(c.reason){archive.push([job.id,new Date().toISOString(),c.reason,year,c.row].concat(c.old));c.valores[10]=marker;summary.revisar++;}}));
  if(Date.now()-started>240000)throw new Error('Tempo insuficiente antes da gravação; nenhuma linha alterada.');
  if(archive.length){let review=ss.getSheetByName('SYNC_REVISAO');if(!review){review=ss.insertSheet('SYNC_REVISAO');review.getRange(1,1,1,25).setValues([['JOB_ID','ARQUIVADO_EM','MOTIVO','ANO_ORIGEM','LINHA_ORIGEM'].concat(VENDAS_RBN_CFG.colunas)]);}const end=review.getLastRow()+archive.length;if(end>review.getMaxRows())review.insertRowsAfter(review.getMaxRows(),end-review.getMaxRows());review.getRange(review.getLastRow()+1,1,archive.length,25).setValues(archive);}
  VENDAS_RBN_CFG.anos.forEach(year=>{
    const state=byYear[year],dirty=new Set();
    state.changes.forEach(c=>{const k=Math.floor((c.row-2)/size);state.blocks.get(k)[(c.row-2)%size]=c.valores;dirty.add(k);});
    Array.from(dirty).sort((a,b)=>a-b).forEach(k=>{const rows=state.blocks.get(k);state.sheet.getRange(2+k*size,1,rows.length,20).setValues(rows);});
    if(state.append.length){const last=state.sheet.getLastRow(),need=last+state.append.length;if(need>state.sheet.getMaxRows())state.sheet.insertRowsAfter(state.sheet.getMaxRows(),need-state.sheet.getMaxRows());state.sheet.getRange(last+1,1,state.append.length,20).setValues(state.append);}
  });
  SpreadsheetApp.flush();summary.concluidaEm=new Date().toISOString();summary.durationMs=Date.now()-started;
  console.log('Sincronização concluída: '+JSON.stringify(summary));return summary;
}
function atualizarCacheVendasRbn() {
  var props=PropertiesService.getScriptProperties();
  if (props.getProperty('VENDAS_RBN_CACHE_PENDENTE')!=='1') return {ok:true,atualizar:false};
  // A função existente refreshDataset_ já usa LockService para evitar concorrência.
  var result=refreshDataset_();
  if (result && result.ok) {
    props.deleteProperty('VENDAS_RBN_CACHE_PENDENTE');
    return {ok:true,atualizar:true,resultado:result};
  }
  throw new Error('Não foi possível atualizar o cache da Supervisão.');
}




function atualizarMetasCacheRbn() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Outra rotina está usando o cache.');
  try {
    const goals = readAuxiliary_().goals.filter(g => g.monthKey === '2026-10')
      .map(g => JSON.stringify({ type: 'goal', value: g }));
    if (!goals.length) throw new Error('A aba METAS não contém metas de outubro/2026.');
    const cache = SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
    const sheet = cache.getSheetByName(CFG.cacheSheetName);
    if (!sheet) throw new Error('A aba DATASET do cache não foi encontrada.');
    const props = PropertiesService.getScriptProperties();
    const currentCount = Number(props.getProperty('SNAPSHOT_RECORD_COUNT') || 0);
    if (!currentCount) throw new Error('O cache não possui contagem de registros configurada.');
    const count = Math.min(1000, Math.max(0, sheet.getLastRow() - 1));
    const rows = count ? sheet.getRange(2, 1, count, 1).getValues() : [];
    const existing = [];
    rows.forEach((row, i) => {
      try { const item = JSON.parse(String(row[0] || '{}'));
        if (item.type === 'goal' && item.value && item.value.monthKey === '2026-10') existing.push(i + 2);
      } catch (err) {}
    });
    if (existing.length) {
      if (existing.length !== goals.length) throw new Error('Já há metas de outubro no cache em quantidade diferente; interrompi sem alterar.');
      existing.forEach((row, i) => sheet.getRange(row, 1).setValue(goals[i]));
      return { ok: true, inserted: 0, updated: goals.length, recordCount: currentCount };
    }
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, goals.length, 1).setValues(goals.map(value => [value]));
    props.setProperty('SNAPSHOT_RECORD_COUNT', String(currentCount + goals.length));
    return { ok: true, inserted: goals.length, updated: 0, recordCount: currentCount + goals.length, monthKey: '2026-10' };
  } finally { lock.releaseLock(); }
}


function previousMonthKey_(date) {
  const parts = Utilities.formatDate(date || new Date(), 'America/Fortaleza', 'yyyy-MM').split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(parts[0], parts[1] - 2, 1)), 'UTC', 'yyyy-MM');
}
function selectedSourceRows_(sheet, ix, predicate, width) {
  const count = Math.max(0, sheet.getLastRow() - 1); if (!count) return [];
  const dates=sheet.getRange(2,ix['Data Pedido']+1,count,1).getValues(), statuses=sheet.getRange(2,ix['Posição']+1,count,1).getValues();
  const invoices=ix['Numero Nota Fiscal']==null?null:sheet.getRange(2,ix['Numero Nota Fiscal']+1,count,1).getValues();
  const billings=ix['Data Faturamento']==null?null:sheet.getRange(2,ix['Data Faturamento']+1,count,1).getValues();
  const blocks=new Set(),size=4000,result=[];
  for(let i=0;i<count;i++) if(predicate({row:i+2,date:dates[i][0],status:statuses[i][0],invoice:invoices&&invoices[i][0],billingDate:billings&&billings[i][0]})) blocks.add(Math.floor(i/size));
  Array.from(blocks).sort((a,b)=>a-b).forEach(k=>{
    const first=2+k*size, rows=sheet.getRange(first,1,Math.min(size,count-k*size),width).getValues();
    rows.forEach((row,i)=>{if(predicate({row:first+i,date:cell_(row,ix,'Data Pedido'),status:cell_(row,ix,'Posição'),invoice:cell_(row,ix,'Numero Nota Fiscal'),billingDate:cell_(row,ix,'Data Faturamento')}))result.push(row);});
  });
  return result;
}
function buildRecentSalesRecords_(aux, fromMonth) {
  const source = SpreadsheetApp.openById(CFG.salesSpreadsheetId), records = [];
  let latest = null;
  CFG.years.forEach(year => {
    const sheet = source.getSheetByName(year);
    if (!sheet) throw new Error('A aba anual ' + year + ' não foi encontrada na base de vendas.');
    const width = sheet.getLastColumn();
    if (!width || sheet.getLastRow() < 2) return;
    const ix = headerIndex_(sheet.getRange(1, 1, 1, width).getValues()[0]);
    ['Posição', 'Data Faturamento', 'Cod/Vend.', 'Cod/Cliente', 'Cod/Produto', 'Pedidos Enviados'].forEach(name => { if (ix[name] == null) throw new Error('A aba ' + year + ' não contém a coluna ' + name + '.'); });
    const matches = selectedSourceRows_(sheet, ix, item => {
      if (norm_(item.status) !== 'FECHADO') return false;
      const iso = dateIso_(item.billingDate);
      return !!iso && iso.slice(0, 7) >= fromMonth;
    }, width);
    matches.forEach(row => {
      const iso = dateIso_(cell_(row, ix, 'Data Faturamento'));
      if (!iso || norm_(cell_(row, ix, 'Posição')) !== 'FECHADO' || iso.slice(0, 7) < fromMonth) return;
      const date = new Date(iso), rcaCode = code_(cell_(row, ix, 'Cod/Vend.')), rca = aux.rcaMap.get(rcaCode) || {}, clientCode = code_(cell_(row, ix, 'Cod/Cliente'));
      const rawProduct = String(cell_(row, ix, 'Cod/Produto') || '').trim(), productCode = code_(rawProduct);
      const productName = rawProduct.replace(/^\s*\d+\s*-\s*/, '').trim() || (productCode == null ? 'Sem descrição' : 'Produto ' + productCode);
      const city = String(cell_(row, ix, 'MUNICENT') || '').trim(), region = aux.routeMap.get(String(rcaCode) + '|' + norm_(city)) || '';
      const sale = { date: iso, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, monthKey: iso.slice(0, 7), rca: rcaCode, rcaName: rca.name || String(rcaCode == null ? '' : rcaCode), supervisor: rca.supervisor || '', department: String(cell_(row, ix, 'DEPARTAMENTO') || '').trim(), client: clientCode, product: productCode, productName: productName, order: String(cell_(row, ix, 'NUMPED') || '').trim(), city: city, uf: norm_(cell_(row, ix, 'ESTENT')), region: region, value: num_(cell_(row, ix, 'Pedidos Enviados')), marginPct: null };
      records.push(JSON.stringify({ type: 'sale', value: sale })); if (!latest || iso > latest) latest = iso;
    });
  });
  return { records: records, latest: latest };
}
function refreshOpenOrdersCache_(providedAux, targetName, deferPublish) {
  const source = SpreadsheetApp.openById(CFG.salesSpreadsheetId), year = String(CFG.years[CFG.years.length - 1]);
  const sourceSheet = source.getSheetByName(year);
  if (!sourceSheet) throw new Error('A aba anual ' + year + ' não foi encontrada na base de vendas.');
  const width = sourceSheet.getLastColumn(), cache = SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
  const name=targetName || PropertiesService.getScriptProperties().getProperty('OPEN_ORDERS_SHEET_NAME') || 'OPEN_ORDERS'; let cacheSheet = cache.getSheetByName(name); if (!cacheSheet) cacheSheet=cache.insertSheet(name);
  const aux = providedAux || readAuxiliary_(), records = [];
  if (width && sourceSheet.getLastRow() > 1) {
    const ix = headerIndex_(sourceSheet.getRange(1, 1, 1, width).getValues()[0]);
    ['Posição', 'Data Pedido', 'Cod/Vend.', 'Cod/Cliente', 'Cod/Produto', 'NUMPED', 'Pedidos Enviados'].forEach(name => { if (ix[name] == null) throw new Error('A aba ' + year + ' não contém a coluna ' + name + '.'); });
    const rows = selectedSourceRows_(sourceSheet, ix, item => ['PENDENTE', 'LIBERADO', 'BLOQUEADO'].indexOf(norm_(item.status)) >= 0 && !item.invoice && !item.billingDate, width);
    rows.forEach(row => {
      const status = norm_(cell_(row, ix, 'Posição')), iso = dateIso_(cell_(row, ix, 'Data Pedido'));
      if (!iso || String(new Date(iso).getUTCFullYear()) !== year) return;
      const date = new Date(iso), rcaCode = code_(cell_(row, ix, 'Cod/Vend.')), rca = aux.rcaMap.get(rcaCode) || {};
      const rawProduct = String(cell_(row, ix, 'Cod/Produto') || '').trim(), productCode = code_(rawProduct);
      const productName = rawProduct.replace(/^\s*\d+\s*-\s*/, '').trim() || (productCode == null ? 'Sem descrição' : 'Produto ' + productCode);
      const city = String(cell_(row, ix, 'MUNICENT') || ''), region = aux.routeMap.get(String(rcaCode) + '|' + norm_(city)) || '';
      records.push(JSON.stringify({ type: 'openOrder', value: { date: iso, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, monthKey: iso.slice(0, 7), status: status, rca: rcaCode, rcaName: rca.name || String(rcaCode == null ? '' : rcaCode), supervisor: rca.supervisor || '', department: String(cell_(row, ix, 'DEPARTAMENTO') || '').trim(), client: code_(cell_(row, ix, 'Cod/Cliente')), product: productCode, productName: productName, order: String(cell_(row, ix, 'NUMPED') || '').trim(), city: city, uf: norm_(cell_(row, ix, 'ESTENT')), region: region, value: num_(cell_(row, ix, 'Pedidos Enviados')) } }));
    });
  }
  cacheSheet.clearContents(); cacheSheet.getRange(1, 1).setValue('NDJSON');
  if (records.length) {if(records.length+1>cacheSheet.getMaxRows())cacheSheet.insertRowsAfter(cacheSheet.getMaxRows(),records.length+1-cacheSheet.getMaxRows());cacheSheet.getRange(2,1,records.length,1).setValues(records.map(value=>[value]));}
  const updatedAt = new Date().toISOString(); if(!deferPublish)PropertiesService.getScriptProperties().setProperty('OPEN_ORDERS_UPDATED_AT', updatedAt);
  return { ok: true, count: records.length, updatedAt: updatedAt };
}
function refreshDataset_() {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw new Error('Já existe uma atualização de bases em andamento.');
  const started=Date.now(),props=PropertiesService.getScriptProperties();
  try {
    const aux=readAuxiliary_(),cache=SpreadsheetApp.openById(CFG.cacheSpreadsheetId),previousInfo=datasetInfo_(),fromMonth=previousMonthKey_(new Date());
    const oldName=props.getProperty('SNAPSHOT_SHEET_NAME')||'DATASET',oldSheet=cache.getSheetByName(oldName),nextName=oldName==='DATASET_A'?'DATASET_B':'DATASET_A';
    const openName=props.getProperty('OPEN_ORDERS_SHEET_NAME')||'OPEN_ORDERS',nextOpen=openName==='OPEN_ORDERS_A'?'OPEN_ORDERS_B':'OPEN_ORDERS_A';
    let snapshot,recentCount=0;const totals={};
    if(props.getProperty('SNAPSHOT_DATE_BASIS')==='invoice'&&previousInfo.exists&&oldSheet&&oldSheet.getLastRow()>1){
      const rows=oldSheet.getRange(2,1,Math.min(previousInfo.recordCount,oldSheet.getLastRow()-1),1).getValues(),retained=[];let latest=null;
      rows.forEach(row=>{const raw=String(row[0]||'');let item;try{item=JSON.parse(raw);}catch(e){throw new Error('Registro inválido no cache anterior; histórico preservado.');}
        if(item.type!=='sale'||!item.value)return;const date=String(item.value.date||'');if(date.slice(0,7)>=fromMonth)return;retained.push(raw);if(!latest||date>latest)latest=date;
      });
      console.log('Histórico preservado: '+retained.length+' vendas.');
      const recent=buildRecentSalesRecords_(aux,fromMonth);recentCount=recent.records.length;
      recent.records.forEach(raw=>{const v=JSON.parse(raw).value;if(!latest||v.date>latest)latest=v.date;const k=v.monthKey;if(!totals[k])totals[k]={itens:0,valor:0};totals[k].itens++;totals[k].valor+=v.value;});
      if(!retained.length&&!recentCount)throw new Error('Nenhuma venda para construir a base.');
      const head=[];aux.rcas.forEach(v=>head.push(JSON.stringify({type:'rca',value:v})));aux.goals.forEach(v=>head.push(JSON.stringify({type:'goal',value:v})));aux.clients.forEach(v=>head.push(JSON.stringify({type:'client',value:v})));
      snapshot={records:head.concat(retained,recent.records),latest:latest,validCount:retained.length+recentCount};
      snapshot.records.push(JSON.stringify({type:'meta',value:{latest:latest,validCount:snapshot.validCount}}));
    }else snapshot=buildSnapshotRecords_();
    let next=cache.getSheetByName(nextName);if(!next)next=cache.insertSheet(nextName);
    const need=snapshot.records.length+1;if(need>next.getMaxRows())next.insertRowsAfter(next.getMaxRows(),need-next.getMaxRows());
    next.clearContents();next.getRange(1,1).setValue('NDJSON');
    for(let i=0;i<snapshot.records.length;i+=10000){const batch=snapshot.records.slice(i,i+10000).map(v=>[v]);next.getRange(i+2,1,batch.length,1).setValues(batch);}
    const opened=refreshOpenOrdersCache_(aux,nextOpen,true);SpreadsheetApp.flush();
    const updatedAt=new Date().toISOString();Object.keys(totals).forEach(k=>totals[k].valor=Math.round(totals[k].valor*100)/100);
    props.setProperties({SNAPSHOT_DATE_BASIS:'invoice',SNAPSHOT_SHEET_NAME:nextName,OPEN_ORDERS_SHEET_NAME:nextOpen,SNAPSHOT_UPDATED_AT:updatedAt,OPEN_ORDERS_UPDATED_AT:updatedAt,SNAPSHOT_LATEST_DATE:snapshot.latest,SNAPSHOT_SALES_COUNT:String(snapshot.validCount),SNAPSHOT_RECORD_COUNT:String(snapshot.records.length),SNAPSHOT_RECENT_COUNT:String(recentCount),SNAPSHOT_RECENT_TOTALS:JSON.stringify(totals),AUTO_REFRESH_SOURCE_SIGNATURE:sourceSignature_()},false);
    const result={ok:true,mode:previousInfo.exists?'incremental':'full',fromMonth:fromMonth,latest:snapshot.latest,salesCount:snapshot.validCount,recordCount:snapshot.records.length,updatedAt:updatedAt,durationMs:Date.now()-started,totals:totals,openOrders:opened.count};
    console.log('Cache publicado: '+JSON.stringify(result));return result;
  }catch(err){props.setProperty('VENDAS_RBN_ULTIMO_ERRO_CACHE',String(err).slice(0,1500));throw err;}finally{lock.releaseLock();}
}
function sourceSignature_() {
  return String(PropertiesService.getScriptProperties().getProperty('VENDAS_RBN_ULTIMA_SYNC') || '') + ':' + SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheets().map(function(sheet) { return sheet.getLastRow(); }).join(',');
}
function automaticRefreshDataset_() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(1000)) return { ok: true, skipped: true, reason: 'Atualização já em andamento.' };
  try {
    const props = PropertiesService.getScriptProperties(), signature = sourceSignature_();
    if (props.getProperty('AUTO_REFRESH_SOURCE_SIGNATURE') === signature && datasetInfo_().exists) return { ok: true, skipped: true, reason: 'As planilhas de origem não mudaram.' };
  } finally { lock.releaseLock(); }
  return refreshDataset_();
}
function installAutomaticRefreshTrigger() {
  const handler = 'automaticRefreshDataset_';
  ScriptApp.getProjectTriggers().forEach(trigger => { if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(15).create();
  const installedAt = new Date().toISOString(); PropertiesService.getScriptProperties().setProperty('AUTO_REFRESH_INSTALLED_AT', installedAt);
  return { ok: true, handler: handler, cadence: 'hourly', installedAt: installedAt };
}

function diagnosticarAtualizacaoRbn() {
  const p = PropertiesService.getScriptProperties();
  console.log(JSON.stringify({agora:new Date().toISOString(),snapshot:datasetInfo_(),cachePendente:p.getProperty('VENDAS_RBN_CACHE_PENDENTE'),ultimaSync:p.getProperty('VENDAS_RBN_ULTIMA_SYNC'),pedidosAtualizadosEm:p.getProperty('OPEN_ORDERS_UPDATED_AT'),origem:CFG.salesSpreadsheetId,cache:CFG.cacheSpreadsheetId,auxiliar:CFG.auxiliarySpreadsheetId}));
}

function sincronizarAgoraRbn(){ console.log(JSON.stringify(sincronizarVendasRbn())); }
function atualizarBasesAgoraRbn(){ PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_CACHE_PENDENTE','1');console.log(JSON.stringify(atualizarCacheVendasRbn())); }
function validarCacheRbn(){
 const p=PropertiesService.getScriptProperties(),info=datasetInfo_(),n=Number(p.getProperty('SNAPSHOT_RECENT_COUNT')||0),s=SpreadsheetApp.openById(CFG.cacheSpreadsheetId).getSheetByName(CFG.cacheSheetName),totals={};
 if(n)s.getRange(info.recordCount-n+1,1,n,1).getValues().forEach(r=>{const v=JSON.parse(r[0]).value,k=v.monthKey;if(!totals[k])totals[k]={itens:0,valor:0};totals[k].itens++;totals[k].valor+=v.value;});
 Object.keys(totals).forEach(k=>totals[k].valor=Math.round(totals[k].valor*100)/100);
 const open=openOrdersData_().orders,positions={};open.forEach(v=>{const k=v.monthKey+'|'+v.status;if(!positions[k])positions[k]={itens:0,valor:0,pedidos:{}};positions[k].itens++;positions[k].valor+=v.value;positions[k].pedidos[v.order]=true;});
 Object.keys(positions).forEach(k=>{positions[k].valor=Math.round(positions[k].valor*100)/100;positions[k].pedidos=Object.keys(positions[k].pedidos).length;});
 console.log(JSON.stringify({snapshot:info,totals:totals,positions:positions,cachePendente:p.getProperty('VENDAS_RBN_CACHE_PENDENTE'),ultimaSync:p.getProperty('VENDAS_RBN_ULTIMA_SYNC')}));
}
