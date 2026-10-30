import streamlit as st

from gestao_sugestao_ciclo_patch import aplicar_sugestao_inteligente_ciclo


def aplicar_sugestao_ciclo_estavel():
    """Reaplica o wrapper da sugestão a cada rerun sem empilhar wrappers.

    O Streamlit executa novamente o script quando Ano/Tipo/Mês mudam. O patch
    anterior tinha um bloqueio global e podia deixar a sugestão desaparecer
    depois da primeira alteração do ciclo.
    """
    if not hasattr(st, '_gm_number_input_base'):
        st._gm_number_input_base = st.number_input
    else:
        st.number_input = st._gm_number_input_base

    st._gm_ciclo_patch_aplicado = False
    aplicar_sugestao_inteligente_ciclo()
