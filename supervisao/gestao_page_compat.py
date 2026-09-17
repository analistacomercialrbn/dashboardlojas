from gestao_page_compat_base import aplicar_formatacao_comparativos as _aplicar_base
from aggrid_ptbr_patch import aplicar_aggrid_ptbr
from gestao_layout_patch import aplicar_layout_simplificado
from gestao_expand_patch import aplicar_expandir_tabela
from gestao_fullscreen_css import aplicar_fullscreen_dialog
from gestao_sugestao_ciclo_reapply import aplicar_sugestao_ciclo_estavel
from gestao_wizard_visual import aplicar_visual_wizard_metas
from gestao_supervisor_visual import aplicar_visual_supervisores


def aplicar_formatacao_comparativos():
    _aplicar_base()
    aplicar_aggrid_ptbr()
    aplicar_layout_simplificado()
    aplicar_expandir_tabela()
    aplicar_fullscreen_dialog()
    aplicar_sugestao_ciclo_estavel()
    aplicar_visual_wizard_metas()
    aplicar_visual_supervisores()
