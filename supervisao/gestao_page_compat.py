from gestao_page_compat_base import aplicar_formatacao_comparativos as _aplicar_base
from gestao_layout_patch import aplicar_layout_simplificado


def aplicar_formatacao_comparativos():
    _aplicar_base()
    aplicar_layout_simplificado()
