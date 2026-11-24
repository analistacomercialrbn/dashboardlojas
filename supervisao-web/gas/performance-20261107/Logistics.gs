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
