import os, io, re, unicodedata
from datetime import datetime
import numpy as np
import pandas as pd
import requests
import streamlit as st
import plotly.express as px
import pydeck as pdk

st.set_page_config(page_title='Logística Operacional | RBN', page_icon='🚚', layout='wide', initial_sidebar_state='expanded')
st.markdown('''<style>
.block-container{padding-top:1rem;max-width:1500px}[data-testid="stSidebar"]{background:#0f2f2a}[data-testid="stSidebar"] *{color:white}.ttl{font-size:30px;font-weight:800;color:#143c35}.sub{color:#667085;margin-bottom:18px}.card{background:white;border:1px solid #e7ecea;border-radius:14px;padding:15px 17px;min-height:105px}.lab{font-size:12px;color:#667085;font-weight:700;text-transform:uppercase}.val{font-size:27px;color:#143c35;font-weight:800;margin-top:7px}.help{font-size:11px;color:#98a2b3;margin-top:4px}.section{font-size:18px;font-weight:750;color:#143c35;margin:12px 0 8px}</style>''', unsafe_allow_html=True)

def norm(s):
    s='' if s is None else str(s)
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode('ascii')
    return re.sub(r'\s+',' ',s.replace('\n',' ')).strip().upper()

def txt(v):
    if pd.isna(v): return None
    s=str(v).strip(); return s or None

def xdate(v):
    if pd.isna(v) or v=='': return pd.NaT
    if isinstance(v,(pd.Timestamp,datetime)): return pd.to_datetime(v,errors='coerce')
    if isinstance(v,(int,float,np.integer,np.floating)) and 30000<=float(v)<=70000:
        return pd.Timestamp('1899-12-30')+pd.to_timedelta(float(v),unit='D')
    return pd.to_datetime(v,errors='coerce',dayfirst=True)

def wait(v):
    if pd.isna(v) or v=='': return np.nan
    if isinstance(v,(int,float,np.integer,np.floating)): return float(v)
    d=pd.to_datetime(v,errors='coerce')
    if pd.notna(d) and d.year<=1901: return float((d-pd.Timestamp('1899-12-31')).days)
    m=re.search(r'(\d+(?:[\.,]\d+)?)',str(v)); return float(m.group(1).replace(',','.')) if m else np.nan

def br(x,d=0):
    if pd.isna(x): return '-'
    return f'{x:,.{d}f}'.replace(',','X').replace('.',',').replace('X','.')
def money(x): return f'R$ {br(x,2)}'
def card(label,value,help_=''):
    st.markdown(f'<div class="card"><div class="lab">{label}</div><div class="val">{value}</div><div class="help">{help_}</div></div>',unsafe_allow_html=True)
def cards(items):
    cols=st.columns(len(items))
    for c,item in zip(cols,items):
        with c: card(*item)

def city_key(v):
    if v is None or pd.isna(v): return None
    s=str(v).strip().upper()
    s=re.sub(r'\s*[-/]\s*[A-Z]{2}\s*$','',s)
    return norm(s)
def city_uf(v):
    if v is None or pd.isna(v): return None
    m=re.search(r'[-/]\s*([A-Z]{2})\s*$',str(v).upper().strip())
    return m.group(1) if m else None

@st.cache_data(ttl=300,show_spinner=False)
def source_bytes():
    try: url=st.secrets.get('DATA_XLSX_URL',None)
    except Exception: url=None
    url=url or os.getenv('DATA_XLSX_URL')
    if not url: raise FileNotFoundError('Configure DATA_XLSX_URL em Secrets.')
    r=requests.get(url,timeout=45); r.raise_for_status(); return io.BytesIO(r.content)

@st.cache_data(ttl=300,show_spinner=False)
def load():
    src=source_bytes(); raw=pd.read_excel(src,sheet_name='FORMAÇÃO 2026',header=1,engine='openpyxl'); raw.columns=[norm(c) for c in raw.columns]
    ren={'TEMPO ESPERA':'TEMPO_ESPERA','DATA IMPLANTACAO':'DATA_IMPLANTACAO','CLIENTE':'CLIENTE','VENDEDOR':'VENDEDOR','CIDADE':'CIDADE','LOCAL CARREGAMENTO':'LOCAL_CARREGAMENTO','PRODUTO':'PRODUTO','VOLUMES':'VOLUMES','PESO':'PESO','CUSTOS R$':'CUSTOS','OBSERVACOES':'OBSERVACOES','CAMINHAO':'CAMINHAO','MOTORISTA':'MOTORISTA','STATUS DA ENTREGA':'STATUS','DATA CARREGAMENTO (EXPEDICAO)':'DATA_CARREGAMENTO','DATA CHEGADA CLIENTE':'DATA_CHEGADA','CLASSIFICACAO DE ROTA':'CLASSIFICACAO_ROTA','NOTA FISCAL':'NOTA_FISCAL','CATEGORIA OCORRENCIA':'CATEGORIA_OCORRENCIA','FOLLOW UP OCORRENCIA':'FOLLOW_UP','CONFERENTE':'CONFERENTE','SEPARADOR':'SEPARADOR','PREVISAO DE ROTA':'PREVISAO_ROTA'}
    raw=raw.rename(columns={c:ren.get(c,c) for c in raw.columns}); cols=list(ren.values())
    for c in cols:
        if c not in raw.columns: raw[c]=np.nan
    d=raw[cols].copy(); d=d[d.notna().any(axis=1)]
    for c in ['CLIENTE','VENDEDOR','CIDADE','LOCAL_CARREGAMENTO','PRODUTO','CAMINHAO','MOTORISTA','STATUS','CLASSIFICACAO_ROTA','CATEGORIA_OCORRENCIA','FOLLOW_UP','CONFERENTE','SEPARADOR','OBSERVACOES']: d[c]=d[c].map(txt)
    for c in ['VOLUMES','PESO','CUSTOS']: d[c]=pd.to_numeric(d[c],errors='coerce')
    for c in ['DATA_IMPLANTACAO','DATA_CARREGAMENTO','DATA_CHEGADA','PREVISAO_ROTA']: d[c]=d[c].map(xdate)
    d['DIAS_ESPERA']=d['TEMPO_ESPERA'].map(wait); s=d['STATUS'].fillna('').str.upper()
    d['ENTREGUE']=s.str.contains('ENTREG'); d['EM_ROTA']=s.str.contains('ROTA')&~d['ENTREGUE']; d['CARREGADO']=s.str.contains('CARREG')&~d['ENTREGUE']; d['TEM_OCORRENCIA']=d['CATEGORIA_OCORRENCIA'].notna()|d['FOLLOW_UP'].notna()
    try:
        src2=source_bytes(); rg=pd.read_excel(src2,sheet_name='CADASTRO REGIAO',header=0,engine='openpyxl'); rg.columns=[norm(c) for c in rg.columns]
        mc=next((c for c in rg.columns if 'MUNICIPIO' in c),None); rc=next((c for c in rg.columns if 'REGIAO DE PLANEJAMENTO' in c),None)
        if mc and rc:
            rg=rg[[mc,rc]].dropna(); rg['KEY']=rg[mc].map(city_key); d['KEY']=d['CIDADE'].map(city_key); d=d.merge(rg[['KEY',rc]].drop_duplicates('KEY'),on='KEY',how='left').rename(columns={rc:'REGIAO'})
        else: d['REGIAO']=np.nan
    except Exception: d['REGIAO']=np.nan
    return d

@st.cache_data(ttl=3600,show_spinner=False)
def coords():
    try: url=st.secrets.get('MAP_COORDS_URL',None)
    except Exception: url=None
    url=url or os.getenv('MAP_COORDS_URL') or 'https://drive.google.com/uc?export=download&id=1ojDIEwHSRybJ8qfGwFRmJEDFs-pa17Gz'
    try:
        r=requests.get(url,timeout=45); r.raise_for_status(); c=pd.read_csv(io.BytesIO(r.content),encoding='utf-8-sig')
        c.columns=[norm(x) for x in c.columns]; c['MUN_KEY']=c['NM_MUN'].map(city_key); c['SIGLA_UF']=c['SIGLA_UF'].astype(str).str.upper().str.strip()
        c['LATITUDE']=pd.to_numeric(c['LATITUDE'],errors='coerce'); c['LONGITUDE']=pd.to_numeric(c['LONGITUDE'],errors='coerce')
        return c[['MUN_KEY','SIGLA_UF','LATITUDE','LONGITUDE']].dropna(subset=['LATITUDE','LONGITUDE'])
    except Exception: return pd.DataFrame()

def map_data(base):
    x=base.copy(); x['MUN_KEY']=x['CIDADE'].map(city_key); x['UF_KEY']=x['CIDADE'].map(city_uf); x['PESO_ABERTO_L']=np.where(~x.ENTREGUE,x.PESO.fillna(0),0); x['ABERTO_L']=(~x.ENTREGUE).astype(int)
    g=x.groupby(['MUN_KEY','UF_KEY'],dropna=False).agg(CIDADE=('CIDADE','first'),PESO_ABERTO=('PESO_ABERTO_L','sum'),REGISTROS_ABERTOS=('ABERTO_L','sum'),TEMPO_MEDIO=('DIAS_ESPERA','mean'),OCORRENCIAS=('TEM_OCORRENCIA','sum')).reset_index(); c=coords()
    if c.empty: return g
    out=g.merge(c,left_on=['MUN_KEY','UF_KEY'],right_on=['MUN_KEY','SIGLA_UF'],how='left'); miss=out.LATITUDE.isna()
    if miss.any():
        ct=c.groupby('MUN_KEY').size(); uq=c[c.MUN_KEY.isin(ct[ct.eq(1)].index)].drop_duplicates('MUN_KEY'); alt=out.loc[miss,['MUN_KEY']].merge(uq,on='MUN_KEY',how='left')
        out.loc[miss,'LATITUDE']=alt.LATITUDE.values; out.loc[miss,'LONGITUDE']=alt.LONGITUDE.values
    return out

def show_map(base,indicator,height=520):
    md=map_data(base); key={'Peso em aberto':'PESO_ABERTO','Registros em aberto':'REGISTROS_ABERTOS','Tempo médio de espera':'TEMPO_MEDIO','Ocorrências':'OCORRENCIAS'}[indicator]
    if 'LATITUDE' not in md or md.LATITUDE.notna().sum()==0:
        st.warning('A base de coordenadas do Drive ainda não está pública para leitura do Streamlit.'); st.dataframe(md.sort_values(key,ascending=False).head(30),use_container_width=True,hide_index=True); return
    md=md[md.LATITUDE.notna()&md.LONGITUDE.notna()].copy(); vals=pd.to_numeric(md[key],errors='coerce').fillna(0); vmax=max(float(vals.max()),1); md['RADIUS']=5000+np.sqrt(vals.clip(lower=0)/vmax)*42000
    layer=pdk.Layer('ScatterplotLayer',data=md,get_position='[LONGITUDE,LATITUDE]',get_radius='RADIUS',get_fill_color='[26,104,87,170]',get_line_color='[15,47,42,220]',line_width_min_pixels=1,pickable=True,auto_highlight=True)
    view=pdk.ViewState(latitude=float(md.LATITUDE.mean()),longitude=float(md.LONGITUDE.mean()),zoom=4.2)
    tip={'html':'<b>{CIDADE}</b><br/>Peso em aberto: {PESO_ABERTO} kg<br/>Registros em aberto: {REGISTROS_ABERTOS}<br/>Espera média: {TEMPO_MEDIO} dias<br/>Ocorrências: {OCORRENCIAS}','style':{'backgroundColor':'#0f2f2a','color':'white'}}
    st.pydeck_chart(pdk.Deck(layers=[layer],initial_view_state=view,tooltip=tip,map_style=None),use_container_width=True,height=height)

try: df=load()
except Exception as e:
    st.error('Fonte não configurada'); st.info('Defina DATA_XLSX_URL em Secrets.'); st.code(str(e)); st.stop()

with st.sidebar:
    st.markdown('### 🚚 LOGÍSTICA RBN'); st.caption('Dashboard Operacional · V1')
    page=st.radio('Menu',['Visão Geral','Formação de Cargas','Rotas e Entregas','Motoristas e Frota','Pendências','Ocorrências','Custos'],label_visibility='collapsed')
    st.markdown('---'); st.markdown('#### Filtros')
    def multi(label,col): return st.multiselect(label,sorted([x for x in df[col].dropna().unique() if str(x).strip()]))
    dates=df.DATA_IMPLANTACAO.dropna(); period=None
    if len(dates): period=st.date_input('Período',value=(dates.min().date(),dates.max().date()),min_value=dates.min().date(),max_value=dates.max().date())
    filters=[(multi('Vendedor','VENDEDOR'),'VENDEDOR'),(multi('Região','REGIAO'),'REGIAO'),(multi('Cidade','CIDADE'),'CIDADE'),(multi('Motorista','MOTORISTA'),'MOTORISTA'),(multi('Caminhão','CAMINHAO'),'CAMINHAO'),(multi('Status','STATUS'),'STATUS'),(multi('Produto','PRODUTO'),'PRODUTO'),(multi('Classificação de rota','CLASSIFICACAO_ROTA'),'CLASSIFICACAO_ROTA')]
    st.caption('Somente leitura · nenhum dado é gravado na planilha.')

f=df.copy()
if period and len(period)==2:
    a,b=pd.Timestamp(period[0]),pd.Timestamp(period[1])+pd.Timedelta(days=1)-pd.Timedelta(seconds=1); f=f[(f.DATA_IMPLANTACAO.isna())|f.DATA_IMPLANTACAO.between(a,b)]
for vals,col in filters:
    if vals: f=f[f[col].isin(vals)]

st.markdown('<div class="ttl">Logística Operacional</div><div class="sub">Gestão de cargas, rotas, entregas, pendências e custos · V1</div>',unsafe_allow_html=True)

if page=='Visão Geral':
    aberto=f[~f.ENTREGUE]; cards([('Registros em aberto',br(len(aberto)),''),('Peso em aberto',f'{br(aberto.PESO.sum()/1000,1)} t',''),('Em rota',br(f.EM_ROTA.sum()),''),('Entregues',br(f.ENTREGUE.sum()),''),('Espera média',f'{br(aberto.DIAS_ESPERA.mean(),1)} dias',''),('Ocorrências',br(f.TEM_OCORRENCIA.sum()),'')])
    c1,c2=st.columns([1.2,1])
    with c1:
        st.markdown('<div class="section">Peso em aberto por rota</div>',unsafe_allow_html=True); g=aberto.groupby('CLASSIFICACAO_ROTA',dropna=False).PESO.sum().reset_index().sort_values('PESO').tail(12); g.CLASSIFICACAO_ROTA=g.CLASSIFICACAO_ROTA.fillna('Sem classificação'); st.plotly_chart(px.bar(g,x='PESO',y='CLASSIFICACAO_ROTA',orientation='h'),use_container_width=True)
    with c2:
        st.markdown('<div class="section">Situação operacional</div>',unsafe_allow_html=True); sit=pd.DataFrame({'Situação':['Entregue','Em rota','Carregado','Demais'],'Qtd':[f.ENTREGUE.sum(),f.EM_ROTA.sum(),f.CARREGADO.sum(),(~(f.ENTREGUE|f.EM_ROTA|f.CARREGADO)).sum()]}); st.plotly_chart(px.pie(sit,names='Situação',values='Qtd',hole=.58),use_container_width=True)
    st.markdown('<div class="section">Mapa operacional por cidade</div>',unsafe_allow_html=True); ind=st.selectbox('Indicador do mapa',['Peso em aberto','Registros em aberto','Tempo médio de espera','Ocorrências']); show_map(f,ind)
    st.markdown('<div class="section">Atenção operacional</div>',unsafe_allow_html=True); p=aberto.copy(); p['PRIORIDADE']=np.where(p.DIAS_ESPERA.ge(10),'CRÍTICA',np.where(p.DIAS_ESPERA.ge(5),'ATENÇÃO','NORMAL')); st.dataframe(p.sort_values('DIAS_ESPERA',ascending=False)[['PRIORIDADE','CLIENTE','CIDADE','VENDEDOR','PESO','DIAS_ESPERA','STATUS','MOTORISTA','CAMINHAO','PREVISAO_ROTA']].head(50),use_container_width=True,hide_index=True)
elif page=='Formação de Cargas':
    cards([('Registros',br(len(f)),''),('Clientes',br(f.CLIENTE.nunique()),''),('Volumes',br(f.VOLUMES.sum()),''),('Peso',f'{br(f.PESO.sum()/1000,1)} t',''),('Espera média',f'{br(f.DIAS_ESPERA.mean(),1)} dias','')]); st.dataframe(f[['DATA_IMPLANTACAO','CLIENTE','VENDEDOR','CIDADE','REGIAO','PRODUTO','VOLUMES','PESO','DIAS_ESPERA','MOTORISTA','CAMINHAO','STATUS','CLASSIFICACAO_ROTA','PREVISAO_ROTA','OBSERVACOES']].sort_values('DIAS_ESPERA',ascending=False),use_container_width=True,hide_index=True)
elif page=='Rotas e Entregas':
    a=f[~f.ENTREGUE]; cards([('Rotas',br(a.CLASSIFICACAO_ROTA.nunique()),''),('Clientes em aberto',br(a.CLIENTE.nunique()),''),('Peso em aberto',f'{br(a.PESO.sum()/1000,1)} t',''),('Em rota',br(f.EM_ROTA.sum()),''),('Sem previsão',br(a.PREVISAO_ROTA.isna().sum()),'')]); st.markdown('<div class="section">Mapa de rotas e entregas</div>',unsafe_allow_html=True); ind=st.selectbox('Indicador do mapa',['Peso em aberto','Registros em aberto','Tempo médio de espera','Ocorrências'],key='rotasmap'); show_map(f,ind,560); g=a.groupby('CLASSIFICACAO_ROTA',dropna=False).agg(PESO=('PESO','sum'),CLIENTES=('CLIENTE','nunique'),REGISTROS=('CLIENTE','size'),ESPERA=('DIAS_ESPERA','mean')).reset_index(); st.plotly_chart(px.bar(g,x='CLASSIFICACAO_ROTA',y='PESO',hover_data=['CLIENTES','REGISTROS','ESPERA']),use_container_width=True); st.dataframe(g.sort_values('PESO',ascending=False),use_container_width=True,hide_index=True)
elif page=='Motoristas e Frota':
    m=f[f.MOTORISTA.notna()]; g=m.groupby('MOTORISTA').agg(REGISTROS=('CLIENTE','size'),CLIENTES=('CLIENTE','nunique'),PESO=('PESO','sum'),ENTREGUES=('ENTREGUE','sum'),OCORRENCIAS=('TEM_OCORRENCIA','sum'),ESPERA=('DIAS_ESPERA','mean')).reset_index(); cards([('Motoristas',br(m.MOTORISTA.nunique()),''),('Veículos',br(m.CAMINHAO.nunique()),''),('Peso associado',f'{br(m.PESO.sum()/1000,1)} t',''),('Em rota',br(m.EM_ROTA.sum()),''),('Ocorrências',br(m.TEM_OCORRENCIA.sum()),'')]); st.plotly_chart(px.bar(g.sort_values('PESO',ascending=False).head(15),x='MOTORISTA',y='PESO',hover_data=['CLIENTES','REGISTROS','ENTREGUES','OCORRENCIAS']),use_container_width=True); st.dataframe(g.sort_values('PESO',ascending=False),use_container_width=True,hide_index=True)
elif page=='Pendências':
    p=f[~f.ENTREGUE].copy(); p['SEM_PREVISAO']=p.PREVISAO_ROTA.isna(); p['SEM_MOTORISTA']=p.MOTORISTA.isna(); p['OCORR_SEM_FOLLOW']=p.CATEGORIA_OCORRENCIA.notna()&p.FOLLOW_UP.isna(); cards([('Pendências',br(len(p)),''),('Espera ≥10d',br(p.DIAS_ESPERA.ge(10).sum()),''),('Sem previsão',br(p.SEM_PREVISAO.sum()),''),('Sem motorista',br(p.SEM_MOTORISTA.sum()),''),('Ocorr. sem follow-up',br(p.OCORR_SEM_FOLLOW.sum()),'')]); st.dataframe(p.sort_values('DIAS_ESPERA',ascending=False)[['CLIENTE','CIDADE','VENDEDOR','PESO','DIAS_ESPERA','STATUS','PREVISAO_ROTA','MOTORISTA','CAMINHAO','CATEGORIA_OCORRENCIA','FOLLOW_UP']],use_container_width=True,hide_index=True)
elif page=='Ocorrências':
    o=f[f.TEM_OCORRENCIA].copy(); cards([('Ocorrências',br(len(o)),''),('Categorias',br(o.CATEGORIA_OCORRENCIA.nunique()),''),('Com follow-up',br(o.FOLLOW_UP.notna().sum()),''),('% follow-up',f'{br(100*o.FOLLOW_UP.notna().mean(),1)}%','')]); g=o.groupby('CATEGORIA_OCORRENCIA',dropna=False).size().reset_index(name='QTD'); st.plotly_chart(px.bar(g,x='QTD',y='CATEGORIA_OCORRENCIA',orientation='h'),use_container_width=True); st.dataframe(o[['CLIENTE','CIDADE','MOTORISTA','CAMINHAO','CATEGORIA_OCORRENCIA','FOLLOW_UP','CONFERENTE','SEPARADOR','STATUS']],use_container_width=True,hide_index=True)
elif page=='Custos':
    custo=f.CUSTOS.sum(min_count=1); peso=f.PESO.sum(min_count=1); cards([('Custo informado',money(custo if pd.notna(custo) else 0),''),('Registros com custo',br(f.CUSTOS.notna().sum()),''),('Peso total',f'{br(peso/1000,1)} t',''),('Custo/kg',money((custo/peso) if pd.notna(custo) and peso else 0),'exploratório')]); st.warning('Custos ainda têm cobertura parcial na base.'); g=f[f.CUSTOS.notna()].groupby('CLASSIFICACAO_ROTA',dropna=False).agg(CUSTO=('CUSTOS','sum'),PESO=('PESO','sum'),REGISTROS=('CLIENTE','size')).reset_index(); g['CUSTO_KG']=g.CUSTO/g.PESO.replace(0,np.nan); st.dataframe(g.sort_values('CUSTO',ascending=False),use_container_width=True,hide_index=True)

st.markdown('---'); st.caption('V1 · Dados processados somente em memória. Nenhuma alteração é realizada nos arquivos de origem.')
