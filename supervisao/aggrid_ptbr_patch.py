"""Aplica tradução pt-BR aos textos internos do AG Grid usados no dashboard."""

try:
    from st_aggrid import GridOptionsBuilder
except Exception:
    GridOptionsBuilder = None


LOCALE_PT_BR = {
    # Filtros de texto e número
    'equals': 'Igual a',
    'notEqual': 'Diferente de',
    'lessThan': 'Menor que',
    'greaterThan': 'Maior que',
    'lessThanOrEqual': 'Menor ou igual a',
    'greaterThanOrEqual': 'Maior ou igual a',
    'inRange': 'Entre',
    'inRangeStart': 'De',
    'inRangeEnd': 'Até',
    'contains': 'Contém',
    'notContains': 'Não contém',
    'startsWith': 'Começa com',
    'endsWith': 'Termina com',
    'blank': 'Em branco',
    'notBlank': 'Não está em branco',
    'empty': 'Escolha uma opção',

    # Área de filtro
    'filterOoo': 'Filtrar...',
    'filterByValue': 'Filtrar por valor',
    'filterValue': 'Valor do filtro',
    'applyFilter': 'Aplicar',
    'resetFilter': 'Redefinir',
    'clearFilter': 'Limpar',
    'cancelFilter': 'Cancelar',
    'selectAll': 'Selecionar tudo',
    'selectAllSearchResults': 'Selecionar todos os resultados',
    'searchOoo': 'Pesquisar...',
    'blanks': '(Em branco)',
    'noMatches': 'Nenhum resultado encontrado',

    # Operadores combinados
    'andCondition': 'E',
    'orCondition': 'OU',

    # Menu/colunas
    'columns': 'Colunas',
    'filters': 'Filtros',
    'rowGroupColumns': 'Agrupar linhas',
    'rowGroupColumnsEmptyMessage': 'Arraste aqui para agrupar',
    'valueColumns': 'Valores',
    'pivotMode': 'Modo tabela dinâmica',
    'groups': 'Grupos',
    'values': 'Valores',
    'pivots': 'Colunas',
    'columnFilter': 'Filtro de coluna',
    'columnChooser': 'Escolher colunas',
    'sortAscending': 'Ordenar crescente',
    'sortDescending': 'Ordenar decrescente',
    'sortUnSort': 'Limpar ordenação',
    'pinColumn': 'Fixar coluna',
    'pinLeft': 'Fixar à esquerda',
    'pinRight': 'Fixar à direita',
    'noPin': 'Não fixar',
    'autosizeThiscolumn': 'Ajustar esta coluna',
    'autosizeAllColumns': 'Ajustar todas as colunas',
    'resetColumns': 'Redefinir colunas',

    # Estado da grade
    'loadingOoo': 'Carregando...',
    'noRowsToShow': 'Nenhum dado para exibir',
    'enabled': 'Ativado',

    # Paginação
    'page': 'Página',
    'more': 'Mais',
    'to': 'a',
    'of': 'de',
    'next': 'Próxima',
    'last': 'Última',
    'first': 'Primeira',
    'previous': 'Anterior',

    # Agregações
    'sum': 'Soma',
    'min': 'Mínimo',
    'max': 'Máximo',
    'none': 'Nenhum',
    'count': 'Contagem',
    'avg': 'Média',
    'filteredRows': 'Filtradas',
    'selectedRows': 'Selecionadas',
    'totalRows': 'Total de linhas',
    'totalAndFilteredRows': 'Linhas',

    # Clipboard/exportação
    'copy': 'Copiar',
    'copyWithHeaders': 'Copiar com cabeçalhos',
    'copyWithGroupHeaders': 'Copiar com cabeçalhos de grupo',
    'cut': 'Recortar',
    'paste': 'Colar',
    'export': 'Exportar',
    'csvExport': 'Exportar CSV',
    'excelExport': 'Exportar Excel',
}


def aplicar_aggrid_ptbr():
    """Injeta localeText em todo GridOptionsBuilder.build() do projeto."""
    if GridOptionsBuilder is None:
        return
    if getattr(GridOptionsBuilder, '_rbn_ptbr_aplicado', False):
        return

    original_build = GridOptionsBuilder.build

    def build_ptbr(self, *args, **kwargs):
        opts = original_build(self, *args, **kwargs)
        locale_atual = opts.get('localeText', {}) or {}
        opts['localeText'] = {**LOCALE_PT_BR, **locale_atual}
        return opts

    GridOptionsBuilder.build = build_ptbr
    GridOptionsBuilder._rbn_ptbr_aplicado = True
