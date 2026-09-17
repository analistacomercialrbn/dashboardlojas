from io import BytesIO
import copy

import pandas as pd
import plotly.express as px
import requests
import streamlit as st

from access_control import auth_bootstrap, render_admin_users, scope_ativos
from gestao_page_compat import aplicar_formatacao_comparativos
import gestao_metas as gm

st.set_page_config(page_title='Gestão de Metas', page_icon='🎯', layout='wide')

VENDAS_ID = '1ioeKNG2P5HLZpmCTxUa3FaCfI1pfHuyC'
AUX_ID = '1h3XtB-2aMSMGhr5Ws7P-6nijKZc3zeqI'
NAVY = '#1E2655'
BG = '#F6F7FB'
MUTED = '#737A8C'

gm.BRANCH = 'dashboard-data'

if not hasattr(gm, '_load_store_original_fast'):
    gm._load_store_original_fast = gm._load_store
if not hasattr(gm, '_save_store_original_fast'):
    gm._save_store_original_fast = gm._save_store


def _load_store_session():
    if '_gm_store_cache' not in st.session_state:
        st.session_state['_gm_store_cache'] = gm._load_store_original_fast()
    return copy.deepcopy(st.session_state['_gm_store_cache'])


def _save_store_session(store):
    ok, msg = gm._save_store_original_fast(store)
    if ok:
        st.session_state['_gm_store_cache'] = copy.deepcopy(store)
    return ok, msg


gm._load_store = _load_store_session
gm._save_store = _save_store_session

st.markdown(f"""
<style>
[data-testid="stAppViewContainer"] {{ background:{BG}; }}
[data-testid="stHeader"] {{ background:rgba(0,0,0,0); }}
[data-testid="stSidebar"] {{ background:#fff; border-right:1px solid #E6E8EF; }}
.block-container {{ padding-top:1.4rem; padding-bottom:2rem; max-width:1500px; }}
.brandbar {{ display:flex; align-items:center; justify-content:space-between; gap:18px; background:{NAVY}; padding:18px 24px; border-radius:18px; margin-bottom:18px; box-shadow:0 8px 24px rgba(30,38,85,.14); }}
.brand-title {{ color:white; font-size:30px; font-weight:750; margin:0; }}
.brand-sub {{ color:#DDE2F4; font-size:13px; margin-top:5px; }}
.brand-word {{ color:white; font-size:24px; font-weight:900; letter-spacing:.08em; }}
.kpi {{ background:#fff; border:1px solid #E6E8EF; border-radius:16px; padding:16px 18px; min-height:116px; box-shadow:0 4px 14px rgba(30,38,85,.06); }}
.kpi-label {{ color:{MUTED}; font-size:12px; font-weight:650; text-transform:uppercase; letter-spacing:.06em; }}
.kpi-value {{ color:{NAVY}; font-size:25px; font-weight:760; margin-top:7px; white-space:nowrap; }}
.kpi-note {{ color:{MUTED}; font-size:11px; margin-top:4px; }}
@media (max-width: 1100px) {{
  .block-container {{ padding-left:.8rem !important; padding-right:.8rem !important; padding-top:1rem !important; max-width:100% !important; }}
  .brandbar {{ padding:14px 16px !important; border-radius:14px !important; }}
  .brand-title {{ font-size:22px !important; }}
  .brand-sub {{ font-size:11px !important; }}
  .brand-word {{ display:none !important; }}
  [data-testid="stHorizontalBlock"] {{ flex-wrap:wrap !important; gap:.7rem !important; }}
  [data-testid="column"] {{ flex:1 1 280px !important; width:auto !important; min-width:260px !important; }}
  .kpi {{ min-height:96px !important; padding:12px 14px !important; }}
  .kpi-value {{ font-size:22px !important; white-space:normal !important; }}
  [data-baseweb="tab-list"] {{ overflow-x:auto !important; overflow-y:hidden !important; flex-wrap:nowrap !important; gap:8px !important; }}
  [data-baseweb="tab"] {{ flex:0 0 auto !important; white-space:nowrap !important; }}
  div[data-testid="stDataFrame"] {{ overflow-x:auto !important; }}
}}
@media (max-width: 650px) {{
  [data-testid="column"] {{ flex:1 1 100% !important; width:100% !important; min-width:100% !important; }}
  .brand-title {{ font-size:20px !important; }}
  .brand-sub {{ display:none !important; }}
}}
</style>
""", unsafe_allow_html=True)


@st.cache_data(show_spinner=False)
def drive_bytes(fid):
    r = requests.get(f'https://drive.google.com/uc?export=download&id={fid}', timeout=180)
    r.raise_for_status()
    if 'text/html' in r.headers.get('content-type','').lower():
        raise RuntimeError('Confirme o compartilhamento dos arquivos do Drive como leitor por link.')
    return r.content


def _read_excel(buf, **kwargs):
    try:
        return pd.read_excel(buf, engine='calamine', **kwargs)
    except Exception:
        if hasattr(buf, 'seek'):
            buf.seek(0)
        return pd.read_excel(buf, **kwargs)


def cod(s):
    return pd.to_numeric(s.astype(str).str.extract(r'^\s*(\d+)', expand=False), errors='coerce').astype('Int64')


def dt(s):
    if pd.api.types.is_datetime64_any_dtype(s):
        return pd.to_datetime(s, errors='coerce')
    n = pd.to_numeric(s, errors='coerce')
    excel = pd.to_datetime(n, unit='D', origin='1899-12-30', errors='coerce')
    txt = pd.to_datetime(s.astype(str), dayfirst=True, errors='coerce')
    return txt.fillna(excel)


def brl(v, casas=2):
    if pd.isna(v):
        return '—'
    return f'R$ {float(v):,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def brl_compacto(v):
    v = float(v or 0)
    if abs(v) >= 1_000_000:
        return f'R$ {v/1_000_000:.2f} mi'.replace('.', ',')
    if abs(v) >= 1_000:
        return f'R$ {v/1_000:.1f} mil'.replace('.', ',')
    return brl(v)


def pct(v):
    return '—' if pd.isna(v) else f'{float(v):.1f}%'.replace('.', ',')


def kpi(label, value, note=''):
    return f"<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value'>{value}</div><div class='kpi-note'>{note}</div></div>"


def ler_vendas(buf):
    previa = _read_excel(buf, sheet_name='Sheet1', header=None, nrows=8)
    header = 0
    for i, row in previa.iterrows():
        vals = set(row.astype(str).str.strip())
        if 'Data Faturamento' in vals and 'Pedidos Enviados' in vals:
            header = i
            break
    buf.seek(0)
    cols = {'Cod/Vend.','Data Faturamento','Pedidos Enviados','Posição','DEPARTAMENTO'}
    return _read_excel(buf, sheet_name='Sheet1', header=header, usecols=lambda c: str(c).strip() in cols)


@st.cache_data(show_spinner='Carregando histórico e metas...')
def load_data():
    vendas_bytes = drive_bytes(VENDAS_ID)
    aux_bytes = drive_bytes(AUX_ID)

    v = ler_vendas(BytesIO(vendas_bytes))
    rca = _read_excel(BytesIO(aux_bytes), sheet_name='RCA', usecols=lambda c: str(c).strip() in {'COD_RCA','RCA','SUPERVISOR','ATIVO'})
    met = _read_excel(BytesIO(aux_bytes), sheet_name='METAS', usecols=lambda c: str(c).strip() in {'COD_RCA','MES','META'})

    v['COD_RCA'] = cod(v['Cod/Vend.'])
    v['DATA_FAT'] = dt(v['Data Faturamento'])
    v['VALOR'] = pd.to_numeric(v['Pedidos Enviados'], errors='coerce').fillna(0)
    v['FATURADO'] = v['DATA_FAT'].notna() & v['Posição'].astype(str).str.strip().str.upper().eq('FECHADO')

    rca['COD_RCA'] = pd.to_numeric(rca['COD_RCA'], errors='coerce').astype('Int64')
    rca['ATIVO'] = rca['ATIVO'].astype(str).str.upper().str.strip()
    met['COD_RCA'] = pd.to_numeric(met['COD_RCA'], errors='coerce').astype('Int64')
    met['MES'] = met['MES'].astype(str).str[:7]
    met['META'] = pd.to_numeric(met['META'], errors='coerce').fillna(0)

    h = rca[['COD_RCA','RCA','SUPERVISOR','ATIVO']].drop_duplicates('COD_RCA')
    v = v.merge(h, on='COD_RCA', how='left')
    return v, rca, met


def render_historico_planejamento(vendas, ativos):
    st.markdown('### Histórico para planejamento')
    st.caption('Use os filtros para explorar o faturamento antes de definir a meta do ciclo. A visão respeita o escopo de acesso do usuário.')

    permitidos = set(pd.to_numeric(ativos['COD_RCA'], errors='coerce').dropna().astype('Int64').tolist())
    hist = vendas[vendas['FATURADO']].copy()
    if permitidos:
        hist = hist[hist['COD_RCA'].isin(permitidos)]

    if hist.empty:
        st.info('Sem faturamento histórico disponível para o seu escopo.')
        return

    hist['ANO'] = hist['DATA_FAT'].dt.year.astype('Int64')
    hist['MES_NUM'] = hist['DATA_FAT'].dt.month.astype('Int64')
    meses_nomes = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez'}
    hist['MES'] = hist['MES_NUM'].map(meses_nomes)

    anos = sorted(hist['ANO'].dropna().astype(int).unique().tolist())
    supervisores = sorted(hist['SUPERVISOR'].dropna().astype(str).unique().tolist())

    f1, f2, f3 = st.columns(3)
    anos_sel = f1.multiselect('Ano', anos, default=anos, key='gm_hist_anos')
    meses_sel = f2.multiselect('Mês', list(meses_nomes.values()), default=list(meses_nomes.values()), key='gm_hist_meses')
    sup_sel = f3.multiselect('Supervisor', supervisores, default=[], placeholder='Todos', key='gm_hist_sup')

    base = hist.copy()
    if anos_sel:
        base = base[base['ANO'].isin(anos_sel)]
    if meses_sel:
        base = base[base['MES'].isin(meses_sel)]
    if sup_sel:
        base = base[base['SUPERVISOR'].astype(str).isin(sup_sel)]

    rcas_disp = sorted(base['RCA'].dropna().astype(str).unique().tolist())
    deps_disp = sorted(base['DEPARTAMENTO'].dropna().astype(str).unique().tolist())
    f4, f5 = st.columns(2)
    rca_sel = f4.multiselect('RCA / Vendedor', rcas_disp, default=[], placeholder='Todos', key='gm_hist_rca')
    dep_sel = f5.multiselect('Departamento', deps_disp, default=[], placeholder='Todos', key='gm_hist_dep')
    if rca_sel:
        base = base[base['RCA'].astype(str).isin(rca_sel)]
    if dep_sel:
        base = base[base['DEPARTAMENTO'].astype(str).isin(dep_sel)]

    if base.empty:
        st.warning('Nenhum faturamento encontrado para os filtros selecionados.')
        return

    total = float(base['VALOR'].sum())
    meses_com_venda = base['DATA_FAT'].dt.to_period('M').nunique()
    media_mensal = total / meses_com_venda if meses_com_venda else 0
    mensal = base.groupby(base['DATA_FAT'].dt.to_period('M'))['VALOR'].sum().sort_index()
    melhor_periodo = mensal.idxmax() if not mensal.empty else None
    melhor_valor = float(mensal.max()) if not mensal.empty else 0

    cres_base = hist.copy()
    if sup_sel:
        cres_base = cres_base[cres_base['SUPERVISOR'].astype(str).isin(sup_sel)]
    if rca_sel:
        cres_base = cres_base[cres_base['RCA'].astype(str).isin(rca_sel)]
    if dep_sel:
        cres_base = cres_base[cres_base['DEPARTAMENTO'].astype(str).isin(dep_sel)]

    ontem = pd.Timestamp.now(tz='America/Fortaleza').tz_localize(None).normalize() - pd.Timedelta(days=1)
    ano_atual = int(ontem.year)
    ano_anterior = ano_atual - 1
    inicio_atual = pd.Timestamp(year=ano_atual, month=1, day=1)
    inicio_anterior = pd.Timestamp(year=ano_anterior, month=1, day=1)
    fim_anterior = ontem - pd.DateOffset(years=1)

    mask_atual = cres_base['DATA_FAT'].between(inicio_atual, ontem, inclusive='both')
    mask_anterior = cres_base['DATA_FAT'].between(inicio_anterior, fim_anterior, inclusive='both')
    atual_val = float(cres_base.loc[mask_atual, 'VALOR'].sum())
    anterior_val = float(cres_base.loc[mask_anterior, 'VALOR'].sum())
    crescimento = (atual_val / anterior_val - 1) * 100 if anterior_val else pd.NA

    k1, k2, k3, k4 = st.columns(4)
    k1.metric('Faturamento filtrado', brl(total))
    k2.metric('Média mensal', brl(media_mensal))
    melhor_nome = '—' if melhor_periodo is None else f"{meses_nomes[int(melhor_periodo.month)]}/{melhor_periodo.year}"
    k3.metric('Melhor mês', brl(melhor_valor), melhor_nome)
    k4.metric(f'Crescimento x ano anterior • até {ontem.strftime("%d/%m")}', pct(crescimento))

    pivot = pd.pivot_table(base, index='MES_NUM', columns='ANO', values='VALOR', aggfunc='sum', fill_value=0)
    pivot = pivot.reindex([m for m in range(1,13) if meses_nomes[m] in meses_sel or not meses_sel]).fillna(0)
    pivot.index = [meses_nomes[int(m)] for m in pivot.index]
    pivot.index.name = 'Mês'
    pivot.columns = [str(int(c)) for c in pivot.columns]
    pivot['Total'] = pivot.sum(axis=1)
    total_row = pd.DataFrame([pivot.sum(axis=0)], index=['Total Geral'])
    tabela = pd.concat([pivot, total_row])

    st.markdown('#### Faturamento por mês e ano')
    configs = {c: st.column_config.NumberColumn(c, format='localized') for c in tabela.columns}
    st.dataframe(tabela, use_container_width=True, column_config=configs)

    graf = base.groupby(['ANO','MES_NUM','MES'], as_index=False)['VALOR'].sum().sort_values(['ANO','MES_NUM'])
    fig = px.line(graf, x='MES', y='VALOR', color=graf['ANO'].astype(str), markers=True,
                  category_orders={'MES':list(meses_nomes.values())},
                  labels={'VALOR':'Faturamento','color':'Ano'},
                  title='Evolução mensal do faturamento')
    fig.update_layout(height=360, margin=dict(l=10,r=10,t=50,b=10), separators=',.', yaxis_tickprefix='R$ ')
    st.plotly_chart(fig, use_container_width=True)
    st.divider()


def _reconciliar_dezenas_milhar(valores_brutos, total, passo=10000):
    alvo = round(float(total) / passo) * passo
    arred = {m: round(float(v) / passo) * passo for m, v in valores_brutos.items()}
    diferenca_passos = int(round((alvo - sum(arred.values())) / passo))
    residuos = {m: float(valores_brutos[m]) - arred[m] for m in arred}

    while diferenca_passos > 0:
        for m in sorted(arred, key=lambda x: residuos[x], reverse=True):
            if diferenca_passos <= 0:
                break
            arred[m] += passo
            diferenca_passos -= 1

    while diferenca_passos < 0:
        candidatos = [m for m in sorted(arred, key=lambda x: residuos[x]) if arred[m] >= passo]
        if not candidatos:
            break
        for m in candidatos:
            if diferenca_passos >= 0:
                break
            arred[m] -= passo
            diferenca_passos += 1

    return arred, alvo


def _modelo_meta_inteligente(vendas, ativos, meta_anual, ano_meta):
    permitidos = set(pd.to_numeric(ativos['COD_RCA'], errors='coerce').dropna().astype('Int64').tolist())
    h = vendas[vendas['FATURADO'] & vendas['DATA_FAT'].notna()].copy()
    if permitidos:
        h = h[h['COD_RCA'].isin(permitidos)]
    h = h[h['DATA_FAT'].dt.year < int(ano_meta)].copy()
    if h.empty:
        return pd.DataFrame(), {}, float(meta_anual)

    h['ANO'] = h['DATA_FAT'].dt.year.astype(int)
    h['MES'] = h['DATA_FAT'].dt.month.astype(int)
    anos = sorted(h['ANO'].unique().tolist())[-3:]
    h = h[h['ANO'].isin(anos)].copy()
    matriz = h.groupby(['ANO','MES'])['VALOR'].sum().unstack(fill_value=0).reindex(index=anos, columns=range(1,13), fill_value=0)

    pesos_ano = {a: i + 1 for i, a in enumerate(anos)}
    base_vals = {}
    medianas = {}
    var_24_26 = {}
    var_25_26 = {}
    mom_med = {}

    for mes in range(1, 13):
        existentes = [(a, float(matriz.loc[a, mes])) for a in anos if float(matriz.loc[a, mes]) > 0]
        if existentes:
            soma_p = sum(pesos_ano[a] for a, _ in existentes)
            media_pond = sum(v * pesos_ano[a] for a, v in existentes) / soma_p
            mediana = float(pd.Series([v for _, v in existentes]).median())
            base_vals[mes] = 0.60 * media_pond + 0.40 * mediana
            medianas[mes] = mediana
        else:
            base_vals[mes] = 0.0
            medianas[mes] = 0.0

        v24 = float(matriz.loc[2024, mes]) if 2024 in matriz.index else 0.0
        v25 = float(matriz.loc[2025, mes]) if 2025 in matriz.index else 0.0
        v26 = float(matriz.loc[2026, mes]) if 2026 in matriz.index else 0.0
        var_24_26[mes] = (v26 / v24 - 1) * 100 if v24 and v26 else pd.NA
        var_25_26[mes] = (v26 / v25 - 1) * 100 if v25 and v26 else pd.NA

        variacoes = []
        if mes > 1:
            for a in anos:
                ant = float(matriz.loc[a, mes - 1])
                atual = float(matriz.loc[a, mes])
                if ant > 0 and atual > 0:
                    variacoes.append((atual / ant - 1) * 100)
        mom_med[mes] = float(pd.Series(variacoes).median()) if variacoes else pd.NA

    total_base = sum(base_vals.values()) or 1.0
    part_base = {m: base_vals[m] / total_base for m in range(1,13)}
    scores = {}
    for m in range(1,13):
        sinais = []
        if not pd.isna(var_25_26[m]):
            sinais.append(float(var_25_26[m]) / 100)
        if not pd.isna(var_24_26[m]):
            v = max(float(var_24_26[m]) / 100, -0.95)
            sinais.append((1 + v) ** 0.5 - 1)
        trend = sum(sinais) / len(sinais) if sinais else 0.0
        trend = max(-0.30, min(0.30, trend))
        mom = 0.0 if pd.isna(mom_med[m]) else max(-0.30, min(0.30, float(mom_med[m]) / 100))
        scores[m] = max(part_base[m] * (1 + 0.35 * trend + 0.20 * mom), 0.0001)

    total_score = sum(scores.values()) or 1.0
    pesos = {m: scores[m] / total_score for m in range(1,13)}
    bruto = {m: float(meta_anual) * pesos[m] for m in range(1,13)}
    arred, alvo = _reconciliar_dezenas_milhar(bruto, meta_anual)

    meses_nome = {1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez'}
    ranking = sorted(base_vals, key=base_vals.get, reverse=True)
    fortes = set(ranking[:4])
    fracos = set(ranking[-4:])
    linhas = []
    for m in range(1,13):
        classe = 'Mês forte' if m in fortes else ('Mês fraco' if m in fracos else 'Mês intermediário')
        leitura = classe
        if not pd.isna(var_25_26[m]):
            leitura += f" • 25→26 {float(var_25_26[m]):+.1f}%"
        if not pd.isna(mom_med[m]):
            leitura += f" • vs mês anterior {float(mom_med[m]):+.1f}%"
        linhas.append({
            'Mês': meses_nome[m],
            'Média histórica': base_vals[m],
            'Mediana histórica': medianas[m],
            'Part. sazonal %': part_base[m] * 100,
            'Var. 2024→2026 %': var_24_26[m],
            'Var. 2025→2026 %': var_25_26[m],
            'Var. média vs mês anterior %': mom_med[m],
            'Peso sugerido %': pesos[m] * 100,
            'Meta sugerida': arred[m],
            'Leitura do modelo': leitura,
        })
    return pd.DataFrame(linhas), arred, alvo


def render_sugestao_meta_inteligente(vendas, ativos, usuario):
    perfil = str(usuario.get('perfil') or '')
    if perfil not in ('ADMIN', 'GERENTE'):
        return

    st.markdown('### Sugestão inteligente da meta anual')
    st.caption('O modelo considera força histórica dos meses, mediana, comportamento mais recente, comparação 2024→2026 e 2025→2026 e a variação de um mês para o outro. As metas mensais são fechadas em dezenas de milhar.')

    anos_hist = sorted(vendas.loc[vendas['FATURADO'], 'DATA_FAT'].dropna().dt.year.astype(int).unique().tolist())
    ano_padrao = (max(anos_hist) + 1) if anos_hist else 2027
    c1, c2 = st.columns([1, 2])
    ano_meta = c1.selectbox('Ano da meta inteligente', sorted(set([ano_padrao, ano_padrao + 1, 2027])), index=0, key='gm_ai_ano')
    valor_padrao = 112_000_000.0 if int(ano_meta) == 2027 else 0.0
    meta_anual = c2.number_input('Meta anual', min_value=0.0, value=valor_padrao, step=10000.0, format='%.2f', key='gm_ai_meta')

    tabela, sugestao, meta_arred = _modelo_meta_inteligente(vendas, ativos, meta_anual, ano_meta)
    if tabela.empty:
        st.info('Não há histórico suficiente para montar a sugestão.')
        return

    if abs(meta_arred - float(meta_anual)) > 0.01:
        st.info(f'A meta anual foi ajustada para {brl(meta_arred)} para respeitar o padrão de dezenas de milhar.')

    st.caption('Arredondamento padrão: somente múltiplos de R$ 10.000,00. Ex.: R$ 433.120,00 é tratado como aproximadamente R$ 430.000,00, e o saldo é redistribuído para que o total anual feche exatamente.')
    edit = st.data_editor(
        tabela,
        use_container_width=True,
        hide_index=True,
        disabled=[c for c in tabela.columns if c != 'Meta sugerida'],
        column_config={
            'Média histórica': st.column_config.NumberColumn(format='localized'),
            'Mediana histórica': st.column_config.NumberColumn(format='localized'),
            'Part. sazonal %': st.column_config.NumberColumn(format='%.2f%%'),
            'Var. 2024→2026 %': st.column_config.NumberColumn(format='%.1f%%'),
            'Var. 2025→2026 %': st.column_config.NumberColumn(format='%.1f%%'),
            'Var. média vs mês anterior %': st.column_config.NumberColumn(format='%.1f%%'),
            'Peso sugerido %': st.column_config.NumberColumn(format='%.2f%%'),
            'Meta sugerida': st.column_config.NumberColumn(format='localized', step=10000.0),
        },
        key=f'gm_ai_editor_{ano_meta}_{int(meta_arred)}'
    )

    valores_edit = pd.to_numeric(edit['Meta sugerida'], errors='coerce').fillna(0)
    fora_padrao = valores_edit.apply(lambda v: abs(v / 10000 - round(v / 10000)) > 1e-9).any()
    soma = float(valores_edit.sum())
    d1, d2, d3 = st.columns(3)
    d1.metric('Meta anual', brl(meta_arred))
    d2.metric('Soma mensal', brl(soma))
    d3.metric('Diferença', brl(meta_arred - soma))
    if fora_padrao:
        st.warning('Há valor mensal fora do padrão de R$ 10.000,00. Ajuste antes de aplicar.')
    elif abs(meta_arred - soma) <= 0.01:
        st.success('Distribuição mensal fechada e dentro do padrão de arredondamento.')
    else:
        st.warning('A soma mensal ainda não fecha a meta anual.')

    if perfil == 'ADMIN' and st.button('Aplicar sugestão ao ciclo anual', use_container_width=True, disabled=fora_padrao or abs(meta_arred - soma) > 0.01, key=f'gm_ai_apply_{ano_meta}'):
        mapa_mes = {'Jan':1,'Fev':2,'Mar':3,'Abr':4,'Mai':5,'Jun':6,'Jul':7,'Ago':8,'Set':9,'Out':10,'Nov':11,'Dez':12}
        store = gm._load_store()
        meses = list(range(1,13))
        key = gm._cycle_key(int(ano_meta), meses)
        cycle = copy.deepcopy(store.get('cycles', {}).get(key) or gm._empty_cycle(int(ano_meta), meses, 'Anual', meta_arred, usuario))
        cycle['ano'] = int(ano_meta)
        cycle['meses'] = meses
        cycle['tipo'] = 'Anual'
        cycle['meta_empresa'] = float(meta_arred)
        cycle['meta_mensal'] = {str(mapa_mes[str(r['Mês'])]): float(r['Meta sugerida']) for _, r in edit.iterrows()}
        cycle['metodologia_meta_mensal'] = {
            'modelo': 'inteligente_historico',
            'arredondamento': 10000,
            'criterios': ['força histórica', 'mediana', '2024→2026', '2025→2026', 'variação mês a mês'],
        }
        cycle['atualizado_em'] = gm._now()
        gm._event(cycle, 'APLICAR_SUGESTAO_INTELIGENTE_ANUAL', usuario, f'Meta anual {meta_arred:.0f}')
        store.setdefault('cycles', {})[key] = cycle
        ok, msg = gm._save_store(store)
        (st.success if ok else st.error)(msg)
        if ok:
            st.session_state['gm2_ano'] = int(ano_meta)
            st.session_state['gm2_tipo'] = 'Anual'
            st.session_state['gm2_inicio'] = 'Janeiro'
            st.rerun()

    st.divider()


USUARIO_ATUAL = auth_bootstrap()

if st.sidebar.button('↻ Atualizar bases agora', use_container_width=True):
    load_data.clear()
    drive_bytes.clear()
    st.session_state.pop('_gm_store_cache', None)
    st.rerun()

try:
    vendas, rcas, metas = load_data()
except Exception as exc:
    st.error(str(exc))
    st.stop()

ativos = scope_ativos(rcas[rcas['ATIVO'].eq('S')].copy(), USUARIO_ATUAL)

if USUARIO_ATUAL.get('perfil') == 'ADMIN' and st.session_state.get('admin_users_page'):
    render_admin_users(rcas)
    st.stop()

st.markdown("""
<div class='brandbar'>
  <div>
    <div class='brand-title'>Gestão de Metas</div>
    <div class='brand-sub'>Planejamento • análise histórica • distribuição • justificativas • aprovação</div>
  </div>
  <div class='brand-word'>REBANHO</div>
</div>
""", unsafe_allow_html=True)

if USUARIO_ATUAL.get('perfil') == 'RCA':
    st.info('A Gestão de Metas está disponível para Supervisor, Gerente e Admin. O perfil RCA permanece no acompanhamento operacional.')
    st.stop()

aplicar_formatacao_comparativos()
render_historico_planejamento(vendas, ativos)
render_sugestao_meta_inteligente(vendas, ativos, USUARIO_ATUAL)

gm.render_gestao_metas(
    vendas=vendas,
    metas=metas,
    ativos=ativos,
    usuario=USUARIO_ATUAL,
    brl=brl,
    brl_compacto=brl_compacto,
    pct=pct,
    kpi=kpi,
)
