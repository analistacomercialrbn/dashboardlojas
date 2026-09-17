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

    estado = {'ocultar_temporal': False}

    def markdown(body, *args, **kwargs):
        if body == '#### Distribuição temporal da meta':
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

        valor = number_input_original(label, *args, **kwargs)
        try:
            ciclo_txt = key.replace('gm2_meta_', '', 1)
            ano_txt, meses_txt = ciclo_txt.split('|', 1)
            ano = int(ano_txt)
            meses = [int(x) for x in meses_txt.split(',') if x]
        except Exception:
            return valor

        ctx = _contexto_render()
        vendas = ctx.get('vendas')
        ativos = ctx.get('ativos')
        usuario = ctx.get('usuario') or {}
        brl = ctx.get('brl') or (lambda x: f'R$ {float(x):,.2f}')
        perfil = str(usuario.get('perfil') or '')
        if perfil not in ('ADMIN','GERENTE'):
            return valor

        st.markdown('#### Sugestão inteligente do ciclo')
        st.caption('A tabela abaixo é a própria distribuição mensal do ciclo. Você pode ajustar os valores sugeridos antes de salvar.')

        modelo = _modelo_ciclo(vendas, ativos, ano, meses, valor)
        if not modelo:
            st.info('Não há histórico suficiente para gerar uma sugestão para este ciclo.')
            return valor

        c1,c2,c3 = st.columns(3)
        c1.metric('Meta sugerida do ciclo', brl(modelo['meta_sugerida']))
        c2.metric('Mesmo período A-1', brl(modelo['a1_total']))
        c3.metric(f'Últimos {len(meses)} mês(es)', brl(modelo['recent_total']))

        if float(valor or 0) > 0:
            st.caption(f'A distribuição usa a meta informada de {brl(valor)}. A referência calculada pelo modelo para este ciclo é {brl(modelo["meta_sugerida"])}.')
        else:
            st.caption(f'Como a meta do ciclo está zerada, a distribuição usa automaticamente a sugestão de {brl(modelo["meta_sugerida"])}.')

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
        d1,d2,d3 = st.columns(3)
        d1.metric('Meta do ciclo', brl(modelo['meta_base']))
        d2.metric('Soma mensal', brl(soma))
        d3.metric('Diferença', brl(diferenca))

        if abs(diferenca) <= 0.01:
            st.success('Distribuição mensal fechada. Esta será a distribuição oficial do ciclo ao salvar.')
        else:
            st.warning('A soma dos meses precisa fechar a meta do ciclo antes de salvar.')

        if perfil == 'ADMIN':
            clicou = st.button(
                'Salvar ciclo e meta global',
                use_container_width=True,
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

        st.divider()
        return valor

    st.number_input = number_input
    st.markdown = markdown
    st.caption = caption
    st.data_editor = data_editor
    st.button = button
