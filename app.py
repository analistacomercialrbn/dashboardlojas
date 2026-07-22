import pandas as pd
import plotly.graph_objects as go
import streamlit as st

st.set_page_config(page_title="Dashboard Comercial", layout="wide")


@st.cache_data
def carregar_e_tratar_dados():
  # IDs extraídos dos seus links do Google Drive
  id_base = '1jXPOz96HPUNi3EW_XIMLkPzDHW6EeauL'
  id_pontos = '1BfdHKrHF1BEE_lhe0qYylZDmsobckax3'

  # Links de download direto para o Pandas
  url_base = f'https://drive.google.com/uc?export=download&id={id_base}'
  url_pontos = f'https://drive.google.com/uc?export=download&id={id_pontos}'

  # 1. Carregar Planilhas via URL do Drive
  df_base = pd.read_excel(url_base, sheet_name='BASE')
  df_pontos = pd.read_excel(url_pontos, sheet_name='Planilha1')

  # Lista de Filtros
  codigos_clientes = [
      '10290',
      '10524',
      '1093',
      '11076',
      '2285',
      '2306',
      '2437',
      '2635',
      '3665',
      '4381',
      '4827',
      '6795',
      '7045',
      '7610',
      '782',
      '7938',
      '8482',
      '8714',
      '9121',
      '9157',
      '9677',
      '9957',
  ]

  codigos_produtos = [
      '33',
      '164',
      '300',
      '302',
      '342',
      '395',
      '431',
      '447',
      '448',
      '449',
      '450',
      '453',
      '455',
      '456',
      '461',
      '462',
      '464',
      '465',
      '466',
      '468',
      '470',
      '525',
      '526',
      '527',
      '528',
      '533',
      '534',
      '535',
      '536',
      '537',
      '538',
      '540',
      '541',
      '560',
      '561',
      '567',
      '745',
      '746',
      '1151',
      '1152',
      '1174',
      '1184',
  ]

  # 2. Higienização dos Códigos
  df_base['Cod_Cliente'] = (
      df_base['Cliente'].astype(str).str.extract(r'(\d+)')[0]
  )
  df_base['Cod_Produto'] = (
      df_base['Produto'].astype(str).str.extract(r'(\d+)')[0]
  )
  df_pontos['Cod_Produto'] = (
      df_pontos['COD/PRODUTO'].astype(str).str.extract(r'(\d+)')[0]
  )

  # Identificar coluna de Seção correta na Base ou Pontos
  col_secao_base = [
      c
      for c in df_base.columns
      if 'SECAO' in c.upper() or 'SEÇÃO' in c.upper()
  ]
  if col_secao_base:
    df_base['Seção'] = df_base[col_secao_base[0]].astype(str).str.strip()
  else:
    df_base['Seção'] = 'GERAL'

  # 3. Conversão Robusta de Datas
  meses_pt = {
      'jan': 1,
      'fev': 2,
      'mar': 3,
      'abr': 4,
      'mai': 5,
      'jun': 6,
      'jul': 7,
      'ago': 8,
      'set': 9,
      'out': 10,
      'nov': 11,
      'dez': 12,
  }

  def converter_data_universal(val):
    if pd.isna(val):
      return pd.NaT
    if isinstance(val, (pd.Timestamp, pd.DatetimeIndex)):
      return val

    try:
      dt = pd.to_datetime(val, dayfirst=True, errors='coerce')
      if not pd.isna(dt):
        return dt
    except:
      pass

    val_str = str(val).lower().strip().replace('-', '/')
    parts = val_str.split('/')

    if len(parts) >= 2:
      mes_str = parts[0].strip()
      ano_str = parts[-1].strip()
      mes_num = meses_pt.get(mes_str)

      if not mes_num and mes_str.isdigit():
        mes_num = int(mes_str)

      if mes_num:
        ano_num = int('20' + ano_str) if len(ano_str) == 2 else int(ano_str)
        return pd.Timestamp(year=ano_num, month=mes_num, day=1)

    return pd.NaT

  df_base['Data_Tratada'] = df_base['Mês_Ano'].apply(converter_data_universal)
  df_base['Ano'] = df_base['Data_Tratada'].dt.year
  df_base['Mes_Num'] = df_base['Data_Tratada'].dt.month

  # 4. Filtrar Base
  df_filtrado = df_base[
      (df_base['Cod_Cliente'].isin(codigos_clientes))
      & (df_base['Cod_Produto'].isin(codigos_produtos))
      & (df_base['Ano'] == 2026)
      & (df_base['Mes_Num'] >= 1)
      & (df_base['Mes_Num'] <= 6)
  ].copy()

  # 5. Merge de Pontos
  df_pontos_clean = df_pontos[
      ['Cod_Produto', 'PONTOS POR UND']
  ].drop_duplicates(subset=['Cod_Produto'])

  df_merged = pd.merge(
      df_filtrado, df_pontos_clean, on='Cod_Produto', how='left'
  )

  df_merged['PONTOS POR UND'] = df_merged['PONTOS POR UND'].fillna(0)
  df_merged['Qtd_Vendida'] = (
      pd.to_numeric(df_merged['Soma Prod.'], errors='coerce').fillna(0)
  )
  df_merged['Pontos_Totais'] = (
      df_merged['Qtd_Vendida'] * df_merged['PONTOS POR UND']
  )

  # 6. Mês Nome Ordenado
  mapa_meses_nome = {1: 'jan', 2: 'fev', 3: 'mar', 4: 'abr', 5: 'mai', 6: 'jun'}
  df_merged['Mes_Nome'] = df_merged['Mes_Num'].map(mapa_meses_nome)

  ordem_meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun']
  df_merged['Mes_Nome'] = pd.Categorical(
      df_merged['Mes_Nome'], categories=ordem_meses, ordered=True
  )

  # 7. Porte do Cliente
  if 'Porte' not in df_merged.columns:
    df_merged['Porte'] = 'Médio'
    df_merged.loc[
        df_merged['Cod_Cliente'].str.endswith(('0', '1', '2')), 'Porte'
    ] = 'Pequeno'
    df_merged.loc[
        df_merged['Cod_Cliente'].str.endswith(('7', '8', '9')), 'Porte'
    ] = 'Grande'

  return df_merged


df = carregar_e_tratar_dados()

# --- INTERFACE DO STREAMLIT ---
st.title('📊 Dashboard Comercial - Performance por Porte')

portes_disponiveis = sorted(df['Porte'].dropna().unique().tolist())
porte_selecionado = st.sidebar.selectbox(
    'Selecione o Porte da Loja:', portes_disponiveis
)

df_porte = df[df['Porte'] == porte_selecionado]

# Agrupamentos para o gráfico
df_agrupado_pontos = (
    df_porte.groupby(['Cliente', 'Mes_Nome'], observed=False)['Pontos_Totais']
    .sum()
    .reset_index()
)
df_media_pontos = (
    df_agrupado_pontos.groupby('Mes_Nome', observed=False)['Pontos_Totais']
    .mean()
    .reset_index()
)

# 1. GRÁFICO SUPERIOR
st.subheader(f'📈 Evolução Mensal da Pontuação - Porte: {porte_selecionado}')

fig = go.Figure()

for cliente in df_agrupado_pontos['Cliente'].unique():
  dados_cliente = df_agrupado_pontos[df_agrupado_pontos['Cliente'] == cliente]
  labels = [
      f'{v:,.0f}' if v > 0 else '' for v in dados_cliente['Pontos_Totais']
  ]

  fig.add_trace(
      go.Scatter(
          x=dados_cliente['Mes_Nome'],
          y=dados_cliente['Pontos_Totais'],
          mode='lines+markers+text',
          name=cliente,
          text=labels,
          textposition='top center',
          line=dict(shape='spline', smoothing=1.3),
          marker=dict(size=8),
          opacity=0.75,
      )
  )

labels_media = [f'{v:,.0f}' for v in df_media_pontos['Pontos_Totais']]
fig.add_trace(
    go.Scatter(
        x=df_media_pontos['Mes_Nome'],
        y=df_media_pontos['Pontos_Totais'],
        mode='lines+markers+text',
        name='MÉDIA DO PORTE',
        text=labels_media,
        textposition='bottom center',
        line=dict(
            color='black', width=4, dash='dash', shape='spline', smoothing=1.3
        ),
        marker=dict(size=10, color='black'),
    )
)

fig.update_layout(
    xaxis_title='Mês',
    yaxis_title='Pontos Totais',
    hovermode='x unified',
    height=500,
    margin=dict(l=20, r=20, t=30, b=20),
)

st.plotly_chart(fig, use_container_width=True)

st.divider()

# 2. TABELA DINÂMICA SUSPENSA / EXPANSÍVEL
st.subheader('📋 Detalhamento Dinâmico (Estilo Tabela Dinâmica)')

# Opção para escolher o que analisar
tipo_metrica = st.radio(
    'Selecione a métrica para detalhar:',
    ['🏆 Pontuação Totais', '📦 Quantidade Vendida'],
    horizontal=True,
)
col_valor = 'Pontos_Totais' if 'Pontuação' in tipo_metrica else 'Qtd_Vendida'
fmt = '{:,.2f}' if 'Pontuação' in tipo_metrica else '{:,.0f}'

meses_cols = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun']

# Loop de Clientes (Nível 1 - Suspenso)
for cliente in sorted(df_porte['Cliente'].unique()):
  df_cli = df_porte[df_porte['Cliente'] == cliente]
  tot_cli = df_cli[col_valor].sum()

  with st.expander(f'🏢 **{cliente}** | Total: {tot_cli:,.2f}'):

    # Loop de Seções do Cliente (Nível 2 - Suspenso)
    for secao in sorted(df_cli['Seção'].unique()):
      df_sec = df_cli[df_cli['Seção'] == secao]
      tot_sec = df_sec[col_valor].sum()

      st.markdown(
          f'&nbsp;&nbsp;&nbsp;&nbsp;📂 **Seção: {secao}** *(Total:'
          f' {tot_sec:,.2f})*',
          unsafe_allow_html=True,
      )

      # Tabela de Produtos daquela Seção Específica (Nível 3)
      piv = df_sec.pivot_table(
          index='Produto',
          columns='Mes_Nome',
          values=col_valor,
          aggfunc='sum',
          observed=False,
      ).fillna(0)

      # Garantir todas as colunas de meses
      for m in meses_cols:
        if m not in piv.columns:
          piv[m] = 0
      piv = piv[meses_cols]
      piv['Total Geral'] = piv.sum(axis=1)

      st.dataframe(piv.style.format(fmt), use_container_width=True)
