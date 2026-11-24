
function formDirectClientNames_(){
 const sh=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId).getSheetByName('CLIENTES');
 if(!sh)throw new Error('Cadastro CLIENTES não encontrado na base auxiliar comercial.');
 const values=sh.getDataRange().getValues(),ix=headerIndex_(values.shift()||[]);
 if(ix.CODCLI==null||ix.CLIENTE==null)throw new Error('O cadastro CLIENTES precisa de CODCLI e CLIENTE.');
 const names={},conflicts=new Set();
 for(const r of values){const code=code_(r[ix.CODCLI]),name=logText_(r[ix.CLIENTE]);if(code==null||!name||/^\d+$/.test(name))continue;const key=String(code);if(names[key]&&norm_(names[key])!==norm_(name))conflicts.add(key);else names[key]=name;}
 for(const key of conflicts)delete names[key];return names;
}
function formDirectClientName_(raw,names){
 const code=code_(raw),known=code==null?'':names[String(code)];if(known)return known;
 const text=logText_(raw).replace(/^\s*\d+\s*-\s*/,'').trim();return text&&!/^\d+$/.test(text)?text:'Nome não localizado no cadastro';
}

// Pedidos consultados na base sincronizada do Força de Vendas; escrita somente na auxiliar.
function formDirectCatalog_(){
 const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),tz=ss.getSpreadsheetTimeZone(),out={},clientNames=formDirectClientNames_();
 for(const year of CFG.years){const sh=ss.getSheetByName(year);if(!sh||sh.getLastRow()<2)continue;const width=sh.getLastColumn(),ix=headerIndex_(sh.getRange(1,1,1,width).getDisplayValues()[0]);
  for(const h of ['NUMPED','Cod/Cliente','Cod/Produto','Qt Pedida','Posição','Data Pedido','MUNICENT','ESTENT'])if(ix[h]==null)throw new Error('Coluna comercial ausente: '+h);
  const lo=Math.min(ix['Cod/Cliente'],ix['NUMPED'],ix['Posição']),hi=Math.max(ix['Cod/Cliente'],ix['NUMPED'],ix['Posição']),ids=sh.getRange(2,lo+1,sh.getLastRow()-1,hi-lo+1).getValues(),hits=[],excluded=new Set();ids.forEach((r,i)=>{const order=String(r[ix['NUMPED']-lo]||'').trim(),client=code_(r[ix['Cod/Cliente']-lo]);if(client==null||!/^\d{1,20}$/.test(order))return;const key=formExpOrderKey_(year,String(client),order);if(['PENDENTE','LIBERADO','BLOQUEADO'].includes(norm_(r[ix['Posição']-lo])))hits.push(i+2);else excluded.add(key);});if(!hits.length)continue;const rows=sh.getRange(hits[0],1,hits[hits.length-1]-hits[0]+1,width).getValues();
  for(const r of rows){const order=String(cell_(r,ix,'NUMPED')||'').trim(),rawClient=String(cell_(r,ix,'Cod/Cliente')||''),clientCode=code_(rawClient),status=norm_(cell_(r,ix,'Posição'));if(!/^\d{1,20}$/.test(order)||clientCode==null)continue;
   const key=formExpOrderKey_(year,String(clientCode),order);if(excluded.has(key))continue;if(!['PENDENTE','LIBERADO','BLOQUEADO'].includes(status)){out[key]=null;continue;}if(Object.prototype.hasOwnProperty.call(out,key)&&out[key]===null)continue;let o=out[key];if(!o)o=out[key]={key,year,order,clientCode:String(clientCode),client:formDirectClientName_(rawClient,clientNames),city:logText_(cell_(r,ix,'MUNICENT')),uf:logText_(cell_(r,ix,'ESTENT')),seller:logText_(cell_(r,ix,'Cod/Vend.')),date:logDate_(cell_(r,ix,'Data inicial do pedido')||cell_(r,ix,'Data Pedido'),tz),products:[],rcas:[],statuses:[],invoices:[],weight:null,volumes:null,weightIncomplete:true};
   o.rcas.push(code_(cell_(r,ix,'Cod/Vend.')));o.statuses.push(status);const product=String(cell_(r,ix,'Cod/Produto')||'');o.products.push({code:code_(product),description:product.replace(/^\s*\d+\s*-\s*/,''),quantity:logNumber_(cell_(r,ix,'Qt Pedida')),value:logNumber_(cell_(r,ix,'Pedidos Enviados')),supplier:logText_(cell_(r,ix,'Cod/Fornecedor')),department:logText_(cell_(r,ix,'DEPARTAMENTO')),section:logText_(cell_(r,ix,'SECAO')),invoice:logText_(cell_(r,ix,'Numero Nota Fiscal')),billingDate:logDate_(cell_(r,ix,'Data Faturamento'),tz),orderDate:logDate_(cell_(r,ix,'Data Pedido'),tz),status});if(cell_(r,ix,'Numero Nota Fiscal'))o.invoices.push(String(cell_(r,ix,'Numero Nota Fiscal')));
  }
 }
 const catalog={};for(const [key,o]of Object.entries(out)){if(!o)continue;o.rcas=[...new Set(o.rcas)];o.rca=o.rcas[0];o.statuses=[...new Set(o.statuses)];o.invoices=[...new Set(o.invoices)];o.active=o.statuses.every(s=>['PENDENTE','LIBERADO','BLOQUEADO'].includes(s));if(!o.active)continue;o.version=digestHex_(JSON.stringify(o)).slice(0,24);catalog[key]=o;}return catalog;
}
function formDirectAllowed_(user,o){return (o.rcas||[]).length>0&&o.rcas.every(rca=>userAllowsRca_(user,rca))&&logisticsRowAllowed_(user,{seller:o.seller||String(o.rca||''),region:o.region||'',carrier:''},'operations');}
function formDirectSnapshot_(st){const out={};for(const e of st.events)for(const [key,o]of Object.entries(e.data.orders||{}))out[key]=o;return out;}
function formDirectView_(st,catalog,user){
 const saved=formDirectSnapshot_(st),orders=[],byKey={},canonical={};for(const o of Object.values(catalog)){const k=o.clientCode+'|'+o.order;canonical[k]=(canonical[k]||0)+1;}
 for(const key of new Set([...Object.keys(catalog),...Object.keys(st.assignments)])){const fresh=catalog[key],o=fresh||saved[key];if(!o||!formDirectAllowed_(user,o))continue;const a=st.assignments[key],duplicate=canonical[o.clientCode+'|'+o.order]>1,issue=!fresh?'Pedido não está mais em aberto na base comercial':duplicate?'Pedido repetido em mais de um ano; conferir origem':'';
  const row={sourceKey:key,orderKey:key,client:o.client,city:o.city,cityLabel:o.city,uf:o.uf,date:o.date,region:'',seller:String(o.rca||''),product:o.products.map(p=>p.description).join(' / '),status:o.statuses.join(' / '),weight:null,volumes:null,availableWeight:null,mountedWeight:null,awaitingFormation:!!fresh&&!duplicate,delivered:false,linked:true,montageId:a?a.montageId:''};
  const entry={...o,blocked:!fresh||duplicate,sourceIssue:issue,sourceKeys:[key],sourceRows:[row],originalStatuses:o.statuses,montageId:a?a.montageId:'',internalStatus:a?(st.montages[a.montageId].status==='Finalizada'?'Montagem finalizada':'Em montagem'):st.last[key]&&st.last[key].type==='REMOVER'?'Removido da montagem':'Disponível',sourceDate:o.date};orders.push(entry);byKey[key]=entry;
 }
 const montages=[];for(const m of Object.values(st.montages)){const keys=Object.keys(st.assignments).filter(k=>st.assignments[k].montageId===m.id);if(keys.some(k=>!byKey[k]))continue;if(!keys.length&&!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)&&m.owner!==user.login)continue;const members=keys.map(k=>byKey[k]);montages.push({...m,orderKeys:keys,orders:keys.length,clients:new Set(members.map(o=>o.clientCode)).size,cities:new Set(members.map(o=>o.city+'|'+o.uf)).size,weight:keys.length?null:0,volumes:keys.length?null:0,sourceIssues:members.filter(o=>o.blocked).length});}
 const events=st.events.slice().reverse().filter(e=>e.keys.length?e.keys.every(k=>byKey[k]):montages.some(m=>m.id===e.to)||['VEICULO_SALVAR','MOTORISTA_SALVAR','UNIDADE_SALVAR','ROTEIRIZACAO_CONFIGURAR'].includes(e.type)).slice(0,200).map(e=>({id:e.id,at:e.at,by:e.by,type:e.type,keys:e.keys,from:e.from,to:e.to,name:e.data.name||'',alerts:e.data.alerts||[],capacitySnapshot:e.data.capacitySnapshot||null,confirmed:e.data.route?.confirmed||false}));
 return formFleetEnhance_({ok:true,experimental:true,direct:true,orders,montages,events,mapRows:orders.map(o=>o.sourceRows[0]),revision:st.revision,sequence:st.sequence,sourceVersion:digestHex_(JSON.stringify(orders.map(o=>[o.key,o.version,o.blocked]).sort())).slice(0,32),updatedAt:new Date().toISOString(),source:'Força de Vendas · base sincronizada',missingFields:['Peso','Volumes']},st);
}
function formDirectMaterialize_(ss,st){
 formExpMaterialize_(ss,st);const sh=ss.getSheetByName('MONTAGEM_PEDIDOS'),headers=['CLIENTE_CODIGO','CLIENTE','CIDADE','UF','DATA_PEDIDO','STATUS_COMERCIAL','PESO_KG','VOLUMES','ITENS_JSON','FONTE','VERSAO_FONTE','ORDEM_ENTREGA','ENDERECO_ENTREGA'];sh.getRange(1,6,1,headers.length).setValues([headers]);const saved=formDirectSnapshot_(st),routeOrders=formRouteOrders_(st),rows=Object.keys(st.assignments).map(k=>{const o=saved[k];return o?[o.clientCode,o.client,o.city,o.uf,o.date,o.statuses.join(' / '),st.orderWeights[k]?st.orderWeights[k].weight:o.weight==null?'':o.weight,o.volumes==null?'':o.volumes,JSON.stringify(o.products),'FORCA_DE_VENDAS',o.version,routeOrders[k]?.number||'',routeOrders[k]?.address||'']:Array(headers.length).fill('');});if(rows.length)sh.getRange(2,6,rows.length,headers.length).setValues(rows.map(r=>r.map(v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)));const end=sh.getLastRow();if(end>rows.length+1)sh.getRange(rows.length+2,6,end-rows.length-1,headers.length).clearContent();formFleetMaterialize_(ss,st);
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

function formDirectReadCatalog_(sourceState, force) {
  const cache = CacheService.getScriptCache();
  const key = 'FORM_DIRECT_V2_' + digestHex_(CFG.salesSpreadsheetId + '|' + sourceState).slice(0,32);
  if (!force) {
    try {
      const saved = cache.get(key);
      if (saved) return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(saved),'application/gzip')).getDataAsString('UTF-8'));
    } catch (error) {
      // A consulta à fonte continua disponível se o cache estiver incompleto.
    }
  }
  const catalog = formDirectCatalog_();
  if (sourceState === formDirectSourceState_()) {
    try {
      const compressed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(catalog),'application/json')).getBytes());
      if (compressed.length <= 95000) cache.put(key,compressed,45);
    } catch (error) {
      // O cache não impede a leitura ou gravação da montagem.
    }
  }
  return catalog;
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

function formationDirectApi_(user,p){
 if(p.action==='fleetSave')return formFleetApi_(user,p);
 if(p.action==='settingsRead')return formRouteSettingsRead_(user);
 if(p.action==='priorityRead')return formPriorityRead_(user);
 formExpAccess_(user);
 // Consultas demoradas não reservam o bloqueio global usado pelos acionadores.
 const ss=formExpAux_(),initial=formExpState_(ss);
 if(p.action==='save'&&Object.prototype.hasOwnProperty.call(initial.requests,p.requestId))return formAssemblyRetry_(initial,p.requestId);
 const sourceState = formDirectSourceState_();
 const reading = !p.action || p.action==='read';
 const catalog = reading ? formDirectReadCatalog_(sourceState,p.force===true) : formDirectCatalog_();
 if(formDirectSourceState_()!==sourceState)throw new Error('A base de vendas foi atualizada durante a consulta. Atualize os pedidos antes de salvar.');
 if(reading)return formDirectView_(formExpState_(ss),catalog,user);
 if(p.action!=='save')throw new Error('Ação de montagem inválida.');
 // O bloqueio protege apenas revisão, reserva e escrita do histórico auxiliar.
 const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw new Error('A atualização está finalizando uma gravação. Sua seleção foi preservada; tente salvar novamente em instantes.');
 try{
 const st=formExpState_(ss);if(Object.prototype.hasOwnProperty.call(st.requests,p.requestId))return formAssemblyRetry_(st,p.requestId);
 if(formDirectSourceState_()!==sourceState)throw new Error('A base de vendas mudou antes da gravação. Atualize os pedidos para conferir.');
 const view=formDirectView_(st,catalog,user);
 if(p.action!=='save'||!['CRIAR','ADICIONAR','TRANSFERIR','REMOVER','RENOMEAR'].includes(p.operation))throw new Error('Operação inválida. Os pedidos já vêm identificados do Força de Vendas.');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||'')))throw new Error('Identificador de movimentação inválido.');
 p=formDirectValidateContext_(st,view,p);
 formFleetAssertMove_(st,p);
 // Retirar um pedido cujo status mudou deve continuar possível para liberar a montagem.
 if(p.operation==='REMOVER'){if(Number(p.revision)!==st.revision||p.sourceVersion!==view.sourceVersion||p.confirmed!==true)throw new Error('Atualize e confirme a retirada.');if(!Array.isArray(p.keys)||!p.keys.length||p.keys.length>100||new Set(p.keys).size!==p.keys.length||p.keys.some(k=>!st.assignments[k]||!view.orders.some(o=>o.key===k)))throw new Error('Seleção de pedidos inválida.');}
 else formExpValidateMove_(st,view,p);
 const keys = p.keys || [];
 const at = new Date();
 const company = p.operation === 'CRIAR' ? formAssemblyCompany_(p.company) : '';
 const name = company ? formAssemblyCode_(st, company, at) : String(p.name || '').trim();
 if (p.operation === 'RENOMEAR') {
   if (st.montages[p.target]?.company) throw new Error('O código da montagem é permanente.');
   if (!name || name.length > 100) throw new Error('Informe um nome de até 100 caracteres.');
   if (/^(REB|NUT)\d{6,}$/i.test(name)) throw new Error('Este formato é reservado aos códigos automáticos.');
 }
 const to=p.operation==='CRIAR'?'mont_'+Utilities.getUuid():p.target||'',snapshots={};for(const key of keys){const o=catalog[key]||formDirectSnapshot_(st)[key];if(o)snapshots[key]=o;}
 const e={id:p.requestId,revision:st.revision+1,at:at.toISOString(),by:user.login,type:p.operation,keys,from:Object.fromEntries(keys.map(k=>[k,st.assignments[k]&&st.assignments[k].montageId||''])),to,data:{name,...(company?{company}:{}),orders:snapshots,source:'FORCA_DE_VENDAS'}};
 const data=JSON.stringify(e.data),keyJson=JSON.stringify(keys),fromJson=JSON.stringify(e.from);if([data,keyJson,fromJson].some(s=>s.length>44000))throw new Error('Muitos itens comerciais para uma movimentação. Divida a seleção em lotes menores.');for(const o of Object.values(snapshots))if(JSON.stringify(o.products).length>44000)throw new Error('Pedido excede o limite de itens da planilha auxiliar.');
 const journal=ss.getSheetByName('HISTORICO_MOVIMENTACOES'),row=journal.getLastRow()+1;if(row>journal.getMaxRows())journal.insertRowsAfter(journal.getMaxRows(),row-journal.getMaxRows());journal.getRange(row,1,1,9).setValues([[e.id,e.revision,e.at,e.by,e.type,keyJson,fromJson,e.to,data]]);SpreadsheetApp.flush();if(journal.getRange(row,1).getDisplayValue()!==e.id)throw new Error('Gravação não confirmada. Atualize antes de repetir.');formExpApply_(st,e);st.events.push(e);st.revision=e.revision;formFleetHydrate_(st);let projectionWarning=false;try{formDirectMaterialize_(ss,st);}catch(err){projectionWarning=true;}
 let nextView = null;
 try { nextView = formDirectView_(st,catalog,user); } catch (error) { console.warn('Montagem gravada; atualização da tela pendente.'); }
 return {ok:true,revision:st.revision,montageId:to,projectionWarning,view:nextView,message:company?'Montagem '+name+' criada.':'Montagem salva na planilha auxiliar com os dados do Força de Vendas.'};
 }finally{lock.releaseLock();}
}
function verificarMontagemDiretaRbn(){const st=formExpState_(formExpAux_()),catalog=formDirectCatalog_(),v=formDirectView_(st,catalog,{perfil:'ADMIN',login:'diagnostico'});console.log(JSON.stringify({pedidos:v.orders.length,cidades:new Set(v.orders.map(o=>o.city+'|'+o.uf)).size,montagens:v.montages.length,revisao:v.revision,camposAusentes:v.missingFields,primeiroPedido:v.orders[0]?{pedido:v.orders[0].order,itens:v.orders[0].products.length}:null}));return {ok:true,pedidos:v.orders.length};}

function verificarNomesClientesMontagemRbn(){
 const names=formDirectClientNames_(),codes=['1015','10749','7534','10390','11869','8132'];
 const result=codes.map(code=>({codigo:code,nome:formDirectClientName_(code,names)}));
 console.log(JSON.stringify({cadastros:Object.keys(names).length,clientes:result}));return result;
}

function formDirectSourceState_(){
 const p=PropertiesService.getScriptProperties();
 if(p.getProperty('RBN_SALES_JOB_N'))throw new Error('A base de vendas está recebendo novos pedidos. Aguarde a atualização e consulte novamente.');
 return String(p.getProperty('VENDAS_RBN_ULTIMA_SYNC')||'');
}

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
function verificarFrotaMontagemRbn(){const st=formExpState_(formExpAux_()),fleet=formFleetOptions_(st);console.log(JSON.stringify({revisao:st.revision,montagens:Object.values(st.montages).map(m=>({nome:m.name,status:m.status,pedidos:Object.values(st.assignments).filter(a=>a.montageId===m.id).length})),veiculos:fleet.vehicles,motoristas:fleet.drivers.map(d=>d.name)}));}

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
  if (p.action !== 'fleetSave' || !/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId || ''))) {
    throw new Error('Identificador de operação inválido.');
  }
  const operation = p.operation;
  const settings = ['VEICULO_SALVAR','MOTORISTA_SALVAR','UNIDADE_SALVAR','ROTEIRIZACAO_CONFIGURAR'];
  const operations = [...settings,'CONFIGURAR_CARGA','PESOS_PEDIDOS','FINALIZAR','REABRIR','ROTEIRO_SALVAR'];
  if (!operations.includes(operation)) throw new Error('Operação inválida.');

  const ss = formExpAux_();
  const target = settings.includes(operation) ? '' : String(p.target || '');
  const initial = formExpState_(ss);
  if (initial.requests[p.requestId]) return {ok:true, alreadyApplied:true, montageId:target, message:'Operação já registrada.'};
  let catalog = null, sourceState = '';
  if (operation === 'FINALIZAR') {
    formFleetCanManage_(user, initial, target);
    sourceState = formDirectSourceState_();
    catalog = formDirectCatalog_();
    if (sourceState !== formDirectSourceState_()) throw new Error('A base mudou durante a conferência. Atualize a montagem.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Outra gravação está finalizando. Aguarde alguns instantes.');
  try {
    const st = formExpState_(ss);
    if (st.requests[p.requestId]) return {ok:true, alreadyApplied:true, montageId:target, message:'Operação já registrada.'};
    if (Number(p.revision) !== st.revision) {
      throw new Error('O cadastro ou a montagem foi atualizado. Recarregue a tela e confira antes de salvar.');
    }
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
    const e = {id:p.requestId, revision:st.revision+1, at:new Date().toISOString(), by:user.login,
      type:operation, keys, from:{}, to:target, data};
    const payload = JSON.stringify(data);
    if (payload.length > 44000) throw new Error('Operação muito grande. Reduza o tamanho dos endereços ou divida a carga.');
    const journal = ss.getSheetByName('HISTORICO_MOVIMENTACOES');
    const row = journal.getLastRow()+1;
    if (row > journal.getMaxRows()) journal.insertRowsAfter(journal.getMaxRows(), row-journal.getMaxRows());
    journal.getRange(row,1,1,9).setValues([[e.id,e.revision,e.at,e.by,e.type,JSON.stringify(keys),'{}',e.to,payload]]);
    SpreadsheetApp.flush();
    if (journal.getRange(row,1).getDisplayValue() !== e.id) throw new Error('Gravação não confirmada. Atualize antes de repetir.');
    st.events.push(e);
    st.revision = e.revision;
    formFleetHydrate_(st);
    let projectionWarning = false;
    try { formDirectMaterialize_(ss, st); } catch (err) { projectionWarning = true; }
    const message = {
      FINALIZAR: 'Montagem finalizada. Confira o roteiro.',
      REABRIR: 'Montagem reaberta para ajustes.',
      ROTEIRO_SALVAR: data.route?.confirmed ? 'Roteiro confirmado. Ordem salva nos pedidos.' : 'Rascunho do roteiro salvo.'
    }[operation] || 'Informações salvas.';
    return {ok:true, revision:st.revision, montageId:target, projectionWarning, message,
      ...(operation === 'ROTEIRO_SALVAR' ? {route:st.montages[target].route} : {})};
  } finally {
    lock.releaseLock();
  }
}

function formAuxSafeCell_(v) {
  return typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v;
}

function formAuxTable_(ss, name, headers, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const last = sh.getLastRow();
  if (last && JSON.stringify(sh.getRange(1,1,1,headers.length).getDisplayValues()[0]) !== JSON.stringify(headers)) {
    throw new Error('Cabeçalhos divergentes: ' + name);
  }
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  if (rows.length) {
    if (rows.length+1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length+1-sh.getMaxRows());
    sh.getRange(2,1,rows.length,headers.length).setValues(rows.map(r => r.map(formAuxSafeCell_)));
  }
  if (last > rows.length+1) sh.getRange(rows.length+2,1,last-rows.length-1,headers.length).clearContent();
}

function formFleetMaterialize_(ss, st) {
  formAuxTable_(ss, 'VEICULOS', ['PLACA','TIPO_VEICULO','CAPACIDADE_KG','MOTORISTA_PADRAO','ATIVO','ATUALIZADO_EM','USUARIO'],
    Object.values(st.fleetVehicles).map(v => [v.plate,v.type||'',v.capacityKg||'',v.defaultDriver||'',
      v.active!==false?'SIM':'NAO',v.updatedAt||'',v.by||'']));
  formAuxTable_(ss, 'MOTORISTAS', ['NOME','ATIVO','ATUALIZADO_EM','USUARIO'],
    Object.values(st.fleetDrivers).map(d => [d.name,d.active!==false?'SIM':'NAO',d.updatedAt||'',d.by||'']));
  const sh = ss.getSheetByName('MONTAGENS');
  const headers = ['PLACA','TIPO_VEICULO','MOTORISTA','CAPACIDADE_KG','FINALIZADO_EM','SITUACAO_ROTEIRO','EMPRESA_SAIDA'];
  sh.getRange(1,6,1,headers.length).setValues([headers]);
  const vehicles = formFleetOptions_(st, true).vehicles;
  const rows = Object.values(st.montages).map(m => {
    const v = m.vehicleSnapshot || vehicles.find(v => v.plate === m.vehicleId) || {};
    const routeStatus = m.status === 'Finalizada'
      ? m.route?.confirmed ? 'Confirmado' : m.route ? 'Rascunho' : 'Pendente' : '';
    return [m.vehicleId,v.type||'',m.driver,v.capacityKg||'',m.finalizedAt,routeStatus,FORM_COMPANIES[m.company]||''];
  });
  if (rows.length) sh.getRange(2,6,rows.length,headers.length).setValues(rows.map(r => r.map(formAuxSafeCell_)));
  formRouteMaterialize_(ss, st);
}
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
  const st = formExpState_(formExpAux_());
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

function formRouteMaterialize_(ss, st) {
  const { units, defaultUnitId, returnToUnit, groupAddresses } = formRouteSettings_(st);
  formAuxTable_(ss, 'UNIDADES_LOGISTICAS', ['ID','NOME','ENDERECO'], units.map(u => [u.id,u.name,u.address]));
  const unitSheet = ss.getSheetByName('UNIDADES_LOGISTICAS');
  unitSheet.getRange(1,4,units.length+1,1).setValues([['EMPRESA'], ...units.map(u => [FORM_COMPANIES[u.company] || ''])]);
  formAuxTable_(ss, 'CONFIG_LOGISTICA', ['UNIDADE_PADRAO','RETORNAR_A_UNIDADE','AGRUPAR_ENDERECOS'],
    [[defaultUnitId, returnToUnit ? 'SIM' : 'NAO', groupAddresses ? 'SIM' : 'NAO']]);
  const rows = [];
  for (const m of Object.values(st.montages)) {
    if (!m.route) continue;
    m.route.stops.forEach((s, i) => {
      for (const key of s.keys) {
        rows.push([m.id, i+1, formExpParseKey_(key).order, key, s.address,
          m.route.unit?.name || '', m.route.unit?.address || '',
          m.route.returnToUnit ? 'SIM' : 'NAO', m.route.confirmed ? 'Confirmado' : 'Rascunho',
          m.route.at, m.route.by]);
      }
    });
  }
  formAuxTable_(ss, 'ROTEIROS_PARADAS',
    ['MONTAGEM_ID','ORDEM','PEDIDO','PEDIDO_ID','ENDERECO_ENTREGA','UNIDADE_SAIDA','ENDERECO_SAIDA',
     'RETORNO_A_UNIDADE','STATUS','ATUALIZADO_EM','USUARIO'], rows);
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
  const st = formExpState_(formExpAux_());
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
