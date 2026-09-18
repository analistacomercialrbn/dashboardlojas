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


def _round_money(v):
    v = _num(v)
    if v <= 0:
        return 0.0
    step = 1000.0 if v < 100000 else (5000.0 if v < 500000 else 10000.0)
    return round(v / step) * step


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


def _sync_months(rec, meses, pct_geral):
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
        .gm-su-head{display:grid;grid-template-columns:1.8fr .75fr .72fr .82fr 1.02fr repeat(3,.65fr .9fr) .8fr;gap:8px;padding:0 11px 7px;align-items:end}
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

        st.caption('A sugestão inicial já vem arredondada. Você pode editar a % geral ou o valor da meta do ciclo; ao alterar um, o outro é recalculado.')

        st.markdown(
            "<div class='gm-su-head'><span>Supervisor</span><span>Histórico</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_geral = 0.0
        soma_meta = 0.0
        soma_mes_pct = {str(m): 0.0 for m in meses}
        linhas_ok = True

        for idx, row in data.reset_index(drop=True).iterrows():
            sup = str(row.get('Supervisor', 'Supervisor'))
            rec = sups.setdefault(sup, {})
            part_ref = _num(row.get('Participação ref. %'))
            hist = _num(row.get('Hist. recente'))
            sugerida = _num(row.get('Meta sugerida'))

            if 'meta_ciclo_alvo' not in rec:
                base = sugerida or _num(rec.get('proposta')) or _num(row.get('Meta definida')) or (meta_ciclo * part_ref / 100.0)
                rec['meta_ciclo_alvo'] = _round_money(base)
                rec['percentual_geral'] = (100 * rec['meta_ciclo_alvo'] / meta_ciclo) if meta_ciclo else part_ref

            pct_key = f'gm_su_geral_v2_{key}_{idx}'
            val_key = f'gm_su_val_v2_{key}_{idx}'

            def on_pct_change(rec=rec, pct_key=pct_key, val_key=val_key, meta_ciclo=meta_ciclo):
                pct = _num(st.session_state.get(pct_key))
                rec['percentual_geral'] = pct
                rec['meta_ciclo_alvo'] = round(meta_ciclo * pct / 100.0, 2)
                st.session_state[val_key] = rec['meta_ciclo_alvo']

            def on_val_change(rec=rec, pct_key=pct_key, val_key=val_key, meta_ciclo=meta_ciclo):
                val = _num(st.session_state.get(val_key))
                rec['meta_ciclo_alvo'] = val
                rec['percentual_geral'] = (100 * val / meta_ciclo) if meta_ciclo else 0.0
                st.session_state[pct_key] = rec['percentual_geral']

            with st.container(border=True):
                cols = st.columns([1.8,.75,.72,.82,1.02]+sum(([.65,.9] for _ in meses),[])+[.8], vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-su-name'>{sup}</div><div class='gm-su-sub'>Participação no faturamento do ciclo</div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-su-val'><strong>{_fmt(hist)}</strong><span>histórico</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    st.markdown(f"<div class='gm-su-val'><strong>{part_ref:.2f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[3]:
                    pct_geral = st.number_input(
                        f'% geral • {sup}', min_value=0.0, max_value=100.0,
                        value=_num(rec.get('percentual_geral')), step=0.01, format='%.2f',
                        key=pct_key, on_change=on_pct_change, label_visibility='collapsed'
                    )
                with cols[4]:
                    meta_alvo = st.number_input(
                        f'Meta ciclo • {sup}', min_value=0.0,
                        value=_num(rec.get('meta_ciclo_alvo')), step=1000.0, format='%.2f',
                        key=val_key, on_change=on_val_change, label_visibility='collapsed'
                    )

                rec['percentual_geral'] = _num(pct_geral)
                rec['meta_ciclo_alvo'] = _num(meta_alvo)
                soma_geral += rec['percentual_geral']
                soma_meta += rec['meta_ciclo_alvo']

                pct_mensal = _sync_months(rec, meses, rec['percentual_geral'])
                mensal = rec.setdefault('mensal', {})
                overrides = rec.setdefault('percentual_mensal_override', {})
                pct_exata_geral = (100 * rec['meta_ciclo_alvo'] / meta_ciclo) if meta_ciclo else 0.0
                pos = 5
                for m in meses:
                    mes_key = f'gm_su_mes_v3_{key}_{idx}_{m}'

                    def on_mes_change(rec=rec, m=m, mes_key=mes_key):
                        rec.setdefault('percentual_mensal_override', {})[str(m)] = True
                        rec.setdefault('percentual_mensal', {})[str(m)] = _num(st.session_state.get(mes_key))

                    valor_exibido = _num(pct_mensal.get(str(m)))
                    if not overrides.get(str(m), False):
                        valor_exibido = pct_exata_geral

                    with cols[pos]:
                        pm = st.number_input(
                            f'{gm.MESES[m]} % • {sup}', min_value=0.0, max_value=100.0,
                            value=valor_exibido, step=0.01, format='%.2f',
                            key=mes_key, on_change=on_mes_change, label_visibility='collapsed'
                        )

                    if overrides.get(str(m), False):
                        pct_usada = float(pm)
                    else:
                        pct_usada = pct_exata_geral
                        pct_mensal[str(m)] = pct_exata_geral

                    soma_mes_pct[str(m)] += pct_usada
                    valor = round(_num(meta_mensal.get(str(m))) * pct_usada / 100.0, 2)
                    mensal[str(m)] = valor
                    with cols[pos+1]:
                        st.markdown(f"<div class='gm-su-val'><strong>{_fmt(valor)}</strong><span>{'ajustado' if overrides.get(str(m), False) else 'herdado da % geral'}</span></div>", unsafe_allow_html=True)
                    pos += 2

                realizado = round(sum(_num(mensal.get(str(m))) for m in meses), 2)
                rec['mensal'] = {str(m): round(_num(mensal.get(str(m))), 2) for m in meses}
                rec['proposta'] = rec['meta_ciclo_alvo']
                saida.loc[saida.index[idx], 'Meta definida'] = rec['meta_ciclo_alvo']

                ok_linha = abs(realizado - rec['meta_ciclo_alvo']) <= 0.02
                linhas_ok = linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-su-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar meses'}</div>", unsafe_allow_html=True)

        cards = []
        meses_ok = True
        for m in meses:
            pct_total = soma_mes_pct[str(m)]
            alvo = _num(meta_mensal.get(str(m)))
            ok = abs(pct_total - 100) <= 0.01 if alvo > 0 else abs(pct_total) <= 0.01
            meses_ok = meses_ok and ok
            cards.append(f"<div class='gm-su-box'><span>{gm.MESES[m]}</span><strong>{pct_total:.2f}%</strong><small>{'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        if cards:
            st.markdown("<div class='gm-su-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        geral_ok = abs(soma_geral - 100) <= 0.01 if meta_ciclo > 0 else True
        valor_ok = abs(soma_meta - meta_ciclo) <= 0.02 if meta_ciclo > 0 else True
        if geral_ok and valor_ok and meses_ok and linhas_ok:
            st.success('Participação geral, valores e distribuição mensal fechados.')
        else:
            st.warning(f'Geral: {soma_geral:.2f}% • Metas do ciclo: {_fmt(soma_meta)} de {_fmt(meta_ciclo)}. Os valores gerais já fecham; ajuste apenas os meses marcados como exceção quando necessário.')

        return saida

    st.data_editor = data_editor
