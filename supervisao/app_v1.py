from io import BytesIO
import pandas as pd
import plotly.express as px
import requests
import streamlit as st

st.set_page_config(page_title='Dashboard de Supervisão', page_icon='📊', layout='wide')
VENDAS_ID='1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'
AUX_ID='1h3XtB-2aMSMGhr5Ws7P-6nijKZc3zeqI'

def drive_bytes(fid):
    r=requests.get(f'https://drive.google.com/uc?export=download&id={fid}',timeout=180); r.raise_for_status()
    if 'text/html' in r.headers.get('content-type','').lower(): raise RuntimeError('Confirme o compartilhamento dos arquivos do Drive como leitor por link.')
    return BytesIO(r.content)

def cod(s): return pd.to_numeric(s.astype(str).str.extract(r'^\s*(\d+)',expand=False),errors='coerce').astype('Int64')
def dt(s):
    if pd.api.types.is_datetime64_any_dtype(s): return pd.to_datetime(s,errors='coerce')
    n=pd.to_numeric(s,errors='coerce'); a=pd.to_datetime(n,unit='D',origin='1899-12-30',errors='coerce'); b=pd.to_datetime(s.astype(str),dayfirst=True,errors='coerce'); return b.fillna(a)
def brl(v): return '—' if pd.isna(v) else f'R$ {float(v):,.2f}'.replace(',','X').replace('.',',').replace('X','.')
def pct(v): return '—' if pd.isna(v) else f'{float(v):.1f}%'.replace('.',',')
def nint(v): return f'{int(round(float(v or 0))):,}'.replace(',','.')

def mes_nome(x):
    p=pd.Period(x); nomes=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']; return f'{nomes[p.month]}/{p.year}'

@st.cache_data(ttl=900,show_spinner='Carregando bases...')
def load():
    v=pd.read_excel(drive_bytes(VENDAS_ID),sheet_name='Sheet1',skiprows=2)
    aux=drive_bytes(AUX_ID); cli=pd.read_excel(aux,sheet_name='CLIENTES'); aux.seek(0); rca=pd.read_excel(aux,sheet_name='RCA'); aux.seek(0); met=pd.read_excel(aux,sheet_name='METAS')
    v['COD_RCA']=cod(v['Cod/Vend.']); v['CODCLI']=cod(v['Cod/Cliente']); v['CODPROD']=cod(v['Cod/Produto']); v['DATA_FAT']=dt(v['Data Faturamento']); v['VALOR']=pd.to_numeric(v['Pedidos Enviados'],errors='coerce').fillna(0); v['MES']=v['DATA_FAT'].dt.to_period('M').astype('string'); v['FATURADO']=v['DATA_FAT'].notna() & v['Posição'].astype(str).str.strip().str.upper().eq('FECHADO')
    for d in (cli,rca,met): d['COD_RCA']=pd.to_numeric(d['COD_RCA'],errors='coerce').astype('Int64')
    cli['CODCLI']=pd.to_numeric(cli['CODCLI'],errors='coerce').astype('Int64'); rca['ATIVO']=rca['ATIVO'].astype(str).str.upper().str.strip(); met['MES']=met['MES'].astype(str).str[:7]; met['META']=pd.to_numeric(met['META'],errors='coerce').fillna(0)
    h=rca[['COD_RCA','RCA','SUPERVISOR','ATIVO']].drop_duplicates('COD_RCA'); v=v.merge(h,on='COD_RCA',how='left'); return v,cli,rca,met

try: vendas,clientes,rcas,metas=load()
except Exception as e: st.error(str(e)); st.stop()

st.title('Dashboard de Supervisão')
st.caption('Venda oficial: Produto (14) • Metas/carteira/hierarquia: Base Consolidada • A aba VENDAS da consolidada não é utilizada.')
ativos=rcas[rcas['ATIVO'].eq('S')].copy(); meses=sorted(set(vendas.loc[vendas.FATURADO,'MES'].dropna().astype(str))|set(metas.MES.dropna().astype(str)),reverse=True); mes=st.sidebar.selectbox('Mês de análise',meses,index=meses.index('2026-09') if '2026-09' in meses else 0,format_func=mes_nome)
sups=sorted(ativos.SUPERVISOR.dropna().unique()); ss=st.sidebar.multiselect('Supervisor',sups,default=sups); ro=sorted(ativos.loc[ativos.SUPERVISOR.isin(ss),'RCA'].dropna().unique()); rs=st.sidebar.multiselect('RCA',ro,default=ro)
deps=sorted(set(vendas.loc[vendas.MES.eq(mes),'DEPARTAMENTO'].dropna().astype(str))|set(metas.loc[metas.MES.eq(mes),'DEPARTAMENTO'].dropna().astype(str))); ds=st.sidebar.multiselect('Departamento',deps,default=deps)
cods=set(ativos.loc[ativos.SUPERVISOR.isin(ss)&ativos.RCA.isin(rs),'COD_RCA'].dropna()); fat=vendas[vendas.FATURADO&vendas.MES.eq(mes)&vendas.COD_RCA.isin(cods)&vendas.DEPARTAMENTO.astype(str).isin(ds)].copy(); meta=metas[metas.MES.eq(mes)&metas.COD_RCA.isin(cods)&metas.DEPARTAMENTO.astype(str).isin(ds)].copy(); meta=meta.merge(ativos[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA'),on='COD_RCA',how='left')
F=fat.VALOR.sum(); M=meta.META.sum(); P=fat.NUMPED.nunique(); C=fat.CODCLI.nunique(); A=F/M*100 if M else pd.NA
c1,c2,c3,c4,c5=st.columns(5); c1.metric('Faturamento',brl(F)); c2.metric('Meta',brl(M)); c3.metric('Atingimento',pct(A)); c4.metric('Clientes positivados',nint(C)); c5.metric('Ticket médio',brl(F/P if P else 0))
base=ativos[ativos.SUPERVISOR.isin(ss)&ativos.RCA.isin(rs)][['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA'); fr=fat.groupby('COD_RCA').agg(FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique'),POSITIVADOS=('CODCLI','nunique')).reset_index(); mr=meta.groupby('COD_RCA',as_index=False).META.sum()
if fat.empty: mix=pd.DataFrame(columns=['COD_RCA','MIX','PRODUTOS_PEDIDO'])
else:
    pp=fat.groupby(['COD_RCA','NUMPED']).agg(SECOES=('SECAO','nunique'),PRODUTOS=('CODPROD','nunique')).reset_index(); mix=pp.groupby('COD_RCA').agg(MIX=('SECOES','mean'),PRODUTOS_PEDIDO=('PRODUTOS','mean')).reset_index()
r=base.merge(fr,on='COD_RCA',how='left').merge(mr,on='COD_RCA',how='left').merge(mix,on='COD_RCA',how='left').fillna({'FATURAMENTO':0,'PEDIDOS':0,'POSITIVADOS':0,'META':0,'MIX':0,'PRODUTOS_PEDIDO':0}); r['ATINGIMENTO']=r.FATURAMENTO.div(r.META.replace(0,pd.NA))*100; r['TICKET']=r.FATURAMENTO.div(r.PEDIDOS.replace(0,pd.NA))
hist=vendas[vendas.FATURADO]; vida=hist.groupby('CODCLI').DATA_FAT.agg(PRIMEIRA='min',ULTIMA='max').reset_index(); fim=pd.Period(mes).end_time.normalize(); car=clientes[clientes.COD_RCA.isin(cods)][['CODCLI','COD_RCA']].drop_duplicates().merge(vida,on='CODCLI',how='left'); car['NOVO']=car.PRIMEIRA.dt.to_period('M').astype('string').eq(mes); car['INATIVO']=car.ULTIMA.notna()&car.ULTIMA.lt(fim-pd.Timedelta(days=89)); cr=car.groupby('COD_RCA').agg(NOVOS=('NOVO','sum'),INATIVADOS=('INATIVO','sum')).reset_index(); r=r.merge(cr,on='COD_RCA',how='left').fillna({'NOVOS':0,'INATIVADOS':0})

a,b,c=st.tabs(['Indicadores e Resultados','Análise de Carteira','Mix e Oportunidades'])
with a:
    st.subheader('Faturamento x Meta — Supervisão'); s=r.groupby('SUPERVISOR',as_index=False).agg(FATURAMENTO=('FATURAMENTO','sum'),META=('META','sum')); s['ATINGIMENTO']=s.FATURAMENTO.div(s.META.replace(0,pd.NA))*100; st.dataframe(pd.DataFrame({'Supervisor':s.SUPERVISOR,'Faturamento':s.FATURAMENTO.map(brl),'Meta':s.META.map(brl),'Atingimento':s.ATINGIMENTO.map(pct)}),use_container_width=True,hide_index=True)
    st.subheader('Faturamento x Meta — RCAs'); t=pd.DataFrame({'RCA':r.RCA,'Faturamento':r.FATURAMENTO.map(brl),'Meta':r.META.map(brl),'Atingimento':r.ATINGIMENTO.map(pct),'Margem':'—','Descontos':'—','Mix':r.MIX.map(lambda x:f'{x:.2f}'.replace('.',','))}); st.dataframe(t,use_container_width=True,hide_index=True); st.caption('Mix = média de seções distintas por pedido. Margem e descontos aguardam a fonte específica.')
with b:
    st.subheader('Análise de Carteira por RCA'); t=pd.DataFrame({'RCA':r.RCA,'Positivados':r.POSITIVADOS.map(nint),'Novos':r.NOVOS.map(nint),'Inativados':r.INATIVADOS.map(nint),'Ticket médio':r.TICKET.map(brl)}); st.dataframe(t,use_container_width=True,hide_index=True); st.caption('Inativado = cliente da carteira atual com histórico de compra e sem faturamento nos 90 dias anteriores ao fim do mês selecionado.')
with c:
    st.subheader('Mix médio por pedido'); t=pd.DataFrame({'RCA':r.RCA,'Seções/pedido':r.MIX.map(lambda x:f'{x:.2f}'.replace('.',',')),'Produtos/pedido':r.PRODUTOS_PEDIDO.map(lambda x:f'{x:.2f}'.replace('.',',')),'Pedidos':r.PEDIDOS.map(nint)}); st.dataframe(t,use_container_width=True,hide_index=True)
    if not fat.empty:
        dep=fat.groupby('DEPARTAMENTO',as_index=False).VALOR.sum().sort_values('VALOR',ascending=False); fig=px.bar(dep,x='DEPARTAMENTO',y='VALOR',title='Faturamento por departamento'); fig.update_layout(xaxis_title='',yaxis_title='Faturamento',height=420); st.plotly_chart(fig,use_container_width=True)
        rd=st.selectbox('Detalhar RCA',sorted(fat.RCA.dropna().unique())); d=fat[fat.RCA.eq(rd)]; q1,q2,q3,q4=st.columns(4); q1.metric('Faturamento',brl(d.VALOR.sum())); q2.metric('Pedidos',nint(d.NUMPED.nunique())); q3.metric('Clientes',nint(d.CODCLI.nunique())); q4.metric('Produtos distintos',nint(d.CODPROD.nunique())); sec=d.groupby('SECAO',as_index=False).VALOR.sum().sort_values('VALOR',ascending=False).head(15); fig2=px.bar(sec,x='VALOR',y='SECAO',orientation='h',title='Top seções por faturamento'); fig2.update_yaxes(categoryorder='total ascending'); fig2.update_layout(height=500,xaxis_title='Faturamento',yaxis_title=''); st.plotly_chart(fig2,use_container_width=True)

st.divider(); st.caption('A exportação Produto (14) informa limite de 150.000 linhas. Indicadores históricos de clientes novos e inativados são provisórios até termos uma extração sem truncamento.')
