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
    """Une meta total e distribuição mensal no mesmo card do supervisor."""
    st.markdown(
        """
        <style>
        .gm-su-card{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:14px 15px 12px;margin:5px 0 10px}
        .gm-su-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:9px}
        .gm-su-name{font-size:13px;font-weight:900;color:#1e2655}.gm-su-share{font-size:10px;font-weight:800;color:#6f7687;background:#f3f5f9;border-radius:999px;padding:4px 8px}
        .gm-su-ref{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:8px}.gm-su-ref span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:800}.gm-su-ref strong{display:block;font-size:10px;color:#3d4459;margin-top:2px}
        .gm-su-month-title{font-size:9px;color:#7f8696;font-weight:850;text-transform:uppercase;letter-spacing:.05em;margin:8px 0 3px}
        .gm-su-status{border-radius:12px;padding:8px 10px;font-size:10px;font-weight:750;margin:8px 0 2px}.gm-su-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-su-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-su-month-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 4px}.gm-su-month-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:9px 11px}.gm-su-month-box span{display:block;font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-su-month-box strong{display:block;font-size:12px;color:#1e2655;margin-top:2px}.gm-su-month-box small{font-size:8px;color:#8a90a0}
        @media(max-width:850px){.gm-su-ref,.gm-su-month-summary{grid-template-columns:1fr}.gm-su-card{padding:12px}}
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

        st.caption('Defina o total e o mês a mês no mesmo card. A soma dos meses deve fechar o total de cada supervisor.')
        cols = st.columns(2)

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

            with cols[idx % 2]:
                st.markdown(
                    f"""
                    <div class='gm-su-card'>
                      <div class='gm-su-head'><div class='gm-su-name'>{sup}</div><div class='gm-su-share'>{part:.1f}% ref.</div></div>
                      <div class='gm-su-ref'>
                        <div><span>Histórico recente</span><strong>{_fmt(hist)}</strong></div>
                        <div><span>Meta sugerida</span><strong>{_fmt(sugerida)}</strong></div>
                        <div><span>Meta atual</span><strong>{_fmt(atual)}</strong></div>
                      </div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

                total_novo = st.number_input(
                    f'Meta total • {sup}', min_value=0.0, value=atual, step=10000.0,
                    format='%.2f', key=f'gm_su_total_{key}_{idx}'
                )
                saida.loc[saida.index[idx], 'Meta definida'] = float(total_novo)

                st.markdown("<div class='gm-su-month-title'>Distribuição mensal</div>", unsafe_allow_html=True)
                mcols = st.columns(max(1, len(meses)))
                novos = {}
                for j, m in enumerate(meses):
                    with mcols[j]:
                        novos[str(m)] = st.number_input(
                            gm.MESES[m], min_value=0.0, value=_num(mensal.get(str(m))), step=10000.0,
                            format='%.2f', key=f'gm_su_month_{key}_{idx}_{m}'
                        )
                rec['mensal'] = {str(m): float(novos[str(m)]) for m in meses}
                soma_m = sum(rec['mensal'].values())
                dif = float(total_novo) - soma_m
                ok = abs(dif) <= 0.02
                st.markdown(
                    f"<div class='gm-su-status {'ok' if ok else 'warn'}'>{'✓' if ok else '!'} Meses: {_fmt(soma_m)} • Diferença: {_fmt(dif)}</div>",
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
