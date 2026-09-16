from pathlib import Path

_core = Path(__file__).with_name('app_v1_core.py')
core_source = _core.read_text(encoding='utf-8')

access_patch = r'''
# Controle de acesso modularizado.
auth_block = r"""
from access_control import auth_bootstrap, render_admin_users, scope_ativos
USUARIO_ATUAL = auth_bootstrap()

# Ajustes responsivos para celular e tablet.
st.markdown(r'''<style>
/* Layout geral mais compacto em telas menores */
@media (max-width: 1100px) {
  .block-container {
    padding-left: .8rem !important;
    padding-right: .8rem !important;
    padding-top: 1rem !important;
    max-width: 100% !important;
  }

  .brandbar {
    padding: 14px 16px !important;
    border-radius: 14px !important;
    gap: 10px !important;
  }
  .brand-title { font-size: 22px !important; }
  .brand-sub { font-size: 11px !important; }
  .brand-word { display: none !important; }

  /* As colunas passam a quebrar linha em vez de ficarem espremidas. */
  [data-testid="stHorizontalBlock"] {
    flex-wrap: wrap !important;
    gap: .7rem !important;
  }
  [data-testid="column"] {
    flex: 1 1 280px !important;
    width: auto !important;
    min-width: 260px !important;
  }

  .kpi {
    min-height: 96px !important;
    padding: 12px 14px !important;
  }
  .kpi-label {
    font-size: 11px !important;
    line-height: 1.25 !important;
    overflow-wrap: normal !important;
    word-break: normal !important;
  }
  .kpi-value {
    font-size: 22px !important;
    line-height: 1.15 !important;
    white-space: normal !important;
  }
  .kpi-note { font-size: 10px !important; }

  /* Abas ficam roláveis na horizontal. */
  [data-baseweb="tab-list"] {
    overflow-x: auto !important;
    overflow-y: hidden !important;
    flex-wrap: nowrap !important;
    gap: 8px !important;
    scrollbar-width: thin;
  }
  [data-baseweb="tab"] {
    flex: 0 0 auto !important;
    white-space: nowrap !important;
    padding-left: 10px !important;
    padding-right: 10px !important;
  }

  div[data-testid="stDataFrame"] {
    overflow-x: auto !important;
  }

  /* Evita uma sidebar excessivamente larga no celular. */
  [data-testid="stSidebar"] {
    width: min(300px, 86vw) !important;
    min-width: min(300px, 86vw) !important;
  }
}

@media (max-width: 650px) {
  [data-testid="column"] {
    flex: 1 1 100% !important;
    width: 100% !important;
    min-width: 100% !important;
  }
  .brand-title { font-size: 20px !important; }
  .brand-sub { display: none !important; }
  .kpi { min-height: 86px !important; }
  .kpi-value { font-size: 21px !important; }
}
</style>''', unsafe_allow_html=True)
"""

source = source.replace(
    "st.set_page_config(page_title='Dashboard de Supervisão', page_icon='📊', layout='wide')",
    "st.set_page_config(page_title='Dashboard de Supervisão', page_icon='📊', layout='wide')\n" + auth_block,
    1,
)

role_scope = r"""
ativos = rcas[rcas['ATIVO'].eq('S')].copy()
ativos = scope_ativos(ativos, USUARIO_ATUAL)

if USUARIO_ATUAL.get('perfil') == 'ADMIN' and st.session_state.get('admin_users_page'):
    render_admin_users(rcas)
    st.stop()
"""
source = source.replace("ativos = rcas[rcas['ATIVO'].eq('S')].copy()", role_scope, 1)

# Nova aba Gestão de Metas sem substituir as abas existentes.
old_tabs = "aba1,aba2,aba3,aba4 = st.tabs(['Visão Geral','Carteira','Mix e Oportunidades','Cidades 🗺️'])"
new_tabs = "aba1,aba2,aba3,aba4,aba5 = st.tabs(['Visão Geral','Carteira','Mix e Oportunidades','Cidades 🗺️','Gestão de Metas'])"
source = source.replace(old_tabs, new_tabs, 1)

gestao_block = r"""
with aba5:
    if USUARIO_ATUAL.get('perfil') == 'RCA':
        st.info('A Gestão de Metas está disponível para Supervisor, Gerente e Admin. O perfil RCA permanece somente no acompanhamento operacional.')
    else:
        from gestao_metas import render_gestao_metas
        render_gestao_metas(
            vendas=vendas,
            metas=metas,
            ativos=ativos,
            usuario=USUARIO_ATUAL,
            brl=brl,
            brl_compacto=brl_compacto,
            pct=pct,
            kpi=kpi,
        )
"""
source = source.replace("\nwith aba4:\n", "\n" + gestao_block + "\nwith aba4:\n", 1)
'''

needle = "exec(compile(source, str(_app), 'exec'), globals(), globals())"
if needle not in core_source:
    raise RuntimeError('Bootstrap principal incompatível: ponto de execução não encontrado.')

core_source = core_source.replace(needle, access_patch + "\n" + needle, 1)
exec(compile(core_source, str(_core), 'exec'), globals(), globals())
