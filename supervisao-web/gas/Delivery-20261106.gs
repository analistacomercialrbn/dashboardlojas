// Data de entrega: mesma autorização SAC, identidade estável e conflito otimista.
function deliveryFields_(){return [['deliveredDate','DATA ENTREGA']].concat(SAC_FIELDS);}
function deliveryDate_(value,tz){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value)||logDate_(value,tz)!==value)throw new Error('Informe uma data de entrega válida.');
 const today=Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
 if(value>today)throw new Error('A data de entrega não pode estar no futuro.');
 return Utilities.parseDate(value+' 12:00:00',tz,'yyyy-MM-dd HH:mm:ss');
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
function deliveryPublic_(f){return {name:f.name,label:f.label,value:f.value,options:f.options,readOnly:f.readOnly,type:f.type};}
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
 }finally{if(wrote)try{CacheService.getScriptCache().remove('LOG_S7_'+digestHex_(id+'|transport').slice(0,24)+'_M');}catch(err){}lock.releaseLock();}
}
function transportEdit_(user,p,id){return deliveryApi_(user,p,id,false);}
function transportBatch_(user,p,id){return deliveryApi_(user,p,id,true);}