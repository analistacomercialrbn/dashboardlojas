import io, os, re, unicodedata
from datetime import datetime
import numpy as np
import pandas as pd
import requests
import streamlit as st
import plotly.express as px

st.set_page_config(page_title='Indicadores Operacionais | RBN', page_icon='📊', layout='wide')

st.markdown('''<style>
.block-container{padding-top:1rem;max-width:1500px}
.ttl{font-size:30px;font-weight:800;color:#143c35}.sub{color:#667085;margin-bottom:18px}
.card{background:white;border:1px solid #e7ecea;border-radius:14px;padding:15px 17px;min-height:105px}
.lab{font-size:12px;color:#667085;font-weight:700;text-transform:uppercase}.val{font-size:27px;color:#143c35;font-weight:800;margin-top:7px}.help{font-size:11px;color:#98a2b3;margin-top:4px}
</style>''', unsafe_allow_html=True)

def norm(s):
    s='' if s is None else str(s)
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode('ascii')
    return re.sub(r'\s+',' ',s.replace('\n',' ')).strip().upper()

def br(v,d=0):
    if pd.isna(v): return '-'
    return f'{v:,.{d}f}'.replace(',','X').replace('.',',').replace('X','.')

def money(v): return f'R$ {br(v,2)}'
def card(label,value,help_=''):
    st.markdown(f'<div class="card"><div class="lab">{label}</div><div class="val">{value}</div><div class="help">{help_}</div></div>',unsafe_allow_html=True)
def cards(items):
    cols=st.columns(len(items))
    for c,x in zip(cols,items):
        with c: card(*x)

def secret(name, default=None):
    try: return st.secrets.get(name,default)
    except Exception: return os.getenv(name,default)

@st.cache_data(ttl=300,show_spinner=False)
def wb_bytes():
    url=secret('TRANSPORT_XLSX_URL','https://drive.google.com/uc?export=download&id=127enD4Qy-u_9aUNgCEF-Lt57Y2jaKBQ4')
    r=requests.get(url,timeout=60); r.raise_for_status(); return io.BytesIO(r.content)

@st.cache_data(ttl=300,show_spinner=False)
def load_formacao():
    d=pd.read_excel(wb_bytes(),sheet_name='Formação de Carga',header=3,engine='openpyxl')
    d.columns=[norm(c) for c in d.columns]
    keep=['DATA','REGIAO','VEICULO','MOTORISTA','CUSTO DE CAPATAZIA','DESCRICAO DO PROBLEMA','PROBLEMAS','CATEGORIA','MES','CONFERENTE','SEPARADOR']
    for c in keep:
        if c not in d.columns: d[c]=np.nan
    d=d[keep].copy(); d=d[d[['DATA','REGIAO','VEICULO','MOTORISTA']].notna().any(axis=1)]
    d['DATA']=pd.to_datetime(d['DATA'],errors='coerce'); d['CUSTO DE CAPATAZIA']=pd.to_numeric(d['CUSTO DE CAPATAZIA'],errors='coerce').fillna(0)
    d['OCORRENCIA']=d['PROBLEMAS'].notna() | d['DESCRICAO DO PROBLEMA'].notna()
    d['MES_NUM']=d['DATA'].dt.month; d['MES_ANO']=d['DATA'].dt.to_period('M').astype(str)
    return d

@st.cache_data(ttl=300,show_spinner=False)
def load_transport():
    d=pd.read_excel(wb_bytes(),sheet_name='Transportadoras',header=6,engine='openpyxl')
    d.columns=[norm(c) for c in d.columns]
    ren={'NOTA':'NOTA','CLIENTE':'CLIENTE','CIDADE':'CIDADE','EMISSAO':'EMISSAO','COLETA':'COLETA','PREVISAO':'PREVISAO','DT ENTREGA':'DT_ENTREGA','PESO':'PESO','STATUS DA ENTREGA':'STATUS','DIAS ATRASO':'DIAS_ATRASO','NO PRAZO':'NO_PRAZO','FORA DE PRAZO':'FORA_PRAZO','TRANSPORTADORA':'TRANSPORTADORA','OCORRENCIA':'OCORRENCIA','CATEGORIA /OCORRENCIA2':'CATEGORIA','RESPONSAVEL PELA OCORRENCIA':'RESPONSAVEL','FOLLOW UP/OCORRENCIA':'FOLLOW_UP','CONFERENTE':'CONFERENTE','SEPARADOR':'SEPARADOR','TIPO DE CARGA':'TIPO_CARGA'}
    d=d.rename(columns={c:ren.get(c,c) for c in d.columns})
    cols=list(ren.values())
    for c in cols:
        if c not in d.columns: d[c]=np.nan
    d=d[cols].copy(); d=d[d['NOTA'].notna() | d['CLIENTE'].notna()]
    for c in ['EMISSAO','COLETA','PREVISAO','DT_ENTREGA']: d[c]=pd.to_datetime(d[c],errors='coerce')
    for c in ['PESO','DIAS_ATRASO','NO_PRAZO','FORA_PRAZO']: d[c]=pd.to_numeric(d[c],errors='coerce')
    d['NO_PRAZO_BOOL']=d['STATUS'].astype(str).str.upper().str.contains('NO PRAZO') | d['NO_PRAZO'].fillna(0).gt(0)
    d['FORA_BOOL']=d['STATUS'].astype(str).str.upper().str.contains('FORA') | d['FORA_PRAZO'].fillna(0).gt(0)
    d['MES']=d['DT_ENTREGA'].dt.to_period('M').astype(str)
    return d

try:
    fc=load_formacao(); tr=load_transport()
except Exception as e:
    st.error('A base de acompanhamento ainda não está acessível ao Streamlit.')
    st.info('Deixe ACOMPANHAMENTO_TRANSPORTADORAS_TESTE.xlsx como "Qualquer pessoa com o link → Leitor" no Drive.')
    st.code(str(e)); st.stop()

st.markdown('<div class="ttl">Indicadores Operacionais</div><div class="sub">Formação de Carga e desempenho de Transportadoras</div>',unsafe_allow_html=True)
t1,t2=st.tabs(['Formação de Carga','Transportadoras'])

with t1:
    meses=sorted(fc['MES_ANO'].dropna().unique(),reverse=True)
    mes=st.selectbox('Mês',meses,index=0 if meses else None,key='mes_fc') if meses else None
    f=fc if not mes else fc[fc['MES_ANO'].eq(mes)]
    cargas=len(f); ocorr=int(f['OCORRENCIA'].sum()); assertiv=(1-ocorr/cargas)*100 if cargas else np.nan; cap=f['CUSTO DE CAPATAZIA'].sum()
    cards([('Assertividade',f'{br(assertiv,0)}%','Meta > 95%'),('Ocorrências',br(ocorr),''),('Acumulado carga',br(cargas),''),('Custo capatazia',money(cap),'')])
    c1,c2,c3=st.columns([1.2,1,1])
    with c1:
        g=f[f.OCORRENCIA].groupby('PROBLEMAS',dropna=False).size().reset_index(name='QTD').sort_values('QTD',ascending=False).head(10); g['PROBLEMAS']=g.PROBLEMAS.fillna('Sem descrição')
        st.plotly_chart(px.bar(g,x='PROBLEMAS',y='QTD',title='Ocorrências gerais',text='QTD'),use_container_width=True)
    with c2:
        g=f[f.OCORRENCIA].groupby('CATEGORIA',dropna=False).size().reset_index(name='QTD'); g['CATEGORIA']=g.CATEGORIA.fillna('Sem categoria')
        st.plotly_chart(px.pie(g,names='CATEGORIA',values='QTD',title='Ocorrências por categoria',hole=.42),use_container_width=True)
    with c3:
        g=f[f.OCORRENCIA].groupby('REGIAO',dropna=False).size().reset_index(name='QTD').sort_values('QTD')
        st.plotly_chart(px.bar(g,x='QTD',y='REGIAO',orientation='h',title='Ocorrências por região',text='QTD'),use_container_width=True)
    c1,c2=st.columns(2)
    with c1:
        g=f.groupby('REGIAO',dropna=False)['CUSTO DE CAPATAZIA'].sum().reset_index().sort_values('CUSTO DE CAPATAZIA',ascending=False)
        st.plotly_chart(px.line(g,x='REGIAO',y='CUSTO DE CAPATAZIA',markers=True,title='Custo de capatazia por região'),use_container_width=True)
    with c2:
        g=f[f.OCORRENCIA].groupby('CONFERENTE',dropna=False).size().reset_index(name='QTD').sort_values('QTD',ascending=False).head(12); g['CONFERENTE']=g.CONFERENTE.fillna('Sem responsável')
        st.plotly_chart(px.bar(g,x='CONFERENTE',y='QTD',title='Ocorrências por colaborador',text='QTD'),use_container_width=True)

with t2:
    meses=sorted([x for x in tr.MES.dropna().unique() if x!='NaT'],reverse=True)
    mes=st.selectbox('Mês de entrega',meses,index=0 if meses else None,key='mes_tr') if meses else None
    f=tr if not mes else tr[tr.MES.eq(mes)]
    transports=sorted(f.TRANSPORTADORA.dropna().unique())
    sel=st.multiselect('Transportadora',transports,default=transports,key='trs')
    if sel: f=f[f.TRANSPORTADORA.isin(sel)]
    n=len(f); nop=int(f.NO_PRAZO_BOOL.sum()); fora=int(f.FORA_BOOL.sum()); efic=100*nop/n if n else np.nan
    cards([('Eficiência mensal',f'{br(efic,0)}%','Meta >95%'),('Entregas',br(n),''),('No prazo',br(nop),''),('Fora do prazo',br(fora),'')])
    if len(sel):
        cols=st.columns(min(len(sel),4))
        for c,t in zip(cols,sel[:4]):
            x=f[f.TRANSPORTADORA.eq(t)]; e=100*x.NO_PRAZO_BOOL.sum()/len(x) if len(x) else np.nan
            with c: card(t,f'{br(e,0)}%',f'{len(x)} entregas')
    c1,c2,c3=st.columns([1,1.2,1])
    with c1:
        g=f.groupby('TRANSPORTADORA').agg(NO_PRAZO=('NO_PRAZO_BOOL','sum'),FORA=('FORA_BOOL','sum')).reset_index().melt(id_vars='TRANSPORTADORA',var_name='SITUAÇÃO',value_name='QTD')
        st.plotly_chart(px.bar(g,x='TRANSPORTADORA',y='QTD',color='SITUAÇÃO',barmode='group',title='No prazo x fora do prazo'),use_container_width=True)
    with c2:
        g=f[f.OCORRENCIA.notna()].groupby('OCORRENCIA').size().reset_index(name='QTD').sort_values('QTD',ascending=False).head(12)
        st.plotly_chart(px.bar(g,x='QTD',y='OCORRENCIA',orientation='h',title='Total de ocorrências'),use_container_width=True)
    with c3:
        g=f[f.FORA_BOOL].groupby('RESPONSAVEL',dropna=False).size().reset_index(name='QTD').sort_values('QTD',ascending=False); g['RESPONSAVEL']=g.RESPONSAVEL.fillna('Sem responsável')
        st.plotly_chart(px.bar(g,x='RESPONSAVEL',y='QTD',title='Ranking de falhas'),use_container_width=True)
    c1,c2=st.columns([1.2,1])
    with c1:
        g=f.groupby('TIPO_CARGA',dropna=False)['DIAS_ATRASO'].mean().reset_index().sort_values('DIAS_ATRASO',ascending=False).head(15); g['TIPO_CARGA']=g.TIPO_CARGA.fillna('Sem tipo')
        st.plotly_chart(px.line(g,x='TIPO_CARGA',y='DIAS_ATRASO',markers=True,title='Atraso médio por tipo de carga'),use_container_width=True)
    with c2:
        g=f.groupby('TRANSPORTADORA')['PESO'].sum().reset_index()
        st.plotly_chart(px.pie(g,names='TRANSPORTADORA',values='PESO',title='Peso por transportadora',hole=.55),use_container_width=True)
    g=f.groupby('CIDADE').agg(ATRASOS=('FORA_BOOL','sum'),ENTREGAS=('CLIENTE','size')).reset_index().sort_values(['ATRASOS','ENTREGAS'],ascending=False).head(20)
    st.plotly_chart(px.bar(g,x='ATRASOS',y='CIDADE',orientation='h',title='Maior representatividade em atrasos',hover_data=['ENTREGAS']),use_container_width=True)
