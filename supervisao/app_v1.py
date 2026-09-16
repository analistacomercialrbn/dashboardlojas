from pathlib import Path

_core = Path(__file__).with_name('app_v1_core.py')
core_source = _core.read_text(encoding='utf-8')

access_patch = r'''
# Controle de acesso modularizado.
auth_block = r"""
from access_control import auth_bootstrap, render_admin_users, scope_ativos
USUARIO_ATUAL = auth_bootstrap()
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
