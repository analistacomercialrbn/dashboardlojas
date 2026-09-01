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

NAVY = '#1E2655'
NAVY_2 = '#2D396F'
BG = '#F6F7FB'
TEXT = '#20263A'
MUTED = '#737A8C'
GREEN = '#2E8B57'
RED = '#C94A55'

NE_CODES = {
    'AL':'27','BA':'29','CE':'23','MA':'21','PB':'25','PE':'26','PI':'22','RN':'24','SE':'28'
}

st.markdown(f"""
<style>
[data-testid="stAppViewContainer"] {{ background:{BG}; }}
[data-testid="stHeader"] {{ background:rgba(0,0,0,0); }}
[data-testid="stSidebar"] {{ background:#fff; border-right:1px solid #E6E8EF; }}
.block-container {{ padding-top:1.7rem; padding-bottom:2rem; max-width:1500px; }}
h1,h2,h3 {{ color:{NAVY}; letter-spacing:-.02em; }}
.brandbar {{ display:flex; align-items:center; justify-content:space-between; gap:18px; background:{NAVY}; padding:18px 24px; border-radius:18px; margin-bottom:18px; box-shadow:0 8px 24px rgba(30,38,85,.14); }}
.brand-title {{ color:white; font-size:30px; font-weight:750; margin:0; }}
.brand-sub {{ color:#DDE2F4; font-size:13px; margin-top:5px; }}
.brand-word {{ color:white; font-size:24px; font-weight:900; letter-spacing:.08em; }}
.kpi {{ background:#fff; border:1px solid #E6E8EF; border-radius:16px; padding:16px 18px; min-height:116px; box-shadow:0 4px 14px rgba(30,38,85,.06); }}
.kpi-label {{ color:{MUTED}; font-size:12px; font-weight:650; text-transform:uppercase; letter-spacing:.06em; }}
.kpi-value {{ color:{NAVY}; font-size:25px; font-weight:760; margin-top:7px; white-space:nowrap; }}
.kpi-note {{ color:{MUTED}; font-size:11px; margin-top:4px; }}
.section-note {{ color:{MUTED}; font-size:12px; margin-top:-8px; margin-bottom:14px; }}
[data-baseweb="tab-list"] {{ gap:22px; }}
[data-baseweb="tab-highlight"] {{ background-color:{NAVY}; }}
div[data-testid="stDataFrame"] {{ border:1px solid #E5E7EF; border-radius:14px; overflow:hidden; }}
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


def norm(v):
    if pd.isna(v): return ''
    s = unicodedata.normalize('NFKD', str(v))
    return ''.join(c for c in s if not unicodedata.combining(c)).upper().strip()


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
        height=height, margin=dict(l=12,r=12,t=54,b=12),
        paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
        font=dict(color=TEXT,size=12), title_font=dict(color=NAVY,size=18),
        legend=dict(orientation=legend,yanchor='bottom',y=1.02,xanchor='left',x=0),
        hoverlabel=dict(bgcolor='white',font_color=TEXT),
    )
    fig.update_xaxes(showgrid=False,linecolor='#E5E7EF')
    fig.update_yaxes(gridcolor='#ECEEF4',zeroline=False)
    return fig


def kpi(label, value, note=''):
    return f"<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value'>{value}</div><div class='kpi-note'>{note}</div></div>"


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
def load_nordeste_geojson():
    features = []
    for uf, code in NE_CODES.items():
        url = f'https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-{code}-mun.json'
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        data = r.json()
        for ft in data.get('features', []):
            name = ft.get('properties', {}).get('name', '')
            ft.setdefault('properties', {})['uf'] = uf
            ft['properties']['key'] = f'{uf}|{norm(name)}'
            features.append(ft)
    return {'type':'FeatureCollection','features':features}


try:
    vendas, clientes, rcas, metas = load(BASE_VENDAS_VERSAO)
except Exception as e:
    st.error(str(e)); st.stop()

st.markdown(f"""
<div class='brandbar'>
  <div><div class='brand-title'>Dashboard de Supervisão</div><div class='brand-sub'>Gestão comercial • faturamento, carteira, mix e cobertura municipal</div></div>
  <div class='brand-word'>REBANHO</div>
</div>
""", unsafe_allow_html=True)

ativos = rcas[rcas['ATIVO'].eq('S')].copy()
meses = sorted(set(vendas.loc[vendas.FATURADO,'MES_FAT'].dropna().astype(str)) | set(metas.MES.dropna().astype(str)), reverse=True)
mes = st.sidebar.selectbox('Mês de análise', meses, index=meses.index('2026-08') if '2026-08' in meses else 0, format_func=mes_nome)

sups = sorted(ativos.SUPERVISOR.dropna().unique())
ss = st.sidebar.multiselect('Supervisor', sups, default=[], placeholder='Todos os supervisores')
ss_eff = ss or sups
ro = sorted(ativos.loc[ativos.SUPERVISOR.isin(ss_eff),'RCA'].dropna().unique())
rs = st.sidebar.multiselect('RCA', ro, default=[], placeholder='Todos os RCAs')
rs_eff = rs or ro

deps = sorted(set(vendas.loc[vendas.MES_FAT.eq(mes),'DEPARTAMENTO'].dropna().astype(str)) | set(metas.loc[metas.MES.eq(mes),'DEPARTAMENTO'].dropna().astype(str)))
ds = st.sidebar.multiselect('Departamento', deps, default=[], placeholder='Todos os departamentos')
ds_eff = ds or deps
st.sidebar.caption('Seleções vazias significam “Todos”.')

cods = set(ativos.loc[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff),'COD_RCA'].dropna())
fat = vendas[vendas.FATURADO & vendas.MES_FAT.eq(mes) & vendas.COD_RCA.isin(cods) & vendas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = metas[metas.MES.eq(mes) & metas.COD_RCA.isin(cods) & metas.DEPARTAMENTO.astype(str).isin(ds_eff)].copy()
meta = meta.merge(ativos[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA'), on='COD_RCA', how='left')

F = fat.VALOR.sum(); M = meta.META.sum(); P = fat.NUMPED.nunique(); C = fat.CODCLI.nunique(); A = F/M*100 if M else pd.NA
base = ativos[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff)][['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA')
fr = fat.groupby('COD_RCA').agg(FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique'),POSITIVADOS=('CODCLI','nunique')).reset_index()
mr = meta.groupby('COD_RCA',as_index=False).META.sum()

if fat.empty:
    mix = pd.DataFrame(columns=['COD_RCA','MIX_PRODUTOS_CLIENTE'])
    mix_geral = 0
else:
    pc = fat.groupby(['COD_RCA','CODCLI']).agg(PRODUTOS=('CODPROD','nunique')).reset_index()
    mix = pc.groupby('COD_RCA').agg(MIX_PRODUTOS_CLIENTE=('PRODUTOS','mean')).reset_index()
    mix_geral = pc.PRODUTOS.mean()

r = base.merge(fr,on='COD_RCA',how='left').merge(mr,on='COD_RCA',how='left').merge(mix,on='COD_RCA',how='left').fillna({'FATURAMENTO':0,'PEDIDOS':0,'POSITIVADOS':0,'META':0,'MIX_PRODUTOS_CLIENTE':0})
r['ATINGIMENTO'] = r.FATURAMENTO.div(r.META.replace(0,pd.NA))*100
r['TICKET'] = r.FATURAMENTO.div(r.PEDIDOS.replace(0,pd.NA))

hist = vendas[vendas.FATURADO & vendas.CODCLI.notna()].copy()
primeira = hist.groupby('CODCLI',as_index=False)['DATA_FAT'].min().rename(columns={'DATA_FAT':'PRIMEIRA_COMPRA'})
novos_mes = fat[['COD_RCA','CODCLI']].drop_duplicates().merge(primeira,on='CODCLI',how='left')
novos_mes['NOVO'] = novos_mes['PRIMEIRA_COMPRA'].dt.to_period('M').astype('string').eq(mes)
nr = novos_mes.groupby('COD_RCA')['NOVO'].sum().rename('NOVOS').reset_index()

fim = pd.Period(mes).end_time.normalize()
vida = hist.groupby('CODCLI',as_index=False).DATA_FAT.max().rename(columns={'DATA_FAT':'ULTIMA'})
car = clientes[clientes.COD_RCA.isin(cods)][['CODCLI','COD_RCA']].drop_duplicates().merge(vida,on='CODCLI',how='left')
car['INATIVO'] = car.ULTIMA.notna() & car.ULTIMA.lt(fim-pd.Timedelta(days=89))
ir = car.groupby('COD_RCA')['INATIVO'].sum().rename('INATIVADOS').reset_index()
r = r.merge(nr,on='COD_RCA',how='left').merge(ir,on='COD_RCA',how='left').fillna({'NOVOS':0,'INATIVADOS':0})

novos_total = int(r.NOVOS.sum()); inativos_total = int(r.INATIVADOS.sum())

k1,k2,k3,k4,k5,k6 = st.columns(6)
k1.markdown(kpi('Faturamento',brl_compacto(F),brl(F)),unsafe_allow_html=True)
k2.markdown(kpi('Meta',brl_compacto(M),brl(M)),unsafe_allow_html=True)
k3.markdown(kpi('Atingimento',pct(A),'Faturamento ÷ meta'),unsafe_allow_html=True)
k4.markdown(kpi('Clientes positivados',nint(C),'Clientes únicos no mês'),unsafe_allow_html=True)
k5.markdown(kpi('Ticket médio',brl_compacto(F/P if P else 0),'Por pedido faturado'),unsafe_allow_html=True)
k6.markdown(kpi('Mix médio',dec(mix_geral),'Produtos distintos por cliente'),unsafe_allow_html=True)

st.caption(f'Fonte de vendas: {BASE_VENDAS_VERSAO} • Competência definida pela Data de Faturamento.')

aba1,aba2,aba3,aba4 = st.tabs(['Visão Geral','Carteira','Mix e Oportunidades','Cidades 🗺️'])

with aba1:
    st.subheader('Resultado por supervisão')
    s = r.groupby('SUPERVISOR',as_index=False).agg(FATURAMENTO=('FATURAMENTO','sum'),META=('META','sum'))
    s['ATINGIMENTO'] = s.FATURAMENTO.div(s.META.replace(0,pd.NA))*100
    fig = go.Figure()
    fig.add_bar(x=s.SUPERVISOR,y=s.META,name='Meta',marker_color='#C8CEE1')
    fig.add_bar(x=s.SUPERVISOR,y=s.FATURAMENTO,name='Faturamento',marker_color=NAVY)
    fig.update_layout(barmode='group',title='Faturamento x Meta por supervisão',yaxis_tickprefix='R$ ',yaxis_tickformat='.2s')
    st.plotly_chart(chart_layout(fig,390),use_container_width=True)

    c1,c2 = st.columns(2)
    with c1:
        rr = r.sort_values('ATINGIMENTO')
        fig = px.bar(rr,x='ATINGIMENTO',y='RCA',orientation='h',title='Atingimento de meta por RCA',text=rr.ATINGIMENTO.map(pct))
        fig.update_traces(marker_color=NAVY,textposition='outside')
        fig.add_vline(x=100,line_dash='dash',line_color=GREEN)
        st.plotly_chart(chart_layout(fig,max(430,28*len(rr)+100),'v'),use_container_width=True)
    with c2:
        dep = fat.groupby('DEPARTAMENTO',as_index=False).VALOR.sum().sort_values('VALOR')
        fig = px.bar(dep,x='VALOR',y='DEPARTAMENTO',orientation='h',title='Faturamento por departamento')
        fig.update_traces(marker_color=NAVY_2)
        st.plotly_chart(chart_layout(fig,max(430,32*len(dep)+90),'v'),use_container_width=True)

    st.subheader('Painel por RCA')
    tabela = pd.DataFrame({
        'RCA':r.RCA,'Supervisor':r.SUPERVISOR,'Faturamento':r.FATURAMENTO.map(brl),'Meta':r.META.map(brl),
        'Atingimento':r.ATINGIMENTO.map(pct),'Clientes':r.POSITIVADOS.map(nint),'Ticket médio':r.TICKET.map(brl),
        'Mix prod./cliente':r.MIX_PRODUTOS_CLIENTE.map(dec),'Margem':'—','Descontos':'—'
    })
    st.dataframe(tabela,use_container_width=True,hide_index=True,height=min(620,40+35*len(tabela)))

with aba2:
    st.subheader('Saúde da carteira')
    x1,x2,x3,x4 = st.columns(4)
    x1.markdown(kpi('Positivados',nint(C),'Clientes que compraram no mês'),unsafe_allow_html=True)
    x2.markdown(kpi('Novos',nint(novos_total),'Primeira compra encontrada em 2026'),unsafe_allow_html=True)
    x3.markdown(kpi('Inativados',nint(inativos_total),'Sem faturamento há 90+ dias'),unsafe_allow_html=True)
    x4.markdown(kpi('Ticket médio',brl_compacto(F/P if P else 0),'Por pedido faturado'),unsafe_allow_html=True)
    c1,c2 = st.columns(2)
    with c1:
        cr = r.sort_values('POSITIVADOS')
        fig = px.bar(cr,x='POSITIVADOS',y='RCA',orientation='h',title='Clientes positivados por RCA',text='POSITIVADOS')
        fig.update_traces(marker_color=NAVY,textposition='outside')
        st.plotly_chart(chart_layout(fig,max(430,28*len(cr)+100),'v'),use_container_width=True)
    with c2:
        ci = r[['RCA','NOVOS','INATIVADOS']].sort_values('INATIVADOS')
        fig = go.Figure()
        fig.add_bar(y=ci.RCA,x=ci.NOVOS,name='Novos',orientation='h',marker_color=GREEN)
        fig.add_bar(y=ci.RCA,x=ci.INATIVADOS,name='Inativados',orientation='h',marker_color=RED)
        fig.update_layout(barmode='group',title='Novos x Inativados por RCA')
        st.plotly_chart(chart_layout(fig,max(430,28*len(ci)+100)),use_container_width=True)

with aba3:
    st.subheader('Mix por cliente')
    st.markdown("<div class='section-note'>Mix = média de produtos distintos comprados por cada cliente do RCA no mês. Cada cliente pesa uma vez.</div>",unsafe_allow_html=True)
    mixr = r.sort_values('MIX_PRODUTOS_CLIENTE')
    fig = px.bar(mixr,x='MIX_PRODUTOS_CLIENTE',y='RCA',orientation='h',title='Mix médio de produtos por cliente — RCA',text=mixr.MIX_PRODUTOS_CLIENTE.map(dec))
    fig.update_traces(marker_color=NAVY,textposition='outside')
    st.plotly_chart(chart_layout(fig,max(430,30*len(mixr)+100),'v'),use_container_width=True)
    if not fat.empty:
        pc_det = fat.groupby(['COD_RCA','RCA','CODCLI']).agg(PRODUTOS=('CODPROD','nunique'),FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index()
        c1,c2 = st.columns(2)
        with c1:
            fig = px.histogram(pc_det,x='PRODUTOS',nbins=min(20,max(6,int(pc_det.PRODUTOS.max()))),title='Distribuição do mix entre clientes')
            fig.update_traces(marker_color=NAVY_2)
            st.plotly_chart(chart_layout(fig,390,'v'),use_container_width=True)
        with c2:
            faixas = pd.cut(pc_det.PRODUTOS,bins=[0,1,3,5,10,float('inf')],labels=['1 produto','2–3','4–5','6–10','11+'],include_lowest=True)
            dist = faixas.value_counts(sort=False).reset_index(); dist.columns=['Faixa','Clientes']
            fig = px.pie(dist,names='Faixa',values='Clientes',hole=.58,title='Clientes por faixa de mix',color_discrete_sequence=[NAVY,NAVY_2,'#59659A','#8991B7','#BAC0D8'])
            st.plotly_chart(chart_layout(fig,390,'v'),use_container_width=True)

with aba4:
    st.subheader('Cobertura municipal — Nordeste')
    st.markdown("<div class='section-note'>Cada área é um município. A cor representa o faturamento no mês; municípios sem venda permanecem claros. Passe o mouse para ver os indicadores e clique para detalhar.</div>",unsafe_allow_html=True)

    if fat.empty:
        st.info('Sem faturamento para o recorte selecionado.')
    elif not {'CIDADE','UF'}.issubset(clientes.columns):
        st.warning('A base de clientes não contém as colunas CIDADE e UF necessárias para o mapa.')
    else:
        cli_cols = ['CODCLI','CIDADE','UF'] + (['CLIENTE'] if 'CLIENTE' in clientes.columns else [])
        cli_geo = clientes[cli_cols].drop_duplicates('CODCLI').copy()
        cli_geo['UF'] = cli_geo['UF'].astype(str).str.upper().str.strip()
        loc = fat.merge(cli_geo,on='CODCLI',how='left')
        loc = loc[loc.UF.isin(NE_CODES)].copy()
        loc['CIDADE_N'] = loc.CIDADE.map(norm)
        loc['KEY'] = loc.UF + '|' + loc.CIDADE_N

        city = loc.groupby(['KEY','CIDADE','UF'],dropna=False).agg(
            FATURAMENTO=('VALOR','sum'),CLIENTES=('CODCLI','nunique'),PEDIDOS=('NUMPED','nunique')
        ).reset_index()
        cmix = loc.groupby(['KEY','CODCLI']).CODPROD.nunique().rename('MIXCLI').reset_index()
        cmix = cmix.groupby('KEY').MIXCLI.mean().rename('MIX').reset_index()
        city = city.merge(cmix,on='KEY',how='left')

        geojson = load_nordeste_geojson()
        munis = pd.DataFrame([{
            'KEY':ft['properties']['key'],
            'CIDADE_MAPA':ft['properties'].get('name',''),
            'UF_MAPA':ft['properties'].get('uf','')
        } for ft in geojson['features']])
        mapa = munis.merge(city,on='KEY',how='left')
        mapa['CIDADE'] = mapa['CIDADE'].fillna(mapa['CIDADE_MAPA'])
        mapa['UF'] = mapa['UF'].fillna(mapa['UF_MAPA'])
        for c in ['FATURAMENTO','CLIENTES','PEDIDOS','MIX']:
            mapa[c] = pd.to_numeric(mapa[c],errors='coerce').fillna(0)

        z1,z2,z3,z4 = st.columns(4)
        vendidos = city[city.FATURAMENTO.gt(0)]
        z1.markdown(kpi('Cidades positivadas',nint(vendidos.shape[0]),'Com faturamento no mês'),unsafe_allow_html=True)
        z2.markdown(kpi('Municípios no mapa',nint(mapa.shape[0]),'Nordeste completo'),unsafe_allow_html=True)
        z3.markdown(kpi('Maior cidade',vendidos.loc[vendidos.FATURAMENTO.idxmax(),'CIDADE'] if len(vendidos) else '—','Por faturamento'),unsafe_allow_html=True)
        z4.markdown(kpi('Faturamento Nordeste',brl_compacto(city.FATURAMENTO.sum()),'Recorte atual'),unsafe_allow_html=True)

        positive = mapa.loc[mapa.FATURAMENTO.gt(0),'FATURAMENTO']
        zmax = float(positive.quantile(.95)) if len(positive) else 1.0
        zmax = max(zmax,1.0)
        custom = mapa[['CIDADE','UF','FATURAMENTO','CLIENTES','PEDIDOS','MIX']].to_numpy()
        fig = go.Figure(go.Choropleth(
            geojson=geojson,
            locations=mapa.KEY,
            z=mapa.FATURAMENTO,
            featureidkey='properties.key',
            zmin=0,
            zmax=zmax,
            colorscale=[
                [0.00,'#F4F5F9'],
                [0.01,'#E6E9F3'],
                [0.20,'#C7CDE2'],
                [0.45,'#8F99C1'],
                [0.70,'#56639A'],
                [1.00,NAVY]
            ],
            marker_line_color='#8D96B4',
            marker_line_width=.45,
            customdata=custom,
            colorbar=dict(title='Faturamento',thickness=14,len=.72),
            hovertemplate='<b>%{customdata[0]} - %{customdata[1]}</b><br>Faturamento: R$ %{customdata[2]:,.2f}<br>Clientes: %{customdata[3]:.0f}<br>Pedidos: %{customdata[4]:.0f}<br>Mix: %{customdata[5]:.2f}<extra></extra>'
        ))
        fig.update_geos(
            fitbounds='locations',
            visible=False,
            projection_type='mercator',
            bgcolor='rgba(0,0,0,0)'
        )
        fig.update_layout(
            height=720,
            margin=dict(l=0,r=0,t=8,b=0),
            paper_bgcolor='rgba(0,0,0,0)',
            dragmode=False
        )

        selected_key = None
        try:
            ev = st.plotly_chart(fig,use_container_width=True,on_select='rerun',selection_mode='points',key='mapa_municipal_ne')
            sel = getattr(ev,'selection',None)
            pts = getattr(sel,'points',None) if sel is not None else None
            if pts and isinstance(pts[0],dict):
                selected_key = pts[0].get('location')
        except Exception:
            st.plotly_chart(fig,use_container_width=True,key='mapa_municipal_ne_fallback')

        labels_df = city[['KEY','CIDADE','UF','FATURAMENTO']].copy()
        labels_df['LABEL'] = labels_df.CIDADE.astype(str) + ' - ' + labels_df.UF.astype(str)
        labels_df = labels_df.sort_values(['UF','CIDADE'])
        labels = labels_df.LABEL.tolist()
        key_to_label = dict(zip(labels_df.KEY,labels_df.LABEL))
        default_label = key_to_label.get(selected_key, labels[0] if labels else None)
        idx = labels.index(default_label) if default_label in labels else 0
        choice = st.selectbox('Cidade para detalhar',labels,index=idx if labels else None)

        if choice:
            row = labels_df.loc[labels_df.LABEL.eq(choice)].iloc[0]
            key = row.KEY
            d = loc[loc.KEY.eq(key)].copy()
            dcli = d.groupby('CODCLI').agg(PRODUTOS=('CODPROD','nunique'),FATURAMENTO=('VALOR','sum'),PEDIDOS=('NUMPED','nunique')).reset_index()
            a1,a2,a3,a4,a5 = st.columns(5)
            a1.markdown(kpi('Faturamento',brl_compacto(d.VALOR.sum()),brl(d.VALOR.sum())),unsafe_allow_html=True)
            a2.markdown(kpi('Clientes',nint(d.CODCLI.nunique()),'Positivados'),unsafe_allow_html=True)
            a3.markdown(kpi('Pedidos',nint(d.NUMPED.nunique()),'Faturados'),unsafe_allow_html=True)
            a4.markdown(kpi('Ticket médio',brl_compacto(d.VALOR.sum()/d.NUMPED.nunique() if d.NUMPED.nunique() else 0),'Por pedido'),unsafe_allow_html=True)
            a5.markdown(kpi('Mix médio',dec(dcli.PRODUTOS.mean()),'Produtos distintos/cliente'),unsafe_allow_html=True)

            c1,c2 = st.columns(2)
            with c1:
                rc = d.groupby('RCA',as_index=False).VALOR.sum().sort_values('VALOR')
                fig2 = px.bar(rc,x='VALOR',y='RCA',orientation='h',title=f'Faturamento por RCA — {row.CIDADE}')
                fig2.update_traces(marker_color=NAVY)
                st.plotly_chart(chart_layout(fig2,max(350,28*len(rc)+100),'v'),use_container_width=True)
            with c2:
                dp = d.groupby('DEPARTAMENTO',as_index=False).VALOR.sum().sort_values('VALOR')
                fig3 = px.bar(dp,x='VALOR',y='DEPARTAMENTO',orientation='h',title=f'Faturamento por departamento — {row.CIDADE}')
                fig3.update_traces(marker_color=NAVY_2)
                st.plotly_chart(chart_layout(fig3,max(350,30*len(dp)+100),'v'),use_container_width=True)

            st.subheader('Clientes da cidade')
            nomes = clientes[['CODCLI','CLIENTE']].drop_duplicates('CODCLI') if 'CLIENTE' in clientes.columns else pd.DataFrame(columns=['CODCLI','CLIENTE'])
            detail = dcli.merge(nomes,on='CODCLI',how='left').sort_values('FATURAMENTO',ascending=False)
            detail['Faturamento'] = detail.FATURAMENTO.map(brl)
            detail['Mix produtos'] = detail.PRODUTOS.map(nint)
            detail['Pedidos'] = detail.PEDIDOS.map(nint)
            cols = ['CODCLI'] + (['CLIENTE'] if 'CLIENTE' in detail.columns else []) + ['Faturamento','Mix produtos','Pedidos']
            st.dataframe(detail[cols].rename(columns={'CODCLI':'Código cliente','CLIENTE':'Cliente'}),use_container_width=True,hide_index=True)

st.divider()
st.caption(f'Base carregada: {len(vendas):,} linhas • Fonte: {BASE_VENDAS_VERSAO} • Filtro mensal pela Data de Faturamento.'.replace(',','.'))
