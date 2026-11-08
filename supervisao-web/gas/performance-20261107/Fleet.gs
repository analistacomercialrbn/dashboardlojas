// Frota, pesos e finalização persistem no mesmo histórico auxiliar das montagens.
function formFleetPlate_(value){return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function formFleetValidPlate_(plate){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate);}
function formFleetHistory_(){
 const id=PropertiesService.getScriptProperties().getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,cache=CacheService.getScriptCache(),key='FORM_FLEET_V1_'+id,saved=cache.get(key);if(saved){try{return JSON.parse(saved);}catch(e){}}
 const ss=SpreadsheetApp.openById(id),sh=ss.getSheetByName('FORMAÇÃO 2026'),vehicles={},drivers={};
 const add=(raw,driver)=>{const text=logText_(raw).toUpperCase(),match=text.match(/\b([A-Z]{3}[- ]?[0-9][A-Z0-9]{3})\b/);if(!match)return;const plate=formFleetPlate_(match[1]),type=text.replace(match[0],'').replace(/[-–()]/g,' ').trim();if(!vehicles[plate])vehicles[plate]={plate,type,capacityKg:null,defaultDriver:logText_(driver),active:true,source:'Histórico',needsReview:!formFleetValidPlate_(plate)};else if(!vehicles[plate].type&&type)vehicles[plate].type=type;};
 if(sh&&sh.getLastRow()>2)for(const r of sh.getRange(3,12,sh.getLastRow()-2,4).getValues().sort((a,b)=>formFleetDate_(b[3])-formFleetDate_(a[3]))){add(r[0],r[1]);if(logText_(r[1]))drivers[logNorm_(r[1])]={name:logText_(r[1]),active:true,source:'Histórico'};}
 const base=ss.getSheetByName('BASE DE DADOS');if(base)for(const r of base.getRange(2,1,Math.min(200,Math.max(1,base.getLastRow()-1)),5).getDisplayValues()){add(r[0],'');if(logText_(r[4]))drivers[logNorm_(r[4])]={name:logText_(r[4]),active:true,source:'Histórico'};}
 const result={vehicles,drivers};try{cache.put(key,JSON.stringify(result),120);}catch(e){}return result;
}
function formFleetCanManage_(user,st,id){const m=Object.prototype.hasOwnProperty.call(st.montages,id)?st.montages[id]:null;if(!m)throw new Error('Montagem não encontrada.');const keys=Object.keys(st.assignments).filter(k=>st.assignments[k].montageId===id),saved=formDirectSnapshot_(st);if(keys.some(k=>!saved[k]||!formDirectAllowed_(user,saved[k])))throw new Error('Montagem fora do seu recorte.');if(!keys.length&&!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)&&m.owner!==user.login)throw new Error('Montagem fora do seu recorte.');return m;}
function formFleetAssertMove_(st,p){if(['ADICIONAR','TRANSFERIR','RENOMEAR'].includes(p.operation)&&st.montages[p.target]&&st.montages[p.target].status==='Finalizada')throw new Error('Reabra a montagem de destino antes de alterá-la.');for(const key of p.keys||[]){const a=st.assignments[key];if(a&&st.montages[a.montageId].status==='Finalizada')throw new Error('Reabra a montagem antes de mover seus pedidos.');}}

function formFleetDate_(v){if(v instanceof Date)return v.getTime();const s=String(v||''),m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?Date.UTC(+m[3],+m[2]-1,+m[1]):0;}
function verificarFrotaMontagemRbn(){const st=formExpState_(formExpAux_(true)),fleet=formFleetOptions_(st);console.log(JSON.stringify({revisao:st.revision,montagens:Object.values(st.montages).map(m=>({nome:m.name,status:m.status,pedidos:Object.values(st.assignments).filter(a=>a.montageId===m.id).length})),veiculos:fleet.vehicles,motoristas:fleet.drivers.map(d=>d.name)}));}

function formFleetHydrate_(st) {
  st.fleetVehicles = {};
  st.fleetDrivers = {};
  st.orderWeights = {};
  st.routeUnits = {};
  st.routePreferences = null;
  for (const m of Object.values(st.montages)) {
    Object.assign(m, { status: 'Em montagem', vehicleId: '', driver: '', finalizedAt: '',
      vehicleSnapshot: null, capacitySnapshot: null, finalAlerts: [], route: null });
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
          if (m.status !== 'Finalizada' && m.vehicleId === d.previousPlate) m.vehicleId = v.plate;
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
          if (m.status !== 'Finalizada' && logNorm_(m.driver) === oldKey) m.driver = driver.name;
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

    if (!Object.prototype.hasOwnProperty.call(st.montages,e.to)) continue;
    const m = st.montages[e.to];
    if (e.type === 'CRIAR' && d.company) m.company = d.company;
    if (e.type === 'CONFIGURAR_CARGA') {
      m.vehicleId = d.vehicleId;
      m.driver = d.driver;
    }
    if (e.type === 'FINALIZAR') {
      Object.assign(m, {status: 'Finalizada', finalizedAt: e.at, vehicleSnapshot: d.vehicleSnapshot,
        capacitySnapshot: d.capacitySnapshot || null, finalAlerts: d.alerts || []});
    }
    if (e.type === 'REABRIR') {
      Object.assign(m, {status: 'Em montagem', finalizedAt: '', vehicleSnapshot: null,
        capacitySnapshot: null, finalAlerts: [], route: null});
    }
    if (e.type === 'ROTEIRO_SALVAR') m.route = {...d.route, at: e.at, by: e.by};
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
    if (w && w.version === o.version) {
      Object.assign(o, {weight: w.weight, weightIncomplete: false, weightSource: w.source, weightAt: w.at});
    } else if (w) {
      Object.assign(o, {weight: null, weightIncomplete: true,
        weightNote: 'O pedido foi atualizado. Confira e informe o peso novamente.'});
    }
    if (routeOrders[o.key]) o.deliveryStop = routeOrders[o.key];
    byKey[o.key] = o;
    const row = o.sourceRows[0];
    if (row) Object.assign(row, {weight:o.weight, availableWeight:o.montageId ? 0 : o.weight,
      mountedWeight:o.montageId ? o.weight : 0});
  }

  for (const m of view.montages) {
    const stored = st.montages[m.id];
    const closed = stored.status === 'Finalizada';
    const members = m.orderKeys.map(k => byKey[k]);
    const vehicle = (closed && stored.vehicleSnapshot) || allFleet.vehicles.find(v => v.plate === stored.vehicleId);
    const capacity = (closed && stored.capacitySnapshot) || formFleetCapacity_(members, vehicle);
    Object.assign(m, capacity, {vehicle:vehicle || null, vehicleId:stored.vehicleId, driver:stored.driver,
      finalizedAt:stored.finalizedAt, weight:capacity.totalWeightKg});
    m.alerts = closed && stored.capacitySnapshot ? stored.finalAlerts : formFleetWarnings_(m);
    m.finishReasons = [];
    if (!m.orders) m.finishReasons.push('Adicione pedidos');
    if (!vehicle) m.finishReasons.push('Escolha o veículo');
    if (!m.driver) m.finishReasons.push('Escolha o motorista');
    if (vehicle && !vehicle.type) m.finishReasons.push('Cadastre o tipo do veículo');
    if (m.sourceIssues) m.finishReasons.push('Revise pedidos alterados na origem');
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

function formFleetFinish_(st, catalog, user, p, target, sourceState) {
  if (p.confirmed !== true) throw new Error('Confirme a finalização.');
  if (formDirectSourceState_() !== sourceState) throw new Error('A base foi atualizada. Confira a montagem novamente.');
  const item = formDirectView_(st, catalog, user).montages.find(m => m.id === target);
  if (!item?.canFinalize) throw new Error(item ? item.finishReasons.join(' · ') : 'Montagem indisponível.');
  const {knownWeightKg,totalWeightKg,unknownOrders,capacityKg,overCapacity,remainingKg} = item;
  return {
    vehicleSnapshot:{...item.vehicle, driver:item.driver, totalWeightKg},
    capacitySnapshot:{knownWeightKg,totalWeightKg,unknownOrders,capacityKg,overCapacity,remainingKg},
    alerts:item.alerts
  };
}

function formFleetApi_(user, p) {
  formExpAccess_(user);
  if (p.action!=='fleetSave'||!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||''))) {
    throw new Error('Identificador de operação inválido.');
  }
  const operation=p.operation;
  const settings=['VEICULO_SALVAR','MOTORISTA_SALVAR','UNIDADE_SALVAR','ROTEIRIZACAO_CONFIGURAR'];
  if (![...settings,'CONFIGURAR_CARGA','PESOS_PEDIDOS','FINALIZAR','REABRIR','ROTEIRO_SALVAR'].includes(operation)) {
    throw new Error('Operação inválida.');
  }
  const editingSettings=settings.includes(operation), target=editingSettings?'':String(p.target||'');
  const timing=centralTiming_('formacao.'+operation);
  let status='erro';
  try {
    const ss=formExpAux_(true), initial=formExpState_(ss);
    if (initial.requests[p.requestId]) {
      status='repetido';
      return formAssemblyRetry_(initial,p.requestId);
    }
    let catalog=null, sourceState='';
    if (operation==='FINALIZAR') {
      formFleetCanManage_(user,initial,target);
      sourceState=formDirectSourceState_();
      catalog=formDirectReadCatalog_(sourceState,false,formDirectTargetKeys_(initial,target));
      formDirectGuard_(sourceState);
    } else if (!editingSettings) {
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
    let st, projectionWarning;
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
    if (!settings.includes(operation)) {
      const m = formFleetCanManage_(user, st, target);
      keys = Object.keys(st.assignments).filter(k => st.assignments[k].montageId === target);
      if (m.status === 'Finalizada' && !['REABRIR','ROTEIRO_SALVAR'].includes(operation)) {
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
      if (operation === 'FINALIZAR') data = formFleetFinish_(st, catalog, user, p, target, sourceState);
      if (operation === 'REABRIR') {
        if (m.status !== 'Finalizada' || p.confirmed !== true) throw new Error('Confirme a reabertura da montagem.');
        data = {};
      }
      if (operation === 'ROTEIRO_SALVAR') data = {route:formRouteSaveData_(st, m, keys, p.route || {})};
    }
      const event={id:p.requestId,revision:st.revision+1,at:new Date().toISOString(),by:user.login,type:operation,keys,from:{},to:target,data};
      timing.mark('validacao');
      projectionWarning=formProjectionCommit_(ss,st,event,timing);
    } finally {
      lock.releaseLock();
    }
    let view=null, settingsView=null;
    try {
      if(editingSettings) settingsView=formRouteSettingsView_(st);
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
      FINALIZAR:'Montagem finalizada. Confira o roteiro.',
      REABRIR:'Montagem reaberta para ajustes.',
      ROTEIRO_SALVAR:st.montages[target]?.route?.confirmed?'Roteiro confirmado. Ordem salva nos pedidos.':'Rascunho do roteiro salvo.'
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
