from pathlib import Path

_app = Path(__file__).with_name('app_v2.py')
source = _app.read_text(encoding='utf-8')

source = source.replace(
"""    else:\n        cli_cols = ['CODCLI','CIDADE','UF'] + (['CLIENTE'] if 'CLIENTE' in clientes.columns else [])\n        cli_geo = clientes[cli_cols].drop_duplicates('CODCLI').copy()\n        cli_geo['UF'] = cli_geo['UF'].astype(str).str.upper().str.strip()\n        loc = fat.merge(cli_geo,on='CODCLI',how='left')\n""",
"""    else:\n        mapa_rcas = ['Todos'] + sorted(fat['RCA'].dropna().astype(str).unique().tolist())\n        mapa_rca = st.selectbox('RCA no mapa', mapa_rcas, index=0, help='Selecione um RCA para o mapa mostrar somente as cidades com faturamento dele no recorte atual.')\n        fat_mapa = fat.copy() if mapa_rca == 'Todos' else fat[fat['RCA'].astype(str).eq(mapa_rca)].copy()\n\n        cli_cols = ['CODCLI','CIDADE','UF'] + (['CLIENTE'] if 'CLIENTE' in clientes.columns else [])\n        cli_geo = clientes[cli_cols].drop_duplicates('CODCLI').copy()\n        cli_geo['UF'] = cli_geo['UF'].astype(str).str.upper().str.strip()\n        loc = fat_mapa.merge(cli_geo,on='CODCLI',how='left')\n"""
)

source = source.replace(
"""        fig.update_geos(\n            fitbounds='locations',\n            visible=False,\n            projection_type='mercator',\n            bgcolor='rgba(0,0,0,0)'\n        )\n""",
"""        fig.update_geos(\n            visible=False,\n            projection_type='mercator',\n            lataxis_range=[-19.8, -1.0],\n            lonaxis_range=[-49.5, -33.5],\n            bgcolor='rgba(0,0,0,0)'\n        )\n"""
)

source = source.replace(
"""    st.markdown(\"<div class='section-note'>Cada área é um município. A cor representa o faturamento no mês; municípios sem venda permanecem claros. Passe o mouse para ver os indicadores e clique para detalhar.</div>\",unsafe_allow_html=True)\n""",
"""    st.markdown(\"<div class='section-note'>Mapa restrito ao Nordeste, com limites municipais. Use o filtro de RCA abaixo para visualizar apenas o faturamento e as cidades daquele RCA; passe o mouse sobre os municípios para ver os indicadores.</div>\",unsafe_allow_html=True)\n"""
)

exec(compile(source, str(_app), 'exec'), globals(), globals())
