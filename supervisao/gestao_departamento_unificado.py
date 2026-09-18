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


def _sincronizar_meses(rec, meses, pct_geral):
    pct = rec.setdefault('percentual_mensal', {})
    anterior = _num(rec.get('percentual_geral_anterior', pct_geral))
    for m in meses:
        k = str(m)
        if k not in pct or abs(_num(pct.get(k)) - anterior) <= 0.001:
            pct[k] = pct_geral
    rec['percentual_geral_anterior'] = pct_geral
    return pct


def aplicar_departamentos_unificados():
    st.markdown(
        """
        <style>
        .gm-du-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:6px 0 12px}.gm-du-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-du-panel-title{font-size:17px;font-weight:900;color:#1e2655}.gm-du-panel-sub{font-size:10px;color:#858b99;margin-top:3px}.gm-du-panel-meta{text-align:right}.gm-du-panel-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-du-panel-meta strong{font-size:18px;color:#1e2655}
        .gm-du-head{display:grid;grid-template-columns:1.9fr .8fr .95fr 1.08fr repeat(3,.72fr 1fr) .88fr;gap:9px;padding:0 12px 7px;align-items:end}.gm-du-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-du-head span:first-child{text-align:left}
        .gm-du-name{font-size:12px;font-weight:900;color:#1e2655}.gm-du-sub{font-size:8px;color:#8b91a0;margin-top:4px}.gm-du-val{text-align:center}.gm-du-val strong{font-size:10px;color:#30384d;display:block}.gm-du-val span{font-size:8px;color:#9096a4}
        .gm-du-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-du-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-du-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-du-summary,.gm-du-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}.gm-du-box,.gm-du-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-du-box span,.gm-du-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-box strong,.gm-du-total strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-du-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1200px){.gm-du-head{display:none}.gm-du-summary,.gm-du-total{grid-template-columns:1fr}.gm-du-panel-meta{text-align:left}}
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
        if not sup: return data_editor_prev(data,*args,**kwargs)
        srec=(cycle.get('supervisores') or {}).get(sup) or {}
        sup_mensal=srec.get('mensal') or {}
        meta_sup=sum(_num(sup_mensal.get(str(m))) for m in meses) or _num(srec.get('proposta'))
        deps=srec.setdefault('departamentos',{})

        outros_existente = OUTROS in deps
        incluir_outros=st.toggle('Incluir Outros',value=outros_existente,key=f'gm_du_outros_{key}_{sup}',help='Reserva parte da participação geral e mensal para departamentos sem meta formal.')
        saida=_filtrar_departamentos(data,deps,incluir_outros)

        st.markdown(f"<div class='gm-du-panel'><div class='gm-du-panel-top'><div><div class='gm-du-panel-title'>Participação dos departamentos</div><div class='gm-du-panel-sub'>A % geral define o peso do departamento no ciclo. Cada mês herda essa % e pode ser ajustado separadamente.</div></div><div class='gm-du-panel-meta'><span>Meta do supervisor no ciclo</span><strong>{_fmt(meta_sup)}</strong></div></div></div>",unsafe_allow_html=True)

        st.markdown("<div class='gm-du-head'><span>Departamento</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo</span>"+''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)+"<span>Status</span></div>",unsafe_allow_html=True)

        soma_geral=0.0
        pct_somas={str(m):0.0 for m in meses}
        linhas_ok=True

        for idx,row in saida.reset_index(drop=True).iterrows():
            dep=str(row.get('Departamento','Departamento')); rec=deps.setdefault(dep,{})
            part_ref=_num(row.get('Participação ref. %'))
            if 'percentual_geral' not in rec:
                valor_existente=_num(rec.get('proposta')) or _num(row.get('Meta proposta'))
                rec['percentual_geral']=(100*valor_existente/meta_sup) if (meta_sup and valor_existente>0) else part_ref

            with st.container(border=True):
                cols=st.columns([1.9,.8,.95,1.08]+sum(([.72,1] for _ in meses),[])+[.88],vertical_alignment='center',gap='small')
                with cols[0]:
                    sub='Opcional • sem meta formal' if dep==OUTROS else 'Departamento com meta'
                    st.markdown(f"<div class='gm-du-name'>{dep}</div><div class='gm-du-sub'>{sub}</div>",unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-du-val'><strong>{part_ref:.2f}%</strong><span>referência</span></div>",unsafe_allow_html=True)
                with cols[2]:
                    pct_geral=st.number_input(f'% geral • {dep}',min_value=0.0,max_value=100.0,value=_num(rec.get('percentual_geral')),step=0.1,format='%.2f',key=f'gm_du_geral_{key}_{idx}',label_visibility='collapsed')
                rec['percentual_geral']=float(pct_geral); soma_geral+=float(pct_geral)
                meta_alvo=meta_sup*float(pct_geral)/100.0
                with cols[3]:
                    st.markdown(f"<div class='gm-du-val'><strong>{_fmt(meta_alvo)}</strong><span>pela % geral</span></div>",unsafe_allow_html=True)

                pct=_sincronizar_meses(rec,meses,float(pct_geral))
                mensal=rec.setdefault('mensal',{})
                pos=4
                for m in meses:
                    with cols[pos]:
                        pm=st.number_input(f'{gm.MESES[m]} % • {dep}',min_value=0.0,max_value=100.0,value=_num(pct.get(str(m))),step=0.1,format='%.2f',key=f'gm_du_mes_{key}_{idx}_{m}',label_visibility='collapsed')
                    pct[str(m)]=float(pm); pct_somas[str(m)]+=float(pm)
                    valor=_num(sup_mensal.get(str(m)))*float(pm)/100.0
                    mensal[str(m)]=valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-du-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>",unsafe_allow_html=True)
                    pos+=2

                realizado=sum(_num(mensal.get(str(m))) for m in meses)
                rec['mensal']={str(m):_num(mensal.get(str(m))) for m in meses}
                rec['proposta']=realizado
                saida.loc[saida.index[idx],'Meta proposta']=realizado
                ok_linha=abs(realizado-meta_alvo)<=0.02
                linhas_ok=linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-du-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar ciclo'}</div>",unsafe_allow_html=True)

        total=float(pd.to_numeric(saida['Meta proposta'],errors='coerce').fillna(0).sum()); dif_total=meta_sup-total
        st.markdown(f"<div class='gm-du-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",unsafe_allow_html=True)

        cards=[]; meses_ok=True
        for m in meses:
            soma_pct=pct_somas[str(m)]; alvo=_num(sup_mensal.get(str(m)))
            ok=(abs(soma_pct-100)<=0.01) if alvo>0 else abs(soma_pct)<=0.01
            meses_ok=meses_ok and ok
            cards.append(f"<div class='gm-du-box'><span>{gm.MESES[m]}</span><strong>{soma_pct:.1f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        if cards: st.markdown("<div class='gm-du-summary'>"+''.join(cards)+"</div>",unsafe_allow_html=True)

        geral_ok=abs(soma_geral-100)<=0.01 if meta_sup>0 else True
        tudo_ok=geral_ok and meses_ok and linhas_ok and abs(dif_total)<=0.02
        estado['ok'][sup]=tudo_ok
        if tudo_ok: st.success('Participação geral e mensal dos departamentos fechada.')
        else: st.warning(f'Geral: {soma_geral:.2f}%. A soma geral deve fechar 100%, cada mês deve fechar 100% e o total mensal de cada departamento deve respeitar sua % geral.')
        return saida

    def button(label,*args,**kwargs):
        key=str(kwargs.get('key') or ''); ctx=_ctx(); sup=str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_dep_'): return False
        if key.startswith('gm2_save_dep_'):
            label='Salvar departamentos e avançar para RCAs →'
            if sup and estado['ok'].get(sup) is False: kwargs['disabled']=True
        return button_prev(label,*args,**kwargs)

    st.data_editor=data_editor
    st.button=button
