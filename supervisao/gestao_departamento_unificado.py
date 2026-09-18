import inspect
import unicodedata

import pandas as pd
import streamlit as st

import gestao_metas as gm


DEPARTAMENTOS_META = [
    'AGRICULTURA',
    'SAUDE ANIMAL',
    'NUTRICAO - RUMINANTES',
    'NUTRICAO - MONOGASTRICOS',
    'MIX REVENDA',
    'ORDENHA',
]
OUTROS = 'OUTROS'


def _num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _fmt(v):
    v = _num(v)
    return f"R$ {v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _normalizar(txt):
    s = str(txt or '').strip().upper()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    s = ' '.join(s.replace('–', '-').replace('—', '-').split())
    return s


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


def _linha_vazia(nome):
    return {
        'Departamento': nome,
        'Hist. recente': 0.0,
        'Hist. A-1': 0.0,
        'Participação ref. %': 0.0,
        'Meta sugerida': 0.0,
        'Meta proposta': 0.0,
    }


def _filtrar_departamentos(data, deps, incluir_outros):
    """Mantém apenas os seis departamentos formais e consolida os demais em Outros quando habilitado."""
    base = data.copy()
    base['_norm'] = base['Departamento'].map(_normalizar)

    linhas = []
    usados = set()
    for nome in DEPARTAMENTOS_META:
        encontrados = base[base['_norm'].eq(_normalizar(nome))]
        if encontrados.empty:
            row = _linha_vazia(nome)
        else:
            r = encontrados.iloc[0]
            row = {c: r.get(c, 0) for c in data.columns}
            row['Departamento'] = nome
            usados.update(encontrados.index.tolist())
        rec = deps.setdefault(nome, {})
        if _num(rec.get('proposta')) == 0 and _num(row.get('Meta proposta')) > 0:
            rec['proposta'] = _num(row.get('Meta proposta'))
        row['Meta proposta'] = _num(rec.get('proposta', row.get('Meta proposta')))
        linhas.append(row)

    extras = base.loc[~base.index.isin(usados)].copy()
    extras = extras[~extras['_norm'].eq(_normalizar(OUTROS))]

    # Remove da estrutura operacional departamentos sem meta formal.
    extras_nomes = [str(x) for x in extras['Departamento'].tolist()]
    acumulado_extra = 0.0
    mensal_extra = {}
    for nome in list(deps.keys()):
        if _normalizar(nome) not in {_normalizar(x) for x in DEPARTAMENTOS_META + [OUTROS]}:
            rec = deps.get(nome) or {}
            acumulado_extra += _num(rec.get('proposta'))
            for mk, mv in (rec.get('mensal') or {}).items():
                mensal_extra[str(mk)] = mensal_extra.get(str(mk), 0.0) + _num(mv)
            deps.pop(nome, None)

    if incluir_outros:
        row = _linha_vazia(OUTROS)
        if not extras.empty:
            for col in ['Hist. recente', 'Hist. A-1', 'Meta sugerida', 'Meta proposta']:
                if col in extras.columns:
                    row[col] = float(pd.to_numeric(extras[col], errors='coerce').fillna(0).sum())
            if 'Participação ref. %' in extras.columns:
                row['Participação ref. %'] = float(pd.to_numeric(extras['Participação ref. %'], errors='coerce').fillna(0).sum())

        rec = deps.setdefault(OUTROS, {})
        if _num(rec.get('proposta')) == 0 and acumulado_extra > 0:
            rec['proposta'] = acumulado_extra
        if not rec.get('mensal') and mensal_extra:
            rec['mensal'] = mensal_extra
        row['Meta proposta'] = _num(rec.get('proposta', row.get('Meta proposta')))
        linhas.append(row)
    else:
        deps.pop(OUTROS, None)

    saida = pd.DataFrame(linhas)
    for col in data.columns:
        if col not in saida.columns:
            saida[col] = 0.0
    return saida[data.columns]


def aplicar_departamentos_unificados():
    """Tela operacional de departamentos: seis linhas de meta + Outros opcional."""
    st.markdown(
        """
        <style>
        .gm-du-panel{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:14px 16px;margin:6px 0 12px}
        .gm-du-panel-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .gm-du-panel-title{font-size:17px;font-weight:900;color:#1e2655}.gm-du-panel-sub{font-size:10px;color:#858b99;margin-top:3px}
        .gm-du-panel-meta{text-align:right}.gm-du-panel-meta span{display:block;font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850}.gm-du-panel-meta strong{font-size:18px;color:#1e2655}
        .gm-du-rule{font-size:10px;color:#596174;background:#f7f8fb;border:1px solid #e7e9ef;border-radius:12px;padding:9px 11px;margin:4px 0 10px}
        .gm-du-head{display:grid;grid-template-columns:2.25fr 1.25fr repeat(3,1.18fr) .9fr;gap:12px;padding:0 14px 7px;margin-top:8px;align-items:end}
        .gm-du-head span{font-size:8px;color:#9298a6;text-transform:uppercase;font-weight:850;letter-spacing:.04em;text-align:center}.gm-du-head span:first-child{text-align:left}
        .gm-du-namebox{min-height:48px;display:flex;flex-direction:column;justify-content:center}.gm-du-name{font-size:12px;font-weight:900;color:#1e2655;line-height:1.2}.gm-du-sub{font-size:8px;color:#8b91a0;margin-top:4px}
        .gm-du-status{border-radius:9px;padding:7px 5px;font-size:9px;font-weight:800;text-align:center;line-height:1.25;white-space:nowrap}.gm-du-status.ok{background:#f2faf5;border:1px solid #d7eadf;color:#356b46}.gm-du-status.warn{background:#fff9f0;border:1px solid #eadfc4;color:#816422}
        .gm-du-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0 5px}.gm-du-box{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:10px 12px}.gm-du-box span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-box strong{display:block;font-size:13px;color:#1e2655;margin-top:2px}.gm-du-box small{font-size:8px;color:#8a90a0}
        .gm-du-total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 8px}.gm-du-total>div{background:#fff;border:1px solid #e4e8ef;border-radius:13px;padding:11px 13px}.gm-du-total span{font-size:8px;color:#8e95a4;text-transform:uppercase;font-weight:850}.gm-du-total strong{display:block;font-size:15px;color:#1e2655;margin-top:2px}
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

        outros_existente = _num((deps.get(OUTROS) or {}).get('proposta')) > 0
        incluir_outros = st.toggle(
            'Incluir Outros',
            value=outros_existente,
            key=f'gm_du_outros_{key}_{sup}',
            help='Use somente quando quiser reservar parte da meta para departamentos sem meta formal.',
        )

        saida = _filtrar_departamentos(data, deps, incluir_outros)

        st.markdown(
            f"""
            <div class='gm-du-panel'>
              <div class='gm-du-panel-top'>
                <div>
                  <div class='gm-du-panel-title'>Distribuição por departamento</div>
                  <div class='gm-du-panel-sub'>A tela principal mostra apenas os seis departamentos com meta formal. Outros é opcional.</div>
                </div>
                <div class='gm-du-panel-meta'><span>Meta do supervisor</span><strong>{_fmt(meta_sup)}</strong></div>
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.markdown(
            "<div class='gm-du-rule'>Departamentos de meta: Agricultura, Saúde Animal, Nutrição - Ruminantes, Nutrição - Monogástricos, Mix Revenda e Ordenha.</div>",
            unsafe_allow_html=True,
        )

        with st.expander('Ver referências usadas na sugestão', expanded=False):
            refs = []
            for _, r in saida.iterrows():
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
        for idx, row in saida.reset_index(drop=True).iterrows():
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
                    subtitulo = 'Opcional • departamentos sem meta formal' if dep == OUTROS else 'Departamento com meta'
                    st.markdown(
                        f"<div class='gm-du-namebox'><div class='gm-du-name'>{dep}</div><div class='gm-du-sub'>{subtitulo}</div></div>",
                        unsafe_allow_html=True,
                    )
                with cols[1]:
                    total_novo = st.number_input(
                        'Meta total', min_value=0.0, value=atual, step=10000.0,
                        format='%.2f', key=f'gm_du_total_{key}_{idx}', label_visibility='collapsed'
                    )
                saida.loc[saida.index[idx], 'Meta proposta'] = float(total_novo)
                rec['proposta'] = float(total_novo)

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
        ctx = _ctx()
        sup = str(ctx.get('sup') or '')
        if key.startswith('gm2_auto_dep_'):
            # A análise é feita externamente na dinâmica; evita repovoar departamentos sem meta formal.
            return False
        if key.startswith('gm2_save_dep_'):
            label = 'Salvar departamentos e avançar para RCAs →'
            if sup and estado['ok'].get(sup) is False:
                kwargs['disabled'] = True
        return button_prev(label, *args, **kwargs)

    st.data_editor = data_editor
    st.button = button
