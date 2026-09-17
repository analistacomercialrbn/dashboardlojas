import inspect

import pandas as pd
import streamlit as st


def aplicar_layout_simplificado():
    if getattr(st, '_rbn_layout_simplificado', False):
        return
    st._rbn_layout_simplificado = True

    dataframe_original = st.dataframe
    editor_original = st.data_editor

    def modelo_inteligente(data):
        if not isinstance(data, pd.DataFrame):
            return False
        esperadas = {
            'Mês', 'Média histórica', 'Mediana histórica', 'Part. sazonal %',
            'Var. 2024→2026 %', 'Var. 2025→2026 %', 'Var. média vs mês anterior %',
            'Peso sugerido %', 'Meta sugerida', 'Leitura do modelo'
        }
        return esperadas.issubset(set(data.columns))

    def _contexto_historico_do_caller():
        frame = inspect.currentframe()
        try:
            atual = frame.f_back
            while atual is not None:
                if atual.f_code.co_name == 'render_historico_planejamento':
                    base = atual.f_locals.get('base')
                    if isinstance(base, pd.DataFrame):
                        necessarias = {'ANO', 'MES', 'VALOR', 'SUPERVISOR', 'RCA', 'DEPARTAMENTO'}
                        if necessarias.issubset(base.columns):
                            return base.copy()
                    return None
                atual = atual.f_back
            return None
        finally:
            del frame

    def _normalizar_estado():
        campos = ['Ano', 'Mês', 'Supervisor', 'RCA', 'Departamento']
        linhas = st.session_state.get('gm_pivot_rows', ['Mês'])
        colunas = st.session_state.get('gm_pivot_cols', ['Ano'])
        linhas = [c for c in linhas if c in campos]
        colunas = [c for c in colunas if c in campos and c not in linhas]
        if not linhas and not colunas:
            linhas = ['Mês']
            colunas = ['Ano']
        st.session_state['gm_pivot_rows'] = linhas
        st.session_state['gm_pivot_cols'] = colunas
        st.session_state.setdefault('gm_pivot_totals', True)

    def _resetar_pivot():
        st.session_state['gm_pivot_rows'] = ['Mês']
        st.session_state['gm_pivot_cols'] = ['Ano']
        st.session_state['gm_pivot_totals'] = True

    def _render_tabela_dinamica(base):
        _normalizar_estado()
        st.caption('Tabela dinâmica: escolha os campos das linhas e das colunas. Os filtros do histórico acima continuam sendo respeitados.')

        campos = ['Ano', 'Mês', 'Supervisor', 'RCA', 'Departamento']
        topo1, topo2 = st.columns([5, 1])
        with topo2:
            st.button('↺ Padrão', key='gm_pivot_reset', use_container_width=True, on_click=_resetar_pivot)

        c1, c2, c3 = st.columns([2, 2, 1])
        linhas = c1.multiselect(
            'Linhas',
            campos,
            key='gm_pivot_rows',
            help='Você pode criar uma hierarquia, por exemplo: RCA → Departamento.'
        )

        opcoes_colunas = [c for c in campos if c not in linhas]
        atuais_colunas = [c for c in st.session_state.get('gm_pivot_cols', []) if c in opcoes_colunas]
        if atuais_colunas != st.session_state.get('gm_pivot_cols', []):
            st.session_state['gm_pivot_cols'] = atuais_colunas

        colunas = c2.multiselect(
            'Colunas',
            opcoes_colunas,
            key='gm_pivot_cols',
            help='Exemplo: Ano ou Mês.'
        )
        totais = c3.checkbox('Mostrar totais', key='gm_pivot_totals')

        if not linhas and not colunas:
            st.info('Escolha pelo menos um campo em Linhas ou Colunas.')
            return

        mapa = {
            'Ano': 'ANO',
            'Mês': 'MES',
            'Supervisor': 'SUPERVISOR',
            'RCA': 'RCA',
            'Departamento': 'DEPARTAMENTO',
        }

        x = base.copy()
        ordem_meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
        x['MES'] = pd.Categorical(x['MES'], categories=ordem_meses, ordered=True)
        x['ANO'] = pd.to_numeric(x['ANO'], errors='coerce').astype('Int64')

        idx = [mapa[c] for c in linhas]
        cols = [mapa[c] for c in colunas]

        kwargs_pivot = dict(
            values='VALOR',
            aggfunc='sum',
            fill_value=0,
            observed=True,
            sort=False,
        )
        if idx:
            kwargs_pivot['index'] = idx
        if cols:
            kwargs_pivot['columns'] = cols
        if totais and idx and cols:
            kwargs_pivot['margins'] = True
            kwargs_pivot['margins_name'] = 'Total'

        tabela = pd.pivot_table(x, **kwargs_pivot)

        if totais and idx and not cols:
            tabela.loc['Total'] = tabela.sum(numeric_only=True)
        elif totais and cols and not idx:
            if isinstance(tabela, pd.Series):
                tabela = tabela.to_frame().T
            tabela['Total'] = tabela.sum(axis=1, numeric_only=True)

        ren = {v: k for k, v in mapa.items()}
        if isinstance(tabela, pd.Series):
            tabela = tabela.to_frame('Faturamento')
        if isinstance(tabela.index, pd.MultiIndex):
            tabela.index = tabela.index.set_names([ren.get(n, n) for n in tabela.index.names])
        else:
            tabela.index.name = ren.get(tabela.index.name, tabela.index.name)
        if isinstance(tabela.columns, pd.MultiIndex):
            tabela.columns = tabela.columns.set_names([ren.get(n, n) for n in tabela.columns.names])
        else:
            tabela.columns.name = ren.get(tabela.columns.name, tabela.columns.name)

        st.caption('Valor exibido: Faturamento (R$) • Você pode inverter Ano/Mês ou detalhar RCA → Departamento.')
        dataframe_original(
            tabela,
            use_container_width=True,
            height=min(650, max(250, 38 * (len(tabela) + 2))),
        )

    def dataframe(data=None, *args, **kwargs):
        base = _contexto_historico_do_caller()
        if base is not None:
            return _render_tabela_dinamica(base)
        return dataframe_original(data, *args, **kwargs)

    def data_editor(data=None, *args, **kwargs):
        if not modelo_inteligente(data):
            return editor_original(data, *args, **kwargs)

        visiveis = ['Mês', 'Média histórica', 'Peso sugerido %', 'Meta sugerida', 'Leitura do modelo']
        simplificado = data[visiveis].copy()
        kwargs_main = dict(kwargs)
        cfg = kwargs_main.get('column_config') or {}
        kwargs_main['column_config'] = {k: v for k, v in cfg.items() if k in visiveis}
        disabled = kwargs_main.get('disabled')
        if isinstance(disabled, (list, tuple)):
            kwargs_main['disabled'] = [c for c in disabled if c in visiveis]

        editado = editor_original(simplificado, *args, **kwargs_main)
        with st.expander('Ver cálculo completo da sugestão', expanded=False):
            dataframe_original(
                data,
                use_container_width=True,
                hide_index=True,
                column_config=cfg,
            )
        return editado

    st.dataframe = dataframe
    st.data_editor = data_editor
