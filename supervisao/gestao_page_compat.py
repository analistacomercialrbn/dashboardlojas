import pandas as pd
import streamlit as st


def aplicar_formatacao_comparativos():
    if not hasattr(st, '_rbn_number_column_original'):
        st._rbn_number_column_original = st.column_config.NumberColumn

    def number_column(*args, **kwargs):
        fmt = kwargs.get('format')
        if isinstance(fmt, str) and ('R$' in fmt or fmt == '%.2f'):
            kwargs['format'] = 'localized'
        return st._rbn_number_column_original(*args, **kwargs)

    st.column_config.NumberColumn = number_column

    if not hasattr(st, '_rbn_info_original'):
        st._rbn_info_original = st.info

    def info(body, *args, **kwargs):
        if isinstance(body, str) and body.startswith('Ciclo:') and 'comparação recente:' in body and 'sazonalidade:' in body:
            partes = [p.strip() for p in body.split('•')]
            if len(partes) >= 3:
                ciclo = partes[0].replace('Ciclo:', 'Ciclo de planejamento:', 1)
                atual = partes[1].replace('comparação recente:', 'Ano atual:', 1)
                anterior = partes[2].replace('sazonalidade:', 'Ano anterior:', 1)
                body = f'{ciclo}  •  {anterior}  •  {atual}'
                st.session_state['_rbn_compare_detail'] = f'{anterior}  •  {atual}'
        return st._rbn_info_original(body, *args, **kwargs)

    st.info = info

    def comparison_frame(df):
        if not isinstance(df, pd.DataFrame):
            return df, {}
        principal = {'Últimos meses', 'Mesmo período A-1', 'Part. Últimos meses', 'Part. Mesmo período A-1'}
        if principal.issubset(df.columns):
            ren = {
                'Mesmo período A-1': 'Ano anterior (R$)',
                'Part. Mesmo período A-1': '% Ano anterior',
                'Últimos meses': 'Ano atual (R$)',
                'Part. Últimos meses': '% Ano atual',
                'Crescimento recente x A-1': 'Crescimento',
            }
            out = df.rename(columns=ren).copy()
            ids = [c for c in df.columns if c not in principal and c != 'Crescimento recente x A-1']
            ordem = ids[:1] + ['Ano anterior (R$)', '% Ano anterior', 'Ano atual (R$)', '% Ano atual']
            if 'Crescimento' in out.columns:
                ordem.append('Crescimento')
            ordem += [c for c in out.columns if c not in ordem]
            return out[ordem], ren
        if {'Hist. A-1', 'Hist. recente'}.issubset(df.columns):
            out = df.copy()
            anterior = pd.to_numeric(out['Hist. A-1'], errors='coerce').fillna(0)
            atual = pd.to_numeric(out['Hist. recente'], errors='coerce').fillna(0)
            ta, tb = float(anterior.sum()), float(atual.sum())
            out['% Ano anterior'] = anterior / ta * 100 if ta else 0.0
            out['% Ano atual'] = atual / tb * 100 if tb else 0.0
            out['Crescimento'] = (atual / anterior.replace(0, pd.NA) - 1) * 100
            ren = {'Hist. A-1': 'Ano anterior (R$)', 'Hist. recente': 'Ano atual (R$)'}
            out = out.rename(columns=ren)
            ids = [c for c in df.columns if c not in {'Hist. A-1','Hist. recente','Participação ref. %','Meta sugerida','Meta definida','Meta proposta'}]
            ordem = ids + ['Ano anterior (R$)', '% Ano anterior', 'Ano atual (R$)', '% Ano atual', 'Crescimento']
            for c in ['Participação ref. %','Meta sugerida','Meta definida','Meta proposta']:
                if c in out.columns:
                    ordem.append(c)
            ordem += [c for c in out.columns if c not in ordem]
            return out[ordem], ren
        return df, {}

    def remap(config, ren):
        if not isinstance(config, dict):
            config = {} if config is None else config
        if not isinstance(config, dict):
            return config
        novo = {ren.get(k, k): v for k, v in config.items()}
        novo.setdefault('% Ano anterior', st.column_config.NumberColumn(format='%.2f%%'))
        novo.setdefault('% Ano atual', st.column_config.NumberColumn(format='%.2f%%'))
        novo.setdefault('Crescimento', st.column_config.NumberColumn(format='%.2f%%'))
        return novo

    if not hasattr(st, '_rbn_dataframe_original'):
        st._rbn_dataframe_original = st.dataframe
    if not hasattr(st, '_rbn_data_editor_original'):
        st._rbn_data_editor_original = st.data_editor

    def dataframe(data=None, *args, **kwargs):
        novo, ren = comparison_frame(data)
        if ren:
            detalhe = st.session_state.get('_rbn_compare_detail')
            if detalhe:
                st.caption(f'Comparativo: {detalhe}')
            kwargs['column_config'] = remap(kwargs.get('column_config'), ren)
        return st._rbn_dataframe_original(novo, *args, **kwargs)

    def data_editor(data=None, *args, **kwargs):
        novo, ren = comparison_frame(data)
        if ren:
            detalhe = st.session_state.get('_rbn_compare_detail')
            if detalhe:
                st.caption(f'Comparativo: {detalhe}')
            kwargs['column_config'] = remap(kwargs.get('column_config'), ren)
            disabled = kwargs.get('disabled')
            if isinstance(disabled, (list, tuple)):
                kwargs['disabled'] = [ren.get(c, c) for c in disabled]
        return st._rbn_data_editor_original(novo, *args, **kwargs)

    st.dataframe = dataframe
    st.data_editor = data_editor

    if not hasattr(st, '_rbn_plotly_chart_original'):
        st._rbn_plotly_chart_original = st.plotly_chart

    def plotly_chart(fig, *args, **kwargs):
        try:
            fig.update_layout(separators=',.')
            for tr in fig.data:
                if getattr(tr, 'name', None) == 'Mesmo período A-1':
                    tr.name = 'Ano anterior'
                elif getattr(tr, 'name', None) == 'Últimos meses':
                    tr.name = 'Ano atual'
            ant = [tr for tr in fig.data if getattr(tr, 'name', None) == 'Ano anterior']
            atu = [tr for tr in fig.data if getattr(tr, 'name', None) == 'Ano atual']
            outros = [tr for tr in fig.data if getattr(tr, 'name', None) not in ('Ano anterior','Ano atual')]
            if ant or atu:
                fig.data = tuple(ant + atu + outros)
        except Exception:
            pass
        return st._rbn_plotly_chart_original(fig, *args, **kwargs)

    st.plotly_chart = plotly_chart
