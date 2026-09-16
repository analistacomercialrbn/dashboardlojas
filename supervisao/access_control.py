import base64
import hashlib
import hmac
import json
import secrets
from pathlib import Path

import pandas as pd
import requests
import streamlit as st

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
            'nome':'Coordenação Comercial','perfil':'ADMIN','senha_algo':'sha256',
            'senha_hash':'2b5c13156ad585cfd7dc3de698ddef30d37ac8438f62998ef2dd1ab75cd50fdd',
            'salt':'','supervisor':None,'cod_rca':None,'ativo':True,
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
    if usuario.get('senha_algo','sha256') == 'pbkdf2_sha256':
        salt = str(usuario.get('salt') or '')
        recebido = hashlib.pbkdf2_hmac('sha256', str(senha or '').encode('utf-8'), salt.encode('utf-8'), 200000).hex()
    else:
        recebido = hashlib.sha256(str(senha or '').encode('utf-8')).hexdigest()
    return chave if hmac.compare_digest(recebido, str(usuario.get('senha_hash',''))) else None


def github_token():
    try:
        return str(st.secrets.get('GITHUB_TOKEN') or st.secrets.get('GH_TOKEN') or '')
    except Exception:
        return ''


def _persist_access_users(dados):
    token = github_token()
    if not token:
        return False, 'Falta configurar GITHUB_TOKEN nos Secrets do app para permitir salvar usuários.'
    api = f'https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_USERS_PATH}'
    headers = {'Authorization':f'Bearer {token}','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    try:
        atual = requests.get(api, headers=headers, params={'ref':GITHUB_BRANCH}, timeout=30)
        atual.raise_for_status()
        texto = json.dumps(dados, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
        payload = {'message':'Atualiza usuários do dashboard pela tela administrativa','content':base64.b64encode(texto.encode()).decode('ascii'),'sha':atual.json()['sha'],'branch':GITHUB_BRANCH}
        resp = requests.put(api, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        try: USERS_PATH.write_text(texto, encoding='utf-8')
        except Exception: pass
        return True, 'Usuário salvo. A alteração já foi registrada e continuará válida após reinícios.'
    except Exception as exc:
        return False, f'Não foi possível salvar o cadastro: {exc}'


def auth_bootstrap():
    global ACCESS_USERS
    ACCESS_USERS = _load_access_users()
    if not st.session_state.get('auth_user'):
        st.markdown("<div style='height:5vh'></div>", unsafe_allow_html=True)
        c1,c2,c3=st.columns([1,1.15,1])
        with c2:
            st.markdown("<div style='text-align:center;font-size:30px;font-weight:800;color:#1E2655;margin-bottom:4px;'>Dashboard de Supervisão</div>", unsafe_allow_html=True)
            st.markdown("<div style='text-align:center;color:#737A8C;margin-bottom:22px;'>Acesso restrito • REBANHO</div>", unsafe_allow_html=True)
            with st.form('login_form'):
                login=st.text_input('Usuário'); senha=st.text_input('Senha',type='password'); entrar=st.form_submit_button('Entrar',use_container_width=True)
            if entrar:
                chave=_validar_acesso(login,senha)
                if chave:
                    st.session_state['auth_user']=chave; st.rerun()
                else: st.error('Usuário ou senha inválidos.')
        st.stop()
    usuario=ACCESS_USERS.get(st.session_state.get('auth_user'))
    if not usuario or not usuario.get('ativo'):
        st.session_state.pop('auth_user',None); st.rerun()
    st.sidebar.markdown(f"**{usuario['nome']}**")
    st.sidebar.caption(f"Perfil: {usuario['perfil'].title()}")
    if usuario.get('perfil')=='ADMIN':
        if st.sidebar.button('👥 Usuários e acessos',use_container_width=True):
            st.session_state['admin_users_page']=True; st.rerun()
    if st.sidebar.button('Sair',use_container_width=True):
        for k in list(st.session_state.keys()):
            if k=='auth_user' or k.startswith('xf_') or k=='admin_users_page': st.session_state.pop(k,None)
        st.rerun()
    st.sidebar.divider()
    return usuario


def scope_ativos(ativos, usuario):
    out=ativos.copy()
    if usuario.get('perfil')=='SUPERVISOR':
        sup=str(usuario.get('supervisor') or '').strip().upper()
        out=out[out['SUPERVISOR'].astype(str).str.strip().str.upper().eq(sup)].copy()
    elif usuario.get('perfil')=='RCA':
        cod=pd.to_numeric(pd.Series([usuario.get('cod_rca')]),errors='coerce').iloc[0]
        out=out[out['COD_RCA'].eq(cod)].copy()
    return out


def render_admin_users(rcas):
    global ACCESS_USERS
    ACCESS_USERS=_load_access_users()
    st.markdown("<div style='font-size:30px;font-weight:800;color:#1E2655;margin-bottom:4px;'>Usuários e acessos</div>",unsafe_allow_html=True)
    st.caption('Cadastre quem pode acessar o dashboard e defina o nível de visualização de cada pessoa.')
    cvolta,_=st.columns([1,5])
    with cvolta:
        if st.button('← Voltar ao painel',use_container_width=True):
            st.session_state['admin_users_page']=False; st.rerun()
    rows=[]
    for login,u in sorted(ACCESS_USERS.items()):
        vinculo='Todos os dados'
        if u.get('perfil')=='SUPERVISOR': vinculo=u.get('supervisor') or '—'
        elif u.get('perfil')=='RCA': vinculo=str(u.get('cod_rca') or '—')
        rows.append({'Usuário':login,'Nome':u.get('nome',''),'Perfil':u.get('perfil',''),'Vínculo':vinculo,'Status':'Ativo' if u.get('ativo') else 'Inativo'})
    if rows: st.dataframe(pd.DataFrame(rows),use_container_width=True,hide_index=True)
    st.divider()
    modo=st.radio('O que deseja fazer?',['Novo usuário','Editar usuário'],horizontal=True)
    ar=rcas[rcas['ATIVO'].astype(str).str.upper().str.strip().eq('S')].copy()
    sup_opts=sorted(ar['SUPERVISOR'].dropna().astype(str).str.strip().unique().tolist())
    rdf=ar[['COD_RCA','RCA','SUPERVISOR']].dropna(subset=['COD_RCA']).drop_duplicates('COD_RCA').sort_values('RCA')
    labels=[f"{int(x.COD_RCA)} - {x.RCA}" for _,x in rdf.iterrows()]
    rmap={f"{int(x.COD_RCA)} - {x.RCA}":int(x.COD_RCA) for _,x in rdf.iterrows()}
    if modo=='Novo usuário':
        perfil=st.selectbox('Perfil *',['ADMIN','GERENTE','SUPERVISOR','RCA'],key='novo_usuario_perfil')
        if perfil in ('ADMIN','GERENTE'): st.caption('Este perfil tem visão geral e não precisa ser vinculado a supervisor ou RCA.')
        a,b=st.columns(2); login=a.text_input('Usuário ou e-mail *',key='novo_usuario_login'); nome=b.text_input('Nome *',key='novo_usuario_nome')
        supervisor=None; cod_rca=None
        if perfil=='SUPERVISOR': supervisor=st.selectbox('Supervisor vinculado *',sup_opts,key='novo_usuario_supervisor') if sup_opts else None
        elif perfil=='RCA':
            esc=st.selectbox('RCA vinculado *',labels,key='novo_usuario_rca') if labels else None; cod_rca=rmap.get(esc) if esc else None
        c,d=st.columns(2); senha=c.text_input('Senha inicial *',type='password',key='novo_usuario_senha'); confirma=d.text_input('Confirmar senha *',type='password',key='novo_usuario_confirma')
        ativo=st.checkbox('Usuário ativo',value=True,key='novo_usuario_ativo')
        if st.button('Cadastrar usuário',use_container_width=True,key='novo_usuario_salvar'):
            chave=str(login or '').strip().lower()
            erro=None
            if not chave or not str(nome or '').strip(): erro='Preencha usuário/e-mail e nome.'
            elif chave in ACCESS_USERS: erro='Esse usuário já existe. Use “Editar usuário”.'
            elif len(str(senha))<8: erro='A senha precisa ter pelo menos 8 caracteres.'
            elif senha!=confirma: erro='As senhas não coincidem.'
            elif perfil=='SUPERVISOR' and not supervisor: erro='Selecione o supervisor vinculado.'
            elif perfil=='RCA' and cod_rca is None: erro='Selecione o RCA vinculado.'
            if erro: st.error(erro)
            else:
                salt,h=_hash_password(senha); novos=dict(ACCESS_USERS)
                novos[chave]={'nome':str(nome).strip(),'perfil':perfil,'senha_algo':'pbkdf2_sha256','senha_hash':h,'salt':salt,'supervisor':supervisor if perfil=='SUPERVISOR' else None,'cod_rca':cod_rca if perfil=='RCA' else None,'ativo':bool(ativo)}
                ok,msg=_persist_access_users(novos); (st.success if ok else st.error)(msg)
                if ok: ACCESS_USERS=novos; st.rerun()
    else:
        login=st.selectbox('Usuário para editar',sorted(ACCESS_USERS),key='editar_usuario_login'); atual=ACCESS_USERS[login]
        perfis=['ADMIN','GERENTE','SUPERVISOR','RCA']; idx=perfis.index(atual.get('perfil')) if atual.get('perfil') in perfis else 0
        perfil=st.selectbox('Perfil *',perfis,index=idx,key=f'editar_perfil_{login}')
        if perfil in ('ADMIN','GERENTE'): st.caption('Este perfil tem visão geral e não precisa ser vinculado a supervisor ou RCA.')
        a,b=st.columns(2); a.text_input('Usuário',value=login,disabled=True,key=f'editar_login_{login}'); nome=b.text_input('Nome *',value=atual.get('nome',''),key=f'editar_nome_{login}')
        supervisor=None; cod_rca=None
        if perfil=='SUPERVISOR':
            atual_sup=atual.get('supervisor'); i=sup_opts.index(atual_sup) if atual_sup in sup_opts else 0; supervisor=st.selectbox('Supervisor vinculado *',sup_opts,index=i,key=f'editar_sup_{login}') if sup_opts else None
        elif perfil=='RCA':
            ac=atual.get('cod_rca'); al=next((k for k,v in rmap.items() if v==ac),None); i=labels.index(al) if al in labels else 0; lab=st.selectbox('RCA vinculado *',labels,index=i,key=f'editar_rca_{login}') if labels else None; cod_rca=rmap.get(lab) if lab else None
        ativo=st.checkbox('Usuário ativo',value=bool(atual.get('ativo',True)),disabled=(login==st.session_state.get('auth_user')),key=f'editar_ativo_{login}')
        st.caption('Para manter a senha atual, deixe os campos abaixo vazios.')
        c,d=st.columns(2); ns=c.text_input('Nova senha',type='password',key=f'editar_senha_{login}'); cs=d.text_input('Confirmar nova senha',type='password',key=f'editar_confirma_{login}')
        if st.button('Salvar alterações',use_container_width=True,key=f'editar_salvar_{login}'):
            erro=None
            if not str(nome or '').strip(): erro='Preencha o nome.'
            elif perfil=='SUPERVISOR' and not supervisor: erro='Selecione o supervisor vinculado.'
            elif perfil=='RCA' and cod_rca is None: erro='Selecione o RCA vinculado.'
            elif ns and len(str(ns))<8: erro='A nova senha precisa ter pelo menos 8 caracteres.'
            elif ns!=cs: erro='As senhas não coincidem.'
            if erro: st.error(erro)
            else:
                novos=dict(ACCESS_USERS); reg=dict(atual); reg.update({'nome':str(nome).strip(),'perfil':perfil,'supervisor':supervisor if perfil=='SUPERVISOR' else None,'cod_rca':cod_rca if perfil=='RCA' else None,'ativo':True if login==st.session_state.get('auth_user') else bool(ativo)})
                if ns:
                    salt,h=_hash_password(ns); reg.update({'senha_algo':'pbkdf2_sha256','senha_hash':h,'salt':salt})
                novos[login]=reg; ok,msg=_persist_access_users(novos); (st.success if ok else st.error)(msg)
                if ok: ACCESS_USERS=novos; st.rerun()
    if not github_token(): st.warning('Para salvar usuários de forma permanente, configure GITHUB_TOKEN nos Secrets do Streamlit.')
