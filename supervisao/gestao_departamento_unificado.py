import inspect
import unicodedata

import pandas as pd
import streamlit as st

import gestao_metas as gm
from gestao_rounding import (
    initialize_matrix, num, pct, rounded_months,
    sync_general_from_pct, sync_general_from_value, sync_month_from_value,
)

DEPARTAMENTOS_META = [
    'AGRICULTURA','SAUDE ANIMAL','NUTRICAO - RUMINANTES',
    'NUTRICAO - MONOGASTRICOS','MIX REVENDA','ORDENHA'
]
OUTROS = 'OUTROS'


def _fmt(v):
    return f"R$ {num(v):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _normalizar(txt):
    s = str(txt or '').strip().upper()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    return ' '.join(s.replace('–', '-').replace('—', '-').split())


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


def _linha_vazia(nome):
    return {
        'Departamento': nome, 'Hist. recente': 0.0, 'Hist. A-1': 0.0,
        'Participação ref. %': 0.0, 'Meta sugerida': 0.0, 'Meta proposta': 0.0
    }


def _filtrar(data, deps, incluir_outros):
    base = data.copy()
    base['_norm'] = base['Departamento'].map(_normalizar)
    linhas = []

    for nome in DEPARTAMENTOS_META:
        encontrados = base[base['_norm'].eq(_normalizar(nome))]
        if encontrados.empty:
            row = _linha_vazia(nome)
        else:
            r = encontrados.iloc[0]
            row = {c: r.get(c, 0) for c in data.columns}
            row['Departamento'] = nome
        deps.setdefault(nome, {})
        linhas.append(row)

    if incluir_outros:
        deps.setdefault(OUTROS, {})
        linhas.append(_linha_vazia(OUTROS))
    else:
        deps.pop(OUTROS, None)

    saida = pd.DataFrame(linhas)
    for col in data.columns:
        if col not in saida.columns:
            saida[col] = 0.0
    return saida[data.columns]


def aplicar_departamentos_unificados():
    st.markdown(
        """
        <style>
        .gm-du-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:6px 0 12px}.gm-du-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-du-panel-title{font-size:17px;font-weight:900;color:#1e2655}.gm-du-panel-sub{font-size:10px;color:#858b99;margin-top:3px}.gm-du-panel-meta{text-align:right}.gm-du-panel-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-du-panel-meta strong{font-size:18px;color:#1e2655}
        .gm-du-head{display:grid;grid-template-columns:1.8fr .7fr .8fr 1fr repeat(3,.66fr .92fr) .78fr;gap:8px;padding:0 10px 7px;align-items:end}.gm-du-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-du-head span:first-child{text-align:left}
        .gm-du-name{font-size:12px;font-weight:900;color:#1e2655}.gm-du-sub{font-size:8px;color:#8b91a0;margin-top:4px}.gm-du-val{text-align:center}.gm-du-val strong{font-size:10px;color:#30384d;display:block}.gm-du-val span{font-size:8px;color:#9096a4}
        .gm-du-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-du-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-du-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-du-summary,.gm-du-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}.gm-du-box,.gm-du-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-du-box span,.gm-du-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-box strong,.gm-du-total strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-du-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1250px){.gm-du-head{display:none}.gm-du-summary,.gm-du-total{grid-template-columns:1fr}.gm-du-panel-meta{text-align:left}}
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
        sup_mensal = srec.get('mensal') or {}
        meta_sup = sum(num(sup_mensal.get(str(m))) for m in meses) or num(srec.get('proposta'))
        deps = srec.setdefault('departamentos', {})

        incluir_outros = st.toggle(
            'Incluir Outros',
            value=OUTROS in deps,
            key=f'gm_du_outros_v4_{key}_{sup}',
            help='Reserva parte da meta para departamentos sem meta formal.'
        )
        saida = _filtrar(data, deps, incluir_outros)

        items = []
        for _, row in saida.reset_index(drop=True).iterrows():
            dep = str(row.get('Departamento', 'Departamento'))
            rec = deps.setdefault(dep, {})
            base = num(row.get('Meta sugerida')) or num(rec.get('proposta')) or num(row.get('Meta proposta')) or (meta_sup * num(row.get('Participação ref. %')) / 100.0)
            items.append((dep, rec, base))
        initialize_matrix(items, meta_sup, sup_mensal, meses, marker='round_months_v2')

        st.markdown(
            f"<div class='gm-du-panel'><div class='gm-du-panel-top'><div>"
            f"<div class='gm-du-panel-title'>Participação dos departamentos</div>"
            f"<div class='gm-du-panel-sub'>Meta do ciclo e meses já vêm sugeridos em valores redondos. Edite R$ quando quiser; a % mensal acompanha automaticamente.</div>"
            f"</div><div class='gm-du-panel-meta'><span>Meta do supervisor no ciclo</span><strong>{_fmt(meta_sup)}</strong></div></div></div>",
            unsafe_allow_html=True,
        )

        st.markdown(
            "<div class='gm-du-head'><span>Departamento</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_meta = 0.0
        soma_mes = {str(m): 0.0 for m in meses}
        linhas_ok = True

        for idx, row in saida.reset_index(drop=True).iterrows():
            dep = str(row.get('Departamento', 'Departamento'))
            rec = deps[dep]
            part_ref = num(row.get('Participação ref. %'))

            pct_key = f'gm_du_geral_v4_{key}_{idx}'
            val_key = f'gm_du_val_v4_{key}_{idx}'

            def on_pct(rec=rec, pct_key=pct_key, val_key=val_key):
                sync_general_from_pct(rec, st.session_state.get(pct_key), meta_sup)
                rec['mensal'] = rounded_months(rec['meta_ciclo_alvo'], sup_mensal, meses)
                rec['percentual_mensal'] = {str(m): pct(rec['mensal'][str(m)], sup_mensal.get(str(m))) for m in meses}
                st.session_state[val_key] = rec['meta_ciclo_alvo']

            def on_val(rec=rec, pct_key=pct_key, val_key=val_key):
                sync_general_from_value(rec, st.session_state.get(val_key), meta_sup)
                rec['mensal'] = rounded_months(rec['meta_ciclo_alvo'], sup_mensal, meses)
                rec['percentual_mensal'] = {str(m): pct(rec['mensal'][str(m)], sup_mensal.get(str(m))) for m in meses}
                st.session_state[pct_key] = rec['percentual_geral']

            with st.container(border=True):
                cols = st.columns([1.8,.7,.8,1]+sum(([.66,.92] for _ in meses),[])+[.78], vertical_alignment='center', gap='small')
                with cols[0]:
                    sub = 'Opcional • departamentos sem meta formal' if dep == OUTROS else 'Departamento com meta'
                    st.markdown(f"<div class='gm-du-name'>{dep}</div><div class='gm-du-sub'>{sub}</div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-du-val'><strong>{part_ref:.2f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    pg = st.number_input(f'% geral • {dep}', min_value=0.0, max_value=100.0, value=num(rec.get('percentual_geral')), step=0.01, format='%.2f', key=pct_key, on_change=on_pct, label_visibility='collapsed')
                with cols[3]:
                    vg = st.number_input(f'Meta ciclo • {dep}', min_value=0.0, value=num(rec.get('meta_ciclo_alvo')), step=1000.0, format='%.2f', key=val_key, on_change=on_val, label_visibility='collapsed')

                rec['percentual_geral'] = num(pg)
                rec['meta_ciclo_alvo'] = num(vg)
                soma_meta += rec['meta_ciclo_alvo']

                mensal = rec.setdefault('mensal', {})
                pcts = rec.setdefault('percentual_mensal', {})
                pos = 4
                for m in meses:
                    pcts[str(m)] = pct(mensal.get(str(m)), sup_mensal.get(str(m)))
                    with cols[pos]:
                        st.markdown(f"<div class='gm-du-val'><strong>{pcts[str(m)]:.2f}%</strong><span>calculada</span></div>", unsafe_allow_html=True)
                    mkey = f'gm_du_mesval_v4_{key}_{idx}_{m}'

                    def on_mes(rec=rec, m=m, mkey=mkey):
                        sync_month_from_value(rec, m, st.session_state.get(mkey), sup_mensal.get(str(m)))

                    with cols[pos+1]:
                        mv = st.number_input(f'{gm.MESES[m]} R$ • {dep}', min_value=0.0, value=num(mensal.get(str(m))), step=1000.0, format='%.2f', key=mkey, on_change=on_mes, label_visibility='collapsed')
                    mensal[str(m)] = round(num(mv), 2)
                    pcts[str(m)] = pct(mensal[str(m)], sup_mensal.get(str(m)))
                    soma_mes[str(m)] += mensal[str(m)]
                    pos += 2

                realizado = round(sum(num(mensal.get(str(m))) for m in meses), 2)
                rec['proposta'] = rec['meta_ciclo_alvo']
                saida.loc[saida.index[idx], 'Meta proposta'] = rec['meta_ciclo_alvo']
                ok_linha = abs(realizado - rec['meta_ciclo_alvo']) <= 0.02
                linhas_ok = linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-du-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar meses'}</div>", unsafe_allow_html=True)

        total = round(soma_meta, 2)
        dif_total = round(meta_sup - total, 2)
        st.markdown(
            f"<div class='gm-du-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div>"
            f"<div><span>Distribuído</span><strong>{_fmt(total)}</strong></div>"
            f"<div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",
            unsafe_allow_html=True,
        )

        cards = []
        meses_ok = True
        for m in meses:
            alvo = round(num(sup_mensal.get(str(m))), 2)
            soma = round(soma_mes[str(m)], 2)
            p = pct(soma, alvo)
            ok = abs(soma - alvo) <= 0.02
            meses_ok = meses_ok and ok
            cards.append(f"<div class='gm-du-box'><span>{gm.MESES[m]}</span><strong>{_fmt(soma)} • {p:.2f}%</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Dif. '+_fmt(alvo-soma)}</small></div>")
        if cards:
            st.markdown("<div class='gm-du-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        tudo_ok = abs(dif_total) <= 0.02 and meses_ok and linhas_ok
        estado['ok'][sup] = tudo_ok
        if tudo_ok:
            st.success('Metas do ciclo e valores mensais dos departamentos fechados.')
        else:
            st.warning('Ajuste os valores do ciclo ou dos meses até fechar exatamente a meta do supervisor.')
        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        ctx = _ctx()
        sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_dep_'):
            return False
        if key.startswith('gm2_save_dep_'):
            label = 'Salvar departamentos e avançar para RCAs →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
