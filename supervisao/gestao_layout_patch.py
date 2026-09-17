import inspect

import pandas as pd
import streamlit as st


def aplicar_layout_simplificado():
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

    def _flatten_columns(df):
        out = df.copy()
        if isinstance(out.columns, pd.MultiIndex):
            nomes = []
            usados = {}
            for col in out.columns:
                partes = [str(p) for p in col if p not in (None, '', 'VALOR') and str(p) != 'nan']
                nome = ' | '.join(partes) if partes else 'Faturamento'
                usados[nome] = usados.get(nome, 0) + 1
                if usados[nome] > 1:
                    nome = f'{nome} ({usados[nome]})'
                nomes.append(nome)
            out.columns = nomes
        else:
            out.columns = [str(c) for c in out.columns]
        return out

    def _preparar_exibicao(tabela, linhas, totais):
        if isinstance(tabela, pd.Series):
            tabela = tabela.to_frame('Faturamento')

        tabela = tabela.copy()

        # Total horizontal antes de transformar o índice em colunas normais.
        if totais and tabela.shape[1] > 1:
            tabela['Total'] = tabela.select_dtypes(include='number').sum(axis=1)

        tabela = tabela.reset_index()
        tabela = _flatten_columns(tabela)

        # Garante tipos homogêneos para o PyArrow/Streamlit.
        qtd_linhas = len(linhas)
        label_cols = list(tabela.columns[:qtd_linhas]) if qtd_linhas else []
        for c in label_cols:
            tabela[c] = tabela[c].astype('string').fillna('')

        valor_cols = [c for c in tabela.columns if c not in label_cols]
        for c in valor_cols:
            tabela[c] = pd.to_numeric(tabela[c], errors='coerce').fillna(0.0).astype(float)

        if totais and valor_cols:
            total_row = {c: '' for c in tabela.columns}
            if label_cols:
                total_row[label_cols[0]] = 'Total'
            for c in valor_cols:
                total_row[c] = float(tabela[c].sum())
            tabela = pd.concat([tabela, pd.DataFrame([total_row])], ignore_index=True)

        return tabela

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

        # Todos os campos de dimensão viram texto antes do pivot. Isso evita
        # mistura de inteiros com o rótulo Total, que quebrava o PyArrow.
        x['ANO'] = pd.to_numeric(x['ANO'], errors='coerce').astype('Int64').astype('string')
        x['MES'] = pd.Categorical(x['MES'], categories=ordem_meses, ordered=True)
        for c in ['SUPERVISOR', 'RCA', 'DEPARTAMENTO']:
            x[c] = x[c].astype('string').fillna('')
        x['VALOR'] = pd.to_numeric(x['VALOR'], errors='coerce').fillna(0.0).astype(float)

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

        tabela = pd.pivot_table(x, **kwargs_pivot)
        exibicao = _preparar_exibicao(tabela, linhas, totais)

        st.caption('Valor exibido: Faturamento (R$) • Você pode inverter Ano/Mês ou detalhar RCA → Departamento.')
        dataframe_original(
            exibicao,
            use_container_width=True,
            hide_index=True,
            height=min(650, max(250, 38 * (len(exibicao) + 2))),
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
