import inspect

import pandas as pd
import plotly.express as px
import streamlit as st

import gestao_metas as gm


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


def _brl(v):
    try:
        v = float(v or 0)
    except Exception:
        v = 0.0
    s = f'{v:,.2f}'
    return 'R$ ' + s.replace(',', 'X').replace('.', ',').replace('X', '.')


def _render_painel(ctx, originals):
    hist_sup = ctx.get('hist_sup')
    vendas = ctx.get('vendas')
    key = str(ctx.get('key') or 'ciclo')
    recent_periods = ctx.get('recent_periods') or []
    prior_periods = ctx.get('prior_periods') or []

    if not isinstance(hist_sup, pd.DataFrame) or hist_sup.empty:
        originals['info']('Sem histórico disponível para o escopo.')
        return

    session_key = f'gm_sup_hist_open_{key}'
    aberto = bool(st.session_state.get(session_key, False))

    titulo = 'Ocultar análise histórica' if aberto else 'Ver análise histórica e evolução'
    if originals['button'](titulo, use_container_width=True, key=f'gm_sup_hist_toggle_{key}'):
        st.session_state[session_key] = not aberto
        st.rerun()

    originals['caption'](
        'Abra somente quando quiser consultar o histórico. A distribuição de metas continua logo abaixo.'
    )

    if not aberto:
        return

    recente = float(hist_sup['Últimos meses'].sum()) if 'Últimos meses' in hist_sup.columns else 0.0
    anterior = float(hist_sup['Mesmo período A-1'].sum()) if 'Mesmo período A-1' in hist_sup.columns else 0.0
    crescimento = ((recente / anterior) - 1) * 100 if anterior else None

    with originals['container'](border=True):
        originals['markdown']('#### Análise histórica dos supervisores')
        originals['caption'](
            f"Período recente: {gm._fmt_periods(recent_periods)}  •  Base comparativa: {gm._fmt_periods(prior_periods)}"
        )

        c1, c2, c3, c4 = originals['columns'](4)
        c1.metric('Faturamento recente', _brl(recente))
        c2.metric('Mesmo período A-1', _brl(anterior))
        c3.metric('Variação', '—' if crescimento is None else f'{crescimento:.1f}%'.replace('.', ','))
        c4.metric('Supervisores', str(len(hist_sup)))

        opcoes = ['Visão geral'] + hist_sup['Supervisor'].astype(str).tolist()
        escolhido = originals['selectbox'](
            'O que você quer analisar?',
            opcoes,
            key=f'gm_sup_hist_view_{key}',
        )

        if escolhido == 'Visão geral':
            plot = hist_sup[['Supervisor', 'Últimos meses', 'Mesmo período A-1']].melt(
                id_vars=['Supervisor'],
                value_vars=['Mesmo período A-1', 'Últimos meses'],
                var_name='Período',
                value_name='Faturamento',
            )
            fig = px.bar(
                plot,
                x='Supervisor',
                y='Faturamento',
                color='Período',
                barmode='group',
                title='Comparativo por supervisor',
            )
            fig.update_layout(
                height=390,
                margin=dict(l=10, r=10, t=55, b=10),
                yaxis_tickprefix='R$ ',
                yaxis_tickformat='.2s',
                legend_orientation='h',
                legend_title_text='',
            )
            originals['plotly_chart'](fig, use_container_width=True)

            resumo = hist_sup.copy()
            resumo = resumo.rename(columns={
                'Mesmo período A-1': 'A-1',
                'Últimos meses': 'Recente',
                'Part. Últimos meses': 'Participação %',
                'Crescimento recente x A-1': 'Crescimento %',
            })
            cols = [c for c in ['Supervisor', 'A-1', 'Recente', 'Participação %', 'Crescimento %'] if c in resumo.columns]
            originals['dataframe'](
                resumo[cols],
                use_container_width=True,
                hide_index=True,
                column_config={
                    'A-1': st.column_config.NumberColumn(format='R$ %.2f'),
                    'Recente': st.column_config.NumberColumn(format='R$ %.2f'),
                    'Participação %': st.column_config.NumberColumn(format='%.2f%%'),
                    'Crescimento %': st.column_config.NumberColumn(format='%.2f%%'),
                },
            )
        else:
            row = hist_sup[hist_sup['Supervisor'].astype(str).eq(escolhido)].iloc[0]
            a1 = float(row.get('Mesmo período A-1', 0) or 0)
            rec = float(row.get('Últimos meses', 0) or 0)
            cresc = ((rec / a1) - 1) * 100 if a1 else None
            d1, d2, d3 = originals['columns'](3)
            d1.metric('Mesmo período A-1', _brl(a1))
            d2.metric('Período recente', _brl(rec))
            d3.metric('Crescimento', '—' if cresc is None else f'{cresc:.1f}%'.replace('.', ','))

            if isinstance(vendas, pd.DataFrame) and not vendas.empty:
                x = vendas[vendas['FATURADO']].copy()
                x = x[x['SUPERVISOR'].astype(str).eq(escolhido)]
                if not x.empty:
                    x['MES'] = x['DATA_FAT'].dt.to_period('M').astype(str)
                    g = x.groupby('MES', as_index=False)['VALOR'].sum().tail(18)
                    fig = px.line(g, x='MES', y='VALOR', markers=True, title=f'Evolução mensal — {escolhido}')
                    fig.update_layout(
                        height=360,
                        margin=dict(l=10, r=10, t=55, b=10),
                        yaxis_tickprefix='R$ ',
                        yaxis_tickformat='.2s',
                    )
                    originals['plotly_chart'](fig, use_container_width=True)


def aplicar_toggle_analise_supervisores():
    originals = {
        'markdown': st.markdown,
        'caption': st.caption,
        'button': st.button,
        'multiselect': st.multiselect,
        'selectbox': st.selectbox,
        'plotly_chart': st.plotly_chart,
        'dataframe': st.dataframe,
        'divider': st.divider,
        'container': st.container,
        'columns': st.columns,
        'info': st.info,
    }

    # Evita empilhar este mesmo wrapper entre reruns.
    if getattr(originals['markdown'], '_gm_sup_toggle_wrapper', False):
        return

    estado = {'suprimir_original': False, 'custom': False}

    def markdown(body, *args, **kwargs):
        if body == '### Análise histórica dos supervisores':
            estado['custom'] = True
            try:
                _render_painel(_ctx(), originals)
            finally:
                estado['custom'] = False
            estado['suprimir_original'] = True
            return None
        if estado['suprimir_original'] and not estado['custom']:
            return None
        return originals['markdown'](body, *args, **kwargs)

    def multiselect(label, options, *args, **kwargs):
        if estado['suprimir_original'] and not estado['custom']:
            return []
        return originals['multiselect'](label, options, *args, **kwargs)

    def selectbox(label, options, *args, **kwargs):
        if estado['suprimir_original'] and not estado['custom']:
            opts = list(options)
            return opts[0] if opts else None
        return originals['selectbox'](label, options, *args, **kwargs)

    def plotly_chart(*args, **kwargs):
        if estado['suprimir_original'] and not estado['custom']:
            return None
        return originals['plotly_chart'](*args, **kwargs)

    def dataframe(*args, **kwargs):
        if estado['suprimir_original'] and not estado['custom']:
            return None
        return originals['dataframe'](*args, **kwargs)

    def divider(*args, **kwargs):
        if estado['suprimir_original'] and not estado['custom']:
            estado['suprimir_original'] = False
        return originals['divider'](*args, **kwargs)

    markdown._gm_sup_toggle_wrapper = True
    st.markdown = markdown
    st.multiselect = multiselect
    st.selectbox = selectbox
    st.plotly_chart = plotly_chart
    st.dataframe = dataframe
    st.divider = divider
