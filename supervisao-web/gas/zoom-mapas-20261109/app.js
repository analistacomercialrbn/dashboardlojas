const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const PAGE_META = {
  history:['Histórico macro','Evolução mensal e anual · valores por origem'],
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
  dailyMode:'today',
  dailyDate:'',
  historyYear:null,
  historySource:null,
  historyGeo:null,
  historyScene:0,
  historyMode:'year',
  historyUf:'CE',
  historyPlaying:true,
  historyTimer:null,
  historyObserver:null,
  historyEpoch:0,
  historyMapEpoch:0,
  selectedCity:'Todos',
  requestId:0,
  charts:[],
  map:null,
  mapLayers:[],
  coverageDrawId:0,
  lastPayload:null,
  cityView:'sales',
  areaPayload:null,
  areaCity:'',
  areaScope:'nutrition',
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
  if (!sessionStorage.getItem('dashboardSession')) { showLogin(); return; }
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
async function enterApp(){
 if(logOverviewArea()&&logPageAllowed('overview')){
  $('#loginView').classList.add('hidden');
  LOG.page='overview';
  await openModule('logistics');
 }else showModules();
}
function renderUser(){
  $('#historyNav')?.classList.toggle('hidden',!['ADMIN','DIRETOR','GERENTE'].includes(state.user?.perfil));
  $('#usersNav')?.classList.add('hidden');
  const u=state.user||{};
  $('#userCard').innerHTML=`<div class="avatar">${esc(initials(u.nome))}</div><div><div class="user-name">${esc(u.nome||u.login)}</div><div class="user-role">${esc(u.formationOnly?'Formação de Carga':(u.perfil||'').toLowerCase())}</div></div>`;
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
  installTableSorting();
  const drawer=$('#appMenu'),toggle=$('#menuToggle'),backdrop=$('#menuBackdrop');
  const closeMenu=()=>{drawer.hidden=true;drawer.inert=true;backdrop.hidden=true;toggle.setAttribute('aria-expanded','false');document.body.classList.remove('menu-is-open');toggle.focus();};
  toggle.addEventListener('click',()=>{drawer.hidden=false;drawer.inert=false;backdrop.hidden=false;toggle.setAttribute('aria-expanded','true');document.body.classList.add('menu-is-open');$('#menuClose').focus();});
  $('#menuClose').addEventListener('click',closeMenu);backdrop.addEventListener('click',closeMenu);
  drawer.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeMenu();}if(e.key==='Tab'){const items=Array.from(drawer.querySelectorAll('button:not(.hidden)')).filter(el=>!el.disabled),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});

  $$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    closeMenu();
    $('#activeMenuLabel').textContent=btn.textContent.trim();
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
  $('#refreshData').addEventListener('click',()=>state.module==='logistics'?logLoad(LOG.kind,true):initData(true));
  $('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}catch{} location.reload()});
}

function setStatus(text,show=true){
  if(show&&state.module&&state.module!=='commercial')return;
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
function initData(force=false,{preserveFilters=false,background=false,preferFresh=false}={}){
  state.loadingData=true;
  if(!background)destroyCharts();
  if(state.worker)state.worker.terminate();
  if(!background)setStatus(force?'Atualizando bases no Apps Script…':'Carregando bases comerciais…',true);
  const workerSource=document.getElementById('workerSource')?.textContent||'';
  if(!workerSource.trim()) throw new Error('O processador local não foi carregado.');
  let workerUrl=null,usingFallback=false,firstWorkerMessage=false,fallbackTimer=null;
  const handleMessage=e=>{
    const m=e.data||{};
    if(m.type==='serverRequest'){
      const activeWorker=state.worker;
      let settled=false;
      const warningTimer=setTimeout(()=>{
        if(settled||background)return;
        setStatus(m.action==='refresh'
          ?'A atualização ainda está em andamento. Pode levar alguns minutos; mantenha esta tela aberta e evite clicar novamente.'
          :'O Apps Script ainda está processando a solicitação. Mantenha esta tela aberta.',true);
      },120000);
      const timeout=setTimeout(()=>{
        if(settled)return;settled=true;clearTimeout(warningTimer);
        activeWorker?.postMessage({type:'serverResponse',requestId:m.requestId,error:'O Apps Script não concluiu a solicitação em 5 minutos e 30 segundos. A atualização pode ainda estar em execução; aguarde antes de tentar novamente.'});
      },330000);
      api('/api/'+m.action,{method:'POST',body:JSON.stringify(m.payload||{})})
        .then(data=>{if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(warningTimer);activeWorker?.postMessage({type:'serverResponse',requestId:m.requestId,data});})
        .catch(error=>{if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(warningTimer);activeWorker?.postMessage({type:'serverResponse',requestId:m.requestId,error:error?.message||String(error)});});
      return;
    }
    if(m.type==='stage'){if(!background)setStatus(m.text,true);}
    else if(m.type==='ready'){
      const retainedFilters=preserveFilters?{...state.filters}:null;
      state.dimensions=m.dimensions;
      setupFilters();
      if(retainedFilters){state.filters=retainedFilters;syncUiFromFilters();}
      state.loadingData=false;
      state.serverUpdatedAt=m.serverUpdatedAt||null;
      renderBaseUpdate(m.updateInfo||{updatedAt:state.serverUpdatedAt});
      beginAutomaticUpdates();
      setStatus('',false);
      queryPage();
      if(m.fromLocal)setTimeout(checkAutomaticUpdate,0);
    }else if(m.type==='result'){
      if((state.module&&state.module!=='commercial')||m.requestId!==state.requestId)return;
      setStatus('',false);
      state.lastPayload=m.payload;
      try{renderPage(m.page,m.payload)}catch(error){
        console.error('Falha ao renderizar a tela do dashboard:',error);
        $('#content').innerHTML=`<div class="empty"><strong>Não foi possível exibir esta tela.</strong><br><br>${esc(error?.message||'Ocorreu uma falha ao montar os gráficos e informações.')}</div>`;
      }
    }else if(m.type==='error'||m.type==='queryError'){
      if(state.module&&state.module!=='commercial')return;
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
      if(!background)setStatus('Iniciando processador compatível com o Apps Script…',true);
      fallback.postMessage({type:'init',force,preferFresh,userScope:state.user?.login+'|'+(state.user?.accessVersion||'')});
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
    worker.postMessage({type:'init',force,preferFresh,userScope:state.user?.login+'|'+(state.user?.accessVersion||'')});
  }catch(error){startFallback(error);}
}
function renderBaseUpdate(info={}){
 if(state.module&&state.module!=='commercial')return;
  const node=$('#lastBaseUpdate');if(!node)return;
  const date=info.updatedAt||state.serverUpdatedAt;
  const stamp=date?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(date)):'';
  const status=info.updateError?' · Atualização com pendência':info.updating?' · Atualizando automaticamente…':'';
  node.textContent=(stamp?'Última atualização: '+stamp:'')+status;node.dateTime=date||'';node.title=info.updateError||info.updateStage||'';
}
async function checkAutomaticUpdate(){
 if(state.module&&state.module!=='commercial')return;
  if(document.hidden||state.loadingData||state.checkingForUpdates||!state.user||!state.serverUpdatedAt)return;
  state.checkingForUpdates=true;
  try{
    const info=await api('/api/info');
    renderBaseUpdate(info);
    if(info.exists&&info.updatedAt&&info.updatedAt!==state.serverUpdatedAt)initData(false,{preserveFilters:true,background:true,preferFresh:true});
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
  if(state.module==='hub')return;
  if(state.module==='administration'){renderUsers();return;}
  if(state.module==='logistics'){logShow();return;}
  state.commercialPage=state.page;
  $('#logFilters')?.classList.add('hidden');
  mountCoverageFilters(state.page==='cidades'&&state.cityView==='coverage');
  $('.filterbar')?.classList.toggle('hidden',['history','bi_settings'].includes(state.page));
  if(state.page==='bi_settings'){if(state.user?.perfil!=='ADMIN')return;++state.requestId;destroyCharts();biSettings();return;}
  if(state.page==='users'){++state.requestId;destroyCharts();$('#pageTitle').textContent='Configurações · Usuários';$('#pageSubtitle').textContent='Perfis, áreas e recortes de informação';setStatus('',false);renderUsers();return;}
  if(!state.worker||!state.dimensions||state.loadingData)return;
  destroyCharts();
  updateHeader();
  setStatus('Atualizando indicadores…',true);
  const requestId=++state.requestId;
  state.worker.postMessage({type:'query',requestId,page:state.page,biWidgets:biConfig()?.widgets.filter(w=>w.page===state.page)||[],filters:{...state.filters,dailyMode:state.dailyMode,dailyDate:state.dailyDate},selectedCity:state.selectedCity,coverageContext:state.page==='cidades'&&state.cityView==='coverage'&&state.coverage?{cities:coverageFilteredRows().map(row=>({...row,areaKey:aliasCity(row.city)+'|'+row.uf,confirmed:!coveragePending(row,state.coverageFilters.department)})),scope:state.areaScope,city:state.areaCity}:null});
}
function updateHeader(){
  if(state.page==='history'){$('#pageTitle').textContent='Histórico macro';$('#pageSubtitle').textContent='Evolução mensal e anual · valores por origem';$('#periodChip').textContent='Desde jun/2017';return;}
  const [title,sub]=PAGE_META[state.page]||PAGE_META.overview;
  $('#pageTitle').textContent=title;$('#pageSubtitle').textContent=sub;
  const m=state.filters.month==='Todos'?'Todos os meses':['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(state.filters.month)-1];
  $('#periodChip').textContent=`${m} • ${state.filters.year}`;
}
function destroyCharts(){
  stopHistoryMotion();++state.historyEpoch;
  document.querySelectorAll('.chart-motion-controls').forEach(el=>el.remove());
  for(const c of state.charts){try{c.$motionCleanup?.();c.destroy()}catch{}}
  state.charts=[];
}
function chart(canvas,type,data,options={}){
  const horizontal=options.indexAxis==='y';
  const moneyTick=value=>money(value,true);
  const c=new Chart(canvas,{type,data,options:{responsive:true,maintainAspectRatio:false,animation:chartMotionOptions(),plugins:{legend:{display:false,labels:{boxWidth:9,usePointStyle:true,font:{size:10}}},tooltip:{backgroundColor:'#fff',titleColor:'#1E285F',bodyColor:'#4D556B',borderColor:'#D9DDEA',borderWidth:1,padding:10,displayColors:false,callbacks:{label:ctx=>money(ctx.raw,true)}}},scales:{x:{grid:{display:horizontal,color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},...(horizontal?{callback:moneyTick}:{})}},y:{grid:{color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},...(!horizontal?{callback:moneyTick}:{})}}},...options}});
  state.charts.push(c);installChartMotion(c);return c;
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
        const label=pluginOptions.formatter?pluginOptions.formatter(Number(value)):money(Number(value),true),width=ctx.measureText(label).width;
        const inside=bar.x+width+12>area.right;
        ctx.textAlign=inside?'right':'left';ctx.fillStyle=chartInstance.canvas.closest('.feature-panel')?(inside?'#0c2142':'#deedff'):(inside?'#FFFFFF':'#334155');
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
  mountCoverageFilters(page==='cidades'&&state.cityView==='coverage');
  if(page==='history'){$('#content').classList.remove('visual-page');delete $('#content').dataset.presentation;}
  if(page==='history')renderMacroHistory(payload);
  else if(page==='overview')renderOverview(payload);
  else if(page==='carteira')renderCarteira(payload);
  else if(page==='produtos')renderProdutos(payload);
  else if(page==='cidades')renderCidades(payload);
  else if(page==='metas')renderMetas(payload);
  else if(page==='pedidos')renderOrders(payload);
  if(page!=='history'&&!(page==='cidades'&&state.cityView==='coverage'))applyPageLook(page,payload);
  biRender(page,payload);
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
    
    <section class="executive-day" aria-label="Resumo comercial diário">
      <div class="executive-day-heading"><div><span class="executive-eyebrow">Acompanhamento da diretoria</span><h2>${daily.isToday?'Comercial de hoje':'Movimento comercial do dia'}</h2><p>${esc(dailyDate)}</p><details class="daily-help"><summary aria-label="Critérios do resumo diário">ⓘ</summary><p>Faturamento pela data de faturamento. Pedidos recebidos pela data inicial, faturados ou não. A data abaixo altera somente este resumo.</p></details></div></div>
      <div class="daily-date-controls" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0">
        <button type="button" class="secondary" data-daily-mode="today" aria-pressed="${state.dailyMode==='today'}">Hoje</button>
        <button type="button" class="secondary" data-daily-mode="yesterday" aria-pressed="${state.dailyMode==='yesterday'}">Ontem</button>
        <label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Escolher data <input type="date" id="dailyDateChoice" aria-label="Data do movimento comercial" value="${esc(daily.date||'')}" style="min-height:44px;max-width:100%;padding:8px;border:1px solid #c7d8f2;border-radius:8px"></label>
        
      </div>
      <div class="executive-day-grid">
        ${kpi('Faturamento do dia',money(daily.soldValue),`${integer(daily.soldOrders)} pedidos realizados`)}
        ${kpi('Pedidos recebidos no dia',daily.entriesAvailable?money(daily.entryValue):'—',daily.entriesAvailable?`${integer(daily.entryCount)} pedidos · faturados e não faturados`:'Entradas diárias disponíveis nos dois meses mais recentes')}
        ${kpi('Clientes no dia',integer(daily.clients),'Com venda realizada ou pedido em aberto')}
      </div>
    </section>
    <div class="section-heading executive-period-heading"><div><h2>Resultado do período</h2><p>Meta, carteira e potencial de fechamento no recorte selecionado.</p></div></div>
    <div class="overview-hero">
      <div class="overview-revenue">
        <div class="revenue-kicker"><i></i> Faturamento no recorte</div>
        <div class="revenue-value" title="${money(revenue)}">${money(k.revenue,true)}</div>
        <div class="revenue-caption"><strong>${money(revenue)}</strong> · Vendas pela data de faturamento</div>
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
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Desempenho por RCA</div><div class="panel-sub">Clique em um RCA para filtrar os cartões e os demais gráficos. O risco vertical indica a meta de cada RCA.</div></div></div><div class="chart-wrap short"><canvas id="overviewRca"></canvas></div></div>
      <div class="panel"><div class="panel-head"><div><div class="panel-title">Composição por departamento</div><div class="panel-sub">Clique em uma linha para aplicar o departamento aos cartões e gráficos.</div></div></div><div id="depList" class="overview-departments metric-list"></div></div>
    </div>
  `;
  Array.from(document.querySelectorAll('[data-daily-mode]')).forEach(button=>button.addEventListener('click',()=>{state.dailyMode=button.dataset.dailyMode;queryPage();}));
  $('#dailyDateChoice').addEventListener('change',event=>{if(!event.target.value)return;state.dailyMode='custom';state.dailyDate=event.target.value;queryPage();});
  const monthly=p.monthly||[];
  chart($('#overviewMonthly'),'line',{labels:monthly.map(x=>x.label),datasets:[{label:'Faturamento',data:monthly.map(x=>x.revenue),borderColor:'#1D2A68',backgroundColor:'rgba(29,42,104,.09)',fill:true,tension:.32,pointRadius:4,pointHoverRadius:6,borderWidth:2.5}]},{scales:{x:{grid:{display:false},border:{display:false}},y:{min:1000000,beginAtZero:false,grid:{color:'#E8EDF6'},border:{display:false},ticks:{callback:v=>money(v,true)}}}});
  const top=(p.rca||[]).slice(0,10);
  const selectedRcas=new Set(normalizeMulti(state.filters.rca));
  const rcaChart=chart($('#overviewRca'),'bar',{labels:top.map(x=>x.name),datasets:[
    {label:'Faturamento',data:top.map(x=>x.revenue),backgroundColor:top.map(x=>selectedRcas.size&&!selectedRcas.has(String(x.key))?'#BDD0EE':'#1D2A68'),borderRadius:7,barThickness:10},
    {type:'scatter',label:'Meta',data:top.map((x,i)=>({x:x.meta||0,y:i})),pointStyle:'line',pointRotation:90,pointRadius:10,pointHoverRadius:12,borderColor:'#56759f',backgroundColor:'#56759f',showValueLabels:false}
  ]},{indexAxis:'y',onClick:(_event,elements)=>{if(elements?.length)toggleCrossFilter('rca',top[elements[0].index].key)},plugins:{legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:9}}},barValueLabels:{display:true},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(typeof ctx.raw==='object'?ctx.raw.x:ctx.raw,true)}`}}},scales:{x:{afterDataLimits:axis=>{axis.max=axis.max*1.18},grid:{color:'#E8EDF6'},ticks:{callback:v=>money(v,true)}},y:{grid:{display:false},ticks:{autoSkip:false,font:{size:9}}}}});
  rcaChart.canvas.style.cursor='pointer';
  const total=(p.departments||[]).reduce((a,x)=>a+x.revenue,0)||1;
  const selectedDepartments=new Set(normalizeMulti(state.filters.department));
  $('#depList').innerHTML=(p.departments||[]).slice(0,12).map(x=>`<button type="button" class="metric-row department-filter ${selectedDepartments.has(String(x.key))?'selected':''}" data-department="${esc(x.key)}"><span><span class="metric-name">${esc(x.key||'Sem departamento')}</span><span class="progress ${x.meta>0?'':'hidden'}"><i style="width:${x.meta>0?Math.max(0,Math.min(100,x.revenue/x.meta*100)):0}%"></i></span></span><span class="metric-value">${money(x.revenue,true)} · ${x.meta>0?pct(x.revenue/x.meta*100)+' da meta':'Sem meta'}<small>${x.meta?`Meta ${money(x.meta,true)}`:'Meta não cadastrada'}</small></span></button>`).join('')||'<div class="empty">Sem departamento neste recorte.</div>';
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
      ${kpi('Inativos • curto',integer(k.short),'90 a 179 dias no fechamento anterior')}
      ${kpi('Inativos • longo',integer(k.long),'180 dias ou mais no fechamento anterior')}
      ${kpi('Mix por cliente',dec(k.mix),'Produtos distintos por cliente')}
      ${kpi('Produtos ativos no recorte',integer(k.products),'Itens faturados')}
    </div>

    <div class="panel carteira-movement-panel">
      <div class="panel-title-row"><div><h2>Movimento da carteira</h2><div class="panel-sub">Positivados e novos: período selecionado. Inativos: fechamento do mês anterior. Clique nas faixas para filtrar a lista.</div></div></div>
      <div class="chart-wrap short"><canvas id="portfolioMovementChart"></canvas></div>
    </div>

    <div class="grid two-col carteira-secondary">
      <div class="panel"><div class="panel-title-row"><div><h2>Inativos por RCA</h2><div class="panel-sub">Clique em uma faixa ou RCA para filtrar a lista; as seleções se combinam.</div></div></div><div class="chart-wrap tall"><canvas id="inactiveChart"></canvas></div></div>
      <div class="panel"><div class="panel-title-row"><div><h2>Leitura da carteira</h2><div class="panel-sub">Data de corte: ${fmtDate(k.cutoff)}</div></div></div>
        <div class="metric-list">
          <div class="metric-line"><div class="name">Relação curto / novos</div><div class="value">${ratio}</div></div>
          <div class="metric-line"><div class="name">Inativos totais</div><div class="value">${integer(inactiveTotal)}</div></div>
          <div class="metric-line"><div class="name">Clientes ativos no período</div><div class="value">${integer(k.clients)}</div></div>
        </div>
        <div class="small-note" style="margin-top:18px">As faixas não se sobrepõem: curto prazo considera de 90 a 179 dias sem compra e longo prazo 180 dias ou mais, no fechamento do mês anterior. A relação curto / novos é mostrada em vezes (x), não em percentual.</div>
      </div>
    </div>
    ${sectionHeading('Clientes inativos para ação','Ordenados pelo maior faturamento dos 12 meses anteriores à data de corte.')}
    <div id="inactiveSelections" class="inactive-selections"></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>RCA</th><th>Última compra</th><th class="align-right">Dias</th><th class="align-right">Fat. 12m</th><th>Faixa</th></tr></thead><tbody id="inactiveTable"></tbody></table></div>
  `;

  const pickInactive=(rca,band)=>{state.inactivePick=state.inactivePick||{};if(rca!==undefined)state.inactivePick.rca=state.inactivePick.rca===String(rca)?'':String(rca);if(band!==undefined)state.inactivePick.band=state.inactivePick.band===band?'':band;drawInactiveList(p);};
  chart($('#portfolioMovementChart'),'bar',{
    labels:['Positivados','Novos','Inativados'],
    datasets:[
      {label:'Positivados',data:[k.clients,null,null],backgroundColor:'#6176B5',borderRadius:8,stack:'carteira'},
      {label:'Novos',data:[null,k.newClients,null],backgroundColor:'#2D8B62',borderRadius:8,stack:'carteira'},
      {label:'Inativos • curto',data:[null,null,k.short],backgroundColor:'#CC4D5B',borderRadius:8,stack:'carteira'},
      {label:'Inativos • longo',data:[null,null,k.long],backgroundColor:'#D89B35',borderRadius:8,stack:'carteira'}
    ]
  },{
    onClick:(_e,els)=>{if(els.length&&els[0].datasetIndex>=2)pickInactive(undefined,els[0].datasetIndex===2?'short':'long');},
    plugins:{
      legend:{display:true,position:'top',align:'start',onClick:(e,item)=>{if(item.datasetIndex>=2)pickInactive(undefined,item.datasetIndex===2?'short':'long');},labels:{boxWidth:8,usePointStyle:true,font:{size:10}}},
      tooltip:{backgroundColor:'#fff',titleColor:'#1E2655',bodyColor:'#4D556B',borderColor:'#D9DDEA',borderWidth:1,padding:10,displayColors:true,callbacks:{label:ctx=>`${ctx.dataset.label}: ${integer(ctx.raw)}`}}
    },
    scales:{
      x:{stacked:true,grid:{display:false},border:{display:false},ticks:{color:'#7A8294',font:{size:10}}},
      y:{stacked:true,beginAtZero:true,grid:{color:'#EEF0F5'},border:{display:false},ticks:{color:'#7A8294',font:{size:10},callback:v=>integer(v)}}
    }
  });

  const rows=(p.byRca||[]).slice(0,18).reverse();
  const inactiveChart=chart($('#inactiveChart'),'bar',{labels:rows.map(x=>x.name),datasets:[
    {label:'Longo prazo',data:rows.map(x=>x.long),backgroundColor:'#D89B35',borderRadius:6},
    {label:'Curto prazo',data:rows.map(x=>x.short),backgroundColor:'#C94A55',borderRadius:6}
  ]},{indexAxis:'y',onClick:(_e,els)=>{if(els.length){const x=els[0];state.inactivePick={rca:String(rows[x.index].rca),band:x.datasetIndex===0?'long':'short'};drawInactiveList(p);}},plugins:{legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${integer(ctx.raw)}`}}},scales:{x:{grid:{color:'#EEF0F5'},ticks:{callback:v=>integer(v)}}}});
  inactiveChart.canvas.addEventListener('click',event=>{const box=inactiveChart.canvas.getBoundingClientRect(),x=(event.clientX-box.left)*inactiveChart.width/box.width,y=(event.clientY-box.top)*inactiveChart.height/box.height;if(x>=inactiveChart.chartArea.left)return;const scale=inactiveChart.scales.y,index=Math.round(scale.getValueForPixel(y));if(rows[index])pickInactive(rows[index].rca,undefined);});
  drawInactiveList(p);
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
  $$('.city-view-switch button').forEach(b=>b.addEventListener('click',()=>{state.cityView=b.dataset.cityView;queryPage()}));
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
let centralLeafletPending=null;
function centralLeaflet() {
 if(window.L)return Promise.resolve();
 if(!centralLeafletPending)centralLeafletPending=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  script.crossOrigin='anonymous';
  script.onload=resolve;
  script.onerror=()=>{
   centralLeafletPending=null;
   script.remove();
   reject(new Error('Não foi possível carregar o mapa. Tente novamente.'));
  };
  document.head.append(script);
 });
 return centralLeafletPending;
}
async function renderCityMap(cities,selectedKey){
  if(state.map){try{state.map.remove()}catch{}state.map=null}
  const el=$('#cityMap'); if(!el)return;
  try{await centralLeaflet();}catch(error){if(el.isConnected)el.textContent=error.message;return;}
  if(!el.isConnected)return;
  state.map=L.map(el,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:10,scrollWheelZoom:true}).setView([-8.5,-40.5],5);
  const codes={RO:'11',AC:'12',AM:'13',RR:'14',PA:'15',AP:'16',TO:'17',MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',BA:'29',MG:'31',ES:'32',RJ:'33',SP:'35',PR:'41',SC:'42',RS:'43',MS:'50',MT:'51',GO:'52',DF:'53'};
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
          return {color:selected?'#F2D49B':'#28476c',weight:selected?2.8:.75,fillColor:c?colorAt(c.revenue):'#243b60',fillOpacity:selected?1:(c?.95:.8)};
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
  ]},options:{responsive:true,maintainAspectRatio:false,animation:chartMotionOptions(),plugins:{legend:{display:true,position:'top',align:'start',labels:{boxWidth:8,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${money(ctx.raw)}`}}},scales:{x:{grid:{display:false},border:{display:false}},y:{grid:{color:'#EEF0F5'},border:{display:false},ticks:{callback:v=>money(v,true)}}}}});
  state.charts.push(c);installChartMotion(c);
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
  f.uf=normalizeMulti(state.filters.uf);
  return rows.filter(row=>{
    const selectedUfs=normalizeMulti(f.uf);if(selectedUfs.length&&!selectedUfs.includes(row.uf))return false;
    if(f.rca!=='Todos'&&coverageRcaKey(coverageAssignment(row,f.department))!==f.rca)return false;
    if(state.filters.city!=='Todos'&&aliasCity(state.filters.city)!==aliasCity(row.city))return false;
    const region=(state.dimensions?.geography||[]).find(g=>g.uf===row.uf&&aliasCity(g.city)===aliasCity(row.city))?.region;
    if(state.filters.region!=='Todos'&&normalize(region)!==normalize(state.filters.region))return false;
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
async function renderCoverageView(p={}){
  if(p.area)state.areaPayload=p.area;
  const cities=state.coverage?.cities||[],f=state.coverageFilters;
  $('#content').innerHTML=
    '<div class="city-view-switch" role="group" aria-label="Visualização de cidades"><button type="button" data-city-view="sales">Faturamento</button><button type="button" class="active" data-city-view="coverage">Cobertura territorial</button></div>'+
    '<div class="coverage-heading"><div><h2>Análise de área e cobertura</h2><p>Explore o território de cada RCA e acompanhe as vendas dos municípios da área.</p></div><div class="coverage-downloads"><button id="coverageRefresh" class="btn secondary small">Atualizar matriz</button><button id="coveragePng" class="btn primary small">Baixar PNG</button><button id="coverageSvg" class="btn secondary small">Baixar SVG</button></div></div>'+
    '<div class="coverage-controls panel">'+
      '<label>Linha comercial<select id="coverageDepartment">'+COVERAGE_DEPARTMENTS.map(x=>'<option value="'+esc(x.value)+'" '+(f.department===x.value?'selected':'')+'>'+esc(x.value)+'</option>').join('')+'</select></label>'+

      '<label>RCA<select id="coverageRca"><option value="Todos">Todos os RCAs</option></select></label>'+
      '<label>Situação<select id="coverageStatus"><option value="Todas" '+(f.status==='Todas'?'selected':'')+'>Todas</option><option value="Conferidas" '+(f.status==='Conferidas'?'selected':'')+'>Conferidas</option><option value="Pendentes" '+(f.status==='Pendentes'?'selected':'')+'>Pendentes</option></select></label>'+
    '</div>'+
    '<div id="coverageLoad" class="coverage-load '+(state.coverage?'hidden':'')+'">Carregando matriz de cobertura…</div>'+
    '<div id="coverageError" class="coverage-error hidden"></div>'+
    '<div class="panel area-scope-panel"><label>Indicadores da área<select id="areaScope"><option value="nutrition">Linha Nutrição</option><option value="commercial">Comercial, exceto Saúde</option><option value="health">Saúde Animal</option><option value="all">Todos os departamentos</option></select></label><p>O RCA define o território pela matriz atual. Os indicadores somam as vendas das cidades, realizadas por qualquer vendedor autorizado no seu acesso. Ano e mês seguem o período do topo.</p></div>'+
    '<div id="coverageStats" class="coverage-stats"></div>'+
    '<div class="grid coverage-layout"><div class="panel coverage-map-panel"><div class="panel-title-row"><div><h2>Mapa por município</h2><div class="panel-sub">Clique em um município para conferir responsável e rota.</div></div><span id="coverageBaseDate" class="badge"></span></div><div id="coverageMap"></div></div>'+
    '<div class="panel coverage-side"><div class="panel-title-row"><div><h2>Legenda da cobertura</h2><div class="panel-sub">Cada cor identifica um RCA nesta linha.</div></div></div><div id="coverageLegend" class="coverage-legend"></div><div class="coverage-detail" id="coverageDetail"></div></div></div>'+
    '<div id="areaAnalysis"></div>'+
    '<div class="coverage-footnote">Fonte: matriz de cobertura comercial no Google Drive. Cidades sem responsável ou com situação diferente de “Conferido” são exibidas como pendentes.</div>';
  $$('.city-view-switch button').forEach(b=>b.addEventListener('click',()=>{state.cityView=b.dataset.cityView;queryPage()}));
  $('#areaScope').value=state.areaScope;
  $('#areaScope').addEventListener('change',e=>{state.areaScope=e.target.value;queryPage()});
  $('#coverageDepartment').addEventListener('change',e=>{f.department=e.target.value;f.rca='Todos';state.coverageSelection=null;state.areaCity='';queryPage()});
  $('#coverageRca').addEventListener('change',e=>{f.rca=e.target.value;state.coverageSelection=null;state.areaCity='';queryPage()});
  $('#coverageStatus').addEventListener('change',e=>{f.status=e.target.value;state.coverageSelection=null;state.areaCity='';queryPage()});
  $('#coverageRefresh').addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;button.textContent='Atualizando…';try{state.coverage=await api('/api/coverage',{method:'POST',body:JSON.stringify({force:true})});state.coverageSelection=null;state.areaCity='';queryPage()}catch(error){const box=$('#coverageError');if(box){box.textContent='Não foi possível atualizar a matriz: '+(error?.message||String(error));box.classList.remove('hidden')}}finally{if(button.isConnected){button.disabled=false;button.textContent='Atualizar matriz'}}});
  $('#coveragePng').addEventListener('click',()=>downloadCoverageMap('png'));
  $('#coverageSvg').addEventListener('click',()=>downloadCoverageMap('svg'));
  if(!state.coverage){
    api('/api/coverage').then(data=>{
      state.coverage=data;
      $('#coverageLoad')?.classList.add('hidden');
      queryPage();
    }).catch(error=>{
      const box=$('#coverageError');
      if(box){box.textContent='Não foi possível ler a matriz de cobertura: '+(error?.message||String(error));box.classList.remove('hidden')}
      $('#coverageLoad')?.classList.add('hidden');
    });
    return;
  }
  mountCoverageFilters(true);
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
  Array.from(document.querySelectorAll('#coverageLegend .coverage-legend-row')).forEach((el,index)=>{const key=legend[index][0];el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','Filtrar território: '+legend[index][1].name);const pick=()=>{if(key==='__pending__')f.status=f.status==='Pendentes'?'Todas':'Pendentes';else{f.rca=f.rca===key?'Todos':key;f.status='Todas'}state.areaCity='';state.coverageSelection=null;queryPage()};el.onclick=pick;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick()}};});
  renderCoverageDetail();
  renderAreaAnalysis(state.areaPayload);
  applyPageLook('coverage',{rows:allowed});
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
  const codes={RO:'11',AC:'12',AM:'13',RR:'14',PA:'15',AP:'16',TO:'17',MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',BA:'29',MG:'31',ES:'32',RJ:'33',SP:'35',PR:'41',SC:'42',RS:'43',MS:'50',MT:'51',GO:'52',DF:'53'};
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
    const [geos]=await Promise.all([Promise.all(ufs.map(uf=>coverageGeoFor(uf))),centralLeaflet()]);
    geos.forEach((geo,index)=>geo.features?.forEach(feature=>features.push({uf:ufs[index],feature})));
  }catch(error){
    const box=$('#coverageError');if(box){box.textContent=error?.message||String(error);box.classList.remove('hidden')}
    return;
  }
  if(drawId!==state.coverageDrawId||!document.body.contains(el))return;
  const byCity=coverageRowMap(rows,definition.value),allByCity=coverageRowMap(state.coverage?.cities||[],definition.value),featureUfs=new Map(features.map(item=>[item.feature,item.uf]));
  state.map=L.map(el,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:10,scrollWheelZoom:true}).setView([-7.3,-39.5],5);
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
      if(row&&visible)leafletLayer.on('click',()=>{state.coverageSelection=row;state.areaCity=aliasCity(row.city)+'|'+row.uf;queryPage()});
    }
  }).addTo(state.map);
  const syncCityLabels=()=>{
    if(!state.map)return;
    const show=state.map.getZoom()>=9;
    if(show&&!state.map.hasLayer(cityLabels))cityLabels.addTo(state.map);
    else if(!show&&state.map.hasLayer(cityLabels))state.map.removeLayer(cityLabels);
  };
  state.map.on('zoomend',syncCityLabels);
  try{const focus=features.filter(item=>byCity.has(aliasCity(item.feature.properties?.name||item.feature.properties?.NOME||'')+'|'+item.uf));const bounds=focus.length?L.geoJSON({type:'FeatureCollection',features:focus.map(x=>x.feature)}).getBounds():layer.getBounds();state.map.fitBounds(bounds,{padding:[20,20],maxZoom:9})}catch{}
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




async function renderUsers(){
 if(state.user?.perfil!=='ADMIN')return;
 $('#content').innerHTML='<div class="panel">Carregando usuários…</div>';
 try{
 const data=await api('/api/users');if(state.page!=='users')return;
 const permissionLabels={sac:'SAC',formation:'Formação de Carga',agenda:'Agenda de Motoristas'};
 const roles={RCA:'RCA',SUPERVISOR:'Supervisor',GERENTE:'Gerente',DIRETOR:'Diretor',SAC:'SAC',INTERNO:'Interno',FORMACAO_CARGA:'Formação de Carga',ADMIN:'Administrador'};
 const permissionKeys=Object.keys(permissionLabels);
 const options=values=>values.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');
 $('#content').innerHTML=`<div class="panel"><h2>Usuários da plataforma</h2><p>Somente administradores podem gerenciar acessos.</p><div style="overflow:auto"><table><thead><tr><th>Nome / login</th><th>Perfil</th><th>Área / acesso</th><th>Situação</th><th></th></tr></thead><tbody>${data.users.map(u=>`<tr><td>${esc(u.nome)}<br><small>${esc(u.login)}</small></td><td>${esc(roles[u.perfil]||u.perfil)}</td><td>${esc((u.areas||[]).map(a=>a==='commercial'?'Comercial':'Logística').join(' · '))}<br><small>${permissionKeys.filter(k=>u.permissions?.[k]?.view).map(k=>esc(permissionLabels[k]+(u.permissions[k].edit?' · edita':' · consulta'))).join('<br>')}</small></td><td>${u.ativo?'Ativo':'Inativo'}</td><td><button type="button" class="secondary" data-edit-user="${esc(u.login)}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>
 <div class="panel" style="margin-top:16px"><h2 id="userFormTitle">Novo usuário</h2><form id="adminUserForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:14px">
 <label>Login<input name="login" required minlength="3" maxlength="100" autocomplete="off" style="width:100%;min-height:44px"></label>
 <label>Nome<input name="nome" required maxlength="120" style="width:100%;min-height:44px"></label>
 <label>Perfil<select name="perfil" style="width:100%;min-height:44px">${options(Object.entries(roles).map(([value,label])=>({value,label})))}</select></label>
 <fieldset class="user-area-fields"><legend>Áreas de acesso</legend><label><input type="checkbox" name="areaCommercial"> Comercial</label><label><input type="checkbox" name="areaLogistics"> Logística</label><small>Diretor e administrador têm acesso às duas áreas. As permissões abaixo definem o acesso a cada função da Logística.</small></fieldset>
 <fieldset class="user-log-scope"><legend>Recorte logístico</legend><label>Transportadoras<textarea name="carriers" placeholder="Uma por linha. Vazio: todas"></textarea></label><label>Vendedores<textarea name="sellers" placeholder="Nome exato na base, um por linha"></textarea></label><label>Regiões<textarea name="regions" placeholder="Nome exato na base, uma por linha"></textarea></label><small>Os recortes preenchidos são combinados. Supervisor de logística precisa ter pelo menos um recorte.</small></fieldset>
 <fieldset class="user-log-permissions"><legend>Permissões logísticas</legend>
 ${permissionKeys.map(k=>`<div><strong>${esc(permissionLabels[k])}</strong>
 <label><input type="checkbox" name="${k}View"> Visualizar</label><label><input type="checkbox" name="${k}Edit"> Editar</label></div>`).join('')}
 <small>Editar exige a permissão de visualizar.</small></fieldset>
 <div class="user-permission-note" id="userPermissionNote"></div>
 <label id="userRcaLabel">RCA<select name="cod_rca" style="width:100%;min-height:44px"><option value="">Selecione</option>${options(data.rcas.map(r=>({value:r.code,label:r.code+' · '+r.name})))}</select></label>
 <label id="userSupervisorLabel">Supervisão<select name="supervisor" style="width:100%;min-height:44px"><option value="">Selecione</option>${options([...new Set(data.rcas.map(r=>r.supervisor).filter(Boolean))].map(s=>({value:s,label:s})))}</select></label>
 <label>Nova senha<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" style="width:100%;min-height:44px"><small>Obrigatória no cadastro. Na edição, deixe em branco para manter.</small></label>
 <label><input name="ativo" type="checkbox" checked> Usuário ativo</label>
 <div><button type="submit" class="btn">Salvar usuário</button> <button type="button" id="newUserBtn" class="secondary">Novo usuário</button></div>
 <p id="userSaveStatus" role="status" style="grid-column:1/-1"></p></form></div>`;
 applyPageLook('users',data);
 const form=$('#adminUserForm'),field=n=>form.elements.namedItem(n);
 const applyPermissions=permissions=>{
   for(const k of permissionKeys){
     field(k+'View').checked=permissions?.[k]?.view===true;
     field(k+'Edit').checked=permissions?.[k]?.edit===true;
   }
 };
 const defaults=role=>({
  sac:{view:role!=='RCA'&&role!=='FORMACAO_CARGA',edit:role==='ADMIN'},
  formation:{view:['ADMIN','DIRETOR','GERENTE','SUPERVISOR','FORMACAO_CARGA'].includes(role),edit:role==='ADMIN'||role==='FORMACAO_CARGA'},
  agenda:{view:['ADMIN','DIRETOR','GERENTE','FORMACAO_CARGA'].includes(role),edit:role==='ADMIN'||role==='FORMACAO_CARGA'}
 });
 const scope=()=>{
   const role=field('perfil').value,all=['ADMIN','DIRETOR'].includes(role),internal=['SAC','INTERNO','FORMACAO_CARGA'].includes(role);
   if(all||internal||role==='RCA'){
     field('areaCommercial').checked=!internal;
     field('areaLogistics').checked=role!=='RCA';
   }
   ['areaCommercial','areaLogistics'].forEach(n=>field(n).disabled=all||internal||role==='RCA');
   const logistics=field('areaLogistics').checked, fixed=['ADMIN','FORMACAO_CARGA'].includes(role);
   if(fixed)applyPermissions(defaults(role));
   for(const k of permissionKeys){
     const view=field(k+'View'),edit=field(k+'Edit');
     view.disabled=!logistics||fixed;
     edit.disabled=!logistics||fixed||!view.checked;
     if(!view.checked)edit.checked=false;
   }
   $('#userRcaLabel').hidden=role!=='RCA';
   $('#userSupervisorLabel').hidden=role!=='SUPERVISOR'||!field('areaCommercial').checked;
   $('.user-log-scope').hidden=all||role==='FORMACAO_CARGA'||!logistics;
   for(const n of ['sellers','regions'])field(n).closest('label').hidden=internal;
   $('#userPermissionNote').textContent=role==='FORMACAO_CARGA'?'Abre diretamente a Montagem de Cargas e pode editar a Agenda de Motoristas.':role==='ADMIN'?'Acesso administrativo preservado.':'As permissões de edição valem somente para as áreas selecionadas.';
 };
 field('perfil').addEventListener('change',()=>{applyPermissions(defaults(field('perfil').value));scope();});
 ['areaCommercial','areaLogistics',...permissionKeys.map(k=>k+'View')].forEach(n=>field(n).addEventListener('change',scope));scope();
 $('#newUserBtn').onclick=()=>{form.reset();field('login').readOnly=false;$('#userFormTitle').textContent='Novo usuário';scope();};
 $$('[data-edit-user]').forEach(b=>b.onclick=()=>{
   const u=data.users.find(x=>x.login===b.dataset.editUser);
   form.reset();
   for(const n of ['login','nome','perfil','cod_rca','supervisor'])field(n).value=u[n]??'';
   field('ativo').checked=u.ativo;
   field('areaCommercial').checked=(u.areas||[]).includes('commercial');
   field('areaLogistics').checked=(u.areas||[]).includes('logistics');
   applyPermissions(u.permissions||defaults(u.perfil));
   for(const k of ['carriers','sellers','regions'])field(k).value=(u.logisticsScope?.[k]||[]).join('\n');
   field('login').readOnly=true;$('#userFormTitle').textContent='Editar usuário';scope();form.scrollIntoView({behavior:'smooth',block:'start'});
 });
 form.onsubmit=async event=>{
 event.preventDefault();const status=$('#userSaveStatus'),button=form.querySelector('[type=submit]');button.disabled=true;
 try{
 const save={login:field('login').value,nome:field('nome').value,perfil:field('perfil').value,cod_rca:field('cod_rca').value,supervisor:field('supervisor').value,ativo:field('ativo').checked};
 save.areas=['commercial','logistics'].filter((a,i)=>field(i?'areaLogistics':'areaCommercial').checked);save.permissions=Object.fromEntries(permissionKeys.map(k=>[k,{
  view:field('areaLogistics').checked&&field(k+'View').checked,edit:field('areaLogistics').checked&&field(k+'Edit').checked
 }]));save.logisticsScope=Object.fromEntries(['carriers','sellers','regions'].map(k=>[k,field(k).value.split(/\n/).map(v=>v.trim()).filter(Boolean)]));
 const password=field('password').value;
 if(password){
 const salt=crypto.getRandomValues(new Uint8Array(16)),hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const hash=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);
 save.credential={algorithm:'pbkdf2_sha256',iterations:100000,salt:hex(salt),hash:hex(hash)};
 }
 field('password').value='';await api('/api/users',{method:'POST',body:JSON.stringify({save})});await renderUsers();$('#userSaveStatus').textContent='Usuário salvo. As novas permissões serão aplicadas no próximo acesso.';
 }catch(error){status.textContent=error.message||'Não foi possível salvar.';}finally{button.disabled=false;}
 };
 }catch(error){if(state.page==='users')$('#content').innerHTML='<div class="panel">'+esc(error.message)+'</div>';}
}

function mergeMacroHistory(historical,current){
 const months=new Map();
 for(const row of historical){
  if(row.month>='2024-08')throw new Error('Histórico recuperado ultrapassa julho de 2024.');
  if(months.has(row.month))throw new Error('Mês duplicado no histórico recuperado.');
  months.set(row.month,{...row,source:'Shop Control recuperado'});
 }
 for(const row of current){
  if(row.month<'2024-08')continue;
  if(months.has(row.month))throw new Error('Sobreposição entre as fontes.');
  months.set(row.month,{...row,source:'WinThor / BI'});
 }
 return [...months.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
function stopHistoryMotion(){
 if(state.historyTimer)clearInterval(state.historyTimer);state.historyTimer=null;
 state.historyObserver?.disconnect();state.historyObserver=null;
}
function historyCityKey(city,uf){return aliasCity(city).replace(/[^A-Z0-9]/g,'')+'|'+String(uf||'').toUpperCase();}
function historyPercent(now,before){return before>0?(now/before-1)*100:null;}
function historyMonthLabel(key){return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(key.slice(5,7))-1]+'/'+key.slice(0,4);}
function buildHistoryExperience(rows,geoRows){
 const byMonth=new Map(rows.map(r=>[r.month,r])),latest=rows.at(-1)?.month;
 const complete=r=>!!r&&r.month!=='2017-06'&&!(r.month===latest&&Number(r.maxDate.slice(8,10))<new Date(Number(r.month.slice(0,4)),Number(r.month.slice(5,7)),0).getDate());
 const years=[...new Set(rows.map(r=>r.month.slice(0,4)))].map(year=>{
  const months=rows.filter(r=>r.month.startsWith(year)),comp=months.filter(complete),previous=comp.map(r=>byMonth.get(String(Number(year)-1)+r.month.slice(4)));
  const comparable=comp.length>0&&previous.every(r=>complete(r)),value=months.reduce((a,r)=>a+r.value,0),compValue=comp.reduce((a,r)=>a+r.value,0),oldValue=previous.reduce((a,r)=>a+(r?.value||0),0);
  return {year,months,value,comp,comparable,growth:comparable?historyPercent(compValue,oldValue):null,period:comp.length?historyMonthLabel(comp[0].month)+' a '+historyMonthLabel(comp.at(-1).month):'Sem período completo',partial:months.length!==12||months.some(r=>!complete(r)),sources:[...new Set(months.map(r=>r.source))]};
 });
 const geo=new Map();for(const r of geoRows){if(geo.has(r.month))throw new Error('Sobreposição no histórico geográfico.');const cities=new Map();for(const [city,uf,value] of r.cities||[]){const key=historyCityKey(city,uf),item=cities.get(key)||{key,city,uf,value:0};item.value+=Number(value)||0;cities.set(key,item);}geo.set(r.month,{...r,cities});}
 const aggregate=months=>{const result=new Map();let unlocated=0;for(const m of months){const g=geo.get(m);if(!g)continue;unlocated+=g.unlocated||0;for(const [key,r] of g.cities){const item=result.get(key)||{...r,value:0};item.value+=r.value;result.set(key,item);}}return {cities:result,unlocated};};
 const annual=years.map(y=>{const months=y.comp.map(r=>r.month),previous=months.map(m=>String(Number(y.year)-1)+m.slice(4));return {key:y.year,label:y.year,period:y.period,source:y.sources.join(' + '),current:aggregate(months),previous:aggregate(previous),comparable:y.comparable,partial:y.partial,comparison:'Mesmo conjunto de meses do ano anterior'};}).filter(f=>f.current.cities.size);
 const monthly=rows.map(r=>{const d=new Date(r.month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);const key=d.toISOString().slice(0,7),prev=byMonth.get(key);return {key:r.month,label:historyMonthLabel(r.month),period:historyMonthLabel(r.month),source:r.source,current:aggregate([r.month]),previous:aggregate([key]),comparable:complete(r)&&complete(prev),partial:!complete(r),comparison:'Mês anterior: '+historyMonthLabel(key)};}).filter(f=>f.current.cities.size);
 return {rows,byMonth,years,complete,frames:{year:annual,month:monthly}};
}
async function renderMacroHistory(payload){
 if(!['ADMIN','DIRETOR','GERENTE'].includes(state.user?.perfil))return;
 stopHistoryMotion();const epoch=++state.historyEpoch;
 $('#content').innerHTML='<div class="panel">Preparando evolução comercial…</div>';
 try{
 const [source,geoSource]=await Promise.all([state.historySource?Promise.resolve(state.historySource):api('/api/history'),state.historyGeo?Promise.resolve(state.historyGeo):api('/api/historyGeo')]);
 state.historySource=source;state.historyGeo=geoSource;
 if(state.page!=='history'||epoch!==state.historyEpoch)return;
 const rows=mergeMacroHistory(source.monthly,payload.monthly||[]),model=buildHistoryExperience(rows,[...(geoSource.monthly||[]),...(payload.geoMonthly||[])]);
 const year=model.years.find(g=>g.year===String(state.historyYear))||model.years.at(-1);if(!year)throw new Error('Sem histórico disponível.');state.historyYear=year.year;
 const peak=year.months.reduce((a,r)=>!a||r.value>a.value?r:a,null),total=rows.reduce((a,r)=>a+r.value,0),completeYears=model.years.filter(y=>!y.partial),record=completeYears.reduce((a,y)=>!a||y.value>a.value?y:a,null);
 $('#content').innerHTML=`<section class="history-hero"><div class="history-hero-copy"><span class="history-eyebrow">REBANHO · EVOLUÇÃO COMERCIAL</span><h2>Uma trajetória em movimento.</h2><p>Explore os resultados no tempo e veja como as vendas se distribuem pelo território.</p></div><div class="history-hero-facts"><div><span>Vendas registradas desde 2017</span><strong>${money(total,true)}</strong><small>Somatório dos períodos disponíveis</small></div><div><span>Maior ano completo</span><strong>${esc(record?.year||'—')}</strong><small>${record?money(record.value,true):'Sem base completa'}</small></div></div></section>
 <section class="panel history-year-panel"><div class="history-section-head"><div><span class="history-eyebrow">PANORAMA ANUAL</span><h2>O ritmo de crescimento da Rebanho</h2><p class="panel-sub">Clique em um ano para explorar seus meses. Anos parciais são identificados no gráfico.</p></div><label>Ano em análise<select id="macroYear">${model.years.map(y=>`<option value="${y.year}" ${y.year===year.year?'selected':''}>${y.year}${y.partial?' · parcial':''}</option>`).join('')}</select></label></div>
 <div class="history-kpis">${kpi('Vendas em '+year.year,money(year.value,true),year.partial?'Período com cobertura parcial':'12 meses com registros')}${kpi('Variação comparável',year.growth===null?'Sem base':pct(year.growth),year.growth===null?'Sem registros completos para o período anterior':year.period+' vs. mesmos meses do ano anterior')}${kpi('Melhor mês do ano',peak?historyMonthLabel(peak.month):'—',peak?money(peak.value,true):'')}${kpi('Meses com registros',integer(year.months.length),year.sources.join(' + '))}</div>
 <div class="chart-wrap history-chart"><canvas id="macroAnnual"></canvas></div></section>
 <section class="history-map-shell" id="historyMapShell"><div class="history-map-head"><div><span class="history-eyebrow">EVOLUÇÃO TERRITORIAL</span><h2>O crescimento ganha espaço.</h2><p>Azul mais escuro representa maior valor de vendas. As setas mostram crescimento ou queda frente ao período anterior.</p></div><div class="history-map-options"><label>Território<select id="historyUf"></select></label><div class="history-segment" role="group" aria-label="Passo da linha do tempo"><button data-history-mode="year" aria-pressed="${state.historyMode==='year'}">Ano a ano</button><button data-history-mode="month" aria-pressed="${state.historyMode==='month'}">Mês a mês</button></div></div></div>
 <div id="historyMapLoading" class="history-map-loading">Preparando municípios…</div><div class="history-map-body"><div class="history-map-stage"><div class="history-time-stamp"><strong id="historyFrameLabel">—</strong><span id="historyFramePeriod"></span></div><svg id="historyEvolutionMap" viewBox="0 0 900 650" role="group" aria-label="Evolução geográfica das vendas"></svg><div class="history-map-legend"><span>Menor valor</span><i></i><span>Maior valor</span></div><div id="historyCityFocus" class="history-city-focus">Toque em um município para ver seu resultado.</div></div><aside class="history-map-aside"><span class="history-eyebrow">VENDAS LOCALIZADAS NO MAPA</span><strong id="historyAreaValue" class="history-area-value">—</strong><span id="historyAreaGrowth" class="history-area-growth"></span><p id="historyComparisonCaption"></p><h3>Cidades em destaque</h3><div id="historyMovingRanks" class="history-moving-ranks"></div></aside></div>
 <div class="history-timeline"><button id="historyToggle" class="history-play" aria-label="Pausar evolução" title="Pausar evolução">Ⅱ</button><label class="history-scrubber">Período<input id="historyScrubber" type="range" min="0" max="1" value="0" step="1"><span id="historyTimelineEnds"></span></label><output id="historyTimelineValue"></output></div><p class="history-map-note" id="historyMapMethod"></p></section>
 <div class="grid equal-col history-details-grid"><section class="panel"><div class="history-section-head"><div><span class="history-eyebrow">${year.year}</span><h2>Vendas mês a mês</h2></div></div><div class="chart-wrap"><canvas id="macroMonthly"></canvas></div><p class="panel-sub">Linha clara: mesmo mês do ano anterior, quando houver registros completos nos mesmos meses.</p></section><section class="panel"><span class="history-eyebrow">SAZONALIDADE</span><h2>Onde o crescimento se concentra</h2><p class="panel-sub">Variação de cada mês sobre o mesmo mês do ano anterior. Células neutras indicam ausência de comparação válida.</p><div class="history-heatmap-scroll"><div id="historyHeatmap" class="history-heatmap"></div></div></section></div>
 <details class="panel history-data-detail"><summary>Consultar valores anuais e critérios</summary><div class="table-wrap"><table><thead><tr><th>Ano</th><th>Vendas registradas</th><th>Variação comparável</th><th>Cobertura / origem</th></tr></thead><tbody>${model.years.map(y=>`<tr><td><button class="history-year-link" data-macro-year="${y.year}">${y.year}</button></td><td>${money(y.value)}</td><td>${y.growth===null?'Sem base comparável':pct(y.growth)}</td><td>${y.months.length} meses${y.partial?' · parcial':''} · ${esc(y.sources.join(' + '))}</td></tr>`).join('')}</tbody></table></div><p>Shop Control recuperado: jun/2017 a jul/2024, valores de venda incluindo negativos, sem conciliação contábil confirmada. WinThor/BI: desde ago/2024 por data de faturamento. Comparamos os valores registrados independentemente da fonte de origem. No mapa anual usamos os meses completos disponíveis e comparamos o mesmo conjunto de meses; a visão mensal não compara meses parciais. As áreas representam municípios de venda e não a atuação histórica de vendedores ou RCAs. Valores sem município identificado permanecem no total geral, sem distribuição fictícia no mapa.</p></details>`;
 const pick=value=>{state.historyYear=String(value);destroyCharts();renderMacroHistory(payload);};$('#macroYear').onchange=e=>pick(e.target.value);Array.from(document.querySelectorAll('[data-macro-year]')).forEach(b=>b.onclick=()=>pick(b.dataset.macroYear));
 chart($('#macroAnnual'),'bar',{labels:model.years.map(y=>y.year+(y.partial?' *':'')),datasets:[{label:'Vendas registradas',data:model.years.map(y=>y.value),backgroundColor:model.years.map(y=>y.year===year.year?'#1D2A68':'#84A7DA'),borderRadius:8,barPercentage:.62}]},{onClick:(_e,els)=>{if(els.length)pick(model.years[els[0].index].year)},plugins:{tooltip:{callbacks:{afterLabel:ctx=>{const y=model.years[ctx.dataIndex];return (y.partial?'Cobertura parcial. ':'')+(y.growth===null?'Sem período anterior completo':pct(y.growth)+' · '+y.period);}}}},scales:{x:{grid:{display:false},ticks:{font:{size:12}}},y:{beginAtZero:true,ticks:{callback:v=>money(v,true)}}}});
 const monthNames=Array.from({length:12},(_,i)=>historyMonthLabel(year.year+'-'+String(i+1).padStart(2,'0')).split('/')[0]);
 const yr=Number(year.year),point=i=>model.byMonth.get(year.year+'-'+String(i+1).padStart(2,'0'));
 chart($('#macroMonthly'),'line',{labels:monthNames,datasets:[{label:year.year,data:monthNames.map((_,i)=>point(i)?.value??null),borderColor:'#265EA8',backgroundColor:'rgba(50,115,208,.14)',fill:true,tension:.3},{label:String(yr-1),data:monthNames.map((_,i)=>{const r=point(i),old=model.byMonth.get(String(yr-1)+'-'+String(i+1).padStart(2,'0'));return r&&old&&model.complete(r)&&model.complete(old)?old.value:null;}),borderColor:'#94AED1',borderDash:[5,5],tension:.3}]},{plugins:{legend:{display:true}},scales:{y:{ticks:{callback:v=>money(v,true)}}}});
 $('#historyHeatmap').innerHTML='<span></span>'+monthNames.map(m=>'<span class="heat-month">'+m+'</span>').join('')+model.years.map(y=>'<button class="heat-year" data-heat-year="'+y.year+'">'+y.year+'</button>'+monthNames.map((name,i)=>{const row=model.byMonth.get(y.year+'-'+String(i+1).padStart(2,'0')),old=model.byMonth.get(String(Number(y.year)-1)+'-'+String(i+1).padStart(2,'0'));const v=row&&old&&model.complete(row)&&model.complete(old)?historyPercent(row.value,old.value):null;const color=v===null?'#edf1f7':v<0?'rgba(184,80,91,'+(.15+Math.min(Math.abs(v),100)/100*.65)+')':'rgba(45,107,182,'+(.15+Math.min(v,100)/100*.7)+')';const label=v===null?'—':Math.round(v)+'%';return '<span class="heat-cell" style="background:'+color+';color:'+(v!==null&&Math.abs(v)>40?'#fff':'#29456c')+'" title="'+name+'/'+y.year+': '+(v===null?'sem base comparável':pct(v))+'">'+label+'</span>';}).join('')).join('');
 Array.from(document.querySelectorAll('[data-heat-year]')).forEach(b=>b.onclick=()=>pick(b.dataset.heatYear));
 await mountHistoryMap(model,epoch);
 }catch(error){if(state.page==='history'&&epoch===state.historyEpoch)$('#content').innerHTML='<div class="panel">'+esc(error.message)+'</div>';}
}
function bindHistoryMapWheelZoom(svg) {
 const bounds = svg.viewBox.baseVal;
 const minX = bounds.x, minY = bounds.y, maxWidth = bounds.width, maxHeight = bounds.height;
 svg.onwheel = event => {
  if (!event.deltaY) return;
  const transform = svg.getScreenCTM();
  if (!transform) return;
  event.preventDefault();
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const anchor = point.matrixTransform(transform.inverse());
  const {x,y,width} = svg.viewBox.baseVal;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
  const step = Math.exp(Math.max(-.4,Math.min(.4,delta * .002)));
  const nextWidth = Math.max(maxWidth / 6,Math.min(maxWidth,width * step));
  if (nextWidth === width) return;
  const ratio = nextWidth / width, nextHeight = maxHeight * (nextWidth / maxWidth);
  const nextX = Math.max(minX,Math.min(minX + maxWidth - nextWidth,anchor.x - (anchor.x - x) * ratio));
  const nextY = Math.max(minY,Math.min(minY + maxHeight - nextHeight,anchor.y - (anchor.y - y) * ratio));
  svg.setAttribute('viewBox',[nextX,nextY,nextWidth,nextHeight].join(' '));
 };
}
async function mountHistoryMap(model,epoch){
 const mapEpoch=++state.historyMapEpoch;
 const supported={RO:'11',AC:'12',AM:'13',RR:'14',PA:'15',AP:'16',TO:'17',MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',BA:'29',MG:'31',ES:'32',RJ:'33',SP:'35',PR:'41',SC:'42',RS:'43',MS:'50',MT:'51',GO:'52',DF:'53'};
 const ufs=[...new Set([...model.frames.year,...model.frames.month].flatMap(f=>[...f.current.cities.values()].map(c=>c.uf)))].filter(uf=>supported[uf]).sort();
 if(!ufs.length){$('#historyMapLoading').textContent='Sem municípios identificados para o mapa.';return;}
 if(!ufs.includes(state.historyUf))state.historyUf=ufs[0];
 const select=$('#historyUf');select.innerHTML=ufs.map(uf=>'<option '+(uf===state.historyUf?'selected':'')+'>'+uf+'</option>').join('');
 const remount=()=>{stopHistoryMotion();state.historyScene=0;state.historyPlaying=true;mountHistoryMap(model,epoch);};select.onchange=e=>{state.historyUf=e.target.value;remount();};
 Array.from(document.querySelectorAll('[data-history-mode]')).forEach(b=>b.onclick=()=>{state.historyMode=b.dataset.historyMode;remount();});
 Array.from(document.querySelectorAll('[data-history-mode]')).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyMode===state.historyMode)));
 $('#historyMapLoading').hidden=false;
 let geo;try{geo=await coverageGeoFor(state.historyUf);}catch(error){if(state.page==='history'&&epoch===state.historyEpoch)$('#historyMapLoading').textContent='Mapa indisponível para '+state.historyUf+'. Os totais históricos continuam disponíveis.';return;}
 if(state.page!=='history'||epoch!==state.historyEpoch||mapEpoch!==state.historyMapEpoch)return;
 $('#historyMapLoading').hidden=true;
 const features=geo.features||[],svg=$('#historyEvolutionMap'),byKey=new Map(),points=[];
 for(const feature of features){const polygons=feature.geometry?.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry?.type==='MultiPolygon'?feature.geometry.coordinates:[];for(const poly of polygons)for(const ring of poly)for(const p of ring)points.push(p);}
 if(!points.length)return;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const [x,y] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
 const cos=Math.cos((minY+maxY)/2*Math.PI/180),scale=Math.min(760/((maxX-minX)*cos),540/(maxY-minY)),offsetX=(900-(maxX-minX)*cos*scale)/2,offsetY=(650-(maxY-minY)*scale)/2;
 const project=(x,y)=>[offsetX+(x-minX)*cos*scale,offsetY+(maxY-y)*scale];
 const shapes=features.map(f=>{const name=f.properties?.name||f.properties?.NOME||'',key=historyCityKey(name,state.historyUf),polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const poly of polys)for(const ring of poly)for(const p of ring){a=Math.min(a,p[0]);c=Math.max(c,p[0]);b=Math.min(b,p[1]);d=Math.max(d,p[1]);}byKey.set(key,{feature:f,name,point:project((a+c)/2,(b+d)/2)});return '<path data-geo-city="'+esc(key)+'" d="'+coveragePath(f.geometry,project)+'" tabindex="0" role="button" aria-label="'+esc(name)+'" fill="#243b60"><title>'+esc(name)+'</title></path>';}).join('');
 if(window.innerWidth<700)svg.setAttribute('viewBox',[offsetX-35,offsetY-35,(maxX-minX)*cos*scale+70,(maxY-minY)*scale+70].join(' '));else svg.setAttribute('viewBox','0 0 900 650');
 bindHistoryMapWheelZoom(svg);
 svg.innerHTML='<defs><filter id="histArrowGlow"><feGaussianBlur stdDeviation="2"/></filter></defs><g class="history-geography">'+shapes+'</g><g id="historyMapArrows" class="history-map-arrows" aria-hidden="true"></g>';
 const paths=new Map(Array.from(svg.querySelectorAll('[data-geo-city]')).map(p=>[p.dataset.geoCity,p]));
 const frames=model.frames[state.historyMode],rankKeys=new Set(),maxValue=Math.max(1,...frames.flatMap(f=>[...f.current.cities.values()].filter(c=>byKey.has(c.key)).map(c=>c.value)));
 frames.forEach(f=>[...f.current.cities.values()].filter(c=>byKey.has(c.key)).sort((a,b)=>b.value-a.value).slice(0,8).forEach(c=>rankKeys.add(c.key)));
 const rankRoot=$('#historyMovingRanks');rankRoot.innerHTML=[...rankKeys].map(key=>'<div class="history-rank-row" data-rank-city="'+esc(key)+'"><span class="history-rank-name"></span><strong></strong><div class="history-rank-track"><i></i></div><small></small></div>').join('');
 const ranks=new Map(Array.from(rankRoot.querySelectorAll('[data-rank-city]')).map(el=>[el.dataset.rankCity,el]));let selectedKey='';
 const pctText=v=>v===null?'Sem base':(v>=0?'↑ ':'↓ ')+pct(Math.abs(v));
 const frameCity=(f,key)=>({now:f.current.cities.get(key)?.value||0,before:f.previous.cities.get(key)?.value||0});
 const focus=()=>{const f=frames[state.historyScene],r=frameCity(f,selectedKey),v=f.comparable?historyPercent(r.now,r.before):null;$('#historyCityFocus').innerHTML=selectedKey?'<strong>'+esc(byKey.get(selectedKey)?.name||selectedKey)+'</strong><span>'+money(r.now)+' <small>'+pctText(v)+'</small></span>':'Toque em um município para ver seu resultado.';};
 const draw=()=>{
  const f=frames[state.historyScene];if(!f||!svg.isConnected)return;
  const current=[...f.current.cities.values()].filter(c=>byKey.has(c.key)),prev=[...f.previous.cities.values()].filter(c=>byKey.has(c.key)),sum=current.reduce((a,c)=>a+c.value,0),before=prev.reduce((a,c)=>a+c.value,0),growth=f.comparable?historyPercent(sum,before):null;
  $('#historyFrameLabel').textContent=f.label;$('#historyFramePeriod').textContent=f.period+(f.partial?' · parcial':'');$('#historyAreaValue').textContent=money(sum,true);$('#historyAreaGrowth').textContent=pctText(growth);$('#historyAreaGrowth').classList.toggle('decline',growth!==null&&growth<0);$('#historyComparisonCaption').textContent=f.comparison+(f.comparable?'':' · sem base equivalente');$('#historyTimelineValue').textContent=f.label;$('#historyScrubber').value=String(state.historyScene);
  for(const [key,path]of paths){const r=frameCity(f,key),positive=Math.max(0,r.now),t=Math.sqrt(positive/maxValue),light=88-t*59;path.setAttribute('fill',r.now<0?'#9d6478':r.now===0?'#243b60':'hsl(215 68% '+light+'%)');path.classList.toggle('is-selected',key===selectedKey);const v=f.comparable?historyPercent(r.now,r.before):null;const label=byKey.get(key).name+' · '+money(r.now)+' · '+pctText(v);path.setAttribute('aria-label',label);path.querySelector('title').textContent=label;}
  const ordered=current.filter(c=>c.value>0).sort((a,b)=>b.value-a.value).slice(0,8),order=new Map(ordered.map((c,i)=>[c.key,i]));
  for(const [key,el]of ranks){const index=order.get(key),row=f.current.cities.get(key),v=f.comparable?historyPercent(row?.value||0,f.previous.cities.get(key)?.value||0):null;el.style.opacity=index===undefined||(window.innerWidth<700&&index>=6)?'0':'1';el.style.transform='translateY('+((index??9)*48)+'px)';el.style.pointerEvents=index===undefined?'none':'auto';el.querySelector('.history-rank-name').textContent=row?.city||byKey.get(key)?.name||key;el.querySelector('strong').textContent=money(row?.value||0,true);el.querySelector('i').style.width=Math.max(0,(row?.value||0)/maxValue*100)+'%';el.querySelector('small').textContent=pctText(v);}
  const changes=[...byKey.keys()].map(key=>{const r=frameCity(f,key),v=f.comparable?historyPercent(r.now,r.before):null;return {key,...r,v};}).filter(c=>c.v!==null&&c.v!==0).sort((a,b)=>Math.abs(b.now-b.before)-Math.abs(a.now-a.before)).slice(0,6);
  $('#historyMapArrows').innerHTML=changes.map((c,i)=>{const p=byKey.get(c.key).point,up=c.v>0,color=up?'#9df0d3':'#ffc0b9';return '<g transform="translate('+p[0].toFixed(1)+' '+p[1].toFixed(1)+')"><g class="history-arrow-motion '+(up?'up':'down')+'" style="animation-delay:'+i*65+'ms"><rect x="-33" y="-19" width="66" height="24" rx="12" fill="#081a3b" fill-opacity=".9"/><text text-anchor="middle" y="-3" fill="'+color+'" font-size="13" font-weight="700">'+(up?'↑':'↓')+' '+Math.abs(c.v).toFixed(0)+'%</text></g></g>';}).join('');
  const missing=[...f.current.cities.values()].filter(c=>c.uf===state.historyUf&&!byKey.has(c.key)).reduce((a,c)=>a+c.value,0);
  $('#historyMapMethod').textContent=f.source+' · '+state.historyUf+'. Escala de cor fixa em todos os períodos desta visualização. Setas: variação de vendas, sem atribuição a vendedores. '+(state.historyMode==='year'?'Meses completos disponíveis em cada ano. ':'Meses parciais não geram percentuais. ')+(missing?'Sem correspondência municipal nesta UF: '+money(missing)+'. ':'')+(f.current.unlocated?'Sem localização na base geral deste período: '+money(f.current.unlocated)+'. ':'')+'Comparações incluem fontes diferentes, conforme os valores registrados.';
  focus();
 };
 const pause=()=>{state.historyPlaying=false;if(state.historyTimer)clearInterval(state.historyTimer);state.historyTimer=null;$('#historyToggle').textContent='▶';$('#historyToggle').setAttribute('aria-label','Reproduzir evolução');};
 const start=()=>{if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;state.historyPlaying=true;$('#historyToggle').textContent='Ⅱ';$('#historyToggle').setAttribute('aria-label','Pausar evolução');if(state.historyTimer)clearInterval(state.historyTimer);state.historyTimer=setInterval(()=>{if(document.hidden)return;if(state.page!=='history'||epoch!==state.historyEpoch||!svg.isConnected){stopHistoryMotion();return;}if(state.historyScene>=frames.length-1){pause();return;}state.historyScene++;draw();},state.historyMode==='year'?2500:1600);};
 state.historyScene=Math.min(Math.max(0,state.historyScene),frames.length-1);$('#historyScrubber').max=String(frames.length-1);$('#historyTimelineEnds').textContent=frames[0].label+' — '+frames.at(-1).label;
 $('#historyScrubber').oninput=e=>{pause();state.historyScene=Number(e.target.value);draw();};$('#historyToggle').onclick=()=>{if(state.historyPlaying){pause();return;}if(state.historyScene===frames.length-1)state.historyScene=0;draw();start();};
 for(const [key,path]of paths){const pick=()=>{pause();selectedKey=selectedKey===key?'':key;draw();};path.onclick=pick;path.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}};}
 draw();if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){pause();return;}
 if(state.historyPlaying){state.historyObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){start();state.historyObserver?.disconnect();state.historyObserver=null;}},{threshold:.3});state.historyObserver.observe($('#historyMapShell'));}else pause();
}

function chartMotionOptions(){return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?false:{duration:1100,easing:'easeOutCubic',delay:ctx=>ctx.type==='data'?Math.min(400,ctx.dataIndex*35):0};}
function installChartMotion(c){
 c.canvas.setAttribute('role','img');c.canvas.setAttribute('aria-label','Gráfico de '+c.data.datasets.map(d=>d.label||'valores').join(', '));
 if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
 const isLine=c.config.type==='line',horizontal=c.options.indexAxis==='y';
 c.data.datasets.forEach(d=>{if(isLine){d.pointRadius=2;d.pointHoverRadius=6;d.borderWidth=3;}if(!d.solidColor&&!Array.isArray(d.backgroundColor)&&!d.borderDash){const base=typeof d.backgroundColor==='string'&&/^#[0-9a-f]{6}$/i.test(d.backgroundColor)?d.backgroundColor:'#254E96';d.backgroundColor=context=>{const {ctx,chartArea:a}=context.chart;if(!a)return base;const g=horizontal?ctx.createLinearGradient(a.left,0,a.right,0):ctx.createLinearGradient(0,a.bottom,0,a.top);g.addColorStop(0,isLine?'rgba(48,105,196,0.01)':base+'66');g.addColorStop(1,isLine?'rgba(48,105,196,0.22)':base);return g;};}});
 c.update('none');
 if(typeof IntersectionObserver==='function'){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){c.reset();c.update();observer.disconnect();}},{threshold:.2});observer.observe(c.canvas);c.$motionCleanup=()=>observer.disconnect();}
}
function renderAreaAnalysis(p){
 const root=$('#areaAnalysis');if(!root)return;
 for(const c of [...state.charts])if(c.canvas?.id?.startsWith('area')){c.$motionCleanup?.();c.destroy();state.charts=state.charts.filter(x=>x!==c);}
 if(!p){root.innerHTML='<div class="panel">Preparando indicadores do território…</div>';return;}
 const change=(a,b)=>p.previousAvailable===false?'Sem base completa':b>0?pct((a/b-1)*100):'Sem base';
 const current=p.current||{},previous=p.previous||{},monthly=p.monthly||[];
 root.innerHTML=`<section class="panel area-analysis-heading"><div class="panel-title-row"><div><h2>${esc(p.cityName||'Resultado do território')}</h2><p class="panel-sub">${esc(p.period)} · comparação com ${esc(p.previousPeriod)}${p.partial?' · período parcial':''}</p></div>${state.areaCity?'<button class="btn secondary" id="areaAllCities">Voltar à área</button>':''}</div><div class="grid kpi-grid four">${kpi('Faturamento da área',money(current.revenue,true),change(current.revenue,previous.revenue)+' vs. ano anterior')}${kpi('Clientes com compra',integer(current.clients),change(current.clients,previous.clients)+' vs. ano anterior')}${kpi('Produtos vendidos',integer(current.products),change(current.products,previous.products)+' vs. ano anterior')}${kpi('Cidades com venda',integer(current.cities),integer(p.municipalities)+' municípios conferidos na área')}</div><details><summary>Critérios desta análise</summary><p>Resultado geográfico: vendas fechadas por data de faturamento nos municípios com atribuição conferida na matriz atual. A mesma área é aplicada aos dois anos; não representa a produtividade individual do RCA nem o território histórico. Áreas em revisão ficam fora dos indicadores. Respeita os dados permitidos ao usuário. Filtros gerais de vendedor, supervisor e departamento não alteram esta análise; use a linha e o escopo acima. Comparações são limitadas à última data de faturamento disponível no ano selecionado. Comparações anuais são omitidas quando faltam meses na base do ano anterior. Ausência de registros na base aparece como “Sem base”.</p></details></section>
 <div class="grid equal-col area-analysis-grid"><section class="panel"><h2>Evolução do faturamento da área</h2><p class="panel-sub">Compare o mesmo território nos dois anos.</p><div class="chart-wrap"><canvas id="areaMonthly"></canvas></div></section><section class="panel"><h2>Variação mensal</h2><label>Comparação<select id="areaComparison"><option value="yoy">Mesmo mês do ano anterior</option><option value="mom">Mês anterior</option></select></label><div class="chart-wrap"><canvas id="areaGrowth"></canvas></div></section></div>
 <div class="grid equal-col area-analysis-grid"><section class="panel"><h2>Cidades do território</h2><p class="panel-sub">Clique para detalhar a cidade. ${integer(p.municipalities)} cidades conferidas; ${integer(current.cities)} com venda no período.</p><div class="area-table-scroll"><table><thead><tr><th>Cidade</th><th>Faturamento</th><th>Clientes</th></tr></thead><tbody>${(p.cities||[]).map(x=>`<tr><td><button class="area-city-pick" data-area-city="${esc(x.key)}">${esc(x.city)} · ${esc(x.uf)}</button></td><td>${money(x.revenue,true)}</td><td>${integer(x.clients)}</td></tr>`).join('')||'<tr><td colspan="3">Sem cidades com registros no período.</td></tr>'}</tbody></table></div></section><section class="panel"><h2>Produtos da área</h2><p class="panel-sub">Principais produtos por faturamento · concentração nos três primeiros: ${pct(p.top3Share)}</p><div class="chart-wrap tall"><canvas id="areaProducts"></canvas></div></section></div>`;
 const rev=chart($('#areaMonthly'),'line',{labels:monthly.map(x=>x.label),datasets:[{label:String(p.year),data:monthly.map(x=>x.revenue),borderColor:'#1D2A68',backgroundColor:'rgba(29,42,104,.08)',fill:true,tension:.25},{label:String(p.year-1),data:monthly.map(x=>x.previous),borderColor:'#91ADD8',borderDash:[5,4],tension:.25}]},{plugins:{legend:{display:true}},scales:{y:{beginAtZero:true,ticks:{callback:v=>money(v,true)}}}});
 let growth;
 const draw=()=>{if(growth){growth.$motionCleanup?.();const old=growth.canvas.parentElement.nextElementSibling;if(old?.classList.contains('chart-motion-controls'))old.remove();growth.destroy();state.charts=state.charts.filter(c=>c!==growth);}const mode=$('#areaComparison').value;growth=chart($('#areaGrowth'),'bar',{labels:monthly.map(x=>x.label),datasets:[{label:'Variação',data:monthly.map(x=>x[mode]),backgroundColor:monthly.map(x=>x[mode]<0?'#B85B58':'#365C9D'),borderRadius:5}]},{plugins:{tooltip:{callbacks:{label:ctx=>pct(ctx.raw)}}},scales:{y:{ticks:{callback:v=>pct(v)}}}});growth.$valueFormat=pct;};draw();$('#areaComparison').onchange=draw;
 const products=p.products||[];chart($('#areaProducts'),'bar',{labels:products.map(x=>x.name),datasets:[{label:'Faturamento',data:products.map(x=>x.revenue),backgroundColor:'#365C9D',borderRadius:5}]},{indexAxis:'y'});
 $('#areaAllCities')?.addEventListener('click',()=>{state.areaCity='';state.coverageSelection=null;queryPage()});
 Array.from(root.querySelectorAll('[data-area-city]')).forEach(b=>b.onclick=()=>{state.areaCity=b.dataset.areaCity;state.coverageSelection=(state.coverage?.cities||[]).find(r=>aliasCity(r.city)+'|'+r.uf===state.areaCity)||null;queryPage()});
}



function pageLookHero(kicker,title,description,facts){
 return `<section class="page-summary-hero"><div class="page-summary-copy"><span class="history-eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="page-summary-facts">${facts.map(f=>'<div><span>'+esc(f[0])+'</span><strong>'+esc(f[1])+'</strong><small>'+esc(f[2]||'')+'</small></div>').join('')}</div></section>`;
}
function applyPageLook(page,p={}){
 const root=$('#content');if(!root||page==='history')return;
 root.classList.add('visual-page');root.dataset.presentation=page;
 const k=p.kpis||{},cities=p.cities||[],coverage=p.rows||[];
 const totalOpen=p.totalOpenValue??(Number(p.openValue||0)+Number(p.blockedValue||0));
 const definitions={
  carteira:['RELACIONAMENTO E CARTEIRA','Clientes e oportunidades de recuperação.','Clientes, frequência de compra e oportunidades de recuperação.',[['Faturamento no recorte',money(k.revenue,true),'Vendas pela data de faturamento'],['Clientes com compra',integer(k.clients),'Positivados no período']]],
  produtos:['MIX E PRODUTOS','Desempenho e composição do mix.','Explore os produtos de maior resultado e a concentração por RCA.',[['Produtos faturados',integer(k.products),'SKUs com venda no recorte'],['Clientes compradores',integer(k.clients),'Clientes distintos com compra']]],
  pedidos:['CARTEIRA DE PEDIDOS','Posição e previsão dos pedidos.','Acompanhe posições, clientes e itens para orientar o fechamento.',[['Carteira total',money(totalOpen,true),'Inclui pedidos bloqueados'],['Pedidos em aberto',integer(p.totalOpenCount??p.orders?.length),'Todos os status do recorte']]],
  cidades:['INTELIGÊNCIA TERRITORIAL',p.selected?p.selected.city+' em perspectiva.':'Faturamento por território.','Explore o faturamento de cada cidade e aprofunde produtos e clientes.',[['Faturamento da área',money(p.selected?.revenue??cities.reduce((a,x)=>a+x.revenue,0),true),p.selected?p.selected.city+' · '+p.selected.uf:'Área e período selecionados'],['Cidades com venda',integer(cities.filter(c=>c.revenue>0).length),'Municípios atendidos no recorte']]],
  metas:['PLANEJAMENTO COMERCIAL','Acompanhamento de realizado e meta.','Compare o realizado com as metas cadastradas ao longo do ano.',[['Meta do ano',money(p.totalMeta,true),'Planejamento no ano selecionado'],['Faturamento no ano',money(p.totalRevenue,true),p.totalMeta?pct(p.totalRevenue/p.totalMeta*100)+' da meta':'Sem meta cadastrada']]],
  coverage:['COBERTURA E ANÁLISE DE ÁREA','Cobertura e resultados por área.','Conecte a distribuição comercial aos resultados dos municípios.',[['Municípios no recorte',integer(coverage.length),'Linha e área selecionadas'],['Municípios conferidos',integer(coverage.filter(r=>!coveragePending(r,state.coverageFilters.department)).length),'Atribuição comercial validada']]],
  users:['ADMINISTRAÇÃO DA PLATAFORMA','Cada pessoa, com o acesso certo.','Defina as áreas, os recortes de informação e o preenchimento manual do SAC.',[['Usuários cadastrados',integer(p.users?.length),'Contas do dashboard'],['Acessos ativos',integer((p.users||[]).filter(u=>u.ativo).length),'Contas habilitadas']]]
 };
 if(page==='overview'){
  const hero=root.querySelector('.overview-hero');if(hero&&!hero.classList.contains('overview-summary-hero')){
   hero.classList.add('overview-summary-hero');const revenue=hero.querySelector('.overview-revenue');revenue.insertAdjacentHTML('afterbegin','<span class="history-eyebrow">REBANHO · VISÃO EXECUTIVA</span><h2 class="overview-summary-title">Resultado comercial do período.</h2>');root.prepend(hero);root.querySelector('.executive-period-heading')?.remove();
  }
 }else if(definitions[page]&&!root.querySelector(':scope > .page-summary-hero')){
  const config=definitions[page];const switcher=root.querySelector(':scope > .city-view-switch');if(switcher)switcher.insertAdjacentHTML('afterend',pageLookHero(...config));else root.insertAdjacentHTML('afterbegin',pageLookHero(...config));
  const grid=root.querySelector(':scope > .kpi-grid');const count={carteira:1,produtos:2,cidades:2,metas:2,pedidos:1}[page]||0;
  if(grid&&count){for(let i=0;i<count;i++)grid.firstElementChild?.remove();grid.classList.add('summary-metrics');grid.style.setProperty('--summary-columns',String(grid.children.length));}
  if(page==='pedidos')root.querySelector(':scope > .section-heading')?.remove();
  if(page==='metas')root.querySelector('.readonly-banner')?.remove();
  if(page==='coverage'){root.querySelector('.coverage-heading>div:first-child')?.remove();const stats=root.querySelector('#coverageStats');if(stats){stats.firstElementChild?.remove();stats.firstElementChild?.remove();}}
 }
 const featureSelectors={overview:'.overview-analysis>.panel:first-child',carteira:'.carteira-movement-panel',produtos:'.equal-col>.panel:first-child',cidades:'.city-layout>.panel:first-child',metas:'.two-col>.panel:first-child',pedidos:'.order-status-panel',coverage:'.coverage-map-panel,.coverage-side',users:':scope>.panel:first-of-type'};
 root.querySelectorAll(featureSelectors[page]||'.__none').forEach(panel=>panel.classList.add('feature-panel'));
 root.querySelectorAll('.panel,.table-wrap').forEach(panel=>panel.classList.add('presentation-panel'));
 for(const c of state.charts){
  if(!c.canvas?.closest('.feature-panel')||c.$panelLookApplied)continue;c.$panelLookApplied=true;
  for(const axis of Object.values(c.options.scales||{})){if(axis.ticks)axis.ticks.color='#a9bfdc';if(axis.grid)axis.grid.color='#2b4466';if(axis.border)axis.border.display=false;}
  if(c.options.plugins?.legend?.labels)c.options.plugins.legend.labels.color='#c2d5ef';
  c.data.datasets.forEach((dataset,i)=>{
   if(c.canvas.id==='portfolioMovementChart')return;
   const base=i===0?'#93c4fa':'#5178a8';if(c.config.type==='line'){dataset.borderColor=base;dataset.pointBackgroundColor=base;}
   dataset.backgroundColor=context=>{const {ctx,chartArea:a}=context.chart;if(!a)return base;const horizontal=c.options.indexAxis==='y',g=horizontal?ctx.createLinearGradient(a.left,0,a.right,0):ctx.createLinearGradient(0,a.bottom,0,a.top);g.addColorStop(0,c.config.type==='line'?'rgba(99,163,236,0.01)':i===0?'#345f98':'#344e70');g.addColorStop(1,c.config.type==='line'?'rgba(108,178,255,.28)':base);return g;};
  });c.update('none');
 }
 if(state.map&&['cidades','coverage'].includes(page))requestAnimationFrame(()=>state.map?.invalidateSize());
}

function drawInactiveList(p){
 const pick=state.inactivePick||{},all=p.inactive||[],rows=all.filter(x=>(!pick.rca||String(x.rca)===pick.rca)&&(!pick.band||(pick.band==='short'?x.isShort:x.isLong)));
 $('#inactiveTable').innerHTML=rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.rcaName)}</td><td>${fmtDate(x.last)}</td><td class="align-right">${integer(x.days)}</td><td class="align-right">${money(x.revenue12)}</td><td><span class="badge ${x.isShort?'red':'amber'}">${x.isShort?'Curto':'Longo'}</span></td></tr>`).join('')||'<tr><td colspan="6">Nenhum cliente nesta seleção.</td></tr>';
 const name=all.find(x=>String(x.rca)===pick.rca)?.rcaName||pick.rca;
 $('#inactiveSelections').innerHTML=`<span>${integer(rows.length)} clientes · fechamento ${fmtDate(p.kpis?.cutoff)}</span><div>${pick.rca?'<button data-clear-inactive="rca">'+esc(name)+' ×</button>':''}${pick.band?'<button data-clear-inactive="band">'+(pick.band==='short'?'Curto prazo':'Longo prazo')+' ×</button>':''}<button data-band="short" aria-pressed="${pick.band==='short'}">Curto prazo</button><button data-band="long" aria-pressed="${pick.band==='long'}">Longo prazo</button></div>`;
 $$('[data-clear-inactive]').forEach(b=>b.onclick=()=>{state.inactivePick[b.dataset.clearInactive]='';drawInactiveList(p)});
 $$('[data-band]').forEach(b=>b.onclick=()=>{state.inactivePick=state.inactivePick||{};state.inactivePick.band=state.inactivePick.band===b.dataset.band?'':b.dataset.band;drawInactiveList(p)});
 installTableSorting();
}
function mountCoverageFilters(active){
 const bar=$('.filterbar');if(!bar)return;
 bar.classList.toggle('coverage-context',active);
 let root=$('#coverageShared');
 if(!active){state.coverageEntered=false;root?.remove();return;}
 if(!root){root=document.createElement('div');root.id='coverageShared';root.className='coverage-shared';bar.append(root);}
 else if($('#coverageDepartment')&&!root.contains($('#coverageDepartment')))root.replaceChildren();
 const controls=$('#content .coverage-controls'),scope=$('#content .area-scope-panel');
 if(controls)root.append(controls);if(scope)root.append(scope);
 const globalRca=normalizeMulti(state.filters.rca);
 if(!state.coverageEntered){state.coverageEntered=true;const selected=(state.dimensions?.rcas||[]).find(r=>globalRca.includes(String(r.code)));if(selected){const match=coverageRcaOptions(state.coverage?.cities||[],state.coverageFilters.department).find(r=>coverageRcaKey(r.label)===coverageRcaKey(selected.name));if(match)state.coverageFilters.rca=match.key;}}
}
function installTableSorting(){
 const root=$('#appView');if(!root)return;
 const enhance=()=>root.querySelectorAll('table').forEach(table=>{table.querySelectorAll('thead th').forEach((th,index)=>{
 if(th.dataset.sortReady)return;th.dataset.sortReady='1';const label=th.textContent.trim();if(!label)return;
 const button=document.createElement('button');button.type='button';button.className='table-sort';button.textContent=label+' ↕';button.setAttribute('aria-label','Ordenar por '+label);th.replaceChildren(button);
 button.onclick=()=>{const asc=th.getAttribute('aria-sort')!=='ascending';table.querySelectorAll('th[aria-sort]').forEach(x=>x.removeAttribute('aria-sort'));th.setAttribute('aria-sort',asc?'ascending':'descending');table.querySelectorAll('.table-sort').forEach(x=>x.textContent=x.textContent.replace(/[↑↓]$/,'↕'));button.textContent=label+(asc?' ↑':' ↓');
 const value=cell=>{const t=(cell?.textContent||'').trim();const date=t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(date)return Number(date[3]+date[2]+date[1]);if(/^(?:R\$\s*)?[+-]?[\d.,\s]+(?:%|x|\s*mil|\s*mi)?$/.test(t)){let n=Number(t.replace(/R\$|%|x|mil|mi|\s/g,'').replace(/\./g,'').replace(',','.'));if(/\bmil\b/.test(t))n*=1000;else if(/\bmi\b/.test(t))n*=1000000;return n;}return t;};
 for(const body of table.tBodies){const rows=Array.from(body.rows);rows.sort((a,b)=>{const x=value(a.cells[index]),y=value(b.cells[index]);return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'pt-BR',{numeric:true,sensitivity:'base'}))*(asc?1:-1)});rows.forEach(row=>body.append(row));}
 };
 });});
 enhance();if(!root.dataset.sortObserved){root.dataset.sortObserved='1';let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}).observe(root,{childList:true,subtree:true});}
}

function biApi(url,payload){return api(url,{body:JSON.stringify(payload)});}
// Editor declarativo: medidas calculadas no mesmo worker e no escopo autorizado.
const BI={revision:0,published:null,draft:null,editing:false};
const BI_METRICS={revenue:'Faturamento',orders:'Pedidos faturados',clients:'Clientes positivados',products:'Produtos vendidos',ticket:'Ticket por pedido',mix:'Mix por cliente',goal:'Meta',attainment:'Atingimento (%)',open:'Pedidos em aberto',openCount:'Quantidade em aberto',blocked:'Valor bloqueado',pending:'Valor pendente',released:'Valor liberado',projection:'Projeção com pedidos',inactiveShort:'Inativos curto prazo',inactiveLong:'Inativos longo prazo',newClients:'Novos clientes'};
const BI_DIMS={none:'Total',month:'Mês',year:'Ano',rca:'RCA',supervisor:'Supervisor',department:'Departamento',city:'Cidade',uf:'Estado',product:'Produto',client:'Cliente',status:'Posição do pedido'};
function biConfig(){return BI.editing?BI.draft:BI.published;}
async function biInit(){try{const r=await biApi('/api/biLayout',{action:'read'});if(!r.ok)throw Error(r.message||'Configurações indisponíveis');Object.assign(BI,{revision:r.revision,published:r.published,draft:r.draft||r.published,versions:r.versions||[]});biNav();}catch(e){console.warn(e);}}
function biNav(){const nav=$('#appMenu nav');if(!nav)return;$$('[data-bi-nav]').forEach(n=>n.remove());const cfg=biConfig();for(const p of cfg?.pages||[]){if(state.user?.perfil!=='DIRETOR'&&!p.roles.includes(state.user?.perfil))continue;PAGE_META[p.id]=[p.title,'Painel personalizado · filtros comerciais compartilhados'];const b=document.createElement('button');b.className='nav-item';b.dataset.biNav='';b.textContent='▦ '+p.title;b.onclick=()=>{state.page=p.id;queryPage();$('#menuClose')?.click();};nav.append(b);}if(state.user?.perfil==='ADMIN'){const b=document.createElement('button');b.dataset.biNav='';b.className='nav-item';b.textContent='⚙ Configurações e BI';b.onclick=()=>{state.page='bi_settings';queryPage();$('#menuClose')?.click();};nav.append(b);}}
function biOptions(o,v){return Object.entries(o).map(([k,l])=>`<option value="${esc(k)}" ${k===String(v)?'selected':''}>${esc(l)}</option>`).join('');}
async function biSave(action='draft',extra={}){try{const r=await biApi('/api/biLayout',{action,revision:BI.revision,config:BI.draft,...extra});if(!r.ok)throw Error(r.message||r.error||'Não foi possível salvar');if(action!=='draft'){await biInit();BI.editing=false;biNav();}alert(r.message||'Salvo');queryPage();}catch(e){alert(e.message);}}
function biSettings(){const c=BI.draft;if(!c){$('#content').textContent='Configurações indisponíveis. Reabra o aplicativo para tentar novamente.';return;}$('#pageTitle').textContent='Configurações e BI';$('#pageSubtitle').textContent='Crie componentes e páginas; revise o rascunho antes de publicar.';$('#content').innerHTML=`<div class="panel bi-settings"><h2>Estúdio de BI</h2><p>Os cálculos usam a base comercial e respeitam as permissões de cada usuário. A publicação disponibiliza o layout para os perfis autorizados.</p><div class="bi-actions"><button id="biEdit">${BI.editing?'Encerrar prévia':'Visualizar rascunho'}</button><button id="biAdd">Adicionar componente</button><button id="biPage">Criar página</button><button id="biDraft">Salvar rascunho</button><button id="biPublish">Publicar</button><button id="biExport">Exportar configuração</button><label>Importar configuração<input id="biImport" type="file" accept="application/json"></label></div><h3>Componentes</h3><div class="table-wrap"><table><thead><tr><th>Título</th><th>Página</th><th>Indicador</th><th>Ações</th></tr></thead><tbody>${c.widgets.map((w,i)=>`<tr><td>${esc(w.title)}</td><td>${esc(PAGE_META[w.page]?.[0]||c.pages.find(p=>p.id===w.page)?.title||w.page)}</td><td>${esc(BI_METRICS[w.metric])}</td><td><button data-bi-edit="${i}">Editar</button><button data-bi-copy="${i}">Duplicar</button><button data-bi-up="${i}">↑</button><button data-bi-down="${i}">↓</button><button data-bi-hide="${i}">${w.hidden?'Mostrar':'Ocultar'}</button><button data-bi-delete="${i}">Excluir</button></td></tr>`).join('')||'<tr><td colspan="4">Adicione seu primeiro componente.</td></tr>'}</tbody></table></div><h3>Versões publicadas</h3><div class="bi-actions">${(BI.versions||[]).map(v=>`<button data-bi-restore="${v.revision}">Restaurar revisão ${v.revision} · ${esc(v.at)}</button>`).join('')||'Ainda não há versões anteriores.'}</div><h3>Fontes e atualização</h3><button id="biDiag">Consultar diagnóstico</button><pre id="biDiagText"></pre><p>A atualização automática existente continua funcionando. A configuração de frequência será disponibilizada após a validação dos gatilhos atuais.</p></div>`;
$('#biEdit').onclick=()=>{BI.editing=!BI.editing;biNav();biSettings();};$('#biAdd').onclick=()=>biForm();$('#biPage').onclick=()=>{const title=prompt('Nome da nova página');if(!title?.trim())return;c.pages.push({id:'bi_'+Date.now(),title:title.trim().slice(0,70),roles:['ADMIN']});biNav();biSettings();};$('#biDraft').onclick=()=>biSave();$('#biPublish').onclick=()=>biSave('publish');$('#biExport').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(c,null,2)],{type:'application/json'}));a.download='rebanho-bi.json';a.click();URL.revokeObjectURL(a.href);};$('#biImport').onchange=async e=>{try{const cfg=JSON.parse(await e.target.files[0].text());const r=await biApi('/api/biLayout',{action:'draft',revision:BI.revision,config:cfg});if(!r.ok)throw Error(r.message||r.error);BI.draft=cfg;biSettings();}catch(e){alert('Importação não realizada: '+e.message);}};$('#biDiag').onclick=async()=>{const r=await biApi('/api/biDiagnostics',{});$('#biDiagText').textContent=JSON.stringify(r,null,2);};
$$('[data-bi-edit]').forEach(b=>b.onclick=()=>biForm(Number(b.dataset.biEdit)));for(const [attr,fn]of Object.entries({copy:i=>{c.widgets.push({...c.widgets[i],id:'w_'+Date.now(),title:c.widgets[i].title+' (cópia)'});},delete:i=>c.widgets.splice(i,1),hide:i=>c.widgets[i].hidden=!c.widgets[i].hidden,up:i=>{if(i>0)[c.widgets[i-1],c.widgets[i]]=[c.widgets[i],c.widgets[i-1]];},down:i=>{if(i<c.widgets.length-1)[c.widgets[i+1],c.widgets[i]]=[c.widgets[i],c.widgets[i+1]];}}))$$(`[data-bi-${attr}]`).forEach(b=>b.onclick=()=>{fn(Number(b.getAttribute('data-bi-'+attr)));biSettings();});$$('[data-bi-restore]').forEach(b=>b.onclick=()=>biSave('restore',{version:Number(b.dataset.biRestore)}));}
function biForm(index){const c=BI.draft,w=c.widgets[index]||{id:'w_'+Date.now(),title:'Novo gráfico',page:'overview',type:'bar',metric:'revenue',dimension:'rca',comparison:'none',sort:'desc',limit:10,width:'half',height:300,color:'blue',interaction:true,hidden:false};const d=document.createElement('dialog');d.className='bi-dialog';const pages=Object.fromEntries([...Object.entries(PAGE_META).filter(([k])=>k!=='bi_settings'),...c.pages.map(p=>[p.id,[p.title]])].map(([k,v])=>[k,v[0]]));const selects={page:pages,type:{card:'Cartão',bar:'Barras horizontais',column:'Colunas',line:'Linha',area:'Área',doughnut:'Rosca',table:'Tabela'},metric:BI_METRICS,dimension:BI_DIMS,comparison:{none:'Sem comparação',previous:'Mês anterior',year:'Ano anterior',goal:'Meta'},sort:{desc:'Maior para menor',asc:'Menor para maior',label:'Ordem dos nomes'},width:{full:'Largura total',half:'Meia largura',third:'Um terço'},color:{blue:'Azul Rebanho',cyan:'Ciano',green:'Verde',purple:'Roxo',orange:'Laranja'}};d.innerHTML=`<form method="dialog"><h2>Configurar componente</h2><label>Título<input name="title" maxlength="100" required value="${esc(w.title)}"></label>${Object.entries(selects).map(([k,o])=>`<label>${({page:'Página',type:'Visualização',metric:'Indicador',dimension:'Agrupamento',comparison:'Comparação',sort:'Ordenação',width:'Largura',color:'Cor'})[k]}<select name="${k}">${biOptions(o,w[k])}</select></label>`).join('')}<label>Limite de categorias<input type="number" name="limit" min="3" max="50" value="${w.limit}"></label><label>Altura<input name="height" type="number" min="160" max="650" value="${w.height}"></label><label><input type="checkbox" name="interaction" ${w.interaction?'checked':''}> Filtrar ao clicar em RCA, departamento ou estado</label><p>Meta e projeção: total, período, RCA, supervisor ou departamento. Inativos: total ou RCA. Pedidos em aberto: sem agrupamento por produto.</p><div class="bi-actions"><button value="cancel">Cancelar</button><button id="biApply" type="button">Aplicar ao rascunho</button></div></form>`;document.body.append(d);d.showModal();d.onclose=()=>d.remove();$('#biApply',d).onclick=async()=>{const f=new FormData($('form',d)),v={...w,...Object.fromEntries(f),limit:Number(f.get('limit')),height:Number(f.get('height')),interaction:f.has('interaction')};const next=structuredClone(c);if(index===undefined)next.widgets.push(v);else next.widgets[index]=v;try{const r=await biApi('/api/biLayout',{action:'draft',revision:BI.revision,config:next});if(!r.ok)throw Error(r.message||r.error||'Configuração inválida');BI.draft=next;d.close();biSettings();}catch(e){alert(e.message);}};}
function biRender(page,payload){const cfg=biConfig();if(!cfg)return;const ws=cfg.widgets.filter(w=>w.page===page&&!w.hidden);if(page.startsWith('bi_'))$('#content').innerHTML='';if(!ws.length)return;const grid=document.createElement('div');grid.className='bi-grid';$('#content').append(grid);for(const w of ws){const data=payload.bi?.find(x=>x.id===w.id),rows=data?.rows||[],panel=document.createElement('section');panel.className='panel bi-widget bi-'+w.width;grid.append(panel);const fmt=n=>n==null?'—':['clients','orders','products','openCount','inactiveShort','inactiveLong','newClients'].includes(w.metric)?Number(n).toLocaleString('pt-BR'):['mix','attainment'].includes(w.metric)?Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2})+(w.metric==='attainment'?'%':''):money(n,true);panel.innerHTML=`<h3>${esc(w.title)}</h3><small>${esc(BI_METRICS[w.metric])} · ${esc(BI_DIMS[w.dimension])}</small>`;if(data?.error){panel.append(Object.assign(document.createElement('p'),{textContent:data.error}));continue;}if(w.type==='card'){panel.innerHTML+=`<strong class="bi-number">${fmt(rows[0]?.value)}</strong>${rows[0]?.comparison!=null?`<small>Referência: ${fmt(rows[0].comparison)}</small>`:''}`;continue;}if(w.type==='table'){panel.innerHTML+=`<div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Valor</th>${w.comparison!=='none'?'<th>Referência</th><th>Variação</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${fmt(r.value)}</td>${w.comparison!=='none'?`<td>${fmt(r.comparison)}</td><td>${r.change==null?'—':r.change.toFixed(1)+'%'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;continue;}const wrap=document.createElement('div');wrap.style.height=w.height+'px';const canvas=document.createElement('canvas');wrap.append(canvas);panel.append(wrap);const color={blue:'#223470',cyan:'#148fbd',green:'#168a76',purple:'#7952b3',orange:'#d98a21'}[w.color];const click=(e,items)=>{if(!w.interaction||!items.length)return;const r=rows[items[0].index];if(['rca','department','supervisor','uf'].includes(w.dimension)){state.filters[w.dimension]=normalizeMulti(state.filters[w.dimension]).includes(String(r.key))?[]:[String(r.key)];setupFilters();queryPage();}};chart(canvas,['column','bar'].includes(w.type)?'bar':w.type==='area'?'line':w.type,{labels:rows.map(r=>r.label),datasets:[{label:BI_METRICS[w.metric],data:rows.map(r=>r.value),backgroundColor:w.type==='doughnut'?rows.map((_,i)=>`hsl(${215+i*17} 45% ${35+i%4*10}%)`):color,borderColor:color,fill:w.type==='area',borderRadius:5},...(w.comparison!=='none'?[{label:'Referência',data:rows.map(r=>r.comparison),backgroundColor:'#bdcfea',borderColor:'#9cb6dc'}]:[])]},{indexAxis:w.type==='bar'?'y':'x',onClick:click,plugins:{legend:{display:true},tooltip:{callbacks:{label:ctx=>fmt(ctx.raw)}}},...(w.type==='doughnut'?{scales:{}}:{})});}}

// Central Rebanho e módulo de logística.
const LOG={page:'overview',cache:{},pending:{},filters:{year:'Todos',month:'Todos',uf:[],region:[],city:[],seller:[],driver:[],vehicle:[],status:[],product:[],route:[],carrier:[]},search:'',tablePage:0,epoch:0,kind:'operations',metric:'weight',geo:null,geoPromise:null,timer:null,advanced:false,kindFilters:{}};
const LOG_PAGES={overview:['Visão geral','Panorama operacional de cargas e entregas','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],map:['Mapa logístico','Peso em aberto, regiões e municípios','M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15'],transport:['Transportadoras e SAC','Atrasos, saídas e acompanhamento das notas','M3 5h18v14H3zM3 9h18M8 5v14M12 13h5M12 16h3'],formation:['Formação de cargas','Registros, clientes, produtos e previsão','M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10'],routes:['Rotas e entregas','Carteira logística, destinos e prazos','M4 6a2 2 0 1 0 0 .1M20 18a2 2 0 1 0 0 .1M6 6h9a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h9'],fleet:['Motoristas e frota','Movimentação por motorista, veículo e agenda','M2 5h12v12H2zM14 9h4l4 4v4h-8M7 19a2 2 0 1 0 0 .1M18 19a2 2 0 1 0 0 .1'],pending:['Pendências','Espera, previsão e acompanhamento','M12 3l10 18H2L12 3zM12 9v5M12 17v1'],occurrences:['Ocorrências','Categorias, responsáveis e follow-up','M6 3h12v18H6zM9 7h6M9 11h6M9 15h3'],costs:['Custos','Custos informados e cobertura da base','M12 3v18M17 7c-1-4-10-4-10 1s10 2 10 7-9 5-11 1'],indicators:['Qualidade da formação','Assertividade e ocorrências na formação de carga','M4 21V10h4v11M10 21V4h4v17M16 21V7h4v14'],sources:['Fontes de dados','Origem, atualização e conexão de leitura','M3 5c0-4 18-4 18 0s-18 4-18 0M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0']};
function areaAllowed(area){return ['ADMIN','DIRETOR'].includes(state.user?.perfil)||(state.user?.areas||(['GERENTE'].includes(state.user?.perfil)?['commercial','logistics']:['commercial'])).includes(area);}
function logAllowed(){return areaAllowed('logistics');}
function moduleIcon(path){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;}
function showModules(){state.module='hub';state.page='hub';++state.requestId;++LOG.epoch;destroyCharts();if(state.map){try{state.map.remove()}catch{}state.map=null;}$('#appView').classList.add('hidden');$('#loginView').classList.add('hidden');document.body.dataset.module='hub';let el=$('#moduleHub');if(!el){el=document.createElement('section');el.id='moduleHub';el.className='module-hub';document.body.append(el);}el.classList.remove('hidden');el.innerHTML=`<header class="hub-header"><img src="${esc($('.login-logo').src)}" alt="Rebanho"><div><span>${esc(state.user?.nome||state.user?.login||'')}</span><button class="btn ghost" id="hubLogout">Sair</button></div></header><main class="hub-main"><span class="history-eyebrow">REBANHO · INTELIGÊNCIA DE GESTÃO</span><h1>Qual operação vamos acompanhar?</h1><p>Escolha um painel para acessar os indicadores da sua área.</p><div class="module-cards"><button class="module-card commercial-module" id="openCommercial"><span class="module-card-icon">${moduleIcon(LOG_PAGES.overview[2])}</span><small>GESTÃO COMERCIAL</small><h2>Comercial</h2><p>Faturamento, metas, pedidos, clientes, produtos e cobertura territorial.</p><span class="module-card-link">Abrir Supervisão ${moduleIcon("M7 17L17 7M7 7h10v10")}</span></button><button class="module-card logistics-module" id="openLogistics"><span class="module-card-icon">${moduleIcon(LOG_PAGES.fleet[2])}</span><small>GESTÃO OPERACIONAL</small><h2>Logística</h2><p>Cargas, rotas, entregas, motoristas, ocorrências e desempenho.</p><span class="module-card-link">${logAllowed()?'Abrir Logística':'Acesso para perfis de gestão'} ${moduleIcon("M7 17L17 7M7 7h10v10")}</span></button></div></main>`;if(state.user?.transportOnly){$('#openLogistics h2').textContent='Transportadoras';$('#openLogistics small').textContent='ACOMPANHAMENTO DE TRANSPORTADORAS';$('#openLogistics p').textContent='Entregas, prazos, ocorrências e acompanhamento das notas.';}$('#openCommercial').hidden=!areaAllowed('commercial');$('#openLogistics').hidden=!logAllowed();if(state.user?.perfil==='ADMIN')$('.module-cards').insertAdjacentHTML('beforeend',`<button class="module-card admin-module" id="openAdministration"><span class="module-card-icon">${moduleIcon('M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4zM9 12l2 2 4-4')}</span><small>ADMINISTRAÇÃO DA PLATAFORMA</small><h2>Usuários e acessos</h2><p>Perfis, áreas, equipes e permissões de consulta e edição.</p><span class="module-card-link">Gerenciar plataforma →</span></button>`);$('#openAdministration')?.addEventListener('click',()=>openModule('administration'));$('#openCommercial').onclick=()=>openModule('commercial');$('#openLogistics').onclick=()=>openModule('logistics');$('#hubLogout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});}finally{location.reload();}};}
async function openModule(which){if(which==='administration'&&state.user?.perfil!=='ADMIN'||which==='commercial'&&!areaAllowed('commercial')||which==='logistics'&&!logAllowed()){alert('Seu usuário não tem acesso a esta área.');return;}++state.requestId;destroyCharts();state.module=which;document.body.dataset.module=which;$('#moduleHub')?.classList.add('hidden');$('#appView').classList.remove('hidden');renderUser();if(!state.shellBound){bindShell();state.shellBound=true;}if(!$('#switchModule')){const b=document.createElement('button');b.type='button';b.id='switchModule';b.className='btn ghost module-switch';b.innerHTML=moduleIcon('M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z')+'<span>Áreas</span>';b.onclick=()=>{$('#menuClose')?.click();showModules();};$('.header-account').prepend(b);}
$('#switchModule').classList.toggle('hidden',state.user?.formationOnly===true);
$('#appMenu .menu-footer').textContent=which==='logistics'?'Dashboard de Logística':'Dashboard de Supervisão';document.title=which==='logistics'?'Rebanho · Logística':'Rebanho · Supervisão';$('#appMenu .menu-caption').textContent=which==='logistics'?'PAINEL LOGÍSTICO':'PAINEL COMERCIAL';$('#appMenu .menu-heading strong').textContent=which==='logistics'?'Inteligência logística':'Inteligência comercial';$('.topbar .eyebrow').textContent=which==='logistics'?'Dashboard de Logística':'Dashboard de Supervisão';$('#refreshData').innerHTML='<span aria-hidden="true">↻</span> '+(which==='logistics'?'Atualizar dados':'Atualizar bases');$('#refreshData').disabled=false;
if(which==='administration'){state.page='users';document.title='Rebanho · Administração';$('.topbar .eyebrow').textContent='Central Rebanho';$('#pageTitle').textContent='Administração da plataforma';$('#pageSubtitle').textContent='Usuários, áreas e permissões';$('#activeMenuLabel').textContent='Administração';$('#appMenu .menu-heading strong').textContent='Administração';$('#appMenu .menu-caption').textContent='PLATAFORMA';$('#logFilters')?.classList.add('hidden');$('.filterbar').classList.add('hidden');$('#dataStatus').classList.add('hidden');$('#refreshData').hidden=true;$('#periodChip').hidden=true;$('#lastBaseUpdate').textContent='';$('#content').className='admin-content';renderUsers();return;}$('#refreshData').hidden=false;$('#periodChip').hidden=false;if(which==='commercial'){$('#content').className='';state.page=state.commercialPage||'overview';$('#activeMenuLabel').textContent=PAGE_META[state.page]?.[0]||'Comercial';$$('#appMenu [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));$('#logFilters')?.classList.add('hidden');if(!BI.published)await biInit();if(!state.worker)initData();else queryPage();}
else{if(!logPageAllowed(LOG.page))LOG.page=['formation','agenda','transport','overview'].find(logPageAllowed)||'unavailable';
 if(LOG.page==='transport'){LOG.indicatorTab='transport';LOG.kind='transport';}
 state.page='logistics';setStatus('',false);logNav();$('.filterbar').classList.add('hidden');logShow();logLoad(LOG.kind,false,true);if(!LOG.timer)LOG.timer=setInterval(()=>{if(state.module==='logistics'&&!document.hidden){
 if(LOG.page==='agenda'&&!document.querySelector('.formation-dialog[open]'))agendaRefreshVisible();
 else logLoad(LOG.kind,false,true);
}},180000);}}

function logKind(){return LOG.page==='transport'?'transport':LOG.page==='indicators'?'formations':LOG.page==='fleet'&&LOG.fleetTab==='schedule'?'schedule':'operations';}
function logFetchSource(kind, force=false, check=false) {
 const pending=LOG.pending[kind];
 if(pending) return force&&!pending.force ? pending.task.catch(()=>{}).then(()=>logFetchSource(kind,true,check)) : pending.task;
 const existing=LOG.cache[kind];
 if(existing&&!force&&!check)return Promise.resolve(false);
 const version=check?existing?.meta?.version:null;
 const task=api('/api/logistics',{body:JSON.stringify({kind,force,check,version})}).then(result=>{
   // Uma gravação confirmada invalida a leitura que começou antes dela.
   if(LOG.cache[kind]!==existing)return false;
   if(result.unchanged)return false;
   LOG.cache[kind]=result;
   return true;
 }).finally(()=>{
   if(LOG.pending[kind]?.task===task)delete LOG.pending[kind];
 });
 LOG.pending[kind]={task,force};
 return task;
}

async function logLoad(kind,force=false,check=false) {
 if(!logPageAllowed(LOG.page)||['settings','agenda'].includes(LOG.page)||LOG.page==='formation'&&FEXP.view!=='legacy')return;
 if(LOG.page==='overview')return logOverviewLoad(force,check);
 const visible=()=>state.module==='logistics'&&LOG.page!=='overview'&&LOG.page!=='settings'&&
   !(LOG.page==='formation'&&FEXP.view!=='legacy')&&logKind()===kind;
 const existing=LOG.cache[kind];
 try{
   if(!existing&&visible()&&LOG.page!=='formation')$('#content').innerHTML='<div class="status-card"><div class="spinner"></div><div><strong>Carregando dados logísticos</strong><p>Consultando a planilha de origem…</p></div></div>';
   const changed=await logFetchSource(kind,force,check);
   if(!changed||!visible())return;
   if(!existing){
     const latest=LOG.cache[kind]?.meta?.to;
     LOG.filters.year=latest?latest.slice(0,4):'Todos';
     LOG.filters.month=latest?String(Number(latest.slice(5,7))):'Todos';
   }
   logShow();
 }catch(error){
   if(!visible())return;
   if(LOG.cache[kind]){formationNotice('A lista atual continua disponível. '+error.message);return;}
   $('#content').innerHTML=`<div class="panel empty"><h2>Não foi possível ler a fonte logística</h2><p>${esc(error.message)}</p><button id="logRetry" class="btn">Tentar novamente</button></div>`;
   $('#logRetry').onclick=()=>logLoad(kind,true);
 }
}
function logN(v,d=0){return v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:d,minimumFractionDigits:d});}
function logSum(rows,k){return rows.reduce((s,r)=>s+(Number(r[k])||0),0);}
function logAvg(rows,k){const a=rows.filter(r=>r[k]!=null&&Number.isFinite(Number(r[k])));return a.length?logSum(a,k)/a.length:null;}
function logDistinct(rows,k){return new Set(rows.map(r=>r[k]).filter(Boolean)).size;}
function logGroup(rows,key,value=null,mode='sum'){const map=new Map();for(const r of rows){const k=r[key]||'Não informado';if(!map.has(k))map.set(k,{key:k,name:k,value:0,count:0});const x=map.get(k);if(mode==='count'){x.value++;x.count++;}else if(r[value]!=null&&Number.isFinite(Number(r[value]))){x.value+=Number(r[value]);x.count++;}}return [...map.values()].map(x=>({...x,value:mode==='avg'?(x.count?x.value/x.count:null):x.value})).sort((a,b)=>(b.value||0)-(a.value||0));}
function logRows(all,{ignorePeriod=false}={}){const f=LOG.filters,q=normalize(LOG.search);return all.filter(r=>{if(!ignorePeriod&&f.year!=='Todos'&&(!r.date||r.date.slice(0,4)!==f.year))return false;if(!ignorePeriod&&f.month!=='Todos'&&(!r.date||Number(r.date.slice(5,7))!==Number(f.month)))return false;for(const k of ['uf','region','city','seller','driver','vehicle','status','product','route','carrier','category','problem','checker','responsible','cargoType'])if(f[k]?.length&&!f[k].includes(String(r[k]||'')))return false;return !q||normalize([r.client,r.city,r.product,r.invoice,r.driver,r.region,r.problem,r.description,r.destination].filter(Boolean).join(' ')).includes(q);});}
function logPick(key,value){LOG.filters[key]=(LOG.filters[key]||[]).includes(value)?[]:[value];LOG.tablePage=0;logShow();}
function logFilters(all){let el=$('#logFilters');if(!el){el=document.createElement('section');el.id='logFilters';el.className='filterbar logistics-filter';$('#dataStatus').before(el);}el.classList.remove('hidden');const f=LOG.filters,years=[...new Set(all.map(r=>r.date?.slice(0,4)).filter(Boolean))].sort().reverse();const overviewDims={uf:'Estado',city:'Cidade',status:'Status',...(logOverviewArea()!=='sac'?{region:'Região',seller:'Vendedor'}:{}),...(logOverviewArea()!=='formation'?{carrier:'Transportadora'}:{})};const dims=LOG.page==='overview'?overviewDims:LOG.kind==='transport'?{carrier:'Transportadora',uf:'Estado',city:'Cidade',status:'Status',category:'Ocorrência',responsible:'Responsável',cargoType:'Tipo de carga'}:LOG.kind==='formations'?{region:'Região',driver:'Motorista',vehicle:'Veículo',category:'Ocorrência',checker:'Conferente'}:LOG.kind==='schedule'?{driver:'Motorista'}:{uf:'Estado',region:'Região',city:'Cidade',seller:'Vendedor',driver:'Motorista',vehicle:'Veículo',status:'Status',product:'Produto',route:'Classificação de rota',category:'Ocorrência'};
 el.innerHTML=`<div class="filterbar-top"><div class="filter-intro"><span class="filter-icon">${moduleIcon('M8 2v4M16 2v4M3 9h18M4 4h16v17H4z')}</span><div><strong>Período da análise</strong><small>${LOG.page==='overview'?'Implantação / emissão da NF':LOG.kind==='transport'?'Emissão da NF':LOG.kind==='formations'?'Data da formação':LOG.kind==='schedule'?'Data da agenda':'Data de implantação'}</small></div></div><div class="filterbar-main"><div class="filter-group period"><label for="logYear">Ano</label><select id="logYear">${biOptions(Object.fromEntries(['Todos',...years].map(y=>[y,y])),f.year)}</select></div><div class="filter-group period"><label for="logMonth">Mês</label><select id="logMonth">${biOptions({Todos:'Todos',...Object.fromEntries(['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i)=>[i+1,m]))},f.month)}</select></div><button class="filter-refine" id="logMore" aria-expanded="${LOG.advanced}">${LOG.advanced?'−':'＋'} Mais filtros</button><button class="filter-clear" id="logClear">Limpar</button></div></div><div class="log-advanced ${LOG.advanced?'':'hidden'}">${Object.entries(dims).map(([k,l])=>`<div class="filter-group"><label>${l}</label><div class="multi-select" id="logF_${k}"></div></div>`).join('')}<div class="filter-group"><label for="logSearch">Buscar no detalhe</label><input type="search" id="logSearch" placeholder="${LOG.page==='overview'&&logOverviewArea()==='formation'?'Cidade ou região…':'Cliente, nota, cidade…'}" value="${esc(LOG.search)}"></div></div><div class="log-active-filters">${Object.entries(f).filter(([k,v])=>Array.isArray(v)&&v.length).map(([k,v])=>`<button data-log-clear="${k}">${esc(dims[k]||k)}: ${esc(v.join(', '))} ×</button>`).join('')}</div>`;
 if(LOG.advanced)for(const [k]of Object.entries(dims)){const values=[...new Set(all.map(r=>r[k]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));fillMultiSelect($('#logF_'+k),values.map(v=>({value:v,label:v})),f[k]||[],()=>{LOG.filters[k]=selectedMulti('logF_'+k);LOG.tablePage=0;logShow();});}
 $('#logYear').onchange=e=>{f.year=e.target.value;LOG.tablePage=0;logShow();};$('#logMonth').onchange=e=>{f.month=e.target.value;LOG.tablePage=0;logShow();};$('#logMore').onclick=()=>{LOG.advanced=!LOG.advanced;logFilters(all);};$('#logClear').onclick=()=>{for(const k of Object.keys(f))f[k]=Array.isArray(f[k])?[]:'Todos';LOG.search='';LOG.tablePage=0;if(LOG.page==='formation'&&FEXP.tab==='plan'){FEXP.priorityCity='';FEXP.withoutInvoice=false;FEXP.page=0;}logShow();};$('#logSearch').onchange=e=>{LOG.search=e.target.value;LOG.tablePage=0;logShow();};$$('[data-log-clear]').forEach(b=>b.onclick=()=>{f[b.dataset.logClear]=[];logShow();});}
function logKpis(items){return `<div class="log-kpis">${items.map(([l,v,n])=>`<div class="kpi-card"><div class="kpi-label">${esc(l)}</div><div class="kpi-value">${esc(v)}</div><div class="kpi-note">${esc(n||'')}</div></div>`).join('')}</div>`;}
function logHero(eyebrow,title,note,stats){return `<section class="log-hero page-summary-hero"><span class="history-eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2><p>${esc(note)}</p><div class="log-hero-stats">${stats.map(([label,value,sub])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub||'')}</small></div>`).join('')}</div></section>`;}
function logPanel(id,title,sub=''){return `<section class="panel presentation-panel log-chart-panel" data-log-chart="${id}"><div class="panel-heading"><div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div></div><div class="log-chart-wrap"><canvas id="${id}"></canvas></div></section>`;}
function logChart(id,rows,key,{type='bar',format=v=>logN(v),comparison=null,source=[]}={}){
 const el=$('#'+id);if(!el)return;
 const accent=['logWait','logLateCity','logPendingRegion','logProblems','logTransportProblems','logOccurrence'].includes(id)?'#a64d32':
   ['logVehicle','logService','logOverviewService','logDailyDelivery','logCostDriver','logWaitRegion'].includes(id)?'#995023':'#b85a25';
 const data=type==='donut'?rows:rows.slice(0,type==='line'?90:10),horizontal=['bar','service'].includes(type),colors=['#c15b1c','#ed9b4e','#f4c48c','#9e481c','#f8dfbe','#763f25','#b28461','#d9b597'];
 const labels=data.map(x=>{const v=x.name||x.key;return type==='line'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v.slice(8)+'/'+v.slice(5,7):String(v);});
 const total=data.reduce((s,r)=>s+(Number(r.value)||0),0),share=v=>logN(total?Number(v)/total*100:0,1)+'%';
 const datasets=type==='service'?[['No prazo','#a74c20',r=>r.onTime],['Com atraso','#b14c48',r=>r.late],['Em aberto','#edb779',r=>!r.delivered]].map(([label,color,test])=>({label,data:data.map(c=>source.filter(r=>(r.carrier||'Não informado')===c.key&&test(r)).length),backgroundColor:color,solidColor:true,borderRadius:4,barThickness:20})):[{label:type==='line'?'Evolução':'Total',data:data.map(x=>x.value),backgroundColor:type==='donut'?data.map((_,i)=>colors[i%colors.length]):type==='line'?accent+'29':accent,solidColor:true,borderColor:accent,borderWidth:type==='line'?3:0,borderRadius:5,barThickness:horizontal?18:undefined,pointRadius:type==='line'?3:undefined,fill:type==='line',tension:.3,...(comparison||{})}];
 const tooltip=c=>{if(type==='donut')return logN(c.raw)+' registros · '+share(c.raw);if(id==='logLateCity'){const city=data[c.dataIndex].key,a=source.filter(r=>(r.city||'Não informado')===city);return ['Notas atrasadas: '+logN(c.raw),'Entregues fora do prazo: '+logN(a.filter(r=>r.late).length),'Pendências vencidas: '+logN(a.filter(r=>r.overdue&&!r.delivered).length)];}return (type==='service'?c.dataset.label+': ':'')+format(c.raw);};
 const categoryTick=function(v){return this.getLabelForValue(v);};
 const instance=chart(el,type==='donut'?'doughnut':['column','service'].includes(type)?'bar':type,{labels,datasets},{indexAxis:horizontal?'y':'x',cutout:type==='donut'?'68%':undefined,layout:{padding:{right:horizontal?62:12,top:10,bottom:8}},plugins:{legend:{display:type==='service',position:'bottom',labels:{color:'#8a6450',boxWidth:9,usePointStyle:true,padding:16,font:{size:11}}},tooltip:{callbacks:{title:items=>labels[items[0]?.dataIndex]||'',label:tooltip}},barValueLabels:{display:type==='bar',formatter:format}},scales:type==='donut'?{}:{x:{type:horizontal?'linear':'category',stacked:type==='service',beginAtZero:horizontal,grid:{display:horizontal,color:'#f0e4d8'},ticks:{maxTicksLimit:horizontal?6:12,color:'#745447',font:{size:10},callback:horizontal?v=>format(v):categoryTick}},y:{type:horizontal?'category':'linear',stacked:type==='service',beginAtZero:!horizontal,grid:{display:!horizontal,color:'#f0e4d8'},ticks:{autoSkip:!horizontal,color:'#694e42',font:{size:11},callback:horizontal?categoryTick:v=>format(v)}}},onClick:(e,hits)=>{if(key&&hits.length)logPick(key,data[hits[0].index].key);}});
 if(type==='donut'){const legend=document.createElement('div');legend.className='log-status-labels';legend.setAttribute('aria-label','Quantidade e participação por status');legend.innerHTML=data.map((r,i)=>`<button type="button" data-status-index="${i}"><i style="background:${colors[i%colors.length]}"></i><span>${esc(labels[i])}</span><strong>${logN(r.value)} · ${share(r.value)}</strong></button>`).join('');el.closest('.panel').append(legend);legend.querySelectorAll('button').forEach(b=>b.onclick=()=>{if(key)logPick(key,data[Number(b.dataset.statusIndex)].key);});}
 return instance;
}

const LOG_OP_COLS=[['date','Implantação','date'],['client','Cliente'],['seller','Vendedor'],['cityLabel','Cidade'],['region','Região'],['product','Produto'],['volumes','Volumes','num'],['weight','Peso (kg)','num'],['wait','Espera (dias)','num'],['driver','Motorista'],['vehicle','Veículo'],['status','Status'],['forecast','Previsão','date'],['loaded','Carregamento','date'],['deliveredDate','Chegada','date'],['invoice','Nota fiscal'],['category','Ocorrência'],['follow','Follow-up'],['loading','Local de carregamento'],['checker','Conferente'],['picker','Separador'],['notes','Observações']];
function logTable(title,rows,cols){LOG.tableRows=rows;LOG.tableCols=cols;const size=50,start=Math.min(LOG.tablePage*size,Math.max(0,Math.floor((rows.length-1)/size)*size)),part=rows.slice(start,start+size),cell=(r,[k,,type])=>r[k]==null||r[k]===''?'—':type==='date'?r[k].split('-').reverse().join('/'):type==='money'?money(r[k]):type==='num'?logN(r[k],2):String(r[k]);return `<section class="panel log-detail-panel" id="logDetail"><div class="log-table-heading"><div><h3>${esc(title)}</h3><p>${logN(rows.length)} registros · use as setas dos títulos para ordenar esta página</p></div><button class="btn" id="logExport">Exportar CSV</button></div><div class="table-wrap"><table class="log-table"><thead><tr>${LOG.kind==='transport'&&state.user?.editTransport?'<th>Preenchimento SAC</th>':''}${cols.map(([,label])=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${part.map(r=>`<tr>${LOG.kind==='transport'&&state.user?.editTransport?`<td><button class="btn sac-edit" data-sac-edit="${esc(r.id)}">Preencher</button></td>`:''}${cols.map(col=>`<td>${esc(cell(r,col))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length}">Nenhum registro no recorte.</td></tr>`}</tbody></table></div><div class="log-pagination"><button class="btn" id="logPrev" ${start===0?'disabled':''}>Anterior</button><span>${rows.length?start+1:0}–${Math.min(start+size,rows.length)} de ${rows.length}</span><button class="btn" id="logNext" ${start+size>=rows.length?'disabled':''}>Próxima</button></div></section>`;}
function logBindTable(){if(!$('#logExport'))return;$$('[data-sac-edit]').forEach(b=>b.onclick=()=>sacEdit(b.dataset.sacEdit));$('#logExport').onclick=()=>{const clean=x=>{let s=String(x??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const text='\uFEFF'+[LOG.tableCols.map(c=>c[1]),...LOG.tableRows.map(r=>LOG.tableCols.map(c=>r[c[0]]??''))].map(r=>r.map(clean).join(';')).join('\r\n');const u=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=u;a.download='rebanho-logistica-'+LOG.page+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};$('#logPrev').onclick=()=>{LOG.tablePage=Math.max(0,LOG.tablePage-1);logShow();};$('#logNext').onclick=()=>{LOG.tablePage++;logShow();};}
function logSetKind(kind){const period={year:LOG.filters.year,month:LOG.filters.month},prev=LOG.kind;LOG.kindFilters[prev]=structuredClone(LOG.filters);LOG.filters=LOG.kindFilters[kind]||{year:'Todos',month:'Todos',uf:[],region:[],city:[],seller:[],driver:[],vehicle:[],status:[],product:[],route:[],carrier:[]};Object.assign(LOG.filters,period);LOG.kind=kind;if(kind==='transport'&&LOG.metric==='wait')LOG.metric='weight';LOG.search='';LOG.tablePage=0;}
function logShow(){if(state.module!=='logistics')return;
 if(!logPageAllowed(LOG.page)){
  $('#content').innerHTML='<section class="panel"><h2>Área indisponível para seu perfil</h2></section>';
  logNav();
  return;
 }
 if(LOG.page==='agenda'){agendaShow();return;}if(LOG.page==='settings'&&!state.user?.transportOnly){cargoSettingsShow();return;}$('#refreshData').hidden=false;if(LOG.page==='overview'){logOverview();return;}if(LOG.page==='formation'&&FEXP.view!=='legacy'&&!state.user?.transportOnly){formationShow();return;}const epoch=++LOG.epoch;destroyCharts();if(state.map){try{state.map.remove()}catch{}state.map=null;}$('#content').className='visual-page logistics-content';$('#content').dataset.presentation='logistics';$('.filterbar:not(#logFilters)')?.classList.add('hidden');$('#dataStatus').classList.add('hidden');const page=state.user?.transportOnly?['Transportadoras','Entregas, prazos e acompanhamento das notas']:LOG_PAGES[LOG.page]||LOG_PAGES.overview;$('#pageTitle').textContent=page[0];$('#pageSubtitle').textContent=page[1];$('#activeMenuLabel').textContent='Logística · '+page[0];logNav();if(LOG.page==='sources'){$('#logFilters')?.classList.add('hidden');logSources();return;}const kind=logKind();if(kind!==LOG.kind)logSetKind(kind);const data=LOG.cache[kind];if(!data){$('#logFilters')?.classList.add('hidden');logLoad(kind);return;}const all=data.rows||[],rows=logRows(all),open=rows.filter(r=>!r.delivered),waiting=rows.filter(logAwaitingFormation),meta=data.meta||{};logFilters(all);$('#lastBaseUpdate').textContent=(meta.reference?'Referência: ':'Leitura da planilha: ')+new Date(meta.reference?meta.referenceUpdatedAt:meta.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})+(meta.reference?' · referência importada':'');$('#periodChip').textContent=(LOG.filters.month==='Todos'?'Todos os meses':String(LOG.filters.month).padStart(2,'0'))+' · '+(LOG.filters.year==='Todos'?'Todos os anos':LOG.filters.year);
let html='',charts=[];const addChart=(id,data,key,opts)=>charts.push(()=>logChart(id,data,key,opts));const weight=v=>logN(v/1000,1)+' t',number=v=>logN(v),wait=v=>logN(v,1)+' dias';
if(kind==='operations'){
const k=logKpis([['Aguardando formação',logN(waiting.length),'Somente STATUS DA ENTREGA em branco'],['Em rota',logN(rows.filter(r=>r.inRoute).length)],['Entregues',logN(rows.filter(r=>r.delivered).length)],['Espera média',wait(logAvg(waiting,'wait')),'Aguardando formação com espera informada'],['Ocorrências',logN(rows.filter(r=>r.occurrence).length)]]);
html=logHero('REBANHO · INTELIGÊNCIA LOGÍSTICA',LOG.page==='overview'?'A operação, do carregamento à entrega.':page[0],LOG.page==='overview'?'Peso, espera e pendências para orientar as próximas decisões.':page[1],[['Peso aguardando formação',weight(logSum(waiting,'weight')),'Somente STATUS DA ENTREGA em branco'],['Peso em rota',weight(logSum(rows.filter(r=>r.inRoute),'weight')),'Caminhões já em rota'],['Clientes no recorte',logN(logDistinct(rows,'client')),'Clientes distintos na seleção']])+k;

if(['map','routes'].includes(LOG.page)){if(LOG.page==='routes')html+=logKpis([['Regiões em aberto',logN(logDistinct(open,'region'))],['Sem previsão',logN(open.filter(r=>!r.forecast).length)],['Sem motorista',logN(open.filter(r=>!r.driver).length)]]);html+=logMapMarkup();html+=logTable('Detalhe das rotas e destinos',rows,LOG_OP_COLS);}
if(LOG.page==='formation'){html+='<button class="btn primary" id="formationBackExperimental">Voltar à gestão experimental de cargas</button>';html+=logMapMarkup();html+=logKpis([['Registros',logN(rows.length)],['Volumes',logN(logSum(rows,'volumes'))],['Peso total',weight(logSum(rows,'weight'))]]);html+='<div class="two-col">'+logPanel('logLoadProduct','Peso por produto','Clique para filtrar a formação.')+logPanel('logLoadDriver','Distribuição por motorista','Clique para filtrar.')+'</div>';addChart('logLoadProduct',logGroup(rows,'product','weight'),'product',{format:weight});addChart('logLoadDriver',logGroup(rows,'driver','weight'),'driver',{format:weight});html+=logTable('Formação de cargas · registros da base',rows,LOG_OP_COLS);}
if(LOG.page==='fleet'){html+=`<div class="city-view-switch"><button class="active" id="logFleet">Motoristas e frota</button>${canLog('agenda')?'<button id="logAgenda">Agenda de motoristas</button>':''}</div>`;html+='<div class="two-col">'+logPanel('logDriver','Peso por motorista','Clique para filtrar.')+logPanel('logVehicle','Peso por veículo','Clique para filtrar.')+'</div>';addChart('logDriver',logGroup(rows.filter(r=>r.driver),'driver','weight'),'driver',{format:weight});addChart('logVehicle',logGroup(rows.filter(r=>r.vehicle),'vehicle','weight'),'vehicle',{format:weight});const drivers=[...new Set(rows.map(r=>r.driver).filter(Boolean))].map(driver=>{const a=rows.filter(r=>r.driver===driver);return {driver,records:a.length,clients:logDistinct(a,'client'),weight:logSum(a,'weight'),delivered:a.filter(r=>r.delivered).length,occurrences:a.filter(r=>r.occurrence).length};}).sort((a,b)=>b.weight-a.weight);html+=logTable('Movimentação por motorista',drivers,[['driver','Motorista'],['records','Registros','num'],['clients','Clientes','num'],['weight','Peso (kg)','num'],['delivered','Entregues','num'],['occurrences','Ocorrências','num']]);}
if(LOG.page==='pending'){html+=logKpis([['Espera ≥ 10 dias',logN(open.filter(r=>r.wait>=10).length)],['Sem previsão',logN(open.filter(r=>!r.forecast).length)],['Sem motorista',logN(open.filter(r=>!r.driver).length)],['Ocorrências sem follow-up',logN(open.filter(r=>r.category&&!r.follow&&r.occurrence).length)]]);html+='<div class="two-col">'+logPanel('logPendingRegion','Pendências por região','Prioridade pelo peso ainda não entregue.')+logPanel('logPendingStatus','Posição da carteira','Clique para filtrar as pendências.')+'</div>';addChart('logPendingRegion',logGroup(open,'region','weight'),'region',{format:weight});addChart('logPendingStatus',logGroup(open,'status',null,'count'),'status',{});html+=logTable('Pendências para ação',open.sort((a,b)=>(b.wait??-1)-(a.wait??-1)),LOG_OP_COLS);}
if(LOG.page==='occurrences'){const o=rows.filter(r=>r.occurrence);html+=logKpis([['Categorias',logN(logDistinct(o,'category'))],['Com follow-up',logN(o.filter(r=>r.follow).length)],['Cobertura do follow-up',o.length?logN(o.filter(r=>r.follow).length/o.length*100,1)+'%':'—']]);html+='<div class="two-col">'+logPanel('logOccurrence','Ocorrências por categoria','Clique para filtrar os indicadores e o detalhe.')+logPanel('logOccurrenceRegion','Ocorrências por região','Clique para filtrar.')+'</div>';addChart('logOccurrence',logGroup(o,'category',null,'count'),'category');addChart('logOccurrenceRegion',logGroup(o,'region',null,'count'),'region');html+=logTable('Ocorrências e acompanhamento',o,LOG_OP_COLS.filter(c=>!['volumes','loading','loaded','deliveredDate'].includes(c[0])));}
if(LOG.page==='costs'){const covered=rows.filter(r=>r.cost!=null),cost=logSum(covered,'cost'),kg=logSum(covered,'weight');html+=logKpis([['Custo informado',covered.length?money(cost):'—'],['Registros com custo',logN(covered.length)+' / '+logN(rows.length)],['Custo/kg com cobertura',kg?money(cost/kg):'—','Somente peso dos registros com custo'],['Cobertura dos custos',rows.length?logN(covered.length/rows.length*100,1)+'%':'—']]);html+='<div class="log-notice">Os custos têm cobertura parcial. Campos vazios não são tratados como custo zero.</div><div class="two-col">'+logPanel('logCost','Custos por região','Somente valores preenchidos.')+logPanel('logCostDriver','Custos por motorista','Somente valores preenchidos.')+'</div>';addChart('logCost',logGroup(covered,'region','cost'),'region',{format:v=>money(v,true)});addChart('logCostDriver',logGroup(covered,'driver','cost'),'driver',{format:v=>money(v,true)});html+=logTable('Detalhe dos custos informados',covered,[['date','Implantação','date'],['client','Cliente'],['region','Região'],['driver','Motorista'],['vehicle','Veículo'],['weight','Peso (kg)','num'],['cost','Custo','money']]);}
}
else{html=logIndicators(rows,kind,addChart);}
const progress=rows.length?rows.filter(r=>r.delivered).length/rows.length*100:0;const intro=kind==='operations'?`<section class="log-control-strip"><div><small>CONCLUSÃO DA OPERAÇÃO</small><strong>${logN(progress,1)}% entregues</strong><span><i style="width:${progress}%"></i></span></div>${canLog('sac')?'<button id="logGoTransport">Transportadoras ↗</button>':''}<button id="logGoPending">Ver pendências ↗</button></section>`:'';html=intro+html;$('#content').innerHTML=(meta.reference?'<div class="log-notice">Referência importada da base usada pelo Streamlit · arquivo de 10/09/2026. Os indicadores abaixo seguem os períodos disponíveis nesse arquivo.</div>':'')+html+`<footer class="log-footnote">${state.user?.editTransport&&kind==='transport'?'Preenchimento manual autorizado ao SAC':'Consulta'} · fonte: ${esc(meta.sourceName||'')} / ${esc(meta.sheet||'')}. ${all.filter(r=>!r.date).length?'Registros sem data válida aparecem somente em Todos os anos / Todos os meses, com data “—”.':''}</footer>`;charts.forEach(fn=>fn());logBindTable();transportBindQueue();$('#formationBackExperimental')?.addEventListener('click',()=>{FEXP.view='experimental';formationShow();});$('#logFormationBack')?.addEventListener('click',()=>{LOG.page='formation';logShow();});$('#logGoTransport')?.addEventListener('click',()=>{LOG.page='transport';LOG.indicatorTab='transport';logShow();});$('#logGoPending')?.addEventListener('click',()=>{LOG.page='pending';logShow();});$('#logFleet')?.addEventListener('click',()=>{LOG.fleetTab='fleet';logShow();});$('#logAgenda')?.addEventListener('click',()=>{LOG.page='agenda';logShow();});$('#logTabFormation')?.addEventListener('click',()=>{LOG.indicatorTab='formations';logShow();});$('#logTabTransport')?.addEventListener('click',()=>{LOG.indicatorTab='transport';logShow();});if($('#logMap')){logMap(rows,epoch);$('#logMapMetric').onchange=e=>{LOG.metric=e.target.value;if(state.map){state.map.remove();state.map=null;}logMap(rows,LOG.epoch);};}}
function logIndicators(rows,kind,addChart){const tabs=kind==='formations'?'<div class="city-view-switch"><button id="logFormationBack">← Formação de Carga</button><span>Qualidade da formação</span></div>':'';if(kind==='formations'){const o=rows.filter(r=>r.occurrence),accuracy=rows.length?(1-o.length/rows.length)*100:null;let h=tabs+logHero('REBANHO · QUALIDADE OPERACIONAL','Assertividade na formação de cargas.','Registros da formação operacional e seus apontamentos.',[['Assertividade',accuracy==null?'—':logN(accuracy,1)+'%','Referência: acima de 95%'],['Registros analisados',logN(rows.length),'Fonte: FORMAÇÃO 2026']])+logKpis([['Ocorrências',logN(o.length)],['Custo informado',money(logSum(rows,'cost'))],['Regiões',logN(logDistinct(rows,'region'))]])+'<div class="two-col">'+logPanel('logProblems','Ocorrências gerais')+logPanel('logCategories','Ocorrências por categoria')+logPanel('logProblemsRegion','Ocorrências por região','Clique para filtrar.')+logPanel('logCapRegion','Custos por região','Clique para filtrar.')+logPanel('logChecker','Ocorrências por conferente')+'</div>';addChart('logProblems',logGroup(o,'problem',null,'count'),'category',{});addChart('logCategories',logGroup(o,'category',null,'count'),'category',{type:'donut'});addChart('logProblemsRegion',logGroup(o,'region',null,'count'),'region',{});addChart('logCapRegion',logGroup(rows,'region','cost'),'region',{format:v=>money(v,true)});addChart('logChecker',logGroup(o,'checker',null,'count'),'checker',{});h+=logTable('Apontamentos da formação de carga',rows,[['date','Data','date'],['region','Região'],['vehicle','Veículo'],['driver','Motorista'],['cost','Custo','money'],['problem','Problema'],['description','Descrição'],['category','Categoria'],['checker','Conferente'],['picker','Separador']]);return h;}
const delivered=rows.filter(r=>r.delivered),on=delivered.filter(r=>r.onTime),late=delivered.filter(r=>r.late),classified=on.length+late.length,open=rows.filter(r=>!r.delivered),overdue=open.filter(r=>r.overdue),eff=classified?on.length/classified*100:null;
let h=tabs+logHero('REBANHO · TRANSPORTADORAS','O que foi entregue. O que exige ação.','Notas por data de emissão da NF · fonte ACOMPANHAMENTO, atualizada pela operação.',[['Entregas no prazo',eff==null?'—':logN(eff,1)+'%','Somente entregas concluídas com SLA informado'],['Em aberto',logN(open.length),logN(overdue.length)+' com prazo vencido']])+logKpis([['Notas no recorte',logN(rows.length)],['Entregues',logN(delivered.length)],['Entregues com atraso',logN(late.length)],['Ocorrências',logN(rows.filter(r=>r.occurrence).length)],['Frete informado',rows.some(r=>r.freight!=null)?money(logSum(rows,'freight'),true):'—']]);
h+='<div class="two-col">'+logPanel('logService','Desempenho por transportadora','Notas no prazo, atrasadas e em aberto. Clique na transportadora.')+logPanel('logDailyDelivery','Ritmo de entregas','Entregas concluídas por dia, entre as notas do recorte.')+logPanel('logLateCity','Onde estão os atrasos','Entregues fora do prazo e pendências vencidas por cidade.')+logPanel('logTransportProblems','Ocorrências para acompanhar','Clique na ocorrência para detalhar.')+'</div>';
const carriers=logGroup(rows,'carrier',null,'count').slice(0,10);addChart('logService',carriers,'carrier',{type:'service',source:rows});
const daily=logGroup(delivered.map(r=>({...r,day:r.deliveredDate})),'day',null,'count').sort((a,b)=>a.key.localeCompare(b.key));addChart('logDailyDelivery',daily,null,{type:'line'});addChart('logLateCity',logGroup([...late,...overdue],'city',null,'count'),'city',{source:[...late,...overdue]});addChart('logTransportProblems',logGroup(rows.filter(r=>r.occurrence),'problem',null,'count'),'problem',{});
h+=logMapMarkup();return h+transportQueue()+logTable('Acompanhamento das transportadoras',rows,[['invoice','NF'],['client','Cliente'],['cityLabel','Cidade'],['issued','Emissão','date'],['collected','Coleta','date'],['forecast','Prazo Rebanho / previsão','date'],['deliveredDate','Entrega','date'],['carrier','Transportadora'],['status','Status'],['sla','SLA'],['delay','Atraso (dias)','num'],['weight','Peso (kg)','num'],['freight','Frete','money'],['problem','Ocorrência'],['responsible','Responsável'],['follow','Follow-up'],['cargoType','Tipo de carga']]);}

function logMapMetric(a){const active=logPlanningRows(a);return LOG.metric==='late'?a.filter(r=>r.late||r.overdue).length:LOG.metric==='count'?active.length:LOG.metric==='wait'?logAvg(active,'wait'):LOG.metric==='occurrence'?a.filter(r=>r.occurrence).length:logSum(active,'weight');}
function logMapMarkup(){const formation=LOG.kind!=='transport',active=logPlanningRows(LOG.tableRows||[]);return `<section class="panel log-map-panel"><div class="log-table-heading"><div><h3>${formation?'Prioridade para formação de carga':'Mapa de transportadoras'}</h3><p>${formation?'Peso aguardando formação por município · somente status em branco. Clique para filtrar os detalhes.':'Aproxime e clique em um município para filtrar toda a visão.'}</p></div><select id="logMapMetric" aria-label="Indicador do mapa">${biOptions({weight:formation?'Peso aguardando formação':'Peso em aberto',count:formation?'Registros aguardando formação':'Registros em aberto',...(formation?{wait:'Espera média'}:{late:'Atrasos'}),occurrence:'Ocorrências'},LOG.metric)}</select><button class="btn" id="logMapBack">Ver Nordeste</button></div><div id="logMapTotal" class="log-map-total" role="status"></div><div class="log-map-scale"><span>Menor peso</span><i></i><span>Maior peso</span></div><div class="log-map-layout"><div id="logMap" class="log-map"><div class="empty">Carregando malha municipal…</div></div><div><h4 id="logMapLegend">${formation?'Cidades prioritárias':'Peso em aberto por município'}</h4><div id="logMapRanking" class="log-map-ranking"></div></div></div><p class="log-map-note" id="logMapNote"></p></section>`;}
function logMapLabels(map,layer,locs,metric,fmt){
 const labels=L.layerGroup().addTo(map),draw=()=>{if(state.map!==map)return;labels.clearLayers();const candidates=[];layer.eachLayer(l=>{const f=l.feature,k=aliasCity(f.properties.NM_MUN)+'|'+f.properties.SIGLA_UF,a=locs.get(k)||[],value=metric(a);if(!(value>0))return;const center=l.getBounds().getCenter();if(!map.getBounds().contains(center))return;candidates.push({center,name:f.properties.NM_MUN,value});});candidates.sort((a,b)=>b.value-a.value);const occupied=[],limit=map.getZoom()<7?18:map.getZoom()<9?45:120;let shown=0;
  for(const c of candidates){if(shown>=limit)break;const p=map.latLngToContainerPoint(c.center),width=Math.min(170,Math.max(82,c.name.length*5.8)),rect={left:p.x-width/2,right:p.x+width/2,top:p.y-19,bottom:p.y+19};if(occupied.some(r=>!(rect.right+6<r.left||rect.left-6>r.right||rect.bottom+4<r.top||rect.top-4>r.bottom)))continue;occupied.push(rect);L.marker(c.center,{interactive:false,keyboard:false,icon:L.divIcon({className:'log-map-weight-label',html:`<span>${esc(c.name)}</span><strong>${esc(fmt(c.value))}</strong>`,iconSize:[width,38],iconAnchor:[width/2,19]})}).addTo(labels);shown++;}
 };map.on('zoomend moveend',draw);draw();
}

async function logGeo(){if(LOG.geo)return LOG.geo;if(!LOG.geoPromise)LOG.geoPromise=api('/api/logistics',{body:JSON.stringify({kind:'geo'})}).then(r=>LOG.geo=r.geo).catch(e=>{LOG.geoPromise=null;throw e;});return LOG.geoPromise;}
async function logMap(rows,epoch){const box=$('#logMap');if(!box)return;try{const [geo]=await Promise.all([logGeo(),centralLeaflet()]);if(state.module!=='logistics'||epoch!==LOG.epoch||!box.isConnected)return;
const features=geo.features||[],names=new Map();for(const ft of features){const k=aliasCity(ft.properties.NM_MUN);if(!names.has(k))names.set(k,new Set());names.get(k).add(ft.properties.SIGLA_UF);}for(const dataset of Object.values(LOG.cache)){for(const row of dataset.rows||[]){const options=names.get(aliasCity(row.city));if(!row.uf&&options?.size===1)row.uf=[...options][0];}}const locs=new Map();let unmatched=0;for(const r of rows){let uf=r.uf;const n=aliasCity(r.city);if(!uf&&names.get(n)?.size===1)uf=[...names.get(n)][0];if(!uf||!features.some(f=>aliasCity(f.properties.NM_MUN)===n&&f.properties.SIGLA_UF===uf)){unmatched++;continue;}if(!r.uf)r.uf=uf;const k=n+'|'+uf;if(!locs.has(k))locs.set(k,[]);locs.get(k).push(r);}
const metric=logMapMetric;const fmt=v=>LOG.metric==='weight'?logN(v/1000,3)+' t':LOG.metric==='wait'?logN(v,1)+' dias':logN(v);const max=Math.max(1,...[...locs.values()].map(metric).filter(Number.isFinite));
box.innerHTML='';const map=L.map(box,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:12,scrollWheelZoom:true});state.map=map;const ufs=LOG.filters.uf.length?LOG.filters.uf:[...new Set([...locs.keys()].map(k=>k.split('|')[1]))];const visible=features.filter(f=>!ufs.length||ufs.includes(f.properties.SIGLA_UF));
const layer=L.geoJSON({type:'FeatureCollection',features:visible},{style:f=>{const k=aliasCity(f.properties.NM_MUN)+'|'+f.properties.SIGLA_UF,a=locs.get(k),v=metric(a||[]),t=Math.pow(Math.max(0,v||0)/max,.65),rgb=[255,235,211].map((x,i)=>Math.round(x+([174,69,15][i]-x)*t));return {color:a?'#9e633c':'#d9c6b6',weight:a?1:.5,fillColor:v>0?'rgb('+rgb.join(',')+')':'#eee8e2',fillOpacity:v>0?.95:.5};},onEachFeature:(f,l)=>{const name=f.properties.NM_MUN,uf=f.properties.SIGLA_UF,a=locs.get(aliasCity(name)+'|'+uf);if(!a)return;l.bindTooltip(LOG.page==='formation'&&FEXP.tab==='plan'&&FEXP.view!=='legacy'?formationMapTooltip(a,name,uf):'<b>'+esc(name)+' · '+uf+'</b><br>'+fmt(metric(a))+'<br>'+logN(LOG.kind==='transport'?a.length:logPlanningRows(a).length)+(LOG.kind==='transport'?' registros':' registros aguardando formação'),{sticky:true});l.on('click',()=>{LOG.filters.city=[a[0].city];LOG.filters.uf=[uf];LOG.tablePage=0;logShow();});}}).addTo(map);
const focus=visible.filter(f=>metric(locs.get(aliasCity(f.properties.NM_MUN)+'|'+f.properties.SIGLA_UF)||[])>0);const focusLayer=L.geoJSON({type:'FeatureCollection',features:focus.length?focus:visible});if(focusLayer.getBounds().isValid())map.fitBounds(focusLayer.getBounds(),{padding:[18,18],maxZoom:LOG.filters.city.length?10:7});else map.setView([-7.5,-40],5);requestAnimationFrame(()=>{if(box.isConnected)map.invalidateSize();});
const rank=[...locs].map(([k,a])=>({city:a[0].city,uf:k.split('|')[1],value:metric(a)})).filter(r=>r.value>0).sort((a,b)=>(b.value||0)-(a.value||0));$('#logMapLegend').textContent=({weight:LOG.kind==='transport'?'Peso em aberto por município':'Peso aguardando formação por município',count:LOG.kind==='transport'?'Registros em aberto':'Registros aguardando formação',late:'Atrasos por município',wait:'Espera média',occurrence:'Ocorrências'})[LOG.metric];$('#logMapRanking').innerHTML=rank.slice(0,25).map((r,i)=>'<button data-log-map-rank="'+i+'"><span>'+esc(r.city+' · '+r.uf)+'</span><strong>'+fmt(r.value)+'</strong><i style="width:'+Math.max(1,(r.value||0)/max*100)+'%"></i></button>').join('');$$('[data-log-map-rank]').forEach(b=>b.onclick=()=>{const r=rank[Number(b.dataset.logMapRank)];LOG.filters.city=[r.city];LOG.filters.uf=[r.uf];logShow();});if(LOG.kind!=='transport')logMapLabels(map,layer,locs,metric,fmt);const active=logPlanningRows(rows);$('#logMapTotal').textContent=(LOG.kind==='transport'?'Peso em aberto: ':'Peso total aguardando formação: ')+logN(logSum(active,'weight')/1000,3)+' t · '+logN(active.length)+' registros'+(active.filter(r=>r.weight==null).length?' · '+logN(active.filter(r=>r.weight==null).length)+' sem peso informado':'');$('#logMapNote').textContent='Mais escuro = maior intensidade do indicador. Os rótulos priorizam os maiores volumes; aproxime para ver mais cidades sem sobreposição. '+(rows.length-unmatched)+' registros localizados'+(unmatched?' · '+unmatched+' sem localização segura, mantidos nas tabelas e totais.':'.');$('#logMapBack').onclick=()=>{LOG.filters.region=[];LOG.filters.city=[];LOG.filters.uf=[];logShow();};
}catch(e){if(box.isConnected)box.innerHTML='<div class="empty">Mapa indisponível: '+esc(e.message)+'</div>';}}

async function logSources(){const epoch=LOG.epoch;$('#content').innerHTML='<div class="panel"><h2>Conexões de leitura</h2><p>Carregando fontes…</p></div>';try{const r=await api('/api/logistics',{body:JSON.stringify({kind:'sources'})});if(epoch!==LOG.epoch||state.module!=='logistics')return;$('#content').innerHTML=logHero('REBANHO · FONTES','As informações no lugar certo.','Cada módulo utiliza sua própria fonte e preserva os arquivos de origem.',[['Leitura','Somente consulta'],['Atualização','Automática','A cada 3 minutos enquanto este módulo estiver aberto']])+`<section class="panel log-source-panel"><h3>Planilhas conectadas</h3><p>A conexão operacional usa FORMAÇÃO 2026, CADASTRO REGIAO e DESTINO MOTORISTAS. Transportadoras usa a aba ACOMPANHAMENTO do Novo Fluxo.</p><label>Planilha de operações (ID)<input id="logOperationsId" value="${esc(r.ids.operations)}"></label><label>Planilha de transportadoras (ID)<input id="logIndicatorsId" value="${esc(r.ids.indicators)}"></label><button class="btn primary" id="logSaveSources">Salvar conexões</button><p id="logSourceMessage" role="status"></p><div class="log-notice">Duas fontes conectadas: FORMAÇÕES DE CARGA e ACOMPANHAMENTO TRANSPORTADORAS — NOVO FLUXO. As atualizações feitas nas planilhas são consultadas automaticamente a cada 3 minutos com o módulo aberto.</div><div class="log-source-links"><a href="https://docs.google.com/spreadsheets/d/${esc(r.ids.operations)}/edit" target="_blank" rel="noopener">Abrir operações ↗</a><a href="https://docs.google.com/spreadsheets/d/${esc(r.ids.indicators)}/edit" target="_blank" rel="noopener">Abrir indicadores ↗</a></div></section>`;$('#logSaveSources').onclick=async()=>{const b=$('#logSaveSources');b.disabled=true;try{const out=await api('/api/logistics',{body:JSON.stringify({action:'configure',operationsId:$('#logOperationsId').value,indicatorsId:$('#logIndicatorsId').value})});LOG.cache={};$('#logSourceMessage').textContent=out.message;}catch(e){$('#logSourceMessage').textContent=e.message;}finally{b.disabled=false;}};}catch(e){if(epoch===LOG.epoch)$('#content').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}}



function sacApplySaved(result) {
 const current=LOG.cache.transport;
 if(current&&result.patches?.length){
  const changed=new Map(result.patches.map(patch=>[patch.id,patch]));
  LOG.cache.transport={...current,rows:current.rows.map(row=>changed.has(row.id)?{...row,...changed.get(row.id)}:row)};
  if(state.module==='logistics'&&['transport','overview'].includes(LOG.page))logShow();
 }
 if(result.patches==null||result.patches.length||result.partial){
  const pending=LOG.pending.transport?.task;
  void Promise.resolve(pending).catch(()=>{}).then(()=>logLoad('transport',false,true));
 }
}

async function sacEdit(key){
 if(!state.user?.editTransport)return;
 let dialog=document.createElement('dialog');dialog.className='sac-dialog';dialog.setAttribute('aria-label','Preenchimento SAC');document.body.append(dialog);dialog.innerHTML='<div class="panel">Carregando campos da planilha…</div>';dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());
 try{
  const data=await api('/api/logistics',{body:JSON.stringify({kind:'transport',action:'editRead',key})});
  dialog.innerHTML=`<form id="sacForm"><header><div><small>ACOMPANHAMENTO · SAC</small><h2>NF ${esc(data.invoice)}</h2><p>${esc(data.client)} · ${esc(data.carrier)}</p></div><button type="button" class="btn" id="sacClose" aria-label="Fechar edição">×</button></header>${transportNoteContext(data.record||(LOG.cache.transport?.rows||[]).find(r=>r.id===key))}<p class="sac-help">A data de entrega e os campos alterados serão salvos nesta nota na planilha de origem. Os indicadores serão recarregados após salvar.</p><div class="sac-fields">${data.fields.map(f=>`<label>${esc(f.label)}${f.type==='date'?`<input type="date" aria-label="${esc(f.label)}" name="${esc(f.name)}" value="${esc(f.value)}" max="${transportToday()}" ${f.readOnly?'readonly':''}>`:f.options?`<select aria-label="${esc(f.label)}" name="${esc(f.name)}" ${f.readOnly?'disabled':''}><option value="">Sem preenchimento</option>${[...new Set([...f.options,...(f.value?[f.value]:[])])].map(v=>`<option value="${esc(v)}" ${v===f.value?'selected':''}>${esc(v)}</option>`).join('')}</select>`:`<textarea aria-label="${esc(f.label)}" name="${esc(f.name)}" maxlength="2000" rows="${['follow','notes'].includes(f.name)?3:2}" ${f.readOnly?'readonly':''}>${esc(f.value)}</textarea>`}${f.readOnly?'<small>Fórmula protegida</small>':''}</label>`).join('')}</div><p id="sacResult" role="status"></p><footer><button type="button" class="btn" id="sacCancel">Cancelar</button><button type="submit" class="btn primary">Salvar na planilha</button></footer></form>`;
  $('#sacClose',dialog).onclick=$('#sacCancel',dialog).onclick=()=>dialog.close();
  $('#sacForm',dialog).onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,submit=form.querySelector('[type=submit]'),status=$('#sacResult',dialog);submit.disabled=true;status.textContent='Salvando na planilha…';const values=Object.fromEntries(data.fields.filter(f=>!f.readOnly).map(f=>[f.name,form.elements.namedItem(f.name).value]));
   try{
    const saved=await api('/api/logistics',{body:JSON.stringify({kind:'transport',action:'editSave',key,version:data.version,values})});
    dialog.close();
    sacApplySaved(saved);
    formationNotice(saved.message+(saved.auditWarning?' O registro de auditoria ficou pendente.':''));
   }catch(err){status.textContent=err.message;submit.disabled=false;}

  };$('#sacClose',dialog).focus();
 }catch(error){dialog.innerHTML=`<div class="panel"><h2>Não foi possível abrir a nota</h2><p>${esc(error.message)}</p><button class="btn" id="sacErrorClose">Fechar</button></div>`;$('#sacErrorClose',dialog).onclick=()=>dialog.close();}
}



// Fila operacional: todas as emissões, mantendo os filtros de transportadora e território.
function transportToday(now=new Date()){return (()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;})();}
function transportDayShift(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function transportDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date||'')?date.split('-').reverse().join('/'):'Não informada';}
function transportQueueModel(rows,today,day,view='overdue',query=''){
  const hasFollow = row => !!String(row.follow||'').trim() && !['-','—','N/A'].includes(normalize(row.follow));
  const isOpen = row => !row.delivered && !row.deliveredDate;
  const overdue = row => isOpen(row) && !!row.forecast && row.forecast < today;
  const attention = row => overdue(row) || row.occurrence;
  const groups = {
    dueToday: row => isOpen(row) && row.forecast === today,
    overdueNoFollow: row => overdue(row) && !hasFollow(row),
    overdueWithFollow: row => overdue(row) && hasFollow(row),
    overdue,
    occurrences: row => row.occurrence,
    shipped: row => row.collected === day,
    noFollow: row => attention(row) && !hasFollow(row),
    open: isOpen,
    noForecast: row => isOpen(row) && !row.forecast
  };
  const counts = Object.fromEntries(Object.entries(groups).map(([key,test]) => [key, rows.filter(test).length]));
  const q = normalize(query);
  const selected = rows.filter(groups[view] || overdue)
    .filter(row => !q || normalize([row.invoice,row.client,row.city,row.carrier,row.follow,row.problem,row.category,row.responsible].join(' ')).includes(q))
    .map(row => ({
      ...row,
      queueDelay: overdue(row) ? Math.max(0,Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(row.forecast+'T12:00:00Z'))/86400000)) : 0,
      needsFollow: attention(row) && !hasFollow(row),
      dueToday: groups.dueToday(row),
      hasFollow: hasFollow(row)
    }))
    .sort((a,b)=>b.queueDelay-a.queueDelay || Number(b.needsFollow)-Number(a.needsFollow) ||
      (a.forecast||'9999').localeCompare(b.forecast||'9999') || String(a.client).localeCompare(String(b.client),'pt-BR'));
  return {counts,rows:selected};
}
async function sacImportRows(file) {
  if(!file||!/\.xls$/i.test(file.name)||file.size>5*1024*1024)throw new Error('Selecione um relatório original .xls de até 5 MB.');
  const text=await file.text();
  if(!/<table(?:\s|>)/i.test(text))throw new Error('Formato diferente dos relatórios de remessas validados.');
  // O conteúdo do relatório fica no template inerte e só seus textos são enviados.
  const template=document.createElement('template');
  template.innerHTML=text;
  const headerName=value=>normalize(value).replace(/[^A-Z0-9]+/g,' ').trim();
  for(const table of template.content.querySelectorAll('table')){
    const rows=Array.from(table.rows,row=>Array.from(row.cells,cell=>cell.textContent.trim()));
    const header=rows.findIndex(row=>['NF S','DESTINATARIO','EMISSAO NF S','ULTIMO STATUS']
      .every(label=>row.some(value=>headerName(value)===label)));
    if(header<0)continue;
    const grid=rows.slice(header);
    if(grid.length>1001||JSON.stringify(grid).length>650000)throw new Error('Use um arquivo com até 1.000 linhas e 650 KB de dados.');
    return grid;
  }
  throw new Error('Não encontrei a tabela de remessas no arquivo.');
}

function sacImportSummary(summary,confirmed=false) {
  const fields=[['inserted',confirmed?'Inseridas':'Novas'],['updated',confirmed?'Atualizadas':'A atualizar'],['unchanged','Sem alterações'],['conflicts','Para conferir'],['ignored','Ignoradas']];
  return `<dl class="sac-import-summary">${fields.map(([key,label])=>`<div><dt>${label}</dt><dd>${logN(summary[key])}</dd></div>`).join('')}</dl>
    ${summary.grouped?`<p>${logN(summary.grouped)} remessas conciliadas com notas individuais. Peso e frete dessas remessas foram preservados nas notas.</p>`:''}
    ${summary.conflicts?'<p>As linhas para conferir têm NF repetida ou identificação ambígua e ficam fora da gravação.</p>':''}`;
}

async function sacImportOpen() {
  if(state.user?.perfil!=='SAC'||!state.user?.editTransport)return;
  const dialog=formationDialog('Importar relatório da transportadora',
    `<form id="sacImportForm"><p>Escolha a transportadora, envie o relatório original e confira a prévia antes de gravar no acompanhamento.</p>
    <label>Transportadora <select name="carrier" required disabled><option value="">Carregando…</option></select></label>
    <label>Relatório de remessas <input type="file" name="report" accept=".xls" required disabled></label>
    <div id="sacImportPreview" hidden></div>
    <p id="sacImportStatus" role="status"></p>
    <footer><button type="button" class="btn" id="sacImportBack" hidden>Voltar à seleção</button>
    <button type="submit" class="btn primary" disabled>Analisar arquivo</button></footer></form>`);
  const form=$('#sacImportForm',dialog), select=form.elements.namedItem('carrier'), file=form.elements.namedItem('report');
  const submit=form.querySelector('[type=submit]'), status=$('#sacImportStatus',dialog);
  const box=$('#sacImportPreview',dialog), back=$('#sacImportBack',dialog);
  let payload=null, busy=false;
  const request=(action,extra={})=>api('/api/logistics',{body:JSON.stringify({kind:'transport',action,...extra})});
  const reset=()=>{
    payload=null; box.hidden=true; back.hidden=true; submit.disabled=false; submit.textContent='Analisar arquivo';
    select.disabled=false;file.disabled=false;status.textContent='';
  };
  back.onclick=reset;
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  const close=dialog.querySelector('.formation-close');
  close?.addEventListener('click',event=>{if(busy){event.preventDefault();event.stopImmediatePropagation();}},true);
  try {
    const {carriers}=await request('importOptions');
    if(!dialog.isConnected)return;
    if(!carriers.length)throw new Error('Seu perfil não tem transportadoras habilitadas para importar.');
    select.innerHTML='<option value="">Selecione</option>'+carriers.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    if(carriers.length===1)select.value=carriers[0];
    select.disabled=false;file.disabled=false;submit.disabled=false;
  }catch(error){status.textContent=error.message;return;}

  file.onchange=()=>{
    const name=normalize(file.files[0]?.name || '');
    const guess=name.includes('TRANSRAPIDO')?'TRANSRÁPIDO':name.includes('F&P')?'F&P':'';
    if(guess&&Array.from(select.options).some(option=>option.value===guess))select.value=guess;
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    if(busy)return;
    busy=true;submit.disabled=true;back.disabled=true;
    try{
      if(!payload){
        const selected=file.files[0], name=normalize(selected?.name||'');
        if((name.includes('TRANSRAPIDO')&&select.value!=='TRANSRÁPIDO')||(name.includes('F&P')&&select.value!=='F&P')){
          throw new Error('O nome do arquivo indica outra transportadora. Confira a seleção.');
        }
        status.textContent='Conferindo as notas com o acompanhamento…';
        const rows=await sacImportRows(selected), carrier=select.value;
        const result=await request('importPreview',{carrier,rows});
        payload={carrier,rows,previewToken:result.previewToken};
        select.disabled=true;file.disabled=true;box.hidden=false;back.hidden=false;
        box.innerHTML=`<h3>Prévia · ${esc(result.carrier)}</h3><p>${esc(selected.name)}</p>`+sacImportSummary(result.summary);
        if(result.examples.length)box.innerHTML+=`<details><summary>NFs para conferir</summary><ul>${result.examples.map(invoice=>`<li>${esc(invoice)}</li>`).join('')}</ul></details>`;
        const changes=result.summary.inserted+result.summary.updated;
        submit.textContent='Confirmar importação';
        submit.disabled=!changes;
        status.textContent=changes?'Revise as quantidades antes de confirmar.':'Não há alterações para gravar.';
        return;
      }
      status.textContent='Gravando as notas no acompanhamento…';
      const result=await request('importCommit',payload);
      payload=null;back.hidden=true;submit.hidden=true;
      box.innerHTML='<h3>Importação concluída</h3>'+sacImportSummary(result.summary,true);
      status.textContent='Atualizando a fila e os gráficos…';
      try{
        await logFetchSource('transport',true);
        if(state.module==='logistics'&&LOG.page==='transport')logShow();
        status.textContent='Acompanhamento salvo. Fila e gráficos atualizados.';
      }catch(error){
        status.textContent='Acompanhamento salvo. Use Atualizar para carregar os gráficos novamente.';
      }
    }catch(error){
      if(payload)reset();
      submit.disabled=false;
      status.textContent=error.message;
    }finally{
      busy=false;back.disabled=false;
    }
  };
}

function transportQueue(){
 const today=transportToday();if(!LOG.queue)LOG.queue={view:'overdueNoFollow',day:transportDayShift(today,-1),query:'',page:0};const q=LOG.queue;
 const scope=logRows(LOG.cache.transport?.rows||[],{ignorePeriod:true}),model=transportQueueModel(scope,today,q.day,q.view,q.query);q.rows=model.rows;const selected=sacSelection(model.rows);
 const titles={dueToday:'Vencem hoje',overdueNoFollow:'Atrasadas sem follow-up',overdueWithFollow:'Atrasadas acompanhadas',overdue:'Todos os atrasos',occurrences:'Ocorrências registradas',shipped:'Saídas pela coleta',noFollow:'Sem follow-up',open:'Todas em aberto'},size=window.matchMedia('(max-width:760px)').matches?4:8,start=Math.min(q.page*size,Math.max(0,Math.floor((model.rows.length-1)/size)*size)),shown=model.rows.slice(start,start+size);
 return `<section class="panel transport-workbench" id="transportWorkbench"><div class="transport-workbench-heading"><div><span class="history-eyebrow">${state.user?.transportOnly?'ROTINA DO SAC':'ACOMPANHAMENTO GERENCIAL · SAC'}</span><h2>Controle de entregas e ocorrências</h2><p>Acompanhamento de todas as emissões, inclusive de meses anteriores. Transportadora, cidade e demais filtros continuam valendo.</p></div><div class="sac-import-actions"><span class="transport-asof">Posição em ${transportDate(today)}</span>${state.user?.perfil==='SAC'&&state.user?.editTransport?'<button type="button" class="btn primary" id="sacImportOpen">Importar relatório</button>':''}</div></div>
 <div class="transport-queue-kpis">${[['dueToday','Vencem hoje','Notas em aberto com prazo para hoje'],['overdueNoFollow','Atrasadas sem follow-up','Prioridade para cobrança'],['overdueWithFollow','Atrasadas acompanhadas','Com follow-up registrado']].map(([v,title,note])=>`<button type="button" class="transport-queue-kpi ${q.view===v?'active':''} ${v==='overdueNoFollow'?'queue-danger':''}" data-queue-view="${v}" aria-pressed="${q.view===v}"><span>${esc(title)}</span><strong>${logN(model.counts[v])}</strong><small>${esc(note)}</small></button>`).join('')}</div>
 <div class="transport-queue-toolbar"><div class="transport-view-tabs" role="group" aria-label="Filtrar acompanhamento">${Object.entries(titles).map(([v,t])=>`<button type="button" data-queue-view="${v}" aria-pressed="${q.view===v}" class="${q.view===v?'active':''}">${t}</button>`).join('')}</div><div class="transport-queue-controls"><label>Data da coleta<input type="date" id="transportQueueDay" value="${esc(q.day)}"></label><button class="btn" id="transportQueueYesterday">Ontem</button><button class="btn" id="transportQueueToday">Hoje</button><label class="transport-queue-search">Buscar nota, cliente ou follow-up<input type="search" id="transportQueueSearch" value="${esc(q.query)}" placeholder="NF, cliente, transportadora…"></label></div></div>
 <div class="transport-queue-caption"><strong>${esc(titles[q.view])} · ${logN(model.rows.length)} ${model.rows.length===1?'nota':'notas'}${q.query?(model.rows.length===1?' encontrada':' encontradas'):''}</strong><small>${state.user?.editTransport?'Abra a nota para preencher o acompanhamento e salvar na planilha.':'Abra a nota para consultar o acompanhamento registrado pelo SAC.'}</small></div>
 ${sacBatchBar(model.rows,selected)}
 <div class="transport-note-list">${shown.map(r=>`<article class="transport-note-row ${r.queueDelay?'is-overdue':''}"><div class="transport-note-identity">${state.user?.editTransport?`<label class="sac-note-select"><input type="checkbox" data-sac-select="${esc(r.id)}" aria-label="Selecionar NF ${esc(r.invoice||'não informada')}" ${selected.has(r.id)?'checked':''}>Selecionar nota</label>`:''}<span class="transport-note-number">NF ${esc(r.invoice||'Não informada')}</span><h3>${esc(r.client||'Cliente não informado')}</h3><p>${esc(r.carrier||'Transportadora não informada')} · ${esc(r.city||r.cityLabel||'Cidade não informada')}${r.uf?' / '+esc(r.uf):''}</p><div class="transport-note-badges">${r.delivered?'<span>Entregue</span>':r.queueDelay?`<span class="badge-overdue">${r.queueDelay} ${r.queueDelay===1?'dia':'dias'} após o prazo</span>`:r.dueToday?'<span class="badge-due">Vence hoje</span>':'<span>Em aberto</span>'}${r.occurrence?'<span class="badge-occurrence">Ocorrência</span>':''}${r.needsFollow?'<span class="badge-no-follow">Sem follow-up</span>':''}</div></div><dl class="transport-note-dates"><div><dt>Coleta / saída</dt><dd>${transportDate(r.collected)}</dd></div><div><dt>Prazo de entrega</dt><dd>${transportDate(r.forecast)}</dd></div></dl><div class="transport-note-follow"><small>ÚLTIMO FOLLOW-UP REGISTRADO</small><p>${esc(r.hasFollow?r.follow:'Nenhum follow-up registrado.')}</p>${r.problem||r.category?`<small>Ocorrência: ${esc(r.problem||r.category)}</small>`:''}${r.responsible?`<small>Responsável: ${esc(r.responsible)}</small>`:''}</div><button type="button" class="btn transport-note-open" data-transport-note="${esc(r.id)}">${state.user?.editTransport?'Acompanhar / editar':'Ver acompanhamento'} ${moduleIcon('M9 5l7 7-7 7')}</button></article>`).join('')||`<div class="transport-queue-empty"><strong>Nenhuma nota nesta seleção.</strong><p>${scope.length?'Confira os outros grupos ou selecione outra data de coleta.':'Não há notas para os filtros e o recorte de acesso atuais.'}</p></div>`}</div>
 <div class="log-pagination"><button class="btn" id="transportQueuePrev" ${start===0?'disabled':''}>Anterior</button><span>${model.rows.length?start+1:0}–${Math.min(start+size,model.rows.length)} de ${model.rows.length}</span><button class="btn" id="transportQueueNext" ${start+size>=model.rows.length?'disabled':''}>Próxima</button></div><p class="transport-queue-note">Contagem por registro do acompanhamento; uma remessa pode reunir várias NFs. Dias após o prazo são contados em dias corridos. Saídas usam a data de coleta informada pela transportadora; não são estimadas pela emissão da NF. ${model.counts.noForecast?logN(model.counts.noForecast)+' notas em aberto sem prazo informado não são classificadas como atrasadas.':''} Ocorrências incluem notas entregues; confira o follow-up para acompanhar o andamento.</p></section>`;
}
function transportBindQueue(){if(!$('#transportWorkbench'))return;
 const importer=$('#sacImportOpen');if(importer)importer.onclick=sacImportOpen;
 if(state.user?.editTransport){
 const all=$('#sacSelectAll'),ids=[...new Set(LOG.queue.rows.map(r=>r.id))];all.indeterminate=LOG.queue.selected.length>0&&LOG.queue.selected.length<ids.length;
 all.onchange=()=>{LOG.queue.selected=all.checked?ids:[];transportRefreshQueue();};
 $('#sacClearSelection').onclick=()=>{LOG.queue.selected=[];transportRefreshQueue();};$('#sacBatchOpen').onclick=sacBatchEdit;
 $$('[data-sac-select]').forEach(b=>b.onchange=()=>{const selected=new Set(LOG.queue.selected);if(b.checked&&selected.size>=500){b.checked=false;$('#sacSelectionCount').textContent='Limite de 500 notas por lote.';return;}if(b.checked)selected.add(b.dataset.sacSelect);else selected.delete(b.dataset.sacSelect);LOG.queue.selected=[...selected];transportRefreshQueue();});
 }

 $$('[data-queue-view]').forEach(b=>b.onclick=()=>{LOG.queue.view=b.dataset.queueView;LOG.queue.page=0;transportRefreshQueue();});
 $('#transportQueueDay').onchange=e=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))return;LOG.queue.day=e.target.value;LOG.queue.view='shipped';LOG.queue.page=0;transportRefreshQueue();};
 for(const [id,days]of [['transportQueueYesterday',-1],['transportQueueToday',0]])$('#'+id).onclick=()=>{LOG.queue.day=transportDayShift(transportToday(),days);LOG.queue.view='shipped';LOG.queue.page=0;transportRefreshQueue();};
 const search=$('#transportQueueSearch');search.oninput=()=>{clearTimeout(LOG.queueSearchTimer);LOG.queueSearchTimer=setTimeout(()=>{if(!search.isConnected)return;const focused=document.activeElement===search,position=search.selectionStart;LOG.queue.query=search.value;LOG.queue.page=0;transportRefreshQueue();if(focused){const next=$('#transportQueueSearch');next.focus({preventScroll:true});if(position!=null)next.setSelectionRange(position,position);}},220);};search.onchange=()=>{clearTimeout(LOG.queueSearchTimer);LOG.queue.query=search.value;LOG.queue.page=0;transportRefreshQueue();};
 $('#transportQueuePrev').onclick=()=>{LOG.queue.page=Math.max(0,LOG.queue.page-1);transportRefreshQueue();};$('#transportQueueNext').onclick=()=>{LOG.queue.page++;transportRefreshQueue();};
 $$('[data-transport-note]').forEach(b=>b.onclick=()=>transportNote(b.dataset.transportNote));
}
function transportRefreshQueue(){const old=$('#transportWorkbench');if(!old)return;old.outerHTML=transportQueue();transportBindQueue();}
function transportNoteContext(row){if(!row)return '';const days=transportQueueModel([row],transportToday(),'','open').rows[0]?.queueDelay||0;return `<div class="transport-dialog-context"><dl><div><dt>Coleta / saída</dt><dd>${transportDate(row.collected)}</dd></div><div><dt>Prazo de entrega</dt><dd>${transportDate(row.forecast)}</dd></div><div><dt>Entrega</dt><dd>${transportDate(row.deliveredDate)}</dd></div><div><dt>Situação</dt><dd>${esc(row.status||'Não informada')}${days?' · '+days+' dias após o prazo':''}</dd></div></dl><p>${esc(row.city||row.cityLabel||'Cidade não informada')}${row.uf?' / '+esc(row.uf):''}</p></div>`;}
function transportNote(key){const row=(LOG.cache.transport?.rows||[]).find(r=>r.id===key);if(!row)return;if(state.user?.editTransport){sacEdit(key);return;}
 const dialog=document.createElement('dialog');dialog.className='sac-dialog transport-read-dialog';dialog.setAttribute('aria-label','Acompanhamento da nota');dialog.innerHTML=`<header><div><small>ACOMPANHAMENTO · TRANSPORTADORAS</small><h2>NF ${esc(row.invoice||'Não informada')}</h2><p>${esc(row.client)} · ${esc(row.carrier)}</p></div><button class="btn" id="transportNoteClose" aria-label="Fechar acompanhamento">×</button></header>${transportNoteContext(row)}<div class="transport-read-fields">${[['Follow-up',row.follow],['Ocorrência',row.manualOccurrence||row.problem],['Categoria',row.category],['Responsável pela ocorrência',row.responsible],['Observações',row.notes],['Conferente',row.checker],['Separador',row.picker],['Tipo de carga',row.cargoType]].map(([l,v])=>`<section><small>${l}</small><p>${esc(v||'Não informado')}</p></section>`).join('')}</div><p class="sac-help">Consulta gerencial. O preenchimento é exclusivo do SAC autorizado.</p>`;document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();$('#transportNoteClose',dialog).onclick=()=>dialog.close();
}


function sacSelection(rows){
 const available=new Set(rows.map(r=>r.id)),old=LOG.queue.selected||[];
 LOG.queue.selected=state.user?.editTransport?[...new Set(old)].filter(k=>available.has(k)):[];
 return new Set(LOG.queue.selected);
}
function sacBatchBar(rows,selected){if(!state.user?.editTransport)return '';const all=rows.length>0&&selected.size===new Set(rows.map(r=>r.id)).size;return `<div class="sac-batch-toolbar"><label class="sac-select-all"><input type="checkbox" id="sacSelectAll" ${all?'checked':''} ${!rows.length||rows.length>500?'disabled':''}>Marcar todas do filtro <span>(${logN(rows.length)})</span></label><strong id="sacSelectionCount" role="status">${logN(selected.size)} selecionadas</strong><div><button type="button" class="btn" id="sacClearSelection" ${!selected.size?'disabled':''}>Limpar seleção</button><button type="button" class="btn primary" id="sacBatchOpen" ${!selected.size?'disabled':''}>Preencher selecionadas</button></div>${rows.length>500?'<small>Para marcar todas, refine o filtro para até 500 notas. A seleção individual continua disponível.</small>':''}</div>`;}
async function sacBatchEdit(){
 if(!state.user?.editTransport)return;const keys=[...(LOG.queue.selected||[])];if(!keys.length)return;
 const dialog=document.createElement('dialog');dialog.className='sac-dialog sac-batch-dialog';dialog.setAttribute('aria-label','Preenchimento em massa do SAC');dialog.innerHTML='<div class="panel"><h2>Preparando notas selecionadas…</h2><p>Conferindo permissões e valores atuais na planilha.</p></div>';document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());
 try{
 const data=await api('/api/logistics',{body:JSON.stringify({kind:'transport',action:'batchRead',keys})});
 dialog.innerHTML=`<form id="sacBatchForm"><header><div><small>ACOMPANHAMENTO · SAC</small><h2>Preencher ${logN(data.items.length)} notas</h2><p>Marque somente os campos que deseja alterar.</p></div><button type="button" class="btn" id="sacBatchClose" aria-label="Fechar preenchimento em massa">×</button></header><section id="sacBatchInputs"><div class="sac-fields">${data.fields.map(f=>`<section class="sac-batch-field"><label class="sac-field-toggle"><input type="checkbox" data-batch-apply="${esc(f.name)}" ${f.readOnly||f.options?.length===0?'disabled':''}>${esc(f.label)}</label><div class="sac-batch-control" data-batch-control="${esc(f.name)}">${f.name==='follow'?'<label>Como aplicar<select name="followMode" disabled><option value="append">Acrescentar ao follow-up existente</option><option value="replace">Substituir o follow-up existente</option></select></label>':''}${f.type==='date'?`<input type="date" name="${esc(f.name)}" aria-label="${esc(f.label)} em massa" max="${transportToday()}" disabled>`:f.options?`<select name="${esc(f.name)}" aria-label="${esc(f.label)} em massa" disabled><option value="">Escolha uma opção</option>${f.options.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`:`<textarea name="${esc(f.name)}" aria-label="${esc(f.label)} em massa" rows="${f.name==='follow'||f.name==='notes'?3:2}" maxlength="2000" disabled placeholder="Valor para as notas selecionadas"></textarea>`}<small>${f.readOnly?'Campo protegido por fórmula em uma das notas.':f.options?.length===0?'Não há opção comum a todas as notas.':`${logN(f.filled)} notas já possuem este campo preenchido.`}</small></div></section>`).join('')}</div><p class="sac-help">Campos desmarcados serão preservados. Campos vazios não apagam dados. O follow-up pode ser acrescentado ou substituído.</p></section><section id="sacBatchReview" hidden></section><p id="sacBatchStatus" role="status" aria-live="polite"></p><footer><button type="button" class="btn" id="sacBatchBack" hidden>Voltar e editar</button><button type="button" class="btn" id="sacBatchCancel">Cancelar</button><button type="submit" class="btn primary" id="sacBatchSubmit">Revisar alterações</button></footer></form>`;
 const form=$('#sacBatchForm',dialog),status=$('#sacBatchStatus',dialog),submit=$('#sacBatchSubmit',dialog),back=$('#sacBatchBack',dialog),review=$('#sacBatchReview',dialog),inputs=$('#sacBatchInputs',dialog);let changes=null,saving=false;
 $('#sacBatchClose',dialog).onclick=$('#sacBatchCancel',dialog).onclick=()=>{if(!saving)dialog.close();};dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 $$('[data-batch-apply]',dialog).forEach(toggle=>toggle.onchange=()=>{const box=$$('[data-batch-control]',dialog).find(x=>x.dataset.batchControl===toggle.dataset.batchApply);box.querySelectorAll('textarea,select,input[type=date]').forEach(el=>{el.disabled=!toggle.checked;el.required=toggle.checked;});});
 back.onclick=()=>{changes=null;inputs.hidden=false;review.hidden=true;back.hidden=true;submit.textContent='Revisar alterações';status.textContent='';};
 form.onsubmit=async e=>{e.preventDefault();if(saving)return;if(!changes){
 changes={};for(const f of data.fields){const toggle=$$('[data-batch-apply]',dialog).find(t=>t.dataset.batchApply===f.name);if(!toggle?.checked)continue;const value=form.elements.namedItem(f.name).value.trim();if(!value){changes=null;status.textContent='Preencha os campos marcados.';return;}changes[f.name]={value,mode:f.name==='follow'?form.elements.namedItem('followMode').value:'replace'};}
 if(!Object.keys(changes).length){changes=null;status.textContent='Marque ao menos um campo para alterar.';return;}
 review.innerHTML=`<h3>Revise antes de salvar</h3><p>As alterações abaixo serão aplicadas a <strong>${logN(data.items.length)} notas</strong>. Os demais campos serão preservados.</p><dl class="sac-batch-summary">${Object.entries(changes).map(([name,c])=>`<div><dt>${esc(data.fields.find(f=>f.name===name).label)} <small>${c.mode==='append'?'Acrescentar':'Substituir'}</small></dt><dd>${esc(name==='deliveredDate'?transportDate(c.value):c.value)}</dd></div>`).join('')}</dl><details><summary>Conferir as ${logN(data.items.length)} notas selecionadas</summary><ul class="sac-batch-invoices">${data.items.map(x=>`<li><strong>NF ${esc(x.invoice||'Não informada')}</strong> · ${esc(x.client)}</li>`).join('')}</ul></details>`;
 inputs.hidden=true;review.hidden=false;back.hidden=false;submit.textContent='Confirmar e salvar em '+logN(data.items.length)+' notas';status.textContent='';return;}
 saving=true;submit.disabled=true;back.disabled=true;$('#sacBatchCancel',dialog).disabled=$('#sacBatchClose',dialog).disabled=true;status.textContent='Salvando e conferindo as notas na planilha…';
 try{const result=await api('/api/logistics',{body:JSON.stringify({kind:'transport',action:'batchSave',keys,versions:Object.fromEntries(data.items.map(x=>[x.key,x.version])),changes})});
 LOG.queue.selected=[];sacApplySaved(result);
 if(!result.patches?.length)transportRefreshQueue();
 dialog.innerHTML=`<div class="panel sac-batch-result"><h2>${result.partial?'Algumas notas precisam de conferência':'Preenchimento concluído'}</h2><p role="status">${logN(result.updated)} notas atualizadas${result.unchanged?' · '+logN(result.unchanged)+' sem alterações':''}${result.partial?' · '+logN(result.failed.length)+' não confirmadas':''}.</p>${result.partial?`<p>Confira estas notas antes de repetir o preenchimento:</p><ul>${result.failed.map(x=>`<li>NF ${esc(x.invoice||'Não informada')}</li>`).join('')}</ul>`:''}${result.auditWarning?'<p>Os dados foram conferidos, mas o registro de auditoria não pôde ser confirmado.</p>':''}<button type="button" class="btn primary" id="sacBatchDone">Concluir</button></div>`;$('#sacBatchDone',dialog).onclick=()=>dialog.close();
 }catch(err){saving=false;submit.disabled=false;back.disabled=false;$('#sacBatchCancel',dialog).disabled=$('#sacBatchClose',dialog).disabled=false;status.textContent=err.message;if(!err.message.startsWith('Outra gravação está em andamento.')){status.textContent+=' Feche e reabra o formulário para conferir os valores atuais antes de tentar novamente.';submit.disabled=true;back.hidden=true;}}
 };
 $('#sacBatchClose',dialog).focus();
 }catch(err){dialog.innerHTML=`<div class="panel"><h2>Não foi possível preparar o lote</h2><p>${esc(err.message)}</p><button type="button" class="btn" id="sacBatchErrorClose">Fechar</button></div>`;$('#sacBatchErrorClose',dialog).onclick=()=>dialog.close();}
}


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
 const index=rows=>{
   const buckets=new Map();
   for(const n of rows){const key=n.number+'|'+n.year;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(n);}
   return buckets;
 };
 const opsByInvoice=index(ops),trsByInvoice=index(trs);
 const bucket=(map,n)=>map.get(n.number+'|'+n.year)||[];
 const sameInvoice=(a,b)=>!a.series||!b.series||a.series===b.series;
 const sameParty=(a,b)=>a.client===b.client&&(!a.city||!b.city||a.city===b.city)&&(!a.uf||!b.uf||a.uf===b.uf);
 for(const indexed of [opsByInvoice,trsByInvoice]){
   for(const group of indexed.values()){
     if(group.length<2)continue;
     for(const n of group)if(group.some(o=>o!==n&&sameInvoice(n,o)))uncertain.add(n);
   }
 }
 for(const a of ops){
  const possible=bucket(trsByInvoice,a).filter(b=>sameInvoice(a,b)),candidates=possible.filter(b=>sameParty(a,b));
  if(uncertain.has(a)){possible.forEach(b=>uncertain.add(b));continue;}
  if(candidates.length===1&&!uncertain.has(candidates[0])&&bucket(opsByInvoice,candidates[0]).filter(o=>sameInvoice(o,candidates[0])&&sameParty(o,candidates[0])).length===1){
   const b=candidates[0];used.add(b);shared++;if(a.delivered!==b.delivered)conflicts++;if(a.delivered||b.delivered)delivered++;
  }else if(possible.length){uncertain.add(a);possible.forEach(b=>uncertain.add(b));}
  else if(a.delivered)delivered++;
 }
 for(const b of trs)if(!used.has(b)&&!uncertain.has(b)&&b.delivered)delivered++;
 return {delivered,shared,conflicts,ambiguous:uncertain.size,unidentified,operationNotes:ops.length,transportNotes:trs.length};
}
function logOverviewModel(operations,transport,scope='all'){
 const ops=scope==='transport'?[]:operations,trs=scope==='formation'?[]:transport,waiting=ops.filter(logAwaitingFormation),inRoute=ops.filter(r=>r.inRoute),done=ops.filter(r=>r.delivered),identity=logDeliveryConsolidation(ops,trs),cargo=new Set(ops.map(r=>r.cargoId).filter(Boolean)),loaded=ops.filter(r=>r.loaded||r.inRoute||r.delivered),occ=trs.filter(r=>r.occurrence),follow=trs.filter(r=>String(r.follow||'').trim());
 return {waitingKg:logSum(waiting,'weight'),inRouteKg:logSum(inRoute,'weight'),deliveredKg:logSum(done,'weight'),waitingRecords:waiting.length,inRouteRecords:inRoute.length,deliveredRecords:done.length,cargos:cargo.size||null,loadedRecords:loaded.length,overdue:trs.filter(r=>r.overdue&&!r.delivered).length,occurrences:occ.length,followUps:follow.length,withoutFollow:occ.filter(r=>!String(r.follow||'').trim()).length,transportDelivered:trs.filter(r=>r.delivered).length,identity,operations:ops,transport:trs};
}

const LOG_OVERVIEW_LABELS={operations:'Formação de Carga',formationOverview:'Formação de Carga',transport:'Transportadoras'};
function logOverviewArea(){
 return state.user?.formationOnly?'formation':state.user?.perfil==='SAC'?'sac':'';
}

function overviewSources(){
 const area=logOverviewArea();
 if(area==='formation')return canLog('formation')?['formationOverview']:[];
 if(area==='sac')return canLog('sac')?['transport']:[];
 return [['operations','formation'],['transport','sac']].filter(([,key])=>canLog(key)).map(([kind])=>kind);
}
async function logOverviewLoad(force=false,check=false) {
 if(LOG.overviewPending)return force&&!LOG.overviewForce?LOG.overviewPending.then(()=>logOverviewLoad(true,check)):LOG.overviewPending;
 const visible=()=>state.module==='logistics'&&LOG.page==='overview';
 LOG.overviewErrors={};
 if(force||check)logBindOverviewExtras(force);
 const task=Promise.all(overviewSources().map(async kind=>{
   try{
     const changed=await logFetchSource(kind,force,check);
     if(changed&&visible())logOverview();
   }catch(error){
     LOG.overviewErrors[kind]=error.message;
     if(visible())logOverview();
   }
 })).finally(()=>{delete LOG.overviewPending;delete LOG.overviewForce;});
 LOG.overviewPending=task;
 LOG.overviewForce=force;
 return task;
}
function logOverdueModel(rows,today=transportToday()) {
 const {rows:overdue}=transportQueueModel(rows,today,today);
 return overdue.sort((a,b)=>Number(b.needsFollow)-Number(a.needsFollow)||b.queueDelay-a.queueDelay);
}

function logOverviewOverdue(rows,page=0) {
 const missing=rows.filter(r=>r.needsFollow).length,size=12;
 const start=Math.min(page*size,Math.max(0,Math.floor((rows.length-1)/size)*size));
 const visible=rows.slice(start,start+size);
 return `<section id="overviewOverdue" class="panel overview-compact overview-overdue" tabindex="-1" aria-labelledby="overviewOverdueTitle">
   <header class="driver-agenda-heading"><div><h2 id="overviewOverdueTitle">Notas em atraso</h2>
   <p>${logN(rows.length)} em atraso · ${logN(missing)} sem follow-up · período selecionado</p></div></header>
   ${rows.length?`<ul class="overview-scroll" tabindex="0" aria-label="Notas em atraso">${visible.map(r=>`<li>
     <button type="button" class="overview-note" data-overview-note="${esc(r.id)}">
       <i class="cargo-state-dot red" aria-hidden="true"></i><span><strong>NF ${esc(r.invoice||'não informada')}</strong>
       <span class="overview-note-carrier"> · ${esc(r.carrier||'Transportadora não informada')}</span>
       <small>${r.queueDelay} ${r.queueDelay===1?'dia':'dias'} em atraso</small></span>
       <span class="overview-follow ${r.needsFollow?'needs-follow':''}">${esc(r.needsFollow?'Sem follow-up':r.follow)}</span>
     </button></li>`).join('')}</ul>
   ${rows.length>size?`<div class="log-pagination"><button type="button" class="btn" data-overdue-page="${start/size-1}" ${start===0?'disabled':''}>Anterior</button>
     <span>${start+1}–${Math.min(start+size,rows.length)} de ${rows.length}</span><button type="button" class="btn" data-overdue-page="${start/size+1}" ${start+size>=rows.length?'disabled':''}>Próxima</button></div>`:''}`:'<p>Nenhuma nota em atraso no recorte.</p>'}</section>`;
}

function logBindOverviewOverdue(rows) {
 const panel=$('#overviewOverdue');
 if(!panel)return;
 $$('[data-overview-note]',panel).forEach(b=>b.onclick=()=>transportNote(b.dataset.overviewNote));
 $$('[data-overdue-page]',panel).forEach(b=>b.onclick=()=>{
   panel.outerHTML=logOverviewOverdue(rows,Number(b.dataset.overduePage));
   logBindOverviewOverdue(rows);
   $('#overviewOverdue .overview-scroll')?.focus({preventScroll:true});
 });
}

const LOG_WAIT_BUCKETS = [
  ['0–2 dias', 2, '#edaa67'],
  ['3–7 dias', 7, '#dd843f'],
  ['8–14 dias', 14, '#bb5d28'],
  ['15 dias ou mais', Infinity, '#8a3818'],
  ['Espera não informada', null, '#8b7b71']
];

function logWaitingBuckets(rows) {
  const buckets = LOG_WAIT_BUCKETS.map(([label, limit, color]) => ({label, limit, color, rows: [], kg: 0}));
  for (const row of rows.filter(logAwaitingFormation)) {
    const index = Number.isFinite(row.wait) && row.wait >= 0
      ? buckets.findIndex(bucket => row.wait <= bucket.limit)
      : buckets.length - 1;
    const bucket = buckets[index];
    bucket.rows.push(row);
    if (Number.isFinite(row.weight) && row.weight > 0) bucket.kg += row.weight;
  }
  return buckets;
}

function logUpcomingNotes(rows, today) {
  const tomorrow = transportDayShift(today, 1);
  return rows.filter(row => !row.delivered && !row.deliveredDate &&
      (row.forecast === today || row.forecast === tomorrow))
    .sort((a,b) => a.forecast.localeCompare(b.forecast) ||
      String(a.carrier || '').localeCompare(String(b.carrier || ''), 'pt-BR') ||
      String(a.invoice || '').localeCompare(String(b.invoice || ''), 'pt-BR', {numeric:true}));
}

function logSlaModel(rows) {
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T12:00:00Z'));
  const delivered = rows.filter(row => date(row.deliveredDate));
  const carriers = new Map(), weeks = new Map();
  let eligible = 0, onTime = 0;
  for (const row of delivered) {
    const key = row.carrier || 'Não informada';
    if (!carriers.has(key)) carriers.set(key, {key, total:0, eligible:0, onTime:0});
    const carrier = carriers.get(key);
    carrier.total++;
    if (!date(row.forecast)) continue;

    const start = agendaWeek(row.deliveredDate);
    if (!weeks.has(start)) weeks.set(start, {start, eligible:0, onTime:0});
    const week = weeks.get(start);
    const metDeadline = Number(row.deliveredDate <= row.forecast);
    week.eligible++;
    week.onTime += metDeadline;
    carrier.eligible++;
    carrier.onTime += metDeadline;
    eligible++;
    onTime += metDeadline;
  }
  const percent = item => item.eligible ? item.onTime / item.eligible * 100 : null;
  const keys = [...weeks.keys()].sort(), latest = keys.at(-1);
  const trend = latest ? Array.from({length:12}, (_,i) => transportDayShift(latest, (i-11)*7))
    .filter(start => start >= keys[0])
    .map(start => weeks.get(start) || {start, eligible:0, onTime:0})
    .map(week => ({...week, percent:percent(week)})) : [];
  return {
    delivered:delivered.length, eligible, onTime, percent:percent({eligible,onTime}), trend,
    carriers:[...carriers.values()].map(carrier => ({...carrier, percent:percent(carrier)}))
      .sort((a,b) => b.eligible - a.eligible || b.total - a.total || a.key.localeCompare(b.key,'pt-BR'))
  };
}

function logTowerPercent(value) {
  return value === null ? '—' : logN(value, 1) + '%';
}

function logTowerHero(items,area='') {
  const title=area==='formation'?'Torre de controle da Formação':area==='sac'?'Torre de controle do SAC':'Torre de controle logística';
  const description=area==='formation'?'Priorize o peso em espera e acompanhe a situação das cargas.':area==='sac'?'Acompanhe vencimentos, follow-ups e desempenho das transportadoras.':'Priorize cargas e acompanhe os prazos de entrega no recorte selecionado.';
  return `<section class="log-tower-hero" aria-labelledby="logTowerTitle">
    <div class="log-tower-heading"><span class="log-tower-eyebrow">CENTRAL REBANHO · LOGÍSTICA</span>
      <h2 id="logTowerTitle">${title}</h2>
      <p>${description}</p>
    </div>
    <div class="log-tower-kpis">${items.map(([label,value,detail,target,tone='']) =>
      `<button type="button" class="log-tower-kpi ${tone}" data-log-jump="${target}">
        <span>${esc(label)}</span><strong>${esc(value)}</strong>
        <small>${esc(detail)}</small><i aria-hidden="true">↗</i></button>`).join('')}</div>
  </section>`;
}

function logTowerPanel(id, index, title, description, content) {
  return `<section id="${id}" class="panel log-tower-panel" tabindex="-1" aria-labelledby="${id}Title">
    <header class="log-tower-panel-head"><span aria-hidden="true">${index}</span>
      <div><h3 id="${id}Title">${title}</h3><p>${description}</p></div></header>
    ${content}</section>`;
}

function logTowerWaiting(buckets) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.kg, 0);
  const max = Math.max(1, ...buckets.map(bucket => bucket.kg));
  const body = `<div class="log-wait-total"><strong>${logN(total/1000,2)} t</strong><span>peso informado · ${logN(buckets.reduce((n,b)=>n+b.rows.length,0))} registros</span></div>
    <div class="log-wait-bands">${buckets.map((bucket,index) =>
      `<button type="button" data-log-wait="${index}" ${bucket.rows.length?'':'disabled'} style="--band-color:${bucket.color}">
        <span>${bucket.label}</span><span class="log-wait-track"><i style="--fill:${100*bucket.kg/max}%"></i></span>
        <strong>${logN(bucket.kg/1000,2)} t</strong><small>${logN(bucket.rows.length)} reg.</small></button>`).join('')}</div>`;
  return logTowerPanel('logTowerWaiting','01','Peso por tempo de espera',
    'Apenas registros com status da entrega em branco. Selecione uma faixa para ver as regiões.',body);
}

function logTowerWaitingDetails(bucket) {
  const regions = logGroup(bucket.rows, 'region', 'weight');
  return formationDialog('Peso em espera · '+bucket.label,
    `<p>${logN(bucket.rows.length)} registros · ${logN(bucket.kg/1000,2)} t informadas</p>
    <ul class="log-tower-detail-list">${regions.map(region =>
      `<li><strong>${esc(region.name)}</strong><span>${logN(region.value/1000,2)} t</span></li>`).join('')}</ul>`);
}

function logTowerUpcoming(notes, today, page=0) {
  const size = 8, start = Math.min(Math.max(0,page)*size, Math.max(0,Math.ceil(notes.length/size)-1)*size);
  const todayCount = notes.filter(row => row.forecast === today).length;
  const body = `<p class="log-tower-queue-total"><strong>${logN(todayCount)} hoje</strong><span>${logN(notes.length-todayCount)} amanhã</span></p>
    ${notes.length?`<ul class="overview-scroll log-tower-note-list" tabindex="0" aria-label="Notas a vencer">${notes.slice(start,start+size).map(row =>
      `<li><button type="button" class="overview-note" data-log-upcoming-note="${esc(row.id)}">
        <span><strong>NF ${esc(row.invoice || 'não informada')}</strong><small>${esc(row.carrier || 'Transportadora não informada')}</small></span>
        <span class="log-tower-due ${row.forecast===today?'is-today':''}">${row.forecast===today?'Hoje':'Amanhã'} · ${row.forecast.slice(8)}/${row.forecast.slice(5,7)}</span>
      </button></li>`).join('')}</ul>
      ${notes.length>size?`<div class="log-pagination"><button type="button" class="btn" data-log-upcoming-page="${start/size-1}" ${start===0?'disabled':''}>Anterior</button><span>${start+1}–${Math.min(start+size,notes.length)} de ${notes.length}</span><button type="button" class="btn" data-log-upcoming-page="${start/size+1}" ${start+size>=notes.length?'disabled':''}>Próxima</button></div>`:''}`:
      '<p class="log-tower-empty">Nenhuma nota a vencer hoje ou amanhã no recorte.</p>'}`;
  return logTowerPanel('logTowerUpcoming','AÇÃO','Vencimentos próximos',
    'Notas ainda abertas. Prazo interno Rebanho ou, quando ausente, previsão da transportadora.',body);
}

function logTowerBindUpcoming(notes, today) {
  const panel = $('#logTowerUpcoming');
  if (!panel) return;
  $$('[data-log-upcoming-note]',panel).forEach(button => button.onclick = () => transportNote(button.dataset.logUpcomingNote));
  $$('[data-log-upcoming-page]',panel).forEach(button => button.onclick = () => {
    panel.outerHTML = logTowerUpcoming(notes,today,Number(button.dataset.logUpcomingPage));
    logTowerBindUpcoming(notes,today);
    $('#logTowerUpcoming .overview-scroll')?.focus({preventScroll:true});
  });
}

function logTowerSla(sla) {
  const weekLabel = date => date.slice(8)+'/'+date.slice(5,7);
  const body = sla.trend.length ? `<div class="log-sla-total"><strong>${logTowerPercent(sla.percent)}</strong>
    <span>${logN(sla.onTime)} no prazo de ${logN(sla.eligible)} avaliadas · ${logN(sla.delivered)} entregues</span></div>
    <div class="log-sla-chart"><canvas id="logTowerTrendChart"></canvas></div>
    <details class="log-sla-data"><summary>Ver números por semana</summary>
      <ul class="log-tower-detail-list">${sla.trend.map(week => `<li><strong>${weekLabel(week.start)}–${weekLabel(transportDayShift(week.start,6))}</strong>
        <span>${logTowerPercent(week.percent)} · ${logN(week.onTime)} de ${logN(week.eligible)}</span></li>`).join('')}</ul>
    </details>` : '<p class="log-tower-empty">Nenhuma entrega com data e prazo informados no recorte.</p>';
  return logTowerPanel('logTowerSla','02','Entregas no prazo por semana',
    'Por data de entrega, entre as notas do recorte. Até 12 semanas, de domingo a sábado.',body);
}

function logTowerDrawSla(trend) {
  const canvas = $('#logTowerTrendChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const weekLabels = trend.map(week => week.start.slice(8)+'/'+week.start.slice(5,7));
  chart(canvas, 'line', {
    labels:weekLabels,
    datasets:[{label:'Entregas no prazo',data:trend.map(week=>week.percent),
      borderColor:'#a34519',backgroundColor:'#e7894430',pointBackgroundColor:'#a34519',
      pointBorderColor:'#fff8f0',pointBorderWidth:2,solidColor:true,fill:true,tension:.26}]
  },{
    interaction:{mode:'nearest',intersect:false},
    plugins:{legend:{display:false},tooltip:{callbacks:{label:({dataIndex})=>{
      const week=trend[dataIndex];
      return logTowerPercent(week.percent)+' · '+logN(week.onTime)+' de '+logN(week.eligible)+' entregas';
    }}}},
    scales:{x:{grid:{display:false},ticks:{color:'#775442',maxTicksLimit:7}},
      y:{min:0,max:100,grid:{color:'#edcfb8'},ticks:{color:'#775442',stepSize:25,callback:value=>value+'%'}}}
  });
}

function logTowerCarriers(carriers) {
  const visible = carriers.slice(0,8);
  const body = visible.length ? `<div class="log-carrier-sla">${visible.map((carrier,index) =>
    `<button type="button" data-log-sla-carrier="${index}">
      <span><strong>${esc(carrier.key)}</strong><small>${logN(carrier.eligible)} avaliadas · ${logN(carrier.total)} entregues</small></span>
      <span class="log-wait-track"><i style="--fill:${carrier.percent ?? 0}%"></i></span>
      <b>${logTowerPercent(carrier.percent)}</b></button>`).join('')}</div>` :
    '<p class="log-tower-empty">Nenhuma entrega registrada no recorte.</p>';
  return logTowerPanel('logTowerCarriers','SLA','Pontualidade por transportadora',
    'Até 8 transportadoras por volume avaliado. A pontualidade usa a data de entrega e o prazo informado.',body);
}

function logTowerCarrierDetails(carrier) {
  return formationDialog('Pontualidade · '+carrier.key,
    `<p><strong>${logTowerPercent(carrier.percent)}</strong> das entregas avaliadas ficaram no prazo.</p>
    <ul class="log-tower-detail-list"><li><strong>Entregas no prazo</strong><span>${logN(carrier.onTime)}</span></li>
    <li><strong>Entregas após o prazo</strong><span>${logN(carrier.eligible-carrier.onTime)}</span></li>
    <li><strong>Entregas sem prazo informado</strong><span>${logN(carrier.total-carrier.eligible)}</span></li></ul>`);
}

function logTowerStages(rows) {
  const stages = [
    {label:'Aguardando formação', color:'#e8a05d', count:rows.filter(logAwaitingFormation).length},
    {label:'Em rota', color:'#bf5b27', count:rows.filter(row=>row.inRoute).length},
    {label:'Entregue', color:'#7a391f', count:rows.filter(row=>row.delivered).length},
    {label:'Outras situações', color:'#8b7b71', count:rows.filter(row=>!logAwaitingFormation(row)&&!row.inRoute&&!row.delivered).length}
  ];
  const segmentLabel = stages.map(stage => stage.label+': '+logN(stage.count)).join(' · ');
  const content = rows.length ? `<div class="log-stage-track" role="img" aria-label="${esc(segmentLabel)}">${stages.map(stage =>
    `<span style="--stage-color:${stage.color};--stage-size:${stage.count}"></span>`).join('')}</div>
    <ul class="log-stage-legend">${stages.map(stage => `<li><i style="--stage-color:${stage.color}"></i>
      <span>${stage.label}</span><strong>${logN(stage.count)}</strong></li>`).join('')}</ul>`:
    '<p class="log-tower-empty">Nenhum registro de formação no recorte.</p>';
  return logTowerPanel('logTowerStages','FLUXO','Situação da Formação de Carga',
    'Quantidade de registros da planilha por etapa.',content);
}

function logOverview(){
 ++LOG.epoch;
 destroyCharts();
 if(state.map){try{state.map.remove()}catch{}state.map=null;}
 $('#content').className='visual-page logistics-content logistics-overview';
 $('.filterbar:not(#logFilters)')?.classList.add('hidden');
 $('#dataStatus').classList.add('hidden');
 const area=logOverviewArea();
 const [title,subtitle]=area==='formation'?['Visão Geral da Formação de Carga','Peso em espera, situação das cargas e agenda de motoristas']:
   area==='sac'?['Visão Geral do SAC','Vencimentos, atrasos, follow-ups e pontualidade das transportadoras']:
   ['Visão Geral da Logística','Planejamento de cargas e acompanhamento das entregas'];
 $('#pageTitle').textContent=title;
 $('#pageSubtitle').textContent=subtitle;
 $('#activeMenuLabel').textContent=area?title:'Logística · Visão Geral';
 logNav();
 const enabled=overviewSources(),missing=enabled.filter(kind=>!LOG.cache[kind]);
 const errors=Object.keys(LOG.overviewErrors||{});
 const progress=missing.length||errors.length?`<div class="status-card">${errors.length?'':'<div class="spinner"></div>'}<p role="status">${errors.length?
   esc(errors.map(kind=>LOG_OVERVIEW_LABELS[kind]+': '+LOG.overviewErrors[kind]).join(' · ')):
   'Carregando '+missing.map(kind=>LOG_OVERVIEW_LABELS[kind]).join(' e ')+'…'}${missing.length===1&&enabled.length===2?' Os indicadores abaixo são da fonte já disponível.':''}</p>${errors.length?'<button class="btn" id="logOverviewRetry">Tentar novamente</button>':''}</div>`:'';
 const bindRetry=()=>{const button=$('#logOverviewRetry');if(button)button.onclick=()=>logOverviewLoad(true);};
 if(!enabled.length||missing.length===enabled.length){
   $('#logFilters')?.classList.add('hidden');
   $('#content').innerHTML=progress+logOverviewExtras();
   bindRetry();logBindOverviewExtras();
   if(enabled.length&&!errors.length)logOverviewLoad();
   return;
 }
 const formationSource=area==='formation'?'formationOverview':'operations';
 const formation=enabled.includes(formationSource)&&!missing.includes(formationSource);
 const transport=enabled.includes('transport')&&!missing.includes('transport');
 const allOps=formation?LOG.cache[formationSource].rows:[],allTrs=transport?LOG.cache.transport.rows:[];
 const m=logOverviewModel(logRows(allOps),logRows(allTrs)),identity=m.identity;
 const today=transportToday();
 const overdue=transport?logOverdueModel(m.transport,today):[];
 const upcoming=transport?logUpcomingNotes(m.transport,today):[];
 const sla=transport?logSlaModel(m.transport):null;
 const withoutFollow=overdue.filter(row=>row.needsFollow).length;
 LOG.kind=formation?'operations':'transport';
 logFilters([...allOps,...allTrs]);
 $('#periodChip').textContent=(LOG.filters.month==='Todos'?'Todos os meses':String(LOG.filters.month).padStart(2,'0'))+' · '+LOG.filters.year;
 const stamp=kind=>new Date(LOG.cache[kind].meta.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'});
 $('#lastBaseUpdate').textContent=enabled.filter(kind=>!missing.includes(kind)).map(kind=>LOG_OVERVIEW_LABELS[kind]+': '+stamp(kind)).join(' · ');
 const weight=v=>logN(v/1000,3)+' t',waiting=m.operations.filter(logAwaitingFormation);
 const loadedNote=m.cargos===null?'Sem identificador de carga na base · '+logN(m.loadedRecords)+' registros carregados/em rota/entregues':'Cargas com identificação na base';
 const metrics=(title,tone,items)=>`<section class="overview-metrics ${tone}"><h2>${title}</h2>${logKpis(items)}</section>`;
 const buckets=formation?logWaitingBuckets(waiting):[];
 const headline=[];
 if(formation)headline.push(['Peso aguardando formação',weight(buckets.reduce((sum,bucket)=>sum+bucket.kg,0)),logN(waiting.length)+' registros · ver faixas de espera','logTowerWaiting']);
 if(transport)headline.push(
   ['Vencem hoje ou amanhã',logN(upcoming.length),'Notas em aberto no recorte','logTowerUpcoming'],
   ['Atrasadas sem follow-up',logN(withoutFollow),logN(overdue.length)+' notas vencidas','overviewOverdue',withoutFollow?'is-alert':''],
   ['Entregas no prazo',logTowerPercent(sla.percent),logN(sla.eligible)+' avaliadas · ver tendência','logTowerSla']
 );
 const links=`<section class="panel log-overview-links"><h3>Aprofundar e agir</h3>${
   area!=='sac'&&logPageAllowed('formation')?`<button class="btn" id="logOverviewFormation">${area?'Abrir montagem de cargas':'Montagem de Cargas e mapa de prioridades'} ↗</button>`:''
 }${area!=='formation'&&logPageAllowed('transport')?`<button class="btn" id="logOverviewTransport">${area?'Abrir fila do SAC':'Transportadoras e acompanhamento SAC'} ↗</button>`:''}</section>`;
 let h=progress+logTowerHero(headline,area)+(area?links:'');
 h+=`<div class="overview-grid log-tower-grid">${formation?logTowerWaiting(buckets):''}${transport?logTowerSla(sla):''}</div>`;
 if(transport)h+=`<div class="overview-grid log-tower-grid">${logTowerUpcoming(upcoming,today)}${logOverviewOverdue(overdue)}</div>`;
 h+=logOverviewExtras();
 if(formation||transport)h+=`<div class="overview-grid log-tower-grid">${formation?logTowerStages(m.operations):''}${transport?logTowerCarriers(sla.carriers):''}</div>`;
 h+=`<div class="overview-grid">${formation?metrics('Formação de Carga','overview-formation',[
   ['Peso aguardando formação',weight(m.waitingKg),'Somente status da entrega em branco'],
   ['Peso em rota',weight(m.inRouteKg),'Status ROTA / EM ROTA'],
   ['Cargas formadas',m.cargos===null?'—':logN(m.cargos),loadedNote],
   ['Entregues na formação',logN(m.deliveredRecords),'Registros da planilha · '+weight(m.deliveredKg)]
 ]):''}${transport?metrics('Transportadoras','overview-transport',[
   ['Notas em atraso',logN(overdue.length),'Em aberto com prazo vencido'],
   ['Ocorrências',logN(m.occurrences),'Ocorrências registradas'],
   ['Com follow-up',logN(m.followUps),'Registros com acompanhamento preenchido'],
   ['Atrasadas sem follow-up',logN(overdue.filter(r=>r.needsFollow).length),'Aguardando acompanhamento']
 ]):''}</div>`;
 if(!area&&(formation||transport))h+=`<details class="panel log-identity-note"><summary>${logN(identity.delivered)} entregas concluídas com NF identificada · ver critérios</summary><p>${logN(identity.shared)} notas relacionadas entre as bases · ${logN(identity.conflicts)} divergências de situação · ${logN(identity.ambiguous)} identificações ambíguas separadas do total.</p><p>Formação: ${logN(identity.unidentified.operations)} registros entregues sem identificação suficiente; Transportadoras: ${logN(identity.unidentified.transport)}. Uma mesma NF em vários produtos conta uma vez. Notas coincidentes só são relacionadas quando ano, cliente, cidade e série permitem uma correspondência única.</p><p>Os pesos vêm da Formação de Carga. O período usa a data de implantação na formação e a de emissão da NF nas transportadoras.</p></details>`;
 if(formation)h+=`<div class="overview-grid overview-charts">${logPanel('logRegion','Peso aguardando formação por região','Toneladas · status da entrega em branco.')}${logPanel('logWait','Maior espera média por região','Registros aguardando formação com espera informada.')}</div>`;
 if(!area)h+=links;
 $('#content').innerHTML=h;
 bindRetry();
 logBindOverviewExtras();
 logBindOverviewOverdue(overdue);
 if(transport){
   logTowerBindUpcoming(upcoming,today);
   logTowerDrawSla(sla.trend);
   $$('[data-log-sla-carrier]').forEach(button=>button.onclick=()=>logTowerCarrierDetails(sla.carriers[Number(button.dataset.logSlaCarrier)]));
 }
 $$('[data-log-wait]').forEach(button=>button.onclick=()=>logTowerWaitingDetails(buckets[Number(button.dataset.logWait)]));
 $$('[data-log-jump]').forEach(button=>button.onclick=()=>{
   const panel=document.getElementById(button.dataset.logJump);
   if(!panel)return;
   panel.focus({preventScroll:true});
   panel.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 });
 if(formation){
   logChart('logRegion',logGroup(waiting,'region','weight'),'region',{format:v=>logN(v/1000,2)+' t'});
   logChart('logWait',logGroup(waiting,'region','wait','avg'),'region',{format:v=>logN(v,1)+' dias'});
 }
 for(const [id,page]of [['logOverviewFormation','formation'],['logOverviewTransport','transport']])$('#'+id)?.addEventListener('click',()=>{LOG.page=page;logShow();});
}
function logNav(){
 let n=$('#logNav');if(!n){n=document.createElement('nav');n.id='logNav';n.className='nav';n.setAttribute('aria-label','Seções de logística');$('#appMenu .menu-footer').before(n);}
 const item=(k,label)=>{const p=LOG_PAGES[k];return `<button type="button" class="nav-item ${k===LOG.page?'active':''}" data-log-page="${k}"><span>${moduleIcon(p[2])}</span><b>${esc(label||p[0])}</b></button>`;};
 LOG_PAGES.agenda=['Agenda de motoristas','Calendário da operação', 'M8 2v4M16 2v4M3 9h18M4 4h16v17H4z'];
 if(state.user?.formationOnly||state.user?.transportOnly)n.innerHTML=['overview','formation','agenda','transport'].filter(logPageAllowed).map(k=>item(k)).join('');
 else {
 LOG_PAGES.settings=['Configurações da Logística','Cadastros e padrões do roteiro','M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3'];
 n.innerHTML=['overview','formation','transport'].filter(logPageAllowed).map(k=>item(k)).join('')+'<p class="menu-caption">DETALHAMENTOS</p>'+['routes','fleet','agenda','pending','occurrences','costs'].filter(logPageAllowed).map(k=>item(k)).join('')+(logPageAllowed('indicators')?item('indicators','Qualidade da formação'):'')+(logPageAllowed('settings')?item('settings'):'')+(state.user?.perfil==='ADMIN'?item('sources'):'');
 }
 $$('[data-log-page]').forEach(b=>b.onclick=()=>{LOG.page=b.dataset.logPage;if(LOG.page==='indicators')LOG.indicatorTab='formations';LOG.search='';LOG.tablePage=0;$('#menuClose').click();logShow();});
}

const FEXP={data:null,pending:null,tab:'plan',view:'experimental',mode:'available',selected:new Set(),assemblySelected:new Set(),montage:'',query:'',withoutInvoice:false,sort:'order',direction:1,page:0,busy:false,timer:null};
function formationN(v,d=0){return v==null?'—':logN(v,d);}
function formationWeight(v){return v==null?'—':logN(v,1)+' kg · '+logN(v/1000,3)+' t';}
function formationAggregate(orders){const products=new Map();let weight=0,volumes=0,unknownWeight=false,unknownVolumes=false;for(const o of orders){if(o.weight==null||o.weightIncomplete)unknownWeight=true;else weight+=o.weight;if(o.volumes==null)unknownVolumes=true;else volumes+=o.volumes;for(const p of o.products||[]){const key=p.code==null?'name:'+p.description:'code:'+p.code;if(!products.has(key))products.set(key,{code:p.code,description:p.description,quantity:0,unknown:false});const x=products.get(key);if(p.quantity==null)x.unknown=true;else x.quantity+=p.quantity;}}return {count:orders.length,clients:new Set(orders.map(o=>o.clientCode)).size,weight:unknownWeight?null:weight,volumes:unknownVolumes?null:volumes,products:[...products.values()].map(p=>({...p,quantity:p.unknown?null:p.quantity})).sort((a,b)=>String(a.description).localeCompare(String(b.description),'pt-BR'))};}
function formationApi(payload){return api('/api/logistics',{body:JSON.stringify({kind:'formationDirect',...payload})});}
function formationApplyView(view) {
 if(FEXP.data&&view.revision<FEXP.data.revision)return false;
 if(FEXP.data?.revision!==view.revision)cargoOverviewInvalidate();
 FEXP.data=view;
 const available=new Set(view.orders.filter(o=>!o.blocked&&!o.montageId).map(o=>o.key));
 FEXP.selected=new Set([...FEXP.selected].filter(k=>available.has(k)));
 const members=new Set(view.orders.filter(o=>o.montageId===FEXP.montage).map(o=>o.key));
 FEXP.assemblySelected=new Set([...FEXP.assemblySelected].filter(k=>members.has(k)));
 return true;
}

async function formationReload(force=false) {
 if(FEXP.pending)return force&&!FEXP.pendingForce ? FEXP.pending.then(()=>formationReload(true)) : FEXP.pending;
 const current=FEXP.data,check=!!current&&!force;
 const visible=()=>state.module==='logistics'&&LOG.page==='formation'&&FEXP.view!=='legacy';
 const task=(async()=>{
  try{
   const result=await formationApi({action:'read',force,check,revision:current?.revision,sourceVersion:current?.sourceVersion,viewVersion:current?.viewVersion});
   if(result.unchanged){
    if(FEXP.data===current)FEXP.data.updatedAt=result.updatedAt;
    return true;
   }
   if(!formationApplyView(result))return false;
   if(visible())formationShow();
   return true;
  }catch(error){
   if(!visible())return false;
   if(FEXP.data){formationNotice('Os dados exibidos foram preservados. '+error.message);return false;}
   $('#content').innerHTML=`<section class="panel"><h2>Montagens indisponíveis</h2><p>${esc(error.message)}</p><button class="btn" id="formationRetry">Tentar novamente</button></section>`;
   $('#formationRetry').onclick=()=>formationReload(true);
   return false;
  }finally{
   FEXP.pending=null;
   FEXP.pendingForce=false;
  }
 })();
 FEXP.pending=task;
 FEXP.pendingForce=force;
 return task;
}
function formationHasInvoice(order) {
  return (order.invoices || []).some(value => {
    const invoice = normalize(value);
    return invoice && !/^(?:0+(?:[.,]0+)?|[-–—]+|#?N\/A|SEM NF|NAO INFORMAD[AO])$/.test(invoice);
  });
}
function formationOrderRows(){const all=FEXP.data.orders,filteredSource=new Set(logRows(FEXP.data.mapRows).map(r=>r.sourceKey)),q=normalize(FEXP.query);return all.filter(o=>!o.montageId&&!o.blocked&&(!FEXP.withoutInvoice||!formationHasInvoice(o))).filter(o=>o.sourceRows.some(r=>filteredSource.has(r.sourceKey))).filter(o=>!q||normalize([o.order,o.clientCode,o.client,o.city,o.uf,o.internalStatus,...o.products.map(p=>p.code+' '+p.description)].join(' ')).includes(q)).sort((a,b)=>{const x=a[FEXP.sort],y=b[FEXP.sort];return (typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??''),'pt-BR',{numeric:true}))*FEXP.direction;});}
function formationTable(rows,selection,assembly=false){const start=assembly?0:FEXP.page*40,part=assembly?rows:rows.slice(start,start+40);return `<div class="table-wrap"><table class="log-table formation-orders"><thead><tr><th><input type="checkbox" id="formationSelectPage" aria-label="Selecionar pedidos disponíveis desta página" ${part.some(o=>assembly||!o.blocked&&!o.montageId)?'':'disabled'}></th>${[['order','Pedido'],['clientCode','Cód. cliente'],['client','Cliente'],['city','Cidade'],['uf','UF'],['volumes','Volumes'],['weight','Peso'],['internalStatus','Situação']].map(([k,label])=>`<th><button class="formation-sort" data-formation-sort="${k}">${label} ↕</button></th>`).join('')}<th>Montagem</th><th>Detalhes</th></tr></thead><tbody>${part.map(o=>`<tr><td><input type="checkbox" data-formation-select="${esc(o.key)}" aria-label="Selecionar pedido ${esc(o.order)}" ${selection.has(o.key)?'checked':''} ${!assembly&&(o.blocked||o.montageId)?'disabled':''}></td><td><strong>${esc(o.order)}</strong></td><td>${esc(o.clientCode)}</td><td>${esc(o.client)}</td><td>${esc(o.city||o.sourceRows[0]?.cityLabel||'—')}</td><td>${esc(o.uf||o.sourceRows[0]?.uf||'—')}</td><td>${formationN(o.volumes)}</td><td>${o.weightIncomplete?'—':formationWeight(o.weight)}</td><td>${esc(o.internalStatus)}${o.sourceIssue?`<small class="formation-warning">${esc(o.sourceIssue)}</small>`:''}</td><td>${esc(FEXP.data.montages.find(m=>m.id===o.montageId)?.name||'—')}</td><td><button class="btn" data-formation-detail="${esc(o.key)}">Ver pedido</button></td></tr>`).join('')||'<tr><td colspan="11">Nenhum pedido em aberto na base do Força de Vendas para este recorte.</td></tr>'}</tbody></table></div>${assembly?'':`<div class="log-pagination"><button class="btn" id="formationPrev" ${FEXP.page===0?'disabled':''}>Anterior</button><span>${rows.length?start+1:0}–${Math.min(start+40,rows.length)} de ${rows.length}</span><button class="btn" id="formationNext" ${start+40>=rows.length?'disabled':''}>Próxima</button></div>`}`;}
function formationProducts(products){return `<div class="table-wrap"><table class="log-table"><thead><tr><th>Código</th><th>Produto</th><th>Quantidade pedida</th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.code??'—')}</td><td>${esc(p.description)}</td><td>${formationN(p.quantity,2)}</td></tr>`).join('')||'<tr><td colspan="3">Nenhum produto selecionado.</td></tr>'}</tbody></table></div>`;}
function formationSourceTable(rows){return `<div class="table-wrap"><table class="log-table"><thead><tr><th>Cliente na formação</th><th>Cidade</th><th>Grupo de produto</th><th>Volumes</th><th>Peso</th><th>Status original</th><th>Implantação</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.client)}</td><td>${esc(r.cityLabel)}</td><td>${esc(r.product)}</td><td>${formationN(r.volumes)}</td><td>${formationWeight(r.weight)}</td><td>${esc(r.status)}</td><td>${transportDate(r.date)}</td></tr>`).join('')}</tbody></table></div>`;}
function formationSummary(orders){const t=formationAggregate(orders);return `<aside class="panel formation-selection"><h3>Composição selecionada</h3><p class="formation-counter">${logN(t.count)} pedidos · ${logN(t.clients)} clientes</p><strong>${formationWeight(t.weight)}</strong><p>${formationN(t.volumes)} volumes</p>${t.weight==null||t.volumes==null?'<p class="formation-warning">Há dados de peso ou volumes incompletos na fonte. O total não foi estimado.</p>':''}<div class="formation-actions"><button class="btn primary" id="formationCreate">Criar nova montagem</button><button class="btn" id="formationAdd" ${t.count?'':'disabled'}>Adicionar à montagem existente</button><button class="btn" id="formationClear" ${t.count?'':'disabled'}>Limpar seleção</button></div><details open><summary>Produtos selecionados</summary>${formationProducts(t.products)}</details><p class="sac-help">A seleção permanece ao navegar entre cidades. Os pedidos e produtos vêm do Força de Vendas. Peso e volumes não informados na base aparecem como —.</p></aside>`;}
function formationShow(){
 if(state.module!=='logistics'||LOG.page!=='formation')return;const epoch=++LOG.epoch;destroyCharts();if(state.map){try{state.map.remove()}catch{}state.map=null;}LOG.kind='operations';$('#refreshData').hidden=true;$('#content').className='visual-page logistics-content formation-experimental';$('.filterbar:not(#logFilters)')?.classList.add('hidden');$('#dataStatus').classList.add('hidden');$('#pageTitle').textContent='Gestão de Formação de Cargas';$('#pageSubtitle').textContent='Pedidos do Força de Vendas · montagens gravadas na planilha auxiliar';$('#activeMenuLabel').textContent='Logística · Formação de Carga';logNav();
 if(!FEXP.data){$('#content').innerHTML='<div class="status-card"><div class="spinner"></div><p>Consultando os pedidos e as montagens experimentais…</p></div>';formationReload();return;}
 const d=FEXP.data;if(!FEXP.directInitialized){LOG.filters.year='Todos';LOG.filters.month='Todos';FEXP.directInitialized=true;}logFilters(d.mapRows);$('#periodChip').textContent=(LOG.filters.month==='Todos'?'Todos os meses':String(LOG.filters.month).padStart(2,'0'))+' · '+LOG.filters.year;$('#lastBaseUpdate').textContent='Força de Vendas · consulta '+new Date(d.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})+' · revisão '+d.revision;
 let html=`<div class="formation-test-banner"><strong>Ambiente de teste</strong><span>Os pedidos vêm da base sincronizada do Força de Vendas. A auxiliar é alimentada ao montar as cargas.</span><button class="btn" id="formationRefresh">Atualizar</button></div><div class="city-view-switch formation-tabs">${[['plan','Planejar cargas'],['montages','Cargas em montagem'],['history','Histórico'],['legacy','Indicadores anteriores']].map(([k,l])=>`<button class="${FEXP.tab===k?'active':''}" data-formation-tab="${k}">${l}</button>`).join('')}</div>`;
 if(FEXP.tab==='plan'){
  const rows=logRows(d.mapRows),waiting=rows.filter(r=>r.awaitingFormation),available=logSum(waiting,'availableWeight'),mounted=logSum(waiting,'mountedWeight'),unlinked=waiting.filter(r=>!r.linked),missing=waiting.filter(r=>r.weight==null).length;
  html+=logKpis([['Pedidos disponíveis',logN(waiting.filter(r=>!r.montageId).length),'Pedidos em aberto no Força de Vendas'],['Pedidos em montagem',logN(waiting.filter(r=>r.montageId).length),'Reservados na planilha auxiliar'],['Clientes',logN(new Set(waiting.map(r=>r.client)).size),'No recorte selecionado'],['Peso e volumes','Não informados','A base comercial atual não exporta esses campos']]);
  const ambiguous=waiting.filter(r=>r.ambiguous).length;if(ambiguous)html+='<p class="formation-warning">'+logN(ambiguous)+' registros possuem identificação repetida na origem e ficam bloqueados para vínculo e reserva até conferência. Confira sua identificação antes de montar a carga.</p>';if(missing)html+=`<p class="formation-warning">${logN(missing)} pedidos sem peso informado na base comercial. O mapa apresenta quantidade de pedidos.</p>`;
  html+=logMapMarkup();
  const orders=formationOrderRows();if(FEXP.page*40>=orders.length)FEXP.page=0;
  html+=`<div class="formation-workspace"><section class="panel"><div class="log-table-heading"><div><h3>Pedidos do Força de Vendas</h3><p>Selecione pedidos em aberto para criar ou completar uma montagem. Os dados comerciais são consultados automaticamente.</p></div></div><label class="formation-search">Pesquisar pedido, cliente ou produto<input type="search" id="formationQuery" value="${esc(FEXP.query)}" placeholder="Pedido, código do cliente, nome ou SKU"></label>${formationTable(orders,FEXP.selected)}</section>${formationSummary(d.orders.filter(o=>FEXP.selected.has(o.key)))}</div>`;
 }else if(FEXP.tab==='montages'){
  html+=`<section class="formation-montages">${d.montages.map(m=>`<button class="panel formation-montage-card ${FEXP.montage===m.id?'is-active':''}" data-formation-montage="${esc(m.id)}"><span class="history-eyebrow">${esc(m.status)}</span><h3>${esc(m.name)}</h3><small>${new Date(m.createdAt).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})} · ${esc(m.owner)}</small><p>${logN(m.orders)} pedidos · ${logN(m.clients)} clientes · ${logN(m.cities)} cidades</p><strong>${formationWeight(m.weight)}</strong><p>${formationN(m.volumes)} volumes</p>${m.sourceIssues?`<small class="formation-warning">${logN(m.sourceIssues)} pedidos com alteração na fonte. Movimentações bloqueadas para esses pedidos.</small>`:''}<small>${esc(m.id)}</small></button>`).join('')||'<section class="panel empty">Nenhuma montagem iniciada.</section>'}</section><button class="btn primary" id="formationCreateEmpty">Iniciar nova montagem</button>`;
  const montage=d.montages.find(m=>m.id===FEXP.montage);if(montage){const members=d.orders.filter(o=>o.montageId===montage.id),totals=formationAggregate(members);html+=`<section class="panel"><div class="log-table-heading"><div><h2>${esc(montage.name)}</h2><p>${esc(montage.id)} · ${formationWeight(montage.weight)} · ${formationN(montage.volumes)} volumes</p></div><button class="btn" id="formationRename">Renomear</button><button class="btn" id="formationReturnPlan">Adicionar mais pedidos</button></div><div class="formation-actions"><strong>${FEXP.assemblySelected.size} pedidos selecionados</strong><button class="btn" id="formationTransfer" ${FEXP.assemblySelected.size?'':'disabled'}>Transferir selecionados</button><button class="btn" id="formationRemove" ${FEXP.assemblySelected.size?'':'disabled'}>Retirar e devolver à disponibilidade</button></div>${formationTable(members,FEXP.assemblySelected,true)}<details><summary>Produtos consolidados da montagem</summary>${formationProducts(totals.products)}</details></section>`;}
 }else html+=`<section class="panel"><h3>Histórico de movimentações</h3><p>Últimos 200 eventos visíveis no seu recorte. O histórico completo permanece na base auxiliar.</p><div class="table-wrap"><table class="log-table"><thead><tr><th>Data e hora</th><th>Usuário</th><th>Operação</th><th>Pedidos</th><th>Origem</th><th>Destino</th></tr></thead><tbody>${d.events.map(e=>`<tr><td>${new Date(e.at).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})}</td><td>${esc(e.by)}</td><td>${esc(e.type)}</td><td>${esc(e.keys.map(k=>d.orders.find(o=>o.key===k)?.order||k).join(', '))}</td><td>${esc([...new Set(Object.values(e.from).filter(Boolean))].map(id=>d.montages.find(m=>m.id===id)?.name||id).join(', '))}</td><td>${esc(d.montages.find(m=>m.id===e.to)?.name||e.name||'Disponibilidade')}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma movimentação registrada.</td></tr>'}</tbody></table></div></section>`;
 $('#content').innerHTML=html;formationBind();
 if(FEXP.tab==='plan'){LOG.metric='count';const rows=logRows(d.mapRows).filter(r=>r.awaitingFormation);logMap(rows,epoch).then(()=>{if(LOG.epoch!==epoch)return;$('#logMapMetric').hidden=true;$('#logMapTotal').textContent=logN(rows.length)+' pedidos em aberto · peso não informado';$('#logMapLegend').textContent='Pedidos por município';$('#logMap').closest('section').querySelector('h3').textContent='Pedidos por cidade';$('#logMap').closest('section').querySelector('.log-table-heading p').textContent='Clique em uma cidade para consultar e selecionar seus pedidos.';const labels=$$('#logMap').length?$('#logMap').closest('section').querySelectorAll('.log-map-scale span'):[];if(labels.length===2){labels[0].textContent='Menos pedidos';labels[1].textContent='Mais pedidos';}});}
 if(!FEXP.timer)FEXP.timer=setInterval(()=>{if(state.module==='logistics'&&LOG.page==='formation'&&FEXP.view!=='legacy'&&!document.hidden&&!document.querySelector('.formation-dialog[open]')&&!FEXP.busy)formationReload();},120000);
}
function formationBind(){
 $('#formationRefresh').onclick=()=>formationReload(true);$$('[data-formation-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.formationTab==='legacy'){FEXP.view='legacy';logShow();return;}cargoSwitchFormationTab(b.dataset.formationTab);});$$('[data-formation-mode]').forEach(b=>b.onclick=()=>{FEXP.mode=b.dataset.formationMode;formationShow();});
 $$('[data-formation-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.formationSort;FEXP.direction=FEXP.sort===k?-FEXP.direction:1;FEXP.sort=k;formationShow();});
 const assembly=FEXP.tab==='montages';
 formationBindOrders(document,assembly?FEXP.assemblySelected:FEXP.selected,formationShow);
 $$('[data-formation-detail]').forEach(b=>b.onclick=()=>formationDetail(b.dataset.formationDetail));$$('[data-formation-montage]').forEach(b=>b.onclick=()=>{FEXP.montage=b.dataset.formationMontage;FEXP.montageDetail=true;FEXP.assemblySelected.clear();formationShow();});
 $('#formationQuery')?.addEventListener('change',e=>{FEXP.query=e.target.value;FEXP.page=0;formationShow();});
 formationBindPlanActions(document);
 $('#formationCreateEmpty')?.addEventListener('click',()=>formationMoveDialog('CRIAR',[]));$('#formationTransfer')?.addEventListener('click',()=>formationMoveDialog('TRANSFERIR',[...FEXP.assemblySelected]));$('#formationRemove')?.addEventListener('click',()=>formationMoveDialog('REMOVER',[...FEXP.assemblySelected]));$('#formationRename')?.addEventListener('click',()=>formationMoveDialog('RENOMEAR',[]));$('#formationReturnPlan')?.addEventListener('click',()=>{FEXP.tab='plan';formationShow();});$('#formationLink')?.addEventListener('click',formationLinkDialog);
}
function formationBindPlanActions(root, redraw = formationShow) {
  const create = root.querySelector('#formationCreate');
  const add = root.querySelector('#formationAdd');
  const clear = root.querySelector('#formationClear');
  if (create) create.onclick = () => formationMoveDialog('CRIAR',[...FEXP.selected]);
  if (add) add.onclick = () => formationMoveDialog('ADICIONAR',[...FEXP.selected]);
  if (clear) clear.onclick = () => { FEXP.selected.clear(); redraw(); };
}

function formationBindOrders(root, selection, render) {
  const editable=canLog('formation','edit');
  if(!editable)root.querySelectorAll('[data-formation-select],#formationSelectPage').forEach(input=>(input.closest('label')||input).remove());
  const cards = [...root.querySelectorAll('[data-formation-select]:not(:disabled)')];
  const page = root.querySelector('#formationSelectPage');
  if (page) {
    const selected = cards.filter(input => selection.has(input.dataset.formationSelect)).length;
    page.checked = !!cards.length && selected === cards.length;
    page.indeterminate = selected > 0 && selected < cards.length;
    page.disabled = !cards.length;
    page.onchange = () => {
      for (const input of cards) {
        const key = input.dataset.formationSelect;
        if (!page.checked) selection.delete(key);
        else if (selection.size < 100) selection.add(key);
      }
      render();
    };
  }
  for (const input of cards) input.onchange = () => {
    const key = input.dataset.formationSelect;
    if (input.checked) {
      if (selection.size >= 100) {
        input.checked = false;
        formationNotice('Selecione até 100 pedidos por movimentação.');
        return;
      }
      selection.add(key);
    } else selection.delete(key);
    render();
  };
  const previous = root.querySelector('#formationPrev'), next = root.querySelector('#formationNext');
  if (previous) previous.onclick = () => { FEXP.page--; render(); };
  if (next) next.onclick = () => { FEXP.page++; render(); };
}

function formationNotice(message){const p=document.createElement('p');p.className='log-notice';p.setAttribute('role','status');p.textContent=message;$('#content').prepend(p);}
function formationDialog(title,content){const dialog=document.createElement('dialog');dialog.className='sac-dialog formation-dialog';dialog.setAttribute('aria-label',title);dialog.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" class="btn formation-close" aria-label="Fechar">×</button></header>${content}`;document.body.append(dialog);dialog.showModal();dialog.querySelector('.formation-close').onclick=()=>{if(!FEXP.busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(FEXP.busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());return dialog;}
function formationDetail(key){const o=FEXP.data.orders.find(o=>o.key===key);if(!o)return;const grouped=formationAggregate([o]);formationDialog('Pedido '+o.order,`<p>${esc(o.clientCode+' · '+o.client)} · ${esc(o.city||'')} / ${esc(o.uf||'')}</p><p>${[o.internalStatus,o.weight==null||o.weightIncomplete?'':cargoKg(o.weight),o.volumes==null?'':formationN(o.volumes)+' volumes'].filter(Boolean).map(esc).join(' · ')}</p><p>Situação comercial: ${esc(o.originalStatuses.join(' / '))}. ${esc(o.sourceIssue)}</p>${o.deliveryStop?`<p><strong>Parada ${o.deliveryStop.number}</strong> · ${esc(o.deliveryStop.address)}</p>`:''}<h3>Produtos do pedido</h3>${formationProducts(grouped.products)}<details><summary>Informações completas dos itens comerciais</summary><div class="table-wrap"><table class="log-table"><thead><tr><th>Produto</th><th>Fornecedor</th><th>Departamento / seção</th><th>NF</th><th>Faturamento</th><th>Data do pedido</th><th>Situação comercial</th><th>Valor</th></tr></thead><tbody>${o.products.map(p=>`<tr><td>${esc(p.description)}</td><td>${esc(p.supplier||'—')}</td><td>${esc((p.department||'')+' / '+(p.section||''))}</td><td>${esc(p.invoice||'—')}</td><td>${transportDate(p.billingDate)}</td><td>${transportDate(p.orderDate)}</td><td>${esc(p.status)}</td><td>${p.value==null?'—':money(p.value)}</td></tr>`).join('')}</tbody></table></div></details><details><summary>Dados na base comercial</summary>${formationSourceTable(o.sourceRows)}<p class="sac-help">${o.weightSource?'Peso: '+esc(o.weightSource)+'. ':''}A base comercial não informa peso e volumes. Pesos preenchidos na montagem são identificados separadamente. Quantidades não são convertidas em kg. Notas comerciais: ${esc((o.invoices||[]).join(', ')||'Não informadas')}.</p></details>`);}
async function formationSave(payload,dialog,status,requestId) {
  if (FEXP.busy) return;
  FEXP.busy = true;
  dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
  status.textContent = 'Conferindo os pedidos e salvando a montagem…';
  let result;
  try {
    result = await formationApi({action:'save',requestId,...payload});
  } catch (error) {
    status.textContent = error.message;
    dialog.querySelectorAll('button').forEach(button=>button.disabled=false);
    FEXP.busy = false;
    return;
  }
  FEXP.selected.clear();
  FEXP.assemblySelected.clear();
  if (result.montageId) {
    FEXP.montage = result.montageId;
    FEXP.tab = 'montages';
    if (['CRIAR','ADICIONAR'].includes(payload.operation)) FEXP.montageDetail = true;
  }
  dialog.close();
  cargoOverviewInvalidate();
  const message = result.message + (result.projectionWarning?' O histórico foi salvo; a atualização das abas auxiliares ficou pendente.':'');
  try {
    if(result.view){
      formationApplyView(result.view);
      formationShow();
      formationNotice(message);
    }else{
      formationNotice(message+' Atualizando a tela…');
      if(FEXP.pending)await FEXP.pending;
      const updated=await formationReload();
      formationNotice(message+(updated?'':' Atualize a tela para exibir a montagem.'));
    }
  }finally{
    FEXP.busy=false;
  }
}

function formationOrderContext(orders) {
  return Object.fromEntries(orders.map(order=>[order.key,{version:order.version,montageId:order.montageId || ''}]));
}

function formationMoveDialog(operation,keys){const d=FEXP.data,create=operation==='CRIAR',transfer=['TRANSFERIR','REMOVER'].includes(operation),rename=operation==='RENOMEAR',targets=d.montages.filter(m=>m.status===CARGO_OPEN&&(!transfer||m.id!==FEXP.montage)),members=d.orders.filter(o=>keys.includes(o.key)),t=formationAggregate(members),current=d.montages.find(m=>m.id===FEXP.montage),titles={CRIAR:'Criar montagem',ADICIONAR:'Adicionar pedidos à montagem',TRANSFERIR:'Confirmar transferência',REMOVER:'Confirmar retirada dos pedidos',RENOMEAR:'Renomear montagem'},requestId=crypto.randomUUID().replace(/-/g,'');
 const dialog=formationDialog(titles[operation],`<form id="formationMoveForm">${create?`<label>Empresa de saída<select name="company" required>${cargoOptions(d.assemblyCompanies,'','Escolha Rebanho ou Nutriranch','code')}</select></label><p class="sac-help">O código é gerado ao salvar com a sigla da empresa, ano, mês e sequência mensal.</p>`:rename?`<label>Nome da montagem<input name="name" maxlength="100" value="${esc(current?.name||'')}" required></label>`:''}${['ADICIONAR','TRANSFERIR'].includes(operation)?`<label>Montagem de destino<select name="target" required><option value="">Selecione</option>${targets.map(m=>`<option value="${esc(m.id)}">${esc(m.name)} · ${logN(m.orders)} pedidos</option>`).join('')}</select></label>`:''}${rename?'':`<p><strong>${logN(keys.length)} pedidos</strong> · ${formationWeight(t.weight)} · ${formationN(t.volumes)} volumes</p><ul>${members.map(o=>`<li>Pedido ${esc(o.order)} · ${esc(o.client)}</li>`).join('')}</ul>`}${transfer?`<label class="formation-confirm"><input type="checkbox" name="confirm" required>Confirmo ${operation==='REMOVER'?'a retirada desses pedidos e o retorno à disponibilidade':'a transferência desses pedidos, retirando-os automaticamente da montagem anterior'}.</label>`:''}<p class="sac-help">A movimentação será registrada na planilha auxiliar da montagem.</p><p role="status" id="formationMoveStatus"></p><footer><button type="submit" class="btn primary">${create?'Criar montagem':transfer?'Confirmar operação':'Salvar'}</button></footer></form>`);
 const form=dialog.querySelector('form');form.onsubmit=e=>{e.preventDefault();formationSave({operation,keys,ordersAtConfirmation:formationOrderContext(members),company:form.elements.namedItem('company')?.value||'',name:form.elements.namedItem('name')?.value||'',target:rename?FEXP.montage:form.elements.namedItem('target')?.value||'',confirmed:transfer?form.elements.namedItem('confirm').checked:false,revision:d.revision,sourceVersion:d.sourceVersion},dialog,dialog.querySelector('#formationMoveStatus'),requestId);};}
function formationLinkDialog(){const candidates=logRows(FEXP.data.mapRows).filter(r=>r.awaitingFormation&&!r.linked),chosen=new Set(),requestId=crypto.randomUUID().replace(/-/g,'');let lookup=null,selectedOrder=null;
 const dialog=formationDialog('Identificar pedido na base auxiliar',`<p>Selecione todos os registros de formação que pertencem ao mesmo pedido comercial. Registros repetidos não podem ser vinculados automaticamente.</p><div class="formation-link-sources table-wrap"><table class="log-table"><thead><tr><th>Selecionar</th><th>Cliente</th><th>Cidade</th><th>Grupo</th><th>Volumes</th><th>Peso</th></tr></thead><tbody>${candidates.slice(0,200).map(r=>`<tr><td><input type="checkbox" data-formation-source="${esc(r.sourceKey)}" ${r.ambiguous?'disabled':''}></td><td>${esc(r.client)}</td><td>${esc(r.cityLabel)}</td><td>${esc(r.product)}</td><td>${formationN(r.volumes)}</td><td>${formationWeight(r.weight)}</td></tr>`).join('')}</tbody></table></div><p>${candidates.length>200?'Exibindo 200 registros. Refine cidade, região ou período para localizar os demais.':''}</p><form id="formationLookupForm"><label>Número exato do pedido comercial<input name="orderNumber" inputmode="numeric" pattern="[0-9]{1,20}"></label><label>Ou pesquise pelo nome do cliente<input name="clientSearch" placeholder="Se vazio, usa o nome do registro selecionado"></label><p class="sac-help">A busca por cliente sugere até 30 pedidos próximos à implantação. Confira o ano e os produtos; nenhum vínculo é automático.</p><button class="btn" type="submit">Buscar pedido e conferir</button></form><section id="formationLinkReview"></section><p role="status" id="formationLinkStatus"></p>`);
 const status=dialog.querySelector('#formationLinkStatus'),review=dialog.querySelector('#formationLinkReview');dialog.querySelectorAll('[data-formation-source]').forEach(c=>c.onchange=()=>{if(c.checked){if(chosen.size>=50){c.checked=false;status.textContent='Selecione até 50 registros para o mesmo pedido.';return;}chosen.add(c.dataset.formationSource);}else chosen.delete(c.dataset.formationSource);lookup=null;selectedOrder=null;review.innerHTML='';});
 dialog.querySelector('#formationLookupForm').onsubmit=async e=>{e.preventDefault();if(!chosen.size){status.textContent='Selecione os registros da formação.';return;}status.textContent='Consultando o pedido comercial…';try{lookup=await formationApi({action:'lookup',orderNumber:e.currentTarget.elements.namedItem('orderNumber').value,clientSearch:e.currentTarget.elements.namedItem('clientSearch').value||candidates.find(r=>chosen.has(r.sourceKey))?.client||'',sourceKeys:[...chosen]});review.innerHTML=lookup.orders.length?`<h3>Confira o pedido e o ano</h3>${lookup.orders.map(o=>`<button type="button" class="btn" data-formation-candidate="${esc(o.key)}">${esc(o.order)} · ${esc(o.year)} · ${esc(o.clientCode+' '+o.client)} · ${esc(o.city)}</button>`).join('')}<div id="formationCandidateDetail"></div>`:'<p>Nenhum pedido ativo encontrado no seu recorte. Confira o número e o cadastro.</p>';status.textContent='';review.querySelectorAll('[data-formation-candidate]').forEach(b=>b.onclick=()=>{selectedOrder=lookup.orders.find(o=>o.key===b.dataset.formationCandidate);const o=selectedOrder,totals=formationAggregate([{...o,weight:null,volumes:null}]);dialog.querySelector('#formationCandidateDetail').innerHTML=`<h3>Pedido ${esc(o.order)} · ${esc(o.client)}</h3><p>Cliente ${esc(o.clientCode)} · ${esc(o.city)} / ${esc(o.uf)} · ${transportDate(o.date)} · ${esc(o.statuses.join(', '))}</p><h4>Produtos comerciais</h4>${formationProducts(totals.products)}<h4>Registros de formação que ficarão vinculados</h4>${formationSourceTable(o.confirmedSourceRows)}<p class="formation-warning">Os nomes, cidades, grupos e quantidades podem diferir entre as fontes. Confirme a identidade e o escopo completo do pedido. Qt Pedida não equivale automaticamente a volumes ou kg.</p><label class="formation-confirm"><input type="checkbox" id="formationLinkConfirmed">Confirmo que os registros acima pertencem a este pedido e representam o escopo que deve ser reservado em conjunto.</label><button type="button" class="btn primary" id="formationConfirmLink">Salvar vínculo na base auxiliar</button>`;dialog.querySelector('#formationConfirmLink').onclick=()=>{if(!dialog.querySelector('#formationLinkConfirmed').checked){status.textContent='Confirme o vínculo após conferir as fontes.';return;}formationSave({operation:'VINCULAR',orderKey:o.key,orderVersion:o.version,sourceKeys:[...chosen],confirmed:true,revision:lookup.revision,sourceVersion:lookup.sourceVersion},dialog,status,requestId);};});}catch(err){status.textContent=err.message;}};
}
function formationMapTooltipLegacy(rows,name,uf){const a=logSum(rows,'availableWeight'),b=logSum(rows,'mountedWeight');return '<b>'+esc(name)+' · '+esc(uf)+'</b><br>Disponível: '+logN(a/1000,3)+' t<br>Em montagem: '+logN(b/1000,3)+' t<br>Aguardando saída: '+logN((a+b)/1000,3)+' t';}

function formationMapTooltip(rows,name,uf){return '<b>'+esc(name)+' · '+esc(uf)+'</b><br>'+logN(rows.filter(r=>!r.montageId).length)+' pedidos disponíveis<br>'+logN(rows.filter(r=>r.montageId).length)+' pedidos em montagem<br>Peso não informado na base comercial';}

function cargoKg(value){return value==null?'Peso não informado':logN(value,1)+' kg';}
function cargoVehicleLabel(v){return v.plate+' ('+(v.type||'TIPO NÃO INFORMADO')+')';}
function cargoOptions(list,current,label,value='name'){return '<option value="">'+label+'</option>'+list.map(x=>`<option value="${esc(x[value])}" ${x[value]===current?'selected':''}>${esc(value==='plate'?cargoVehicleLabel(x):x.name)}</option>`).join('');}
function formationTable(rows, selection, assembly = false) {
  const start = assembly ? 0 : FEXP.page * 30;
  const part = assembly ? rows : rows.slice(start, start + 30);
  const locked = assembly && FEXP.data.montages.find(m => m.id === FEXP.montage)?.status !== CARGO_OPEN;
  return `<div class="cargo-list-toolbar"><span>${logN(rows.length)} ${rows.length===1?'pedido':'pedidos'}</span>
    ${locked?'':'<label><input type="checkbox" id="formationSelectPage"> Selecionar esta página</label>'}</div>
    <div class="cargo-order-list">${part.map(o => cargoOrderCard(o, selection.has(o.key), locked || !assembly && (o.blocked || o.montageId))).join('')
      || '<div class="cargo-empty">Nenhum pedido neste recorte.</div>'}</div>
    ${assembly?'':`<div class="cargo-pagination"><button class="btn" id="formationPrev" ${FEXP.page===0?'disabled':''}>Anterior</button>
      <span>${rows.length?start+1:0}–${Math.min(start+30,rows.length)} de ${rows.length}</span>
      <button class="btn" id="formationNext" ${start+30>=rows.length?'disabled':''}>Próxima</button></div>`}`;
}

function cargoOrderCard(order, selected, disabled) {
  const products = formationAggregate([order]).products;
  const location = [order.city, order.uf].filter(Boolean).join(' / ') || 'Cidade não informada';
  const itemCount = products.length === 1 ? '1 produto' : logN(products.length) + ' produtos';
  return `<article class="cargo-order ${selected?'is-selected':''}">
    <label class="cargo-order-check"><input type="checkbox" data-formation-select="${esc(order.key)}"
      aria-label="Selecionar pedido ${esc(order.order)}" ${selected?'checked':''} ${disabled?'disabled':''}></label>
    <div class="cargo-order-body">
      <div class="cargo-order-top"><strong>Pedido ${esc(order.order)}</strong>
        ${order.internalStatus==='Disponível'?'':`<span class="cargo-status ${order.montageId?'reserved':''}">${esc(order.internalStatus)}</span>`}</div>
      <h4>${esc(order.client)}</h4><p>${esc(location)}${order.deliveryStop?' · Parada '+esc(order.deliveryStop.number):''}</p>
      ${order.sourceIssue?`<p class="cargo-alert">${esc(order.sourceIssue)}</p>`:''}
      ${order.weightNote?`<p class="cargo-alert">${esc(order.weightNote)}</p>`:''}
      <div class="cargo-order-bottom">
        <details class="cargo-order-products" name="cargo-order-products">
          <summary>${itemCount}</summary>
          <div class="cargo-order-preview">
            <ul class="cargo-order-product-list" aria-label="Produtos e quantidades">${products.map(product =>
              `<li><span>${esc(product.description)}</span><strong>${product.quantity==null?'—':logN(product.quantity,2)}</strong></li>`).join('')
              || '<li>Nenhum produto informado.</li>'}</ul>
            <button type="button" class="cargo-link" data-formation-detail="${esc(order.key)}">Detalhes do pedido</button>
          </div>
        </details>
        <span>${order.weight==null?'Sem peso':cargoKg(order.weight)}</span>
      </div>
    </div></article>`;
}

function cargoBindOrderPreviews(root = document) {
  root.querySelectorAll('article.cargo-order').forEach(card => {
    const details = card.querySelector('.cargo-order-products');
    if (!details) return;
    const preview = details.querySelector('.cargo-order-preview');
    let hovered = false;
    let pinned = false;

    function position() {
      if (!details.open || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      card.classList.toggle('preview-above', window.innerHeight - card.getBoundingClientRect().bottom < preview.offsetHeight + 12
        && card.getBoundingClientRect().top > window.innerHeight - card.getBoundingClientRect().bottom);
    }

    card.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      hovered = true;
      details.open = true;
      position();
    });
    card.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'mouse') return;
      hovered = false;
      if (!pinned && !preview.contains(document.activeElement)) details.open = false;
    });
    details.querySelector('summary').addEventListener('click', event => {
      if (!hovered || event.detail === 0 || event.pointerType && event.pointerType !== 'mouse') return;
      event.preventDefault();
      pinned = !pinned;
      details.open = pinned;
      position();
    });
    details.addEventListener('toggle', () => {
      if (!details.open) pinned = false;
      position();
    });
    details.addEventListener('focusout', event => {
      if (!hovered && !details.contains(event.relatedTarget)) details.open = false;
    });
    card.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !details.open) return;
      if (preview.contains(document.activeElement)) details.querySelector('summary').focus();
      details.open = false;
    });
  });
}

function formationSummary(orders){const t=formationAggregate(orders);return `<aside class="panel cargo-selection"><div><small>SELEÇÃO ATUAL</small><h3>${t.count} pedidos selecionados</h3><p>${t.clients} clientes · ${t.weight==null?'Peso pendente':cargoKg(t.weight)}</p></div><div class="cargo-actions"><button class="btn primary" id="formationCreate" ${t.count?'':'disabled'}>Criar montagem</button><button class="btn" id="formationAdd" ${t.count&&FEXP.data.montages.some(m=>m.status!=='Finalizada')?'':'disabled'}>Adicionar à montagem</button><button class="cargo-link" id="formationClear" ${t.count?'':'disabled'}>Limpar seleção</button></div></aside>`;}
function cargoForm(title,content,build){const dialog=formationDialog(title,`<form class="cargo-form">${content}<p role="status" class="cargo-form-status"></p><footer><button class="btn primary" type="submit">Salvar</button></footer></form>`),form=dialog.querySelector('form');form.onsubmit=e=>{e.preventDefault();try{cargoSave(build(form),dialog,dialog.querySelector('[role=status]'));}catch(err){dialog.querySelector('[role=status]').textContent=err.message;}};return dialog;}
function cargoWeightsDialog(){const m=FEXP.data.montages.find(m=>m.id===FEXP.montage),members=FEXP.data.orders.filter(o=>o.montageId===m.id);cargoForm('Pesos dos pedidos · '+m.name,`<p class="cargo-help">Informe o peso real total de cada pedido em kg. O valor ficará identificado como informado na montagem.</p>${members.map(o=>`<label class="cargo-weight-input"><span><strong>Pedido ${esc(o.order)}</strong><small>${esc(o.client)}</small></span><input data-weight-key="${esc(o.key)}" type="number" min="0.001" max="100000" step="0.001" value="${o.weight==null?'':o.weight}" placeholder="kg"></label>`).join('')}`,f=>{const weights={};for(const input of f.querySelectorAll('[data-weight-key]'))if(input.value!=='')weights[input.dataset.weightKey]=Number(input.value);if(!Object.keys(weights).length)throw new Error('Informe pelo menos um peso.');return {operation:'PESOS_PEDIDOS',target:m.id,weights,orderVersions:Object.fromEntries(members.filter(o=>Object.prototype.hasOwnProperty.call(weights,o.key)).map(o=>[o.key,o.version]))};});}

function cargoSwitchFormationTab(tab) {
  FEXP.tab = tab;
  if (tab==='montages') FEXP.montageDetail = false;
  if(tab==='routing'||tab==='finished')FEXP.routeExpanded='';
  FEXP.page = 0;
  formationShow();
}

const CARGO_SETTINGS = {data:null, pending:null, section:'vehicles'};

function cargoSettingsOpen(section = 'vehicles') {
  if(!logPageAllowed('settings'))return;
  CARGO_SETTINGS.section = section;
  LOG.page = 'settings';
  cargoSettingsShow();
}

async function cargoSettingsLoad() {
  if (CARGO_SETTINGS.pending) return CARGO_SETTINGS.pending;
  const task = (async () => {
    try {
      CARGO_SETTINGS.data = await formationApi({action:'settingsRead'});
      if (state.module === 'logistics' && LOG.page === 'settings') cargoSettingsShow();
    } catch (error) {
      if (state.module !== 'logistics' || LOG.page !== 'settings') return;
      $('#content').innerHTML = `<section class="panel"><h2>Configurações indisponíveis</h2><p>${esc(error.message)}</p>
        <button class="btn" id="cargoSettingsRetry">Tentar novamente</button></section>`;
      $('#cargoSettingsRetry').onclick = cargoSettingsLoad;
    } finally {
      CARGO_SETTINGS.pending = null;
    }
  })();
  CARGO_SETTINGS.pending = task;
  return task;
}

function cargoSettingsShow() {
  if (state.module !== 'logistics' || LOG.page !== 'settings') return;
  ++LOG.epoch;
  destroyCharts();
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  $('#refreshData').hidden = true;
  $('#logFilters')?.classList.add('hidden');
  $('.filterbar:not(#logFilters)')?.classList.add('hidden');
  $('#dataStatus').classList.add('hidden');
  $('#content').className = 'visual-page logistics-content formation-workspace-v2';
  $('#pageTitle').textContent = 'Configurações da Logística';
  $('#pageSubtitle').textContent = 'Frota, motoristas, unidades de saída e padrões do roteiro';
  $('#activeMenuLabel').textContent = 'Logística · Configurações';
  $('#periodChip').textContent = 'Cadastros';
  $('#lastBaseUpdate').textContent = '';
  logNav();

  const d = CARGO_SETTINGS.data;
  if (!d) {
    $('#content').innerHTML = '<section class="panel cargo-empty">Carregando configurações…</section>';
    cargoSettingsLoad();
    return;
  }
  const tabs = [['vehicles','Veículos'],['drivers','Motoristas'],['units','Unidades de saída'],['routing','Roteirização']];
  const nav = `<nav class="cargo-tabs" aria-label="Configurações da Logística">${tabs.map(([key,label]) =>
    `<button type="button" data-cargo-setting="${key}" class="${CARGO_SETTINGS.section===key?'active':''}">${label}</button>`
  ).join('')}</nav>`;
  const page = {
    vehicles:() => cargoSettingsVehicles(d.fleet.vehicles),
    drivers:() => cargoSettingsDrivers(d.fleet.drivers),
    units:() => cargoSettingsUnits(d.routing),
    routing:() => cargoSettingsRouting(d)
  };
  $('#content').innerHTML = `<div class="cargo-workspace-top">${nav}
    <button type="button" class="btn" id="cargoSettingsRefresh">Atualizar</button></div>${page[CARGO_SETTINGS.section]()}`;
  $$('[data-cargo-setting]').forEach(b => b.onclick = () => {
    CARGO_SETTINGS.section = b.dataset.cargoSetting;
    cargoSettingsShow();
  });
  $('#cargoSettingsRefresh').onclick = cargoSettingsLoad;
  if(!canLog('formation','edit')){
    $$('#content :is(#cargoNewVehicle,#cargoNewDriver,#cargoNewUnit,[data-edit-vehicle],[data-edit-driver],[data-edit-unit],[data-status-vehicle],[data-status-driver],#cargoEditPreferences)').forEach(el=>el.remove());
  }
  $('#cargoNewVehicle')?.addEventListener('click', () => cargoVehicleDialog());
  $('#cargoNewDriver')?.addEventListener('click', () => cargoDriverDialog());
  $('#cargoNewUnit')?.addEventListener('click', () => cargoUnitDialog());
  $$('[data-edit-vehicle]').forEach(b => b.onclick = () => cargoVehicleDialog(b.dataset.editVehicle));
  $$('[data-edit-driver]').forEach(b => b.onclick = () => cargoDriverDialog(b.dataset.editDriver));
  $$('[data-edit-unit]').forEach(b => b.onclick = () => cargoUnitDialog(b.dataset.editUnit));
  $$('[data-status-vehicle]').forEach(b => b.onclick = () => {
    const v = d.fleet.vehicles.find(x => x.plate === b.dataset.statusVehicle);
    cargoFleetStatusDialog(cargoVehicleLabel(v), v.active === false, {operation:'VEICULO_SALVAR', previousPlate:v.plate});
  });
  $$('[data-status-driver]').forEach(b => b.onclick = () => {
    const x = d.fleet.drivers.find(item => item.name === b.dataset.statusDriver);
    cargoFleetStatusDialog(x.name, x.active === false, {operation:'MOTORISTA_SALVAR', previousName:x.name});
  });
  $('#cargoEditPreferences')?.addEventListener('click', cargoPreferencesDialog);
}

function cargoSettingsVehicles(vehicles) {
  return `<section class="panel"><div class="cargo-section-heading"><div><h2>Veículos</h2>
    <p>Gerencie placas, tipo de veículo, capacidade e motorista padrão.</p></div>
    <button class="btn primary" id="cargoNewVehicle">Cadastrar veículo</button></div>
    <div class="cargo-fleet-grid">${vehicles.map(v => `<article class="cargo-vehicle">
      <div><h3>${esc(cargoVehicleLabel(v))}</h3><span class="cargo-status ${v.active===false?'inactive':'finished'}">
        ${v.active===false?'Inativo':'Ativo'}</span></div>
      <p>${v.capacityKg ? cargoKg(v.capacityKg)+' de capacidade' : 'Capacidade a cadastrar'}</p>
      <p>Motorista padrão: ${esc(v.defaultDriver || 'Não definido')}</p>
      <p>${esc(v.source || 'Cadastro')}</p>
      ${v.needsReview ? '<p class="cargo-alert">Confira a placa cadastrada no histórico.</p>' : ''}
      <div class="cargo-actions"><button class="btn" data-edit-vehicle="${esc(v.plate)}">Editar</button>
      <button class="btn" data-status-vehicle="${esc(v.plate)}">${v.active===false?'Reativar':'Inativar'}</button></div>
      </article>`).join('') || '<p>Nenhum veículo cadastrado.</p>'}</div></section>`;
}

function cargoSettingsDrivers(drivers) {
  return `<section class="panel"><div class="cargo-section-heading"><div><h2>Motoristas</h2>
    <p>Gerencie a lista usada nas montagens de carga.</p></div>
    <button class="btn primary" id="cargoNewDriver">Cadastrar motorista</button></div>
    <div class="cargo-fleet-grid">${drivers.map(d => `<article class="cargo-vehicle">
      <div><h3>${esc(d.name)}</h3><span class="cargo-status ${d.active===false?'inactive':'finished'}">
        ${d.active===false?'Inativo':'Ativo'}</span></div>
      <div class="cargo-actions"><button class="btn" data-edit-driver="${esc(d.name)}">Editar</button>
      <button class="btn" data-status-driver="${esc(d.name)}">${d.active===false?'Reativar':'Inativar'}</button></div>
      </article>`).join('') || '<p>Nenhum motorista cadastrado.</p>'}</div></section>`;
}

function cargoSettingsUnits(routing) {
  return `<section class="panel"><div class="cargo-section-heading"><div><h2>Unidades de saída</h2>
    <p>Cadastre o endereço completo dos depósitos usados como ponto de partida.</p></div>
    <button class="btn primary" id="cargoNewUnit">Cadastrar unidade</button></div>
    <div class="cargo-fleet-grid">${routing.units.map(u => `<article class="cargo-vehicle">
      <div><h3>${esc(u.name)}</h3>${routing.defaultUnitId===u.id?'<span class="cargo-status finished">Padrão</span>':''}</div>
      <p>${esc(cargoCompanyName(u.company)||'Empresa a definir')} · ${esc(u.address)}</p><button class="btn" data-edit-unit="${esc(u.id)}">Editar</button>
    </article>`).join('') || '<p>Nenhuma unidade cadastrada.</p>'}</div></section>`;
}

function cargoSettingsRouting(d) {
  const r = d.routing;
  return `<section class="panel"><div class="cargo-section-heading"><div><h2>Padrões do roteiro</h2>
    <p>Essas opções são sugeridas ao abrir um roteiro novo.</p></div>
    <button class="btn primary" id="cargoEditPreferences">Editar padrões</button></div>
    <p><strong>Unidade de saída padrão</strong> · ${esc(r.units.find(u => u.id===r.defaultUnitId)?.name || 'Escolher a cada roteiro')}</p>
    <p><strong>Sugerir retorno à unidade</strong> · ${r.returnToUnit?'Sim':'Não'}</p>
    <p><strong>Agrupar endereços iguais</strong> · ${r.groupAddresses?'Sim':'Não'}</p>
    <p><strong>Google Maps na Central</strong> · ${d.googleMapsConfigured?'Chave configurada':'Aguardando ativação'}</p>
    </section>`;
}

function cargoFleetStatusDialog(label, active, payload) {
  const action = active ? 'Reativar' : 'Inativar';
  const dialog = cargoForm(action, `<p><strong>${esc(label)}</strong></p>
    <p>${active ? 'Voltará à seleção de novas montagens.' : 'Sairá da seleção de novas montagens e ficará no histórico.'}</p>`,
    () => ({...payload,active}));
  dialog.querySelector('button[type=submit]').textContent = action;
}

function cargoVehicleDialog(plate = '') {
  const f = CARGO_SETTINGS.data.fleet;
  const v = f.vehicles.find(x => x.plate === plate) || {};
  const drivers = f.drivers.filter(x => x.active!==false || x.name===v.defaultDriver);
  cargoForm(plate?'Editar veículo':'Cadastrar veículo', `
    <label>Placa<input name="plate" maxlength="8" value="${esc(v.plate || '')}" placeholder="ABC1D23" required></label>
    <label>Tipo de veículo<input name="type" list="cargoTypes" value="${esc(v.type || '')}" maxlength="60" required></label>
    <datalist id="cargoTypes"><option>BAÚ</option><option>BITRUCK</option><option>TRUCK</option><option>HILUX</option></datalist>
    <label>Capacidade de carga (kg)<input name="capacity" type="number" min="0.01" max="100000" step="0.01"
      value="${v.capacityKg || ''}" placeholder="Informe a capacidade real"></label>
    <label>Motorista padrão<select name="driver">${cargoOptions(drivers,v.defaultDriver,'Sem motorista padrão')}</select></label>`,
    f => ({operation:'VEICULO_SALVAR', previousPlate:plate, vehicle:{plate:f.elements.plate.value,
      type:f.elements.type.value, capacityKg:f.elements.capacity.value, defaultDriver:f.elements.driver.value}}));
}

function cargoDriverDialog(name = '') {
  cargoForm(name?'Editar motorista':'Cadastrar motorista',
    `<label>Nome do motorista<input name="driverName" value="${esc(name)}" required maxlength="100"></label>`,
    f => ({operation:'MOTORISTA_SALVAR',previousName:name,driver:{name:f.elements.driverName.value}}));
}

function cargoCompanies() {
  return FEXP.data?.assemblyCompanies || [{code:'REB',name:'Rebanho'},{code:'NUT',name:'Nutriranch'}];
}

function cargoCompanyName(code) {
  return cargoCompanies().find(company => company.code === code)?.name || '';
}

function cargoRouteUnits(m) {
  return FEXP.data.routing.units.filter(unit => !m.company || unit.company === m.company);
}

function cargoUnitDialog(id = '') {
  const u = CARGO_SETTINGS.data.routing.units.find(x => x.id===id) || {};
  cargoForm(id?'Editar unidade':'Cadastrar unidade', `
    <label>Empresa da unidade<select name="company" required>${cargoOptions(cargoCompanies(),u.company,'Escolha a empresa','code')}</select></label>
    <label>Nome da unidade<input name="unitName" value="${esc(u.name || '')}" required maxlength="100"></label>
    <label>Endereço completo<textarea name="address" required maxlength="240" rows="3"
      placeholder="Rua, número, município e UF">${esc(u.address || '')}</textarea></label>`,
    f => ({operation:'UNIDADE_SALVAR',unit:{id,company:f.elements.company.value,name:f.elements.unitName.value,address:f.elements.address.value}}));
}

function cargoPreferencesDialog() {
  const r = CARGO_SETTINGS.data.routing;
  cargoForm('Padrões do roteiro', `
    <label>Unidade padrão<select name="unit">${cargoOptions(r.units,r.defaultUnitId,'Escolher a cada roteiro','id')}</select></label>
    <label class="cargo-confirm"><input name="returnToUnit" type="checkbox" ${r.returnToUnit?'checked':''}>Sugerir retorno à unidade</label>
    <label class="cargo-confirm"><input name="groupAddresses" type="checkbox" ${r.groupAddresses?'checked':''}>Agrupar pedidos com endereço igual</label>`,
    f => ({operation:'ROTEIRIZACAO_CONFIGURAR',preferences:{defaultUnitId:f.elements.unit.value,
      returnToUnit:f.elements.returnToUnit.checked,groupAddresses:f.elements.groupAddresses.checked}}));
}

const CARGO_OPEN='Em aberto', CARGO_PENDING='Aguardando roteirização', CARGO_FINAL='Finalizada';

function cargoIncidentLines(m) {
  return (m.overweightOccurrences||[]).map(o=>[
    cargoDate(o.at),o.by,
    o.knownWeightKg==null?'':'Peso '+cargoKg(o.knownWeightKg),
    o.capacityKg==null?'':'Limite '+cargoKg(o.capacityKg),
    o.excessKg==null?'':'Excedente '+cargoKg(o.excessKg),
    o.reason?'Justificativa: '+o.reason:''
  ].filter(Boolean).join(' · '));
}

function cargoStatus(m) {
  const tone=m.status===CARGO_FINAL?'green':m.status===CARGO_PENDING?'orange':'yellow';
  const lines=cargoIncidentLines(m);
  return `<span class="cargo-state-line"><span class="cargo-state"><i class="cargo-state-dot ${tone}" aria-hidden="true"></i>${esc(m.status)}</span>${
    lines.length?`<details class="cargo-incident"><summary title="${esc('Excesso de peso · '+lines.at(-1))}" aria-label="Consultar ocorrência de excesso de peso"><i class="cargo-state-dot red" aria-hidden="true"></i></summary>
      <div class="cargo-incident-info"><strong>Excesso de peso registrado</strong><ul>${lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></div></details>`:''
  }</span>`;
}

const CARGO_ROUTE = {draft:null, map:null, mapBox:null, markers:[], polylines:[], generation:0, timer:null, loader:null};

function cargoRouteOpen(id) {
  const m=FEXP.data.montages.find(item=>item.id===id);
  if(!m||m.status===CARGO_OPEN)return;
  FEXP.montage=id;
  FEXP.tab=m.status===CARGO_FINAL?'finished':'routing';
  FEXP.routeExpanded=id;
  formationShow();
}

function cargoRouteDraft(m) {
  if (CARGO_ROUTE.draft?.id === m.id && CARGO_ROUTE.draft.routingAt === m.routingAt) return CARGO_ROUTE.draft;
  const settings = FEXP.data.routing;
  const saved = m.route;
  const units = cargoRouteUnits(m);
  const suggested = units.find(unit => unit.id === settings.defaultUnitId) || (m.company && units.length === 1 ? units[0] : null);
  const orders = FEXP.data.orders.filter(o => o.montageId === m.id);
  orders.sort((a,b) => (a.city || '').localeCompare(b.city || '', 'pt-BR') || a.order.localeCompare(b.order,'pt-BR',{numeric:true}));
  const initial = orders.map(o => ({keys:[o.key], address:o.deliveryStop?.address || ''}));
  CARGO_ROUTE.draft = {
    id:m.id,
    routingAt:m.routingAt,
    unitSnapshot:saved?.unit||suggested||null,
    readOnly:m.status===CARGO_FINAL||!canLog('formation','edit'),
    baseAt:saved?.at || '',
    unitId:saved ? saved.unit?.id || '' : suggested?.id || '',
    returnToUnit:saved?.returnToUnit ?? settings.returnToUnit,
    groupAddresses:saved?.groupAddresses ?? settings.groupAddresses,
    stops:saved ? structuredClone(saved.stops) : initial,
    dirty:false
  };
  return CARGO_ROUTE.draft;
}

function cargoRouteGroups(stops, groupAddresses) {
  const grouped = new Map();
  const result = [];
  for (const stop of stops) {
    const address = stop.address.trim();
    const key = groupAddresses && address ? normalize(address).replace(/\s+/g,' ') : '';
    if (key && grouped.has(key)) {
      grouped.get(key).keys.push(...stop.keys);
      continue;
    }
    const next = {keys:stop.keys.slice(), address};
    result.push(next);
    if (key) grouped.set(key,next);
  }
  return result;
}

function cargoRouteState(m,draft) {
  if (m.route?.confirmed) return {label:'Ordem confirmada',tone:'confirmed'};
  if (draft?.dirty) return {label:'Alterações não salvas',tone:'pending'};
  if (m.route) return {label:'Rascunho salvo',tone:'draft'};
  return {label:'Roteiro pendente',tone:'pending'};
}

function cargoRouteMissing(stops) {
  return stops.filter(stop => !String(stop.address||'').trim()).length;
}

function cargoRouteMissingLabel(count) {
  if (count === 0) return 'Endereços preenchidos';
  return `${count} ${count===1?'parada sem endereço':'paradas sem endereço'}`;
}

function cargoRouteBadge(m,draft) {
  const state = cargoRouteState(m,draft);
  return `<span class="cargo-route-badge ${state.tone}">${state.label}</span>`;
}

function cargoRouteUpdateReadiness(m,draft) {
  const status = $('#cargoRouteState'), summary = $('#cargoRouteAddressSummary');
  if (status) status.innerHTML = cargoRouteBadge(m,draft);
  if (!summary) return;
  const missing = cargoRouteMissing(draft.stops);
  summary.textContent = draft.stops.length ? cargoRouteMissingLabel(missing) : 'Sem paradas';
  summary.classList.toggle('is-pending',missing>0);
  const jump = $('#cargoRouteFirstMissing');
  if (jump) jump.hidden = missing===0;
}

function cargoRouteMarkup(m) {
  const draft = cargoRouteDraft(m);
  const units = cargoRouteUnits(m);
  const readOnly=draft.readOnly;
  return `<section class="panel cargo-route-panel">
    <header class="cargo-detail-header"><div>${cargoStatus(m)}
    <h3>Roteiro · ${esc(m.name)}</h3><p>${m.orders} pedidos · ${esc(m.vehicle?cargoVehicleLabel(m.vehicle):'Veículo pendente')} · ${esc(m.driver)}</p>
    <div class="cargo-route-state"><span id="cargoRouteState" aria-live="polite">${cargoRouteBadge(m,draft)}</span>
      ${m.route?.at?`<small>Último salvamento · ${cargoDate(m.route.at)}</small>`:''}</div></div>
    <button class="btn" id="cargoRouteBack">Recolher roteiro</button></header>
    ${readOnly?`<div class="cargo-route-settings"><p>Saída <strong>${esc(draft.unitSnapshot?.name||'—')}</strong> · ${esc(draft.unitSnapshot?.address||'')}</p>
      <p>${draft.returnToUnit?'Retorno à unidade previsto':'Trajeto termina na última parada'}</p></div>`:`<div class="cargo-route-settings">
      <label>Unidade de saída${m.company?' · '+esc(cargoCompanyName(m.company)):''}<select id="cargoRouteUnit">${cargoOptions(units,draft.unitId,'Escolha a unidade','id')}</select></label>
      <label class="cargo-confirm"><input id="cargoRouteReturn" type="checkbox" ${draft.returnToUnit?'checked':''}>Retornar à unidade</label>
      <label class="cargo-confirm"><input id="cargoRouteGroup" type="checkbox" ${draft.groupAddresses?'checked':''}>Agrupar endereços iguais</label>
      ${units.length||!logPageAllowed('settings')?'':'<button class="cargo-link" id="cargoRouteNewUnit">Cadastrar unidade de saída</button>'}
    </div>`}
    <div class="cargo-route-layout"><div>
      <div class="cargo-section-heading"><div><h3>Paradas</h3>
      <p>${readOnly?(m.route?.confirmed?'Sequência confirmada.':'Consulta da sequência atual.'):'Informe o endereço completo ou as coordenadas. Arraste pelo ícone ou use as setas para ordenar.'}</p></div></div>
      <div class="cargo-route-readiness">
        <strong id="cargoRouteAddressSummary" aria-live="polite"></strong>
        ${readOnly?'':'<button type="button" class="cargo-link" id="cargoRouteFirstMissing" hidden>Ir para o primeiro endereço pendente</button>'}
      </div>
      <ol id="cargoRouteStops" class="cargo-route-stops"></ol>
    </div><div class="cargo-route-map-column"><h3>Google Maps</h3>
      <p id="cargoRouteMapStatus" role="status"></p><div id="cargoRouteMap" hidden aria-label="Mapa do roteiro"></div>
      <div id="cargoRouteLinks" class="cargo-actions"></div>
    </div></div>
    ${readOnly?'':`<footer class="cargo-finalize"><div><strong>Concluir roteirização</strong><p>A ordem confirmada fica nos pedidos e a carga passa para Finalizadas.</p></div>
      <div class="cargo-actions">${m.route?.confirmed?'':'<button class="btn" id="cargoRouteDraft">Salvar rascunho</button>'}
      <button class="btn primary" id="cargoRouteConfirm">Confirmar roteiro</button></div>
    </footer><p id="cargoRouteSaveStatus" role="status"></p>`}</section>`;
}

function cargoRouteRenderStops(m, draft) {
  const orders = new Map(FEXP.data.orders.map(o => [o.key,o]));
  const list = $('#cargoRouteStops');
  list.innerHTML = draft.stops.map((stop, index) => {
    const members = stop.keys.map(k => orders.get(k)).filter(Boolean);
    const labels = [...new Set(members.map(o => o.client))];
    const cities = [...new Set(members.map(o => [o.city,o.uf].filter(Boolean).join(' / ')))].filter(Boolean);
    const missing = !String(stop.address||'').trim();
    return `<li data-route-index="${index}" class="cargo-stop ${missing?'is-address-pending':''}">
      <header><span class="cargo-stop-number">${index+1}</span><div><strong>${esc(labels.join(' · '))}</strong>
      <small>${esc(cities.join(' · '))}</small>
      <small class="cargo-route-missing-label" ${missing?'':'hidden'}>Endereço pendente</small>
      <div class="cargo-stop-orders">${members.map(o=>`<button type="button" class="cargo-link" data-formation-detail="${esc(o.key)}">Pedido ${esc(o.order)}</button>`).join(' ')}</div></div>
      ${draft.readOnly?'':'<span class="cargo-stop-grip" data-route-grip title="Arrastar parada" aria-hidden="true">⠿</span>'}</header>
      ${draft.readOnly?`<p>${esc(stop.address)}</p>`:`<label>Endereço da parada ${index+1}<textarea data-route-address="${index}" rows="2" maxlength="240"
        placeholder="Rua, número, cidade e UF ou coordenadas">${esc(stop.address)}</textarea></label>
      <div class="cargo-actions"><button type="button" class="btn" data-route-step="${index},-1" aria-label="Subir parada ${index+1}" ${index===0?'disabled':''}>↑ Subir</button>
      <button type="button" class="btn" data-route-step="${index},1" aria-label="Descer parada ${index+1}" ${index===draft.stops.length-1?'disabled':''}>↓ Descer</button></div>`}
      </li>`;
  }).join('');
  list.querySelectorAll('[data-formation-detail]').forEach(b=>b.onclick=()=>formationDetail(b.dataset.formationDetail));
  cargoRouteUpdateReadiness(m,draft);
  if(draft.readOnly)return;
  const move = (from,to) => {
    if (to<0 || to>=draft.stops.length || from===to) return;
    const [stop] = draft.stops.splice(from,1);
    draft.stops.splice(to,0,stop);
    draft.dirty = true;
    cargoRouteRenderStops(m,draft);
    cargoRoutePreview(draft);
  };
  list.querySelectorAll('[data-route-step]').forEach(b => b.onclick = () => {
    const [i, delta] = b.dataset.routeStep.split(',').map(Number);
    move(i,i+delta);
  });
  list.querySelectorAll('[data-route-address]').forEach(input => {
    input.oninput = () => {
      draft.stops[Number(input.dataset.routeAddress)].address = input.value;
      draft.dirty = true;
      const pending = !input.value.trim(), item = input.closest('li');
      item.classList.toggle('is-address-pending',pending);
      item.querySelector('.cargo-route-missing-label').hidden = !pending;
      cargoRouteUpdateReadiness(m,draft);
    };
    input.onchange = () => cargoRoutePreview(draft);
  });
  list.querySelectorAll('[data-route-grip]').forEach(grip => {
    grip.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const from = Number(grip.closest('li').dataset.routeIndex);
      let to = from;
      grip.onpointermove = e => {
        const over = document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-route-index]');
        list.querySelector('.drop-target')?.classList.remove('drop-target');
        if (over && list.contains(over)) {
          to = Number(over.dataset.routeIndex);
          over.classList.add('drop-target');
        } else to = from;
      };
      const stop = () => {
        grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
        list.querySelector('.drop-target')?.classList.remove('drop-target');
      };
      grip.onpointerup = () => {stop();move(from,to);};
      grip.onpointercancel = stop;
    };
  });
}

function cargoRouteBind(m) {
  const d = cargoRouteDraft(m);
  $('#cargoRouteBack').onclick = () => {FEXP.routeExpanded='';formationShow();};
  if(d.readOnly){
    cargoRouteRenderStops(m,d);
    cargoRoutePreview(d);
    return;
  }
  $('#cargoRouteNewUnit')?.addEventListener('click', () => cargoSettingsOpen('units'));
  $('#cargoRouteFirstMissing').onclick = () => $('#cargoRouteStops .is-address-pending [data-route-address]')?.focus();
  $('#cargoRouteUnit').onchange = e => {d.unitId=e.target.value;d.dirty=true;cargoRouteUpdateReadiness(m,d);cargoRoutePreview(d);};
  $('#cargoRouteReturn').onchange = e => {d.returnToUnit=e.target.checked;d.dirty=true;cargoRouteUpdateReadiness(m,d);cargoRoutePreview(d);};
  $('#cargoRouteGroup').onchange = e => {
    d.groupAddresses = e.target.checked;
    d.stops = d.groupAddresses ? cargoRouteGroups(d.stops,true) : d.stops.flatMap(s=>s.keys.map(key=>({keys:[key],address:s.address})));
    d.dirty = true;
    cargoRouteRenderStops(m,d);
    cargoRoutePreview(d);
  };
  $('#cargoRouteDraft')?.addEventListener('click', () => cargoRouteConfirm(m,d,false));
  $('#cargoRouteConfirm').onclick = () => cargoRouteConfirm(m,d,true);
  cargoRouteRenderStops(m,d);
  cargoRoutePreview(d);
}

function cargoRouteConfirm(m,draft,confirmed) {
  const stops = cargoRouteGroups(draft.stops,draft.groupAddresses);
  const status = $('#cargoRouteSaveStatus');
  if (confirmed && (!draft.unitId || stops.some(s => !s.address))) {
    status.textContent = 'Escolha a unidade de saída e preencha os endereços de todas as paradas.';
    return;
  }
  status.textContent = '';
  const dialog = cargoForm(confirmed?'Confirmar roteiro':'Salvar rascunho',
    `${cargoStatus(m)}<p><strong>${esc(m.name)}</strong> · ${stops.length} paradas · ${m.orders} pedidos</p>
    <p>${confirmed?'A ordem abaixo será gravada nos pedidos.':'Você poderá continuar editando os endereços e a sequência.'}</p>
    <ol>${stops.map(s=>`<li>${esc(s.address || 'Endereço a preencher')} · ${s.keys.length} pedido(s)</li>`).join('')}</ol>
    ${confirmed&&m.overCapacity?`<p>A carga excede a capacidade do veículo. A ocorrência ficará no histórico.</p>
      <label>Justificativa da liberação (opcional)<textarea name="overweightReason" maxlength="500" rows="3"></textarea></label>`:''}`,
    form => ({operation:'ROTEIRO_SALVAR',target:m.id,route:{unitId:draft.unitId,returnToUnit:draft.returnToUnit,
      groupAddresses:draft.groupAddresses,stops,confirmed,baseAt:draft.baseAt,routingAt:draft.routingAt,
      overweightReason:form.elements.overweightReason?.value || ''}}));
  dialog.querySelector('button[type=submit]').textContent = confirmed?'Confirmar roteiro':'Salvar rascunho';
}

function cargoRoutePoints(draft) {
  const unit = draft.readOnly ? draft.unitSnapshot : FEXP.data.routing.units.find(u => u.id===draft.unitId);
  const stops = cargoRouteGroups(draft.stops,draft.groupAddresses);
  if (!unit || !stops.length || stops.some(s=>!s.address)) return null;
  const points = [{address:unit.address,label:'Saída'},...stops.map((s,i)=>({address:s.address,label:String(i+1)}))];
  if (draft.returnToUnit) points.push({address:unit.address,label:'Retorno'});
  return points;
}

function cargoRouteSegments(points, legsPerSegment) {
  const segments = [];
  for (let i=0;i<points.length-1;i+=legsPerSegment) segments.push(points.slice(i,i+legsPerSegment+1));
  return segments;
}

function cargoRouteLink(segment) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api','1');
  url.searchParams.set('travelmode','driving');
  url.searchParams.set('origin',segment[0].address);
  url.searchParams.set('destination',segment.at(-1).address);
  if (segment.length>2) url.searchParams.set('waypoints',segment.slice(1,-1).map(p=>p.address).join('|'));
  return url.href;
}

function cargoRoutePreview(draft) {
  const message = $('#cargoRouteMapStatus'), box = $('#cargoRouteMap'), links = $('#cargoRouteLinks');
  if (!box) return;
  const sequence = ++CARGO_ROUTE.generation;
  clearTimeout(CARGO_ROUTE.timer);
  const points = cargoRoutePoints(draft);
  const segments = points ? cargoRouteSegments(points,4) : [];
  links.innerHTML = segments.map((segment,i)=>`<a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(cargoRouteLink(segment))}">
    ${segments.length>1?'Abrir trecho '+(i+1):'Abrir no Google Maps'} ↗</a>`).join('');
  const key = FEXP.data.googleMapsKey;
  if (!key) {
    box.hidden = true;
    message.textContent = 'Mapa na Central aguardando ativação. O roteiro pode ser salvo e aberto no Google Maps.';
    return;
  }
  if (!points) {
    box.hidden = true;
    message.textContent = 'Informe a unidade de saída e os endereços para desenhar a rota.';
    return;
  }
  box.hidden = false;
  message.textContent = 'Calculando trajeto…';
  CARGO_ROUTE.timer = setTimeout(() => cargoRouteDraw(points,key,box,message,sequence),500);
}

function cargoMapsLoad(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (CARGO_ROUTE.loader) return CARGO_ROUTE.loader;
  CARGO_ROUTE.loader = new Promise((resolve,reject) => {
    const script = document.createElement('script');
    const finish = error => {
      clearTimeout(timeout);
      if (error) {
        script.remove();
        reject(new Error('Não foi possível carregar o Google Maps. Confira a ativação da chave.'));
      } else resolve();
    };
    const timeout = setTimeout(() => finish(true),15000);
    window.cargoGoogleMapsReady = () => finish(false);
    const url = new URL('https://maps.googleapis.com/maps/api/js');
    for (const [k,v] of Object.entries({key,loading:'async',callback:'cargoGoogleMapsReady',v:'weekly',language:'pt-BR',region:'BR',auth_referrer_policy:'origin'})) {
      url.searchParams.set(k,v);
    }
    script.src = url.href;
    script.async = true;
    script.onerror = () => finish(true);
    document.head.append(script);
  }).catch(error => {CARGO_ROUTE.loader=null;throw error;});
  return CARGO_ROUTE.loader;
}

function cargoRouteLocation(address) {
  const match = address.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return address;
  const lat = Number(match[1]), lng = Number(match[2]);
  return Math.abs(lat)<=90 && Math.abs(lng)<=180 ? {lat,lng} : address;
}

async function cargoRouteDraw(points,key,box,message,sequence) {
  const current = () => sequence===CARGO_ROUTE.generation && box.isConnected;
  try {
    await cargoMapsLoad(key);
    if (!current()) return;
    const [{Map:GoogleMap},{Route}] = await Promise.all([google.maps.importLibrary('maps'),google.maps.importLibrary('routes')]);
    if (!current()) return;
    if (CARGO_ROUTE.mapBox!==box) {
      const gestureHandling = window.matchMedia('(any-pointer: fine)').matches ? 'greedy' : 'cooperative';
      CARGO_ROUTE.map = new GoogleMap(box,{center:{lat:-6.2,lng:-39.6},zoom:7,streetViewControl:false,gestureHandling});
      CARGO_ROUTE.mapBox = box;
    }
    const results = [];
    const segments = cargoRouteSegments(points,26);
    for (const segment of segments) {
      if (!current()) return;
      const {routes} = await Route.computeRoutes({
        origin:cargoRouteLocation(segment[0].address),
        destination:cargoRouteLocation(segment.at(-1).address),
        intermediates:segment.slice(1,-1).map(p=>({location:cargoRouteLocation(p.address)})),
        travelMode:'DRIVING',region:'br',fields:['path','legs','distanceMeters','durationMillis']
      });
      if (!routes?.[0]) throw new Error('Trajeto indisponível. Confira os endereços informados.');
      results.push({route:routes[0],segment});
    }
    if (!current()) return;
    CARGO_ROUTE.polylines.forEach(p=>p.setMap(null));
    CARGO_ROUTE.markers.forEach(p=>p.setMap(null));
    CARGO_ROUTE.polylines = [];
    CARGO_ROUTE.markers = [];
    const map = CARGO_ROUTE.map, bounds = new google.maps.LatLngBounds();
    let km=0, millis=0;
    const pin = (position,point) => {
      if (!position || !point) return;
      const pos = {lat:position.lat,lng:position.lng};
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;
      CARGO_ROUTE.markers.push(new google.maps.Marker({map,position:pos,label:point.label==='Saída'?'S':point.label==='Retorno'?'R':point.label,title:point.label}));
    };
    results.forEach(({route,segment},i) => {
      route.path.forEach(p=>bounds.extend({lat:p.lat,lng:p.lng}));
      route.createPolylines().forEach(p=>{p.setMap(map);CARGO_ROUTE.polylines.push(p);});
      if (!i) pin(route.legs?.[0]?.startLocation,segment[0]);
      (route.legs || []).forEach((leg,j)=>pin(leg.endLocation,segment[j+1]));
      km += Number(route.distanceMeters || 0)/1000;
      millis += Number(route.durationMillis || 0);
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds,36);
    const mins = Math.round(millis/60000);
    message.textContent = logN(km,1)+' km · '+(mins>=60?Math.floor(mins/60)+' h ':'')+(mins%60)+' min estimados';
  } catch (error) {
    if (!current()) return;
    message.textContent = error.message || 'Não foi possível calcular a rota no Google Maps.';
  }
}

function cargoAlertMessages(alerts = []) {
  return alerts.map(a => {
    if (a.code === 'PLACA_FORA_DO_PADRAO') return 'Placa '+a.plate+' fora do padrão. Confira o cadastro do veículo.';
    if (a.code === 'PESO_INCOMPLETO') return `${a.orders} pedido(s) sem peso. Peso informado: ${cargoKg(a.knownWeightKg)}.`;
    if (a.code === 'CAPACIDADE_EXCEDIDA') return `Peso informado excede a capacidade em ${cargoKg(a.excessKg)}. Capacidade: ${cargoKg(a.capacityKg)}.`;
    if (a.code === 'CAPACIDADE_NAO_INFORMADA') return 'Capacidade do veículo não informada.';
    return '';
  }).filter(Boolean);
}

function cargoAlertList(alerts, title = '') {
  const lines = cargoAlertMessages(alerts);
  if (!lines.length) return '';
  return `<div class="cargo-weight-alerts">${title?`<strong>${esc(title)}</strong>`:''}
    <ul>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul></div>`;
}

function cargoCapacityProgress(m) {
  if (!(m.capacityKg > 0)) return {percent:null,message:m.vehicleId || m.vehicle?'Cadastre a capacidade do veículo':'Selecione um veículo'};
  const pending = m.unknownOrders || 0;
  const known = m.knownWeightKg;
  const percent = m.orders > pending || !m.orders ? known / m.capacityKg * 100 : null;
  const remaining = Math.round((m.capacityKg - known) * 1000) / 1000;
  const kg = value => value > 0 && value < 0.1 ? logN(value,3)+' kg' : cargoKg(value);
  const missing = pending ? ` · ${pending} ${pending===1?'pedido sem peso':'pedidos sem peso'}` : '';
  if (remaining < 0) return {percent,message:`Excesso de ${kg(-remaining)}${missing}`};
  if (remaining === 0) return {percent,message:'Capacidade atingida'+missing};
  if (pending) return {percent,message:'Saldo pendente'+missing};
  return {percent,message:`Faltam ${kg(remaining)} para a capacidade`};
}

function cargoCapacity(m) {
  const percent = m.capacityKg ? Math.min(100,m.knownWeightKg/m.capacityKg*100) : 0;
  return `<section class="cargo-capacity ${m.overCapacity?'is-over':''}">
    <div><strong>${cargoKg(m.totalWeightKg)}</strong>
      <span>${m.capacityKg?'de '+cargoKg(m.capacityKg)+' de capacidade':'Capacidade a cadastrar'}</span></div>
    <div class="cargo-capacity-track"><i style="width:${percent}%"></i></div>
    ${cargoAlertList(m.alerts,m.status==='Finalizada'?'Alertas da finalização':'Alertas de conferência')}
    ${m.status===CARGO_OPEN?`<p><strong>${esc(cargoCapacityProgress(m).message)}</strong></p>`:
      m.remainingKg>=0&&m.remainingKg!=null?`<p>${cargoKg(m.remainingKg)} disponíveis no veículo.</p>`:''}
  </section>`;
}

function cargoPlanAge(order, today) {
  const date = order.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return -1;
  const timestamp = Date.parse(date+'T12:00:00Z');
  if (!Number.isFinite(timestamp)) return -1;
  return Math.round((Date.parse(today+'T12:00:00Z')-timestamp)/86400000);
}

function cargoPlanCitySummary(city, orders, today) {
  const bands = [
    {label:'0–2 dias', max:2, count:0},
    {label:'3–7 dias', max:7, count:0},
    {label:'8–14 dias', max:14, count:0},
    {label:'15 dias ou mais', max:Infinity, count:0},
    {label:'Data indisponível', count:0}
  ];
  let known = 0, weight = 0;
  for (const order of orders) {
    if (Number.isFinite(order.weight) && order.weight >= 0 && !order.weightIncomplete) {
      known++;
      weight += order.weight;
    }
    const age = cargoPlanAge(order,today);
    const band = age < 0 ? bands.at(-1) : bands.find(item => age <= item.max);
    band.count++;
  }
  return `<section class="cargo-priority-summary" role="status">
    <div><small>CIDADE SELECIONADA</small><h3>${esc(city.city)}${city.uf?' · '+esc(city.uf):''}</h3>
      <p>${logN(orders.length)} pedidos disponíveis</p></div>
    <div><small>PESO EM ABERTO INFORMADO</small><strong>${known?esc(cargoKg(weight)):'Peso não informado'}</strong>
      <p>${logN(known)} de ${logN(orders.length)} pedidos com peso</p></div>
    <div class="cargo-priority-ages"><small>IDADE DOS PEDIDOS · A PARTIR DA DATA DO PEDIDO</small>
      <ul>${bands.filter(band=>band.count).map(band=>`<li><b>${logN(band.count)}</b> ${band.label}</li>`).join('')}</ul></div>
  </section>`;
}

function cargoMontageIssues(m) {
  const issues = [];
  if (!m.driver) issues.push(['Motorista pendente','']);
  if (!m.vehicle) issues.push(['Veículo pendente','']);
  if (m.unknownOrders) issues.push([`${m.unknownOrders} ${m.unknownOrders===1?'pedido sem peso':'pedidos sem peso'}`,'']);
  if (m.overCapacity) issues.push(['Acima da capacidade','critical']);
  return issues.length ? `<ul class="cargo-board-issues" aria-label="Pendências da montagem">${issues.map(([label,tone])=>
    `<li class="${tone}">${esc(label)}</li>`).join('')}</ul>` : '';
}

function cargoMontageSummary(m) {
  const plate = m.vehicle?.plate || m.vehicleId;
  return `<dl class="cargo-montage-meta">
    <div><dt>Motorista</dt><dd>${esc(m.driver || 'A definir')}</dd></div>
    <div><dt>Placa</dt><dd>${plate?esc(m.vehicle?cargoVehicleLabel(m.vehicle):plate):'A definir'}</dd></div>
    <div><dt>Peso / capacidade</dt><dd>${cargoKg(m.totalWeightKg ?? (m.knownWeightKg>0?m.knownWeightKg:null))}${m.unknownOrders&&m.knownWeightKg>0?' (parcial)':''}${m.capacityKg?' / '+cargoKg(m.capacityKg):''}</dd></div>
    <div><dt>Saldo do veículo</dt><dd>${esc(cargoCapacityProgress(m).message)}</dd></div>
  </dl>`;
}

function cargoMontageBoard(data) {
  const byMontage = new Map();
  for (const order of data.orders) {
    if (!order.montageId) continue;
    if (!byMontage.has(order.montageId)) byMontage.set(order.montageId, []);
    byMontage.get(order.montageId).push(order);
  }
  const open = data.montages.filter(m => m.status === CARGO_OPEN);
  const count = (items, one, many) => items.length + ' ' + (items.length === 1 ? one : many);
  return `<div class="cargo-section-heading"><div><h2>Montagens</h2>
    <p>${open.length} em aberto</p>
    ${canLog('formation','edit')?'<p class="cargo-montage-instruction">Arraste um pedido para outra montagem em aberto ou use o menu ⋯.</p>':''}</div>
    ${canLog('formation','edit')?'<button class="btn primary" id="formationCreateEmpty">Nova montagem</button>':''}</div>
    <div id="cargoMontageBoard" class="cargo-montage-board">
      ${open.map(m => {
        const orders = byMontage.get(m.id) || [];
        return `<section class="panel cargo-montage-panel" data-cargo-drop="${esc(m.id)}">
          <header><div>${cargoStatus(m)}
          <h3>${esc(m.name)}</h3><p>${m.company?esc(cargoCompanyName(m.company))+' · ':''}${count(orders,'pedido','pedidos')}</p></div>
          <button type="button" class="btn" data-formation-montage="${esc(m.id)}">Abrir montagem</button></header>
          ${cargoMontageIssues(m)}
          ${cargoMontageSummary(m)}
          <div class="cargo-montage-orders">
          ${orders.map(o => {
            const movable=canLog('formation','edit')&&!o.blocked;
            const location = [o.city,o.uf].filter(Boolean).join(' / ');
            return `<article class="cargo-montage-order" ${movable?`draggable="true" data-cargo-drag="${esc(o.key)}"`:''}>
              <div><strong>Pedido ${esc(o.order)}</strong><p>${esc(o.client)}</p>
              ${location?`<small>${esc(location)}</small>`:''}
              ${o.sourceIssue?`<small class="cargo-alert">${esc(o.sourceIssue)}</small>`:''}</div>
              <details class="cargo-montage-order-menu" name="cargo-montage-order-menu">
                <summary aria-label="Opções do pedido ${esc(o.order)}">⋯</summary>
                <div class="cargo-montage-order-actions">
                  ${movable?`<button type="button" class="cargo-link" data-cargo-move="${esc(o.key)}">Mover para…</button>`:''}
                  <button type="button" class="cargo-link" data-formation-detail="${esc(o.key)}">Detalhes do pedido</button>
                </div>
              </details></article>`;
          }).join('') || '<p class="cargo-montage-empty">Nenhum pedido nesta montagem.</p>'}
          </div></section>`;
      }).join('') || '<section class="panel cargo-empty">Nenhuma montagem iniciada.</section>'}
    </div>`;
}

function cargoMoveDestinations(order, montages) {
  if (!order || order.blocked) return [];
  const origin = montages.find(m => m.id === order.montageId);
  if (!origin || origin.status !== CARGO_OPEN) return [];
  return montages.filter(m => m.id !== origin.id && m.status === CARGO_OPEN);
}

function cargoMoveOrder(key, targetId = '') {
  if (FEXP.busy || document.querySelector('.formation-dialog[open]')) return;
  const {orders, montages, revision, sourceVersion} = FEXP.data;
  const order = orders.find(item => item.key === key);
  const targets = cargoMoveDestinations(order, montages);
  if (!targets.length) {
    formationNotice('Nenhuma outra montagem em aberto para receber este pedido.');
    return;
  }
  if (targetId && !targets.some(m => m.id === targetId)) return;
  const origin = montages.find(m => m.id === order.montageId);
  const requestId = crypto.randomUUID().replace(/-/g,'');
  const dialog = formationDialog('Mover pedido ' + order.order, `
    <p>${esc(order.client)} · Origem: <strong>${esc(origin.name)}</strong></p>
    <form class="cargo-form">
      <fieldset class="cargo-move-targets"><legend>Escolha a montagem de destino</legend>
        ${targets.map(m => `<label class="cargo-move-target">
          <input type="radio" name="target" value="${esc(m.id)}" ${m.id===targetId?'checked':''} required>
          <span><strong>${esc(m.name)}</strong> · ${m.orders} ${m.orders===1?'pedido':'pedidos'}
          <span class="cargo-move-meta">${esc(m.driver || 'Motorista a definir')} · ${esc(m.vehicle?.plate || m.vehicleId || 'Placa a definir')}</span>
          </span></label>`).join('')}
      </fieldset>
      <p role="status" class="cargo-form-status"></p>
      <footer><button type="submit" class="btn primary">Confirmar transferência</button></footer>
    </form>`);
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    formationSave({operation:'TRANSFERIR',keys:[key],ordersAtConfirmation:formationOrderContext([order]),target:event.currentTarget.elements.target.value,
      confirmed:true,revision,sourceVersion},dialog,dialog.querySelector('[role=status]'),requestId);
  };
}

function cargoBindMontageBoard(board) {
  let order = null;
  let highlighted = null;
  const highlight = panel => {
    if (highlighted === panel) return;
    highlighted?.classList.remove('drop-target');
    highlighted = panel;
    highlighted?.classList.add('drop-target');
  };
  const finishDrag = () => {
    order = null;
    highlight(null);
    board.classList.remove('is-dragging');
  };
  const destinationAt = event => {
    const panel = event.target.closest('[data-cargo-drop]');
    return panel && order && panel.dataset.cargoDrop !== order.montageId ? panel : null;
  };
  board.addEventListener('click', event => {
    const button = event.target.closest('[data-cargo-move]');
    if (!button) return;
    button.closest('details').open = false;
    cargoMoveOrder(button.dataset.cargoMove);
  });
  board.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-cargo-drag]');
    if (!card) return;
    order = FEXP.data.orders.find(o => o.key === card.dataset.cargoDrag);
    if (FEXP.busy || !cargoMoveDestinations(order,FEXP.data.montages).length) {
      event.preventDefault();
      order = null;
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain','Pedido da montagem');
    board.classList.add('is-dragging');
  });
  board.addEventListener('dragover', event => {
    const panel = destinationAt(event);
    highlight(panel);
    if (!panel) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  board.addEventListener('dragleave', event => {
    if (highlighted && !highlighted.contains(event.relatedTarget)) highlight(null);
  });
  board.addEventListener('drop', event => {
    const panel = destinationAt(event);
    if (!panel) return;
    event.preventDefault();
    const key = order.key;
    finishDrag();
    cargoMoveOrder(key, panel.dataset.cargoDrop);
  });
  board.addEventListener('dragend', finishDrag);
}

function cargoMontageDetail(m) {
  const closed=m.status!==CARGO_OPEN, editable=!closed&&canLog('formation','edit');
  const members = FEXP.data.orders.filter(o => o.montageId===m.id);
  const fleet = FEXP.data.fleet || {vehicles:[],drivers:[]};
  const vehicles = fleet.vehicles.slice(), drivers = fleet.drivers.slice();
  if (m.vehicle && !vehicles.some(v=>v.plate===m.vehicleId)) vehicles.push(m.vehicle);
  if (m.driver && !drivers.some(d=>d.name===m.driver)) drivers.push({name:m.driver});
  const products = formationAggregate(members).products;
  return `<section class="panel cargo-montage-detail">
    <header class="cargo-detail-header"><div>${cargoStatus(m)}
      <h2>${esc(m.name)}</h2><p>${m.company?esc(cargoCompanyName(m.company))+' · ':''}${m.orders} pedidos · ${m.clients} clientes · ${m.cities} cidades</p></div>
      <div class="cargo-actions">${closed
        ? '<button class="btn" id="cargoReopen">Reabrir montagem</button><button class="btn primary" id="cargoOpenRoute">Roteirizar carga</button>'
        : !editable?'':`${m.company?'':'<button class="cargo-link" id="formationRename">Renomear</button>'}<button class="btn primary" id="formationReturnPlan">Adicionar pedidos</button>`}</div></header>
    ${editable?'':'<p class="cargo-help">Consulta da montagem</p>'}
    <div class="cargo-steps"><span>1. Pedidos</span><span>2. Veículo e motorista</span><span>3. Roteirização</span><span>4. Finalização</span></div>
    <section class="cargo-dispatch"><div class="cargo-section-heading"><h3>Veículo e motorista</h3></div>
      ${!editable ? `<p><strong>${esc(m.vehicle?cargoVehicleLabel(m.vehicle):'Veículo não informado')}</strong></p>
        <p>Motorista: ${esc(m.driver)}</p><small>${esc(m.status)} · ${cargoDate(m.statusAt)}</small>`
      : `<form id="cargoDispatchForm">
        <label>Veículo<select name="vehicle" required>${cargoOptions(vehicles,m.vehicleId,'Escolha a placa e o tipo','plate')}</select>
          <small data-selected-label="vehicle">${esc(m.vehicle?cargoVehicleLabel(m.vehicle):'')}</small></label>
        <label>Motorista<select name="driver" required>${cargoOptions(drivers,m.driver,'Escolha o motorista')}</select>
          <small data-selected-label="driver">${esc(m.driver)}</small></label>
        <button class="btn" type="submit">Salvar veículo e motorista</button></form>`}
    </section>
    ${cargoCapacity(m)}
    <div class="cargo-section-heading"><h3>Pedidos desta montagem</h3>${!editable?'':'<button class="btn" id="cargoWeights">Informar pesos</button>'}</div>
    ${editable&&FEXP.assemblySelected.size?`<div class="cargo-selected-actions"><strong>${FEXP.assemblySelected.size} selecionados</strong>
      <button class="btn" id="formationTransfer">Transferir</button><button class="btn" id="formationRemove">Retirar da montagem</button></div>`:''}
    ${formationTable(members,FEXP.assemblySelected,true)}
    <details class="cargo-products"><summary>Produtos consolidados · ${products.length} produtos</summary>${formationProducts(products)}</details>
    ${!editable?'':`<footer class="cargo-finalize">${closed ? `<div><strong>${m.route?.confirmed?'Roteiro confirmado':'Montagem finalizada'}</strong>
      <p>${m.route?.confirmed?`${m.route.stops.length} paradas · Confirmado por ${esc(m.route.by)} em ${cargoDate(m.route.at)}`:'Confira a sequência e os endereços das paradas.'}</p></div>`
      : `<div><strong>Conferir e enviar para roteirização</strong><p>${m.canFinalize
        ? (m.alerts?.length?'Os alertas serão registrados no histórico ao enviar a montagem.':'Tudo pronto para roteirizar.')
        : esc(m.finishReasons.join(' · '))}</p></div>
        <button class="btn primary" id="cargoFinish" ${m.canFinalize?'':'disabled'}>Enviar para roteirização</button>`}</footer>`}
    </section>`;
}

function cargoDate(date) {
  return new Date(date).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'});
}

function cargoFinalizedInPeriod(m, period, start, end, today=transportToday()) {
  if(!m.finalizedAt)return false;
  const day=transportToday(new Date(m.finalizedAt));
  if(period==='custom')return (!start||day>=start)&&(!end||day<=end);
  let first;
  if(period==='7'||period==='15') first=transportDayShift(today,1-Number(period));
  else {
    const [year,month,date]=today.split('-').map(Number);
    const previous=new Date(Date.UTC(year,month-1-({month:1,'3months':3,'6months':6}[period]||1),1));
    const lastDay=new Date(Date.UTC(previous.getUTCFullYear(),previous.getUTCMonth()+1,0)).getUTCDate();
    previous.setUTCDate(Math.min(date,lastDay));
    first=previous.toISOString().slice(0,10);
  }
  return day>=first&&day<=today;
}

function cargoDeliveryOrderData(m, orders) {
  if (m.status !== CARGO_FINAL || !m.route?.confirmed || !m.route.stops?.length) return null;
  const byKey = new Map(orders.filter(order => order.montageId === m.id).map(order => [order.key,order]));
  const seen = new Set();
  const rows = m.route.stops.flatMap((stop, index) => stop.keys.map(key => {
    const order = byKey.get(key);
    if (!order || seen.has(key)) return null;
    seen.add(key);
    return {
      stop: index + 1,
      order: order.order,
      client: order.client,
      seller: order.seller || (order.rcas || []).filter(value => value != null).join(' / '),
      city: [order.city,order.uf].filter(Boolean).join(' / '),
      address: stop.address,
      weight: !order.weightIncomplete && Number.isFinite(order.weight) && order.weight >= 0 ? order.weight : null,
      volumes: Number.isFinite(order.volumes) && order.volumes >= 0 ? order.volumes : null
    };
  }));
  if (rows.some(row => row === null) || rows.length !== m.orders || seen.size !== byKey.size) return null;
  const cities = [...new Set(rows.map(row => row.city).filter(Boolean))];
  const confirmedAt = new Date(m.finalizedAt || m.route.at);
  return {
    name: m.name,
    origin: m.route.unit?.name || cargoCompanyName(m.company),
    route: cities.join(' → '),
    plate: m.vehicle?.plate || m.vehicleId,
    driver: m.driver,
    date: Number.isFinite(confirmedAt.getTime()) ? transportDate(transportToday(confirmedAt)) : '',
    stops: m.route.stops.length,
    rows,
    weight: rows.reduce((sum,row) => sum + (row.weight ?? 0), 0),
    unknownWeight: rows.filter(row => row.weight === null).length
  };
}

function cargoDeliveryOrderHtml(order) {
  const field = (label, value) => `<div><dt>${label}</dt><dd>${esc(value || 'Não informado')}</dd></div>`;
  const weight = order.unknownWeight === order.rows.length ? 'Não informado' : logN(order.weight / 1000,3)+' t';
  const title = 'Ordem de Entregas · '+order.name;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)}</title><style>
      @page{size:A4;margin:13mm}
      *{box-sizing:border-box}body{font:13px/1.35 system-ui,sans-serif;color:#152542;margin:0}
      main{max-width:184mm;margin:0 auto;padding:0 0 12px}header{border-bottom:3px solid #243f78;padding-bottom:12px;margin-bottom:14px}
      header small{color:#243f78;font-weight:750;letter-spacing:.12em}h1{margin:4px 0;font-size:27px}
      header p{margin:0;font-weight:650}dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 12px}
      dl div,.summary div{min-width:0;border:1px solid #97a9cb;padding:8px 10px;break-inside:avoid}
      dt,.summary span{color:#294475;font-weight:700}dd{margin:2px 0 0;overflow-wrap:anywhere}
      .route{grid-column:1/-1}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
      .summary strong{display:block;font-size:16px;margin-top:4px}.summary .km{min-height:53px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #9dacca;text-align:left;padding:7px 6px;vertical-align:top;overflow-wrap:anywhere}
      th{background:#e1e9f7;color:#152d60;font-size:12px}thead{display:table-header-group}tr{break-inside:avoid}
      td:nth-last-child(-n+2),th:nth-last-child(-n+2){text-align:right}td small{display:block;color:#3b4c69;margin-top:3px}
      .notes{font-size:12px;color:#3b4c69}.actions{padding:12px 0}.actions button{font:inherit;font-weight:650;background:#243f78;color:#fff;border:0;border-radius:6px;padding:9px 14px;cursor:pointer}
      .table-wrap{overflow:auto}table{min-width:610px}
      @media screen{main{padding:12px}}
      @media screen and (max-width:520px){.summary{grid-template-columns:repeat(2,1fr)}}
      @media print{.actions{display:none}table{min-width:0}.table-wrap{overflow:visible}}
    </style><body><main>
    <div class="actions"><button type="button" id="deliveryOrderPrint">Imprimir / salvar PDF</button></div>
    <header><small>REBANHO · LOGÍSTICA</small><h1>Ordem de Entregas</h1><p>Montagem ${esc(order.name)}</p></header>
    <dl>${field('Origem',order.origin)}${field('Data da ordem',order.date)}
      ${field('Veículo',order.plate)}${field('Motorista',order.driver)}
      <div class="route"><dt>Rota</dt><dd>${esc(order.route || 'Consulte a sequência de destinos abaixo.')}</dd></div></dl>
    <section class="summary" aria-label="Resumo da ordem"><div><span>Paradas de entrega</span><strong>${order.stops}</strong></div>
      <div><span>Peso total</span><strong>${weight}</strong>${order.unknownWeight&&order.unknownWeight<order.rows.length?'<small>Parcial</small>':''}</div>
      <div class="km"><span>KM inicial</span></div><div class="km"><span>KM final</span></div></section>
    <div class="table-wrap"><table aria-label="Entregas na sequência confirmada">
      <colgroup><col style="width:8%"><col style="width:22%"><col style="width:15%"><col style="width:33%"><col style="width:10%"><col style="width:12%"></colgroup>
      <thead><tr><th scope="col">Parada</th><th scope="col">Cliente / pedido</th><th scope="col">Vendedor</th><th scope="col">Destino</th><th scope="col">Volumes</th><th scope="col">Peso (kg)</th></tr></thead>
      <tbody>${order.rows.map(row => `<tr><td>${row.stop}</td><td><strong>${esc(row.client || 'Não informado')}</strong><small>Pedido ${esc(row.order)}</small></td>
        <td>${esc(row.seller || '—')}</td><td>${esc(row.city || '—')}<small>${esc(row.address)}</small></td>
        <td>${row.volumes === null ? '—' : logN(row.volumes)}</td><td>${row.weight === null ? '—' : logN(row.weight,3)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="notes">${order.rows.length} pedidos na sequência do roteiro confirmado. Campos com “—” estão sem informação na Central.</p>
    </main></body></html>`;
}

function cargoOpenDeliveryOrder(id) {
  const montage = FEXP.data.montages.find(item => item.id === id);
  const order = montage && cargoDeliveryOrderData(montage,FEXP.data.orders);
  if (!order) {
    formationNotice('Não foi possível montar a ordem. Atualize a tela e confira se todos os pedidos estão no roteiro confirmado.');
    return;
  }
  const preview = window.open('', '_blank');
  if (!preview) {
    formationNotice('Permita a abertura de uma nova aba para emitir a Ordem de Entregas.');
    return;
  }
  preview.opener = null;
  preview.document.open();
  preview.document.write(cargoDeliveryOrderHtml(order));
  preview.document.close();
  preview.document.getElementById('deliveryOrderPrint').addEventListener('click', () => preview.print());
}

function cargoRouteQueue(d, finished) {
  const period=FEXP.finalPeriod||'month', start=FEXP.finalStart||'',end=FEXP.finalEnd||'';
  const today=transportToday();
  const candidates=d.montages.filter(m=>finished?
    m.status===CARGO_FINAL&&cargoFinalizedInPeriod(m,period,start,end,today):m.status===CARGO_PENDING);
  const stamp=finished?'finalizedAt':'routingAt';
  const stopCounts = new Map();
  for (const order of d.orders) {
    if (!order.montageId) continue;
    const counts = stopCounts.get(order.montageId) || {total:0,missing:0};
    counts.total++;
    if (!String(order.deliveryStop?.address||'').trim()) counts.missing++;
    stopCounts.set(order.montageId,counts);
  }
  candidates.sort((a,b)=>String(b[stamp]).localeCompare(String(a[stamp])));
  return `<section class="cargo-queue"><h2>${finished?'Montagens finalizadas':'Fila de roteirização'}</h2>
    ${finished?`<div class="panel cargo-period"><label>Data de finalização <select id="cargoFinalPeriod">${biOptions({
      '7':'Últimos 7 dias','15':'Últimos 15 dias',month:'Último mês','3months':'Últimos 3 meses','6months':'Últimos 6 meses',custom:'Período personalizado'
    },period)}</select></label>${period==='custom'?`<label>De <input id="cargoFinalStart" type="date" value="${esc(start)}"></label>
      <label>Até <input id="cargoFinalEnd" type="date" value="${esc(end)}"></label>`:''}</div>`:''}
    ${candidates.map(m=>{
      const expanded=FEXP.routeExpanded===m.id;
      const counts=stopCounts.get(m.id);
      const missing=m.route?.stops?cargoRouteMissing(m.route.stops):counts?.total===m.orders?counts.missing:null;
      return `<article class="panel cargo-queue-card"><header class="cargo-detail-header"><div>${cargoStatus(m)}
        <h3>${esc(m.name)}</h3><p>${m.orders} pedidos · ${esc(m.driver||'Motorista a definir')} · ${esc(m.vehicle?.plate||m.vehicleId||'Placa a definir')}</p>
        <small>${cargoDate(m[stamp])} · ${esc(finished?m.finalizedBy:m.routingBy)}</small>
        ${expanded?'':`<div class="cargo-route-state">${cargoRouteBadge(m)}
          ${missing>0?`<small class="cargo-route-missing-label">${cargoRouteMissingLabel(missing)}</small>`:''}</div>`}</div>
        <div class="cargo-actions">${expanded?'':`<button type="button" class="btn primary" data-cargo-route="${esc(m.id)}">${finished||!canLog('formation','edit')?'Consultar roteiro':'Roteirizar'}</button>`}
        ${finished&&m.route?.confirmed?`<button type="button" class="btn" data-cargo-delivery-order="${esc(m.id)}">Emitir Ordem de Entregas</button>`:''}
        ${canLog('formation','edit')?`<button type="button" class="btn" data-cargo-reopen="${esc(m.id)}">Reabrir montagem</button>`:''}</div></header>
        ${expanded?cargoRouteMarkup(m):''}</article>`;
    }).join('')||'<div class="panel cargo-empty">Nenhuma montagem neste recorte.</div>'}
  </section>`;
}

function cargoBindWorkflow() {
  $$('[data-cargo-route]').forEach(b=>b.onclick=()=>cargoRouteOpen(b.dataset.cargoRoute));
  $$('[data-cargo-delivery-order]').forEach(b=>b.onclick=()=>cargoOpenDeliveryOrder(b.dataset.cargoDeliveryOrder));
  $$('[data-cargo-reopen]').forEach(b=>b.onclick=()=>{
    FEXP.montage=b.dataset.cargoReopen;
    cargoFinishDialog(true);
  });
  $$('[data-cargo-inspect]').forEach(b=>b.onclick=()=>{
    const m=FEXP.data.montages.find(item=>item.id===b.dataset.cargoInspect);
    if(!m)return;
    if(m.status===CARGO_OPEN){
      FEXP.montage=m.id;
      FEXP.assemblySelected.clear();
      FEXP.tab='montages';
      FEXP.montageDetail=true;
      formationShow();
    }else{
      if(m.status===CARGO_FINAL){
        FEXP.finalPeriod='custom';
        FEXP.finalStart=FEXP.finalEnd=transportToday(new Date(m.finalizedAt));
      }
      cargoRouteOpen(m.id);
    }
  });
  $$('[data-cargo-audit]').forEach(b=>b.onclick=async()=>{
    const result=b.nextElementSibling;
    b.disabled=true;
    result.textContent='Consultando movimentações…';
    try {
      const response=await formationApi({action:'montageHistory',target:b.dataset.cargoAudit});
      result.innerHTML=cargoHistoryEvents({montages:FEXP.data.montages,events:response.events});
      b.hidden=true;
    }catch(error){
      result.textContent=error.message;
    }finally{
      b.disabled=false;
    }
  });
  for(const [id,property] of [['cargoFinalPeriod','finalPeriod'],['cargoFinalStart','finalStart'],['cargoFinalEnd','finalEnd']]){
    const control=$('#'+id);
    if(control)control.onchange=()=>{
      FEXP[property]=control.value;
      FEXP.routeExpanded='';
      formationShow();
    };
  }
}

function cargoHistoryEvents(d) {
  const titles = {CRIAR:'Montagem criada',ADICIONAR:'Pedidos adicionados',TRANSFERIR:'Pedidos transferidos',
    REMOVER:'Pedidos retirados',RENOMEAR:'Montagem renomeada',CONFIGURAR_CARGA:'Veículo e motorista definidos',
    PESOS_PEDIDOS:'Pesos informados',FINALIZAR:'Montagem enviada para roteirização',ENVIAR_ROTEIRO:'Montagem enviada para roteirização',REABRIR:'Montagem reaberta',
    VEICULO_SALVAR:'Cadastro de veículo atualizado',MOTORISTA_SALVAR:'Cadastro de motorista atualizado',
    UNIDADE_SALVAR:'Unidade de saída atualizada',ROTEIRIZACAO_CONFIGURAR:'Padrões do roteiro atualizados'};
  return `<section class="panel"><h2>Histórico de movimentações</h2><div class="cargo-history">${d.events.map(e => {
    const title = e.type==='ROTEIRO_SALVAR' ? (e.confirmed?'Roteiro confirmado':'Rascunho do roteiro salvo') : titles[e.type]||e.type;
    return `<article><strong>${esc(title)}</strong><p>${esc(d.montages.find(m=>m.id===e.to)?.name||'Cadastro')}
      ${e.keys.length?' · '+e.keys.length+' pedidos':''}</p><small>${cargoDate(e.at)} · ${esc(e.by)}</small>
      ${e.capacitySnapshot&&e.alerts?.length?`<p>Peso informado: ${cargoKg(e.capacitySnapshot.knownWeightKg)}
        · Capacidade: ${e.capacitySnapshot.capacityKg==null?'Não informada':cargoKg(e.capacitySnapshot.capacityKg)}</p>`:''}
      ${e.overweight?cargoStatus({status:CARGO_FINAL,overweightOccurrences:[{...e.overweight,at:e.at,by:e.by}]}):''}
      ${cargoAlertList(e.alerts,'Alertas no momento da transição')}</article>`;
  }).join('') || '<p>Nenhuma movimentação registrada.</p>'}</div></section>`;
}

function cargoHistory(d) {
  const rows=d.montages.slice().sort((a,b)=>String(b.statusAt).localeCompare(String(a.statusAt)));
  return `<section class="panel cargo-history-table"><h2>Histórico de montagens</h2>
    <p>Abra uma linha para conferir as etapas registradas.</p>
    ${rows.map(m=>`<details class="cargo-history-row"><summary>
      <strong>${esc(m.name)}</strong><span>${cargoDate(m.statusAt)}</span><span>${m.orders} pedidos</span>
      <span>${esc(m.driver||'Motorista a definir')}</span><span>${esc(m.vehicle?.plate||m.vehicleId||'Placa a definir')}</span>
      <span class="cargo-state">${esc(m.status)}<i class="cargo-state-dot ${m.status===CARGO_FINAL?'green':m.status===CARGO_PENDING?'orange':'yellow'}" aria-hidden="true"></i>
      ${m.overweightOccurrences?.length?`<i class="cargo-state-dot red" title="${esc('Excesso de peso · '+cargoIncidentLines(m).at(-1))}" aria-label="Excesso de peso registrado"></i>`:''}</span>
      </summary><div class="cargo-history-body">${cargoStatus(m)}
      <p>Criada em ${cargoDate(m.createdAt)} · ${esc(m.owner)}</p>
      ${m.routingAt?`<p>Envio para roteirização em ${cargoDate(m.routingAt)} · ${esc(m.routingBy)}</p>`:''}
      ${m.finalizedAt?`<p>Roteiro concluído em ${cargoDate(m.finalizedAt)} · ${esc(m.finalizedBy)}</p>`:''}
      <button type="button" class="btn" data-cargo-inspect="${esc(m.id)}">Consultar detalhes</button> <button type="button" class="btn" data-cargo-audit="${esc(m.id)}">Ver movimentações</button><div aria-live="polite"></div></div></details>`).join('')||'<p>Nenhuma montagem registrada.</p>'}
    </section><details class="panel cargo-history-movements"><summary>Movimentações recentes</summary>${cargoHistoryEvents(d)}</details>`;
}

function cargoPriorityCities(orders, features) {
  const states = new Map();
  for (const feature of features) {
    const {NM_MUN:city,SIGLA_UF:uf} = feature.properties;
    const name = aliasCity(city);
    if (!states.has(name)) states.set(name,new Set());
    states.get(name).add(normalize(uf));
  }
  const location = row => {
    const city = aliasCity(row.city);
    const matches = states.get(city);
    const uf = normalize(row.uf) || (matches?.size===1 ? [...matches][0] : '');
    return {key:city+'|'+uf,uf};
  };
  const cities = new Map();
  for (const order of orders) {
    if (!order.city) continue;
    const place = location(order);
    if (!cities.has(place.key)) cities.set(place.key,{...place,city:order.city,orderCount:0});
    cities.get(place.key).orderCount++;
  }
  const ranked = [...cities.values()].sort((a,b) =>
    b.orderCount-a.orderCount || a.city.localeCompare(b.city,'pt-BR') || a.uf.localeCompare(b.uf));
  return {ranked, location};
}

function cargoPriorityMarkup() {
  return `<section id="cargoPriority" class="cargo-priority">
    <div class="cargo-section-heading"><div><h3>Prioridade para montagem</h3>
      <p>Clique em uma cidade no mapa ou na lista para filtrar os pedidos.</p></div></div>
    <div class="cargo-priority-layout">
      <div><div id="cargoPriorityMap" class="log-map" aria-label="Mapa de prioridade por cidade"><p>Carregando malha municipal…</p></div>
        <div class="log-map-scale"><span>Menos pedidos</span><i></i><span>Mais pedidos</span></div></div>
      <aside aria-label="Cidades prioritárias">
        <div class="cargo-priority-side"><strong>Cidades prioritárias</strong>
          <button type="button" class="cargo-link" id="cargoPriorityClear">Todas as cidades</button></div>
        <div id="cargoPriorityCities" class="cargo-priority-cities"></div>
      </aside>
    </div>
    <p class="cargo-priority-note">Prioridade pela quantidade de pedidos disponíveis no Força de Vendas. A cidade selecionada mostra a idade dos pedidos e o peso informado no recorte.</p>
  </section>`;
}

function cargoPriorityDraw(box, features, cities, pick, view) {
  const locs = new Map(cities.filter(city => city.uf).map(city => [city.key,[city]]));
  const metric = rows => rows[0]?.orderCount ?? 0;
  const fmt = orderCount;
  const max = Math.max(1,...cities.map(city => city.orderCount));
  const ufs = new Set(cities.map(city => city.uf).filter(Boolean));
  const visible = features.filter(feature => !ufs.size || ufs.has(feature.properties.SIGLA_UF));
  box.innerHTML = '';
  const map = L.map(box,{zoomControl:true,attributionControl:false,minZoom:4,maxZoom:12,scrollWheelZoom:true});
  state.map = map;
  const keyOf = feature => aliasCity(feature.properties.NM_MUN)+'|'+feature.properties.SIGLA_UF;
  const layer = L.geoJSON({type:'FeatureCollection',features:visible},{
    style:feature => {
      const key = keyOf(feature), city = locs.get(key)?.[0];
      const count = city?.orderCount ?? 0;
      const selected = key === FEXP.priorityCity;
      const t = Math.pow(Math.max(0,count/max),.65);
      const rgb = [255,235,211].map((x,i)=>Math.round(x+([174,69,15][i]-x)*t));
      return {color:selected?'#59300f':city?'#9e633c':'#d9c6b6',weight:selected?3:city?1:.5,
        fillColor:city?'rgb('+rgb.join(',')+')':'#eee8e2',fillOpacity:city ? .95 : .45};
    },
    onEachFeature:(feature, polygon) => {
      const key = keyOf(feature), city = locs.get(key)?.[0];
      if (!city) return;
      polygon.bindTooltip('<b>'+esc(city.city)+' · '+esc(city.uf)+'</b><br>'+
        fmt(city.orderCount)+(city.orderCount===1?' disponível':' disponíveis'),{sticky:true});
      polygon.on('click',()=>pick(key));
    }
  }).addTo(map);
  const focus = L.featureGroup(layer.getLayers().filter(polygon=>locs.has(keyOf(polygon.feature))));
  if (view) map.setView(view.center,view.zoom);
  else if (focus.getBounds().isValid()) map.fitBounds(focus.getBounds(),{padding:[18,18],maxZoom:8});
  else map.setView([-7.5,-40],5);
  logMapLabels(map,layer,locs,metric,fmt);
  requestAnimationFrame(()=>{if(box.isConnected && state.map===map)map.invalidateSize();});
  return () => layer.setStyle(layer.options.style);
}

function cargoPriorityBind(panel, orders, view) {
  const list = panel.querySelector('#cargoPriorityCities');
  const box = panel.querySelector('#cargoPriorityMap');
  const clear = panel.querySelector('#cargoPriorityClear');
  const results = $('#cargoPlanOrders');
  const selection = $('#cargoPlanSelection');
  const today = transportToday();
  let updateMap = null;
  let model = cargoPriorityCities(orders,LOG.geo?.features || []);
  const syncCity = previousCity => {
    if (!FEXP.priorityCity || model.ranked.some(city=>city.key===FEXP.priorityCity)) return;
    const resolved = previousCity && !previousCity.uf ? model.location(previousCity).key : '';
    FEXP.priorityCity = model.ranked.some(city=>city.key===resolved) ? resolved : '';
    FEXP.page = 0;
  };

  const renderOrders = () => {
    const city = model.ranked.find(item=>item.key===FEXP.priorityCity);
    const filtered = city ? orders.filter(order=>model.location(order).key===city.key) : orders;
    if (FEXP.page*30>=filtered.length) FEXP.page=0;
    results.innerHTML = (city ? cargoPlanCitySummary(city,filtered,today) : '')
      + formationTable(filtered,FEXP.selected);
    formationBindOrders(results,FEXP.selected,renderOrders);
    selection.innerHTML=canLog('formation','edit')?formationSummary(FEXP.data.orders.filter(order=>FEXP.selected.has(order.key))):'';
    formationBindPlanActions(selection,renderOrders);
    results.querySelectorAll('[data-formation-detail]').forEach(button=>button.onclick=()=>formationDetail(button.dataset.formationDetail));
    cargoBindOrderPreviews(results);
  };
  const pick = key => {
    FEXP.priorityCity = FEXP.priorityCity===key ? '' : key;
    FEXP.page = 0;
    for (const button of list.querySelectorAll('[data-cargo-city]')) {
      button.setAttribute('aria-pressed',String(button.dataset.cargoCity===FEXP.priorityCity));
    }
    clear.disabled = !FEXP.priorityCity;
    updateMap?.();
    renderOrders();
  };
  const renderCities = () => {
    list.innerHTML = model.ranked.map(city => `<button type="button" data-cargo-city="${esc(city.key)}" aria-pressed="${city.key===FEXP.priorityCity}">
      <span><strong>${esc(city.city)}${city.uf?' · '+esc(city.uf):''}</strong></span>
      <span>${orderCount(city.orderCount)}</span></button>`).join('') || '<p>Nenhuma cidade no recorte.</p>';
    clear.disabled = !FEXP.priorityCity;
  };
  clear.onclick = () => pick('');
  list.onclick = event => {
    const button = event.target.closest('[data-cargo-city]');
    if (button) pick(button.dataset.cargoCity);
  };

  syncCity();
  renderCities();
  renderOrders();
  Promise.all([logGeo(),centralLeaflet()]).then(([geo]) => {
    if (!panel.isConnected) return;
    const features = geo.features || [];
    const previousCity = model.ranked.find(city=>city.key===FEXP.priorityCity);
    model = cargoPriorityCities(orders,features);
    syncCity(previousCity);
    renderCities();
    renderOrders();
    updateMap = cargoPriorityDraw(box,features,model.ranked,pick,view);
  }).catch(() => {
    if (!panel.isConnected) return;
    if (state.map?.getContainer() === box) { state.map.remove(); state.map = null; }
    box.textContent = 'Mapa indisponível. Use a lista de cidades para filtrar.';
  });
}

function formationShow() {
  if (state.module!=='logistics' || LOG.page!=='formation') return;
  LOG.epoch++;
  const oldMap = state.map;
  const priorityView = oldMap?.getContainer?.().id === 'cargoPriorityMap'
    ? {center:oldMap.getCenter(),zoom:oldMap.getZoom()} : null;
  destroyCharts();
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  LOG.kind = 'operations';
  $('#refreshData').hidden = true;
  $('#content').className = 'visual-page logistics-content formation-workspace-v2';
  $('.filterbar:not(#logFilters)')?.classList.add('hidden');
  $('#dataStatus').classList.add('hidden');
  $('#pageTitle').textContent = 'Montagem de cargas';
  $('#pageSubtitle').textContent = 'Selecione pedidos, confira o peso e organize as entregas.';
  $('#activeMenuLabel').textContent = 'Logística · Montagem de cargas';
  logNav();
  if (!FEXP.data) {
    $('#content').innerHTML='<section class="panel cargo-empty">Consultando os pedidos e as montagens…</section>';
    formationReload();
    return;
  }
  const d = FEXP.data;
  if (!FEXP.directInitialized) {
    LOG.filters.year = 'Todos';
    LOG.filters.month = 'Todos';
    FEXP.directInitialized = true;
  }
  if (FEXP.tab==='plan') logFilters(d.mapRows);
  else $('#logFilters')?.classList.add('hidden');
  $('#lastBaseUpdate').textContent = 'Consulta: '+cargoDate(d.updatedAt);
  $('#periodChip').textContent = 'Força de Vendas';

  const tabs = [['plan','Pedidos disponíveis'],['montages','Montagens',CARGO_OPEN],['routing','Roteirização',CARGO_PENDING],['finished','Finalizadas',CARGO_FINAL],['history','Histórico']];
  let html = `<div class="cargo-workspace-top"><nav class="cargo-tabs" aria-label="Montagem de cargas">${tabs.map(([k,l,status]) =>
    `<button type="button" data-formation-tab="${k}" class="${FEXP.tab===k?'active':''}">
      ${l}${status?` <span>${d.montages.filter(m=>m.status===status).length}</span>`:''}</button>`
  ).join('')}</nav><button class="btn" id="formationRefresh">Atualizar</button></div>`;
  let m = d.montages.find(x => x.id===FEXP.montage);
  let orders = [];
  if (FEXP.tab==='plan') {
    orders = formationOrderRows();
    html += `<section class="panel cargo-plan"><div class="cargo-section-heading"><div><h2>Escolha os pedidos da carga</h2>
      <p>Use a cidade ou a busca para localizar clientes e produtos.</p></div>
      ${canLog('formation','edit')?'<button class="cargo-link" id="formationCreateEmpty">Criar montagem vazia</button>':''}</div>
      <label class="cargo-search">Buscar pedido, cliente ou produto<input type="search" id="formationQuery" value="${esc(FEXP.query)}"
       placeholder="Digite o pedido, nome do cliente ou produto"></label>
      <label class="cargo-invoice-filter"><input type="checkbox" id="formationWithoutInvoice" ${FEXP.withoutInvoice?'checked':''}> Somente pedidos sem nota fiscal</label>
      ${cargoPriorityMarkup()}<div id="cargoPlanOrders"></div>
      </section><div id="cargoPlanSelection"></div>`;
  } else if (['routing','finished'].includes(FEXP.tab)) {
    html += cargoRouteQueue(d,FEXP.tab==='finished');
    m = d.montages.find(item=>item.id===FEXP.routeExpanded);
  } else if (FEXP.tab==='montages') {
    if (m?.status===CARGO_OPEN && FEXP.montageDetail) {
      html += '<button type="button" class="cargo-link" id="cargoBackToBoard">← Todas as montagens</button>';
      html += cargoMontageDetail(m);
    } else {
      html += cargoMontageBoard(d);
    }
  } else html += cargoHistory(d);

  $('#content').innerHTML = html;
  formationBind();
  $('#formationRefresh').onclick = () => {
    if (['routing','finished'].includes(FEXP.tab)) CARGO_ROUTE.draft = null;
    formationReload(true);
  };
  cargoBind(m);
  cargoBindOrderPreviews();
  const board = $('#cargoMontageBoard');
  if (board) cargoBindMontageBoard(board);
  $('#cargoBackToBoard')?.addEventListener('click', () => cargoSwitchFormationTab('montages'));
  cargoBindWorkflow();
  if (FEXP.tab==='plan') {
    cargoPriorityBind($('#cargoPriority'),orders,priorityView);
    $('#formationWithoutInvoice').onchange = event => {
      FEXP.withoutInvoice = event.currentTarget.checked;
      FEXP.page = 0;
      formationShow();
      $('#formationWithoutInvoice')?.focus({preventScroll:true});
    };
  }
  if (!FEXP.timer) FEXP.timer = setInterval(()=>{
    if (state.module==='logistics' && LOG.page==='formation' && (['plan','montages','history','finished'].includes(FEXP.tab)||FEXP.tab==='routing'&&!FEXP.routeExpanded)
        && !document.hidden && !document.querySelector('.formation-dialog[open], .cargo-montage-board.is-dragging, .cargo-montage-order-menu[open]') && !FEXP.busy) {
      formationReload();
    }
  },120000);
}

async function cargoSave(payload,dialog,status) {
  if(FEXP.busy)return;
  FEXP.busy=true;
  const requestId=dialog.dataset.requestId||(dialog.dataset.requestId=crypto.randomUUID().replace(/-/g,''));
  const settings=LOG.page==='settings';
  const revision=settings?CARGO_SETTINGS.data.revision:FEXP.data.revision;
  dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
  status.textContent='Salvando na planilha…';
  let result;
  try{
    result=await formationApi({action:'fleetSave',revision,requestId,...payload});
  }catch(error){
    status.textContent=error.message;
    dialog.querySelectorAll('button').forEach(button=>button.disabled=false);
    FEXP.busy=false;
    return;
  }
  dialog.close();
  cargoOverviewInvalidate();
  const message=result.message+(result.projectionWarning?' O histórico foi salvo; as abas auxiliares estão pendentes.':'');
  try{
    if(settings){
      if(result.settings){
        CARGO_SETTINGS.data=result.settings;
        cargoSettingsShow();
      }else await cargoSettingsLoad();
      // Ao voltar para montagens, recarrega as configurações alteradas.
      FEXP.data=null;
      formationNotice(message);
      return;
    }
    if(payload.operation==='ENVIAR_ROTEIRO'){
      CARGO_ROUTE.draft=null;
      FEXP.tab='routing';
      FEXP.montage=result.montageId||payload.target;
      FEXP.routeExpanded='';
    }
    if(['ROTEIRO_SALVAR','REABRIR'].includes(payload.operation))CARGO_ROUTE.draft=null;
    if(payload.operation==='ROTEIRO_SALVAR' && payload.route.confirmed){
      FEXP.tab='finished';
      FEXP.finalPeriod='7';
      FEXP.routeExpanded=payload.target;
    }
    if(payload.operation==='REABRIR'){
      FEXP.tab='montages';
      FEXP.montage=payload.target;
      FEXP.montageDetail=true;
      FEXP.assemblySelected.clear();
      FEXP.routeExpanded='';
    }
    if(result.view){
      formationApplyView(result.view);
      formationShow();
      formationNotice(message);
    }else{
      formationNotice(message+' Atualizando a tela…');
      if(FEXP.pending)await FEXP.pending;
      const updated=await formationReload();
      formationNotice(message+(updated?'':' Atualize a tela para ver a alteração.'));
    }
  }finally{
    FEXP.busy=false;
  }
}

function cargoFinishDialog(reopen=false) {
  const m = FEXP.data.montages.find(x=>x.id===FEXP.montage);
  const dialog = cargoForm(reopen?'Reabrir montagem':'Enviar para roteirização',`
    ${cargoStatus(m)}<h3>${esc(m.name)}</h3><p>${m.orders} pedidos · ${cargoKg(m.totalWeightKg)}</p>
    <p>${esc(m.vehicle?cargoVehicleLabel(m.vehicle):'')} · ${esc(m.driver)}</p>
    ${reopen?'':cargoAlertList(m.alerts,'Alertas que ficarão no histórico')}
    <p class="cargo-help">${reopen?'A composição poderá ser editada novamente. O roteiro anterior fica no histórico e a nova composição precisa ser roteirizada.':'A composição será concluída e a carga entrará na fila de roteirização.'}</p>
    <label class="cargo-confirm"><input name="confirmed" type="checkbox" required>Confirmo ${reopen?'a reabertura':'o envio para roteirização'} desta montagem.</label>`,
    f=>({operation:reopen?'REABRIR':'ENVIAR_ROTEIRO',target:m.id,confirmed:f.elements.confirmed.checked}));
  dialog.querySelector('button[type=submit]').textContent=reopen?'Reabrir montagem':'Enviar para roteirização';
}

function cargoBind(m) {
  $('#cargoWeights')?.addEventListener('click',cargoWeightsDialog);
  $('#cargoFinish')?.addEventListener('click',()=>cargoFinishDialog());
  $('#cargoReopen')?.addEventListener('click',()=>cargoFinishDialog(true));
  $('#cargoOpenRoute')?.addEventListener('click',()=>cargoRouteOpen(m.id));
  if ($('#cargoRouteStops')) cargoRouteBind(m);

  const form = $('#cargoDispatchForm');
  if (!form) return;
  const vehicle = form.elements.vehicle, driver = form.elements.driver;
  const labels = () => {
    $('[data-selected-label="vehicle"]').textContent=vehicle.value?vehicle.selectedOptions[0]?.textContent||'':'';
    $('[data-selected-label="driver"]').textContent=driver.value?driver.selectedOptions[0]?.textContent||'':'';
  };
  vehicle.onchange = () => {
    const v = FEXP.data.fleet.vehicles.find(v=>v.plate===vehicle.value);
    if (v?.defaultDriver && [...driver.options].some(o=>o.value===v.defaultDriver)) driver.value=v.defaultDriver;
    labels();
  };
  driver.onchange = labels;
  form.onsubmit = event => {
    event.preventDefault();
    cargoForm('Confirmar veículo e motorista', `<p>${esc(vehicle.selectedOptions[0]?.textContent)}</p><p>Motorista: ${esc(driver.value)}</p>`,
      () => ({operation:'CONFIGURAR_CARGA',target:m.id,vehicleId:vehicle.value,driver:driver.value}));
  };
}

const AGENDA = {month:'',week:'',ranges:new Map(),pending:new Map(),options:null,revision:0};
const CARGO_OVERVIEW = {data:null,pending:null};

function canLog(key,mode='view') {
  const p=state.user?.permissions?.[key];
  if(p)return p[mode]===true;
  if(key==='sac')return mode==='view'?logAllowed():state.user?.editTransport===true;
  return logAllowed()&&!state.user?.transportOnly&&(mode==='view'||key==='formation');
}

function logPageAllowed(page) {
  if(page==='overview'&&logOverviewArea())return canLog(logOverviewArea());
  if(page==='formation')return canLog('formation');
  if(page==='agenda')return canLog('agenda');
  if(page==='transport')return canLog('sac');
  if(state.user?.formationOnly||state.user?.transportOnly)return false;
  if(page==='settings')return canLog('formation');
  if(page==='sources')return state.user?.perfil==='ADMIN';
  return logAllowed()&&(page==='overview'||canLog('formation')&&Object.hasOwn(LOG_PAGES,page));
}

function agendaApi(action,p={}) {
  return api('/api/logistics',{body:JSON.stringify({kind:'agenda',action,...p})});
}

function agendaWeek(date) {
  return transportDayShift(date,-new Date(date+'T12:00:00Z').getUTCDay());
}

function agendaMonthShift(month,delta) {
  const [year,n]=month.split('-').map(Number);
  return new Date(Date.UTC(year,n-1+delta,1)).toISOString().slice(0,7);
}

function agendaMonthDays(month) {
  const first=month+'-01',last=transportDayShift(agendaMonthShift(month,1)+'-01',-1);
  const start=agendaWeek(first),end=transportDayShift(agendaWeek(last),6);
  return {start,end,days:Array.from({length:1+Math.round((Date.parse(end)-Date.parse(start))/86400000)},(_,i)=>transportDayShift(start,i))};
}

function agendaDateLabel(date,long=false) {
  return new Intl.DateTimeFormat('pt-BR',long?
    {timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}:
    {timeZone:'UTC',day:'2-digit',month:'2-digit'}).format(new Date(date+'T12:00:00Z'));
}

async function agendaRange(from,to,force=false) {
  if(!force){
    for(const range of AGENDA.ranges.values()){
      if(range.from<=from&&range.to>=to&&Date.now()-range.at<90000)return range.rows.filter(r=>r.date>=from&&r.date<=to);
    }
  }
  const revision=AGENDA.revision,key=from+'|'+to+'|'+revision;
  if(AGENDA.pending.has(key))return AGENDA.pending.get(key);
  const request=agendaApi('read',{from,to}).then(({rows})=>{
    if(revision!==AGENDA.revision)return agendaRange(from,to);
    AGENDA.ranges.set(key,{from,to,rows,at:Date.now()});
    if(AGENDA.ranges.size>16)AGENDA.ranges.delete(AGENDA.ranges.keys().next().value);
    return rows;
  }).finally(()=>AGENDA.pending.delete(key));
  AGENDA.pending.set(key,request);
  return request;
}

function agendaMontageLink(m) {
  return `<button type="button" class="cargo-link" data-agenda-montage="${esc(m.id)}">${esc(m.name)}</button> ${cargoStatus(m)}`;
}

function agendaActivity(item) {
  const activity=String(item.activity||'').trim();
  const destination=String(item.destination||'').trim();
  const generic=/^programa[cç][aã]o$/iu.test(activity);
  return generic||!activity?destination||'Atividade a definir':activity;
}

function agendaCalendarItem(item) {
  const activity=agendaActivity(item);
  const incident=item.montage?cargoIncidentLines(item.montage):[];
  const title=[item.time,item.driver,activity,item.destination!==activity?item.destination:''].filter(Boolean).join(' · ');
  return `<div class="driver-calendar-entry"><button type="button" class="driver-calendar-event" data-agenda-program="${esc(item.id)}"
    title="${esc(title)}">${esc([item.time,item.driver].filter(Boolean).join(' '))}<small>${esc(activity)}</small></button>
    ${incident.length?`<button type="button" class="driver-calendar-alert" data-agenda-incident="${esc(item.id)}"
      title="${esc('Excesso de peso · '+incident.at(-1))}" aria-label="Consultar ocorrência da carga de ${esc(item.driver)}"><i class="cargo-state-dot red" aria-hidden="true"></i></button>`:''}</div>`;
}

function agendaCompactWeek(groups,model,today) {
  const days=Array.from({length:7},(_,i)=>transportDayShift(model.start,i));
  const day=days.includes(AGENDA.overviewDay)?AGENDA.overviewDay:days.includes(today)?today:days.find(d=>groups.has(d))||days[0];
  const items=groups.get(day)||[];
  const labels=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  return `<div class="overview-agenda-days" role="group" aria-label="Dia da semana">${days.map((date,i)=>`<button type="button"
    data-agenda-overview-day="${date}" aria-pressed="${date===day}" aria-label="${esc(agendaDateLabel(date,true))}">
    ${labels[i]} <strong>${Number(date.slice(8))}</strong></button>`).join('')}</div>
    ${items.length?`<div class="overview-scroll overview-agenda-items" tabindex="0" aria-label="Programações do dia">${items.map(agendaProgram).join('')}</div>`:'<p>Nenhuma programação neste dia.</p>'}`;
}

function agendaProgram(item) {
  const activity=agendaActivity(item);
  return `<article class="driver-program"><button type="button" class="driver-program-link" data-agenda-program="${esc(item.id)}">
    ${item.time?`<time>${esc(item.time)}</time>`:''}<strong>${esc(item.driver)}</strong><span>${esc(activity)}</span>
    ${item.destination&&item.destination!==activity?`<small>${esc(item.destination)}</small>`:''}${item.vehicle?`<small>${esc(item.vehicle)}</small>`:''}</button>
    ${item.montage?`<div class="driver-program-montage">${agendaMontageLink(item.montage)}</div>`:''}</article>`;
}

function agendaBindPrograms(root,rows) {
  const items=new Map(rows.map(r=>[r.id,r]));
  root.querySelectorAll('[data-agenda-program]').forEach(button=>button.onclick=()=>{
    button.closest('dialog')?.close();
    agendaItemDialog(items.get(button.dataset.agendaProgram));
  });
  root.querySelectorAll('[data-agenda-montage]').forEach(button=>button.onclick=()=>openLogMontage(button.dataset.agendaMontage));
  root.querySelectorAll('[data-agenda-incident]').forEach(button=>button.onclick=()=>{
    const item=items.get(button.dataset.agendaIncident);
    if(!item?.montage)return;
    const lines=cargoIncidentLines(item.montage);
    formationDialog('Ocorrência da carga',`<p><strong>${esc(item.montage.name)}</strong> · ${esc(item.driver)}</p>
      <p>Excesso de peso registrado</p><ul>${lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`);
  });
}

function agendaSelectedDay(period,today) {
  const selected = AGENDA.monthDay;
  return selected?.slice(0,7)===period ? selected : today.startsWith(period) ? today : period+'-01';
}

function agendaListDay(groups,period,date,editable,today) {
  const items = groups.get(date) || [];
  const first = period+'-01', last = transportDayShift(agendaMonthShift(period,1)+'-01',-1);
  return `<section class="driver-agenda-day-list" aria-label="Programação por dia">
    <div class="driver-day-list-toolbar">
      <button class="btn" type="button" data-agenda-list-shift="-1" ${date===first?'disabled':''} aria-label="Dia anterior">←</button>
      <label>Data da programação<input type="date" data-agenda-list-date value="${date}" min="${first}" max="${last}"></label>
      <button class="btn" type="button" data-agenda-list-shift="1" ${date===last?'disabled':''} aria-label="Dia seguinte">→</button>
    </div>
    <div class="driver-day-list-header"><div><h3>${esc(agendaDateLabel(date,true))}${date===today?' · Hoje':''}</h3>
      <p>${logN(items.length)} ${items.length===1?'programação':'programações'}</p></div>
      ${editable?`<button type="button" class="btn" data-agenda-create-day="${date}">Adicionar neste dia</button>`:''}</div>
    <div class="driver-program-grid">${items.map(agendaProgram).join('')||'<p>Nenhuma programação nesta data.</p>'}</div>
  </section>`;
}

async function agendaRender(root,monthly,force=false) {
  if(!root)return;
  const today=transportToday();
  const compact=!monthly&&LOG.page==='overview',editable=canLog('agenda','edit');
  AGENDA.month ||= today.slice(0,7);
  if(monthly)AGENDA.monthView ||= globalThis.matchMedia?.('(max-width:700px)')?.matches?'list':'calendar';
  AGENDA.week ||= agendaWeek(today);
  const period=monthly?AGENDA.month:AGENDA.week;
  const model=monthly?agendaMonthDays(period):{start:period,end:transportDayShift(period,6)};
  const label=monthly?new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(period+'-01T12:00:00Z')):'Programação da semana';
  const render=(rows=null,error='')=>{
    const groups=new Map();
    for(const row of rows||[]){
      if(!groups.has(row.date))groups.set(row.date,[]);
      groups.get(row.date).push(row);
    }
    const listView=monthly&&AGENDA.monthView==='list';
    const day=monthly?agendaSelectedDay(period,today):'';
    const mode=monthly?`<div class="driver-agenda-mode" role="group" aria-label="Visualização da agenda">
      ${[['calendar','Calendário'],['list','Por dia']].map(([value,text])=>`<button type="button" class="btn ${AGENDA.monthView===value?'active':''}"
        data-agenda-mode="${value}" aria-pressed="${AGENDA.monthView===value}">${text}</button>`).join('')}</div>`:'';
    const arrows=`<button type="button" class="btn" data-agenda-shift="-1" aria-label="${monthly?'Mês anterior':'Semana anterior'}">←</button>
      <button type="button" class="btn" data-agenda-shift="1" aria-label="${monthly?'Mês seguinte':'Semana seguinte'}">→</button>`;
    const calendar=()=>`<div class="driver-calendar">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day=>`<div class="driver-calendar-weekday">${day}</div>`).join('')}
      ${model.days.map(date=>{
        const items=groups.get(date)||[];
        return `<div class="driver-calendar-day ${date.slice(0,7)!==period?'is-adjacent':''} ${date===today?'is-today':''}">
          <button type="button" class="driver-day-number" aria-label="${esc(agendaDateLabel(date,true))}" ${date===today?'aria-current="date"':''} data-agenda-day="${date}">${Number(date.slice(8))}</button>
          ${editable?`<button type="button" class="driver-calendar-create" data-agenda-create-day="${date}" aria-label="Criar programação para ${esc(agendaDateLabel(date,true))}"></button>`:''}
          ${items.slice(0,2).map(agendaCalendarItem).join('')}
          ${items.length>2?`<button type="button" class="driver-calendar-more" data-agenda-day="${date}">+${items.length-2}</button>`:''}</div>`;
      }).join('')}</div>`;
    const week=()=>[...groups].map(([date,items])=>`<section class="driver-week-day"><h3>${esc(agendaDateLabel(date,true))}</h3>
      <div class="driver-program-grid">${items.map(agendaProgram).join('')}</div></section>`).join('')||'<p>Nenhuma programação nesta semana.</p>';
    root.innerHTML=`<header class="driver-agenda-heading"><div><h2>${esc(label)}</h2><p>${monthly?(listView?'Selecione um dia para ver os motoristas, destinos e veículos.':editable?'Clique no espaço livre de um dia para criar uma programação.':'Selecione um dia para consultar a programação.'):
      `<strong>${agendaDateLabel(model.start)} a ${agendaDateLabel(model.end)}</strong> · domingo a sábado`}</p></div>
      <div class="driver-agenda-actions">${arrows}
      ${monthly?'<button type="button" class="btn" data-agenda-today>Hoje</button>':''}
      ${monthly&&canLog('agenda','edit')?'<button type="button" class="btn primary" data-agenda-new>Nova programação</button>':''}
      ${!monthly&&LOG.page==='overview'?'<button type="button" class="btn" data-agenda-open>Abrir agenda</button>':''}</div></header>
      ${mode}${error?`<p role="status">${esc(error)} <button type="button" class="btn" data-agenda-retry>Tentar novamente</button></p>`:
        rows===null?'<p role="status">Consultando programação…</p>':
        monthly?(listView?agendaListDay(groups,period,day,editable,today):calendar()):compact?agendaCompactWeek(groups,model,today):week()}`;
    root.querySelectorAll('[data-agenda-mode]').forEach(button=>button.onclick=()=>{
      AGENDA.monthView=button.dataset.agendaMode;
      render(rows,error);
      root.querySelector('[data-agenda-mode][aria-pressed="true"]')?.focus();
    });
    const selectDay=value=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!value.startsWith(period)||!model.days.includes(value))return;
      AGENDA.monthDay=value;
      render(rows,error);
      root.querySelector('[data-agenda-list-date]')?.focus();
    };
    const dateField=root.querySelector('[data-agenda-list-date]');
    if(dateField)dateField.onchange=()=>selectDay(dateField.value);
    root.querySelectorAll('[data-agenda-list-shift]').forEach(button=>button.onclick=()=>{
      selectDay(transportDayShift(day,Number(button.dataset.agendaListShift)));
    });
    root.querySelectorAll('[data-agenda-shift]').forEach(b=>b.onclick=()=>{
      const delta=Number(b.dataset.agendaShift);
      if(monthly)AGENDA.month=agendaMonthShift(period,delta);
      else AGENDA.week=transportDayShift(period,delta*7);
      AGENDA.overviewDay='';
      agendaRender(root,monthly);
    });
    const todayButton=root.querySelector('[data-agenda-today]');
    if(todayButton)todayButton.onclick=()=>{AGENDA.month=today.slice(0,7);AGENDA.monthDay=today;AGENDA.week=agendaWeek(today);agendaRefreshVisible();};
    const add=root.querySelector('[data-agenda-new]');
    if(add)add.onclick=()=>agendaEditDialog({date:listView?day:today.startsWith(period)?today:period+'-01'});
    const retry=root.querySelector('[data-agenda-retry]');
    if(retry)retry.onclick=()=>agendaRender(root,monthly,true);
    const open=root.querySelector('[data-agenda-open]');
    if(open)open.onclick=()=>{AGENDA.month=period.slice(0,7);LOG.page='agenda';logShow();};
    root.querySelectorAll('[data-agenda-day]').forEach(b=>b.onclick=()=>agendaDayDialog(b.dataset.agendaDay,groups.get(b.dataset.agendaDay)||[]));
    root.querySelectorAll('[data-agenda-create-day]').forEach(b=>b.onclick=()=>agendaEditDialog({date:b.dataset.agendaCreateDay}));
    root.querySelectorAll('[data-agenda-overview-day]').forEach(b=>b.onclick=()=>{
      AGENDA.overviewDay=b.dataset.agendaOverviewDay;
      render(rows);
      root.querySelector('[aria-pressed="true"]')?.focus();
    });
    agendaBindPrograms(root,rows||[]);
  };
  render();
  const current=()=>root.isConnected&&(monthly?AGENDA.month:AGENDA.week)===period;
  try{
    const rows=await agendaRange(model.start,model.end,force);
    if(current())render(rows);
  }catch(error){if(current())render(null,error.message);}
}

function agendaDayDialog(date,items) {
  const dialog=formationDialog(agendaDateLabel(date,true),`<div class="driver-program-grid">${items.map(agendaProgram).join('')||'<p>Nenhuma programação neste dia.</p>'}</div>
    ${canLog('agenda','edit')?'<footer><button type="button" class="btn primary" data-agenda-new>Nova programação</button></footer>':''}`);
  agendaBindPrograms(dialog,items);
  const add=dialog.querySelector('[data-agenda-new]');
  if(add)add.onclick=()=>{dialog.close();agendaEditDialog({date});};
}

function agendaItemDialog(item) {
  if(!item)return;
  const dialog=formationDialog(agendaActivity(item),`<div class="driver-agenda-details">
    <strong>${esc(item.driver)}</strong><p>${esc(agendaDateLabel(item.date,true))}${item.time?' · '+esc(item.time):''}</p>
    ${item.destination?`<p><strong>Destino</strong> ${esc(item.destination)}</p>`:''}
    ${item.vehicle?`<p><strong>Veículo</strong> ${esc(item.vehicle)}</p>`:''}
    ${item.notes?`<p class="driver-agenda-notes"><strong>Observações</strong> ${esc(item.notes)}</p>`:''}
    ${item.montage?`<div>${agendaMontageLink(item.montage)}</div>`:''}</div>
    ${canLog('agenda','edit')?'<footer><button type="button" class="btn" data-agenda-edit>Editar programação</button></footer>':''}`);
  agendaBindPrograms(dialog,[item]);
  const edit=dialog.querySelector('[data-agenda-edit]');
  if(edit)edit.onclick=()=>{dialog.close();agendaEditDialog(item);};
}

async function agendaEditDialog(item) {
  if(!canLog('agenda','edit'))return;
  const dialog=formationDialog(item.id?'Editar programação':'Nova programação',`<form class="cargo-form driver-agenda-form">
    <label>Motorista<input name="driver" list="agendaDriverOptions" value="${esc(item.driver||'')}" required maxlength="120"><datalist id="agendaDriverOptions"></datalist></label>
    <div class="driver-agenda-form-pair"><label>Data<input name="date" type="date" value="${esc(item.date)}" required></label>
    <label>Horário<input name="time" type="time" value="${esc(item.time||'')}"></label></div>
    <label>Atividade<input name="activity" value="${esc(item.activity||'')}" required maxlength="180"></label>
    <label>Destino ou destinos<textarea name="destination" rows="2" maxlength="500">${esc(item.destination||'')}</textarea></label>
    <label>Veículo ou placa<input name="vehicle" list="agendaVehicleOptions" value="${esc(item.vehicle||'')}" maxlength="120"><datalist id="agendaVehicleOptions"></datalist></label>
    ${canLog('formation')?`<label>Montagem vinculada<select name="montageId" disabled><option value="${esc(item.montageId||'')}">${esc(item.montage?.name||'Nenhuma')}</option></select></label>`:''}
    <label>Observações<textarea name="notes" rows="3" maxlength="1200">${esc(item.notes||'')}</textarea></label>
    <small data-agenda-options></small><p role="status" class="cargo-form-status"></p>
    <footer><button type="submit" class="btn primary">Salvar programação</button></footer></form>`);
  const form=dialog.querySelector('form'),status=dialog.querySelector('[role=status]'),button=form.querySelector('[type=submit]');
  let pending=false,requestId='',signature='';
  form.onsubmit=async e=>{
    e.preventDefault();
    if(pending)return;
    const values=Object.fromEntries(new FormData(form));
    if(!Object.hasOwn(values,'montageId'))values.montageId=item.montageId||'';
    const nextSignature=JSON.stringify(values);
    if(signature!==nextSignature){signature=nextSignature;requestId=crypto.randomUUID().replace(/-/g,'');}
    pending=true;button.disabled=true;status.textContent='Salvando na planilha…';
    try{
      const result=await agendaApi('save',{requestId,item:{id:item.id,version:item.version,...values}});
      AGENDA.revision++;
      for(const range of AGENDA.ranges.values()){
        range.rows=range.rows.filter(r=>r.id!==result.item.id);
        if(result.item.date>=range.from&&result.item.date<=range.to){
          range.rows.push(result.item);
          range.rows.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.driver.localeCompare(b.driver,'pt-BR'));
        }
      }
      if(LOG.page==='agenda'){AGENDA.month=result.item.date.slice(0,7);AGENDA.week=agendaWeek(result.item.date);}
      dialog.close();
      agendaRefreshVisible();
      formationNotice(result.message);
    }catch(error){status.textContent=error.message;}
    finally{pending=false;button.disabled=false;}
  };
  try{
    AGENDA.options ||= agendaApi('options').catch(error=>{AGENDA.options=null;throw error;});
    const data=await AGENDA.options;
    if(!dialog.open)return;
    const option=(value,label=value)=>`<option value="${esc(value)}">${esc(label)}</option>`;
    form.querySelector('#agendaDriverOptions').innerHTML=data.drivers.map(v=>option(v)).join('');
    form.querySelector('#agendaVehicleOptions').innerHTML=data.vehicles.map(v=>option(v.plate,cargoVehicleLabel(v))).join('');
    const montages=form.elements.montageId;
    if(montages){
      montages.innerHTML=option('','Nenhuma')+data.montages.map(m=>option(m.id,m.name+' · '+m.status)).join('');
      montages.value=item.montageId||'';
      montages.disabled=false;
    }
  }catch(error){form.querySelector('[data-agenda-options]').textContent='Sugestões indisponíveis. Você pode preencher os campos de texto.';}
}

function agendaRefreshVisible(force=false) {
  agendaRender($('#driverAgendaMonth'),true,force);
  agendaRender($('#driverAgendaWeek'),false,force);
}

function agendaShow() {
  ++LOG.epoch;
  destroyCharts();
  if(state.map){state.map.remove();state.map=null;}
  $('#content').className='visual-page logistics-content';
  $('#logFilters')?.classList.add('hidden');
  $('.filterbar:not(#logFilters)')?.classList.add('hidden');
  $('#dataStatus').classList.add('hidden');
  $('#pageTitle').textContent='Agenda de motoristas';
  $('#pageSubtitle').textContent='Calendário e programação de saídas, atividades e destinos.';
  $('#activeMenuLabel').textContent='Logística · Agenda de motoristas';
  $('#refreshData').hidden=true;
  $('#lastBaseUpdate').textContent='';
  $('#periodChip').textContent='Programação';
  logNav();
  $('#content').innerHTML=`${logPageAllowed('fleet')?'<div class="city-view-switch"><button type="button" id="logFleet">Motoristas e frota</button><button type="button" class="active" aria-current="page">Agenda de motoristas</button></div>':''}
    <section class="panel driver-agenda" id="driverAgendaMonth"></section><section class="panel driver-agenda" id="driverAgendaWeek"></section>`;
  $('#logFleet')?.addEventListener('click',()=>{LOG.page='fleet';logShow();});
  agendaRefreshVisible();
}

function cargoOverviewInvalidate() {
  CARGO_OVERVIEW.data=null;
  AGENDA.options=null;
  AGENDA.revision++;
  AGENDA.ranges.clear();
}

async function cargoOverviewRender(root,force=false) {
  if(!root)return;
  const render=(items,problem='')=>{
    root.innerHTML=`<header class="driver-agenda-heading"><div><h2>Cargas em Montagem</h2><p>Composição atual das cargas em aberto.</p></div></header>
      ${problem?`<p role="status">${esc(problem)} <button type="button" class="btn" data-cargo-overview-retry>Tentar novamente</button></p>`:items===null?
      '<p role="status">Consultando montagens…</p>':items.length?`<ul class="overview-scroll" tabindex="0" aria-label="Cargas em montagem">${items.map(m=>{
        const {percent,message}=cargoCapacityProgress(m);
        return `<li class="overview-cargo-row"><strong><button type="button" class="cargo-link" data-agenda-montage="${esc(m.id)}">${esc(m.name)}</button></strong>
          ${cargoStatus(m)}<span>${m.orders} pedido${m.orders===1?'':'s'}</span>
          ${percent===null?'':`<span class="overview-cargo-capacity">
            <meter min="0" max="100" value="${Math.min(100,percent)}" aria-label="Ocupação da capacidade" class="${percent>100?'is-exceeded':''}"></meter>
            <strong>${logN(percent,1)}%${m.unknownOrders?' <small>parcial</small>':''}</strong></span>`}
          <small class="overview-cargo-balance">${esc(message)}</small></li>`;
      }).join('')}</ul>`:'<p>Nenhuma carga em aberto.</p>'}`;
    agendaBindPrograms(root,[]);
    const retry=root.querySelector('[data-cargo-overview-retry]');
    if(retry)retry.onclick=()=>cargoOverviewRender(root,true);
  };
  if(!force&&CARGO_OVERVIEW.data&&Date.now()-CARGO_OVERVIEW.data.at<90000){render(CARGO_OVERVIEW.data.items);return;}
  if(!CARGO_OVERVIEW.data)render(null);
  CARGO_OVERVIEW.pending ||= api('/api/logistics',{body:JSON.stringify({kind:'formationSummary'})}).then(result=>{
    CARGO_OVERVIEW.data={...result,at:Date.now()};return result.items;
  }).finally(()=>CARGO_OVERVIEW.pending=null);
  try{const items=await CARGO_OVERVIEW.pending;if(root.isConnected)render(items);}
  catch(error){if(root.isConnected)render(null,error.message);}
}

function logOverviewExtras(overdue='') {
  const area=logOverviewArea();
  const compact=(area!=='sac'&&canLog('agenda')?'<section class="panel driver-agenda overview-compact" id="driverAgendaWeek"></section>':'')+
    (area!=='sac'&&canLog('formation')?'<section class="panel driver-agenda overview-compact" id="cargoOverview"></section>':'');
  return (compact?'<div class="overview-grid overview-widgets">'+compact+'</div>':'')+overdue;
}

function logBindOverviewExtras(force=false) {
  agendaRender($('#driverAgendaWeek'),false,force);
  cargoOverviewRender($('#cargoOverview'),force);
}

async function openLogMontage(id) {
  if(!logPageAllowed('formation'))return;
  document.querySelector('.formation-dialog[open]')?.close();
  if(!FEXP.data||!FEXP.data.montages.some(m=>m.id===id)||CARGO_OVERVIEW.data?.revision>FEXP.data.revision){
    const ok=await formationReload();
    if(!ok){formationNotice('Não foi possível consultar a montagem.');return;}
  }
  const m=FEXP.data?.montages.find(item=>item.id===id);
  if(!m){formationNotice('Montagem indisponível no seu recorte.');return;}
  LOG.page='formation';
  FEXP.view='experimental';
  FEXP.montage=id;
  FEXP.assemblySelected.clear();
  if(m.status===CARGO_OPEN){
    FEXP.tab='montages';FEXP.montageDetail=true;logShow();
  }else{
    if(m.status===CARGO_FINAL){FEXP.finalPeriod='custom';FEXP.finalStart=FEXP.finalEnd=transportToday(new Date(m.finalizedAt));}
    cargoRouteOpen(id);
  }
}
