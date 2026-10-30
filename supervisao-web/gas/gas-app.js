const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const PAGE_META = {
  overview: ['Visão Geral','Resumo executivo • faturamento, meta, ritmo e pontos de atenção'],
  carteira: ['Carteira','Saúde da carteira • novos, inativos, recuperação e oportunidades'],
  produtos: ['Mix e Produtos','Produtos • mix, concentração, desempenho e venda cruzada'],
  cidades: ['Cidades','Cobertura comercial • evolução, pontos críticos, produtos e clientes'],
  metas: ['Gestão de Metas','Planejamento • histórico, distribuição e acompanhamento'],
  pedidos: ['Pedidos & Previsão','Pedidos em carteira • situação, valor e relação com o faturamento']
};

const state = {
  user:null,
  dimensions:null,
  worker:null,
  loadingData:false,
  serverUpdatedAt:null,
  updateCheckTimer:null,
  checkingForUpdates:false,
  page:'overview',
  filters:{uf:[],region:'Todos',city:'Todos',year:'Todos',month:'Todos',supervisor:[],rca:[],department:[]},
  selectedCity:'Todos',
  requestId:0,
  charts:[],
  map:null,
  mapLayers:[],
  coverageDrawId:0,
  lastPayload:null,
  cityView:'sales',
  coverage:null,
  coverageGeo:{},
  coverageSelection:null,
  selectedOrderClient:'',
  selectedOrderKey:'',
  selectedOrderStatus:'',
  orderClientQuery:'',
  orderPayload:null,
  coverageFilters:{department:'Nutrição',uf:[],rca:'Todos',status:'Todas'}
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

function api(url, opts={}){
  let action=String(url||'').replace(/^\/api\//,'').split(/[/?]/)[0];
  const body=opts.body ? JSON.parse(opts.body) : {};
  if(action==='session') action='session';
  if(action==='login') action='login';
  if(action==='logout') action='logout';
  return new Promise((resolve,reject)=>{
    google.script.run.withSuccessHandler(result=>{
      if(!result || result.ok===false){reject(new Error(result?.message||'Falha na comunicação com o Apps Script.'));return;}
      if(action==='login' && result.token) sessionStorage.setItem('dashboardSession',result.token);
      if(action==='logout') sessionStorage.removeItem('dashboardSession');
      resolve(result);
    }).withFailureHandler(error=>reject(new Error(error?.message||String(error))))
      .dashboardApi(action,body,sessionStorage.getItem('dashboardSession')||'');
  });
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
  $$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    state.page=btn.dataset.page;
    state.selectedCity='Todos';
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b===btn));
    queryPage();
  }));
  ['filterRegion','filterCity'].forEach(id=>{
    $('#'+id).addEventListener('change',()=>{
      syncFiltersFromUi();
      if(id==='filterRegion')state.filters.city='Todos';
      updateGeoFilterUi();
      state.selectedCity='Todos';
      queryPage();
    });
  });
  ['filterYear','filterMonth'].forEach(id=>{
    $('#'+id).addEventListener('change',()=>{
      syncFiltersFromUi();
      state.selectedCity='Todos';
      queryPage();
    });
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.multi-select')) $$('.multi-select.open').forEach(x=>x.classList.remove('open'));
  });
  $('#clearFilters').addEventListener('click',()=>{
    const latest=state.dimensions?.latest?new Date(state.dimensions.latest):new Date();
    state.filters={uf:[],region:'Todos',city:'Todos',year:String(latest.getFullYear()),month:String(latest.getMonth()+1),supervisor:[],rca:[],department:[]};
    state.selectedOrderStatus='';state.selectedOrderClient='';state.selectedOrderKey='';state.orderClientQuery='';
    syncUiFromFilters(); queryPage();
  });
  $('#toggleAdvancedFilters').addEventListener('click',e=>{
    const button=e.currentTarget, panel=$('#advancedFilters'), opening=panel.classList.contains('hidden');
    panel.classList.toggle('hidden',!opening);
    button.setAttribute('aria-expanded',String(opening));
    button.classList.toggle('is-open',opening);
    button.querySelector('span').textContent=opening?'−':'＋';
  });
  $('#refreshData').addEventListener('click',()=>initData(true));
  $('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}catch{} location.reload()});
}

function setStatus(text,show=true){
  $('#dataStatusText').textContent=text;
  $('#dataStatus').classList.toggle('hidden',!show);
}
function createInlineDataEngine(source){
  const script=document.createElement('script');
  const nonce=document.querySelector('script[nonce]')?.nonce;
  if(nonce)script.nonce=nonce;
  const engine={
    onmessage:null,
    onerror:null,
    postMessage(message){
      if(typeof window.__rebanhoEngineReceive!=='function')throw new Error('O processador alternativo não foi inicializado.');
      window.__rebanhoEngineReceive({data:message});
    },
    terminate(){
      script.remove();
      delete window.__rebanhoEngineReceive;
      delete window.__rebanhoEngineSend;
    }
  };
  window.__rebanhoEngineSend=message=>Promise.resolve().then(()=>engine.onmessage?.({data:message}));
  script.textContent=`(function(){let onmessage;const postMessage=message=>window.__rebanhoEngineSend(message);${source}\nwindow.__rebanhoEngineReceive=onmessage;})();`;
  document.head.appendChild(script);
  if(typeof window.__rebanhoEngineReceive!=='function'){
    script.remove();delete window.__rebanhoEngineSend;
    throw new Error('O navegador bloqueou o processador alternativo do Apps Script.');
  }
  return engine;
}
function initData(force=false,{preserveFilters=false}={}){
  state.loadingData=true;
  destroyCharts();
  if(state.worker)state.worker.terminate();
  setStatus(force?'Atualizando bases no Apps Script…':'Carregando bases comerciais…',true);
  const workerSource=document.getElementById('workerSource')?.textContent||'';
  if(!workerSource.trim()) throw new Error('O processador local não foi carregado.');
  let workerUrl=null,usingFallback=false,firstWorkerMessage=false,fallbackTimer=null;
  const handleMessage=e=>{
    const m=e.data||{};
    if(m.type==='serverRequest'){
      const activeWorker=state.worker;
      let settled=false;
      const warningTimer=setTimeout(()=>{
        if(settled)return;
        setStatus(m.action==='refresh'
          ?'A atualização ainda está em andamento. Pode levar alguns minutos; mantenha esta tela aberta e evite clicar novamente.'
          :'O Apps Script ainda está processando a solicitação. Mantenha esta tela aberta.',true);
      },30000);
      const timeout=setTimeout(()=>{
        if(settled)return;settled=true;clearTimeout(warningTimer);
        activeWorker?.postMessage({type:'serverResponse',requestId:m.requestId,error:'O Apps Script não concluiu a solicitação em 5 minutos e 30 segundos. A atualização pode ainda estar em execução; aguarde antes de tentar novamente.'});
      },330000);
      api('/api/'+m.action,{method:'POST',body:JSON.stringify(m.payload||{})})
        .then(data=>{if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(warningTimer);activeWorker?.postMessage({type:'serverResponse',requestId:m.requestId,data});})
        .catch(error=>{if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(warningTimer);activeWorker?.postMessage({type:'serverResponse',requestId:m.requestId,error:error?.message||String(error)});});
      return;
    }
    if(m.type==='stage'){setStatus(m.text,true);}
    else if(m.type==='ready'){
      const retainedFilters=preserveFilters?{...state.filters}:null;
      state.dimensions=m.dimensions;
      setupFilters();
      if(retainedFilters){state.filters=retainedFilters;syncUiFromFilters();}
      state.loadingData=false;
      state.serverUpdatedAt=m.serverUpdatedAt||null;
      const stamp=state.serverUpdatedAt?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(state.serverUpdatedAt)):'';
      $('#lastBaseUpdate').textContent=stamp?'Última atualização: '+stamp:'';
      $('#lastBaseUpdate').dateTime=state.serverUpdatedAt||'';
      if(stamp)$('#periodChip').title='Dados atualizados em '+stamp;
      beginAutomaticUpdates();
      setStatus('',false);
      queryPage();
    }else if(m.type==='result'){
      if(m.requestId!==state.requestId)return;
      setStatus('',false);
      state.lastPayload=m.payload;
      try{renderPage(m.page,m.payload)}catch(error){
        console.error('Falha ao renderizar a tela do dashboard:',error);
        $('#content').innerHTML=`<div class="empty"><strong>Não foi possível exibir esta tela.</strong><br><br>${esc(error?.message||'Ocorreu uma falha ao montar os gráficos e informações.')}</div>`;
      }
    }else if(m.type==='error'||m.type==='queryError'){
      state.loadingData=false;
      setStatus('',false);
      $('#content').innerHTML=`<div class="empty"><strong>Não foi possível carregar os dados.</strong><br><br>${esc(m.message||'Erro desconhecido')}</div>`;
    }
  };
  const startFallback=error=>{
    if(usingFallback)return;
    usingFallback=true;clearTimeout(fallbackTimer);
    try{state.worker?.terminate();}catch{}
    if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=null;}
    try{
      const fallback=createInlineDataEngine(workerSource);
      state.worker=fallback;fallback.onmessage=handleMessage;
      setStatus('Iniciando processador compatível com o Apps Script…',true);
      fallback.postMessage({type:'init',force});
    }catch(fallbackError){
      setStatus('',false);
      $('#content').innerHTML=`<div class="empty"><strong>Falha ao iniciar o processamento das bases.</strong><br><br>${esc(fallbackError?.message||error?.message||'Erro no processador de dados.')}</div>`;
    }
  };
  try{
    workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
    const worker=new Worker(workerUrl);
    state.worker=worker;
    worker.addEventListener('error',e=>{
      if(!firstWorkerMessage){startFallback(e);return;}
      setStatus('',false);
      $('#content').innerHTML=`<div class="empty"><strong>Falha no processamento das bases.</strong><br><br>${esc(e.message||'Erro no processador de dados.')}</div>`;
    },{once:true});
    worker.onmessage=e=>{
      if(!firstWorkerMessage){firstWorkerMessage=true;clearTimeout(fallbackTimer);if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=null;}}
      handleMessage(e);
    };
    fallbackTimer=setTimeout(()=>{if(!firstWorkerMessage)startFallback(new Error('O processador em segundo plano não respondeu.'));},3000);
    worker.postMessage({type:'init',force});
  }catch(error){startFallback(error);}
}
async function checkAutomaticUpdate(){
  if(document.hidden||state.loadingData||state.checkingForUpdates||!state.user||!state.serverUpdatedAt)return;
  state.checkingForUpdates=true;
  try{
    const info=await api('/api/info');
    if(info.exists&&info.updatedAt&&info.updatedAt!==state.serverUpdatedAt)initData(false,{preserveFilters:true});
  }catch(error){console.warn('Não foi possível conferir a atualização automática:',error?.message||String(error));}
  finally{state.checkingForUpdates=false;}
}
function beginAutomaticUpdates(){
  if(state.updateCheckTimer)return;
  state.updateCheckTimer=setInterval(checkAutomaticUpdate,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAutomaticUpdate();});
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
  const emptyLabel=el.id==='filterUf'?'Todos os estados':'Todos';
  el.innerHTML=`
    <button type="button" class="multi-select-trigger">
      <span class="multi-select-text">${esc(picked.size?multiSummary([...picked],options):emptyLabel)}</span>
      <span class="multi-select-arrow">⌄</span>
    </button>
    <div class="multi-select-menu">
      <input type="search" class="multi-select-search" aria-label="Pesquisar opções" placeholder="Pesquisar…" autocomplete="off">
      <button type="button" class="multi-select-all">${esc(emptyLabel)}</button>
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
  $('.multi-select-search',el).addEventListener('input',e=>{
    const needle=normalize(e.currentTarget.value);
    $$('.multi-select-option',el).forEach(option=>option.classList.toggle('filtered-out',needle&&!normalize(option.textContent).includes(needle)));
  });
  $('.multi-select-all',el).addEventListener('click',()=>{
    $$('input[type="checkbox"][data-value]',el).forEach(x=>x.checked=false);
    $('.multi-select-text',el).textContent=emptyLabel;
    $('.multi-select-search',el).value='';
    $$('.multi-select-option',el).forEach(option=>option.classList.remove('filtered-out'));
    onChange?.();
  });
  $$('input[type="checkbox"][data-value]',el).forEach(ch=>ch.addEventListener('change',()=>{
    const selectedValues=selectedMulti(el.id);
    $('.multi-select-text',el).textContent=selectedValues.length?multiSummary(selectedValues,options):emptyLabel;
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
  state.filters.uf=normalizeMulti(state.filters.uf);state.filters.region=state.filters.region||'Todos';state.filters.city=state.filters.city||'Todos';
  updateGeoFilterUi();
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
function updateGeoFilterUi(preserveUf=false){
  const rows=state.dimensions?.geography||[];
  const ufs=normalizeMulti(state.filters.uf),region=state.filters.region||'Todos';
  const allUfs=[...new Set(rows.map(x=>x.uf))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const regionRows=rows.filter(x=>!ufs.length||ufs.includes(x.uf));
  const regions=[...new Set(regionRows.map(x=>x.region))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(region!=='Todos'&&!regions.includes(region))state.filters.region='Todos';
  const activeRegion=state.filters.region||'Todos';
  const cityRows=rows.filter(x=>(!ufs.length||ufs.includes(x.uf))&&(activeRegion==='Todos'||x.region===activeRegion));
  const cities=[...new Set(cityRows.map(x=>x.city))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(state.filters.city!=='Todos'&&!cities.includes(state.filters.city))state.filters.city='Todos';
  if(!preserveUf){
    fillMultiSelect($('#filterUf'),allUfs.map(x=>({value:x,label:x})),ufs,()=>{
      state.filters.uf=selectedMulti('filterUf');
      state.filters.region='Todos';state.filters.city='Todos';
      updateGeoFilterUi(true);
      state.selectedCity='Todos';
      queryPage();
    });
  }
  fillSelect($('#filterRegion'),['Todos',...regions],state.filters.region,x=>x==='Todos'?'Todas':x);
  fillSelect($('#filterCity'),['Todos',...cities],state.filters.city,x=>x==='Todos'?'Todas':x);
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
    uf:selectedMulti('filterUf'),
    region:$('#filterRegion').value,
    city:$('#filterCity').value,
    year:$('#filterYear').value,
    month:$('#filterMonth').value,
    supervisor:selectedMulti('filterSupervisor'),
    rca:selectedMulti('filterRca'),
    department:selectedMulti('filterDepartment')
  };
  updateAdvancedFilterCount();
}
function syncUiFromFilters(){
  updateGeoFilterUi();
  $('#filterYear').value=state.filters.year;
  $('#filterMonth').value=state.filters.month;
  const d=state.dimensions||{};
  fillMultiSelect($('#filterSupervisor'),(d.supervisors||[]).map(x=>({value:String(x),label:String(x)})),state.filters.supervisor,()=>handleMultiChange('filterSupervisor'));
  fillMultiSelect($('#filterDepartment'),(d.departments||[]).map(x=>({value:String(x),label:String(x)})),state.filters.department,()=>handleMultiChange('filterDepartment'));
  refreshRcaOptions();
  updateAdvancedFilterCount();
}
function updateAdvancedFilterCount(){
  const total=normalizeMulti(state.filters.supervisor).length+normalizeMulti(state.filters.rca).length+normalizeMulti(state.filters.department).length;
  const badge=$('#advancedFilterCount');
  if(!badge)return;
  badge.textContent=total?String(total):'';
  badge.classList.toggle('hidden',!total);
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
  const horizontal=options.indexAxis==='y';
  const moneyTick=value=>money(value,true);
  const c=new Chart(canvas,{type,data,options:{responsive:true,maintainAspectRatio:false,animation:{duration:450},plugins:{legend:{display:false,labels:{boxWidth:9,usePointStyle:true,font:{size:10}}},tooltip:{backgroundColor:'#fff',titleColor:'#1E285F',bodyColor:'#4D556B',borderColor:'#D9DDEA',borderWidth:1,padding:10,displayColors:false,callbacks:{label:ctx=>money(ctx.raw,true)}}},scales:{x:{grid:{display:horizontal,color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},...(horizontal?{callback:moneyTick}:{})}},y:{grid:{color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},...(!horizontal?{callback:moneyTick}:{})}}},...options}});
  state.charts.push(c);return c;
}
function toggleCrossFilter(key,value){
  const selected=normalizeMulti(state.filters[key]);
  const text=String(value);
  state.filters[key]=selected.includes(text)?selected.filter(x=>x!==text):[...selected,text];
  state.selectedCity='Todos';
  syncUiFromFilters();
  queryPage();
}
if(typeof Chart!=='undefined'&&!Chart.registry.plugins.get('barValueLabels')){
  Chart.register({id:'barValueLabels',afterDatasetsDraw(chartInstance,_args,pluginOptions){
    if(!pluginOptions?.display)return;
    const ctx=chartInstance.ctx,area=chartInstance.chartArea;
    ctx.save();ctx.font='600 10px Inter,system-ui,sans-serif';ctx.textBaseline='middle';
    chartInstance.data.datasets.forEach((dataset,datasetIndex)=>{
      if(dataset.showValueLabels===false)return;
      chartInstance.getDatasetMeta(datasetIndex).data.forEach((bar,index)=>{
        const value=dataset.data[index];if(value==null||!Number.isFinite(Number(value)))return;
        const label=money(Number(value),true),width=ctx.measureText(label).width;
        const inside=bar.x+width+12>area.right;
        ctx.textAlign=inside?'right':'left';ctx.fillStyle=inside?'#FFFFFF':'#334155';
        ctx.fillText(label,inside?bar.x-7:bar.x+7,bar.y);
      });
    });ctx.restore();
  }});
}
function kpi(label,value,note=''){
  return `<div class="kpi-card"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-note">${esc(note)}</div></div>`;
}
function insight(i){
  let val=i.value;
  if(i.kind==='money')val=money(val,true);
  else if(i.kind==='percent'||typeof val==='number')val=pct(val);
  return `<div class="insight ${esc(i.level||'attention')}"><div class="insight-badge">${i.level==='critical'?'● Crítico':i.level==='opportunity'?'● Oportunidade':'● Atenção'}</div><div class="insight-value">${esc(val)}</div><div class="insight-title">${esc(i.title)}</div><div class="insight-text">${esc(i.text||'')}</div></div>`;
}
function sectionHeading(title,sub=''){return `<div class="section-heading"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div>`}

function renderPage(page,payload){
  if(page==='overview')renderOverview(payload);
  else if(page==='carteira')renderCarteira(payload);
  else if(page==='produtos')renderProdutos(payload);
  else if(page==='cidades')renderCidades(payload);
  else if(page==='metas')renderMetas(payload);
  else if(page==='pedidos')renderOrders(payload);
}

function renderOverview(p){
  const k=p.kpis||{};
  const daily=p.daily||{},dailyDate=daily.date?daily.date.split('-').reverse().join('/'):'Sem movimento no período';
  const pipeline=p.pipeline||{},goal=Number(k.meta)||0,revenue=Number(k.revenue)||0;
  const attainment=Math.max(0,Math.min(100,goal?revenue/goal*100:0));
  const openWidth=goal?Math.min(100-attainment,Number(pipeline.openValue||0)/goal*100):0;
  const blockedWidth=goal?Math.min(Math.max(0,100-attainment-openWidth),Number(pipeline.blockedValue||0)/goal*100):0;
  const gap=Math.max(0,goal-revenue),departmentSelected=normalizeMulti(state.filters.department).length>0;
  const goalGapLabel=departmentSelected?'Falta para meta do departamento':'Falta para a meta';
  const statusLabels={PENDENTE:'Pendente',LIBERADO:'Liberado',BLOQUEADO:'Bloqueado'};
  $('#content').innerHTML=`
    <div class="overview-hero">
      <div class="overview-revenue">
        <div class="revenue-kicker"><i></i> Vendas realizadas no recorte</div>
        <div class="revenue-value" title="${money(revenue)}">${money(k.revenue,true)}</div>
        <div class="revenue-caption"><strong>${money(revenue)}</strong> · Vendas pela data do pedido</div>
        <div class="revenue-divider"></div>
        <div class="revenue-meta"><span>Meta do recorte</span><strong>${money(k.meta,true)}</strong><span>${pct(k.attainment)} atingido</span></div>
        <div class="goal-progress" role="img" aria-label="Faturado ${pct(attainment)}; pedidos ativos e bloqueados aparecem em tons claros">
          <i class="goal-segment realized" style="width:${attainment}%"></i><i class="goal-segment open" style="width:${openWidth}%"></i><i class="goal-segment blocked" style="width:${blockedWidth}%"></i>
        </div>
        <div class="goal-legend"><span><i class="legend-dot realized"></i>Faturado</span><span><i class="legend-dot open"></i>Pedidos ativos</span><span><i class="legend-dot blocked"></i>Bloqueados</span></div>
        <div class="revenue-caption goal-caption">Pedidos em aberto no recorte: <strong>${money(Number(pipeline.totalOpenValue||0),true)}</strong> <span>(inclui bloqueados)</span></div>
      </div>
      <div class="overview-kpis">
        ${kpi('Clientes positivados',integer(k.clients),'Clientes únicos com compra')}
        ${kpi('Ticket médio',money(k.ticket,true),'Valor por pedido')}
        ${kpi('Pedidos em aberto',money(Number(pipeline.totalOpenValue||0),true),`${integer(pipeline.totalOpenCount||0)} pedidos · inclui bloqueados`)}
        ${kpi(goalGapLabel,money(gap,true),goal?`${pct(k.attainment)} atingido${revenue>=goal?' · meta alcançada':''}`:'Meta não cadastrada para este recorte')}
      </div>
    </div>
    <div class="overview-pipeline">
      <div class="grid kpi-grid four">
        ${kpi('Carteira total',money(Number(pipeline.totalOpenValue||0),true),`${integer(pipeline.totalOpenCount||0)} pedidos · inclui bloqueados`)}
        ${kpi('Carteira ÷ faturamento',pct(revenue?Number(pipeline.totalOpenValue||0)/revenue*100:null),'Peso total dos pedidos em aberto')}
        ${kpi('Projeção liberados + pendentes',money(pipeline.projected,true),`Potencial ${pct(pipeline.projectedAttainment)} da meta · não é garantia de faturamento`)}
        ${kpi('Valor bloqueado',money(pipeline.blockedValue,true),`${integer(pipeline.blockedCount)} pedidos aguardando solução`)}
      </div>
      <div class="order-status-breakdown" aria-label="Pedidos em aberto por posição"><strong>Posição dos pedidos</strong>
        ${(pipeline.byStatus||[]).map(x=>`<span class="status-summary ${String(x.status).toLowerCase()}"><b>${esc(statusLabels[x.status]||x.status)}</b><strong>${money(x.value,true)}</strong><small>${integer(x.count)} pedidos</small></span>`).join('')||'<span class="muted">Sem pedidos neste recorte.</span>'}
      </div>
    </div>
    <div class="overview-analysis">
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Ritmo de faturamento</div><div class="panel-sub">Eixo iniciado em R$ 1 milhão para destacar a variação entre os meses.</div></div><span class="panel-chip">${esc(state.filters.year||'Ano')}</span></div><div class="chart-wrap"><canvas id="overviewMonthly"></canvas></div></div>
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Leituras para acompanhar</div><div class="panel-sub">Sinais identificados nesta seleção.</div></div></div><div class="overview-insights">${(p.insights?.length?p.insights:[{level:'opportunity',title:'Recorte estável',value:'—',text:'Nenhum alerta forte identificado.'}]).slice(0,4).map(insight).join('')}</div></div>
    </div>
    <div class="section-heading"><div><h2>Quem movimenta o resultado</h2><p>Distribuição do faturamento por RCA e departamento.</p></div></div>
    <div class="overview-bottom">
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Desempenho por RCA</div><div class="panel-sub">Clique em um RCA para filtrar os cartões e os demais gráficos. As barras claras indicam a meta.</div></div></div><div class="chart-wrap short"><canvas id="overviewRca"></canvas></div></div>
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Composição por departamento</div><div class="panel-sub">Clique em uma linha para aplicar o departamento aos cartões e gráficos.</div></div></div><div id="depList" class="overview-departments metric-list"></div></div>
    </div>
  `;
  const monthly=p.monthly||[];
  chart($('#overviewMonthly'),'line',{labels:monthly.map(x=>x.label),datasets:[{label:'Faturamento',data:monthly.map(x=>x.revenue),borderColor:'#1D2A68',backgroundColor:'rgba(29,42,104,.09)',fill:true,tension:.32,pointRadius:4,pointHoverRadius:6,borderWidth:2.5}]},{scales:{x:{grid:{display:false},border:{display:false}},y:{min:1000000,beginAtZero:false,grid:{color:'#E8EDF6'},border:{display:false},ticks:{callback:v=>money(v,true)}}}});
  const top=(p.rca||[]).slice(0,10);
  const selectedRcas=new Set(normalizeMulti(state.filters.rca));
  const rcaChart=chart($('#overviewRca'),'bar',{labels:top.map(x=>x.name),datasets:[
    {label:'Faturamento',data:top.map(x=>x.revenue),backgroundColor:top.map(x=>selectedRcas.size&&!selectedRcas.has(String(x.key))?'#BDD0EE':'#1D2A68'),borderRadius:7,barThickness:10},
    {label:'Meta',data:top.map(x=>x.meta||0),backgroundColor:'#C7D8F2',borderRadius:7,barThickness:10,showValueLabels:false}
  ]},{indexAxis:'y',onClick:(_event,elements)=>{if(elements?.length)toggleCrossFilter('rca',top[elements[0].index].key)},plugins:{legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:9}}},barValueLabels:{display:true},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(ctx.raw,true)}`}}},scales:{x:{afterDataLimits:axis=>{axis.max=axis.max*1.18},grid:{color:'#E8EDF6'},ticks:{callback:v=>money(v,true)}},y:{grid:{display:false},ticks:{autoSkip:false,font:{size:9}}}}});
  rcaChart.canvas.style.cursor='pointer';
  const total=(p.departments||[]).reduce((a,x)=>a+x.revenue,0)||1;
  const selectedDepartments=new Set(normalizeMulti(state.filters.department));
  $('#depList').innerHTML=(p.departments||[]).slice(0,12).map(x=>`<button type="button" class="metric-row department-filter ${selectedDepartments.has(String(x.key))?'selected':''}" data-department="${esc(x.key)}"><span><span class="metric-name">${esc(x.key||'Sem departamento')}</span><span class="progress"><i style="width:${Math.min(100,x.revenue/total*100)}%"></i></span></span><span class="metric-value">${money(x.revenue,true)} · ${pct(x.revenue/total*100)}<small>${x.meta?`Meta ${money(x.meta,true)}`:'Meta não cadastrada'}</small></span></button>`).join('')||'<div class="empty">Sem departamento neste recorte.</div>';
  $$('.department-filter').forEach(button=>button.addEventListener('click',()=>toggleCrossFilter('department',button.dataset.department)));
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
  if(state.cityView==='coverage'){renderCoverageView(p);return;}
  renderCidadesSales(p);
}
function renderCidadesSales(p){
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
      <div class="panel"><div class="panel-title-row"><div><h2>Faturamento por município</h2><div class="panel-sub">Tons mais escuros indicam maior faturamento. Clique para filtrar.</div></div><button id="allCitiesBtn" class="btn secondary small">Ver todos</button></div><div id="cityMap"></div><div class="map-revenue-legend"><span>Menor faturamento</span><i></i><i></i><i></i><i></i><span>Maior faturamento</span></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>${selected?esc(selected.city+' - '+selected.uf):'Cidades da área'}</h2><div class="panel-sub">Ranking por faturamento.</div></div></div><div id="cityList" class="city-list"></div></div>
    </div>
    ${sectionHeading('Evolução mensal do faturamento',selected?`Histórico de ${selected.city} no ano selecionado.`:'Histórico da área no ano selecionado.')}
    <div class="panel"><div class="chart-wrap"><canvas id="cityMonthly"></canvas></div></div>
    <div class="grid equal-col" style="margin-top:12px">
      <div class="panel"><div class="panel-title-row"><div><h2>Principais produtos</h2><div class="panel-sub">${selected?'Na cidade selecionada.':'Na área filtrada.'}</div></div></div><div id="cityProducts" class="metric-list"></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Principais clientes</h2><div class="panel-sub">${selected?'Na cidade selecionada.':'Na área filtrada.'}</div></div></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="align-right">Faturamento</th><th class="align-right">Produtos</th></tr></thead><tbody id="cityClients"></tbody></table></div></div>
    </div>
  `;
  $('#content').insertAdjacentHTML('afterbegin','<div class="city-view-switch" role="group" aria-label="Visualização de cidades"><button type="button" class="active" data-city-view="sales">Faturamento</button><button type="button" data-city-view="coverage">Cobertura territorial</button></div>');
  $$('.city-view-switch button').forEach(b=>b.addEventListener('click',()=>{state.cityView=b.dataset.cityView;renderCidades(state.lastPayload||p)}));
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
  state.map=L.map(el,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:10,scrollWheelZoom:false}).setView([-8.5,-40.5],5);
  const codes={MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',BA:'29'};
  const cityMap=new Map(cities.map(c=>[`${aliasCity(c.city)}|${c.uf}`,c]));
  const sortedValues=cities.map(c=>Number(c.revenue)||0).sort((a,b)=>a-b);
  const max=Math.max(1,...sortedValues);
  const colorAt=value=>{
    const t=Math.max(0,Math.min(1,(Number(value)||0)/max));
    const start=[226,237,252],end=[29,66,145],rgb=start.map((v,i)=>Math.round(v+(end[i]-v)*Math.pow(t,.68)));
    return '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
  };
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
          const selected=c&&c.key===selectedKey;
          return {color:selected?'#112B63':'#B8C6D8',weight:selected?2.8:.75,fillColor:selected?'#1D2A68':c?colorAt(c.revenue):'#F2F5FA',fillOpacity:selected?0.96:c?0.9:0.55};
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

function renderOrders(p){
  const byStatus=p.byStatus||[];
  const rows=p.orders||[];
  const statusLabel={PENDENTE:'Pendente',LIBERADO:'Liberado',BLOQUEADO:'Bloqueado'};
  const statusClass={PENDENTE:'pending',LIBERADO:'released',BLOQUEADO:'blocked'};
  state.orderPayload=p;
  if(!rows.some(x=>orderClientCode(x)===state.selectedOrderClient))state.selectedOrderClient='';
  if(!rows.some(x=>x.key===state.selectedOrderKey))state.selectedOrderKey='';
  $('#content').innerHTML=`
    ${sectionHeading('Pedidos em aberto e posição','Visão de carteira por cliente, pedido e item, inspirada na rotina 336 do Winthor.')}
    <div class="grid kpi-grid four">
      ${kpi('Carteira total',money(p.totalOpenValue??(Number(p.openValue||0)+Number(p.blockedValue||0)),true),`${integer(p.totalOpenCount??(Number(p.openCount||0)+Number(p.blockedCount||0)))} pedidos · todos os status`)}
      ${kpi('Participação no faturamento',pct(p.shareRevenue),'Carteira total, inclusive bloqueados ÷ faturado')}
      ${kpi('Projeção liberados + pendentes',money(p.projected,true),`${pct(p.projectedAttainment)} da meta do recorte`)}
      ${kpi('Bloqueados',money(p.blockedValue,true),`${integer(p.blockedCount)} pedidos fora da projeção`)}
    </div>
    <div class="panel order-status-panel order-status-filter"><div class="panel-title-row"><div><h2>Pedidos por posição</h2><div class="panel-sub">Clique em uma posição para filtrar os clientes e os pedidos abaixo.</div></div></div><div class="order-status-breakdown">
      <button type="button" class="status-summary order-position-choice" data-order-status="" aria-pressed="false"><b>Todas as posições</b><strong>${money(p.totalOpenValue??rows.reduce((sum,x)=>sum+Number(x.value||0),0),true)}</strong><small>${orderCount(rows.length)}</small></button>
      ${byStatus.map(x=>`<button type="button" class="status-summary order-position-choice ${String(x.status).toLowerCase()}" data-order-status="${esc(x.status)}" aria-pressed="false"><b>${esc(statusLabel[x.status]||x.status)}</b><strong>${money(x.value,true)}</strong><small>${orderCount(x.count)}</small></button>`).join('')}
    </div></div>
    <div class="order-explorer">
      <div class="panel order-clients-panel"><div class="panel-title-row"><div><h2>Clientes</h2><div id="orderClientFilterNote" class="panel-sub">Todos os clientes do recorte.</div></div></div>
        <label class="order-search-label" for="orderClientSearch">Buscar cliente</label><input id="orderClientSearch" class="order-client-search" type="search" placeholder="Nome ou código do cliente" autocomplete="off">
        <button id="allOrderClients" class="order-client-all" type="button">Todos os clientes</button>
        <div id="orderClientList" class="order-client-list"></div>
      </div>
      <div class="panel order-detail-panel"><div class="panel-title-row"><div><h2 id="orderClientTitle">Todos os clientes</h2><div id="orderDetailNote" class="panel-sub">Pedidos de todos os clientes. Clique em um pedido para ver os itens.</div></div><span id="orderClientTotal" class="panel-chip"></span></div>
        <div id="clientOrders"></div>
        <div id="orderLineDetails" class="order-line-details"></div>
      </div>
    </div>
    <div class="small-note order-stock-note">O arquivo de pedidos atual não traz saldo de estoque. Quando essa informação estiver disponível na integração, os itens serão marcados como disponíveis ou em falta; por enquanto, o saldo aparece como “não informado”.</div>`;
  $('#orderClientSearch').value=state.orderClientQuery;
  $('#orderClientSearch').addEventListener('input',e=>{state.orderClientQuery=e.target.value;updateOrderExplorer()});
  $('#allOrderClients').addEventListener('click',()=>{state.selectedOrderClient='';state.selectedOrderKey='';state.orderClientQuery='';$('#orderClientSearch').value='';updateOrderExplorer()});
  $$('.order-position-choice').forEach(button=>button.addEventListener('click',()=>{const status=button.dataset.orderStatus;state.selectedOrderStatus=state.selectedOrderStatus===status?'':status;state.selectedOrderClient='';state.selectedOrderKey='';updateOrderExplorer()}));
  updateOrderExplorer();
}
function orderClientCode(order){return String(order.client??'')||'__sem_cliente'}
function orderCount(count){return `${integer(count)} ${Number(count)===1?'pedido':'pedidos'}`}
function orderExplorerData(){
  const rows=(state.orderPayload?.orders||[]).filter(x=>!state.selectedOrderStatus||x.status===state.selectedOrderStatus),query=normalize(state.orderClientQuery),groups=new Map();
  rows.forEach(order=>{
    const code=orderClientCode(order);
    if(!groups.has(code))groups.set(code,{code,labelCode:String(order.client??''),name:order.clientName||String(order.client??'')||'Cliente sem identificação',orders:[],value:0});
    const group=groups.get(code);group.orders.push(order);group.value+=Number(order.value)||0;
  });
  const clients=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const visible=clients.filter(x=>!query||normalize(x.name).includes(query)||normalize(x.labelCode).includes(query));
  const selected=visible.find(x=>x.code===state.selectedOrderClient);
  const orders=selected?selected.orders:visible.flatMap(x=>x.orders);
  return {clients,visible,selected,orders,value:orders.reduce((sum,x)=>sum+Number(x.value||0),0)};
}
function updateOrderExplorer(){
  const {visible,selected,orders,value}=orderExplorerData();
  if(!selected)state.selectedOrderClient='';
  if(!orders.some(x=>x.key===state.selectedOrderKey))state.selectedOrderKey='';
  const statusLabel={PENDENTE:'Pendente',LIBERADO:'Liberado',BLOQUEADO:'Bloqueado'},statusClass={PENDENTE:'pending',LIBERADO:'released',BLOQUEADO:'blocked'};
  const position=state.selectedOrderStatus?statusLabel[state.selectedOrderStatus]||state.selectedOrderStatus:'Todas as posições';
  $$('.order-position-choice').forEach(button=>{const active=button.dataset.orderStatus===state.selectedOrderStatus;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active))});
  $('#orderClientFilterNote').textContent=`${integer(visible.length)} ${visible.length===1?'cliente':'clientes'} · ${position}`;
  $('#allOrderClients').classList.toggle('selected',!selected&&!state.orderClientQuery);
  $('#allOrderClients').setAttribute('aria-pressed',String(!selected&&!state.orderClientQuery));
  $('#orderClientList').innerHTML=visible.length?visible.map(x=>`<button type="button" class="order-client-choice ${selected?.code===x.code?'selected':''}" data-client="${esc(x.code)}" aria-pressed="${selected?.code===x.code}"><span><strong>${esc(x.name)}</strong><small>Cód. ${esc(x.labelCode||'—')} · ${orderCount(x.orders.length)}</small></span><b>${money(x.value,true)}</b></button>`).join(''):'<div class="empty">Nenhum cliente corresponde aos filtros.</div>';
  $$('.order-client-choice').forEach(button=>button.addEventListener('click',()=>{state.selectedOrderClient=state.selectedOrderClient===button.dataset.client?'':button.dataset.client;state.selectedOrderKey=visible.find(x=>x.code===state.selectedOrderClient)?.orders[0]?.key||'';updateOrderExplorer()}));
  $('#orderClientTitle').textContent=selected?.name||(state.orderClientQuery?'Clientes da busca':'Todos os clientes');
  $('#orderDetailNote').textContent=`${position} · ${selected?'Pedidos deste cliente':'Pedidos de todos os clientes listados'}. Clique no número do pedido para ver os itens.`;
  $('#orderClientTotal').textContent=`${orderCount(orders.length)} · ${money(value,true)}`;
  $('#clientOrders').innerHTML=orders.length?`<div class="table-wrap order-table-wrap"><table class="order-table order-browser-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Posição</th><th>Data</th><th>RCA</th><th>Itens</th><th class="align-right">Valor</th></tr></thead><tbody>${orders.map(x=>`<tr class="order-select-row ${state.selectedOrderKey===x.key?'selected':''}"><td data-label="Pedido"><button type="button" class="order-open" data-order="${esc(x.key)}" aria-label="Ver itens do pedido ${esc(x.order||'sem número')}" aria-expanded="${state.selectedOrderKey===x.key}">${esc(x.order||'—')} <span aria-hidden="true">↗</span></button></td><td data-label="Cliente" class="order-customer-cell"><strong>${esc(x.clientName||x.client||'Cliente sem identificação')}</strong><small class="item-code">Cód. ${esc(x.client??'—')}</small></td><td data-label="Posição"><span class="order-status ${statusClass[x.status]||''}">${esc(statusLabel[x.status]||x.status)}</span></td><td data-label="Data">${fmtDate(x.date)}</td><td data-label="RCA">${esc(x.rcaName||x.rca||'—')}</td><td data-label="Itens">${integer(x.lines||x.items?.length||0)}</td><td data-label="Valor" class="align-right"><strong>${money(x.value,true)}</strong></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhum pedido corresponde aos filtros selecionados.</div>';
  $$('.order-open').forEach(button=>button.addEventListener('click',()=>{state.selectedOrderKey=state.selectedOrderKey===button.dataset.order?'':button.dataset.order;updateOrderExplorer();if(state.selectedOrderKey)$('#orderLineDetails').scrollIntoView({behavior:'smooth',block:'nearest'})}));
  const order=orders.find(x=>x.key===state.selectedOrderKey);
  $('#orderLineDetails').innerHTML=order?`<div class="order-lines-heading"><div><h3>Itens do pedido ${esc(order.order||'')}</h3><span>${esc(order.clientName||order.client||'Cliente sem identificação')} · ${esc(order.department||'')}</span></div><span class="order-status ${statusClass[order.status]||''}">${esc(statusLabel[order.status]||order.status)}</span></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th class="align-right">Quantidade</th><th>Estoque</th><th class="align-right">Valor do item</th></tr></thead><tbody>${(order.items||[]).map(item=>`<tr><td><strong>${esc(item.productName||'Produto sem descrição')}</strong><small class="item-code">${item.product!=null?'Cód. '+esc(item.product):''}</small></td><td class="align-right">${item.quantity?dec(item.quantity):'—'}</td><td>${item.stock==null?'<span class="stock-unknown">Não informado</span>':item.stock>0?`<span class="stock-available">${dec(item.stock)} disponível</span>`:'<span class="stock-missing">Sem estoque</span>'}</td><td class="align-right">${money(item.value,true)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">A base não contém o detalhamento dos itens deste pedido.</td></tr>'}</tbody></table></div>`:'<div class="order-lines-empty">Selecione um pedido para abrir o detalhamento dos itens.</div>';
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


const COVERAGE_DEPARTMENTS=[
  {value:'Nutrição',field:'nutrition',route:'nutritionRoute'},
  {value:'Saúde Animal',field:'animalHealth',route:'animalHealthRoute'},
  {value:'Aves',field:'poultry',route:''},
  {value:'Suínos',field:'swine',route:''}
];
const COVERAGE_COLORS=['#3157B7','#159A88','#CE6B34','#7652B7','#C54868','#3F82B8','#8A7A26','#437B55','#BD4B2C','#5D6FBA','#A5418B','#327C91','#8B5C3B','#526A39','#8463A8','#A34E5B','#2F8F70','#586179'];
function xmlEscape(value){return String(value||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]});}
function normCoverage(value){return normalize(value).replace(/\s+/g,' ');}
function coverageRcaKey(name){return normalize(String(name||'')).replace(/\s*\/\s*/g,' / ').replace(/\s+/g,' ')}
function coverageRcaOptions(rows,department){
  const groups=new Map();
  rows.forEach(row=>{const name=coverageAssignment(row,department);if(!name)return;const key=coverageRcaKey(name);if(!groups.has(key))groups.set(key,new Map());const variants=groups.get(key);variants.set(name,(variants.get(name)||0)+1)});
  return [...groups.entries()].map(([key,variants])=>({key,label:[...variants.entries()].sort((a,b)=>b[1]-a[1])[0][0]})).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
}
function coverageAssignment(row,department){
  const def=COVERAGE_DEPARTMENTS.find(x=>x.value===department)||COVERAGE_DEPARTMENTS[0];
  return String(row?.[def.field]||'').trim();
}
function coveragePending(row,department){
  const status=String(row?.status||'').trim().toUpperCase();
  const person=coverageAssignment(row,department);
  if(!person||person.indexOf('/')>=0)return true;
  if(status==='CONFERIDO')return false;
  const note=String(row?.notes||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const departmentLabels=['NUTRIÇÃO','SAÚDE ANIMAL','AVES','SUÍNOS'];
  const scopedDepartments=departmentLabels.filter(label=>note.includes(normalize(label)+' —'));
  if(scopedDepartments.length)return scopedDepartments.some(label=>normalize(label)===normalize(department));
  return true;
}
function coverageFilteredRows(){
  const rows=state.coverage?.cities||[],f=state.coverageFilters;
  return rows.filter(row=>{
    const selectedUfs=normalizeMulti(f.uf);if(selectedUfs.length&&!selectedUfs.includes(row.uf))return false;
    if(f.rca!=='Todos'&&coverageRcaKey(coverageAssignment(row,f.department))!==f.rca)return false;
    const pending=coveragePending(row,f.department);
    if(f.status==='Conferidas'&&pending)return false;
    if(f.status==='Pendentes'&&!pending)return false;
    return true;
  });
}
function coverageRowMap(rows,department){
  const map=new Map();
  rows.forEach(row=>map.set(aliasCity(row.city)+'|'+row.uf,row));
  return map;
}
async function renderCoverageView(){
  const cities=state.coverage?.cities||[],f=state.coverageFilters;
  $('#content').innerHTML=
    '<div class="city-view-switch" role="group" aria-label="Visualização de cidades"><button type="button" data-city-view="sales">Faturamento</button><button type="button" class="active" data-city-view="coverage">Cobertura territorial</button></div>'+
    '<div class="coverage-heading"><div><h2>Distribuição de cobertura comercial</h2><p>As cores representam o RCA responsável pela linha selecionada. Áreas em revisão ficam destacadas.</p></div><div class="coverage-downloads"><button id="coverageRefresh" class="btn secondary small">Atualizar matriz</button><button id="coveragePng" class="btn primary small">Baixar PNG</button><button id="coverageSvg" class="btn secondary small">Baixar SVG</button></div></div>'+
    '<div class="coverage-controls panel">'+
      '<label>Linha comercial<select id="coverageDepartment">'+COVERAGE_DEPARTMENTS.map(x=>'<option value="'+esc(x.value)+'" '+(f.department===x.value?'selected':'')+'>'+esc(x.value)+'</option>').join('')+'</select></label>'+
      '<label>Estado<div id="coverageUf" class="multi-select"></div></label>'+
      '<label>RCA<select id="coverageRca"><option value="Todos">Todos os RCAs</option></select></label>'+
      '<label>Situação<select id="coverageStatus"><option value="Todas" '+(f.status==='Todas'?'selected':'')+'>Todas</option><option value="Conferidas" '+(f.status==='Conferidas'?'selected':'')+'>Conferidas</option><option value="Pendentes" '+(f.status==='Pendentes'?'selected':'')+'>Pendentes</option></select></label>'+
    '</div>'+
    '<div id="coverageLoad" class="coverage-load '+(state.coverage?'hidden':'')+'">Carregando matriz de cobertura…</div>'+
    '<div id="coverageError" class="coverage-error hidden"></div>'+
    '<div id="coverageStats" class="coverage-stats"></div>'+
    '<div class="grid coverage-layout"><div class="panel coverage-map-panel"><div class="panel-title-row"><div><h2>Mapa por município</h2><div class="panel-sub">Clique em um município para conferir responsável e rota.</div></div><span id="coverageBaseDate" class="badge"></span></div><div id="coverageMap"></div></div>'+
    '<div class="panel coverage-side"><div class="panel-title-row"><div><h2>Legenda da cobertura</h2><div class="panel-sub">Cada cor identifica um RCA nesta linha.</div></div></div><div id="coverageLegend" class="coverage-legend"></div><div class="coverage-detail" id="coverageDetail"></div></div></div>'+
    '<div class="coverage-footnote">Fonte: matriz de cobertura comercial no Google Drive. Cidades sem responsável ou com situação diferente de “Conferido” são exibidas como pendentes.</div>';
  $$('.city-view-switch button').forEach(b=>b.addEventListener('click',()=>{state.cityView=b.dataset.cityView;renderCidades(state.lastPayload||{})}));
  fillMultiSelect($('#coverageUf'),[...new Set(cities.map(x=>x.uf))].sort().map(x=>({value:x,label:x})),f.uf,()=>{
    f.uf=selectedMulti('coverageUf');
    state.coverageSelection=null;
    renderCoverageResults();
  });
  $('#coverageDepartment').addEventListener('change',e=>{f.department=e.target.value;f.rca='Todos';state.coverageSelection=null;renderCoverageView()});
  $('#coverageRca').addEventListener('change',e=>{f.rca=e.target.value;state.coverageSelection=null;renderCoverageView()});
  $('#coverageStatus').addEventListener('change',e=>{f.status=e.target.value;state.coverageSelection=null;renderCoverageView()});
  $('#coverageRefresh').addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;button.textContent='Atualizando…';try{state.coverage=await api('/api/coverage',{method:'POST',body:JSON.stringify({force:true})});state.coverageSelection=null;renderCoverageView()}catch(error){const box=$('#coverageError');if(box){box.textContent='Não foi possível atualizar a matriz: '+(error?.message||String(error));box.classList.remove('hidden')}}finally{if(button.isConnected){button.disabled=false;button.textContent='Atualizar matriz'}}});
  $('#coveragePng').addEventListener('click',()=>downloadCoverageMap('png'));
  $('#coverageSvg').addEventListener('click',()=>downloadCoverageMap('svg'));
  if(!state.coverage){
    api('/api/coverage').then(data=>{
      state.coverage=data;
      $('#coverageLoad')?.classList.add('hidden');
      renderCoverageView();
    }).catch(error=>{
      const box=$('#coverageError');
      if(box){box.textContent='Não foi possível ler a matriz de cobertura: '+(error?.message||String(error));box.classList.remove('hidden')}
      $('#coverageLoad')?.classList.add('hidden');
    });
    return;
  }
  renderCoverageResults();
}
function renderCoverageResults(){
  const cities=state.coverage?.cities||[],f=state.coverageFilters;
  const allowed=coverageFilteredRows(),def=COVERAGE_DEPARTMENTS.find(x=>x.value===f.department)||COVERAGE_DEPARTMENTS[0];
  const rcas=coverageRcaOptions(cities,f.department);
  const rcaEl=$('#coverageRca');
  rcaEl.innerHTML='<option value="Todos">Todos os RCAs</option>'+rcas.map(x=>'<option value="'+esc(x.key)+'" '+(f.rca===x.key?'selected':'')+'>'+esc(x.label)+'</option>').join('');
  const pendingCount=allowed.filter(x=>coveragePending(x,f.department)).length;
  const coveredCount=allowed.length-pendingCount;
  const uniqueRcas=new Set(allowed.map(x=>coverageRcaKey(coverageAssignment(x,f.department))).filter(Boolean));
  $('#coverageStats').innerHTML=
    '<div class="coverage-stat"><span>Municípios no recorte</span><strong>'+integer(allowed.length)+'</strong></div>'+
    '<div class="coverage-stat"><span>Conferidos</span><strong>'+integer(coveredCount)+'</strong></div>'+
    '<div class="coverage-stat pending"><span>Em revisão / sem responsável</span><strong>'+integer(pendingCount)+'</strong></div>'+
    '<div class="coverage-stat"><span>RCAs na linha</span><strong>'+integer(uniqueRcas.size)+'</strong></div>';
  $('#coverageBaseDate').textContent=state.coverage.updatedAt?'Base '+fmtDate(state.coverage.updatedAt):'Matriz comercial';
  const palette=new Map(rcas.map((item,index)=>[item.key,COVERAGE_COLORS[index%COVERAGE_COLORS.length]]));
  const counts=new Map();
  allowed.forEach(row=>{
    const name=coveragePending(row,f.department)?'Em revisão / sem responsável':coverageAssignment(row,f.department);
    const key=name.startsWith('Em revisão')?'__pending__':coverageRcaKey(name),entry=counts.get(key)||{name:name,count:0};entry.count++;counts.set(key,entry);
  });
  const legend=[...counts.entries()].sort((a,b)=>a[1].name.startsWith('Em revisão')?1:b[1].name.startsWith('Em revisão')?-1:a[1].name.localeCompare(b[1].name,'pt-BR'));
  $('#coverageLegend').innerHTML=legend.map(([key,item])=>'<div class="coverage-legend-row"><span class="coverage-swatch" style="background:'+ (key==='__pending__'?'#E4A33A':palette.get(key)||'#9AA3B5')+'"></span><strong>'+esc(item.name)+'</strong><span>'+integer(item.count)+'</span></div>').join('')||'<div class="empty">Nenhuma cidade neste recorte.</div>';
  renderCoverageDetail();
  loadCoverageMap(allowed,palette,def);
}
function renderCoverageDetail(){
  const box=$('#coverageDetail'),row=state.coverageSelection;
  if(!box)return;
  if(!row){box.innerHTML='<div class="coverage-detail-empty"><span>⌖</span><strong>Selecione um município</strong><p>Confira os responsáveis e as rotas comerciais da cidade.</p></div>';return}
  box.innerHTML='<div class="coverage-detail-title"><span>'+esc(row.uf)+'</span><h3>'+esc(row.city)+'</h3></div>'+
    '<div class="coverage-detail-row"><span>Nutrição</span><strong>'+esc(row.nutrition||'Não definido')+'</strong></div>'+
    '<div class="coverage-detail-row"><span>Saúde Animal</span><strong>'+esc(row.animalHealth||'Não definido')+'</strong></div>'+
    '<div class="coverage-detail-row"><span>Aves</span><strong>'+esc(row.poultry||'—')+'</strong></div>'+
    '<div class="coverage-detail-row"><span>Suínos</span><strong>'+esc(row.swine||'—')+'</strong></div>'+
    '<div class="coverage-detail-row"><span>Rota comercial · Nutrição</span><strong>'+esc(row.nutritionRoute||'—')+'</strong></div>'+
    '<div class="coverage-detail-row"><span>Rota comercial · Saúde Animal</span><strong>'+esc(row.animalHealthRoute||'—')+'</strong></div>'+
    '<div class="coverage-detail-row"><span>Rota de entrega</span><strong>'+esc(row.deliveryRoute||'—')+'</strong></div>'+
    '<div class="coverage-detail-status '+(coveragePending(row,state.coverageFilters.department)?'pending':'')+'">'+esc(row.status||'Sem situação cadastrada')+'</div>'+
    (row.notes?'<p class="coverage-notes">'+esc(row.notes)+'</p>':'');
}
function coverageGeoFor(uf){
  if(state.coverageGeo[uf])return Promise.resolve(state.coverageGeo[uf]);
  const codes={MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',BA:'29'};
  if(!codes[uf])return Promise.reject(new Error('Estado sem geometria cadastrada: '+uf));
  return fetch('https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-'+codes[uf]+'-mun.json')
    .then(res=>{if(!res.ok)throw new Error('Falha ao carregar o mapa de '+uf);return res.json()})
    .then(json=>{state.coverageGeo[uf]=json;return json});
}
async function loadCoverageMap(rows,palette,definition){
  const drawId=++state.coverageDrawId;
  $('#coverageError')?.classList.add('hidden');
  const el=$('#coverageMap');if(!el)return;
  if(state.map){try{state.map.remove()}catch{}state.map=null}
  const selectedUfs=normalizeMulti(state.coverageFilters.uf),ufs=selectedUfs.length?selectedUfs:[...new Set((state.coverage?.cities||[]).map(x=>x.uf))];
  $('#coverageMap').innerHTML='';
  const features=[];
  try{
    const geos=await Promise.all(ufs.map(uf=>coverageGeoFor(uf)));
    geos.forEach((geo,index)=>geo.features?.forEach(feature=>features.push({uf:ufs[index],feature})));
  }catch(error){
    const box=$('#coverageError');if(box){box.textContent=error?.message||String(error);box.classList.remove('hidden')}
    return;
  }
  if(drawId!==state.coverageDrawId||!document.body.contains(el))return;
  const byCity=coverageRowMap(rows,definition.value),allByCity=coverageRowMap(state.coverage?.cities||[],definition.value),featureUfs=new Map(features.map(item=>[item.feature,item.uf]));
  state.map=L.map(el,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:10}).setView([-7.3,-39.5],5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,opacity:.12}).addTo(state.map);
  const cityLabels=L.layerGroup();
  const layer=L.geoJSON({type:'FeatureCollection',features:features.map(x=>x.feature)},{
    style:feature=>{
      const name=feature.properties?.name||feature.properties?.NOME||'';
      const uf=feature.properties?.uf||feature.properties?.UF||'';
      const stateUf=featureUfs.get(feature)||uf;
      const key=aliasCity(name)+'|'+stateUf,row=allByCity.get(key),visible=byCity.get(key);
      const pending=row&&coveragePending(row,definition.value);
      const person=row?coverageAssignment(row,definition.value):'';
      const outside=!visible;
      return {color:pending?'#C08422':outside?'#D8DDE7':'#FFFFFF',weight:pending?1.1:.75,dashArray:pending?'3 3':null,fillColor:pending?'#E8E1D1':person?(palette.get(coverageRcaKey(person))||'#8993A8'):'#E7EAF0',fillOpacity:outside ? .2 : pending ? .78 : .88};
    },
    onEachFeature:(feature,leafletLayer)=>{
      const name=feature.properties?.name||feature.properties?.NOME||'';
      const uf=featureUfs.get(feature)||feature.properties?.uf||'';
      const key=aliasCity(name)+'|'+uf,row=allByCity.get(key),visible=byCity.get(key);
      const person=row?coverageAssignment(row,definition.value):'';
      const text='<b>'+esc(row?.city||name)+' - '+esc(uf)+'</b><br>'+esc(definition.value)+': '+esc(person||'Não definido')+'<br>Situação: '+esc(row?.status||'Sem registro na matriz');
      leafletLayer.bindTooltip(text,{sticky:true});
      if(visible&&row){
        const labelIcon=L.divIcon({className:'coverage-city-label-icon',html:'<span style="display:block;transform:translate(-50%,-50%);white-space:nowrap;background:rgba(255,255,255,.86);border:1px solid rgba(30,38,85,.28);border-radius:3px;padding:1px 3px;color:#1E2655;font:700 9px/1.1 Arial,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.2);pointer-events:none">'+esc(row.city||name)+'</span>',iconAnchor:[0,0]});
        L.marker(leafletLayer.getBounds().getCenter(),{icon:labelIcon,interactive:false,keyboard:false}).addTo(cityLabels);
      }
      if(row)leafletLayer.on('click',()=>{state.coverageSelection=row;renderCoverageDetail()});
    }
  }).addTo(state.map);
  const syncCityLabels=()=>{
    if(!state.map)return;
    const show=state.map.getZoom()>=9;
    if(show&&!state.map.hasLayer(cityLabels))cityLabels.addTo(state.map);
    else if(!show&&state.map.hasLayer(cityLabels))state.map.removeLayer(cityLabels);
  };
  state.map.on('zoomend',syncCityLabels);
  try{state.map.fitBounds(layer.getBounds(),{padding:[12,12]})}catch{}
  syncCityLabels();
}
function coveragePath(geometry,project){
  const paths=[];
  const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  polygons.forEach(poly=>poly.forEach(ring=>{
    let d='';
    ring.forEach((point,i)=>{const p=project(point[0],point[1]);d+=(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)});
    paths.push(d+'Z');
  }));
  return paths.join(' ');
}
function coverageTextWidth(text,size){
  let width=0;
  for(const ch of Array.from(String(text||''))){
    if(/\s/.test(ch))width+=size*.3;
    else if(/[ilíIÍjJtf.,:;'’!|]/.test(ch))width+=size*.31;
    else if(/[MWÁÊÔQO@%]/.test(ch))width+=size*.82;
    else width+=size*.56;
  }
  return width;
}
function coverageWrapLabel(text,size,maxWidth){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean),lines=[];
  let line='';
  const pushLongWord=word=>{
    let part='';
    for(const ch of Array.from(word)){
      if(part&&coverageTextWidth(part+ch,size)>maxWidth){lines.push(part);part=ch}
      else part+=ch;
    }
    return part;
  };
  words.forEach(word=>{
    if(coverageTextWidth(word,size)>maxWidth){
      if(line){lines.push(line);line=''}
      line=pushLongWord(word);
      return;
    }
    const candidate=line?line+' '+word:word;
    if(coverageTextWidth(candidate,size)<=maxWidth)line=candidate;
    else{if(line)lines.push(line);line=word}
  });
  if(line)lines.push(line);
  return lines;
}
function coverageFitLabel(text,radius,frameWidth){
  if(!(radius>0))return null;
  const label=String(text||'').replace(/\s+/g,' ').trim().toLocaleUpperCase('pt-BR');
  if(!label)return null;
  const widthAtOne=coverageTextWidth(label,1);
  const radiusSize=Math.max(.78,Math.min(5.4,radius*.34));
  const safeWidth=Math.max(1,Math.min(42,Number.isFinite(frameWidth)?frameWidth:42));
  const size=Math.max(.7,Math.min(radiusSize,safeWidth/Math.max(1,widthAtOne)));
  return{text:label,size};
}
function coverageRingContains(point,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if(((a[1]>point[1])!==(b[1]>point[1]))&&(point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]))inside=!inside;
  }
  return inside;
}
function coveragePointSegmentDistance(point,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
  return Math.hypot(point[0]-(a[0]+t*dx),point[1]-(a[1]+t*dy));
}
function coveragePolygonInteriorPoint(coordinates){
  const rings=(coordinates||[]).map(ring=>ring.map(point=>[point[0],point[1]]).filter(point=>Number.isFinite(point[0])&&Number.isFinite(point[1])));
  const outer=rings[0];if(!outer||outer.length<4)return null;
  const xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),width=maxX-minX,height=maxY-minY;
  if(!(width>0&&height>0))return null;
  const inside=point=>coverageRingContains(point,outer)&&!rings.slice(1).some(ring=>coverageRingContains(point,ring));
  const distance=point=>{
    if(!inside(point))return -1;
    let best=Infinity;
    rings.forEach(ring=>{for(let i=1;i<ring.length;i++)best=Math.min(best,coveragePointSegmentDistance(point,ring[i-1],ring[i]))});
    return best;
  };
  let best=null,bestDistance=-1;
  const centroidCandidate=(()=>{
    let area=0,cx=0,cy=0;
    for(let i=0,j=outer.length-1;i<outer.length;j=i++){
      const cross=outer[j][0]*outer[i][1]-outer[i][0]*outer[j][1];area+=cross;cx+=(outer[j][0]+outer[i][0])*cross;cy+=(outer[j][1]+outer[i][1])*cross;
    }
    if(Math.abs(area)<1e-12)return null;
    return[cx/(3*area),cy/(3*area)];
  })();
  [centroidCandidate,[(minX+maxX)/2,(minY+maxY)/2]].forEach(point=>{if(!point)return;const d=distance(point);if(d>bestDistance){best=point;bestDistance=d}});
  const divisions=20;
  for(let iy=0;iy<=divisions;iy++)for(let ix=0;ix<=divisions;ix++){
    const point=[minX+width*ix/divisions,minY+height*iy/divisions],d=distance(point);
    if(d>bestDistance){best=point;bestDistance=d}
  }
  if(!best||bestDistance<=0)return null;
  let step=Math.min(width,height)/divisions;
  for(let round=0;round<8;round++){
    step/=2;
    for(let iy=-1;iy<=1;iy++)for(let ix=-1;ix<=1;ix++){
      const point=[best[0]+ix*step,best[1]+iy*step];
      if(point[0]<minX||point[0]>maxX||point[1]<minY||point[1]>maxY)continue;
      const d=distance(point);
      if(d>bestDistance){best=point;bestDistance=d}
    }
  }
  return{point:best,radius:bestDistance};
}
function coverageGeometryInteriorPoint(geometry,project){
  const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  let best=null;
  polygons.forEach(polygon=>{
    const projected=(polygon||[]).map(ring=>ring.map(point=>project(point[0],point[1])));
    const result=coveragePolygonInteriorPoint(projected);
    if(result&&(!best||result.radius>best.radius))best=result;
  });
  return best;
}
function buildCoverageSvg(){
  const f=state.coverageFilters,definition=COVERAGE_DEPARTMENTS.find(x=>x.value===f.department)||COVERAGE_DEPARTMENTS[0];
  const rows=coverageFilteredRows(),map=coverageRowMap(rows,definition.value),all=coverageRowMap(state.coverage?.cities||[],definition.value);
  const selectedUfs=normalizeMulti(f.uf),ufs=selectedUfs.length?selectedUfs:[...new Set((state.coverage?.cities||[]).map(x=>x.uf))];
  const features=[];
  ufs.forEach(uf=>state.coverageGeo[uf]?.features?.forEach(feature=>features.push({uf,feature})));
  const points=[];
  features.forEach(item=>{const g=item.feature.geometry;const polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];polygons.forEach(poly=>poly.forEach(ring=>ring.forEach(pt=>points.push([pt[0]*Math.cos(-7*Math.PI/180),pt[1]]))))});
  if(!points.length)throw new Error('O mapa ainda não está pronto para exportação.');
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
  const W=1600,H=1120,mapBox={x:48,y:152,w:1050,h:910},legendX=1150,scale=Math.min(mapBox.w/(maxX-minX),mapBox.h/(maxY-minY));
  const project=(lon,lat)=>{const x=lon*Math.cos(-7*Math.PI/180),y=lat;return [mapBox.x+(x-minX)*scale,mapBox.y+(maxY-y)*scale]};
  const rcas=coverageRcaOptions(state.coverage?.cities||[],definition.value);
  const palette=new Map(rcas.map((item,index)=>[item.key,COVERAGE_COLORS[index%COVERAGE_COLORS.length]]));
  let shapes='',labels='';
  features.forEach(item=>{
    const feature=item.feature,name=feature.properties?.name||feature.properties?.NOME||'',row=all.get(aliasCity(name)+'|'+item.uf),visible=map.get(aliasCity(name)+'|'+item.uf),pending=row&&coveragePending(row,definition.value),person=row?coverageAssignment(row,definition.value):'';
    const fill=visible?(pending?'url(#pendingHatch)':(palette.get(coverageRcaKey(person))||'#8993A8')):'#EDF0F5';
    const stroke=pending?'#C08422':'#FFFFFF';
    shapes+='<path d="'+coveragePath(feature.geometry,project)+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+(pending?'1.2':'0.75')+'"><title>'+xmlEscape((row?.city||name)+' - '+item.uf+' · '+(person||'Sem responsável')+' · '+(row?.status||'Sem registro'))+'</title></path>';
    if(visible&&row){
      const label=String(row.city||name).replace(/\\s+/g,' ').trim(),anchor=coverageGeometryInteriorPoint(feature.geometry,project);
      const frameWidth=anchor?Math.max(1,Math.min(anchor.point[0]-8,W-8-anchor.point[0])):1;
      const layout=anchor&&coverageFitLabel(label,anchor.radius,frameWidth);
      if(layout){
        labels+='<text x="'+anchor.point[0].toFixed(2)+'" y="'+anchor.point[1].toFixed(2)+'" text-anchor="middle" dominant-baseline="central" fill="#244767" font-family="Arial,sans-serif" font-size="'+layout.size.toFixed(2)+'" font-weight="600" letter-spacing=".06" paint-order="stroke" stroke="#FFFFFF" stroke-width=".85" stroke-opacity=".92">'+xmlEscape(layout.text)+'</text>';
      }
    }
  });
  const visibleCounts=new Map();
  rows.forEach(row=>{const name=coveragePending(row,definition.value)?'Em revisão / sem responsável':coverageAssignment(row,definition.value),key=name.startsWith('Em revisão')?'__pending__':coverageRcaKey(name),entry=visibleCounts.get(key)||{name:name,count:0};entry.count++;visibleCounts.set(key,entry)});
  let legend='',y=185;
  [...visibleCounts.entries()].sort((a,b)=>a[1].name.startsWith('Em revisão')?1:b[1].name.startsWith('Em revisão')?-1:a[1].name.localeCompare(b[1].name,'pt-BR')).forEach(([key,item])=>{
    const color=key==='__pending__'?'url(#pendingHatch)':palette.get(key)||'#8993A8';
    legend+='<rect x="'+legendX+'" y="'+y+'" width="22" height="22" rx="5" fill="'+color+'" stroke="#D6DCE7"/><text x="'+(legendX+34)+'" y="'+(y+15)+'" class="legendText">'+xmlEscape(item.name)+'</text><text x="1530" y="'+(y+15)+'" class="legendCount">'+item.count+'</text>';y+=34;
  });
  if(!legend)legend='<text x="'+legendX+'" y="'+y+'" class="legendText">Nenhuma cidade neste recorte.</text>';
  const subtitle='Linha: '+f.department+'  ·  UF: '+(selectedUfs.length?selectedUfs.join(', '):'Todos')+'  ·  Situação: '+f.status;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><defs><pattern id="pendingHatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#F3E9D6"/><line x1="0" y1="0" x2="0" y2="8" stroke="#C08422" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="#FFFFFF"/><text x="48" y="58" class="title">Cobertura comercial por município</text><text x="48" y="94" class="subtitle">'+xmlEscape(subtitle)+'</text><text x="48" y="126" class="source">Dashboard de Supervisão Rebanho · Matriz de cobertura comercial</text>'+shapes+labels+'<line x1="1130" y1="145" x2="1130" y2="1075" stroke="#E4E8F0"/><text x="'+legendX+'" y="150" class="legendTitle">Legenda · '+xmlEscape(f.department)+'</text>'+legend+'<rect x="'+legendX+'" y="980" width="22" height="22" rx="5" fill="url(#pendingHatch)" stroke="#C08422"/><text x="'+(legendX+34)+'" y="995" class="legendText">Área em revisão / sem responsável</text><text x="'+legendX+'" y="1048" class="source">Municípios no recorte: '+rows.length+'</text><text x="48" y="1090" class="source">Rótulos horizontais em caixa alta; podem ultrapassar os limites municipais.</text><style>.title{font:700 34px Arial,sans-serif;fill:#1E2655}.subtitle{font:600 18px Arial,sans-serif;fill:#39425E}.source{font:13px Arial,sans-serif;fill:#747D90}.legendTitle{font:700 20px Arial,sans-serif;fill:#1E2655}.legendText{font:14px Arial,sans-serif;fill:#252C3E}.legendCount{font:700 13px Arial,sans-serif;fill:#606A80;text-anchor:end}</style></svg>';
}
function downloadCoverageMap(type){
  try{
    const svg=buildCoverageSvg(),blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    const suffix=state.coverageFilters.department.toLowerCase().replace(/\s+/g,'-');
    if(type==='svg'){a.href=url;a.download='cobertura-comercial-'+suffix+'-alta-resolucao.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
    const image=new Image();
    image.onload=()=>{
      const canvas=document.createElement('canvas');canvas.width=6400;canvas.height=4480;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx){URL.revokeObjectURL(url);throw new Error('Não foi possível preparar a imagem em alta resolução.')}
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      canvas.toBlob(png=>{
        if(!png){URL.revokeObjectURL(url);throw new Error('Não foi possível gerar o PNG em alta resolução.')}
        const link=document.createElement('a');link.href=URL.createObjectURL(png);link.download='cobertura-comercial-'+suffix+'-6400x4480.png';link.click();
        setTimeout(()=>URL.revokeObjectURL(link.href),1000);URL.revokeObjectURL(url)
      },'image/png')
    };
    image.onerror=()=>{URL.revokeObjectURL(url);throw new Error('Não foi possível gerar a imagem PNG.')};image.src=url;
  }catch(error){alert(error?.message||String(error))}
}



