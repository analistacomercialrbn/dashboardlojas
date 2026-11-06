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
    const rawMonth=cell_(row,goalIx,'MES'),key=rawMonth instanceof Date?Utilities.formatDate(rawMonth,ss.getSpreadsheetTimeZone(),'yyyy-MM'):String(rawMonth||'').trim(), match = key.match(/^(20\d{2})-(0?[1-9]|1[0-2])$/), rca = code_(cell_(row, goalIx, 'COD_RCA'));
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
  return { ok: true, exists: !!updatedAt && recordCount > 0, updatedAt: updatedAt, latest: p.getProperty('SNAPSHOT_LATEST_DATE'), salesCount: Number(p.getProperty('SNAPSHOT_SALES_COUNT') || 0), recordCount: recordCount, updating: p.getProperty('VENDAS_RBN_CACHE_PENDENTE')==='1'||!!p.getProperty('RBN_SALES_JOB_N'), updateStage:p.getProperty('RBN_UPDATE_STAGE')||'',updateError:p.getProperty('RBN_UPDATE_ERROR')||'' };
}
function compactSnapshotRecord_(raw) {
  const item = JSON.parse(String(raw || '{}')), v = item.value || {};
  switch (item.type) {
    case 'orderEntry': return [5, v.date, v.rca, v.department, v.client, v.product, v.productName, v.order, v.city, v.uf, v.region, v.value];
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
const UI_BUNDLE_URL = 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/ea3e9d18a272cfd484afa87251827091eb9bce17/supervisao-web/gas/gas-app.html';

function doGet() {
  const response = UrlFetchApp.fetch(UI_BUNDLE_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Não foi possível carregar a interface do dashboard.');
  return HtmlService.createHtmlOutput(response.getContentText()).setTitle('Central Rebanho · Comercial e Logística').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
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
    if(action==='logistics')return logisticsApi_(user,payload);
    if(action==='biLayout')return biLayoutApi_(user,payload);
    if(action==='biDiagnostics')return biDiagnostics_(user);
    if (action === 'history') return recoveredMacroHistory_(user);
    if (action === 'historyGeo') return recoveredGeoHistory_(user);
    if (action === 'users') return manageUsers_(user,payload);
    if (action === 'info') return Object.assign({ ok: true }, datasetInfo_());
    if (action === 'openOrders') { const out=openOrdersData_(); out.orders=out.orders.filter(row=>userAllowsRca_(user,row.rca));return out; }
    if (action === 'page') {const out=datasetPage_(payload.offset,payload.limit);out.records=out.records.filter(row=>userAllowsRecord_(user,row));return out;}
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
  const user = { login: login, nome: String(record.nome || login), perfil: String(record.perfil || 'RCA').toUpperCase(), cod_rca: record.cod_rca == null ? null : record.cod_rca, supervisor: String(record.supervisor || ''),accessVersion:String(record.accessVersion||'') };
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('DASH_SESSION_' + token, JSON.stringify(user), AUTH.sessionTtlSeconds);
  return { ok: true, token: token, user: user };
}
function sessionUser_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const value = CacheService.getScriptCache().get('DASH_SESSION_' + token);
  if (!value) return null;
  try { const saved=JSON.parse(value),record=loadUsers_()[saved.login];if(!record||record.ativo!==true||String(record.accessVersion||'')!==String(saved.accessVersion||''))return null;return Object.assign({},saved,{perfil:record.perfil,cod_rca:record.cod_rca,supervisor:record.supervisor}); } catch (err) { return null; }
}
function loadUsers_() {
  const cache = CacheService.getScriptCache(), cached = cache.get('DASH_USERS_JSON');
  if (cached) return Object.assign(JSON.parse(cached),rbnLoadState_('DASH_USER_OVERRIDES')||{});
  const response = UrlFetchApp.fetch(AUTH.usersUrl, { muteHttpExceptions: true, followRedirects: true });
  if (response.getResponseCode() !== 200) throw new Error('Não foi possível validar o usuário no cadastro de acesso.');
  const users = JSON.parse(response.getContentText());
  if (!users || typeof users !== 'object') throw new Error('Cadastro de usuários inválido.');
  cache.put('DASH_USERS_JSON', JSON.stringify(users), 300);
  return Object.assign(users,rbnLoadState_('DASH_USER_OVERRIDES')||{});
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
    for (let i = 1; i < Number(record.iterations||AUTH.pbkdf2Iterations); i++) {
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
    if([11,12,13,14].indexOf(i)!==-1){if((v===''||v==null)&&(w===''||w==null))return true;if(v===''||v==null||w===''||w==null)return false;return Math.abs(num_(v)-num_(w))<0.0000001;}
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
  if(!incoming.size&&!job.allowEmpty)throw new Error('Exportação vazia: origem preservada.');
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
  summary.datasPedidos=rbnAtualizarDatasPedidos_(ss);
  SpreadsheetApp.flush();summary.concluidaEm=new Date().toISOString();summary.durationMs=Date.now()-started;
  console.log('Sincronização concluída: '+JSON.stringify(summary));return summary;
}
function atualizarCacheVendasRbn() {
  var props=PropertiesService.getScriptProperties();
  if (props.getProperty('VENDAS_RBN_CACHE_PENDENTE')!=='1') return {ok:true,atualizar:false};
  // A função existente refreshDataset_ já usa LockService para evitar concorrência.
  var result=refreshDataset_();
  if (result && result.ok) {
    if(!result.pending)props.deleteProperty('VENDAS_RBN_CACHE_PENDENTE');
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
  const initials=ix['Data inicial do pedido']==null?null:sheet.getRange(2,ix['Data inicial do pedido']+1,count,1).getValues();
  const blocks=new Set(),size=4000,result=[];
  for(let i=0;i<count;i++) if(predicate({row:i+2,date:dates[i][0],initialDate:initials&&initials[i][0],status:statuses[i][0],invoice:invoices&&invoices[i][0],billingDate:billings&&billings[i][0]})) blocks.add(Math.floor(i/size));
  Array.from(blocks).sort((a,b)=>a-b).forEach(k=>{
    const first=2+k*size, rows=sheet.getRange(first,1,Math.min(size,count-k*size),width).getValues();
    rows.forEach((row,i)=>{if(predicate({row:first+i,date:cell_(row,ix,'Data Pedido'),initialDate:cell_(row,ix,'Data inicial do pedido'),status:cell_(row,ix,'Posição'),invoice:cell_(row,ix,'Numero Nota Fiscal'),billingDate:cell_(row,ix,'Data Faturamento')}))result.push(row);});
  });
  return result;
}
function buildOrderEntries_(aux, fromMonth) {
  const source = SpreadsheetApp.openById(CFG.salesSpreadsheetId), records = [];
  let latest = null;
  CFG.years.forEach(year => {
    const sheet = source.getSheetByName(year);
    if (!sheet) throw new Error('A aba anual ' + year + ' não foi encontrada na base de vendas.');
    const width = sheet.getLastColumn();
    if (!width || sheet.getLastRow() < 2) return;
    const ix = headerIndex_(sheet.getRange(1, 1, 1, width).getValues()[0]);
    ['Posição', 'Data Pedido', 'Cod/Vend.', 'Cod/Cliente', 'Cod/Produto', 'Pedidos Enviados'].forEach(name => { if (ix[name] == null) throw new Error('A aba ' + year + ' não contém a coluna ' + name + '.'); });
    const matches = selectedSourceRows_(sheet, ix, item => {
      if (norm_(item.status) === 'SUBSTITUIDO_NA_IMPORTACAO') return false;
      const iso = dateIso_(item.initialDate||item.date);
      return !!iso && iso.slice(0, 7) >= fromMonth;
    }, width);
    matches.forEach(row => {
      const iso = dateIso_(cell_(row, ix, 'Data inicial do pedido')||cell_(row, ix, 'Data Pedido'));
      if (!iso || norm_(cell_(row, ix, 'Posição')) === 'SUBSTITUIDO_NA_IMPORTACAO' || iso.slice(0, 7) < fromMonth) return;
      const date = new Date(iso), rcaCode = code_(cell_(row, ix, 'Cod/Vend.')), rca = aux.rcaMap.get(rcaCode) || {}, clientCode = code_(cell_(row, ix, 'Cod/Cliente'));
      const rawProduct = String(cell_(row, ix, 'Cod/Produto') || '').trim(), productCode = code_(rawProduct);
      const productName = rawProduct.replace(/^\s*\d+\s*-\s*/, '').trim() || (productCode == null ? 'Sem descrição' : 'Produto ' + productCode);
      const city = String(cell_(row, ix, 'MUNICENT') || '').trim(), region = aux.routeMap.get(String(rcaCode) + '|' + norm_(city)) || '';
      const sale = { date: iso, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, monthKey: iso.slice(0, 7), rca: rcaCode, rcaName: rca.name || String(rcaCode == null ? '' : rcaCode), supervisor: rca.supervisor || '', department: String(cell_(row, ix, 'DEPARTAMENTO') || '').trim(), client: clientCode, product: productCode, productName: productName, order: String(cell_(row, ix, 'NUMPED') || '').trim(), city: city, uf: norm_(cell_(row, ix, 'ESTENT')), region: region, value: num_(cell_(row, ix, 'Pedidos Enviados')), marginPct: null };
      records.push(JSON.stringify({ type: 'orderEntry', value: sale })); if (!latest || iso > latest) latest = iso;
    });
  });
  return { records: records, latest: latest };
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
    snapshot.records=snapshot.records.concat(buildOrderEntries_(aux,fromMonth).records);
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
  return String(PropertiesService.getScriptProperties().getProperty('VENDAS_RBN_ULTIMA_SYNC') || '') + ':' + String(PropertiesService.getScriptProperties().getProperty('RBN_GOALS_SIGNATURE')||'') + ':' + SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheets().map(function(sheet) { return sheet.getLastRow(); }).join(',');
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

function rbnAtualizarDatasPedidos_(ss) {
  const names=['Data inicial do pedido','Data atual do pedido'], groups=new Map(), sheets=[];
  VENDAS_RBN_CFG.anos.forEach(year=>{
    const sheet=ss.getSheetByName(year);if(!sheet)return;
    if(sheet.getMaxColumns()<22)sheet.insertColumnsAfter(sheet.getMaxColumns(),22-sheet.getMaxColumns());
    const headers=sheet.getRange(1,21,1,2).getValues()[0];
    headers.forEach((v,i)=>{
      if(!v||String(v)===names[i])return;
      if(String(v)!=='Column '+(21+i))throw new Error('Colunas U/V ocupadas na aba '+year+'.');
      const count=sheet.getLastRow()-1;
      if(count>0){const range=sheet.getRange(2,21+i,count,1);if(range.getValues().some(r=>r[0]!==''&&r[0]!=null)||range.getFormulas().some(r=>r[0]))throw new Error('Coluna reservada possui dados na aba '+year+'.');}
    });
    sheet.getRange(1,21,1,2).setValues([names]);
    const n=Math.max(0,sheet.getLastRow()-1);if(!n)return;
    const ids=sheet.getRange(2,9,n,1).getValues(),dates=sheet.getRange(2,16,n,1).getValues(),status=sheet.getRange(2,11,n,1).getValues(),saved=sheet.getRange(2,21,n,2).getValues();
    const rows=[];
    for(let i=0;i<n;i++){
      const id=rbnCodigo_(ids[i][0]);if(!/^\d+$/.test(id))continue;
      const date=rbnIso_(dates[i][0]),initial=rbnIso_(saved[i][0]),current=rbnIso_(saved[i][1]),active=norm_(status[i][0])!=='SUBSTITUIDO_NA_IMPORTACAO';
      rows.push({i,id,date,initial,current,active});
      if(!groups.has(id))groups.set(id,{initial:'',current:'',activeDate:''});
      const g=groups.get(id);
      if(initial&&(!g.initial||initial<g.initial))g.initial=initial;
      if(current&&(!g.current||current>g.current))g.current=current;
      if(active&&date&&(!g.activeDate||date>g.activeDate))g.activeDate=date;
    }
    sheets.push({sheet,n,rows,saved});
  });
  groups.forEach(g=>{g.current=g.activeDate||g.current;g.initial=g.initial||g.current;});
  let changed=0;
  sheets.forEach(({sheet,n,rows,saved})=>{
    const values=saved.map(r=>r.slice()),dirty=new Set();
    rows.forEach(row=>{const g=groups.get(row.id);if(!g.initial)return;
      if(row.initial!==g.initial||row.current!==g.current){values[row.i]=[g.initial,g.current];dirty.add(Math.floor(row.i/4000));changed++;}
    });
    Array.from(dirty).sort((a,b)=>a-b).forEach(k=>{const i=k*4000,chunk=values.slice(i,i+4000);sheet.getRange(i+2,21,chunk.length,2).setValues(chunk);});
  });
  return {pedidos:groups.size,linhasAtualizadas:changed};
}
function inicializarDatasPedidosRbn(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw new Error('Outra rotina em execução.');
  try{const result=rbnAtualizarDatasPedidos_(SpreadsheetApp.openById(CFG.salesSpreadsheetId));PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_CACHE_PENDENTE','1');console.log(JSON.stringify(result));return result;}finally{lock.releaseLock();}
}



// Checkpoints keep completed work across executions. Only a complete staging cache is published.
function rbnLoadState_(key){const p=PropertiesService.getScriptProperties(),n=Number(p.getProperty(key+'_N')||0);if(!n)return null;let s='';for(let i=0;i<n;i++)s+=p.getProperty(key+'_'+i)||'';return JSON.parse(s);}
function rbnSaveState_(key,value){const p=PropertiesService.getScriptProperties(),s=JSON.stringify(value),parts={};for(let i=0;i<s.length;i+=6000)parts[key+'_'+(i/6000)]=s.slice(i,i+6000);p.setProperties(parts,false);p.setProperty(key+'_N',String(Math.ceil(s.length/6000)));}
function rbnClearState_(key){const p=PropertiesService.getScriptProperties(),n=Number(p.getProperty(key+'_N')||0);for(let i=0;i<n;i++)p.deleteProperty(key+'_'+i);p.deleteProperty(key+'_N');}
function rbnScheduleContinuation_(){const h='continuarAtualizacaoRbn';if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===h))ScriptApp.newTrigger(h).timeBased().after(1000).create();}
function rbnStatus_(stage,error){PropertiesService.getScriptProperties().setProperties({RBN_UPDATE_STAGE:stage,RBN_UPDATE_STAGE_AT:new Date().toISOString(),RBN_UPDATE_ERROR:error?String(error).slice(0,1000):''},false);}
function rbnSheetsBatch_(id,requests){const ss=SpreadsheetApp.openById(id);requests.forEach(q=>{if(q.updateCells){const x=q.updateCells,r=x.range||x.start,s=ss.getSheetById(r.sheetId);if(x.range)s.getRange(r.startRowIndex+1,r.startColumnIndex+1,r.endRowIndex-r.startRowIndex,r.endColumnIndex-r.startColumnIndex).clearContent();else if(x.rows.length)s.getRange(r.rowIndex+1,r.columnIndex+1,x.rows.length,1).setValues(x.rows.map(v=>[v.values[0].userEnteredValue.stringValue]));}else if(q.copyPaste){const x=q.copyPaste,a=x.source,b=x.destination;ss.getSheetById(a.sheetId).getRange(a.startRowIndex+1,1,a.endRowIndex-a.startRowIndex,1).copyTo(ss.getSheetById(b.sheetId).getRange(b.startRowIndex+1,1,b.endRowIndex-b.startRowIndex,1),{contentsOnly:true});}else throw new Error('Operação de preparação não suportada.');});}
function rbnWriteRecords_(ss,sheet,start,records){for(let i=0;i<records.length;i+=2000)rbnSheetsBatch_(ss.getId(),[{updateCells:{start:{sheetId:sheet.getSheetId(),rowIndex:start+i,columnIndex:0},rows:records.slice(i,i+2000).map(v=>({values:[{userEnteredValue:{stringValue:v}}]})),fields:'userEnteredValue'}}]);}
function rbnHistoryRuns_(rows,fromMonth){const runs=[];let count=0,latest=null;rows.forEach((row,i)=>{const item=JSON.parse(String(row[0]||''));if(item.type!=='sale'||!item.value)return;const date=String(item.value.date||'');if(!date||date.slice(0,7)>=fromMonth)return;const source=i+1,last=runs[runs.length-1];if(last&&last.source+last.length===source)last.length++;else runs.push({source:source,target:count,length:1});count++;if(!latest||date>latest)latest=date;});return {runs:runs,count:count,latest:latest};}
function refreshDataset_(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,pending:true,message:'Atualização em andamento.'};
  const p=PropertiesService.getScriptProperties(),started=Date.now();
  try{
    if(rbnLoadState_('RBN_SALES_JOB')){rbnScheduleContinuation_();return {ok:true,pending:true,message:'Sincronizando vendas antes do cache.'};}
    let st=rbnLoadState_('RBN_CACHE_JOB');const cache=SpreadsheetApp.openById(CFG.cacheSpreadsheetId);
    if(st&&st.signature!==sourceSignature_()){rbnClearState_('RBN_CACHE_JOB');st=null;}
    if(!st){
      rbnStatus_('Preparando dados recentes');const aux=readAuxiliary_(),info=datasetInfo_(),from=previousMonthKey_(new Date()),sourceName=p.getProperty('SNAPSHOT_SHEET_NAME')||'DATASET',old=cache.getSheetByName(sourceName);
      if(p.getProperty('SNAPSHOT_DATE_BASIS')!=='invoice'||!info.exists||!old)throw new Error('Histórico precisa estar previamente inicializado por faturamento.');
      const layout=JSON.parse(p.getProperty('RBN_CACHE_LAYOUT')||'null');const history=layout&&layout.sheet===sourceName&&layout.fromMonth===from&&layout.recordCount===info.recordCount?{runs:layout.historyCount?[{source:1+layout.headLength,target:0,length:layout.historyCount}]:[],count:layout.historyCount,latest:layout.historyLatest}:rbnHistoryRuns_(old.getRange(2,1,Math.min(info.recordCount,old.getLastRow()-1),1).getValues(),from);const recent=buildRecentSalesRecords_(aux,from),entries=buildOrderEntries_(aux,from),head=[];
      aux.rcas.forEach(v=>head.push(JSON.stringify({type:'rca',value:v})));aux.goals.forEach(v=>head.push(JSON.stringify({type:'goal',value:v})));aux.clients.forEach(v=>head.push(JSON.stringify({type:'client',value:v})));
      let latest=history.latest;const totals={};recent.records.forEach(raw=>{const v=JSON.parse(raw).value;if(!latest||v.date>latest)latest=v.date;const k=v.monthKey;if(!totals[k])totals[k]={itens:0,valor:0};totals[k].itens++;totals[k].valor+=v.value;});
      if(!history.count&&!recent.records.length)throw new Error('Nenhuma venda válida; cache anterior preservado.');
      const salesCount=history.count+recent.records.length,tail=recent.records.concat([JSON.stringify({type:'meta',value:{latest:latest,validCount:salesCount}})],entries.records),targetName=sourceName==='DATASET_A'?'DATASET_B':'DATASET_A';let target=cache.getSheetByName(targetName);if(!target)target=cache.insertSheet(targetName);
      const count=head.length+history.count+tail.length;if(target.getMaxRows()<count+1)target.insertRowsAfter(target.getMaxRows(),count+1-target.getMaxRows());
      rbnSheetsBatch_(cache.getId(),[{updateCells:{range:{sheetId:target.getSheetId(),startRowIndex:0,endRowIndex:target.getMaxRows(),startColumnIndex:0,endColumnIndex:1},fields:'userEnteredValue'}}]);
      rbnWriteRecords_(cache,target,0,['NDJSON'].concat(head));rbnWriteRecords_(cache,target,1+head.length+history.count,tail);
      const open=p.getProperty('OPEN_ORDERS_SHEET_NAME')||'OPEN_ORDERS';st={sourceName:sourceName,targetName:targetName,targetOpen:open==='OPEN_ORDERS_A'?'OPEN_ORDERS_B':'OPEN_ORDERS_A',signature:sourceSignature_(),fromMonth:from,headLength:head.length,history:history,runsDone:0,latest:latest,salesCount:salesCount,recordCount:count,totals:totals,startedAt:new Date(started).toISOString()};
      rbnSaveState_('RBN_CACHE_JOB',st);rbnStatus_('Copiando histórico consolidado');rbnScheduleContinuation_();console.log('Cache preparado: '+JSON.stringify({recordCount:count,history:history.count,written:head.length+tail.length,durationMs:Date.now()-started}));return {ok:true,pending:true,message:'Dados recentes preparados; histórico em conclusão.'};
    }
    const source=cache.getSheetByName(st.sourceName),target=cache.getSheetByName(st.targetName);if(!source||!target)throw new Error('Cache de preparação ausente.');
    while(st.runsDone<st.history.runs.length){const runs=st.history.runs.slice(st.runsDone,st.runsDone+40);rbnSheetsBatch_(cache.getId(),runs.map(r=>({copyPaste:{source:{sheetId:source.getSheetId(),startRowIndex:r.source,endRowIndex:r.source+r.length,startColumnIndex:0,endColumnIndex:1},destination:{sheetId:target.getSheetId(),startRowIndex:1+st.headLength+r.target,endRowIndex:1+st.headLength+r.target+r.length,startColumnIndex:0,endColumnIndex:1},pasteType:'PASTE_VALUES'}})));st.runsDone+=runs.length;rbnSaveState_('RBN_CACHE_JOB',st);if(Date.now()-started>180000){rbnScheduleContinuation_();return {ok:true,pending:true};}}
    rbnStatus_('Atualizando pedidos em aberto');const opened=refreshOpenOrdersCache_(readAuxiliary_(),st.targetOpen,true);SpreadsheetApp.flush();if(st.signature!==sourceSignature_())throw new Error('Origem mudou durante o processamento; cache anterior preservado.');
    const updatedAt=new Date().toISOString();Object.keys(st.totals).forEach(k=>st.totals[k].valor=Math.round(st.totals[k].valor*100)/100);
    p.setProperties({SNAPSHOT_DATE_BASIS:'invoice',SNAPSHOT_SHEET_NAME:st.targetName,OPEN_ORDERS_SHEET_NAME:st.targetOpen,SNAPSHOT_UPDATED_AT:updatedAt,OPEN_ORDERS_UPDATED_AT:updatedAt,SNAPSHOT_LATEST_DATE:st.latest,SNAPSHOT_SALES_COUNT:String(st.salesCount),SNAPSHOT_RECORD_COUNT:String(st.recordCount),SNAPSHOT_RECENT_TOTALS:JSON.stringify(st.totals),AUTO_REFRESH_SOURCE_SIGNATURE:st.signature,RBN_CACHE_LAYOUT:JSON.stringify({sheet:st.targetName,fromMonth:st.fromMonth,recordCount:st.recordCount,headLength:st.headLength,historyCount:st.history.count,historyLatest:st.history.latest})},false);p.deleteProperty('VENDAS_RBN_CACHE_PENDENTE');p.deleteProperty('VENDAS_RBN_ULTIMO_ERRO_CACHE');rbnClearState_('RBN_CACHE_JOB');rbnStatus_('Atualizado');
    const result={ok:true,pending:false,mode:'incremental',fromMonth:st.fromMonth,latest:st.latest,salesCount:st.salesCount,recordCount:st.recordCount,updatedAt:updatedAt,totals:st.totals,openOrders:opened.count,durationMs:Date.now()-Date.parse(st.startedAt)};console.log('Cache publicado: '+JSON.stringify(result));return result;
  }catch(e){rbnStatus_('Falha na atualização',e);p.setProperty('VENDAS_RBN_CACHE_PENDENTE','1');throw e;}finally{lock.releaseLock();}
}
function rbnPeriods_(inicio,fim){const result=[];let cursor=inicio;while(cursor<=fim){const d=new Date(cursor+'T12:00:00Z'),end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10);result.push({inicio:cursor,fim:end<fim?end:fim});const next=new Date(end+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);cursor=next.toISOString().slice(0,10);}return result;}
function sincronizarVendasRbn(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,pending:true};const p=PropertiesService.getScriptProperties();let st=null;
  try{
    if(rbnLoadState_('RBN_CACHE_JOB')){rbnScheduleContinuation_();return {ok:true,pending:true};}
    const cfg=rbnConfig_();st=rbnLoadState_('RBN_SALES_JOB');
    if(!st){const jobs=(rbnApi_(cfg,'acao=jobs').jobs||[]).filter(j=>Number(j.tentativas||0)<3).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));if(!jobs.length)return {ok:true,pendentes:0};const job=jobs[0];rbnApi_(cfg,'',{acao:'iniciar',id:job.id});st={job:job,periods:rbnPeriods_(job.periodo_inicio,job.periodo_fim),done:0,results:[]};rbnSaveState_('RBN_SALES_JOB',st);}
    if(st.failed)throw new Error('Sincronização pausada para revisão: '+st.failed);
    if(st.done<st.periods.length){const period=st.periods[st.done];rbnStatus_('Sincronizando '+period.inicio.slice(0,7));rbnApi_(cfg,'',{acao:'heartbeat',id:st.job.id});const result=rbnExecutarJob_(cfg,Object.assign({},st.job,{periodo_inicio:period.inicio,periodo_fim:period.fim,allowEmpty:true}));st.results.push(result);st.done++;rbnSaveState_('RBN_SALES_JOB',st);rbnApi_(cfg,'',{acao:'heartbeat',id:st.job.id});}
    if(st.done<st.periods.length){rbnScheduleContinuation_();return {ok:true,pending:true,completedMonths:st.done,totalMonths:st.periods.length};}
    const lines=st.results.reduce((s,r)=>s+r.exportadas,0);rbnApi_(cfg,'',{acao:'concluir',id:st.job.id,linhas:lines});p.setProperties({VENDAS_RBN_ULTIMA_SYNC:JSON.stringify({id:st.job.id,inicio:st.job.periodo_inicio,fim:st.job.periodo_fim,exportadas:lines,concluidaEm:new Date().toISOString()}),VENDAS_RBN_CACHE_PENDENTE:'1'},false);rbnClearState_('RBN_SALES_JOB');rbnStatus_('Vendas sincronizadas; preparando dashboard');rbnScheduleContinuation_();return {ok:true,pending:true};
  }catch(e){rbnStatus_('Falha na sincronização',e);if(st){st.errors=Number(st.errors||0)+1;if(st.errors>=3)st.failed=String(e).slice(0,500);rbnSaveState_('RBN_SALES_JOB',st);if(!st.failed)rbnScheduleContinuation_();}throw e;}finally{lock.releaseLock();}
}
function sincronizarMetasRbn(){const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,pending:true};try{const p=PropertiesService.getScriptProperties(),data=rbnApi_(rbnConfig_(),'acao=metas');if(!Array.isArray(data.metas)||!data.signature)throw new Error('Exportação de metas inválida.');if(p.getProperty('RBN_GOALS_SIGNATURE')===data.signature)return {ok:true,changed:false};const incoming=data.metas,keys=new Set(),months=new Set();const rows=incoming.map(v=>{const mes=String(v.mes),rca=Number(v.cod_rca),department=String(v.departamento||''),value=Number(v.meta),key=mes+'|'+rca+'|'+department;if(!/^20\d\d-\d\d$/.test(mes)||!Number.isFinite(rca)||!department||!Number.isFinite(value)||value<0||keys.has(key))throw new Error('Meta inválida ou duplicada.');keys.add(key);months.add(mes);return [mes,rca,department,value];});if(!rows.length)return {ok:true,changed:false};const sheet=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheetByName('METAS'),old=sheet.getDataRange().getValues();if(old[0].slice(0,4).join('|')!=='MES|COD_RCA|DEPARTAMENTO|META')throw new Error('Cabeçalho de metas divergente.');const output=old.slice(1).filter(v=>v[0]&&!months.has(v[0] instanceof Date?Utilities.formatDate(v[0],sheet.getParent().getSpreadsheetTimeZone(),'yyyy-MM'):String(v[0]))).map(v=>[v[0] instanceof Date?Utilities.formatDate(v[0],sheet.getParent().getSpreadsheetTimeZone(),'yyyy-MM'):v[0],v[1],v[2],v[3]]).concat(rows);sheet.getRange(2,1,output.length,1).setNumberFormat('@');sheet.getRange(2,1,output.length,4).setValues(output);if(old.length>output.length+1)sheet.getRange(output.length+2,1,old.length-output.length-1,4).clearContent();SpreadsheetApp.flush();p.setProperties({RBN_GOALS_SIGNATURE:data.signature,RBN_GOALS_UPDATED_AT:new Date().toISOString(),VENDAS_RBN_CACHE_PENDENTE:'1'},false);rbnScheduleContinuation_();return {ok:true,changed:true,rows:rows.length};}finally{lock.releaseLock();}}
function continuarAtualizacaoRbn(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='continuarAtualizacaoRbn').forEach(t=>ScriptApp.deleteTrigger(t));if(rbnLoadState_('RBN_SALES_JOB'))return sincronizarVendasRbn();if(rbnLoadState_('RBN_CACHE_JOB')||PropertiesService.getScriptProperties().getProperty('VENDAS_RBN_CACHE_PENDENTE')==='1')return atualizarCacheVendasRbn();return {ok:true};}
function instalarFluxoRapidoRbn(){const wanted={sincronizarVendasRbn:1,atualizarCacheVendasRbn:1,sincronizarMetasRbn:1},seen={};ScriptApp.getProjectTriggers().forEach(t=>{const h=t.getHandlerFunction();if(wanted[h]){ScriptApp.deleteTrigger(t);seen[h]=true;}});Object.keys(wanted).forEach(h=>ScriptApp.newTrigger(h).timeBased().everyMinutes(1).create());console.log('Fluxo automático a cada minuto e continuação por etapa instalado.');}
function inicializarLayoutCacheRbn(){const p=PropertiesService.getScriptProperties(),ss=SpreadsheetApp.openById(CFG.cacheSpreadsheetId),name=p.getProperty('SNAPSHOT_SHEET_NAME'),sheet=ss.getSheetByName(name),count=Number(p.getProperty('SNAPSHOT_RECORD_COUNT')),sales=Number(p.getProperty('SNAPSHOT_SALES_COUNT')),recent=Number(p.getProperty('SNAPSHOT_RECENT_COUNT')),from=previousMonthKey_(new Date());if(p.getProperty('RBN_CACHE_LAYOUT'))return;const headRows=sheet.getRange(2,1,Math.min(10000,count),1).getValues();let head=0;for(const row of headRows){const item=JSON.parse(row[0]);if(item.type==='sale')break;head++;}if(head>=headRows.length||recent>sales)throw new Error('Estrutura do cache não reconhecida.');const history=sales-recent,edge=history?JSON.parse(sheet.getRange(1+head+history,1).getValues()[0][0]):null,next=recent?JSON.parse(sheet.getRange(2+head+history,1).getValues()[0][0]):null;if(edge&&(edge.type!=='sale'||edge.value.date.slice(0,7)>=from))throw new Error('Limite histórico divergente.');if(next&&(next.type!=='sale'||next.value.date.slice(0,7)<from))throw new Error('Limite recente divergente.');const layout={sheet:name,fromMonth:from,recordCount:count,headLength:head,historyCount:history,historyLatest:edge?edge.value.date:null};p.setProperty('RBN_CACHE_LAYOUT',JSON.stringify(layout));console.log(JSON.stringify({layout:layout,updatedAt:p.getProperty('SNAPSHOT_UPDATED_AT'),totals:p.getProperty('SNAPSHOT_RECENT_TOTALS'),goals:readAuxiliary_().goals.filter(g=>g.monthKey==='2026-11').reduce((s,g)=>s+g.value,0)}));}

function userAllowsRca_(user,rca){
 if(['ADMIN','GERENTE'].indexOf(user.perfil)>=0)return true;
 if(user.perfil==='RCA')return String(user.cod_rca)===String(rca);
 if(user.perfil==='SUPERVISOR'){
  if(!user._allowed){const cache=CacheService.getScriptCache(),key='DASH_SCOPE_'+digestHex_(user.login+'|'+user.supervisor),saved=cache.get(key);const codes=saved?JSON.parse(saved):readAuxiliary_().rcas.filter(r=>norm_(r.supervisor)===norm_(user.supervisor)&&!!user.supervisor).map(r=>String(r.code));user._allowed=new Set(codes);if(!saved)cache.put(key,JSON.stringify(codes),300);}return user._allowed.has(String(rca));
 }
 return false;
}
function userAllowsRecord_(user,row){
 if(['ADMIN','GERENTE'].indexOf(user.perfil)>=0)return true;
 if(row[0]===4)return true;
 const index={0:2,1:1,2:4,3:3,5:2}[row[0]];
 return index!=null&&userAllowsRca_(user,row[index]);
}
function manageUsers_(actor,payload){
 if(actor.perfil!=='ADMIN')throw new Error('Apenas o administrador pode configurar usuários.');
 const users=loadUsers_(),aux=readAuxiliary_();
 if(payload.save){
  const input=payload.save,login=String(input.login||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._@-]{2,99}$/.test(login))throw new Error('Login: use de 3 a 100 caracteres, sem espaços.');
  const perfil=String(input.perfil||'').toUpperCase();
  if(['ADMIN','GERENTE','SUPERVISOR','RCA'].indexOf(perfil)<0)throw new Error('Perfil inválido.');
  const old=users[login],record=Object.assign({},old||{},{nome:String(input.nome||'').trim().slice(0,120),perfil:perfil,ativo:input.ativo===true,cod_rca:perfil==='RCA'?Number(input.cod_rca):null,supervisor:perfil==='SUPERVISOR'?String(input.supervisor||''):''});
  if(!record.nome)throw new Error('Informe o nome.');
  if(perfil==='RCA'&&!aux.rcas.some(r=>Number(r.code)===record.cod_rca))throw new Error('Selecione um RCA válido.');
  if(perfil==='SUPERVISOR'&&!aux.rcas.some(r=>r.supervisor===record.supervisor&&!!record.supervisor))throw new Error('Selecione uma supervisão válida.');
  if(login===actor.login&&(perfil!=='ADMIN'||!record.ativo))throw new Error('Você não pode remover seu próprio acesso administrativo.');
  if(input.credential){
   const p=input.credential;
   if(p.algorithm!=='pbkdf2_sha256'||p.iterations!==100000||!/^[a-f0-9]{32}$/.test(p.salt)||!/^[a-f0-9]{64}$/.test(p.hash))throw new Error('Credencial inválida.');
   record.senha_algo=p.algorithm;record.iterations=p.iterations;record.salt=p.salt;record.senha_hash=p.hash;
  }else if(!old)throw new Error('Defina uma senha para o novo usuário.');
  record.accessVersion=Utilities.getUuid();
  if(login===actor.login)record.accessVersion=old.accessVersion||'';
  const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('Aguarde a atualização em andamento e tente salvar novamente.');
  try{const overrides=rbnLoadState_('DASH_USER_OVERRIDES')||{};overrides[login]=record;rbnSaveState_('DASH_USER_OVERRIDES',overrides);}finally{lock.releaseLock();}
  CacheService.getScriptCache().remove('DASH_USERS_JSON');
  console.log('Usuário atualizado: '+login+' por '+actor.login);
 }
 const updated=loadUsers_();
 return {ok:true,users:Object.keys(updated).map(login=>{const r=updated[login];return {login:login,nome:r.nome,perfil:r.perfil,ativo:r.ativo===true,cod_rca:r.cod_rca,supervisor:r.supervisor};}),rcas:aux.rcas.map(r=>({code:r.code,name:r.name,supervisor:r.supervisor}))};
}

function recoveredMacroHistory_(user){
 if(['ADMIN','GERENTE'].indexOf(user.perfil)<0)throw new Error('O histórico macro não possui vínculo com RCA ou supervisão.');
 const cache=CacheService.getScriptCache(),key='DASH_RECOVERED_MACRO_V1',saved=cache.get(key);
 if(saved)return JSON.parse(saved);
 const packed=SCRIPT_PROPS.getProperty('RECOVERED_MACRO_MONTHS_V1');if(!packed)throw new Error('Histórico recuperado ainda não foi inicializado.');
 const data={cutoff:'2024-08-01',monthly:JSON.parse(packed).map(r=>({month:r[0],value:r[1],minDate:r[2],maxDate:r[3]}))};
 if(data.cutoff!=='2024-08-01'||!Array.isArray(data.monthly)||data.monthly.length!==86)throw new Error('Histórico macro inválido.');
 const seen=new Set();
 data.monthly.forEach(row=>{if(!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(row.month)||row.month<'2017-06'||row.month>='2024-08'||typeof row.value!=='number'||!isFinite(row.value)||seen.has(row.month))throw new Error('Mês inválido ou duplicado no histórico.');seen.add(row.month);});
 const out={ok:true,monthly:data.monthly.map(r=>({month:r.month,value:r.value,minDate:r.minDate,maxDate:r.maxDate})),source:'Shop Control recuperado',cutoff:data.cutoff};
 cache.put(key,JSON.stringify(out),21600);return out;
}


function recoveredGeoHistory_(user){
 if(['ADMIN','GERENTE'].indexOf(user.perfil)<0)throw new Error('O histórico geográfico consolidado exige perfil gerencial.');
 const count=Number(SCRIPT_PROPS.getProperty('RECOVERED_GEO_V1_COUNT')||0);
 if(!count)return {ok:true,monthly:[],available:false};
 if(count<1||count>40)throw new Error('Histórico geográfico inválido.');
 let packed='';for(let i=0;i<count;i++){const part=SCRIPT_PROPS.getProperty('RECOVERED_GEO_V1_'+i);if(!part)throw new Error('Resumo geográfico incompleto.');packed+=part;}
 const bytes=Utilities.base64Decode(packed),data=JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes,'application/gzip')).getDataAsString('UTF-8'));
 if(!Array.isArray(data)||data.length!==86)throw new Error('Períodos geográficos inválidos.');
 const seen=new Set();data.forEach(r=>{if(!Array.isArray(r)||!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(r[0])||r[0]<'2017-06'||r[0]>='2024-08'||seen.has(r[0])||!Array.isArray(r[1])||!Number.isFinite(r[2]))throw new Error('Mês geográfico inválido.');seen.add(r[0]);r[1].forEach(c=>{if(!Array.isArray(c)||typeof c[0]!=='string'||!/^[A-Z]{2}$/.test(c[1])||!Number.isFinite(c[2]))throw new Error('Município histórico inválido.');});});
 return {ok:true,available:true,monthly:data.map(r=>({month:r[0],cities:r[1],unlocated:r[2]})),source:'Shop Control recuperado',cutoff:'2024-08-01'};
}



// Configurações e layouts: JSON declarativo, sem código fornecido pelo editor.
function biDefault_(){return {schema:1,settings:{shortDays:90,longDays:180,cutoff:'previous',openStatuses:['PENDENTE','LIBERADO','BLOQUEADO'],projectionStatuses:['PENDENTE','LIBERADO'],warning:70,success:100,defaultPage:'overview',defaultPeriod:'latest',compact:true,decimals:2,animation:true,density:'comfortable',refreshMinutes:1,autoRefresh:true},pages:[],widgets:[],overrides:[]};}
function biValidate_(input){
 if(!input||input.schema!==1)throw new Error('Formato de configuração inválido.');
 const d=biDefault_(),s=input.settings||{},out={schema:1,settings:{},pages:[],widgets:[],overrides:[]};
 const integer=(v,min,max,name)=>{if(!Number.isInteger(v)||v<min||v>max)throw new Error('Valor inválido: '+name);return v;};
 const choose=(v,options,name)=>{if(options.indexOf(v)<0)throw new Error('Opção inválida: '+name);return v;};
 const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw new Error('Texto inválido.');return v.trim();};
 const statuses=(v)=>{if(!Array.isArray(v)||v.some(x=>['PENDENTE','LIBERADO','BLOQUEADO'].indexOf(x)<0))throw new Error('Posição de pedido inválida.');return [...new Set(v)];};
 Object.keys(d.settings).forEach(k=>{const v=s[k]===undefined?d.settings[k]:s[k];if(['compact','animation','autoRefresh'].indexOf(k)>=0){if(typeof v!=='boolean')throw new Error('Preferência inválida.');out.settings[k]=v;}else if(k==='shortDays'||k==='longDays')out.settings[k]=integer(v,1,3650,k);else if(k==='warning'||k==='success')out.settings[k]=integer(v,0,300,k);else if(k==='decimals')out.settings[k]=integer(v,0,2,k);else if(k==='openStatuses'||k==='projectionStatuses')out.settings[k]=statuses(v);else if(k==='refreshMinutes')out.settings[k]=choose(v,[1,5,10,15,30],k);else if(k==='cutoff')out.settings[k]=choose(v,['previous','selected'],k);else if(k==='defaultPeriod')out.settings[k]=choose(v,['latest','current','previous'],k);else if(k==='density')out.settings[k]=choose(v,['compact','comfortable'],k);else if(k==='defaultPage')out.settings[k]=text(v,50);});
 if(out.settings.longDays<=out.settings.shortDays)throw new Error('O longo prazo deve começar depois do curto prazo.');
 if(out.settings.success<=out.settings.warning)throw new Error('A faixa de meta atingida deve ser maior que a faixa de atenção.');
 const built=['overview','pedidos','carteira','produtos','cidades','metas','history'];
 if(!Array.isArray(input.pages)||input.pages.length>12)throw new Error('Use até 12 páginas personalizadas.');
 const ids=new Set();input.pages.forEach(p=>{const id=text(p.id,50);if(!/^bi_[a-z0-9_-]+$/.test(id)||ids.has(id))throw new Error('Página duplicada ou inválida.');ids.add(id);if(!Array.isArray(p.roles)||!p.roles.length||p.roles.some(r=>['ADMIN','GERENTE','SUPERVISOR','RCA'].indexOf(r)<0))throw new Error('Perfil de página inválido.');out.pages.push({id,title:text(p.title,70),roles:[...new Set(p.roles)]});});
 const validPages=built.concat([...ids]);if(validPages.indexOf(out.settings.defaultPage)<0)out.settings.defaultPage='overview';
 const metrics=['revenue','orders','clients','products','ticket','mix','goal','attainment','open','openCount','blocked','pending','released','projection','inactiveShort','inactiveLong','newClients'];
 const dimensions=['none','month','year','rca','supervisor','department','city','uf','product','client','status'];
 const widgets=(list,native)=>{if(!Array.isArray(list)||list.length>(native?60:40))throw new Error('Limite de componentes excedido.');return list.map(w=>{const id=text(w.id,100);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('Identificador inválido.');const o={id,page:choose(w.page,validPages,'página'),title:text(w.title,100),type:choose(w.type,['card','bar','column','line','area','doughnut','table'],'visualização'),metric:choose(w.metric,metrics,'indicador'),dimension:choose(w.dimension,dimensions,'agrupamento'),comparison:choose(w.comparison||'none',['none','previous','year','goal'],'comparação'),sort:choose(w.sort||'desc',['desc','asc','label'],'ordem'),limit:integer(w.limit||10,3,50,'limite'),width:choose(w.width||'half',['half','full','third'],'largura'),height:integer(w.height||300,160,650,'altura'),color:choose(w.color||'blue',['blue','cyan','green','purple','orange'],'cor'),interaction:w.interaction===true,hidden:w.hidden===true};
 if(o.type==='card')o.dimension='none';if(o.type==='map'){o.dimension='city';if(o.metric!=='revenue')throw new Error('Mapa disponível para faturamento por cidade.');}
 if(['goal','attainment','projection'].indexOf(o.metric)>=0&&['none','month','year','rca','supervisor','department'].indexOf(o.dimension)<0)throw new Error('Meta e projeção não têm distribuição válida neste agrupamento.');
 if(['inactiveShort','inactiveLong','newClients'].indexOf(o.metric)>=0&&['none','rca'].indexOf(o.dimension)<0)throw new Error('Este indicador está disponível no total ou por RCA.');
 if(['open','openCount','blocked','pending','released'].indexOf(o.metric)>=0&&o.dimension==='product')throw new Error('Pedidos não possuem distribuição segura por produto neste editor.');
 if(o.comparison==='goal'&&!['none','month','year','rca','supervisor','department'].includes(o.dimension))throw new Error('A comparação com meta não está disponível neste agrupamento.');
 if(o.dimension==='status'&&['open','openCount','blocked','pending','released'].indexOf(o.metric)<0)throw new Error('Posição disponível para pedidos em aberto.');
 if(native){o.nativeKey=text(w.nativeKey,160);if(!/^[a-zA-Z0-9_-]+$/.test(o.nativeKey))throw new Error('Componente original inválido.');o.original=w.original===true;}return o;});};
 out.widgets=widgets(input.widgets||[],false);out.overrides=widgets(input.overrides||[],true);
 if(new Set(out.widgets.map(w=>w.id)).size!==out.widgets.length)throw new Error('Componente duplicado.');
 if(JSON.stringify(out).length>40000)throw new Error('Layout excedeu o limite de tamanho.');return out;
}
function biLayoutApi_(user,payload){
 const p=PropertiesService.getScriptProperties(),read=k=>rbnLoadState_(k),published=read('DASH_BI_PUBLISHED')||{revision:0,config:biDefault_()},admin=user.perfil==='ADMIN';
 if(!payload.action||payload.action==='read')return {ok:true,revision:published.revision,published:published.config,draft:admin?(read('DASH_BI_DRAFT')||published.config):null,versions:admin?(read('DASH_BI_VERSIONS')||[]).map(v=>({revision:v.revision,at:v.at,by:v.by})):[]};
 if(!admin)throw new Error('Apenas administradores podem alterar layouts e regras.');
 const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('Outra gravação está em andamento. Tente novamente.');
 try{
 const current=read('DASH_BI_PUBLISHED')||{revision:0,config:biDefault_()};
 if(Number(payload.revision)!==current.revision)throw new Error('Outro administrador publicou alterações. Reabra as configurações antes de salvar.');
 if(payload.action==='draft'){const config=biValidate_(payload.config);rbnSaveState_('DASH_BI_DRAFT',config);return {ok:true,message:'Rascunho salvo.'};}
 let config;if(payload.action==='restore'){const v=(read('DASH_BI_VERSIONS')||[]).find(v=>v.revision===Number(payload.version));if(!v)throw new Error('Versão não encontrada.');config=biValidate_(v.config);}else if(payload.action==='publish')config=biValidate_(payload.config);else throw new Error('Ação de layout inválida.');
 const versions=read('DASH_BI_VERSIONS')||[];versions.unshift({revision:current.revision,config:current.config,at:current.at||new Date().toISOString(),by:current.by||'Inicial'});while(versions.length>5)versions.pop();rbnSaveState_('DASH_BI_VERSIONS',versions);
 const saved={revision:current.revision+1,config,at:new Date().toISOString(),by:user.login};rbnSaveState_('DASH_BI_PUBLISHED',saved);rbnSaveState_('DASH_BI_DRAFT',config);console.log('Configuração BI publicada por '+user.login+' revisão '+saved.revision);return {ok:true,revision:saved.revision,message:'Layout e configurações publicados.'};
 }finally{lock.releaseLock();}
}
function biDiagnostics_(user){
 if(user.perfil!=='ADMIN')throw new Error('Diagnóstico disponível ao administrador.');
 const p=PropertiesService.getScriptProperties(),info=datasetInfo_();return {ok:true,dataset:info,sync:p.getProperty('VENDAS_RBN_ULTIMA_SYNC'),stage:p.getProperty('RBN_UPDATE_STAGE'),stageAt:p.getProperty('RBN_UPDATE_STAGE_AT'),error:p.getProperty('RBN_UPDATE_ERROR'),goalsAt:p.getProperty('RBN_GOALS_UPDATED_AT'),sources:{sales:CFG.salesSpreadsheetId,auxiliary:CFG.auxiliarySpreadsheetId,cache:CFG.cacheSpreadsheetId,coverage:CFG.coverageSpreadsheetId},triggers:ScriptApp.getProjectTriggers().filter(t=>['sincronizarVendasRbn','atualizarCacheVendasRbn','sincronizarMetasRbn'].indexOf(t.getHandlerFunction())>=0).map(t=>t.getHandlerFunction())};
}

// Módulo logístico: fontes de leitura separadas da base comercial.
const LOGISTICS_SOURCES={operations:'1HmmIntr9PMEJSk6rAPhWJafTynxmZWUQiehxR1bRZUU',indicators:'1mdgzC1erdRyHiiauwVepFu3odSRU3oM6tpzSa2csxtM',reference:'127enD4Qy-u_9aUNgCEF-Lt57Y2jaKBQ4',geoUrl:'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/7b1b074e704661878a79200f054f762774187c6a/supervisao-web/assets/logistica-ne-2025.geojson.gz.b64'};
function logisticsAllowed_(user){return !!user&&['ADMIN','GERENTE'].indexOf(user.perfil)>=0;}
function logNorm_(v){return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();}
function logText_(v){const s=String(v==null?'':v).trim();return s&&s!=='#N/A'?s:'';}
function logNumber_(v){if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v).trim().replace(/R\$|\s/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null;}
function logDate_(v,tz){if(v==null||v==='')return '';if(v instanceof Date)return isNaN(v)?'':Utilities.formatDate(v,tz||'America/Fortaleza','yyyy-MM-dd');if(typeof v==='number'){if(v<30000||v>70000)return '';return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);}const s=String(v).trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);if(!m)return '';return (m[3].length===2?'20'+m[3]:m[3])+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');}
function logProblem_(v){const t=logNorm_(v);return !!t&&!['SEM OCORRENCIAS','SEM OCORRENCIA','NENHUMA','NAO','N/A','-','OK'].includes(t);}
function logCity_(v){const s=logText_(v),m=logNorm_(s).match(/\s*[-/]\s*([A-Z]{2})$/);return {city:logNorm_(s).replace(/\s*[-/]\s*[A-Z]{2}$/,''),uf:m?m[1]:''};}
function logRecords_(values,kind,tz,regionValues){
 const header=kind==='operations'?1:kind==='formations'?3:0;
 const names=(values[header]||[]).map(logNorm_),idx=n=>names.indexOf(logNorm_(n));
 const get=(r,...keys)=>{for(const k of keys){const i=idx(k);if(i>=0&&r[i]!=null&&r[i]!=='')return r[i];}return '';};
 const regionMap=new Map();for(const r of (regionValues||[]).slice(1)){const c=logCity_(r[1]);if(c.city&&logText_(r[2]))regionMap.set(c.city+(c.uf?'|'+c.uf:''),logText_(r[2]));}
 return values.slice(header+1).flatMap((r,i)=>{
  const T=(...ks)=>logText_(get(r,...ks)),N=(...ks)=>logNumber_(get(r,...ks)),D=(...ks)=>logDate_(get(r,...ks),tz);
  if(kind==='operations'){
   if(!T('CLIENTE')&&!T('CIDADE')&&!T('PRODUTO'))return [];
   const loc=logCity_(T('CIDADE')),status=T('STATUS DA ENTREGA'),s=logNorm_(status),wait=get(r,'TEMPO ESPERA');
   let days=wait instanceof Date?Math.round((wait.getTime()-new Date(1899,11,31).getTime())/86400000):logNumber_(wait);if(days!=null&&days<0)days=null;
   return [{id:'op_'+(i+header+2),date:D('DATA IMPLANTAÇÃO'),client:T('CLIENTE'),seller:T('VENDEDOR'),...loc,cityLabel:T('CIDADE'),region:regionMap.get(loc.city+'|'+loc.uf)||regionMap.get(loc.city)||T('CLASSIFICAÇÃO DE ROTA')||'Sem região',loading:T('LOCAL CARREGAMENTO'),product:T('PRODUTO'),volumes:N('VOLUMES'),weight:N('PESO'),cost:N('CUSTOS R$'),notes:T('OBSERVAÇÕES'),vehicle:T('CAMINHÃO'),driver:T('MOTORISTA'),status:status||'Sem status',loaded:D('DATA CARREGAMENTO (Expedição)'),deliveredDate:D('DATA CHEGADA CLIENTE'),route:T('CLASSIFICAÇÃO DE ROTA'),invoice:T('NOTA FISCAL'),category:T('CATEGORIA OCORRENCIA'),follow:T('FOLLOW UP OCORRENCIA'),checker:T('CONFERENTE'),picker:T('SEPARADOR'),forecast:D('PREVISÃO DE ROTA'),wait:days,delivered:/^ENTREGUE\b/.test(s),inRoute:/ROTA/.test(s)&&!/^ENTREGUE\b/.test(s),isLoaded:/CARREG/.test(s)&&!/^ENTREGUE\b/.test(s),occurrence:logProblem_(T('CATEGORIA OCORRENCIA'))||logProblem_(T('FOLLOW UP OCORRENCIA'))}];
  }
  if(kind==='formations'){
   if(!D('DATA')&&!T('REGIÃO')&&!T('VEÍCULO')&&!T('MOTORISTA'))return [];
   return [{id:'fc_'+(i+header+2),date:D('DATA'),region:T('REGIÃO')||'Sem região',vehicle:T('VEÍCULO'),driver:T('MOTORISTA'),cost:N('CUSTO DE CAPATAZIA'),problem:T('PROBLEMAS'),description:T('DESCRIÇÃO DO PROBLEMA'),category:T('CATEGORIA'),checker:T('CONFERENTE'),picker:T('SEPARADOR'),occurrence:logProblem_(T('PROBLEMAS'))||logProblem_(T('DESCRIÇÃO DO PROBLEMA'))}];
  }
  if(!T('NF')&&!T('CLIENTE'))return [];
  const deliveredDate=D('DATA ENTREGA'),sla=T('STATUS SLA'),status=T('STATUS TRANSPORTADORA')||sla||'Sem status',forecast=D('PRAZO INTERNO REBANHO')||D('PREVISÃO TRANSPORTADORA'),today=Utilities.formatDate(new Date(),tz||'America/Fortaleza','yyyy-MM-dd');
  const onTime=!!deliveredDate&&/NO PRAZO/.test(logNorm_(sla)),late=!!deliveredDate&&/FORA|ATRAS/.test(logNorm_(sla)),overdue=!deliveredDate&&!!forecast&&forecast<today;
  const loc=logCity_(T('CIDADE'));loc.uf=T('UF')||loc.uf;
  return [{id:T('CHAVE')||'tr_'+(i+2),invoice:T('NF'),client:T('CLIENTE'),...loc,cityLabel:T('CIDADE'),date:D('EMISSÃO')||D('DATA COLETA')||deliveredDate,issued:D('EMISSÃO'),collected:D('DATA COLETA'),forecast,deliveredDate,delivered:!!deliveredDate,weight:N('PESO'),volumes:N('VOLUMES'),freight:N('FRETE TOTAL'),goods:N('VALOR MERCADORIA'),status,sla,delay:N('DIAS ATRASO'),onTime,late,overdue,carrier:T('TRANSPORTADORA'),problem:T('OCORRÊNCIA')||T('PROBLEMA / OBSERVAÇÃO'),category:T('CATEGORIA OCORRÊNCIA'),responsible:T('RESPONSÁVEL OCORRÊNCIA'),follow:T('FOLLOW UP / OCORRÊNCIA'),checker:T('CONFERENTE'),picker:T('SEPARADOR'),cargoType:T('TIPO DE CARGA'),seller:T('RCA'),occurrence:logProblem_(T('OCORRÊNCIA'))||logProblem_(T('PROBLEMA / OBSERVAÇÃO'))}];
 });
}
function logisticsApi_(user,payload){
 if(!logisticsAllowed_(user))throw new Error('Este módulo está disponível para os perfis de gestão.');
 const p=payload||{},kind=p.kind||'operations',props=PropertiesService.getScriptProperties();
 const ids={operations:props.getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,indicators:props.getProperty('LOG_INDICATORS_ID')||LOGISTICS_SOURCES.indicators};
 if(p.action==='configure'){
  if(user.perfil!=='ADMIN')throw new Error('Somente o administrador pode configurar fontes.');
  const a=String(p.operationsId||ids.operations).trim(),b=String(p.indicatorsId||ids.indicators).trim();if(!/^[\w-]{20,}$/.test(a)||!/^[-\w]{20,}$/.test(b))throw new Error('Informe o ID de uma planilha Google.');
  const ops=SpreadsheetApp.openById(a),ind=SpreadsheetApp.openById(b);if(!ops.getSheetByName('FORMAÇÃO 2026')||!ops.getSheetByName('CADASTRO REGIAO'))throw new Error('A fonte operacional precisa das abas FORMAÇÃO 2026 e CADASTRO REGIAO.');if(!ind.getSheetByName('ACOMPANHAMENTO'))throw new Error('A fonte de transportadoras precisa da aba ACOMPANHAMENTO.');
  props.setProperties({LOG_OPERATIONS_ID:a,LOG_INDICATORS_ID:b});return {ok:true,message:'Fontes de leitura atualizadas.'};
 }
 if(kind==='geo'){const response=UrlFetchApp.fetch(LOGISTICS_SOURCES.geoUrl,{muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('Não foi possível carregar a malha municipal.');const bytes=Utilities.base64Decode(response.getContentText().trim());return {ok:true,geo:JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes,'application/gzip')).getDataAsString('UTF-8'))};}
 if(kind==='sources')return {ok:true,ids,reference:LOGISTICS_SOURCES.reference,readOnly:true};
 if(!['operations','formations','transport','schedule'].includes(kind))throw new Error('Fonte logística inválida.');
 // Consulta somente planilhas, usando as permissões que o módulo comercial já possui.
 const id=kind==='transport'?ids.indicators:ids.operations,cache=CacheService.getScriptCache(),base='LOG_S3_'+digestHex_(id+'|'+kind).slice(0,24);
 let meta=cache.get(base+'_M');meta=meta?JSON.parse(meta):null;let rows=null;
 if(meta&&p.force!==true){const keys=Array.from({length:meta.parts},(_,i)=>base+'_'+i),saved=cache.getAll(keys);if(keys.every(k=>saved[k]!=null)){try{rows=JSON.parse(keys.map(k=>saved[k]).join(''));}catch(e){rows=null;}}}
 if(!rows){
  const ss=SpreadsheetApp.openById(id),sheetName={operations:'FORMAÇÃO 2026',formations:'FORMAÇÃO 2026',transport:'ACOMPANHAMENTO',schedule:'DESTINO MOTORISTAS'}[kind],sh=ss.getSheetByName(sheetName);if(!sh)throw new Error('Aba ausente: '+sheetName);
  const values=sh.getRange(1,1,Math.max(1,sh.getLastRow()),Math.min(sh.getLastColumn(),kind==='operations'?23:kind==='transport'?36:kind==='formations'?23:27)).getValues(),regions=['operations','formations'].includes(kind)?ss.getSheetByName('CADASTRO REGIAO').getDataRange().getValues():[];
  if(kind==='schedule'){const hs=values[0]||[];rows=values.slice(1).flatMap((r,i)=>hs.slice(2).flatMap((h,j)=>logText_(h)&&logText_(r[j+2])?[{id:'ag_'+i+'_'+j,date:logDate_(r[0],ss.getSpreadsheetTimeZone()),driver:logText_(h),destination:logText_(r[j+2])}]:[]));}
  else rows=logRecords_(values,kind==='formations'?'operations':kind,ss.getSpreadsheetTimeZone(),regions);if(kind==='formations')rows=rows.map(r=>({...r,problem:r.category,description:r.follow}));
  const dates=rows.map(x=>x.date).filter(Boolean).sort(),json=JSON.stringify(rows),version=digestHex_(id+'|'+kind+'|'+json).slice(0,24),stamp=new Date().toISOString(),parts={};for(let i=0;i<json.length;i+=45000)parts[base+'_'+(i/45000)]=json.slice(i,i+45000);
  meta={count:rows.length,version,parts:Math.ceil(json.length/45000),updatedAt:stamp,checkedAt:stamp,sourceTimestampKind:'read',sourceId:id,sourceName:ss.getName(),sheet:sheetName,from:dates[0]||'',to:dates.at(-1)||'',reference:false,referenceUpdatedAt:'2026-09-10T20:24:33.252Z'};parts[base+'_M']=JSON.stringify(meta);
  try{cache.putAll(parts,180);}catch(e){console.warn('Cache logístico indisponível: '+e.message);}
 }
 const version=meta.version;
 if(p.version===version&&p.check===true)return {ok:true,unchanged:true,meta};
 return {ok:true,meta,rows};
}

// Verificação manual de leitura das fontes, sem gravar nas planilhas.
function verificarFontesLogisticaRbn(){const result={};for(const kind of ['operations','formations','transport','schedule']){try{const r=logisticsApi_({perfil:'ADMIN'},{kind});result[kind]={count:r.rows.length,updatedAt:r.meta.updatedAt,from:r.meta.from,to:r.meta.to,weight:r.rows.reduce((s,x)=>s+(x.weight||0),0),delivered:r.rows.filter(x=>x.delivered).length,onTime:r.rows.filter(x=>x.onTime).length,late:r.rows.filter(x=>x.late).length,occurrences:r.rows.filter(x=>x.occurrence).length};}catch(e){result[kind]={error:e.message};}}try{const geo=logisticsApi_({perfil:'ADMIN'},{kind:'geo'});result.geo={features:geo.geo.features.length};}catch(e){result.geo={error:e.message};}console.log(JSON.stringify(result));return result;}


// Conecta as duas fontes solicitadas e valida a leitura sem alterar suas células.
function conectarBasesLogisticaRbn(){const r=logisticsApi_({perfil:'ADMIN'},{action:'configure',operationsId:LOGISTICS_SOURCES.operations,indicatorsId:LOGISTICS_SOURCES.indicators});console.log(r.message);return verificarFontesLogisticaRbn();}
