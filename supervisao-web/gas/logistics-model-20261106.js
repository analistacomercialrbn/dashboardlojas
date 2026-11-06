function logAwaitingFormation(r){return r.awaitingFormation===true;}
function logPlanningRows(rows,kind=LOG.kind){return kind==='transport'?rows.filter(r=>!r.delivered):rows.filter(logAwaitingFormation);}
function logInvoiceParts(value){
 const s=normalize(String(value||'')).replace(/\b(NF-E|NFE|NOTA FISCAL|NF)\b/g,'').trim();
 if(!s)return [];
 const parts=s.split(/\s*[,;\n+]\s*/).filter(Boolean),out=[];
 for(const p of parts){const m=p.match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m||Number(m[1])<=0)return [];out.push({number:String(Number(m[1])),series:m[2]==null?'':String(Number(m[2]))});}
 return out;
}
function logDeliveryConsolidation(operations,transport){
 // Agrupa produtos da mesma NF. Série, ano, cliente e cidade impedem fusões indevidas.
 const nodes=[],unidentified={operations:0,transport:0};
 for(const [kind,rows] of [['operations',operations],['transport',transport]]){
  const grouped=new Map();
  for(const r of rows){const parts=logInvoiceParts(r.invoice),year=String(r.issued||r.date||'').slice(0,4),client=normalize(r.client),city=normalize(r.city||r.cityLabel),uf=normalize(r.uf);if(!parts.length||!year||!client){if(r.delivered)unidentified[kind]++;continue;}
   for(const p of parts){const id=[p.number,p.series,year,client,city,uf].join('|');let n=grouped.get(id);if(!n){n={kind,...p,year,client,city,uf,delivered:false,rows:0};grouped.set(id,n);}n.delivered=n.delivered||!!r.delivered;n.rows++;}
  }
  nodes.push(...grouped.values());
 }
 const ops=nodes.filter(n=>n.kind==='operations'),trs=nodes.filter(n=>n.kind==='transport'),used=new Set();let shared=0,conflicts=0,delivered=0;const uncertain=new Set();
 const sameInvoice=(a,b)=>a.number===b.number&&a.year===b.year&&(!a.series||!b.series||a.series===b.series);
 const sameParty=(a,b)=>a.client===b.client&&(!a.city||!b.city||a.city===b.city)&&(!a.uf||!b.uf||a.uf===b.uf);
 for(const group of [ops,trs])for(const n of group)if(group.some(o=>o!==n&&sameInvoice(n,o))){uncertain.add(n);}
 for(const a of ops){const possible=trs.filter(b=>sameInvoice(a,b));const candidates=possible.filter(b=>sameParty(a,b));
  if(uncertain.has(a)){possible.forEach(b=>uncertain.add(b));continue;}
  if(candidates.length===1&&!uncertain.has(candidates[0])&&ops.filter(o=>sameInvoice(o,candidates[0])&&sameParty(o,candidates[0])).length===1){const b=candidates[0];used.add(b);shared++;if(a.delivered!==b.delivered)conflicts++;if(a.delivered||b.delivered)delivered++;}
  else if(possible.length){uncertain.add(a);possible.forEach(b=>uncertain.add(b));}
  else if(a.delivered)delivered++;
 }
 for(const b of trs)if(!used.has(b)&&!uncertain.has(b)&&b.delivered)delivered++;
 return {delivered,shared,conflicts,ambiguous:uncertain.size,unidentified,operationNotes:ops.length,transportNotes:trs.length};
}
function logOverviewModel(operations,transport,scope='all'){
 const ops=scope==='transport'?[]:operations,trs=scope==='formation'?[]:transport,waiting=ops.filter(logAwaitingFormation),inRoute=ops.filter(r=>r.inRoute),done=ops.filter(r=>r.delivered),identity=logDeliveryConsolidation(ops,trs),cargo=new Set(ops.map(r=>r.cargoId).filter(Boolean)),loaded=ops.filter(r=>r.loaded||r.inRoute||r.delivered),occ=trs.filter(r=>r.occurrence),follow=trs.filter(r=>String(r.follow||'').trim());
 return {waitingKg:logSum(waiting,'weight'),inRouteKg:logSum(inRoute,'weight'),deliveredKg:logSum(done,'weight'),waitingRecords:waiting.length,inRouteRecords:inRoute.length,deliveredRecords:done.length,cargos:cargo.size||null,loadedRecords:loaded.length,overdue:trs.filter(r=>r.overdue&&!r.delivered).length,occurrences:occ.length,followUps:follow.length,withoutFollow:occ.filter(r=>!String(r.follow||'').trim()).length,transportDelivered:trs.filter(r=>r.delivered).length,identity,operations:ops,transport:trs};
}