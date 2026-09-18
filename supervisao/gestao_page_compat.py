from gestao_page_compat_base import aplicar_formatacao_comparativos as _aplicar_base
from aggrid_ptbr_patch import aplicar_aggrid_ptbr
from gestao_layout_patch import aplicar_layout_simplificado
from gestao_expand_patch import aplicar_expandir_tabela
from gestao_fullscreen_css import aplicar_fullscreen_dialog
from gestao_sugestao_ciclo_reapply import aplicar_sugestao_ciclo_estavel
from gestao_wizard_visual import aplicar_visual_wizard_metas
from gestao_supervisor_visual import aplicar_visual_supervisores
from gestao_supervisor_analise_toggle import aplicar_toggle_analise_supervisores
from gestao_departamento_visual import aplicar_visual_departamentos
from gestao_rca_visual import aplicar_visual_rcas
from gestao_aprovacao_visual import aplicar_visual_aprovacao
from gestao_mensal_integrado import aplicar_mensal_integrado
from gestao_supervisor_unificado import aplicar_supervisores_unificados
from gestao_departamento_unificado import aplicar_departamentos_unificados
from gestao_rca_unificado import aplicar_rcas_unificados


def aplicar_formatacao_comparativos():
    _aplicar_base()
    aplicar_aggrid_ptbr()
    aplicar_layout_simplificado()
    aplicar_expandir_tabela()
    aplicar_fullscreen_dialog()
    aplicar_sugestao_ciclo_estavel()
    aplicar_visual_wizard_metas()
    aplicar_visual_supervisores()
    aplicar_toggle_analise_supervisores()
    aplicar_visual_departamentos()
    aplicar_visual_rcas()
    aplicar_visual_aprovacao()
    aplicar_mensal_integrado()
    aplicar_supervisores_unificados()
    aplicar_departamentos_unificados()
    aplicar_rcas_unificados()
