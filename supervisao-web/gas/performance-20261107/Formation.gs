
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
 const code=code_(raw),known=code==null?'':names[String(code)];if(known)return known;
 const text=logText_(raw).replace(/^\s*\d+\s*-\s*/,'').trim();return text&&!/^\d+$/.test(text)?text:'Nome não localizado no cadastro';
}

// Pedidos consultados na base sincronizada do Força de Vendas; escrita somente na auxiliar.
const FORM_OPEN_STATUSES = new Set(['PENDENTE','LIBERADO','BLOQUEADO']);
const FORM_CACHE_SECONDS = 1800;

function formDirectCandidateRows_(sheet, ix, count, selected, fast) {
 const orderText=value=>String(value||'').trim();
 let wanted=selected;
 let ids;
 if(fast&&wanted?.size){
  // NUMPED pode aparecer com separadores na exibição; os valores brutos são validados abaixo.
  const terms=[...wanted].map(number=>number.replace(/\d(?=(?:\d{3})+$)/g,'$&[.,\u00a0\u202f ]?')).join('|');
  if(terms.length<7000){
   try{
    return sheet.getRange(2,ix.NUMPED+1,count,1).createTextFinder('^\\s*(?:'+terms+')(?:[.,]0+)?\\s*$')
     .useRegularExpression(true).matchEntireCell(true).findAll().map(range=>range.getRow());
   }catch(error){
    // A leitura bruta também suporta abas e formatos legados.
   }
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
 const ss=SpreadsheetApp.openById(CFG.salesSpreadsheetId),tz=ss.getSpreadsheetTimeZone(),out={};
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
   }
  }
 }
 const catalog={};for(const [key,o]of Object.entries(out)){if(!o)continue;o.rcas=[...new Set(o.rcas)];o.rca=o.rcas[0];o.statuses=[...new Set(o.statuses)];o.invoices=[...new Set(o.invoices)];o.active=o.statuses.every(status=>FORM_OPEN_STATUSES.has(status));if(!o.active)continue;o.version=digestHex_(JSON.stringify(o)).slice(0,24);catalog[key]=o;}return catalog;
}
function formDirectAllowed_(user,o){return (o.rcas||[]).length>0&&o.rcas.every(rca=>userAllowsRca_(user,rca))&&logisticsRowAllowed_(user,{seller:o.seller||String(o.rca||''),region:o.region||'',carrier:''},'operations');}
function formDirectSnapshot_(st){const out={};for(const e of st.events)for(const [key,o]of Object.entries(e.data.orders||{}))out[key]=o;return out;}
function formDirectView_(st,catalog,user){
 const saved=formDirectSnapshot_(st),orders=[],byKey={},canonical={};for(const o of Object.values(catalog)){const k=o.clientCode+'|'+o.order;canonical[k]=(canonical[k]||0)+1;}
 for(const key of new Set([...Object.keys(catalog),...Object.keys(st.assignments)])){const fresh=catalog[key],o=fresh||saved[key];if(!o||!formDirectAllowed_(user,o))continue;const a=st.assignments[key],duplicate=canonical[o.clientCode+'|'+o.order]>1,issue=!fresh?'Pedido não está mais em aberto na base comercial':duplicate?'Pedido repetido em mais de um ano; conferir origem':'';
  const row={sourceKey:key,orderKey:key,client:o.client,city:o.city,cityLabel:o.city,uf:o.uf,date:o.date,region:'',seller:String(o.rca||''),product:o.products.map(p=>p.description).join(' / '),status:o.statuses.join(' / '),weight:null,volumes:null,availableWeight:null,mountedWeight:null,awaitingFormation:!!fresh&&!duplicate,delivered:false,linked:true,montageId:a?a.montageId:''};
  const entry={...o,blocked:!fresh||duplicate,sourceIssue:issue,sourceKeys:[key],sourceRows:[row],originalStatuses:o.statuses,montageId:a?a.montageId:'',internalStatus:a?(st.montages[a.montageId].status==='Finalizada'?'Montagem finalizada':'Em montagem'):st.last[key]&&st.last[key].type==='REMOVER'?'Removido da montagem':'Disponível',sourceDate:o.date};orders.push(entry);byKey[key]=entry;
 }
 const grouped=new Map();for(const [key,a] of Object.entries(st.assignments)){if(!grouped.has(a.montageId))grouped.set(a.montageId,[]);grouped.get(a.montageId).push(key);}
 const montages=[];for(const m of Object.values(st.montages)){const keys=grouped.get(m.id)||[];if(keys.some(k=>!byKey[k]))continue;if(!keys.length&&!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)&&m.owner!==user.login)continue;const members=keys.map(k=>byKey[k]);montages.push({...m,orderKeys:keys,orders:keys.length,clients:new Set(members.map(o=>o.clientCode)).size,cities:new Set(members.map(o=>o.city+'|'+o.uf)).size,weight:keys.length?null:0,volumes:keys.length?null:0,sourceIssues:members.filter(o=>o.blocked).length});}
 const visibleMontages=new Set(montages.map(m=>m.id));
 const events=st.events.slice().reverse().filter(e=>e.keys.length?e.keys.every(k=>byKey[k]):visibleMontages.has(e.to)||['VEICULO_SALVAR','MOTORISTA_SALVAR','UNIDADE_SALVAR','ROTEIRIZACAO_CONFIGURAR'].includes(e.type)).slice(0,200).map(e=>({id:e.id,at:e.at,by:e.by,type:e.type,keys:e.keys,from:e.from,to:e.to,name:e.data.name||'',alerts:e.data.alerts||[],capacitySnapshot:e.data.capacitySnapshot||null,confirmed:e.data.route?.confirmed||false}));
 const view=formFleetEnhance_({ok:true,experimental:true,direct:true,orders,montages,events,mapRows:orders.map(o=>o.sourceRows[0]),revision:st.revision,sequence:st.sequence,sourceVersion:digestHex_(JSON.stringify(orders.map(o=>[o.key,o.version,o.blocked]).sort())).slice(0,32),updatedAt:new Date().toISOString(),source:'Força de Vendas · base sincronizada',missingFields:['Peso','Volumes']},st);
 view.viewVersion=digestHex_(JSON.stringify([view.revision,view.sourceVersion,view.fleet,view.routing,view.googleMapsKey])).slice(0,24);
 return view;
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
 const key='FORM_CATALOG_V3_'+digestHex_(CFG.salesSpreadsheetId+'|'+CFG.auxiliarySpreadsheetId+'|'+sourceState).slice(0,28);
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
 const catalog=formDirectCatalog_(null,names);
 if(sourceState===formDirectSourceState_()){
  centralCacheWrite_(cache,key,JSON.stringify(catalog),FORM_CACHE_SECONDS);
  centralCacheWrite_(cache,namesKey,JSON.stringify(names),FORM_CACHE_SECONDS);
 }
 return catalog;
}

function formDirectGuard_(sourceState) {
 if(formDirectSourceState_()!==sourceState)throw new Error('A base de vendas foi atualizada durante a consulta. Atualize os pedidos e confira a seleção.');
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

function formationDirectApi_(user,p) {
 if(p.action==='fleetSave')return formFleetApi_(user,p);
 if(p.action==='settingsRead')return formRouteSettingsRead_(user);
 if(p.action==='priorityRead')return formPriorityRead_(user);
 formExpAccess_(user);
 const reading=!p.action||p.action==='read';
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
   const view=formDirectView_(st,catalog,user);
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
  if(!lock.tryLock(3000))throw new Error('Outra gravação está em andamento. A seleção foi mantida. Tente salvar novamente em instantes.');
  timing.mark('fila');
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
    data:{name,...(company?{company}:{}),orders:snapshots,source:'FORCA_DE_VENDAS'}};
   timing.mark('validacao');
   projectionWarning=formProjectionCommit_(ss,st,event,timing);
   message=company?'Montagem '+name+' criada.':'Montagem salva na planilha auxiliar com os dados do Força de Vendas.';
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

