import streamlit as st

NAVY = "#1E2655"
NAVY_2 = "#2D396F"
BLUE = "#4F67A7"
BG = "#F5F7FB"
TEXT = "#20263A"
MUTED = "#737A8C"
BORDER = "#E4E8F0"

NAV_ICONS = {
    "Visão Geral": "⌂",
    "Carteira": "◫",
    "Mix e Oportunidades": "◇",
    "Cidades": "⌖",
    "Gestão de Metas": "◎",
}


def nav_format(label):
    return f"{NAV_ICONS.get(label, '•')}  {label}"


def apply_academy_theme():
    st.markdown(
        f"""
        <style>
        :root {{
          --rbn-navy:{NAVY};
          --rbn-navy-2:{NAVY_2};
          --rbn-blue:{BLUE};
          --rbn-bg:{BG};
          --rbn-text:{TEXT};
          --rbn-muted:{MUTED};
          --rbn-border:{BORDER};
        }}

        html, body, [class*="css"] {{
          font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }}

        [data-testid="stAppViewContainer"] {{
          background:var(--rbn-bg) !important;
        }}
        [data-testid="stHeader"] {{
          background:transparent !important;
          height:0 !important;
        }}
        [data-testid="stToolbar"],
        [data-testid="stDecoration"],
        #MainMenu,
        footer {{
          display:none !important;
        }}

        [data-testid="stMainBlockContainer"],
        .block-container {{
          max-width:none !important;
          width:100% !important;
          padding:1.15rem clamp(1rem,2.2vw,2.8rem) 2.5rem !important;
        }}

        /* Shell lateral no padrão das plataformas internas */
        [data-testid="stSidebar"] {{
          background:#FFFFFF !important;
          border-right:1px solid var(--rbn-border) !important;
          box-shadow:8px 0 30px rgba(30,38,85,.035);
        }}
        [data-testid="stSidebar"] > div:first-child {{
          padding-top:.65rem !important;
        }}
        [data-testid="stSidebarNav"] {{
          display:none !important;
        }}
        [data-testid="stSidebar"] hr {{
          border:none !important;
          border-top:1px solid #EDF0F5 !important;
          margin:.75rem 0 !important;
        }}

        .rbn-sidebar-brand {{
          padding:10px 11px 12px;
          margin:0 0 8px;
          border-bottom:1px solid #EEF0F5;
        }}
        .rbn-sidebar-brand .word {{
          color:var(--rbn-navy);
          font-size:20px;
          font-weight:900;
          letter-spacing:.08em;
          line-height:1;
        }}
        .rbn-sidebar-brand .product {{
          color:var(--rbn-muted);
          font-size:11px;
          font-weight:650;
          margin-top:6px;
        }}
        .rbn-user-card {{
          display:flex;
          align-items:center;
          gap:10px;
          padding:10px 11px;
          margin:7px 0 9px;
          background:#F7F8FC;
          border:1px solid #E9ECF3;
          border-radius:13px;
        }}
        .rbn-avatar {{
          width:34px;
          height:34px;
          border-radius:10px;
          display:flex;
          align-items:center;
          justify-content:center;
          background:var(--rbn-navy);
          color:#fff;
          font-size:12px;
          font-weight:800;
        }}
        .rbn-user-name {{
          color:var(--rbn-text);
          font-size:12px;
          font-weight:750;
          line-height:1.2;
        }}
        .rbn-user-role {{
          color:var(--rbn-muted);
          font-size:10px;
          margin-top:3px;
        }}

        /* Navegação */
        [data-testid="stSidebar"] [role="radiogroup"] {{
          gap:4px !important;
        }}
        [data-testid="stSidebar"] [role="radiogroup"] label {{
          width:100% !important;
          min-height:40px;
          display:flex !important;
          align-items:center !important;
          border:1px solid transparent !important;
          border-radius:10px !important;
          padding:8px 10px !important;
          background:transparent !important;
          color:#49516A !important;
          font-size:12px !important;
          font-weight:650 !important;
          transition:.15s ease !important;
          margin:0 !important;
        }}
        [data-testid="stSidebar"] [role="radiogroup"] label:hover {{
          background:#F4F6FA !important;
          color:var(--rbn-navy) !important;
        }}
        [data-testid="stSidebar"] [role="radiogroup"] label:has(input:checked) {{
          background:#EEF1F8 !important;
          border-color:#E1E6F1 !important;
          color:var(--rbn-navy) !important;
          font-weight:800 !important;
          box-shadow:inset 3px 0 0 var(--rbn-navy);
        }}
        [data-testid="stSidebar"] [role="radiogroup"] label > div:first-child {{
          display:none !important;
        }}

        /* Cabeçalho como aplicação, não como slide */
        .rbn-topbar {{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          background:#FFFFFF;
          border:1px solid var(--rbn-border);
          border-radius:16px;
          padding:14px 18px;
          margin:0 0 16px;
          box-shadow:0 5px 18px rgba(30,38,85,.045);
        }}
        .rbn-topbar-left {{
          min-width:0;
        }}
        .rbn-eyebrow {{
          color:#7B8397;
          font-size:10px;
          font-weight:800;
          letter-spacing:.08em;
          text-transform:uppercase;
          margin-bottom:4px;
        }}
        .rbn-page-title {{
          color:var(--rbn-navy);
          font-size:25px;
          font-weight:820;
          line-height:1.12;
          letter-spacing:-.025em;
        }}
        .rbn-page-sub {{
          color:var(--rbn-muted);
          font-size:11px;
          margin-top:4px;
        }}
        .rbn-brand-pill {{
          flex:none;
          color:#FFFFFF;
          background:var(--rbn-navy);
          border-radius:11px;
          padding:9px 12px;
          font-size:13px;
          font-weight:900;
          letter-spacing:.08em;
        }}

        /* Cards no padrão Academy/Políticas */
        .kpi {{
          background:#FFFFFF !important;
          border:1px solid var(--rbn-border) !important;
          border-radius:14px !important;
          padding:12px 14px !important;
          min-height:78px !important;
          box-shadow:none !important;
        }}
        .kpi-label {{
          color:#7A8294 !important;
          font-size:9.5px !important;
          font-weight:800 !important;
          letter-spacing:.065em !important;
        }}
        .kpi-value {{
          color:var(--rbn-navy) !important;
          font-size:22px !important;
          font-weight:820 !important;
          margin-top:4px !important;
        }}
        .kpi-note {{
          color:#8A91A2 !important;
          font-size:10px !important;
          margin-top:4px !important;
        }}

        [data-testid="stVerticalBlockBorderWrapper"] {{
          background:#FFFFFF !important;
          border:1px solid var(--rbn-border) !important;
          border-radius:15px !important;
          box-shadow:none !important;
        }}

        div[data-testid="stPlotlyChart"] {{
          background:#FFFFFF;
          border:1px solid var(--rbn-border);
          border-radius:15px;
          padding:4px 7px 2px;
          overflow:hidden;
          box-shadow:none;
        }}

        div[data-testid="stDataFrame"] {{
          background:#FFFFFF;
          border:1px solid var(--rbn-border) !important;
          border-radius:14px !important;
          overflow:hidden !important;
          box-shadow:none !important;
        }}

        /* Controles */
        [data-baseweb="select"] > div,
        [data-baseweb="base-input"] {{
          border-radius:10px !important;
          border-color:#E1E5ED !important;
          background:#FFFFFF !important;
          box-shadow:none !important;
        }}
        [data-baseweb="tag"] {{
          background:#EEF1F8 !important;
          color:var(--rbn-navy) !important;
          border-radius:7px !important;
        }}
        div[data-testid="stButton"] > button {{
          border-radius:10px !important;
          min-height:38px;
          border:1px solid #DCE1EB !important;
          box-shadow:none !important;
          font-weight:700 !important;
        }}
        div[data-testid="stButton"] > button[kind="primary"] {{
          background:var(--rbn-navy) !important;
          border-color:var(--rbn-navy) !important;
          color:#fff !important;
        }}
        div[data-testid="stButton"] > button:hover {{
          border-color:#BFC7D8 !important;
          color:var(--rbn-navy) !important;
        }}
        div[data-testid="stButton"] > button[kind="primary"]:hover {{
          background:var(--rbn-navy-2) !important;
          color:#fff !important;
        }}

        [data-testid="stExpander"] {{
          border:1px solid var(--rbn-border) !important;
          border-radius:13px !important;
          background:#FFFFFF !important;
        }}

        h1,h2,h3 {{
          color:var(--rbn-navy) !important;
          letter-spacing:-.02em !important;
        }}
        h3 {{
          font-size:19px !important;
          margin-top:1rem !important;
        }}
        .section-note {{
          color:var(--rbn-muted) !important;
          font-size:11px !important;
        }}
        .filter-chip {{
          background:#EEF1F8 !important;
          color:var(--rbn-navy) !important;
          border:1px solid #E0E5EF !important;
          border-radius:999px !important;
        }}

        /* Insights */
        .insight-card {{
          border-radius:15px !important;
          box-shadow:none !important;
          border-color:#E4E8F0 !important;
        }}

        /* Mobile */
        @media (max-width:1100px) {{
          [data-testid="stMainBlockContainer"],
          .block-container {{
            padding:.8rem .8rem 2rem !important;
          }}
          .rbn-topbar {{
            padding:12px 13px;
            border-radius:14px;
          }}
          .rbn-page-title {{
            font-size:21px;
          }}
          .rbn-page-sub {{
            display:none;
          }}
          .rbn-brand-pill {{
            font-size:11px;
            padding:8px 10px;
          }}
          [data-testid="stHorizontalBlock"] {{
            flex-wrap:wrap !important;
            gap:.65rem !important;
          }}
          [data-testid="column"] {{
            flex:1 1 260px !important;
            min-width:240px !important;
          }}
        }}
        @media (max-width:650px) {{
          [data-testid="column"] {{
            flex:1 1 100% !important;
            width:100% !important;
            min-width:100% !important;
          }}
          .rbn-topbar {{
            align-items:flex-start;
          }}
          .rbn-page-title {{
            font-size:19px;
          }}
          .rbn-brand-pill {{
            display:none;
          }}
          .kpi {{
            min-height:72px !important;
          }}
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_sidebar_brand(product="Supervisão Comercial"):
    st.sidebar.markdown(
        f"""
        <div class="rbn-sidebar-brand">
          <div class="word">REBANHO</div>
          <div class="product">{product}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_user_card(name, role):
    initials = "".join([p[:1] for p in str(name).strip().split()[:2]]).upper() or "RB"
    st.sidebar.markdown(
        f"""
        <div class="rbn-user-card">
          <div class="rbn-avatar">{initials}</div>
          <div>
            <div class="rbn-user-name">{name}</div>
            <div class="rbn-user-role">{str(role).title()}</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_app_header(section, subtitle="Gestão comercial • dados, análises e decisões"):
    st.markdown(
        f"""
        <div class="rbn-topbar">
          <div class="rbn-topbar-left">
            <div class="rbn-eyebrow">Dashboard de Supervisão</div>
            <div class="rbn-page-title">{section}</div>
            <div class="rbn-page-sub">{subtitle}</div>
          </div>
          <div class="rbn-brand-pill">REBANHO</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
