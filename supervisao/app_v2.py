from io import BytesIO
import unicodedata
import time

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
[data-testid="stMain"] {{ width:100%; }}
[data-testid="stMainBlockContainer"],
.block-container {{
  width:100% !important;
  max-width:none !important;
  padding-top:1.35rem !important;
  padding-bottom:2rem !important;
  padding-left:clamp(1rem,2vw,2.75rem) !important;
  padding-right:clamp(1rem,2vw,2.75rem) !important;
}}
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
.filter-chip {{ display:inline-block; background:#EEF1F8; color:{NAVY}; border:1px solid #DCE1EE; border-radius:999px; padding:5px 10px; margin:0 6px 6px 0; font-size:11px; font-weight:650; }}
[data-baseweb="tab-list"] {{ gap:22px; }}
[data-baseweb="tab-highlight"] {{ background-color:{NAVY}; }}
div[data-testid="stDataFrame"] {{ border:1px solid #E5E7EF; border-radius:14px; overflow:hidden; width:100% !important; }}
.exec-section {{ margin-top:18px; }}
.exec-note {{ color:{MUTED}; font-size:12px; margin-top:-5px; margin-bottom:12px; }}

div[data-testid="stPlotlyChart"] {{ width:100% !important; }}
div[data-testid="stPlotlyChart"] > div {{ width:100% !important; }}

@media (min-width: 1800px) {{
  [data-testid="stMainBlockContainer"],
  .block-container {{
    padding-left:clamp(1.5rem,2.4vw,4rem) !important;
    padding-right:clamp(1.5rem,2.4vw,4rem) !important;
  }}
  .brandbar {{ padding:20px 28px; }}
  .brand-title {{ font-size:32px; }}
  .brand-sub {{ font-size:14px; }}
  .brand-word {{ font-size:25px; }}
  .kpi {{ min-height:122px; padding:18px 20px; }}
  .kpi-value {{ font-size:27px; }}
}}

@media (min-width: 2400px) {{
  [data-testid="stMainBlockContainer"],
  .block-container {{
    padding-left:clamp(2rem,2.8vw,5rem) !important;
    padding-right:clamp(2rem,2.8vw,5rem) !important;
  }}
  .brand-title {{ font-size:34px; }}
  .kpi-value {{ font-size:29px; }}
}}
</style>
""", unsafe_allow_html=True)


def drive_bytes(fid):
    # Evita receber uma versão antiga do arquivo pelo cache/CDN do Google Drive.
    # O cache principal continua sendo controlado por load() no Streamlit.
    r = requests.get(
        'https://drive.google.com/uc',
        params={'export':'download','id':fid,'_cb':str(time.time_ns())},
        headers={'Cache-Control':'no-cache','Pragma':'no-cache'},
        timeout=180,
    )
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


def plot_crossfilter(fig, key, state_key=None, point_field='y'):
    """Renderiza gráfico selecionável e grava um filtro em session_state."""
    try:
        ev = st.plotly_chart(fig, use_container_width=True, on_select='rerun', selection_mode='points', key=key)
        if state_key:
            sel = getattr(ev, 'selection', None)
            pts = getattr(sel, 'points', None) if sel is not None else None
            if pts and isinstance(pts[0], dict):
                val = pts[0].get(point_field)
                if val is not None:
                    val = str(val)
                    if st.session_state.get(state_key) != val:
                        st.session_state[state_key] = val
                        st.rerun()
        return ev
    except Exception:
        st.plotly_chart(fig, use_container_width=True, key=f'{key}_fallback')
        return None


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
    v['MARGEM_PCT'] = pd.to_numeric(v.get('% Margem'), errors='coerce')
    v['DESCONTO_VALOR'] = pd.to_numeric(v.get('Vl Desconto'), errors='coerce').fillna(0)
    v['DESCONTO_PCT_ORIG'] = pd.to_numeric(v.get('% Desconto'), errors='coerce')
    v['MARGEM_PESO'] = v['MARGEM_PCT'] * v['VALOR']
    v['BASE_BRUTA_DESC'] = v['VALOR'] + v['DESCONTO_VALOR']
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


if st.sidebar.button('↻ Atualizar bases agora', use_container_width=True):
    load.clear()
    st.rerun()

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

# Cross-filter por clique: Supervisor, RCA e Departamento.
xf_sup = st.session_state.get('xf_supervisor')
xf_rca = st.session_state.get('xf_rca')
xf_dep = st.session_state.get('xf_departamento')

if xf_sup and xf_sup not in set(ss_eff):
    st.session_state.pop('xf_supervisor', None); xf_sup = None
if xf_rca and xf_rca not in set(rs_eff):
    st.session_state.pop('xf_rca', None); xf_rca = None
if xf_dep and xf_dep not in set(ds_eff):
    st.session_state.pop('xf_departamento', None); xf_dep = None

if xf_sup:
    fat = fat[fat.SUPERVISOR.astype(str).eq(xf_sup)].copy()
    meta = meta[meta.SUPERVISOR.astype(str).eq(xf_sup)].copy()
if xf_rca:
    fat = fat[fat.RCA.astype(str).eq(xf_rca)].copy()
    meta = meta[meta.RCA.astype(str).eq(xf_rca)].copy()
if xf_dep:
    fat = fat[fat.DEPARTAMENTO.astype(str).eq(xf_dep)].copy()
    meta = meta[meta.DEPARTAMENTO.astype(str).eq(xf_dep)].copy()

ativos_xf = [x for x in [('Supervisor',xf_sup),('RCA',xf_rca),('Departamento',xf_dep)] if x[1]]
if ativos_xf:
    cc1, cc2 = st.columns([6,1])
    with cc1:
        chips = ''.join(f"<span class='filter-chip'>{k}: {v}</span>" for k,v in ativos_xf)
        st.markdown(chips, unsafe_allow_html=True)
    with cc2:
        if st.button('Limpar cliques', use_container_width=True):
            for k in ['xf_supervisor','xf_rca','xf_departamento']:
                st.session_state.pop(k, None)
            st.rerun()

F = fat.VALOR.sum(); M = meta.META.sum(); P = fat.NUMPED.nunique(); C = fat.CODCLI.nunique(); A = F/M*100 if M else pd.NA
base = ativos[ativos.SUPERVISOR.isin(ss_eff) & ativos.RCA.isin(rs_eff)][['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA')
if xf_sup: base = base[base.SUPERVISOR.astype(str).eq(xf_sup)]
if xf_rca: base = base[base.RCA.astype(str).eq(xf_rca)]
fr = fat.groupby('COD_RCA').agg(
    FATURAMENTO=('VALOR','sum'), PEDIDOS=('NUMPED','nunique'), POSITIVADOS=('CODCLI','nunique'),
    MARGEM_PESO=('MARGEM_PESO','sum'), DESCONTO_VALOR=('DESCONTO_VALOR','sum'), BASE_BRUTA_DESC=('BASE_BRUTA_DESC','sum')
).reset_index()
fr['MARGEM_CALC'] = fr['MARGEM_PESO'].div(fr['FATURAMENTO'].replace(0,pd.NA))
fr['DESCONTO_PCT_CALC'] = -fr['DESCONTO_VALOR'].div(fr['BASE_BRUTA_DESC'].replace(0,pd.NA))*100
mr = meta.groupby('COD_RCA',as_index=False).META.sum()

if fat.empty:
    mix = pd.DataFrame(columns=['COD_RCA','MIX_PRODUTOS_CLIENTE'])
    mix_geral = 0
else:
    pc = fat.groupby(['COD_RCA','CODCLI']).agg(PRODUTOS=('CODPROD','nunique')).reset_index()
    mix = pc.groupby('COD_RCA').agg(MIX_PRODUTOS_CLIENTE=('PRODUTOS','mean')).reset_index()
    mix_geral = pc.PRODUTOS.mean()

r = base.merge(fr,on='COD_RCA',how='left').merge(mr,on='COD_RCA',how='left').merge(mix,on='COD_RCA',how='left').fillna({'FATURAMENTO':0,'PEDIDOS':0,'POSITIVADOS':0,'META':0,'MIX_PRODUTOS_CLIENTE':0,'DESCONTO_VALOR':0})
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
if xf_rca:
    cod_xf = set(base.COD_RCA.dropna())
    car = car[car.COD_RCA.isin(cod_xf)].copy()
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

# -------------------------------------------------------------------------
# LEITURA EXECUTIVA E PONTOS DE ATENÇÃO AUTOMÁTICOS
# -------------------------------------------------------------------------
# Quando existe um único mês/ano selecionado, o painel compara o ritmo de
# faturamento com o avanço do mês. Dias úteis aqui significam segunda a
# sexta-feira; feriados não são descontados.
_ano_mes_exec = None
try:
    if 'ano_sel' in globals() and 'mes_sel' in globals():
        if ano_sel != 'Todos' and len(mes_sel) == 1:
            _ano_mes_exec = (int(ano_sel), int(meses_nome[mes_sel[0]]))
    elif 'mes' in globals():
        _p_exec = pd.Period(mes)
        _ano_mes_exec = (_p_exec.year, _p_exec.month)
except Exception:
    _ano_mes_exec = None

_exec = {
    'projecao': pd.NA, 'gap_proj': pd.NA, 'ritmo': pd.NA,
    'necessario_dia': pd.NA, 'crescimento_a1': pd.NA,
    'rcas_em_ritmo': 0, 'rcas_com_meta': 0, 'corte': None,
    'dias_passados': 0, 'dias_total': 0, 'dias_restantes': 0,
}
_atencoes = []
_oportunidades = []

if _ano_mes_exec:
    _ano_exec, _mes_exec = _ano_mes_exec
    _inicio_exec = pd.Timestamp(year=_ano_exec, month=_mes_exec, day=1)
    _fim_exec = _inicio_exec + pd.offsets.MonthEnd(0)
    _hoje_exec = pd.Timestamp.now(tz='America/Fortaleza').tz_localize(None).normalize()
    _ontem_exec = _hoje_exec - pd.Timedelta(days=1)
    _mes_corrente = (_ano_exec == _hoje_exec.year and _mes_exec == _hoje_exec.month)

    # O comparativo respeita exatamente o escopo atual de RCA/Departamento.
    _cod_exec = set(pd.to_numeric(base['COD_RCA'], errors='coerce').dropna().astype('Int64'))
    _dep_exec = [str(xf_dep)] if xf_dep else [str(x) for x in ds_eff]
    _cmp = vendas[
        vendas['FATURADO']
        & vendas['COD_RCA'].isin(_cod_exec)
        & vendas['DEPARTAMENTO'].astype(str).isin(_dep_exec)
    ].copy()

    _max_data = _cmp.loc[
        _cmp['DATA_FAT'].between(_inicio_exec, _fim_exec, inclusive='both'),
        'DATA_FAT'
    ].max()
    if _mes_corrente:
        _corte_exec = min(_ontem_exec, _fim_exec)
        if pd.notna(_max_data):
            _corte_exec = min(_corte_exec, pd.Timestamp(_max_data).normalize())
    else:
        _corte_exec = _fim_exec

    _exec['corte'] = _corte_exec
    _atual_exec = _cmp[
        _cmp['DATA_FAT'].between(_inicio_exec, _corte_exec, inclusive='both')
    ].copy() if pd.notna(_corte_exec) else _cmp.iloc[0:0].copy()
    _fat_corte = float(_atual_exec['VALOR'].sum())

    _inicio_a1 = _inicio_exec - pd.DateOffset(years=1)
    _corte_a1 = _corte_exec - pd.DateOffset(years=1) if pd.notna(_corte_exec) else _inicio_a1
    _fat_a1 = float(_cmp.loc[
        _cmp['DATA_FAT'].between(_inicio_a1, _corte_a1, inclusive='both'),
        'VALOR'
    ].sum())
    _exec['crescimento_a1'] = (_fat_corte / _fat_a1 - 1) * 100 if _fat_a1 else pd.NA

    if _mes_corrente and pd.notna(_corte_exec):
        _dias_total = len(pd.bdate_range(_inicio_exec, _fim_exec))
        _dias_passados = len(pd.bdate_range(_inicio_exec, _corte_exec))
        _dias_restantes = max(_dias_total - _dias_passados, 0)
        _fracao_tempo = (_dias_passados / _dias_total) if _dias_total else 0

        _exec.update({
            'dias_passados': _dias_passados,
            'dias_total': _dias_total,
            'dias_restantes': _dias_restantes,
        })

        if _dias_passados:
            _proj = (_fat_corte / _dias_passados) * _dias_total
            _exec['projecao'] = _proj
            _exec['gap_proj'] = float(M) - _proj if M else pd.NA
        if M and _fracao_tempo:
            _esperado_hoje = float(M) * _fracao_tempo
            _exec['ritmo'] = (_fat_corte / _esperado_hoje) * 100 if _esperado_hoje else pd.NA
        if M and _dias_restantes > 0:
            _exec['necessario_dia'] = max(float(M) - _fat_corte, 0) / _dias_restantes
        elif M and _fat_corte >= float(M):
            _exec['necessario_dia'] = 0.0

        # Projeção por RCA.
        _real_rca = _atual_exec.groupby('COD_RCA', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'REALIZADO_CORTE'})
        _meta_rca = meta.groupby('COD_RCA', as_index=False)['META'].sum()
        _rca_exec = base[['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA').merge(
            _real_rca, on='COD_RCA', how='left'
        ).merge(_meta_rca, on='COD_RCA', how='left').fillna({'REALIZADO_CORTE':0,'META':0})
        _rca_exec = _rca_exec[_rca_exec['META'].gt(0)].copy()
        if not _rca_exec.empty and _dias_passados:
            _rca_exec['PROJECAO'] = _rca_exec['REALIZADO_CORTE'] / _dias_passados * _dias_total
            _rca_exec['GAP_PROJ'] = _rca_exec['META'] - _rca_exec['PROJECAO']
            _rca_exec['RITMO'] = _rca_exec['REALIZADO_CORTE'].div((_rca_exec['META'] * _fracao_tempo).replace(0,pd.NA)) * 100
            _exec['rcas_com_meta'] = int(len(_rca_exec))
            _exec['rcas_em_ritmo'] = int((_rca_exec['RITMO'] >= 100).sum())

            _riscos = _rca_exec[_rca_exec['GAP_PROJ'].gt(0)].sort_values('GAP_PROJ', ascending=False)
            if not _riscos.empty:
                _rr = _riscos.iloc[0]
                _need_rca = max(float(_rr['META']) - float(_rr['REALIZADO_CORTE']), 0)
                _need_rca_dia = _need_rca / _dias_restantes if _dias_restantes else 0
                _atencoes.append((
                    'RCA com maior gap projetado',
                    f"{_rr['RCA']} projeta fechamento de {brl(_rr['PROJECAO'])}, "
                    f"com gap de {brl(_rr['GAP_PROJ'])}. "
                    + (f"Precisa de aproximadamente {brl(_need_rca_dia)} por dia útil restante." if _dias_restantes else "")
                ))

            _destaques = _rca_exec[_rca_exec['PROJECAO'].gt(_rca_exec['META'] * 1.03)].sort_values('PROJECAO', ascending=False)
            if not _destaques.empty:
                _rd = _destaques.iloc[0]
                _oportunidades.append((
                    'RCA acima da trajetória',
                    f"{_rd['RCA']} está em ritmo para fechar próximo de {brl(_rd['PROJECAO'])}, "
                    f"acima da meta de {brl(_rd['META'])}. Vale identificar os clientes e linhas que estão puxando esse resultado."
                ))

        # Projeção por departamento e participação no gap.
        _real_dep = _atual_exec.groupby('DEPARTAMENTO', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'REALIZADO_CORTE'})
        _meta_dep = meta.groupby('DEPARTAMENTO', as_index=False)['META'].sum()
        _dep_exec_df = _meta_dep.merge(_real_dep, on='DEPARTAMENTO', how='outer').fillna(0)
        if not _dep_exec_df.empty and _dias_passados:
            _dep_exec_df['PROJECAO'] = _dep_exec_df['REALIZADO_CORTE'] / _dias_passados * _dias_total
            _dep_exec_df['GAP_PROJ'] = _dep_exec_df['META'] - _dep_exec_df['PROJECAO']
            _gaps_pos = _dep_exec_df[_dep_exec_df['GAP_PROJ'].gt(0)].copy()
            _gap_total_dep = float(_gaps_pos['GAP_PROJ'].sum())
            if not _gaps_pos.empty:
                _dr = _gaps_pos.sort_values('GAP_PROJ', ascending=False).iloc[0]
                _part_gap = float(_dr['GAP_PROJ']) / _gap_total_dep * 100 if _gap_total_dep else 0
                _atencoes.append((
                    'Departamento que mais pressiona a meta',
                    f"{_dr['DEPARTAMENTO']} concentra {pct(_part_gap)} do gap positivo projetado entre departamentos "
                    f"({brl(_dr['GAP_PROJ'])})."
                ))

            _dep_acima = _dep_exec_df[_dep_exec_df['PROJECAO'].gt(_dep_exec_df['META'] * 1.03)].sort_values('PROJECAO', ascending=False)
            if not _dep_acima.empty:
                _do = _dep_acima.iloc[0]
                _oportunidades.append((
                    'Departamento com tração',
                    f"{_do['DEPARTAMENTO']} projeta {brl(_do['PROJECAO'])} para uma meta de {brl(_do['META'])}. "
                    "Use o detalhamento por RCA para identificar onde replicar o desempenho."
                ))

        if pd.notna(_exec['gap_proj']) and float(_exec['gap_proj']) > 0:
            _atencoes.insert(0, (
                'Risco de fechamento abaixo da meta',
                f"No ritmo dos dias úteis, a projeção é {brl(_exec['projecao'])}, "
                f"com gap aproximado de {brl(_exec['gap_proj'])}. "
                + (f"O recorte precisa gerar {brl(_exec['necessario_dia'])} por dia útil restante para atingir a meta." if pd.notna(_exec['necessario_dia']) else "")
            ))
        elif pd.notna(_exec['gap_proj']) and float(_exec['gap_proj']) <= 0:
            _oportunidades.insert(0, (
                'Ritmo suficiente para a meta',
                f"A projeção atual é {brl(_exec['projecao'])}, "
                f"{brl(abs(float(_exec['gap_proj'])))} acima da meta do recorte."
            ))

    # Comparativo com o mesmo período do ano anterior.
    if pd.notna(_exec['crescimento_a1']):
        if float(_exec['crescimento_a1']) < -3:
            _atencoes.append((
                'Queda frente ao mesmo período do ano anterior',
                f"O faturamento até {_corte_exec.strftime('%d/%m')} está {pct(abs(float(_exec['crescimento_a1'])))} abaixo do mesmo período de {_ano_exec-1}."
            ))
        elif float(_exec['crescimento_a1']) > 3:
            _oportunidades.append((
                'Crescimento sobre o ano anterior',
                f"O recorte está {pct(float(_exec['crescimento_a1']))} acima do mesmo período de {_ano_exec-1}. "
                "Vale identificar quais RCAs, departamentos e clientes sustentam esse avanço."
            ))

# Sinais adicionais de carteira e mix.
if inativos_total > novos_total and inativos_total > 0:
    _atencoes.append((
        'Pressão na carteira',
        f"Há {nint(inativos_total)} clientes inativados contra {nint(novos_total)} novos no recorte. "
        "Priorize os inativos de maior histórico antes de ampliar prospecção sem foco."
    ))
elif novos_total > inativos_total and novos_total > 0:
    _oportunidades.append((
        'Renovação positiva da carteira',
        f"O período registra {nint(novos_total)} novos clientes contra {nint(inativos_total)} inativados."
    ))

if not r.empty and r['MIX_PRODUTOS_CLIENTE'].notna().any():
    _mix_mediana = float(r.loc[r['MIX_PRODUTOS_CLIENTE'].gt(0), 'MIX_PRODUTOS_CLIENTE'].median()) if r['MIX_PRODUTOS_CLIENTE'].gt(0).any() else 0
    _mix_cands = r[(r['POSITIVADOS'] >= 3) & r['MIX_PRODUTOS_CLIENTE'].gt(0)].sort_values('MIX_PRODUTOS_CLIENTE')
    if _mix_mediana and not _mix_cands.empty:
        _mx = _mix_cands.iloc[0]
        if float(_mx['MIX_PRODUTOS_CLIENTE']) < _mix_mediana * 0.80:
            _oportunidades.append((
                'Oportunidade de aumento de mix',
                f"{_mx['RCA']} tem mix médio de {dec(_mx['MIX_PRODUTOS_CLIENTE'])} produtos por cliente, "
                f"abaixo da mediana do grupo ({dec(_mix_mediana)}). Há espaço para venda cruzada na carteira já positivada."
            ))

st.caption(f'Fonte de vendas: {BASE_VENDAS_VERSAO} • Competência definida pela Data de Faturamento.')
st.caption('Clique nos rankings e ações da Visão Geral para aprofundar a análise sem precisar refazer os filtros.')

aba1,aba2,aba3,aba4 = st.tabs(['Visão Geral','Carteira','Mix e Oportunidades','Cidades 🗺️'])

with aba1:
    st.subheader('Cockpit comercial')
    if _ano_mes_exec and pd.notna(_exec['corte']):
        st.caption(
            f"Leitura do período até {_exec['corte'].strftime('%d/%m/%Y')} • "
            "use os controles abaixo para investigar rapidamente onde agir."
        )
    else:
        st.caption('Selecione um único mês e ano para habilitar projeções e leitura de ritmo.')

    # 1) KPIs executivos essenciais.
    cx1,cx2,cx3,cx4,cx5 = st.columns(5)
    cx1.metric('Faturamento', brl(F), pct(A) + ' da meta' if pd.notna(A) else 'Sem meta')
    cx2.metric('Meta', brl(M), 'Recorte selecionado')
    cx3.metric(
        'Projeção de fechamento',
        brl(_exec['projecao']) if pd.notna(_exec['projecao']) else '—',
        ('Acima da meta' if pd.notna(_exec['gap_proj']) and float(_exec['gap_proj']) <= 0 else 'Abaixo da meta')
        if pd.notna(_exec['gap_proj']) else None
    )
    cx4.metric(
        'Gap projetado',
        brl(_exec['gap_proj']) if pd.notna(_exec['gap_proj']) else '—',
        f"{_exec['dias_restantes']} dias úteis restantes" if _exec['dias_restantes'] else None
    )
    cx5.metric(
        'Ritmo da meta',
        pct(_exec['ritmo']) if pd.notna(_exec['ritmo']) else '—',
        '100% = ritmo necessário'
    )

    # 2) Linha de progresso: realizado, esperado no dia, projeção e meta.
    if _ano_mes_exec and pd.notna(_exec['projecao']) and M:
        _fracao_exec = (_exec['dias_passados'] / _exec['dias_total']) if _exec['dias_total'] else 0
        _esperado_exec = float(M) * _fracao_exec
        _limite_exec = max(float(M), float(_exec['projecao']), float(F), 1.0) * 1.08
        fig_exec = go.Figure()
        fig_exec.add_trace(go.Bar(
            x=[float(F)], y=['Período'], orientation='h', name='Realizado',
            marker_color=NAVY, hovertemplate='Realizado: R$ %{x:,.2f}<extra></extra>'
        ))
        fig_exec.add_trace(go.Scatter(
            x=[_esperado_exec], y=['Período'], mode='markers', name='Esperado hoje',
            marker=dict(size=15, symbol='diamond', color='#C58A2E'),
            hovertemplate='Esperado hoje: R$ %{x:,.2f}<extra></extra>'
        ))
        fig_exec.add_trace(go.Scatter(
            x=[float(_exec['projecao'])], y=['Período'], mode='markers', name='Projeção',
            marker=dict(size=16, symbol='circle', color=GREEN if float(_exec['projecao']) >= float(M) else RED),
            hovertemplate='Projeção: R$ %{x:,.2f}<extra></extra>'
        ))
        fig_exec.add_vline(x=float(M), line_width=3, line_dash='dash', line_color=NAVY_2,
                           annotation_text='Meta', annotation_position='top')
        fig_exec.update_layout(
            title='Trajetória do mês',
            barmode='overlay',
            height=240,
            xaxis=dict(range=[0,_limite_exec], tickprefix='R$ ', tickformat='.2s', showgrid=True, gridcolor='#ECEEF4'),
            yaxis=dict(showticklabels=False),
            margin=dict(l=8,r=8,t=58,b=10),
            legend=dict(orientation='h', yanchor='bottom', y=1.02, x=0),
            paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)'
        )
        st.plotly_chart(fig_exec, use_container_width=True, key='cockpit_trajetoria')

    # 3) Central de prioridades clicável.
    st.markdown('### Prioridades agora')
    st.caption('As ações abaixo são priorizadas pelo impacto projetado. Clique para aplicar o recorte correspondente.')

    _prioridades = []
    if '_rca_exec' in globals() and isinstance(_rca_exec, pd.DataFrame) and not _rca_exec.empty:
        _risco_rca = _rca_exec[_rca_exec['GAP_PROJ'].gt(0)].sort_values('GAP_PROJ', ascending=False)
        if not _risco_rca.empty:
            _p = _risco_rca.iloc[0]
            _prioridades.append({
                'nivel':'Crítico',
                'titulo':f"RCA: {_p['RCA']}",
                'texto':f"Gap projetado de {brl(_p['GAP_PROJ'])} • projeção {brl(_p['PROJECAO'])}",
                'tipo':'RCA','alvo':str(_p['RCA'])
            })
    if '_dep_exec_df' in globals() and isinstance(_dep_exec_df, pd.DataFrame) and not _dep_exec_df.empty:
        _risco_dep = _dep_exec_df[_dep_exec_df['GAP_PROJ'].gt(0)].sort_values('GAP_PROJ', ascending=False)
        if not _risco_dep.empty:
            _p = _risco_dep.iloc[0]
            _prioridades.append({
                'nivel':'Atenção',
                'titulo':f"Departamento: {_p['DEPARTAMENTO']}",
                'texto':f"Gap projetado de {brl(_p['GAP_PROJ'])} • projeção {brl(_p['PROJECAO'])}",
                'tipo':'Departamento','alvo':str(_p['DEPARTAMENTO'])
            })
    if pd.notna(_exec['crescimento_a1']):
        _cres = float(_exec['crescimento_a1'])
        _prioridades.append({
            'nivel':'Oportunidade' if _cres >= 0 else 'Atenção',
            'titulo':'Comparativo com o ano anterior',
            'texto':f"{pct(_cres)} no mesmo período • use os rankings para localizar quem explica a variação",
            'tipo':'Nenhum','alvo':None
        })
    if not _prioridades and _atencoes:
        _prioridades.append({'nivel':'Atenção','titulo':_atencoes[0][0],'texto':_atencoes[0][1],'tipo':'Nenhum','alvo':None})

    if _prioridades:
        _cols_prio = st.columns(min(3, len(_prioridades)))
        for _i, _prio in enumerate(_prioridades[:3]):
            with _cols_prio[_i]:
                with st.container(border=True):
                    st.caption(_prio['nivel'].upper())
                    st.markdown(f"**{_prio['titulo']}**")
                    st.write(_prio['texto'])
                    if _prio['tipo'] != 'Nenhum':
                        if st.button(
                            f"Analisar {_prio['tipo']}",
                            key=f"cockpit_prio_{_i}",
                            use_container_width=True
                        ):
                            if _prio['tipo'] == 'RCA':
                                st.session_state['xf_rca'] = _prio['alvo']
                            elif _prio['tipo'] == 'Departamento':
                                st.session_state['xf_departamento'] = _prio['alvo']
                            st.rerun()
    else:
        st.success('Nenhuma prioridade automática forte foi identificada no recorte atual.')

    # 4) Ranking RCA interativo.
    st.markdown('### Ranking interativo de RCA')
    _ranking_opcao = st.radio(
        'Indicador',
        ['Gap', 'Ritmo', 'Atingimento', 'Faturamento', 'Clientes', 'Mix'],
        horizontal=True,
        label_visibility='collapsed',
        key='cockpit_ranking_indicador'
    )

    _rank = r[['COD_RCA','RCA','SUPERVISOR','FATURAMENTO','META','ATINGIMENTO','POSITIVADOS','MIX_PRODUTOS_CLIENTE']].copy()
    if _ano_mes_exec and _exec['dias_passados'] and _exec['dias_total']:
        _fator_proj = _exec['dias_total'] / _exec['dias_passados']
        _rank['PROJECAO'] = _rank['FATURAMENTO'] * _fator_proj
        _rank['GAP'] = _rank['META'] - _rank['PROJECAO']
        _frac_rank = _exec['dias_passados'] / _exec['dias_total']
        _rank['RITMO'] = _rank['FATURAMENTO'].div((_rank['META'] * _frac_rank).replace(0,pd.NA)) * 100
    else:
        _rank['PROJECAO'] = _rank['FATURAMENTO']
        _rank['GAP'] = _rank['META'] - _rank['FATURAMENTO']
        _rank['RITMO'] = _rank['ATINGIMENTO']

    _map_rank = {
        'Gap':('GAP','Gap para meta',False,'R$ '),
        'Ritmo':('RITMO','Ritmo da meta',False,''),
        'Atingimento':('ATINGIMENTO','Atingimento',False,''),
        'Faturamento':('FATURAMENTO','Faturamento',False,'R$ '),
        'Clientes':('POSITIVADOS','Clientes positivados',False,''),
        'Mix':('MIX_PRODUTOS_CLIENTE','Mix médio',False,''),
    }
    _col_rank,_titulo_rank,_asc_rank,_prefix_rank = _map_rank[_ranking_opcao]
    _rank_show = _rank[_rank[_col_rank].notna()].sort_values(_col_rank, ascending=_asc_rank).head(15).copy()

    if not _rank_show.empty:
        fig_rank = px.bar(
            _rank_show.sort_values(_col_rank, ascending=not _asc_rank),
            x=_col_rank, y='RCA', orientation='h',
            title=f'{_titulo_rank} por RCA',
            text=_rank_show.sort_values(_col_rank, ascending=not _asc_rank)[_col_rank].map(
                lambda v: brl_compacto(v) if _ranking_opcao in ('Gap','Faturamento')
                else (pct(v) if _ranking_opcao in ('Ritmo','Atingimento') else dec(v))
            )
        )
        fig_rank.update_traces(marker_color=NAVY, textposition='outside')
        if _ranking_opcao in ('Ritmo','Atingimento'):
            fig_rank.add_vline(x=100, line_dash='dash', line_color=GREEN)
        if _ranking_opcao in ('Gap','Faturamento'):
            fig_rank.update_xaxes(tickprefix='R$ ', tickformat='.2s')
        plot_crossfilter(
            chart_layout(fig_rank, max(430, 30*len(_rank_show)+120), 'v'),
            f'cockpit_rank_{_ranking_opcao}',
            'xf_rca',
            'y'
        )
        st.caption('Clique em uma barra para filtrar o dashboard inteiro pelo RCA selecionado.')
    else:
        st.info('Sem dados suficientes para montar o ranking neste recorte.')

    # 5) Onde está o gap? Alterna dimensão sem poluir a tela.
    st.markdown('### Onde está o gap?')
    _dim_gap = st.radio(
        'Dimensão',
        ['Supervisor','Departamento','RCA'],
        horizontal=True,
        label_visibility='collapsed',
        key='cockpit_dim_gap'
    )

    _fator_gap = (_exec['dias_total'] / _exec['dias_passados']) if _exec['dias_passados'] else 1.0
    if _dim_gap == 'Supervisor':
        _real_g = fat.groupby('SUPERVISOR', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'REALIZADO'})
        _meta_g = meta.groupby('SUPERVISOR', as_index=False)['META'].sum()
        _g = _meta_g.merge(_real_g, on='SUPERVISOR', how='outer').fillna(0)
        _g['PROJECAO'] = _g['REALIZADO'] * _fator_gap
        _g['GAP'] = (_g['META'] - _g['PROJECAO']).clip(lower=0)
        _g = _g.sort_values('GAP', ascending=False)
        _campo_gap='SUPERVISOR'; _state_gap='xf_supervisor'
    elif _dim_gap == 'Departamento':
        _real_g = fat.groupby('DEPARTAMENTO', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'REALIZADO'})
        _meta_g = meta.groupby('DEPARTAMENTO', as_index=False)['META'].sum()
        _g = _meta_g.merge(_real_g, on='DEPARTAMENTO', how='outer').fillna(0)
        _g['PROJECAO'] = _g['REALIZADO'] * _fator_gap
        _g['GAP'] = (_g['META'] - _g['PROJECAO']).clip(lower=0)
        _g = _g.sort_values('GAP', ascending=False)
        _campo_gap='DEPARTAMENTO'; _state_gap='xf_departamento'
    else:
        _g = _rank[['RCA','META','PROJECAO','GAP']].copy()
        _g['GAP'] = _g['GAP'].clip(lower=0)
        _g = _g.sort_values('GAP', ascending=False)
        _campo_gap='RCA'; _state_gap='xf_rca'

    _g = _g[_g['GAP'].gt(0)].head(15)
    if not _g.empty:
        fig_gap = px.bar(
            _g.sort_values('GAP'),
            x='GAP', y=_campo_gap, orientation='h',
            title=f'Gap projetado por {_dim_gap.lower()}',
            text=_g.sort_values('GAP')['GAP'].map(brl_compacto)
        )
        fig_gap.update_traces(marker_color=RED, textposition='outside')
        fig_gap.update_xaxes(tickprefix='R$ ', tickformat='.2s')
        plot_crossfilter(
            chart_layout(fig_gap, max(400, 32*len(_g)+110), 'v'),
            f'cockpit_gap_{_dim_gap}',
            _state_gap,
            'y'
        )
        st.caption(f'Clique em uma barra para aplicar o filtro de {_dim_gap.lower()} em todo o dashboard.')
    else:
        st.success('Nenhum gap positivo relevante nesta dimensão para o recorte atual.')

    # 6) Detalhes ficam recolhidos; o cockpit permanece limpo.
    with st.expander('Ver análises detalhadas', expanded=False):
        st.markdown('#### Resultado por supervisão')
        s = r.groupby('SUPERVISOR',as_index=False).agg(FATURAMENTO=('FATURAMENTO','sum'),META=('META','sum'))
        s['ATINGIMENTO'] = s.FATURAMENTO.div(s.META.replace(0,pd.NA))*100
        fig = go.Figure()
        fig.add_bar(x=s.SUPERVISOR,y=s.META,name='Meta',marker_color='#C8CEE1')
        fig.add_bar(x=s.SUPERVISOR,y=s.FATURAMENTO,name='Faturamento',marker_color=NAVY)
        fig.update_layout(barmode='group',title='Faturamento x Meta por supervisão',yaxis_tickprefix='R$ ',yaxis_tickformat='.2s')
        plot_crossfilter(chart_layout(fig,390), 'xf_graf_supervisao', 'xf_supervisor', 'x')

        c1,c2 = st.columns(2)
        with c1:
            rr = r.sort_values('ATINGIMENTO')
            fig = px.bar(rr,x='ATINGIMENTO',y='RCA',orientation='h',title='Atingimento de meta por RCA',text=rr.ATINGIMENTO.map(pct))
            fig.update_traces(marker_color=NAVY,textposition='outside')
            fig.add_vline(x=100,line_dash='dash',line_color=GREEN)
            plot_crossfilter(chart_layout(fig,max(430,28*len(rr)+100),'v'), 'xf_graf_rca_ating', 'xf_rca', 'y')
        with c2:
            dep_real = fat.groupby('DEPARTAMENTO',as_index=False).VALOR.sum().rename(columns={'VALOR':'REALIZADO'})
            dep_meta = meta.groupby('DEPARTAMENTO',as_index=False).META.sum()
            dep = dep_real.merge(dep_meta,on='DEPARTAMENTO',how='outer').fillna(0)
            dep['ATINGIMENTO'] = dep.REALIZADO.div(dep.META.replace(0,pd.NA))*100
            dep = dep.sort_values('REALIZADO')
            fig = go.Figure()
            fig.add_bar(y=dep.DEPARTAMENTO,x=dep.META,name='Meta',orientation='h',marker_color='#C8CEE1',customdata=dep[['ATINGIMENTO']])
            fig.add_bar(y=dep.DEPARTAMENTO,x=dep.REALIZADO,name='Realizado',orientation='h',marker_color=NAVY_2,customdata=dep[['ATINGIMENTO']])
            fig.update_layout(barmode='group',title='Meta x realizado por departamento',xaxis_tickprefix='R$ ',xaxis_tickformat='.2s')
            fig.update_traces(hovertemplate='<b>%{y}</b><br>Valor: R$ %{x:,.2f}<br>Atingimento: %{customdata[0]:.1f}%<extra>%{fullData.name}</extra>')
            plot_crossfilter(chart_layout(fig,max(430,38*len(dep)+100),'v'), 'xf_graf_departamento', 'xf_departamento', 'y')

        st.markdown('#### Painel por RCA')
        tabela = pd.DataFrame({
            'RCA':r.RCA,'Supervisor':r.SUPERVISOR,'Faturamento':r.FATURAMENTO.map(brl),'Meta':r.META.map(brl),
            'Atingimento':r.ATINGIMENTO.map(pct),'Clientes':r.POSITIVADOS.map(nint),'Ticket médio':r.TICKET.map(brl),
            'Mix prod./cliente':r.MIX_PRODUTOS_CLIENTE.map(dec),'Margem':r.MARGEM_CALC.map(pct),
            'Desconto (R$)':r.DESCONTO_VALOR.map(brl),'% Desconto':r.DESCONTO_PCT_CALC.map(pct)
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
        plot_crossfilter(chart_layout(fig,max(430,28*len(cr)+100),'v'), 'xf_graf_rca_pos', 'xf_rca', 'y')
    with c2:
        ci = r[['RCA','NOVOS','INATIVADOS']].sort_values('INATIVADOS')
        fig = go.Figure()
        fig.add_bar(y=ci.RCA,x=ci.NOVOS,name='Novos',orientation='h',marker_color=GREEN)
        fig.add_bar(y=ci.RCA,x=ci.INATIVADOS,name='Inativados',orientation='h',marker_color=RED)
        fig.update_layout(barmode='group',title='Novos x Inativados por RCA')
        plot_crossfilter(chart_layout(fig,max(430,28*len(ci)+100)), 'xf_graf_rca_carteira', 'xf_rca', 'y')

with aba3:
    st.subheader('Mix por cliente')
    st.markdown("<div class='section-note'>Mix = média de produtos distintos comprados por cada cliente do RCA no mês. Cada cliente pesa uma vez.</div>",unsafe_allow_html=True)
    mixr = r.sort_values('MIX_PRODUTOS_CLIENTE')
    fig = px.bar(mixr,x='MIX_PRODUTOS_CLIENTE',y='RCA',orientation='h',title='Mix médio de produtos por cliente — RCA',text=mixr.MIX_PRODUTOS_CLIENTE.map(dec))
    fig.update_traces(marker_color=NAVY,textposition='outside')
    plot_crossfilter(chart_layout(fig,max(430,30*len(mixr)+100),'v'), 'xf_graf_rca_mix', 'xf_rca', 'y')
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
    st.info('Mapa municipal carregado pela camada de compatibilidade do app_v1.py.')

st.divider()
st.caption(f'Base carregada: {len(vendas):,} linhas • Fonte: {BASE_VENDAS_VERSAO} • Filtro mensal pela Data de Faturamento.'.replace(',','.'))
