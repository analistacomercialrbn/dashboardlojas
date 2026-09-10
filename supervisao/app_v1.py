from pathlib import Path

_core = Path(__file__).with_name('app_v1_core.py')
core_source = _core.read_text(encoding='utf-8')

access_patch = r'''
# Controle de acesso aplicado sobre o app_v2 já transformado pelo bootstrap principal.
auth_block = r"""
import base64
import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path

USERS_PATH = Path(__file__).with_name('usuarios.json')
GITHUB_REPO = 'analistacomercialrbn/dashboardlojas'
GITHUB_USERS_PATH = 'supervisao/usuarios.json'
GITHUB_BRANCH = 'main'


def _load_access_users():
    try:
        dados = json.loads(USERS_PATH.read_text(encoding='utf-8'))
        if isinstance(dados, dict) and dados:
            return dados
    except Exception:
        pass
    return {
        'admin': {
            'nome': 'Coordenação Comercial',
            'perfil': 'ADMIN',
            'senha_algo': 'sha256',
            'senha_hash': '2b5c13156ad585cfd7dc3de698ddef30d37ac8438f62998ef2dd1ab75cd50fdd',
            'salt': '',
            'supervisor': None,
            'cod_rca': None,
            'ativo': True,
        }
    }


ACCESS_USERS = _load_access_users()


def _hash_password(senha, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', str(senha).encode('utf-8'), salt.encode('utf-8'), 200000)
    return salt, digest.hex()


def _validar_acesso(login, senha):
    chave = str(login or '').strip().lower()
    usuario = ACCESS_USERS.get(chave)
    if not usuario or not usuario.get('ativo'):
        return None
    algo = usuario.get('senha_algo', 'sha256')
    if algo == 'pbkdf2_sha256':
        salt = str(usuario.get('salt') or '')
        recebido = hashlib.pbkdf2_hmac('sha256', str(senha or '').encode('utf-8'), salt.encode('utf-8'), 200000).hex()
    else:
        recebido = hashlib.sha256(str(senha or '').encode('utf-8')).hexdigest()
    if not hmac.compare_digest(recebido, str(usuario.get('senha_hash', ''))):
        return None
    return chave


def _github_token():
    try:
        if 'GITHUB_TOKEN' in st.secrets:
            return str(st.secrets['GITHUB_TOKEN'])
        if 'GH_TOKEN' in st.secrets:
            return str(st.secrets['GH_TOKEN'])
    except Exception:
        pass
    return None


def _persist_access_users(dados):
    token = _github_token()
    if not token:
        return False, 'Falta configurar GITHUB_TOKEN nos Secrets do app para permitir salvar usuários.'

    api = f'https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_USERS_PATH}'
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }
    try:
        atual = requests.get(api, headers=headers, params={'ref': GITHUB_BRANCH}, timeout=30)
        atual.raise_for_status()
        sha = atual.json()['sha']
        texto = json.dumps(dados, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
        payload = {
            'message': 'Atualiza usuários do dashboard pela tela administrativa',
            'content': base64.b64encode(texto.encode('utf-8')).decode('ascii'),
            'sha': sha,
            'branch': GITHUB_BRANCH,
        }
        resp = requests.put(api, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        USERS_PATH.write_text(texto, encoding='utf-8')
        return True, 'Usuário salvo. A alteração já foi registrada e continuará válida após reinícios.'
    except Exception as exc:
        return False, f'Não foi possível salvar o cadastro: {exc}'


def _render_admin_users(rcas):
    global ACCESS_USERS
    st.markdown("<div style='font-size:30px;font-weight:800;color:#1E2655;margin-bottom:4px;'>Usuários e acessos</div>", unsafe_allow_html=True)
    st.caption('Cadastre quem pode acessar o dashboard e defina o nível de visualização de cada pessoa.')

    cvolta, _ = st.columns([1, 5])
    with cvolta:
        if st.button('← Voltar ao painel', use_container_width=True):
            st.session_state['admin_users_page'] = False
            st.rerun()

    usuarios_rows = []
    for login, u in sorted(ACCESS_USERS.items()):
        vinculo = 'Todos os dados'
        if u.get('perfil') == 'SUPERVISOR':
            vinculo = u.get('supervisor') or '—'
        elif u.get('perfil') == 'RCA':
            vinculo = str(u.get('cod_rca') or '—')
        usuarios_rows.append({
            'Usuário': login,
            'Nome': u.get('nome', ''),
            'Perfil': u.get('perfil', ''),
            'Vínculo': vinculo,
            'Status': 'Ativo' if u.get('ativo') else 'Inativo',
        })
    if usuarios_rows:
        st.dataframe(pd.DataFrame(usuarios_rows), use_container_width=True, hide_index=True)

    st.divider()
    modo = st.radio('O que deseja fazer?', ['Novo usuário', 'Editar usuário'], horizontal=True)

    ativos_rca = rcas[rcas['ATIVO'].astype(str).str.upper().str.strip().eq('S')].copy()
    sup_opts = sorted(ativos_rca['SUPERVISOR'].dropna().astype(str).str.strip().unique().tolist())
    rca_opts_df = ativos_rca[['COD_RCA','RCA','SUPERVISOR']].dropna(subset=['COD_RCA']).drop_duplicates('COD_RCA').sort_values('RCA')
    rca_labels = [f"{int(row.COD_RCA)} - {row.RCA}" for _, row in rca_opts_df.iterrows()]
    rca_map = {f"{int(row.COD_RCA)} - {row.RCA}": int(row.COD_RCA) for _, row in rca_opts_df.iterrows()}

    if modo == 'Novo usuário':
        perfil = st.selectbox('Perfil *', ['ADMIN','GERENTE','SUPERVISOR','RCA'], key='novo_usuario_perfil')
        if perfil in ('ADMIN','GERENTE'):
            st.caption('Este perfil tem visão geral e não precisa ser vinculado a supervisor ou RCA.')
        a,b = st.columns(2)
        login = a.text_input('Usuário ou e-mail *', key='novo_usuario_login')
        nome = b.text_input('Nome *', key='novo_usuario_nome')
        supervisor = None
        cod_rca = None
        if perfil == 'SUPERVISOR':
            supervisor = st.selectbox('Supervisor vinculado *', sup_opts, key='novo_usuario_supervisor') if sup_opts else None
        elif perfil == 'RCA':
            escolhido = st.selectbox('RCA vinculado *', rca_labels, key='novo_usuario_rca') if rca_labels else None
            cod_rca = rca_map.get(escolhido) if escolhido else None
        c,d = st.columns(2)
        senha = c.text_input('Senha inicial *', type='password', key='novo_usuario_senha')
        confirma = d.text_input('Confirmar senha *', type='password', key='novo_usuario_confirma')
        ativo = st.checkbox('Usuário ativo', value=True, key='novo_usuario_ativo')
        salvar = st.button('Cadastrar usuário', use_container_width=True, key='novo_usuario_salvar')

        if salvar:
            chave = str(login or '').strip().lower()
            if not chave or not str(nome or '').strip():
                st.error('Preencha usuário/e-mail e nome.')
            elif chave in ACCESS_USERS:
                st.error('Esse usuário já existe. Use “Editar usuário”.')
            elif len(str(senha)) < 8:
                st.error('A senha precisa ter pelo menos 8 caracteres.')
            elif senha != confirma:
                st.error('As senhas não coincidem.')
            elif perfil == 'SUPERVISOR' and not supervisor:
                st.error('Selecione o supervisor vinculado.')
            elif perfil == 'RCA' and cod_rca is None:
                st.error('Selecione o RCA vinculado.')
            else:
                salt, senha_hash = _hash_password(senha)
                novos = dict(ACCESS_USERS)
                novos[chave] = {
                    'nome': str(nome).strip(),
                    'perfil': perfil,
                    'senha_algo': 'pbkdf2_sha256',
                    'senha_hash': senha_hash,
                    'salt': salt,
                    'supervisor': supervisor if perfil == 'SUPERVISOR' else None,
                    'cod_rca': cod_rca if perfil == 'RCA' else None,
                    'ativo': bool(ativo),
                }
                ok, msg = _persist_access_users(novos)
                if ok:
                    ACCESS_USERS = novos
                    st.success(msg)
                    st.rerun()
                else:
                    st.error(msg)
    else:
        editaveis = sorted(ACCESS_USERS.keys())
        escolhido_login = st.selectbox('Usuário para editar', editaveis, key='editar_usuario_login')
        atual = ACCESS_USERS[escolhido_login]
        perfis = ['ADMIN','GERENTE','SUPERVISOR','RCA']
        perfil_idx = perfis.index(atual.get('perfil')) if atual.get('perfil') in perfis else 0
        perfil_edit = st.selectbox('Perfil *', perfis, index=perfil_idx, key=f'editar_perfil_{escolhido_login}')
        if perfil_edit in ('ADMIN','GERENTE'):
            st.caption('Este perfil tem visão geral e não precisa ser vinculado a supervisor ou RCA.')

        a,b = st.columns(2)
        a.text_input('Usuário', value=escolhido_login, disabled=True, key=f'editar_login_{escolhido_login}')
        nome_edit = b.text_input('Nome *', value=atual.get('nome',''), key=f'editar_nome_{escolhido_login}')
        supervisor_edit = None
        cod_rca_edit = None
        if perfil_edit == 'SUPERVISOR':
            atual_sup = atual.get('supervisor')
            sup_idx = sup_opts.index(atual_sup) if atual_sup in sup_opts else 0
            supervisor_edit = st.selectbox('Supervisor vinculado *', sup_opts, index=sup_idx, key=f'editar_sup_{escolhido_login}') if sup_opts else None
        elif perfil_edit == 'RCA':
            atual_cod = atual.get('cod_rca')
            atual_label = next((k for k,v in rca_map.items() if v == atual_cod), None)
            rca_idx = rca_labels.index(atual_label) if atual_label in rca_labels else 0
            rca_label_edit = st.selectbox('RCA vinculado *', rca_labels, index=rca_idx, key=f'editar_rca_{escolhido_login}') if rca_labels else None
            cod_rca_edit = rca_map.get(rca_label_edit) if rca_label_edit else None
        ativo_edit = st.checkbox('Usuário ativo', value=bool(atual.get('ativo', True)), disabled=(escolhido_login == st.session_state.get('auth_user')), key=f'editar_ativo_{escolhido_login}')
        st.caption('Para manter a senha atual, deixe os campos abaixo vazios.')
        c,d = st.columns(2)
        nova_senha = c.text_input('Nova senha', type='password', key=f'editar_senha_{escolhido_login}')
        confirma_senha = d.text_input('Confirmar nova senha', type='password', key=f'editar_confirma_{escolhido_login}')
        salvar_edit = st.button('Salvar alterações', use_container_width=True, key=f'editar_salvar_{escolhido_login}')

        if salvar_edit:
            if not str(nome_edit or '').strip():
                st.error('Preencha o nome.')
            elif perfil_edit == 'SUPERVISOR' and not supervisor_edit:
                st.error('Selecione o supervisor vinculado.')
            elif perfil_edit == 'RCA' and cod_rca_edit is None:
                st.error('Selecione o RCA vinculado.')
            elif nova_senha and len(str(nova_senha)) < 8:
                st.error('A nova senha precisa ter pelo menos 8 caracteres.')
            elif nova_senha != confirma_senha:
                st.error('As senhas não coincidem.')
            else:
                novos = dict(ACCESS_USERS)
                registro = dict(atual)
                registro['nome'] = str(nome_edit).strip()
                registro['perfil'] = perfil_edit
                registro['supervisor'] = supervisor_edit if perfil_edit == 'SUPERVISOR' else None
                registro['cod_rca'] = cod_rca_edit if perfil_edit == 'RCA' else None
                registro['ativo'] = True if escolhido_login == st.session_state.get('auth_user') else bool(ativo_edit)
                if nova_senha:
                    salt, senha_hash = _hash_password(nova_senha)
                    registro['senha_algo'] = 'pbkdf2_sha256'
                    registro['senha_hash'] = senha_hash
                    registro['salt'] = salt
                novos[escolhido_login] = registro
                ok, msg = _persist_access_users(novos)
                if ok:
                    ACCESS_USERS = novos
                    st.success(msg)
                    st.rerun()
                else:
                    st.error(msg)

    if not _github_token():
        st.warning('A tela já está pronta, mas para o botão Salvar funcionar de forma permanente é necessário adicionar uma vez o segredo GITHUB_TOKEN nas configurações do app no Streamlit.')


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
if USUARIO_ATUAL.get('perfil') == 'ADMIN':
    if st.sidebar.button('👥 Usuários e acessos', use_container_width=True):
        st.session_state['admin_users_page'] = True
        st.rerun()
if st.sidebar.button('Sair', use_container_width=True):
    for _k in list(st.session_state.keys()):
        if _k == 'auth_user' or _k.startswith('xf_') or _k == 'admin_users_page':
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

if USUARIO_ATUAL.get('perfil') == 'ADMIN' and st.session_state.get('admin_users_page'):
    _render_admin_users(rcas)
    st.stop()
"""
source = source.replace("ativos = rcas[rcas['ATIVO'].eq('S')].copy()", role_scope, 1)
'''

needle = "exec(compile(source, str(_app), 'exec'), globals(), globals())"
if needle not in core_source:
    raise RuntimeError('Bootstrap principal incompatível: ponto de execução não encontrado.')

core_source = core_source.replace(needle, access_patch + "\n" + needle, 1)
exec(compile(core_source, str(_core), 'exec'), globals(), globals())
