const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const PAGE_META = {
  overview: ['Visão Geral','Resumo executivo • faturamento, meta, ritmo e pontos de atenção'],
  carteira: ['Carteira','Saúde da carteira • novos, inativos, recuperação e oportunidades'],
  produtos: ['Mix e Produtos','Produtos • mix, concentração, desempenho e venda cruzada'],
  cidades: ['Cidades','Cobertura comercial • evolução, pontos críticos, produtos e clientes'],
  metas: ['Gestão de Metas','Planejamento • histórico, distribuição e acompanhamento']
};

const state = {
  user:null,
  dimensions:null,
  worker:null,
  page:'overview',
  filters:{year:'Todos',month:'Todos',supervisor:[],rca:[],department:[]},
  selectedCity:'Todos',
  requestId:0,
  charts:[],
  map:null,
  mapLayers:[],
  lastPayload:null
};

function money(v, compact=false){
  const n=Number(v||0);
  if(compact){
    if(Math.abs(n)>=1e6) return `R$ ${(n/1e6).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} mi`;
    if(Math.abs(n)>=1e3) return `R$ ${(n/1e3).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})} mil`;
  }
  return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function pct(v){
  if(v===null||v===undefined||Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
}
function integer(v){return Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:0})}
function dec(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtDate(v){if(!v)return '—'; return new Date(v).toLocaleDateString('pt-BR')}
function initials(name){return String(name||'RB').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function normalize(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()}
function aliasCity(v){
  const n=normalize(v);
  const aliases={ITAPAGE:'ITAPAJE',PINRETAMA:'PINDORETAMA'};
  return aliases[n]||n;
}

async function api(url, opts={}){
  const res=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
  let body=null; const text=await res.text();
  try{body=text?JSON.parse(text):null}catch{body=text}
  if(!res.ok) throw new Error(body?.message||body||`Erro ${res.status}`);
  return body;
}

async function bootstrap(){
  bindLogin();
  try{
    const s=await api('/api/session');
    if(s?.authenticated){state.user=s.user; enterApp();}
    else showLogin();
  }catch{showLogin();}
}

function showLogin(){
  $('#loginView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
}
function enterApp(){
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  renderUser();
  bindShell();
  initData();
}
function renderUser(){
  const u=state.user||{};
  $('#userCard').innerHTML=`<div class="avatar">${esc(initials(u.nome))}</div><div><div class="user-name">${esc(u.nome||u.login)}</div><div class="user-role">${esc((u.perfil||'').toLowerCase())}</div></div>`;
}
function bindLogin(){
  $('#loginForm').addEventListener('submit',async e=>{
    e.preventDefault(); $('#loginError').textContent='';
    const btn=e.currentTarget.querySelector('button'); btn.disabled=true; btn.textContent='Entrando…';
    try{
      const data=await api('/api/login',{method:'POST',body:JSON.stringify({login:$('#loginUser').value,password:$('#loginPassword').value})});
      state.user=data.user; enterApp();
    }catch(err){$('#loginError').textContent=err.message||'Usuário ou senha inválidos.'}
    finally{btn.disabled=false;btn.textContent='Entrar'}
  });
}
function bindShell(){
  $('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    state.page=btn.dataset.page;
    state.selectedCity='Todos';
    $('.nav-item').forEach(b=>b.classList.toggle('active',b===btn));
    queryPage();
  }));
  ['filterYear','filterMonth'].forEach(id=>{
    $('#'+id).addEventListener('change',()=>{
      syncFiltersFromUi();
      state.selectedCity='Todos';
      queryPage();
    });
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.multi-select')) $('.multi-select.open').forEach(x=>x.classList.remove('open'));
  });
  $('#clearFilters').addEventListener('click',()=>{
    const latest=state.dimensions?.latest?new Date(state.dimensions.latest):new Date();
    state.filters={year:String(latest.getFullYear()),month:String(latest.getMonth()+1),supervisor:[],rca:[],department:[]};
    syncUiFromFilters(); queryPage();
  });
  $('#refreshData').addEventListener('click',()=>initData(true));
  $('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}catch{} location.reload()});
}

function setStatus(text,show=true){
  $('#dataStatusText').textContent=text;
  $('#dataStatus').classList.toggle('hidden',!show);
}
function initData(force=false){
  destroyCharts();
  if(state.worker)state.worker.terminate();
  setStatus(force?'Atualizando bases do Drive…':'Conectando ao Drive…',true);
  const v=Date.now();
  state.worker=new Worker('/data-worker.js?v='+v);
  state.worker.onmessage=e=>{
    const m=e.data||{};
    if(m.type==='stage'){setStatus(m.text,true);}
    else if(m.type==='ready'){
      state.dimensions=m.dimensions;
      setupFilters();
      setStatus('',false);
      queryPage();
    }else if(m.type==='result'){
      if(m.requestId!==state.requestId)return;
      setStatus('',false);
      state.lastPayload=m.payload;
      renderPage(m.page,m.payload);
    }else if(m.type==='error'||m.type==='queryError'){
      setStatus('',false);
      $('#content').innerHTML=`<div class="empty"><strong>Não foi possível carregar os dados.</strong><br><br>${esc(m.message||'Erro desconhecido')}</div>`;
    }
  };
  state.worker.postMessage({type:'init'});
}
function normalizeMulti(v){
  if(Array.isArray(v)) return v.map(String).filter(x=>x&&x!=='Todos');
  if(v===null||v===undefined||v===''||v==='Todos') return [];
  return [String(v)];
}
function selectedMulti(id){
  return $$('#'+id+' input[type="checkbox"][data-value]:checked').map(x=>x.dataset.value);
}
function multiSummary(values, options){
  const picked=normalizeMulti(values);
  if(!picked.length)return 'Todos';
  if(picked.length===1){
    const hit=options.find(x=>String(x.value)===String(picked[0]));
    return hit?.label||picked[0];
  }
  return picked.length+' selecionados';
}
function fillMultiSelect(el,options,selected,onChange){
  const picked=new Set(normalizeMulti(selected));
  el.innerHTML=`
    <button type="button" class="multi-select-trigger">
      <span class="multi-select-text">${esc(multiSummary([...picked],options))}</span>
      <span class="multi-select-arrow">⌄</span>
    </button>
    <div class="multi-select-menu">
      <button type="button" class="multi-select-all">Todos</button>
      <div class="multi-select-options">
        ${options.map(o=>`<label class="multi-select-option"><input type="checkbox" data-value="${esc(o.value)}" ${picked.has(String(o.value))?'checked':''}><span>${esc(o.label)}</span></label>`).join('')}
      </div>
    </div>`;
  const trigger=$('.multi-select-trigger',el);
  trigger.addEventListener('click',e=>{
    e.stopPropagation();
    $$('.multi-select.open').filter(x=>x!==el).forEach(x=>x.classList.remove('open'));
    el.classList.toggle('open');
  });
  $('.multi-select-menu',el).addEventListener('click',e=>e.stopPropagation());
  $('.multi-select-all',el).addEventListener('click',()=>{
    $$('input[type="checkbox"][data-value]',el).forEach(x=>x.checked=false);
    $('.multi-select-text',el).textContent='Todos';
    onChange?.();
  });
  $$('input[type="checkbox"][data-value]',el).forEach(ch=>ch.addEventListener('change',()=>{
    $('.multi-select-text',el).textContent=multiSummary(selectedMulti(el.id),options);
    onChange?.();
  }));
}
function handleMultiChange(id){
  syncFiltersFromUi();
  if(id==='filterSupervisor')refreshRcaOptions();
  state.selectedCity='Todos';
  queryPage();
}
function setupFilters(){
  const d=state.dimensions||{};
  const latest=d.latest?new Date(d.latest):new Date();
  const defaultYear=d.years?.includes(latest.getFullYear())?latest.getFullYear():(d.years?.[0]||'Todos');
  state.filters.year=String(defaultYear);
  state.filters.month=String(latest.getMonth()+1);
  state.filters.supervisor=normalizeMulti(state.filters.supervisor);
  state.filters.rca=normalizeMulti(state.filters.rca);
  state.filters.department=normalizeMulti(state.filters.department);
  fillSelect($('#filterYear'),['Todos',...(d.years||[]).map(String)],state.filters.year,x=>x==='Todos'?'Todos':x);
  fillSelect($('#filterMonth'),['Todos',...Array.from({length:12},(_,i)=>String(i+1))],state.filters.month,x=>x==='Todos'?'Todos':['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(x)-1]);
  fillMultiSelect($('#filterSupervisor'),(d.supervisors||[]).map(x=>({value:String(x),label:String(x)})),state.filters.supervisor,()=>handleMultiChange('filterSupervisor'));
  fillMultiSelect($('#filterDepartment'),(d.departments||[]).map(x=>({value:String(x),label:String(x)})),state.filters.department,()=>handleMultiChange('filterDepartment'));
  refreshRcaOptions();
  syncUiFromFilters();
}
function fillSelect(el,values,selected,labeller=x=>x){
  el.innerHTML=values.map(v=>`<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(labeller(v))}</option>`).join('');
}
function refreshRcaOptions(){
  const supervisors=normalizeMulti(state.filters.supervisor);
  const rcas=(state.dimensions?.rcas||[]).filter(r=>!supervisors.length||supervisors.includes(String(r.supervisor)));
  const allowed=new Set(rcas.map(r=>String(r.code)));
  state.filters.rca=normalizeMulti(state.filters.rca).filter(x=>allowed.has(String(x)));
  fillMultiSelect(
    $('#filterRca'),
    rcas.map(r=>({value:String(r.code),label:r.name||String(r.code)})),
    state.filters.rca,
    ()=>handleMultiChange('filterRca')
  );
}
function syncFiltersFromUi(){
  state.filters={
    year:$('#filterYear').value,
    month:$('#filterMonth').value,
    supervisor:selectedMulti('filterSupervisor'),
    rca:selectedMulti('filterRca'),
    department:selectedMulti('filterDepartment')
  };
}
function syncUiFromFilters(){
  $('#filterYear').value=state.filters.year;
  $('#filterMonth').value=state.filters.month;
  const d=state.dimensions||{};
  fillMultiSelect($('#filterSupervisor'),(d.supervisors||[]).map(x=>({value:String(x),label:String(x)})),state.filters.supervisor,()=>handleMultiChange('filterSupervisor'));
  fillMultiSelect($('#filterDepartment'),(d.departments||[]).map(x=>({value:String(x),label:String(x)})),state.filters.department,()=>handleMultiChange('filterDepartment'));
  refreshRcaOptions();
}

function queryPage(){
  if(!state.worker||!state.dimensions)return;
  destroyCharts();
  updateHeader();
  setStatus('Atualizando indicadores…',true);
  const requestId=++state.requestId;
  state.worker.postMessage({type:'query',requestId,page:state.page,filters:state.filters,selectedCity:state.selectedCity});
}
function updateHeader(){
  const [title,sub]=PAGE_META[state.page]||PAGE_META.overview;
  $('#pageTitle').textContent=title;$('#pageSubtitle').textContent=sub;
  const m=state.filters.month==='Todos'?'Todos os meses':['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(state.filters.month)-1];
  $('#periodChip').textContent=`${m} • ${state.filters.year}`;
}
function destroyCharts(){
  for(const c of state.charts){try{c.destroy()}catch{}}
  state.charts=[];
}
function chart(canvas,type,data,options={}){
  const c=new Chart(canvas,{type,data,options:{responsive:true,maintainAspectRatio:false,animation:{duration:450},plugins:{legend:{display:false,labels:{boxWidth:9,usePointStyle:true,font:{size:10}}},tooltip:{backgroundColor:'#fff',titleColor:'#1E2655',bodyColor:'#4D556B',borderColor:'#D9DDEA',borderWidth:1,padding:10,displayColors:false,callbacks:{label:ctx=>money(ctx.raw,true)}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:'#7A8294',font:{size:10}}},y:{grid:{color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},callback:v=>money(v,true)}}},...options}});
  state.charts.push(c);return c;
}
function kpi(label,value,note=''){
  return `<div class="kpi-card"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-note">${esc(note)}</div></div>`;
}
function insight(i){
  let val=i.value;
  if(i.kind==='money')val=money(val,true);
  else if(i.kind==='percent'||typeof val==='number')val=pct(val);
  return `<div class="insight-card ${esc(i.level||'attention')}"><div class="insight-badge">${i.level==='critical'?'● Crítico':i.level==='opportunity'?'● Oportunidade':'● Atenção'}</div><div class="insight-value">${esc(val)}</div><div class="insight-title">${esc(i.title)}</div><div class="insight-text">${esc(i.text||'')}</div></div>`;
}
function sectionHeading(title,sub=''){return `<div class="section-heading"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div>`}

function renderPage(page,payload){
  if(page==='overview')renderOverview(payload);
  else if(page==='carteira')renderCarteira(payload);
  else if(page==='produtos')renderProdutos(payload);
  else if(page==='cidades')renderCidades(payload);
  else if(page==='metas')renderMetas(payload);
}

function renderOverview(p){
  const k=p.kpis||{};
  $('#content').innerHTML=`
    <div class="grid kpi-grid">
      ${kpi('Faturamento',money(k.revenue,true),'Recorte selecionado')}
      ${kpi('Meta',money(k.meta,true),'Meta do recorte')}
      ${kpi('Atingimento',pct(k.attainment),'Realizado ÷ meta')}
      ${kpi('Clientes positivados',integer(k.clients),'Clientes únicos')}
      ${kpi('Ticket médio',money(k.ticket,true),'Faturamento ÷ pedidos')}
      ${kpi('Mix médio',dec(k.mix),'Produtos por cliente')}
    </div>
    ${sectionHeading('Pontos de atenção do período','Leitura automática que acompanha os filtros selecionados.')}
    <div class="grid insight-grid">${(p.insights?.length?p.insights:[{level:'opportunity',title:'Recorte estável',value:'—',text:'Nenhum alerta forte identificado.'}]).map(insight).join('')}</div>
    <div class="grid two-col">
      <div class="panel"><div class="panel-title-row"><div><h2>Faturamento mês a mês</h2><div class="panel-sub">Ano selecionado • o filtro de mês não reduz esta série.</div></div></div><div class="chart-wrap"><canvas id="overviewMonthly"></canvas></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Ranking por RCA</h2><div class="panel-sub">Maiores faturamentos no recorte.</div></div></div><div class="chart-wrap"><canvas id="overviewRca"></canvas></div></div>
    </div>
    ${sectionHeading('Departamentos','Participação do faturamento no período.')}
    <div class="panel"><div id="depList" class="metric-list"></div></div>
  `;
  const monthly=p.monthly||[];
  chart($('#overviewMonthly'),'line',{labels:monthly.map(x=>x.label),datasets:[{data:monthly.map(x=>x.revenue),borderColor:'#1E2655',backgroundColor:'rgba(30,38,85,.08)',fill:true,tension:.32,pointRadius:4,pointHoverRadius:6,borderWidth:2.5}]});
  const top=(p.rca||[]).slice(0,10).reverse();
  chart($('#overviewRca'),'bar',{labels:top.map(x=>x.name),datasets:[{data:top.map(x=>x.revenue),backgroundColor:'#42548D',borderRadius:7,barThickness:16}]},{indexAxis:'y'});
  const total=(p.departments||[]).reduce((a,x)=>a+x.revenue,0)||1;
  $('#depList').innerHTML=(p.departments||[]).slice(0,12).map(x=>`<div class="metric-line"><div><div class="name">${esc(x.key||'Sem departamento')}</div><div class="progress"><i style="width:${Math.min(100,x.revenue/total*100)}%"></i></div></div><div class="value">${money(x.revenue,true)} · ${pct(x.revenue/total*100)}</div></div>`).join('');
}

function renderCarteira(p){
  const k=p.kpis||{};
  const inactiveTotal=Number(k.short||0)+Number(k.long||0);
  const ratio=k.newClients ? (Number(k.short||0)/Number(k.newClients||1)).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'x' : '—';
  $('#content').innerHTML=`
    <div class="grid kpi-grid">
      ${kpi('Positivados',integer(k.clients),'Compraram no período')}
      ${kpi('Novos',integer(k.newClients),'Primeira compra no período')}
      ${kpi('Inativos • curto',integer(k.short),'3 a 6 meses sem comprar')}
      ${kpi('Inativos • longo',integer(k.long),'6 a 12 meses sem comprar')}
      ${kpi('Mix por cliente',dec(k.mix),'Produtos distintos por cliente')}
      ${kpi('Produtos ativos no recorte',integer(k.products),'Itens faturados')}
    </div>

    <div class="panel carteira-movement-panel">
      <div class="panel-title-row"><div><h2>Movimento da carteira</h2><div class="panel-sub">Positivados, novos e inativados no mesmo recorte. A barra de inativados é composta por curto + longo prazo.</div></div></div>
      <div class="chart-wrap short"><canvas id="portfolioMovementChart"></canvas></div>
    </div>

    <div class="grid two-col carteira-secondary">
      <div class="panel"><div class="panel-title-row"><div><h2>Inativos por RCA</h2><div class="panel-sub">Faixas exclusivas: curto de 3 a 6 meses e longo de 6 a 12 meses.</div></div></div><div class="chart-wrap tall"><canvas id="inactiveChart"></canvas></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Leitura da carteira</h2><div class="panel-sub">Data de corte: ${fmtDate(k.cutoff)}</div></div></div>
        <div class="metric-list">
          <div class="metric-line"><div class="name">Relação curto / novos</div><div class="value">${ratio}</div></div>
          <div class="metric-line"><div class="name">Inativos totais</div><div class="value">${integer(inactiveTotal)}</div></div>
          <div class="metric-line"><div class="name">Clientes ativos no período</div><div class="value">${integer(k.clients)}</div></div>
        </div>
        <div class="small-note" style="margin-top:18px">As faixas não se sobrepõem: curto prazo considera de 3 a 6 meses sem compra e longo prazo de 6 a 12 meses. A relação curto / novos é mostrada em vezes (x), não em percentual.</div>
      </div>
    </div>
    ${sectionHeading('Clientes inativos para ação','Ordenados pelo maior faturamento dos 12 meses anteriores à data de corte.')}
    <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>RCA</th><th>Última compra</th><th class="align-right">Dias</th><th class="align-right">Fat. 12m</th><th>Faixa</th></tr></thead><tbody id="inactiveTable"></tbody></table></div>
  `;

  chart($('#portfolioMovementChart'),'bar',{
    labels:['Positivados','Novos','Inativados'],
    datasets:[
      {label:'Positivados',data:[k.clients,null,null],backgroundColor:'#6176B5',borderRadius:8,stack:'carteira'},
      {label:'Novos',data:[null,k.newClients,null],backgroundColor:'#2D8B62',borderRadius:8,stack:'carteira'},
      {label:'Inativos • curto',data:[null,null,k.short],backgroundColor:'#CC4D5B',borderRadius:8,stack:'carteira'},
      {label:'Inativos • longo',data:[null,null,k.long],backgroundColor:'#D89B35',borderRadius:8,stack:'carteira'}
    ]
  },{
    plugins:{
      legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:10}}},
      tooltip:{backgroundColor:'#fff',titleColor:'#1E2655',bodyColor:'#4D556B',borderColor:'#D9DDEA',borderWidth:1,padding:10,displayColors:true,callbacks:{label:ctx=>`${ctx.dataset.label}: ${integer(ctx.raw)}`}}
    },
    scales:{
      x:{stacked:true,grid:{display:false},border:{display:false},ticks:{color:'#7A8294',font:{size:10}}},
      y:{stacked:true,beginAtZero:true,grid:{color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},callback:v=>integer(v)}}
    }
  });

  const rows=(p.byRca||[]).slice(0,18).reverse();
  chart($('#inactiveChart'),'bar',{labels:rows.map(x=>x.name),datasets:[
    {label:'Longo prazo',data:rows.map(x=>x.long),backgroundColor:'#D89B35',borderRadius:6},
    {label:'Curto prazo',data:rows.map(x=>x.short),backgroundColor:'#C94A55',borderRadius:6}
  ]},{indexAxis:'y',plugins:{legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${integer(ctx.raw)}`}}},scales:{x:{grid:{color:'#EEF0F5'},ticks:{callback:v=>integer(v)}}}});
  $('#inactiveTable').innerHTML=(p.inactive||[]).map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.rcaName)}</td><td>${fmtDate(x.last)}</td><td class="align-right">${integer(x.days)}</td><td class="align-right">${money(x.revenue12)}</td><td><span class="badge ${x.isShort?'red':'amber'}">${x.isShort?'Curto':'Longo'}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum cliente nesta faixa.</td></tr>';
}

function renderProdutos(p){
  $('#content').innerHTML=`
    <div class="grid kpi-grid four">
      ${kpi('Produtos faturados',integer(p.kpis?.products),'SKUs com venda no recorte')}
      ${kpi('Clientes',integer(p.kpis?.clients),'Clientes que compraram produtos')}
      ${kpi('Produto líder',p.top?.[0]?money(p.top[0].revenue,true):'—',p.top?.[0]?.name||'Sem dados')}
      ${kpi('Menor faturamento',p.bottom?.[0]?money(p.bottom[0].revenue,true):'—',p.bottom?.[0]?.name||'Sem dados')}
    </div>
    <div class="grid equal-col">
      <div class="panel"><div class="panel-title-row"><div><h2>Produtos com maior faturamento</h2><div class="panel-sub">Top 10 do recorte.</div></div></div><div class="chart-wrap tall"><canvas id="prodTop"></canvas></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Menores faturamentos</h2><div class="panel-sub">Produtos vendidos com menor resultado no período.</div></div></div><div class="chart-wrap tall"><canvas id="prodBottom"></canvas></div></div>
    </div>
    ${sectionHeading('Dois principais produtos por RCA','Ajuda a identificar dependência e concentração do faturamento.')}
    <div class="table-wrap"><table><thead><tr><th>RCA</th><th>1º produto</th><th class="align-right">Fat. 1º</th><th>2º produto</th><th class="align-right">Fat. 2º</th><th class="align-right">Concentração Top 2</th></tr></thead><tbody id="top2Table"></tbody></table></div>
  `;
  const top=[...(p.top||[])].reverse();
  chart($('#prodTop'),'bar',{labels:top.map(x=>x.name),datasets:[{data:top.map(x=>x.revenue),backgroundColor:'#1E2655',borderRadius:6,barThickness:15}]},{indexAxis:'y'});
  const bottom=[...(p.bottom||[])].reverse();
  chart($('#prodBottom'),'bar',{labels:bottom.map(x=>x.name),datasets:[{data:bottom.map(x=>x.revenue),backgroundColor:'#8991B7',borderRadius:6,barThickness:15}]},{indexAxis:'y'});
  $('#top2Table').innerHTML=(p.top2||[]).map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.first?.name||'—')}</td><td class="align-right">${money(x.first?.revenue||0)}</td><td>${esc(x.second?.name||'—')}</td><td class="align-right">${x.second?money(x.second.revenue):'—'}</td><td class="align-right">${pct(x.share)}</td></tr>`).join('');
}

function renderCidades(p){
  const cities=p.cities||[];
  const selected=p.selected;
  const revenue=(selected?.revenue ?? cities.reduce((a,x)=>a+x.revenue,0));
  $('#content').innerHTML=`
    <div class="grid kpi-grid five">
      ${kpi(selected?'Cidade selecionada':'Cidades atendidas',selected?esc(selected.city):integer(cities.filter(x=>x.revenue>0).length),selected?selected.uf:'Com faturamento no recorte')}
      ${kpi('Faturamento',money(revenue,true),selected?selected.city:'Área filtrada')}
      ${kpi('Maior cidade',cities[0]?esc(cities[0].city):'—',cities[0]?money(cities[0].revenue,true):'Sem dados')}
      ${kpi('Menor cidade',cities.length?esc([...cities].filter(x=>x.revenue>0).sort((a,b)=>a.revenue-b.revenue)[0]?.city||'—'):'—','Entre cidades com venda')}
      ${kpi('Produtos no foco',integer(p.products?.length),'Top itens analisados')}
    </div>
    ${sectionHeading('Pontos críticos do recorte','Mudam conforme período, RCA, departamento e cidade selecionada.')}
    <div class="grid insight-grid">${(p.insights?.length?p.insights:[{level:'opportunity',title:'Sem alerta crítico forte',value:'—',text:'O recorte não apresentou uma queda relevante automática.'}]).map(insight).join('')}</div>
    <div class="grid city-layout">
      <div class="panel"><div class="panel-title-row"><div><h2>Mapa da área</h2><div class="panel-sub">Clique em um município para abrir o detalhamento.</div></div><button id="allCitiesBtn" class="btn secondary small">Ver todos</button></div><div id="cityMap"></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>${selected?esc(selected.city+' - '+selected.uf):'Cidades da área'}</h2><div class="panel-sub">Ranking por faturamento.</div></div></div><div id="cityList" class="city-list"></div></div>
    </div>
    ${sectionHeading('Evolução mensal do faturamento',selected?`Histórico de ${selected.city} no ano selecionado.`:'Histórico da área no ano selecionado.')}
    <div class="panel"><div class="chart-wrap"><canvas id="cityMonthly"></canvas></div></div>
    <div class="grid equal-col" style="margin-top:12px">
      <div class="panel"><div class="panel-title-row"><div><h2>Principais produtos</h2><div class="panel-sub">${selected?'Na cidade selecionada.':'Na área filtrada.'}</div></div></div><div id="cityProducts" class="metric-list"></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Principais clientes</h2><div class="panel-sub">${selected?'Na cidade selecionada.':'Na área filtrada.'}</div></div></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="align-right">Faturamento</th><th class="align-right">Produtos</th></tr></thead><tbody id="cityClients"></tbody></table></div></div>
    </div>
  `;
  const max=cities[0]?.revenue||1;
  $('#cityList').innerHTML=cities.slice(0,100).map(c=>`<div class="city-row ${selected?.key===c.key?'active':''}" data-city="${esc(c.key)}"><div><strong>${esc(c.city)} - ${esc(c.uf)}</strong><div class="progress" style="margin-top:5px;width:150px"><i style="width:${Math.max(2,c.revenue/max*100)}%"></i></div></div><span>${money(c.revenue,true)}</span></div>`).join('');
  $$('.city-row').forEach(row=>row.addEventListener('click',()=>{state.selectedCity=row.dataset.city;queryPage()}));
  $('#allCitiesBtn').addEventListener('click',()=>{state.selectedCity='Todos';queryPage()});
  const monthly=p.monthly||[];
  chart($('#cityMonthly'),'line',{labels:monthly.map(x=>x.label),datasets:[{data:monthly.map(x=>x.revenue),borderColor:'#1E2655',backgroundColor:'rgba(30,38,85,.08)',fill:true,tension:.32,pointRadius:4,borderWidth:2.5}]});
  const pmax=p.products?.[0]?.revenue||1;
  $('#cityProducts').innerHTML=(p.products||[]).slice(0,10).map(x=>`<div class="metric-line"><div><div class="name">${esc(x.name)}</div><div class="progress"><i style="width:${x.revenue/pmax*100}%"></i></div></div><div class="value">${money(x.revenue,true)}</div></div>`).join('');
  $('#cityClients').innerHTML=(p.clients||[]).slice(0,20).map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td class="align-right">${money(x.revenue)}</td><td class="align-right">${integer(x.products)}</td></tr>`).join('');
  renderCityMap(cities,selected?.key);
}
async function renderCityMap(cities,selectedKey){
  if(state.map){try{state.map.remove()}catch{}state.map=null}
  const el=$('#cityMap'); if(!el)return;
  state.map=L.map(el,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:10}).setView([-8.5,-40.5],5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,opacity:.18}).addTo(state.map);
  const codes={MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',BA:'29'};
  const cityMap=new Map(cities.map(c=>[`${aliasCity(c.city)}|${c.uf}`,c]));
  const max=Math.max(1,...cities.map(c=>c.revenue));
  const states=[...new Set(cities.map(c=>c.uf).filter(uf=>codes[uf]))];
  const bounds=[];
  for(const uf of states){
    try{
      const res=await fetch(`https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${codes[uf]}-mun.json`);
      if(!res.ok)continue; const geo=await res.json();
      const layer=L.geoJSON(geo,{
        style:f=>{
          const name=f.properties?.name||f.properties?.NOME||'';
          const c=cityMap.get(`${aliasCity(name)}|${uf}`);
          const ratio=c?c.revenue/max:0;
          const selected=c&&c.key===selectedKey;
          return {color:selected?'#1E2655':'#AAB3C9',weight:selected?3.5:.65,fillColor:selected?'#E5A43A':ratio>.65?'#1E2655':ratio>.35?'#596CA7':ratio>0?'#BBC5DE':'#E8EBF1',fillOpacity:selected ? .95 : (c ? .82 : .20)};
        },
        onEachFeature:(f,l)=>{
          const name=f.properties?.name||f.properties?.NOME||'';
          const c=cityMap.get(`${aliasCity(name)}|${uf}`);
          if(c){
            l.bindTooltip(`<b>${esc(c.city)} - ${uf}</b><br>${money(c.revenue)}`,{sticky:true});
            l.on('click',()=>{state.selectedCity=c.key;queryPage()});
          }
        }
      }).addTo(state.map);
      try{bounds.push(layer.getBounds())}catch{}
    }catch{}
  }
  if(bounds.length){
    let b=bounds[0]; for(let i=1;i<bounds.length;i++)b.extend(bounds[i]); state.map.fitBounds(b,{padding:[12,12]});
  }
}

function renderMetas(p){
  const attainment=p.totalMeta?p.totalRevenue/p.totalMeta*100:null;
  $('#content').innerHTML=`
    <div class="readonly-banner"><strong>Nova Gestão de Metas em migração.</strong> Esta versão web já traz a leitura histórica e a distribuição cadastrada. A edição, versionamento e aprovação serão conectados ao novo backend antes da retirada definitiva do Streamlit.</div>
    <div class="grid kpi-grid four">
      ${kpi('Meta do ano',money(p.totalMeta,true),'Ano selecionado')}
      ${kpi('Faturamento',money(p.totalRevenue,true),'Acumulado no ano')}
      ${kpi('Atingimento',pct(attainment),'Realizado ÷ meta')}
      ${kpi('Supervisões com meta',integer(p.supervisors?.length),'Distribuição cadastrada')}
    </div>
    <div class="grid two-col">
      <div class="panel"><div class="panel-title-row"><div><h2>Faturamento x meta mês a mês</h2><div class="panel-sub">Leitura anual do período selecionado.</div></div></div><div class="chart-wrap tall"><canvas id="metaMonthly"></canvas></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Meta por supervisão</h2><div class="panel-sub">Distribuição cadastrada na base.</div></div></div><div id="metaSup" class="metric-list"></div></div>
    </div>
  `;
  const monthly=p.monthly||[];
  const c=new Chart($('#metaMonthly'),{type:'bar',data:{labels:monthly.map(x=>x.label),datasets:[
    {label:'Meta',data:monthly.map(x=>x.meta),backgroundColor:'#DDE2EF',borderRadius:6},
    {label:'Faturamento',data:monthly.map(x=>x.revenue),backgroundColor:'#1E2655',borderRadius:6}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(ctx.raw)}`}}},scales:{x:{grid:{display:false},border:{display:false}},y:{grid:{color:'#EEF0F5'},border:{display:false},ticks:{callback:v=>money(v,true)}}}}});
  state.charts.push(c);
  const max=p.supervisors?.[0]?.meta||1;
  $('#metaSup').innerHTML=(p.supervisors||[]).map(x=>`<div class="metric-line"><div><div class="name">${esc(x.name)}</div><div class="progress"><i style="width:${x.meta/max*100}%"></i></div></div><div class="value">${money(x.meta,true)}</div></div>`).join('');
}

bootstrap();
