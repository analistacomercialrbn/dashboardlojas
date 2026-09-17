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


def _distribuir(total, meses, pesos):
    if not meses:
        return {}
    vals = [_num(pesos.get(str(m), pesos.get(m, 0))) for m in meses]
    soma = sum(vals)
    if soma <= 0:
        return {str(m): _num(total) / len(meses) for m in meses}
    return {str(m): _num(total) * vals[i] / soma for i, m in enumerate(meses)}


def aplicar_supervisores_unificados():
    """Une meta total e distribuição mensal em uma linha horizontal por supervisor."""
    st.markdown(
        """
        <style>
        .gm-su-line-head{display:grid;grid-template-columns:2.25fr 1.05fr 1.05fr 1.15fr repeat(3,1.05fr) 1.05fr;gap:10px;padding:0 12px 6px;margin-top:8px;align-items:end}
        .gm-su-line-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center}
        .gm-su-line-head span:first-child{text-align:left}
        .gm-su-namebox{min-height:58px;display:flex;flex-direction:column;justify-content:center}
        .gm-su-name{font-size:13px;font-weight:900;color:#1e2655;line-height:1.2}
        .gm-su-sub{font-size:9px;color:#8b91a0;margin-top:4px}
        .gm-su-refbox{min-height:58px;display:flex;flex-direction:column;justify-content:center;text-align:center}
        .gm-su-refbox span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:800}
        .gm-su-refbox strong{font-size:11px;color:#30384d;margin-top:3px}
        .gm-su-status{border-radius:10px;padding:8px 6px;font-size:9px;font-weight:800;text-align:center;margin-top:23px;white-space:nowrap}.gm-su-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-su-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-su-month-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 4px}.gm-su-month-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:9px 11px}.gm-su-month-box span{display:block;font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-su-month-box strong{display:block;font-size:12px;color:#1e2655;margin-top:2px}.gm-su-month-box small{font-size:8px;color:#8a90a0}
        div[data-testid="stVerticalBlockBorderWrapper"]{border-radius:14px!important}
        @media(max-width:1000px){.gm-su-line-head{display:none}.gm-su-month-summary{grid-template-columns:1fr}.gm-su-status{margin-top:0}}
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
        sups = cycle.setdefault('supervisores', {})
        saida = data.copy()

        st.caption('Cada supervisor ocupa uma única linha: referência, meta total e distribuição mensal ficam lado a lado.')

        nomes_meses = [gm.MESES[m] for m in meses]
        while len(nomes_meses) < 3:
            nomes_meses.append('')
        st.markdown(
            "<div class='gm-su-line-head'>"
            "<span>Supervisor</span><span>Histórico</span><span>Meta sugerida</span><span>Meta total</span>"
            + ''.join(f"<span>{nome}</span>" for nome in nomes_meses[:3])
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        for idx, row in data.reset_index(drop=True).iterrows():
            sup = str(row.get('Supervisor', 'Supervisor'))
            rec = sups.setdefault(sup, {})
            atual = _num(row.get('Meta definida'))
            part = _num(row.get('Participação ref. %'))
            hist = _num(row.get('Hist. recente'))
            sugerida = _num(row.get('Meta sugerida'))

            mensal = rec.setdefault('mensal', {})
            if not any(abs(_num(mensal.get(str(m)))) > 0.0001 for m in meses):
                mensal.update(_distribuir(atual, meses, meta_mensal))

            with st.container(border=True):
                specs = [2.25, 1.05, 1.05, 1.15] + [1.05] * len(meses) + [1.05]
                cols = st.columns(specs, vertical_alignment='center')

                with cols[0]:
                    st.markdown(
                        f"<div class='gm-su-namebox'><div class='gm-su-name'>{sup}</div><div class='gm-su-sub'>{part:.1f}% de participação de referência</div></div>",
                        unsafe_allow_html=True,
                    )
                with cols[1]:
                    st.markdown(
                        f"<div class='gm-su-refbox'><span>Histórico recente</span><strong>{_fmt(hist)}</strong></div>",
                        unsafe_allow_html=True,
                    )
                with cols[2]:
                    st.markdown(
                        f"<div class='gm-su-refbox'><span>Meta sugerida</span><strong>{_fmt(sugerida)}</strong></div>",
                        unsafe_allow_html=True,
                    )
                with cols[3]:
                    total_novo = st.number_input(
                        'Meta total', min_value=0.0, value=atual, step=10000.0,
                        format='%.2f', key=f'gm_su_total_{key}_{idx}', label_visibility='collapsed'
                    )
                saida.loc[saida.index[idx], 'Meta definida'] = float(total_novo)

                novos = {}
                for j, m in enumerate(meses):
                    with cols[4 + j]:
                        novos[str(m)] = st.number_input(
                            gm.MESES[m], min_value=0.0, value=_num(mensal.get(str(m))), step=10000.0,
                            format='%.2f', key=f'gm_su_month_{key}_{idx}_{m}', label_visibility='collapsed'
                        )
                rec['mensal'] = {str(m): float(novos[str(m)]) for m in meses}
                soma_m = sum(rec['mensal'].values())
                dif = float(total_novo) - soma_m
                ok = abs(dif) <= 0.02
                with cols[-1]:
                    st.markdown(
                        f"<div class='gm-su-status {'ok' if ok else 'warn'}'>{'✓ Fechado' if ok else 'Ajustar'}<br><span style='font-weight:600'>{_fmt(dif)}</span></div>",
                        unsafe_allow_html=True,
                    )

        total = float(pd.to_numeric(saida['Meta definida'], errors='coerce').fillna(0).sum())
        st.divider()
        st.markdown('##### Fechamento mensal da empresa')
        cards = []
        meses_ok = True
        for m in meses:
            soma = sum(_num((sups.get(str(r['Supervisor']), {}).get('mensal') or {}).get(str(m))) for _, r in saida.iterrows())
            alvo = _num(meta_mensal.get(str(m)))
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(
                f"<div class='gm-su-month-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)}</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar'}</small></div>"
            )
        st.markdown("<div class='gm-su-month-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)
        st.caption(f'Total distribuído no ciclo: {_fmt(total)}')
        if meses and meses_ok:
            st.success('Distribuição mensal fechada com a meta da empresa.')
        elif meses:
            st.warning('Existem meses que ainda não fecham com a meta mensal da empresa.')

        return saida

    st.data_editor = data_editor
