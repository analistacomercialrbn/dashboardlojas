import os, io, re, unicodedata
from datetime import datetime

import numpy as np
import pandas as pd
import requests
import streamlit as st
import plotly.express as px

st.set_page_config(
    page_title="Logística Operacional | RBN",
    page_icon="🚚",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """<style>
.block-container{padding-top:1.7rem;max-width:1500px}
[data-testid="stSidebar"]{background:#0f2f2a}
[data-testid="stSidebar"] *{color:white}
.ttl{font-size:30px;font-weight:800;color:#143c35}.sub{color:#667085;margin-bottom:18px}
.card{background:white;border:1px solid #e7ecea;border-radius:14px;padding:15px 17px;min-height:105px}
.lab{font-size:12px;color:#667085;font-weight:700;text-transform:uppercase}.val{font-size:27px;color:#143c35;font-weight:800;margin-top:7px}.help{font-size:11px;color:#98a2b3;margin-top:4px}
.section{font-size:18px;font-weight:750;color:#143c35;margin:12px 0 8px}
</style>""",
    unsafe_allow_html=True,
)

UF_NOME = {
    "AL": "Alagoas", "BA": "Bahia", "CE": "Ceará", "MA": "Maranhão",
    "PB": "Paraíba", "PE": "Pernambuco", "PI": "Piauí",
    "RN": "Rio Grande do Norte", "SE": "Sergipe",
}
NOME_UF = {
    unicodedata.normalize("NFKD", v).encode("ascii", "ignore").decode("ascii").upper(): k
    for k, v in UF_NOME.items()
}


def norm(s):
    s = "" if s is None else str(s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s.replace("\n", " ")).strip().upper()


def txt(v):
    if pd.isna(v):
        return None
    s = str(v).strip()
    return s or None


def xdate(v):
    if pd.isna(v) or v == "":
        return pd.NaT
    if isinstance(v, (pd.Timestamp, datetime)):
        return pd.to_datetime(v, errors="coerce")
    if isinstance(v, (int, float, np.integer, np.floating)) and 30000 <= float(v) <= 70000:
        return pd.Timestamp("1899-12-30") + pd.to_timedelta(float(v), unit="D")
    return pd.to_datetime(v, errors="coerce", dayfirst=True)


def wait(v):
    if pd.isna(v) or v == "":
        return np.nan
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    d = pd.to_datetime(v, errors="coerce")
    if pd.notna(d) and d.year <= 1901:
        return float((d - pd.Timestamp("1899-12-31")).days)
    m = re.search(r"(\d+(?:[\.,]\d+)?)", str(v))
    return float(m.group(1).replace(",", ".")) if m else np.nan


def br(x, d=0):
    if pd.isna(x):
        return "-"
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def money(x):
    return f"R$ {br(x, 2)}"


def card(label, value, help_=""):
    st.markdown(
        f'<div class="card"><div class="lab">{label}</div>'
        f'<div class="val">{value}</div><div class="help">{help_}</div></div>',
        unsafe_allow_html=True,
    )


def cards(items):
    cols = st.columns(len(items))
    for c, item in zip(cols, items):
        with c:
            card(*item)


def city_key(v):
    if v is None or pd.isna(v):
        return None
    s = str(v).strip().upper()
    s = re.sub(r"\s*[-/]\s*[A-Z]{2}\s*$", "", s)
    return norm(s)


def city_uf(v):
    if v is None or pd.isna(v):
        return None
    m = re.search(r"[-/]\s*([A-Z]{2})\s*$", str(v).upper().strip())
    return m.group(1) if m else None


def secret(name, default=None):
    try:
        return st.secrets.get(name, default)
    except Exception:
        return os.getenv(name, default)


@st.cache_data(ttl=300, show_spinner=False)
def source_bytes():
    url = secret("DATA_XLSX_URL")
    if not url:
        raise FileNotFoundError("Configure DATA_XLSX_URL em Secrets.")
    r = requests.get(url, timeout=45)
    r.raise_for_status()
    return io.BytesIO(r.content)


@st.cache_data(ttl=3600, show_spinner=False)
def geojson_ne():
    url = secret(
        "MAP_GEOJSON_URL",
        "https://drive.google.com/uc?export=download&id=1syIzmYAeSd6_LS0d3P-yO411KsVzDP5K",
    )
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


@st.cache_data(ttl=300, show_spinner=False)
def load():
    raw = pd.read_excel(source_bytes(), sheet_name="FORMAÇÃO 2026", header=1, engine="openpyxl")
    raw.columns = [norm(c) for c in raw.columns]
    ren = {
        "TEMPO ESPERA": "TEMPO_ESPERA",
        "DATA IMPLANTACAO": "DATA_IMPLANTACAO",
        "CLIENTE": "CLIENTE",
        "VENDEDOR": "VENDEDOR",
        "CIDADE": "CIDADE",
        "LOCAL CARREGAMENTO": "LOCAL_CARREGAMENTO",
        "PRODUTO": "PRODUTO",
        "VOLUMES": "VOLUMES",
        "PESO": "PESO",
        "CUSTOS R$": "CUSTOS",
        "OBSERVACOES": "OBSERVACOES",
        "CAMINHAO": "CAMINHAO",
        "MOTORISTA": "MOTORISTA",
        "STATUS DA ENTREGA": "STATUS",
        "DATA CARREGAMENTO (EXPEDICAO)": "DATA_CARREGAMENTO",
        "DATA CHEGADA CLIENTE": "DATA_CHEGADA",
        "CLASSIFICACAO DE ROTA": "CLASSIFICACAO_ROTA",
        "NOTA FISCAL": "NOTA_FISCAL",
        "CATEGORIA OCORRENCIA": "CATEGORIA_OCORRENCIA",
        "FOLLOW UP OCORRENCIA": "FOLLOW_UP",
        "CONFERENTE": "CONFERENTE",
        "SEPARADOR": "SEPARADOR",
        "PREVISAO DE ROTA": "PREVISAO_ROTA",
    }
    raw = raw.rename(columns={c: ren.get(c, c) for c in raw.columns})
    cols = list(ren.values())
    for c in cols:
        if c not in raw.columns:
            raw[c] = np.nan
    d = raw[cols].copy()
    d = d[d.notna().any(axis=1)]

    for c in [
        "CLIENTE", "VENDEDOR", "CIDADE", "LOCAL_CARREGAMENTO", "PRODUTO",
        "CAMINHAO", "MOTORISTA", "STATUS", "CLASSIFICACAO_ROTA",
        "CATEGORIA_OCORRENCIA", "FOLLOW_UP", "CONFERENTE", "SEPARADOR", "OBSERVACOES",
    ]:
        d[c] = d[c].map(txt)
    for c in ["VOLUMES", "PESO", "CUSTOS"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    for c in ["DATA_IMPLANTACAO", "DATA_CARREGAMENTO", "DATA_CHEGADA", "PREVISAO_ROTA"]:
        d[c] = d[c].map(xdate)

    d["DIAS_ESPERA"] = d["TEMPO_ESPERA"].map(wait)
    s = d["STATUS"].fillna("").str.upper()
    d["ENTREGUE"] = s.str.contains("ENTREG")
    d["EM_ROTA"] = s.str.contains("ROTA") & ~d["ENTREGUE"]
    d["CARREGADO"] = s.str.contains("CARREG") & ~d["ENTREGUE"]
    d["TEM_OCORRENCIA"] = d["CATEGORIA_OCORRENCIA"].notna() | d["FOLLOW_UP"].notna()
    d["MUN_KEY"] = d["CIDADE"].map(city_key)
    d["UF_KEY"] = d["CIDADE"].map(city_uf)

    try:
        rg = pd.read_excel(source_bytes(), sheet_name="CADASTRO REGIAO", header=0, engine="openpyxl")
        rg.columns = [norm(c) for c in rg.columns]
        mc = next((c for c in rg.columns if "MUNICIPIO" in c), None)
        rc = next((c for c in rg.columns if "REGIAO DE PLANEJAMENTO" in c), None)
        if mc and rc:
            rg = rg[[mc, rc]].dropna()
            rg["MUN_KEY"] = rg[mc].map(city_key)
            d = d.merge(
                rg[["MUN_KEY", rc]].drop_duplicates("MUN_KEY"),
                on="MUN_KEY",
                how="left",
            ).rename(columns={rc: "REGIAO"})
        else:
            d["REGIAO"] = np.nan
    except Exception:
        d["REGIAO"] = np.nan

    d["REGIAO_OPERACIONAL"] = (
        d["REGIAO"].fillna(d["CLASSIFICACAO_ROTA"]).fillna("SEM REGIÃO")
    )
    return d


def prepare_geo(base, gj):
    uf_by_city, valid_locs = {}, set()
    for ft in gj.get("features", []):
        p = ft.setdefault("properties", {})
        mun = city_key(p.get("NM_MUN"))
        uf = str(p.get("SIGLA_UF", "")).upper().strip()
        loc = (mun or "") + "|" + uf
        p["LOC"] = loc
        valid_locs.add(loc)
        if mun and uf:
            uf_by_city.setdefault(mun, set()).add(uf)

    b = base.copy()
    missing = b["UF_KEY"].isna() | b["UF_KEY"].astype(str).str.strip().eq("")
    b.loc[missing, "UF_KEY"] = b.loc[missing, "MUN_KEY"].map(
        lambda m: next(iter(uf_by_city.get(m, set())))
        if len(uf_by_city.get(m, set())) == 1 else None
    )
    b["UF_NOME"] = b["UF_KEY"].map(UF_NOME)
    b["LOC"] = b["MUN_KEY"].fillna("") + "|" + b["UF_KEY"].fillna("")
    b["MAP_MATCH"] = b["LOC"].isin(valid_locs)
    return b


def cidade_agg(base):
    x = base.copy()
    x["PESO_ABERTO_L"] = np.where(~x.ENTREGUE, x.PESO.fillna(0), 0)
    x["ABERTO_L"] = (~x.ENTREGUE).astype(int)
    g = x.groupby(["MUN_KEY", "UF_KEY", "UF_NOME"], dropna=False).agg(
        CIDADE=("CIDADE", "first"),
        REGIAO=("REGIAO_OPERACIONAL", "first"),
        PESO_ABERTO=("PESO_ABERTO_L", "sum"),
        REGISTROS_ABERTOS=("ABERTO_L", "sum"),
        CLIENTES=("CLIENTE", "nunique"),
        TEMPO_MEDIO=("DIAS_ESPERA", "mean"),
        OCORRENCIAS=("TEM_OCORRENCIA", "sum"),
        EM_ROTA=("EM_ROTA", "sum"),
    ).reset_index()
    g["LOC"] = g["MUN_KEY"].fillna("") + "|" + g["UF_KEY"].fillna("")
    return g


def reset_map_selection(prefix):
    st.session_state[prefix + "_reg"] = "Todas"
    st.session_state[prefix + "_city"] = "Visão da região"


def mapa_logistico(base, key_prefix="mapa"):
    st.markdown('<div class="section">Mapa logístico — Nordeste</div>', unsafe_allow_html=True)
    st.caption(
        "Na visão inicial, a intensidade do azul representa o peso em aberto consolidado da regional. "
        "Ao abrir uma regional, o mapa mostra somente as cidades daquela regional e a intensidade passa "
        "a representar o indicador por cidade."
    )

    indicador = st.selectbox(
        "Indicador por cidade (após abrir a regional)",
        ["Peso em aberto", "Formações em aberto", "Tempo médio de espera", "Ocorrências"],
        key=key_prefix + "_ind",
    )
    metric = {
        "Peso em aberto": "PESO_ABERTO",
        "Formações em aberto": "REGISTROS_ABERTOS",
        "Tempo médio de espera": "TEMPO_MEDIO",
        "Ocorrências": "OCORRENCIAS",
    }[indicador]

    try:
        gj = geojson_ne()
    except Exception as e:
        st.warning("A malha municipal ainda não está acessível ao Streamlit.")
        st.code(str(e))
        return

    base_map = prepare_geo(base, gj)
    g = cidade_agg(base_map[base_map["MAP_MATCH"]])

    estados = ["Nordeste"] + [UF_NOME[u] for u in ["CE", "PI", "MA", "RN", "PB", "PE", "AL", "SE", "BA"]]
    estado = st.session_state.get(key_prefix + "_uf", "Nordeste")
    if estado not in estados:
        estado = "Nordeste"

    uf_sel = None if estado == "Nordeste" else NOME_UF[norm(estado)]
    base_estado = base_map if uf_sel is None else base_map[base_map.UF_KEY.eq(uf_sel)]
    g_estado = g if uf_sel is None else g[g.UF_KEY.eq(uf_sel)]

    regions = sorted([x for x in base_estado.REGIAO_OPERACIONAL.dropna().unique() if str(x).strip()])
    reg = st.session_state.get(key_prefix + "_reg", "Todas")
    if reg not in ["Todas"] + regions:
        reg = "Todas"
        st.session_state[key_prefix + "_reg"] = "Todas"

    base_reg = base_estado if reg == "Todas" else base_estado[base_estado.REGIAO_OPERACIONAL.eq(reg)]
    g_reg = g_estado if reg == "Todas" else g_estado[g_estado.REGIAO.eq(reg)]
    city_opts = sorted([x for x in g_reg.CIDADE.dropna().unique() if str(x).strip()])
    cidade = st.session_state.get(key_prefix + "_city", "Visão da região")
    if cidade not in ["Visão da região"] + city_opts:
        cidade = "Visão da região"
        st.session_state[key_prefix + "_city"] = "Visão da região"

    reg_base = base_estado.copy()
    reg_base["PESO_ABERTO_L"] = np.where(~reg_base.ENTREGUE, reg_base.PESO.fillna(0), 0)
    reg_resumo = reg_base.groupby("REGIAO_OPERACIONAL", dropna=False).agg(
        PESO_REGIONAL_ABERTO=("PESO_ABERTO_L", "sum"),
        CIDADES_REGIONAL=("MUN_KEY", "nunique"),
        CLIENTES_REGIONAL=("CLIENTE", "nunique"),
        FORMACOES_REGIONAIS=("CLIENTE", "size"),
    ).reset_index().rename(columns={"REGIAO_OPERACIONAL": "REGIAO"})
    g_regional = g_estado.merge(reg_resumo, on="REGIAO", how="left")

    c1, c2 = st.columns([1.35, 1])
    clicked_region, clicked_city = None, None

    with c1:
        plotg = g_regional.copy() if reg == "Todas" else g_reg.copy()
        if plotg.empty:
            st.info("Não há municípios da seleção atual correspondentes à malha do mapa.")
        else:
            if reg == "Todas":
                fig = px.choropleth(
                    plotg,
                    geojson=gj,
                    locations="LOC",
                    featureidkey="properties.LOC",
                    color="PESO_REGIONAL_ABERTO",
                    hover_name="REGIAO",
                    custom_data=["LOC", "CIDADE", "REGIAO"],
                    hover_data={
                        "CIDADE": True, "UF_NOME": True, "PESO_REGIONAL_ABERTO": ":,.0f",
                        "CIDADES_REGIONAL": True, "CLIENTES_REGIONAL": True,
                        "FORMACOES_REGIONAIS": True, "LOC": False,
                    },
                    color_continuous_scale="Blues",
                    labels={"PESO_REGIONAL_ABERTO": "Peso regional em aberto"},
                )
                fig.update_layout(coloraxis_colorbar=dict(title="Peso regional em aberto", len=.68, thickness=14))
            else:
                fig = px.choropleth(
                    plotg,
                    geojson=gj,
                    locations="LOC",
                    featureidkey="properties.LOC",
                    color=metric,
                    hover_name="CIDADE",
                    custom_data=["LOC", "CIDADE", "REGIAO"],
                    hover_data={
                        "UF_NOME": True, "REGIAO": True, "PESO_ABERTO": ":,.0f",
                        "REGISTROS_ABERTOS": True, "TEMPO_MEDIO": ":.1f",
                        "OCORRENCIAS": True, "LOC": False,
                    },
                    color_continuous_scale="Blues",
                )
                fig.update_layout(coloraxis_colorbar=dict(title=indicador, len=.68, thickness=14))

            fig.update_geos(fitbounds="locations", visible=False, projection_type="mercator")
            fig.update_layout(height=600, margin=dict(l=0, r=0, t=0, b=0), clickmode="event+select")

            event = st.plotly_chart(
                fig,
                use_container_width=True,
                config={"displayModeBar": False},
                key=f"{key_prefix}_plot_{norm(reg)}",
                on_select="rerun",
                selection_mode="points",
            )
            try:
                pts = event.selection.points
                if pts:
                    pt = pts[-1]
                    loc = pt.get("location") or (pt.get("customdata") or [None])[0]
                    hit = plotg[plotg.LOC.eq(loc)]
                    if len(hit):
                        if reg == "Todas":
                            clicked_region = hit.iloc[0]["REGIAO"]
                        else:
                            clicked_city = hit.iloc[0]["CIDADE"]
            except Exception:
                clicked_region, clicked_city = None, None

        unmatched = base_reg[~base_reg.MAP_MATCH & base_reg.MUN_KEY.notna()]
        if len(unmatched):
            st.caption(
                f"{len(unmatched)} registro(s) da seleção ainda não puderam ser associados "
                "com segurança a um município da malha."
            )

    if clicked_region and clicked_region in regions:
        st.session_state[key_prefix + "_reg"] = clicked_region
        st.session_state[key_prefix + "_city"] = "Visão da região"
        st.rerun()

    if clicked_city and clicked_city in city_opts:
        st.session_state[key_prefix + "_city"] = clicked_city
        st.rerun()

    with c2:
        estado = st.selectbox("Estado", estados, key=key_prefix + "_uf")
        uf_sel = None if estado == "Nordeste" else NOME_UF[norm(estado)]
        base_estado = base_map if uf_sel is None else base_map[base_map.UF_KEY.eq(uf_sel)]
        g_estado = g if uf_sel is None else g[g.UF_KEY.eq(uf_sel)]

        regions = sorted([x for x in base_estado.REGIAO_OPERACIONAL.dropna().unique() if str(x).strip()])
        current_reg = st.session_state.get(key_prefix + "_reg", "Todas")
        if current_reg not in ["Todas"] + regions:
            st.session_state[key_prefix + "_reg"] = "Todas"

        reg = st.selectbox("Regional", ["Todas"] + regions, key=key_prefix + "_reg")

        if reg != "Todas":
            st.button(
                "← Voltar ao mapa geral",
                key=key_prefix + "_back",
                use_container_width=True,
                on_click=reset_map_selection,
                args=(key_prefix,),
            )

        base_reg = base_estado if reg == "Todas" else base_estado[base_estado.REGIAO_OPERACIONAL.eq(reg)]
        g_reg = g_estado if reg == "Todas" else g_estado[g_estado.REGIAO.eq(reg)]
        city_opts = sorted([x for x in g_reg.CIDADE.dropna().unique() if str(x).strip()])

        current_city = st.session_state.get(key_prefix + "_city", "Visão da região")
        if current_city not in ["Visão da região"] + city_opts:
            st.session_state[key_prefix + "_city"] = "Visão da região"

        cidade = st.selectbox(
            "Cidade selecionada",
            ["Visão da região"] + city_opts,
            key=key_prefix + "_city",
        )

        det = base_reg if cidade == "Visão da região" else base_reg[base_reg.CIDADE.eq(cidade)]
        aberto = det[~det.ENTREGUE]

        titulo = estado if reg == "Todas" else reg
        if estado == "Nordeste" and reg == "Todas":
            titulo = "Nordeste"
        if cidade != "Visão da região":
            titulo = cidade

        st.markdown(f"### {titulo}")
        aa, bb, cc = st.columns(3)
        with aa:
            card("Peso em aberto", f"{br(aberto.PESO.sum()/1000, 1)} t")
        with bb:
            card("Clientes", br(aberto.CLIENTE.nunique()))
        with cc:
            card("Formações", br(len(aberto)))

        aa, bb, cc = st.columns(3)
        with aa:
            card("Espera média", f"{br(aberto.DIAS_ESPERA.mean(), 1)} dias")
        with bb:
            card("Em rota", br(det.EM_ROTA.sum()))
        with cc:
            card("Ocorrências", br(det.TEM_OCORRENCIA.sum()))

        if reg == "Todas":
            tr = reg_resumo.copy().sort_values("PESO_REGIONAL_ABERTO", ascending=False)
            st.markdown("**Resumo por regional**")
            st.dataframe(
                tr,
                use_container_width=True,
                hide_index=True,
                column_config={
                    "REGIAO": "Regional",
                    "PESO_REGIONAL_ABERTO": st.column_config.NumberColumn("Peso em aberto", format="%.0f kg"),
                    "CIDADES_REGIONAL": "Cidades",
                    "CLIENTES_REGIONAL": "Clientes",
                    "FORMACOES_REGIONAIS": "Formações",
                },
            )
        elif cidade == "Visão da região":
            t = g_reg[
                ["CIDADE", "UF_NOME", "PESO_ABERTO", "REGISTROS_ABERTOS", "CLIENTES", "TEMPO_MEDIO", "OCORRENCIAS"]
            ].sort_values("PESO_ABERTO", ascending=False).head(15)
            st.markdown("**Cidades da regional**")
            st.dataframe(t, use_container_width=True, hide_index=True)
        else:
            st.markdown("**Motoristas na cidade**")
            tm = det.groupby("MOTORISTA", dropna=False).agg(
                PESO=("PESO", "sum"),
                FORMACOES=("CLIENTE", "size"),
                CLIENTES=("CLIENTE", "nunique"),
            ).reset_index().sort_values("PESO", ascending=False)
            st.dataframe(tm, use_container_width=True, hide_index=True)

    cidade_final = st.session_state.get(key_prefix + "_city", "Visão da região")
    reg_final = st.session_state.get(key_prefix + "_reg", "Todas")

    if cidade_final != "Visão da região":
        det_cli = base_map[base_map.CIDADE.eq(cidade_final)].copy()
        st.markdown(f"### Clientes — {cidade_final}")
        st.caption("Detalhamento dos registros da cidade selecionada no mapa ou no filtro lateral.")
        if len(det_cli):
            resumo = det_cli.groupby(["CLIENTE", "VENDEDOR"], dropna=False).agg(
                PESO=("PESO", "sum"),
                VOLUMES=("VOLUMES", "sum"),
                FORMACOES=("CLIENTE", "size"),
                ESPERA_MEDIA=("DIAS_ESPERA", "mean"),
                EM_ROTA=("EM_ROTA", "sum"),
                OCORRENCIAS=("TEM_OCORRENCIA", "sum"),
            ).reset_index().sort_values("PESO", ascending=False)
            st.dataframe(
                resumo,
                use_container_width=True,
                hide_index=True,
                column_config={
                    "CLIENTE": "Cliente",
                    "VENDEDOR": "Vendedor",
                    "PESO": st.column_config.NumberColumn("Peso", format="%.0f kg"),
                    "VOLUMES": st.column_config.NumberColumn("Volumes", format="%.0f"),
                    "FORMACOES": "Formações",
                    "ESPERA_MEDIA": st.column_config.NumberColumn("Espera média", format="%.1f dias"),
                    "EM_ROTA": "Em rota",
                    "OCORRENCIAS": "Ocorrências",
                },
            )
            with st.expander("Ver detalhes das formações dos clientes", expanded=False):
                cols = [
                    "CLIENTE", "VENDEDOR", "PRODUTO", "PESO", "VOLUMES", "DIAS_ESPERA",
                    "STATUS", "PREVISAO_ROTA", "MOTORISTA", "CAMINHAO",
                    "CATEGORIA_OCORRENCIA", "FOLLOW_UP",
                ]
                st.dataframe(
                    det_cli[cols].sort_values(["CLIENTE", "DIAS_ESPERA"], ascending=[True, False]),
                    use_container_width=True,
                    hide_index=True,
                )
        else:
            st.info("Não há registros para a cidade selecionada.")
    elif reg_final != "Todas":
        st.caption(
            "A regional está aberta. Clique em uma cidade no mapa para ver abaixo os detalhes dos clientes. "
            "Use “Voltar ao mapa geral” para sair da regional."
        )
    else:
        st.caption("Clique em uma regional no mapa para abrir suas cidades.")


try:
    df = load()
except Exception as e:
    st.error("Fonte não configurada")
    st.info("Defina DATA_XLSX_URL em Secrets.")
    st.code(str(e))
    st.stop()

with st.sidebar:
    st.markdown("### 🚚 LOGÍSTICA RBN")
    st.caption("Dashboard Operacional · V1")
    page = st.radio(
        "Menu",
        ["Visão Geral", "Mapa Logístico", "Formação de Cargas", "Rotas e Entregas",
         "Motoristas e Frota", "Pendências", "Ocorrências", "Custos"],
        label_visibility="collapsed",
    )
    st.markdown("---")
    st.markdown("#### Filtros")

    def multi(label, col):
        return st.multiselect(label, sorted([x for x in df[col].dropna().unique() if str(x).strip()]))

    dates = df.DATA_IMPLANTACAO.dropna()
    period = None
    if len(dates):
        period = st.date_input(
            "Período",
            value=(dates.min().date(), dates.max().date()),
            min_value=dates.min().date(),
            max_value=dates.max().date(),
        )

    filters = [
        (multi("Vendedor", "VENDEDOR"), "VENDEDOR"),
        (multi("Região", "REGIAO_OPERACIONAL"), "REGIAO_OPERACIONAL"),
        (multi("Cidade", "CIDADE"), "CIDADE"),
        (multi("Motorista", "MOTORISTA"), "MOTORISTA"),
        (multi("Caminhão", "CAMINHAO"), "CAMINHAO"),
        (multi("Status", "STATUS"), "STATUS"),
        (multi("Produto", "PRODUTO"), "PRODUTO"),
        (multi("Classificação de rota", "CLASSIFICACAO_ROTA"), "CLASSIFICACAO_ROTA"),
    ]
    st.caption("Somente leitura · nenhum dado é gravado na planilha.")

f = df.copy()
if period and len(period) == 2:
    a = pd.Timestamp(period[0])
    b = pd.Timestamp(period[1]) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    f = f[(f.DATA_IMPLANTACAO.isna()) | f.DATA_IMPLANTACAO.between(a, b)]

for vals, col in filters:
    if vals:
        f = f[f[col].isin(vals)]

st.markdown(
    '<div class="ttl">Logística Operacional</div>'
    '<div class="sub">Gestão de cargas, rotas, entregas, pendências e custos · V1</div>',
    unsafe_allow_html=True,
)

if page == "Visão Geral":
    aberto = f[~f.ENTREGUE]
    cards([
        ("Registros em aberto", br(len(aberto)), ""),
        ("Peso em aberto", f"{br(aberto.PESO.sum()/1000, 1)} t", ""),
        ("Em rota", br(f.EM_ROTA.sum()), ""),
        ("Entregues", br(f.ENTREGUE.sum()), ""),
        ("Espera média", f"{br(aberto.DIAS_ESPERA.mean(), 1)} dias", ""),
        ("Ocorrências", br(f.TEM_OCORRENCIA.sum()), ""),
    ])
    c1, c2 = st.columns([1.2, 1])
    with c1:
        gbar = aberto.groupby("REGIAO_OPERACIONAL", dropna=False).PESO.sum().reset_index().sort_values("PESO").tail(12)
        st.plotly_chart(px.bar(gbar, x="PESO", y="REGIAO_OPERACIONAL", orientation="h"), use_container_width=True)
    with c2:
        sit = pd.DataFrame({
            "Situação": ["Entregue", "Em rota", "Carregado", "Demais"],
            "Qtd": [
                f.ENTREGUE.sum(),
                f.EM_ROTA.sum(),
                f.CARREGADO.sum(),
                (~(f.ENTREGUE | f.EM_ROTA | f.CARREGADO)).sum(),
            ],
        })
        st.plotly_chart(px.pie(sit, names="Situação", values="Qtd", hole=.58), use_container_width=True)
    st.markdown("### Mapa resumido")
    mapa_logistico(f, "geral")

elif page == "Mapa Logístico":
    mapa_logistico(f, "principal")

elif page == "Formação de Cargas":
    cards([
        ("Registros", br(len(f)), ""),
        ("Clientes", br(f.CLIENTE.nunique()), ""),
        ("Volumes", br(f.VOLUMES.sum()), ""),
        ("Peso", f"{br(f.PESO.sum()/1000, 1)} t", ""),
        ("Espera média", f"{br(f.DIAS_ESPERA.mean(), 1)} dias", ""),
    ])
    st.dataframe(
        f[[
            "DATA_IMPLANTACAO", "CLIENTE", "VENDEDOR", "CIDADE", "REGIAO_OPERACIONAL",
            "PRODUTO", "VOLUMES", "PESO", "DIAS_ESPERA", "MOTORISTA",
            "CAMINHAO", "STATUS", "PREVISAO_ROTA",
        ]].sort_values("DIAS_ESPERA", ascending=False),
        use_container_width=True,
        hide_index=True,
    )

elif page == "Rotas e Entregas":
    a = f[~f.ENTREGUE]
    cards([
        ("Regiões", br(a.REGIAO_OPERACIONAL.nunique()), ""),
        ("Clientes em aberto", br(a.CLIENTE.nunique()), ""),
        ("Peso em aberto", f"{br(a.PESO.sum()/1000, 1)} t", ""),
        ("Em rota", br(f.EM_ROTA.sum()), ""),
        ("Sem previsão", br(a.PREVISAO_ROTA.isna().sum()), ""),
    ])
    mapa_logistico(f, "rotas")

elif page == "Motoristas e Frota":
    m = f[f.MOTORISTA.notna()]
    gm = m.groupby("MOTORISTA").agg(
        REGISTROS=("CLIENTE", "size"),
        CLIENTES=("CLIENTE", "nunique"),
        PESO=("PESO", "sum"),
        ENTREGUES=("ENTREGUE", "sum"),
        OCORRENCIAS=("TEM_OCORRENCIA", "sum"),
    ).reset_index()
    cards([
        ("Motoristas", br(m.MOTORISTA.nunique()), ""),
        ("Veículos", br(m.CAMINHAO.nunique()), ""),
        ("Peso associado", f"{br(m.PESO.sum()/1000, 1)} t", ""),
        ("Em rota", br(m.EM_ROTA.sum()), ""),
        ("Ocorrências", br(m.TEM_OCORRENCIA.sum()), ""),
    ])
    st.dataframe(gm.sort_values("PESO", ascending=False), use_container_width=True, hide_index=True)

elif page == "Pendências":
    p = f[~f.ENTREGUE].copy()
    p["SEM_PREVISAO"] = p.PREVISAO_ROTA.isna()
    p["SEM_MOTORISTA"] = p.MOTORISTA.isna()
    p["OCORR_SEM_FOLLOW"] = p.CATEGORIA_OCORRENCIA.notna() & p.FOLLOW_UP.isna()
    cards([
        ("Pendências", br(len(p)), ""),
        ("Espera ≥10d", br(p.DIAS_ESPERA.ge(10).sum()), ""),
        ("Sem previsão", br(p.SEM_PREVISAO.sum()), ""),
        ("Sem motorista", br(p.SEM_MOTORISTA.sum()), ""),
        ("Ocorr. sem follow-up", br(p.OCORR_SEM_FOLLOW.sum()), ""),
    ])
    st.dataframe(
        p[[
            "CLIENTE", "CIDADE", "VENDEDOR", "PESO", "DIAS_ESPERA", "STATUS",
            "PREVISAO_ROTA", "MOTORISTA", "CATEGORIA_OCORRENCIA", "FOLLOW_UP",
        ]].sort_values("DIAS_ESPERA", ascending=False),
        use_container_width=True,
        hide_index=True,
    )

elif page == "Ocorrências":
    o = f[f.TEM_OCORRENCIA].copy()
    cards([
        ("Ocorrências", br(len(o)), ""),
        ("Categorias", br(o.CATEGORIA_OCORRENCIA.nunique()), ""),
        ("Com follow-up", br(o.FOLLOW_UP.notna().sum()), ""),
        ("% follow-up", f"{br(100*o.FOLLOW_UP.notna().mean(), 1)}%", ""),
    ])
    st.dataframe(
        o[[
            "CLIENTE", "CIDADE", "MOTORISTA", "CAMINHAO", "CATEGORIA_OCORRENCIA",
            "FOLLOW_UP", "CONFERENTE", "SEPARADOR", "STATUS",
        ]],
        use_container_width=True,
        hide_index=True,
    )

elif page == "Custos":
    custo = f.CUSTOS.sum(min_count=1)
    peso = f.PESO.sum(min_count=1)
    cards([
        ("Custo informado", money(custo if pd.notna(custo) else 0), ""),
        ("Registros com custo", br(f.CUSTOS.notna().sum()), ""),
        ("Peso total", f"{br(peso/1000, 1)} t", ""),
        ("Custo/kg", money((custo/peso) if pd.notna(custo) and peso else 0), "exploratório"),
    ])
    st.warning("Custos ainda têm cobertura parcial na base.")

st.markdown("---")
st.caption("V1 · Dados processados somente em memória. Nenhuma alteração é realizada nos arquivos de origem.")
