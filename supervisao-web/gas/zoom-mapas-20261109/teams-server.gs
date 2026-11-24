// Visão equipes: leitura mensal das mesmas fontes comerciais, sem alterar as bases.
// Metas adicionais, quando disponíveis: METAS_INDICADORES (MES, COD_RCA, INDICADOR, META).
function teamsList_(value) {
  return (Array.isArray(value)?value:value==null||value===''||value==='Todos'?[]:[value]).map(String).filter(v=>v&&v!=='Todos');
}

function teamsNationalHolidays_(year) {
  // Calendário nacional; pontos facultativos só entram se cadastrados em FERIADOS.
  // Referência: Portaria MGI 11.460/2025, calendário de 2026.
  const fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','12-25'];
  if(year>=2024)fixed.push('11-20');
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  const friday=new Date(Date.UTC(year,month-1,day-2)).toISOString().slice(0,10);
  return new Set(fixed.map(v=>year+'-'+v).concat(friday));
}

function teamsCalendar_(month,lastBilled,today,extra=[]) {
  const [year,number]=month.split('-').map(Number),start=month+'-01';
  const end=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  const current=today.slice(0,7),future=month>current;
  const cutoff=future?'':month<current?end:(lastBilled&&lastBilled<=today?lastBilled:today);
  const holidays=teamsNationalHolidays_(year);
  extra.forEach(day=>holidays.add(day));
  let total=0,elapsed=0,elapsedToday=0;
  for(let at=Date.parse(start+'T12:00:00Z');at<=Date.parse(end+'T12:00:00Z');at+=86400000){
    const day=new Date(at),iso=day.toISOString().slice(0,10);
    if(day.getUTCDay()===0||day.getUTCDay()===6||holidays.has(iso))continue;
    total++;
    if(cutoff&&iso<=cutoff)elapsed++;
    if(iso<=today)elapsedToday++;
  }
  return {month,start,end,cutoff,lastBilled:lastBilled||'',total,elapsed,remaining:total-elapsed,remainingToday:total-elapsedToday,
    factor:future||!elapsed?null:month<current?1:total/elapsed,
    closed:month<current,future,holidays:[...holidays].filter(day=>day.startsWith(month)).sort()};
}

function teamsReference_(month) {
  const ss=SpreadsheetApp.openById(CFG.auxiliarySpreadsheetId),holidays=[],goals=[];
  const holidaySheet=ss.getSheetByName('FERIADOS');
  if(holidaySheet&&holidaySheet.getLastRow()>1){
    const rows=holidaySheet.getDataRange().getValues(),headers=rows.shift().map(logNorm_),column=headers.indexOf('DATA');
    if(column>=0)for(const row of rows){const day=logDate_(row[column],ss.getSpreadsheetTimeZone());if(day)holidays.push(day);}
  }
  const goalSheet=ss.getSheetByName('METAS_INDICADORES');
  if(goalSheet&&goalSheet.getLastRow()>1){
    const range=goalSheet.getDataRange(),rows=range.getValues(),formats=range.getNumberFormats();
    const header=rows.shift().map(logNorm_),at=name=>header.indexOf(name);
    if(['MES','COD_RCA','INDICADOR','META'].some(name=>at(name)<0))throw new Error('Revise as colunas de METAS_INDICADORES: MES, COD_RCA, INDICADOR e META.');
    const aliases={POSITIVACAO:'clients',POSITIVACOES:'clients',MIX:'mix','MIX DE PRODUTOS':'mix','MIX POR CLIENTE':'mix',MARGEM:'margin','MARGEM BRUTA':'margin',TICKET:'ticket','TICKET MEDIO':'ticket'};
    rows.forEach((row,i)=>{
      const raw=row[at('MES')],key=raw instanceof Date?Utilities.formatDate(raw,ss.getSpreadsheetTimeZone(),'yyyy-MM'):String(raw||'').trim();
      if(key!==month)return;
      const indicator=aliases[logNorm_(row[at('INDICADOR')])],rca=code_(row[at('COD_RCA')]);
      let value=num_(row[at('META')]);
      if(indicator==='margin'&&String(formats[i+1][at('META')]).includes('%'))value*=100;
      if(indicator&&rca!=null&&value>0)goals.push({rca,indicator,value,department:at('DEPARTAMENTO')<0?'':String(row[at('DEPARTAMENTO')]||'').trim()});
    });
  }
  return {holidays,goals};
}

function teamsBucket_() {
  return {revenue:0,profit:0,missingProfit:0,clients:new Map(),orders:new Set(),lines:0};
}

function teamsAddSale_(bucket,sale) {
  bucket.revenue+=sale.value;bucket.lines++;
  if(sale.profit==null&&sale.value!==0)bucket.missingProfit++;
  else bucket.profit+=sale.profit||0;
  if(sale.order)bucket.orders.add(sale.rca+'|'+sale.order);
  if(sale.value>0&&sale.client!=null){
    if(!bucket.clients.has(sale.client))bucket.clients.set(sale.client,new Set());
    if(sale.product!=null)bucket.clients.get(sale.client).add(sale.product);
  }
}

function teamsMetrics_(bucket,canMargin) {
  const clients=bucket.clients.size,pairs=[...bucket.clients.values()].reduce((sum,products)=>sum+products.size,0);
  return {revenue:bucket.revenue,clients,mix:clients?pairs/clients:null,ticket:clients?bucket.revenue/clients:null,
    margin:canMargin&&bucket.revenue>0&&!bucket.missingProfit?100*bucket.profit/bucket.revenue:null,
    marginMissingLines:canMargin?bucket.missingProfit:null,orders:bucket.orders.size,lines:bucket.lines};
}

function teamsDate_(value,tz) {
  // Mesma normalização civil do cache comercial, sem chamada ao serviço por linha.
  return typeof value==='number'?logDate_(value,tz):(dateIso_(value)||'').slice(0,10);
}

// O cache interno contém todas as vendas do mês. O recorte de acesso é aplicado
// antes de devolver qualquer agregado ao usuário, inclusive em acertos de cache.
function teamsSalesMonth_(month,version,today) {
  const cache=CacheService.getScriptCache(),key='TEAMS_MONTH_V1_'+digestHex_(month+'|'+version+'|'+today).slice(0,32);
  const saved=centralCacheRead_(cache,key);if(saved)return saved;
  const directory=new Map(portfolioClients_({perfil:'ADMIN'}).links.map(([child,parent])=>[String(child),parent]));
  const source=SpreadsheetApp.openById(CFG.salesSpreadsheetId),tz=source.getSpreadsheetTimeZone();
  let lastBilled='';
  const records=[];
  // Uma venda pode ser faturada em ano diferente do ano original do pedido.
  for(const sourceYear of CFG.years){
  const sheet=source.getSheetByName(String(sourceYear));
  if(!sheet)continue;
  const headers=headerIndex_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]);
  const needed=['Posição','Data Faturamento','Cod/Vend.','Cod/Cliente','Cod/Produto','Pedidos Enviados','DEPARTAMENTO','MUNICENT','ESTENT'];
  if(needed.some(name=>headers[name]==null))throw new Error('A base comercial não possui todas as colunas necessárias para o ranking.');
  const width=Math.max(...needed.concat(['Vl Lucro','NUMPED']).map(name=>headers[name]??-1))+1;
  const count=Math.max(0,sheet.getLastRow()-1);
  if(count){
    const billings=sheet.getRange(2,headers['Data Faturamento']+1,count,1).getValues(),statuses=sheet.getRange(2,headers['Posição']+1,count,1).getValues(),blocks=new Set();
    for(let i=0;i<count;i++){
      if(norm_(statuses[i][0])!=='FECHADO')continue;
      const day=teamsDate_(billings[i][0],tz);
      if(!day.startsWith(month)||day>today)continue;
      if(day>lastBilled)lastBilled=day;
      blocks.add(Math.floor(i/4000));
    }
    for(const block of blocks){
      const first=2+block*4000,rows=sheet.getRange(first,1,Math.min(4000,count-block*4000),width).getValues();
      for(const row of rows){
        if(norm_(cell_(row,headers,'Posição'))!=='FECHADO')continue;
        const day=teamsDate_(cell_(row,headers,'Data Faturamento'),tz);
        if(!day.startsWith(month)||day>today)continue;
        const rca=code_(cell_(row,headers,'Cod/Vend.'));
        if(rca==null)continue;
        const department=String(cell_(row,headers,'DEPARTAMENTO')||'').trim(),rawCity=String(cell_(row,headers,'MUNICENT')||'').trim(),uf=norm_(cell_(row,headers,'ESTENT'));
        const client=code_(cell_(row,headers,'Cod/Cliente')),rawProfit=cell_(row,headers,'Vl Lucro');
        const knownProfit=typeof rawProfit==='number'&&Number.isFinite(rawProfit)||typeof rawProfit==='string'&&/^\s*-?\d[\d.,]*\s*$/.test(rawProfit);
        const sale={rca,client:client==null?null:directory.get(String(client))??client,product:code_(cell_(row,headers,'Cod/Produto')),
          department,city:rawCity,uf,order:String(cell_(row,headers,'NUMPED')||''),value:num_(cell_(row,headers,'Pedidos Enviados')),profit:knownProfit?num_(rawProfit):null};
        records.push(sale);
      }
    }
  }
  }
  const result={records,lastBilled};
  centralCacheWrite_(cache,key,JSON.stringify(result),21600);
  return result;
}

function teamsView_(user,payload) {
  if(!['ADMIN','DIRETOR','GERENTE','SUPERVISOR','RCA'].includes(user.perfil))throw new Error('Seu perfil não tem acesso à visão de equipes.');
  const f=payload.filters||{},year=Number(f.year),monthNumber=Number(f.month);
  if(!CFG.years.map(Number).includes(year)||!Number.isInteger(monthNumber)||monthNumber<1||monthNumber>12)throw new Error('Selecione um ano e um mês para comparar as equipes.');
  const month=year+'-'+String(monthNumber).padStart(2,'0'),today=centralToday_('America/Fortaleza');
  const aux=readAuxiliary_(),reference=teamsReference_(month),departments=teamsList_(f.department),supervisors=teamsList_(f.supervisor),sellers=teamsList_(f.rca);
  const ufs=teamsList_(f.uf).map(norm_),city=teamsList_(f.city).map(norm_),region=teamsList_(f.region).map(norm_);
  const catalog=new Map(aux.rcas.map(rca=>[String(rca.code),rca]));
  const sellerAllowed=code=>userAllowsRca_(user,code)&&(!sellers.length||sellers.includes(String(code)))&&
    (!supervisors.length||supervisors.includes(String(catalog.get(String(code))?.supervisor||'')));
  const canMargin=['ADMIN','DIRETOR','GERENTE'].includes(user.perfil);
  const version=SCRIPT_PROPS.getProperty('SNAPSHOT_UPDATED_AT')||'';
  const key='TEAMS_VIEW_V2_'+digestHex_(JSON.stringify([month,today,version,f,user.login,user.perfil,user.accessVersion,user.supervisor,user.cod_rca,aux.goals,reference])).slice(0,40);
  const cache=CacheService.getScriptCache(),saved=centralCacheRead_(cache,key);
  if(saved)return saved;
  const buckets=new Map(),overall=teamsBucket_();
  for(const rca of aux.rcas)if(sellerAllowed(rca.code))buckets.set(String(rca.code),teamsBucket_());
  const monthly=teamsSalesMonth_(month,version,today),lastBilled=monthly.lastBilled;
  for(const sale of monthly.records){
    const rca=sale.rca;
    if(!sellerAllowed(rca))continue;
    if(departments.length&&!departments.includes(sale.department)||ufs.length&&!ufs.includes(sale.uf)||city.length&&!city.includes(norm_(sale.city)))continue;
    if(region.length&&!region.includes(norm_(aux.routeMap.get(rca+'|'+norm_(sale.city))||'')))continue;
    if(!buckets.has(String(rca))){buckets.set(String(rca),teamsBucket_());catalog.set(String(rca),{code:rca,name:'RCA '+rca,supervisor:''});}
    teamsAddSale_(buckets.get(String(rca)),sale);teamsAddSale_(overall,sale);
  }
  const calendar=teamsCalendar_(month,lastBilled,today,reference.holidays);
  const rows=[...buckets].map(([code,bucket])=>{
    const person=catalog.get(code)||{},actual=teamsMetrics_(bucket,canMargin);
    const values=aux.goals.filter(goal=>goal.monthKey===month&&String(goal.rca)===code&&(!departments.length||departments.includes(goal.department)));
    const revenueGoal=values.length?values.reduce((sum,goal)=>sum+goal.value,0):null;
    const goals={revenue:revenueGoal>0?revenueGoal:null,clients:null,mix:null,margin:null,ticket:null};
    for(const indicator of ['clients','mix','margin','ticket']){
      const goalsInScope=reference.goals.filter(goal=>String(goal.rca)===code&&goal.indicator===indicator&&
        (departments.length?departments.length===1&&departments.includes(goal.department):!goal.department));
      if(goalsInScope.length===1)goals[indicator]=goalsInScope[0].value;
    }
    const projected=calendar.factor==null?null:actual.revenue*calendar.factor;
    return {code:Number(code),name:person.name||'RCA '+code,supervisor:person.supervisor||'Sem supervisor',active:person.active===true,...actual,goals,
      attainment:goals.revenue?actual.revenue/goals.revenue*100:null,projected,projectedAttainment:goals.revenue&&projected!=null?projected/goals.revenue*100:null};
  });
  const result={ok:true,rows,summary:teamsMetrics_(overall,canMargin),calendar,canMargin,
    goalScopeLimited:Boolean(ufs.length||city.length||region.length),updatedAt:new Date().toISOString(),baseUpdatedAt:version};
  centralCacheWrite_(cache,key,JSON.stringify(result),180);
  return result;
}
