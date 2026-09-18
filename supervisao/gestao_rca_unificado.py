import inspect

import pandas as pd
import streamlit as st

import gestao_metas as gm


def _num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _fmt(v):
    v = _num(v)
    return f"R$ {v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _ctx():
    frame = inspect.currentframe()
    try:
        atual = frame.f_back
        while atual is not None:
            if atual.f_code.co_name == 'render_gestao_metas':
                return atual.f_locals
            atual = atual.f_back
    finally:
        del frame
    return {}


def _participacoes(data):
    vals = pd.to_numeric(data.get('Participação ref. %'), errors='coerce').fillna(0)
    soma = float(vals.sum())
    if soma <= 0:
        n = len(data)
        return {str(int(r['COD_RCA'])): (100 / n if n else 0) for _, r in data.iterrows()}
    return {str(int(r['COD_RCA'])): 100 * float(v) / soma for (_, r), v in zip(data.iterrows(), vals)}


def _deps_ativos(srec, meses):
    deps = []
    for nome, rec in (srec.get('departamentos') or {}).items():
        mensal = rec.get('mensal') or {}
        if _num(rec.get('proposta')) > 0 or any(_num(mensal.get(str(m))) > 0 for m in meses):
            deps.append(str(nome))
    return deps


def _sincronizar_meses(rec, chave, meses, pct_geral):
    pct = rec.setdefault(chave, {})
    anterior = _num(rec.get(chave + '_geral_anterior', pct_geral))
    for m in meses:
        k = str(m)
        if k not in pct or abs(_num(pct.get(k)) - anterior) <= 0.001:
            pct[k] = pct_geral
    rec[chave + '_geral_anterior'] = pct_geral
    return pct


def _init_rcas(rcas, data, srec, meses):
    refs = _participacoes(data)
    meta_sup = sum(_num((srec.get('mensal') or {}).get(str(m))) for m in meses) or _num(srec.get('proposta'))
    for _, row in data.iterrows():
        cod = str(int(row['COD_RCA']))
        nome = str(row.get('RCA', ''))
        rr = rcas.setdefault(cod, {'rca': nome})
        rr['rca'] = nome
        if 'percentual_geral' not in rr:
            valor = _num(rr.get('proposta')) or _num(row.get('Meta proposta'))
            rr['percentual_geral'] = (100 * valor / meta_sup) if (meta_sup and valor > 0) else refs.get(cod, 0.0)


def _init_dep_rca(rr, dep, srec, meses):
    rd = rr.setdefault('departamentos', {}).setdefault(dep, {})
    rca_total = _num(rr.get('meta_ciclo_alvo')) or _num(rr.get('proposta'))
    sup_dep = (srec.get('departamentos') or {}).get(dep) or {}
    sup_pct_geral = _num(sup_dep.get('percentual_geral'))
    if 'percentual_geral' not in rd:
        valor = sum(_num((rd.get('mensal') or {}).get(str(m))) for m in meses)
        rd['percentual_geral'] = (100 * valor / rca_total) if (rca_total and valor > 0) else sup_pct_geral
    return rd


def aplicar_rcas_unificados():
    st.markdown(
        """
        <style>
        .gm-ru-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:8px 0 12px}.gm-ru-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-ru-title{font-size:17px;font-weight:900;color:#1e2655}.gm-ru-sub{font-size:10px;color:#858b99;margin-top:3px}.gm-ru-meta{text-align:right}.gm-ru-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-ru-meta strong{font-size:18px;color:#1e2655}
        .gm-ru-head{display:grid;grid-template-columns:1.8fr .72fr .9fr 1.05fr repeat(3,.68fr .95fr) .85fr;gap:8px;padding:0 11px 7px;align-items:end}.gm-ru-head span,.gm-ru-dep-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-ru-head span:first-child,.gm-ru-dep-head span:first-child{text-align:left}
        .gm-ru-name{font-size:12px;font-weight:900;color:#1e2655}.gm-ru-subline{font-size:8px;color:#8b91a0;margin-top:4px}.gm-ru-val{text-align:center}.gm-ru-val strong{font-size:10px;color:#30384d;display:block}.gm-ru-val span{font-size:8px;color:#9096a4}
        .gm-ru-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-ru-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-ru-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-ru-detail{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:14px 16px;margin:14px 0 10px}.gm-ru-detail-title{font-size:14px;font-weight:900;color:#1e2655}.gm-ru-detail-sub{font-size:10px;color:#818897;margin-top:2px}
        .gm-ru-dep-head{display:grid;grid-template-columns:1.8fr .9fr 1.05fr repeat(3,.68fr .95fr) .85fr;gap:8px;padding:0 11px 7px;align-items:end}
        .gm-ru-summary,.gm-ru-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}.gm-ru-box,.gm-ru-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-ru-box span,.gm-ru-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-box strong,.gm-ru-total strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-ru-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1250px){.gm-ru-head,.gm-ru-dep-head{display:none}.gm-ru-summary,.gm-ru-total{grid-template-columns:1fr}.gm-ru-meta{text-align:left}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_prev = st.data_editor
    button_prev = st.button
    estado = {'ok': {}}

    def data_editor(data=None, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if not key.startswith('gm2_rca_edit_') or not isinstance(data, pd.DataFrame):
            return data_editor_prev(data, *args, **kwargs)
        if data.empty or 'RCA' not in data.columns or 'Meta proposta' not in data.columns:
            return data_editor_prev(data, *args, **kwargs)

        ctx = _ctx()
        cycle = ctx.get('cycle') or {}
        meses = ctx.get('meses') or []
        sup = str(ctx.get('sup') or '')
        if not sup:
            return data_editor_prev(data, *args, **kwargs)

        srec = (cycle.get('supervisores') or {}).get(sup) or {}
        sup_mensal = srec.get('mensal') or {}
        meta_sup = sum(_num(sup_mensal.get(str(m))) for m in meses) or _num(srec.get('proposta'))
        rcas = srec.setdefault('rcas', {})
        deps = _deps_ativos(srec, meses)
        saida = data.copy()

        if not deps:
            st.warning('Primeiro distribua a meta do supervisor entre os departamentos.')
            return data_editor_prev(data, *args, **kwargs)

        _init_rcas(rcas, data, srec, meses)

        st.markdown(f"<div class='gm-ru-panel'><div class='gm-ru-panel-top'><div><div class='gm-ru-title'>Participação dos RCAs</div><div class='gm-ru-sub'>A % geral define o peso do RCA no ciclo. Os meses herdam essa % e podem ser ajustados individualmente.</div></div><div class='gm-ru-meta'><span>Meta do supervisor no ciclo</span><strong>{_fmt(meta_sup)}</strong></div></div></div>", unsafe_allow_html=True)

        st.markdown(
            "<div class='gm-ru-head'><span>RCA</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        refs = _participacoes(saida)
        soma_geral = 0.0
        soma_mes_pct = {str(m):0.0 for m in meses}
        rcas_linhas_ok = True

        for idx,row in saida.reset_index(drop=True).iterrows():
            cod=str(int(row['COD_RCA'])); nome=str(row.get('RCA','RCA')); rr=rcas[cod]
            ref=refs.get(cod,_num(row.get('Participação ref. %')))

            with st.container(border=True):
                cols=st.columns([1.8,.72,.9,1.05]+sum(([.68,.95] for _ in meses),[])+[.85],vertical_alignment='center',gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-name'>{nome}</div><div class='gm-ru-subline'>Código {cod}</div>",unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-ru-val'><strong>{ref:.2f}%</strong><span>referência</span></div>",unsafe_allow_html=True)
                with cols[2]:
                    pct_geral=st.number_input(f'% geral • {nome}',min_value=0.0,max_value=100.0,value=_num(rr.get('percentual_geral')),step=0.1,format='%.2f',key=f'gm_ru_geral_{key}_{idx}',label_visibility='collapsed')
                rr['percentual_geral']=float(pct_geral); soma_geral+=float(pct_geral)
                meta_rca=meta_sup*float(pct_geral)/100.0
                rr['meta_ciclo_alvo']=meta_rca
                with cols[3]:
                    st.markdown(f"<div class='gm-ru-val'><strong>{_fmt(meta_rca)}</strong><span>pela % geral</span></div>",unsafe_allow_html=True)

                pct_mensal=_sincronizar_meses(rr,'percentual_mensal',meses,float(pct_geral))
                mensal=rr.setdefault('mensal_alvo',{})
                pos=4
                for m in meses:
                    with cols[pos]:
                        pm=st.number_input(f'{gm.MESES[m]} % • {nome}',min_value=0.0,max_value=100.0,value=_num(pct_mensal.get(str(m))),step=0.1,format='%.2f',key=f'gm_ru_mes_{key}_{idx}_{m}',label_visibility='collapsed')
                    pct_mensal[str(m)]=float(pm); soma_mes_pct[str(m)]+=float(pm)
                    valor=_num(sup_mensal.get(str(m)))*float(pm)/100.0
                    mensal[str(m)]=valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-ru-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>",unsafe_allow_html=True)
                    pos+=2

                realizado=sum(_num(mensal.get(str(m))) for m in meses)
                rr['mensal_alvo']={str(m):_num(mensal.get(str(m))) for m in meses}
                rr['mensal']=dict(rr['mensal_alvo'])
                rr['proposta']=realizado
                saida.loc[saida.index[idx],'Meta proposta']=realizado
                ok_linha=abs(realizado-meta_rca)<=0.02
                rcas_linhas_ok=rcas_linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar ciclo'}</div>",unsafe_allow_html=True)

        geral_rca_ok=abs(soma_geral-100)<=0.01 if meta_sup>0 else True
        meses_rca_ok=True
        cards=[]
        for m in meses:
            ok=abs(soma_mes_pct[str(m)]-100)<=0.01 if _num(sup_mensal.get(str(m)))>0 else True
            meses_rca_ok=meses_rca_ok and ok
            cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]} • RCAs</span><strong>{soma_mes_pct[str(m)]:.1f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        st.markdown("<div class='gm-ru-summary'>"+''.join(cards)+"</div>",unsafe_allow_html=True)

        st.markdown("<div class='gm-ru-detail'><div class='gm-ru-detail-title'>Departamentos dentro do RCA</div><div class='gm-ru-detail-sub'>A % geral define a composição do RCA no ciclo. Os meses herdam essa composição e podem receber ajustes.</div></div>",unsafe_allow_html=True)

        opcoes=[f"{int(r['COD_RCA'])} - {r['RCA']}" for _,r in saida.iterrows()]
        escolha=st.selectbox('RCA para distribuir departamentos',opcoes,key=f'gm_ru_detail_rca_{key}_{sup}')
        cod_sel=escolha.split(' - ',1)[0]
        rr=rcas[cod_sel]
        meta_rca=_num(rr.get('meta_ciclo_alvo')) or _num(rr.get('proposta'))

        st.markdown(
            "<div class='gm-ru-dep-head'><span>Departamento</span><span>% geral</span><span>Meta ciclo</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_dep_geral=0.0
        soma_dep_mes={str(m):0.0 for m in meses}
        deps_linhas_ok=True

        for dep_idx,dep in enumerate(deps):
            rd=_init_dep_rca(rr,dep,srec,meses)

            with st.container(border=True):
                cols=st.columns([1.8,.9,1.05]+sum(([.68,.95] for _ in meses),[])+[.85],vertical_alignment='center',gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-name'>{dep}</div><div class='gm-ru-subline'>Composição da meta do RCA</div>",unsafe_allow_html=True)
                with cols[1]:
                    pct_geral_dep=st.number_input(f'% geral • {dep}',min_value=0.0,max_value=100.0,value=_num(rd.get('percentual_geral')),step=0.1,format='%.2f',key=f'gm_ru_depgeral_{key}_{cod_sel}_{dep_idx}',label_visibility='collapsed')
                rd['percentual_geral']=float(pct_geral_dep); soma_dep_geral+=float(pct_geral_dep)
                meta_dep_rca=meta_rca*float(pct_geral_dep)/100.0
                with cols[2]:
                    st.markdown(f"<div class='gm-ru-val'><strong>{_fmt(meta_dep_rca)}</strong><span>pela % geral</span></div>",unsafe_allow_html=True)

                pct_dep=_sincronizar_meses(rd,'percentual_mensal',meses,float(pct_geral_dep))
                mensal_dep=rd.setdefault('mensal',{})
                pos=3
                for m in meses:
                    base=_num((rr.get('mensal_alvo') or {}).get(str(m)))
                    with cols[pos]:
                        pm=st.number_input(f'{gm.MESES[m]} % • {dep}',min_value=0.0,max_value=100.0,value=_num(pct_dep.get(str(m))),step=0.1,format='%.2f',key=f'gm_ru_depmes_{key}_{cod_sel}_{dep_idx}_{m}',label_visibility='collapsed')
                    pct_dep[str(m)]=float(pm); soma_dep_mes[str(m)]+=float(pm)
                    valor=base*float(pm)/100.0
                    mensal_dep[str(m)]=valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-ru-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>",unsafe_allow_html=True)
                    pos+=2

                realizado_dep=sum(_num(mensal_dep.get(str(m))) for m in meses)
                rd['mensal']={str(m):_num(mensal_dep.get(str(m))) for m in meses}
                rd['proposta']=realizado_dep
                ok_dep=abs(realizado_dep-meta_dep_rca)<=0.02
                deps_linhas_ok=deps_linhas_ok and ok_dep
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok_dep else 'warn'}'>{'✓ Fechado' if ok_dep else 'Ajustar ciclo'}</div>",unsafe_allow_html=True)

        geral_dep_ok=abs(soma_dep_geral-100)<=0.01 if meta_rca>0 else True
        meses_dep_ok=True
        dep_cards=[]
        for m in meses:
            alvo_mes=_num((rr.get('mensal_alvo') or {}).get(str(m)))
            ok=abs(soma_dep_mes[str(m)]-100)<=0.01 if alvo_mes>0 else True
            meses_dep_ok=meses_dep_ok and ok
            dep_cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]} • departamentos</span><strong>{soma_dep_mes[str(m)]:.1f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        st.markdown("<div class='gm-ru-summary'>"+''.join(dep_cards)+"</div>",unsafe_allow_html=True)

        st.markdown('##### Conferência dos departamentos entre os RCAs')
        fechamento_ok=True
        rows=[]
        for dep in deps:
            dep_rec=(srec.get('departamentos') or {}).get(dep,{})
            dep_mensal=dep_rec.get('mensal') or {}
            item={'Departamento':dep}
            dep_ok=True
            for m in meses:
                soma=sum(_num((((rrec.get('departamentos') or {}).get(dep) or {}).get('mensal') or {}).get(str(m))) for rrec in rcas.values())
                alvo=_num(dep_mensal.get(str(m)))
                item[gm.MESES[m]]=soma
                item[f'Dif. {gm.MESES[m]}']=alvo-soma
                if abs(soma-alvo)>0.02: dep_ok=False
            item['Status']='✓ Fechado' if dep_ok else 'Ajustar'
            fechamento_ok=fechamento_ok and dep_ok
            rows.append(item)
        if rows: st.dataframe(pd.DataFrame(rows),use_container_width=True,hide_index=True)

        total=sum(_num(r.get('proposta')) for r in rcas.values())
        dif_total=meta_sup-total
        st.markdown(f"<div class='gm-ru-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído aos RCAs</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",unsafe_allow_html=True)

        tudo_ok=geral_rca_ok and meses_rca_ok and rcas_linhas_ok and geral_dep_ok and meses_dep_ok and deps_linhas_ok and fechamento_ok and abs(dif_total)<=0.02
        estado['ok'][sup]=tudo_ok
        if tudo_ok:
            st.success('Participações gerais e mensais fechadas em todos os níveis.')
        else:
            st.warning('Ajuste as participações: geral e meses precisam fechar 100%, e os totais mensais devem respeitar a % geral do ciclo.')

        return saida

    def button(label,*args,**kwargs):
        key=str(kwargs.get('key') or ''); ctx=_ctx(); sup=str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_rca_'):
            label='Usar participação de referência'
        elif key.startswith('gm2_save_rca_'):
            label='Salvar RCAs e avançar para Aprovação →'
            if sup and estado['ok'].get(sup) is False: kwargs['disabled']=True
        return button_prev(label,*args,**kwargs)

    st.data_editor=data_editor
    st.button=button
