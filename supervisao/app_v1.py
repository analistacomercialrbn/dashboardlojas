from pathlib import Path

_app = Path(__file__).with_name('app_v2.py')
source = _app.read_text(encoding='utf-8')

# Mantém o mapa integrado aos filtros principais do dashboard (mês, supervisor, RCA e departamento)
# e adiciona um recorte geográfico por estado, com zoom automático no estado selecionado.
source = source.replace(
"""with aba4:\n    st.subheader('Cobertura municipal — Nordeste')\n    st.markdown(\"<div class='section-note'>Cada área é um município. A cor representa o faturamento no mês; municípios sem venda permanecem claros. Passe o mouse para ver os indicadores e clique para detalhar.</div>\",unsafe_allow_html=True)\n\n    if fat.empty:\n""",
"""with aba4:\n    estados_mapa = {\n        'Nordeste': None,\n        'Alagoas (AL)': 'AL',\n        'Bahia (BA)': 'BA',\n        'Ceará (CE)': 'CE',\n        'Maranhão (MA)': 'MA',\n        'Paraíba (PB)': 'PB',\n        'Pernambuco (PE)': 'PE',\n        'Piauí (PI)': 'PI',\n        'Rio Grande do Norte (RN)': 'RN',\n        'Sergipe (SE)': 'SE',\n    }\n    estado_label = st.selectbox('Estado no mapa', list(estados_mapa.keys()), index=0, key='estado_mapa')\n    estado_uf = estados_mapa[estado_label]\n    titulo_regiao = estado_label.split(' (')[0]\n\n    st.subheader(f'Cobertura municipal — {titulo_regiao}')\n    st.markdown(\"<div class='section-note'>Cada área representa um município. O mapa acompanha automaticamente os filtros de mês, supervisor, RCA e departamento da lateral. Selecione um estado para ampliar somente aquele território; passe o mouse sobre o município para ver os indicadores e clique para detalhar.</div>\",unsafe_allow_html=True)\n\n    if fat.empty:\n"""
)

source = source.replace(
"""        loc = fat.merge(cli_geo,on='CODCLI',how='left')\n        loc = loc[loc.UF.isin(NE_CODES)].copy()\n        loc['CIDADE_N'] = loc.CIDADE.map(norm)\n""",
"""        loc = fat.merge(cli_geo,on='CODCLI',how='left')\n        loc = loc[loc.UF.isin(NE_CODES)].copy()\n        if estado_uf:\n            loc = loc[loc.UF.eq(estado_uf)].copy()\n        loc['CIDADE_N'] = loc.CIDADE.map(norm)\n"""
)

source = source.replace(
"""        geojson = load_nordeste_geojson()\n        munis = pd.DataFrame([{\n""",
"""        geojson = load_nordeste_geojson()\n        if estado_uf:\n            geojson = {\n                'type': 'FeatureCollection',\n                'features': [ft for ft in geojson['features'] if ft.get('properties', {}).get('uf') == estado_uf]\n            }\n        munis = pd.DataFrame([{\n"""
)

source = source.replace(
"""        z2.markdown(kpi('Municípios no mapa',nint(mapa.shape[0]),'Nordeste completo'),unsafe_allow_html=True)\n        z3.markdown(kpi('Maior cidade',vendidos.loc[vendidos.FATURAMENTO.idxmax(),'CIDADE'] if len(vendidos) else '—','Por faturamento'),unsafe_allow_html=True)\n        z4.markdown(kpi('Faturamento Nordeste',brl_compacto(city.FATURAMENTO.sum()),'Recorte atual'),unsafe_allow_html=True)\n""",
"""        z2.markdown(kpi('Municípios no mapa',nint(mapa.shape[0]),f'{titulo_regiao} completo'),unsafe_allow_html=True)\n        z3.markdown(kpi('Maior cidade',vendidos.loc[vendidos.FATURAMENTO.idxmax(),'CIDADE'] if len(vendidos) else '—','Por faturamento'),unsafe_allow_html=True)\n        z4.markdown(kpi(f'Faturamento {titulo_regiao}',brl_compacto(city.FATURAMENTO.sum()),'Recorte atual'),unsafe_allow_html=True)\n"""
)

# Realça melhor os limites municipais e estaduais e deixa o mapa mais próximo do layout gerencial de referência.
source = source.replace(
"""            marker_line_color='#8D96B4',\n            marker_line_width=.45,\n""",
"""            marker_line_color='#7782A8',\n            marker_line_width=.65,\n"""
)

source = source.replace(
"""        fig.update_layout(\n            height=720,\n            margin=dict(l=0,r=0,t=8,b=0),\n            paper_bgcolor='rgba(0,0,0,0)',\n            dragmode=False\n        )\n""",
"""        fig.update_layout(\n            height=720 if not estado_uf else 680,\n            margin=dict(l=0,r=0,t=8,b=0),\n            paper_bgcolor='rgba(0,0,0,0)',\n            dragmode=False\n        )\n"""
)

exec(compile(source, str(_app), 'exec'), globals(), globals())
