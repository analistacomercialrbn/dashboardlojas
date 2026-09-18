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
    pesos = {}
    if data is None or data.empty:
        return pesos
    vals = pd.to_numeric(data.get('Participação ref. %'), errors='coerce').fillna(0)
    soma = float(vals.sum())
    if soma <= 0:
        n = len(data)
        return {str(int(r['COD_RCA'])): (1 / n if n else 0) for _, r in data.iterrows()}
    for (_, r), v in zip(data.iterrows(), vals):
        pesos[str(int(r['COD_RCA']))] = float(v) / soma
    return pesos


def _deps_ativos(srec, meses):
    deps = []
    for nome, rec in (srec.get('departamentos') or {}).items():
        total = _num(rec.get('proposta'))
        mensal = rec.get('mensal') or {}
        if total > 0 or any(_num(mensal.get(str(m))) > 0 for m in meses):
            deps.append(str(nome))
    return deps


def _inicializar_departamentos(rcas, data, srec, meses):
    """Cria a matriz RCA x departamento x mês usando a participação de referência do RCA como ponto inicial."""
    pesos = _participacoes(data)
    deps = _deps_ativos(srec, meses)
    for _, row in data.iterrows():
        cod = str(int(row['COD_RCA']))
        nome = str(row.get('RCA', ''))
        rr = rcas.setdefault(cod, {'rca': nome})
        rr['rca'] = nome
        rd_all = rr.setdefault('departamentos', {})
        for dep in deps:
            alvo_dep = (srec.get('departamentos') or {}).get(dep, {})
            alvo_mensal = alvo_dep.get('mensal') or {}
            rd = rd_all.setdefault(dep, {'mensal': {}})
            mensal = rd.setdefault('mensal', {})
            if not any(abs(_num(mensal.get(str(m)))) > 0.0001 for m in meses):
                for m in meses:
                    mensal[str(m)] = _num(alvo_mensal.get(str(m))) * pesos.get(cod, 0.0)


def _recalcular_rollup(rr, deps, meses):
    mensal = {}
    for m in meses:
        mensal[str(m)] = sum(
            _num((((rr.get('departamentos') or {}).get(dep) or {}).get('mensal') or {}).get(str(m)))
            for dep in deps
        )
    rr['mensal'] = mensal
    rr['proposta'] = sum(mensal.values())
    return rr['proposta'], mensal


def aplicar_rcas_unificados():
    """RCAs recebem metas mensais por departamento, com resumo consolidado por RCA."""
    st.markdown(
        """
        <style>
        .gm-ru-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:8px 0 12px}
        .gm-ru-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-ru-title{font-size:17px;font-weight:900;color:#1e2655}.gm-ru-sub{font-size:10px;color:#858b99;margin-top:3px}
        .gm-ru-meta{text-align:right}.gm-ru-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-ru-meta strong{font-size:18px;color:#1e2655}
        .gm-ru-head{display:grid;grid-template-columns:2.25fr 1fr 1.2fr repeat(3,1.12fr) .9fr;gap:12px;padding:0 14px 7px;margin-top:8px;align-items:end}
        .gm-ru-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center}.gm-ru-head span:first-child{text-align:left}
        .gm-ru-namebox{min-height:48px;display:flex;flex-direction:column;justify-content:center}.gm-ru-name{font-size:12px;font-weight:900;color:#1e2655;line-height:1.2}.gm-ru-subline{font-size:8px;color:#8b91a0;margin-top:4px}
        .gm-ru-ref{min-height:48px;display:flex;flex-direction:column;justify-content:center;text-align:center}.gm-ru-ref strong{font-size:10px;color:#30384d}.gm-ru-ref span{font-size:8px;color:#9096a4;margin-top:2px}
        .gm-ru-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center;line-height:1.25;white-space:nowrap}.gm-ru-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-ru-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-ru-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 8px}.gm-ru-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:11px 13px}.gm-ru-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-total strong{display:block;font-size:15px;color:#1e2655;margin-top:2px}
        .gm-ru-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0 5px}.gm-ru-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-ru-box span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-box strong{display:block;font-size:13px;color:#1e2655;margin-top:2px}.gm-ru-box small{font-size:8px;color:#8a90a0}
        .gm-ru-detail{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:14px 16px;margin:14px 0 10px}.gm-ru-detail-title{font-size:14px;font-weight:900;color:#1e2655}.gm-ru-detail-sub{font-size:10px;color:#818897;margin-top:2px}
        .gm-ru-dep-head{display:grid;grid-template-columns:2fr repeat(3,1.15fr) 1fr;gap:10px;padding:8px 12px 6px}.gm-ru-dep-head span{font-size:8px;color:#9197a5;text-transform:uppercase;font-weight:850;text-align:center}.gm-ru-dep-head span:first-child{text-align:left}
        .gm-ru-dep-name{font-size:11px;font-weight:850;color:#273052}.gm-ru-dep-alvo{font-size:8px;color:#8d93a1;margin-top:3px}
        .gm-ru-dep-status{font-size:9px;font-weight:800;text-align:center;border-radius:9px;padding:7px}.gm-ru-dep-status.ok{background:#f2faf5;color:#356b46;border:1px solid #d7eadf}.gm-ru-dep-status.warn{background:#fff9f0;color:#816422;border:1px solid #eadfc4}
        @media(max-width:1050px){.gm-ru-head,.gm-ru-dep-head{display:none}.gm-ru-total,.gm-ru-summary{grid-template-columns:1fr}.gm-ru-meta{text-align:left}}
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
        meta_sup = _num(srec.get('proposta'))
        sup_mensal = srec.get('mensal') or {}
        rcas = srec.setdefault('rcas', {})
        deps = _deps_ativos(srec, meses)
        saida = data.copy()

        if not deps:
            st.warning('Primeiro distribua a meta do supervisor entre os departamentos.')
            return data_editor_prev(data, *args, **kwargs)

        _inicializar_departamentos(rcas, data, srec, meses)

        # Rollup inicial para que o resumo reflita a matriz por departamento.
        for _, row in data.iterrows():
            cod = str(int(row['COD_RCA']))
            rr = rcas.setdefault(cod, {'rca': str(row.get('RCA', ''))})
            total_rca, mensal_rca = _recalcular_rollup(rr, deps, meses)
            mask = pd.to_numeric(saida['COD_RCA'], errors='coerce').fillna(-1).astype(int).eq(int(cod))
            saida.loc[mask, 'Meta proposta'] = total_rca

        st.markdown(
            f"""
            <div class='gm-ru-panel'>
              <div class='gm-ru-panel-top'>
                <div>
                  <div class='gm-ru-title'>Distribuição por RCA e departamento</div>
                  <div class='gm-ru-sub'>O total de cada RCA agora é formado pela soma dos departamentos recebidos em cada mês.</div>
                </div>
                <div class='gm-ru-meta'><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div>
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        nomes_meses = [gm.MESES[m] for m in meses]
        while len(nomes_meses) < 3:
            nomes_meses.append('')
        st.markdown(
            "<div class='gm-ru-head'>"
            "<span>RCA</span><span>Part. ref.</span><span>Meta total</span>"
            + ''.join(f"<span>{nome}</span>" for nome in nomes_meses[:3])
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        for idx, row in saida.reset_index(drop=True).iterrows():
            cod = str(int(row.get('COD_RCA'))) if pd.notna(row.get('COD_RCA')) else ''
            nome = str(row.get('RCA', 'RCA'))
            part = _num(row.get('Participação ref. %'))
            rr = rcas.setdefault(cod, {'rca': nome})
            total_rca, mensal_rca = _recalcular_rollup(rr, deps, meses)

            with st.container(border=True):
                cols = st.columns([2.25, 1, 1.2] + [1.12] * len(meses) + [.9], vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-namebox'><div class='gm-ru-name'>{nome}</div><div class='gm-ru-subline'>Código {cod} • {len(deps)} departamentos</div></div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{part:.1f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(total_rca)}</strong><span>total calculado</span></div>", unsafe_allow_html=True)
                for j, m in enumerate(meses):
                    with cols[3 + j]:
                        st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(mensal_rca.get(str(m)))}</strong><span>{gm.MESES[m]}</span></div>", unsafe_allow_html=True)
                soma_m = sum(_num(mensal_rca.get(str(m))) for m in meses)
                ok = abs(total_rca - soma_m) <= 0.02
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok else 'warn'}'>{'✓ Fechado' if ok else 'Ajustar'}</div>", unsafe_allow_html=True)

        st.markdown("<div class='gm-ru-detail'><div class='gm-ru-detail-title'>Distribuição mensal por departamento</div><div class='gm-ru-detail-sub'>Escolha um RCA e informe quanto ele receberá de cada departamento em cada mês.</div></div>", unsafe_allow_html=True)

        opcoes = [f"{int(r['COD_RCA'])} - {r['RCA']}" for _, r in saida.iterrows()]
        escolha = st.selectbox('RCA para distribuir departamentos', opcoes, key=f'gm_ru_detail_rca_{key}_{sup}')
        cod_sel = escolha.split(' - ', 1)[0]
        rr = rcas[cod_sel]
        nome_sel = rr.get('rca', escolha.split(' - ', 1)[-1])

        st.markdown(
            "<div class='gm-ru-dep-head'><span>Departamento</span>"
            + ''.join(f"<span>{gm.MESES[m]}</span>" for m in meses[:3])
            + "<span>Total</span></div>",
            unsafe_allow_html=True,
        )

        for dep_idx, dep in enumerate(deps):
            alvo_dep = (srec.get('departamentos') or {}).get(dep, {})
            alvo_dep_mensal = alvo_dep.get('mensal') or {}
            rd = rr.setdefault('departamentos', {}).setdefault(dep, {'mensal': {}})
            mensal = rd.setdefault('mensal', {})

            with st.container(border=True):
                cols = st.columns([2] + [1.15] * len(meses) + [1], vertical_alignment='center', gap='small')
                with cols[0]:
                    alvo_ciclo = sum(_num(alvo_dep_mensal.get(str(m))) for m in meses)
                    st.markdown(f"<div class='gm-ru-dep-name'>{dep}</div><div class='gm-ru-dep-alvo'>Meta do supervisor no departamento: {_fmt(alvo_ciclo)}</div>", unsafe_allow_html=True)

                novos = {}
                for j, m in enumerate(meses):
                    with cols[1 + j]:
                        novos[str(m)] = st.number_input(
                            gm.MESES[m],
                            min_value=0.0,
                            value=_num(mensal.get(str(m))),
                            step=1000.0,
                            format='%.2f',
                            key=f'gm_ru_dep_{key}_{cod_sel}_{dep_idx}_{m}',
                            label_visibility='collapsed',
                        )
                rd['mensal'] = {str(m): float(novos[str(m)]) for m in meses}
                total_dep_rca = sum(rd['mensal'].values())
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(total_dep_rca)}</strong><span>total</span></div>", unsafe_allow_html=True)

        # Recalcula o RCA editado depois dos inputs.
        _recalcular_rollup(rr, deps, meses)

        st.markdown('##### Fechamento dos departamentos entre todos os RCAs')
        fechamento_ok = True
        rows_check = []
        for dep in deps:
            dep_rec = (srec.get('departamentos') or {}).get(dep, {})
            dep_mensal = dep_rec.get('mensal') or {}
            item = {'Departamento': dep}
            dep_ok = True
            for m in meses:
                soma = sum(
                    _num((((rrec.get('departamentos') or {}).get(dep) or {}).get('mensal') or {}).get(str(m)))
                    for rrec in rcas.values()
                )
                alvo = _num(dep_mensal.get(str(m)))
                item[gm.MESES[m]] = soma
                item[f'Alvo {gm.MESES[m]}'] = alvo
                if abs(soma - alvo) > 0.02:
                    dep_ok = False
            item['Status'] = '✓ Fechado' if dep_ok else 'Ajustar'
            fechamento_ok = fechamento_ok and dep_ok
            rows_check.append(item)

        if rows_check:
            cols_show = ['Departamento'] + [gm.MESES[m] for m in meses] + ['Status']
            st.dataframe(pd.DataFrame(rows_check)[cols_show], use_container_width=True, hide_index=True)

        # Rollup final de todos os RCAs.
        total = 0.0
        mes_totais = {str(m): 0.0 for m in meses}
        for cod, rr2 in rcas.items():
            total_rca, mensal_rca = _recalcular_rollup(rr2, deps, meses)
            total += total_rca
            for m in meses:
                mes_totais[str(m)] += _num(mensal_rca.get(str(m)))

        dif_total = meta_sup - total
        st.markdown(
            f"<div class='gm-ru-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído aos RCAs</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",
            unsafe_allow_html=True,
        )

        cards = []
        meses_ok = True
        for m in meses:
            soma = mes_totais[str(m)]
            alvo = _num(sup_mensal.get(str(m)))
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)}</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar'}</small></div>")
        if cards:
            st.markdown("<div class='gm-ru-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        tudo_ok = fechamento_ok and meses_ok and abs(dif_total) <= 0.02
        estado['ok'][sup] = tudo_ok
        if tudo_ok:
            st.success('RCAs fecham a meta do supervisor por departamento e por mês.')
        else:
            st.warning('Ainda existem diferenças. Cada departamento precisa fechar entre os RCAs em todos os meses.')

        # devolve o resumo consolidado para o fluxo original salvar proposta por RCA
        for idx, row in saida.iterrows():
            cod = str(int(row['COD_RCA']))
            saida.loc[idx, 'Meta proposta'] = _num((rcas.get(cod) or {}).get('proposta'))
        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        ctx = _ctx()
        sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_rca_'):
            label = 'Redistribuir pela participação de referência'
        elif key.startswith('gm2_save_rca_'):
            label = 'Salvar RCAs e avançar para Aprovação →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
