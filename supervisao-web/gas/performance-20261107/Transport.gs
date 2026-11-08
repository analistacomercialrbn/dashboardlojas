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
