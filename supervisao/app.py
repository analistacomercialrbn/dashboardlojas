import re
from io import BytesIO

import pandas as pd
import plotly.express as px
import requests
import streamlit as st

st.set_page_config(page_title='Reunião de Supervisão', page_icon='📊', layout='wide')

VENDAS_ID = '1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'
AUX_ID = '1h3XtB-2aMSMGhr5Ws7P-6nijKZc3zeqI'


def drive_bytes(file_id: str) -> BytesIO:
    url = f'https://drive.google.com/uc?export=download&id={file_id}'
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    if 'text/html' in r.headers.get('content-type',''):
        raise RuntimeError('Arquivo do Drive não está liberado para leitura pelo app. Compartilhe como “qualquer pessoa com o link – leitor”.')
    return BytesIO(r.content)


def extrair_codigo(s):
    return pd.to_numeric(s.astype(str).str.extract(r'(^|\s)(\d+)')[1], errors='coerce').astype('Int64')


@st.cache_data(ttl=900, show_spinner='Carregando bases...')
def carregar():
    vendas = pd.read_excel(drive_bytes(VENDAS_ID), sheet_name='Sheet1', skiprows=2)
    aux = drive_bytes(AUX_ID)
    clientes = pd.read_excel(aux, sheet_name='CLIENTES'); aux.seek(0)
    rca = pd.read_excel(aux, sheet_name='RCA'); aux.seek(0)
    metas = pd.read_excel(aux, sheet_name='METAS')
    vendas['COD_RCA'] = extrair_codigo(vendas['Cod/Vend.']); vendas['CODCLI'] = extrair_codigo(vendas['Cod/Cliente']); vendas['CODPROD'] = extrair_codigo(vendas['Cod/Produto'])
    vendas['DATA_PEDIDO'] = pd.to_datetime(vendas['Data Pedido'], errors='coerce'); vendas['DATA_FAT'] = pd.to_datetime(vendas['Data Faturamento'], errors='coerce')
    vendas['VALOR'] = pd.to_numeric(vendas['Pedidos Enviados'], errors='coerce').fillna(0); vendas['MES'] = vendas['DATA_PEDIDO'].dt.to_period('M').astype(str)
    vendas['FATURADO'] = vendas['Data Faturamento'].notna() & vendas['Posição'].astype(str).str.upper().eq('FECHADO')
    rca['COD_RCA'] = pd.to_numeric(rca['COD_RCA'], errors='coerce').astype('Int64'); clientes['COD_RCA'] = pd.to_numeric(clientes['COD_RCA'], errors='coerce').astype('Int64'); clientes['CODCLI'] = pd.to_numeric(clientes['CODCLI'], errors='coerce').astype('Int64')
    metas['COD_RCA'] = pd.to_numeric(metas['COD_RCA'], errors='coerce').astype('Int64'); metas['MES'] = metas['MES'].astype(str).str[:7]; metas['META'] = pd.to_numeric(metas['META'], errors='coerce').fillna(0)
    vendas = vendas.merge(rca[['COD_RCA','RCA','SUPERVISOR','ATIVO']].drop_duplicates('COD_RCA'), on='COD_RCA', how='left')
    return vendas, clientes, rca, metas


def brl(v): return f'R$ {v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X','.')
def pct(v): return '—' if pd.isna(v) else f'{v:.1f}%'.replace('.', ',')

try: vendas, clientes, rcas, metas = carregar()
except Exception as e: st.error(str(e)); st.stop()

st.title('📊 Reunião de Supervisão')
st.caption('Venda oficial: Produto (14) • Metas/carteira/hierarquia: Base Consolidada • A aba VENDAS da consolidada não é utilizada.')
meses = sorted(set(vendas['MES'].dropna()) | set(metas['MES'].dropna()), reverse=True)
mes = st.sidebar.selectbox('Mês', meses, index=meses.index('2026-09') if '2026-09' in meses else 0)
sups = sorted(rcas.loc[rcas['ATIVO'].eq('S'),'SUPERVISOR'].dropna().unique()); sup_sel = st.sidebar.multiselect('Supervisão', sups, default=sups)
rca_opts = sorted(rcas.loc[(rcas['ATIVO'].eq('S')) & rcas['SUPERVISOR'].isin(sup_sel), 'RCA'].dropna().unique()); rca_sel = st.sidebar.multiselect('RCA', rca_opts, default=rca_opts)
base = vendas[vendas['MES'].eq(mes) & vendas['SUPERVISOR'].isin(sup_sel) & vendas['RCA'].isin(rca_sel)].copy(); fat = base[base['FATURADO']].copy()
meta = metas[metas['MES'].eq(mes)].merge(rcas[['COD_RCA','RCA','SUPERVISOR']], on='COD_RCA', how='left'); meta = meta[meta['SUPERVISOR'].isin(sup_sel) & meta['RCA'].isin(rca_sel)]

c1,c2,c3,c4,c5=st.columns(5); tot_fat=fat['VALOR'].sum(); tot_meta=meta['META'].sum(); ating=100*tot_fat/tot_meta if tot_meta else None; pedidos=fat['NUMPED'].nunique(); clientes_pos=fat['CODCLI'].nunique(); ticket=tot_fat/pedidos if pedidos else 0
c1.metric('Faturamento',brl(tot_fat)); c2.metric('Meta',brl(tot_meta)); c3.metric('Atingimento',pct(ating)); c4.metric('Clientes positivados',f'{clientes_pos:,}'.replace(',','.')); c5.metric('Ticket médio/pedido',brl(ticket))
aba1,aba2,aba3=st.tabs(['Indicadores e Resultados','Carteira','Mix'])
with aba1:
    fat_rca=fat.groupby(['COD_RCA','RCA'],dropna=False).agg(FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index(); meta_rca=meta.groupby(['COD_RCA','RCA'],dropna=False)['META'].sum().reset_index()
    tab=rcas[rcas['ATIVO'].eq('S') & rcas['SUPERVISOR'].isin(sup_sel) & rcas['RCA'].isin(rca_sel)][['COD_RCA','RCA']].drop_duplicates(); tab=tab.merge(fat_rca,on=['COD_RCA','RCA'],how='left').merge(meta_rca,on=['COD_RCA','RCA'],how='left').fillna({'FATURAMENTO':0,'PEDIDOS':0,'META':0}); tab['ATINGIMENTO']=tab['FATURAMENTO'].div(tab['META'].replace(0,pd.NA))*100
    mix=fat.groupby('COD_RCA').agg(SECOES=('SECAO','nunique'),PRODUTOS=('CODPROD','nunique')).reset_index(); tab=tab.merge(mix,on='COD_RCA',how='left').fillna({'SECOES':0,'PRODUTOS':0}); ex=tab[['RCA','FATURAMENTO','META','ATINGIMENTO','SECOES','PRODUTOS']].copy(); ex.columns=['RCA','Faturamento','Meta','Atingimento %','Seções vendidas','Produtos distintos']; st.dataframe(ex.style.format({'Faturamento':brl,'Meta':brl,'Atingimento %':pct}),use_container_width=True,hide_index=True); st.info('Margem bruta e descontos ficam reservados para a próxima fonte de dados. Não serão estimados.')
with aba2:
    hist=vendas[vendas['FATURADO']].copy(); primeira=hist.groupby(['COD_RCA','CODCLI'])['DATA_FAT'].min().rename('PRIMEIRA_COMPRA').reset_index(); pos=fat.groupby(['COD_RCA','RCA']).agg(POSITIVADOS=('CODCLI','nunique'),FAT=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index(); novos=fat[['COD_RCA','CODCLI']].drop_duplicates().merge(primeira,on=['COD_RCA','CODCLI'],how='left'); novos['NOVO']=novos['PRIMEIRA_COMPRA'].dt.to_period('M').astype(str).eq(mes); novos=novos.groupby('COD_RCA')['NOVO'].sum().rename('NOVOS').reset_index(); pos=pos.merge(novos,on='COD_RCA',how='left'); pos['TICKET_MEDIO']=pos['FAT']/pos['PEDIDOS'].replace(0,pd.NA); fim=pd.Period(mes).end_time.normalize(); ini90=fim-pd.Timedelta(days=89); antes=hist[hist['DATA_FAT']<=fim].groupby(['COD_RCA','CODCLI'])['DATA_FAT'].max().rename('ULTIMA').reset_index(); inat=antes[antes['ULTIMA']<ini90].groupby('COD_RCA')['CODCLI'].nunique().rename('INATIVADOS').reset_index(); pos=pos.merge(inat,on='COD_RCA',how='left').fillna({'INATIVADOS':0}); out=pos[['RCA','POSITIVADOS','NOVOS','INATIVADOS','TICKET_MEDIO']].copy(); out.columns=['RCA','Positivados','Novos','Inativados (90+ dias)','Ticket médio']; st.dataframe(out.style.format({'Ticket médio':brl}),use_container_width=True,hide_index=True); st.caption('Regra provisória: inativado = cliente com histórico de compra para o RCA e sem faturamento nos últimos 90 dias até o fim do mês selecionado.')
with aba3:
    st.subheader('Mix médio por pedido')
    if fat.empty: st.warning('Sem faturamento fechado no período selecionado.')
    else:
        por_pedido=fat.groupby(['COD_RCA','RCA','NUMPED']).agg(SECOES=('SECAO','nunique'),PRODUTOS=('CODPROD','nunique')).reset_index(); mixrca=por_pedido.groupby('RCA').agg(**{'Seções/pedido':('SECOES','mean'),'Produtos/pedido':('PRODUTOS','mean'),'Pedidos':('NUMPED','nunique')}).reset_index(); st.dataframe(mixrca.style.format({'Seções/pedido':'{:.2f}','Produtos/pedido':'{:.2f}'}),use_container_width=True,hide_index=True); dep=fat.groupby('DEPARTAMENTO',as_index=False)['VALOR'].sum().sort_values('VALOR',ascending=False); st.plotly_chart(px.bar(dep,x='DEPARTAMENTO',y='VALOR',title='Faturamento por departamento'),use_container_width=True)
st.divider(); st.caption('Versão inicial. A exportação Produto (14) informa limite de 150.000 linhas; o histórico pode estar truncado na origem.')
