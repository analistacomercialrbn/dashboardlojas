function transportValidationOptions_(rule, lists, label) {
  if(!rule)return null;
  const type=String(rule.getCriteriaType()), args=rule.getCriteriaValues();
  if(type==='VALUE_IN_LIST')return args[0].map(String);
  if(type!=='VALUE_IN_RANGE')throw new Error('Validação não suportada no campo '+label+'.');
  const range=args[0],key=range.getSheet().getSheetId()+'!'+range.getA1Notation();
  if(!lists.has(key))lists.set(key,range.getDisplayValues().flat().filter(Boolean));
  return lists.get(key);
}

function transportEditRows_(sh, user, keys, batch) {
  const total=sh.getLastRow();
  if(total<2)throw new Error('Nenhuma nota disponível.');
  const needed=new Set(keys), indices=new Map();
  const identities=sh.getRange(2,1,total-1,7).getDisplayValues();
  identities.forEach((cells,i)=>{
    if(!cells.some(Boolean))return;
    const key=transportRowKey_(cells);
    if(!needed.has(key))return;
    if(indices.has(key))throw new Error('Nota com chave duplicada. Atualize a seleção.');
    indices.set(key,i+2);
  });
  if(indices.size!==needed.size)throw new Error('Nota ausente. Atualize a seleção.');
  const head=sh.getRange(1,1,1,36).getDisplayValues()[0];
  if(SAC_FIELDS.some((f,i)=>logNorm_(head[i+27])!==logNorm_(f[1])))throw new Error('A estrutura da planilha mudou. Atualize a tela.');
  const tz=sh.getParent().getSpreadsheetTimeZone(), lists=new Map(), items=new Map();
  const byRow=new Map([...indices].map(([key,n])=>[n,key]));
  for(const {first,last} of centralRowBlocks_([...byRow.keys()])){
    const count=last-first+1, raw=sh.getRange(first,1,count,36).getValues();
    const manual=sh.getRange(first,28,count,8), display=manual.getDisplayValues(), formulas=manual.getFormulas(), rules=manual.getDataValidations();
    for(let i=0;i<count;i++){
      const n=first+i,key=byRow.get(n);
      if(!key)continue;
      const record=logRecords_([head,raw[i]],'transport',tz,[])[0];
      if(!record||!logisticsRowAllowed_(user,record,'transport'))throw new Error('Uma nota está fora do seu recorte de acesso.');
      if(!key.startsWith('trf_')&&record.id!==key)throw new Error('A posição de uma nota mudou. Atualize a seleção.');
      const values=display[i], rowFormulas=formulas[i];
      const fields=SAC_FIELDS.map(([name,label],j)=>({name,label,value:values[j],readOnly:!!rowFormulas[j],options:transportValidationOptions_(rules[i][j],lists,label)}));
      const version=digestHex_(JSON.stringify(batch?[key,raw[i][2],values,rowFormulas,fields.map(f=>f.options)]:[key,raw[i][2],values]));
      items.set(key,{key,version,n,record,values,formulas:rowFormulas,fields});
    }
  }
  return keys.map(key=>items.get(key));
}

function transportEditRead_(items, batch) {
  if(!batch){
    const x=items[0], {invoice,client,carrier}=x.record;
    return {ok:true,key:x.key,version:x.version,fields:x.fields,invoice,client,carrier,record:x.record};
  }
  return {ok:true,items:items.map(x=>({key:x.key,version:x.version,invoice:x.record.invoice,client:x.record.client})),
    fields:SAC_FIELDS.map(([name,label],i)=>{
      const values=items.map(x=>x.fields[i]), restricted=values.filter(f=>f.options!==null);
      const sets=restricted.map(f=>new Set(f.options));
      return {name,label,readOnly:values.some(f=>f.readOnly),filled:values.filter(f=>String(f.value||'').trim()).length,
        options:sets.length?[...sets[0]].filter(v=>sets.every(set=>set.has(v))):null};
    })};
}

function transportEditChanges_(p, batch) {
  const input=batch?p.changes:p.values;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!SAC_FIELDS.some(f=>f[0]===k))){
    throw new Error('Campos de gravação inválidos.');
  }
  if(batch&&(!Object.keys(input).length||!p.versions||typeof p.versions!=='object'||Array.isArray(p.versions))){
    throw new Error('Reabra o lote para conferir os valores atuais.');
  }
  return Object.fromEntries(Object.entries(input).map(([name,change])=>{
    if(!batch)return [name,{value:String(change??'').trim(),mode:'replace'}];
    if(!change||typeof change.value!=='string'||!change.value.trim()||change.value.trim().length>2000||
       !(change.mode==='replace'||name==='follow'&&change.mode==='append'))throw new Error('Preencha corretamente os campos marcados.');
    return [name,{value:change.value.trim(),mode:change.mode}];
  }));
}

function transportEditValidate_(items, versions, changes, batch) {
  for(const item of items){
    if(item.version!==versions[item.key])throw new Error('Uma nota foi alterada na planilha. Reabra o formulário antes de salvar.');
    item.next=item.values.slice();
    item.changed=[];
    item.fields.forEach((field,i)=>{
      const change=changes[field.name];
      if(!change)return;
      const v=change.mode==='append'&&field.value?field.value+'\n'+change.value:change.value;
      if(v.length>2000)throw new Error('O campo '+field.label+' excede 2.000 caracteres.');
      if(field.readOnly&&(batch||v!==field.value))throw new Error('O campo '+field.label+' contém fórmula.');
      if(v===field.value)return;
      if(v&&field.options&&!field.options.includes(v))throw new Error('Escolha uma opção válida para '+field.label+'.');
      item.next[i]=v;
      item.changed.push(i);
    });
  }
}

function transportEditVerify_(sh, items, before) {
  const byRow=new Map(items.map(x=>[x.n,x])), failed=new Set();
  for(const {first,last} of centralRowBlocks_([...byRow.keys()])){
    const count=last-first+1, range=sh.getRange(first,28,count,8), values=range.getDisplayValues();
    const identities=sh.getRange(first,1,count,7).getDisplayValues(), formulas=before?range.getFormulas():null;
    for(let i=0;i<count;i++){
      const x=byRow.get(first+i);
      if(!x)continue;
      const correct=transportRowKey_(identities[i])===x.key&&(before?
        JSON.stringify(values[i])===JSON.stringify(x.values)&&JSON.stringify(formulas[i])===JSON.stringify(x.formulas):
        x.changed.every(j=>values[i][j]===x.next[j]));
      if(!correct)failed.add(x.key);
    }
  }
  return failed;
}

function transportEditWrite_(sh, items, changes) {
  SAC_FIELDS.forEach(([name],j)=>{
    const rows=items.filter(x=>x.changed.includes(j)).sort((a,b)=>a.n-b.n);
    if(!rows.length)return;
    const col=28+j;
    if(changes[name].mode==='replace'){
      const letter='A'+String.fromCharCode(65+col-27);
      sh.getRangeList(rows.map(x=>letter+x.n)).setValue(formAuxSafeCell_(changes[name].value));
      return;
    }
    // Anexos podem ter valores diferentes; escreve trechos adjacentes na coluna.
    let first=rows[0].n, values=[];
    for(const x of rows){
      if(x.n!==first+values.length){
        sh.getRange(first,col,values.length,1).setValues(values);
        first=x.n;
        values=[];
      }
      values.push([formAuxSafeCell_(x.next[j])]);
    }
    sh.getRange(first,col,values.length,1).setValues(values);
  });
}

function transportEditPatch_(x) {
  const fields=Object.fromEntries(SAC_FIELDS.map(([name],i)=>[name,x.next[i]]));
  return {id:x.key,...fields,problem:fields.manualOccurrence||fields.notes||fields.category,
    occurrence:logProblem_(fields.manualOccurrence)||logProblem_(fields.notes)||logProblem_(fields.category)};
}

function centralTransportEdit_(user, p, id, batch) {
  if(!platformAccess_(user).editTransport)throw new Error('Somente o SAC autorizado pode preencher os campos manuais.');
  if(p.kind!=='transport')throw new Error('Fonte de edição inválida.');
  const read=p.action===(batch?'batchRead':'editRead');
  if(!read&&p.action!==(batch?'batchSave':'editSave'))throw new Error('Ação de edição inválida.');
  const keys=batch?p.keys:[String(p.key||'')];
  if(!Array.isArray(keys)||!keys.length||keys.length>500||keys.some(k=>typeof k!=='string'||!k||k.length>200)||new Set(keys).size!==keys.length){
    throw new Error(batch?'Selecione de 1 a 500 notas distintas.':'Identificador da nota inválido.');
  }
  const timing=centralTiming_('sac.'+p.action);
  const lock=read?null:LockService.getScriptLock();
  let status='erro', locked=false, attempted=false;
  try{
    const changes=read?null:transportEditChanges_(p,batch);
    if(lock){
      locked=lock.tryLock(3000);
      if(!locked)throw new Error('Outra gravação está em andamento. Seus dados foram mantidos. Tente novamente em instantes.');
      timing.mark('fila');
    }
    const sh=SpreadsheetApp.openById(id).getSheetByName('ACOMPANHAMENTO');
    if(!sh)throw new Error('Aba de acompanhamento ausente.');
    const items=transportEditRows_(sh,user,keys,batch);
    timing.mark('notasSelecionadas');
    if(read){
      const result=transportEditRead_(items,batch);
      status='ok';
      return result;
    }
    transportEditValidate_(items,batch?p.versions:{[keys[0]]:p.version},changes,batch);
    const modified=items.filter(item=>item.changed.length);
    if(!modified.length){
      status='sem_alteracoes';
      return {ok:true,updated:0,unchanged:items.length,failed:[],partial:false,patches:[],message:'Nenhuma alteração para salvar.'};
    }
    if(transportEditVerify_(sh,modified,true).size)throw new Error('A planilha mudou durante a edição. Reabra o formulário.');
    timing.mark('validacao');
    attempted=true;
    try{
      transportEditWrite_(sh,modified,changes);
    }catch(error){
      console.warn('Uma gravação do SAC precisa de conferência.');
    }
    try{SpreadsheetApp.flush();}catch(error){console.warn('Uma gravação do SAC precisa de confirmação.');}
    timing.mark('gravacao');
    let failed;
    try{failed=transportEditVerify_(sh,modified,false);}catch(error){failed=new Set(modified.map(x=>x.key));}
    timing.mark('confirmacao');
    const saved=modified.filter(x=>!failed.has(x.key)), updatedAt=new Date().toISOString();
    let auditWarning=false;
    if(saved.length)try{
      const audit=saved.map(x=>({at:updatedAt,by:user.login,key:x.key,fields:x.changed.map(j=>SAC_FIELDS[j][0]),...(batch?{batch:true}:{})}))
        .concat(rbnLoadState_('LOG_SAC_AUDIT')||[]);
      while(audit.length>100||JSON.stringify(audit).length>30000)audit.pop();
      rbnSaveState_('LOG_SAC_AUDIT',audit);
    }catch(error){auditWarning=true;}
    if(!batch&&failed.size)throw new Error('Não foi possível confirmar todos os campos. Reabra a nota para conferir o que foi gravado.');
    status=failed.size?'parcial':'ok';
    return {ok:true,updated:saved.length,unchanged:items.length-modified.length,
      failed:modified.filter(x=>failed.has(x.key)).map(x=>({key:x.key,invoice:x.record.invoice})),
      partial:failed.size>0,auditWarning,updatedAt,patches:saved.map(transportEditPatch_),message:'Campos salvos na planilha de transportadoras.'};
  }finally{
    if(attempted)try{
      PropertiesService.getScriptProperties().setProperty(centralTransportVersionKey_(id),Utilities.getUuid());
    }catch(error){console.warn('A atualização automática do cache do SAC ficou pendente.');}
    if(locked)lock.releaseLock();
    timing.finish(status);
  }
}
