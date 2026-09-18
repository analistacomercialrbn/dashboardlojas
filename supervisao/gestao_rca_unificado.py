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


def _participacoes(data):
    vals = pd.to_numeric(data.get('Participação ref. %'), errors='coerce').fillna(0)
    soma = float(vals.sum())
    if soma <= 0:
        n = len(data)
        return {str(int(r['COD_RCA'])): (100 / n if n else 0) for _, r in data.iterrows()}
    return {str(int(r['COD_RCA'])): 100 * float(v) / soma for (_, r), v in zip(data.iterrows(), vals)}


def _deps_ativos(srec, meses):
    deps = []
    for nome, rec in (srec.get('departamentos') or {}).items():
        mensal = rec.get('mensal') or {}
        if num(rec.get('meta_ciclo_alvo')) > 0 or num(rec.get('proposta')) > 0 or any(num(mensal.get(str(m))) > 0 for m in meses):
            deps.append(str(nome))
    return deps


def _init_dep_matrix(rr, deps, srec, meses, marker):
    parent_total = num(rr.get('meta_ciclo_alvo')) or num(rr.get('proposta'))
    parent_months = rr.get('mensal') or rr.get('mensal_alvo') or {}
    items = []
    for dep in deps:
        rd = rr.setdefault('departamentos', {}).setdefault(dep, {})
        sup_dep = (srec.get('departamentos') or {}).get(dep) or {}
        base_pct = num(sup_dep.get('percentual_geral'))
        base = parent_total * base_pct / 100.0
        items.append((dep, rd, base))
    initialize_matrix(items, parent_total, parent_months, meses, marker=marker)


def aplicar_rcas_unificados():
    st.markdown(
        """
        <style>
        .gm-ru-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:8px 0 12px}.gm-ru-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-ru-title{font-size:17px;font-weight:900;color:#1e2655}.gm-ru-sub{font-size:10px;color:#858b99;margin-top:3px}.gm-ru-meta{text-align:right}.gm-ru-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-ru-meta strong{font-size:18px;color:#1e2655}
        .gm-ru-head{display:grid;grid-template-columns:1.72fr .68fr .78fr .98fr repeat(3,.64fr .88fr) .78fr;gap:8px;padding:0 10px 7px;align-items:end}.gm-ru-head span,.gm-ru-dep-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;text-align:center}.gm-ru-head span:first-child,.gm-ru-dep-head span:first-child{text-align:left}
        .gm-ru-name{font-size:12px;font-weight:900;color:#1e2655}.gm-ru-subline{font-size:8px;color:#8b91a0;margin-top:4px}.gm-ru-val{text-align:center}.gm-ru-val strong{font-size:10px;color:#30384d;display:block}.gm-ru-val span{font-size:8px;color:#9096a4}
        .gm-ru-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center}.gm-ru-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-ru-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-ru-detail{background:#fff;border:1px solid #e3e7ef;border-radius:16px;padding:14px 16px;margin:14px 0 10px}.gm-ru-detail-title{font-size:14px;font-weight:900;color:#1e2655}.gm-ru-detail-sub{font-size:10px;color:#818897;margin-top:2px}
        .gm-ru-dep-head{display:grid;grid-template-columns:1.72fr .78fr .98fr repeat(3,.64fr .88fr) .78fr;gap:8px;padding:0 10px 7px;align-items:end}
        .gm-ru-summary,.gm-ru-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}.gm-ru-box,.gm-ru-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-ru-box span,.gm-ru-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-ru-box strong,.gm-ru-total strong{display:block;font-size:14px;color:#1e2655;margin-top:2px}.gm-ru-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1250px){.gm-ru-head,.gm-ru-dep-head{display:none}.gm-ru-summary,.gm-ru-total{grid-template-columns:1fr}.gm-ru-meta{text-align:left}}
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
        sup_mensal = srec.get('mensal') or {}
        meta_sup = num(srec.get('meta_ciclo_alvo')) or sum(num(sup_mensal.get(str(m))) for m in meses) or num(srec.get('proposta'))
        rcas = srec.setdefault('rcas', {})
        deps = _deps_ativos(srec, meses)
        saida = data.copy()

        if not deps:
            st.warning('Primeiro distribua a meta do supervisor entre os departamentos.')
            return data_editor_prev(data, *args, **kwargs)

        refs = _participacoes(saida)
        items = []
        for _, row in saida.reset_index(drop=True).iterrows():
            cod = str(int(row['COD_RCA']))
            nome = str(row.get('RCA', 'RCA'))
            rr = rcas.setdefault(cod, {'rca': nome})
            rr['rca'] = nome
            base = num(row.get('Meta sugerida')) or num(rr.get('proposta')) or num(row.get('Meta proposta')) or (meta_sup * refs.get(cod, 0.0) / 100.0)
            items.append((cod, rr, base))
        initialize_matrix(items, meta_sup, sup_mensal, meses, marker='round_months_v2')

        # Pré-preenche também os departamentos de todos os RCAs para o fechamento já nascer utilizável.
        for cod, rr, _ in items:
            _init_dep_matrix(rr, deps, srec, meses, marker='round_dep_months_v2')

        st.markdown(
            f"<div class='gm-ru-panel'><div class='gm-ru-panel-top'><div>"
            f"<div class='gm-ru-title'>Participação dos RCAs</div>"
            f"<div class='gm-ru-sub'>Meta do ciclo e meses já vêm em valores redondos. Edite R$ quando precisar; as porcentagens mensais são recalculadas.</div>"
            f"</div><div class='gm-ru-meta'><span>Meta do supervisor no ciclo</span><strong>{_fmt(meta_sup)}</strong></div></div></div>",
            unsafe_allow_html=True,
        )

        st.markdown(
            "<div class='gm-ru-head'><span>RCA</span><span>Ref. %</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_meta = 0.0
        soma_mes = {str(m): 0.0 for m in meses}
        rcas_linhas_ok = True

        for idx, row in saida.reset_index(drop=True).iterrows():
            cod = str(int(row['COD_RCA']))
            nome = str(row.get('RCA', 'RCA'))
            rr = rcas[cod]
            ref = refs.get(cod, num(row.get('Participação ref. %')))

            pct_key = f'gm_ru_geral_v4_{key}_{idx}'
            val_key = f'gm_ru_val_v4_{key}_{idx}'

            def on_pct(rr=rr, pct_key=pct_key, val_key=val_key):
                sync_general_from_pct(rr, st.session_state.get(pct_key), meta_sup)
                rr['mensal'] = rounded_months(rr['meta_ciclo_alvo'], sup_mensal, meses)
                rr['percentual_mensal'] = {str(m): pct(rr['mensal'][str(m)], sup_mensal.get(str(m))) for m in meses}
                rr['mensal_alvo'] = dict(rr['mensal'])
                st.session_state[val_key] = rr['meta_ciclo_alvo']

            def on_val(rr=rr, pct_key=pct_key, val_key=val_key):
                sync_general_from_value(rr, st.session_state.get(val_key), meta_sup)
                rr['mensal'] = rounded_months(rr['meta_ciclo_alvo'], sup_mensal, meses)
                rr['percentual_mensal'] = {str(m): pct(rr['mensal'][str(m)], sup_mensal.get(str(m))) for m in meses}
                rr['mensal_alvo'] = dict(rr['mensal'])
                st.session_state[pct_key] = rr['percentual_geral']

            with st.container(border=True):
                cols = st.columns([1.72,.68,.78,.98]+sum(([.64,.88] for _ in meses),[])+[.78], vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-name'>{nome}</div><div class='gm-ru-subline'>Código {cod}</div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-ru-val'><strong>{ref:.2f}%</strong><span>referência</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    pg = st.number_input(f'% geral • {nome}', min_value=0.0, max_value=100.0, value=num(rr.get('percentual_geral')), step=0.01, format='%.2f', key=pct_key, on_change=on_pct, label_visibility='collapsed')
                with cols[3]:
                    vg = st.number_input(f'Meta ciclo • {nome}', min_value=0.0, value=num(rr.get('meta_ciclo_alvo')), step=1000.0, format='%.2f', key=val_key, on_change=on_val, label_visibility='collapsed')

                rr['percentual_geral'] = num(pg)
                rr['meta_ciclo_alvo'] = num(vg)
                soma_meta += rr['meta_ciclo_alvo']

                mensal = rr.setdefault('mensal', {})
                pcts = rr.setdefault('percentual_mensal', {})
                pos = 4
                for m in meses:
                    pcts[str(m)] = pct(mensal.get(str(m)), sup_mensal.get(str(m)))
                    with cols[pos]:
                        st.markdown(f"<div class='gm-ru-val'><strong>{pcts[str(m)]:.2f}%</strong><span>calculada</span></div>", unsafe_allow_html=True)
                    mkey = f'gm_ru_mesval_v4_{key}_{idx}_{m}'

                    def on_mes(rr=rr, m=m, mkey=mkey):
                        sync_month_from_value(rr, m, st.session_state.get(mkey), sup_mensal.get(str(m)))
                        rr['mensal_alvo'] = dict(rr.get('mensal') or {})

                    with cols[pos+1]:
                        mv = st.number_input(f'{gm.MESES[m]} R$ • {nome}', min_value=0.0, value=num(mensal.get(str(m))), step=1000.0, format='%.2f', key=mkey, on_change=on_mes, label_visibility='collapsed')
                    mensal[str(m)] = round(num(mv), 2)
                    pcts[str(m)] = pct(mensal[str(m)], sup_mensal.get(str(m)))
                    soma_mes[str(m)] += mensal[str(m)]
                    pos += 2

                rr['mensal_alvo'] = dict(mensal)
                realizado = round(sum(num(mensal.get(str(m))) for m in meses), 2)
                rr['proposta'] = rr['meta_ciclo_alvo']
                saida.loc[saida.index[idx], 'Meta proposta'] = rr['meta_ciclo_alvo']
                ok_linha = abs(realizado - rr['meta_ciclo_alvo']) <= 0.02
                rcas_linhas_ok = rcas_linhas_ok and ok_linha
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok_linha else 'warn'}'>{'✓ Fechado' if ok_linha else 'Ajustar meses'}</div>", unsafe_allow_html=True)

        meses_rca_ok = True
        cards = []
        for m in meses:
            alvo = round(num(sup_mensal.get(str(m))), 2)
            soma = round(soma_mes[str(m)], 2)
            p = pct(soma, alvo)
            ok = abs(soma - alvo) <= 0.02
            meses_rca_ok = meses_rca_ok and ok
            cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]} • RCAs</span><strong>{_fmt(soma)} • {p:.2f}%</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Dif. '+_fmt(alvo-soma)}</small></div>")
        st.markdown("<div class='gm-ru-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)

        st.markdown(
            "<div class='gm-ru-detail'><div class='gm-ru-detail-title'>Departamentos dentro do RCA</div>"
            "<div class='gm-ru-detail-sub'>Os departamentos também vêm com metas mensais arredondadas. O valor em R$ é editável e a porcentagem é calculada automaticamente.</div></div>",
            unsafe_allow_html=True,
        )

        opcoes = [f"{int(r['COD_RCA'])} - {r['RCA']}" for _, r in saida.iterrows()]
        escolha = st.selectbox('RCA para distribuir departamentos', opcoes, key=f'gm_ru_detail_rca_v4_{key}_{sup}')
        cod_sel = escolha.split(' - ', 1)[0]
        rr = rcas[cod_sel]
        parent_total = num(rr.get('meta_ciclo_alvo'))
        parent_months = rr.get('mensal') or {}
        _init_dep_matrix(rr, deps, srec, meses, marker='round_dep_months_v2')

        st.markdown(
            "<div class='gm-ru-dep-head'><span>Departamento</span><span>% geral</span><span>Meta ciclo R$</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        soma_dep_meta = 0.0
        soma_dep_mes = {str(m): 0.0 for m in meses}
        deps_linhas_ok = True

        for dep_idx, dep in enumerate(deps):
            rd = rr.setdefault('departamentos', {}).setdefault(dep, {})
            pct_key = f'gm_ru_depgeral_v4_{key}_{cod_sel}_{dep_idx}'
            val_key = f'gm_ru_depval_v4_{key}_{cod_sel}_{dep_idx}'

            def on_dep_pct(rd=rd, pct_key=pct_key, val_key=val_key):
                sync_general_from_pct(rd, st.session_state.get(pct_key), parent_total)
                rd['mensal'] = rounded_months(rd['meta_ciclo_alvo'], parent_months, meses)
                rd['percentual_mensal'] = {str(m): pct(rd['mensal'][str(m)], parent_months.get(str(m))) for m in meses}
                st.session_state[val_key] = rd['meta_ciclo_alvo']

            def on_dep_val(rd=rd, pct_key=pct_key, val_key=val_key):
                sync_general_from_value(rd, st.session_state.get(val_key), parent_total)
                rd['mensal'] = rounded_months(rd['meta_ciclo_alvo'], parent_months, meses)
                rd['percentual_mensal'] = {str(m): pct(rd['mensal'][str(m)], parent_months.get(str(m))) for m in meses}
                st.session_state[pct_key] = rd['percentual_geral']

            with st.container(border=True):
                cols = st.columns([1.72,.78,.98]+sum(([.64,.88] for _ in meses),[])+[.78], vertical_alignment='center', gap='small')
                with cols[0]:
                    st.markdown(f"<div class='gm-ru-name'>{dep}</div><div class='gm-ru-subline'>Composição da meta do RCA</div>", unsafe_allow_html=True)
                with cols[1]:
                    pg = st.number_input(f'% geral • {dep}', min_value=0.0, max_value=100.0, value=num(rd.get('percentual_geral')), step=0.01, format='%.2f', key=pct_key, on_change=on_dep_pct, label_visibility='collapsed')
                with cols[2]:
                    vg = st.number_input(f'Meta ciclo • {dep}', min_value=0.0, value=num(rd.get('meta_ciclo_alvo')), step=1000.0, format='%.2f', key=val_key, on_change=on_dep_val, label_visibility='collapsed')

                rd['percentual_geral'] = num(pg)
                rd['meta_ciclo_alvo'] = num(vg)
                soma_dep_meta += rd['meta_ciclo_alvo']

                mensal_dep = rd.setdefault('mensal', {})
                pct_dep = rd.setdefault('percentual_mensal', {})
                pos = 3
                for m in meses:
                    pct_dep[str(m)] = pct(mensal_dep.get(str(m)), parent_months.get(str(m)))
                    with cols[pos]:
                        st.markdown(f"<div class='gm-ru-val'><strong>{pct_dep[str(m)]:.2f}%</strong><span>calculada</span></div>", unsafe_allow_html=True)
                    mkey = f'gm_ru_depmesval_v4_{key}_{cod_sel}_{dep_idx}_{m}'

                    def on_dep_mes(rd=rd, m=m, mkey=mkey):
                        sync_month_from_value(rd, m, st.session_state.get(mkey), parent_months.get(str(m)))

                    with cols[pos+1]:
                        mv = st.number_input(f'{gm.MESES[m]} R$ • {dep}', min_value=0.0, value=num(mensal_dep.get(str(m))), step=1000.0, format='%.2f', key=mkey, on_change=on_dep_mes, label_visibility='collapsed')
                    mensal_dep[str(m)] = round(num(mv), 2)
                    pct_dep[str(m)] = pct(mensal_dep[str(m)], parent_months.get(str(m)))
                    soma_dep_mes[str(m)] += mensal_dep[str(m)]
                    pos += 2

                realizado_dep = round(sum(num(mensal_dep.get(str(m))) for m in meses), 2)
                rd['proposta'] = rd['meta_ciclo_alvo']
                ok_dep = abs(realizado_dep - rd['meta_ciclo_alvo']) <= 0.02
                deps_linhas_ok = deps_linhas_ok and ok_dep
                with cols[-1]:
                    st.markdown(f"<div class='gm-ru-status {'ok' if ok_dep else 'warn'}'>{'✓ Fechado' if ok_dep else 'Ajustar meses'}</div>", unsafe_allow_html=True)

        valor_dep_ok = abs(soma_dep_meta - parent_total) <= 0.02
        meses_dep_ok = True
        dep_cards = []
        for m in meses:
            alvo = round(num(parent_months.get(str(m))), 2)
            soma = round(soma_dep_mes[str(m)], 2)
            p = pct(soma, alvo)
            ok = abs(soma - alvo) <= 0.02
            meses_dep_ok = meses_dep_ok and ok
            dep_cards.append(f"<div class='gm-ru-box'><span>{gm.MESES[m]} • departamentos</span><strong>{_fmt(soma)} • {p:.2f}%</strong><small>Alvo {_fmt(alvo)} • {'Fechado' if ok else 'Dif. '+_fmt(alvo-soma)}</small></div>")
        st.markdown("<div class='gm-ru-summary'>" + ''.join(dep_cards) + "</div>", unsafe_allow_html=True)

        st.markdown('##### Conferência dos departamentos entre os RCAs')
        fechamento_ok = True
        rows = []
        for dep in deps:
            dep_rec = (srec.get('departamentos') or {}).get(dep, {})
            dep_mensal = dep_rec.get('mensal') or {}
            item = {'Departamento': dep}
            dep_ok = True
            for m in meses:
                soma = round(sum(num((((rrec.get('departamentos') or {}).get(dep) or {}).get('mensal') or {}).get(str(m))) for rrec in rcas.values()), 2)
                alvo = round(num(dep_mensal.get(str(m))), 2)
                item[gm.MESES[m]] = soma
                item[f'Dif. {gm.MESES[m]}'] = round(alvo - soma, 2)
                if abs(soma - alvo) > 0.02:
                    dep_ok = False
            item['Status'] = '✓ Fechado' if dep_ok else 'Ajustar'
            fechamento_ok = fechamento_ok and dep_ok
            rows.append(item)
        if rows:
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        total = round(soma_meta, 2)
        dif_total = round(meta_sup - total, 2)
        st.markdown(
            f"<div class='gm-ru-total'><div><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div>"
            f"<div><span>Distribuído aos RCAs</span><strong>{_fmt(total)}</strong></div>"
            f"<div><span>Diferença</span><strong>{_fmt(dif_total)}</strong></div></div>",
            unsafe_allow_html=True,
        )

        tudo_ok = (
            abs(dif_total) <= 0.02 and meses_rca_ok and rcas_linhas_ok
            and valor_dep_ok and meses_dep_ok and deps_linhas_ok and fechamento_ok
        )
        estado['ok'][sup] = tudo_ok
        if tudo_ok:
            st.success('RCAs e departamentos fechados com valores mensais arredondados.')
        else:
            st.warning('Ajuste os valores do ciclo ou dos meses até fechar os RCAs e os departamentos.')
        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        ctx = _ctx()
        sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_rca_'):
            label = 'Usar participação de referência'
        elif key.startswith('gm2_save_rca_'):
            label = 'Salvar RCAs e avançar para Aprovação →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
