/* Rebanho Supervisão Web — processamento das bases fora da thread principal. */
importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');

let SALES = [];
let METAS = [];
let RCAS = [];
let CLIENTS = new Map();
let RCA_BY_CODE = new Map();
let CLIENT_HISTORY = new Map();
let LATEST_DATE = null;

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
    const d=XLSX.SSF.parse_date_code(v);
    if(d) return new Date(d.y,d.m-1,d.d);
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
function sheet(wb, wanted){
  const name=wb.SheetNames.find(n=>norm(n)===norm(wanted));
  return name ? wb.Sheets[name] : null;
}
function readSheet(wb, wanted){
  const ws=sheet(wb,wanted);
  if(!ws) return [];
  const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});
  let header=0;
  for(let i=0;i<Math.min(matrix.length,10);i++){
    const set=new Set((matrix[i]||[]).map(x=>String(x??'').trim()));
    if(set.has('Data Faturamento') || set.has('COD_RCA') || set.has('CODCLI')) { header=i; break; }
  }
  return XLSX.utils.sheet_to_json(ws,{range:header,defval:null,raw:true});
}
async function getWorkbook(kind){
  const res=await fetch(`/api/file?kind=${kind}&t=${Date.now()}`,{credentials:'include'});
  if(!res.ok) throw new Error(await res.text() || 'Falha ao carregar base');
  const buf=await res.arrayBuffer();
  return XLSX.read(buf,{type:'array',cellDates:true});
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
    CLIENT_HISTORY.get(s.client).push({date:s.date, value:s.value, rca:s.rca});
  }
  for(const arr of CLIENT_HISTORY.values()) arr.sort((a,b)=>a.date-b.date);
}

async function init(){
  try{
    postStage('Baixando base de vendedores e metas…',8);
    const aux=await getWorkbook('aux');
    postStage('Lendo estrutura comercial…',18);
    const rcaRows=readSheet(aux,'RCA');
    RCAS=rcaRows.map(r=>({
      code:code(r.COD_RCA ?? r['Cod/Vend.']),
      name:String(r.RCA ?? r.VENDEDOR ?? '').trim(),
      supervisor:String(r.SUPERVISOR ?? '').trim(),
      active:norm(r.ATIVO ?? 'S')==='S'
    })).filter(r=>r.code!=null && r.name);
    RCA_BY_CODE=new Map(RCAS.map(r=>[r.code,r]));

    const clientRows=readSheet(aux,'CLIENTES');
    CLIENTS=new Map();
    for(const r of clientRows){
      const c=code(r.CODCLI ?? r['Cod/Cliente'] ?? r.COD_CLIENTE);
      if(c==null) continue;
      CLIENTS.set(c,{
        code:c,
        name:String(r.CLIENTE ?? r.NOME ?? r['Nome Cliente'] ?? c).trim(),
        rca:code(r.COD_RCA ?? r['Cod/Vend.'])
      });
    }

    const metaRows=readSheet(aux,'METAS');
    METAS=metaRows.map(r=>{
      const codRca=code(r.COD_RCA ?? r['Cod/Vend.']);
      const mk=monthKeyFrom(r.MES ?? r.MÊS ?? r.DATA);
      const rr=RCA_BY_CODE.get(codRca)||{};
      return {
        monthKey:mk,
        year:mk?Number(mk.slice(0,4)):null,
        month:mk?Number(mk.slice(5,7)):null,
        rca:codRca,
        rcaName:rr.name||String(r.RCA??''),
        supervisor:rr.supervisor||String(r.SUPERVISOR??''),
        department:String(r.DEPARTAMENTO ?? r.DEPTO ?? '').trim(),
        value:num(r.META)
      };
    }).filter(x=>x.year && x.month && x.rca!=null);

    postStage('Baixando faturamento…',28);
    const vendas=await getWorkbook('vendas');
    postStage('Processando faturamento…',45);
    const ws=vendas.Sheets[vendas.SheetNames.find(n=>norm(n)==='SHEET1') || vendas.SheetNames[0]];
    const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});
    let header=0;
    for(let i=0;i<Math.min(matrix.length,10);i++){
      const vals=new Set((matrix[i]||[]).map(x=>String(x??'').trim()));
      if(vals.has('Data Faturamento') && vals.has('Pedidos Enviados')) {header=i;break;}
    }
    const rows=XLSX.utils.sheet_to_json(ws,{range:header,defval:null,raw:true});
    SALES=[];
    let maxDate=null;
    for(const r of rows){
      const date=parseDate(r['Data Faturamento']);
      if(!date || norm(r['Posição'])!=='FECHADO') continue;
      const codRca=code(r['Cod/Vend.']);
      const rr=RCA_BY_CODE.get(codRca)||{};
      const prod=code(r['Cod/Produto']);
      const value=num(r['Pedidos Enviados']);
      const margin=num(r['% Margem']);
      const row={
        date,
        year:date.getFullYear(),
        month:date.getMonth()+1,
        monthKey:formatMonthKey(date),
        rca:codRca,
        rcaName:rr.name||String(r.RCA??codRca??''),
        supervisor:rr.supervisor||String(r.SUPERVISOR??''),
        department:String(r.DEPARTAMENTO??'').trim(),
        client:code(r['Cod/Cliente']),
        product:prod,
        productName:productLabel(r['Cod/Produto']),
        order:String(r.NUMPED ?? '').trim(),
        city:String(r.MUNICENT??'').trim(),
        uf:norm(r.ESTENT??''),
        value,
        marginPct:Number.isFinite(margin)?margin:null
      };
      SALES.push(row);
      if(!maxDate || date>maxDate) maxDate=date;
    }
    LATEST_DATE=maxDate;
    buildHistory();

    const years=[...new Set(SALES.map(s=>s.year))].sort((a,b)=>b-a);
    const departments=[...new Set(SALES.map(s=>s.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const supervisors=[...new Set(RCAS.filter(r=>r.active).map(r=>r.supervisor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const activeRcas=RCAS.filter(r=>r.active).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));

    postStage('Base pronta.',100);
    postMessage({
      type:'ready',
      dimensions:{
        years,departments,supervisors,
        rcas:activeRcas,
        latest:LATEST_DATE?LATEST_DATE.toISOString():null
      }
    });
  }catch(err){
    postMessage({type:'error',message:err?.message||String(err)});
  }
}

function allowedRca(filters){
  const active=RCAS.filter(r=>r.active);
  return new Set(active.filter(r=>{
    if(filters.supervisor && filters.supervisor!=='Todos' && r.supervisor!==filters.supervisor) return false;
    if(filters.rca && filters.rca!=='Todos' && String(r.code)!==String(filters.rca)) return false;
    return true;
  }).map(r=>r.code));
}
function filterSales(filters,{ignoreMonth=false, city=null}={}){
  const allowed=allowedRca(filters);
  return SALES.filter(s=>{
    if(!allowed.has(s.rca)) return false;
    if(filters.year && filters.year!=='Todos' && s.year!==Number(filters.year)) return false;
    if(!ignoreMonth && filters.month && filters.month!=='Todos' && s.month!==Number(filters.month)) return false;
    if(filters.department && filters.department!=='Todos' && s.department!==filters.department) return false;
    if(city && norm(s.city)!==norm(city)) return false;
    return true;
  });
}
function filterMetas(filters,{ignoreMonth=false}={}){
  const allowed=allowedRca(filters);
  return METAS.filter(m=>{
    if(!allowed.has(m.rca)) return false;
    if(filters.year && filters.year!=='Todos' && m.year!==Number(filters.year)) return false;
    if(!ignoreMonth && filters.month && filters.month!=='Todos' && m.month!==Number(filters.month)) return false;
    if(filters.department && filters.department!=='Todos' && m.department && m.department!==filters.department) return false;
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
  const inactive=[];
  const by=new Map();
  let short=0,long=0;
  for(const [client,hist] of CLIENT_HISTORY){
    const reg=CLIENTS.get(client);
    const owner=reg?.rca ?? hist[hist.length-1]?.rca;
    if(!allowed.has(owner))continue;
    let last=null,rev12=0;
    for(const h of hist){
      if(h.date<=cutoff) last=h.date;
      if(h.date>=lim12 && h.date<=cutoff)rev12+=h.value;
    }
    if(!last)continue;
    const isShort=last<=lim3 && last>=lim6;
    const isLong=last<=lim3 && last>=lim12;
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
  return {kpis:{...k,newClients,short,long,cutoff:cutoff.toISOString()},byRca:[...by.values()].sort((a,b)=>b.long-a.long),inactive:inactive.slice(0,120)};
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
  if(msg.type==='init') return init();
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
