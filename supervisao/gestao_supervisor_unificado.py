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


def aplicar_supervisores_unificados():
    """Supervisores são distribuídos por percentual em cada mês; o valor em R$ é calculado."""
    st.markdown(
        """
        <style>
        .gm-su-line-head{display:grid;grid-template-columns:2.05fr 1fr 1fr 1.2fr repeat(3,.85fr 1.18fr) .92fr;gap:10px;padding:0 14px 7px;margin-top:10px;align-items:end}
        .gm-su-line-head span{font-size:8px;color:#8f96a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center;white-space:nowrap}.gm-su-line-head span:first-child{text-align:left}
        .gm-su-namebox{min-height:52px;display:flex;flex-direction:column;justify-content:center}.gm-su-name{font-size:13px;font-weight:900;color:#1e2655}.gm-su-sub{font-size:9px;color:#8b91a0;margin-top:4px}
        .gm-su-valuebox{min-height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.gm-su-valuebox strong{font-size:11px;color:#30384d;white-space:nowrap}.gm-su-valuebox span{font-size:8px;color:#8f96a6;margin-top:2px}
        .gm-su-status{border-radius:10px;padding:8px 5px;font-size:9px;font-weight:800;text-align:center;white-space:nowrap}.gm-su-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-su-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-su-month-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 4px}.gm-su-month-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:9px 11px}.gm-su-month-box span{display:block;font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-su-month-box strong{display:block;font-size:12px;color:#1e2655;margin-top:2px}.gm-su-month-box small{font-size:8px;color:#8a90a0}
        @media(max-width:1200px){.gm-su-line-head{display:none}.gm-su-month-summary{grid-template-columns:1fr}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_prev = st.data_editor
    estado = {'ok': True}

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

        st.caption('Digite a participação % de cada supervisor em cada mês. O valor em R$ é calculado automaticamente sobre a meta mensal da empresa.')

        st.markdown(
            "<div class='gm-su-line-head'><span>Supervisor</span><span>Histórico</span><span>Sugerida</span><span>Meta total</span>"
            + ''.join(f"<span>{gm.MESES[m]} %</span><span>{gm.MESES[m]} R$</span>" for m in meses)
            + "<span>Status</span></div>",
            unsafe_allow_html=True,
        )

        pct_somas = {str(m): 0.0 for m in meses}
        for idx, row in data.reset_index(drop=True).iterrows():
            sup = str(row.get('Supervisor', 'Supervisor'))
            rec = sups.setdefault(sup, {})
            part_ref = _num(row.get('Participação ref. %'))
            hist = _num(row.get('Hist. recente'))
            sugerida = _num(row.get('Meta sugerida'))
            mensal = rec.setdefault('mensal', {})
            pct = rec.setdefault('percentual_mensal', {})

            for m in meses:
                if str(m) not in pct:
                    alvo = _num(meta_mensal.get(str(m)))
                    pct[str(m)] = (100 * _num(mensal.get(str(m))) / alvo) if alvo else part_ref

            with st.container(border=True):
                specs = [2.05, 1, 1, 1.2] + sum(([.85, 1.18] for _ in meses), []) + [.92]
                cols = st.columns(specs, gap='small', vertical_alignment='center')
                with cols[0]:
                    st.markdown(f"<div class='gm-su-namebox'><div class='gm-su-name'>{sup}</div><div class='gm-su-sub'>{part_ref:.1f}% de referência histórica</div></div>", unsafe_allow_html=True)
                with cols[1]:
                    st.markdown(f"<div class='gm-su-valuebox'><strong>{_fmt(hist)}</strong><span>histórico</span></div>", unsafe_allow_html=True)
                with cols[2]:
                    st.markdown(f"<div class='gm-su-valuebox'><strong>{_fmt(sugerida)}</strong><span>sugerida</span></div>", unsafe_allow_html=True)

                novos = {}
                pos = 4
                for m in meses:
                    with cols[pos]:
                        novos[str(m)] = st.number_input(
                            f'{gm.MESES[m]} % • {sup}', min_value=0.0, max_value=100.0,
                            value=_num(pct.get(str(m))), step=1.0, format='%.2f',
                            key=f'gm_su_pct_{key}_{idx}_{m}', label_visibility='collapsed'
                        )
                    pct[str(m)] = float(novos[str(m)])
                    pct_somas[str(m)] += float(novos[str(m)])
                    valor = _num(meta_mensal.get(str(m))) * float(novos[str(m)]) / 100.0
                    mensal[str(m)] = valor
                    with cols[pos + 1]:
                        st.markdown(f"<div class='gm-su-valuebox'><strong>{_fmt(valor)}</strong><span>calculado</span></div>", unsafe_allow_html=True)
                    pos += 2

                total_novo = sum(_num(mensal.get(str(m))) for m in meses)
                rec['mensal'] = {str(m): _num(mensal.get(str(m))) for m in meses}
                rec['proposta'] = total_novo
                saida.loc[saida.index[idx], 'Meta definida'] = total_novo
                with cols[3]:
                    st.markdown(f"<div class='gm-su-valuebox'><strong>{_fmt(total_novo)}</strong><span>total calculado</span></div>", unsafe_allow_html=True)
                with cols[-1]:
                    st.markdown("<div class='gm-su-status ok'>Calculado<br>por %</div>", unsafe_allow_html=True)

        st.divider()
        st.markdown('##### Fechamento da participação dos supervisores')
        cards = []
        tudo_ok = True
        for m in meses:
            soma_pct = pct_somas[str(m)]
            alvo = _num(meta_mensal.get(str(m)))
            soma_valor = sum(_num((sups.get(str(r['Supervisor']), {}).get('mensal') or {}).get(str(m))) for _, r in saida.iterrows())
            ok = abs(soma_pct - 100) <= 0.01 if alvo > 0 else abs(soma_pct) <= 0.01
            tudo_ok = tudo_ok and ok
            cards.append(f"<div class='gm-su-month-box'><span>{gm.MESES[m]}</span><strong>{soma_pct:.1f}%</strong><small>{_fmt(soma_valor)} de {_fmt(alvo)} • {'Fechado' if ok else 'Ajustar para 100%'}</small></div>")
        st.markdown("<div class='gm-su-month-summary'>" + ''.join(cards) + "</div>", unsafe_allow_html=True)
        estado['ok'] = tudo_ok
        if meses and tudo_ok:
            st.success('Participação dos supervisores fecha 100% em todos os meses.')
        elif meses:
            st.warning('A soma das participações dos supervisores precisa fechar 100% em cada mês.')

        return saida

    st.data_editor = data_editor
