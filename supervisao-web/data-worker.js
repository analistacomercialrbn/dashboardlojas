/* Rebanho Supervisão Web — processamento das bases fora da thread principal. */
let SALES = [];
let METAS = [];
let RCAS = [];
let CLIENTS = new Map();
let RCA_BY_CODE = new Map();
let CLIENT_HISTORY = new Map();
let LATEST_DATE = null;
let FORCE_REFRESH = false;
let SERVER_UPDATED_AT = null;


function secs(ms){return (ms/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'s';}
function now(){return performance.now();}
const CACHE_DB = 'rbn-supervisao-cache';
const CACHE_STORE = 'snapshots';
const CACHE_KEY = 'server-normalized-v1';
const LOCAL_CACHE_FALLBACK_MS = 12 * 60 * 60 * 1000;

function openCacheDb(){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined') return resolve(null);
    const req=indexedDB.open(CACHE_DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(CACHE_STORE))db.createObjectStore(CACHE_STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function loadLocalCache(){
  try{
    const db=await openCacheDb(); if(!db)return null;
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(CACHE_STORE,'readonly');
      const req=tx.objectStore(CACHE_STORE).get(CACHE_KEY);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }catch{return null}
}
async function saveLocalCache(){
  try{
    const db=await openCacheDb(); if(!db)return;
    const snapshot={
      savedAt:Date.now(),
      serverUpdatedAt:SERVER_UPDATED_AT,
      sales:SALES,
      metas:METAS,
      rcas:RCAS,
      clients:[...CLIENTS.entries()],
      latest:LATEST_DATE
    };
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(CACHE_STORE,'readwrite');
      tx.objectStore(CACHE_STORE).put(snapshot,CACHE_KEY);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }catch(err){console.warn('Falha ao persistir a cópia local do dashboard:',err?.name||'erro')}
}
function restoreLocalCache(snapshot){
  SERVER_UPDATED_AT=snapshot?.serverUpdatedAt||null;
  SALES=Array.isArray(snapshot?.sales)?snapshot.sales:[];
  METAS=Array.isArray(snapshot?.metas)?snapshot.metas:[];
  RCAS=Array.isArray(snapshot?.rcas)?snapshot.rcas:[];
  CLIENTS=new Map(Array.isArray(snapshot?.clients)?snapshot.clients:[]);
  RCA_BY_CODE=new Map(RCAS.map(r=>[r.code,r]));
  LATEST_DATE=snapshot?.latest?new Date(snapshot.latest):null;
  buildHistory();
}
function emitReady(){
  const years=[...new Set(SALES.map(s=>s.year))].sort((a,b)=>b-a);
  const departments=[...new Set(SALES.map(s=>s.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const supervisors=[...new Set(RCAS.filter(r=>r.active).map(r=>r.supervisor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const activeRcas=RCAS.filter(r=>r.active).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  postStage('Base pronta.',100);
  postMessage({type:'ready',dimensions:{years,departments,supervisors,rcas:activeRcas,latest:LATEST_DATE?LATEST_DATE.toISOString():null}});
}

const MONTHS = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function postStage(text, progress=0){ postMessage({type:'stage', text, progress}); }
function norm(v){
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
}
function num(v){
  if(v === null || v === undefined || v === '') return 0;
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s=String(v).trim();
  if(!s) return 0;
  if(s.includes(',') && s.includes('.')) s=s.replace(/\./g,'').replace(',','.');
  else if(s.includes(',')) s=s.replace(',','.');
  const n=Number(s.replace(/[^0-9.-]/g,''));
  return Number.isFinite(n)?n:0;
}
function code(v){
  const m=String(v ?? '').match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
function parseDate(v){
  if(v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if(typeof v === 'number'){
    const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);
    return Number.isNaN(d.getTime())?null:new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  }
  if(!v) return null;
  const s=String(v).trim();
  let m=s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if(m) return new Date(+m[1],+m[2]-1,+m[3]);
  m=s.match(/^(\d{1,2})[\/](-?\d{1,2})[\/](\d{4})/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1]);
  const d=new Date(s);
  return Number.isNaN(d.getTime())?null:d;
}
function monthKeyFrom(v){
  const d=parseDate(v);
  if(d) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const s=String(v ?? '');
  const m=s.match(/(20\d{2})[^0-9]?(0?[1-9]|1[0-2])/);
  return m ? `${m[1]}-${String(+m[2]).padStart(2,'0')}` : '';
}
function productLabel(v){
  const s=String(v ?? '').trim();
  const name=s.replace(/^\s*\d+\s*-\s*/,'').trim();
  return name || (code(v)!=null ? `Produto ${code(v)}` : 'Sem descrição');
}
function addSet(map,key,val){
  if(!map.has(key)) map.set(key,new Set());
  if(val!==null && val!==undefined) map.get(key).add(val);
}
function formatMonthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

function buildHistory(){
  CLIENT_HISTORY=new Map();
  for(const s of SALES){
    if(s.client==null) continue;
    if(!CLIENT_HISTORY.has(s.client)) CLIENT_HISTORY.set(s.client,[]);
    CLIENT_HISTORY.get(s.client).push({date:s.date, value:s.value, rca:s.rca, department:s.department});
  }
  for(const arr of CLIENT_HISTORY.values()) arr.sort((a,b)=>a.date-b.date);
}

async function fetchServerDatasetInfo(){
  const res=await fetch('/api/dataset/info',{credentials:'include',cache:'no-store'});
  if(res.status===404)return null;
  if(!res.ok){const err=new Error(await res.text()||'Falha ao verificar a versão do snapshot.');err.status=res.status;throw err;}
  return res.json();
}

async function fetchServerDataset(force){
  if(force){
    postStage('Atualizando as bases no servidor…',10);
    const build=await fetch('/api/rebuild?refresh=1',{method:'POST',credentials:'include',cache:'no-store'});
    let result=null;try{result=await build.json()}catch{}
    if(!build.ok)throw new Error(result?.message||'O servidor não conseguiu atualizar as bases.');
    postStage('Bases processadas no servidor. Baixando dados preparados…',35);
  }
  let res=await fetch('/api/dataset',{credentials:'include',cache:'no-store'});
  if(res.status===404&&!force){
    postStage('Preparando a base comercial no servidor…',15);
    const build=await fetch('/api/rebuild',{method:'POST',credentials:'include',cache:'no-store'});
    let result=null;try{result=await build.json()}catch{}
    if(!build.ok)throw new Error(result?.message||'O servidor não conseguiu preparar as bases.');
    res=await fetch('/api/dataset',{credentials:'include',cache:'no-store'});
  }
  if(!res.ok)throw new Error(await res.text()||'Falha ao carregar a base preparada.');
  SERVER_UPDATED_AT=res.headers.get('x-dataset-updated-at')||null;
  const reader=res.body.getReader(),decoder=new TextDecoder();let pending='',count=0,expectedCount=null;
  SALES=[];METAS=[];RCAS=[];CLIENTS=new Map();LATEST_DATE=null;
  const consume=line=>{
    if(!line)return;
    const item=JSON.parse(line),v=item.value;
    if(item.type==='meta'){LATEST_DATE=v.latest?new Date(v.latest):null;expectedCount=Number(v.validCount)||0;}
    else if(item.type==='rca')RCAS.push(v);
    else if(item.type==='goal')METAS.push(v);
    else if(item.type==='client')CLIENTS.set(v[0],v[1]);
    else if(item.type==='sale'){v.date=new Date(v.date);SALES.push(v);count++}
    if(count&&count%25000===0)postStage('Recebendo dados preparados… '+count.toLocaleString('pt-BR')+' linhas',45+Math.min(45,count/200000*45));
  };
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    pending+=decoder.decode(value,{stream:true});
    const lines=pending.split('\n');pending=lines.pop()||'';
    for(const line of lines)consume(line);
  }
  pending+=decoder.decode();
  if(pending.trim())consume(pending);
  if(!SALES.length)throw new Error('A base preparada não contém vendas fechadas.');
  if(expectedCount&&SALES.length!==expectedCount)throw new Error('A base preparada chegou incompleta ('+SALES.length.toLocaleString('pt-BR')+' de '+expectedCount.toLocaleString('pt-BR')+' vendas). Tente atualizar novamente.');
  RCA_BY_CODE=new Map(RCAS.map(r=>[r.code,r]));
}
async function init(){
  try{
    if(!FORCE_REFRESH){
      postStage('Abrindo base local…',4);
      const cached=await loadLocalCache();
      postStage('Conferindo atualização do servidor…',6);
      let info=null;
      try{info=await fetchServerDatasetInfo();}
      catch(err){
        const cacheAge=Date.now()-Number(cached?.savedAt||0);
        if(cached?.sales?.length&&cacheAge<LOCAL_CACHE_FALLBACK_MS&&(!err.status||err.status>=500)){
          restoreLocalCache(cached);emitReady();return;
        }
        throw err;
      }
      if(cached?.sales?.length){
        const cacheAge=Date.now()-Number(cached.savedAt||0);
        const matchesServer=!!info?.updatedAt&&cached.serverUpdatedAt===info.updatedAt;
        const recentFallback=!info&&cacheAge<LOCAL_CACHE_FALLBACK_MS;
        if(matchesServer||recentFallback){restoreLocalCache(cached);emitReady();return;}
      }
    }
    postStage('Conectando ao serviço de dados…',8);
    await fetchServerDataset(FORCE_REFRESH);
    postStage(SALES.length.toLocaleString('pt-BR')+' linhas preparadas recebidas. Montando histórico…',93);
    const tHist=now();buildHistory();
    postStage('Histórico comercial montado em '+secs(now()-tHist)+'.',98);
    emitReady();saveLocalCache();
  }catch(err){postMessage({type:'error',message:err?.message||String(err)})}
}

function multi(v){
  if(Array.isArray(v))return v.map(String).filter(x=>x&&x!=='Todos');
  if(v===null||v===undefined||v===''||v==='Todos')return [];
  return [String(v)];
}
function allowedRca(filters){
  const active=RCAS.filter(r=>r.active);
  const supervisors=multi(filters.supervisor);
  const rcas=multi(filters.rca);
  return new Set(active.filter(r=>{
    if(supervisors.length && !supervisors.includes(String(r.supervisor))) return false;
    if(rcas.length && !rcas.includes(String(r.code))) return false;
    return true;
  }).map(r=>r.code));
}
function filterSales(filters,{ignoreMonth=false, city=null}={}){
  const allowed=allowedRca(filters);
  const departments=multi(filters.department);
  const targetYear=filters.year && filters.year!=='Todos'?Number(filters.year):null;
  const targetMonth=!ignoreMonth && filters.month && filters.month!=='Todos'?Number(filters.month):null;
  const targetCity=city?norm(city):null;
  return SALES.filter(s=>{
    if(!allowed.has(s.rca)) return false;
    if(targetYear!==null && s.year!==targetYear) return false;
    if(targetMonth!==null && s.month!==targetMonth) return false;
    if(departments.length && !departments.includes(String(s.department))) return false;
    if(targetCity && norm(s.city)!==targetCity) return false;
    return true;
  });
}
function filterMetas(filters,{ignoreMonth=false}={}){
  const allowed=allowedRca(filters);
  const departments=multi(filters.department);
  const targetYear=filters.year && filters.year!=='Todos'?Number(filters.year):null;
  const targetMonth=!ignoreMonth && filters.month && filters.month!=='Todos'?Number(filters.month):null;
  return METAS.filter(m=>{
    if(!allowed.has(m.rca)) return false;
    if(targetYear!==null && m.year!==targetYear) return false;
    if(targetMonth!==null && m.month!==targetMonth) return false;
    if(departments.length && m.department && !departments.includes(String(m.department))) return false;
    return true;
  });
}
function metrics(rows){
  const clients=new Set(),orders=new Set(),products=new Set();
  const byClient=new Map();
  let revenue=0, marginNum=0, marginBase=0;
  for(const s of rows){
    revenue+=s.value;
    if(s.client!=null){clients.add(s.client);addSet(byClient,s.client,s.product);}
    if(s.order) orders.add(s.order);
    if(s.product!=null) products.add(s.product);
    if(Number.isFinite(s.marginPct)){marginNum+=s.value*s.marginPct;marginBase+=s.value;}
  }
  let mix=0;
  if(byClient.size) mix=[...byClient.values()].reduce((a,set)=>a+set.size,0)/byClient.size;
  return {
    revenue,clients:clients.size,orders:orders.size,products:products.size,mix,
    ticket:orders.size?revenue/orders.size:0,
    margin:marginBase?marginNum/marginBase:null
  };
}
function totalMeta(rows){return rows.reduce((a,x)=>a+x.value,0)}
function groupRevenue(rows,keyFn){
  const m=new Map();
  for(const s of rows){
    const k=keyFn(s);
    if(!m.has(k)) m.set(k,{key:k,revenue:0,clients:new Set(),orders:new Set(),products:new Set()});
    const g=m.get(k);g.revenue+=s.value;
    if(s.client!=null)g.clients.add(s.client);if(s.order)g.orders.add(s.order);if(s.product!=null)g.products.add(s.product);
  }
  return [...m.values()].map(g=>({key:g.key,revenue:g.revenue,clients:g.clients.size,orders:g.orders.size,products:g.products.size}));
}
function monthSeries(rows){
  const g=groupRevenue(rows,s=>s.month);
  return g.sort((a,b)=>a.key-b.key).map(x=>({month:x.key,label:MONTHS[x.key],revenue:x.revenue,clients:x.clients,orders:x.orders}));
}
function previousFilters(filters){
  if(!filters.year || filters.year==='Todos' || !filters.month || filters.month==='Todos') return null;
  let y=Number(filters.year),m=Number(filters.month)-1;if(m===0){m=12;y--}
  return {...filters,year:y,month:m};
}
function compactInsights(filters,rows){
  const out=[];
  const pf=previousFilters(filters);
  if(pf){
    const prev=filterSales(pf);
    const now=metrics(rows),before=metrics(prev);
    if(before.revenue>0){
      const v=(now.revenue/before.revenue-1)*100;
      if(v<0)out.push({level:v<=-10?'critical':'attention',title:'Queda do faturamento',value:v,text:'versus mês anterior'});
      else if(v>5)out.push({level:'opportunity',title:'Crescimento do faturamento',value:v,text:'versus mês anterior'});
    }
  }
  const rcaGroups=groupRevenue(rows,s=>s.rca).sort((a,b)=>a.revenue-b.revenue);
  if(rcaGroups.length>1){
    const low=rcaGroups[0], rr=RCA_BY_CODE.get(low.key)||{};
    out.push({level:'attention',title:'Menor faturamento por RCA',value:low.revenue,text:rr.name||String(low.key),kind:'money'});
  }
  const dep=groupRevenue(rows,s=>s.department).sort((a,b)=>b.revenue-a.revenue);
  const total=rows.reduce((a,s)=>a+s.value,0);
  if(dep.length && total){
    const share=dep[0].revenue/total*100;
    if(share>=45)out.push({level:'attention',title:'Concentração por departamento',value:share,text:dep[0].key,kind:'percent'});
  }
  return out.slice(0,4);
}
function overview(filters){
  const rows=filterSales(filters);
  const yearRows=filterSales(filters,{ignoreMonth:true});
  const k=metrics(rows);
  const meta=totalMeta(filterMetas(filters));
  const rca=groupRevenue(rows,s=>s.rca).map(x=>({...x,name:(RCA_BY_CODE.get(x.key)||{}).name||String(x.key)})).sort((a,b)=>b.revenue-a.revenue);
  const departments=groupRevenue(rows,s=>s.department).sort((a,b)=>b.revenue-a.revenue);
  return {kpis:{...k,meta,attainment:meta?k.revenue/meta*100:null},monthly:monthSeries(yearRows),rca,departments,insights:compactInsights(filters,rows)};
}
function carteira(filters){
  const rows=filterSales(filters);
  const k=metrics(rows);
  const cutoff=rows.length?new Date(Math.max(...rows.map(s=>s.date.getTime()))):LATEST_DATE;
  if(!cutoff)return {kpis:{...k,newClients:0,short:0,long:0},byRca:[],inactive:[]};
  const lim3=new Date(cutoff);lim3.setMonth(lim3.getMonth()-3);
  const lim6=new Date(cutoff);lim6.setMonth(lim6.getMonth()-6);
  const lim12=new Date(cutoff);lim12.setMonth(lim12.getMonth()-12);
  const allowed=allowedRca(filters);
  const departments=multi(filters.department);
  const inactive=[];
  const by=new Map();
  let short=0,long=0;
  for(const [client,hist] of CLIENT_HISTORY){
    const reg=CLIENTS.get(client);
    const owner=reg?.rca ?? hist[hist.length-1]?.rca;
    if(!allowed.has(owner))continue;
    const scopedHist=departments.length?hist.filter(h=>departments.includes(String(h.department))):hist;
    if(!scopedHist.length)continue;
    let last=null,rev12=0;
    for(const h of scopedHist){
      if(h.date<=cutoff) last=h.date;
      if(h.date>=lim12 && h.date<=cutoff)rev12+=h.value;
    }
    if(!last)continue;
    const isShort=last<=lim3 && last>lim6;
    const isLong=last<=lim6 && last>=lim12;
    if(!isShort && !isLong)continue;
    const days=Math.floor((cutoff-last)/86400000);
    if(isShort)short++;if(isLong)long++;
    const rr=RCA_BY_CODE.get(owner)||{};
    if(!by.has(owner))by.set(owner,{rca:owner,name:rr.name||String(owner),short:0,long:0});
    if(isShort)by.get(owner).short++;if(isLong)by.get(owner).long++;
    inactive.push({client,name:reg?.name||String(client),rca:owner,rcaName:rr.name||String(owner),last:last.toISOString(),days,revenue12:rev12,isShort,isLong});
  }
  const periodClients=new Set(rows.map(s=>s.client).filter(x=>x!=null));
  let newClients=0;
  for(const cli of periodClients){
    const hist=CLIENT_HISTORY.get(cli)||[];
    if(!hist.length)continue;
    const first=hist[0].date;
    if(filters.year!=='Todos' && first.getFullYear()!==Number(filters.year))continue;
    if(filters.month!=='Todos' && first.getMonth()+1!==Number(filters.month))continue;
    newClients++;
  }
  inactive.sort((a,b)=>b.revenue12-a.revenue12);
  return {kpis:{...k,newClients,short,long,cutoff:cutoff.toISOString()},byRca:[...by.values()].sort((a,b)=>(b.short+b.long)-(a.short+a.long)),inactive:inactive.slice(0,120)};
}
function produtos(filters){
  const rows=filterSales(filters);
  const byProd=new Map();
  const byRca=new Map();
  for(const s of rows){
    if(s.product==null)continue;
    if(!byProd.has(s.product))byProd.set(s.product,{code:s.product,name:s.productName,revenue:0,clients:new Set(),orders:new Set(),rcas:new Set()});
    const p=byProd.get(s.product);p.revenue+=s.value;if(s.client!=null)p.clients.add(s.client);if(s.order)p.orders.add(s.order);if(s.rca!=null)p.rcas.add(s.rca);
    if(!byRca.has(s.rca))byRca.set(s.rca,new Map());
    const rm=byRca.get(s.rca);
    if(!rm.has(s.product))rm.set(s.product,{code:s.product,name:s.productName,revenue:0});
    rm.get(s.product).revenue+=s.value;
  }
  const arr=[...byProd.values()].map(p=>({code:p.code,name:p.name,revenue:p.revenue,clients:p.clients.size,orders:p.orders.size,rcas:p.rcas.size}));
  const top=[...arr].sort((a,b)=>b.revenue-a.revenue).slice(0,10);
  const bottom=[...arr].filter(x=>x.revenue>0).sort((a,b)=>a.revenue-b.revenue).slice(0,10);
  const top2=[];
  for(const [rca,map] of byRca){
    const rr=RCA_BY_CODE.get(rca)||{};
    const list=[...map.values()].sort((a,b)=>b.revenue-a.revenue);
    const total=list.reduce((a,x)=>a+x.revenue,0), first=list[0],second=list[1];
    if(first)top2.push({rca,name:rr.name||String(rca),first,second:second||null,share:total?((first.revenue+(second?.revenue||0))/total*100):0,total});
  }
  top2.sort((a,b)=>b.total-a.total);
  return {kpis:{products:arr.length,clients:new Set(rows.map(s=>s.client).filter(x=>x!=null)).size},top,bottom,top2};
}
function cidades(filters, selectedCity=null){
  const rows=filterSales(filters);
  const cityMap=new Map();
  for(const s of rows){
    if(!s.city)continue;
    const key=`${norm(s.city)}|${s.uf}`;
    if(!cityMap.has(key))cityMap.set(key,{key,city:s.city,uf:s.uf,revenue:0,clients:new Set(),orders:new Set(),products:new Set()});
    const c=cityMap.get(key);c.revenue+=s.value;if(s.client!=null)c.clients.add(s.client);if(s.order)c.orders.add(s.order);if(s.product!=null)c.products.add(s.product);
  }
  const list=[...cityMap.values()].map(c=>({key:c.key,city:c.city,uf:c.uf,revenue:c.revenue,clients:c.clients.size,orders:c.orders.size,products:c.products.size})).sort((a,b)=>b.revenue-a.revenue);
  const chosen=selectedCity && selectedCity!=='Todos' ? list.find(c=>c.key===selectedCity) : null;
  const focus=chosen?filterSales(filters,{city:chosen.city}):rows;
  const yearFocus=chosen?filterSales(filters,{ignoreMonth:true,city:chosen.city}):filterSales(filters,{ignoreMonth:true});
  const p=produtosForRows(focus);
  const cli=clientRanking(focus);
  const insights=cityInsights(filters,list,chosen);
  return {cities:list,selected:chosen,monthly:monthSeries(yearFocus),products:p.slice(0,12),clients:cli.slice(0,20),insights};
}
function produtosForRows(rows){
  const m=new Map();
  for(const s of rows){
    if(s.product==null)continue;
    if(!m.has(s.product))m.set(s.product,{code:s.product,name:s.productName,revenue:0,clients:new Set(),orders:new Set()});
    const x=m.get(s.product);x.revenue+=s.value;if(s.client!=null)x.clients.add(s.client);if(s.order)x.orders.add(s.order);
  }
  return [...m.values()].map(x=>({...x,clients:x.clients.size,orders:x.orders.size})).sort((a,b)=>b.revenue-a.revenue);
}
function clientRanking(rows){
  const m=new Map();
  for(const s of rows){
    if(s.client==null)continue;
    if(!m.has(s.client))m.set(s.client,{code:s.client,name:CLIENTS.get(s.client)?.name||String(s.client),revenue:0,orders:new Set(),products:new Set()});
    const x=m.get(s.client);x.revenue+=s.value;if(s.order)x.orders.add(s.order);if(s.product!=null)x.products.add(s.product);
  }
  return [...m.values()].map(x=>({...x,orders:x.orders.size,products:x.products.size})).sort((a,b)=>b.revenue-a.revenue);
}
function cityInsights(filters,list,chosen){
  const out=[];
  if(!chosen && list.length>1){
    const low=[...list].filter(x=>x.revenue>0).sort((a,b)=>a.revenue-b.revenue)[0];
    if(low)out.push({level:'attention',title:'Menor faturamento por cidade',value:low.revenue,text:`${low.city} - ${low.uf}`,kind:'money'});
  }
  const pf=previousFilters(filters);
  if(pf){
    const prev=cidadesSimple(pf);
    const prevMap=new Map(prev.map(x=>[x.key,x]));
    const candidates=(chosen?[chosen]:list).map(c=>{
      const p=prevMap.get(c.key);return p&&p.revenue>0?{...c,variation:(c.revenue/p.revenue-1)*100,prev:p.revenue}:null
    }).filter(Boolean).sort((a,b)=>a.variation-b.variation);
    if(candidates.length&&candidates[0].variation<0){
      const x=candidates[0];out.push({level:x.variation<=-20?'critical':'attention',title:chosen?'Queda da cidade':'Cidade com maior queda',value:x.variation,text:`${x.city} - ${x.uf}`,kind:'percent',foot:`${x.prev}|${x.revenue}`});
    }
  }
  const focus=chosen?filterSales(filters,{city:chosen.city}):filterSales(filters);
  const prod=produtosForRows(focus);
  const prevF=previousFilters(filters);
  if(prevF && prod.length){
    const prevProd=produtosForRows(chosen?filterSales(prevF,{city:chosen.city}):filterSales(prevF));
    const pm=new Map(prevProd.map(x=>[x.code,x]));
    const drops=prod.map(x=>{const p=pm.get(x.code);return p&&p.revenue>0?{...x,var:(x.revenue/p.revenue-1)*100,prev:p.revenue}:null}).filter(Boolean).sort((a,b)=>a.var-b.var);
    if(drops.length&&drops[0].var<0){const x=drops[0];out.push({level:x.var<=-25?'critical':'attention',title:'Produto em queda',value:x.var,text:x.name,kind:'percent'});}
  }
  return out.slice(0,4);
}
function cidadesSimple(filters){
  const rows=filterSales(filters),m=new Map();
  for(const s of rows){
    if(!s.city)continue;const key=`${norm(s.city)}|${s.uf}`;
    if(!m.has(key))m.set(key,{key,city:s.city,uf:s.uf,revenue:0});m.get(key).revenue+=s.value;
  }
  return [...m.values()];
}
function metasPage(filters){
  const rows=filterSales(filters,{ignoreMonth:true});
  const metas=filterMetas(filters,{ignoreMonth:true});
  const revMonths=monthSeries(rows);
  const metaByMonth=new Map();
  for(const m of metas)metaByMonth.set(m.month,(metaByMonth.get(m.month)||0)+m.value);
  const monthly=Array.from({length:12},(_,i)=>({month:i+1,label:MONTHS[i+1],revenue:revMonths.find(x=>x.month===i+1)?.revenue||0,meta:metaByMonth.get(i+1)||0}));
  const supMap=new Map();
  for(const m of metas){
    const k=m.supervisor||'Sem supervisor';supMap.set(k,(supMap.get(k)||0)+m.value);
  }
  return {monthly,supervisors:[...supMap].map(([name,meta])=>({name,meta})).sort((a,b)=>b.meta-a.meta),totalMeta:[...metaByMonth.values()].reduce((a,b)=>a+b,0),totalRevenue:rows.reduce((a,s)=>a+s.value,0)};
}

onmessage=async(e)=>{
  const msg=e.data||{};
  if(msg.type==='init'){FORCE_REFRESH=!!msg.force;return init();}
  if(msg.type==='query'){
    try{
      const f=msg.filters||{};
      let payload;
      if(msg.page==='overview')payload=overview(f);
      else if(msg.page==='carteira')payload=carteira(f);
      else if(msg.page==='produtos')payload=produtos(f);
      else if(msg.page==='cidades')payload=cidades(f,msg.selectedCity);
      else if(msg.page==='metas')payload=metasPage(f);
      else payload={};
      postMessage({type:'result',requestId:msg.requestId,page:msg.page,payload});
    }catch(err){postMessage({type:'queryError',requestId:msg.requestId,message:err?.message||String(err)});}
  }
};
