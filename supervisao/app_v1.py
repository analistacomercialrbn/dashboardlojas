from io import BytesIO
import unicodedata

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import requests
import streamlit as st

st.set_page_config(page_title='Dashboard de Supervisão', page_icon='📊', layout='wide')

VENDAS_ID = '1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'
AUX_ID = '1h3XtB-2aMSMGhr5Ws7P-6nijKZc3zeqI'
BASE_VENDAS_VERSAO = 'Produto (16)'
MUNICIPIOS_URL = 'https://raw.githubusercontent.com/kelvins/Municipios-Brasileiros/main/csv/municipios.csv'

NAVY = '#1E2655'
NAVY_2 = '#2D396F'
BLUE_LIGHT = '#E9EDF7'
BG = '#F6F7FB'
TEXT = '#20263A'
MUTED = '#737A8C'
GREEN = '#2E8B57'
RED = '#C94A55'
AMBER = '#C98A22'

UF_CODE = {
    11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',
    25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',
    43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'
}
NE_UFS = {'AL','BA','CE','MA','PB','PE','PI','RN','SE'}

st.markdown(f"""
<style>
:root {{ --rebanho: {NAVY}; }}
[data-testid="stAppViewContainer"] {{ background: {BG}; }}
[data-testid="stHeader"] {{ background: rgba(0,0,0,0); }}
[data-testid="stSidebar"] {{ background: #FFFFFF; border-right: 1px solid #E6E8EF; }}
.block-container {{ padding-top: 1.7rem; padding-bottom: 2rem; max-width: 1500px; }}
h1,h2,h3 {{ color:{NAVY}; letter-spacing:-0.02em; }}
.brandbar {{ display:flex; align-items:center; justify-content:space-between; gap:18px; background:{NAVY}; padding:18px 24px; border-radius:18px; margin-bottom:18px; box-shadow:0 8px 24px rgba(30,38,85,.14); }}
.brand-title {{ color:white; font-size:30px; font-weight:750; margin:0; }}
.brand-sub {{ color:#DDE2F4; font-size:13px; margin-top:5px; }}
.brand-word {{ color:white; font-size:24px; font-weight:900; letter-spacing:.08em; }}
.kpi {{ background:#FFFFFF; border:1px solid #E6E8EF; border-radius:16px; padding:16px 18px; min-height:116px; box-shadow:0 4px 14px rgba(30,38,85,.06); }}
.kpi-label {{ color:{MUTED}; font-size:12px; font-weight:650; text-transform:uppercase; letter-spacing:.06em; }}
.kpi-value {{ color:{NAVY}; font-size:26px; font-weight:760; margin-top:7px; white-space:nowrap; }}
.kpi-note {{ color:{MUTED}; font-size:11px; margin-top:4px; }}
.section-note {{ color:{MUTED}; font-size:12px; margin-top:-8px; margin-bottom:14px; }}
[data-baseweb="tab-list"] {{ gap:22px; }}
[data-baseweb="tab"] {{ padding-left:4px; padding-right:4px; }}
[data-baseweb="tab-highlight"] {{ background-color:{NAVY}; }}
div[data-testid="stDataFrame"] {{ border:1px solid #E5E7EF; border-radius:14px; overflow:hidden; }}
.stMultiSelect [data-baseweb="select"] > div {{ border-radius:10px; }}
</style>
""", unsafe_allow_html=True)


def drive_bytes(fid):
    r = requests.get(f'https://drive.google.com/uc?export=download&id={fid}', timeout=180)
    r.raise_for_status()
    if 'text/html' in r.headers.get('content-type','').lower():
        raise RuntimeError('Confirme o compartilhamento dos arquivos do Drive como leitor por link.')
    return BytesIO(r.content)


def cod(s):
    return pd.to_numeric(s.astype(str).str.extract(r'^\s*(\d+)', expand=False), errors='coerce').astype('Int64')


def dt(s):
    if pd.api.types.is_datetime64_any_dtype(s):
        return pd.to_datetime(s, errors='coerce')
    n = pd.to_numeric(s, errors='coerce')
    excel = pd.to_datetime(n, unit='D', origin='1899-12-30', errors='coerce')
    txt = pd.to_datetime(s.astype(str), dayfirst=True, errors='coerce')
    return txt.fillna(excel)


def brl(v, casas=2):
    if pd.isna(v): return '—'
    return f'R$ {float(v):,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def brl_compacto(v):
    v = float(v or 0)
    if abs(v) >= 1_000_000: return f'R$ {v/1_000_000:.2f} mi'.replace('.', ',')
    if abs(v) >= 1_000: return f'R$ {v/1_000:.1f} mil'.replace('.', ',')
    return brl(v)


def pct(v):
    return '—' if pd.isna(v) else f'{float(v):.1f}%'.replace('.', ',')


def nint(v):
    return f'{int(round(float(v or 0))):,}'.replace(',', '.')


def dec(v):
    return '—' if pd.isna(v) else f'{float(v):.2f}'.replace('.', ',')


def norm(v):
    if pd.isna(v): return ''
    s = unicodedata.normalize('NFKD', str(v))
    return ''.join(c for c in s if not unicodedata.combining(c)).upper().strip()


def mes_nome(x):
    p = pd.Period(x)
    nomes = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
    return f'{nomes[p.month]}/{p.year}'


def ler_vendas(buf):
    previa = pd.read_excel(buf, sheet_name='Sheet1', header=None, nrows=8)
    header = 0
    for i, row in previa.iterrows():
        vals = set(row.astype(str).str.strip())
        if 'Data Faturamento' in vals and 'Pedidos Enviados' in vals:
            header = i
            break
    buf.seek(0)
    return pd.read_excel(buf, sheet_name='Sheet1', header=header)


def chart_layout(fig, height=420, legend='h'):
    fig.update_layout(
        height=height,
        margin=dict(l=12, r=12, t=54, b=12),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font=dict(color=TEXT, size=12),
        title_font=dict(color=NAVY, size=18),
        legend=dict(orientation=legend, yanchor='bottom', y=1.02, xanchor='left', x=0),
        hoverlabel=dict(bgcolor='white', font_color=TEXT),
    )
    fig.update_xaxes(showgrid=False, linecolor='#E5E7EF')
    fig.update_yaxes(gridcolor='#ECEEF4', zeroline=False)
    return fig


def kpi(label, value, note=''):
    return f"""<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value'>{value}</div><div class='kpi-note'>{note}</div></div>"""


@st.cache_data(ttl=30, show_spinner='Carregando bases...')
def load(base_version):
    v = ler_vendas(drive_bytes(VENDAS_ID))
    aux = drive_bytes(AUX_ID)
    cli = pd.read_excel(aux, sheet_name='CLIENTES'); aux.seek(0)
    rca = pd.read_excel(aux, sheet_name='RCA'); aux.seek(0)
    met = pd.read_excel(aux, sheet_name='METAS')

    v['COD_RCA'] = cod(v['Cod/Vend.'])
    v['CODCLI'] = cod(v['Cod/Cliente'])
    v['CODPROD'] = cod(v['Cod/Produto'])
    v['DATA_PEDIDO'] = dt(v['Data Pedido'])
    v['DATA_FAT'] = dt(v['Data Faturamento'])
    v['VALOR'] = pd.to_numeric(v['Pedidos Enviados'], errors='coerce').fillna(0)
    v['FATURADO'] = v['DATA_FAT'].notna() & v['Posição'].astype(str).str.strip().str.upper().eq('FECHADO')
    v['MES_FAT'] = v['DATA_FAT'].dt.to_period('M').astype('string')

    for d in (cli, rca, met):
        d['COD_RCA'] = pd.to_numeric(d['COD_RCA'], errors='coerce').astype('Int64')
    cli['CODCLI'] = pd.to_numeric(cli['CODCLI'], errors='coerce').astype('Int64')
    rca['ATIVO'] = rca['ATIVO'].astype(str).str.upper().str.strip()
    met['MES'] = met['MES'].astype(str).str[:7]
    met['META'] = pd.to_numeric(met['META'], errors='coerce').fillna(0)

    h = rca[['COD_RCA','RCA','SUPERVISOR','ATIVO']].drop_duplicates('COD_RCA')
    v = v.merge(h, on='COD_RCA', how='left')
    return v, cli, rca, met


@st.cache_data(ttl=86400, show_spinner=False)
def load_municipios():
    g = pd.read_csv(MUNICIPIOS_URL)
    g['UF'] = pd.to_numeric(g['codigo_uf'], errors='coerce').map(UF_CODE)
    g['CIDADE_N'] = g['nome'].map(norm)
    g['UF_N'] = g['UF'].map(norm)
    return g[['nome','UF','CIDADE_N','UF_N','latitude','longitude']].dropna(subset=['latitude','longitude'])


try:
    vendas, clientes, rcas, metas = load(BASE_VENDAS_VERSAO)
except Exception as e:
    st.error(str(e)); st.stop()

st.markdown(f"""
<div class='brandbar'>
  <div><div class='brand-title'>Dashboard de Supervisão</div><div class='brand-sub'>Gestão comercial • faturamento, carteira, mix e cobertura por cidade</div></div>
  <div class='brand-word'>REBANHO</div>
</div>
""", unsafe_allow_html=True)

ativos = rcas[rcas['ATIVO'].eq('S')].copy()
meses = sorted(set(vendas.loc[vendas.FATURADO,'MES_FAT'].dropna().astype(str)) | set(metas.MES.dropna().astype(str)), reverse=True)
mes = st.sidebar.selectbox('Mês de análise', meses, index=meses.index('2026-08') if '2026-08' in meses else 0, format_func=mes_nome)

sups = sorted(ativos.SUPERVISOR.dropna().unique())
ss = st.sidebar.multiselect('Supervisor', sups, default=[], placeholder='Todos os supervisores')
ss_eff = ss or sups
ro = sorted(ativos.loc[ativos.SUPERVISOR.isin(ss_eff), 'RCA'].dropna().unique())
rs = st.sidebar.multiselect('RCA', ro, default=[], placeholder='Todos os RCAs')
rs_eff = rs or ro

deps = sorted(set(vendas.loc[vendas.MES_FAT.eq(mes),'DEPARTAMENTO'].dropna().astype(str)) | set(metas.loc[metas.MES.eq(mes),'DEPARTAMENTO'].dropna().astype(str)))
ds = st.sidebar.multiselect('Departamento', deps, default=[], placeholder='Todos os departamentos')
ds_eff = ds or deps
st.sidebar.caption('Seleções vazias significam “Todos”.')

cods = set(ativos.loc[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff), 'COD_RCA'].dropna())
fat = vendas[vendas.FATURADO & vendas.MES_FAT.eq(mes) & vendas.COD_RCA.isin(cods) & vendas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = metas[metas.MES.eq(mes) & metas.COD_RCA.isin(cods) & metas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = meta.merge(ativos[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA'), on='COD_RCA', how='left')

F = fat.VALOR.sum(); M = meta.META.sum(); P = fat.NUMPED.nunique(); C = fat.CODCLI.nunique(); A = F/M*100 if M else pd.NA

base = ativos[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff)][['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA')
fr = fat.groupby('COD_RCA').agg(FATURAMENTO=('VALOR','sum'), PEDIDOS=('NUMPED','nunique'), POSITIVADOS=('CODCLI','nunique')).reset_index()
mr = meta.groupby('COD_RCA', as_index=False).META.sum()

if fat.empty:
    mix = pd.DataFrame(columns=['COD_RCA','MIX_PRODUTOS_CLIENTE','DEPTOS_CLIENTE'])
    mix_geral = 0
else:
    pc = fat.groupby(['COD_RCA','CODCLI']).agg(PRODUTOS=('CODPROD','nunique'), DEPTOS=('DEPARTAMENTO','nunique')).reset_index()
    mix = pc.groupby('COD_RCA').agg(MIX_PRODUTOS_CLIENTE=('PRODUTOS','mean'), DEPTOS_CLIENTE=('DEPTOS','mean')).reset_index()
    mix_geral = pc.PRODUTOS.mean()

r = base.merge(fr, on='COD_RCA', how='left').merge(mr, on='COD_RCA', how='left').merge(mix, on='COD_RCA', how='left').fillna({'FATURAMENTO':0,'PEDIDOS':0,'POSITIVADOS':0,'META':0,'MIX_PRODUTOS_CLIENTE':0,'DEPTOS_CLIENTE':0})
r['ATINGIMENTO'] = r.FATURAMENTO.div(r.META.replace(0,pd.NA))*100
r['TICKET'] = r.FATURAMENTO.div(r.PEDIDOS.replace(0,pd.NA))

hist = vendas[vendas.FATURADO & vendas.CODCLI.notna()].copy()
primeira = hist.groupby('CODCLI', as_index=False)['DATA_FAT'].min().rename(columns={'DATA_FAT':'PRIMEIRA_COMPRA'})
novos_mes = fat[['COD_RCA','CODCLI']].drop_duplicates().merge(primeira, on='CODCLI', how='left')
novos_mes['NOVO'] = novos_mes['PRIMEIRA_COMPRA'].dt.to_period('M').astype('string').eq(mes)
nr = novos_mes.groupby('COD_RCA')['NOVO'].sum().rename('NOVOS').reset_index()

fim = pd.Period(mes).end_time.normalize()
vida = hist.groupby('CODCLI', as_index=False).DATA_FAT.max().rename(columns={'DATA_FAT':'ULTIMA'})
car = clientes[clientes.COD_RCA.isin(cods)][['CODCLI','COD_RCA']].drop_duplicates().merge(vida, on='CODCLI', how='left')
car['INATIVO'] = car.ULTIMA.notna() & car.ULTIMA.lt(fim - pd.Timedelta(days=89))
ir = car.groupby('COD_RCA')['INATIVO'].sum().rename('INATIVADOS').reset_index()
r = r.merge(nr, on='COD_RCA', how='left').merge(ir, on='COD_RCA', how='left').fillna({'NOVOS':0,'INATIVADOS':0})

novos_total = int(r.NOVOS.sum())
inativos_total = int(r.INATIVADOS.sum())

k1,k2,k3,k4,k5,k6 = st.columns(6)
k1.markdown(kpi('Faturamento', brl_compacto(F), brl(F)), unsafe_allow_html=True)
k2.markdown(kpi('Meta', brl_compacto(M), brl(M)), unsafe_allow_html=True)
k3.markdown(kpi('Atingimento', pct(A), 'Faturamento ÷ meta'), unsafe_allow_html=True)
k4.markdown(kpi('Clientes positivados', nint(C), 'Clientes únicos no mês'), unsafe_allow_html=True)
k5.markdown(kpi('Ticket médio', brl_compacto(F/P if P else 0), 'Por pedido faturado'), unsafe_allow_html=True)
k6.markdown(kpi('Mix médio', dec(mix_geral), 'Produtos distintos por cliente'), unsafe_allow_html=True)

st.caption(f'Fonte de vendas: {BASE_VENDAS_VERSAO} • Competência definida pela Data de Faturamento.')

aba1, aba2, aba3, aba4 = st.tabs(['Visão Geral', 'Carteira', 'Mix e Oportunidades', 'Cidades 🗺️'])

with aba1:
    st.subheader('Resultado por supervisão')
    s = r.groupby('SUPERVISOR', as_index=False).agg(FATURAMENTO=('FATURAMENTO','sum'), META=('META','sum'))
    s['ATINGIMENTO'] = s.FATURAMENTO.div(s.META.replace(0,pd.NA))*100
    fig = go.Figure()
    fig.add_bar(x=s.SUPERVISOR, y=s.META, name='Meta', marker_color='#C8CEE1')
    fig.add_bar(x=s.SUPERVISOR, y=s.FATURAMENTO, name='Faturamento', marker_color=NAVY)
    fig.update_layout(barmode='group', title='Faturamento x Meta por supervisão', yaxis_tickprefix='R$ ', yaxis_tickformat='.2s')
    st.plotly_chart(chart_layout(fig, 390), use_container_width=True)
    c1,c2 = st.columns([1.05,1])
    with c1:
        rr = r.sort_values('ATINGIMENTO', ascending=True).copy()
        fig2 = px.bar(rr, x='ATINGIMENTO', y='RCA', orientation='h', title='Atingimento de meta por RCA', text=rr.ATINGIMENTO.map(pct))
        fig2.update_traces(marker_color=NAVY, textposition='outside')
        fig2.add_vline(x=100, line_dash='dash', line_color=GREEN, annotation_text='100%')
        st.plotly_chart(chart_layout(fig2, max(430,28*len(rr)+100), legend='v'), use_container_width=True)
    with c2:
        dep = fat.groupby('DEPARTAMENTO', as_index=False).VALOR.sum().sort_values('VALOR', ascending=False)
        fig3 = px.bar(dep, x='VALOR', y='DEPARTAMENTO', orientation='h', title='Faturamento por departamento')
        fig3.update_traces(marker_color=NAVY_2)
        fig3.update_yaxes(categoryorder='total ascending')
        st.plotly_chart(chart_layout(fig3, max(430,32*len(dep)+90), legend='v'), use_container_width=True)
    st.subheader('Painel por RCA')
    tabela = pd.DataFrame({'RCA':r.RCA,'Supervisor':r.SUPERVISOR,'Faturamento':r.FATURAMENTO.map(brl),'Meta':r.META.map(brl),'Atingimento':r.ATINGIMENTO.map(pct),'Clientes':r.POSITIVADOS.map(nint),'Ticket médio':r.TICKET.map(brl),'Mix prod./cliente':r.MIX_PRODUTOS_CLIENTE.map(dec),'Margem':'—','Descontos':'—'})
    st.dataframe(tabela, use_container_width=True, hide_index=True, height=min(620,40+35*len(tabela)))

with aba2:
    st.subheader('Saúde da carteira')
    x1,x2,x3,x4 = st.columns(4)
    x1.markdown(kpi('Positivados',nint(C),'Clientes que compraram no mês'),unsafe_allow_html=True)
    x2.markdown(kpi('Novos',nint(novos_total),'Primeira compra encontrada em 2026'),unsafe_allow_html=True)
    x3.markdown(kpi('Inativados',nint(inativos_total),'Sem faturamento há 90+ dias'),unsafe_allow_html=True)
    x4.markdown(kpi('Ticket médio',brl_compacto(F/P if P else 0),'Por pedido faturado'),unsafe_allow_html=True)
    c1,c2 = st.columns(2)
    with c1:
        cr = r.sort_values('POSITIVADOS', ascending=True)
        fig = px.bar(cr, x='POSITIVADOS', y='RCA', orientation='h', title='Clientes positivados por RCA', text='POSITIVADOS')
        fig.update_traces(marker_color=NAVY, textposition='outside')
        st.plotly_chart(chart_layout(fig,max(430,28*len(cr)+100),legend='v'),use_container_width=True)
    with c2:
        ci = r[['RCA','NOVOS','INATIVADOS']].copy().sort_values('INATIVADOS',ascending=True)
        fig = go.Figure()
        fig.add_bar(y=ci.RCA,x=ci.NOVOS,name='Novos',orientation='h',marker_color=GREEN)
        fig.add_bar(y=ci.RCA,x=ci.INATIVADOS,name='Inativados',orientation='h',marker_color=RED)
        fig.update_layout(barmode='group',title='Novos x Inativados por RCA')
        st.plotly_chart(chart_layout(fig,max(430,28*len(ci)+100)),use_container_width=True)
    ct = pd.DataFrame({'RCA':r.RCA,'Positivados':r.POSITIVADOS.map(nint),'Novos':r.NOVOS.map(nint),'Inativados 90+ dias':r.INATIVADOS.map(nint),'Ticket médio':r.TICKET.map(brl)})
    st.dataframe(ct,use_container_width=True,hide_index=True)

with aba3:
    st.subheader('Mix por cliente')
    st.markdown("<div class='section-note'>Mix = média de produtos distintos comprados por cada cliente do RCA no mês. O cliente é contado uma única vez, mesmo que faça vários pedidos.</div>", unsafe_allow_html=True)
    m1,m2,m3,m4 = st.columns(4)
    melhor = r.loc[r.MIX_PRODUTOS_CLIENTE.idxmax()] if len(r) else None
    m1.markdown(kpi('Mix médio geral',dec(mix_geral),'Produtos distintos por cliente'),unsafe_allow_html=True)
    m2.markdown(kpi('Maior mix RCA',dec(melhor.MIX_PRODUTOS_CLIENTE) if melhor is not None else '—',melhor.RCA if melhor is not None else ''),unsafe_allow_html=True)
    m3.markdown(kpi('Produtos distintos',nint(fat.CODPROD.nunique()),'No recorte selecionado'),unsafe_allow_html=True)
    m4.markdown(kpi('Clientes analisados',nint(C),'Clientes únicos no mês'),unsafe_allow_html=True)
    mixr = r.sort_values('MIX_PRODUTOS_CLIENTE',ascending=True)
    fig = px.bar(mixr,x='MIX_PRODUTOS_CLIENTE',y='RCA',orientation='h',title='Mix médio de produtos por cliente — RCA',text=mixr.MIX_PRODUTOS_CLIENTE.map(dec))
    fig.update_traces(marker_color=NAVY,textposition='outside')
    st.plotly_chart(chart_layout(fig,max(430,30*len(mixr)+100),legend='v'),use_container_width=True)
    if not fat.empty:
        pc_det = fat.groupby(['COD_RCA','RCA','CODCLI']).agg(PRODUTOS=('CODPROD','nunique'),FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index()
        c1,c2 = st.columns(2)
        with c1:
            fig = px.histogram(pc_det,x='PRODUTOS',nbins=min(20,max(6,int(pc_det.PRODUTOS.max()))),title='Distribuição do mix entre clientes')
            fig.update_traces(marker_color=NAVY_2)
            st.plotly_chart(chart_layout(fig,390,legend='v'),use_container_width=True)
        with c2:
            faixas = pd.cut(pc_det.PRODUTOS,bins=[0,1,3,5,10,float('inf')],labels=['1 produto','2–3','4–5','6–10','11+'],include_lowest=True)
            dist = faixas.value_counts(sort=False).reset_index(); dist.columns=['Faixa','Clientes']
            fig = px.pie(dist,names='Faixa',values='Clientes',hole=.58,title='Clientes por faixa de mix',color_discrete_sequence=[NAVY,NAVY_2,'#59659A','#8991B7','#BAC0D8'])
            st.plotly_chart(chart_layout(fig,390,legend='v'),use_container_width=True)
        st.subheader('Detalhe do RCA')
        rd = st.selectbox('Selecionar RCA para aprofundar',sorted(fat.RCA.dropna().unique()))
        d = fat[fat.RCA.eq(rd)]
        dcli = d.groupby('CODCLI').agg(PRODUTOS=('CODPROD','nunique'),FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index()
        y1,y2,y3,y4 = st.columns(4)
        y1.markdown(kpi('Faturamento',brl_compacto(d.VALOR.sum()),brl(d.VALOR.sum())),unsafe_allow_html=True)
        y2.markdown(kpi('Clientes',nint(d.CODCLI.nunique()),'Positivados'),unsafe_allow_html=True)
        y3.markdown(kpi('Mix médio',dec(dcli.PRODUTOS.mean()),'Produtos distintos/cliente'),unsafe_allow_html=True)
        y4.markdown(kpi('Pedidos',nint(d.NUMPED.nunique()),'Pedidos faturados'),unsafe_allow_html=True)

with aba4:
    st.subheader('Cobertura por cidade — Nordeste')
    st.markdown("<div class='section-note'>Mapa restrito aos nove estados do Nordeste. Clique em um ponto para selecionar a cidade; se o navegador não devolver o clique, use o seletor abaixo.</div>", unsafe_allow_html=True)

    if fat.empty:
        st.info('Sem faturamento para o recorte selecionado.')
    elif not {'CIDADE','UF'}.issubset(clientes.columns):
        st.warning('A base de clientes não contém as colunas CIDADE e UF necessárias para o mapa.')
    else:
        cols_cli = ['CODCLI','CIDADE','UF'] + (['PRACA'] if 'PRACA' in clientes.columns else [])
        cli_geo = clientes[cols_cli].drop_duplicates('CODCLI').copy()
        loc = fat.merge(cli_geo,on='CODCLI',how='left')
        loc['CIDADE_N'] = loc['CIDADE'].map(norm)
        loc['UF_N'] = loc['UF'].map(norm)
        loc = loc[loc['UF_N'].isin(NE_UFS)].copy()
        loc['PRACA_N'] = loc['PRACA'].map(norm) if 'PRACA' in loc.columns else ''

        city = loc.groupby(['CIDADE','UF','CIDADE_N','UF_N','PRACA_N'],dropna=False).agg(FATURAMENTO=('VALOR','sum'),CLIENTES=('CODCLI','nunique'),PEDIDOS=('NUMPED','nunique')).reset_index()
        city_mix = loc.groupby(['CIDADE_N','UF_N','CODCLI']).CODPROD.nunique().rename('MIXCLI').reset_index()
        city_mix = city_mix.groupby(['CIDADE_N','UF_N']).MIXCLI.mean().rename('MIX').reset_index()
        city = city.merge(city_mix,on=['CIDADE_N','UF_N'],how='left')

        geo = load_municipios()
        city = city.merge(geo[['CIDADE_N','UF_N','latitude','longitude']],on=['CIDADE_N','UF_N'],how='left')
        sem_coord = city['latitude'].isna() & city['PRACA_N'].ne('')
        if sem_coord.any():
            fallback = city.loc[sem_coord,['PRACA_N','UF_N']].merge(geo[['CIDADE_N','UF_N','latitude','longitude']],left_on=['PRACA_N','UF_N'],right_on=['CIDADE_N','UF_N'],how='left')
            city.loc[sem_coord,'latitude'] = fallback['latitude'].to_numpy()
            city.loc[sem_coord,'longitude'] = fallback['longitude'].to_numpy()

        mapped = city.dropna(subset=['latitude','longitude']).copy()
        z1,z2,z3,z4 = st.columns(4)
        z1.markdown(kpi('Cidades positivadas',nint(city.shape[0]),'Nordeste'),unsafe_allow_html=True)
        z2.markdown(kpi('Cidades no mapa',nint(mapped.shape[0]),'Com coordenadas localizadas'),unsafe_allow_html=True)
        z3.markdown(kpi('Maior cidade',city.loc[city.FATURAMENTO.idxmax(),'CIDADE'] if len(city) else '—','Por faturamento'),unsafe_allow_html=True)
        z4.markdown(kpi('Faturamento Nordeste',brl_compacto(city.FATURAMENTO.sum()),'Recorte atual'),unsafe_allow_html=True)

        selected_label = None
        if not mapped.empty:
            mapped['LABEL'] = mapped['CIDADE'].astype(str) + ' - ' + mapped['UF'].astype(str)
            sizeref = max(mapped['FATURAMENTO'].max()/1400,1)
            fig = go.Figure(go.Scattergeo(
                lon=mapped['longitude'],lat=mapped['latitude'],text=mapped['LABEL'],
                customdata=mapped[['LABEL','FATURAMENTO','CLIENTES','PEDIDOS','MIX']].to_numpy(),mode='markers',
                marker=dict(size=(mapped['FATURAMENTO']/sizeref).clip(lower=7,upper=42),color=mapped['FATURAMENTO'],colorscale=[[0,'#DDE2F4'],[0.45,'#59659A'],[1,NAVY]],line=dict(width=1,color='white'),opacity=.88,colorbar=dict(title='Faturamento')),
                hovertemplate='<b>%{customdata[0]}</b><br>Faturamento: R$ %{customdata[1]:,.2f}<br>Clientes: %{customdata[2]}<br>Pedidos: %{customdata[3]}<br>Mix: %{customdata[4]:.2f}<extra></extra>'
            ))
            fig.update_geos(
                scope='south america', projection_type='mercator',
                showland=True, landcolor='#F0F2F8', showcountries=True, countrycolor='#D5D9E6',
                showcoastlines=True, coastlinecolor='#C8CEE1',
                lataxis_range=[-19.5,-1.0], lonaxis_range=[-49.5,-33.0],
                bgcolor='rgba(0,0,0,0)'
            )
            fig.update_layout(height=570,margin=dict(l=0,r=0,t=5,b=0),paper_bgcolor='rgba(0,0,0,0)')
            try:
                ev = st.plotly_chart(fig,use_container_width=True,on_select='rerun',selection_mode='points',key='mapa_cidades')
                selection = getattr(ev,'selection',None)
                points = getattr(selection,'points',None) if selection is not None else None
                if points:
                    cd = points[0].get('customdata') if isinstance(points[0],dict) else None
                    if cd is not None: selected_label = cd[0] if isinstance(cd,(list,tuple)) else str(cd)
            except Exception:
                st.plotly_chart(fig,use_container_width=True,key='mapa_cidades_fallback')

        labels = sorted((city['CIDADE'].fillna('').astype(str)+' - '+city['UF'].fillna('').astype(str)).unique())
        labels = [x for x in labels if x.strip(' -')]
        default_index = labels.index(selected_label) if selected_label in labels else 0
        choice = st.selectbox('Cidade para detalhar',labels,index=default_index if labels else None)
        if choice:
            cname,cuf = choice.rsplit(' - ',1)
            d = loc[(loc['CIDADE'].fillna('').astype(str)==cname)&(loc['UF'].fillna('').astype(str)==cuf)].copy()
            dcli = d.groupby('CODCLI').agg(PRODUTOS=('CODPROD','nunique'),FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index()
            a1,a2,a3,a4,a5 = st.columns(5)
            a1.markdown(kpi('Faturamento',brl_compacto(d.VALOR.sum()),brl(d.VALOR.sum())),unsafe_allow_html=True)
            a2.markdown(kpi('Clientes',nint(d.CODCLI.nunique()),'Positivados'),unsafe_allow_html=True)
            a3.markdown(kpi('Pedidos',nint(d.NUMPED.nunique()),'Faturados'),unsafe_allow_html=True)
            a4.markdown(kpi('Ticket médio',brl_compacto(d.VALOR.sum()/d.NUMPED.nunique() if d.NUMPED.nunique() else 0),'Por pedido'),unsafe_allow_html=True)
            a5.markdown(kpi('Mix médio',dec(dcli.PRODUTOS.mean()),'Produtos distintos/cliente'),unsafe_allow_html=True)
            c1,c2 = st.columns(2)
            with c1:
                rca_city = d.groupby('RCA',as_index=False).VALOR.sum().sort_values('VALOR')
                fig = px.bar(rca_city,x='VALOR',y='RCA',orientation='h',title=f'Faturamento por RCA — {cname}')
                fig.update_traces(marker_color=NAVY)
                st.plotly_chart(chart_layout(fig,max(350,28*len(rca_city)+100),'v'),use_container_width=True)
            with c2:
                dep_city = d.groupby('DEPARTAMENTO',as_index=False).VALOR.sum().sort_values('VALOR')
                fig = px.bar(dep_city,x='VALOR',y='DEPARTAMENTO',orientation='h',title=f'Faturamento por departamento — {cname}')
                fig.update_traces(marker_color=NAVY_2)
                st.plotly_chart(chart_layout(fig,max(350,30*len(dep_city)+100),'v'),use_container_width=True)
            st.subheader('Clientes da cidade')
            nomes = clientes[['CODCLI','CLIENTE']].drop_duplicates('CODCLI') if 'CLIENTE' in clientes.columns else pd.DataFrame(columns=['CODCLI','CLIENTE'])
            detail = dcli.merge(nomes,on='CODCLI',how='left').sort_values('FATURAMENTO',ascending=False)
            detail['Faturamento'] = detail.FATURAMENTO.map(brl)
            detail['Mix produtos'] = detail.PRODUTOS.map(nint)
            detail['Pedidos'] = detail.PEDIDOS.map(nint)
            cols = ['CODCLI'] + (['CLIENTE'] if 'CLIENTE' in detail.columns else []) + ['Faturamento','Mix produtos','Pedidos']
            st.dataframe(detail[cols].rename(columns={'CODCLI':'Código cliente','CLIENTE':'Cliente'}),use_container_width=True,hide_index=True)

st.divider()
st.caption(f'Base carregada: {len(vendas):,} linhas • Fonte: {BASE_VENDAS_VERSAO} • Filtro mensal sempre pela Data de Faturamento.'.replace(',','.'))
