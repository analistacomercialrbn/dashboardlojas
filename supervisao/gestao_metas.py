import base64
import copy
import json
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
import streamlit as st

REPO = 'analistacomercialrbn/dashboardlojas'
BRANCH = 'main'
STORE_REPO_PATH = 'supervisao/metas_planejamento.json'
STORE_LOCAL = Path(__file__).with_name('metas_planejamento.json')

STATUS_LABEL = {
    'EM_ELABORACAO': 'Em elaboração',
    'ENVIADO': 'Enviado pelo supervisor',
    'EM_ANALISE': 'Em análise',
    'AJUSTE_SOLICITADO': 'Ajuste solicitado',
    'APROVADO': 'Aprovado',
}

CRITERIOS = [
    'Participação histórica',
    'Crescimento sobre ano anterior',
    'Recuperação de RCA',
    'Expectativa comercial',
    'Alteração de território',
    'Entrada ou saída de cliente',
    'Potencial identificado',
    'Outro',
]

MESES = {
    1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',
    7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'
}


def _token():
    try:
        return str(st.secrets.get('GITHUB_TOKEN') or st.secrets.get('GH_TOKEN') or '')
    except Exception:
        return ''


def _headers():
    h = {'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    if _token():
        h['Authorization'] = f'Bearer {_token()}'
    return h


def _load_store():
    api = f'https://api.github.com/repos/{REPO}/contents/{STORE_REPO_PATH}'
    try:
        r = requests.get(api, headers=_headers(), params={'ref':BRANCH}, timeout=20)
        r.raise_for_status()
        data = r.json()
        txt = base64.b64decode(data['content']).decode('utf-8')
        store = json.loads(txt)
        if isinstance(store, dict) and 'plans' in store:
            return store
    except Exception:
        pass
    try:
        store = json.loads(STORE_LOCAL.read_text(encoding='utf-8'))
        if isinstance(store, dict) and 'plans' in store:
            return store
    except Exception:
        pass
    return {'plans':{}}


def _save_store(store):
    tok = _token()
    if not tok:
        return False, 'GITHUB_TOKEN não configurado nos Secrets do Streamlit.'
    api = f'https://api.github.com/repos/{REPO}/contents/{STORE_REPO_PATH}'
    try:
        atual = requests.get(api, headers=_headers(), params={'ref':BRANCH}, timeout=20)
        atual.raise_for_status()
        sha = atual.json()['sha']
        texto = json.dumps(store, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
        payload = {
            'message':'Atualiza planejamento de metas pelo dashboard',
            'content':base64.b64encode(texto.encode('utf-8')).decode('ascii'),
            'sha':sha,
            'branch':BRANCH,
        }
        resp = requests.put(api, headers=_headers(), json=payload, timeout=30)
        resp.raise_for_status()
        try:
            STORE_LOCAL.write_text(texto, encoding='utf-8')
        except Exception:
            pass
        return True, 'Planejamento salvo.'
    except Exception as exc:
        return False, f'Não foi possível salvar o planejamento: {exc}'


def _now():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def _user_name(usuario):
    return str(usuario.get('nome') or usuario.get('login') or 'Usuário')


def _plan_key(ano, meses, supervisor):
    return f"{ano}|{','.join(str(m) for m in meses)}|{supervisor}"


def _empty_plan(ano, meses, supervisor, meta_empresa, usuario):
    return {
        'ano':int(ano), 'meses':[int(m) for m in meses], 'supervisor':supervisor,
        'meta_empresa':float(meta_empresa or 0), 'status':'EM_ELABORACAO', 'versao':1,
        'justificativa_geral':'', 'criado_em':_now(), 'atualizado_em':_now(),
        'criado_por':_user_name(usuario), 'rcas':{}, 'eventos':[], 'versoes':[]
    }


def _snapshot(plan):
    snap = copy.deepcopy(plan)
    snap.pop('eventos', None)
    snap.pop('versoes', None)
    snap['snapshot_em'] = _now()
    return snap


def _event(plan, acao, usuario, obs=''):
    plan.setdefault('eventos', []).append({
        'data_hora':_now(), 'usuario':_user_name(usuario), 'acao':acao,
        'status':plan.get('status','EM_ELABORACAO'), 'versao':plan.get('versao',1),
        'observacao':str(obs or '')
    })


def _period_mask(df, ano, meses):
    return df['DATA_FAT'].notna() & df['DATA_FAT'].dt.year.eq(int(ano)) & df['DATA_FAT'].dt.month.isin(meses)


def _hist_rca(vendas, codigos, ano, meses, sup):
    base = vendas[vendas['FATURADO'] & vendas['COD_RCA'].isin(codigos)].copy()
    base = base[base['SUPERVISOR'].astype(str).eq(str(sup))]
    prev = base[_period_mask(base, int(ano)-1, meses)].copy()
    if meses:
        inicio = pd.Timestamp(int(ano), min(meses), 1)
    else:
        inicio = pd.Timestamp(int(ano), 1, 1)
    fim12 = inicio - pd.Timedelta(days=1)
    ini12 = fim12 - pd.DateOffset(months=12) + pd.Timedelta(days=1)
    ult12 = base[base['DATA_FAT'].between(ini12, fim12)].copy()
    return prev, ult12


def _meta_periodo(metas, ativos, ano, meses, sup):
    x = metas.copy()
    if 'ANO' not in x.columns:
        x['ANO'] = pd.to_numeric(x['MES'].astype(str).str[:4], errors='coerce')
    if 'MES_NUM' not in x.columns:
        x['MES_NUM'] = pd.to_numeric(x['MES'].astype(str).str[5:7], errors='coerce')
    x = x.merge(ativos[['COD_RCA','SUPERVISOR']].drop_duplicates('COD_RCA'), on='COD_RCA', how='left')
    x = x[x['SUPERVISOR'].astype(str).eq(str(sup)) & x['ANO'].eq(int(ano)) & x['MES_NUM'].isin(meses)]
    return float(x['META'].sum())


def _status_badge(status):
    label = STATUS_LABEL.get(status, status)
    return f"<span style='display:inline-block;padding:5px 10px;border-radius:999px;background:#EEF1F8;color:#1E2655;font-size:12px;font-weight:700'>{label}</span>"


def _money_num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def render_gestao_metas(vendas, metas, ativos, usuario, brl, brl_compacto, pct, kpi):
    st.subheader('Gestão de Metas')
    st.caption('Construção, distribuição, justificativa e aprovação das metas. A aba Metas continua sendo o acompanhamento do realizado.')

    anos = sorted(set(vendas.loc[vendas['FATURADO'],'DATA_FAT'].dropna().dt.year.astype(int).tolist()) | set(pd.to_numeric(metas['MES'].astype(str).str[:4], errors='coerce').dropna().astype(int).tolist()), reverse=True)
    if not anos:
        anos = [datetime.now().year]
    ano_padrao = 2026 if 2026 in anos else anos[0]
    c1,c2,c3 = st.columns([1,2,2])
    ano = c1.selectbox('Ano do planejamento', anos, index=anos.index(ano_padrao), key='gm_ano')
    nomes = list(MESES.values())
    meses_sel = c2.multiselect('Meses do período', nomes, default=['Outubro','Novembro','Dezembro'], key='gm_meses')
    meses = sorted([m for m,n in MESES.items() if n in meses_sel])
    if not meses:
        st.warning('Selecione pelo menos um mês para montar o planejamento.')
        return

    sups = sorted(ativos['SUPERVISOR'].dropna().astype(str).unique().tolist())
    if not sups:
        st.info('Nenhuma supervisão disponível para este usuário.')
        return
    sup = c3.selectbox('Supervisão', sups, key='gm_sup')

    escopo_rca = ativos[ativos['SUPERVISOR'].astype(str).eq(str(sup))][['COD_RCA','RCA','SUPERVISOR']].drop_duplicates('COD_RCA').dropna(subset=['COD_RCA'])
    codigos = set(escopo_rca['COD_RCA'])
    meta_existente = _meta_periodo(metas, ativos, ano, meses, sup)
    store = _load_store()
    key = _plan_key(ano, meses, sup)
    plan = copy.deepcopy(store.get('plans',{}).get(key) or _empty_plan(ano, meses, sup, meta_existente, usuario))
    if not plan.get('meta_empresa') and meta_existente:
        plan['meta_empresa'] = meta_existente

    prev, ult12 = _hist_rca(vendas, codigos, ano, meses, sup)
    hist_prev_total = float(prev['VALOR'].sum())
    hist12_total = float(ult12['VALOR'].sum())

    rprev = prev.groupby('COD_RCA', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'HIST_ANT'}) if not prev.empty else pd.DataFrame(columns=['COD_RCA','HIST_ANT'])
    r12 = ult12.groupby('COD_RCA', as_index=False)['VALOR'].sum().rename(columns={'VALOR':'HIST_12M'}) if not ult12.empty else pd.DataFrame(columns=['COD_RCA','HIST_12M'])
    resumo = escopo_rca.merge(rprev,on='COD_RCA',how='left').merge(r12,on='COD_RCA',how='left').fillna({'HIST_ANT':0,'HIST_12M':0})
    resumo['PART'] = resumo['HIST_ANT'].div(hist_prev_total if hist_prev_total else pd.NA)
    if hist_prev_total == 0:
        resumo['PART'] = resumo['HIST_12M'].div(hist12_total if hist12_total else pd.NA)
    resumo['PART'] = resumo['PART'].fillna(0)
    resumo['MEDIA_MENSAL'] = resumo['HIST_12M'] / 12
    resumo['SUGERIDA'] = resumo['PART'] * float(plan.get('meta_empresa',0) or 0)

    for _, row in resumo.iterrows():
        cod = str(int(row.COD_RCA))
        rec = plan.setdefault('rcas',{}).setdefault(cod, {})
        rec.setdefault('rca', str(row.RCA))
        rec['meta_sugerida'] = float(row.SUGERIDA)
        rec.setdefault('meta_proposta', float(row.SUGERIDA))
        rec.setdefault('criterio','Participação histórica')
        rec.setdefault('justificativa','')
        rec.setdefault('premissas','')
        rec.setdefault('detalhes',{})

    total_proposto = sum(_money_num(x.get('meta_proposta')) for x in plan.get('rcas',{}).values())
    falta = _money_num(plan.get('meta_empresa')) - total_proposto
    cres = ((total_proposto / hist_prev_total - 1) * 100) if hist_prev_total else pd.NA

    st.markdown(_status_badge(plan.get('status','EM_ELABORACAO')), unsafe_allow_html=True)
    k1,k2,k3,k4,k5,k6 = st.columns(6)
    k1.markdown(kpi('Meta definida',brl_compacto(plan.get('meta_empresa',0)),brl(plan.get('meta_empresa',0))),unsafe_allow_html=True)
    k2.markdown(kpi('Distribuído aos RCAs',brl_compacto(total_proposto),brl(total_proposto)),unsafe_allow_html=True)
    k3.markdown(kpi('Saldo a distribuir',brl_compacto(falta),brl(falta)),unsafe_allow_html=True)
    k4.markdown(kpi('Mesmo período A-1',brl_compacto(hist_prev_total),brl(hist_prev_total)),unsafe_allow_html=True)
    k5.markdown(kpi('Histórico 12 meses',brl_compacto(hist12_total),brl(hist12_total)),unsafe_allow_html=True)
    k6.markdown(kpi('Crescimento proposto',pct(cres),'Proposta x mesmo período A-1'),unsafe_allow_html=True)

    t1,t2,t3,t4,t5 = st.tabs(['Planejamento','Distribuição por RCA','Departamentos','Visão da Gestão','Histórico'])

    with t1:
        st.markdown('### Planejamento da Supervisão')
        editavel = plan.get('status') in ('EM_ELABORACAO','AJUSTE_SOLICITADO') or usuario.get('perfil') in ('ADMIN','GERENTE')
        a,b = st.columns([1,2])
        meta_empresa = a.number_input('Meta definida pela empresa', min_value=0.0, value=float(plan.get('meta_empresa',0)), step=1000.0, format='%.2f', disabled=not editavel, key=f'gm_meta_empresa_{key}')
        just_geral = b.text_area('Justificativa geral / premissas da supervisão', value=plan.get('justificativa_geral',''), disabled=not editavel, key=f'gm_justgeral_{key}')
        plan['meta_empresa'] = float(meta_empresa)
        plan['justificativa_geral'] = just_geral

        quadro = []
        for m in meses:
            hist_m = vendas[vendas['FATURADO'] & vendas['COD_RCA'].isin(codigos) & vendas['SUPERVISOR'].astype(str).eq(str(sup)) & vendas['DATA_FAT'].dt.year.eq(int(ano)-1) & vendas['DATA_FAT'].dt.month.eq(m)]['VALOR'].sum()
            dist_m = 0.0
            for rec in plan.get('rcas',{}).values():
                for depv in rec.get('detalhes',{}).values():
                    dist_m += _money_num(depv.get(str(m)))
            quadro.append({'Mês':MESES[m], 'Histórico A-1':brl(hist_m), 'Distribuído':brl(dist_m), 'Saldo':brl((meta_empresa/len(meses))-dist_m)})
        st.dataframe(pd.DataFrame(quadro), use_container_width=True, hide_index=True)

        if st.button('Salvar planejamento', use_container_width=True, disabled=not editavel, key=f'gm_save_plan_{key}'):
            plan['atualizado_em'] = _now(); _event(plan,'SALVAR_PLANEJAMENTO',usuario)
            store.setdefault('plans',{})[key] = plan
            ok,msg = _save_store(store)
            (st.success if ok else st.error)(msg)
            if ok: st.rerun()

    with t2:
        st.markdown('### Distribuição por RCA')
        rows=[]
        for _, row in resumo.sort_values('RCA').iterrows():
            cod = str(int(row.COD_RCA)); rec = plan['rcas'][cod]
            prop = _money_num(rec.get('meta_proposta'))
            var = ((prop / row.SUGERIDA - 1)*100) if row.SUGERIDA else pd.NA
            rows.append({'COD_RCA':int(row.COD_RCA),'RCA':row.RCA,'Histórico A-1':float(row.HIST_ANT),'Histórico 12m':float(row.HIST_12M),'Participação %':float(row.PART*100),'Média mensal':float(row.MEDIA_MENSAL),'Meta sugerida':float(row.SUGERIDA),'Meta proposta':prop,'Variação %':var})
        rdf = pd.DataFrame(rows)
        edited = st.data_editor(rdf, use_container_width=True, hide_index=True, disabled=[c for c in rdf.columns if c!='Meta proposta'], column_config={'Meta proposta':st.column_config.NumberColumn(format='R$ %.2f'),'Histórico A-1':st.column_config.NumberColumn(format='R$ %.2f'),'Histórico 12m':st.column_config.NumberColumn(format='R$ %.2f'),'Média mensal':st.column_config.NumberColumn(format='R$ %.2f'),'Meta sugerida':st.column_config.NumberColumn(format='R$ %.2f'),'Participação %':st.column_config.NumberColumn(format='%.2f%%'),'Variação %':st.column_config.NumberColumn(format='%.2f%%')}, key=f'gm_rca_editor_{key}')

        selecionado = st.selectbox('Detalhar RCA', [f"{r['COD_RCA']} - {r['RCA']}" for r in rows], key=f'gm_rca_det_{key}') if rows else None
        if selecionado:
            codsel = selecionado.split(' - ',1)[0]
            rec = plan['rcas'][codsel]
            c1,c2 = st.columns([1,2])
            criterio = c1.selectbox('Critério utilizado', CRITERIOS, index=CRITERIOS.index(rec.get('criterio')) if rec.get('criterio') in CRITERIOS else 0, key=f'gm_crit_{key}_{codsel}')
            justificativa = c2.text_area('Justificativa da meta', value=rec.get('justificativa',''), key=f'gm_just_{key}_{codsel}')
            premissas = st.text_area('Premissas utilizadas', value=rec.get('premissas',''), key=f'gm_prem_{key}_{codsel}')
            rec['criterio']=criterio; rec['justificativa']=justificativa; rec['premissas']=premissas

        if st.button('Salvar distribuição por RCA', use_container_width=True, key=f'gm_save_rca_{key}'):
            for _, er in edited.iterrows():
                plan['rcas'][str(int(er.COD_RCA))]['meta_proposta'] = float(er['Meta proposta'] or 0)
            plan['atualizado_em']=_now(); _event(plan,'SALVAR_DISTRIBUICAO_RCA',usuario)
            store.setdefault('plans',{})[key]=plan
            ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
            if ok: st.rerun()

    with t3:
        st.markdown('### Detalhamento por Departamento e Mês')
        if not rows:
            st.info('Sem RCAs no escopo.')
        else:
            rca_label = st.selectbox('RCA', [f"{r['COD_RCA']} - {r['RCA']}" for r in rows], key=f'gm_dep_rca_{key}')
            codsel = rca_label.split(' - ',1)[0]
            codnum = int(codsel)
            rec = plan['rcas'][codsel]
            deps = sorted(set(vendas.loc[vendas['COD_RCA'].eq(codnum),'DEPARTAMENTO'].dropna().astype(str)) | set(metas.loc[metas['COD_RCA'].eq(codnum),'DEPARTAMENTO'].dropna().astype(str)))
            if not deps:
                st.info('Nenhum departamento encontrado para este RCA.')
            else:
                det = rec.setdefault('detalhes',{})
                hist_dep = prev[prev['COD_RCA'].eq(codnum)].groupby('DEPARTAMENTO')['VALOR'].sum() if not prev.empty else pd.Series(dtype=float)
                htot = float(hist_dep.sum())
                data=[]
                for dep in deps:
                    drec = det.setdefault(dep,{})
                    linha={'Departamento':dep}
                    share = float(hist_dep.get(dep,0))/htot if htot else (1/len(deps))
                    for m in meses:
                        if str(m) not in drec:
                            drec[str(m)] = float(rec.get('meta_proposta',0))*share/len(meses)
                        linha[MESES[m]] = _money_num(drec.get(str(m)))
                    data.append(linha)
                ddf = pd.DataFrame(data)
                ded = st.data_editor(ddf, use_container_width=True, hide_index=True, disabled=['Departamento'], column_config={MESES[m]:st.column_config.NumberColumn(format='R$ %.2f') for m in meses}, key=f'gm_dep_editor_{key}_{codsel}')
                total_det = sum(float(ded[MESES[m]].sum()) for m in meses)
                meta_rca = _money_num(rec.get('meta_proposta'))
                dif = meta_rca-total_det
                a,b,c = st.columns(3)
                a.metric('Meta do RCA',brl(meta_rca)); b.metric('Distribuído',brl(total_det)); c.metric('Diferença',brl(dif))
                if abs(dif) <= 0.02:
                    st.success('Distribuição fechada: departamentos e meses somam a meta do RCA.')
                else:
                    st.warning(f'A distribuição ainda não fecha. Diferença: {brl(dif)}')
                if st.button('Salvar departamentos e meses', use_container_width=True, key=f'gm_save_dep_{key}_{codsel}'):
                    for _, rr in ded.iterrows():
                        dep = str(rr['Departamento']); det.setdefault(dep,{})
                        for m in meses:
                            det[dep][str(m)] = float(rr[MESES[m]] or 0)
                    plan['atualizado_em']=_now(); _event(plan,'SALVAR_DEPARTAMENTOS',usuario,f'RCA {codsel}')
                    store.setdefault('plans',{})[key]=plan
                    ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
                    if ok: st.rerun()

    with t4:
        st.markdown('### Visão da Gestão')
        consolidado=[]
        for s in sups:
            skey=_plan_key(ano,meses,s); sp=store.get('plans',{}).get(skey)
            me=_meta_periodo(metas,ativos,ano,meses,s)
            if sp:
                mp=sum(_money_num(x.get('meta_proposta')) for x in sp.get('rcas',{}).values())
                status=STATUS_LABEL.get(sp.get('status'),sp.get('status'))
            else:
                mp=0.0; status='Não iniciado'
            consolidado.append({'Supervisor':s,'Meta definida':me,'Proposta enviada':mp,'Diferença':mp-me,'Status':status})
        cdf=pd.DataFrame(consolidado)
        st.dataframe(cdf,use_container_width=True,hide_index=True,column_config={'Meta definida':st.column_config.NumberColumn(format='R$ %.2f'),'Proposta enviada':st.column_config.NumberColumn(format='R$ %.2f'),'Diferença':st.column_config.NumberColumn(format='R$ %.2f')})

        perfil=str(usuario.get('perfil') or '')
        status=plan.get('status','EM_ELABORACAO')
        b1,b2,b3,b4=st.columns(4)
        enviar=b1.button('Enviar proposta',use_container_width=True,disabled=status not in ('EM_ELABORACAO','AJUSTE_SOLICITADO'),key=f'gm_send_{key}')
        analisar=b2.button('Colocar em análise',use_container_width=True,disabled=perfil not in ('ADMIN','GERENTE') or status!='ENVIADO',key=f'gm_an_{key}')
        ajuste=b3.button('Solicitar ajuste',use_container_width=True,disabled=perfil not in ('ADMIN','GERENTE') or status not in ('ENVIADO','EM_ANALISE'),key=f'gm_adj_{key}')
        aprovar=b4.button('Aprovar',use_container_width=True,disabled=perfil not in ('ADMIN','GERENTE') or status not in ('ENVIADO','EM_ANALISE'),key=f'gm_apr_{key}')
        mudou=False
        if enviar:
            soma=sum(_money_num(x.get('meta_proposta')) for x in plan.get('rcas',{}).values())
            if abs(soma-_money_num(plan.get('meta_empresa'))) > 0.02:
                st.error('A soma das metas dos RCAs precisa ser igual à meta da supervisão antes do envio.')
            else:
                plan['status']='ENVIADO'; plan.setdefault('versoes',[]).append(_snapshot(plan)); _event(plan,'ENVIAR_PROPOSTA',usuario); mudou=True
        elif analisar:
            plan['status']='EM_ANALISE'; _event(plan,'INICIAR_ANALISE',usuario); mudou=True
        elif ajuste:
            plan['status']='AJUSTE_SOLICITADO'; plan['versao']=int(plan.get('versao',1))+1; _event(plan,'SOLICITAR_AJUSTE',usuario); mudou=True
        elif aprovar:
            plan['status']='APROVADO'; plan.setdefault('versoes',[]).append(_snapshot(plan)); _event(plan,'APROVAR_META',usuario); mudou=True
        if mudou:
            plan['atualizado_em']=_now(); store.setdefault('plans',{})[key]=plan
            ok,msg=_save_store(store); (st.success if ok else st.error)(msg)
            if ok: st.rerun()

    with t5:
        st.markdown('### Histórico e versões')
        eventos=plan.get('eventos',[])
        if eventos:
            st.dataframe(pd.DataFrame(eventos).sort_values('data_hora',ascending=False),use_container_width=True,hide_index=True)
        else:
            st.info('Ainda não há eventos registrados para este planejamento.')
        versoes=plan.get('versoes',[])
        if versoes:
            vr=[]
            for v in versoes:
                vr.append({'Versão':v.get('versao'),'Status':STATUS_LABEL.get(v.get('status'),v.get('status')),'Registrada em':v.get('snapshot_em'),'Meta empresa':v.get('meta_empresa'),'Total proposto':sum(_money_num(x.get('meta_proposta')) for x in v.get('rcas',{}).values())})
            st.dataframe(pd.DataFrame(vr),use_container_width=True,hide_index=True,column_config={'Meta empresa':st.column_config.NumberColumn(format='R$ %.2f'),'Total proposto':st.column_config.NumberColumn(format='R$ %.2f')})
