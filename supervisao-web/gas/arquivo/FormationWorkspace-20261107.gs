
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
 const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),out={},clientNames=formDirectClientNames_();
 for(const year of CFG.years){const sh=ss.getSheetByName(year);if(!sh||sh.getLastRow()<2)continue;const width=sh.getLastColumn(),ix=headerIndex_(sh.getRange(1,1,1,width).getDisplayValues()[0]);
  for(const h of ['NUMPED','Cod/Cliente','Cod/Produto','Qt Pedida','Posição','Data Pedido','MUNICENT','ESTENT'])if(ix[h]==null)throw new Error('Coluna comercial ausente: '+h);
  const lo=Math.min(ix['Cod/Cliente'],ix['NUMPED'],ix['Posição']),hi=Math.max(ix['Cod/Cliente'],ix['NUMPED'],ix['Posição']),ids=sh.getRange(2,lo+1,sh.getLastRow()-1,hi-lo+1).getValues(),hits=[],excluded=new Set();ids.forEach((r,i)=>{const order=String(r[ix['NUMPED']-lo]||'').trim(),client=code_(r[ix['Cod/Cliente']-lo]);if(client==null||!/^\d{1,20}$/.test(order))return;const key=formExpOrderKey_(year,String(client),order);if(['PENDENTE','LIBERADO','BLOQUEADO'].includes(norm_(r[ix['Posição']-lo])))hits.push(i+2);else excluded.add(key);});if(!hits.length)continue;const rows=sh.getRange(hits[0],1,hits[hits.length-1]-hits[0]+1,width).getValues();
  for(const r of rows){const order=String(cell_(r,ix,'NUMPED')||'').trim(),rawClient=String(cell_(r,ix,'Cod/Cliente')||''),clientCode=code_(rawClient),status=norm_(cell_(r,ix,'Posição'));if(!/^\d{1,20}$/.test(order)||clientCode==null)continue;
   const key=formExpOrderKey_(year,String(clientCode),order);if(excluded.has(key))continue;if(!['PENDENTE','LIBERADO','BLOQUEADO'].includes(status)){out[key]=null;continue;}if(Object.prototype.hasOwnProperty.call(out,key)&&out[key]===null)continue;let o=out[key];if(!o)o=out[key]={key,year,order,clientCode:String(clientCode),client:formDirectClientName_(rawClient,clientNames),city:logText_(cell_(r,ix,'MUNICENT')),uf:logText_(cell_(r,ix,'ESTENT')),seller:logText_(cell_(r,ix,'Cod/Vend.')),date:logDate_(cell_(r,ix,'Data inicial do pedido')||cell_(r,ix,'Data Pedido'),ss.getSpreadsheetTimeZone()),products:[],rcas:[],statuses:[],invoices:[],weight:null,volumes:null,weightIncomplete:true};
   o.rcas.push(code_(cell_(r,ix,'Cod/Vend.')));o.statuses.push(status);const product=String(cell_(r,ix,'Cod/Produto')||'');o.products.push({code:code_(product),description:product.replace(/^\s*\d+\s*-\s*/,''),quantity:logNumber_(cell_(r,ix,'Qt Pedida')),value:logNumber_(cell_(r,ix,'Pedidos Enviados')),supplier:logText_(cell_(r,ix,'Cod/Fornecedor')),department:logText_(cell_(r,ix,'DEPARTAMENTO')),section:logText_(cell_(r,ix,'SECAO')),invoice:logText_(cell_(r,ix,'Numero Nota Fiscal')),billingDate:logDate_(cell_(r,ix,'Data Faturamento'),ss.getSpreadsheetTimeZone()),orderDate:logDate_(cell_(r,ix,'Data Pedido'),ss.getSpreadsheetTimeZone()),status});if(cell_(r,ix,'Numero Nota Fiscal'))o.invoices.push(String(cell_(r,ix,'Numero Nota Fiscal')));
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
 const events=st.events.slice().reverse().filter(e=>e.keys.length?e.keys.every(k=>byKey[k]):montages.some(m=>m.id===e.to)||['VEICULO_SALVAR','MOTORISTA_SALVAR'].includes(e.type)).slice(0,200).map(e=>({id:e.id,at:e.at,by:e.by,type:e.type,keys:e.keys,from:e.from,to:e.to,name:e.data.name||''}));
 return formFleetEnhance_({ok:true,experimental:true,direct:true,orders,montages,events,mapRows:orders.map(o=>o.sourceRows[0]),revision:st.revision,sequence:st.sequence,sourceVersion:digestHex_(JSON.stringify(orders.map(o=>[o.key,o.version,o.blocked]).sort())).slice(0,32),updatedAt:new Date().toISOString(),source:'Força de Vendas · base sincronizada',missingFields:['Peso','Volumes']},st);
}
function formDirectMaterialize_(ss,st){
 formExpMaterialize_(ss,st);const sh=ss.getSheetByName('MONTAGEM_PEDIDOS'),headers=['CLIENTE_CODIGO','CLIENTE','CIDADE','UF','DATA_PEDIDO','STATUS_COMERCIAL','PESO_KG','VOLUMES','ITENS_JSON','FONTE','VERSAO_FONTE'];sh.getRange(1,6,1,headers.length).setValues([headers]);const saved=formDirectSnapshot_(st),rows=Object.keys(st.assignments).map(k=>{const o=saved[k];return o?[o.clientCode,o.client,o.city,o.uf,o.date,o.statuses.join(' / '),st.orderWeights[k]?st.orderWeights[k].weight:o.weight==null?'':o.weight,o.volumes==null?'':o.volumes,JSON.stringify(o.products),'FORCA_DE_VENDAS',o.version]:Array(headers.length).fill('');});if(rows.length)sh.getRange(2,6,rows.length,headers.length).setValues(rows.map(r=>r.map(v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)));const end=sh.getLastRow();if(end>rows.length+1)sh.getRange(rows.length+2,6,end-rows.length-1,headers.length).clearContent();formFleetMaterialize_(ss,st);
}
function formationDirectApi_(user,p){
 if(p.action==='fleetSave')return formFleetApi_(user,p);
 formExpAccess_(user);
 // Consultas demoradas não reservam o bloqueio global usado pelos acionadores.
 const ss=formExpAux_(),initial=formExpState_(ss);
 if(p.action==='save'&&initial.requests[p.requestId])return {ok:true,alreadyApplied:true,message:'Movimentação já registrada.'};
 const sourceState=formDirectSourceState_(),catalog=formDirectCatalog_();
 if(formDirectSourceState_()!==sourceState)throw new Error('A base de vendas foi atualizada durante a consulta. Atualize os pedidos antes de salvar.');
 if(!p.action||p.action==='read')return formDirectView_(formExpState_(ss),catalog,user);
 if(p.action!=='save')throw new Error('Ação de montagem inválida.');
 // O bloqueio protege apenas revisão, reserva e escrita do histórico auxiliar.
 const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw new Error('A atualização está finalizando uma gravação. Sua seleção foi preservada; tente salvar novamente em instantes.');
 try{
 const st=formExpState_(ss);if(st.requests[p.requestId])return {ok:true,alreadyApplied:true,message:'Movimentação já registrada.'};
 if(formDirectSourceState_()!==sourceState)throw new Error('A base de vendas mudou antes da gravação. Atualize os pedidos para conferir.');
 const view=formDirectView_(st,catalog,user);
 if(p.action!=='save'||!['CRIAR','ADICIONAR','TRANSFERIR','REMOVER','RENOMEAR'].includes(p.operation))throw new Error('Operação inválida. Os pedidos já vêm identificados do Força de Vendas.');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||'')))throw new Error('Identificador de movimentação inválido.');
 formFleetAssertMove_(st,p);
 // Retirar um pedido cujo status mudou deve continuar possível para liberar a montagem.
 if(p.operation==='REMOVER'){if(Number(p.revision)!==st.revision||p.sourceVersion!==view.sourceVersion||p.confirmed!==true)throw new Error('Atualize e confirme a retirada.');if(!Array.isArray(p.keys)||!p.keys.length||p.keys.length>100||new Set(p.keys).size!==p.keys.length||p.keys.some(k=>!st.assignments[k]||!view.orders.some(o=>o.key===k)))throw new Error('Seleção de pedidos inválida.');}
 else formExpValidateMove_(st,view,p);
 const keys=p.keys||[],name=String(p.name||'').trim();if(name.length>100||p.operation==='RENOMEAR'&&!name)throw new Error('Informe um nome de até 100 caracteres.');const to=p.operation==='CRIAR'?'mont_'+Utilities.getUuid():p.target||'',snapshots={};for(const key of keys){const o=catalog[key]||formDirectSnapshot_(st)[key];if(o)snapshots[key]=o;}
 const e={id:p.requestId,revision:st.revision+1,at:new Date().toISOString(),by:user.login,type:p.operation,keys,from:Object.fromEntries(keys.map(k=>[k,st.assignments[k]&&st.assignments[k].montageId||''])),to,data:{name:name||(p.operation==='CRIAR'?'Montagem '+(st.sequence+1):''),orders:snapshots,source:'FORCA_DE_VENDAS'}};
 const data=JSON.stringify(e.data),keyJson=JSON.stringify(keys),fromJson=JSON.stringify(e.from);if([data,keyJson,fromJson].some(s=>s.length>44000))throw new Error('Muitos itens comerciais para uma movimentação. Divida a seleção em lotes menores.');for(const o of Object.values(snapshots))if(JSON.stringify(o.products).length>44000)throw new Error('Pedido excede o limite de itens da planilha auxiliar.');
 const journal=ss.getSheetByName('HISTORICO_MOVIMENTACOES'),row=journal.getLastRow()+1;if(row>journal.getMaxRows())journal.insertRowsAfter(journal.getMaxRows(),row-journal.getMaxRows());journal.getRange(row,1,1,9).setValues([[e.id,e.revision,e.at,e.by,e.type,keyJson,fromJson,e.to,data]]);SpreadsheetApp.flush();if(journal.getRange(row,1).getDisplayValue()!==e.id)throw new Error('Gravação não confirmada. Atualize antes de repetir.');formExpApply_(st,e);st.events.push(e);st.revision=e.revision;formFleetHydrate_(st);let projectionWarning=false;try{formDirectMaterialize_(ss,st);}catch(err){projectionWarning=true;}return {ok:true,revision:st.revision,montageId:to,projectionWarning,message:'Montagem salva na planilha auxiliar com os dados do Força de Vendas.'};
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
function formFleetHydrate_(st){
 st.fleetVehicles={};st.fleetDrivers={};st.orderWeights={};
 for(const m of Object.values(st.montages)){m.vehicleId='';m.driver='';m.finalizedAt='';m.vehicleSnapshot=null;}
 for(const e of st.events){const d=e.data||{};
  if(e.type==='VEICULO_SALVAR'){const v=d.vehicle;st.fleetVehicles[v.plate]={...v,updatedAt:e.at,by:e.by,source:'Cadastro'};if(d.previousPlate&&d.previousPlate!==v.plate)st.fleetVehicles[d.previousPlate]={...(st.fleetVehicles[d.previousPlate]||{}),plate:d.previousPlate,active:false};if(v.defaultDriver)st.fleetDrivers[logNorm_(v.defaultDriver)]={name:v.defaultDriver,active:true};}
  if(e.type==='MOTORISTA_SALVAR')st.fleetDrivers[logNorm_(d.driver.name)]={...d.driver,by:e.by,updatedAt:e.at};
  if(e.type==='PESOS_PEDIDOS')for(const [k,w]of Object.entries(d.weights||{}))st.orderWeights[k]={weight:w,version:(d.orderVersions||{})[k]||'',at:e.at,by:e.by,source:'Informado na montagem'};
  const m=st.montages[e.to];if(!m)continue;
  if(e.type==='CONFIGURAR_CARGA'){m.vehicleId=d.vehicleId;m.driver=d.driver;}
  if(e.type==='FINALIZAR'){m.status='Finalizada';m.finalizedAt=e.at;m.vehicleSnapshot=d.vehicleSnapshot;}
  if(e.type==='REABRIR'){m.status='Em montagem';m.finalizedAt='';m.vehicleSnapshot=null;}
 }
 return st;
}
function formFleetHistory_(){
 const id=PropertiesService.getScriptProperties().getProperty('LOG_OPERATIONS_ID')||LOGISTICS_SOURCES.operations,cache=CacheService.getScriptCache(),key='FORM_FLEET_V1_'+id,saved=cache.get(key);if(saved){try{return JSON.parse(saved);}catch(e){}}
 const ss=SpreadsheetApp.openById(id),sh=ss.getSheetByName('FORMAÇÃO 2026'),vehicles={},drivers={};
 const add=(raw,driver)=>{const text=logText_(raw).toUpperCase(),match=text.match(/\b([A-Z]{3}[- ]?[0-9][A-Z0-9]{3})\b/);if(!match)return;const plate=formFleetPlate_(match[1]),type=text.replace(match[0],'').replace(/[-–()]/g,' ').trim();if(!vehicles[plate])vehicles[plate]={plate,type,capacityKg:null,defaultDriver:logText_(driver),active:true,source:'Histórico',needsReview:!formFleetValidPlate_(plate)};else if(!vehicles[plate].type&&type)vehicles[plate].type=type;};
 if(sh&&sh.getLastRow()>2)for(const r of sh.getRange(3,12,sh.getLastRow()-2,4).getValues().sort((a,b)=>formFleetDate_(b[3])-formFleetDate_(a[3]))){add(r[0],r[1]);if(logText_(r[1]))drivers[logNorm_(r[1])]={name:logText_(r[1]),active:true,source:'Histórico'};}
 const base=ss.getSheetByName('BASE DE DADOS');if(base)for(const r of base.getRange(2,1,Math.min(200,Math.max(1,base.getLastRow()-1)),5).getDisplayValues()){add(r[0],'');if(logText_(r[4]))drivers[logNorm_(r[4])]={name:logText_(r[4]),active:true,source:'Histórico'};}
 const result={vehicles,drivers};try{cache.put(key,JSON.stringify(result),120);}catch(e){}return result;
}
function formFleetOptions_(st){const history=formFleetHistory_(),vehicles={...history.vehicles,...st.fleetVehicles},drivers={...history.drivers,...st.fleetDrivers};return {vehicles:Object.values(vehicles).filter(v=>v.active!==false).sort((a,b)=>a.plate.localeCompare(b.plate)),drivers:Object.values(drivers).filter(d=>d.active!==false).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))};}
function formFleetCapacity_(members,vehicle){const knownWeightKg=members.reduce((sum,o)=>sum+(o.weight==null||o.weightIncomplete?0:o.weight),0),unknownOrders=members.filter(o=>o.weight==null||o.weightIncomplete).length,capacityKg=vehicle&&Number(vehicle.capacityKg)>0?Number(vehicle.capacityKg):null;return {knownWeightKg,totalWeightKg:unknownOrders?null:knownWeightKg,unknownOrders,capacityKg,overCapacity:capacityKg!=null&&knownWeightKg>capacityKg,remainingKg:capacityKg==null||unknownOrders?null:capacityKg-knownWeightKg};}
function formFleetEnhance_(view,st){
 const fleet=formFleetOptions_(st);view.fleet=fleet;const byKey={};for(const o of view.orders){const w=st.orderWeights[o.key];if(w&&w.version===o.version){o.weight=w.weight;o.weightIncomplete=false;o.weightSource=w.source;o.weightAt=w.at;}else if(w){o.weight=null;o.weightIncomplete=true;o.weightNote='O pedido foi atualizado. Confira e informe o peso novamente.';}byKey[o.key]=o;const r=o.sourceRows[0];if(r){r.weight=o.weight;r.availableWeight=o.montageId?0:o.weight;r.mountedWeight=o.montageId?o.weight:0;}}
 for(const m of view.montages){const state=st.montages[m.id],members=m.orderKeys.map(k=>byKey[k]),vehicle=state.status==='Finalizada'&&state.vehicleSnapshot?state.vehicleSnapshot:fleet.vehicles.find(v=>v.plate===state.vehicleId);Object.assign(m,{vehicleId:state.vehicleId,driver:state.driver,vehicle:vehicle||null,finalizedAt:state.finalizedAt,...formFleetCapacity_(members,vehicle)});m.weight=m.totalWeightKg;m.canFinalize=m.orders>0&&!!m.driver&&!!vehicle&&formFleetValidPlate_(vehicle.plate)&&!!vehicle.type&&!!m.capacityKg&&!m.unknownOrders&&!m.overCapacity&&!m.sourceIssues&&m.status!=='Finalizada';m.finishReasons=[...(!m.orders?['Adicione pedidos']:[]),...(!m.vehicleId?['Escolha o veículo']:[]),...(!m.driver?['Escolha o motorista']:[]),...(vehicle&&!formFleetValidPlate_(vehicle.plate)?['Confira a placa no cadastro']:[]),...(vehicle&&!vehicle.type?['Cadastre o tipo do veículo']:[]),...(m.vehicleId&&!m.capacityKg?['Cadastre a capacidade do veículo']:[]),...(m.unknownOrders?['Informe o peso de '+m.unknownOrders+' pedido(s)']:[]),...(m.overCapacity?['O peso excede a capacidade']:[]),...(m.sourceIssues?['Revise pedidos alterados na origem']:[])];}
 view.mapRows=view.orders.map(o=>o.sourceRows[0]);return view;
}
function formFleetCanManage_(user,st,id){const m=st.montages[id];if(!m)throw new Error('Montagem não encontrada.');const keys=Object.keys(st.assignments).filter(k=>st.assignments[k].montageId===id),saved=formDirectSnapshot_(st);if(keys.some(k=>!saved[k]||!formDirectAllowed_(user,saved[k])))throw new Error('Montagem fora do seu recorte.');if(!keys.length&&!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)&&m.owner!==user.login)throw new Error('Montagem fora do seu recorte.');return m;}
function formFleetValidateVehicle_(raw){const plate=formFleetPlate_(raw.plate),type=logText_(raw.type).toUpperCase(),capacityKg=Number(raw.capacityKg),defaultDriver=logText_(raw.defaultDriver);if(!formFleetValidPlate_(plate))throw new Error('Informe uma placa válida, como ABC1D23 ou ABC1234.');if(!type||type.length>60)throw new Error('Informe o tipo do veículo.');if(!Number.isFinite(capacityKg)||capacityKg<=0||capacityKg>100000)throw new Error('Informe a capacidade real do veículo em kg, maior que zero e até 100.000.');if(defaultDriver.length>100)throw new Error('Nome de motorista muito longo.');return {plate,type,capacityKg,defaultDriver,active:true};}
function formFleetApi_(user,p){
 formExpAccess_(user);if(p.action!=='fleetSave')throw new Error('Ação da frota inválida.');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(String(p.requestId||'')))throw new Error('Identificador de operação inválido.');const operations=['VEICULO_SALVAR','MOTORISTA_SALVAR','CONFIGURAR_CARGA','PESOS_PEDIDOS','FINALIZAR','REABRIR'];if(!operations.includes(p.operation))throw new Error('Operação inválida.');
 const ss=formExpAux_();let catalog=null,sourceState='';if(p.operation==='FINALIZAR'){sourceState=formDirectSourceState_();catalog=formDirectCatalog_();if(sourceState!==formDirectSourceState_())throw new Error('A base mudou durante a conferência. Atualize a montagem.');}
 const lock=LockService.getScriptLock();if(!lock.tryLock(30000))throw new Error('Outra gravação está finalizando. Aguarde alguns instantes.');try{
 const st=formExpState_(ss);if(st.requests[p.requestId])return {ok:true,alreadyApplied:true,message:'Operação já registrada.'};if(Number(p.revision)!==st.revision)throw new Error('A montagem ou o cadastro foi atualizado. Atualize a tela e confira antes de salvar.');let data={},keys=[],target=String(p.target||'');const fleet=formFleetOptions_(st);
 if(p.operation==='VEICULO_SALVAR'){const vehicle=formFleetValidateVehicle_(p.vehicle||{}),previousPlate=formFleetPlate_(p.previousPlate||'');if(previousPlate&&previousPlate!==vehicle.plate&&Object.values(st.montages).some(m=>m.vehicleId===previousPlate))throw new Error('A placa anterior está vinculada a uma montagem. Cadastre a placa correta separadamente.');data={vehicle,previousPlate};}
 else if(p.operation==='MOTORISTA_SALVAR'){const name=logText_(p.driver&&p.driver.name).toUpperCase();if(name.length<2||name.length>100)throw new Error('Informe o nome do motorista.');data={driver:{name,active:true}};}
 else {const m=formFleetCanManage_(user,st,target);keys=Object.keys(st.assignments).filter(k=>st.assignments[k].montageId===target);
  if(m.status==='Finalizada'&&p.operation!=='REABRIR')throw new Error('Reabra a montagem para alterar sua composição.');
  if(p.operation==='CONFIGURAR_CARGA'){const vehicle=fleet.vehicles.find(v=>v.plate===p.vehicleId),driver=fleet.drivers.find(d=>logNorm_(d.name)===logNorm_(p.driver));if(!vehicle||!driver)throw new Error('Selecione um veículo e um motorista cadastrados.');data={vehicleId:vehicle.plate,driver:driver.name};}
  if(p.operation==='PESOS_PEDIDOS'){if(!p.weights||typeof p.weights!=='object'||Array.isArray(p.weights)||!Object.keys(p.weights).length||Object.keys(p.weights).length>100)throw new Error('Informe os pesos dos pedidos.');const weights={},orderVersions={};for(const [key,value]of Object.entries(p.weights)){if(!keys.includes(key))throw new Error('Pedido fora desta montagem.');const weight=Number(value);if(!Number.isFinite(weight)||weight<=0||weight>100000)throw new Error('Informe pesos válidos em kg, maiores que zero e até 100.000.');const version=String((p.orderVersions||{})[key]||'');if(!/^[0-9a-f]{24}$/.test(version))throw new Error('Atualize os pedidos antes de informar seus pesos.');weights[key]=weight;orderVersions[key]=version;}data={weights,orderVersions};}
  if(p.operation==='FINALIZAR'){if(p.confirmed!==true)throw new Error('Confirme a finalização.');if(formDirectSourceState_()!==sourceState)throw new Error('A base foi atualizada. Confira a montagem novamente.');const view=formDirectView_(st,catalog,user),item=view.montages.find(x=>x.id===target);if(!item||!item.canFinalize)throw new Error(item?item.finishReasons.join(' · '):'Montagem indisponível.');data={vehicleSnapshot:{...item.vehicle,driver:item.driver,totalWeightKg:item.totalWeightKg}};}
  if(p.operation==='REABRIR'){if(m.status!=='Finalizada'||p.confirmed!==true)throw new Error('Confirme a reabertura de uma montagem finalizada.');}
 }
 const e={id:p.requestId,revision:st.revision+1,at:new Date().toISOString(),by:user.login,type:p.operation,keys,from:{},to:target,data},payload=JSON.stringify(data);if(payload.length>44000)throw new Error('Operação muito grande. Divida o preenchimento.');const journal=ss.getSheetByName('HISTORICO_MOVIMENTACOES'),row=journal.getLastRow()+1;if(row>journal.getMaxRows())journal.insertRowsAfter(journal.getMaxRows(),row-journal.getMaxRows());journal.getRange(row,1,1,9).setValues([[e.id,e.revision,e.at,e.by,e.type,JSON.stringify(keys),'{}',e.to,payload]]);SpreadsheetApp.flush();if(journal.getRange(row,1).getDisplayValue()!==e.id)throw new Error('Gravação não confirmada. Atualize antes de repetir.');st.events.push(e);st.revision=e.revision;formFleetHydrate_(st);let projectionWarning=false;try{formDirectMaterialize_(ss,st);}catch(err){projectionWarning=true;}return {ok:true,revision:st.revision,montageId:target,projectionWarning,message:p.operation==='FINALIZAR'?'Montagem finalizada. Veículo, motorista e composição registrados.':p.operation==='REABRIR'?'Montagem reaberta para ajustes.':'Informações salvas.'};
 }finally{lock.releaseLock();}
}
function formFleetMaterialize_(ss,st){
 const write=(name,headers,rows)=>{let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()&&JSON.stringify(sh.getRange(1,1,1,headers.length).getDisplayValues()[0])!==JSON.stringify(headers))throw new Error('Cabeçalhos divergentes: '+name);const last=sh.getLastRow();sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);if(rows.length){if(rows.length+1>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),rows.length+1-sh.getMaxRows());sh.getRange(2,1,rows.length,headers.length).setValues(rows.map(r=>r.map(v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)));}if(last>rows.length+1)sh.getRange(rows.length+2,1,last-rows.length-1,headers.length).clearContent();};
 write('VEICULOS',['PLACA','TIPO_VEICULO','CAPACIDADE_KG','MOTORISTA_PADRAO','ATIVO','ATUALIZADO_EM','USUARIO'],Object.values(st.fleetVehicles).map(v=>[v.plate,v.type||'',v.capacityKg||'',v.defaultDriver||'',v.active!==false?'SIM':'NAO',v.updatedAt||'',v.by||'']));
 write('MOTORISTAS',['NOME','ATIVO','ATUALIZADO_EM','USUARIO'],Object.values(st.fleetDrivers).map(d=>[d.name,d.active!==false?'SIM':'NAO',d.updatedAt||'',d.by||'']));
 const m=ss.getSheetByName('MONTAGENS'),headers=['PLACA','TIPO_VEICULO','MOTORISTA','CAPACIDADE_KG','FINALIZADO_EM'];m.getRange(1,6,1,headers.length).setValues([headers]);const vehicles=formFleetOptions_(st).vehicles,rows=Object.values(st.montages).map(x=>{const v=x.vehicleSnapshot||vehicles.find(v=>v.plate===x.vehicleId)||{};return [x.vehicleId||'',v.type||'',x.driver||'',v.capacityKg||'',x.finalizedAt||''];});if(rows.length)m.getRange(2,6,rows.length,headers.length).setValues(rows.map(r=>r.map(v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)));
}

function formFleetAssertMove_(st,p){if(['ADICIONAR','TRANSFERIR','RENOMEAR'].includes(p.operation)&&st.montages[p.target]&&st.montages[p.target].status==='Finalizada')throw new Error('Reabra a montagem de destino antes de alterá-la.');for(const key of p.keys||[]){const a=st.assignments[key];if(a&&st.montages[a.montageId].status==='Finalizada')throw new Error('Reabra a montagem antes de mover seus pedidos.');}}

function formFleetDate_(v){if(v instanceof Date)return v.getTime();const s=String(v||''),m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?Date.UTC(+m[3],+m[2]-1,+m[1]):0;}
function verificarFrotaMontagemRbn(){const st=formExpState_(formExpAux_()),fleet=formFleetOptions_(st);console.log(JSON.stringify({revisao:st.revision,montagens:Object.values(st.montages).map(m=>({nome:m.name,status:m.status,pedidos:Object.values(st.assignments).filter(a=>a.montageId===m.id).length})),veiculos:fleet.vehicles,motoristas:fleet.drivers.map(d=>d.name)}));}
