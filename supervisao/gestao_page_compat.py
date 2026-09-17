from gestao_page_compat_base import aplicar_formatacao_comparativos as _aplicar_base
from gestao_layout_patch import aplicar_layout_simplificado
from gestao_expand_patch import aplicar_expandir_tabela
from gestao_fullscreen_css import aplicar_fullscreen_dialog


def aplicar_formatacao_comparativos():
    _aplicar_base()
    aplicar_layout_simplificado()
    aplicar_expandir_tabela()
    aplicar_fullscreen_dialog()
