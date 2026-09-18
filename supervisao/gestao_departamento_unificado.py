import inspect
import unicodedata

import pandas as pd
import streamlit as st

import gestao_metas as gm


DEPARTAMENTOS_META = ['AGRICULTURA','SAUDE ANIMAL','NUTRICAO - RUMINANTES','NUTRICAO - MONOGASTRICOS','MIX REVENDA','ORDENHA']
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


def _normalizar(txt):
    s = str(txt or '').strip().upper()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    return ' '.join(s.replace('–', '-').replace('—', '-').split())


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


def _linha_vazia(nome):
    return {'Departamento':nome,'Hist. recente':0.0,'Hist. A-1':0.0,'Participação ref. %':0.0,'Meta sugerida':0.0,'Meta proposta':0.0}


def _filtrar_departamentos(data, deps, incluir_outros):
    base = data.copy()
    base['_norm'] = base['Departamento'].map(_normalizar)
    linhas, usados = [], set()
    validos_norm = {_normalizar(x) for x in DEPARTAMENTOS_META + [OUTROS]}

    for nome in DEPARTAMENTOS_META:
        encontrados = base[base['_norm'].eq(_normalizar(nome))]
        if encontrados.empty:
            row = _linha_vazia(nome)
        else:
            r = encontrados.iloc[0]
            row = {c:r.get(c,0) for c in data.columns}
            row['Departamento'] = nome
            usados.update(encontrados.index.tolist())
        deps.setdefault(nome,{})
        linhas.append(row)

    acumulado_mensal = {}
    for nome in list(deps.keys()):
        if _normalizar(nome) not in validos_norm:
            rec = deps.get(nome) or {}
            for mk,mv in (rec.get('mensal') or {}).items():
                acumulado_mensal[str(mk)] = acumulado_mensal.get(str(mk),0.0)+_num(mv)
            deps.pop(nome,None)

    if incluir_outros:
        row = _linha_vazia(OUTROS)
        rec = deps.setdefault(OUTROS,{})
        if not rec.get('mensal') and acumulado_mensal:
            rec['mensal'] = acumulado_mensal
        linhas.append(row)
    else:
        deps.pop(OUTROS,None)

    saida = pd.DataFrame(linhas)
    for col in data.columns:
        if col not in saida.columns:
            saida[col] = 0.0
    return saida[data.columns]


def _sync_months(rec, meses, pct_geral):
    pct = rec.setdefault('percentual_mensal', {})
    anterior = _num(rec.get('percentual_geral_anterior', pct_geral))
    for m in meses:
        k = str(m)
        if k not in pct or abs(_num(pct.get(k)) - anterior) <= 0.001:
            pct[k] = pct_geral
    rec['percentual_geral_anterior'] = pct_geral
    return pct


def _corrigir_centavos_outros(saida, deps, meses, sup_mensal):
    nomes = [str(x) for x in saida['Departamento'].tolist()]
    if OUTROS not in nomes or OUTROS not in deps:
        return

    outros = deps[OUTROS]
    mensal_outros = outros.setdefault('mensal', {})
    for m in meses:
        alvo = round(_num(sup_mensal.get(str(m))), 2)
        soma_sem = round(sum(
            round(_num((deps.get(dep, {}).get('mensal') or {}).get(str(m))), 2)
            for dep in nomes if dep != OUTROS
        ), 2)
        mensal_outros[str(m)] = round(alvo - soma_sem, 2)
    outros['proposta'] = round(sum(mensal_outros.values()), 2)


def aplicar_departamentos_unificados():
    st.markdown(
        """
        <style>
        .gm-du-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:6px 0 12px}.gm-du-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-du-panel-title{font-size:17px;font-weight:900;color:#1e2655}.gm-du-panel-sub{font-size:10px;color:#858b99;margin-top:3px}.gm-du-panel-meta{text-align:right}.gm-du-panel-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-du-panel-meta strong{font-size:18px;color:#1e2655}
        .gm-du-head{display:grid;grid-template-columns:1.8fr .72fr .82fr 1.02fr repeat(3,.65fr .9fr) .8fr;gap:8px;padding:0 11px 7px;align-items:end}.gm-du-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-du-head span:first-child{text-align:left}
        .gm-du-name{font-size:12px;font-weight:900;color:#1e2655}.gm-du-sub{font-size:8px;color:#8b91a0;margin-top:4px}.gm-du-val{text-align:center}.gm-du-val strong{font-size:10px;color:#30384d;display:block}.gm-du-val span{font-size:8px;color:#9096a4}
        .gm-du-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-du-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-du-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-du-summary,.gm-du-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}.gm-du-box,.gm-du-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-du-box span,.gm-du-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-box strong,.gm-du-total strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-du-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1250px){.gm-du-head{display:none}.gm-du-summary,.gm-du-total{grid-template-columns:1fr}.gm-du-panel-meta{text-align:left}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_prev = st.data_editor
    button_prev = st.button
    estado={'ok':{}}

    def data_editor(data=None,*args,**kwargs):
        key=str(kwargs.get('key') or '')
        if not key.startswith('gm2_dep_edit_') or not isinstance(data,pd.DataFrame):
            return data_editor_prev(data,*args,**kwargs)
        if data.empty or 'Departamento' not in data.columns or 'Meta proposta' not in data.columns:
            return data_editor_prev(data,*args,**kwargs)

        ctx=_ctx(); cycle=ctx.get('cycle') or {}; meses=ctx.get('meses') or []; sup=str(ctx.get('sup') or '')
        if not sup:
            return data_editor_prev(data,*args,**kwargs)

        srec=(cycle.get('supervisores') or {}).get(sup) or {}
        sup_mensal=srec.get('mensal') or {}
        meta_sup=sum(_num(sup_mensal.get(str(m))) for m in meses) or _num(srec.get('proposta'))
        deps=srec.setdefault('departamentos',{})

        outros_existente = OUTROS in deps
        incluir_outros=st.toggle('Incluir Outros',value=outros_existente,key=f'gm_du_outros_{key}_{sup}',help='Reserva parte da meta para departamentos sem meta formal.')
        saida=_filtrar_departamentos(data,deps,incluir_outros)

        # Sugestão inicial arredondada. Quando OUTROS existe, ele recebe o saldo para fechar a meta do ciclo.
        soma_inicial = 0.0
        for _, row_init in saida.reset_index(drop=True).iterrows():
            dep_init=str(row_init.get('Departamento',''))
            if dep_init == OUTROS:
                continue
            rec_init=deps.setdefault(dep_init,{})
            if 'meta_ciclo_alvo' not in rec_init:
                base=_num(row_init.get('Meta sugerida')) or _num(rec_init.get('proposta')) or _num(row_init.get('Meta proposta')) or (meta_sup*_num(row_init.get('Participação ref. %'))/100.0)
                rec_init['meta_ciclo_alvo']=_round_money(base)
                rec_init['percentual_geral']=(100*rec_init['meta_ciclo_alvo']/meta_sup) if meta_sup else 0.0
            soma_inicial += _num(rec_init.get('meta_ciclo_alvo'))

        if incluir_outros:
            rec_out=deps.setdefault(OUTROS,{})
            if 'meta_ciclo_alvo' not in rec_out:
                rec_out['meta_ciclo_alvo']=max(0.0, round(meta_sup-soma_inicial,2))
                rec_out['percentual_geral']=(100*rec_out['meta_ciclo_alvo']/meta_sup) if meta_sup else 0.0

        st.markdown(f"<div class='gm-du-panel'><div class='gm-du-panel-top'><div><div class='gm-du-panel-title'>Participação dos departamentos</div><div class='gm-du-panel-sub'>A sugestão já vem em valores fechados. Edite a % geral ou a meta do ciclo; os meses herdam a participação e podem ser ajustados.</div></div><div class='gm-du-panel-meta'><span>Meta do supervisor no ciclo</span><strong>{_fmt(meta_sup)}</strong></div></div></div>",unsafe_allow_html=True)

        st.markdown("<div class='gm-du-head'><span>Departamento</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo R$</span>"+''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)+"<span>Status</span></div>",unsafe_allow_html=True)

        soma_geral=0.0; soma_meta=0.0
        pct_somas={str(m):0.0 for m in meses}
        linhas_ok=True

        for idx,row in saida.reset_index(drop=True).iterrows():
            dep=str(row.get('Departamento','Departamento')); rec=deps.setdefault(dep,{})
            part_ref=_num(row.get('Participação ref. %'))

            pct_key=f'gm_du_geral_v3_{key}_{idx}'
            val_key=f'gm_du_val_v3_{key}_{idx}'

            def on_pct_change(rec=rec,pct_key=pct_key,val_key=val_key,meta_sup=meta_sup):
                pct=_num(st.session_state.get(pct_key))
                rec['percentual_geral']=pct
                rec['meta_ciclo_alvo']=round(meta_sup*pct/100.0,2)
                st.session_state[val_key]=rec['meta_ciclo_alvo']

            def on_val_change(rec=rec,pct_key=pct_key,val_key=val_key,meta_sup=meta_sup):
                val=_num(st.session_state.get(val_key))
                rec['meta_ciclo_alvo']=val
                rec['percentual_geral']=(100*val/meta_sup) if meta_sup else 0.0
                st.session_state[pct_key]=rec['percentual_geral']

            with st.container(border=True):
                cols=st.columns([1.8,.72,.82,1.02]+sum(([.65,.9] for _ in meses),[])+[.8],vertical_alignment='center',gap='small')
                with cols[0]:
                    sub='Opcional • saldo de departamentos sem meta formal' if dep==OUTROS else 'Departamento com meta'
                    st.markdown(f"<div class='gm-du-name'>{dep}</div><div class='gm-du-sub'>{sub}</div>",unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-du-val'><strong>{part_ref:.2f}%</strong><span>referência</span></div>",unsafe_allow_html=True)
                with cols[2]:
                    pct_geral=st.number_input(f'% geral • {dep}',min_value=0.0,max_value=100.0,value=_num(rec.get('percentual_geral')),step=0.01,format='%.2f',key=pct_key,on_change=on_pct_change,label_visibility='collapsed')
                with cols[3]:
                    meta_alvo=st.number_input(f'Meta ciclo • {dep}',min_value=0.0,value=_num(rec.get('meta_ciclo_alvo')),step=1000.0,format='%.2f',key=val_key,on_change=on_val_change,label_visibility='collapsed')

                rec['percentual_geral']=_num(pct_geral); rec['meta_ciclo_alvo']=_num(meta_alvo)
                soma_geral+=rec['percentual_geral']; soma_meta+=rec['meta_ciclo_alvo']

                pct=_sync_months(rec,meses,rec['percentual_geral'])
                mensal=rec.setdefault('mensal',{})
                pos=4
                for m in meses:
                    with cols[pos]:
                        pm=st.number_input(f'{gm.MESES[m]} % • {dep}',min_value=0.0,max_value=100.0,value=_num(pct.get(str(m))),step=0.01,format='%.2f',key=f'gm_du_mes_v3_{key}_{idx}_{m}',label_visibility='collapsed')
                    pct[str(m)]=float(pm); pct_somas[str(m)]+=float(pm)
                    valor=round(_num(sup_mensal.get(str(m)))*float(pm)/100.0,2)
                    mensal[str(m)]=valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-du-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>",unsafe_allow_html=True)
                    pos+=2

                realizado=round(sum(_num(mensal.get(str(m))) for m in meses),2)
                rec['mensal']={str(m):round(_num(mensal.get(str(m))),2) for m in meses}
                rec['proposta']=realizado
                saida.loc[saida.index[idx],'Meta proposta']=realizado

                ok_linha=abs(realizado-rec['meta_ciclo_alvo'])<=0.02
                linhas_ok=linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-du-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar meses'}</div>",unsafe_allow_html=True)

        _corrigir_centavos_outros(saida,deps,meses,sup_mensal)
        if incluir_outros and OUTROS in deps:
            mask=saida['Departamento'].astype(str).eq(OUTROS)
            saida.loc[mask,'Meta proposta']=_num(deps[OUTROS].get('proposta'))

        total=round(pd.to_numeric(saida['Meta proposta'],errors='coerce').fillna(0).sum(),2)
        dif_total=round(meta_sup-total,2)
        st.markdown(f"<div class='gm-du-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",unsafe_allow_html=True)

        cards=[]; meses_ok=True
        for m in meses:
            soma_pct=pct_somas[str(m)]; alvo=round(_num(sup_mensal.get(str(m))),2)
            soma_valor=round(sum(_num((deps.get(str(r['Departamento']),{}).get('mensal') or {}).get(str(m))) for _,r in saida.iterrows()),2)
            dif_mes=round(alvo-soma_valor,2)
            ok=(abs(soma_pct-100)<=0.01 if alvo>0 else abs(soma_pct)<=0.01) and abs(dif_mes)<=0.01
            meses_ok=meses_ok and ok
            cards.append(f"<div class='gm-du-box'><span>{gm.MESES[m]}</span><strong>{soma_pct:.2f}%</strong><small>{_fmt(soma_valor)} de {_fmt(alvo)} • {'Fechado' if ok else 'Dif. '+_fmt(dif_mes)}</small></div>")
        if cards:
            st.markdown("<div class='gm-du-summary'>"+''.join(cards)+"</div>",unsafe_allow_html=True)

        geral_ok=abs(soma_geral-100)<=0.01 if meta_sup>0 else True
        valor_ok=abs(soma_meta-meta_sup)<=0.02 if meta_sup>0 else True
        tudo_ok=geral_ok and valor_ok and meses_ok and linhas_ok and abs(dif_total)<=0.01
        estado['ok'][sup]=tudo_ok
        if tudo_ok:
            st.success('Participação geral, metas arredondadas e meses fechados.')
        else:
            st.warning(f'Geral: {soma_geral:.2f}% • Metas: {_fmt(soma_meta)} de {_fmt(meta_sup)}. Ajuste %/valor e os meses até fechar.')
        return saida

    def button(label,*args,**kwargs):
        key=str(kwargs.get('key') or ''); ctx=_ctx(); sup=str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_dep_'):
            return False
        if key.startswith('gm2_save_dep_'):
            label='Salvar departamentos e avançar para RCAs →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled']=True
        return button_prev(label,*args,**kwargs)

    st.data_editor=data_editor
    st.button=button
