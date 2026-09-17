import copy
import inspect

import pandas as pd
import streamlit as st

import gestao_metas as gm


def _reconciliar(valores_brutos, total, passo=10000):
    alvo = round(float(total) / passo) * passo
    arred = {m: round(float(v) / passo) * passo for m, v in valores_brutos.items()}
    dif = int(round((alvo - sum(arred.values())) / passo))
    residuos = {m: float(valores_brutos[m]) - arred[m] for m in arred}
    while dif > 0:
        for m in sorted(arred, key=lambda x: residuos[x], reverse=True):
            if dif <= 0:
                break
            arred[m] += passo
            dif -= 1
    while dif < 0:
        candidatos = [m for m in sorted(arred, key=lambda x: residuos[x]) if arred[m] >= passo]
        if not candidatos:
            break
        for m in candidatos:
            if dif >= 0:
                break
            arred[m] -= passo
            dif += 1
    return arred, alvo


def _contexto_render():
    frame = inspect.currentframe()
    try:
        atual = frame.f_back
        while atual is not None:
            if atual.f_code.co_name == 'render_gestao_metas':
                return {
                    'vendas': atual.f_locals.get('vendas'),
                    'ativos': atual.f_locals.get('ativos'),
                    'usuario': atual.f_locals.get('usuario'),
                    'brl': atual.f_locals.get('brl'),
                }
            atual = atual.f_back
    finally:
        del frame
    return {}


def _modelo_ciclo(vendas, ativos, ano_meta, meses, meta_informada=0.0):
    if not isinstance(vendas, pd.DataFrame) or not isinstance(ativos, pd.DataFrame):
        return None
    permitidos = set(pd.to_numeric(ativos['COD_RCA'], errors='coerce').dropna().astype('Int64').tolist())
    h = vendas[vendas['FATURADO'] & vendas['DATA_FAT'].notna()].copy()
    if permitidos:
        h = h[h['COD_RCA'].isin(permitidos)]
    h = h[h['DATA_FAT'].dt.year < int(ano_meta)].copy()
    if h.empty or not meses:
        return None

    h['ANO'] = h['DATA_FAT'].dt.year.astype(int)
    h['MES'] = h['DATA_FAT'].dt.month.astype(int)
    anos = sorted(h['ANO'].unique().tolist())[-3:]
    h3 = h[h['ANO'].isin(anos)].copy()
    matriz = h3.groupby(['ANO','MES'])['VALOR'].sum().unstack(fill_value=0).reindex(index=anos, columns=range(1,13), fill_value=0)
    pesos_ano = {a:i+1 for i,a in enumerate(anos)}

    base_mes = {}
    for m in meses:
        existentes = [(a, float(matriz.loc[a,m])) for a in anos if float(matriz.loc[a,m]) > 0]
        if existentes:
            soma_p = sum(pesos_ano[a] for a,_ in existentes)
            media_pond = sum(v * pesos_ano[a] for a,v in existentes) / soma_p
            mediana = float(pd.Series([v for _,v in existentes]).median())
            base_mes[m] = 0.60 * media_pond + 0.40 * mediana
        else:
            base_mes[m] = 0.0

    base_hist = sum(base_mes.values())
    n = len(meses)
    recent_periods = gm._recent_period(vendas, n)
    recent = gm._period_values(vendas, recent_periods, cods=permitidos if permitidos else None)
    recent_total = float(recent['VALOR'].sum()) if not recent.empty else 0.0
    recent_prior_periods = [p - 12 for p in recent_periods]
    recent_prior = gm._period_values(vendas, recent_prior_periods, cods=permitidos if permitidos else None)
    recent_prior_total = float(recent_prior['VALOR'].sum()) if not recent_prior.empty else 0.0
    crescimento_recente = (recent_total / recent_prior_total - 1) if recent_prior_total else 0.0
    crescimento_recente = max(-0.30, min(0.30, crescimento_recente))

    mesmo_periodo_a1 = [pd.Period(f'{int(ano_meta)-1}-{m:02d}', freq='M') for m in meses]
    a1 = gm._period_values(vendas, mesmo_periodo_a1, cods=permitidos if permitidos else None)
    a1_total = float(a1['VALOR'].sum()) if not a1.empty else 0.0

    referencia = base_hist or a1_total or recent_total
    sugestao_total = round((referencia * (1 + 0.50 * crescimento_recente)) / 10000) * 10000
    meta_base = float(meta_informada) if float(meta_informada or 0) > 0 else float(sugestao_total)

    soma_base = sum(base_mes.values()) or 1.0
    pesos = {m: base_mes[m] / soma_base for m in meses}
    bruto = {m: meta_base * pesos[m] for m in meses}
    arred, alvo = _reconciliar(bruto, meta_base)

    ranking = sorted(meses, key=lambda m: base_mes[m], reverse=True)
    qtd_forte = max(1, len(meses)//3)
    fortes = set(ranking[:qtd_forte])
    fracos = set(ranking[-qtd_forte:])
    linhas = []
    for m in meses:
        classe = 'Mês forte' if m in fortes else ('Mês fraco' if m in fracos else 'Mês intermediário')
        linhas.append({
            'Mês': gm.MESES[m],
            'Média histórica': base_mes[m],
            'Peso sugerido %': pesos[m] * 100,
            'Meta sugerida': arred[m],
            'Leitura do modelo': classe,
        })

    return {
        'tabela': pd.DataFrame(linhas),
        'meta_sugerida': float(sugestao_total),
        'meta_base': float(alvo),
        'a1_total': a1_total,
        'recent_total': recent_total,
        'recent_periods': recent_periods,
        'meses': list(meses),
    }


def _desembrulhar(fn, nome):
    atual = fn
    vistos = set()
    for _ in range(16):
        if id(atual) in vistos:
            break
        vistos.add(id(atual))
        if getattr(atual, '__module__', '') != __name__ or getattr(atual, '__name__', '') != nome:
            break
        proximo = None
        for cell in getattr(atual, '__closure__', None) or []:
            try:
                obj = cell.cell_contents
            except Exception:
                continue
            if callable(obj) and getattr(obj, '__name__', '') == nome:
                proximo = obj
                break
        if proximo is None:
            break
        atual = proximo
    return atual


def _fmt_curto(v):
    try:
        v = float(v or 0)
    except Exception:
        v = 0.0
    if abs(v) >= 1_000_000:
        return f'R$ {v/1_000_000:.2f} mi'.replace('.', ',')
    if abs(v) >= 1_000:
        return f'R$ {v/1_000:.0f} mil'.replace('.', ',')
    return f'R$ {v:,.0f}'.replace(',', '.')


def aplicar_sugestao_inteligente_ciclo():
    caller = inspect.currentframe().f_back
    while caller is not None:
        if 'render_sugestao_meta_inteligente' in caller.f_globals:
            caller.f_globals['render_sugestao_meta_inteligente'] = lambda *args, **kwargs: None
            break
        caller = caller.f_back

    number_input_original = _desembrulhar(st.number_input, 'number_input')
    markdown_original = _desembrulhar(st.markdown, 'markdown')
    caption_original = _desembrulhar(st.caption, 'caption')
    button_original = _desembrulhar(st.button, 'button')
    data_editor_original = st.data_editor

    estado = {'ocultar_temporal': False, 'ocultar_kpis_global': False}

    markdown_original(
        """
        <style>
        .gm-global-intro{background:linear-gradient(135deg,#f7f8fc 0%,#ffffff 100%);border:1px solid #e2e5ef;border-radius:16px;padding:16px 18px;margin:2px 0 14px}
        .gm-global-intro .eyebrow{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7b8294;text-transform:uppercase}
        .gm-global-intro .title{font-size:20px;font-weight:800;color:#1e2655;margin-top:3px}
        .gm-global-intro .sub{font-size:12px;color:#737a8c;margin-top:4px}
        .gm-ai-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 8px}
        .gm-ai-title strong{font-size:16px;color:#1e2655}
        .gm-ai-badge{font-size:10px;font-weight:800;color:#1e2655;background:#eef0f8;border:1px solid #dfe3f0;border-radius:999px;padding:5px 8px;white-space:nowrap}
        .gm-ai-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:8px 0 12px}
        .gm-ai-card{background:#fff;border:1px solid #e5e8ef;border-radius:14px;padding:12px 14px}
        .gm-ai-card span{display:block;font-size:10px;font-weight:750;color:#8a90a0;text-transform:uppercase;letter-spacing:.05em}
        .gm-ai-card strong{display:block;color:#1e2655;font-size:19px;margin-top:3px}
        .gm-ai-card small{display:block;color:#8b91a0;font-size:10px;margin-top:2px}
        .gm-ai-progress{height:8px;background:#eceef4;border-radius:999px;overflow:hidden;margin:8px 0 4px}
        .gm-ai-progress>div{height:100%;background:#1e2655;border-radius:999px}
        .gm-ai-check{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f7fbf8;border:1px solid #dcecdf;border-radius:12px;padding:10px 12px;margin:10px 0}
        .gm-ai-check strong{color:#2d6940;font-size:12px}.gm-ai-check span{color:#6e776f;font-size:11px}
        @media(max-width:800px){.gm-ai-cards{grid-template-columns:1fr}.gm-ai-title{align-items:flex-start;flex-direction:column}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    def markdown(body, *args, **kwargs):
        if estado['ocultar_kpis_global'] and isinstance(body, str) and "class='kpi'" in body:
            rotulos = ['Meta da empresa', 'Faturamento recente', 'Mesmo período A-1', 'Crescimento pretendido']
            if any(r in body for r in rotulos):
                return None
        if body == '#### Distribuição temporal da meta':
            estado['ocultar_kpis_global'] = False
            estado['ocultar_temporal'] = True
            return None
        return markdown_original(body, *args, **kwargs)

    def caption(body, *args, **kwargs):
        if estado['ocultar_temporal'] and isinstance(body, str) and body.startswith('Soma mensal:'):
            return None
        return caption_original(body, *args, **kwargs)

    def data_editor(data=None, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if estado['ocultar_temporal'] and key.startswith('gm2_month_'):
            return data.copy() if isinstance(data, pd.DataFrame) else data
        return data_editor_original(data, *args, **kwargs)

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if estado['ocultar_temporal'] and key.startswith('gm2_save_global_'):
            estado['ocultar_temporal'] = False
            return False
        return button_original(label, *args, **kwargs)

    def number_input(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if label != 'Meta total do ciclo' or not key.startswith('gm2_meta_'):
            return number_input_original(label, *args, **kwargs)

        ctx = _contexto_render()
        vendas = ctx.get('vendas')
        ativos = ctx.get('ativos')
        usuario = ctx.get('usuario') or {}
        brl = ctx.get('brl') or (lambda x: f'R$ {float(x):,.2f}')
        perfil = str(usuario.get('perfil') or '')

        try:
            ciclo_txt = key.replace('gm2_meta_', '', 1)
            ano_txt, meses_txt = ciclo_txt.split('|', 1)
            ano = int(ano_txt)
            meses = [int(x) for x in meses_txt.split(',') if x]
        except Exception:
            return number_input_original(label, *args, **kwargs)

        periodo = ' + '.join(gm.MESES[m] for m in meses)
        markdown_original(
            f"""
            <div class='gm-global-intro'>
              <div class='eyebrow'>Etapa 1 · Meta global</div>
              <div class='title'>Quanto queremos vender neste ciclo?</div>
              <div class='sub'>{periodo}/{ano}. Informe a meta total; a distribuição mensal será sugerida automaticamente e continuará editável.</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        valor = number_input_original(label, *args, **kwargs)
        if perfil not in ('ADMIN','GERENTE'):
            estado['ocultar_kpis_global'] = True
            return valor

        modelo = _modelo_ciclo(vendas, ativos, ano, meses, valor)
        if not modelo:
            st.info('Não há histórico suficiente para gerar uma sugestão para este ciclo.')
            estado['ocultar_kpis_global'] = True
            return valor

        markdown_original(
            "<div class='gm-ai-title'><strong>Referência inteligente</strong><span class='gm-ai-badge'>apoio à decisão</span></div>",
            unsafe_allow_html=True,
        )
        markdown_original(
            f"""
            <div class='gm-ai-cards'>
              <div class='gm-ai-card'><span>Meta sugerida</span><strong>{_fmt_curto(modelo['meta_sugerida'])}</strong><small>referência calculada pelo histórico</small></div>
              <div class='gm-ai-card'><span>Mesmo período A-1</span><strong>{_fmt_curto(modelo['a1_total'])}</strong><small>base de sazonalidade</small></div>
              <div class='gm-ai-card'><span>Últimos {len(meses)} mês(es)</span><strong>{_fmt_curto(modelo['recent_total'])}</strong><small>ritmo recente da operação</small></div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        if float(valor or 0) > 0:
            st.caption(f'A inteligência usa sua meta de {brl(valor)} como total do ciclo e apenas sugere como distribuí-la entre os meses.')
        else:
            st.caption(f'Como a meta ainda está zerada, a distribuição abaixo usa temporariamente a referência de {brl(modelo["meta_sugerida"])}.')

        markdown_original(
            "<div class='gm-ai-title'><strong>Distribuição mensal</strong><span class='gm-ai-badge'>editável</span></div>",
            unsafe_allow_html=True,
        )
        st.caption('Ajuste somente a coluna “Meta sugerida”. O total precisa fechar exatamente a meta do ciclo para salvar.')

        tabela = modelo['tabela']
        edit = st.data_editor(
            tabela,
            use_container_width=True,
            hide_index=True,
            disabled=[c for c in tabela.columns if c != 'Meta sugerida'],
            column_config={
                'Média histórica': st.column_config.NumberColumn(format='localized'),
                'Peso sugerido %': st.column_config.NumberColumn(format='%.2f%%'),
                'Meta sugerida': st.column_config.NumberColumn(format='localized', step=10000.0),
            },
            key=f'gm_ciclo_sug_editor_{ano}_{"_".join(map(str,meses))}_{int(modelo["meta_base"])}'
        )

        valores = pd.to_numeric(edit['Meta sugerida'], errors='coerce').fillna(0.0)
        soma = float(valores.sum())
        diferenca = float(modelo['meta_base']) - soma
        alvo = float(modelo['meta_base'])
        progresso = 100 if alvo <= 0 and soma <= 0 else (min(max(soma / alvo * 100, 0), 100) if alvo > 0 else 0)

        markdown_original(
            f"""
            <div class='gm-ai-progress'><div style='width:{progresso:.2f}%'></div></div>
            <div style='display:flex;justify-content:space-between;gap:8px;color:#7f8595;font-size:10px;margin-bottom:8px'>
              <span>Distribuído: {brl(soma)}</span><span>Meta: {brl(alvo)}</span>
            </div>
            """,
            unsafe_allow_html=True,
        )

        if abs(diferenca) <= 0.01:
            markdown_original(
                "<div class='gm-ai-check'><strong>✓ Distribuição fechada</strong><span>Pronta para salvar e seguir para Supervisores.</span></div>",
                unsafe_allow_html=True,
            )
        else:
            st.warning(f'Ainda há uma diferença de {brl(diferenca)} entre a soma mensal e a meta do ciclo.')

        if perfil == 'ADMIN':
            clicou = st.button(
                'Salvar meta e avançar para Supervisores →',
                use_container_width=True,
                type='primary',
                disabled=abs(diferenca) > 0.01,
                key=f'gm_ciclo_aplicar_{ano}_{"_".join(map(str,meses))}'
            )
            if clicou:
                mapa_nome = {v:k for k,v in gm.MESES.items()}
                store = gm._load_store()
                cycle_key = gm._cycle_key(ano, meses)
                cycle = copy.deepcopy(store.get('cycles',{}).get(cycle_key) or gm._empty_cycle(ano, meses, st.session_state.get('gm2_tipo','Personalizado'), modelo['meta_base'], usuario))
                cycle['ano'] = ano
                cycle['meses'] = meses
                cycle['tipo'] = st.session_state.get('gm2_tipo', cycle.get('tipo','Personalizado'))
                cycle['meta_empresa'] = float(modelo['meta_base'])
                cycle['meta_mensal'] = {str(mapa_nome[str(r['Mês'])]): float(r['Meta sugerida']) for _,r in edit.iterrows()}
                cycle['metodologia_meta_mensal'] = {
                    'modelo': 'inteligente_por_ciclo_com_ajuste_manual',
                    'arredondamento': 10000,
                    'criterios': ['mesmo período histórico','últimos meses fechados','sazonalidade do ciclo','ajuste manual'],
                }
                cycle['atualizado_em'] = gm._now()
                gm._event(cycle, 'SALVAR_META_GLOBAL_E_DISTRIBUICAO_MENSAL', usuario, f'{gm._period_label(ano,meses)} | meta {modelo["meta_base"]:.0f}')
                store.setdefault('cycles',{})[cycle_key] = cycle
                ok,msg = gm._save_store(store)
                (st.success if ok else st.error)(msg)
                if ok:
                    st.rerun()

        estado['ocultar_kpis_global'] = True
        st.divider()
        return valor

    st.number_input = number_input
    st.markdown = markdown
    st.caption = caption
    st.data_editor = data_editor
    st.button = button
