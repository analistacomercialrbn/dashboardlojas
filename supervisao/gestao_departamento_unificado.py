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


def aplicar_departamentos_unificados():
    """Tela operacional de departamentos: foco em meta total e distribuicao mensal."""
    st.markdown(
        """
        <style>
        .gm-du-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:6px 0 12px}
        .gm-du-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-du-panel-title{font-size:17px;font-weight:900;color:#1e2655}.gm-du-panel-sub{font-size:10px;color:#858b99;margin-top:3px}
        .gm-du-panel-meta{text-align:right}.gm-du-panel-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-du-panel-meta strong{font-size:18px;color:#1e2655}
        .gm-du-head{display:grid;grid-template-columns:2.25fr 1.25fr repeat(3,1.18fr) .9fr;gap:12px;padding:0 14px 7px;margin-top:8px;align-items:end}
        .gm-du-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center}.gm-du-head span:first-child{text-align:left}
        .gm-du-namebox{min-height:48px;display:flex;flex-direction:column;justify-content:center}.gm-du-name{font-size:12px;font-weight:900;color:#1e2655;line-height:1.2}.gm-du-sub{font-size:8px;color:#8b91a0;margin-top:4px}
        .gm-du-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center;line-height:1.25;white-space:nowrap}.gm-du-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-du-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-du-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0 5px}.gm-du-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-du-box span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-box strong{display:block;font-size:13px;color:#1e2655;margin-top:2px}.gm-du-box small{font-size:8px;color:#8a90a0}
        .gm-du-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 8px}.gm-du-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:11px 13px}.gm-du-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-total strong{display:block;font-size:15px;color:#1e2655;margin-top:2px}
        .gm-du-ref-table{font-size:10px;color:#596174;margin-top:4px}
        @media(max-width:1000px){.gm-du-head{display:none}.gm-du-summary,.gm-du-total{grid-template-columns:1fr}.gm-du-panel-meta{text-align:left}.gm-du-status{margin-top:0}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_prev = st.data_editor
    button_prev = st.button
    estado = {'ok': {}}

    def data_editor(data=None, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if not key.startswith('gm2_dep_edit_') or not isinstance(data, pd.DataFrame):
            return data_editor_prev(data, *args, **kwargs)
        if data.empty or 'Departamento' not in data.columns or 'Meta proposta' not in data.columns:
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
        deps = srec.setdefault('departamentos', {})
        saida = data.copy()

        st.markdown(
            f"""
            <div class='gm-du-panel'>
              <div class='gm-du-panel-top'>
                <div>
                  <div class='gm-du-panel-title'>Distribuição por departamento</div>
                  <div class='gm-du-panel-sub'>Defina apenas os valores do planejamento. A análise histórica continua disponível como apoio, sem ocupar a tela principal.</div>
                </div>
                <div class='gm-du-panel-meta'><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div>
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        with st.expander('Ver referências usadas na sugestão', expanded=False):
            refs = []
            for _, r in data.iterrows():
                refs.append({
                    'Departamento': str(r.get('Departamento', '')),
                    'Histórico recente': _num(r.get('Hist. recente')),
                    'Participação ref. %': _num(r.get('Participação ref. %')),
                    'Meta sugerida': _num(r.get('Meta sugerida')),
                })
            rdf = pd.DataFrame(refs)
            st.dataframe(
                rdf,
                use_container_width=True,
                hide_index=True,
                column_config={
                    'Histórico recente': st.column_config.NumberColumn(format='R$ %.2f'),
                    'Participação ref. %': st.column_config.NumberColumn(format='%.2f%%'),
                    'Meta sugerida': st.column_config.NumberColumn(format='R$ %.2f'),
                },
            )

        nomes_meses = [gm.MESES[m] for m in meses]
        while len(nomes_meses) < 3:
            nomes_meses.append('')
        st.markdown(
            "<div class='gm-du-head'>"
            "<span>Departamento</span><span>Meta total</span>"
            + ''.join(f"<span>{nome}</span>" for nome in nomes_meses[:3])
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        linhas_ok = True
        for idx, row in data.reset_index(drop=True).iterrows():
            dep = str(row.get('Departamento', 'Departamento'))
            rec = deps.setdefault(dep, {})
            atual = _num(row.get('Meta proposta'))

            mensal = rec.setdefault('mensal', {})
            soma_existente = sum(_num(mensal.get(str(m))) for m in meses)
            if not meses:
                mensal = {}
            elif not any(abs(_num(mensal.get(str(m)))) > 0.0001 for m in meses) or abs(soma_existente - atual) > 0.02:
                mensal.update(_distribuir(atual, meses, sup_mensal))

            with st.container(border=True):
                specs = [2.25, 1.25] + [1.18] * len(meses) + [.9]
                cols = st.columns(specs, vertical_alignment='center', gap='small')

                with cols[0]:
                    st.markdown(
                        f"<div class='gm-du-namebox'><div class='gm-du-name'>{dep}</div><div class='gm-du-sub'>Planejamento do ciclo</div></div>",
                        unsafe_allow_html=True,
                    )
                with cols[1]:
                    total_novo = st.number_input(
                        'Meta total', min_value=0.0, value=atual, step=10000.0,
                        format='%.2f', key=f'gm_du_total_{key}_{idx}', label_visibility='collapsed'
                    )
                saida.loc[saida.index[idx], 'Meta proposta'] = float(total_novo)

                novos = {}
                for j, m in enumerate(meses):
                    with cols[2 + j]:
                        novos[str(m)] = st.number_input(
                            gm.MESES[m], min_value=0.0, value=_num(mensal.get(str(m))), step=10000.0,
                            format='%.2f', key=f'gm_du_month_{key}_{idx}_{m}', label_visibility='collapsed'
                        )
                rec['mensal'] = {str(m): float(novos[str(m)]) for m in meses}
                soma_m = sum(rec['mensal'].values())
                dif = float(total_novo) - soma_m
                ok = abs(dif) <= 0.02
                linhas_ok = linhas_ok and ok
                with cols[-1]:
                    st.markdown(
                        f"<div class='gm-du-status {'ok' if ok else 'warn'}'>{'✓ Fechado' if ok else 'Ajustar'}<br>{_fmt(dif)}</div>",
                        unsafe_allow_html=True,
                    )

        total = float(pd.to_numeric(saida['Meta proposta'], errors='coerce').fillna(0).sum())
        dif_total = meta_sup - total
        st.markdown(
            f"<div class='gm-du-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div><div><span>Distribuído</span><strong>{_fmt(total)}</strong></div><div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",
            unsafe_allow_html=True,
        )

        cards = []
        meses_ok = True
        for m in meses:
            soma = sum(_num((deps.get(str(r['Departamento']), {}).get('mensal') or {}).get(str(m))) for _, r in saida.iterrows())
            alvo = _num(sup_mensal.get(str(m)))
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(
                f"<div class='gm-du-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)}</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar'}</small></div>"
            )
        if cards:
            st.markdown("<div class='gm-du-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        tudo_ok = linhas_ok and meses_ok and abs(dif_total) <= 0.02
        estado['ok'][sup] = tudo_ok
        if tudo_ok:
            st.success('Distribuição por departamento fechada no total e em todos os meses.')
        else:
            st.warning('Ainda existem diferenças no total ou no fechamento mensal dos departamentos.')
        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        ctx = _ctx(); sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_dep_'):
            label = 'Usar sugestão do histórico'
        elif key.startswith('gm2_save_dep_'):
            label = 'Salvar departamentos e avançar para RCAs →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
