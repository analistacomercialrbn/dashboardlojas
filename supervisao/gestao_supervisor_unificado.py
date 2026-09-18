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


def _sincronizar_meses(rec, meses, pct_geral):
    pct = rec.setdefault('percentual_mensal', {})
    anterior = _num(rec.get('percentual_geral_anterior', pct_geral))
    for m in meses:
        k = str(m)
        if k not in pct or abs(_num(pct.get(k)) - anterior) <= 0.001:
            pct[k] = pct_geral
    rec['percentual_geral_anterior'] = pct_geral
    return pct


def aplicar_supervisores_unificados():
    st.markdown(
        """
        <style>
        .gm-su-head{display:grid;grid-template-columns:1.9fr .85fr .85fr 1fr 1.15fr repeat(3,.72fr 1fr) .88fr;gap:9px;padding:0 12px 7px;align-items:end}
        .gm-su-head span{font-size:8px;color:#8f96a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-su-head span:first-child{text-align:left}
        .gm-su-name{font-size:12px;font-weight:900;color:#1e2655}.gm-su-sub{font-size:8px;color:#8b91a0;margin-top:4px}
        .gm-su-val{text-align:center}.gm-su-val strong{font-size:10px;color:#30384d;display:block}.gm-su-val span{font-size:8px;color:#9096a4}
        .gm-su-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-su-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-su-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-su-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}.gm-su-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:9px 11px}.gm-su-box span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-su-box strong{display:block;font-size:13px;color:#1e2655;margin-top:2px}.gm-su-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1250px){.gm-su-head{display:none}.gm-su-summary{grid-template-columns:1fr}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_prev = st.data_editor

    def data_editor(data=None, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if not key.startswith('gm2_sup_editor_') or not isinstance(data, pd.DataFrame):
            return data_editor_prev(data, *args, **kwargs)
        if data.empty or 'Supervisor' not in data.columns or 'Meta definida' not in data.columns:
            return data_editor_prev(data, *args, **kwargs)

        ctx = _ctx()
        cycle = ctx.get('cycle') or {}
        meses = ctx.get('meses') or []
        meta_mensal = cycle.get('meta_mensal') or {}
        meta_ciclo = sum(_num(meta_mensal.get(str(m))) for m in meses) or _num(cycle.get('meta_global'))
        sups = cycle.setdefault('supervisores', {})
        saida = data.copy()

        st.caption('A % geral define a participação do supervisor no ciclo. Os meses herdam essa % e só precisam ser alterados quando houver uma distribuição mensal diferente.')

        st.markdown(
            "<div class='gm-su-head'><span>Supervisor</span><span>Histórico</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_geral = 0.0
        soma_mes_pct = {str(m): 0.0 for m in meses}
        linhas_ok = True

        for idx, row in data.reset_index(drop=True).iterrows():
            sup = str(row.get('Supervisor', 'Supervisor'))
            rec = sups.setdefault(sup, {})
            part_ref = _num(row.get('Participação ref. %'))
            hist = _num(row.get('Hist. recente'))

            if 'percentual_geral' not in rec:
                valor_atual = _num(rec.get('proposta')) or _num(row.get('Meta definida'))
                rec['percentual_geral'] = (100 * valor_atual / meta_ciclo) if (meta_ciclo and valor_atual > 0) else part_ref

            with st.container(border=True):
                specs = [1.9, .85, .85, 1, 1.15] + sum(([.72, 1] for _ in meses), []) + [.88]
                cols = st.columns(specs, vertical_alignment='center', gap='small')

                with cols[0]:
                    st.markdown(f"<div class='gm-su-name'>{sup}</div><div class='gm-su-sub'>Participação no faturamento do ciclo</div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-su-val'><strong>{_fmt(hist)}</strong><span>histórico</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    st.markdown(f"<div class='gm-su-val'><strong>{part_ref:.2f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[3]:
                    pct_geral = st.number_input(
                        f'% geral • {sup}', min_value=0.0, max_value=100.0,
                        value=_num(rec.get('percentual_geral')), step=0.1, format='%.2f',
                        key=f'gm_su_geral_{key}_{idx}', label_visibility='collapsed'
                    )
                rec['percentual_geral'] = float(pct_geral)
                soma_geral += float(pct_geral)
                meta_alvo = meta_ciclo * float(pct_geral) / 100.0

                pct_mensal = _sincronizar_meses(rec, meses, float(pct_geral))
                mensal = rec.setdefault('mensal', {})
                pos = 5
                for m in meses:
                    with cols[pos]:
                        pm = st.number_input(
                            f'{gm.MESES[m]} % • {sup}', min_value=0.0, max_value=100.0,
                            value=_num(pct_mensal.get(str(m))), step=0.1, format='%.2f',
                            key=f'gm_su_mes_{key}_{idx}_{m}', label_visibility='collapsed'
                        )
                    pct_mensal[str(m)] = float(pm)
                    soma_mes_pct[str(m)] += float(pm)
                    valor = _num(meta_mensal.get(str(m))) * float(pm) / 100.0
                    mensal[str(m)] = valor
                    with cols[pos + 1]:
                        st.markdown(f"<div class='gm-su-val'><strong>{_fmt(valor)}</strong><span>calculado</span></div>", unsafe_allow_html=True)
                    pos += 2

                realizado = sum(_num(mensal.get(str(m))) for m in meses)
                rec['mensal'] = {str(m): _num(mensal.get(str(m))) for m in meses}
                rec['proposta'] = realizado
                saida.loc[saida.index[idx], 'Meta definida'] = realizado
                with cols[4]:
                    st.markdown(f"<div class='gm-su-val'><strong>{_fmt(meta_alvo)}</strong><span>pela % geral</span></div>", unsafe_allow_html=True)

                ok_linha = abs(realizado - meta_alvo) <= 0.02
                linhas_ok = linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-su-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar ciclo'}</div>", unsafe_allow_html=True)

        cards = []
        meses_ok = True
        for m in meses:
            pct_total = soma_mes_pct[str(m)]
            alvo = _num(meta_mensal.get(str(m)))
            ok = abs(pct_total - 100) <= 0.01 if alvo > 0 else abs(pct_total) <= 0.01
            meses_ok = meses_ok and ok
            cards.append(f"<div class='gm-su-box'><span>{gm.MESES[m]}</span><strong>{pct_total:.1f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        if cards:
            st.markdown("<div class='gm-su-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        geral_ok = abs(soma_geral - 100) <= 0.01 if meta_ciclo > 0 else True
        if geral_ok and meses_ok and linhas_ok:
            st.success('Participação geral e mensal dos supervisores fechada.')
        else:
            st.warning(f'Geral: {soma_geral:.2f}%. A soma geral deve fechar 100%, cada mês deve fechar 100% e o total mensal de cada supervisor deve respeitar sua % geral.')

        return saida

    st.data_editor = data_editor
