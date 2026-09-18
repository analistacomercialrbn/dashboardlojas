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


def aplicar_rcas_unificados():
    """Deixa a etapa RCA em formato de grade operacional: um RCA por linha, total e meses lado a lado."""
    st.markdown(
        """
        <style>
        .gm-ru-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:8px 0 12px}
        .gm-ru-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-ru-title{font-size:17px;font-weight:900;color:#1e2655}.gm-ru-sub{font-size:10px;color:#858b99;margin-top:3px}
        .gm-ru-meta{text-align:right}.gm-ru-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-ru-meta strong{font-size:18px;color:#1e2655}
        .gm-ru-head{display:grid;grid-template-columns:2.15fr .85fr 1.05fr 1.2fr repeat(3,1.12fr) .9fr;gap:12px;padding:0 14px 7px;margin-top:8px;align-items:end}
        .gm-ru-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center}.gm-ru-head span:first-child{text-align:left}
        .gm-ru-namebox{min-height:48px;display:flex;flex-direction:column;justify-content:center}.gm-ru-name{font-size:12px;font-weight:900;color:#1e2655;line-height:1.2}.gm-ru-subline{font-size:8px;color:#8b91a0;margin-top:4px}
        .gm-ru-ref{min-height:48px;display:flex;flex-direction:column;justify-content:center;text-align:center}.gm-ru-ref strong{font-size:10px;color:#30384d}.gm-ru-ref span{font-size:8px;color:#9096a4;margin-top:2px}
        .gm-ru-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center;line-height:1.25;white-space:nowrap}.gm-ru-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-ru-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-ru-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 8px}.gm-ru-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:11px 13px}.gm-ru-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-total strong{display:block;font-size:15px;color:#1e2655;margin-top:2px}
        .gm-ru-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0 5px}.gm-ru-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-ru-box span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-box strong{display:block;font-size:13px;color:#1e2655;margin-top:2px}.gm-ru-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1050px){.gm-ru-head{display:none}.gm-ru-total,.gm-ru-summary{grid-template-columns:1fr}.gm-ru-meta{text-align:left}}
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
        sup_mensal = srec.get('mensal') or _distribuir(meta_sup, meses, cycle.get('meta_mensal') or {})
        rcas = srec.setdefault('rcas', {})
        saida = data.copy()

        st.markdown(
            f"""
            <div class='gm-ru-panel'>
              <div class='gm-ru-panel-top'>
                <div>
                  <div class='gm-ru-title'>Distribuição por RCA</div>
                  <div class='gm-ru-sub'>Cada RCA ocupa uma única linha com referência, meta total e mês a mês.</div>
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
            "<span>RCA</span><span>Part. ref.</span><span>Meta sugerida</span><span>Meta total</span>"
            + ''.join(f"<span>{nome}</span>" for nome in nomes_meses[:3])
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        linhas_ok = True
        for idx, row in data.reset_index(drop=True).iterrows():
            cod = str(int(row.get('COD_RCA'))) if pd.notna(row.get('COD_RCA')) else ''
            nome = str(row.get('RCA', 'RCA'))
            atual = _num(row.get('Meta proposta'))
            part = _num(row.get('Participação ref. %'))
            sugerida = _num(row.get('Meta sugerida'))
            rec = rcas.setdefault(cod, {'rca': nome})
            rec['rca'] = nome

            mensal = rec.setdefault('mensal', {})
            soma_existente = sum(_num(mensal.get(str(m))) for m in meses)
            if meses and (not any(abs(_num(mensal.get(str(m)))) > 0.0001 for m in meses) or abs(soma_existente - atual) > 0.02):
                mensal.update(_distribuir(atual, meses, sup_mensal))

            with st.container(border=True):
                specs = [2.15, .85, 1.05, 1.2] + [1.12] * len(meses) + [.9]
                cols = st.columns(specs, vertical_alignment='center', gap='small')

                with cols[0]:
                    st.markdown(
                        f"<div class='gm-ru-namebox'><div class='gm-ru-name'>{nome}</div><div class='gm-ru-subline'>Código {cod}</div></div>",
                        unsafe_allow_html=True,
                    )
                with cols[1]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{part:.1f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    st.markdown(f"<div class='gm-ru-ref'><strong>{_fmt(sugerida)}</strong><span>sugerida</span></div>", unsafe_allow_html=True)
                with cols[3]:
                    total_novo = st.number_input(
                        'Meta total', min_value=0.0, value=atual, step=10000.0,
                        format='%.2f', key=f'gm_ru_total_{key}_{idx}', label_visibility='collapsed'
                    )
                saida.loc[saida.index[idx], 'Meta proposta'] = float(total_novo)
                rec['proposta'] = float(total_novo)

                novos = {}
                for j, m in enumerate(meses):
                    with cols[4 + j]:
                        novos[str(m)] = st.number_input(
                            gm.MESES[m], min_value=0.0, value=_num(mensal.get(str(m))), step=10000.0,
                            format='%.2f', key=f'gm_ru_month_{key}_{idx}_{m}', label_visibility='collapsed'
                        )
                rec['mensal'] = {str(m): float(novos[str(m)]) for m in meses}
                soma_m = sum(rec['mensal'].values())
                dif = float(total_novo) - soma_m
                ok = abs(dif) <= 0.02
                linhas_ok = linhas_ok and ok

                with cols[-1]:
                    st.markdown(
                        f"<div class='gm-ru-status {'ok' if ok else 'warn'}'>{'✓ Fechado' if ok else 'Ajustar'}<br>{_fmt(dif)}</div>",
                        unsafe_allow_html=True,
                    )

        total = float(pd.to_numeric(saida['Meta proposta'], errors='coerce').fillna(0).sum())
        dif_total = meta_sup - total
        st.markdown(
            f"<div class='gm-ru-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído aos RCAs</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",
            unsafe_allow_html=True,
        )

        cards = []
        meses_ok = True
        for m in meses:
            soma = sum(_num((rcas.get(str(int(r['COD_RCA'])), {}).get('mensal') or {}).get(str(m))) for _, r in saida.iterrows())
            alvo = _num(sup_mensal.get(str(m)))
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(
                f"<div class='gm-ru-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)}</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar'}</small></div>"
            )
        if cards:
            st.markdown("<div class='gm-ru-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        tudo_ok = linhas_ok and meses_ok and abs(dif_total) <= 0.02
        estado['ok'][sup] = tudo_ok
        if tudo_ok:
            st.success('Distribuição dos RCAs fechada no total e em todos os meses.')
        else:
            st.warning('Ainda existem diferenças no total ou no fechamento mensal dos RCAs.')

        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        ctx = _ctx()
        sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_rca_'):
            label = 'Usar sugestão do histórico'
        elif key.startswith('gm2_save_rca_'):
            label = 'Salvar RCAs e avançar para Aprovação →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
