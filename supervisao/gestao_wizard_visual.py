import inspect

import streamlit as st

import gestao_metas as gm


def _fmt_brl_curto(valor):
    try:
        v = float(valor or 0)
    except Exception:
        v = 0.0
    if abs(v) >= 1_000_000:
        return f"R$ {v/1_000_000:.1f} mi".replace('.', ',')
    if abs(v) >= 1_000:
        return f"R$ {v/1_000:.0f} mil".replace('.', ',')
    return f"R$ {v:,.0f}".replace(',', '.')


def _contexto_gestao():
    frame = inspect.currentframe()
    try:
        atual = frame.f_back
        while atual is not None:
            if atual.f_code.co_name == 'render_gestao_metas':
                return atual.f_locals
            atual = atual.f_back
    finally:
        del frame
    return {}


def _status_etapas(cycle):
    meta = float(cycle.get('meta_empresa', 0) or 0)
    mensal = cycle.get('meta_mensal') or {}
    soma_mensal = sum(float(v or 0) for v in mensal.values()) if mensal else 0.0
    meta_ok = meta > 0 and abs(soma_mensal - meta) <= 0.02

    sups = cycle.get('supervisores') or {}
    soma_sup = sum(float((r or {}).get('proposta', 0) or 0) for r in sups.values())
    sup_ok = meta_ok and bool(sups) and abs(soma_sup - meta) <= 0.02

    dep_ok = sup_ok and bool(sups)
    for rec in sups.values():
        alvo = float((rec or {}).get('proposta', 0) or 0)
        deps = (rec or {}).get('departamentos') or {}
        if not deps:
            dep_ok = False
            break
        soma = sum(float((d or {}).get('proposta', 0) or 0) for d in deps.values())
        if abs(soma - alvo) > 0.02:
            dep_ok = False
            break

    rca_ok = dep_ok and bool(sups)
    for rec in sups.values():
        alvo = float((rec or {}).get('proposta', 0) or 0)
        rcas = (rec or {}).get('rcas') or {}
        if not rcas:
            rca_ok = False
            break
        soma = sum(float((r or {}).get('proposta', 0) or 0) for r in rcas.values())
        if abs(soma - alvo) > 0.02:
            rca_ok = False
            break

    aprovado = str(cycle.get('status') or '') == 'APROVADO'
    return [meta_ok, sup_ok, dep_ok, rca_ok, aprovado]


def _render_cabecalho_wizard(ctx):
    cycle = ctx.get('cycle') or {}
    ano = ctx.get('ano')
    meses = ctx.get('meses') or []
    tipo = ctx.get('tipo') or cycle.get('tipo') or ''
    status = str(cycle.get('status') or 'RASCUNHO')
    meta = float(cycle.get('meta_empresa', 0) or 0)

    try:
        periodo = ' • '.join(gm.MESES[int(m)][:3] for m in meses)
    except Exception:
        periodo = ''

    etapas = _status_etapas(cycle)
    nomes = ['Meta global', 'Supervisores', 'Departamentos', 'RCAs', 'Aprovação']
    itens = []
    encontrou_pendente = False
    for i, (nome, ok) in enumerate(zip(nomes, etapas), start=1):
        if ok:
            cls = 'done'
            icone = '✓'
            subt = 'Concluído'
        elif not encontrou_pendente:
            cls = 'active'
            icone = str(i)
            subt = 'Em andamento'
            encontrou_pendente = True
        else:
            cls = 'pending'
            icone = str(i)
            subt = 'Pendente'
        itens.append(f"<div class='gm-step {cls}'><div class='gm-step-icon'>{icone}</div><div><div class='gm-step-title'>{nome}</div><div class='gm-step-sub'>{subt}</div></div></div>")

    status_label = gm.STATUS_LABEL.get(status, status.title())
    st.markdown(
        f"""
        <div class='gm-cyclebar'>
          <div>
            <div class='gm-cycle-kicker'>CICLO EM PLANEJAMENTO</div>
            <div class='gm-cycle-title'>{ano} • {tipo} • {periodo}</div>
          </div>
          <div class='gm-cycle-meta'><span>Meta do ciclo</span><strong>{_fmt_brl_curto(meta)}</strong></div>
          <div class='gm-cycle-status'><span>Status</span><strong>{status_label}</strong></div>
        </div>
        <div class='gm-stepper'>{''.join(itens)}</div>
        """,
        unsafe_allow_html=True,
    )


def aplicar_visual_wizard_metas():
    st.markdown(
        """
        <style>
        .gm-cyclebar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:14px;align-items:center;background:#fff;border:1px solid #e6e8ef;border-radius:16px;padding:14px 16px;margin:4px 0 12px 0;box-shadow:0 3px 12px rgba(30,38,85,.05)}
        .gm-cycle-kicker{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7a8091}
        .gm-cycle-title{font-size:18px;font-weight:800;color:#1e2655;margin-top:2px}
        .gm-cycle-meta,.gm-cycle-status{display:flex;flex-direction:column;min-width:120px;padding-left:14px;border-left:1px solid #eceef4}
        .gm-cycle-meta span,.gm-cycle-status span{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#8a90a0;font-weight:700}
        .gm-cycle-meta strong,.gm-cycle-status strong{font-size:14px;color:#1e2655;margin-top:2px;white-space:nowrap}
        .gm-stepper{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:0 0 14px 0}
        .gm-step{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid #e5e8ef;border-radius:13px;padding:10px 11px;min-width:0}
        .gm-step-icon{width:28px;height:28px;min-width:28px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;background:#f0f2f7;color:#6f7585}
        .gm-step-title{font-size:12px;font-weight:800;color:#31384d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .gm-step-sub{font-size:10px;color:#9298a6;margin-top:1px}
        .gm-step.done{background:#f7fbf8;border-color:#dcecdf}.gm-step.done .gm-step-icon{background:#dff0e3;color:#2d6940}
        .gm-step.active{background:#f5f6fb;border-color:#cdd2e7;box-shadow:inset 0 0 0 1px #dfe3f2}.gm-step.active .gm-step-icon{background:#1e2655;color:#fff}
        [data-baseweb="tab-list"]{background:#fff!important;border:1px solid #e4e7ef!important;border-radius:14px!important;padding:5px!important;gap:5px!important;box-shadow:0 3px 12px rgba(30,38,85,.04)!important;margin-bottom:12px!important}
        [data-baseweb="tab"]{border-radius:10px!important;padding:9px 14px!important;min-height:42px!important;font-weight:750!important;color:#62697a!important}
        [data-baseweb="tab"][aria-selected="true"]{background:#1e2655!important;color:#fff!important}
        [data-baseweb="tab-highlight"]{display:none!important}
        div[data-testid="stMetric"]{background:#fff;border:1px solid #e7e9f0;border-radius:14px;padding:12px 14px}
        div[data-testid="stDataEditor"],div[data-testid="stDataFrame"]{border:1px solid #e5e8ef;border-radius:14px;overflow:hidden;background:#fff}
        div[data-testid="stButton"] button[kind="primary"],div[data-testid="stButton"] button[data-testid="stBaseButton-primary"]{border-radius:10px!important}
        div[data-testid="stExpander"]{border:1px solid #e6e8ef!important;border-radius:13px!important;background:#fff!important}
        @media(max-width:900px){.gm-cyclebar{grid-template-columns:1fr 1fr}.gm-cyclebar>div:first-child{grid-column:1/-1}.gm-stepper{grid-template-columns:1fr 1fr}.gm-step:last-child{grid-column:1/-1}.gm-cycle-meta{border-left:0;padding-left:0}.gm-cycle-status{padding-left:10px}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    tabs_atual = st.tabs
    # Evita acumular wrappers em reruns.
    if getattr(tabs_atual, '_gm_wizard_wrapper', False):
        tabs_atual = getattr(tabs_atual, '_gm_original', tabs_atual)

    def tabs(labels, *args, **kwargs):
        alvo = [
            '1. Meta da Empresa',
            '2. Análise e Distribuição dos Supervisores',
            '3. Departamentos',
            '4. RCAs',
            '5. Aprovação e Histórico',
        ]
        if list(labels) == alvo:
            ctx = _contexto_gestao()
            _render_cabecalho_wizard(ctx)
            labels = ['🎯 Meta global', '👥 Supervisores', '🧩 Departamentos', '🧑‍💼 RCAs', '✅ Aprovação']
        return tabs_atual(labels, *args, **kwargs)

    tabs._gm_wizard_wrapper = True
    tabs._gm_original = tabs_atual
    st.tabs = tabs
