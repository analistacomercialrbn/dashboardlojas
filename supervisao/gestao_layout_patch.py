import inspect

import pandas as pd
import streamlit as st


def aplicar_layout_simplificado():
    if getattr(st, '_rbn_layout_simplificado', False):
        return
    st._rbn_layout_simplificado = True

    dataframe_original = st.dataframe
    editor_original = st.data_editor

    def historico_mensal(data):
        if not isinstance(data, pd.DataFrame) or data.empty:
            return False
        cols = [str(c) for c in data.columns]
        anos = [c for c in cols if len(c) == 4 and c.isdigit()]
        return len(anos) >= 2 and 'Total' in cols and len(data) >= 6

    def modelo_inteligente(data):
        if not isinstance(data, pd.DataFrame):
            return False
        esperadas = {
            'Mês', 'Média histórica', 'Mediana histórica', 'Part. sazonal %',
            'Var. 2024→2026 %', 'Var. 2025→2026 %', 'Var. média vs mês anterior %',
            'Peso sugerido %', 'Meta sugerida', 'Leitura do modelo'
        }
        return esperadas.issubset(set(data.columns))

    def _base_historica_do_caller():
        frame = inspect.currentframe()
        try:
            # dataframe() -> render_historico_planejamento()
            caller = frame.f_back.f_back if frame and frame.f_back else None
            base = caller.f_locals.get('base') if caller else None
            if not isinstance(base, pd.DataFrame):
                return None
            necessarias = {'ANO', 'MES', 'VALOR', 'SUPERVISOR', 'RCA', 'DEPARTAMENTO'}
            if not necessarias.issubset(base.columns):
                return None
            return base.copy()
        finally:
            del frame

    def _render_tabela_dinamica(base):
        st.caption('Tabela dinâmica: escolha o que deseja colocar nas linhas e nas colunas. Os filtros do histórico acima continuam sendo respeitados.')

        if st.button('↺ Restaurar visão padrão', key='gm_pivot_reset', use_container_width=False):
            st.session_state['gm_pivot_rows'] = ['Mês']
            st.session_state['gm_pivot_cols'] = ['Ano']
            st.session_state['gm_pivot_totals'] = True
            st.rerun()

        campos = ['Ano', 'Mês', 'Supervisor', 'RCA', 'Departamento']
        if 'gm_pivot_rows' not in st.session_state:
            st.session_state['gm_pivot_rows'] = ['Mês']
        if 'gm_pivot_cols' not in st.session_state:
            st.session_state['gm_pivot_cols'] = ['Ano']
        if 'gm_pivot_totals' not in st.session_state:
            st.session_state['gm_pivot_totals'] = True

        c1, c2, c3 = st.columns([2, 2, 1])
        linhas = c1.multiselect(
            'Linhas',
            campos,
            key='gm_pivot_rows',
            help='Você pode criar uma hierarquia, por exemplo: RCA → Departamento.'
        )
        colunas = c2.multiselect(
            'Colunas',
            campos,
            key='gm_pivot_cols',
            help='Exemplo: Ano ou Mês.'
        )
        totais = c3.checkbox('Mostrar totais', key='gm_pivot_totals')

        repetidos = [c for c in colunas if c in linhas]
        if repetidos:
            st.warning('O mesmo campo não pode ficar em linhas e colunas ao mesmo tempo: ' + ', '.join(repetidos))
            colunas = [c for c in colunas if c not in repetidos]

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

        try:
            tabela = pd.pivot_table(
                x,
                index=idx or None,
                columns=cols or None,
                values='VALOR',
                aggfunc='sum',
                fill_value=0,
                margins=bool(totais),
                margins_name='Total',
                observed=True,
                sort=False,
            )
        except ValueError:
            # Algumas combinações sem eixo de linha/coluna não aceitam margins.
            tabela = pd.pivot_table(
                x,
                index=idx or None,
                columns=cols or None,
                values='VALOR',
                aggfunc='sum',
                fill_value=0,
                observed=True,
                sort=False,
            )

        ren = {v: k for k, v in mapa.items()}
        if isinstance(tabela.index, pd.MultiIndex):
            tabela.index = tabela.index.set_names([ren.get(n, n) for n in tabela.index.names])
        else:
            tabela.index.name = ren.get(tabela.index.name, tabela.index.name)
        if isinstance(tabela.columns, pd.MultiIndex):
            tabela.columns = tabela.columns.set_names([ren.get(n, n) for n in tabela.columns.names])
        else:
            tabela.columns.name = ren.get(tabela.columns.name, tabela.columns.name)

        st.caption('Valor exibido: Faturamento (R$) • Use os seletores para inverter Ano/Mês ou detalhar RCA → Departamento.')
        dataframe_original(
            tabela,
            use_container_width=True,
            height=min(650, max(250, 38 * (len(tabela) + 2))),
        )

    def dataframe(data=None, *args, **kwargs):
        if historico_mensal(data):
            base = _base_historica_do_caller()
            if base is not None:
                return _render_tabela_dinamica(base)
            with st.expander('Ver faturamento detalhado por mês e ano', expanded=False):
                return dataframe_original(data, *args, **kwargs)
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
