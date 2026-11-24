const FORM_PROJECTION_TABLES = {
  CRIAR: ['MONTAGENS','MONTAGEM_PEDIDOS'],
  ADICIONAR: ['MONTAGEM_PEDIDOS'],
  TRANSFERIR: ['MONTAGEM_PEDIDOS'],
  REMOVER: ['MONTAGEM_PEDIDOS'],
  RENOMEAR: ['MONTAGENS'],
  CONFIGURAR_CARGA: ['MONTAGENS'],
  PESOS_PEDIDOS: ['MONTAGEM_PEDIDOS'],
  FINALIZAR: ['MONTAGENS'],
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
  if (tables.includes('MONTAGENS')) {
    const vehicles = new Map(formFleetOptions_(st,true).vehicles.map(vehicle=>[vehicle.plate,vehicle]));
    formProjectionWrite_(ss,'MONTAGENS',[
      ...FORM_EXP_SCHEMA.MONTAGENS,'PLACA','TIPO_VEICULO','MOTORISTA','CAPACIDADE_KG','FINALIZADO_EM','SITUACAO_ROTEIRO','EMPRESA_SAIDA'
    ],Object.values(st.montages).map(m=>{
      const v=m.vehicleSnapshot||vehicles.get(m.vehicleId)||{};
      const routeStatus=m.status==='Finalizada'?(m.route?.confirmed?'Confirmado':m.route?'Rascunho':'Pendente'):'';
      return [m.id,m.name,m.createdAt,m.owner,m.status,m.vehicleId,v.type||'',m.driver,v.capacityKg||'',m.finalizedAt,routeStatus,FORM_COMPANIES[m.company]||''];
    }));
  }
  if (tables.includes('MONTAGEM_PEDIDOS')) {
    const saved=formDirectSnapshot_(st), routeOrders=formRouteOrders_(st);
    formProjectionWrite_(ss,'MONTAGEM_PEDIDOS',[
      ...FORM_EXP_SCHEMA.MONTAGEM_PEDIDOS,'CLIENTE_CODIGO','CLIENTE','CIDADE','UF','DATA_PEDIDO','STATUS_COMERCIAL','PESO_KG','VOLUMES','ITENS_JSON','FONTE','VERSAO_FONTE','ORDEM_ENTREGA','ENDERECO_ENTREGA'
    ],Object.entries(st.assignments).map(([key,a])=>{
      const o=saved[key], route=routeOrders[key], base=[a.montageId,formExpParseKey_(key).order,key,a.at,a.by];
      return o?base.concat([o.clientCode,o.client,o.city,o.uf,o.date,o.statuses.join(' / '),st.orderWeights[key]?.weight??o.weight??'',o.volumes??'',JSON.stringify(o.products),'FORCA_DE_VENDAS',o.version,route?.number||'',route?.address||'']):base.concat(Array(13).fill(''));
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
  if (!id || !props.getProperty('FORM_PROJECTION_PENDING_'+id)) return;
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(500)) return;
  try {
    const ss=formExpAux_(true), marker=formProjectionMarker_(ss);
    if (!props.getProperty(marker)) return;
    formProjectionUpdate_(ss,formExpState_(ss),[...new Set(Object.values(FORM_PROJECTION_TABLES).flat())]);
    SpreadsheetApp.flush();
    props.deleteProperty(marker);
  } catch (error) {
    console.warn('A recuperação das abas auxiliares será repetida.');
  } finally {
    lock.releaseLock();
  }
}
