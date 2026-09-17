from io import BytesIO
import copy

import pandas as pd
import requests
import streamlit as st

from access_control import auth_bootstrap, render_admin_users, scope_ativos
from gestao_page_compat import aplicar_formatacao_comparativos
import gestao_metas as gm

st.set_page_config(page_title='Gestão de Metas', page_icon='🎯', layout='wide')

VENDAS_ID = '1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'
AUX_ID = '1h3XtB-2aMSMGhr5Ws7P-6nijKZc3zeqI'
NAVY = '#1E2655'
BG = '#F6F7FB'
MUTED = '#737A8C'

gm.BRANCH = 'dashboard-data'

if not hasattr(gm, '_load_store_original_fast'):
    gm._load_store_original_fast = gm._load_store
if not hasattr(gm, '_save_store_original_fast'):
    gm._save_store_original_fast = gm._save_store


def _load_store_session():
    if '_gm_store_cache' not in st.session_state:
        st.session_state['_gm_store_cache'] = gm._load_store_original_fast()
    return copy.deepcopy(st.session_state['_gm_store_cache'])


def _save_store_session(store):
    ok, msg = gm._save_store_original_fast(store)
    if ok:
        st.session_state['_gm_store_cache'] = copy.deepcopy(store)
    return ok, msg


gm._load_store = _load_store_session
gm._save_store = _save_store_session

st.markdown(f"""
<style>
[data-testid="stAppViewContainer"] {{ background:{BG}; }}
[data-testid="stHeader"] {{ background:rgba(0,0,0,0); }}
[data-testid="stSidebar"] {{ background:#fff; border-right:1px solid #E6E8EF; }}
.block-container {{ padding-top:1.4rem; padding-bottom:2rem; max-width:1500px; }}
.brandbar {{ display:flex; align-items:center; justify-content:space-between; gap:18px; background:{NAVY}; padding:18px 24px; border-radius:18px; margin-bottom:18px; box-shadow:0 8px 24px rgba(30,38,85,.14); }}
.brand-title {{ color:white; font-size:30px; font-weight:750; margin:0; }}
.brand-sub {{ color:#DDE2F4; font-size:13px; margin-top:5px; }}
.brand-word {{ color:white; font-size:24px; font-weight:900; letter-spacing:.08em; }}
.kpi {{ background:#fff; border:1px solid #E6E8EF; border-radius:16px; padding:16px 18px; min-height:116px; box-shadow:0 4px 14px rgba(30,38,85,.06); }}
.kpi-label {{ color:{MUTED}; font-size:12px; font-weight:650; text-transform:uppercase; letter-spacing:.06em; }}
.kpi-value {{ color:{NAVY}; font-size:25px; font-weight:760; margin-top:7px; white-space:nowrap; }}
.kpi-note {{ color:{MUTED}; font-size:11px; margin-top:4px; }}
@media (max-width: 1100px) {{
  .block-container {{ padding-left:.8rem !important; padding-right:.8rem !important; padding-top:1rem !important; max-width:100% !important; }}
  .brandbar {{ padding:14px 16px !important; border-radius:14px !important; }}
  .brand-title {{ font-size:22px !important; }}
  .brand-sub {{ font-size:11px !important; }}
  .brand-word {{ display:none !important; }}
  [data-testid="stHorizontalBlock"] {{ flex-wrap:wrap !important; gap:.7rem !important; }}
  [data-testid="column"] {{ flex:1 1 280px !important; width:auto !important; min-width:260px !important; }}
  .kpi {{ min-height:96px !important; padding:12px 14px !important; }}
  .kpi-value {{ font-size:22px !important; white-space:normal !important; }}
  [data-baseweb="tab-list"] {{ overflow-x:auto !important; overflow-y:hidden !important; flex-wrap:nowrap !important; gap:8px !important; }}
  [data-baseweb="tab"] {{ flex:0 0 auto !important; white-space:nowrap !important; }}
  div[data-testid="stDataFrame"] {{ overflow-x:auto !important; }}
}}
@media (max-width: 650px) {{
  [data-testid="column"] {{ flex:1 1 100% !important; width:100% !important; min-width:100% !important; }}
  .brand-title {{ font-size:20px !important; }}
  .brand-sub {{ display:none !important; }}
}}
</style>
""", unsafe_allow_html=True)


@st.cache_data(show_spinner=False)
def drive_bytes(fid):
    r = requests.get(f'https://drive.google.com/uc?export=download&id={fid}', timeout=180)
    r.raise_for_status()
    if 'text/html' in r.headers.get('content-type','').lower():
        raise RuntimeError('Confirme o compartilhamento dos arquivos do Drive como leitor por link.')
    return r.content


def _read_excel(buf, **kwargs):
    try:
        return pd.read_excel(buf, engine='calamine', **kwargs)
    except Exception:
        if hasattr(buf, 'seek'):
            buf.seek(0)
        return pd.read_excel(buf, **kwargs)


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
    if pd.isna(v):
        return '—'
    return f'R$ {float(v):,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def brl_compacto(v):
    v = float(v or 0)
    if abs(v) >= 1_000_000:
        return f'R$ {v/1_000_000:.2f} mi'.replace('.', ',')
    if abs(v) >= 1_000:
        return f'R$ {v/1_000:.1f} mil'.replace('.', ',')
    return brl(v)


def pct(v):
    return '—' if pd.isna(v) else f'{float(v):.1f}%'.replace('.', ',')


def kpi(label, value, note=''):
    return f"<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value'>{value}</div><div class='kpi-note'>{note}</div></div>"


def ler_vendas(buf):
    previa = _read_excel(buf, sheet_name='Sheet1', header=None, nrows=8)
    header = 0
    for i, row in previa.iterrows():
        vals = set(row.astype(str).str.strip())
        if 'Data Faturamento' in vals and 'Pedidos Enviados' in vals:
            header = i
            break
    buf.seek(0)
    cols = {'Cod/Vend.','Data Faturamento','Pedidos Enviados','Posição','DEPARTAMENTO'}
    return _read_excel(buf, sheet_name='Sheet1', header=header, usecols=lambda c: str(c).strip() in cols)


@st.cache_data(show_spinner='Carregando histórico e metas...')
def load_data():
    vendas_bytes = drive_bytes(VENDAS_ID)
    aux_bytes = drive_bytes(AUX_ID)

    v = ler_vendas(BytesIO(vendas_bytes))
    rca = _read_excel(BytesIO(aux_bytes), sheet_name='RCA', usecols=lambda c: str(c).strip() in {'COD_RCA','RCA','SUPERVISOR','ATIVO'})
    met = _read_excel(BytesIO(aux_bytes), sheet_name='METAS', usecols=lambda c: str(c).strip() in {'COD_RCA','MES','META'})

    v['COD_RCA'] = cod(v['Cod/Vend.'])
    v['DATA_FAT'] = dt(v['Data Faturamento'])
    v['VALOR'] = pd.to_numeric(v['Pedidos Enviados'], errors='coerce').fillna(0)
    v['FATURADO'] = v['DATA_FAT'].notna() & v['Posição'].astype(str).str.strip().str.upper().eq('FECHADO')

    rca['COD_RCA'] = pd.to_numeric(rca['COD_RCA'], errors='coerce').astype('Int64')
    rca['ATIVO'] = rca['ATIVO'].astype(str).str.upper().str.strip()
    met['COD_RCA'] = pd.to_numeric(met['COD_RCA'], errors='coerce').astype('Int64')
    met['MES'] = met['MES'].astype(str).str[:7]
    met['META'] = pd.to_numeric(met['META'], errors='coerce').fillna(0)

    h = rca[['COD_RCA','RCA','SUPERVISOR','ATIVO']].drop_duplicates('COD_RCA')
    v = v.merge(h, on='COD_RCA', how='left')
    return v, rca, met


USUARIO_ATUAL = auth_bootstrap()

if st.sidebar.button('↻ Atualizar bases agora', use_container_width=True):
    load_data.clear()
    drive_bytes.clear()
    st.session_state.pop('_gm_store_cache', None)
    st.rerun()

try:
    vendas, rcas, metas = load_data()
except Exception as exc:
    st.error(str(exc))
    st.stop()

ativos = scope_ativos(rcas[rcas['ATIVO'].eq('S')].copy(), USUARIO_ATUAL)

if USUARIO_ATUAL.get('perfil') == 'ADMIN' and st.session_state.get('admin_users_page'):
    render_admin_users(rcas)
    st.stop()

st.markdown("""
<div class='brandbar'>
  <div>
    <div class='brand-title'>Gestão de Metas</div>
    <div class='brand-sub'>Planejamento • análise histórica • distribuição • justificativas • aprovação</div>
  </div>
  <div class='brand-word'>REBANHO</div>
</div>
""", unsafe_allow_html=True)

if USUARIO_ATUAL.get('perfil') == 'RCA':
    st.info('A Gestão de Metas está disponível para Supervisor, Gerente e Admin. O perfil RCA permanece no acompanhamento operacional.')
    st.stop()

aplicar_formatacao_comparativos()

gm.render_gestao_metas(
    vendas=vendas,
    metas=metas,
    ativos=ativos,
    usuario=USUARIO_ATUAL,
    brl=brl,
    brl_compacto=brl_compacto,
    pct=pct,
    kpi=kpi,
)
