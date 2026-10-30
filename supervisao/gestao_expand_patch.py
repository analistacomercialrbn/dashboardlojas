import inspect

import pandas as pd
import streamlit as st

try:
    from st_aggrid import AgGrid, GridOptionsBuilder, JsCode
except Exception:
    AgGrid = None
    GridOptionsBuilder = None
    JsCode = None


def aplicar_expandir_tabela():
    dataframe_dinamico = st.dataframe

    def _base_historico():
        frame = inspect.currentframe()
        try:
            atual = frame.f_back
            while atual is not None:
                if atual.f_code.co_name == 'render_historico_planejamento':
                    base = atual.f_locals.get('base')
                    if isinstance(base, pd.DataFrame):
                        req = {'ANO','MES','VALOR','SUPERVISOR','RCA','DEPARTAMENTO'}
                        if req.issubset(base.columns):
                            return base.copy()
                    return None
                atual = atual.f_back
            return None
        finally:
            del frame

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
        mapa = {'Ano':'ANO','Mês':'MES','Supervisor':'SUPERVISOR','RCA':'RCA','Departamento':'DEPARTAMENTO'}
        idx = [mapa[c] for c in linhas]
        cols = [mapa[c] for c in colunas]
        kw = dict(values='VALOR', aggfunc='sum', fill_value=0, observed=True, sort=False)
        if idx: kw['index'] = idx
        if cols: kw['columns'] = cols
        p = pd.pivot_table(x, **kw)
        if isinstance(p, pd.Series):
            p = p.to_frame('Faturamento')
        return p

    def _column_tuples(pivot, colunas):
        if not colunas:
            return [('Faturamento',)]
        if isinstance(pivot.columns, pd.MultiIndex):
            return [tuple('' if pd.isna(v) else str(v) for v in t) for t in pivot.columns.tolist()]
        return [(str(v),) for v in pivot.columns.tolist()]

    def _leaf_rows(pivot, linhas):
        if linhas:
            if isinstance(pivot.index, pd.MultiIndex):
                keys = [tuple('' if pd.isna(v) else str(v) for v in t) for t in pivot.index.tolist()]
            else:
                keys = [(str(v),) for v in pivot.index.tolist()]
        else:
            keys = [('Total',)] * len(pivot)
        return [(k, s.astype(float)) for k, (_, s) in zip(keys, pivot.iterrows())]

    def _build_rows(pivot, linhas, colunas, mostrar_totais):
        col_tuples = _column_tuples(pivot, colunas)
        leaf = _leaf_rows(pivot, linhas)

        def fld(t):
            return '__v__' + '__'.join(str(v).replace('__','_') for v in t)

        fields = [fld(t) for t in col_tuples]
        out = []

        def add(label, serie, nivel=0, subtotal=False, total=False):
            row = {'Rótulos de Linha': label, '__nivel__': int(nivel), '__subtotal__': bool(subtotal), '__total_geral__': bool(total)}
            vals = list(serie.values) if hasattr(serie, 'values') else list(serie)
            for i, f in enumerate(fields):
                row[f] = float(vals[i]) if i < len(vals) and pd.notna(vals[i]) else 0.0
            if mostrar_totais:
                row['__total_linha__'] = float(sum(row[f] for f in fields))
            out.append(row)

        if not linhas:
            add('Total Geral', pivot.sum(axis=0, numeric_only=True), total=True)
            return pd.DataFrame(out), col_tuples, fields

        keys = [k for k, _ in leaf]
        series = [s for _, s in leaf]

        def recurse(indices, level):
            grupos = {}
            for i in indices:
                chave = keys[i][level] if level < len(keys[i]) else ''
                grupos.setdefault(chave, []).append(i)
            for chave in _ordem_dimensao(linhas[level], list(grupos.keys())):
                ids = grupos[chave]
                serie_grupo = pd.concat([series[i] for i in ids], axis=1).sum(axis=1)
                label = ('    ' * level) + str(chave)
                add(label, serie_grupo, nivel=level)
                if level < len(linhas) - 1:
                    recurse(ids, level + 1)
                    if mostrar_totais:
                        add(('    ' * level) + f'{chave} Total', serie_grupo, nivel=level, subtotal=True)

        recurse(list(range(len(leaf))), 0)
        if mostrar_totais:
            add('Total Geral', pivot.sum(axis=0, numeric_only=True), subtotal=True, total=True)
        return pd.DataFrame(out), col_tuples, fields

    def _column_defs(col_tuples, fields, mostrar_totais):
        money = JsCode("""
        function(params) {
            if (params.value === null || params.value === undefined || params.value === '') return '';
            return 'R$ ' + Number(params.value).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }
        """)
        pairs = list(zip(col_tuples, fields))

        def build(items, level):
            if not items:
                return []
            max_levels = max(len(t) for t, _ in items)
            keys = []
            for t, _ in items:
                k = t[level] if level < len(t) else ''
                if k not in keys: keys.append(k)
            defs = []
            for k in keys:
                subset = [(t,f) for t,f in items if (t[level] if level < len(t) else '') == k]
                if level == max_levels - 1:
                    for t, f in subset:
                        defs.append({'headerName': str(t[-1]), 'field': f, 'type':'numericColumn', 'minWidth':115, 'valueFormatter': money, 'filter':'agNumberColumnFilter'})
                else:
                    children = build(subset, level + 1)
                    if children: defs.append({'headerName': str(k), 'children': children})
            return defs

        defs = build(pairs, 0)
        if mostrar_totais:
            defs.append({'headerName':'Total','field':'__total_linha__','type':'numericColumn','minWidth':130,'valueFormatter':money,'filter':'agNumberColumnFilter'})
        return defs

    def _render_full_grid(base):
        if AgGrid is None:
            st.warning('AG Grid ainda não está disponível no ambiente.')
            return

        linhas = list(st.session_state.get('gm_pivot_rows', ['Departamento']))
        colunas = list(st.session_state.get('gm_pivot_cols', ['Ano','Mês']))
        mostrar_totais = bool(st.session_state.get('gm_pivot_totals', True))

        x = _preparar_base(base)
        pivot = _make_pivot(x, linhas, colunas)
        dados, col_tuples, fields = _build_rows(pivot, linhas, colunas, mostrar_totais)

        gb = GridOptionsBuilder.from_dataframe(dados)
        gb.configure_default_column(sortable=True, filter=True, resizable=True, suppressMenu=False)
        opts = gb.build()
        opts['columnDefs'] = [{
            'headerName':'Rótulos de Linha','field':'Rótulos de Linha','pinned':'left','minWidth':310,'flex':1,
            'filter':'agTextColumnFilter','sortable':True,
            'cellStyle': JsCode("""
                function(params) {
                    if (params.data && (params.data.__total_geral__ || params.data.__subtotal__)) return {'fontWeight':'700'};
                    return null;
                }
            """),
        }] + _column_defs(col_tuples, fields, mostrar_totais)
        opts['getRowStyle'] = JsCode("""
            function(params) {
                if (!params.data) return null;
                if (params.data.__total_geral__) return {fontWeight:'700', backgroundColor:'#DCE6F7'};
                if (params.data.__subtotal__) return {fontWeight:'700', backgroundColor:'#EAF0FA'};
                return null;
            }
        """)
        opts['headerHeight'] = 34
        opts['groupHeaderHeight'] = 32
        opts['rowHeight'] = 31
        opts['suppressAggFuncInHeader'] = True
        opts['animateRows'] = False
        opts['ensureDomOrder'] = True

        st.caption('Visualização ampliada • use o X no canto superior para retornar ao dashboard.')
        AgGrid(
            dados,
            gridOptions=opts,
            height=760,
            fit_columns_on_grid_load=False,
            allow_unsafe_jscode=True,
            theme='streamlit',
            enable_enterprise_modules=False,
            key='gm_aggrid_pivot_full',
        )

    if hasattr(st, 'dialog'):
        @st.dialog('Tabela dinâmica — visualização ampliada', width='large')
        def _dialog_tabela(base):
            st.markdown("""
            <style>
            div[data-testid="stDialog"] div[role="dialog"] {
                width: 96vw !important;
                max-width: 96vw !important;
            }
            div[data-testid="stDialog"] [data-testid="stVerticalBlock"] {
                max-width: none !important;
            }
            </style>
            """, unsafe_allow_html=True)
            _render_full_grid(base)
    else:
        _dialog_tabela = None

    def dataframe(data=None, *args, **kwargs):
        base = _base_historico()
        if base is not None and _dialog_tabela is not None:
            c1, c2 = st.columns([8,1])
            with c2:
                if st.button('⛶ Expandir', key='gm_expand_pivot_button', use_container_width=True):
                    _dialog_tabela(base)
        return dataframe_dinamico(data, *args, **kwargs)

    st.dataframe = dataframe
