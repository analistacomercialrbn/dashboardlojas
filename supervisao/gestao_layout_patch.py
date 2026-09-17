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

    def dataframe(data=None, *args, **kwargs):
        if historico_mensal(data):
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
