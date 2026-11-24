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
  if (montage.status !== 'Finalizada') throw new Error('Finalize a montagem para salvar o roteiro.');
  if (String(input.baseAt || '') !== (montage.route?.at || '') || input.finalizedAt !== montage.finalizedAt) {
    throw new Error('O roteiro ou a montagem mudou. Atualize a tela e confira a sequência.');
  }
  if (montage.route?.confirmed && input.confirmed !== true) {
    throw new Error('Confirme a nova sequência para atualizar um roteiro já confirmado.');
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
    if (address.length > 240 || (confirmed && !address)) throw new Error('Confira os endereços de todas as paradas.');
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
    if (m.status !== 'Finalizada' || !m.route?.confirmed) continue;
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

function verificarLogisticaRbn() {
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
