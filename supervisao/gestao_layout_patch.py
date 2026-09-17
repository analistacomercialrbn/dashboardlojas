import inspect

import pandas as pd
import streamlit as st

try:
    from st_aggrid import AgGrid, GridOptionsBuilder, JsCode
except Exception:
    AgGrid = None
    GridOptionsBuilder = None
    JsCode = None


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
        linhas = st.session_state.get('gm_pivot_rows', ['Departamento'])
        colunas = st.session_state.get('gm_pivot_cols', ['Ano', 'Mês'])
        linhas = [c for c in linhas if c in campos]
        colunas = [c for c in colunas if c in campos and c not in linhas]
        if not linhas and not colunas:
            linhas = ['Mês']
            colunas = ['Ano']
        st.session_state['gm_pivot_rows'] = linhas
        st.session_state['gm_pivot_cols'] = colunas
        st.session_state.setdefault('gm_pivot_totals', True)
        st.session_state.setdefault('gm_pivot_layout', 'Planilha dinâmica')

    def _resetar_pivot():
        st.session_state['gm_pivot_rows'] = ['Departamento']
        st.session_state['gm_pivot_cols'] = ['Ano', 'Mês']
        st.session_state['gm_pivot_totals'] = True
        st.session_state['gm_pivot_layout'] = 'Planilha dinâmica'

    def _ordem_dimensao(campo, valores):
        if campo == 'Mês':
            ordem = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
            pos = {v:i for i,v in enumerate(ordem)}
            return sorted(valores, key=lambda v: pos.get(str(v), 99))
        if campo == 'Ano':
            def chave(v):
                try: return int(v)
                except Exception: return 999999
            return sorted(valores, key=chave)
        return sorted(valores, key=lambda v: str(v))

    def _preparar_base(base):
        x = base.copy()
        x['ANO'] = pd.to_numeric(x['ANO'], errors='coerce').astype('Int64').astype('string').fillna('')
        x['MES'] = x['MES'].astype('string').fillna('')
        for c in ['SUPERVISOR','RCA','DEPARTAMENTO']:
            x[c] = x[c].astype('string').fillna('')
        x['VALOR'] = pd.to_numeric(x['VALOR'], errors='coerce').fillna(0.0).astype(float)
        return x

    def _make_pivot(x, linhas, colunas):
        mapa = {
            'Ano':'ANO', 'Mês':'MES', 'Supervisor':'SUPERVISOR',
            'RCA':'RCA', 'Departamento':'DEPARTAMENTO'
        }
        idx = [mapa[c] for c in linhas]
        cols = [mapa[c] for c in colunas]
        kwargs = dict(values='VALOR', aggfunc='sum', fill_value=0, observed=True, sort=False)
        if idx: kwargs['index'] = idx
        if cols: kwargs['columns'] = cols
        pivot = pd.pivot_table(x, **kwargs)
        if isinstance(pivot, pd.Series):
            pivot = pivot.to_frame('Faturamento')
        return pivot

    def _column_tuples(pivot, colunas):
        if not colunas:
            return [('Faturamento',)]
        if isinstance(pivot.columns, pd.MultiIndex):
            return [tuple('' if pd.isna(v) else str(v) for v in tup) for tup in pivot.columns.tolist()]
        return [(str(v),) for v in pivot.columns.tolist()]

    def _leaf_rows(pivot, linhas):
        if linhas:
            if isinstance(pivot.index, pd.MultiIndex):
                keys = [tuple('' if pd.isna(v) else str(v) for v in tup) for tup in pivot.index.tolist()]
            else:
                keys = [(str(v),) for v in pivot.index.tolist()]
        else:
            keys = [('Total',)] * len(pivot)
        rows = []
        for key, (_, serie) in zip(keys, pivot.iterrows()):
            rows.append((key, serie.astype(float)))
        return rows

    def _build_rows_with_subtotals(pivot, linhas, colunas, mostrar_totais):
        col_tuples = _column_tuples(pivot, colunas)
        leaf = _leaf_rows(pivot, linhas)

        def field_for_col(tup):
            return '__v__' + '__'.join(str(v).replace('__','_') for v in tup)

        value_fields = [field_for_col(t) for t in col_tuples]
        output = []

        def add_row(label, serie, nivel=0, subtotal=False, total_geral=False):
            row = {
                'Rótulos de Linha': label,
                '__nivel__': int(nivel),
                '__subtotal__': bool(subtotal),
                '__total_geral__': bool(total_geral),
            }
            vals = list(serie.values) if hasattr(serie, 'values') else list(serie)
            for i, field in enumerate(value_fields):
                row[field] = float(vals[i]) if i < len(vals) and pd.notna(vals[i]) else 0.0
            if mostrar_totais:
                row['__total_linha__'] = float(sum(row[f] for f in value_fields))
            output.append(row)

        if not linhas:
            serie = pivot.sum(axis=0, numeric_only=True)
            add_row('Total Geral', serie, total_geral=True)
            return pd.DataFrame(output), col_tuples, value_fields

        keys = [k for k, _ in leaf]
        series = [s for _, s in leaf]

        def recurse(indices, level, prefix):
            campo = linhas[level]
            grupos = {}
            for i in indices:
                chave = keys[i][level] if level < len(keys[i]) else ''
                grupos.setdefault(chave, []).append(i)
            ordenados = _ordem_dimensao(campo, list(grupos.keys()))
            for chave in ordenados:
                ids = grupos[chave]
                if level == len(linhas) - 1:
                    serie = pd.concat([series[i] for i in ids], axis=1).sum(axis=1)
                    label = ('    ' * level) + str(chave)
                    add_row(label, serie, nivel=level)
                else:
                    serie_grupo = pd.concat([series[i] for i in ids], axis=1).sum(axis=1)
                    label = ('    ' * level) + str(chave)
                    add_row(label, serie_grupo, nivel=level, subtotal=False)
                    recurse(ids, level + 1, prefix + (chave,))
                    if mostrar_totais:
                        add_row(('    ' * level) + f'{chave} Total', serie_grupo, nivel=level, subtotal=True)

        recurse(list(range(len(leaf))), 0, tuple())

        if mostrar_totais:
            grand = pivot.sum(axis=0, numeric_only=True)
            add_row('Total Geral', grand, nivel=0, subtotal=True, total_geral=True)
        return pd.DataFrame(output), col_tuples, value_fields

    def _nested_column_defs(col_tuples, value_fields, mostrar_totais):
        if not col_tuples:
            return []

        pairs = list(zip(col_tuples, value_fields))

        money_formatter = JsCode("""
        function(params) {
            if (params.value === null || params.value === undefined || params.value === '') return '';
            return 'R$ ' + Number(params.value).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }
        """)

        def build(pairs_here, level):
            if not pairs_here:
                return []
            max_levels = max(len(t) for t, _ in pairs_here)
            if level >= max_levels:
                return []
            groups = []
            seen = []
            for tup, fld in pairs_here:
                key = tup[level] if level < len(tup) else ''
                if key not in seen:
                    seen.append(key)
            for key in seen:
                subset = [(t,f) for t,f in pairs_here if (t[level] if level < len(t) else '') == key]
                if level == max_levels - 1:
                    if len(subset) == 1:
                        _, field = subset[0]
                        groups.append({
                            'headerName': str(key), 'field': field,
                            'type': 'numericColumn', 'minWidth': 115,
                            'valueFormatter': money_formatter,
                            'filter': 'agNumberColumnFilter',
                        })
                    else:
                        for tup, field in subset:
                            groups.append({
                                'headerName': str(tup[-1]), 'field': field,
                                'type': 'numericColumn', 'minWidth': 115,
                                'valueFormatter': money_formatter,
                                'filter': 'agNumberColumnFilter',
                            })
                else:
                    children = build(subset, level + 1)
                    if children:
                        groups.append({'headerName': str(key), 'children': children})
            return groups

        defs = build(pairs, 0)
        if mostrar_totais:
            defs.append({
                'headerName': 'Total', 'field': '__total_linha__',
                'type':'numericColumn', 'minWidth':130,
                'valueFormatter': money_formatter,
                'filter':'agNumberColumnFilter',
            })
        return defs

    def _render_aggrid(pivot, linhas, colunas, mostrar_totais):
        if AgGrid is None:
            st.warning('AG Grid ainda não foi carregado no ambiente. Assim que o Streamlit concluir a instalação da nova dependência, recarregue a página.')
            return False

        dados, col_tuples, value_fields = _build_rows_with_subtotals(pivot, linhas, colunas, mostrar_totais)
        if dados.empty:
            st.info('Sem dados para a combinação selecionada.')
            return True

        gb = GridOptionsBuilder.from_dataframe(dados)
        gb.configure_default_column(sortable=True, filter=True, resizable=True, suppressMenu=False)
        gb.configure_column('Rótulos de Linha', pinned='left', minWidth=280, flex=1, filter='agTextColumnFilter')
        for c in ['__nivel__','__subtotal__','__total_geral__']:
            gb.configure_column(c, hide=True)
        for c in value_fields:
            gb.configure_column(c, hide=True)
        if mostrar_totais:
            gb.configure_column('__total_linha__', hide=True)

        opts = gb.build()
        opts['columnDefs'] = [
            {
                'headerName':'Rótulos de Linha', 'field':'Rótulos de Linha',
                'pinned':'left', 'minWidth':280, 'flex':1,
                'filter':'agTextColumnFilter', 'sortable':True,
                'cellStyle': JsCode("""
                    function(params) {
                        if (params.data && params.data.__total_geral__) return {'fontWeight':'700'};
                        if (params.data && params.data.__subtotal__) return {'fontWeight':'700'};
                        return null;
                    }
                """),
            }
        ] + _nested_column_defs(col_tuples, value_fields, mostrar_totais)

        opts['getRowStyle'] = JsCode("""
            function(params) {
                if (!params.data) return null;
                if (params.data.__total_geral__) {
                    return {fontWeight: '700', backgroundColor: '#DCE6F7'};
                }
                if (params.data.__subtotal__) {
                    return {fontWeight: '700', backgroundColor: '#EAF0FA'};
                }
                return null;
            }
        """)
        opts['headerHeight'] = 34
        opts['groupHeaderHeight'] = 32
        opts['rowHeight'] = 31
        opts['suppressAggFuncInHeader'] = True
        opts['animateRows'] = False
        opts['ensureDomOrder'] = True

        AgGrid(
            dados,
            gridOptions=opts,
            height=min(720, max(300, 34 * (len(dados) + 3))),
            fit_columns_on_grid_load=False,
            allow_unsafe_jscode=True,
            theme='streamlit',
            enable_enterprise_modules=False,
            key='gm_aggrid_pivot',
        )
        return True

    def _render_compacto(pivot, linhas, mostrar_totais):
        exib = pivot.copy()
        if isinstance(exib, pd.Series):
            exib = exib.to_frame('Faturamento')
        if mostrar_totais and exib.shape[1] > 1:
            exib['Total'] = exib.sum(axis=1, numeric_only=True)
        exib = exib.reset_index()
        if mostrar_totais:
            valor_cols = [c for c in exib.columns if c not in [m for m in exib.columns[:len(linhas)]]]
            row = {c:'' for c in exib.columns}
            if len(linhas): row[exib.columns[0]] = 'Total Geral'
            for c in valor_cols:
                try: row[c] = float(pd.to_numeric(exib[c], errors='coerce').fillna(0).sum())
                except Exception: pass
            exib = pd.concat([exib, pd.DataFrame([row])], ignore_index=True)
        dataframe_original(exib, use_container_width=True, hide_index=True)

    def _render_tabela_dinamica(base):
        _normalizar_estado()
        st.caption('Tabela dinâmica: monte a visão como no Excel. Os filtros do histórico acima continuam sendo respeitados.')

        campos = ['Ano', 'Mês', 'Supervisor', 'RCA', 'Departamento']
        topo1, topo2 = st.columns([5,1])
        with topo2:
            st.button('↺ Padrão', key='gm_pivot_reset', use_container_width=True, on_click=_resetar_pivot)

        c1, c2, c3, c4 = st.columns([2,2,1.35,1])
        linhas = c1.multiselect('Linhas', campos, key='gm_pivot_rows', help='Ex.: Departamento, ou Supervisor → RCA → Departamento.')
        opcoes_col = [c for c in campos if c not in linhas]
        atuais = [c for c in st.session_state.get('gm_pivot_cols', []) if c in opcoes_col]
        if atuais != st.session_state.get('gm_pivot_cols', []):
            st.session_state['gm_pivot_cols'] = atuais
        colunas = c2.multiselect('Colunas', opcoes_col, key='gm_pivot_cols', help='Ex.: Ano → Mês.')
        layout = c3.selectbox('Layout', ['Planilha dinâmica','Compacto'], key='gm_pivot_layout')
        mostrar_totais = c4.checkbox('Mostrar totais', key='gm_pivot_totals')

        if not linhas and not colunas:
            st.info('Escolha pelo menos um campo em Linhas ou Colunas.')
            return

        x = _preparar_base(base)
        pivot = _make_pivot(x, linhas, colunas)
        st.caption('Valor: Faturamento (R$) • No layout Planilha dinâmica, Ano/Mês viram cabeçalhos agrupados e as linhas ganham hierarquia e subtotais.')

        if layout == 'Planilha dinâmica':
            if not _render_aggrid(pivot, linhas, colunas, mostrar_totais):
                _render_compacto(pivot, linhas, mostrar_totais)
        else:
            _render_compacto(pivot, linhas, mostrar_totais)

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
        kwargs_main['column_config'] = {k:v for k,v in cfg.items() if k in visiveis}
        disabled = kwargs_main.get('disabled')
        if isinstance(disabled, (list,tuple)):
            kwargs_main['disabled'] = [c for c in disabled if c in visiveis]

        editado = editor_original(simplificado, *args, **kwargs_main)
        with st.expander('Ver cálculo completo da sugestão', expanded=False):
            dataframe_original(data, use_container_width=True, hide_index=True, column_config=cfg)
        return editado

    st.dataframe = dataframe
    st.data_editor = data_editor
