import inspect

import pandas as pd
import streamlit as st

import gestao_metas as gm


def _num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


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


def _fmt(v):
    v = _num(v)
    return f"R$ {v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _distribuir(total, meses, pesos):
    total = _num(total)
    vals = [_num(pesos.get(str(m), pesos.get(m, 0))) for m in meses]
    soma = sum(vals)
    if not meses:
        return {}
    if soma <= 0:
        return {str(m): total / len(meses) for m in meses}
    return {str(m): total * vals[i] / soma for i, m in enumerate(meses)}


def _ensure_mensal(rec, meses, total, pesos):
    mensal = rec.setdefault('mensal', {})
    existentes = [_num(mensal.get(str(m))) for m in meses]
    if not any(abs(v) > 0.0001 for v in existentes):
        mensal.update(_distribuir(total, meses, pesos))
    return mensal


def _status_mensal(cycle, meses):
    meta_mensal = cycle.get('meta_mensal') or {}
    sups = cycle.get('supervisores') or {}
    linhas = []
    tudo_ok = bool(meses) and bool(sups)
    for m in meses:
        alvo = _num(meta_mensal.get(str(m)))
        soma_sup = 0.0
        deps_ok = bool(sups)
        rcas_ok = bool(sups)
        for srec in sups.values():
            sm = _num((srec.get('mensal') or {}).get(str(m)))
            soma_sup += sm
            deps = srec.get('departamentos') or {}
            dsum = sum(_num((d.get('mensal') or {}).get(str(m))) for d in deps.values())
            if not deps or abs(dsum - sm) > 0.02:
                deps_ok = False
            rcas = srec.get('rcas') or {}
            rsum = sum(_num((r.get('mensal') or {}).get(str(m))) for r in rcas.values())
            if not rcas or abs(rsum - sm) > 0.02:
                rcas_ok = False
        sup_ok = bool(sups) and abs(soma_sup - alvo) <= 0.02
        fechado = sup_ok and deps_ok and rcas_ok
        tudo_ok = tudo_ok and fechado
        linhas.append({
            'Mês': gm.MESES.get(m, str(m)),
            'Meta empresa': alvo,
            'Supervisores': '✓ Fechado' if sup_ok else 'Pendente',
            'Departamentos': '✓ Fechado' if deps_ok else 'Pendente',
            'RCAs': '✓ Fechado' if rcas_ok else 'Pendente',
            'Fechado': fechado,
        })
    return linhas, tudo_ok


def _render_cabecalho_mensal(titulo, subtitulo):
    st.markdown(
        f"""
        <div class='gm-mi-head'>
          <div><strong>{titulo}</strong><span>{subtitulo}</span></div>
          <span class='gm-mi-badge'>mês a mês</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


def aplicar_mensal_integrado():
    """Acrescenta fechamento mensal ao fluxo visual atual sem substituir o render principal."""
    st.markdown(
        """
        <style>
        .gm-mi-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 8px}
        .gm-mi-head strong{display:block;font-size:14px;color:#1e2655}.gm-mi-head span{display:block;font-size:10px;color:#858b99;margin-top:2px}
        .gm-mi-badge{background:#eef1fb!important;color:#27316d!important;border-radius:999px;padding:5px 9px;font-size:9px!important;font-weight:850;text-transform:uppercase;letter-spacing:.05em}
        .gm-mi-ok{border:1px solid #d8eadf;background:#f7fbf8;border-radius:12px;padding:9px 12px;margin:8px 0;color:#356b46;font-size:11px;font-weight:700}
        .gm-mi-warn{border:1px solid #eadfc4;background:#fffaf3;border-radius:12px;padding:9px 12px;margin:8px 0;color:#816422;font-size:11px;font-weight:700}
        .gm-mi-months{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 12px}.gm-mi-month{border:1px solid #e5e8ef;background:#fff;border-radius:12px;padding:10px 12px}.gm-mi-month span{font-size:9px;color:#8a90a0;text-transform:uppercase;font-weight:800}.gm-mi-month strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-mi-month small{font-size:9px;color:#8a90a0}
        @media(max-width:850px){.gm-mi-months{grid-template-columns:1fr}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_prev = st.data_editor
    button_prev = st.button
    markdown_prev = st.markdown
    estado = {'save_ok': {}, 'approval_ok': True, 'approval_rendered': False}

    def _sup_mensal(out, key):
        ctx = _ctx(); cycle = ctx.get('cycle') or {}; meses = ctx.get('meses') or []
        if not meses or not isinstance(out, pd.DataFrame) or out.empty:
            return
        meta_mensal = cycle.get('meta_mensal') or {}
        sups = cycle.setdefault('supervisores', {})
        with st.expander('Planejamento mês a mês dos supervisores', expanded=False):
            _render_cabecalho_mensal('Distribuição mensal', 'O total de cada supervisor deve fechar também em cada mês do ciclo.')
            rows = []
            for _, row in out.iterrows():
                nome = str(row['Supervisor']); total = _num(row['Meta definida'])
                rec = sups.setdefault(nome, {})
                mensal = _ensure_mensal(rec, meses, total, meta_mensal)
                item = {'Supervisor': nome}
                for m in meses: item[gm.MESES[m]] = _num(mensal.get(str(m)))
                item['Total'] = sum(item[gm.MESES[m]] for m in meses)
                rows.append(item)
            df = pd.DataFrame(rows)
            edit = data_editor_prev(
                df, use_container_width=True, hide_index=True,
                disabled=['Supervisor', 'Total'],
                column_config={**{gm.MESES[m]: st.column_config.NumberColumn(format='R$ %.2f', step=10000.0) for m in meses}, 'Total': st.column_config.NumberColumn(format='R$ %.2f')},
                key=f'gm_month_sup_{key}'
            )
            row_ok = True
            for _, r in edit.iterrows():
                nome = str(r['Supervisor']); rec = sups.setdefault(nome, {})
                rec['mensal'] = {str(m): _num(r[gm.MESES[m]]) for m in meses}
                alvo = _num(out.loc[out['Supervisor'].astype(str).eq(nome), 'Meta definida'].iloc[0])
                if abs(sum(rec['mensal'].values()) - alvo) > 0.02: row_ok = False
            month_ok = True
            cards = []
            for m in meses:
                soma = sum(_num((sups.get(str(r['Supervisor']), {}).get('mensal') or {}).get(str(m))) for _, r in out.iterrows())
                alvo = _num(meta_mensal.get(str(m)))
                ok = abs(soma - alvo) <= 0.02
                month_ok = month_ok and ok
                cards.append(f"<div class='gm-mi-month'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)}</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar'}</small></div>")
            st.markdown("<div class='gm-mi-months'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)
            ok = row_ok and month_ok
            st.markdown("<div class='gm-mi-ok'>✓ Totais e meses fechados.</div>" if ok else "<div class='gm-mi-warn'>Ajuste a distribuição mensal antes de salvar os supervisores.</div>", unsafe_allow_html=True)
            estado['save_ok']['sup'] = ok

    def _dep_mensal(out, key):
        ctx = _ctx(); cycle = ctx.get('cycle') or {}; meses = ctx.get('meses') or []; sup = ctx.get('sup')
        if not sup or not meses or not isinstance(out, pd.DataFrame) or out.empty:
            return
        srec = (cycle.get('supervisores') or {}).get(str(sup)) or {}
        sup_mensal = srec.get('mensal') or _distribuir(_num(srec.get('proposta')), meses, cycle.get('meta_mensal') or {})
        deps = srec.setdefault('departamentos', {})
        with st.expander('Planejamento mês a mês dos departamentos', expanded=False):
            _render_cabecalho_mensal('Departamentos por mês', f'Cada coluna deve fechar a meta mensal de {sup}.')
            rows=[]
            for _, row in out.iterrows():
                nome=str(row['Departamento']); total=_num(row['Meta proposta']); rec=deps.setdefault(nome,{})
                mensal=_ensure_mensal(rec, meses, total, sup_mensal)
                item={'Departamento':nome}
                for m in meses: item[gm.MESES[m]]=_num(mensal.get(str(m)))
                item['Total']=sum(item[gm.MESES[m]] for m in meses); rows.append(item)
            df=pd.DataFrame(rows)
            edit=data_editor_prev(df,use_container_width=True,hide_index=True,disabled=['Departamento','Total'],column_config={**{gm.MESES[m]:st.column_config.NumberColumn(format='R$ %.2f',step=10000.0) for m in meses},'Total':st.column_config.NumberColumn(format='R$ %.2f')},key=f'gm_month_dep_{key}')
            row_ok=True
            for _,r in edit.iterrows():
                nome=str(r['Departamento']); rec=deps.setdefault(nome,{})
                rec['mensal']={str(m):_num(r[gm.MESES[m]]) for m in meses}
                alvo=_num(out.loc[out['Departamento'].astype(str).eq(nome),'Meta proposta'].iloc[0])
                if abs(sum(rec['mensal'].values())-alvo)>0.02: row_ok=False
            month_ok=True
            for m in meses:
                soma=sum(_num((d.get('mensal') or {}).get(str(m))) for d in deps.values()); alvo=_num(sup_mensal.get(str(m)))
                month_ok=month_ok and abs(soma-alvo)<=0.02
            ok=row_ok and month_ok
            st.markdown("<div class='gm-mi-ok'>✓ Departamentos fecham o supervisor em todos os meses.</div>" if ok else "<div class='gm-mi-warn'>Existem diferenças mensais entre supervisor e departamentos.</div>",unsafe_allow_html=True)
            estado['save_ok'][f'dep:{sup}']=ok

    def _rca_mensal(out, key):
        ctx=_ctx(); cycle=ctx.get('cycle') or {}; meses=ctx.get('meses') or []; sup=ctx.get('sup')
        if not sup or not meses or not isinstance(out,pd.DataFrame) or out.empty:
            return
        srec=(cycle.get('supervisores') or {}).get(str(sup)) or {}
        sup_mensal=srec.get('mensal') or _distribuir(_num(srec.get('proposta')),meses,cycle.get('meta_mensal') or {})
        rcas=srec.setdefault('rcas',{})
        with st.expander('Planejamento mês a mês dos RCAs',expanded=False):
            _render_cabecalho_mensal('RCAs por mês',f'Os RCAs devem fechar a meta mensal de {sup}.')
            rows=[]
            for _,row in out.iterrows():
                cod=str(int(row['COD_RCA'])); nome=str(row['RCA']); total=_num(row['Meta proposta']); rec=rcas.setdefault(cod,{'rca':nome})
                mensal=_ensure_mensal(rec,meses,total,sup_mensal)
                item={'COD_RCA':int(cod),'RCA':nome}
                for m in meses:item[gm.MESES[m]]=_num(mensal.get(str(m)))
                item['Total']=sum(item[gm.MESES[m]] for m in meses); rows.append(item)
            df=pd.DataFrame(rows)
            edit=data_editor_prev(df,use_container_width=True,hide_index=True,disabled=['COD_RCA','RCA','Total'],column_config={**{gm.MESES[m]:st.column_config.NumberColumn(format='R$ %.2f',step=10000.0) for m in meses},'Total':st.column_config.NumberColumn(format='R$ %.2f')},key=f'gm_month_rca_{key}')
            row_ok=True
            for _,r in edit.iterrows():
                cod=str(int(r['COD_RCA'])); rec=rcas.setdefault(cod,{})
                rec['mensal']={str(m):_num(r[gm.MESES[m]]) for m in meses}
                alvo=_num(out.loc[pd.to_numeric(out['COD_RCA'],errors='coerce').fillna(-1).astype(int).eq(int(cod)),'Meta proposta'].iloc[0])
                if abs(sum(rec['mensal'].values())-alvo)>0.02: row_ok=False
            month_ok=True
            for m in meses:
                soma=sum(_num((r.get('mensal') or {}).get(str(m))) for r in rcas.values()); alvo=_num(sup_mensal.get(str(m)))
                month_ok=month_ok and abs(soma-alvo)<=0.02
            ok=row_ok and month_ok
            st.markdown("<div class='gm-mi-ok'>✓ RCAs fecham o supervisor em todos os meses.</div>" if ok else "<div class='gm-mi-warn'>Existem diferenças mensais entre supervisor e RCAs.</div>",unsafe_allow_html=True)
            estado['save_ok'][f'rca:{sup}']=ok

    def data_editor(data=None,*args,**kwargs):
        key=str(kwargs.get('key') or '')
        out=data_editor_prev(data,*args,**kwargs)
        if key.startswith('gm2_sup_editor_'):
            _sup_mensal(out,key)
        elif key.startswith('gm2_dep_edit_'):
            _dep_mensal(out,key)
        elif key.startswith('gm2_rca_edit_'):
            _rca_mensal(out,key)
        return out

    def markdown(body,*args,**kwargs):
        resultado=markdown_prev(body,*args,**kwargs)
        if body=='### Validação, aprovação e histórico' and not estado['approval_rendered']:
            estado['approval_rendered']=True
            ctx=_ctx(); cycle=ctx.get('cycle') or {}; meses=ctx.get('meses') or []
            linhas,ok=_status_mensal(cycle,meses); estado['approval_ok']=ok
            st.markdown("<div class='gm-mi-head'><div><strong>Fechamento mensal do ciclo</strong><span>A aprovação agora valida o total e cada mês da hierarquia.</span></div><span class='gm-mi-badge'>validação mensal</span></div>",unsafe_allow_html=True)
            if linhas:
                st.dataframe(pd.DataFrame(linhas),use_container_width=True,hide_index=True,column_config={'Meta empresa':st.column_config.NumberColumn(format='R$ %.2f'),'Fechado':st.column_config.CheckboxColumn()})
            st.markdown("<div class='gm-mi-ok'>✓ Todos os meses fecham de Empresa → Supervisor → Departamento → RCA.</div>" if ok else "<div class='gm-mi-warn'>A aprovação ficará bloqueada enquanto houver algum mês pendente.</div>",unsafe_allow_html=True)
        return resultado

    def button(label,*args,**kwargs):
        key=str(kwargs.get('key') or '')
        ctx=_ctx(); sup=ctx.get('sup')
        if key.startswith('gm2_save_sup_') and estado['save_ok'].get('sup') is False:
            kwargs['disabled']=True
        elif key.startswith('gm2_save_dep_') and sup and estado['save_ok'].get(f'dep:{sup}') is False:
            kwargs['disabled']=True
        elif key.startswith('gm2_save_rca_') and sup and estado['save_ok'].get(f'rca:{sup}') is False:
            kwargs['disabled']=True
        elif key.startswith('gm2_approve_'):
            ctx=_ctx(); cycle=ctx.get('cycle') or {}; meses=ctx.get('meses') or []
            _,ok=_status_mensal(cycle,meses)
            if not ok: kwargs['disabled']=True
        return button_prev(label,*args,**kwargs)

    st.data_editor=data_editor
    st.markdown=markdown
    st.button=button
