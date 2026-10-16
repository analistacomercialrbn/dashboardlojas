const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const pct=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const kpi=(a,b,c='')=>'<div class="kpi-card"><div class="kpi-label">'+a+'</div><div class="kpi-value">'+b+'</div><div class="kpi-note">'+c+'</div></div>';
const months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out'];
const revenue=[7.1,7.4,7.0,7.8,8.2,7.9,8.5,8.8,8.1,8.6].map(x=>x*1e6);
let charts=[];
function clear(){charts.forEach(c=>c.destroy());charts=[]}
function chart(id,type,labels,data,opts={}){const c=new Chart($(id),{type,data:{labels,datasets:[{data,backgroundColor:'#1E2655',borderColor:'#1E2655',borderWidth:2,borderRadius:7,tension:.32,fill:type==='line'?true:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{color:'#EEF0F5'},ticks:{callback:v=>'R$ '+(v/1e6).toFixed(1)+' mi'}}},...opts}});charts.push(c)}
function overview(){
 $('#content').innerHTML='<div class="grid kpi-grid">'+
 kpi('Faturamento','R$ 8,6 mi','Recorte selecionado')+kpi('Meta','R$ 9,0 mi','Meta do mês')+kpi('Atingimento','95,6%','Realizado ÷ meta')+kpi('Clientes positivados','1.284','Clientes únicos')+kpi('Ticket médio','R$ 6,7 mil','Faturamento ÷ pedidos')+kpi('Mix médio','4,28','Produtos por cliente')+'</div>'+
 '<div class="grid insight-grid">'+
 '<div class="insight-card attention"><div class="insight-badge">● Atenção</div><div class="insight-value">R$ 400 mil</div><div class="insight-title">Gap para a meta</div><div class="insight-text">Acompanhar ritmo por RCA e departamento.</div></div>'+
 '<div class="insight-card opportunity"><div class="insight-badge">● Oportunidade</div><div class="insight-value">+6,2%</div><div class="insight-title">Crescimento x A-1</div><div class="insight-text">Acima do mesmo período do ano anterior.</div></div>'+
 '<div class="insight-card attention"><div class="insight-badge">● Atenção</div><div class="insight-value">112</div><div class="insight-title">Inativos curto prazo</div><div class="insight-text">Clientes entre 3 e 6 meses sem compra.</div></div>'+
 '<div class="insight-card critical"><div class="insight-badge">● Crítico</div><div class="insight-value">21%</div><div class="insight-title">Concentração</div><div class="insight-text">Maior RCA concentra parte relevante da venda.</div></div></div>'+
 '<div class="grid two-col"><div class="panel"><h2>Faturamento mês a mês</h2><div class="panel-sub">Ano selecionado</div><div class="chart-wrap"><canvas id="c1"></canvas></div></div>'+
 '<div class="panel"><h2>Ranking por RCA</h2><div class="panel-sub">Top 6 do recorte</div><div class="chart-wrap"><canvas id="c2"></canvas></div></div></div>';
 chart('#c1','line',months,revenue);
 chart('#c2','bar',['Samuel','Gleisson','Robson','Jorge','Dalana','Hudson'],[1.35,1.22,1.08,.95,.81,.67].map(x=>x*1e6),{indexAxis:'y'});
}
function carteira(){
 $('#content').innerHTML='<div class="grid kpi-grid">'+kpi('Positivados','1.284','Compraram no período')+kpi('Novos','84','Primeira compra no período')+kpi('Inativos • curto','112','3 a 6 meses')+kpi('Inativos • longo','267','3 a 12 meses')+kpi('Mix por cliente','4,28','Produtos distintos')+kpi('Produtos ativos','486','Itens faturados')+'</div>'+
 '<div class="grid two-col"><div class="panel"><h2>Inativos por RCA</h2><div class="panel-sub">Curto e longo prazo</div><div class="chart-wrap tall"><canvas id="c3"></canvas></div></div>'+
 '<div class="panel"><h2>Clientes inativos para ação</h2><div class="panel-sub">Priorizados por histórico de faturamento</div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>RCA</th><th>Última compra</th><th>Faixa</th></tr></thead><tbody>'+
 '<tr><td>Cliente Alfa</td><td>Samuel</td><td>12/06/2026</td><td><span class="badge red">Curto</span></td></tr><tr><td>Cliente Beta</td><td>Gleisson</td><td>28/03/2026</td><td><span class="badge amber">Longo</span></td></tr><tr><td>Cliente Gama</td><td>Robson</td><td>04/05/2026</td><td><span class="badge red">Curto</span></td></tr></tbody></table></div></div></div>';
 chart('#c3','bar',['Samuel','Gleisson','Robson','Jorge','Dalana'],[34,29,23,17,9],{indexAxis:'y'});
}
function produtos(){
 $('#content').innerHTML='<div class="grid kpi-grid four">'+kpi('Produtos faturados','486','SKUs com venda')+kpi('Clientes','1.284','Compradores')+kpi('Produto líder','R$ 612 mil','Núcleo Progress Terminação')+kpi('Top 2 RCA','38,4%','Concentração média')+'</div>'+
 '<div class="grid equal-col"><div class="panel"><h2>Produtos com maior faturamento</h2><div class="chart-wrap tall"><canvas id="c4"></canvas></div></div><div class="panel"><h2>Menores faturamentos</h2><div class="chart-wrap tall"><canvas id="c5"></canvas></div></div></div>';
 chart('#c4','bar',['Progress Terminação','MUB Beef Accelerator','Bovicalcio','Master LP','Combatt Pour On'],[612,548,432,388,344].map(x=>x*1000),{indexAxis:'y'});
 chart('#c5','bar',['Item A','Item B','Item C','Item D','Item E'],[8,11,14,18,21].map(x=>x*1000),{indexAxis:'y'});
}
function cidades(){
 $('#content').innerHTML='<div class="grid kpi-grid five">'+kpi('Cidades atendidas','184','Nordeste')+kpi('Faturamento','R$ 8,6 mi','Área filtrada')+kpi('Maior cidade','Fortaleza','R$ 1,1 mi')+kpi('Menor cidade','Pindoretama','R$ 18 mil')+kpi('Produtos no foco','486','Itens vendidos')+'</div>'+
 '<div class="grid city-layout"><div class="panel"><h2>Mapa da área</h2><div class="panel-sub">A versão conectada exibirá os municípios clicáveis.</div><div id="cityMap" style="display:grid;place-items:center"><div style="text-align:center;color:#737A8C"><div style="font-size:52px">⌖</div><strong>Mapa municipal</strong><div class="small-note">Seleção e drill-down preservados na versão conectada.</div></div></div></div>'+
 '<div class="panel"><h2>Cidades da área</h2><div class="city-list"><div class="city-row"><strong>Fortaleza - CE</strong><span>R$ 1,1 mi</span></div><div class="city-row"><strong>Tauá - CE</strong><span>R$ 640 mil</span></div><div class="city-row"><strong>Crateús - CE</strong><span>R$ 510 mil</span></div><div class="city-row"><strong>Itapajé - CE</strong><span>R$ 390 mil</span></div></div></div></div>'+
 '<div class="panel" style="margin-top:12px"><h2>Evolução mensal do faturamento</h2><div class="chart-wrap"><canvas id="c6"></canvas></div></div>';
 chart('#c6','line',months,[.68,.72,.66,.81,.77,.84,.89,.91,.86,.94].map(x=>x*1e6));
}
function metas(){
 $('#content').innerHTML='<div class="readonly-banner"><strong>Gestão de Metas.</strong> Na versão final manteremos planejamento, distribuição e aprovação com os mesmos perfis de acesso.</div>'+
 '<div class="grid kpi-grid four">'+kpi('Meta anual','R$ 112,0 mi','2026')+kpi('Faturamento','R$ 80,4 mi','Acumulado até outubro')+kpi('Atingimento','71,8%','Realizado ÷ meta anual')+kpi('Supervisões','3','Com distribuição cadastrada')+'</div>'+
 '<div class="grid two-col"><div class="panel"><h2>Faturamento x meta mês a mês</h2><div class="chart-wrap tall"><canvas id="c7"></canvas></div></div><div class="panel"><h2>Meta por supervisão</h2><div class="metric-list">'+
 '<div class="metric-line"><div class="name">Mariana</div><div class="value">R$ 38,0 mi</div></div><div class="metric-line"><div class="name">Waldonys</div><div class="value">R$ 37,5 mi</div></div><div class="metric-line"><div class="name">Guilherme</div><div class="value">R$ 36,5 mi</div></div></div></div></div>';
 chart('#c7','bar',months,[8.2,8.4,8.7,8.9,9.1,8.8,9.3,9.5,9.2,9.9].map(x=>x*1e6));
}
const views={overview,carteira,produtos,cidades,metas};
const titles={overview:['Visão Geral','Resumo executivo • faturamento, meta, ritmo e pontos de atenção'],carteira:['Carteira','Saúde da carteira • novos, inativos, recuperação e oportunidades'],produtos:['Mix e Produtos','Produtos • mix, concentração, desempenho e venda cruzada'],cidades:['Cidades','Cobertura comercial • evolução, pontos críticos, produtos e clientes'],metas:['Gestão de Metas','Planejamento • histórico, distribuição e acompanhamento']};
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>{clear();$$('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');const p=b.dataset.page;$('#pageTitle').textContent=titles[p][0];$('#pageSubtitle').textContent=titles[p][1];views[p]()}));
overview();