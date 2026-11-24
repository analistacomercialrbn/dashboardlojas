/**
 * CENTRAL REBANHO
 *
 * Código do servidor no Google Apps Script. Integra as fontes comerciais
 * e logísticas e atende às operações do painel.
 *
 * doGet entrega a interface. dashboardApi atende às ações do painel.
 * doPost recebe solicitações da integração comercial.
 */
// ── 01. Configuração do projeto ──
// Carrega as propriedades do Apps Script e define as fontes e limites de leitura.

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

// ── 02. Entrada de integração e funções de apoio ──
// Recebe solicitações de sincronização e normaliza valores lidos das fontes.

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

function norm_(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function code_(v) {
  const m = String(v == null ? '' : v).match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

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

function headerIndex_(headers) {
  const map = {};
  headers.forEach((h, i) => { map[String(h || '').trim()] = i; });
  return map;
}

function cell_(row, index, name) {
  return index[name] == null ? null : row[index[name]];
}

// ── 03. Bases comerciais e leitura do cache ──
// Reúne referências de clientes e vendas e fornece os dados paginados ao painel.

function readRcaMap_(rcaSheet) {
  const rcaValues = rcaSheet.getDataRange().getValues(), rcaIx = headerIndex_(rcaValues.shift() || []), rcaMap = new Map();
  rcaValues.forEach(row => {
    const c = code_(cell_(row, rcaIx, 'COD_RCA')), name = String(cell_(row, rcaIx, 'RCA') || '').trim();
    if (c != null && name) rcaMap.set(c, { code: c, name: name, supervisor: String(cell_(row, rcaIx, 'SUPERVISOR') || '').trim(), active: norm_(cell_(row, rcaIx, 'ATIVO') || 'S') === 'S' });
  });
  return rcaMap;
}

function readAuxiliary_() {
  const ss = SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId);
  const rcaSheet = ss.getSheetByName('RCA'), clientSheet = ss.getSheetByName('CLIENTES'), goalSheet = ss.getSheetByName('METAS'), routeSheet = ss.getSheetByName('ROTAS');
  if (!rcaSheet || !clientSheet || !goalSheet || !routeSheet) throw new Error('A base auxiliar precisa ter as abas RCA, CLIENTES, METAS e ROTAS.');
  const rcaMap = readRcaMap_(rcaSheet);
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

function installProperties_() {
  return validateSources_();
}

// ── 04. Aplicativo web e distribuição de solicitações ──
// Entrega a interface e encaminha cada operação para a rotina correspondente.

const AUTH = {
  usersUrl: 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/main/supervisao/usuarios.json',
  sessionTtlSeconds: 21600,
  temporaryPasswordMs: 24 * 60 * 60 * 1000,
  passwordChangeSessionSeconds: 600,
  pbkdf2Iterations: 200000
};
const UI_BUNDLE_URL = 'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/6bfbf7e334ab625a689a6f1eb34b886ab2662b57/supervisao-web/gas/zoom-mapas-20261109/app.html';

function doGet() {
  const timing=centralTiming_('central.interface');
  let status='erro';
  try{
    const cache=CacheService.getScriptCache(),key='CENTRAL_UI_'+digestHex_(UI_BUNDLE_URL).slice(0,24);
    let html=cache.get(key);
    if(!html){
      const response=UrlFetchApp.fetch(UI_BUNDLE_URL,{muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('Não foi possível carregar a interface do dashboard.');
      html=response.getContentText();
      try{cache.put(key,html,21600);}catch(error){}
      status='origem';
    }else status='cache';
    timing.mark('interface');
    return HtmlService.createHtmlOutput(html).setTitle('Central Rebanho · Comercial e Logística').addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover');
  }finally{
    timing.finish(status);
  }
}

function authorizeDashboard_() {
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

function portfolioClients_(user) {
  const cache=CacheService.getScriptCache();
  const key='DASH_PORTFOLIO_CLIENTS_V1';
  let entries=centralCacheRead_(cache,key);
  if(!entries){
    const spreadsheet=SpreadsheetApp.openById(CFG.salesSpreadsheetId);
    const directory=new Map();
    for(const year of [...CFG.years].reverse()){
      const sheet=spreadsheet.getSheetByName(year);
      const count=sheet?sheet.getLastRow()-1:0;
      if(!count)continue;
      const columns=headerIndex_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]);
      const child=columns['Cod/Cliente'], rca=columns['Cod/Vend.'];
      const principal=columns['Código do Cliente Principal'], name=columns['Nome do Cliente Principal'];
      if([child,rca,principal,name].some(column=>column==null))continue;
      const codes=sheet.getRange(2,child+1,count,1).getValues();
      const sellers=sheet.getRange(2,rca+1,count,1).getValues();
      const linked=sheet.getRange(2,principal+1,count,name===principal+1?2:1).getValues();
      const names=name===principal+1?null:sheet.getRange(2,name+1,count,1).getValues();
      for(let i=0;i<count;i++){
        const code=code_(codes[i][0]), parent=code_(linked[i][0]), seller=code_(sellers[i][0]);
        if(code==null)continue;
        if(!directory.has(code))directory.set(code,{parent:null,name:'',year:null,conflict:false,rcas:new Set()});
        const item=directory.get(code);
        if(seller!=null)item.rcas.add(seller);
        if(parent==null||parent<=0)continue;
        if(item.year===null){item.year=year;item.parent=parent;}
        if(item.year!==year)continue;
        if(item.parent!==parent){item.conflict=true;continue;}
        if(!item.name)item.name=String((names?names[i][0]:linked[i][1])||'').trim();
      }
    }
    entries=[...directory].filter(([,v])=>v.parent!=null&&!v.conflict)
      .map(([code,v])=>[code,v.parent,v.name,[...v.rcas]]);
    centralCacheWrite_(cache,key,JSON.stringify(entries),300);
  }
  return {ok:true,links:entries.filter(([, , ,rcas])=>rcas.some(rca=>userAllowsRca_(user,rca)))
    .map(([code,parent,name])=>[code,parent,name])};
}

function dashboardApi(action, payload, token) {
  try {
    action = String(action || ''); payload = payload || {};
    if (action === 'login') return loginDashboard_(payload);
    if (action === 'session') {
      const user = sessionUser_(token);
      if (user) return { ok: true, authenticated: true, user };
      return { ok: true, authenticated: false, passwordChangeRequired: !!passwordChangeSession_(token) };
    }
    if (action === 'logout') {
      if (/^[a-f0-9]{64}$/i.test(String(token || ''))) {
        CacheService.getScriptCache().removeAll(['DASH_SESSION_' + token, 'DASH_PASSWORD_CHANGE_' + token]);
      }
      return { ok: true };
    }
    if (action === 'changeTemporaryPassword') return changeTemporaryDashboardPassword_(token, payload);
    const user = sessionUser_(token);
    if (!user) throw new Error('Sua sessão expirou. Entre novamente.');
    if(action==='logistics')return logisticsApi_(user,payload);
    if(action==='users')return manageUsers_(user,payload);
    if (action === 'activity') return recordDashboardActivity_(user, payload.module);
    if (action === 'userActivity') return dashboardActivityOverview_(user);
    requireArea_(user,'commercial');
    if(action==='portfolioClients')return portfolioClients_(user);
    if(action==='teamsView')return teamsView_(user,payload);
    if(action==='biLayout')return biLayoutApi_(user,payload);
    if(action==='biDiagnostics')return biDiagnostics_(user);
    if (action === 'history') return recoveredMacroHistory_(user);
    if (action === 'historyGeo') return recoveredGeoHistory_(user);
    if (action === 'historyMargin') return historyMargin_(user,payload);
    if (action === 'info') return Object.assign({ ok: true }, datasetInfo_());
    if (action === 'openOrders') { const out=openOrdersData_(); out.orders=out.orders.filter(row=>userAllowsRca_(user,row.rca));return out; }
    if (action === 'page') return centralCommercialPage_(user,payload);
    if (action === 'coverage') {
      if (payload.force === true) CacheService.getScriptCache().remove('DASH_COVERAGE_MATRIX_V1');
      const data=coverageData_();if(['SUPERVISOR','RCA'].includes(user.perfil)){const names=readAuxiliary_().rcas.filter(r=>userAllowsRca_(user,r.code)).map(r=>norm_(r.name));data.cities=data.cities.filter(r=>['nutrition','animalHealth','poultry','swine'].some(k=>names.includes(norm_(r[k]))));data.count=data.cities.length;}return data;
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

// ── 05. Login e sessões ──
// Valida credenciais, recupera sessões e lê os perfis cadastrados.

function loginDashboard_(payload) {
  const timing = centralTiming_('central.login');
  let status = 'erro';
  try {
    const login = String(payload.login || '').trim().toLowerCase();
    const password = String(payload.password || '');
    if (!login || !password || password.length > 256) throw new Error('Usuário ou senha inválidos.');
    const cache = CacheService.getScriptCache(), throttleKey = 'DASH_LOGIN_FAIL_' + digestHex_(login).slice(0, 24);
    const attempts = Number(cache.get(throttleKey) || 0);
    if (attempts >= 8) {
      status = 'limitado';
      throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }
    const record = loadUsers_()[login];
    const temporary = record?.temporaryPasswordExpiresAt != null;
    timing.mark('cadastro');
    const verified = record?.ativo === true && (!temporary || record.temporaryPasswordExpiresAt > Date.now())
      && verifyPassword_(password, record);
    timing.mark('verificacao');
    if (!verified) {
      status = 'recusado';
      cache.put(throttleKey, String(attempts + 1), 600);
      throw new Error('Usuário ou senha inválidos.');
    }
    cache.remove(throttleKey);
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    if (temporary) {
      cache.put('DASH_PASSWORD_CHANGE_' + token, JSON.stringify({login, accessVersion:record.accessVersion}),
        AUTH.passwordChangeSessionSeconds);
      status = 'troca_obrigatoria';
      timing.mark('sessao');
      return {ok:true, token, passwordChangeRequired:true};
    }
    const user = publicUser_(login,record);
    cache.put('DASH_SESSION_' + token, JSON.stringify(user), AUTH.sessionTtlSeconds);
    try {
      PropertiesService.getScriptProperties().setProperty(dashboardActivityKey_(login) + '_LOGIN', String(Date.now()));
    } catch (err) {
      console.warn('Não foi possível registrar a data do último login.');
    }
    timing.mark('sessao');
    status = 'ok';
    return { ok: true, token: token, user: user };
  } finally {
    timing.finish(status);
  }
}

const DASH_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

function dashboardActivityKey_(login) {
  return 'DASH_ACTIVITY_' + digestHex_(login).slice(0, 32);
}

function recordDashboardActivity_(user, module) {
  const allowed = module === 'hub' ||
    (module === 'administration' && user.perfil === 'ADMIN') ||
    (['commercial', 'logistics'].includes(module) && platformAccess_(user).areas.includes(module));
  if (!allowed) return {ok:true};
  const cache = CacheService.getScriptCache();
  const key = dashboardActivityKey_(user.login);
  const current = JSON.parse(cache.get(key) || 'null');
  const now = Date.now();
  if (current?.version === user.accessVersion && current.module === module && now - current.at < 45000) return {ok:true};
  cache.put(key, JSON.stringify({at:now, module, version:user.accessVersion}), AUTH.sessionTtlSeconds);
  return {ok:true};
}

function dashboardActivityOverview_(actor) {
  if (actor.perfil !== 'ADMIN') throw new Error('Apenas administradores podem consultar a atividade.');
  const users = Object.entries(loadUsers_()).map(([login, record]) => ({
    key:dashboardActivityKey_(login),
    user:publicUser_(login, record)
  }));
  const cache = CacheService.getScriptCache();
  const activity = {};
  for (let offset = 0; offset < users.length; offset += 100) {
    Object.assign(activity, cache.getAll(users.slice(offset, offset + 100).map(entry => entry.key)));
  }
  const props = PropertiesService.getScriptProperties().getProperties();
  const now = Date.now();
  const rows = users.map(({key,user}) => {
    const presence = JSON.parse(activity[key] || 'null');
    const lastActivity = presence?.at || null;
    const recent = Boolean(user.ativo && lastActivity && presence.version === user.accessVersion &&
      now - lastActivity < DASH_ACTIVITY_WINDOW_MS);
    return {
      login:user.login, name:user.nome, role:user.perfil, enabled:user.ativo, recent,
      module:presence?.module || '', lastActivity, lastLogin:Number(props[key + '_LOGIN']) || null
    };
  });
  rows.sort((a,b) => Number(b.recent) - Number(a.recent) ||
    Math.max(b.lastActivity || 0, b.lastLogin || 0) - Math.max(a.lastActivity || 0, a.lastLogin || 0) ||
    a.name.localeCompare(b.name, 'pt-BR'));
  return {ok:true, rows, updatedAt:now};
}

function dashboardSessionRecord_(token, prefix) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const value = CacheService.getScriptCache().get(prefix + token);
  if (!value) return null;
  try {
    const {login, accessVersion} = JSON.parse(value), record = loadUsers_()[login];
    if (record?.ativo !== true || String(record.accessVersion || '') !== String(accessVersion || '')) return null;
    return {login, record};
  } catch (err) {
    return null;
  }
}

function sessionUser_(token) {
  const session = dashboardSessionRecord_(token, 'DASH_SESSION_');
  return session && session.record.temporaryPasswordExpiresAt == null ? publicUser_(session.login, session.record) : null;
}

function passwordChangeSession_(token) {
  const session = dashboardSessionRecord_(token, 'DASH_PASSWORD_CHANGE_');
  return session && session.record.temporaryPasswordExpiresAt > Date.now() ? session : null;
}

function setDashboardCredential_(record, credential) {
  const {algorithm, iterations, salt, hash} = credential;
  if (algorithm !== 'pbkdf2_sha256' || iterations !== 100000 || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Credencial inválida.');
  }
  Object.assign(record, {senha_algo:algorithm, iterations, salt, senha_hash:hash});
}

function setTemporaryDashboardCredential_(record, credential) {
  setDashboardCredential_(record, credential);
  record.temporaryPasswordExpiresAt = Date.now() + AUTH.temporaryPasswordMs;
}

function saveDashboardUserRecord_(login, record) {
  const overrides = rbnLoadState_('DASH_USER_OVERRIDES') || {};
  overrides[login] = record;
  rbnSaveState_('DASH_USER_OVERRIDES', overrides);
}

function changeTemporaryDashboardPassword_(token, payload) {
  const expired = 'Sua sessão de troca expirou. Entre novamente com a senha provisória ou peça outra ao administrador.';
  const session = passwordChangeSession_(token);
  if (!session) throw new Error(expired);
  const password = payload.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || !password.trim()) {
    throw new Error('Use entre 12 e 128 caracteres para a nova senha.');
  }
  if (verifyPassword_(password, session.record)) throw new Error('Escolha uma senha diferente da provisória.');
  const salt = Utilities.getUuid().replace(/-/g, '');
  const passwordBytes = Uint8Array.from(Utilities.newBlob(password).getBytes());
  const hash = bytesHex_(Array.from(centralPasswordCrypto_.pbkdf2(passwordBytes, Uint8Array.from(hexBytes_(salt)), 100000, 32)));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Aguarde a atualização em andamento e tente salvar novamente.');
  try {
    const current = passwordChangeSession_(token);
    if (!current || current.record.accessVersion !== session.record.accessVersion) throw new Error(expired);
    const record = {...current.record, accessVersion:Utilities.getUuid()};
    setDashboardCredential_(record, {algorithm:'pbkdf2_sha256', iterations:100000, salt, hash});
    delete record.temporaryPasswordExpiresAt;
    saveDashboardUserRecord_(session.login, record);
    CacheService.getScriptCache().remove('DASH_PASSWORD_CHANGE_' + token);
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
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
    const iterations = Number(record.iterations || AUTH.pbkdf2Iterations);
    if (!Number.isSafeInteger(iterations) || iterations < 1) return false;
    const passwordBytes = Uint8Array.from(Utilities.newBlob(password).getBytes());
    const result = centralPasswordCrypto_.pbkdf2(passwordBytes, Uint8Array.from(salt), iterations, 32);
    return constantTimeEqual_(bytesHex_(Array.from(result)), expected);
  }
  return false;
}

// fast-sha256 1.3.0 · Dmitry Chestnykh · domínio público (Unlicense).
// https://github.com/dchest/fast-sha256-js · blob 491822f990d3f233407f8e9da749cdba9fedbc80.
const centralPasswordCrypto_ = (()=>{
const exports={};
"use strict";
// SHA-256 (+ HMAC and PBKDF2) for JavaScript.
//
// Written in 2014-2016 by Dmitry Chestnykh.
// Public domain, no warranty.
//
// Functions (accept and return Uint8Arrays):
//
//   sha256(message) -> hash
//   sha256.hmac(key, message) -> mac
//   sha256.pbkdf2(password, salt, rounds, dkLen) -> dk
//
//  Classes:
//
//   new sha256.Hash()
//   new sha256.HMAC(key)
//
exports.digestLength = 32;
exports.blockSize = 64;
// SHA-256 constants
var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
function hashBlocks(w, v, p, pos, len) {
    var a, b, c, d, e, f, g, h, u, i, j, t1, t2;
    while (len >= 64) {
        a = v[0];
        b = v[1];
        c = v[2];
        d = v[3];
        e = v[4];
        f = v[5];
        g = v[6];
        h = v[7];
        for (i = 0; i < 16; i++) {
            j = pos + i * 4;
            w[i] = (((p[j] & 0xff) << 24) | ((p[j + 1] & 0xff) << 16) |
                ((p[j + 2] & 0xff) << 8) | (p[j + 3] & 0xff));
        }
        for (i = 16; i < 64; i++) {
            u = w[i - 2];
            t1 = (u >>> 17 | u << (32 - 17)) ^ (u >>> 19 | u << (32 - 19)) ^ (u >>> 10);
            u = w[i - 15];
            t2 = (u >>> 7 | u << (32 - 7)) ^ (u >>> 18 | u << (32 - 18)) ^ (u >>> 3);
            w[i] = (t1 + w[i - 7] | 0) + (t2 + w[i - 16] | 0);
        }
        for (i = 0; i < 64; i++) {
            t1 = (((((e >>> 6 | e << (32 - 6)) ^ (e >>> 11 | e << (32 - 11)) ^
                (e >>> 25 | e << (32 - 25))) + ((e & f) ^ (~e & g))) | 0) +
                ((h + ((K[i] + w[i]) | 0)) | 0)) | 0;
            t2 = (((a >>> 2 | a << (32 - 2)) ^ (a >>> 13 | a << (32 - 13)) ^
                (a >>> 22 | a << (32 - 22))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        v[0] += a;
        v[1] += b;
        v[2] += c;
        v[3] += d;
        v[4] += e;
        v[5] += f;
        v[6] += g;
        v[7] += h;
        pos += 64;
        len -= 64;
    }
    return pos;
}
// Hash implements SHA256 hash algorithm.
var Hash = /** @class */ (function () {
    function Hash() {
        this.digestLength = exports.digestLength;
        this.blockSize = exports.blockSize;
        // Note: Int32Array is used instead of Uint32Array for performance reasons.
        this.state = new Int32Array(8); // hash state
        this.temp = new Int32Array(64); // temporary state
        this.buffer = new Uint8Array(128); // buffer for data to hash
        this.bufferLength = 0; // number of bytes in buffer
        this.bytesHashed = 0; // number of total bytes hashed
        this.finished = false; // indicates whether the hash was finalized
        this.reset();
    }
    // Resets hash state making it possible
    // to re-use this instance to hash other data.
    Hash.prototype.reset = function () {
        this.state[0] = 0x6a09e667;
        this.state[1] = 0xbb67ae85;
        this.state[2] = 0x3c6ef372;
        this.state[3] = 0xa54ff53a;
        this.state[4] = 0x510e527f;
        this.state[5] = 0x9b05688c;
        this.state[6] = 0x1f83d9ab;
        this.state[7] = 0x5be0cd19;
        this.bufferLength = 0;
        this.bytesHashed = 0;
        this.finished = false;
        return this;
    };
    // Cleans internal buffers and re-initializes hash state.
    Hash.prototype.clean = function () {
        for (var i = 0; i < this.buffer.length; i++) {
            this.buffer[i] = 0;
        }
        for (var i = 0; i < this.temp.length; i++) {
            this.temp[i] = 0;
        }
        this.reset();
    };
    // Updates hash state with the given data.
    //
    // Optionally, length of the data can be specified to hash
    // fewer bytes than data.length.
    //
    // Throws error when trying to update already finalized hash:
    // instance must be reset to use it again.
    Hash.prototype.update = function (data, dataLength) {
        if (dataLength === void 0) { dataLength = data.length; }
        if (this.finished) {
            throw new Error("SHA256: can't update because hash was finished.");
        }
        var dataPos = 0;
        this.bytesHashed += dataLength;
        if (this.bufferLength > 0) {
            while (this.bufferLength < 64 && dataLength > 0) {
                this.buffer[this.bufferLength++] = data[dataPos++];
                dataLength--;
            }
            if (this.bufferLength === 64) {
                hashBlocks(this.temp, this.state, this.buffer, 0, 64);
                this.bufferLength = 0;
            }
        }
        if (dataLength >= 64) {
            dataPos = hashBlocks(this.temp, this.state, data, dataPos, dataLength);
            dataLength %= 64;
        }
        while (dataLength > 0) {
            this.buffer[this.bufferLength++] = data[dataPos++];
            dataLength--;
        }
        return this;
    };
    // Finalizes hash state and puts hash into out.
    //
    // If hash was already finalized, puts the same value.
    Hash.prototype.finish = function (out) {
        if (!this.finished) {
            var bytesHashed = this.bytesHashed;
            var left = this.bufferLength;
            var bitLenHi = (bytesHashed / 0x20000000) | 0;
            var bitLenLo = bytesHashed << 3;
            var padLength = (bytesHashed % 64 < 56) ? 64 : 128;
            this.buffer[left] = 0x80;
            for (var i = left + 1; i < padLength - 8; i++) {
                this.buffer[i] = 0;
            }
            this.buffer[padLength - 8] = (bitLenHi >>> 24) & 0xff;
            this.buffer[padLength - 7] = (bitLenHi >>> 16) & 0xff;
            this.buffer[padLength - 6] = (bitLenHi >>> 8) & 0xff;
            this.buffer[padLength - 5] = (bitLenHi >>> 0) & 0xff;
            this.buffer[padLength - 4] = (bitLenLo >>> 24) & 0xff;
            this.buffer[padLength - 3] = (bitLenLo >>> 16) & 0xff;
            this.buffer[padLength - 2] = (bitLenLo >>> 8) & 0xff;
            this.buffer[padLength - 1] = (bitLenLo >>> 0) & 0xff;
            hashBlocks(this.temp, this.state, this.buffer, 0, padLength);
            this.finished = true;
        }
        for (var i = 0; i < 8; i++) {
            out[i * 4 + 0] = (this.state[i] >>> 24) & 0xff;
            out[i * 4 + 1] = (this.state[i] >>> 16) & 0xff;
            out[i * 4 + 2] = (this.state[i] >>> 8) & 0xff;
            out[i * 4 + 3] = (this.state[i] >>> 0) & 0xff;
        }
        return this;
    };
    // Returns the final hash digest.
    Hash.prototype.digest = function () {
        var out = new Uint8Array(this.digestLength);
        this.finish(out);
        return out;
    };
    // Internal function for use in HMAC for optimization.
    Hash.prototype._saveState = function (out) {
        for (var i = 0; i < this.state.length; i++) {
            out[i] = this.state[i];
        }
    };
    // Internal function for use in HMAC for optimization.
    Hash.prototype._restoreState = function (from, bytesHashed) {
        for (var i = 0; i < this.state.length; i++) {
            this.state[i] = from[i];
        }
        this.bytesHashed = bytesHashed;
        this.finished = false;
        this.bufferLength = 0;
    };
    return Hash;
}());
exports.Hash = Hash;
// HMAC implements HMAC-SHA256 message authentication algorithm.
var HMAC = /** @class */ (function () {
    function HMAC(key) {
        this.inner = new Hash();
        this.outer = new Hash();
        this.blockSize = this.inner.blockSize;
        this.digestLength = this.inner.digestLength;
        var pad = new Uint8Array(this.blockSize);
        if (key.length > this.blockSize) {
            (new Hash()).update(key).finish(pad).clean();
        }
        else {
            for (var i = 0; i < key.length; i++) {
                pad[i] = key[i];
            }
        }
        for (var i = 0; i < pad.length; i++) {
            pad[i] ^= 0x36;
        }
        this.inner.update(pad);
        for (var i = 0; i < pad.length; i++) {
            pad[i] ^= 0x36 ^ 0x5c;
        }
        this.outer.update(pad);
        this.istate = new Uint32Array(8);
        this.ostate = new Uint32Array(8);
        this.inner._saveState(this.istate);
        this.outer._saveState(this.ostate);
        for (var i = 0; i < pad.length; i++) {
            pad[i] = 0;
        }
    }
    // Returns HMAC state to the state initialized with key
    // to make it possible to run HMAC over the other data with the same
    // key without creating a new instance.
    HMAC.prototype.reset = function () {
        this.inner._restoreState(this.istate, this.inner.blockSize);
        this.outer._restoreState(this.ostate, this.outer.blockSize);
        return this;
    };
    // Cleans HMAC state.
    HMAC.prototype.clean = function () {
        for (var i = 0; i < this.istate.length; i++) {
            this.ostate[i] = this.istate[i] = 0;
        }
        this.inner.clean();
        this.outer.clean();
    };
    // Updates state with provided data.
    HMAC.prototype.update = function (data) {
        this.inner.update(data);
        return this;
    };
    // Finalizes HMAC and puts the result in out.
    HMAC.prototype.finish = function (out) {
        if (this.outer.finished) {
            this.outer.finish(out);
        }
        else {
            this.inner.finish(out);
            this.outer.update(out, this.digestLength).finish(out);
        }
        return this;
    };
    // Returns message authentication code.
    HMAC.prototype.digest = function () {
        var out = new Uint8Array(this.digestLength);
        this.finish(out);
        return out;
    };
    return HMAC;
}());
exports.HMAC = HMAC;
// Returns SHA256 hash of data.
function hash(data) {
    var h = (new Hash()).update(data);
    var digest = h.digest();
    h.clean();
    return digest;
}
exports.hash = hash;
// Function hash is both available as module.hash and as default export.
exports["default"] = hash;
// Returns HMAC-SHA256 of data under the key.
function hmac(key, data) {
    var h = (new HMAC(key)).update(data);
    var digest = h.digest();
    h.clean();
    return digest;
}
exports.hmac = hmac;
// Fills hkdf buffer like this:
// T(1) = HMAC-Hash(PRK, T(0) | info | 0x01)
function fillBuffer(buffer, hmac, info, counter) {
    // Counter is a byte value: check if it overflowed.
    var num = counter[0];
    if (num === 0) {
        throw new Error("hkdf: cannot expand more");
    }
    // Prepare HMAC instance for new data with old key.
    hmac.reset();
    // Hash in previous output if it was generated
    // (i.e. counter is greater than 1).
    if (num > 1) {
        hmac.update(buffer);
    }
    // Hash in info if it exists.
    if (info) {
        hmac.update(info);
    }
    // Hash in the counter.
    hmac.update(counter);
    // Output result to buffer and clean HMAC instance.
    hmac.finish(buffer);
    // Increment counter inside typed array, this works properly.
    counter[0]++;
}
var hkdfSalt = new Uint8Array(exports.digestLength); // Filled with zeroes.
function hkdf(key, salt, info, length) {
    if (salt === void 0) { salt = hkdfSalt; }
    if (length === void 0) { length = 32; }
    var counter = new Uint8Array([1]);
    // HKDF-Extract uses salt as HMAC key, and key as data.
    var okm = hmac(salt, key);
    // Initialize HMAC for expanding with extracted key.
    // Ensure no collisions with `hmac` function.
    var hmac_ = new HMAC(okm);
    // Allocate buffer.
    var buffer = new Uint8Array(hmac_.digestLength);
    var bufpos = buffer.length;
    var out = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
        if (bufpos === buffer.length) {
            fillBuffer(buffer, hmac_, info, counter);
            bufpos = 0;
        }
        out[i] = buffer[bufpos++];
    }
    hmac_.clean();
    buffer.fill(0);
    counter.fill(0);
    return out;
}
exports.hkdf = hkdf;
// Derives a key from password and salt using PBKDF2-HMAC-SHA256
// with the given number of iterations.
//
// The number of bytes returned is equal to dkLen.
//
// (For better security, avoid dkLen greater than hash length - 32 bytes).
function pbkdf2(password, salt, iterations, dkLen) {
    var prf = new HMAC(password);
    var len = prf.digestLength;
    var ctr = new Uint8Array(4);
    var t = new Uint8Array(len);
    var u = new Uint8Array(len);
    var dk = new Uint8Array(dkLen);
    for (var i = 0; i * len < dkLen; i++) {
        var c = i + 1;
        ctr[0] = (c >>> 24) & 0xff;
        ctr[1] = (c >>> 16) & 0xff;
        ctr[2] = (c >>> 8) & 0xff;
        ctr[3] = (c >>> 0) & 0xff;
        prf.reset();
        prf.update(salt);
        prf.update(ctr);
        prf.finish(u);
        for (var j = 0; j < len; j++) {
            t[j] = u[j];
        }
        for (var j = 2; j <= iterations; j++) {
            prf.reset();
            prf.update(u).finish(u);
            for (var k = 0; k < len; k++) {
                t[k] ^= u[k];
            }
        }
        for (var j = 0; j < len && i * len + j < dkLen; j++) {
            dk[i * len + j] = t[j];
        }
    }
    for (var i = 0; i < len; i++) {
        t[i] = u[i] = 0;
    }
    for (var i = 0; i < 4; i++) {
        ctr[i] = 0;
    }
    prf.clean();
    return dk;
}
exports.pbkdf2 = pbkdf2;
return exports;
})();

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



// ── 06. Integração com o Força de Vendas RBN ──
// Sincroniza pedidos, vendas e metas com as bases usadas pelo painel.

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
 * Execute instalarGatilhosVendasRbn_() uma única vez, autorizando permissões.
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

function instalarGatilhosVendasRbn_() {
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
  if (String(out[7]??'').trim()===rbnCodigo_(antiga[7]) && /^\s*\d+\s*[-–—]\s*\S/.test(String(antiga[7]??''))) out[7]=antiga[7];
  [11,13,14,20,21].forEach(function(i) {
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
    if([11,12,13,14,21].indexOf(i)!==-1){if((v===''||v==null)&&(w===''||w==null))return true;if(v===''||v==null||w===''||w==null)return false;return Math.abs(num_(v)-num_(w))<0.0000001;}
    return String(v == null ? '' : v).trim() === String(w == null ? '' : w).trim();
  });
}

function sincronizarVendasRbn_() {
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

const RBN_LOGISTICS_HEADERS = ['Endereço Completo', 'Peso Pedidos'];
const RBN_WEIGHT_NUMBER_FORMAT = '0.###';

function rbnGarantirColunasLogisticas_(sheet) {
  const first = 23;
  const end = first + RBN_LOGISTICS_HEADERS.length - 1;
  const current = sheet.getMaxColumns();
  if (current < end) sheet.insertColumnsAfter(current, end - current);
  const range = sheet.getRange(1, first, 1, RBN_LOGISTICS_HEADERS.length);
  const actual = range.getDisplayValues()[0];
  if (actual.every((value, index) => value === RBN_LOGISTICS_HEADERS[index])) return;
  actual.forEach((value, index) => {
    if (!value || value === RBN_LOGISTICS_HEADERS[index]) return;
    const column = first + index;
    const count = sheet.getLastRow() - 1;
    const placeholder = value === 'Column ' + column || value === 'Coluna ' + column;
    if (!placeholder || (count > 0 && !sheet.getRange(2, column, count, 1).isBlank())) {
      throw new Error('Coluna logística já está em uso na aba ' + sheet.getName() + ': ' + value);
    }
  });
  range.setValues([RBN_LOGISTICS_HEADERS]);
  sheet.getRange(2, first + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(RBN_WEIGHT_NUMBER_FORMAT);
}

function rbnGravarLinhasLogisticas_(sheet, first, rows, comercial=true, logistica=true) {
  if (comercial) sheet.getRange(first, 1, rows.length, 20).setValues(rows.map(row => row.slice(0, 20)));
  if (!logistica) return;
  sheet.getRange(first, 24, rows.length, 1).setNumberFormat(RBN_WEIGHT_NUMBER_FORMAT);
  sheet.getRange(first, 23, rows.length, 2).setValues(rows.map(row => {
    const address = row[20];
    const safeAddress = typeof address === 'string' && /^[=+@-]/.test(address) ? "'" + address : address;
    return [safeAddress ?? '', row[21] ?? ''];
  }));
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
      const peso=item.peso_kg;
      if(peso!=null&&(typeof peso!=='number'||!Number.isFinite(peso)))throw new Error('Peso inválido na exportação.');
      const address=typeof item.endereco_entrega==='string'?item.endereco_entrega.trim():'';
      incoming.set(key,{ano:year,valores:row.concat([address||null,peso??null])});
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
    const dates=count ? sheet.getRange(2,16,count,2).getValues() : [];
    const hasPeriod=dates.some(d=>rbnNoPeriodo_(rbnIso_(d[1])||rbnIso_(d[0]),inicio,fim));
    if(!hasPeriod&&!incomingYears.has(year))return;
    rbnGarantirColunasLogisticas_(sheet);
    if(!count)return;
    const keys=sheet.getRange(2,6,count,4).getValues(),needed=new Set();
    for(let i=0;i<count;i++){
      const key=rbnCodigo_(keys[i][3])+'|'+rbnProduto_(keys[i][0])+'|'+rbnCodigo_(keys[i][2])+'|'+rbnIso_(dates[i][0]);
      if(incoming.has(key)||rbnNoPeriodo_(rbnIso_(dates[i][1])||rbnIso_(dates[i][0]),inicio,fim))needed.add(Math.floor(i/size));
    }
    Array.from(needed).sort((a,b)=>a-b).forEach(k=>{
      const first=2+k*size,length=Math.min(size,count-k*size);
      const values=sheet.getRange(first,1,length,24).getValues();
      const rows=values.map(row=>row.slice(0,20).concat(row.slice(22)));
      state.blocks.set(k,rows);
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
    if(selected&&selected.ano===item.ano){if(!rbnMesmaLinha_(merged,selected.valores)){byYear[item.ano].changes.set(selected.row,{row:selected.row,old:selected.valores,valores:merged});summary.atualizadas++;}}
    else {byYear[item.ano].append.push(merged);summary.novas++;}
    found.forEach(x=>{if(x!==selected||x.ano!==item.ano)retire(x,'Chave substituída/duplicada na importação');});
  });
  VENDAS_RBN_CFG.anos.forEach(year=>byYear[year].changes.forEach(c=>{if(c.reason){archive.push([job.id,new Date().toISOString(),c.reason,year,c.row].concat(c.old.slice(0,20)));c.valores[10]=marker;summary.revisar++;}}));
  if(Date.now()-started>240000)throw new Error('Tempo insuficiente antes da gravação; nenhuma linha alterada.');
  if(archive.length){let review=ss.getSheetByName('SYNC_REVISAO');if(!review){review=ss.insertSheet('SYNC_REVISAO');review.getRange(1,1,1,25).setValues([['JOB_ID','ARQUIVADO_EM','MOTIVO','ANO_ORIGEM','LINHA_ORIGEM'].concat(VENDAS_RBN_CFG.colunas)]);}const end=review.getLastRow()+archive.length;if(end>review.getMaxRows())review.insertRowsAfter(review.getMaxRows(),end-review.getMaxRows());review.getRange(review.getLastRow()+1,1,archive.length,25).setValues(archive);}
  VENDAS_RBN_CFG.anos.forEach(year=>{
    const state=byYear[year],dirty=new Map();
    state.changes.forEach(c=>{
      const k=Math.floor((c.row-2)/size);
      const fields=dirty.get(k)||{comercial:false,logistica:false};
      fields.comercial=fields.comercial||!c.old||!rbnMesmaLinha_(c.valores.slice(0,20),c.old.slice(0,20));
      fields.logistica=fields.logistica||!c.old||!rbnMesmaLinha_(c.valores.slice(20),c.old.slice(20));
      state.blocks.get(k)[(c.row-2)%size]=c.valores;dirty.set(k,fields);
    });
    Array.from(dirty.keys()).sort((a,b)=>a-b).forEach(k=>{
      const fields=dirty.get(k);
      rbnGravarLinhasLogisticas_(state.sheet,2+k*size,state.blocks.get(k),fields.comercial,fields.logistica);
    });
    if(state.append.length){const last=state.sheet.getLastRow(),need=last+state.append.length;if(need>state.sheet.getMaxRows())state.sheet.insertRowsAfter(state.sheet.getMaxRows(),need-state.sheet.getMaxRows());rbnGravarLinhasLogisticas_(state.sheet,last+1,state.append);}
  });
  if(!job.adiarDatasPedidos)summary.datasPedidos=rbnAtualizarDatasPedidos_(ss);
  SpreadsheetApp.flush();summary.concluidaEm=new Date().toISOString();summary.durationMs=Date.now()-started;
  console.log('Sincronização concluída: '+JSON.stringify(summary));return summary;
}

function atualizarCacheVendasRbn_() {
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




function atualizarMetasCacheRbn_() {
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


// ── 07. Leitura incremental e atualização das bases ──
// Lê os períodos necessários, prepara os dados recentes e expõe rotinas de diagnóstico.

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

function installAutomaticRefreshTrigger_() {
  const handler = 'automaticRefreshDataset_';
  ScriptApp.getProjectTriggers().forEach(trigger => { if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(15).create();
  const installedAt = new Date().toISOString(); PropertiesService.getScriptProperties().setProperty('AUTO_REFRESH_INSTALLED_AT', installedAt);
  return { ok: true, handler: handler, cadence: 'hourly', installedAt: installedAt };
}

function diagnosticarAtualizacaoRbn_() {
  const p = PropertiesService.getScriptProperties();
  console.log(JSON.stringify({agora:new Date().toISOString(),snapshot:datasetInfo_(),cachePendente:p.getProperty('VENDAS_RBN_CACHE_PENDENTE'),ultimaSync:p.getProperty('VENDAS_RBN_ULTIMA_SYNC'),pedidosAtualizadosEm:p.getProperty('OPEN_ORDERS_UPDATED_AT'),origem:CFG.salesSpreadsheetId,cache:CFG.cacheSpreadsheetId,auxiliar:CFG.auxiliarySpreadsheetId}));
}

function sincronizarAgoraRbn_() {
  console.log(JSON.stringify(sincronizarVendasRbn_()));
}

function atualizarBasesAgoraRbn_() {
  PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_CACHE_PENDENTE','1');
  console.log(JSON.stringify(atualizarCacheVendasRbn_()));
}

function validarCacheRbn_(){
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

function inicializarDatasPedidosRbn_(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw new Error('Outra rotina em execução.');
  try{const result=rbnAtualizarDatasPedidos_(SpreadsheetApp.openById(CFG.salesSpreadsheetId));PropertiesService.getScriptProperties().setProperty('VENDAS_RBN_CACHE_PENDENTE','1');console.log(JSON.stringify(result));return result;}finally{lock.releaseLock();}
}



// ── 08. Sincronização com retomada ──
// Salva o andamento entre execuções e disponibiliza os dados após concluir a preparação.

// Checkpoints keep completed work across executions. Only a complete staging cache is published.
function rbnLoadState_(key){const p=PropertiesService.getScriptProperties(),n=Number(p.getProperty(key+'_N')||0);if(!n)return null;let s='';for(let i=0;i<n;i++)s+=p.getProperty(key+'_'+i)||'';return JSON.parse(s);}

function rbnSaveState_(key,value){const p=PropertiesService.getScriptProperties(),s=JSON.stringify(value),parts={};for(let i=0;i<s.length;i+=6000)parts[key+'_'+(i/6000)]=s.slice(i,i+6000);p.setProperties(parts,false);p.setProperty(key+'_N',String(Math.ceil(s.length/6000)));}

function rbnClearState_(key){const p=PropertiesService.getScriptProperties(),n=Number(p.getProperty(key+'_N')||0);for(let i=0;i<n;i++)p.deleteProperty(key+'_'+i);p.deleteProperty(key+'_N');}

function rbnScheduleContinuation_(){const h='continuarAtualizacaoRbn';if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===h))ScriptApp.newTrigger(h).timeBased().after(1000).create();}

function rbnStatus_(stage,error) {
  PropertiesService.getScriptProperties().setProperties({RBN_UPDATE_STAGE:stage,RBN_UPDATE_STAGE_AT:new Date().toISOString(),RBN_UPDATE_ERROR:error?String(error).slice(0,1000):''},false);
}

function rbnSheetsBatch_(id,requests) {
  const ss=SpreadsheetApp.openById(id);
  requests.forEach(q=>{if(q.updateCells){const x=q.updateCells,r=x.range||x.start,s=ss.getSheetById(r.sheetId);if(x.range)s.getRange(r.startRowIndex+1,r.startColumnIndex+1,r.endRowIndex-r.startRowIndex,r.endColumnIndex-r.startColumnIndex).clearContent();else if(x.rows.length)s.getRange(r.rowIndex+1,r.columnIndex+1,x.rows.length,1).setValues(x.rows.map(v=>[v.values[0].userEnteredValue.stringValue]));}else if(q.copyPaste){const x=q.copyPaste,a=x.source,b=x.destination;ss.getSheetById(a.sheetId).getRange(a.startRowIndex+1,1,a.endRowIndex-a.startRowIndex,1).copyTo(ss.getSheetById(b.sheetId).getRange(b.startRowIndex+1,1,b.endRowIndex-b.startRowIndex,1),{contentsOnly:true});}else throw new Error('Operação de preparação não suportada.');});
}

function rbnWriteRecords_(ss,sheet,start,records){for(let i=0;i<records.length;i+=2000)rbnSheetsBatch_(ss.getId(),[{updateCells:{start:{sheetId:sheet.getSheetId(),rowIndex:start+i,columnIndex:0},rows:records.slice(i,i+2000).map(v=>({values:[{userEnteredValue:{stringValue:v}}]})),fields:'userEnteredValue'}}]);}

function rbnHistoryRuns_(rows,fromMonth) {
  const runs=[];
  let count=0,latest=null;
  rows.forEach((row,i)=>{const item=JSON.parse(String(row[0]||''));if(item.type!=='sale'||!item.value)return;const date=String(item.value.date||'');if(!date||date.slice(0,7)>=fromMonth)return;const source=i+1,last=runs[runs.length-1];if(last&&last.source+last.length===source)last.length++;else runs.push({source:source,target:count,length:1});count++;if(!latest||date>latest)latest=date;});
  return {runs:runs,count:count,latest:latest};
}

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

function sincronizarVendasRbn_(){
  const started=Date.now();
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,pending:true};const p=PropertiesService.getScriptProperties();let st=null;
  try{
    if(rbnLoadState_('RBN_CACHE_JOB')){rbnScheduleContinuation_();return {ok:true,pending:true};}
    const cfg=rbnConfig_();st=rbnLoadState_('RBN_SALES_JOB');
    if(!st){const jobs=(rbnApi_(cfg,'acao=jobs').jobs||[]).filter(j=>Number(j.tentativas||0)<3).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));if(!jobs.length)return {ok:true,pendentes:0};const job=jobs[0];rbnApi_(cfg,'',{acao:'iniciar',id:job.id});st={job:job,periods:rbnPeriods_(job.periodo_inicio,job.periodo_fim),done:0,results:[]};rbnSaveState_('RBN_SALES_JOB',st);}
    if(st.failed)throw new Error('Sincronização pausada para revisão: '+st.failed);
    if(st.done<st.periods.length){const period=st.periods[st.done];rbnStatus_('Sincronizando '+period.inicio.slice(0,7));rbnApi_(cfg,'',{acao:'heartbeat',id:st.job.id});const result=rbnExecutarJob_(cfg,Object.assign({},st.job,{periodo_inicio:period.inicio,periodo_fim:period.fim,allowEmpty:true,adiarDatasPedidos:true}));st.results.push(result);st.done++;rbnSaveState_('RBN_SALES_JOB',st);rbnApi_(cfg,'',{acao:'heartbeat',id:st.job.id});}
    if(st.done<st.periods.length||Date.now()-started>90000){rbnScheduleContinuation_();return {ok:true,pending:true,completedMonths:st.done,totalMonths:st.periods.length};}
    if(!st.datasConcluidas){
      rbnStatus_('Atualizando datas dos pedidos');
      rbnApi_(cfg,'',{acao:'heartbeat',id:st.job.id});
      rbnAtualizarDatasPedidos_(SpreadsheetApp.openById(cfg.sheetId));
      SpreadsheetApp.flush();st.datasConcluidas=true;rbnSaveState_('RBN_SALES_JOB',st);
    }
    const lines=st.results.reduce((s,r)=>s+r.exportadas,0);rbnApi_(cfg,'',{acao:'concluir',id:st.job.id,linhas:lines});p.setProperties({VENDAS_RBN_ULTIMA_SYNC:JSON.stringify({id:st.job.id,inicio:st.job.periodo_inicio,fim:st.job.periodo_fim,exportadas:lines,concluidaEm:new Date().toISOString()}),VENDAS_RBN_CACHE_PENDENTE:'1'},false);rbnClearState_('RBN_SALES_JOB');rbnStatus_('Vendas sincronizadas; preparando dashboard');rbnScheduleContinuation_();return {ok:true,pending:true};
  }catch(e){rbnStatus_('Falha na sincronização',e);if(st&&!st.failed){st.errors=Number(st.errors||0)+1;if(st.errors>=3)st.failed=String(e).slice(0,500);rbnSaveState_('RBN_SALES_JOB',st);if(!st.failed)rbnScheduleContinuation_();}throw e;}finally{lock.releaseLock();}
}

function sincronizarMetasRbn_(){const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:true,pending:true};try{const p=PropertiesService.getScriptProperties(),data=rbnApi_(rbnConfig_(),'acao=metas');if(!Array.isArray(data.metas)||!data.signature)throw new Error('Exportação de metas inválida.');if(p.getProperty('RBN_GOALS_SIGNATURE')===data.signature)return {ok:true,changed:false};const incoming=data.metas,keys=new Set(),months=new Set();const rows=incoming.map(v=>{const mes=String(v.mes),rca=Number(v.cod_rca),department=String(v.departamento||''),value=Number(v.meta),key=mes+'|'+rca+'|'+department;if(!/^20\d\d-\d\d$/.test(mes)||!Number.isFinite(rca)||!department||!Number.isFinite(value)||value<0||keys.has(key))throw new Error('Meta inválida ou duplicada.');keys.add(key);months.add(mes);return [mes,rca,department,value];});if(!rows.length)return {ok:true,changed:false};const sheet=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheetByName('METAS'),old=sheet.getDataRange().getValues();if(old[0].slice(0,4).join('|')!=='MES|COD_RCA|DEPARTAMENTO|META')throw new Error('Cabeçalho de metas divergente.');const output=old.slice(1).filter(v=>v[0]&&!months.has(v[0] instanceof Date?Utilities.formatDate(v[0],sheet.getParent().getSpreadsheetTimeZone(),'yyyy-MM'):String(v[0]))).map(v=>[v[0] instanceof Date?Utilities.formatDate(v[0],sheet.getParent().getSpreadsheetTimeZone(),'yyyy-MM'):v[0],v[1],v[2],v[3]]).concat(rows);sheet.getRange(2,1,output.length,1).setNumberFormat('@');sheet.getRange(2,1,output.length,4).setValues(output);if(old.length>output.length+1)sheet.getRange(output.length+2,1,old.length-output.length-1,4).clearContent();SpreadsheetApp.flush();p.setProperties({RBN_GOALS_SIGNATURE:data.signature,RBN_GOALS_UPDATED_AT:new Date().toISOString(),VENDAS_RBN_CACHE_PENDENTE:'1'},false);rbnScheduleContinuation_();return {ok:true,changed:true,rows:rows.length};}finally{lock.releaseLock();}}

function continuarAtualizacaoRbn_(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='continuarAtualizacaoRbn').forEach(t=>ScriptApp.deleteTrigger(t));if(rbnLoadState_('RBN_SALES_JOB'))return sincronizarVendasRbn_();if(rbnLoadState_('RBN_CACHE_JOB')||PropertiesService.getScriptProperties().getProperty('VENDAS_RBN_CACHE_PENDENTE')==='1')return atualizarCacheVendasRbn_();return {ok:true};}

function instalarFluxoRapidoRbn_() {
  const wanted={sincronizarVendasRbn:1,atualizarCacheVendasRbn:1,sincronizarMetasRbn:1},seen={};
  ScriptApp.getProjectTriggers().forEach(t=>{const h=t.getHandlerFunction();if(wanted[h]){ScriptApp.deleteTrigger(t);seen[h]=true;}});
  Object.keys(wanted).forEach(h=>ScriptApp.newTrigger(h).timeBased().everyMinutes(1).create());
  console.log('Fluxo automático a cada minuto e continuação por etapa instalado.');
}

function inicializarLayoutCacheRbn_(){const p=PropertiesService.getScriptProperties(),ss=SpreadsheetApp.openById(CFG.cacheSpreadsheetId),name=p.getProperty('SNAPSHOT_SHEET_NAME'),sheet=ss.getSheetByName(name),count=Number(p.getProperty('SNAPSHOT_RECORD_COUNT')),sales=Number(p.getProperty('SNAPSHOT_SALES_COUNT')),recent=Number(p.getProperty('SNAPSHOT_RECENT_COUNT')),from=previousMonthKey_(new Date());if(p.getProperty('RBN_CACHE_LAYOUT'))return;const headRows=sheet.getRange(2,1,Math.min(10000,count),1).getValues();let head=0;for(const row of headRows){const item=JSON.parse(row[0]);if(item.type==='sale')break;head++;}if(head>=headRows.length||recent>sales)throw new Error('Estrutura do cache não reconhecida.');const history=sales-recent,edge=history?JSON.parse(sheet.getRange(1+head+history,1).getValues()[0][0]):null,next=recent?JSON.parse(sheet.getRange(2+head+history,1).getValues()[0][0]):null;if(edge&&(edge.type!=='sale'||edge.value.date.slice(0,7)>=from))throw new Error('Limite histórico divergente.');if(next&&(next.type!=='sale'||next.value.date.slice(0,7)<from))throw new Error('Limite recente divergente.');const layout={sheet:name,fromMonth:from,recordCount:count,headLength:head,historyCount:history,historyLatest:edge?edge.value.date:null};p.setProperty('RBN_CACHE_LAYOUT',JSON.stringify(layout));console.log(JSON.stringify({layout:layout,updatedAt:p.getProperty('SNAPSHOT_UPDATED_AT'),totals:p.getProperty('SNAPSHOT_RECENT_TOTALS'),goals:readAuxiliary_().goals.filter(g=>g.monthKey==='2026-11').reduce((s,g)=>s+g.value,0)}));}

// ── 09. Usuários e recortes comerciais ──
// Administra perfis e determina quais registros comerciais cada usuário pode consultar.

function userAllowsRca_(user,rca){
 if(['ADMIN','DIRETOR','GERENTE'].indexOf(user.perfil)>=0)return true;
 if(user.perfil==='RCA')return String(user.cod_rca)===String(rca);
 if(user.perfil==='SUPERVISOR'){
  if(!user._allowed){const cache=CacheService.getScriptCache(),key='DASH_SCOPE_'+digestHex_(user.login+'|'+user.supervisor),saved=cache.get(key);const codes=saved?JSON.parse(saved):readAuxiliary_().rcas.filter(r=>norm_(r.supervisor)===norm_(user.supervisor)&&!!user.supervisor).map(r=>String(r.code));user._allowed=new Set(codes);if(!saved)cache.put(key,JSON.stringify(codes),300);}return user._allowed.has(String(rca));
 }
 return false;
}

function userAllowsRecord_(user,row){
 if(['ADMIN','DIRETOR','GERENTE'].indexOf(user.perfil)>=0)return true;
 if(row[0]===4)return true;
 const index={0:2,1:1,2:4,3:3,5:2}[row[0]];
 return index!=null&&userAllowsRca_(user,row[index]);
}

function assertDashboardAdmin_(actor,users){
 const record=users[actor.login];
 if(record?.ativo!==true||String(record.perfil||'').toUpperCase()!=='ADMIN'||record.temporaryPasswordExpiresAt!=null||
    String(record.accessVersion||'')!==actor.accessVersion)throw new Error('Sua sessão administrativa expirou. Entre novamente.');
}

function manageUsers_(actor,payload){
 if(actor.perfil!=='ADMIN')throw new Error('Apenas o administrador pode configurar usuários.');
 if(payload.issueTemporaryPassword){
  const input=payload.issueTemporaryPassword,login=String(input.login||'').trim().toLowerCase();
  if(login===actor.login)throw new Error('Peça a outro administrador para gerar sua senha provisória.');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(5000))throw new Error('Aguarde a atualização em andamento e tente novamente.');
  try{
   const users=loadUsers_();
   assertDashboardAdmin_(actor,users);
   if(!Object.prototype.hasOwnProperty.call(users,login)||users[login]?.ativo!==true)throw new Error('Selecione um usuário ativo.');
   const record={...users[login],accessVersion:Utilities.getUuid()};
   setTemporaryDashboardCredential_(record,input.credential||{});
   saveDashboardUserRecord_(login,record);
   return {ok:true,expiresAt:record.temporaryPasswordExpiresAt};
  }finally{lock.releaseLock();}
 }
 const aux=readAuxiliary_();
 if(payload.save){
  const input=payload.save,login=String(input.login||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._@-]{2,99}$/.test(login))throw new Error('Login: use de 3 a 100 caracteres, sem espaços.');
  const perfil=String(input.perfil||'').toUpperCase();
  if(['ADMIN','DIRETOR','GERENTE','SUPERVISOR','RCA','SAC','INTERNO',FORMATION_ROLE].indexOf(perfil)<0)throw new Error('Perfil inválido.');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(5000))throw new Error('Aguarde a atualização em andamento e tente salvar novamente.');
  try{
   const users=loadUsers_();
   assertDashboardAdmin_(actor,users);
   const old=Object.prototype.hasOwnProperty.call(users,login)?users[login]:null,record=Object.assign({},old||{},{nome:String(input.nome||'').trim().slice(0,120),perfil:perfil,ativo:input.ativo===true,cod_rca:perfil==='RCA'?Number(input.cod_rca):null,supervisor:perfil==='SUPERVISOR'?String(input.supervisor||''):''});
   record.areas=['ADMIN','DIRETOR'].includes(perfil)?['commercial','logistics']:Array.isArray(input.areas)?[...new Set(input.areas)].filter(a=>['commercial','logistics'].includes(a)):[];
   if(['SAC','INTERNO',FORMATION_ROLE].includes(perfil))record.areas=['logistics'];
   if(perfil==='RCA')record.areas=['commercial'];
   if(!record.areas.length)throw new Error('Selecione pelo menos uma área.');
   const scope=input.logisticsScope||{},clean=k=>Array.isArray(scope[k])?[...new Set(scope[k].map(x=>String(x).trim()).filter(Boolean))].slice(0,100):[];
   record.logisticsScope={carriers:clean('carriers'),sellers:['SAC','INTERNO'].includes(perfil)?[]:clean('sellers'),regions:['SAC','INTERNO'].includes(perfil)?[]:clean('regions')};
   if(perfil===FORMATION_ROLE)record.logisticsScope={carriers:[],sellers:[],regions:[]};
   if(input.permissions&&typeof input.permissions==='object'){
    record.permissions=Object.fromEntries(LOG_PERMISSION_KEYS.map(key=>{
     const view=input.permissions[key]?.view===true;
     return [key,{view,edit:view&&input.permissions[key]?.edit===true}];
    }));
   }else if(old?.perfil!==perfil)delete record.permissions;
   if(typeof input.editTransport==='boolean')record.editTransport=perfil==='SAC'&&input.editTransport;
   record.editTransport=platformAccess_(record).permissions.sac.edit;
   if(perfil==='SUPERVISOR'&&record.areas.includes('logistics')&&!Object.values(record.logisticsScope).some(a=>a.length))throw new Error('Defina o recorte logístico do supervisor.');
   if(!record.nome)throw new Error('Informe o nome.');
   if(perfil==='RCA'&&!aux.rcas.some(r=>Number(r.code)===record.cod_rca))throw new Error('Selecione um RCA válido.');
   if(perfil==='SUPERVISOR'&&record.areas.includes('commercial')&&!aux.rcas.some(r=>r.supervisor===record.supervisor&&!!record.supervisor))throw new Error('Selecione uma supervisão válida.');
   if(login===actor.login&&(perfil!=='ADMIN'||!record.ativo))throw new Error('Você não pode remover seu próprio acesso administrativo.');
   if(!old)setTemporaryDashboardCredential_(record,input.credential||{});
   else if(input.credential)throw new Error('Use Gerar senha provisória para redefinir a senha.');
   record.accessVersion=login===actor.login?old.accessVersion||'':Utilities.getUuid();
   saveDashboardUserRecord_(login,record);
   console.log('Usuário atualizado: '+login+' por '+actor.login);
   if(!old)return {ok:true,expiresAt:record.temporaryPasswordExpiresAt};
  }finally{lock.releaseLock();}
 }
 const updated=loadUsers_();
 return {ok:true,users:Object.keys(updated).map(login=>{const r=updated[login];return publicUser_(login,r);}),rcas:aux.rcas.map(r=>({code:r.code,name:r.name,supervisor:r.supervisor}))};
}

// ── 10. Histórico comercial e geográfico ──
// Carrega o histórico consolidado e os dados geográficos usados pelo painel.

// Usa a última classificação não vazia registrada no mês para cada cliente.
function historyMargin_(user,payload) {
  if (!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)) throw new Error('Histórico de margem exige perfil gerencial.');
  const year=Number(payload.year), empty={ok:true,rows:[],segments:[],clients:[]};
  if(!Number.isInteger(year)||!CFG.years.map(Number).includes(year))return empty;
  const cache=CacheService.getScriptCache();
  const version=SCRIPT_PROPS.getProperty('SNAPSHOT_UPDATED_AT')||'';
  const key='HIST_MARGIN_RAMO_V1_'+year+'_'+digestHex_(version).slice(0,14);
  const saved=centralCacheRead_(cache,key);
  if(saved)return saved;
  const sheet=SpreadsheetApp.openById(CFG.salesSpreadsheetId).getSheetByName(String(year));
  if(!sheet||sheet.getLastRow()<2)return empty;
  const headers=headerIndex_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]);
  const names=['Data Faturamento','Posição','Pedidos Enviados','Vl Lucro','DEPARTAMENTO','ESTENT','RAMO','Cod/Cliente'];
  const required=['Data Faturamento','Posição','Pedidos Enviados','DEPARTAMENTO','ESTENT','Cod/Cliente'];
  if(required.some(name=>headers[name]==null))return empty;
  const width=Math.max(...names.map(name=>headers[name]??-1))+1;
  const end=sheet.getLastRow(), classifications=new Map(), segments=new Map(), customerBuckets=new Map();
  for(let start=2;start<=end;start+=8000){
    const rows=sheet.getRange(start,1,Math.min(end-start+1,8000),width).getValues();
    for(const row of rows){
      if(norm_(cell_(row,headers,'Posição'))!=='FECHADO')continue;
      const day=dateIso_(cell_(row,headers,'Data Faturamento'));
      if(!day||Number(day.slice(0,4))!==year||day<'2024-08-01')continue;
      const month=Number(day.slice(5,7)), client=code_(cell_(row,headers,'Cod/Cliente'));
      const clientKey=month+'|'+client;
      const label=String(cell_(row,headers,'RAMO')||'').trim(), ramo=norm_(label);
      if(client!=null&&ramo&&(!classifications.has(clientKey)||day>=classifications.get(clientKey).day)){
        classifications.set(clientKey,{day,month,client,ramo});
        if(!segments.has(ramo))segments.set(ramo,label);
      }
      const department=String(cell_(row,headers,'DEPARTAMENTO')||'').trim(), uf=norm_(cell_(row,headers,'ESTENT'));
      const id=JSON.stringify([clientKey,department,uf]);
      if(!customerBuckets.has(id))customerBuckets.set(id,[month,department,uf,0,0,0,0,clientKey]);
      const bucket=customerBuckets.get(id), profit=cell_(row,headers,'Vl Lucro');
      bucket[6]++;
      if((typeof profit==='number'&&Number.isFinite(profit))||
         (typeof profit==='string'&&/^\s*-?\d[\d.,]*\s*$/.test(profit))){
        bucket[3]+=num_(cell_(row,headers,'Pedidos Enviados'));
        bucket[4]+=num_(profit);
        bucket[5]++;
      }
    }
  }
  const buckets=new Map();
  for(const [month,department,uf,base,profit,known,total,clientKey] of customerBuckets.values()){
    const ramo=classifications.get(clientKey)?.ramo||'';
    const id=JSON.stringify([month,department,uf,ramo]);
    if(!buckets.has(id))buckets.set(id,[month,department,uf,0,0,0,0,ramo]);
    const bucket=buckets.get(id);
    bucket[3]+=base;bucket[4]+=profit;bucket[5]+=known;bucket[6]+=total;
  }
  const result={ok:true,rows:[...buckets.values()],segments:[...segments],
    clients:[...classifications.values()].map(({month,client,ramo})=>[month,client,ramo])};
  centralCacheWrite_(cache,key,JSON.stringify(result),300);
  return result;
}

function recoveredMacroHistory_(user){
 if(['ADMIN','DIRETOR','GERENTE'].indexOf(user.perfil)<0)throw new Error('O histórico macro não possui vínculo com RCA ou supervisão.');
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
 if(['ADMIN','DIRETOR','GERENTE'].indexOf(user.perfil)<0)throw new Error('O histórico geográfico consolidado exige perfil gerencial.');
 const count=Number(SCRIPT_PROPS.getProperty('RECOVERED_GEO_V1_COUNT')||0);
 if(!count)return {ok:true,monthly:[],available:false};
 if(count<1||count>40)throw new Error('Histórico geográfico inválido.');
 let packed='';for(let i=0;i<count;i++){const part=SCRIPT_PROPS.getProperty('RECOVERED_GEO_V1_'+i);if(!part)throw new Error('Resumo geográfico incompleto.');packed+=part;}
 const bytes=Utilities.base64Decode(packed),data=JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes,'application/gzip')).getDataAsString('UTF-8'));
 if(!Array.isArray(data)||data.length!==86)throw new Error('Períodos geográficos inválidos.');
 const seen=new Set();data.forEach(r=>{if(!Array.isArray(r)||!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(r[0])||r[0]<'2017-06'||r[0]>='2024-08'||seen.has(r[0])||!Array.isArray(r[1])||!Number.isFinite(r[2]))throw new Error('Mês geográfico inválido.');seen.add(r[0]);r[1].forEach(c=>{if(!Array.isArray(c)||typeof c[0]!=='string'||!/^[A-Z]{2}$/.test(c[1])||!Number.isFinite(c[2]))throw new Error('Município histórico inválido.');});});
 return {ok:true,available:true,monthly:data.map(r=>({month:r[0],cities:r[1],unlocated:r[2]})),source:'Shop Control recuperado',cutoff:'2024-08-01'};
}



// ── 11. Configurações do painel ──
// Valida e armazena a configuração visual e os componentes do painel.

// Configurações e layouts: JSON declarativo, sem código fornecido pelo editor.
function biDefault_() {
  return {schema:1,settings:{shortDays:90,longDays:180,cutoff:'previous',openStatuses:['PENDENTE','LIBERADO','BLOQUEADO'],projectionStatuses:['PENDENTE','LIBERADO'],warning:70,success:100,defaultPage:'overview',defaultPeriod:'latest',compact:true,decimals:2,animation:true,density:'comfortable',refreshMinutes:1,autoRefresh:true},pages:[],widgets:[],overrides:[]};
}

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

// ── 12. Fontes de Logística ──
// Normaliza a leitura da Formação de Carga e do acompanhamento de transportadoras.

// Módulo logístico: fontes de leitura separadas da base comercial.
const LOGISTICS_SOURCES={operations:'1HmmIntr9PMEJSk6rAPhWJafTynxmZWUQiehxR1bRZUU',indicators:'1mdgzC1erdRyHiiauwVepFu3odSRU3oM6tpzSa2csxtM',reference:'127enD4Qy-u_9aUNgCEF-Lt57Y2jaKBQ4',geoUrl:'https://raw.githubusercontent.com/analistacomercialrbn/dashboardlojas/7b1b074e704661878a79200f054f762774187c6a/supervisao-web/assets/logistica-ne-2025.geojson.gz.b64'};

function logisticsAllowed_(user) {
  return !!user&&platformAccess_(user).areas.includes('logistics');
}

function logNorm_(v) {
  return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
}

function logText_(v) {
  const s=String(v==null?'':v).trim();
  return s&&s!=='#N/A'?s:'';
}

function logNumber_(v){if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v).trim().replace(/R\$|\s/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null;}

function logDate_(v,tz){if(v==null||v==='')return '';const clean=x=>{if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x))return '';const d=new Date(x+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===x?x:'';};if(v instanceof Date)return isNaN(v)?'':clean(Utilities.formatDate(v,tz||'America/Fortaleza','yyyy-MM-dd'));if(typeof v==='number'){if(v<30000||v>70000)return '';return clean(new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10));}const s=String(v).trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return clean(s.slice(0,10));const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);return m?clean((m[3].length===2?'20'+m[3]:m[3])+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')):'';}

function logProblem_(v) {
  const t=logNorm_(v);
  return !!t&&!['SEM OCORRENCIAS','SEM OCORRENCIA','NENHUMA','NAO','N/A','-','OK'].includes(t);
}

function logCity_(v) {
  const s=logText_(v),m=logNorm_(s).match(/\s*[-/]\s*([A-Z]{2})$/);
  return {city:logNorm_(s).replace(/\s*[-/]\s*[A-Z]{2}$/,''),uf:m?m[1]:''};
}
// Identidade estável para linhas legadas sem CHAVE; não depende da posição da linha.
function transportRowKey_(cells){
 const parts=cells.slice(0,7).map(logText_);
 return parts[0]||'trf_'+digestHex_(JSON.stringify(parts.slice(1)));
}

function logRegionMap_(values, defaultUf='') {
 const regions=new Map();
 for(const row of values.slice(1)){
  const {city,uf}=logCity_(row[1]), region=logText_(row[2]);
  if(city&&region)regions.set(city+(uf||defaultUf?'|'+(uf||defaultUf):''),region);
 }
 return regions;
}

function logRecords_(values,kind,tz,regionValues){
 const today=kind==='transport'?centralToday_(tz):'';
 const header=kind==='operations'?1:kind==='formations'?3:0;
 const indices=new Map(), names=new Map(), dates=new Map();
 (values[header]||[]).forEach((value,i)=>{const key=logNorm_(value);if(!indices.has(key))indices.set(key,i);});
 const idx=name=>{if(!names.has(name))names.set(name,indices.get(logNorm_(name))??-1);return names.get(name);};
 const date=value=>{
  if(!(value instanceof Date))return logDate_(value,tz);
  const key=value.getTime();
  if(!dates.has(key))dates.set(key,logDate_(value,tz));
  return dates.get(key);
 };
 const get=(r,...keys)=>{for(const k of keys){const i=idx(k);if(i>=0&&r[i]!=null&&r[i]!=='')return r[i];}return '';};
 const regionMap=logRegionMap_(regionValues||[]);
 return values.slice(header+1).flatMap((r,i)=>{
  const T=(...ks)=>logText_(get(r,...ks)),N=(...ks)=>logNumber_(get(r,...ks)),D=(...ks)=>date(get(r,...ks));
  if(kind==='operations'){
   if(!T('CLIENTE')&&!T('CIDADE')&&!T('PRODUTO'))return [];
   const loc=logCity_(T('CIDADE')),status=T('STATUS DA ENTREGA'),s=logNorm_(status),wait=get(r,'TEMPO ESPERA');
   let days=wait instanceof Date?Math.round((wait.getTime()-new Date(1899,11,31).getTime())/86400000):logNumber_(wait);if(days!=null&&days<0)days=null;
   return [{id:'op_'+(i+header+2),date:D('DATA IMPLANTAÇÃO'),dateInvalid:!!get(r,'DATA IMPLANTAÇÃO')&&!D('DATA IMPLANTAÇÃO'),client:T('CLIENTE'),seller:T('VENDEDOR'),...loc,cityLabel:T('CIDADE'),region:regionMap.get(loc.city+'|'+loc.uf)||regionMap.get(loc.city)||T('CLASSIFICAÇÃO DE ROTA')||'Sem região',loading:T('LOCAL CARREGAMENTO'),product:T('PRODUTO'),volumes:N('VOLUMES'),weight:N('PESO'),cost:N('CUSTOS R$'),notes:T('OBSERVAÇÕES'),vehicle:T('CAMINHÃO'),driver:T('MOTORISTA'),status:status||(logNorm_(get(r,'STATUS DA ENTREGA'))?'Status inválido':'Aguardando formação'),awaitingFormation:!logNorm_(get(r,'STATUS DA ENTREGA')),cargoId:T('ID CARGA','CARGA'),loaded:D('DATA CARREGAMENTO (Expedição)','DATA CARREGAMENTO(Expedição)'),deliveredDate:D('DATA CHEGADA CLIENTE'),route:T('CLASSIFICAÇÃO DE ROTA'),invoice:T('NOTA FISCAL'),category:T('CATEGORIA OCORRENCIA'),follow:T('FOLLOW UP OCORRENCIA'),checker:T('CONFERENTE'),picker:T('SEPARADOR'),forecast:D('PREVISÃO DE ROTA'),wait:days,delivered:/^ENTREGUE\b/.test(s),inRoute:/ROTA/.test(s)&&!/^ENTREGUE\b/.test(s),isLoaded:/CARREG/.test(s)&&!/^ENTREGUE\b/.test(s),occurrence:logProblem_(T('CATEGORIA OCORRENCIA'))||logProblem_(T('FOLLOW UP OCORRENCIA'))}];
  }
  if(kind==='formations'){
   if(!D('DATA')&&!T('REGIÃO')&&!T('VEÍCULO')&&!T('MOTORISTA'))return [];
   return [{id:'fc_'+(i+header+2),date:D('DATA'),region:T('REGIÃO')||'Sem região',vehicle:T('VEÍCULO'),driver:T('MOTORISTA'),cost:N('CUSTO DE CAPATAZIA'),problem:T('PROBLEMAS'),description:T('DESCRIÇÃO DO PROBLEMA'),category:T('CATEGORIA'),checker:T('CONFERENTE'),picker:T('SEPARADOR'),occurrence:logProblem_(T('PROBLEMAS'))||logProblem_(T('DESCRIÇÃO DO PROBLEMA'))}];
  }
  if(!T('NF')&&!T('CLIENTE'))return [];
  const deliveredDate=D('DATA ENTREGA'),sla=T('STATUS SLA'),status=T('STATUS TRANSPORTADORA')||sla||'Sem status',forecast=D('PRAZO INTERNO REBANHO')||D('PREVISÃO TRANSPORTADORA');
  const onTime=!!deliveredDate&&/NO PRAZO/.test(logNorm_(sla)),late=!!deliveredDate&&/FORA|ATRAS/.test(logNorm_(sla)),overdue=!deliveredDate&&!!forecast&&forecast<today;
  const loc=logCity_(T('CIDADE'));loc.uf=T('UF')||loc.uf;
  return [{id:transportRowKey_([T('CHAVE'),T('NF'),T('TRANSPORTADORA'),T('CLIENTE'),T('CNPJ/CPF'),T('CIDADE'),T('UF')]),invoice:T('NF'),client:T('CLIENTE'),...loc,cityLabel:T('CIDADE'),date:D('EMISSÃO')||D('DATA COLETA')||deliveredDate,issued:D('EMISSÃO'),collected:D('DATA COLETA'),forecast,deliveredDate,delivered:!!deliveredDate,weight:N('PESO'),volumes:N('VOLUMES'),freight:N('FRETE TOTAL'),goods:N('VALOR MERCADORIA'),status,sla,delay:N('DIAS ATRASO'),onTime,late,overdue,carrier:T('TRANSPORTADORA'),manualOccurrence:T('OCORRÊNCIA'),notes:T('PROBLEMA / OBSERVAÇÃO'),problem:T('OCORRÊNCIA')||T('PROBLEMA / OBSERVAÇÃO')||T('CATEGORIA OCORRÊNCIA'),category:T('CATEGORIA OCORRÊNCIA'),responsible:T('RESPONSÁVEL OCORRÊNCIA'),follow:T('FOLLOW UP / OCORRÊNCIA'),checker:T('CONFERENTE'),picker:T('SEPARADOR'),cargoType:T('TIPO DE CARGA'),seller:T('RCA'),occurrence:logProblem_(T('OCORRÊNCIA'))||logProblem_(T('PROBLEMA / OBSERVAÇÃO'))||logProblem_(T('CATEGORIA OCORRÊNCIA'))}];
 });
}

// Parâmetros privados da premiação. Leituras não abrem a planilha operacional.
function driverPayrollAccess_(user,edit=false){
  requireLogPermission_(user,'formation',edit?'edit':'view');
  if(!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil))throw new Error('A premiação dos motoristas está disponível para a gestão.');
}
function driverPayrollValidate_(rules){
  const routes=Object.create(null);
  if(!rules||typeof rules.perOrder!=='number'||!Number.isFinite(rules.perOrder)||rules.perOrder<0||rules.perOrder>1000000||
     !rules.routes||typeof rules.routes!=='object'||Array.isArray(rules.routes)||Object.keys(rules.routes).length>40){
    throw new Error('Informe até 40 rotas e valores válidos, iguais ou maiores que zero.');
  }
  for(const [name,value] of Object.entries(rules.routes)){
    const key=logNorm_(name);
    if(!key||key.length>80||['__PROTO__','PROTOTYPE','CONSTRUCTOR'].includes(key)||Object.prototype.hasOwnProperty.call(routes,key)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000){
      throw new Error('Confira os nomes e valores das rotas. Não repita classificações.');
    }
    routes[key]=value;
  }
  return {routes,perOrder:rules.perOrder};
}
function driverPayrollRules_(user){
  driverPayrollAccess_(user);
  const saved=PropertiesService.getScriptProperties().getProperty('LOG_DRIVER_BONUS_RULES');
  if(!saved)return {ok:true,routes:{},perOrder:0,revision:'',configured:false};
  const parsed=JSON.parse(saved),rules=driverPayrollValidate_(parsed);
  return {ok:true,...rules,revision:digestHex_(saved),configured:true,updatedAt:parsed.updatedAt||'',updatedBy:parsed.updatedBy||''};
}
function driverPayrollSave_(user,p){
  driverPayrollAccess_(user,true);
  const rules=driverPayrollValidate_(p.rules),props=PropertiesService.getScriptProperties();
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(3000))throw new Error('Outra configuração está sendo salva. Tente novamente em instantes.');
  try{
    const previous=props.getProperty('LOG_DRIVER_BONUS_RULES')||'';
    if(String(p.revision||'')!==(previous?digestHex_(previous):''))throw new Error('Os parâmetros mudaram. Atualize e confira os valores antes de salvar.');
    const updatedAt=new Date().toISOString(),saved=JSON.stringify({...rules,updatedAt,updatedBy:user.login});
    const audit={at:updatedAt,by:user.login,before:previous?JSON.parse(previous):null,after:JSON.parse(saved)};
    props.setProperties({'LOG_DRIVER_BONUS_RULES':saved,['LOG_DRIVER_BONUS_AUDIT_'+Utilities.getUuid()]:JSON.stringify(audit)},false);
    if(props.getProperty('LOG_DRIVER_BONUS_RULES')!==saved)throw new Error('Não foi possível confirmar a gravação. Atualize os parâmetros antes de tentar novamente.');
    return {ok:true,...rules,revision:digestHex_(saved),configured:true,updatedAt,updatedBy:user.login};
  }finally{lock.releaseLock();}
}

function logisticsApi_(user,payload){
 if(!logisticsAllowed_(user))throw new Error('Este módulo está disponível para os perfis de gestão.');
 const p=payload||{},kind=p.kind||'operations',props=PropertiesService.getScriptProperties(),access=platformAccess_(user);
 // A visão da Formação consulta apenas os campos necessários aos indicadores.
 if(kind==='formationOverview'&&!access.formationOnly)throw new Error('Visão geral fora do seu perfil.');
 const special=['formationExperimental','formationDirect','formationSummary','formationOverview','agenda','schedule','geo','transport'];
 if((access.formationOnly||access.transportOnly)&&!special.includes(kind))throw new Error('Área logística fora do seu perfil.');
 if(access.formationOnly&&kind==='transport')throw new Error('Seu perfil não tem acesso ao SAC.');
 if(kind==='transport')requireLogPermission_(user,'sac');
 if(['operations','formations','formationOverview'].includes(kind))requireLogPermission_(user,'formation');
 if(kind==='schedule'||kind==='agenda')requireLogPermission_(user,'agenda');
 if(kind==='geo'&&(access.formationOnly||access.transportOnly))requireLogPermission_(user,'formation');
 const ids={operations:props.getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,indicators:props.getProperty('LOG_INDICATORS_ID')||LOGISTICS_SOURCES.indicators};
 if(kind==='operations'&&p.action==='driverPayrollRules')return driverPayrollRules_(user);
 if(kind==='operations'&&p.action==='driverPayrollSave')return driverPayrollSave_(user,p);
 if(kind==='formationExperimental'||kind==='formationDirect')return formationDirectApi_(user,p);
 if(kind==='formationSummary')return formOverviewSummary_(user);
 if(kind==='agenda')return agendaApi_(user,p,ids.operations);
 if(kind==='transport'&&['batchRead','batchSave'].includes(p.action))return transportBatch_(user,p,ids.indicators);
 if(kind==='transport'&&p.action==='categoryAdd')return transportCategoryAdd_(user,p,ids.indicators);
 if(kind==='transport'&&['editRead','editSave'].includes(p.action))return transportEdit_(user,p,ids.indicators);
 if(kind==='transport'&&['importOptions','importPreview','importCommit'].includes(p.action))return sacImportApi_(user,p,ids.indicators);
 if(p.action==='configure'){
  if(user.perfil!=='ADMIN')throw new Error('Somente o administrador pode configurar fontes.');
  const a=String(p.operationsId||ids.operations).trim(),b=String(p.indicatorsId||ids.indicators).trim();if(!/^[\w-]{20,}$/.test(a)||!/^[-\w]{20,}$/.test(b))throw new Error('Informe o ID de uma planilha Google.');
  const ops=SpreadsheetApp.openById(a),ind=SpreadsheetApp.openById(b);if(!ops.getSheetByName('FORMAÇÃO 2026')||!ops.getSheetByName('CADASTRO REGIAO'))throw new Error('A fonte operacional precisa das abas FORMAÇÃO 2026 e CADASTRO REGIAO.');if(!ind.getSheetByName('ACOMPANHAMENTO'))throw new Error('A fonte de transportadoras precisa da aba ACOMPANHAMENTO.');
  props.setProperties({LOG_OPERATIONS_ID:a,LOG_INDICATORS_ID:b});return {ok:true,message:'Fontes de leitura atualizadas.'};
 }
 if(kind==='geo'){const response=UrlFetchApp.fetch(LOGISTICS_SOURCES.geoUrl,{muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('Não foi possível carregar a malha municipal.');const bytes=Utilities.base64Decode(response.getContentText().trim());return {ok:true,geo:JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes,'application/gzip')).getDataAsString('UTF-8'))};}
 if(kind==='sources'&&user.perfil!=='ADMIN')throw new Error('Somente o administrador acessa as fontes.');
 if(kind==='sources')return {ok:true,ids,reference:LOGISTICS_SOURCES.reference,readOnly:true};
 if(!['operations','formations','formationOverview','transport','schedule'].includes(kind))throw new Error('Fonte logística inválida.');
 // Consulta somente planilhas, usando as permissões que o módulo comercial já possui.
 return centralLogisticsRead_(user,p,kind,kind==='transport'?ids.indicators:ids.operations);
}

// Verificação manual de leitura das fontes, sem gravar nas planilhas.
function verificarFontesLogisticaRbn_(){const result={};for(const kind of ['operations','formations','transport','schedule']){try{const r=logisticsApi_({perfil:'ADMIN'},{kind});result[kind]={count:r.rows.length,updatedAt:r.meta.updatedAt,from:r.meta.from,to:r.meta.to,weight:r.rows.reduce((s,x)=>s+(x.weight||0),0),delivered:r.rows.filter(x=>x.delivered).length,invalidDates:r.rows.filter(x=>x.dateInvalid).length,...(kind==='transport'?{onTime:r.rows.filter(x=>x.onTime).length,late:r.rows.filter(x=>x.late).length}:{}),occurrences:r.rows.filter(x=>x.occurrence).length};}catch(e){result[kind]={error:e.message};}}try{const geo=logisticsApi_({perfil:'ADMIN'},{kind:'geo'});result.geo={features:geo.geo.features.length};}catch(e){result.geo={error:e.message};}console.log(JSON.stringify(result));return result;}


// Conecta as duas fontes solicitadas e valida a leitura sem alterar suas células.
function conectarBasesLogisticaRbn_() {
  const r=logisticsApi_({perfil:'ADMIN'},{action:'configure',operationsId:LOGISTICS_SOURCES.operations,indicatorsId:LOGISTICS_SOURCES.indicators});
  console.log(r.message);
  return verificarFontesLogisticaRbn_();
}


// ── 13. Acesso por área e edição do SAC ──
// Aplica o recorte de cada perfil e mantém as rotinas de edição do acompanhamento.

// Plataforma: autorização central por área, perfil e recorte.
function platformAccess_(record){
 const role=String(record.perfil||'RCA').toUpperCase(),all=['ADMIN','DIRETOR'].includes(role);
 const formationOnly=role===FORMATION_ROLE,transportOnly=['SAC','INTERNO'].includes(role);
 const areas=all?['commercial','logistics']:formationOnly||transportOnly?['logistics']:role==='RCA'?['commercial']:
  Array.isArray(record.areas)?record.areas.filter(a=>['commercial','logistics'].includes(a)):role==='GERENTE'?['commercial','logistics']:['commercial'];
 const s=record.logisticsScope||{},list=k=>Array.isArray(s[k])?s[k].map(String).filter(Boolean):[];
 const permissions=logisticsPermissions_(record,role,areas);
 return {areas,formationOnly,transportOnly,permissions,editTransport:permissions.sac.edit,
  logisticsScope:{carriers:list('carriers'),sellers:list('sellers'),regions:list('regions')}};
}

function publicUser_(login,r) {
  return Object.assign({login,nome:String(r.nome||login),perfil:String(r.perfil||'RCA').toUpperCase(),ativo:r.ativo===true,cod_rca:r.cod_rca==null?null:r.cod_rca,supervisor:String(r.supervisor||''),accessVersion:String(r.accessVersion||'')},platformAccess_(r));
}

function requireArea_(user,area){if(!user||!platformAccess_(user).areas.includes(area))throw new Error('Seu usuário não tem acesso a esta área.');}

function logisticsRowAllowed_(user,row,kind){
 const a=platformAccess_(user);if(!a.areas.includes('logistics'))return false;
 if(kind==='transport'&&!a.permissions.sac.view)return false;
 if(kind==='schedule')return a.permissions.agenda.view;
 if(kind==='formationOverview'){
  return a.formationOnly&&a.permissions.formation.view;
 }
 if(kind==='formationDirect'){
  if(!a.permissions.formation.view)return false;
 }else if((a.formationOnly||a.transportOnly)&&kind!=='transport')return false;
 if(['ADMIN','DIRETOR',FORMATION_ROLE].includes(user.perfil))return true;
 const s=a.logisticsScope;
 if(user.perfil==='SUPERVISOR'&&!s.carriers.length&&!s.sellers.length&&!s.regions.length)return false;
 return (!s.carriers.length||s.carriers.some(x=>logNorm_(x)===logNorm_(row.carrier)))&&(!s.sellers.length||s.sellers.some(x=>logNorm_(x)===logNorm_(row.seller)))&&(!s.regions.length||s.regions.some(x=>logNorm_(x)===logNorm_(row.region)));
}
const SAC_FIELDS=[['manualOccurrence','OCORRÊNCIA'],['category','CATEGORIA OCORRÊNCIA'],['responsible','RESPONSÁVEL OCORRÊNCIA'],['follow','FOLLOW UP / OCORRÊNCIA'],['checker','CONFERENTE'],['picker','SEPARADOR'],['cargoType','TIPO DE CARGA'],['notes','PROBLEMA / OBSERVAÇÃO']];

function transportEditLegacy_(user,p,id){
 if(!platformAccess_(user).editTransport)throw new Error('Somente o SAC autorizado pode preencher os campos manuais.');
 const sh=SpreadsheetApp.openById(id).getSheetByName('ACOMPANHAMENTO');if(!sh)throw new Error('Aba de acompanhamento ausente.');
 const key=String(p.key||'');if(!key||key.length>200)throw new Error('Identificador da nota inválido.');
 const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Outra gravação está em andamento. Tente novamente.');
 try{
  const identities=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),7).getDisplayValues();
  const hits=identities.flatMap((cells,i)=>transportRowKey_(cells)===key?[i+2]:[]);
  if(hits.length!==1)throw new Error('Nota ausente ou chave duplicada. Atualize a tela antes de editar.');
  const n=hits[0],head=sh.getRange(1,1,1,36).getDisplayValues()[0],raw=sh.getRange(n,1,1,36).getValues()[0],row=logRecords_([head,raw],'transport',sh.getParent().getSpreadsheetTimeZone(),[])[0];
  if(!row||!logisticsRowAllowed_(user,row,'transport'))throw new Error('Esta nota está fora do seu recorte de acesso.');
  const range=sh.getRange(n,28,1,8),values=range.getDisplayValues()[0],formulas=range.getFormulas()[0],rules=range.getDataValidations()[0];
  if(SAC_FIELDS.some((f,i)=>logNorm_(head[i+27])!==logNorm_(f[1])))throw new Error('A estrutura da planilha mudou. A gravação foi interrompida.');
  const version=digestHex_(JSON.stringify([key,raw[2],values]));
  const fields=SAC_FIELDS.map(([name,label],i)=>{const rule=rules[i];let options=null;
   if(rule){const type=String(rule.getCriteriaType()),args=rule.getCriteriaValues();if(type==='VALUE_IN_LIST')options=args[0].map(String);else if(type==='VALUE_IN_RANGE')options=args[0].getDisplayValues().flat().filter(Boolean);else throw new Error('Validação não suportada no campo '+label+'.');}
   return {name,label,value:values[i],options,readOnly:!!formulas[i]};});
  if(p.action==='editRead')return {ok:true,key,version,fields,invoice:row.invoice,client:row.client,carrier:row.carrier,record:row};
  if(p.action!=='editSave')throw new Error('Ação de edição inválida.');
  if(p.version!==version)throw new Error('A nota foi alterada na planilha. Feche e abra novamente para revisar os valores atuais.');
  const input=p.values;if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!SAC_FIELDS.some(f=>f[0]===k)))throw new Error('Campos de gravação inválidos.');
  const next=values.slice();fields.forEach((f,i)=>{if(!Object.prototype.hasOwnProperty.call(input,f.name))return;const v=String(input[f.name]??'').trim();if(v.length>2000)throw new Error('O campo '+f.label+' excede 2.000 caracteres.');if(v!==values[i]&&f.readOnly)throw new Error('O campo '+f.label+' contém fórmula e não pode ser editado.');if(v!==values[i]&&v&&f.options&&!f.options.includes(v))throw new Error('Escolha uma opção válida para '+f.label+'.');next[i]=v;});
  if(next.every((v,i)=>v===values[i]))return {ok:true,message:'Nenhuma alteração para salvar.'};
  if(transportRowKey_(sh.getRange(n,1,1,7).getDisplayValues()[0])!==key||digestHex_(JSON.stringify(range.getDisplayValues()[0]))!==digestHex_(JSON.stringify(values)))throw new Error('A planilha mudou durante a edição. Reabra a nota.');
  // Texto literal evita que entradas do usuário sejam interpretadas como fórmulas.
  const safe=next.map((v,i)=>formulas[i]||(/^[=+@-]/.test(v)?"'"+v:v));range.setValues([safe]);SpreadsheetApp.flush();
  const verified=range.getDisplayValues()[0];if(!next.every((v,i)=>formulas[i]||verified[i]===v))throw new Error('Revise a planilha: não foi possível confirmar todos os campos gravados.');
  const audit=rbnLoadState_('LOG_SAC_AUDIT')||[];audit.unshift({at:new Date().toISOString(),by:user.login,key,fields:fields.filter((f,i)=>next[i]!==values[i]).map(f=>f.name)});while(audit.length>100||JSON.stringify(audit).length>30000)audit.pop();rbnSaveState_('LOG_SAC_AUDIT',audit);
  const base='LOG_S8_'+digestHex_(id+'|transport').slice(0,24);CacheService.getScriptCache().remove(base+'_M');
  return {ok:true,message:'Campos salvos na planilha de transportadoras.',updatedAt:new Date().toISOString()};
 }finally{lock.releaseLock();}
}



// ── 14. Entradas dos acionadores de sincronização ──
// Valida os eventos dos acionadores instalados e encaminha a execução.

// As rotinas mantêm os nomes e acionadores já instalados. A chave do evento
// é validada no servidor e nunca é enviada para o navegador.
function requireInstalledClock_(event,handler){
 if(!event||String(event.authMode)!=='FULL'||typeof event.triggerUid!=='string'||!/^\d{10,30}$/.test(event.triggerUid))throw new Error('Execução reservada à rotina automática instalada.');
 const valid=ScriptApp.getProjectTriggers().some(t=>String(t.getUniqueId())===event.triggerUid&&t.getHandlerFunction()===handler&&String(t.getEventType())==='CLOCK');
 if(!valid)throw new Error('Rotina automática não autorizada.');
}

function sincronizarVendasRbn(event) {
  requireInstalledClock_(event,'sincronizarVendasRbn');
  formDirectPrepareAfterSync_(sincronizarVendasRbn_);
  return {ok:true};
}

function atualizarCacheVendasRbn(event) {
  requireInstalledClock_(event,'atualizarCacheVendasRbn');
  formProjectionRecover_();
  atualizarCacheVendasRbn_();
  return {ok:true};
}

function sincronizarMetasRbn(event) {
  requireInstalledClock_(event,'sincronizarMetasRbn');
  sincronizarMetasRbn_();
  return {ok:true};
}

function continuarAtualizacaoRbn(event) {
  requireInstalledClock_(event,'continuarAtualizacaoRbn');
  formDirectPrepareAfterSync_(continuarAtualizacaoRbn_);
  return {ok:true};
}

// ── 15. SAC em lote e datas de entrega ──
// Trata a consulta e a edição de notas, incluindo a conferência de alterações concorrentes.

// SAC: leitura e gravação em lote com o mesmo recorte da edição individual.
function transportBatchLegacy_(user,p,id){
 if(!platformAccess_(user).editTransport)throw new Error('Somente o SAC autorizado pode preencher os campos manuais.');
 if(p.kind!=='transport')throw new Error('Fonte de edição inválida.');
 if(!Array.isArray(p.keys)||!p.keys.length||p.keys.length>500||p.keys.some(k=>typeof k!=='string'||!k||k.length>200)||new Set(p.keys).size!==p.keys.length)throw new Error('Selecione de 1 a 500 notas distintas.');
 const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Outra gravação está em andamento. Tente novamente.');
 let wrote=false;
 try{
  const sh=SpreadsheetApp.openById(id).getSheetByName('ACOMPANHAMENTO');if(!sh)throw new Error('Aba de acompanhamento ausente.');
  const total=sh.getLastRow();if(total<2)throw new Error('Nenhuma nota disponível.');
  const grid=sh.getRange(1,1,total,36),raw=grid.getValues(),display=grid.getDisplayValues(),head=display[0],manual=sh.getRange(2,28,total-1,8),formulas=manual.getFormulas(),rules=manual.getDataValidations();
  if(SAC_FIELDS.some((f,i)=>logNorm_(head[i+27])!==logNorm_(f[1])))throw new Error('A estrutura da planilha mudou. Atualize a tela.');
  const indices=new Map();display.slice(1).forEach((r,i)=>{const key=transportRowKey_(r.slice(0,7));if(!indices.has(key))indices.set(key,[]);indices.get(key).push(i+1);});
  const items=p.keys.map(key=>{
   const hits=indices.get(key)||[];if(hits.length!==1)throw new Error('Nota ausente ou chave duplicada. Atualize a seleção.');
   const i=hits[0],record=logRecords_([raw[0],raw[i]],'transport',sh.getParent().getSpreadsheetTimeZone(),[])[0];
   if(!record||!logisticsRowAllowed_(user,record,'transport'))throw new Error('Uma nota está fora do seu recorte de acesso.');
   const values=display[i].slice(27,35),rowFormulas=formulas[i-1],fields=SAC_FIELDS.map(([name,label],j)=>{
    let options=null;const rule=rules[i-1][j];if(rule){const type=String(rule.getCriteriaType()),args=rule.getCriteriaValues();if(type==='VALUE_IN_LIST')options=args[0].map(String);else if(type==='VALUE_IN_RANGE')options=args[0].getDisplayValues().flat().filter(Boolean);else throw new Error('Validação não suportada no campo '+label+'.');}
    return {name,label,value:values[j],readOnly:!!rowFormulas[j],options};
   });
   const version=digestHex_(JSON.stringify([key,raw[i][2],values,rowFormulas,fields.map(f=>f.options)]));
   return {key,version,invoice:record.invoice,client:record.client,n:i+1,values,formulas:rowFormulas,fields};
  });
  if(p.action==='batchRead')return {ok:true,items:items.map(x=>({key:x.key,version:x.version,invoice:x.invoice,client:x.client})),fields:SAC_FIELDS.map(([name,label],j)=>{
   const fs=items.map(x=>x.fields[j]),restricted=fs.filter(f=>f.options!==null);return {name,label,readOnly:fs.some(f=>f.readOnly),filled:fs.filter(f=>String(f.value||'').trim()).length,options:restricted.length?[...new Set(restricted[0].options)].filter(v=>restricted.every(f=>f.options.includes(v))):null};
  })};
  if(p.action!=='batchSave')throw new Error('Ação de edição inválida.');
  const changes=p.changes;if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>!SAC_FIELDS.some(f=>f[0]===k)))throw new Error('Campos de gravação inválidos.');
  if(!p.versions||typeof p.versions!=='object'||Array.isArray(p.versions))throw new Error('Reabra o lote para conferir os valores atuais.');
  const clean={};Object.entries(changes).forEach(([name,c])=>{if(!c||typeof c!=='object'||typeof c.value!=='string'||!c.value.trim()||c.value.trim().length>2000||!['replace',...(name==='follow'?['append']:[])].includes(c.mode))throw new Error('Preencha corretamente os campos marcados.');clean[name]={value:c.value.trim(),mode:c.mode};});
  items.forEach(x=>{
   if(p.versions[x.key]!==x.version)throw new Error('Uma nota foi alterada na planilha. Reabra o lote antes de salvar.');
   x.next=x.values.slice();x.changed=[];x.fields.forEach((f,j)=>{const c=clean[f.name];if(!c)return;if(f.readOnly)throw new Error('O campo '+f.label+' contém fórmula em uma nota.');const v=c.mode==='append'&&x.values[j]?x.values[j]+'\n'+c.value:c.value;if(v.length>2000)throw new Error('O campo '+f.label+' excede 2.000 caracteres após o preenchimento.');if(f.options&&!f.options.includes(v))throw new Error('Escolha uma opção válida para '+f.label+'.');x.next[j]=v;if(v!==x.values[j])x.changed.push(j);});
  });
  let updated=0,unchanged=0;const failed=[],auditRows=[];
  for(const x of items){
   if(!x.changed.length){unchanged++;continue;}
   try{
    const current=sh.getRange(x.n,1,1,36),now=current.getDisplayValues()[0],nowFormulas=sh.getRange(x.n,28,1,8).getFormulas()[0];
    if(transportRowKey_(now.slice(0,7))!==x.key||JSON.stringify(now.slice(27,35))!==JSON.stringify(x.values)||JSON.stringify(nowFormulas)!==JSON.stringify(x.formulas))throw new Error('Nota alterada durante o salvamento.');
    for(const j of x.changed){wrote=true;const v=x.next[j];sh.getRange(x.n,28+j).setValue(/^[=+@-]/.test(v)?"'"+v:v);}
    SpreadsheetApp.flush();const verified=sh.getRange(x.n,28,1,8).getDisplayValues()[0];if(!x.changed.every(j=>verified[j]===x.next[j]))throw new Error('Gravação não confirmada.');
    updated++;auditRows.push({at:new Date().toISOString(),by:user.login,key:x.key,fields:x.changed.map(j=>SAC_FIELDS[j][0]),batch:true});
   }catch(err){failed.push({key:x.key,invoice:x.invoice});}
  }
  let auditWarning=false;if(auditRows.length)try{const audit=auditRows.concat(rbnLoadState_('LOG_SAC_AUDIT')||[]);while(audit.length>100||JSON.stringify(audit).length>30000)audit.pop();rbnSaveState_('LOG_SAC_AUDIT',audit);}catch(err){auditWarning=true;}
  return {ok:true,updated,unchanged,failed,partial:failed.length>0,auditWarning};
 }finally{if(wrote)try{CacheService.getScriptCache().remove('LOG_S8_'+digestHex_(id+'|transport').slice(0,24)+'_M');}catch(err){}lock.releaseLock();}
}


// Data de entrega: mesma autorização SAC, identidade estável e conflito otimista.
function deliveryFields_() {
  return [['deliveredDate','DATA ENTREGA']].concat(SAC_FIELDS);
}

function deliveryDate_(value,tz){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value)||logDate_(value,tz)!==value)throw new Error('Informe uma data de entrega válida.');
 const today=Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
 if(value>today)throw new Error('A data de entrega não pode estar no futuro.');
 // Grava a data civil como número do Sheets, compatível com células já formatadas.
 return sacImportDateSerial_(value,tz);
}

function deliveryRule_(rule,value,tz){
 if(!rule)return;
 const type=String(rule.getCriteriaType()),args=rule.getCriteriaValues(),d=logDate_(value,tz),a=logDate_(args[0],tz),b=logDate_(args[1],tz);
 const allowed={DATE_IS_VALID_DATE:()=>!!d,DATE_AFTER:()=>d>a,DATE_BEFORE:()=>d<a,DATE_EQUAL_TO:()=>d===a,DATE_ON_OR_AFTER:()=>d>=a,DATE_ON_OR_BEFORE:()=>d<=a,DATE_BETWEEN:()=>d>=a&&d<=b,DATE_NOT_BETWEEN:()=>d<a||d>b};
 if(!allowed[type]||!allowed[type]())throw new Error('A data não atende à validação da planilha. Revise a nota na origem.');
}

function deliveryRead_(sh,key,headers,identities,user,snapshot){
 const hits=identities.flatMap((r,i)=>transportRowKey_(r.slice(0,7))===key?[i+2]:[]);
 if(hits.length!==1)throw new Error('Nota ausente ou chave duplicada. Atualize a seleção.');
 const n=hits[0],width=headers.length,range=snapshot?null:sh.getRange(n,1,1,width),raw=snapshot?snapshot.raw[n-1]:range.getValues()[0],display=snapshot?snapshot.display[n-1]:range.getDisplayValues()[0],formulas=snapshot?snapshot.formulas[n-1]:range.getFormulas()[0],rules=snapshot?snapshot.rules[n-1]:range.getDataValidations()[0],tz=sh.getParent().getSpreadsheetTimeZone();
 const record=logRecords_([headers,raw],'transport',tz,[])[0];
 if(!record||transportRowKey_(display.slice(0,7))!==key||!logisticsRowAllowed_(user,record,'transport'))throw new Error('Esta nota mudou ou está fora do seu recorte de acesso.');
 const fields=deliveryFields_().map(([name,label])=>{
  const columns=headers.flatMap((h,i)=>logNorm_(h)===logNorm_(label)?[i]:[]);
  if(columns.length!==1)throw new Error('Coluna ausente ou duplicada: '+label+'.');
  const col=columns[0],rule=rules[col];let options=null;
  if(rule&&name!=='deliveredDate'){const type=String(rule.getCriteriaType()),args=rule.getCriteriaValues();if(type==='VALUE_IN_LIST')options=args[0].map(String);else if(type==='VALUE_IN_RANGE')options=args[0].getDisplayValues().flat().filter(Boolean);else throw new Error('Validação não suportada no campo '+label+'.');}
  const value=name==='deliveredDate'?logDate_(raw[col],tz):display[col];
  return {name,label,value,options,readOnly:!!formulas[col],type:name==='deliveredDate'?'date':'text',col,rule};
 });
 // Inclui valores, fórmulas, regras e identidade: mudanças externas invalidam o formulário.
 const version=digestHex_(JSON.stringify([key,display.slice(0,7),raw,formulas,fields.map(f=>[f.col,f.rule?String(f.rule.getCriteriaType()):'',f.rule?f.rule.getCriteriaValues().map(v=>v&&typeof v.getA1Notation==='function'?v.getSheet().getSheetId()+':'+v.getA1Notation():v):null,f.options])]));
 return {key,n,version,raw,display,formulas,fields,record,tz};
}

function deliveryPublic_(f) {
  return {name:f.name,label:f.label,value:f.value,options:f.options,readOnly:f.readOnly,type:f.type};
}

function deliveryAudit_(user,rows){
 if(!rows.length)return false;
 try{const audit=rows.map(x=>({at:new Date().toISOString(),by:user.login,key:x.key,fields:x.changed.map(f=>f.name),batch:rows.length>1})).concat(rbnLoadState_('LOG_SAC_AUDIT')||[]);while(audit.length>100||JSON.stringify(audit).length>30000)audit.pop();rbnSaveState_('LOG_SAC_AUDIT',audit);return false;}catch(err){return true;}
}

function deliveryApi_(user,p,id,batch){
 if(!platformAccess_(user).editTransport)throw new Error('Somente o SAC autorizado pode preencher os campos manuais.');
 if(p.kind!=='transport')throw new Error('Fonte de edição inválida.');
 const keys=batch?p.keys:[p.key],read=p.action===(batch?'batchRead':'editRead');
 if(![batch?'batchRead':'editRead',batch?'batchSave':'editSave'].includes(p.action))throw new Error('Ação inválida.');
 if(!Array.isArray(keys)||!keys.length||keys.length>500||keys.some(k=>typeof k!=='string'||!k||k.length>200)||new Set(keys).size!==keys.length)throw new Error('Selecione de 1 a 500 notas distintas.');
 const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Outra gravação está em andamento. Tente novamente.');
 let wrote=false;const started=Date.now();
 try{
  const sh=SpreadsheetApp.openById(id).getSheetByName('ACOMPANHAMENTO');if(!sh||sh.getLastRow()<2)throw new Error('Acompanhamento sem notas.');
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  if(['CHAVE','NF','TRANSPORTADORA','CLIENTE','CNPJ/CPF','CIDADE','UF'].some((h,i)=>logNorm_(headers[i])!==h))throw new Error('A estrutura de identificação da planilha mudou.');
  let snapshot=null;if(batch){const grid=sh.getRange(1,1,sh.getLastRow(),headers.length);snapshot={raw:grid.getValues(),display:grid.getDisplayValues(),formulas:grid.getFormulas(),rules:grid.getDataValidations()};}
  const identities=snapshot?snapshot.display.slice(1).map(r=>r.slice(0,7)):sh.getRange(2,1,sh.getLastRow()-1,7).getDisplayValues(),items=keys.map(key=>{if(Date.now()-started>120000)throw new Error('Reduza a quantidade de notas do lote e tente novamente. Nenhuma gravação foi iniciada.');return deliveryRead_(sh,key,headers,identities,user,snapshot);});
  if(read){
   if(!batch){const x=items[0];return {ok:true,key:x.key,version:x.version,fields:x.fields.map(deliveryPublic_),invoice:x.record.invoice,client:x.record.client,carrier:x.record.carrier,record:x.record};}
   return {ok:true,items:items.map(x=>({key:x.key,version:x.version,invoice:x.record.invoice,client:x.record.client})),fields:items[0].fields.map((f,j)=>{const fs=items.map(x=>x.fields[j]),restricted=fs.filter(f=>f.options!==null);return {...deliveryPublic_(f),value:'',readOnly:fs.some(f=>f.readOnly),filled:fs.filter(f=>f.value).length,options:restricted.length?[...new Set(restricted[0].options)].filter(v=>restricted.every(f=>f.options.includes(v))):null};})};
  }
  const input=batch?p.changes:p.values,validNames=deliveryFields_().map(f=>f[0]);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!validNames.includes(k))||batch&&!Object.keys(input).length)throw new Error('Campos de gravação inválidos.');
  if(batch&&(!p.versions||typeof p.versions!=='object'||Array.isArray(p.versions)))throw new Error('Reabra o lote para conferir os valores atuais.');
  items.forEach(x=>{
   if((batch?p.versions[x.key]:p.version)!==x.version)throw new Error('Uma nota foi alterada na planilha. Reabra o formulário para revisar os valores atuais.');
   x.changed=[];
   x.fields.forEach(f=>{
    if(!Object.prototype.hasOwnProperty.call(input,f.name))return;
    const c=batch?input[f.name]:{value:input[f.name],mode:'replace'};
    if(!c||typeof c.value!=='string'||!['replace',...(f.name==='follow'?['append']:[])].includes(c.mode))throw new Error('Preenchimento inválido: '+f.label+'.');
    const text=c.value.trim();if(batch&&!text)throw new Error('Preencha os campos marcados.');
    const v=c.mode==='append'&&f.value?f.value+'\n'+text:text;
    if(v===f.value)return;
    if(f.readOnly)throw new Error('O campo '+f.label+' contém fórmula e não pode ser editado.');
    if(v.length>2000||v&&f.options&&!f.options.includes(v))throw new Error('Valor inválido: '+f.label+'.');
    let value=v;
    if(f.type==='date'){value=deliveryDate_(v,x.tz);deliveryRule_(f.rule,value,x.tz);const baseline=x.record.collected||x.record.issued;if(baseline&&v<baseline)throw new Error('A entrega não pode ser anterior à coleta ou emissão da nota.');}
    else if(/^[=+@-]/.test(value))value="'"+value;
    x.changed.push({...f,next:v,write:value});
   });
  });
  const changed=[],failed=[];let unchanged=0;
  for(const x of items){
   if(!x.changed.length){unchanged++;continue;}
   if(Date.now()-started>220000){failed.push({key:x.key,invoice:x.record.invoice});continue;}
   try{
    const nowHeaders=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];if(JSON.stringify(headers)!==JSON.stringify(nowHeaders))throw new Error('Cabeçalhos alterados.');
    const nowIds=sh.getRange(2,1,sh.getLastRow()-1,7).getDisplayValues(),now=deliveryRead_(sh,x.key,nowHeaders,nowIds,user);
    if(now.n!==x.n||now.version!==x.version)throw new Error('Nota alterada durante o salvamento.');
    // Somente células explicitamente alteradas são gravadas; follow-ups e fórmulas permanecem intactos.
    for(const f of x.changed){wrote=true;sh.getRange(x.n,f.col+1).setValue(f.write);}
    SpreadsheetApp.flush();
    const verify=sh.getRange(x.n,1,1,headers.length),raw=verify.getValues()[0],display=verify.getDisplayValues()[0];
    if(transportRowKey_(display.slice(0,7))!==x.key||!x.changed.every(f=>f.type==='date'?logDate_(raw[f.col],x.tz)===f.next:display[f.col]===f.next))throw new Error('Gravação não confirmada.');
    changed.push(x);
   }catch(err){failed.push({key:x.key,invoice:x.record.invoice});if(!batch)throw new Error('Não foi possível confirmar a gravação. Feche e reabra a nota para conferir a planilha antes de repetir.');}
  }
  const auditWarning=deliveryAudit_(user,changed);
  return batch?{ok:true,updated:changed.length,unchanged,failed,partial:!!failed.length,auditWarning}:{ok:true,message:changed.length?'Dados e data de entrega salvos na planilha. Indicadores atualizados.':'Nenhuma alteração para salvar.',auditWarning,updatedAt:new Date().toISOString()};
 }finally{if(wrote)try{CacheService.getScriptCache().remove('LOG_S8_'+digestHex_(id+'|transport').slice(0,24)+'_M');}catch(err){}lock.releaseLock();}
}

function transportEdit_(user,p,id) {
  return centralTransportEdit_(user,p,id,false);
}

function transportBatch_(user,p,id) {
  return centralTransportEdit_(user,p,id,true);
}


// ── 16. Histórico auxiliar da Formação de Carga ──
// Registra eventos da montagem na planilha auxiliar e recompõe o estado a partir desse histórico.

// Experimental: todas as gravações ficam em uma planilha auxiliar independente.
const FORM_EXP_SCHEMA={MONTAGENS:['ID','NOME','CRIADO_EM','RESPONSAVEL','STATUS'],MONTAGEM_PEDIDOS:['MONTAGEM_ID','PEDIDO','PEDIDO_ID','INCLUIDO_EM','USUARIO'],VINCULOS_FONTES:['PEDIDO_ID','FONTE_ID','CONFIRMADO_EM','USUARIO'],HISTORICO_MOVIMENTACOES:['EVENTO_ID','REVISAO','DATA_HORA','USUARIO','TIPO','PEDIDOS_JSON','ORIGEM_JSON','DESTINO','DADOS_JSON']};

function formExpAccess_(user,mode='view') {
  requireLogPermission_(user,'formation',mode);
}

function formExpAux_(journalOnly=false){
 const p=PropertiesService.getScriptProperties(),id=p.getProperty('FORM_EXP_AUX_ID');if(!id)throw new Error('A base auxiliar experimental ainda não foi inicializada.');
 const forbidden=[CFG.salesSpreadsheetId,CFG.auxiliarySpreadsheetId,CFG.cacheSpreadsheetId,p.getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,p.getProperty('LOG_INDICATORS_ID')||LOGISTICS_SOURCES.indicators];
 if(forbidden.includes(id))throw new Error('A base auxiliar não pode ser uma das planilhas originais.');
 const ss=SpreadsheetApp.openById(id);(journalOnly?['HISTORICO_MOVIMENTACOES']:Object.keys(FORM_EXP_SCHEMA)).forEach(name=>{const sh=ss.getSheetByName(name);if(!sh||JSON.stringify(sh.getRange(1,1,1,FORM_EXP_SCHEMA[name].length).getDisplayValues()[0])!==JSON.stringify(FORM_EXP_SCHEMA[name]))throw new Error('Estrutura auxiliar divergente: '+name);});return ss;
}

function formExpInitialize_(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Outra rotina está em andamento.');
 try{const p=PropertiesService.getScriptProperties();if(p.getProperty('FORM_EXP_AUX_ID'))return {id:formExpAux_().getId(),existing:true};const ss=SpreadsheetApp.create('Central Rebanho — Formação Experimental — TESTE');const first=ss.getSheets()[0];let index=0;for(const [name,headers]of Object.entries(FORM_EXP_SCHEMA)){const sh=index++===0?first.setName(name):ss.insertSheet(name);sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);sh.getRange(1,1,1,headers.length).setBackground('#a95018').setFontColor('#ffffff').setFontWeight('bold');sh.autoResizeColumns(1,headers.length);}ss.setSpreadsheetTimeZone('America/Fortaleza');p.setProperty('FORM_EXP_AUX_ID',ss.getId());return {id:ss.getId(),existing:false};}finally{lock.releaseLock();}
}

function formExpEmpty_() {
  return {revision:0,montages:{},links:{},assignments:{},last:{},events:[],requests:{},sequence:0};
}

function formExpReplay_(rows){
 const st=formExpEmpty_();for(const row of rows){if(!row[0])continue;const e={id:String(row[0]),revision:Number(row[1]),at:String(row[2]),by:String(row[3]),type:String(row[4]),keys:JSON.parse(row[5]||'[]'),from:JSON.parse(row[6]||'{}'),to:String(row[7]||''),data:JSON.parse(row[8]||'{}')};if(e.revision!==st.revision+1||st.requests[e.id])throw new Error('Histórico auxiliar inconsistente. Nenhuma movimentação foi aplicada.');formExpApply_(st,e);st.events.push(e);st.requests[e.id]=true;st.revision=e.revision;}return st;
}

const FORM_FLEET_SETTINGS = ['VEICULO_SALVAR','MOTORISTA_SALVAR','UNIDADE_SALVAR','ROTEIRIZACAO_CONFIGURAR'];

function formExpApply_(st,e){
 if(e.type==='INICIAR_OPERACAO_REAL'){
  Object.assign(st,{montages:{},links:{},assignments:{},last:{},sequence:0});
  st.events=st.events.filter(event=>FORM_FLEET_SETTINGS.includes(event.type));
  return;
 }
 if(e.type==='CRIAR'){if(st.montages[e.to])throw new Error('Montagem duplicada.');st.sequence++;st.montages[e.to]={id:e.to,name:e.data.name,createdAt:e.at,owner:e.by,status:'Em montagem'};}
 if(e.type==='RENOMEAR'){if(!st.montages[e.to])throw new Error('Montagem inexistente.');st.montages[e.to].name=e.data.name;}
 if(e.type==='VINCULAR'){for(const key of e.keys){st.links[key]={sourceKeys:e.data.sourceKeys.slice(),at:e.at,by:e.by};}}
 if(['CRIAR','ADICIONAR','TRANSFERIR','REMOVER'].includes(e.type))for(const key of e.keys){if(e.type==='REMOVER')delete st.assignments[key];else st.assignments[key]={montageId:e.to,at:e.at,by:e.by};st.last[key]={type:e.type,at:e.at,by:e.by};}
}

function formExpState_(ss) {
  const sh=ss.getSheetByName('HISTORICO_MOVIMENTACOES'),n=sh.getLastRow();
  return formFleetHydrate_(formExpReplay_(n>1?sh.getRange(2,1,n-1,9).getValues():[]));
}

function formExpSources_(user){
 const id=PropertiesService.getScriptProperties().getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,ss=SpreadsheetApp.openById(id),sh=ss.getSheetByName('FORMAÇÃO 2026');if(!sh)throw new Error('Aba FORMAÇÃO 2026 ausente.');
 const values=sh.getRange(1,1,Math.max(2,sh.getLastRow()),23).getValues(),regions=ss.getSheetByName('CADASTRO REGIAO').getDataRange().getValues(),records=logRecords_(values,'operations',ss.getSpreadsheetTimeZone(),regions),counts={},all={};
 for(const r of records){const key='fs_'+digestHex_(JSON.stringify([r.date,logNorm_(r.client),logNorm_(r.seller),logNorm_(r.cityLabel),logNorm_(r.loading),logNorm_(r.product)])).slice(0,40);r.sourceKey=key;r.sourceVersion=digestHex_(JSON.stringify(r)).slice(0,24);counts[key]=(counts[key]||0)+1;all[key]=r;}
 for(const r of records)r.ambiguous=counts[r.sourceKey]!==1;
 return {all,records,visible:records.filter(r=>logisticsRowAllowed_(user,r,'operations')),id};
}

function formExpOrderKey_(year,client,order) {
  return 'ord_'+year+'_'+client+'_'+order;
}

function formExpParseKey_(key){const m=String(key||'').match(/^ord_(20\d{2})_(\d+)_(\d{1,20})$/);if(!m)throw new Error('Identificador de pedido inválido.');return {year:m[1],client:m[2],order:m[3]};}

function formExpCommercial_(keys,force){
 const out={},cache=CacheService.getScriptCache(),pending=[];for(const key of [...new Set(keys)]){formExpParseKey_(key);let saved=force?null:cache.get('FORM_EXP_ORDER_'+digestHex_(key).slice(0,24));if(saved){try{out[key]=JSON.parse(saved);continue;}catch(e){}}pending.push(key);}
 if(!pending.length)return out;const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),byYear={};pending.forEach(key=>{const p=formExpParseKey_(key);(byYear[p.year]||(byYear[p.year]=[])).push({key,...p});});
 for(const [year,wanted]of Object.entries(byYear)){const sh=ss.getSheetByName(year);if(!sh)continue;const count=sh.getLastRow()-1;if(count<1)continue;const headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0],ix=headerIndex_(headers);for(const name of ['NUMPED','Cod/Cliente','Cod/Produto','Qt Pedida','Posição','Data Pedido'])if(ix[name]==null)throw new Error('Coluna comercial ausente: '+name);
  if(ix['NUMPED']!==ix['Cod/Cliente']+1)throw new Error('A estrutura de identificação comercial mudou.');const identities=sh.getRange(2,ix['Cod/Cliente']+1,count,2).getValues(),targets=new Map(wanted.map(p=>[p.order+'|'+p.client,p.key])),matches=[];
  identities.forEach((r,i)=>{const key=targets.get(String(r[1]).trim()+'|'+String(code_(r[0])));if(key)matches.push({row:i+2,key});});
  // Lê blocos próximos de uma vez; as fontes originais nunca são gravadas.
  const blocks=[];for(const m of matches){const last=blocks[blocks.length-1];if(last&&m.row-last.end<8)last.end=m.row;else blocks.push({start:m.row,end:m.row});}
  const rowKeys=new Map(matches.map(m=>[m.row,m.key]));for(const b of blocks){const raw=sh.getRange(b.start,1,b.end-b.start+1,headers.length).getValues();raw.forEach((r,j)=>{const key=rowKeys.get(b.start+j);if(!key)return;const status=norm_(cell_(r,ix,'Posição'));if(!['FECHADO','PENDENTE','LIBERADO','BLOQUEADO'].includes(status))return;let o=out[key];const rawClient=String(cell_(r,ix,'Cod/Cliente')||''),clientCode=String(code_(rawClient)),order=String(cell_(r,ix,'NUMPED')||''),date=logDate_(cell_(r,ix,'Data inicial do pedido')||cell_(r,ix,'Data Pedido'),ss.getSpreadsheetTimeZone());if(!o)o=out[key]={key,order,clientCode,client:rawClient.replace(/^\s*\d+\s*-\s*/,''),city:logText_(cell_(r,ix,'MUNICENT')),uf:logText_(cell_(r,ix,'ESTENT')),date,year,rca:code_(cell_(r,ix,'Cod/Vend.')),products:[],statuses:[],invoices:[]};
   o.rcas=o.rcas||[];o.rcas.push(code_(cell_(r,ix,'Cod/Vend.')));const product=String(cell_(r,ix,'Cod/Produto')||''),quantity=logNumber_(cell_(r,ix,'Qt Pedida'));o.products.push({code:code_(product),description:product.replace(/^\s*\d+\s*-\s*/,''),quantity,value:logNumber_(cell_(r,ix,'Pedidos Enviados')),supplier:logText_(cell_(r,ix,'Cod/Fornecedor')),department:logText_(cell_(r,ix,'DEPARTAMENTO')),section:logText_(cell_(r,ix,'SECAO')),invoice:logText_(cell_(r,ix,'Numero Nota Fiscal')),billingDate:logDate_(cell_(r,ix,'Data Faturamento'),ss.getSpreadsheetTimeZone()),orderDate:logDate_(cell_(r,ix,'Data Pedido'),ss.getSpreadsheetTimeZone()),status});o.statuses.push(status);if(cell_(r,ix,'Numero Nota Fiscal'))o.invoices.push(String(cell_(r,ix,'Numero Nota Fiscal')));
  });}
 }
 for(const key of pending){const o=out[key];if(!o)continue;o.rcas=[...new Set(o.rcas||[o.rca])];o.statuses=[...new Set(o.statuses)];o.invoices=[...new Set(o.invoices)];o.version=digestHex_(JSON.stringify(o)).slice(0,24);try{const s=JSON.stringify(o);if(s.length<85000)cache.put('FORM_EXP_ORDER_'+digestHex_(key).slice(0,24),s,120);}catch(e){}}
 return out;
}

function formExpClientKeys_(query,sourceRows){
 const tokens=logNorm_(query).split(/\s+/).filter(t=>t.length>1&&!['DE','DA','DO','DAS','DOS','LTDA'].includes(t));if(!tokens.length)throw new Error('Informe um nome de cliente mais específico.');
 const years=new Set(sourceRows.flatMap(r=>r.date?[r.date.slice(0,4),String(Number(r.date.slice(0,4))-1)]:[])),ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),found=new Map(),references=sourceRows.map(r=>Date.parse(r.date)).filter(Number.isFinite);
 for(const year of CFG.years.filter(y=>years.has(y))){const sh=ss.getSheetByName(year);if(!sh||sh.getLastRow()<2)continue;const count=sh.getLastRow()-1,identities=sh.getRange(2,8,count,2).getValues();let dates=null;
  identities.forEach((r,i)=>{if(!tokens.every(t=>logNorm_(r[0]).includes(t)))return;const code=code_(r[0]),number=String(r[1]||'');if(code==null||!/^\d{1,20}$/.test(number))return;if(!dates)dates=sh.getRange(2,16,count,1).getValues();const day=logDate_(dates[i][0],ss.getSpreadsheetTimeZone()),stamp=Date.parse(day),rank=references.length&&Number.isFinite(stamp)?Math.min(...references.map(ref=>Math.abs(stamp-ref))):Number.MAX_SAFE_INTEGER,key=formExpOrderKey_(year,String(code),number);if(!found.has(key)||found.get(key)>rank)found.set(key,rank);});
 }
 return [...found].sort((a,b)=>a[1]-b[1]).slice(0,30).map(x=>x[0]);
}

function formExpLookup_(number,user,sourceKeys,sources,clientSearch){
 const exact=/^\d{1,20}$/.test(String(number||''));if(!exact&&logNorm_(clientSearch).length<5)throw new Error('Informe o número do pedido ou um nome de cliente com pelo menos 5 caracteres.');if(!Array.isArray(sourceKeys)||!sourceKeys.length||sourceKeys.length>50)throw new Error('Selecione os registros de formação que deseja vincular.');
 for(const key of sourceKeys){const r=sources.all[key];if(!r||r.ambiguous||!r.awaitingFormation||!logisticsRowAllowed_(user,r,'operations'))throw new Error('Registro de formação indisponível ou fora do seu recorte.');}
 if(!exact)return Object.values(formExpCommercial_(formExpClientKeys_(clientSearch,sourceKeys.map(k=>sources.all[k])),true)).filter(o=>(o.rcas||[o.rca]).every(rca=>userAllowsRca_(user,rca)));
 const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),keys=[];for(const year of CFG.years){const sh=ss.getSheetByName(year);if(!sh||sh.getLastRow()<2)continue;const cells=sh.getRange(2,9,sh.getLastRow()-1,1).createTextFinder(String(number)).matchEntireCell(true).useRegularExpression(false).findAll();if(cells.length>500)throw new Error('O pedido tem muitos itens; revise sua identificação.');for(const c of cells){const customer=sh.getRange(c.getRow(),8).getDisplayValue(),code=code_(customer);if(code!=null)keys.push(formExpOrderKey_(year,String(code),String(number)));}}
 return Object.values(formExpCommercial_([...new Set(keys)],true)).filter(o=>(o.rcas||[o.rca]).every(rca=>userAllowsRca_(user,rca)));
}

function formExpView_(st,sources,commercial,user){
 const allowedSources=new Set(sources.visible.filter(r=>!r.ambiguous).map(r=>r.sourceKey)),orders=[],byKey={},sourceOwners={};
 for(const [key,link]of Object.entries(st.links)){for(const k of link.sourceKeys){if(sourceOwners[k]&&sourceOwners[k]!==key)throw new Error('Vínculo auxiliar duplicado.');sourceOwners[k]=key;}const raw=link.sourceKeys.map(k=>sources.all[k]),o=commercial[key];
  if(raw.some(r=>r&&!logisticsRowAllowed_(user,r,'operations'))||o&&!(o.rcas||[o.rca]).every(rca=>userAllowsRca_(user,rca)))continue;
  // Links órfãos só são visíveis ao criador ou à gestão; não liberam reservas automaticamente.
  if(raw.some(r=>!r)&&!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)&&link.by!==user.login)continue;
  const missing=raw.some(r=>!r||r.ambiguous)||!o,changed=missing||raw.some(r=>!r.awaitingFormation),assignment=st.assignments[key],montageId=assignment&&assignment.montageId||'',last=st.last[key];
  const order=Object.assign({},o||{key,order:formExpParseKey_(key).order,client:'Fonte indisponível',clientCode:formExpParseKey_(key).client,products:[]},{commercialCity:o&&o.city||'',commercialUf:o&&o.uf||'',city:[...new Set(raw.filter(Boolean).map(r=>r.city))].join(' / '),uf:[...new Set(raw.filter(Boolean).map(r=>r.uf).filter(Boolean))].join(' / '),sourceRows:raw.filter(Boolean),sourceKeys:link.sourceKeys,sourceIssue:missing?'Fonte ausente ou identificação duplicada':changed?'Status original alterado':'',blocked:changed,weight:missing?null:raw.reduce((s,r)=>s+(r.weight||0),0),volumes:missing||raw.some(r=>r.volumes==null)?null:raw.reduce((s,r)=>s+r.volumes,0),weightIncomplete:missing||raw.some(r=>r.weight==null),montageId,internalStatus:montageId?'Em montagem':last&&last.type==='REMOVER'?'Removido da montagem':'Disponível',originalStatuses:[...new Set(raw.filter(Boolean).map(r=>r.status))],region:raw[0]&&raw[0].region||'',sourceDate:raw[0]&&raw[0].date||'',linkBy:link.by});orders.push(order);byKey[key]=order;
 }
 const montages=[];for(const m of Object.values(st.montages)){const keys=Object.keys(st.assignments).filter(k=>st.assignments[k].montageId===m.id);if(keys.some(k=>!byKey[k]))continue;if(!keys.length&&!formWideScope_(user)&&m.owner!==user.login)continue;const members=keys.map(k=>byKey[k]),incomplete=members.some(o=>o.weightIncomplete||o.weight==null),volumeIncomplete=members.some(o=>o.volumes==null);montages.push({...m,orderKeys:keys,orders:members.length,clients:new Set(members.map(o=>o.clientCode)).size,cities:new Set(members.flatMap(o=>o.sourceRows.map(r=>r.city+'|'+r.uf))).size,weight:incomplete?null:members.reduce((s,o)=>s+o.weight,0),volumes:volumeIncomplete?null:members.reduce((s,o)=>s+o.volumes,0),sourceIssues:members.filter(o=>o.blocked).length});}
 const visibleMontages=new Set(montages.map(m=>m.id)),mapRows=sources.visible.map(r=>{const owner=sourceOwners[r.sourceKey],reserved=owner&&!!st.assignments[owner],montage=reserved?st.assignments[owner].montageId:'';return {...r,availableWeight:r.awaitingFormation&&!reserved?(r.weight||0):0,mountedWeight:r.awaitingFormation&&reserved?(r.weight||0):0,orderKey:byKey[owner]?owner:'',montageId:visibleMontages.has(montage)?montage:'',linked:!!owner};});
 const visibleOrders=new Set(orders.map(o=>o.key)),events=st.events.slice().reverse().filter(e=>e.keys.length?e.keys.every(k=>visibleOrders.has(k)):montages.some(m=>m.id===e.to)).slice(0,200).map(e=>({id:e.id,at:e.at,by:e.by,type:e.type,keys:e.keys,from:e.from,to:e.to,name:e.data.name||''}));
 return {orders,montages,mapRows,events,sequence:st.sequence,revision:st.revision,sourceVersion:digestHex_(JSON.stringify([sources.records.map(r=>[r.sourceKey,r.sourceVersion,r.ambiguous]),Object.keys(commercial).sort().map(k=>[k,commercial[k].version])])).slice(0,32)};
}

function formExpValidateMove_(st,view,p){
 const actions=['CRIAR','ADICIONAR','TRANSFERIR','REMOVER','RENOMEAR','VINCULAR'];if(!actions.includes(p.operation))throw new Error('Operação de montagem inválida.');if(Number(p.revision)!==st.revision||p.sourceVersion!==view.sourceVersion)throw new Error('As montagens ou as fontes foram atualizadas. Recarregue antes de confirmar.');
 const keys=p.keys||[];if(!Array.isArray(keys)||keys.length>100||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'))throw new Error('Selecione até 100 pedidos distintos.');
 const canonical=keys.map(key=>{const x=formExpParseKey_(key);return x.client+'|'+x.order;});if(new Set(canonical).size!==canonical.length)throw new Error('O mesmo pedido aparece em mais de um ano. Confirme sua identificação antes de selecionar.');
 const visible=new Map(view.orders.map(o=>[o.key,o])),montages=new Map(view.montages.map(m=>[m.id,m]));
 if(['ADICIONAR','TRANSFERIR','RENOMEAR'].includes(p.operation)&&!montages.has(String(p.target||'')))throw new Error('Montagem de destino não disponível no seu recorte.');
 if(['TRANSFERIR','REMOVER'].includes(p.operation)&&p.confirmed!==true)throw new Error('Confirme a remoção ou transferência dos pedidos.');
 if(['ADICIONAR','TRANSFERIR','REMOVER'].includes(p.operation)&&!keys.length)throw new Error('Selecione os pedidos.');
 for(const key of keys){const o=visible.get(key);if(!o||o.blocked)throw new Error('Um pedido está fora do seu recorte, sem fonte válida ou já saiu para entrega.');const a=st.assignments[key],identity=formExpParseKey_(key),alreadyReserved=Object.keys(st.assignments).some(k=>{const other=formExpParseKey_(k);return other.order===identity.order&&other.client===identity.client;});if(['CRIAR','ADICIONAR'].includes(p.operation)&&alreadyReserved)throw new Error('Um pedido já pertence a uma montagem ativa.');if(['TRANSFERIR','REMOVER'].includes(p.operation)&&!a)throw new Error('Um pedido já foi retirado da montagem.');if(p.operation==='TRANSFERIR'&&a.montageId===p.target)throw new Error('Escolha outra montagem de destino.');}
}

function formExpMaterialize_(ss,st){
 const write=(name,rows)=>{const sh=ss.getSheetByName(name),width=FORM_EXP_SCHEMA[name].length,last=sh.getLastRow();if(rows.length){if(sh.getMaxRows()<rows.length+1)sh.insertRowsAfter(sh.getMaxRows(),rows.length+1-sh.getMaxRows());sh.getRange(2,1,rows.length,width).setValues(rows.map(r=>r.map(v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)));}if(last>rows.length+1)sh.getRange(rows.length+2,1,last-rows.length-1,width).clearContent();};
 write('MONTAGENS',Object.values(st.montages).map(m=>[m.id,m.name,m.createdAt,m.owner,m.status]));write('MONTAGEM_PEDIDOS',Object.entries(st.assignments).map(([key,a])=>[a.montageId,formExpParseKey_(key).order,key,a.at,a.by]));write('VINCULOS_FONTES',Object.entries(st.links).flatMap(([key,l])=>l.sourceKeys.map(source=>[key,source,l.at,l.by])));
}

function formationExperimentalApi_(user,p){
 if(p.action&&p.action!=='read')formExpAccess_(user,'edit');
 formExpAccess_(user);const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Outra rotina está em andamento. Aguarde e tente novamente.');
 try{
  const ss=formExpAux_(),st=formExpState_(ss),sources=formExpSources_(user),commercial=formExpCommercial_(Object.keys(st.links),p.action==='save'||p.force===true),view=formExpView_(st,sources,commercial,user);
  if(p.action==='read'||!p.action)return {ok:true,...view,experimental:true};
  if(p.action==='lookup')return {ok:true,orders:formExpLookup_(p.orderNumber,user,p.sourceKeys,sources,p.clientSearch).filter(o=>!st.links[o.key]||view.orders.some(v=>v.key===o.key)).map(o=>({...o,confirmedSourceRows:[...new Set([...(st.links[o.key]&&st.links[o.key].sourceKeys||[]),...p.sourceKeys])].map(k=>sources.all[k]).filter(Boolean)})),revision:st.revision,sourceVersion:view.sourceVersion};
  if(p.action!=='save')throw new Error('Ação experimental inválida.');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||'')))throw new Error('Identificador de movimentação inválido.');if(st.requests[p.requestId])return {ok:true,alreadyApplied:true,message:'Movimentação já registrada.'};
  if(p.operation==='VINCULAR'){
   if(Number(p.revision)!==st.revision||p.sourceVersion!==view.sourceVersion||p.confirmed!==true)throw new Error('Reabra e confirme o vínculo com as fontes atuais.');
   if(!Array.isArray(p.sourceKeys)||!p.sourceKeys.length||new Set(p.sourceKeys).size!==p.sourceKeys.length)throw new Error('Selecione registros de formação distintos.');const sourceKeys=[...new Set([...(st.links[p.orderKey]&&st.links[p.orderKey].sourceKeys||[]),...p.sourceKeys])];if(sourceKeys.length>50)throw new Error('Selecione até 50 registros de formação distintos.');p.sourceKeys=sourceKeys;formExpParseKey_(p.orderKey);if(st.assignments[p.orderKey])throw new Error('Retire o pedido da montagem antes de alterar seu vínculo.');
   for(const key of sourceKeys){const r=sources.all[key];if(!r||r.ambiguous||!r.awaitingFormation||!logisticsRowAllowed_(user,r,'operations'))throw new Error('Registro da formação mudou, é duplicado ou não está disponível.');if(Object.entries(st.links).some(([order,l])=>order!==p.orderKey&&l.sourceKeys.includes(key)))throw new Error('Um registro já está vinculado a outro pedido.');}
   const actual=formExpCommercial_([p.orderKey],true)[p.orderKey];if(!actual||!(actual.rcas||[actual.rca]).every(rca=>userAllowsRca_(user,rca))||actual.version!==p.orderVersion)throw new Error('O pedido comercial mudou ou não está no seu recorte.');
  }else formExpValidateMove_(st,view,p);
  const name=String(p.name||'').trim();if(['CRIAR','RENOMEAR'].includes(p.operation)&&name.length>100)throw new Error('Use até 100 caracteres no nome da montagem.');if(p.operation==='RENOMEAR'&&!name)throw new Error('Informe o nome.');
  const keys=p.operation==='VINCULAR'?[p.orderKey]:p.keys||[],to=p.operation==='CRIAR'?'mont_'+Utilities.getUuid():p.target||'',e={id:p.requestId,revision:st.revision+1,at:new Date().toISOString(),by:user.login,type:p.operation,keys,from:Object.fromEntries(keys.map(k=>[k,st.assignments[k]&&st.assignments[k].montageId||''])),to,data:p.operation==='VINCULAR'?{sourceKeys:p.sourceKeys}:{name:name||(p.operation==='CRIAR'?'Montagem '+(st.sequence+1):'')}};
  const payload=JSON.stringify(e.data),keyJson=JSON.stringify(keys),fromJson=JSON.stringify(e.from);if([payload,keyJson,fromJson].some(s=>s.length>44000))throw new Error('Movimentação muito grande. Divida a seleção.');
  const journal=ss.getSheetByName('HISTORICO_MOVIMENTACOES'),row=journal.getLastRow()+1;if(row>journal.getMaxRows())journal.insertRowsAfter(journal.getMaxRows(),row-journal.getMaxRows());
  // Uma única linha de evento é a fonte de verdade. As projeções podem ser reconstruídas.
  journal.getRange(row,1,1,9).setValues([[e.id,e.revision,e.at,e.by,e.type,keyJson,fromJson,e.to,payload]]);SpreadsheetApp.flush();if(journal.getRange(row,1).getDisplayValue()!==e.id)throw new Error('Não foi possível confirmar o registro. Recarregue antes de repetir.');
  formExpApply_(st,e);st.events.push(e);st.requests[e.id]=true;st.revision=e.revision;let projectionWarning=false;try{formExpMaterialize_(ss,st);}catch(err){projectionWarning=true;console.warn('Projeções auxiliares pendentes; histórico preservado.');}
  return {ok:true,revision:st.revision,montageId:to,message:'Movimentação salva na base auxiliar de teste.',projectionWarning};
 }finally{lock.releaseLock();}
}








// ── 17. Montagem de cargas a partir dos pedidos ──
// Consulta pedidos do Força de Vendas, identifica clientes e aplica as movimentações das montagens.

function formDirectClientNames_(){
 const sh=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheetByName('CLIENTES');
 if(!sh)throw new Error('Cadastro CLIENTES não encontrado na base auxiliar comercial.');
 const ix=headerIndex_(sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0]);
 if(ix.CODCLI==null||ix.CLIENTE==null)throw new Error('O cadastro CLIENTES precisa de CODCLI e CLIENTE.');
 const count=sh.getLastRow()-1, names={}, conflicts=new Set();
 if(count<1)return names;
 const lo=Math.min(ix.CODCLI,ix.CLIENTE), hi=Math.max(ix.CODCLI,ix.CLIENTE);
 const values=sh.getRange(2,lo+1,count,hi-lo+1).getValues();
 for(const r of values){const code=code_(r[ix.CODCLI-lo]),name=logText_(r[ix.CLIENTE-lo]);if(code==null||!name||/^\d+$/.test(name))continue;const key=String(code);if(names[key]&&norm_(names[key])!==norm_(name))conflicts.add(key);else names[key]=name;}
 for(const key of conflicts)delete names[key];return names;
}

function formDirectClientName_(raw,names){
 const text=logText_(raw);
 const code=code_(text);
 const fromOrder=text.match(/^\d+\s*[-–—]\s*(.+)$/)?.[1].trim();
 if(fromOrder && fromOrder!==text && !/^\d+$/.test(fromOrder))return fromOrder;
 return names[String(code)] || (code==null?'Cliente sem código':'Cliente '+code);
}

// Pedidos consultados na base sincronizada do Força de Vendas; escrita somente na auxiliar.
const FORM_OPEN_STATUSES = new Set(['PENDENTE','LIBERADO','BLOQUEADO']);
const FORM_CACHE_SECONDS = 1800;

function formDirectStatusPattern_() {
 const letters=new Map();
 for(const word of FORM_OPEN_STATUSES)for(const letter of word)letters.set(letter,'');
 for(const [first,last] of [[65,122],[192,591],[7680,7935]]){
  for(let i=first;i<=last;i++){
   const char=String.fromCharCode(i), base=norm_(char);
   if(letters.has(base))letters.set(base,letters.get(base)+char);
  }
 }
 const words=[...FORM_OPEN_STATUSES].map(word=>[...word].map(letter=>'['+letters.get(letter)+'][\u0300-\u036f]*').join(''));
 return '(?:'+words.join('|')+')';
}

function formDirectFindRows_(sheet, column, count, pattern) {
 const space='[\\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*';
 return sheet.getRange(2,column+1,count,1).createTextFinder('^'+space+pattern+space+'$')
  .useRegularExpression(true).matchEntireCell(true).findAll().map(range=>range.getRow());
}

function formDirectFindNumbers_(sheet, column, count, numbers) {
 const terms=[...numbers].map(number=>number.replace(/\d(?=(?:\d{3})+$)/g,'$&[.,\u00a0\u202f ]?')).join('|');
 if(terms.length>7000)return null;
 return formDirectFindRows_(sheet,column,count,'(?:'+terms+')(?:[.,]0+)?');
}

function formDirectFindOpenRows_(sheet, ix, count) {
 const open=formDirectFindRows_(sheet,ix['Posição'],count,formDirectStatusPattern_());
 if(!open.length)return [];
 const needed=new Set(open), numbers=new Set();
 for(const {first,last} of centralRowBlocks_(open)){
  const ids=sheet.getRange(first,ix.NUMPED+1,last-first+1,1).getValues();
  ids.forEach(([value],i)=>{
   const id=String(value||'').trim();
   if(needed.has(first+i)&&/^\d{1,20}$/.test(id))numbers.add(id);
  });
 }
 if(!numbers.size)return [];
 const matched=formDirectFindNumbers_(sheet,ix.NUMPED,count,numbers);
 if(!matched)return null;
 const found=new Set(matched);
 // Se a exibição de NUMPED omitiu uma linha válida, usa os valores brutos desse ano.
 return open.every(row=>found.has(row))?matched:null;
}

function formDirectCandidateRows_(sheet, ix, count, selected, fast) {
 const orderText=value=>String(value||'').trim();
 let wanted=selected;
 let ids;
 if(fast){
  try{
   const rows=wanted?formDirectFindNumbers_(sheet,ix.NUMPED,count,wanted):formDirectFindOpenRows_(sheet,ix,count);
   if(rows)return rows;
  }catch(error){
   // A leitura bruta também suporta abas e formatos legados.
  }
 }
 if(!wanted){
  // Abas sem pedidos em aberto só precisam devolver a coluna de posição.
  const position=sheet.getRange(2,ix['Posição']+1,count,1).getValues(), openRows=[], normalized=new Map();
  position.forEach(([value],i)=>{
   if(!normalized.has(value))normalized.set(value,FORM_OPEN_STATUSES.has(norm_(value)));
   if(normalized.get(value))openRows.push(i);
  });
  if(!openRows.length)return [];
  ids=sheet.getRange(2,ix.NUMPED+1,count,1).getValues();
  wanted=new Set(openRows.map(i=>orderText(ids[i][0])).filter(id=>/^\d{1,20}$/.test(id)));
 }
 if(!wanted.size)return [];
 if(!ids)ids=sheet.getRange(2,ix.NUMPED+1,count,1).getValues();
 // Inclui as linhas faturadas com o mesmo número para descartar pedidos mistos.
 return ids.flatMap(([number],i)=>wanted.has(orderText(number))?[i+2]:[]);
}

function formDirectCatalog_(numbers = null, clientNames = formDirectClientNames_(), fast = false) {
 const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),tz=ss.getSpreadsheetTimeZone(),out={},logistics=new Map();
 for(const year of CFG.years){
  const sh=ss.getSheetByName(year), count=sh?sh.getLastRow()-1:0;
  if(count<1)continue;
  const width=sh.getLastColumn(), ix=headerIndex_(sh.getRange(1,1,1,width).getDisplayValues()[0]);
  for(const h of ['NUMPED','Cod/Cliente','Cod/Produto','Qt Pedida','Posição','Data Pedido','MUNICENT','ESTENT'])if(ix[h]==null)throw new Error('Coluna comercial ausente: '+h);
  const hits=formDirectCandidateRows_(sh,ix,count,numbers,fast);
  const needed=new Set(hits);
  for(const {first,last} of centralRowBlocks_(hits)){
   const rows=sh.getRange(first,1,last-first+1,width).getValues();
   for(let i=0;i<rows.length;i++){
    if(!needed.has(first+i))continue;
    const r=rows[i],order=String(cell_(r,ix,'NUMPED')||'').trim(),rawClient=String(cell_(r,ix,'Cod/Cliente')||''),clientCode=code_(rawClient),status=norm_(cell_(r,ix,'Posição'));
    if(!/^\d{1,20}$/.test(order)||clientCode==null||(numbers&&!numbers.has(order)))continue;
   const key=formExpOrderKey_(year,String(clientCode),order);if(!FORM_OPEN_STATUSES.has(status)){out[key]=null;continue;}if(Object.prototype.hasOwnProperty.call(out,key)&&out[key]===null)continue;let o=out[key];if(!o)o=out[key]={key,year,order,clientCode:String(clientCode),client:formDirectClientName_(rawClient,clientNames),city:logText_(cell_(r,ix,'MUNICENT')),uf:logText_(cell_(r,ix,'ESTENT')),seller:logText_(cell_(r,ix,'Cod/Vend.')),date:logDate_(cell_(r,ix,'Data inicial do pedido')||cell_(r,ix,'Data Pedido'),tz),products:[],rcas:[],statuses:[],invoices:[],weight:null,volumes:null,weightIncomplete:true};
   o.rcas.push(code_(cell_(r,ix,'Cod/Vend.')));o.statuses.push(status);const product=String(cell_(r,ix,'Cod/Produto')||'');o.products.push({code:code_(product),description:product.replace(/^\s*\d+\s*-\s*/,''),quantity:logNumber_(cell_(r,ix,'Qt Pedida')),value:logNumber_(cell_(r,ix,'Pedidos Enviados')),supplier:logText_(cell_(r,ix,'Cod/Fornecedor')),department:logText_(cell_(r,ix,'DEPARTAMENTO')),section:logText_(cell_(r,ix,'SECAO')),invoice:logText_(cell_(r,ix,'Numero Nota Fiscal')),billingDate:logDate_(cell_(r,ix,'Data Faturamento'),tz),orderDate:logDate_(cell_(r,ix,'Data Pedido'),tz),status});if(cell_(r,ix,'Numero Nota Fiscal'))o.invoices.push(String(cell_(r,ix,'Numero Nota Fiscal')));
   if(!logistics.has(key))logistics.set(key,[]);
   logistics.get(key).push([cell_(r,ix,'Peso Pedidos'),logText_(cell_(r,ix,'Endereço Completo'))]);
   }
  }
 }
 const catalog={};for(const [key,o]of Object.entries(out)){if(!o)continue;o.rcas=[...new Set(o.rcas)];o.rca=o.rcas[0];o.statuses=[...new Set(o.statuses)];o.invoices=[...new Set(o.invoices)];o.active=o.statuses.every(status=>FORM_OPEN_STATUSES.has(status));if(!o.active)continue;const versionClient=clientNames[o.clientCode]||(o.client==='Cliente '+o.clientCode?'Nome não localizado no cadastro':o.client);const previousVersion=digestHex_(JSON.stringify({...o,client:versionClient})).slice(0,24);o.version=digestHex_(JSON.stringify(o)).slice(0,24);if(previousVersion!==o.version)o.previousVersion=previousVersion;formDirectLogistics_(o,logistics.get(key));catalog[key]=o;}return catalog;
}

function formDirectLogistics_(order, lines) {
  const addresses=new Map();
  let total=0,complete=lines.length>0;
  for(const [weight,address] of lines){
    if(typeof weight==='number'&&Number.isFinite(weight)&&weight>=0)total+=weight;
    else complete=false;
    if(address)addresses.set(logNorm_(address).replace(/\s+/g,' '),address);
  }
  if(complete&&total>0){
    order.weight=Math.round(total*1000)/1000;
    order.weightIncomplete=false;
    order.weightSource='Força de Vendas';
  }
  if(addresses.size===1){
    const [address]=addresses.values();
    if(address.length<=240)order.deliveryAddress=address;
  }
}

function formDirectAllowed_(user,o) {
  return (o.rcas||[]).length>0&&(user.perfil===FORMATION_ROLE||platformAccess_(user).transportOnly||o.rcas.every(rca=>userAllowsRca_(user,rca)))&&logisticsRowAllowed_(user,{seller:o.seller||String(o.rca||''),region:o.region||'',carrier:''},'formationDirect');
}

function formDirectSnapshot_(st){const out={};for(const e of st.events)for(const [key,o]of Object.entries(e.data.orders||{}))out[key]=o;return out;}

function formDirectVolumes_(order) {
 const products=order.products||[];
 if(!products.length||products.some(item=>!Number.isFinite(item.quantity)||item.quantity<0))return null;
 return products.reduce((total,item)=>total+item.quantity,0);
}

// Usa o acompanhamento do SAC apenas para decidir a disponibilidade na Formação.
function formTransportInvoiceIndex_(rows, header, tz) {
 const columns=new Map(header.map((value,i)=>[logNorm_(value),i]));
 for(const name of ['NF','TRANSPORTADORA','CLIENTE','CIDADE','EMISSAO','PEDIDO']){
  if(!columns.has(name))throw new Error('Cabeçalho de notas de transporte ausente.');
 }
 const index=new Map();
 for(const row of rows){
  const get=name=>row[columns.get(name)];
  const date=logDate_(get('EMISSAO'),tz);
  if(!date||!logText_(get('TRANSPORTADORA'))||/CANCELAD|ESTORNAD/.test(logNorm_(get('STATUS TRANSPORTADORA'))))continue;
  const order=logText_(get('PEDIDO'));
  const orderNumbers=/^\d+(?:\s*[,;+/]\s*\d+)*$/.test(order)
   ? order.split(/\s*[,;+/]\s*/).map(number=>number.replace(/^0+(?=\d)/,'')) : [];
  const location=logCity_(get('CIDADE'));
  const identity={date,order,orderNumbers,client:logNorm_(get('CLIENTE')),city:location.city,uf:logNorm_(get('UF'))||location.uf};
  for(const note of sacImportNotes_(get('NF'))){
   const [number,series='']=note.split('-');
   if(number==='0')continue;
   if(!index.has(number))index.set(number,[]);
   index.get(number).push({...identity,series});
  }
 }
 return index;
}

function formTransportInvoiceSnapshot_(force) {
 try {
  const props=PropertiesService.getScriptProperties(),id=props.getProperty('LOG_INDICATORS_ID')||LOGISTICS_SOURCES.indicators;
  const cache=CacheService.getScriptCache(),change=props.getProperty(centralTransportVersionKey_(id))||'';
  const key='FORM_TRANSPORT_NF_V1_'+digestHex_(id+'|'+change).slice(0,28);
  const cached=force?null:centralCacheRead_(cache,key);
  if(cached)return new Map(cached);
  const ss=SpreadsheetApp.openById(id),sheet=ss.getSheetByName('ACOMPANHAMENTO');
  const values=sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),Math.min(20,sheet.getLastColumn())).getDisplayValues();
  const index=formTransportInvoiceIndex_(values.slice(1),values[0],ss.getSpreadsheetTimeZone());
  centralCacheWrite_(cache,key,JSON.stringify([...index]),180);
  return index;
 }catch(error){
  console.warn('Conciliação de notas da Formação indisponível.');
  return new Map();
 }
}

function formDirectAlreadyInTransport_(order,index) {
 const orderNumber=String(order.order).replace(/^0+(?=\d)/,'');
 const client=logNorm_(order.client),city=logCity_(order.city).city,uf=logNorm_(order.uf);
 return !!order.products?.length&&order.products.every(item=>{
  const notes=sacImportNotes_(item.invoice);
  return notes.length>0&&notes.every(note=>{
   const [number,series='']=note.split('-');
   const matches=(index.get(number)||[]).filter(row=>!series||!row.series||series===row.series);
   if(matches.some(row=>row.orderNumbers.includes(orderNumber)&&(!order.date||row.date>=order.date)))return true;
   if(!item.billingDate||!client||!city)return false;
   const candidates=matches.filter(row=>!row.order&&row.date===item.billingDate&&
    row.client===client&&row.city===city&&(!row.uf||!uf||row.uf===uf));
   return candidates.length>0&&new Set(candidates.map(row=>row.series).filter(Boolean)).size<=1;
  });
 });
}

function formSellerDirectory_() {
 try {
  const cache=CacheService.getScriptCache(), key='FORM_DELIVERY_SELLERS_'+CFG.auxiliarySpreadsheetId;
  const cached=centralCacheRead_(cache,key);
  if(cached)return cached;
  const sheet=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheetByName('RCA');
  if(!sheet)return {};
  const names=Object.fromEntries([...readRcaMap_(sheet)].map(([code,rca])=>[code,rca.name]));
  centralCacheWrite_(cache,key,JSON.stringify(names),300);
  return names;
 }catch(error){
  console.warn('Cadastro de vendedores indisponível para a Formação de Cargas.');
  return {};
 }
}

function formDeliverySeller_(order,names) {
 const rawCode=code_(order.seller);
 const rawName=logText_(order.seller).replace(/^\d+\s*[-–—]\s*/,'').trim();
 const codes=new Set([...(order.rcas||[]).map(code_),rawCode]);
 codes.delete(null);
 const labels=[];
 for(const code of codes){
  const label=logText_(names[code]);
  if(/\p{L}/u.test(label))labels.push(label);
  else if(code===rawCode&&/\p{L}/u.test(rawName))labels.push(rawName);
 }
 if(!labels.length&&rawCode===null&&/\p{L}/u.test(rawName))labels.push(rawName);
 return [...new Set(labels)].join(' / ');
}

function formDirectRegionDirectory_() {
 try{
  const id=PropertiesService.getScriptProperties().getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations;
  const cache=CacheService.getScriptCache(), key='FORM_ORDER_REGIONS_'+id;
  const cached=centralCacheRead_(cache,key);
  if(cached)return cached;
  const sheet=SpreadsheetApp.openById(id).getSheetByName('CADASTRO REGIAO'), last=sheet?.getLastRow()||0;
  if(last<2)return {};
  // Os municípios sem UF no cadastro operacional pertencem ao Ceará.
  const regions=logRegionMap_(sheet.getRange(1,1,last,3).getValues(),'CE');
  const labels=new Map(), directory={};
  for(const [city,region] of regions){
   const normalized=logNorm_(region);
   if(!labels.has(normalized))labels.set(normalized,region);
   directory[city]=labels.get(normalized);
  }
  centralCacheWrite_(cache,key,JSON.stringify(directory),300);
  return directory;
 }catch(error){
  console.warn('Cadastro de regiões indisponível para a Formação de Cargas.');
  return {};
 }
}

function formDirectView_(st,catalog,user,forceTransport=false){
 const saved=formDirectSnapshot_(st),orders=[],byKey={},canonical={},filterLabels=[];
 let sellerNames, regions;
 const transportCandidates=Object.values(catalog).some(o=>!st.assignments[o.key]&&o.invoices?.some(nf=>sacImportNotes_(nf).length));
 const transport=transportCandidates?formTransportInvoiceSnapshot_(forceTransport):null;
 const reserved=new Set(Object.keys(st.assignments).map(key=>{const {client,order}=formExpParseKey_(key);return client+'|'+order;}));for(const o of Object.values(catalog)){const k=o.clientCode+'|'+o.order;canonical[k]=(canonical[k]||0)+1;}
 for(const key of new Set([...Object.keys(catalog),...Object.keys(st.assignments)])){const fresh=catalog[key],o=fresh||saved[key];if(!o||!formDirectAllowed_(user,o))continue;const a=st.assignments[key],duplicate=canonical[o.clientCode+'|'+o.order]>1,aliasReserved=!a&&reserved.has(o.clientCode+'|'+o.order),issue=!fresh?'Pedido não está mais em aberto na base comercial':duplicate?'Pedido repetido em mais de um ano; conferir origem':aliasReserved?'Pedido vinculado a uma montagem em outro ano':'';
  if(!a&&transport?.size&&formDirectAlreadyInTransport_(o,transport))continue;
  const finalized=a&&st.montages[a.montageId].status===FORM_FINAL;
  const recordedOrder=finalized?saved[key]||o:o;
  const volumes=formDirectVolumes_(recordedOrder);
  if(!sellerNames)sellerNames=formSellerDirectory_();
  if(!regions)regions=formDirectRegionDirectory_();
  const sellerCode=code_(o.rca??o.seller), seller=String(sellerCode??'');
  const sellerLabel=formDeliverySeller_({seller:o.seller,rcas:[sellerCode]},sellerNames);
  const location=logCity_(o.city), uf=logNorm_(o.uf)||location.uf;
  const region=regions[location.city+'|'+uf]||'Sem região';
  const row={sourceKey:key,orderKey:key,client:o.client,city:o.city,cityLabel:o.city,uf:o.uf,date:o.date,region,seller,sellerLabel,product:o.products.map(p=>p.description).join(' / '),status:o.statuses.join(' / '),weight:null,volumes,availableWeight:null,mountedWeight:null,awaitingFormation:!!fresh&&!duplicate&&!aliasReserved&&!a,delivered:false,linked:true,montageId:a?a.montageId:''};
  const entry={...o,client:o.client==='Nome não localizado no cadastro'?'Cliente '+o.clientCode:o.client,volumes,blocked:!fresh||duplicate||aliasReserved,sourceIssue:issue,sourceKeys:[key],sourceRows:[row],originalStatuses:o.statuses,montageId:a?a.montageId:'',internalStatus:a?(st.montages[a.montageId].status===FORM_FINAL?'Montagem finalizada':st.montages[a.montageId].status):st.last[key]&&st.last[key].type==='REMOVER'?'Removido da montagem':'Disponível',sourceDate:o.date};
  if(finalized){
    Object.assign(entry,{weight:recordedOrder.weight,weightIncomplete:recordedOrder.weightIncomplete,
      weightSource:recordedOrder.weightSource,deliveryAddress:recordedOrder.deliveryAddress});
    entry.deliverySeller=formDeliverySeller_(recordedOrder,sellerNames);
  }
  filterLabels.push([key,region,sellerLabel,entry.deliverySeller||'']);
  orders.push(entry);byKey[key]=entry;
 }
 const grouped=new Map();for(const [key,a] of Object.entries(st.assignments)){if(!grouped.has(a.montageId))grouped.set(a.montageId,[]);grouped.get(a.montageId).push(key);}
 const montages=[];for(const m of Object.values(st.montages)){const keys=grouped.get(m.id)||[];if(keys.some(k=>!byKey[k]))continue;if(!keys.length&&!formWideScope_(user)&&m.owner!==user.login)continue;const members=keys.map(k=>byKey[k]);montages.push({...m,orderKeys:keys,orders:keys.length,clients:new Set(members.map(o=>o.clientCode)).size,cities:new Set(members.map(o=>o.city+'|'+o.uf)).size,weight:keys.length?null:0,volumes:members.some(o=>o.volumes==null)?null:members.reduce((total,o)=>total+o.volumes,0),sourceIssues:members.filter(o=>o.blocked).length});}
 const visibleMontages=new Set(montages.map(m=>m.id));
 const events=st.events.slice().reverse().filter(e=>e.keys.length?e.keys.every(k=>byKey[k]):visibleMontages.has(e.to)||e.data.montageIds?.every(id=>visibleMontages.has(id))||FORM_FLEET_SETTINGS.includes(e.type)).slice(0,200).map(formDirectEvent_);
 const view=formFleetEnhance_({ok:true,experimental:true,direct:true,orders,montages,events,mapRows:orders.map(o=>o.sourceRows[0]),revision:st.revision,sequence:st.sequence,sourceVersion:digestHex_(JSON.stringify(orders.map(o=>[o.key,o.version,o.blocked]).sort())).slice(0,32),updatedAt:new Date().toISOString(),source:'Força de Vendas · base sincronizada'},st);
 view.missingFields=orders.some(o=>o.weightIncomplete)?['Peso']:[];
 const logisticsVersion=digestHex_(JSON.stringify(orders.map(o=>[o.key,o.weight,o.weightIncomplete,o.deliveryAddress]).sort())).slice(0,24);
 view.viewVersion=digestHex_(JSON.stringify([view.revision,view.sourceVersion,logisticsVersion,view.fleet,view.routing,view.googleMapsKey,'qtPedidaVolumes','routingOperationalAlerts','cargoSchedule',filterLabels.sort()])).slice(0,24);
 return view;
}

function formDirectEvent_(e) {
 return {id:e.id,at:e.at,by:e.by,type:e.type,keys:e.keys,from:e.from,to:e.to,name:e.data.name||'',
  alerts:e.data.alerts||[],capacitySnapshot:e.data.capacitySnapshot||null,overweight:e.data.overweight||null,
  deliveryDate:e.data.deliveryDate||'',montageIds:e.data.montageIds||[],
  confirmed:e.data.route?.confirmed||false,routeEdited:e.data.routeEdited===true};
}

function formDirectMontageHistory_(user,p) {
 formExpAccess_(user);
 const st=formExpState_(formExpAux_(true)), id=String(p.target||'');
 formFleetCanManage_(user,st,id);
 const snapshots=formDirectSnapshot_(st);
 return {ok:true,events:st.events.slice().reverse()
  .filter(e=>(e.to===id||Object.values(e.from).includes(id)||e.data.montageIds?.includes(id))
   && e.keys.every(key=>snapshots[key]&&formDirectAllowed_(user,snapshots[key])))
  .map(formDirectEvent_)};
}

const FORM_COMPANIES = Object.freeze({REB:'Rebanho', NUT:'Nutriranch'});

function formAssemblyCompany_(value) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(FORM_COMPANIES, value)) {
    throw new Error('Escolha a empresa de saída da montagem.');
  }
  return value;
}

function formAssemblyCode_(st, company, createdAt) {
  const prefix = company + Utilities.formatDate(createdAt, 'America/Fortaleza', 'yyMM');
  const pattern = new RegExp('^' + prefix + '(\\d{2,})$');
  let sequence = 0;
  for (const event of st.events) {
    if (!['CRIAR','RENOMEAR'].includes(event.type)) continue;
    const match = String(event.data.name || '').trim().toUpperCase().match(pattern);
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  if (!Number.isSafeInteger(sequence + 1)) throw new Error('Sequência de montagens inválida.');
  return prefix + String(sequence + 1).padStart(2, '0');
}

function formAssemblyRetry_(st, requestId) {
  const event = st.events.find(item => item.id === requestId);
  return {ok:true, alreadyApplied:true, montageId:event?.to || '', message:'Movimentação já registrada.'};
}

function formDirectReadCatalog_(sourceState, force, checkedKeys = [], cacheOnly = false) {
 const cache=CacheService.getScriptCache();
 const key='FORM_CATALOG_V7_'+digestHex_(CFG.salesSpreadsheetId+'|'+CFG.auxiliarySpreadsheetId+'|'+sourceState).slice(0,28);
 const saved=force?null:centralCacheRead_(cache,key);
 if(saved&&!checkedKeys.length)return saved;
 if(cacheOnly&&!saved)return null;
 const namesKey='FORM_CLIENTS_V3_'+digestHex_(CFG.auxiliarySpreadsheetId+'|'+sourceState).slice(0,28);
 const names=(force?null:centralCacheRead_(cache,namesKey))||formDirectClientNames_();
 if(saved){
  const numbers=new Set(checkedKeys.map(key=>formExpParseKey_(key).order));
  const previous=Object.entries(saved).filter(([,order])=>numbers.has(order.order));
  let selected=formDirectCatalog_(numbers,names,true);
  if(previous.some(([id,order])=>selected[id]?.products.length!==order.products.length)){
   selected=formDirectCatalog_(numbers,names);
  }
  if(previous.length!==Object.keys(selected).length||previous.some(([id,order])=>order.version!==selected[id]?.version)){
   try{cache.remove(key);}catch(error){}
  }
  for(const [id] of previous)delete saved[id];
  return Object.assign(saved,selected);
 }
 const catalog=formDirectCatalog_(null,names,true);
 if(sourceState===formDirectSourceState_()){
  centralCacheWrite_(cache,key,JSON.stringify(catalog),FORM_CACHE_SECONDS);
  centralCacheWrite_(cache,namesKey,JSON.stringify(names),FORM_CACHE_SECONDS);
 }
 return catalog;
}

function formDirectGuard_(sourceState) {
 if(formDirectSourceState_()!==sourceState)throw new Error('A base de vendas foi atualizada durante a consulta. Atualize os pedidos e confira a seleção.');
}

function formDirectPrepareAfterSync_(sync) {
 const props=PropertiesService.getScriptProperties(), key='VENDAS_RBN_ULTIMA_SYNC';
 const before=props.getProperty(key), start=Date.now();
 sync();
 if(Date.now()-start>90000||before===props.getProperty(key))return;
 try{
  const timing=centralTiming_('formacao.preparoAposSincronizacao');
  formDirectReadCatalog_(formDirectSourceState_(),false);
  timing.finish('ok');
 }catch(error){
  console.warn('O preparo do catálogo ficou para a próxima consulta.');
 }
}

function formDirectTargetKeys_(st, target) {
 return Object.keys(st.assignments).filter(key=>st.assignments[key].montageId===target);
}

function formDirectValidateContext_(st, view, p) {
  const keys = p.keys || [];
  if (!Array.isArray(keys) || keys.length > 100 || new Set(keys).size !== keys.length || keys.some(key=>typeof key!=='string')) {
    throw new Error('Selecione até 100 pedidos distintos.');
  }
  if (!p.ordersAtConfirmation || p.operation === 'RENOMEAR') return p;
  const selected = new Map(view.orders.map(order=>[order.key,order]));
  for (const key of keys) {
    const order = selected.get(key);
    const expected = Object.prototype.hasOwnProperty.call(p.ordersAtConfirmation,key) ? p.ordersAtConfirmation[key] : null;
    if (!order || !expected || expected.montageId !== (st.assignments[key]?.montageId || '') ||
        p.operation !== 'REMOVER' && (order.blocked || expected.version !== order.version)) {
      throw new Error('Um pedido da seleção mudou ou foi movido. Atualize e confira os pedidos antes de salvar.');
    }
  }
  return {...p,revision:st.revision,sourceVersion:view.sourceVersion};
}

function formClosedOrders_(user,p) {
 formExpAccess_(user);
 const from=String(p.from||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||dateIso_(from)?.slice(0,10)!==from)throw new Error('Informe uma data inicial válida.');
 const sourceState=formDirectSourceState_();
 const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),tz=ss.getSpreadsheetTimeZone();
 const query=logNorm_(p.query).slice(0,200);
 const orders=new Map();
 const unavailable=new Set();
 const names=formDirectClientNames_();
 for(const year of CFG.years){
  const sh=ss.getSheetByName(year), count=sh?sh.getLastRow()-1:0;
  if(!count||String(year)<from.slice(0,4))continue;
  const width=sh.getLastColumn();
  const ix=headerIndex_(sh.getRange(1,1,1,width).getDisplayValues()[0]);
  const first=ix['Data Pedido'], initial=ix['Data inicial do pedido'];
  if(first==null)continue;
  const dateCells=sh.getRange(2,first+1,count,(initial??first)-first+1).getValues();
  const candidateRows=[];
  dateCells.forEach((row,index)=>{
   const date=logDate_(row[initial-first]||row[0],tz);
   if(date&&date>=from)candidateRows.push(index+2);
  });
  const candidates=new Set(candidateRows);
  for(const {first:start,last} of centralRowBlocks_(candidateRows)){
   const rows=sh.getRange(start,1,last-start+1,width).getValues();
   rows.forEach((row,index)=>{
    if(!candidates.has(start+index))return;
    const status=norm_(cell_(row,ix,'Posição'));
    if(status!=='FECHADO')return;
    const order=String(cell_(row,ix,'NUMPED')||'').trim();
    const rawClient=cell_(row,ix,'Cod/Cliente'),code=code_(rawClient);
    if(!/^\d{1,20}$/.test(order)||code==null)return;
    const client=formDirectClientName_(rawClient,names),city=logText_(cell_(row,ix,'MUNICENT')),uf=logText_(cell_(row,ix,'ESTENT'));
    const key=formExpOrderKey_(year,String(code),order);
    const seller=logText_(cell_(row,ix,'Cod/Vend.'));
    if(!formDirectAllowed_(user,{rcas:[code_(seller)],seller})){
     unavailable.add(key);
     return;
    }
    const invoice=logText_(cell_(row,ix,'Numero Nota Fiscal'));
    const date=logDate_(cell_(row,ix,'Data inicial do pedido')||cell_(row,ix,'Data Pedido'),tz);
    if(!orders.has(key))orders.set(key,{order,clientCode:String(code),client,city,uf,date,invoices:[],billingDate:'',products:[]});
    const item=orders.get(key);
    if(invoice&&!/^(?:0+(?:[.,]0+)?|[-–—]+|#?N\/A|SEM NF|NAO INFORMAD[AO])$/.test(logNorm_(invoice))&&!item.invoices.includes(invoice))item.invoices.push(invoice);
    const billed=logDate_(cell_(row,ix,'Data Faturamento'),tz);
    if(billed&&billed>item.billingDate)item.billingDate=billed;
    const product=logText_(cell_(row,ix,'Cod/Produto'));
    if(product&&!item.products.includes(product))item.products.push(product);
   });
  }
 }
 formDirectGuard_(sourceState);
 const results=[...orders.entries()].filter(([key])=>!unavailable.has(key)).map(([,order])=>order)
  .filter(o=>p.withoutInvoice!==true||!o.invoices.length).filter(o=>!query||logNorm_([o.order,o.clientCode,o.client,o.city,...o.invoices,...o.products].join(' ')).includes(query))
  .sort((a,b)=>b.date.localeCompare(a.date)||a.order.localeCompare(b.order,'pt-BR',{numeric:true}));
 return {ok:true,orders:results.slice(0,1000).map(({products,...order})=>order),total:results.length};
}

function formationDirectApi_(user,p) {
 if(p.action==='closedOrders')return formClosedOrders_(user,p);
 if(p.action==='fleetSave')return formFleetApi_(user,p);
 if(p.action==='settingsRead'){if(platformAccess_(user).transportOnly)throw new Error('Configurações fora do seu perfil.');return formRouteSettingsRead_(user);}
 if(p.action==='montageHistory')return formDirectMontageHistory_(user,p);
 if(p.action==='priorityRead'){if(platformAccess_(user).formationOnly||platformAccess_(user).transportOnly)throw new Error('Fonte fora do seu perfil.');return formPriorityRead_(user);}
 formExpAccess_(user);
 const reading=!p.action||p.action==='read';
 if(!reading)formExpAccess_(user,'edit');
 if(!reading&&(p.action!=='save'||!['CRIAR','ADICIONAR','TRANSFERIR','REMOVER','RENOMEAR'].includes(p.operation)))throw new Error('Operação de montagem inválida.');
 const keys=p.keys||[];
 if(!reading&&(!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||''))||!Array.isArray(keys)||keys.length>100||
     new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string')))throw new Error('Identificador ou seleção de pedidos inválidos.');
 const timing=centralTiming_(reading?'formacao.leitura':'formacao.'+p.operation);
 let status='erro';
 try{
  const ss=formExpAux_(true);
  if(reading){
   const sourceState=formDirectSourceState_();
   const catalog=formDirectReadCatalog_(sourceState,p.force===true);
   formDirectGuard_(sourceState);
   timing.mark('origem');
   const st=formExpState_(ss);
   timing.mark('historico');
   const view=formDirectView_(st,catalog,user,p.force===true);
   timing.mark('resposta');
   status='ok';
   if(p.check===true&&p.viewVersion===view.viewVersion&&p.revision===view.revision){
    return {ok:true,unchanged:true,revision:view.revision,sourceVersion:view.sourceVersion,updatedAt:view.updatedAt};
   }
   return view;
  }
  // O índice comercial só lê a origem inteira no primeiro acesso de cada geração.
  const initial=formExpState_(ss);
  if(Object.prototype.hasOwnProperty.call(initial.requests,p.requestId)){
   status='repetido';
   return formAssemblyRetry_(initial,p.requestId);
  }
  const sourceState=formDirectSourceState_();
  const checked=[...new Set([...keys,...formDirectTargetKeys_(initial,p.target)])];
  const catalog=formDirectReadCatalog_(sourceState,false,checked);
  formDirectGuard_(sourceState);
  timing.mark('origem');
  const lock=LockService.getScriptLock();
  const locked=lock.tryLock(12000);
  timing.mark('fila');
  if(!locked){
   status='fila_ocupada';
   return {ok:false,code:'FORMATION_WRITE_BUSY',message:'A gravação ainda está ocupada. A seleção foi mantida. Tente salvar novamente em instantes.'};
  }
  let st, to, projectionWarning, message;
  try{
   st=formExpState_(ss);
   if(Object.prototype.hasOwnProperty.call(st.requests,p.requestId)){
    status='repetido';
    return formAssemblyRetry_(st,p.requestId);
   }
   formDirectGuard_(sourceState);
   if(formDirectTargetKeys_(st,p.target).some(key=>!checked.includes(key)))throw new Error('A montagem de destino mudou. Atualize e confira a seleção.');
   const view=formDirectView_(st,catalog,user);
   p=formDirectValidateContext_(st,view,p);
   formFleetAssertMove_(st,p);
   // Retirar um pedido cuja situação comercial mudou continua possível.
   if(p.operation==='REMOVER'){
    const visible=new Set(view.orders.map(order=>order.key));
    if(Number(p.revision)!==st.revision||p.sourceVersion!==view.sourceVersion||p.confirmed!==true)throw new Error('Atualize e confirme a retirada.');
    if(!keys.length||keys.some(key=>!st.assignments[key]||!visible.has(key)))throw new Error('Seleção de pedidos inválida.');
   }else formExpValidateMove_(st,view,p);
   const at=new Date(),company=p.operation==='CRIAR'?formAssemblyCompany_(p.company):'';
   const name=company?formAssemblyCode_(st,company,at):String(p.name||'').trim();
   if(p.operation==='RENOMEAR'){
    if(st.montages[p.target]?.company)throw new Error('O código da montagem é permanente.');
    if(!name||name.length>100)throw new Error('Informe um nome de até 100 caracteres.');
    if(/^(REB|NUT)\d{6,}$/i.test(name))throw new Error('Este formato é reservado aos códigos automáticos.');
   }
   to=p.operation==='CRIAR'?'mont_'+Utilities.getUuid():p.target||'';
   const saved=formDirectSnapshot_(st),snapshots={};
   for(const key of keys){
    const order=catalog[key]||saved[key];
    if(!order)continue;
    if(JSON.stringify(order.products).length>44000)throw new Error('Pedido excede o limite de itens da planilha auxiliar.');
    snapshots[key]=order;
   }
   const event={id:p.requestId,revision:st.revision+1,at:at.toISOString(),by:user.login,type:p.operation,keys,
    from:Object.fromEntries(keys.map(key=>[key,st.assignments[key]?.montageId||''])),to,
    data:{name,...(company?{company}:{}),orders:snapshots,source:'FORCA_DE_VENDAS',
      ...(p.operation==='ADICIONAR'?{routingUpdate:formFleetAddition_(st,view,p)}:{})}};
   timing.mark('validacao');
   projectionWarning=formProjectionCommit_(ss,st,event,timing);
   message=event.data.routingUpdate?'Pedidos adicionados. A carga continua aguardando roteirização; confira a sequência de entregas.':company?'Montagem '+name+' criada.':'Montagem salva na planilha auxiliar com os dados do Força de Vendas.';
  }finally{
   lock.releaseLock();
  }
  let nextView=null;
  try{nextView=formDirectView_(st,catalog,user);}catch(error){console.warn('Montagem gravada. Atualização da tela pendente.');}
  timing.mark('resposta');
  status=projectionWarning?'abas_pendentes':'ok';
  return {ok:true,revision:st.revision,montageId:to,projectionWarning,view:nextView,message};
 }finally{
  timing.finish(status);
 }
}

function verificarMontagemDiretaRbn_() {
  const st=formExpState_(formExpAux_()),catalog=formDirectCatalog_(),v=formDirectView_(st,catalog,{perfil:'ADMIN',login:'diagnostico'});
  console.log(JSON.stringify({pedidos:v.orders.length,cidades:new Set(v.orders.map(o=>o.city+'|'+o.uf)).size,montagens:v.montages.length,revisao:v.revision,camposAusentes:v.missingFields,primeiroPedido:v.orders[0]?{pedido:v.orders[0].order,itens:v.orders[0].products.length}:null}));
  return {ok:true,pedidos:v.orders.length};
}

function verificarNomesClientesMontagemRbn_(){
 const names=formDirectClientNames_(),codes=['1015','10749','7534','10390','11869','8132'];
 const result=codes.map(code=>({codigo:code,nome:formDirectClientName_(code,names)}));
 console.log(JSON.stringify({cadastros:Object.keys(names).length,clientes:result}));return result;
}

function formDirectSourceState_(){
 const p=PropertiesService.getScriptProperties();
 if(p.getProperty('RBN_SALES_JOB_N'))throw new Error('A base de vendas está recebendo novos pedidos. Aguarde a atualização e consulte novamente.');
 return String(p.getProperty('VENDAS_RBN_ULTIMA_SYNC')||'');
}

// ── 18. Frota, capacidade e finalização ──
// Vincula veículos e motoristas, calcula o peso da carga e registra ocorrências ao finalizar.

const FORM_OPEN = 'Em aberto';
const FORM_ROUTING = 'Aguardando roteirização';
const FORM_FINAL = 'Finalizada';

// Frota, pesos e finalização persistem no mesmo histórico auxiliar das montagens.
function formFleetPlate_(value) {
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function formFleetValidPlate_(plate) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate);
}

function formFleetHistory_(){
 const id=PropertiesService.getScriptProperties().getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,cache=CacheService.getScriptCache(),key='FORM_FLEET_V1_'+id,saved=cache.get(key);if(saved){try{return JSON.parse(saved);}catch(e){}}
 const ss=SpreadsheetApp.openById(id),sh=ss.getSheetByName('FORMAÇÃO 2026'),vehicles={},drivers={};
 const add=(raw,driver)=>{const text=logText_(raw).toUpperCase(),match=text.match(/\b([A-Z]{3}[- ]?[0-9][A-Z0-9]{3})\b/);if(!match)return;const plate=formFleetPlate_(match[1]),type=text.replace(match[0],'').replace(/[-–()]/g,' ').trim();if(!vehicles[plate])vehicles[plate]={plate,type,capacityKg:null,defaultDriver:logText_(driver),active:true,source:'Histórico',needsReview:!formFleetValidPlate_(plate)};else if(!vehicles[plate].type&&type)vehicles[plate].type=type;};
 if(sh&&sh.getLastRow()>2)for(const r of sh.getRange(3,12,sh.getLastRow()-2,4).getValues().sort((a,b)=>formFleetDate_(b[3])-formFleetDate_(a[3]))){add(r[0],r[1]);if(logText_(r[1]))drivers[logNorm_(r[1])]={name:logText_(r[1]),active:true,source:'Histórico'};}
 const base=ss.getSheetByName('BASE DE DADOS');if(base)for(const r of base.getRange(2,1,Math.min(200,Math.max(1,base.getLastRow()-1)),5).getDisplayValues()){add(r[0],'');if(logText_(r[4]))drivers[logNorm_(r[4])]={name:logText_(r[4]),active:true,source:'Histórico'};}
 const result={vehicles,drivers};try{cache.put(key,JSON.stringify(result),120);}catch(e){}return result;
}

function formFleetCanManage_(user,st,id){const m=Object.prototype.hasOwnProperty.call(st.montages,id)?st.montages[id]:null;if(!m)throw new Error('Montagem não encontrada.');const keys=Object.keys(st.assignments).filter(k=>st.assignments[k].montageId===id),saved=formDirectSnapshot_(st);if(keys.some(k=>!saved[k]||!formDirectAllowed_(user,saved[k])))throw new Error('Montagem fora do seu recorte.');if(!keys.length&&!formWideScope_(user)&&m.owner!==user.login)throw new Error('Montagem fora do seu recorte.');return m;}

function formFleetAssertMove_(st,p) {
  const allowed = p.operation==='ADICIONAR' ? [FORM_OPEN,FORM_ROUTING] : [FORM_OPEN];
  if (['ADICIONAR','TRANSFERIR','RENOMEAR'].includes(p.operation) && !allowed.includes(st.montages[p.target]?.status)) {
    throw new Error(p.operation==='ADICIONAR' ? 'Escolha uma montagem em aberto ou aguardando roteirização.' : 'A montagem de destino precisa estar em aberto.');
  }
  for (const key of p.keys || []) {
    const a=st.assignments[key];
    if (a && st.montages[a.montageId]?.status !== FORM_OPEN) throw new Error('Reabra a montagem antes de mover os pedidos.');
  }
}

function formFleetAddition_(st, view, p) {
  const montage=st.montages[p.target];
  if(p.operation!=='ADICIONAR'||montage?.status!==FORM_ROUTING)return null;
  const keys=[...new Set([...formDirectTargetKeys_(st,p.target),...p.keys])];
  const byKey=new Map(view.orders.map(order=>[order.key,order]));
  const members=keys.map(key=>byKey.get(key));
  if(members.some(order=>!order))throw new Error('Atualize os pedidos da montagem antes de adicionar.');
  const vehicle=montage.vehicleSnapshot;
  const capacitySnapshot=formFleetCapacity_(members,vehicle);
  const alerts=formFleetWarnings_({...capacitySnapshot,vehicle,vehicleId:montage.vehicleId,driver:montage.driver,
    sourceIssues:members.filter(order=>order.blocked).length});
  const result={capacitySnapshot,alerts};
  if(montage.route){
    const route=montage.route, present=new Set(route.stops.flatMap(stop=>stop.keys));
    const stops=route.stops.map(stop=>({keys:stop.keys.slice(),address:stop.address}));
    for(const key of keys)if(!present.has(key))stops.push({keys:[key],address:byKey.get(key).deliveryAddress||''});
    result.route=formRouteSaveData_(st,montage,keys,{...route,baseAt:route.at,routingAt:montage.routingAt,
      unitId:route.unit?.id||'',confirmed:false,stops});
  }
  return result;
}

function formFleetOverweight_(m, reason) {
  const snapshot=m.capacitySnapshot;
  if (!snapshot?.overCapacity) return null;
  return {knownWeightKg:snapshot.knownWeightKg, totalWeightKg:snapshot.totalWeightKg, capacityKg:snapshot.capacityKg,
    excessKg:Math.round((snapshot.knownWeightKg-snapshot.capacityKg)*1000)/1000, reason};
}

function formFleetRecordOverweight_(m, e, details) {
  if (details) m.overweightOccurrences.push({...details, eventId:e.id, at:e.at, by:e.by});
}


function formFleetDate_(v){if(v instanceof Date)return v.getTime();const s=String(v||''),m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?Date.UTC(+m[3],+m[2]-1,+m[1]):0;}

function verificarFrotaMontagemRbn_() {
  const st=formExpState_(formExpAux_(true)),fleet=formFleetOptions_(st);
  console.log(JSON.stringify({revisao:st.revision,montagens:Object.values(st.montages).map(m=>({nome:m.name,status:m.status,pedidos:Object.values(st.assignments).filter(a=>a.montageId===m.id).length})),veiculos:fleet.vehicles,motoristas:fleet.drivers.map(d=>d.name)}));
}

function formFleetHydrate_(st) {
  st.fleetVehicles = {};
  st.fleetDrivers = {};
  st.orderWeights = {};
  st.orderDeliveryDates = new Map();
  st.routeUnits = {};
  st.routePreferences = null;
  for (const m of Object.values(st.montages)) {
    Object.assign(m, { status: FORM_OPEN, vehicleId: '', driver: '', routingAt: '', routingBy: '', finalizedAt: '', finalizedBy: '',
      statusAt:m.createdAt, statusBy:m.owner, overweightOccurrences: [],
      compositionAt: '', vehicleSnapshot: null, capacitySnapshot: null, finalAlerts: [], route: null, deliveryDate: '', schedule: null });
  }
  for (const e of st.events) {
    const d = e.data || {};
    if (e.type === 'VEICULO_SALVAR') {
      const v = d.vehicle;
      st.fleetVehicles[v.plate] = {...v, updatedAt: e.at, by: e.by, source: 'Cadastro'};
      if (d.previousPlate && d.previousPlate !== v.plate) {
        st.fleetVehicles[d.previousPlate] = {...(d.previousVehicle || st.fleetVehicles[d.previousPlate]),
          plate: d.previousPlate, active: false, updatedAt: e.at, by: e.by};
        for (const m of Object.values(st.montages)) {
          if (m.status === FORM_OPEN && m.vehicleId === d.previousPlate) m.vehicleId = v.plate;
        }
      }
      const driverKey = logNorm_(v.defaultDriver);
      if (driverKey && !st.fleetDrivers[driverKey]) {
        st.fleetDrivers[driverKey] = {name: v.defaultDriver, active: true, updatedAt: e.at, by: e.by};
      }
    }
    if (e.type === 'MOTORISTA_SALVAR') {
      const driver = d.driver;
      const key = logNorm_(driver.name);
      st.fleetDrivers[key] = {...driver, by: e.by, updatedAt: e.at};
      if (d.previousDriver && logNorm_(d.previousDriver.name) !== key) {
        const oldKey = logNorm_(d.previousDriver.name);
        st.fleetDrivers[oldKey] = {...d.previousDriver, active: false, renamedTo: driver.name, by: e.by, updatedAt: e.at};
        for (const m of Object.values(st.montages)) {
          if (m.status === FORM_OPEN && logNorm_(m.driver) === oldKey) m.driver = driver.name;
        }
      }
    }
    if (e.type === 'PESOS_PEDIDOS') {
      for (const [key, weight] of Object.entries(d.weights || {})) {
        st.orderWeights[key] = {weight, version: (d.orderVersions || {})[key] || '',
          at: e.at, by: e.by, source: 'Informado na montagem'};
      }
    }
    if (e.type === 'UNIDADE_SALVAR') st.routeUnits[d.unit.id] = d.unit;
    if (e.type === 'ROTEIRIZACAO_CONFIGURAR') st.routePreferences = d.preferences;

    if (e.type === 'ENTREGA_DATA_SALVAR') {
      for (const id of d.montageIds) {
        const montage=st.montages[id];
        if(montage) montage.deliveryDate=d.deliveryDate;
      }
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(st.montages,e.to)) continue;
    const m = st.montages[e.to];
    if(e.type==='ADICIONAR' && m.status===FORM_ROUTING && d.routingUpdate){
      const update=d.routingUpdate;
      Object.assign(m,{compositionAt:e.at,capacitySnapshot:update.capacitySnapshot,finalAlerts:update.alerts||[]});
      if(m.vehicleSnapshot)m.vehicleSnapshot={...m.vehicleSnapshot,totalWeightKg:update.capacitySnapshot.totalWeightKg};
      if(update.route)m.route={...update.route,confirmed:false,at:e.at,by:e.by};
    }
    if (e.type === 'ENTREGA_PEDIDOS_SALVAR') {
      const dates = st.orderDeliveryDates.get(e.to) || new Map();
      for (const [key, date] of Object.entries(d.dates)) {
        if (date) dates.set(key, date);
        else dates.delete(key);
      }
      st.orderDeliveryDates.set(e.to, dates);
    }
    if (e.type === 'CRIAR' && d.company) m.company = d.company;
    if (e.type === 'CONFIGURAR_CARGA') {
      m.vehicleId = d.vehicleId;
      m.driver = d.driver;
    }
    if (e.type === 'ENVIAR_ROTEIRO' || e.type === 'FINALIZAR') {
      Object.assign(m, {status:FORM_ROUTING, routingAt:e.at, routingBy:e.by, statusAt:e.at, statusBy:e.by,
        vehicleSnapshot:d.vehicleSnapshot, capacitySnapshot:d.capacitySnapshot || null, finalAlerts:d.alerts || []});
      // O evento antigo registrava excesso mesmo antes da confirmação do roteiro.
      if (e.type === 'FINALIZAR') {
        const alert=(d.alerts||[]).find(a=>a.code==='CAPACIDADE_EXCEDIDA');
        formFleetRecordOverweight_(m,e,formFleetOverweight_(m,'') || (alert ? {...alert,reason:''} : null));
      }
    }
    if (e.type === 'REABRIR') {
      Object.assign(m, {status:FORM_OPEN, routingAt:'', routingBy:'', finalizedAt:'', finalizedBy:'',
        statusAt:e.at, statusBy:e.by, vehicleSnapshot:null, capacitySnapshot:null, finalAlerts:[], route:null});
    }
    if (e.type === 'CARGA_AGENDA_SALVAR') m.schedule = d.schedule;
    if (e.type === 'ROTEIRO_SALVAR') {
      if (d.route.confirmed && Object.prototype.hasOwnProperty.call(d, 'schedule')) m.schedule = d.schedule;
      m.route = {...d.route, at:e.at, by:e.by};
      if (d.route.confirmed && m.status !== FORM_FINAL) {
        Object.assign(m, {status:FORM_FINAL, finalizedAt:e.at, finalizedBy:e.by, statusAt:e.at, statusBy:e.by});
        // Para registros legados, conserva a ocorrência já registrada no evento FINALIZAR.
        const previous=m.overweightOccurrences.find(o=>o.at===m.routingAt);
        if (previous && d.overweight?.reason) Object.assign(previous,{reason:d.overweight.reason,reasonAt:e.at,reasonBy:e.by});
        if (!previous) formFleetRecordOverweight_(m,e,d.overweight || null);
      }
    }

  }
  return st;
}

function formFleetOptions_(st, includeInactive = false) {
  const history = formFleetHistory_();
  const drivers = {...history.drivers, ...st.fleetDrivers};
  const vehicles = Object.values({...history.vehicles, ...st.fleetVehicles}).map(v => {
    const preferred = drivers[logNorm_(v.defaultDriver)];
    return {...v, defaultDriver: preferred?.renamedTo || v.defaultDriver || ''};
  });
  const eligible = x => includeInactive || x.active !== false;
  return {
    vehicles: vehicles.filter(eligible).sort((a,b) => a.plate.localeCompare(b.plate)),
    drivers: Object.values(drivers).filter(eligible).sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'))
  };
}

function formFleetCapacity_(members, vehicle) {
  const known = members.filter(o => o.weight != null && !o.weightIncomplete);
  const knownWeightKg = Math.round(known.reduce((sum,o) => sum + o.weight, 0) * 1000) / 1000;
  const unknownOrders = members.length - known.length;
  const capacityKg = Number(vehicle?.capacityKg) > 0 ? Number(vehicle.capacityKg) : null;
  return {
    knownWeightKg,
    totalWeightKg: unknownOrders ? null : knownWeightKg,
    unknownOrders,
    capacityKg,
    overCapacity: capacityKg != null && knownWeightKg > capacityKg,
    remainingKg: capacityKg == null || unknownOrders ? null : capacityKg - knownWeightKg
  };
}

function formFleetWarnings_(m) {
  const alerts = [];
  if (!m.vehicle) alerts.push({code:'VEICULO_NAO_DEFINIDO'});
  if (!m.driver) alerts.push({code:'MOTORISTA_NAO_DEFINIDO'});
  if (m.vehicle && !m.vehicle.type) alerts.push({code:'TIPO_VEICULO_NAO_INFORMADO'});
  if (m.sourceIssues) alerts.push({code:'PEDIDOS_COM_PENDENCIA_NA_ORIGEM', orders:m.sourceIssues});
  if (m.vehicle && !formFleetValidPlate_(m.vehicle.plate)) {
    alerts.push({code:'PLACA_FORA_DO_PADRAO',plate:m.vehicle.plate});
  }
  if (m.unknownOrders) alerts.push({code: 'PESO_INCOMPLETO', orders: m.unknownOrders, knownWeightKg: m.knownWeightKg});
  if (m.vehicleId && !m.capacityKg) alerts.push({code: 'CAPACIDADE_NAO_INFORMADA'});
  if (m.overCapacity) alerts.push({code: 'CAPACIDADE_EXCEDIDA', knownWeightKg: m.knownWeightKg,
    capacityKg: m.capacityKg, excessKg: Math.round((m.knownWeightKg-m.capacityKg)*1000)/1000});
  return alerts;
}

function formFleetEnhance_(view, st) {
  const allFleet = formFleetOptions_(st, true);
  view.fleet = {
    vehicles: allFleet.vehicles.filter(v => v.active !== false),
    drivers: allFleet.drivers.filter(d => d.active !== false)
  };
  view.routing = formRouteSettings_(st);
  view.assemblyCompanies = Object.entries(FORM_COMPANIES).map(([code,name]) => ({code,name}));
  view.googleMapsKey = formRouteMapsKey_();
  const routeOrders = formRouteOrders_(st);
  const byKey = {};
  for (const o of view.orders) {
    const w = st.orderWeights[o.key];
    if (w && (w.version === o.version || w.version === o.previousVersion)) {
      Object.assign(o, {weight: w.weight, weightIncomplete: false, weightSource: w.source, weightAt: w.at});
    } else if (w && o.weightIncomplete) {
      Object.assign(o, {weight: null, weightIncomplete: true,
        weightNote: 'O pedido foi atualizado. Confira e informe o peso novamente.'});
    }
    if (routeOrders[o.key]) o.deliveryStop = routeOrders[o.key];
    if (st.montages[o.montageId]?.status === FORM_FINAL) {
      o.deliveryDate = st.orderDeliveryDates.get(o.montageId)?.get(o.key) || '';
    }
    byKey[o.key] = o;
    const row = o.sourceRows[0];
    if (row) Object.assign(row, {weight:o.weight, availableWeight:o.montageId ? 0 : o.weight,
      mountedWeight:o.montageId ? o.weight : 0});
  }

  for (const m of view.montages) {
    const stored = st.montages[m.id];
    const closed = stored.status !== FORM_OPEN;
    const members = m.orderKeys.map(k => byKey[k]);
    const vehicle = (closed && stored.vehicleSnapshot) || allFleet.vehicles.find(v => v.plate === stored.vehicleId);
    const capacity = (closed && stored.capacitySnapshot) || formFleetCapacity_(members, vehicle);
    Object.assign(m, capacity, {vehicle:vehicle || null, vehicleId:stored.vehicleId, driver:stored.driver,
      finalizedAt:stored.finalizedAt, weight:capacity.totalWeightKg});
    m.alerts = closed && stored.capacitySnapshot ? stored.finalAlerts : formFleetWarnings_(m);
    m.finishReasons = [];
    if (!m.orders) m.finishReasons.push('Adicione pedidos');
    m.canFinalize = !closed && !m.finishReasons.length;
  }
  view.mapRows = view.orders.map(o => o.sourceRows[0]);
  return view;
}

function formFleetSaveVehicle_(fleet, p) {
  const previousPlate = formFleetPlate_(p.previousPlate);
  const previous = fleet.vehicles.find(v => v.plate === previousPlate);
  const raw = p.vehicle || {};
  if (previousPlate && !previous) throw new Error('Veículo não encontrado.');
  if (typeof p.active === 'boolean') {
    if (!previous) throw new Error('Selecione o veículo que deseja atualizar.');
    return {vehicle: {...previous, active: p.active}};
  }

  const plate = formFleetPlate_(raw.plate);
  const type = logText_(raw.type).toUpperCase();
  const capacityKg = raw.capacityKg == null || raw.capacityKg === '' ? null : Number(raw.capacityKg);
  const defaultDriver = logText_(raw.defaultDriver);
  if (!formFleetValidPlate_(plate)) throw new Error('Informe uma placa válida, como ABC1D23 ou ABC1234.');
  if (!type || type.length > 60) throw new Error('Informe o tipo do veículo.');
  if (capacityKg != null && (!Number.isFinite(capacityKg) || capacityKg <= 0 || capacityKg > 100000)) {
    throw new Error('Informe a capacidade de carga em kg, maior que zero e até 100.000.');
  }
  if (plate !== previousPlate && fleet.vehicles.some(v => v.plate === plate)) {
    throw new Error('Já existe um veículo com essa placa. Abra o cadastro existente para editar.');
  }
  const driver = fleet.drivers.find(d => logNorm_(d.name) === logNorm_(defaultDriver));
  if (defaultDriver && (!driver || driver.active === false) && defaultDriver !== previous?.defaultDriver) {
    throw new Error('Selecione um motorista ativo ou deixe o motorista padrão em branco.');
  }
  return {vehicle:{plate,type,capacityKg,defaultDriver:driver?.name || defaultDriver,
    active:previous?.active !== false}, previousPlate, previousVehicle:previous || null};
}

function formFleetSaveDriver_(fleet, p) {
  const previousKey = logNorm_(p.previousName);
  const previous = fleet.drivers.find(d => logNorm_(d.name) === previousKey);
  if (previousKey && !previous) throw new Error('Motorista não encontrado.');
  if (typeof p.active === 'boolean') {
    if (!previous) throw new Error('Selecione o motorista que deseja atualizar.');
    return {driver:{...previous, active:p.active}};
  }
  const name = logText_(p.driver?.name).toUpperCase();
  const key = logNorm_(name);
  if (name.length < 2 || name.length > 100) throw new Error('Informe o nome do motorista.');
  if (key !== previousKey && fleet.drivers.some(d => logNorm_(d.name) === key)) {
    throw new Error('Já existe um motorista com esse nome.');
  }
  return {driver:{name, active:previous?.active !== false}, previousDriver:previous || null};
}

function formFleetSaveWeights_(p, keys) {
  if (!p.weights || typeof p.weights !== 'object' || Array.isArray(p.weights)) {
    throw new Error('Informe os pesos dos pedidos.');
  }
  const entries = Object.entries(p.weights);
  if (!entries.length || entries.length > 100) throw new Error('Informe até 100 pesos por vez.');
  const weights = {}, orderVersions = {};
  for (const [key, value] of entries) {
    if (!keys.includes(key)) throw new Error('Pedido fora desta montagem.');
    const weight = Number(value);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) {
      throw new Error('Informe pesos válidos em kg, maiores que zero e até 100.000.');
    }
    const version = String(p.orderVersions?.[key] || '');
    if (!/^[0-9a-f]{24}$/.test(version)) throw new Error('Atualize os pedidos antes de informar seus pesos.');
    weights[key] = weight;
    orderVersions[key] = version;
  }
  return {weights, orderVersions};
}

function formFleetRoutingView_(st, catalog, user) {
  if (catalog) return formDirectView_(st, catalog, user);
  const saved = formDirectSnapshot_(st), assigned = {};
  for (const key of Object.keys(st.assignments)) {
    if (saved[key]) assigned[key] = saved[key];
  }
  return formDirectView_(st, assigned, user);
}

function formFleetFinish_(st, catalog, user, p, target) {
  if (p.confirmed !== true) throw new Error('Confirme o envio para roteirização.');
  const item = formFleetRoutingView_(st, catalog, user).montages.find(m => m.id === target);
  if (!item?.canFinalize) throw new Error(item?.finishReasons.join(' · ') || 'Montagem indisponível para roteirização.');
  const {knownWeightKg,totalWeightKg,unknownOrders,capacityKg,overCapacity,remainingKg} = item;
  return {
    vehicleSnapshot:item.vehicle ? {...item.vehicle, driver:item.driver, totalWeightKg} : null,
    capacitySnapshot:{knownWeightKg,totalWeightKg,unknownOrders,capacityKg,overCapacity,remainingKg},
    alerts:catalog ? item.alerts : [...item.alerts,{code:'ORIGEM_NAO_CONFERIDA'}]
  };
}

function formMontageDelivery_(st,user,p) {
  const montageIds=p.montageIds;
  if(!Array.isArray(montageIds)||!montageIds.length||montageIds.length>100||
     montageIds.some(id=>typeof id!=='string')||new Set(montageIds).size!==montageIds.length) {
    throw new Error('Selecione de 1 a 100 montagens distintas.');
  }
  const date=p.deliveryDate;
  deliveryDate_(date,'America/Fortaleza');
  for(const id of montageIds){
    const montage=formFleetCanManage_(user,st,id);
    if(montage.status!==FORM_FINAL)throw new Error('Atualize a data somente em montagens finalizadas.');
  }
  return {montageIds,deliveryDate:date};
}

function formOrderDelivery_(st, user, target, input) {
  const montage = formFleetCanManage_(user, st, target);
  if (montage.status !== FORM_FINAL) throw new Error('Atualize as datas somente em montagens finalizadas.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) {
    throw new Error('Informe a data de pelo menos um pedido.');
  }
  for (const [key, date] of Object.entries(input)) {
    if (st.assignments[key]?.montageId !== target) throw new Error('Pedido fora desta montagem.');
    if (date !== '') deliveryDate_(date, 'America/Fortaleza');
  }
  return {dates: input};
}

function formCargoSchedule_(input, montage) {
  const departure = input?.departure ?? '';
  const expectedEnd = input?.expectedEnd ?? '';
  if (departure === '' && expectedEnd === '') return null;
  if (!departure || !expectedEnd || logDate_(departure) !== departure || logDate_(expectedEnd) !== expectedEnd) {
    throw new Error('Informe a data de saída e a previsão de finalização da carga.');
  }
  if (expectedEnd < departure) throw new Error('A previsão de finalização deve ser igual ou posterior à saída.');
  if (!montage.driver) throw new Error('Defina o motorista antes de programar a carga.');
  return {departure, expectedEnd};
}

function formFleetApi_(user, p) {
  formExpAccess_(user,'edit');
  if (p.action!=='fleetSave'||!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||''))) {
    throw new Error('Identificador de operação inválido.');
  }
  const operation=p.operation;
  const settings=FORM_FLEET_SETTINGS;
  if (![...settings,'CONFIGURAR_CARGA','PESOS_PEDIDOS','FINALIZAR','ENVIAR_ROTEIRO','REABRIR','ROTEIRO_SALVAR','ENTREGA_DATA_SALVAR','ENTREGA_PEDIDOS_SALVAR','CARGA_AGENDA_SALVAR'].includes(operation)) {
    throw new Error('Operação inválida.');
  }
  const editingSettings=settings.includes(operation), savingDelivery=operation==='ENTREGA_DATA_SALVAR';
  const savingOrderDelivery = operation === 'ENTREGA_PEDIDOS_SALVAR';
  const savingSchedule = operation === 'CARGA_AGENDA_SALVAR';
  const target=editingSettings||savingDelivery?'':String(p.target||'');
  const sendingToRouting=['FINALIZAR','ENVIAR_ROTEIRO'].includes(operation);
  if(editingSettings&&platformAccess_(user).transportOnly)throw new Error('Configurações fora do seu perfil.');
  const timing=centralTiming_('formacao.'+operation);
  let status='erro';
  try {
    const ss=formExpAux_(true), initial=formExpState_(ss);
    if (initial.requests[p.requestId]) {
      status='repetido';
      return formAssemblyRetry_(initial,p.requestId);
    }
    let catalog=null, sourceState='';
    if (!editingSettings) {
      // O retorno imediato reaproveita o catálogo se estiver disponível.
      try {
        sourceState=formDirectSourceState_();
        catalog=formDirectReadCatalog_(sourceState,false,[],true);
        formDirectGuard_(sourceState);
      } catch (error) {
        catalog=null;
      }
    }
    timing.mark('origem');
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(3000))throw new Error('Outra gravação está em andamento. Seus dados foram mantidos. Tente novamente em instantes.');
    timing.mark('fila');
    let st, projectionWarning, routeEdited=false;
    try {
      st=formExpState_(ss);
      if(st.requests[p.requestId]){
        status='repetido';
        return formAssemblyRetry_(st,p.requestId);
      }
      if(Number(p.revision)!==st.revision)throw new Error('O cadastro ou a montagem foi atualizado. Recarregue a tela e confira antes de salvar.');
    let keys = [], data;
    if (operation === 'VEICULO_SALVAR') data = formFleetSaveVehicle_(formFleetOptions_(st, true), p);
    if (operation === 'MOTORISTA_SALVAR') data = formFleetSaveDriver_(formFleetOptions_(st, true), p);
    if (operation === 'UNIDADE_SALVAR') data = {unit:formRouteUnit_(st, p.unit || {})};
    if (operation === 'ROTEIRIZACAO_CONFIGURAR') data = {preferences:formRoutePreferences_(st, p.preferences || {})};
    if (savingDelivery) data = formMontageDelivery_(st,user,p);
    if (savingOrderDelivery) {
      data = formOrderDelivery_(st, user, target, p.dates);
      keys = Object.keys(data.dates);
    }
    if (savingSchedule) {
      const montage = formFleetCanManage_(user, st, target);
      if (montage.status !== FORM_FINAL || !montage.route?.confirmed) {
        throw new Error('Confirme o roteiro antes de programar a carga.');
      }
      data = {schedule: formCargoSchedule_(p.schedule, montage)};
    }
    if (!editingSettings && !savingDelivery && !savingOrderDelivery && !savingSchedule) {
      const m = formFleetCanManage_(user, st, target);
      keys = Object.keys(st.assignments).filter(k => st.assignments[k].montageId === target);
      if (m.status !== FORM_OPEN && !['REABRIR','ROTEIRO_SALVAR'].includes(operation)) {
        throw new Error('Reabra a montagem para alterar a composição.');
      }
      if (operation === 'CONFIGURAR_CARGA') {
        const fleet = formFleetOptions_(st, true);
        const vehicle = fleet.vehicles.find(v => v.plate === p.vehicleId && (v.active !== false || v.plate === m.vehicleId));
        const driver = fleet.drivers.find(d => logNorm_(d.name) === logNorm_(p.driver)
          && (d.active !== false || logNorm_(d.name) === logNorm_(m.driver)));
        if (!vehicle || !driver) throw new Error('Selecione um veículo e um motorista disponíveis.');
        data = {vehicleId:vehicle.plate, driver:driver.name};
      }
      if (operation === 'PESOS_PEDIDOS') data = formFleetSaveWeights_(p, keys);
      if (sendingToRouting) {
        // A montagem já guarda os pedidos selecionados. A atualização comercial pode terminar depois do envio.
        if (catalog) {
          try { formDirectGuard_(sourceState); } catch (error) { catalog=null; }
        }
        data = formFleetFinish_(st, catalog, user, p, target);
      }
      if (operation === 'REABRIR') {
        if (m.status === FORM_OPEN || p.confirmed !== true) throw new Error('Confirme a reabertura da montagem.');
        data = {};
      }
      if (operation === 'ROTEIRO_SALVAR') {
        const route=formRouteSaveData_(st, m, keys, p.route || {});
        routeEdited = m.status === FORM_FINAL;
        const reason=logText_(p.route?.overweightReason);
        if (reason.length>500) throw new Error('A justificativa deve ter até 500 caracteres.');
        const finalizing = m.status !== FORM_FINAL && route.confirmed;
        data={route, routeEdited, overweight:finalizing ? formFleetOverweight_(m,reason) : null};
        if (finalizing && p.route.schedule !== undefined) {
          data.schedule = formCargoSchedule_(p.route.schedule, m);
        }
      }
    }
      const event={id:p.requestId,revision:st.revision+1,at:new Date().toISOString(),by:user.login,type:operation==='FINALIZAR'?'ENVIAR_ROTEIRO':operation,keys,from:{},to:target,data};
      timing.mark('validacao');
      projectionWarning=formProjectionCommit_(ss,st,event,timing);
    } finally {
      lock.releaseLock();
    }
    let view=null, settingsView=null;
    try {
      if(editingSettings) settingsView=formRouteSettingsView_(st);
      else if(sendingToRouting||savingDelivery||savingOrderDelivery||savingSchedule) view=formFleetRoutingView_(st,catalog,user);
      else if(catalog){
        formDirectGuard_(sourceState);
        view=formDirectView_(st,catalog,user);
      }
    } catch(error){
      console.warn('Alteração gravada. Atualização da tela pendente.');
    }
    timing.mark('resposta');
    status=projectionWarning?'abas_pendentes':'ok';
    const message={
      FINALIZAR:'Montagem enviada para roteirização.',
      ENVIAR_ROTEIRO:'Montagem enviada para roteirização.',
      REABRIR:'Montagem reaberta para ajustes.',
      ENTREGA_DATA_SALVAR:'Data de entrega salva.',
      ENTREGA_PEDIDOS_SALVAR:'Datas de entrega dos pedidos salvas.',
      CARGA_AGENDA_SALVAR:st.montages[target]?.schedule?'Agenda do motorista atualizada.':'Programação da carga removida da agenda.',
      ROTEIRO_SALVAR:routeEdited?'Ordem e endereços atualizados.':st.montages[target]?.route?.confirmed?'Roteiro confirmado. Montagem finalizada.':'Rascunho do roteiro salvo.'
    }[operation]||'Informações salvas.';
    return {ok:true,revision:st.revision,montageId:target,projectionWarning,message,view,settings:settingsView,
      ...(operation==='ROTEIRO_SALVAR'?{route:st.montages[target].route}:{})};
  } finally {
    timing.finish(status);
  }
}

function formAuxSafeCell_(v) {
  return typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v;
}

// ── 19. Roteirização e prioridades de carga ──
// Mantém as unidades de saída e a ordem das paradas e consulta os pesos em aberto.

// As unidades, preferências e paradas são reconstruídas pelo histórico da auxiliar.
function formRouteSettings_(st) {
  const units = Object.values(st.routeUnits || {}).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const preferences = st.routePreferences || { defaultUnitId: '', returnToUnit: false, groupAddresses: true };
  return { units, ...preferences };
}

function formRouteMapsKey_() {
  const key = String(PropertiesService.getScriptProperties().getProperty('RBN_MAPS_BROWSER_KEY') || '').trim();
  return /^[A-Za-z0-9_-]{25,100}$/.test(key) ? key : '';
}

function formRouteSettingsRead_(user) {
  formExpAccess_(user);
  return formRouteSettingsView_(formExpState_(formExpAux_(true)));
}

function formRouteSettingsView_(st) {
  return { ok: true, revision: st.revision, fleet: formFleetOptions_(st, true),
    routing: formRouteSettings_(st), googleMapsConfigured: Boolean(formRouteMapsKey_()) };
}

function formRouteUnit_(st, raw) {
  const name = logText_(raw.name);
  const address = logText_(raw.address);
  if (!name || name.length > 100 || !address || address.length > 240) {
    throw new Error('Informe o nome da unidade e o endereço completo, incluindo cidade e UF.');
  }
  if (raw.id && !Object.prototype.hasOwnProperty.call(st.routeUnits, raw.id)) {
    throw new Error('Unidade de saída não encontrada.');
  }
  return { id: raw.id || 'unit_' + Utilities.getUuid(), name, address, company: formAssemblyCompany_(raw.company) };
}

function formRoutePreferences_(st, raw) {
  const defaultUnitId = String(raw.defaultUnitId || '');
  if (defaultUnitId && !Object.prototype.hasOwnProperty.call(st.routeUnits, defaultUnitId)) {
    throw new Error('Selecione uma unidade de saída cadastrada.');
  }
  return { defaultUnitId, returnToUnit: raw.returnToUnit === true, groupAddresses: raw.groupAddresses !== false };
}

function formRouteSaveData_(st, montage, keys, input) {
  const editingConfirmed = montage.status === FORM_FINAL && montage.route?.confirmed;
  if (montage.status !== FORM_ROUTING && !(editingConfirmed && input.confirmed === true)) {
    throw new Error('A montagem precisa estar aguardando roteirização ou ter um roteiro confirmado.');
  }
  if (String(input.baseAt || '') !== (montage.route?.at || '') || (input.routingAt ?? input.finalizedAt) !== montage.routingAt) {
    throw new Error('O roteiro ou a montagem mudou. Atualize a tela e confira a sequência.');
  }
  if (!Array.isArray(input.stops) || !input.stops.length || input.stops.length > keys.length) {
    throw new Error('Inclua todos os pedidos da montagem no roteiro.');
  }

  const remaining = new Set(keys);
  const stops = [];
  const groups = new Map();
  const confirmed = input.confirmed === true;
  const groupAddresses = input.groupAddresses !== false;
  for (const raw of input.stops) {
    if (!raw || !Array.isArray(raw.keys) || !raw.keys.length) throw new Error('Parada sem pedidos.');
    for (const key of raw.keys) {
      if (!remaining.delete(key)) throw new Error('Pedido duplicado ou fora desta montagem.');
    }
    const address = logText_(raw.address);
    if (address.length > 240) throw new Error('O endereço da parada deve ter até 240 caracteres.');
    const group = address && groupAddresses ? logNorm_(address).replace(/\s+/g, ' ') : '';
    if (group && groups.has(group)) {
      groups.get(group).keys.push(...raw.keys);
    } else {
      const stop = { keys: raw.keys.slice(), address };
      stops.push(stop);
      if (group) groups.set(group, stop);
    }
  }
  if (remaining.size) throw new Error('Há pedidos da montagem sem parada.');

  const unitId = String(input.unitId || '');
  if (unitId && !Object.prototype.hasOwnProperty.call(st.routeUnits, unitId)) {
    throw new Error('Selecione uma unidade de saída cadastrada.');
  }
  const unit = unitId ? st.routeUnits[unitId] : null;
  if (confirmed && !unit) throw new Error('Escolha a unidade de saída para confirmar o roteiro.');
  if (unit && montage.company && unit.company !== montage.company) {
    throw new Error('Escolha uma unidade de saída de ' + FORM_COMPANIES[montage.company] + '.');
  }
  return { unit, returnToUnit: input.returnToUnit === true, groupAddresses, confirmed, stops };
}

function formRouteOrders_(st) {
  const byOrder = {};
  for (const m of Object.values(st.montages)) {
    if (m.status !== FORM_FINAL || !m.route?.confirmed) continue;
    m.route.stops.forEach((stop, index) => {
      for (const key of stop.keys) byOrder[key] = { number: index + 1, address: stop.address };
    });
  }
  return byOrder;
}

// A prioridade por peso vem da planilha operacional, sem misturar pedidos comerciais.
function formPriorityRead_(user) {
  formExpAccess_(user);
  const id = PropertiesService.getScriptProperties().getProperty('LOG_OPERATIONS_ID') || LOGISTICS_SOURCES.operations;
  const ss = SpreadsheetApp.openById(id);
  const sh = ss.getSheetByName('FORMAÇÃO 2026');
  if (!sh || sh.getLastRow() < 2) throw new Error('Aba FORMAÇÃO 2026 não encontrada.');
  const grid = sh.getRange(1, 1, sh.getLastRow(), 23).getValues();
  const statusColumn = grid[1].findIndex(value => logNorm_(value) === 'STATUS DA ENTREGA');
  if (statusColumn < 0) throw new Error('Coluna STATUS DA ENTREGA não encontrada.');
  const regions = ss.getSheetByName('CADASTRO REGIAO')?.getDataRange().getValues() || [];
  const rows = logRecords_(grid, 'operations', ss.getSpreadsheetTimeZone(), regions)
    .filter(r => {
      const rowNumber = Number(String(r.id).replace(/^op_/, ''));
      return grid[rowNumber - 1] && !logText_(grid[rowNumber - 1][statusColumn])
        && logisticsRowAllowed_(user, r, 'operations');
    })
    .map(r => ({...r, awaitingFormation: true}));
  return { ok: true, rows };
}

function verificarLogisticaRbn_() {
  const user = {perfil:'ADMIN', login:'diagnostico'};
  const st = formExpState_(formExpAux_(true));
  const settings = formRouteSettings_(st);
  const priority = formPriorityRead_(user);
  const fleet = formFleetOptions_(st, true);
  console.log(JSON.stringify({
    revisao: st.revision,
    montagens: Object.values(st.montages).map(m => ({nome:m.name,status:m.status,
      pedidos:Object.values(st.assignments).filter(a => a.montageId===m.id).length})),
    veiculos: fleet.vehicles.length, motoristas: fleet.drivers.length, unidades:settings.units.length,
    mapaConfigurado: Boolean(formRouteMapsKey_()),
    aguardando: priority.rows.length, pesoKg: priority.rows.reduce((sum,r) => sum+(Number(r.weight)||0),0)
  }));
}

// ── 20. Desempenho e leitura comercial ──
// Mede o tempo das operações e organiza consultas paginadas e dados em cache.

function centralTiming_(operation) {
  const start = Date.now(), stages = {};
  let checkpoint = start;
  return {
    mark(stage) {
      const now = Date.now();
      stages[stage] = now - checkpoint;
      checkpoint = now;
    },
    finish(status) {
      console.log(JSON.stringify({central:operation, status, ms:Date.now()-start, stages}));
    }
  };
}

// Cada publicação tem chaves próprias. Leitores ignoram gerações incompletas.
function centralCacheRead_(cache, key, unpack = JSON.parse) {
  try {
    const meta = JSON.parse(cache.get(key) || 'null');
    if (!meta || !/^[0-9a-f]{32}$/.test(meta.id) || !Number.isInteger(meta.parts) || meta.parts < 1 || meta.parts > 80) return null;
    const keys = Array.from({length:meta.parts}, (_, i)=>key+'_'+meta.id+'_'+i);
    const chunks = cache.getAll(keys);
    if (!keys.every(k=>typeof chunks[k]==='string')) return null;
    const packed = keys.map(k=>chunks[k]).join('');
    const blob = Utilities.newBlob(Utilities.base64Decode(packed), 'application/gzip');
    const text = Utilities.ungzip(blob).getDataAsString('UTF-8');
    return unpack(text);
  } catch (error) {
    return null;
  }
}

function centralCacheWrite_(cache, key, text, seconds, details = {}) {
  try {
    const packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text, 'application/json')).getBytes());
    const size = 90000, count = Math.ceil(packed.length/size);
    if (!count || count > 80) return;
    const id = Utilities.getUuid().replace(/-/g, ''), chunks = {};
    for (let i=0; i<count; i++) chunks[key+'_'+id+'_'+i] = packed.slice(i*size, (i+1)*size);
    cache.putAll(chunks, seconds);
    cache.put(key, JSON.stringify({...details,id,parts:count}), seconds);
  } catch (error) {
    console.warn('Cache temporário da Central indisponível.');
  }
}

// Limita o número de chamadas ao Sheets sem ler grandes intervalos vazios.
function centralRowBlocks_(numbers, limit = 8, gap = 24) {
  const rows = [...new Set(numbers)].sort((a,b)=>a-b);
  if (!rows.length) return [];
  const breaks = rows.slice(1).map((row,i)=>({row, distance:row-rows[i]}))
    .filter(x=>x.distance > gap).sort((a,b)=>b.distance-a.distance).slice(0,limit-1);
  const starts = new Set(breaks.map(x=>x.row)), blocks = [];
  for (const row of rows) {
    if (!blocks.length || starts.has(row)) blocks.push({first:row,last:row});
    else blocks[blocks.length-1].last = row;
  }
  return blocks;
}

function centralToday_(tz) {
  return Utilities.formatDate(new Date(), tz || 'America/Fortaleza', 'yyyy-MM-dd');
}

function centralCommercialPage_(user, payload) {
  const timing=centralTiming_('comercial.pagina');
  let status='erro';
  try{
    const result=datasetPage_(payload.offset,payload.limit);
    result.records=result.records.filter(row=>userAllowsRecord_(user,row));
    timing.mark('planilha');
    if(payload.compressed===true&&result.records.length){
      try{
        const json=JSON.stringify(result.records);
        const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json,'application/json')).getBytes());
        if(packed.length<json.length){result.gzip=packed;delete result.records;}
      }catch(error){console.warn('Página comercial enviada no formato comum.');}
      timing.mark('resposta');
    }
    status='ok';
    return result;
  }finally{
    timing.finish(status);
  }
}

// ── 21. Resumos da planilha auxiliar ──
// Atualiza os resumos das montagens e permite reconstruí-los a partir dos eventos gravados.

function iniciarOperacaoRealRebanho_() {
  const owner=Session.getEffectiveUser().getEmail();
  if(!owner||Session.getActiveUser().getEmail()!==owner)throw new Error('Execute com a conta responsável pelo projeto.');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('Outra gravação está em andamento.');
  try {
    const ss=formExpAux_(true),st=formExpState_(ss);
    const id='inicio_operacao_real_20261109';
    if(st.requests[id]){
      const active=st.events.find(e=>e.id===id);
      console.log(JSON.stringify({alreadyApplied:true,backup:active?.data.backup||'',montagensAtivas:Object.keys(st.montages).length}));
      return;
    }
    const journal=ss.getSheetByName('HISTORICO_MOVIMENTACOES');
    const at=new Date();
    const backup=journal.copyTo(ss).setName('ARQUIVO_MONTAGENS_'+Utilities.formatDate(at,'America/Fortaleza','yyyyMMdd_HHmmss'));
    SpreadsheetApp.flush();
    if(backup.getLastRow()!==journal.getLastRow())throw new Error('A cópia do histórico não foi confirmada.');
    const archived=Object.keys(st.montages).length;
    const event={id,revision:st.revision+1,at:at.toISOString(),by:owner,type:'INICIAR_OPERACAO_REAL',
      keys:[],from:{},to:'',data:{backup:backup.getName(),archived}};
    const timing=centralTiming_('formacao.inicioOperacaoReal');
    const projectionWarning=formProjectionCommit_(ss,st,event,timing);
    timing.finish(projectionWarning?'abas_pendentes':'ok');
    console.log(JSON.stringify({ok:true,backup:backup.getName(),archived,montagensAtivas:Object.keys(st.montages).length,sequencial:st.sequence,projectionWarning}));
  } finally {
    lock.releaseLock();
  }
}

const FORM_PROJECTION_TABLES = {
  INICIAR_OPERACAO_REAL: ['MONTAGENS','MONTAGEM_PEDIDOS','ROTEIROS_PARADAS','VINCULOS_FONTES'],
  ENTREGA_DATA_SALVAR: ['MONTAGENS'],
  ENTREGA_PEDIDOS_SALVAR: ['MONTAGEM_PEDIDOS'],
  CARGA_AGENDA_SALVAR: ['MONTAGENS'],
  CRIAR: ['MONTAGENS','MONTAGEM_PEDIDOS'],
  ADICIONAR: ['MONTAGENS','MONTAGEM_PEDIDOS','ROTEIROS_PARADAS'],
  TRANSFERIR: ['MONTAGEM_PEDIDOS'],
  REMOVER: ['MONTAGEM_PEDIDOS'],
  RENOMEAR: ['MONTAGENS'],
  CONFIGURAR_CARGA: ['MONTAGENS'],
  PESOS_PEDIDOS: ['MONTAGEM_PEDIDOS'],
  FINALIZAR: ['MONTAGENS'],
  ENVIAR_ROTEIRO: ['MONTAGENS'],
  REABRIR: ['MONTAGENS','MONTAGEM_PEDIDOS','ROTEIROS_PARADAS'],
  ROTEIRO_SALVAR: ['MONTAGENS','MONTAGEM_PEDIDOS','ROTEIROS_PARADAS'],
  VEICULO_SALVAR: ['VEICULOS','MOTORISTAS','MONTAGENS'],
  MOTORISTA_SALVAR: ['MOTORISTAS','MONTAGENS'],
  UNIDADE_SALVAR: ['UNIDADES_LOGISTICAS'],
  ROTEIRIZACAO_CONFIGURAR: ['CONFIG_LOGISTICA']
};

function formProjectionMarker_(ss) {
  return 'FORM_PROJECTION_PENDING_' + ss.getId();
}

function formProjectionWrite_(ss, name, headers, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const last = sh.getLastRow(), max = sh.getMaxRows();
  if (max < rows.length+1) sh.insertRowsAfter(max, rows.length+1-max);
  if (last) {
    const existing = sh.getRange(1,1,1,headers.length).getDisplayValues()[0];
    if (existing.some((value,i)=>value && value!==headers[i])) throw new Error('Cabeçalhos divergentes: '+name);
    if (existing.some((value,i)=>value!==headers[i])) sh.getRange(1,1,1,headers.length).setValues([headers]);
    if (rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows.map(row=>row.map(formAuxSafeCell_)));
  } else {
    sh.getRange(1,1,rows.length+1,headers.length).setValues([headers,...rows.map(row=>row.map(formAuxSafeCell_))]);
    sh.setFrozenRows(1);
  }
  if (last>rows.length+1) sh.getRange(rows.length+2,1,last-rows.length-1,headers.length).clearContent();
}

function formProjectionUpdate_(ss, st, tables) {
  if(tables.includes('VINCULOS_FONTES'))formProjectionWrite_(ss,'VINCULOS_FONTES',FORM_EXP_SCHEMA.VINCULOS_FONTES,
    Object.entries(st.links).flatMap(([key,link])=>link.sourceKeys.map(source=>[key,source,link.at,link.by])));
  if (tables.includes('MONTAGENS')) {
    const vehicles = new Map(formFleetOptions_(st,true).vehicles.map(vehicle=>[vehicle.plate,vehicle]));
    formProjectionWrite_(ss,'MONTAGENS',[
      ...FORM_EXP_SCHEMA.MONTAGENS,'PLACA','TIPO_VEICULO','MOTORISTA','CAPACIDADE_KG','FINALIZADO_EM','SITUACAO_ROTEIRO','EMPRESA_SAIDA','ROTEIRIZACAO_INICIADA_EM','ROTEIRIZACAO_INICIADA_POR','FINALIZADO_POR','STATUS_ATUALIZADO_EM','STATUS_ATUALIZADO_POR','EXCESSO_PESO_JSON','DATA_ENTREGA','DATA_SAIDA','PREVISAO_FINALIZACAO'
    ],Object.values(st.montages).map(m=>{
      const v=m.vehicleSnapshot||vehicles.get(m.vehicleId)||{};
      const routeStatus=m.status===FORM_FINAL?'Confirmado':m.status===FORM_ROUTING?(m.route?'Rascunho':'Pendente'):'';
      return [m.id,m.name,m.createdAt,m.owner,m.status,m.vehicleId,v.type||'',m.driver,v.capacityKg||'',m.finalizedAt,routeStatus,FORM_COMPANIES[m.company]||'',m.routingAt,m.routingBy,m.finalizedBy,m.statusAt,m.statusBy,
        JSON.stringify(m.overweightOccurrences).length<=44000?JSON.stringify(m.overweightOccurrences):'Consultar ocorrências no histórico',m.deliveryDate||'',
        m.schedule?.departure||'',m.schedule?.expectedEnd||''];
    }));
  }
  if (tables.includes('MONTAGEM_PEDIDOS')) {
    const saved=formDirectSnapshot_(st), routeOrders=formRouteOrders_(st);
    formProjectionWrite_(ss,'MONTAGEM_PEDIDOS',[
      ...FORM_EXP_SCHEMA.MONTAGEM_PEDIDOS,'CLIENTE_CODIGO','CLIENTE','CIDADE','UF','DATA_PEDIDO','STATUS_COMERCIAL','PESO_KG','VOLUMES','ITENS_JSON','FONTE','VERSAO_FONTE','ORDEM_ENTREGA','ENDERECO_ENTREGA','DATA_ENTREGA'
    ],Object.entries(st.assignments).map(([key,a])=>{
      const o=saved[key], route=routeOrders[key], base=[a.montageId,formExpParseKey_(key).order,key,a.at,a.by];
      const details = o ? [o.clientCode,o.client,o.city,o.uf,o.date,o.statuses.join(' / '),(st.orderWeights[key]&&[o.version,o.previousVersion].includes(st.orderWeights[key].version)?st.orderWeights[key].weight:o.weight)??'',formDirectVolumes_(o)??'',JSON.stringify(o.products),'FORCA_DE_VENDAS',o.version] : Array(11).fill('');
      const date = st.montages[a.montageId]?.status === FORM_FINAL ? st.orderDeliveryDates.get(a.montageId)?.get(key) || '' : '';
      return base.concat(details, route?.number || '', route?.address || '', date);
    }));
  }
  if (tables.includes('VEICULOS')) formProjectionWrite_(ss,'VEICULOS',
    ['PLACA','TIPO_VEICULO','CAPACIDADE_KG','MOTORISTA_PADRAO','ATIVO','ATUALIZADO_EM','USUARIO'],
    Object.values(st.fleetVehicles).map(v=>[v.plate,v.type||'',v.capacityKg||'',v.defaultDriver||'',v.active!==false?'SIM':'NAO',v.updatedAt||'',v.by||'']));
  if (tables.includes('MOTORISTAS')) formProjectionWrite_(ss,'MOTORISTAS',
    ['NOME','ATIVO','ATUALIZADO_EM','USUARIO'],Object.values(st.fleetDrivers).map(d=>[d.name,d.active!==false?'SIM':'NAO',d.updatedAt||'',d.by||'']));
  if (tables.includes('UNIDADES_LOGISTICAS')) formProjectionWrite_(ss,'UNIDADES_LOGISTICAS',['ID','NOME','ENDERECO','EMPRESA'],
    formRouteSettings_(st).units.map(u=>[u.id,u.name,u.address,FORM_COMPANIES[u.company]||'']));
  if (tables.includes('CONFIG_LOGISTICA')) {
    const {defaultUnitId,returnToUnit,groupAddresses}=formRouteSettings_(st);
    formProjectionWrite_(ss,'CONFIG_LOGISTICA',['UNIDADE_PADRAO','RETORNAR_A_UNIDADE','AGRUPAR_ENDERECOS'],
      [[defaultUnitId,returnToUnit?'SIM':'NAO',groupAddresses?'SIM':'NAO']]);
  }
  if (tables.includes('ROTEIROS_PARADAS')) {
    const rows=[];
    for (const m of Object.values(st.montages)) {
      if (!m.route) continue;
      m.route.stops.forEach((stop,i)=>{
        for (const key of stop.keys) rows.push([m.id,i+1,formExpParseKey_(key).order,key,stop.address,
          m.route.unit?.name||'',m.route.unit?.address||'',m.route.returnToUnit?'SIM':'NAO',m.route.confirmed?'Confirmado':'Rascunho',m.route.at,m.route.by]);
      });
    }
    formProjectionWrite_(ss,'ROTEIROS_PARADAS',['MONTAGEM_ID','ORDEM','PEDIDO','PEDIDO_ID','ENDERECO_ENTREGA','UNIDADE_SAIDA','ENDERECO_SAIDA',
      'RETORNO_A_UNIDADE','STATUS','ATUALIZADO_EM','USUARIO'],rows);
  }
}

// O histórico é a fonte de verdade. Uma aba auxiliar interrompida é recuperável.
function formProjectionCommit_(ss, st, event, timing) {
  const keys=JSON.stringify(event.keys), from=JSON.stringify(event.from), data=JSON.stringify(event.data);
  if ([keys,from,data].some(value=>value.length>44000)) throw new Error('Muitos itens para uma movimentação. Divida a seleção em lotes menores.');
  const props=PropertiesService.getScriptProperties(), marker=formProjectionMarker_(ss);
  const recovering=!!props.getProperty(marker), journal=ss.getSheetByName('HISTORICO_MOVIMENTACOES');
  const row=journal.getLastRow()+1, max=journal.getMaxRows();
  props.setProperty(marker,String(event.revision));
  if (row>max) journal.insertRowsAfter(max,row-max);
  journal.getRange(row,1,1,9).setValues([[event.id,event.revision,event.at,event.by,event.type,keys,from,event.to,data]]);
  SpreadsheetApp.flush();
  timing.mark('historico');
  formExpApply_(st,event);
  st.events.push(event);
  st.requests[event.id]=true;
  st.revision=event.revision;
  formFleetHydrate_(st);
  try {
    const tables=recovering?[...new Set(Object.values(FORM_PROJECTION_TABLES).flat())]:FORM_PROJECTION_TABLES[event.type];
    formProjectionUpdate_(ss,st,tables);
    SpreadsheetApp.flush();
    props.deleteProperty(marker);
    return false;
  } catch (error) {
    console.warn('O histórico foi confirmado. Atualização das abas auxiliares pendente.');
    return true;
  } finally {
    timing.mark('abasAuxiliares');
  }
}

function formProjectionRecover_() {
  const props=PropertiesService.getScriptProperties(), id=props.getProperty('FORM_EXP_AUX_ID');
  const workflowKey='FORM_WORKFLOW_V3_'+id;
  if (!id || (!props.getProperty('FORM_PROJECTION_PENDING_'+id) && props.getProperty(workflowKey))) return;
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(500)) return;
  try {
    const ss=formExpAux_(true), marker=formProjectionMarker_(ss);
    const pending=props.getProperty(marker);
    if (!pending && props.getProperty(workflowKey)) return;
    const tables=pending?[...new Set(Object.values(FORM_PROJECTION_TABLES).flat())]:['MONTAGENS','MONTAGEM_PEDIDOS'];
    formProjectionUpdate_(ss,formExpState_(ss),tables);
    SpreadsheetApp.flush();
    props.setProperty(workflowKey,'1');
    props.deleteProperty(marker);
  } catch (error) {
    console.warn('A recuperação das abas auxiliares será repetida.');
  } finally {
    lock.releaseLock();
  }
}

// ── 22. Consulta e gravação de transportadoras ──
// Busca dados logísticos e valida as mudanças antes e depois de gravar as notas.

// ── Importação de relatórios das transportadoras ──
// A prévia concilia o arquivo com a base. A confirmação grava somente os campos da transportadora.
const SAC_IMPORT_CARRIERS = ['TRANSRÁPIDO','F&P','CBIRDEX'];
const SAC_IMPORT_FIELDS = {
  'CLIENTE':['text','DESTINATARIO'], 'CNPJ/CPF':['text','CNPJ CPF'],
  'CIDADE':['text','CIDADE',2], 'UF':['text','UF',2],
  'EMISSAO':['date','EMISSAO NF S'], 'DATA COLETA':['date','DATA COLETA','COLETA'],
  'PREVISAO TRANSPORTADORA':['date','PREV ENTREGA','PRAZO DE ENTREGA'],
  'DATA ENTREGA':['date','DATA ENTREGA'], 'STATUS TRANSPORTADORA':['text','ULTIMO STATUS'],
  'PESO':['number','PESO'], 'VOLUMES':['number','VOL'], 'VALOR MERCADORIA':['number','VALOR TRANSP'],
  'FRETE TOTAL':['number','FRETE TOTAL'], 'PEDIDO':['text','PEDIDO',2], 'CT-E':['text','CT E'],
  'SERVICO':['text','SERVICO'], 'RECEBEDOR':['text','RECEBEDOR'], 'DOCUMENTO':['text','DOCUMENTO'],
  'DATA STATUS':['date','DATA STATUS'], 'HORA STATUS':['text','HORA STATUS']
};
const SAC_CBIRDEX_FIELDS = {
  'CLIENTE':'DESTINATARIO', 'CNPJ/CPF':'CNPJDESTINATARIO',
  'CIDADE':'CIDADEENTREGA', 'UF':'UFENTREGA', 'EMISSAO':'EMISSAO',
  'PREVISAO TRANSPORTADORA':'PREVISAOENTREGA', 'DATA ENTREGA':'ENTREGAREALIZADA',
  'STATUS TRANSPORTADORA':'SITUACAO', 'PESO':'PESOREAL', 'VOLUMES':'VOLUME',
  'VALOR MERCADORIA':'VALORMERCADORIA', 'FRETE TOTAL':'FRETE'
};
const SAC_IMPORT_TOTALS = ['PESO','VOLUMES','VALOR MERCADORIA','FRETE TOTAL','PEDIDO'];
const SAC_IMPORT_TRACKING = ['DATA ENTREGA','STATUS TRANSPORTADORA','DATA STATUS','HORA STATUS','RECEBEDOR','DOCUMENTO'];

function sacImportCarrier_(value) {
  return SAC_IMPORT_CARRIERS.find(carrier=>logNorm_(carrier)===logNorm_(value)) || '';
}

function sacImportHeader_(value) {
  return logNorm_(value).replace(/[^A-Z0-9]+/g,' ').trim();
}

function sacImportNotes_(value) {
  const raw=logText_(value);
  if(!/^\d+(?:\s*-\s*\d+)?(?:\s*[,;]\s*\d+(?:\s*-\s*\d+)?)*$/.test(raw))return [];
  return [...new Set(raw.split(/[,;]/).map(note=>note.split('-')
    .map(part=>part.trim().replace(/^0+(?=\d)/,'')).join('-')))].sort();
}

function sacImportPermissions_(user,carrier='') {
  const access=platformAccess_(user), scope=access.logisticsScope;
  if(user.perfil!=='SAC'||!access.permissions.sac.edit||scope.sellers.length||scope.regions.length) {
    throw new Error('Importação disponível para o SAC com permissão de edição e acesso à transportadora.');
  }
  const allowed=SAC_IMPORT_CARRIERS.filter(name=>!scope.carriers.length||scope.carriers.some(value=>sacImportCarrier_(value)===name));
  if(carrier&&!allowed.includes(carrier))throw new Error('Transportadora fora do seu perfil de acesso.');
  return allowed;
}

function sacCbirdexId_(value) {
  // No CSV, a série vem antes do número. A planilha usa número-série.
  const parts=logText_(value).match(/^(\d+)(?:\s*\/\s*|\s+)(\d+)$/);
  return parts?sacImportNotes_(parts[2]+'-'+parts[1])[0]:'';
}

function sacImportReadReport_(p,tz,carrier) {
  const cbirdex=carrier==='CBIRDEX';
  let grid=p.rows;
  if(cbirdex){
    if(typeof p.csv!=='string'||!p.csv.trim()||p.csv.length>650000){
      throw new Error('Selecione o CSV original da CBIRDEX com até 650 KB de dados.');
    }
    grid=Utilities.parseCsv(p.csv.replace(/^\uFEFF/,'').trimEnd(),';');
  }
  if(!Array.isArray(grid)||grid.length<2||grid.length>1001||
     grid.some(row=>!Array.isArray(row)||row.length>60||row.some(value=>typeof value!=='string'||value.length>500))||
     JSON.stringify(grid).length>650000)throw new Error('Use um relatório de até 1.000 linhas e 650 KB de dados.');
  const headers=grid[0].map(sacImportHeader_);
  const required=cbirdex?['NUMEROCTE','NOTAFISCAL','DESTINATARIO','EMISSAO','SITUACAO']:['NF S','DESTINATARIO','EMISSAO NF S','ULTIMO STATUS'];
  if(!required.every(name=>headers.filter(h=>h===name).length===1)) {
    throw new Error('Cabeçalho não reconhecido. Selecione o relatório de remessas original da transportadora.');
  }
  const locate=(key,alternative)=>{
    if(typeof alternative==='number'){
      const matches=headers.flatMap((header,i)=>header===key?[i]:[]);
      return [matches[alternative-1],matches[0]];
    }
    return [headers.indexOf(key),headers.indexOf(alternative)];
  };
  const columns=Object.entries(SAC_IMPORT_FIELDS).flatMap(([name,[type,key,alternative]])=>
    cbirdex?(SAC_CBIRDEX_FIELDS[name]?[[name,type,[headers.indexOf(SAC_CBIRDEX_FIELDS[name])]]]:[]):[[name,type,locate(key,alternative)]]);
  const nfColumn=headers.indexOf(cbirdex?'NOTAFISCAL':'NF S');
  const extraNfColumn=headers.indexOf('DEMAISNOTASFISCAIS'),cteColumn=headers.indexOf('NUMEROCTE');
  const report=[];
  let ignored=0;
  for(const row of grid.slice(1)){
    let invoice=logText_(row[nfColumn]);
    const values={};
    if(cbirdex){
      const extra=logText_(row[extraNfColumn]);
      const ids=[invoice,...(extra?extra.split(/[,;\r\n]+/):[])].map(sacCbirdexId_);
      const cte=sacCbirdexId_(row[cteColumn]);
      if(!cte||ids.some(id=>!id)){ignored++;continue;}
      invoice=[...new Set(ids)].join(', ');
      values['CT-E']=cte;
    }
    const notes=sacImportNotes_(invoice);
    if(!notes.length){ignored++;continue;}
    for(const [name,type,indices] of columns){
      const raw=indices.map(i=>logText_(row[i])).find(Boolean);
      if(!raw||/^[-—]+$/.test(raw))continue;
      const dates=type==='date'?raw.split(/\s*[,;]\s*/).map(value=>logDate_(value,tz)).filter(Boolean).sort():[];
      const value=type==='date'?(dates[0]||''):type==='number'?logNumber_(raw):raw;
      if(value!==''&&value!=null)values[name]=value;
    }
    if(cbirdex&&values['DATA ENTREGA']<values.EMISSAO)delete values['DATA ENTREGA'];
    report.push({invoice,notes,values});
  }
  if(!report.length)throw new Error('Nenhuma NF válida foi encontrada no arquivo.');
  return {report,ignored};
}

function sacImportPlan_(rows,columns,carrier,input,tz,today) {
  const exact=new Map(), byNote=new Map(), edits=new Map(), additions=[], seen=new Set();
  const summary={inserted:0,updated:0,unchanged:0,ignored:input.ignored,conflicts:0,grouped:0};
  const examples=[];
  const at=(row,name)=>row[columns[name]];
  const index=(map,key,item)=>{
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(item);
  };
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(sacImportCarrier_(at(row,'TRANSPORTADORA'))!==carrier)continue;
    const notes=sacImportNotes_(at(row,'NF'));
    if(!notes.length)continue;
    const item={i,row,notes,cte:logText_(at(row,'CT-E'))};
    index(exact,notes.join(','),item);
    for(const note of notes)index(byNote,note,item);
  }
  const matches=(items,cte)=>{
    const same=cte?items.filter(item=>item.cte===cte):[];
    if(same.length===1)return same[0];
    if(items.length!==1||cte&&items[0].cte&&items[0].cte!==cte)return null;
    return items[0];
  };
  const record=(status,entry)=>{
    summary[status]++;
    if(status==='conflicts'&&examples.length<12)examples.push(entry.invoice);
  };
  for(const rawEntry of input.report){
    let entry=rawEntry;
    const fields=entry.values, statusDate=fields['DATA STATUS'];
    if(carrier==='TRANSRÁPIDO'&&!fields['DATA ENTREGA']&&statusDate&&statusDate<=today&&
       statusDate>=(fields.EMISSAO||'')&&statusDate>=(fields['DATA COLETA']||'')&&
       /^(?:ENTREGUE|ENTREGA REALIZADA(?: NORMALMENTE)?)(?: VIA APLICATIVO MOVEL)?$/.test(sacImportHeader_(fields['STATUS TRANSPORTADORA']))){
      entry={...entry,values:{...fields,'DATA ENTREGA':statusDate}};
    }
    if(entry.notes.some(note=>seen.has(note))){record('conflicts',entry);continue;}
    entry.notes.forEach(note=>seen.add(note));
    const cte=entry.values['CT-E']||'';
    const exactItems=exact.get(entry.notes.join(','))||[];
    const overlaps=new Set(entry.notes.flatMap(note=>byNote.get(note)||[]));
    let targets=[];
    if(exactItems.length){
      const target=matches(exactItems,cte);
      if(target&&[...overlaps].every(item=>item.notes.length===target.notes.length))targets=[target];
    }else if(entry.notes.length>1&&[...overlaps].every(item=>item.notes.length===1)){
      targets=entry.notes.map(note=>matches(byNote.get(note)||[],cte)).filter(Boolean);
      if(targets.length!==entry.notes.length)targets=[];
      if(targets.length)summary.grouped++;
    }
    if(!targets.length&&overlaps.size){record('conflicts',entry);continue;}
    if(!targets.length){
      const values={...entry.values,NF:entry.invoice,TRANSPORTADORA:carrier};
      if(values['DATA ENTREGA']>today)delete values['DATA ENTREGA'];
      if(!values.EMISSAO){record('ignored',entry);continue;}
      values.CHAVE=carrier+'|'+entry.invoice+(cte?'|'+cte:'');
      additions.push(values);
      record('inserted',entry);
      continue;
    }

    let changed=false;
    for(const target of targets){
      const existing=target.row, next={};
      const existingDelivery=logDate_(at(existing,'DATA ENTREGA'),tz);
      const existingStatusDate=logDate_(at(existing,'DATA STATUS'),tz);
      const incomingStatusDate=entry.values['DATA STATUS'];
      const existingStatusTime=sacImportStatusTime_(at(existing,'HORA STATUS'),tz);
      const incomingStatusTime=sacImportStatusTime_(entry.values['HORA STATUS'],tz);
      const older=existingStatusDate&&(!incomingStatusDate||incomingStatusDate<existingStatusDate||
        incomingStatusDate===existingStatusDate&&existingStatusTime&&incomingStatusTime&&incomingStatusTime<existingStatusTime);
      const preserveTracking=older || existingDelivery&&!entry.values['DATA ENTREGA'];
      for(const [name,value] of Object.entries(entry.values)){
        if(targets.length>1&&SAC_IMPORT_TOTALS.includes(name))continue;
        if(name==='DATA ENTREGA'&&(existingDelivery||value>today))continue;
        if(preserveTracking&&SAC_IMPORT_TRACKING.includes(name))continue;
        if(sacImportComparable_(name,value,tz)!==sacImportComparable_(name,at(existing,name),tz))next[name]=value;
      }
      if(Object.keys(next).length){edits.set(target.i+2,next);changed=true;}
    }
    record(changed?'updated':'unchanged',entry);
  }
  return {summary,examples,edits,additions};
}

function sacImportLayout_(sheet) {
  const header=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(logNorm_);
  const names=['CHAVE','NF','TRANSPORTADORA','PRAZO INTERNO REBANHO','STATUS SLA','DIAS ATRASO','DATA ATUALIZACAO',...Object.keys(SAC_IMPORT_FIELDS)];
  const columns=Object.fromEntries(names.map(name=>{
    const index=header.indexOf(name);
    if(index<0||header.lastIndexOf(name)!==index)throw new Error('Coluna ausente ou duplicada no acompanhamento: '+name+'.');
    return [name,index];
  }));
  if(columns.CHAVE!==0||columns.NF!==1||columns.TRANSPORTADORA!==2)throw new Error('A estrutura de identificação do acompanhamento mudou.');
  return {header,columns};
}

// Usa o valor numérico nativo do Sheets, inclusive em células já formatadas.
// Datas civis não recebem deslocamento de fuso; horários usam o fuso da planilha.
function sacImportDateSerial_(value,tz) {
  const local=value instanceof Date?Utilities.formatDate(value,tz,"yyyy-MM-dd'T'HH:mm:ss.SSS"):String(value);
  const time=Date.parse(local+(local.length===10?'T00:00:00':'')+'Z');
  if(!Number.isFinite(time))throw new Error('Data inválida para gravação no acompanhamento.');
  return (time-Date.UTC(1899,11,30))/86400000;
}

function sacImportCell_(name,value,tz) {
  if(SAC_IMPORT_FIELDS[name]?.[0]==='date')return sacImportDateSerial_(value,tz);
  if(typeof value==='string'&&/^[=+@'-]/.test(value))return "'"+value;
  return value;
}

function sacImportStatusTime_(value,tz) {
  if(value instanceof Date)return isNaN(value)?'':Utilities.formatDate(value,tz,'HH:mm:ss');
  if(typeof value==='number'&&value>=0&&value<1){
    // O Sheets também pode retornar uma hora como fração de um dia.
    const seconds=Math.round(value*86400)%86400;
    return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60]
      .map(part=>String(part).padStart(2,'0')).join(':');
  }
  const time=logText_(value).match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  return time?time[1].padStart(2,'0')+':'+time[2]+':'+(time[3]||'00'):'';
}

function sacImportComparable_(name,value,tz) {
  const type=SAC_IMPORT_FIELDS[name]?.[0];
  if(type==='date')return logDate_(value,tz);
  if(type==='number')return logNumber_(value);
  if(name==='HORA STATUS')return sacImportStatusTime_(value,tz)||logText_(value);
  return logText_(value);
}

function sacImportFormulas_(n,columns,carrier) {
  const cell=name=>transportColumnLetter_(columns[name]+1)+n;
  const nf=cell('NF'), coleta=cell('DATA COLETA'), interno=cell('PRAZO INTERNO REBANHO'), entrega=cell('DATA ENTREGA');
  const prazo=carrier==='CBIRDEX'? `IF(${interno}="";${cell('PREVISAO TRANSPORTADORA')};${interno})`:interno;
  return {
    'PRAZO INTERNO REBANHO':`=IF(${coleta}="";"";WORKDAY.INTL(${coleta};2;1;LISTAS!$E$2:$E$50))`,
    'STATUS SLA':`=IF(${nf}="";"";IF(${prazo}="";"Sem prazo";IF(${entrega}="";IF(TODAY()<=${prazo};"Em andamento - no prazo";"Em andamento - atrasado");IF(${entrega}<=${prazo};"No Prazo";"Fora do Prazo"))))`,
    'DIAS ATRASO':`=IF(${nf}="";"";IF(${prazo}="";"";IF(${entrega}="";MAX(0;TODAY()-${prazo});MAX(0;${entrega}-${prazo}))))`
  };
}

function sacImportWrite_(sheet, layout, plan, last, now, tz) {
  const {columns,header}=layout, additions=plan.additions;
  const updatedAt=sacImportDateSerial_(now,tz);
  if(additions.length){
    if(last+additions.length>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),last+additions.length-sheet.getMaxRows());
    const rows=additions.map((fields,i)=>{
      const line=Array(header.length).fill('');
      for(const [name,value] of Object.entries(fields))line[columns[name]]=sacImportCell_(name,value,tz);
      for(const [name,value] of Object.entries(sacImportFormulas_(last+i+1,columns,fields.TRANSPORTADORA)))line[columns[name]]=value;
      line[columns['DATA ATUALIZACAO']]=updatedAt;
      return line;
    });
    sheet.getRange(last+1,1,rows.length,header.length).setValues(rows);
    for(const name of ['PRAZO INTERNO REBANHO',...Object.keys(SAC_IMPORT_FIELDS).filter(name=>SAC_IMPORT_FIELDS[name][0]==='date')]){
      sheet.getRange(last+1,columns[name]+1,rows.length,1).setNumberFormat('dd/MM/yyyy');
    }
    sheet.getRange(last+1,columns['DATA ATUALIZACAO']+1,rows.length,1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }
  // Grava as colunas externas em trechos contíguos, sem reescrever as colunas manuais.
  const sortedEdits=[...plan.edits].sort((a,b)=>a[0]-b[0]);
  for(const name of [...Object.keys(SAC_IMPORT_FIELDS),'DATA ATUALIZACAO']){
    const column=columns[name]+1;
    let start=0, values=[];
    for(const [row,fields] of sortedEdits){
      if(name!=='DATA ATUALIZACAO'&&!(name in fields))continue;
      if(values.length&&row!==start+values.length){
        sheet.getRange(start,column,values.length,1).setValues(values);
        values=[];
      }
      if(!values.length)start=row;
      values.push([name==='DATA ATUALIZACAO'?updatedAt:sacImportCell_(name,fields[name],tz)]);
    }
    if(values.length)sheet.getRange(start,column,values.length,1).setValues(values);
  }
  SpreadsheetApp.flush();
  const expected=new Map(plan.edits);
  additions.forEach((fields,i)=>expected.set(last+i+1,fields));
  for(const {first,last:end} of centralRowBlocks_([...expected.keys()])){
    const values=sheet.getRange(first,1,end-first+1,header.length).getValues();
    values.forEach((row,i)=>{
      const fields=expected.get(first+i);
      if(!fields)return;
      const mismatches=Object.entries(fields).filter(([name,value])=>
        sacImportComparable_(name,row[columns[name]],tz)!==sacImportComparable_(name,value,tz));
      if(mismatches.length){
        console.warn(JSON.stringify({operation:'sac.import.verify',row:first+i,fields:mismatches.map(([name])=>name)}));
        throw new Error('A conferência da gravação encontrou divergências.');
      }
    });
  }
}

function sacImportApi_(user,p,id) {
  const allowed=sacImportPermissions_(user);
  if(p.action==='importOptions')return {ok:true,carriers:allowed};
  const carrier=sacImportCarrier_(p.carrier);
  if(!carrier||!allowed.includes(carrier))throw new Error('Escolha uma transportadora autorizada.');
  const apply=p.action==='importCommit';
  const cache=CacheService.getScriptCache();
  const token=String(p.previewToken||'');
  const previewKey=apply&&/^[a-f0-9-]{36}$/.test(token)?'SAC_IMPORT_'+token:'';
  const expected=previewKey?cache.get(previewKey):null;
  if(apply&&!expected)throw new Error('A prévia expirou. Analise o arquivo novamente.');
  // A prévia só consulta a planilha. A confirmação recalcula a conciliação sob o lock.
  const lock=apply?LockService.getScriptLock():null;
  if(lock&&!lock.tryLock(10000))throw new Error('Outra gravação está em andamento. Tente novamente em instantes.');
  let attempted=false;
  try{
    const ss=SpreadsheetApp.openById(id), sheet=ss.getSheetByName('ACOMPANHAMENTO'), tz=ss.getSpreadsheetTimeZone();
    if(!sheet)throw new Error('Aba ACOMPANHAMENTO não encontrada.');
    const layout=sacImportLayout_(sheet), last=sheet.getLastRow();
    const input=sacImportReadReport_(p,tz,carrier);
    const rows=last>1?sheet.getRange(2,1,last-1,layout.header.length).getValues():[];
    const today=Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
    const plan=sacImportPlan_(rows,layout.columns,carrier,input,tz,today);
    const digest=digestHex_(JSON.stringify([id,user.login,carrier,layout.header,last,input,[...plan.edits],plan.additions,plan.summary]));
    if(!apply){
      const fresh=Utilities.getUuid();
      cache.put('SAC_IMPORT_'+fresh,digest,600);
      return {ok:true,carrier,summary:plan.summary,examples:plan.examples,previewToken:fresh};
    }
    if(digest!==expected)throw new Error('O arquivo ou o acompanhamento mudou. Gere uma nova prévia antes de confirmar.');
    cache.remove(previewKey);
    if(plan.additions.length||plan.edits.size){
      attempted=true;
      sacImportWrite_(sheet,layout,plan,last,new Date(),tz);
      console.info(JSON.stringify({operation:'sac.import',user:user.login,carrier,summary:plan.summary}));
    }
    return {ok:true,summary:plan.summary};
  }catch(error){
    if(attempted){
      console.error(JSON.stringify({operation:'sac.import.write.error',carrier,
        message:String(error&&error.message||error),stack:String(error&&error.stack||'')}));
      throw new Error('A gravação precisa ser conferida. Gere outra prévia para verificar o que já entrou antes de repetir.');
    }
    throw error;
  }finally{
    try{
      if(attempted)PropertiesService.getScriptProperties().setProperty(centralTransportVersionKey_(id),Utilities.getUuid());
    }catch(error){console.warn('Não foi possível invalidar o cache de transportadoras.');}
    finally{if(lock)lock.releaseLock();}
  }
}

function centralTransportVersionKey_(id) {
  return 'LOG_TRANSPORT_CHANGE_'+digestHex_(id).slice(0,24);
}

function centralLogisticsRead_(user, p, kind, id) {
  const sourceKind=['formations','formationOverview'].includes(kind)?'operations':kind;
  const timing=centralTiming_('logistica.'+sourceKind);
  let status='erro';
  try {
    const cache=CacheService.getScriptCache(),props=PropertiesService.getScriptProperties();
    const changes=sourceKind==='transport'?(props.getProperty(centralTransportVersionKey_(id))||''):'';
    const key='LOG_ROWS_V9_'+digestHex_(id+'|'+sourceKind+'|'+changes).slice(0,30);
    const publicVersion=version=>digestHex_(version+'|'+kind+'|'+user.login+'|'+JSON.stringify(platformAccess_(user))+'|'+String(user.accessVersion||'')).slice(0,24);
    if(p.check===true&&p.force!==true&&p.version){
      try{
        const hint=JSON.parse(cache.get(key)||'null');
        if(hint?.version&&p.version===publicVersion(hint.version)){
          status='sem_alteracoes';
          return {ok:true,unchanged:true,meta:{version:p.version,updatedAt:hint.updatedAt,checkedAt:hint.updatedAt}};
        }
      }catch(error){}
    }
    let snapshot=p.force===true?null:centralCacheRead_(cache,key);
    if(!snapshot){
      const ss=SpreadsheetApp.openById(id),tz=ss.getSpreadsheetTimeZone();
      const sheetName={operations:'FORMAÇÃO 2026',transport:'ACOMPANHAMENTO',schedule:'DESTINO MOTORISTAS'}[sourceKind];
      const sh=ss.getSheetByName(sheetName);
      if(!sh)throw new Error('Aba ausente: '+sheetName);
      const width=Math.min(sh.getLastColumn(),{operations:23,transport:36,schedule:27}[sourceKind]);
      const values=sh.getRange(1,1,Math.max(1,sh.getLastRow()),width).getValues();
      const regions=sourceKind==='operations'?ss.getSheetByName('CADASTRO REGIAO').getDataRange().getValues():[];
      timing.mark('planilha');
      let rows;
      if(sourceKind==='schedule'){
        const drivers=(values[0]||[]).slice(2).map(logText_);
        rows=values.slice(1).flatMap((r,i)=>{
          const date=logDate_(r[0],tz);
          return drivers.flatMap((driver,j)=>driver&&logText_(r[j+2])?[{id:'ag_'+i+'_'+j,date,driver,destination:logText_(r[j+2])}]:[]);
        });
      }else rows=logRecords_(values,sourceKind,tz,regions);
      const updatedAt=new Date().toISOString();
      const version=digestHex_(id+'|'+sourceKind+'|'+JSON.stringify(rows)).slice(0,24);
      snapshot={rows,meta:{version,updatedAt,checkedAt:updatedAt,sourceTimestampKind:'read',sourceId:id,sourceName:ss.getName(),sheet:sheetName,reference:false,referenceUpdatedAt:'2026-09-10T20:24:33.252Z'}};
      centralCacheWrite_(cache,key,JSON.stringify(snapshot),180,{version,updatedAt});
      timing.mark('processamento');
      status='origem';
    }else{
      timing.mark('cache');
      status='cache';
    }
    const version=publicVersion(snapshot.meta.version);
    const meta={...snapshot.meta,version};
    if(user.perfil!=='ADMIN')delete meta.sourceId;
    if(p.check===true&&p.version===version)return {ok:true,unchanged:true,meta};
    let rows=snapshot.rows.filter(row=>logisticsRowAllowed_(user,row,kind));
    if(kind==='formations')rows=rows.map(row=>({...row,problem:row.category,description:row.follow}));
    if(kind==='formationOverview')rows=rows.map(row=>{
      const {date,uf,city,region,seller,status,weight,wait,awaitingFormation,inRoute,delivered,cargoId}=row;
      return {date,uf,city,region,seller,status,weight,wait,awaitingFormation,inRoute,delivered,cargoId,loaded:!!row.loaded};
    });
    let from='',to='';
    for(const row of rows)if(row.date){if(!from||row.date<from)from=row.date;if(row.date>to)to=row.date;}
    timing.mark('recorte');
    return {ok:true,meta:{...meta,count:rows.length,from,to},rows};
  }finally{
    timing.finish(status);
  }
}

function transportCategoryKey_(id) {
  return 'SAC_CATEGORIES_'+digestHex_(id).slice(0,24);
}

function transportCategories_(props, key) {
  return JSON.parse(props.getProperty(key)||'[]');
}

function transportCategoryAdd_(user,p,id) {
  if(!platformAccess_(user).editTransport)throw new Error('Somente o SAC autorizado pode cadastrar categorias.');
  const input=typeof p.category==='string'?p.category.trim():'';
  if(!input||input.length>80||/^[=+@'-]|[\x00-\x1f\x7f]/.test(input)||!logProblem_(input)){
    throw new Error('Informe um nome de categoria válido, com até 80 caracteres.');
  }
  const name=input.replace(/\s+/g,' '), props=PropertiesService.getScriptProperties(), key=transportCategoryKey_(id);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(3000))throw new Error('Outra gravação está em andamento. Tente novamente em instantes.');
  try{
    const options=transportCategories_(props,key);
    const existing=options.find(option=>logNorm_(option)===logNorm_(name));
    if(existing)return {ok:true,category:existing};
    const data=JSON.stringify([...options,name]);
    if(Utilities.newBlob(data).getBytes().length>8000)throw new Error('A lista de categorias cadastradas atingiu o limite.');
    props.setProperty(key,data);
    return {ok:true,category:name};
  }finally{lock.releaseLock();}
}

function transportEditLayout_(sh) {
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0], names=headers.map(logNorm_);
  if(['CHAVE','NF','TRANSPORTADORA','CLIENTE','CNPJ/CPF','CIDADE','UF'].some((h,i)=>names[i]!==h)){
    throw new Error('A estrutura de identificação da planilha mudou.');
  }
  const fields=deliveryFields_().map(([name,label])=>{
    const column=names.indexOf(logNorm_(label));
    if(column<0||names.lastIndexOf(logNorm_(label))!==column)throw new Error('Coluna ausente ou duplicada: '+label+'.');
    return {name,label:name==='follow'?'Follow-up':name==='category'?'Categoria de ocorrência':label,col:column,type:name==='deliveredDate'?'date':'text'};
  });
  return {headers,fields,tz:sh.getParent().getSpreadsheetTimeZone()};
}

function transportEditPositions_(sh, keys) {
  const count=sh.getLastRow()-1;
  if(count<1)throw new Error('Acompanhamento sem notas.');
  const needed=new Set(keys), indices=new Map();
  const hasLegacy=keys.some(key=>/^trf_[a-f0-9]{64}$/.test(key));
  // Para notas com CHAVE, localiza e confere duplicatas usando apenas a coluna de identificação.
  // Notas legadas sem CHAVE ainda são localizadas pelos sete campos originais.
  const identities=sh.getRange(2,1,count,hasLegacy?7:1).getDisplayValues();
  identities.forEach((cells,i)=>{
    const stored=logText_(cells[0]);
    const key=stored||(hasLegacy&&cells.some(Boolean)?transportRowKey_(cells):'');
    if(!needed.has(key))return;
    if(indices.has(key))throw new Error('Nota com chave duplicada. Atualize a seleção.');
    indices.set(key,i+2);
  });
  if(indices.size!==needed.size)throw new Error('Nota ausente. Atualize a seleção.');
  return new Map([...indices].map(([key,row])=>[row,key]));
}

function transportEditRows_(sh, user, keys, layout, positions, categories=[]) {
  const byRow=positions||transportEditPositions_(sh,keys);
  const {headers,fields,tz}=layout, lists=new Map(), items=new Map();
  for(const {first,last} of centralRowBlocks_([...byRow.keys()])){
    const grid=sh.getRange(first,1,last-first+1,headers.length);
    const raw=grid.getValues(), display=grid.getDisplayValues(), formulas=grid.getFormulas(), rules=grid.getDataValidations();
    for(let i=0;i<raw.length;i++){
      const n=first+i, key=byRow.get(n);
      if(!key)continue;
      const record=logRecords_([headers,raw[i]],'transport',tz,[])[0];
      if(!record||transportRowKey_(display[i].slice(0,7))!==key||!logisticsRowAllowed_(user,record,'transport')){
        throw new Error('Uma nota mudou ou está fora do seu recorte de acesso.');
      }
      const rowFields=fields.map(field=>{
        const {name,type,col,label}=field, rule=rules[i][col];
        const criteria=rule?String(rule.getCriteriaType()):'', args=rule?rule.getCriteriaValues():null;
        let options=null;
        if(rule&&name!=='deliveredDate'){
          if(criteria==='VALUE_IN_LIST')options=args[0].map(String);
          else if(criteria==='VALUE_IN_RANGE'){
            const range=args[0], listKey=range.getSheet().getSheetId()+':'+range.getA1Notation();
            if(!lists.has(listKey))lists.set(listKey,range.getDisplayValues().flat().filter(Boolean));
            options=lists.get(listKey);
          }else throw new Error('Validação não suportada no campo '+label+'.');
        }
        const value=type==='date'?logDate_(raw[i][col],tz):display[i][col];
        return {...field,value,options,readOnly:!!formulas[i][col],rule,criteria,args};
      });
      // Mesma assinatura dos formulários já abertos na versão anterior.
      const signature=rowFields.map(f=>[f.col,f.criteria,f.args?.map(v=>v&&typeof v.getA1Notation==='function'?
        v.getSheet().getSheetId()+':'+v.getA1Notation():v)??null,f.options]);
      const version=digestHex_(JSON.stringify([key,display[i].slice(0,7),raw[i],formulas[i],signature]));
      // O cadastro compartilhado não invalida formulários de notas já abertos.
      const category=rowFields.find(f=>f.name==='category');
      if(category){
        category.nativeOptions=category.options;
        category.options=[...new Set([...(category.options||[]),...categories])];
      }
      items.set(key,{key,n,version,fields:rowFields,record,tz});
    }
  }
  return keys.map(key=>items.get(key));
}

function transportEditRead_(items, batch) {
  if(!batch){
    const x=items[0],{invoice,client,carrier}=x.record;
    return {ok:true,key:x.key,version:x.version,fields:x.fields.filter(f=>f.name!=='manualOccurrence').map(deliveryPublic_),invoice,client,carrier,record:x.record};
  }
  return {ok:true,items:items.map(x=>({key:x.key,version:x.version,invoice:x.record.invoice,client:x.record.client})),
    fields:items[0].fields.map((field,i)=>{
      const values=items.map(x=>x.fields[i]), sets=values.filter(f=>f.options!==null).map(f=>new Set(f.options));
      return {...deliveryPublic_(field),value:'',readOnly:values.some(f=>f.readOnly),filled:values.filter(f=>f.value).length,
        options:sets.length?[...sets[0]].filter(v=>sets.every(set=>set.has(v))):null};
    }).filter(f=>f.name!=='manualOccurrence')};
}

function transportEditChanges_(p, batch) {
  const input=batch?p.changes:p.values, fields=deliveryFields_().map(f=>f[0]).filter(name=>name!=='manualOccurrence');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.includes(key))||
     batch&&!Object.keys(input).length)throw new Error('Campos de gravação inválidos.');
  if(batch&&(!p.versions||typeof p.versions!=='object'||Array.isArray(p.versions)))throw new Error('Reabra o lote para conferir os valores atuais.');
  return Object.fromEntries(Object.entries(input).map(([name,value])=>{
    const change=batch?value:{value,mode:'replace'};
    if(!change||typeof change.value!=='string'||!(change.mode==='replace'||name==='follow'&&change.mode==='append')){
      throw new Error('Preenchimento inválido: '+name+'.');
    }
    const text=change.value.trim();
    if(batch&&!text)throw new Error('Preencha os campos marcados.');
    return [name,{value:text,mode:change.mode}];
  }));
}

function transportEditValidate_(items, versions, changes) {
  for(const item of items){
    if(item.version!==versions[item.key])throw new Error('Uma nota foi alterada na planilha. Reabra o formulário para revisar os valores atuais.');
    item.changed=[];
    for(const f of item.fields){
      const change=changes[f.name];
      if(!change)continue;
      const next=change.mode==='append'&&f.value?f.value+'\n'+change.value:change.value;
      if(next===f.value)continue;
      if(f.readOnly)throw new Error('O campo '+f.label+' contém fórmula e não pode ser editado.');
      if(next.length>2000||next&&f.options&&!f.options.includes(next))throw new Error('Valor inválido: '+f.label+'.');
      let write=formAuxSafeCell_(next);
      if(f.type==='date'){
        write=deliveryDate_(next,item.tz);
        deliveryRule_(f.rule,write,item.tz);
        const baseline=item.record.collected||item.record.issued;
        if(baseline&&next<baseline)throw new Error('A entrega não pode ser anterior à coleta ou emissão da nota.');
      }
      item.changed.push({...f,next,write,mode:change.mode});
    }
  }
}

function transportColumnLetter_(col) {
  let name='';
  for(let n=col;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
  return name;
}

function transportEditWrite_(sh, items) {
  const groups=new Map();
  for(const item of items){
    for(const field of item.changed){
      if(!groups.has(field.col))groups.set(field.col,[]);
      groups.get(field.col).push({n:item.n,field});
    }
  }
  for(const [index, entries] of groups){
    let rows=entries;
    const col=index+1, letter=transportColumnLetter_(col);
    if(rows[0].field.name==='category'){
      // Amplia apenas a validação das células que receberão uma categoria cadastrada no app.
      rows=rows.filter(({n,field})=>{
        const {next,rule,nativeOptions,args}=field;
        if(!next||!rule||nativeOptions?.includes(next))return true;
        try{
          const validation=rule.copy().requireValueInList([...nativeOptions,next],args[1]!==false).build();
          sh.getRange(n,col).setDataValidation(validation);
          return true;
        }catch(error){
          console.warn('Uma validação de categoria do SAC precisa de conferência.');
          return false;
        }
      });
    }
    if(!rows.length)continue;
    const initial=rows[0].field;
    try{
      if(initial.mode==='replace'){
        sh.getRangeList(rows.map(x=>letter+x.n)).setValue(initial.write);
        continue;
      }
      rows.sort((a,b)=>a.n-b.n);
      let first=rows[0].n, values=[];
      for(const x of rows){
        if(x.n!==first+values.length){
          sh.getRange(first,col,values.length,1).setValues(values);
          first=x.n;
          values=[];
        }
        values.push([x.field.write]);
      }
      sh.getRange(first,col,values.length,1).setValues(values);
    }catch(error){
      console.warn('Uma coluna do lote do SAC precisa de conferência.');
    }
  }
}

function transportEditVerify_(sh, items, layout) {
  const {headers,tz}=layout, byRow=new Map(items.map(x=>[x.n,x])), confirmed=new Map();
  for(const {first,last} of centralRowBlocks_([...byRow.keys()])){
    const grid=sh.getRange(first,1,last-first+1,headers.length);
    let raw,display;
    try{raw=grid.getValues();display=grid.getDisplayValues();}catch(error){continue;}
    for(let i=0;i<raw.length;i++){
      const item=byRow.get(first+i);
      if(!item||transportRowKey_(display[i].slice(0,7))!==item.key)continue;
      if(!item.changed.every(f=>f.type==='date'?logDate_(raw[i][f.col],tz)===f.next:display[i][f.col]===f.next))continue;
      const row=logRecords_([headers,raw[i]],'transport',tz,[])[0];
      if(row)confirmed.set(item.key,{...row,id:item.key});
    }
  }
  return confirmed;
}

function centralTransportEdit_(user, p, id, batch) {
  if(!platformAccess_(user).editTransport)throw new Error('Somente o SAC autorizado pode preencher os campos manuais.');
  if(p.kind!=='transport')throw new Error('Fonte de edição inválida.');
  const read=p.action===(batch?'batchRead':'editRead');
  if(!read&&p.action!==(batch?'batchSave':'editSave'))throw new Error('Ação de edição inválida.');
  const keys=batch?p.keys:[p.key];
  if(!Array.isArray(keys)||!keys.length||keys.length>500||keys.some(k=>typeof k!=='string'||!k||k.length>200)||new Set(keys).size!==keys.length){
    throw new Error('Selecione de 1 a 500 notas distintas.');
  }
  const timing=centralTiming_('sac.'+p.action), lock=read?null:LockService.getScriptLock();
  let status='erro',locked=false,attempted=false;
  try{
    const changes=read?null:transportEditChanges_(p,batch);
    if(lock){
      locked=lock.tryLock(3000);
      if(!locked)throw new Error('Outra gravação está em andamento. Seus dados foram mantidos. Tente novamente em instantes.');
      timing.mark('fila');
    }
    const sh=SpreadsheetApp.openById(id).getSheetByName('ACOMPANHAMENTO');
    if(!sh)throw new Error('Acompanhamento sem notas.');
    const categories=transportCategories_(PropertiesService.getScriptProperties(),transportCategoryKey_(id));
    const layout=transportEditLayout_(sh), items=transportEditRows_(sh,user,keys,layout,undefined,categories);
    timing.mark('notasSelecionadas');
    if(read){
      status='ok';
      return transportEditRead_(items,batch);
    }
    transportEditValidate_(items,batch?p.versions:{[keys[0]]:p.version},changes);
    const modified=items.filter(item=>item.changed.length);
    if(!modified.length){
      status='sem_alteracoes';
      return {ok:true,updated:0,unchanged:items.length,failed:[],partial:false,patches:[],message:'Nenhuma alteração para salvar.'};
    }
    // Revalida cabeçalhos e notas localizadas imediatamente antes da gravação.
    const nowLayout=transportEditLayout_(sh);
    if(JSON.stringify(nowLayout.headers)!==JSON.stringify(layout.headers))throw new Error('Os cabeçalhos da planilha mudaram. Reabra o formulário.');
    const latest=transportEditRows_(sh,user,modified.map(x=>x.key),nowLayout,new Map(modified.map(x=>[x.n,x.key])));
    if(latest.some((x,i)=>!x||x.version!==modified[i].version)){
      throw new Error('A planilha mudou durante a edição. Reabra o formulário.');
    }
    timing.mark('validacao');
    attempted=true;
    transportEditWrite_(sh,modified);
    try{SpreadsheetApp.flush();}catch(error){console.warn('Uma gravação do SAC precisa de confirmação.');}
    timing.mark('gravacao');
    const confirmed=transportEditVerify_(sh,modified,layout);
    timing.mark('confirmacao');
    const saved=modified.filter(x=>confirmed.has(x.key)), failed=modified.filter(x=>!confirmed.has(x.key));
    const auditWarning=deliveryAudit_(user,saved);
    if(!batch&&failed.length)throw new Error('Não foi possível confirmar a gravação. Reabra a nota para conferir a planilha antes de repetir.');
    status=failed.length?'parcial':'ok';
    return {ok:true,updated:saved.length,unchanged:items.length-modified.length,
      failed:failed.map(x=>({key:x.key,invoice:x.record.invoice})),partial:failed.length>0,auditWarning,
      updatedAt:new Date().toISOString(),patches:[...confirmed.values()],message:'Dados e data de entrega salvos na planilha. Indicadores atualizados.'};
  }finally{
    if(attempted)try{
      PropertiesService.getScriptProperties().setProperty(centralTransportVersionKey_(id),Utilities.getUuid());
    }catch(error){console.warn('A atualização automática do cache do SAC ficou pendente.');}
    if(locked)lock.releaseLock();
    timing.finish(status);
  }
}

// ── 23. Permissões logísticas e visão geral ──
// Define as permissões de cada área e reúne os dados das cargas em montagem.

const LOG_PERMISSION_KEYS = ['sac','formation','agenda'];
const FORMATION_ROLE = 'FORMACAO_CARGA';

function logisticsPermissions_(record, role, areas) {
  const enabled=areas.includes('logistics');
  const dedicated=role===FORMATION_ROLE, restricted=['SAC','INTERNO'].includes(role);
  const defaults={
    sac:{view:enabled,edit:role==='SAC'&&record.editTransport===true},
    formation:{view:enabled&&!restricted,edit:enabled&&!restricted},
    agenda:{view:enabled&&!restricted&&role!=='SUPERVISOR',edit:false}
  };
  return Object.fromEntries(LOG_PERMISSION_KEYS.map(key=>{
    const preset=role==='ADMIN'?{view:true,edit:true}:dedicated?{view:key!=='sac',edit:key!=='sac'}:
      record.permissions?.[key]||defaults[key];
    const view=enabled&&preset.view===true;
    return [key,{view,edit:view&&preset.edit===true}];
  }));
}

function requireLogPermission_(user,key,mode='view') {
  if(!user||!platformAccess_(user).permissions[key]?.[mode]) {
    throw new Error(mode==='edit'?'Seu perfil não tem permissão para editar esta área.':'Seu perfil não tem acesso a esta área.');
  }
}

function formWideScope_(user) {
  return ['ADMIN','DIRETOR','GERENTE',FORMATION_ROLE].includes(user.perfil);
}

function formOverviewSummary_(user, ids=null, st=null) {
  requireLogPermission_(user,'formation');
  if (!st) st = formExpState_(formExpAux_(true));
  const snapshots=formDirectSnapshot_(st);
  const fleet=new Map(formFleetOptions_(st,true).vehicles.map(v=>[v.plate,v]));
  const assigned=new Map();
  for(const [key,a] of Object.entries(st.assignments)) {
    if(!assigned.has(a.montageId))assigned.set(a.montageId,[]);
    assigned.get(a.montageId).push(key);
  }
  const items=[];
  for(const m of Object.values(st.montages)){
    if(ids?!ids.has(m.id):m.status!==FORM_OPEN)continue;
    const keys=assigned.get(m.id)||[];
    if(keys.some(k=>!snapshots[k]||!formDirectAllowed_(user,snapshots[k]))||
       !keys.length&&!formWideScope_(user)&&m.owner!==user.login)continue;
    const members=keys.map(k=>{
      const o=snapshots[k], w=st.orderWeights[k];
      return w&&(w.version===o.version||w.version===o.previousVersion)?{...o,weight:w.weight,weightIncomplete:false}:o;
    });
    const destinations=new Map();
    for(const o of members){
      if(!o.city)continue;
      const label=[o.city,o.uf].filter(Boolean).join(' / ');
      destinations.set(label,(destinations.get(label)||0)+1);
    }
    const vehicle=m.vehicleSnapshot||fleet.get(m.vehicleId);
    const capacity=m.capacitySnapshot||formFleetCapacity_(members,vehicle);
    items.push({
      id:m.id,name:m.name,status:m.status,orders:keys.length,driver:m.driver,vehicleId:m.vehicleId,
      vehicle:vehicle?{plate:vehicle.plate,type:vehicle.type}:null,overweightOccurrences:m.overweightOccurrences,
      ...capacity,destinations:[...destinations].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')).map(([name,count])=>({name,count}))
    });
  }
  return {ok:true,revision:st.revision,items};
}

// ── 24. Agenda de Motoristas ──
// Consulta e salva programações por período e associa as atividades às montagens.

const AGENDA_SHEET='AGENDA_MOTORISTAS_EVENTOS';
const AGENDA_HEADERS=['PROGRAMAÇÃO_ID','REQUISIÇÃO_ID','DATA_HORA','USUÁRIO','PROGRAMAÇÃO_JSON'];

function agendaLegacy_(user, id) {
  const rows=centralLogisticsRead_(user,{},'schedule',id).rows;
  const repetitions=new Map();
  return rows.filter(r=>r.date).map(r=>{
    const identity=r.date+'|'+logNorm_(r.driver);
    const sequence=(repetitions.get(identity)||0)+1;
    repetitions.set(identity,sequence);
    return {
      id:'leg_'+digestHex_(identity+'|'+sequence).slice(0,24),driver:r.driver,date:r.date,time:'',
      activity:'Programação',destination:r.destination,vehicle:'',notes:'',montageId:'',
      version:digestHex_(JSON.stringify([identity,sequence,r.destination])).slice(0,24),legacy:true
    };
  });
}

function agendaSheet_(create=false) {
  const ss=formExpAux_(true);
  let sh=ss.getSheetByName(AGENDA_SHEET);
  if(!sh&&create){
    sh=ss.insertSheet(AGENDA_SHEET);
  }
  if(!sh)return null;
  if(!sh.getLastRow()&&create){
    sh.getRange(1,1,1,AGENDA_HEADERS.length).setValues([AGENDA_HEADERS]);
    sh.setFrozenRows(1);
  }
  if(sh.getLastRow()&&sh.getRange(1,1,1,AGENDA_HEADERS.length).getDisplayValues()[0].join('|')!==AGENDA_HEADERS.join('|')){
    throw new Error('Cabeçalhos da agenda divergentes.');
  }
  return sh;
}

function agendaEvent_(row) {
  const item=JSON.parse(String(row[4]));
  return {...item,id:String(row[0]),version:String(row[1]),updatedAt:String(row[2]),updatedBy:String(row[3])};
}

function agendaLatest_(sh, column, value) {
  const last=sh.getLastRow();
  if(last<2)return null;
  const matches=sh.getRange(2,column,last-1,1).createTextFinder(value).matchEntireCell(true).matchCase(true).findAll();
  if(!matches.length)return null;
  const row=Math.max(...matches.map(cell=>cell.getRow()));
  return agendaEvent_(sh.getRange(row,1,1,5).getValues()[0]);
}

function agendaSnapshot_(sh) {
  if(!sh)return [];
  const last=sh.getLastRow();
  if(last<2)return [];
  const tail=sh.getRange(last,2).getDisplayValue();
  const key='RBN_AGENDA_V1_'+digestHex_(sh.getParent().getId()+'|'+last+'|'+tail).slice(0,28);
  const cache=CacheService.getScriptCache(), cached=centralCacheRead_(cache,key);
  if(cached)return cached;
  const latest=new Map();
  for(const row of sh.getRange(2,1,last-1,5).getValues()) {
    if(row[0])latest.set(String(row[0]),agendaEvent_(row));
  }
  const items=[...latest.values()];
  centralCacheWrite_(cache,key,JSON.stringify(items),300);
  return items;
}

function agendaCargoDays_(montage, summary, from, to) {
  const {departure, expectedEnd} = montage.schedule;
  const start = Date.parse(departure < from ? from : departure);
  const end = Date.parse(expectedEnd > to ? to : expectedEnd);
  const destination = summary.destinations.map(item => item.name).join(' · ');
  const rows = [];
  for (let stamp = start; stamp <= end; stamp += 86400000) {
    const date = new Date(stamp).toISOString().slice(0,10);
    const activity = departure === expectedEnd ? 'Saída e previsão de finalização' :
      date === departure ? 'Saída de carga' : date === expectedEnd ? 'Previsão de finalização' : 'Carga programada';
    rows.push({
      id: 'cargo_' + montage.id + '_' + date, date, time:'', activity,
      driver: summary.driver, vehicle: summary.vehicle?.plate || summary.vehicleId || '',
      destination, montageId: summary.id, montage: summary, schedule: montage.schedule, automatic: true
    });
  }
  return rows;
}

function agendaPublic_(user, rows, from='', to='') {
  const canSee=platformAccess_(user).permissions.formation.view;
  const links=new Set(rows.map(r=>r.montageId).filter(Boolean));
  const st=canSee&&(from||links.size)?formExpState_(formExpAux_(true)):null;
  const scheduled=from&&st?Object.values(st.montages).filter(m=>m.status===FORM_FINAL&&m.route?.confirmed&&m.driver&&
    m.schedule&&m.schedule.departure<=to&&m.schedule.expectedEnd>=from):[];
  scheduled.forEach(m=>links.add(m.id));
  const montages=st&&links.size?new Map(formOverviewSummary_(user,links,st).items.map(m=>[m.id,m])):new Map();
  const visible=rows.map(r=>{
    const montage=montages.get(r.montageId)||null;
    return {...r,montageId:montage?.id||'',montage};
  });
  return visible.concat(scheduled.flatMap(m=>montages.has(m.id)?agendaCargoDays_(m,montages.get(m.id),from,to):[]));
}

function agendaText_(input, field, max, required=false) {
  const value=logText_(input[field]);
  if(value.length>max||required&&!value)throw new Error('Confira o campo '+({driver:'motorista',activity:'atividade',destination:'destinos',vehicle:'veículo',notes:'observações'}[field]||field)+'.');
  return value;
}

function agendaSave_(user,p,operationsId) {
  requireLogPermission_(user,'agenda','edit');
  const requestId=String(p.requestId||'');
  if(!/^[a-f0-9]{32}$/i.test(requestId))throw new Error('Identificador de operação inválido.');
  const input=p.item||{}, id=String(input.id||'');
  if(id&&!/^(?:ag_[a-f0-9-]{36}|leg_[a-f0-9]{24})$/i.test(id))throw new Error('Programação inválida.');
  const date=logDate_(input.date);
  const time=String(input.time||'');
  if(!date||date!==input.date||time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Confira a data e o horário.');
  const item={date,time,driver:agendaText_(input,'driver',120,true),activity:agendaText_(input,'activity',180,true),
    destination:agendaText_(input,'destination',500),vehicle:agendaText_(input,'vehicle',120),notes:agendaText_(input,'notes',1200),
    montageId:''};
  // Leitura da programação legada fora da seção de gravação.
  const legacy=id.startsWith('leg_')?agendaLegacy_(user,operationsId).find(x=>x.id===id):null;
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(3000))throw new Error('Outra gravação está em andamento. Tente novamente.');
  let saved;
  try{
    const sh=agendaSheet_(true), previousRequest=agendaLatest_(sh,2,requestId);
    if(previousRequest) {
      if(previousRequest.updatedBy!==user.login)throw new Error('Identificador de operação indisponível.');
      saved=agendaLatest_(sh,1,previousRequest.id)||previousRequest;
    }else{
      const previous=id?(agendaLatest_(sh,1,id)||legacy):null;
      if(id&&(!previous||input.version!==previous.version))throw new Error('A programação mudou. Atualize o calendário antes de salvar.');
      const requested=String(input.montageId||'');
      const mayLink=platformAccess_(user).permissions.formation.view;
      if(requested||previous?.montageId){
        const st=formExpState_(formExpAux_(true));
        let currentVisible=false;
        if(mayLink&&previous?.montageId){
          try{formFleetCanManage_(user,st,previous.montageId);currentVisible=true;}catch(error){}
        }
        if(requested){
          requireLogPermission_(user,'formation');
          formFleetCanManage_(user,st,requested);
        }
        item.montageId=requested||(!currentVisible?previous?.montageId||'':'');
      }
      const key=id||'ag_'+Utilities.getUuid(), row=sh.getLastRow()+1;
      if(row>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),50);
      const values=[key,requestId,new Date().toISOString(),user.login,JSON.stringify(item)];
      sh.getRange(row,1,1,5).setValues([values]);
      SpreadsheetApp.flush();
      saved=agendaEvent_(values);
    }
  }finally{lock.releaseLock();}
  // A referência pode ser consultada separadamente caso o resumo esteja temporariamente indisponível.
  let result={...saved,montageId:''};
  try{[result]=agendaPublic_(user,[saved]);}catch(error){console.warn('Vínculo da agenda será apresentado na próxima consulta.');}
  return {ok:true,item:result,message:'Programação salva.'};
}

function agendaApi_(user,p,id) {
  requireLogPermission_(user,'agenda');
  if(p.action==='save')return agendaSave_(user,p,id);
  if(p.action==='options'){
    requireLogPermission_(user,'agenda','edit');
    const st=formExpState_(formExpAux_(true)), fleet=formFleetOptions_(st);
    const ids=new Set(Object.keys(st.montages));
    const montages=platformAccess_(user).permissions.formation.view?formOverviewSummary_(user,ids).items:[];
    return {ok:true,drivers:[...new Set([...fleet.drivers.map(x=>x.name),...agendaLegacy_(user,id).map(x=>x.driver)])],
      vehicles:fleet.vehicles.map(v=>({plate:v.plate,type:v.type})),montages};
  }
  if(p.action&&p.action!=='read')throw new Error('Operação de agenda inválida.');
  const from=logDate_(p.from), to=logDate_(p.to);
  if(!from||!to||from!==p.from||to!==p.to||to<from||Date.parse(to)-Date.parse(from)>42*86400000){
    throw new Error('Informe um período de até 43 dias para a agenda.');
  }
  const saved=agendaSnapshot_(agendaSheet_()), replaced=new Set(saved.map(x=>x.id));
  const rows=agendaLegacy_(user,id).filter(r=>!replaced.has(r.id)).concat(saved)
    .filter(r=>r.date>=from&&r.date<=to);
  const visible=agendaPublic_(user,rows,from,to)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.driver.localeCompare(b.driver,'pt-BR'));
  return {ok:true,rows:visible};
}


// Visão equipes: leitura mensal das mesmas fontes comerciais, sem alterar as bases.
// Metas adicionais, quando disponíveis: METAS_INDICADORES (MES, COD_RCA, INDICADOR, META).
function teamsList_(value) {
  return (Array.isArray(value)?value:value==null||value===''||value==='Todos'?[]:[value]).map(String).filter(v=>v&&v!=='Todos');
}

function teamsNationalHolidays_(year) {
  // Calendário nacional; pontos facultativos só entram se cadastrados em FERIADOS.
  // Referência: Portaria MGI 11.460/2025, calendário de 2026.
  const fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','12-25'];
  if(year>=2024)fixed.push('11-20');
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  const friday=new Date(Date.UTC(year,month-1,day-2)).toISOString().slice(0,10);
  return new Set(fixed.map(v=>year+'-'+v).concat(friday));
}

function teamsCalendar_(month,lastBilled,today,extra=[]) {
  const [year,number]=month.split('-').map(Number),start=month+'-01';
  const end=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  const current=today.slice(0,7),future=month>current;
  const cutoff=future?'':month<current?end:(lastBilled&&lastBilled<=today?lastBilled:today);
  const holidays=teamsNationalHolidays_(year);
  extra.forEach(day=>holidays.add(day));
  let total=0,elapsed=0,elapsedToday=0;
  for(let at=Date.parse(start+'T12:00:00Z');at<=Date.parse(end+'T12:00:00Z');at+=86400000){
    const day=new Date(at),iso=day.toISOString().slice(0,10);
    if(day.getUTCDay()===0||day.getUTCDay()===6||holidays.has(iso))continue;
    total++;
    if(cutoff&&iso<=cutoff)elapsed++;
    if(iso<=today)elapsedToday++;
  }
  return {month,start,end,cutoff,lastBilled:lastBilled||'',total,elapsed,remaining:total-elapsed,remainingToday:total-elapsedToday,
    factor:future||!elapsed?null:month<current?1:total/elapsed,
    closed:month<current,future,holidays:[...holidays].filter(day=>day.startsWith(month)).sort()};
}

function teamsReference_(month) {
  const ss=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId),holidays=[],goals=[];
  const holidaySheet=ss.getSheetByName('FERIADOS');
  if(holidaySheet&&holidaySheet.getLastRow()>1){
    const rows=holidaySheet.getDataRange().getValues(),headers=rows.shift().map(logNorm_),column=headers.indexOf('DATA');
    if(column>=0)for(const row of rows){const day=logDate_(row[column],ss.getSpreadsheetTimeZone());if(day)holidays.push(day);}
  }
  const goalSheet=ss.getSheetByName('METAS_INDICADORES');
  if(goalSheet&&goalSheet.getLastRow()>1){
    const range=goalSheet.getDataRange(),rows=range.getValues(),formats=range.getNumberFormats();
    const header=rows.shift().map(logNorm_),at=name=>header.indexOf(name);
    if(['MES','COD_RCA','INDICADOR','META'].some(name=>at(name)<0))throw new Error('Revise as colunas de METAS_INDICADORES: MES, COD_RCA, INDICADOR e META.');
    const aliases={POSITIVACAO:'clients',POSITIVACOES:'clients',MIX:'mix','MIX DE PRODUTOS':'mix','MIX POR CLIENTE':'mix',MARGEM:'margin','MARGEM BRUTA':'margin',TICKET:'ticket','TICKET MEDIO':'ticket'};
    rows.forEach((row,i)=>{
      const raw=row[at('MES')],key=raw instanceof Date?Utilities.formatDate(raw,ss.getSpreadsheetTimeZone(),'yyyy-MM'):String(raw||'').trim();
      if(key!==month)return;
      const indicator=aliases[logNorm_(row[at('INDICADOR')])],rca=code_(row[at('COD_RCA')]);
      let value=num_(row[at('META')]);
      if(indicator==='margin'&&String(formats[i+1][at('META')]).includes('%'))value*=100;
      if(indicator&&rca!=null&&value>0)goals.push({rca,indicator,value,department:at('DEPARTAMENTO')<0?'':String(row[at('DEPARTAMENTO')]||'').trim()});
    });
  }
  return {holidays,goals};
}

function teamsBucket_() {
  return {revenue:0,profit:0,missingProfit:0,clients:new Map(),orders:new Set(),lines:0};
}

function teamsAddSale_(bucket,sale) {
  bucket.revenue+=sale.value;bucket.lines++;
  if(sale.profit==null&&sale.value!==0)bucket.missingProfit++;
  else bucket.profit+=sale.profit||0;
  if(sale.order)bucket.orders.add(sale.rca+'|'+sale.order);
  if(sale.value>0&&sale.client!=null){
    if(!bucket.clients.has(sale.client))bucket.clients.set(sale.client,new Set());
    if(sale.product!=null)bucket.clients.get(sale.client).add(sale.product);
  }
}

function teamsMetrics_(bucket,canMargin) {
  const clients=bucket.clients.size,pairs=[...bucket.clients.values()].reduce((sum,products)=>sum+products.size,0);
  return {revenue:bucket.revenue,clients,mix:clients?pairs/clients:null,ticket:clients?bucket.revenue/clients:null,
    margin:canMargin&&bucket.revenue>0&&!bucket.missingProfit?100*bucket.profit/bucket.revenue:null,
    marginMissingLines:canMargin?bucket.missingProfit:null,orders:bucket.orders.size,lines:bucket.lines};
}

function teamsDate_(value,tz) {
  // Mesma normalização civil do cache comercial, sem chamada ao serviço por linha.
  return typeof value==='number'?logDate_(value,tz):(dateIso_(value)||'').slice(0,10);
}

// O cache interno contém todas as vendas do mês. O recorte de acesso é aplicado
// antes de devolver qualquer agregado ao usuário, inclusive em acertos de cache.
function teamsSalesMonth_(month,version,today) {
  const cache=CacheService.getScriptCache(),key='TEAMS_MONTH_V1_'+digestHex_(month+'|'+version+'|'+today).slice(0,32);
  const saved=centralCacheRead_(cache,key);if(saved)return saved;
  const directory=new Map(portfolioClients_({perfil:'ADMIN'}).links.map(([child,parent])=>[String(child),parent]));
  const source=SpreadsheetApp.openById(CFG.salesSpreadsheetId),tz=source.getSpreadsheetTimeZone();
  let lastBilled='';
  const records=[];
  // Uma venda pode ser faturada em ano diferente do ano original do pedido.
  for(const sourceYear of CFG.years){
  const sheet=source.getSheetByName(String(sourceYear));
  if(!sheet)continue;
  const headers=headerIndex_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]);
  const needed=['Posição','Data Faturamento','Cod/Vend.','Cod/Cliente','Cod/Produto','Pedidos Enviados','DEPARTAMENTO','MUNICENT','ESTENT'];
  if(needed.some(name=>headers[name]==null))throw new Error('A base comercial não possui todas as colunas necessárias para o ranking.');
  const width=Math.max(...needed.concat(['Vl Lucro','NUMPED']).map(name=>headers[name]??-1))+1;
  const count=Math.max(0,sheet.getLastRow()-1);
  if(count){
    const billings=sheet.getRange(2,headers['Data Faturamento']+1,count,1).getValues(),statuses=sheet.getRange(2,headers['Posição']+1,count,1).getValues(),blocks=new Set();
    for(let i=0;i<count;i++){
      if(norm_(statuses[i][0])!=='FECHADO')continue;
      const day=teamsDate_(billings[i][0],tz);
      if(!day.startsWith(month)||day>today)continue;
      if(day>lastBilled)lastBilled=day;
      blocks.add(Math.floor(i/4000));
    }
    for(const block of blocks){
      const first=2+block*4000,rows=sheet.getRange(first,1,Math.min(4000,count-block*4000),width).getValues();
      for(const row of rows){
        if(norm_(cell_(row,headers,'Posição'))!=='FECHADO')continue;
        const day=teamsDate_(cell_(row,headers,'Data Faturamento'),tz);
        if(!day.startsWith(month)||day>today)continue;
        const rca=code_(cell_(row,headers,'Cod/Vend.'));
        if(rca==null)continue;
        const department=String(cell_(row,headers,'DEPARTAMENTO')||'').trim(),rawCity=String(cell_(row,headers,'MUNICENT')||'').trim(),uf=norm_(cell_(row,headers,'ESTENT'));
        const client=code_(cell_(row,headers,'Cod/Cliente')),rawProfit=cell_(row,headers,'Vl Lucro');
        const knownProfit=typeof rawProfit==='number'&&Number.isFinite(rawProfit)||typeof rawProfit==='string'&&/^\s*-?\d[\d.,]*\s*$/.test(rawProfit);
        const sale={rca,client:client==null?null:directory.get(String(client))??client,product:code_(cell_(row,headers,'Cod/Produto')),
          department,city:rawCity,uf,order:String(cell_(row,headers,'NUMPED')||''),value:num_(cell_(row,headers,'Pedidos Enviados')),profit:knownProfit?num_(rawProfit):null};
        records.push(sale);
      }
    }
  }
  }
  const result={records,lastBilled};
  centralCacheWrite_(cache,key,JSON.stringify(result),21600);
  return result;
}

function teamsGroupMap_(aux) {
  // A matriz distingue os especialistas de Saúde dos RCAs que atendem várias linhas.
  // Um nome presente também em Nutrição, Aves ou Suínos permanece nas demais equipes.
  const cities=coverageData_().cities,health=new Set(),general=new Set();
  for(const city of cities){
    if(city.animalHealth)health.add(norm_(city.animalHealth));
    for(const field of ['nutrition','poultry','swine'])if(city[field])general.add(norm_(city[field]));
  }
  return new Map(aux.rcas.map(person=>[String(person.code),health.has(norm_(person.name))&&!general.has(norm_(person.name))?'health':'other']));
}

function teamsView_(user,payload) {
  if(!['ADMIN','DIRETOR','GERENTE','SUPERVISOR','RCA'].includes(user.perfil))throw new Error('Seu perfil não tem acesso à visão de equipes.');
  const f=payload.filters||{},year=Number(f.year),monthNumber=Number(f.month);
  if(!CFG.years.map(Number).includes(year)||!Number.isInteger(monthNumber)||monthNumber<1||monthNumber>12)throw new Error('Selecione um ano e um mês para comparar as equipes.');
  const month=year+'-'+String(monthNumber).padStart(2,'0'),today=centralToday_('America/Fortaleza');
  const aux=readAuxiliary_(),reference=teamsReference_(month),departments=teamsList_(f.department),supervisors=teamsList_(f.supervisor),sellers=teamsList_(f.rca);
  const ufs=teamsList_(f.uf).map(norm_),city=teamsList_(f.city).map(norm_),region=teamsList_(f.region).map(norm_);
  const group=f.teamGroup==='health'?'health':'other',groups=teamsGroupMap_(aux);
  const catalog=new Map(aux.rcas.map(rca=>[String(rca.code),rca]));
  const activeAllowed=code=>catalog.get(String(code))?.active===true&&userAllowsRca_(user,code);
  const groupAllowed=code=>activeAllowed(code)&&groups.get(String(code))===group;
  const sellerAllowed=code=>groupAllowed(code)&&(!sellers.length||sellers.includes(String(code)))&&
    (!supervisors.length||supervisors.includes(String(catalog.get(String(code))?.supervisor||'Sem supervisor')));
  const supervisorOptions=[...new Set(aux.rcas.filter(person=>activeAllowed(person.code)).map(person=>person.supervisor||'Sem supervisor'))]
    .sort((a,b)=>a.localeCompare(b,'pt-BR')).map(name=>({name,count:aux.rcas.filter(person=>groupAllowed(person.code)&&(person.supervisor||'Sem supervisor')===name).length}));
  const groupCounts=Object.fromEntries(['other','health'].map(key=>[key,aux.rcas.filter(person=>activeAllowed(person.code)&&groups.get(String(person.code))===key).length]));
  const canMargin=['ADMIN','DIRETOR','GERENTE'].includes(user.perfil);
  const version=SCRIPT_PROPS.getProperty('SNAPSHOT_UPDATED_AT')||'';
  const key='TEAMS_VIEW_V3_'+digestHex_(JSON.stringify([month,today,version,f,group,user.login,user.perfil,user.accessVersion,user.supervisor,user.cod_rca,aux.goals,reference,
    aux.rcas.map(person=>[person.code,person.name,person.supervisor,person.active,groups.get(String(person.code))])])).slice(0,40);
  const cache=CacheService.getScriptCache(),saved=centralCacheRead_(cache,key);
  if(saved)return saved;
  const buckets=new Map(),overall=teamsBucket_();
  for(const rca of aux.rcas)if(sellerAllowed(rca.code))buckets.set(String(rca.code),teamsBucket_());
  const monthly=teamsSalesMonth_(month,version,today),lastBilled=monthly.lastBilled;
  for(const sale of monthly.records){
    const rca=sale.rca;
    if(!sellerAllowed(rca))continue;
    if(departments.length&&!departments.includes(sale.department)||ufs.length&&!ufs.includes(sale.uf)||city.length&&!city.includes(norm_(sale.city)))continue;
    if(region.length&&!region.includes(norm_(aux.routeMap.get(rca+'|'+norm_(sale.city))||'')))continue;
    teamsAddSale_(buckets.get(String(rca)),sale);teamsAddSale_(overall,sale);
  }
  const calendar=teamsCalendar_(month,lastBilled,today,reference.holidays);
  const rows=[...buckets].map(([code,bucket])=>{
    const person=catalog.get(code)||{},actual=teamsMetrics_(bucket,canMargin);
    const values=aux.goals.filter(goal=>goal.monthKey===month&&String(goal.rca)===code&&(!departments.length||departments.includes(goal.department)));
    const revenueGoal=values.length?values.reduce((sum,goal)=>sum+goal.value,0):null;
    const goals={revenue:revenueGoal>0?revenueGoal:null,clients:null,mix:null,margin:null,ticket:null};
    for(const indicator of ['clients','mix','margin','ticket']){
      const goalsInScope=reference.goals.filter(goal=>String(goal.rca)===code&&goal.indicator===indicator&&
        (departments.length?departments.length===1&&departments.includes(goal.department):!goal.department));
      if(goalsInScope.length===1)goals[indicator]=goalsInScope[0].value;
    }
    const projected=calendar.factor==null?null:actual.revenue*calendar.factor;
    return {code:Number(code),name:person.name||'RCA '+code,supervisor:person.supervisor||'Sem supervisor',active:true,teamGroup:group,...actual,goals,
      attainment:goals.revenue?actual.revenue/goals.revenue*100:null,projected,projectedAttainment:goals.revenue&&projected!=null?projected/goals.revenue*100:null};
  });
  const result={ok:true,rows,summary:teamsMetrics_(overall,canMargin),calendar,canMargin,teamGroup:group,groupCounts,supervisorOptions,
    goalScopeLimited:Boolean(ufs.length||city.length||region.length),updatedAt:new Date().toISOString(),baseUpdatedAt:version};
  centralCacheWrite_(cache,key,JSON.stringify(result),180);
  return result;
}
