import inspect

import pandas as pd
import streamlit as st

import gestao_metas as gm


OUTROS = 'OUTROS'


def _num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _fmt(v):
    v = _num(v)
    return f"R$ {v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _round_money(v):
    v = _num(v)
    if v <= 0:
        return 0.0
    step = 1000.0 if v < 100000 else (5000.0 if v < 500000 else 10000.0)
    return round(v / step) * step


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


def _sync_months(rec, chave, meses, pct_geral):
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
        if 'meta_ciclo_alvo' not in rr:
            base = _num(row.get('Meta sugerida')) or _num(rr.get('proposta')) or _num(row.get('Meta proposta')) or (meta_sup * refs.get(cod,0.0) / 100.0)
            rr['meta_ciclo_alvo'] = _round_money(base)
            rr['percentual_geral'] = (100 * rr['meta_ciclo_alvo'] / meta_sup) if meta_sup else refs.get(cod,0.0)


def _init_dep_targets(rr, deps, srec, meses):
    meta_rca = _num(rr.get('meta_ciclo_alvo')) or _num(rr.get('proposta'))
    dep_store = rr.setdefault('departamentos', {})
    total_sem_outros = 0.0

    for dep in deps:
        if dep == OUTROS:
            continue
        rd = dep_store.setdefault(dep,{})
        if 'meta_ciclo_alvo' not in rd:
            sup_dep = (srec.get('departamentos') or {}).get(dep) or {}
            pct_base = _num(sup_dep.get('percentual_geral'))
            base = meta_rca * pct_base / 100.0
            rd['meta_ciclo_alvo'] = _round_money(base)
            rd['percentual_geral'] = (100 * rd['meta_ciclo_alvo'] / meta_rca) if meta_rca else pct_base
        total_sem_outros += _num(rd.get('meta_ciclo_alvo'))

    if OUTROS in deps:
        rd = dep_store.setdefault(OUTROS,{})
        if 'meta_ciclo_alvo' not in rd:
            rd['meta_ciclo_alvo'] = max(0.0, round(meta_rca-total_sem_outros,2))
            rd['percentual_geral'] = (100 * rd['meta_ciclo_alvo'] / meta_rca) if meta_rca else 0.0


def aplicar_rcas_unificados():
    st.markdown(
        """
        <style>
        .gm-ru-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:8px 0 12px}.gm-ru-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-ru-title{font-size:17px;font-weight:900;color:#1e2655}.gm-ru-sub{font-size:10px;color:#858b99;margin-top:3px}.gm-ru-meta{text-align:right}.gm-ru-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-ru-meta strong{font-size:18px;color:#1e2655}
        .gm-ru-head{display:grid;grid-template-columns:1.75fr .68fr .78fr .98fr repeat(3,.62fr .86fr) .78fr;gap:8px;padding:0 10px 7px;align-items:end}.gm-ru-head span,.gm-ru-dep-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-ru-head span:first-child,.gm-ru-dep-head span:first-child{text-align:left}
        .gm-ru-name{font-size:12px;font-weight:900;color:#1e2655}.gm-ru-subline{font-size:8px;color:#8b91a0;margin-top:4px}.gm-ru-val{text-align:center}.gm-ru-val strong{font-size:10px;color:#30384d;display:block}.gm-ru-val span{font-size:8px;color:#9096a4}
        .gm-ru-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-ru-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-ru-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-ru-detail{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:14px 16px;margin:14px 0 10px}.gm-ru-detail-title{font-size:14px;font-weight:900;color:#1e2655}.gm-ru-detail-sub{font-size:10px;color:#818897;margin-top:2px}
        .gm-ru-dep-head{display:grid;grid-template-columns:1.75fr .78fr .98fr repeat(3,.62fr .86fr) .78fr;gap:8px;padding:0 10px 7px;align-items:end}
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

        st.markdown(f"<div class='gm-ru-panel'><div class='gm-ru-panel-top'><div><div class='gm-ru-title'>Participação dos RCAs</div><div class='gm-ru-sub'>As sugestões já vêm arredondadas. Edite a % geral ou a meta do ciclo; os meses podem ser ajustados depois.</div></div><div class='gm-ru-meta'><span>Meta do supervisor no ciclo</span><strong>{_fmt(meta_sup)}</strong></div></div></div>", unsafe_allow_html=True)

        st.markdown(
            "<div class='gm-ru-head'><span>RCA</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        refs = _participacoes(saida)
        soma_geral = 0.0
        soma_meta = 0.0
        soma_mes_pct = {str(m):0.0 for m in meses}
        rcas_linhas_ok = True

        for idx,row in saida.reset_index(drop=True).iterrows():
            cod=str(int(row['COD_RCA'])); nome=str(row.get('RCA','RCA')); rr=rcas[cod]
            ref=refs.get(cod,_num(row.get('Participação ref. %')))

            pct_key=f'gm_ru_geral_v2_{key}_{idx}'
            val_key=f'gm_ru_val_v2_{key}_{idx}'

            def on_pct_change(rr=rr,pct_key=pct_key,val_key=val_key,meta_sup=meta_sup):
                pct=_num(st.session_state.get(pct_key))
                rr['percentual_geral']=pct
                rr['meta_ciclo_alvo']=round(meta_sup*pct/100.0,2)
                st.session_state[val_key]=rr['meta_ciclo_alvo']

            def on_val_change(rr=rr,pct_key=pct_key,val_key=val_key,meta_sup=meta_sup):
                val=_num(st.session_state.get(val_key))
                rr['meta_ciclo_alvo']=val
                rr['percentual_geral']=(100*val/meta_sup) if meta_sup else 0.0
                st.session_state[pct_key]=rr['percentual_geral']

            with st.container(border=True):
                cols=st.columns([1.75,.68,.78,.98]+sum(([.62,.86] for _ in meses),[])+[.78],vertical_alignment='center',gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-name'>{nome}</div><div class='gm-ru-subline'>Código {cod}</div>",unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-ru-val'><strong>{ref:.2f}%</strong><span>referência</span></div>",unsafe_allow_html=True)
                with cols[2]:
                    pct_geral=st.number_input(f'% geral • {nome}',min_value=0.0,max_value=100.0,value=_num(rr.get('percentual_geral')),step=0.01,format='%.2f',key=pct_key,on_change=on_pct_change,label_visibility='collapsed')
                with cols[3]:
                    meta_rca=st.number_input(f'Meta ciclo • {nome}',min_value=0.0,value=_num(rr.get('meta_ciclo_alvo')),step=1000.0,format='%.2f',key=val_key,on_change=on_val_change,label_visibility='collapsed')

                rr['percentual_geral']=_num(pct_geral); rr['meta_ciclo_alvo']=_num(meta_rca)
                soma_geral+=rr['percentual_geral']; soma_meta+=rr['meta_ciclo_alvo']

                pct_mensal=_sync_months(rr,'percentual_mensal',meses,rr['percentual_geral'])
                mensal=rr.setdefault('mensal_alvo',{})
                pos=4
                for m in meses:
                    with cols[pos]:
                        pm=st.number_input(f'{gm.MESES[m]} % • {nome}',min_value=0.0,max_value=100.0,value=_num(pct_mensal.get(str(m))),step=0.01,format='%.2f',key=f'gm_ru_mes_v2_{key}_{idx}_{m}',label_visibility='collapsed')
                    pct_mensal[str(m)]=float(pm); soma_mes_pct[str(m)]+=float(pm)
                    valor=round(_num(sup_mensal.get(str(m)))*float(pm)/100.0,2)
                    mensal[str(m)]=valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-ru-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>",unsafe_allow_html=True)
                    pos+=2

                realizado=round(sum(_num(mensal.get(str(m))) for m in meses),2)
                rr['mensal_alvo']={str(m):round(_num(mensal.get(str(m))),2) for m in meses}
                rr['mensal']=dict(rr['mensal_alvo'])
                rr['proposta']=realizado
                saida.loc[saida.index[idx],'Meta proposta']=realizado

                ok_linha=abs(realizado-rr['meta_ciclo_alvo'])<=0.02
                rcas_linhas_ok=rcas_linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar meses'}</div>",unsafe_allow_html=True)

        geral_rca_ok=abs(soma_geral-100)<=0.01 if meta_sup>0 else True
        valor_rca_ok=abs(soma_meta-meta_sup)<=0.02 if meta_sup>0 else True
        meses_rca_ok=True
        cards=[]
        for m in meses:
            ok=abs(soma_mes_pct[str(m)]-100)<=0.01 if _num(sup_mensal.get(str(m)))>0 else True
            meses_rca_ok=meses_rca_ok and ok
            cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]} • RCAs</span><strong>{soma_mes_pct[str(m)]:.2f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        st.markdown("<div class='gm-ru-summary'>"+''.join(cards)+"</div>",unsafe_allow_html=True)

        st.markdown("<div class='gm-ru-detail'><div class='gm-ru-detail-title'>Departamentos dentro do RCA</div><div class='gm-ru-detail-sub'>Também aqui % geral e valor do ciclo ficam editáveis. As sugestões de valor já entram arredondadas.</div></div>",unsafe_allow_html=True)

        opcoes=[f"{int(r['COD_RCA'])} - {r['RCA']}" for _,r in saida.iterrows()]
        escolha=st.selectbox('RCA para distribuir departamentos',opcoes,key=f'gm_ru_detail_rca_{key}_{sup}')
        cod_sel=escolha.split(' - ',1)[0]
        rr=rcas[cod_sel]
        _init_dep_targets(rr,deps,srec,meses)
        meta_rca=_num(rr.get('meta_ciclo_alvo')) or _num(rr.get('proposta'))

        st.markdown(
            "<div class='gm-ru-dep-head'><span>Departamento</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_dep_geral=0.0; soma_dep_meta=0.0
        soma_dep_mes={str(m):0.0 for m in meses}
        deps_linhas_ok=True

        for dep_idx,dep in enumerate(deps):
            rd=rr.setdefault('departamentos',{}).setdefault(dep,{})

            pct_key=f'gm_ru_depgeral_v2_{key}_{cod_sel}_{dep_idx}'
            val_key=f'gm_ru_depval_v2_{key}_{cod_sel}_{dep_idx}'

            def on_dep_pct(rd=rd,pct_key=pct_key,val_key=val_key,meta_rca=meta_rca):
                pct=_num(st.session_state.get(pct_key))
                rd['percentual_geral']=pct
                rd['meta_ciclo_alvo']=round(meta_rca*pct/100.0,2)
                st.session_state[val_key]=rd['meta_ciclo_alvo']

            def on_dep_val(rd=rd,pct_key=pct_key,val_key=val_key,meta_rca=meta_rca):
                val=_num(st.session_state.get(val_key))
                rd['meta_ciclo_alvo']=val
                rd['percentual_geral']=(100*val/meta_rca) if meta_rca else 0.0
                st.session_state[pct_key]=rd['percentual_geral']

            with st.container(border=True):
                cols=st.columns([1.75,.78,.98]+sum(([.62,.86] for _ in meses),[])+[.78],vertical_alignment='center',gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-name'>{dep}</div><div class='gm-ru-subline'>Composição da meta do RCA</div>",unsafe_allow_html=True)
                with cols[1]:
                    pct_geral_dep=st.number_input(f'% geral • {dep}',min_value=0.0,max_value=100.0,value=_num(rd.get('percentual_geral')),step=0.01,format='%.2f',key=pct_key,on_change=on_dep_pct,label_visibility='collapsed')
                with cols[2]:
                    meta_dep=st.number_input(f'Meta ciclo • {dep}',min_value=0.0,value=_num(rd.get('meta_ciclo_alvo')),step=1000.0,format='%.2f',key=val_key,on_change=on_dep_val,label_visibility='collapsed')

                rd['percentual_geral']=_num(pct_geral_dep); rd['meta_ciclo_alvo']=_num(meta_dep)
                soma_dep_geral+=rd['percentual_geral']; soma_dep_meta+=rd['meta_ciclo_alvo']

                pct_dep=_sync_months(rd,'percentual_mensal',meses,rd['percentual_geral'])
                mensal_dep=rd.setdefault('mensal',{})
                pos=3
                for m in meses:
                    base=_num((rr.get('mensal_alvo') or {}).get(str(m)))
                    with cols[pos]:
                        pm=st.number_input(f'{gm.MESES[m]} % • {dep}',min_value=0.0,max_value=100.0,value=_num(pct_dep.get(str(m))),step=0.01,format='%.2f',key=f'gm_ru_depmes_v2_{key}_{cod_sel}_{dep_idx}_{m}',label_visibility='collapsed')
                    pct_dep[str(m)]=float(pm); soma_dep_mes[str(m)]+=float(pm)
                    valor=round(base*float(pm)/100.0,2)
                    mensal_dep[str(m)]=valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-ru-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>",unsafe_allow_html=True)
                    pos+=2

                realizado_dep=round(sum(_num(mensal_dep.get(str(m))) for m in meses),2)
                rd['mensal']={str(m):round(_num(mensal_dep.get(str(m))),2) for m in meses}
                rd['proposta']=realizado_dep
                ok_dep=abs(realizado_dep-rd['meta_ciclo_alvo'])<=0.02
                deps_linhas_ok=deps_linhas_ok and ok_dep
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok_dep else 'warn'}'>{'✓ Fechado' if ok_dep else 'Ajustar meses'}</div>",unsafe_allow_html=True)

        geral_dep_ok=abs(soma_dep_geral-100)<=0.01 if meta_rca>0 else True
        valor_dep_ok=abs(soma_dep_meta-meta_rca)<=0.02 if meta_rca>0 else True
        meses_dep_ok=True
        dep_cards=[]
        for m in meses:
            alvo_mes=_num((rr.get('mensal_alvo') or {}).get(str(m)))
            ok=abs(soma_dep_mes[str(m)]-100)<=0.01 if alvo_mes>0 else True
            meses_dep_ok=meses_dep_ok and ok
            dep_cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]} • departamentos</span><strong>{soma_dep_mes[str(m)]:.2f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
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
                if abs(soma-alvo)>0.02:
                    dep_ok=False
            item['Status']='✓ Fechado' if dep_ok else 'Ajustar'
            fechamento_ok=fechamento_ok and dep_ok
            rows.append(item)
        if rows:
            st.dataframe(pd.DataFrame(rows),use_container_width=True,hide_index=True)

        total=sum(_num(r.get('proposta')) for r in rcas.values())
        dif_total=meta_sup-total
        st.markdown(f"<div class='gm-ru-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído aos RCAs</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",unsafe_allow_html=True)

        tudo_ok=geral_rca_ok and valor_rca_ok and meses_rca_ok and rcas_linhas_ok and geral_dep_ok and valor_dep_ok and meses_dep_ok and deps_linhas_ok and fechamento_ok and abs(dif_total)<=0.02
        estado['ok'][sup]=tudo_ok
        if tudo_ok:
            st.success('Participações, valores arredondados e meses fechados em todos os níveis.')
        else:
            st.warning('Ajuste %/valor e os meses. O ciclo e cada mês precisam fechar nos RCAs e nos departamentos.')

        return saida

    def button(label,*args,**kwargs):
        key=str(kwargs.get('key') or ''); ctx=_ctx(); sup=str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_rca_'):
            label='Usar participação de referência'
        elif key.startswith('gm2_save_rca_'):
            label='Salvar RCAs e avançar para Aprovação →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled']=True
        return button_prev(label,*args,**kwargs)

    st.data_editor=data_editor
    st.button=button
