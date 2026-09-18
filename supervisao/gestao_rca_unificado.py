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
        return {str(int(r['COD_RCA'])): (1 / n if n else 0) for _, r in data.iterrows()}
    return {str(int(r['COD_RCA'])): float(v) / soma for (_, r), v in zip(data.iterrows(), vals)}


def _deps_ativos(srec, meses):
    deps = []
    for nome, rec in (srec.get('departamentos') or {}).items():
        mensal = rec.get('mensal') or {}
        if _num(rec.get('proposta')) > 0 or any(_num(mensal.get(str(m))) > 0 for m in meses):
            deps.append(str(nome))
    return deps


def _init_rca_targets(rcas, data, srec, meses):
    """Mantém a meta mensal do RCA como base e separa dela a distribuição por departamento."""
    pesos = _participacoes(data)
    sup_mensal = srec.get('mensal') or {}
    for _, row in data.iterrows():
        cod = str(int(row['COD_RCA']))
        nome = str(row.get('RCA', ''))
        rr = rcas.setdefault(cod, {'rca': nome})
        rr['rca'] = nome

        atual_total = _num(row.get('Meta proposta'))
        alvo = rr.setdefault('mensal_alvo', {})
        if not any(abs(_num(alvo.get(str(m)))) > 0.0001 for m in meses):
            antigo = rr.get('mensal') or {}
            if any(abs(_num(antigo.get(str(m)))) > 0.0001 for m in meses):
                for m in meses:
                    alvo[str(m)] = _num(antigo.get(str(m)))
            else:
                for m in meses:
                    alvo[str(m)] = _num(sup_mensal.get(str(m))) * pesos.get(cod, 0.0)

        soma_alvo = sum(_num(alvo.get(str(m))) for m in meses)
        if soma_alvo <= 0 and atual_total > 0 and meses:
            base = sum(_num(sup_mensal.get(str(m))) for m in meses)
            for m in meses:
                peso_mes = (_num(sup_mensal.get(str(m))) / base) if base else (1 / len(meses))
                alvo[str(m)] = atual_total * peso_mes

        rr['mensal'] = {str(m): _num(alvo.get(str(m))) for m in meses}
        rr['proposta'] = sum(rr['mensal'].values())


def _init_percentuais(rr, deps, meses):
    dep_store = rr.setdefault('departamentos', {})
    for dep in deps:
        rd = dep_store.setdefault(dep, {})
        pct = rd.setdefault('percentual', {})
        mensal = rd.setdefault('mensal', {})
        for m in meses:
            base = _num((rr.get('mensal_alvo') or {}).get(str(m)))
            if str(m) not in pct:
                pct[str(m)] = (100 * _num(mensal.get(str(m))) / base) if base else 0.0


def _recalcular_valores_por_pct(rr, deps, meses):
    base_mensal = rr.get('mensal_alvo') or {}
    for dep in deps:
        rd = rr.setdefault('departamentos', {}).setdefault(dep, {})
        pct = rd.setdefault('percentual', {})
        mensal = rd.setdefault('mensal', {})
        for m in meses:
            mensal[str(m)] = _num(base_mensal.get(str(m))) * _num(pct.get(str(m))) / 100.0
    rr['mensal'] = {str(m): _num(base_mensal.get(str(m))) for m in meses}
    rr['proposta'] = sum(rr['mensal'].values())


def aplicar_rcas_unificados():
    """RCA recebe meta mensal e distribui cada mês por departamento usando percentuais."""
    st.markdown(
        """
        <style>
        .gm-ru-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:8px 0 12px}
        .gm-ru-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-ru-title{font-size:17px;font-weight:900;color:#1e2655}.gm-ru-sub{font-size:10px;color:#858b99;margin-top:3px}
        .gm-ru-meta{text-align:right}.gm-ru-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-ru-meta strong{font-size:18px;color:#1e2655}
        .gm-ru-head{display:grid;grid-template-columns:2.2fr .85fr 1.15fr repeat(3,1.08fr) .9fr;gap:11px;padding:0 14px 7px;margin-top:8px;align-items:end}
        .gm-ru-head span,.gm-ru-pct-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center}.gm-ru-head span:first-child,.gm-ru-pct-head span:first-child{text-align:left}
        .gm-ru-namebox{min-height:48px;display:flex;flex-direction:column;justify-content:center}.gm-ru-name{font-size:12px;font-weight:900;color:#1e2655}.gm-ru-subline{font-size:8px;color:#8b91a0;margin-top:4px}
        .gm-ru-ref{min-height:48px;display:flex;flex-direction:column;justify-content:center;text-align:center}.gm-ru-ref strong{font-size:10px;color:#30384d}.gm-ru-ref span{font-size:8px;color:#9096a4;margin-top:2px}
        .gm-ru-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-ru-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-ru-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-ru-detail{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:14px 16px;margin:14px 0 10px}.gm-ru-detail-title{font-size:14px;font-weight:900;color:#1e2655}.gm-ru-detail-sub{font-size:10px;color:#818897;margin-top:2px}
        .gm-ru-pct-head{display:grid;grid-template-columns:1.8fr repeat(3,.72fr 1.1fr) .9fr;gap:9px;padding:8px 12px 6px}
        .gm-ru-dep-name{font-size:11px;font-weight:850;color:#273052}.gm-ru-dep-alvo{font-size:8px;color:#8d93a1;margin-top:3px}
        .gm-ru-total,.gm-ru-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 8px}.gm-ru-total>div,.gm-ru-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-ru-total span,.gm-ru-box span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-total strong,.gm-ru-box strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-ru-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1100px){.gm-ru-head,.gm-ru-pct-head{display:none}.gm-ru-total,.gm-ru-summary{grid-template-columns:1fr}.gm-ru-meta{text-align:left}}
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

        _init_rca_targets(rcas, data, srec, meses)

        st.markdown(
            f"""
            <div class='gm-ru-panel'><div class='gm-ru-panel-top'>
              <div><div class='gm-ru-title'>Metas mensais dos RCAs</div>
              <div class='gm-ru-sub'>Primeiro defina quanto cada RCA recebe em cada mês. Depois distribua 100% dessa meta entre os departamentos.</div></div>
              <div class='gm-ru-meta'><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div>
            </div></div>
            """,
            unsafe_allow_html=True,
        )

        nomes_meses = [gm.MESES[m] for m in meses]
        st.markdown(
            "<div class='gm-ru-head'><span>RCA</span><span>Part. ref.</span><span>Meta total</span>"
            + ''.join(f"<span>{nome}</span>" for nome in nomes_meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        rca_month_ok = True
        for idx, row in saida.reset_index(drop=True).iterrows():
            cod = str(int(row['COD_RCA']))
            nome = str(row.get('RCA', 'RCA'))
            part = _num(row.get('Participação ref. %'))
            rr = rcas[cod]
            alvo = rr.setdefault('mensal_alvo', {})

            with st.container(border=True):
                cols = st.columns([2.2, .85, 1.15] + [1.08] * len(meses) + [.9], vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-namebox'><div class='gm-ru-name'>{nome}</div><div class='gm-ru-subline'>Código {cod}</div></div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{part:.1f}%</strong><span>referência</span></div>", unsafe_allow_html=True)

                novos_meses = {}
                for j, m in enumerate(meses):
                    with cols[3 + j]:
                        novos_meses[str(m)] = st.number_input(
                            gm.MESES[m], min_value=0.0, value=_num(alvo.get(str(m))),
                            step=10000.0, format='%.2f',
                            key=f'gm_ru_alvo_{key}_{idx}_{m}', label_visibility='collapsed'
                        )
                rr['mensal_alvo'] = {str(m): float(novos_meses[str(m)]) for m in meses}
                rr['mensal'] = dict(rr['mensal_alvo'])
                rr['proposta'] = sum(rr['mensal'].values())
                saida.loc[saida.index[idx], 'Meta proposta'] = rr['proposta']

                with cols[2]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(rr['proposta'])}</strong><span>total</span></div>", unsafe_allow_html=True)

                soma_pct_ok = True
                _init_percentuais(rr, deps, meses)
                for m in meses:
                    soma_pct = sum(_num(((rr.get('departamentos') or {}).get(dep, {}).get('percentual') or {}).get(str(m))) for dep in deps)
                    if _num(rr['mensal_alvo'].get(str(m))) > 0 and abs(soma_pct - 100) > 0.01:
                        soma_pct_ok = False
                rca_month_ok = rca_month_ok and soma_pct_ok
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if soma_pct_ok else 'warn'}'>{'✓ 100%' if soma_pct_ok else 'Ajustar %'}</div>", unsafe_allow_html=True)

        # valida soma das metas mensais de RCA contra o supervisor
        for m in meses:
            soma = sum(_num((r.get('mensal_alvo') or {}).get(str(m))) for r in rcas.values())
            if abs(soma - _num(sup_mensal.get(str(m)))) > 0.02:
                rca_month_ok = False

        st.markdown("<div class='gm-ru-detail'><div class='gm-ru-detail-title'>Percentual por departamento</div><div class='gm-ru-detail-sub'>A análise vem da dinâmica: aqui você informa a % decidida. O valor em R$ é calculado automaticamente sobre a meta mensal do RCA.</div></div>", unsafe_allow_html=True)

        opcoes = [f"{int(r['COD_RCA'])} - {r['RCA']}" for _, r in saida.iterrows()]
        escolha = st.selectbox('RCA para distribuir departamentos', opcoes, key=f'gm_ru_detail_rca_{key}_{sup}')
        cod_sel = escolha.split(' - ', 1)[0]
        rr = rcas[cod_sel]
        _init_percentuais(rr, deps, meses)

        st.markdown(
            "<div class='gm-ru-pct-head'><span>Departamento</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Total</span></div>",
            unsafe_allow_html=True,
        )

        pct_mes_somas = {str(m): 0.0 for m in meses}
        for dep_idx, dep in enumerate(deps):
            dep_meta = (srec.get('departamentos') or {}).get(dep, {})
            rd = rr.setdefault('departamentos', {}).setdefault(dep, {})
            pct = rd.setdefault('percentual', {})
            mensal = rd.setdefault('mensal', {})

            with st.container(border=True):
                specs = [1.8] + sum(([.72, 1.1] for _ in meses), []) + [.9]
                cols = st.columns(specs, vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-dep-name'>{dep}</div><div class='gm-ru-dep-alvo'>Meta supervisor no ciclo: {_fmt(dep_meta.get('proposta'))}</div>", unsafe_allow_html=True)

                pos = 1
                for m in meses:
                    base = _num((rr.get('mensal_alvo') or {}).get(str(m)))
                    with cols[pos]:
                        novo_pct = st.number_input(
                            f'{gm.MESES[m]} %', min_value=0.0, max_value=100.0,
                            value=_num(pct.get(str(m))), step=1.0, format='%.2f',
                            key=f'gm_ru_pct_{key}_{cod_sel}_{dep_idx}_{m}', label_visibility='collapsed'
                        )
                    pct[str(m)] = float(novo_pct)
                    pct_mes_somas[str(m)] += float(novo_pct)
                    mensal[str(m)] = base * float(novo_pct) / 100.0
                    with cols[pos + 1]:
                        st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(mensal[str(m)])}</strong><span>calculado</span></div>", unsafe_allow_html=True)
                    pos += 2

                total_dep = sum(_num(mensal.get(str(m))) for m in meses)
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(total_dep)}</strong><span>total</span></div>", unsafe_allow_html=True)

        _recalcular_valores_por_pct(rr, deps, meses)

        pct_ok = True
        pct_cards = []
        for m in meses:
            soma_pct = pct_mes_somas[str(m)]
            alvo_mes = _num((rr.get('mensal_alvo') or {}).get(str(m)))
            ok = (alvo_mes <= 0 and abs(soma_pct) <= 0.01) or (alvo_mes > 0 and abs(soma_pct - 100) <= 0.01)
            pct_ok = pct_ok and ok
            pct_cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]}</span><strong>{soma_pct:.1f}%</strong><small>{'Fechado' if ok else 'Precisa fechar 100%'}</small></div>")
        st.markdown("<div class='gm-ru-summary'>" + ''.join(pct_cards) + "</div>", unsafe_allow_html=True)

        # fechamento por departamento em R$ entre todos os RCAs
        st.markdown('##### Conferência dos departamentos')
        fechamento_ok = True
        rows_check = []
        for dep in deps:
            dep_rec = (srec.get('departamentos') or {}).get(dep, {})
            dep_mensal = dep_rec.get('mensal') or {}
            item = {'Departamento': dep}
            dep_ok = True
            for m in meses:
                soma = sum(_num((((rrec.get('departamentos') or {}).get(dep) or {}).get('mensal') or {}).get(str(m))) for rrec in rcas.values())
                alvo = _num(dep_mensal.get(str(m)))
                item[gm.MESES[m]] = soma
                item[f'Dif. {gm.MESES[m]}'] = alvo - soma
                if abs(soma - alvo) > 0.02:
                    dep_ok = False
            item['Status'] = '✓ Fechado' if dep_ok else 'Ajustar'
            fechamento_ok = fechamento_ok and dep_ok
            rows_check.append(item)

        if rows_check:
            st.dataframe(pd.DataFrame(rows_check), use_container_width=True, hide_index=True)

        total = sum(_num(r.get('proposta')) for r in rcas.values())
        dif_total = meta_sup - total
        st.markdown(f"<div class='gm-ru-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído aos RCAs</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>", unsafe_allow_html=True)

        meses_ok = True
        cards = []
        for m in meses:
            soma = sum(_num((r.get('mensal_alvo') or {}).get(str(m))) for r in rcas.values())
            alvo = _num(sup_mensal.get(str(m)))
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)}</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar'}</small></div>")
        st.markdown("<div class='gm-ru-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        tudo_ok = pct_ok and rca_month_ok and fechamento_ok and meses_ok and abs(dif_total) <= 0.02
        estado['ok'][sup] = tudo_ok
        if tudo_ok:
            st.success('Distribuição fechada: RCAs, percentuais e departamentos conferem em todos os meses.')
        else:
            st.warning('Ainda há diferenças. As % de cada RCA devem fechar 100% por mês e os departamentos precisam fechar com a meta do supervisor.')

        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        ctx = _ctx()
        sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_rca_'):
            label = 'Distribuir RCAs pela participação de referência'
        elif key.startswith('gm2_save_rca_'):
            label = 'Salvar RCAs e avançar para Aprovação →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
