
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
 const saved=formDirectSnapshot_(st),orders=[],byKey={},canonical={};
 const reserved=new Set(Object.keys(st.assignments).map(key=>{const {client,order}=formExpParseKey_(key);return client+'|'+order;}));for(const o of Object.values(catalog)){const k=o.clientCode+'|'+o.order;canonical[k]=(canonical[k]||0)+1;}
 for(const key of new Set([...Object.keys(catalog),...Object.keys(st.assignments)])){const fresh=catalog[key],o=fresh||saved[key];if(!o||!formDirectAllowed_(user,o))continue;const a=st.assignments[key],duplicate=canonical[o.clientCode+'|'+o.order]>1,aliasReserved=!a&&reserved.has(o.clientCode+'|'+o.order),issue=!fresh?'Pedido não está mais em aberto na base comercial':duplicate?'Pedido repetido em mais de um ano; conferir origem':aliasReserved?'Pedido vinculado a uma montagem em outro ano':'';
  const row={sourceKey:key,orderKey:key,client:o.client,city:o.city,cityLabel:o.city,uf:o.uf,date:o.date,region:'',seller:String(o.rca||''),product:o.products.map(p=>p.description).join(' / '),status:o.statuses.join(' / '),weight:null,volumes:null,availableWeight:null,mountedWeight:null,awaitingFormation:!!fresh&&!duplicate&&!aliasReserved&&!a,delivered:false,linked:true,montageId:a?a.montageId:''};
  const entry={...o,blocked:!fresh||duplicate||aliasReserved,sourceIssue:issue,sourceKeys:[key],sourceRows:[row],originalStatuses:o.statuses,montageId:a?a.montageId:'',internalStatus:a?(st.montages[a.montageId].status===FORM_FINAL?'Montagem finalizada':st.montages[a.montageId].status):st.last[key]&&st.last[key].type==='REMOVER'?'Removido da montagem':'Disponível',sourceDate:o.date};orders.push(entry);byKey[key]=entry;
 }
 const grouped=new Map();for(const [key,a] of Object.entries(st.assignments)){if(!grouped.has(a.montageId))grouped.set(a.montageId,[]);grouped.get(a.montageId).push(key);}
 const montages=[];for(const m of Object.values(st.montages)){const keys=grouped.get(m.id)||[];if(keys.some(k=>!byKey[k]))continue;if(!keys.length&&!['ADMIN','DIRETOR','GERENTE'].includes(user.perfil)&&m.owner!==user.login)continue;const members=keys.map(k=>byKey[k]);montages.push({...m,orderKeys:keys,orders:keys.length,clients:new Set(members.map(o=>o.clientCode)).size,cities:new Set(members.map(o=>o.city+'|'+o.uf)).size,weight:keys.length?null:0,volumes:keys.length?null:0,sourceIssues:members.filter(o=>o.blocked).length});}
 const visibleMontages=new Set(montages.map(m=>m.id));
 const events=st.events.slice().reverse().filter(e=>e.keys.length?e.keys.every(k=>byKey[k]):visibleMontages.has(e.to)||['VEICULO_SALVAR','MOTORISTA_SALVAR','UNIDADE_SALVAR','ROTEIRIZACAO_CONFIGURAR'].includes(e.type)).slice(0,200).map(formDirectEvent_);
 const view=formFleetEnhance_({ok:true,experimental:true,direct:true,orders,montages,events,mapRows:orders.map(o=>o.sourceRows[0]),revision:st.revision,sequence:st.sequence,sourceVersion:digestHex_(JSON.stringify(orders.map(o=>[o.key,o.version,o.blocked]).sort())).slice(0,32),updatedAt:new Date().toISOString(),source:'Força de Vendas · base sincronizada',missingFields:['Peso','Volumes']},st);
 view.viewVersion=digestHex_(JSON.stringify([view.revision,view.sourceVersion,view.fleet,view.routing,view.googleMapsKey])).slice(0,24);
 return view;
}
function formDirectEvent_(e) {
 return {id:e.id,at:e.at,by:e.by,type:e.type,keys:e.keys,from:e.from,to:e.to,name:e.data.name||'',
  alerts:e.data.alerts||[],capacitySnapshot:e.data.capacitySnapshot||null,overweight:e.data.overweight||null,
  confirmed:e.data.route?.confirmed||false};
}

function formDirectMontageHistory_(user,p) {
 formExpAccess_(user);
 const st=formExpState_(formExpAux_(true)), id=String(p.target||'');
 formFleetCanManage_(user,st,id);
 const snapshots=formDirectSnapshot_(st);
 return {ok:true,events:st.events.slice().reverse()
  .filter(e=>(e.to===id||Object.values(e.from).includes(id))
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

function formationDirectApi_(user,p) {
 if(p.action==='fleetSave')return formFleetApi_(user,p);
 if(p.action==='settingsRead')return formRouteSettingsRead_(user);
 if(p.action==='montageHistory')return formDirectMontageHistory_(user,p);
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
const FORM_OPEN = 'Em aberto';
const FORM_ROUTING = 'Aguardando roteirização';
const FORM_FINAL = 'Finalizada';

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
function formFleetAssertMove_(st,p) {
  if (['ADICIONAR','TRANSFERIR','RENOMEAR'].includes(p.operation) && st.montages[p.target]?.status !== FORM_OPEN) {
    throw new Error('A montagem de destino precisa estar em aberto.');
  }
  for (const key of p.keys || []) {
    const a=st.assignments[key];
    if (a && st.montages[a.montageId]?.status !== FORM_OPEN) throw new Error('Reabra a montagem antes de mover os pedidos.');
  }
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
function verificarFrotaMontagemRbn(){const st=formExpState_(formExpAux_(true)),fleet=formFleetOptions_(st);console.log(JSON.stringify({revisao:st.revision,montagens:Object.values(st.montages).map(m=>({nome:m.name,status:m.status,pedidos:Object.values(st.assignments).filter(a=>a.montageId===m.id).length})),veiculos:fleet.vehicles,motoristas:fleet.drivers.map(d=>d.name)}));}

function formFleetHydrate_(st) {
  st.fleetVehicles = {};
  st.fleetDrivers = {};
  st.orderWeights = {};
  st.routeUnits = {};
  st.routePreferences = null;
  for (const m of Object.values(st.montages)) {
    Object.assign(m, { status: FORM_OPEN, vehicleId: '', driver: '', routingAt: '', routingBy: '', finalizedAt: '', finalizedBy: '',
      statusAt:m.createdAt, statusBy:m.owner, overweightOccurrences: [],
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

    if (!Object.prototype.hasOwnProperty.call(st.montages,e.to)) continue;
    const m = st.montages[e.to];
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
    if (e.type === 'ROTEIRO_SALVAR') {
      m.route = {...d.route, at:e.at, by:e.by};
      if (d.route.confirmed) {
        if (m.status !== FORM_FINAL) {
          Object.assign(m, {status:FORM_FINAL, finalizedAt:e.at, finalizedBy:e.by, statusAt:e.at, statusBy:e.by});
        }
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
    const closed = stored.status !== FORM_OPEN;
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
  if (p.confirmed !== true) throw new Error('Confirme o envio para roteirização.');
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
  if (![...settings,'CONFIGURAR_CARGA','PESOS_PEDIDOS','FINALIZAR','ENVIAR_ROTEIRO','REABRIR','ROTEIRO_SALVAR'].includes(operation)) {
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
    if (['FINALIZAR','ENVIAR_ROTEIRO'].includes(operation)) {
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
      if (['FINALIZAR','ENVIAR_ROTEIRO'].includes(operation)) data = formFleetFinish_(st, catalog, user, p, target, sourceState);
      if (operation === 'REABRIR') {
        if (m.status === FORM_OPEN || p.confirmed !== true) throw new Error('Confirme a reabertura da montagem.');
        data = {};
      }
      if (operation === 'ROTEIRO_SALVAR') {
        const route=formRouteSaveData_(st, m, keys, p.route || {});
        const reason=logText_(p.route?.overweightReason);
        if (reason.length>500) throw new Error('A justificativa deve ter até 500 caracteres.');
        data={route, overweight:route.confirmed ? formFleetOverweight_(m,reason) : null};
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
      ROTEIRO_SALVAR:st.montages[target]?.route?.confirmed?'Roteiro confirmado. Montagem finalizada.':'Rascunho do roteiro salvo.'
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
  if (montage.status !== FORM_ROUTING) throw new Error('A montagem precisa estar aguardando roteirização.');
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
const FORM_PROJECTION_TABLES = {
  CRIAR: ['MONTAGENS','MONTAGEM_PEDIDOS'],
  ADICIONAR: ['MONTAGEM_PEDIDOS'],
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
  if (tables.includes('MONTAGENS')) {
    const vehicles = new Map(formFleetOptions_(st,true).vehicles.map(vehicle=>[vehicle.plate,vehicle]));
    formProjectionWrite_(ss,'MONTAGENS',[
      ...FORM_EXP_SCHEMA.MONTAGENS,'PLACA','TIPO_VEICULO','MOTORISTA','CAPACIDADE_KG','FINALIZADO_EM','SITUACAO_ROTEIRO','EMPRESA_SAIDA','ROTEIRIZACAO_INICIADA_EM','ROTEIRIZACAO_INICIADA_POR','FINALIZADO_POR','STATUS_ATUALIZADO_EM','STATUS_ATUALIZADO_POR','EXCESSO_PESO_JSON'
    ],Object.values(st.montages).map(m=>{
      const v=m.vehicleSnapshot||vehicles.get(m.vehicleId)||{};
      const routeStatus=m.status===FORM_FINAL?'Confirmado':m.status===FORM_ROUTING?(m.route?'Rascunho':'Pendente'):'';
      return [m.id,m.name,m.createdAt,m.owner,m.status,m.vehicleId,v.type||'',m.driver,v.capacityKg||'',m.finalizedAt,routeStatus,FORM_COMPANIES[m.company]||'',m.routingAt,m.routingBy,m.finalizedBy,m.statusAt,m.statusBy,
        JSON.stringify(m.overweightOccurrences).length<=44000?JSON.stringify(m.overweightOccurrences):'Consultar ocorrências no histórico'];
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
  const workflowKey='FORM_WORKFLOW_V1_'+id;
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
function centralTransportVersionKey_(id) {
  return 'LOG_TRANSPORT_CHANGE_'+digestHex_(id).slice(0,24);
}

function centralLogisticsRead_(user, p, kind, id) {
  const sourceKind=kind==='formations'?'operations':kind;
  const timing=centralTiming_('logistica.'+sourceKind);
  let status='erro';
  try {
    const cache=CacheService.getScriptCache(),props=PropertiesService.getScriptProperties();
    const changes=sourceKind==='transport'?(props.getProperty(centralTransportVersionKey_(id))||''):'';
    const key='LOG_ROWS_V8_'+digestHex_(id+'|'+sourceKind+'|'+changes).slice(0,30);
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
    let from='',to='';
    for(const row of rows)if(row.date){if(!from||row.date<from)from=row.date;if(row.date>to)to=row.date;}
    timing.mark('recorte');
    return {ok:true,meta:{...meta,count:rows.length,from,to},rows};
  }finally{
    timing.finish(status);
  }
}
function transportEditLayout_(sh) {
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0], names=headers.map(logNorm_);
  if(['CHAVE','NF','TRANSPORTADORA','CLIENTE','CNPJ/CPF','CIDADE','UF'].some((h,i)=>names[i]!==h)){
    throw new Error('A estrutura de identificação da planilha mudou.');
  }
  const fields=deliveryFields_().map(([name,label])=>{
    const column=names.indexOf(logNorm_(label));
    if(column<0||names.lastIndexOf(logNorm_(label))!==column)throw new Error('Coluna ausente ou duplicada: '+label+'.');
    return {name,label,col:column,type:name==='deliveredDate'?'date':'text'};
  });
  return {headers,fields,tz:sh.getParent().getSpreadsheetTimeZone()};
}

function transportEditRows_(sh, user, keys, layout) {
  const count=sh.getLastRow()-1;
  if(count<1)throw new Error('Acompanhamento sem notas.');
  const needed=new Set(keys), indices=new Map(), byRow=new Map();
  const identities=sh.getRange(2,1,count,7).getDisplayValues();
  identities.forEach((cells,i)=>{
    if(!cells.some(Boolean))return;
    const key=transportRowKey_(cells);
    if(!needed.has(key))return;
    if(indices.has(key))throw new Error('Nota com chave duplicada. Atualize a seleção.');
    indices.set(key,i+2);
    byRow.set(i+2,key);
  });
  if(indices.size!==needed.size)throw new Error('Nota ausente. Atualize a seleção.');
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
      items.set(key,{key,n,version,fields:rowFields,record,tz});
    }
  }
  return keys.map(key=>items.get(key));
}

function transportEditRead_(items, batch) {
  if(!batch){
    const x=items[0],{invoice,client,carrier}=x.record;
    return {ok:true,key:x.key,version:x.version,fields:x.fields.map(deliveryPublic_),invoice,client,carrier,record:x.record};
  }
  return {ok:true,items:items.map(x=>({key:x.key,version:x.version,invoice:x.record.invoice,client:x.record.client})),
    fields:items[0].fields.map((field,i)=>{
      const values=items.map(x=>x.fields[i]), sets=values.filter(f=>f.options!==null).map(f=>new Set(f.options));
      return {...deliveryPublic_(field),value:'',readOnly:values.some(f=>f.readOnly),filled:values.filter(f=>f.value).length,
        options:sets.length?[...sets[0]].filter(v=>sets.every(set=>set.has(v))):null};
    })};
}

function transportEditChanges_(p, batch) {
  const input=batch?p.changes:p.values, fields=deliveryFields_().map(f=>f[0]);
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
  for(const [index, rows] of groups){
    const col=index+1, letter=transportColumnLetter_(col), initial=rows[0].field;
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
    const layout=transportEditLayout_(sh), items=transportEditRows_(sh,user,keys,layout);
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
    // Uma conferência em bloco substitui a leitura integral repetida para cada nota.
    const nowLayout=transportEditLayout_(sh);
    if(JSON.stringify(nowLayout.headers)!==JSON.stringify(layout.headers))throw new Error('Os cabeçalhos da planilha mudaram. Reabra o formulário.');
    const latest=transportEditRows_(sh,user,modified.map(x=>x.key),nowLayout);
    if(latest.some((x,i)=>x.n!==modified[i].n||x.version!==modified[i].version)){
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
