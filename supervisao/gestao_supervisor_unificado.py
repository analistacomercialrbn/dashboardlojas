import inspect

import pandas as pd
import streamlit as st

import gestao_metas as gm
from gestao_rounding import (
    initialize_matrix, num, pct, rounded_months,
    sync_general_from_pct, sync_general_from_value, sync_month_from_value,
)


def _fmt(v):
    return f"R$ {num(v):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


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


def aplicar_supervisores_unificados():
    st.markdown(
        """
        <style>
        .gm-su-head{display:grid;grid-template-columns:1.75fr .72fr .7fr .8fr 1fr repeat(3,.66fr .92fr) .78fr;gap:8px;padding:0 10px 7px;align-items:end}
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
        meta_ciclo = sum(num(meta_mensal.get(str(m))) for m in meses) or num(cycle.get('meta_global'))
        sups = cycle.setdefault('supervisores', {})
        saida = data.copy()

        items = []
        for _, row in data.reset_index(drop=True).iterrows():
            sup = str(row.get('Supervisor', 'Supervisor'))
            rec = sups.setdefault(sup, {})
            base = num(row.get('Meta sugerida')) or num(rec.get('proposta')) or num(row.get('Meta definida')) or (meta_ciclo * num(row.get('Participação ref. %')) / 100.0)
            items.append((sup, rec, base))
        initialize_matrix(items, meta_ciclo, meta_mensal, meses, marker='round_months_v2')

        st.caption('A meta do ciclo e os meses já vêm sugeridos em valores redondos. Você pode editar a % geral, o valor do ciclo ou qualquer mês; as porcentagens mensais são recalculadas automaticamente.')

        st.markdown(
            "<div class='gm-su-head'><span>Supervisor</span><span>Histórico</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_geral = 0.0
        soma_meta = 0.0
        soma_mes = {str(m): 0.0 for m in meses}
        linhas_ok = True

        for idx, row in data.reset_index(drop=True).iterrows():
            sup = str(row.get('Supervisor', 'Supervisor'))
            rec = sups[sup]
            part_ref = num(row.get('Participação ref. %'))
            hist = num(row.get('Hist. recente'))

            pct_key = f'gm_su_geral_v4_{key}_{idx}'
            val_key = f'gm_su_val_v4_{key}_{idx}'

            def on_pct(rec=rec, pct_key=pct_key, val_key=val_key):
                sync_general_from_pct(rec, st.session_state.get(pct_key), meta_ciclo)
                rec['mensal'] = rounded_months(rec['meta_ciclo_alvo'], meta_mensal, meses)
                rec['percentual_mensal'] = {str(m): pct(rec['mensal'][str(m)], meta_mensal.get(str(m))) for m in meses}
                st.session_state[val_key] = rec['meta_ciclo_alvo']

            def on_val(rec=rec, pct_key=pct_key, val_key=val_key):
                sync_general_from_value(rec, st.session_state.get(val_key), meta_ciclo)
                rec['mensal'] = rounded_months(rec['meta_ciclo_alvo'], meta_mensal, meses)
                rec['percentual_mensal'] = {str(m): pct(rec['mensal'][str(m)], meta_mensal.get(str(m))) for m in meses}
                st.session_state[pct_key] = rec['percentual_geral']

            with st.container(border=True):
                cols = st.columns([1.75,.72,.7,.8,1]+sum(([.66,.92] for _ in meses),[])+[.78], vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-su-name'>{sup}</div><div class='gm-su-sub'>Participação no faturamento do ciclo</div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-su-val'><strong>{_fmt(hist)}</strong><span>histórico</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    st.markdown(f"<div class='gm-su-val'><strong>{part_ref:.2f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[3]:
                    pg = st.number_input(f'% geral • {sup}', min_value=0.0, max_value=100.0, value=num(rec.get('percentual_geral')), step=0.01, format='%.2f', key=pct_key, on_change=on_pct, label_visibility='collapsed')
                with cols[4]:
                    vg = st.number_input(f'Meta ciclo • {sup}', min_value=0.0, value=num(rec.get('meta_ciclo_alvo')), step=1000.0, format='%.2f', key=val_key, on_change=on_val, label_visibility='collapsed')

                rec['percentual_geral'] = num(pg)
                rec['meta_ciclo_alvo'] = num(vg)
                soma_geral += rec['percentual_geral']
                soma_meta += rec['meta_ciclo_alvo']

                mensal = rec.setdefault('mensal', {})
                pcts = rec.setdefault('percentual_mensal', {})
                pos = 5
                for m in meses:
                    pcts[str(m)] = pct(mensal.get(str(m)), meta_mensal.get(str(m)))
                    with cols[pos]:
                        st.markdown(f"<div class='gm-su-val'><strong>{pcts[str(m)]:.2f}%</strong><span>calculada</span></div>", unsafe_allow_html=True)
                    mkey = f'gm_su_mesval_v4_{key}_{idx}_{m}'

                    def on_mes(rec=rec, m=m, mkey=mkey):
                        sync_month_from_value(rec, m, st.session_state.get(mkey), meta_mensal.get(str(m)))

                    with cols[pos+1]:
                        mv = st.number_input(f'{gm.MESES[m]} R$ • {sup}', min_value=0.0, value=num(mensal.get(str(m))), step=1000.0, format='%.2f', key=mkey, on_change=on_mes, label_visibility='collapsed')
                    mensal[str(m)] = round(num(mv), 2)
                    pcts[str(m)] = pct(mensal[str(m)], meta_mensal.get(str(m)))
                    soma_mes[str(m)] += mensal[str(m)]
                    pos += 2

                realizado = round(sum(num(mensal.get(str(m))) for m in meses), 2)
                rec['proposta'] = rec['meta_ciclo_alvo']
                saida.loc[saida.index[idx], 'Meta definida'] = rec['meta_ciclo_alvo']
                ok_linha = abs(realizado - rec['meta_ciclo_alvo']) <= 0.02
                linhas_ok = linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-su-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar meses'}</div>", unsafe_allow_html=True)

        cards = []
        meses_ok = True
        for m in meses:
            alvo = round(num(meta_mensal.get(str(m))), 2)
            soma = round(soma_mes[str(m)], 2)
            p = pct(soma, alvo)
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(f"<div class='gm-su-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)} • {p:.2f}%</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Dif. '+_fmt(alvo-soma)}</small></div>")
        if cards:
            st.markdown("<div class='gm-su-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        geral_ok = abs(soma_meta - meta_ciclo) <= 0.02
        if geral_ok and meses_ok and linhas_ok:
            st.success('Metas do ciclo e valores mensais fechados.')
        else:
            st.warning(f'Metas do ciclo: {_fmt(soma_meta)} de {_fmt(meta_ciclo)}. Os meses também precisam fechar exatamente com as metas mensais da empresa.')

        return saida

    st.data_editor = data_editor
