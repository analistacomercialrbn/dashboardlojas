from pathlib import Path

_core = Path(__file__).with_name('app_v1_core.py')
core_source = _core.read_text(encoding='utf-8')

access_patch = r'''
# Controle de acesso aplicado sobre o app_v2 já transformado pelo bootstrap principal.
auth_block = r"""
import hashlib
import hmac

ACCESS_USERS = {
    'admin': {
        'nome': 'Coordenação Comercial',
        'perfil': 'ADMIN',
        'senha_hash': '2b5c13156ad585cfd7dc3de698ddef30d37ac8438f62998ef2dd1ab75cd50fdd',
        'supervisor': None,
        'cod_rca': None,
        'ativo': True,
    },
}

def _validar_acesso(login, senha):
    chave = str(login or '').strip().lower()
    usuario = ACCESS_USERS.get(chave)
    if not usuario or not usuario.get('ativo'):
        return None
    recebido = hashlib.sha256(str(senha or '').encode('utf-8')).hexdigest()
    if not hmac.compare_digest(recebido, usuario.get('senha_hash', '')):
        return None
    return chave

if not st.session_state.get('auth_user'):
    st.markdown("<div style='height:5vh'></div>", unsafe_allow_html=True)
    c1, c2, c3 = st.columns([1, 1.15, 1])
    with c2:
        st.markdown("<div style='text-align:center;font-size:30px;font-weight:800;color:#1E2655;margin-bottom:4px;'>Dashboard de Supervisão</div>", unsafe_allow_html=True)
        st.markdown("<div style='text-align:center;color:#737A8C;margin-bottom:22px;'>Acesso restrito • REBANHO</div>", unsafe_allow_html=True)
        with st.form('login_form'):
            login = st.text_input('Usuário')
            senha = st.text_input('Senha', type='password')
            entrar = st.form_submit_button('Entrar', use_container_width=True)
        if entrar:
            chave = _validar_acesso(login, senha)
            if chave:
                st.session_state['auth_user'] = chave
                st.rerun()
            else:
                st.error('Usuário ou senha inválidos.')
    st.stop()

USUARIO_ATUAL = ACCESS_USERS.get(st.session_state.get('auth_user'))
if not USUARIO_ATUAL or not USUARIO_ATUAL.get('ativo'):
    st.session_state.pop('auth_user', None)
    st.rerun()

st.sidebar.markdown(f"**{USUARIO_ATUAL['nome']}**")
st.sidebar.caption(f"Perfil: {USUARIO_ATUAL['perfil'].title()}")
if st.sidebar.button('Sair', use_container_width=True):
    for _k in list(st.session_state.keys()):
        if _k == 'auth_user' or _k.startswith('xf_'):
            st.session_state.pop(_k, None)
    st.rerun()
st.sidebar.divider()
"""

source = source.replace(
    "st.set_page_config(page_title='Dashboard de Supervisão', page_icon='📊', layout='wide')",
    "st.set_page_config(page_title='Dashboard de Supervisão', page_icon='📊', layout='wide')\n" + auth_block,
    1,
)

role_scope = r"""
ativos = rcas[rcas['ATIVO'].eq('S')].copy()
if USUARIO_ATUAL['perfil'] == 'SUPERVISOR':
    _sup = str(USUARIO_ATUAL.get('supervisor') or '').strip().upper()
    ativos = ativos[ativos['SUPERVISOR'].astype(str).str.strip().str.upper().eq(_sup)].copy()
elif USUARIO_ATUAL['perfil'] == 'RCA':
    _cod = pd.to_numeric(pd.Series([USUARIO_ATUAL.get('cod_rca')]), errors='coerce').iloc[0]
    ativos = ativos[ativos['COD_RCA'].eq(_cod)].copy()
"""
source = source.replace("ativos = rcas[rcas['ATIVO'].eq('S')].copy()", role_scope, 1)
'''

needle = "exec(compile(source, str(_app), 'exec'), globals(), globals())"
if needle not in core_source:
    raise RuntimeError('Bootstrap principal incompatível: ponto de execução não encontrado.')

core_source = core_source.replace(needle, access_patch + "\n" + needle, 1)
exec(compile(core_source, str(_core), 'exec'), globals(), globals())
