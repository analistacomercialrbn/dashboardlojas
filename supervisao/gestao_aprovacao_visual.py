import inspect

import pandas as pd
import streamlit as st

import gestao_metas as gm


def _desembrulhar(fn, nome):
    atual = fn
    vistos = set()
    for _ in range(12):
        if id(atual) in vistos:
            break
        vistos.add(id(atual))
        if getattr(atual, '__module__', '') != __name__ or getattr(atual, '__name__', '') != nome:
            break
        prox = None
        for cell in getattr(atual, '__closure__', None) or []:
            try:
                obj = cell.cell_contents
            except Exception:
                continue
            if callable(obj) and getattr(obj, '__name__', '') == nome:
                prox = obj
                break
        if prox is None:
            break
        atual = prox
    return atual


def _ctx():
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


def _num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _brl(v):
    v = _num(v)
    if abs(v) >= 1_000_000:
        return f"R$ {v/1_000_000:.2f} mi".replace('.', ',')
    if abs(v) >= 1_000:
        return f"R$ {v/1_000:.0f} mil".replace('.', ',')
    return f"R$ {v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _validacoes(cycle):
    meta = _num(cycle.get('meta_empresa'))
    sups = cycle.get('supervisores') or {}
    total_sup = sum(_num((r or {}).get('proposta')) for r in sups.values())
    valid_sup = bool(sups) and abs(meta - total_sup) <= 0.02

    valid_dep = bool(sups)
    valid_rca = bool(sups)
    total_dep = 0.0
    total_rca = 0.0
    for rec in sups.values():
        rec = rec or {}
        alvo = _num(rec.get('proposta'))
        deps = rec.get('departamentos') or {}
        rcas = rec.get('rcas') or {}
        sd = sum(_num((x or {}).get('proposta')) for x in deps.values())
        sr = sum(_num((x or {}).get('proposta')) for x in rcas.values())
        total_dep += sd
        total_rca += sr
        if not deps or abs(alvo - sd) > 0.02:
            valid_dep = False
        if not rcas or abs(alvo - sr) > 0.02:
            valid_rca = False
    return meta, total_sup, total_dep, total_rca, valid_sup, valid_dep, valid_rca


def _render_topo():
    ctx = _ctx()
    cycle = ctx.get('cycle') or {}
    ano = ctx.get('ano', '')
    meses = ctx.get('meses') or []
    tipo = ctx.get('tipo') or cycle.get('tipo') or ''
    meta, total_sup, total_dep, total_rca, ok_sup, ok_dep, ok_rca = _validacoes(cycle)
    pronto = ok_sup and ok_dep and ok_rca
    periodo = ' • '.join(gm.MESES.get(int(m), str(m))[:3] for m in meses)
    status = gm.STATUS_LABEL.get(cycle.get('status'), str(cycle.get('status') or 'RASCUNHO').title())

    def pill(ok, titulo, detalhe):
        cls = 'ok' if ok else 'pend'
        icon = '✓' if ok else '!'
        return f"<div class='gm-ap-check {cls}'><div class='gm-ap-check-icon'>{icon}</div><div><strong>{titulo}</strong><span>{detalhe}</span></div></div>"

    topo_cls = 'ready' if pronto else 'wait'
    topo_txt = 'Ciclo pronto para aprovação' if pronto else 'Revise os pontos pendentes antes de aprovar'
    st.markdown(
        f"""
        <div class='gm-ap-hero {topo_cls}'>
          <div>
            <div class='gm-ap-kicker'>ETAPA 5 • FECHAMENTO</div>
            <div class='gm-ap-title'>{topo_txt}</div>
            <div class='gm-ap-sub'>{ano} • {tipo} • {periodo} &nbsp;|&nbsp; Status atual: <strong>{status}</strong></div>
          </div>
          <div class='gm-ap-meta'><span>Meta do ciclo</span><strong>{_brl(meta)}</strong></div>
        </div>
        <div class='gm-ap-summary'>
          <div class='gm-ap-box'><span>Supervisores</span><strong>{_brl(total_sup)}</strong><small>{'Fechado' if ok_sup else 'Pendente'}</small></div>
          <div class='gm-ap-box'><span>Departamentos</span><strong>{_brl(total_dep)}</strong><small>{'Fechado' if ok_dep else 'Pendente'}</small></div>
          <div class='gm-ap-box'><span>RCAs</span><strong>{_brl(total_rca)}</strong><small>{'Fechado' if ok_rca else 'Pendente'}</small></div>
          <div class='gm-ap-box'><span>Diferença final</span><strong>{_brl(meta-total_rca)}</strong><small>Meta x RCAs</small></div>
        </div>
        <div class='gm-ap-checks'>
          {pill(ok_sup, 'Supervisores', 'Distribuição fecha a meta global')}
          {pill(ok_dep, 'Departamentos', 'Todos os supervisores fechados')}
          {pill(ok_rca, 'RCAs', 'Distribuição final conciliada')}
        </div>
        """,
        unsafe_allow_html=True,
    )


def _render_supervisores(df):
    st.markdown("<div class='gm-ap-section-title'>Conferência por supervisor</div><div class='gm-ap-section-sub'>Veja rapidamente onde existe alguma diferença antes do fechamento.</div>", unsafe_allow_html=True)
    if df.empty:
        st.info('Nenhum supervisor distribuído neste ciclo.')
        return
    cols = st.columns(2)
    for i, row in df.reset_index(drop=True).iterrows():
        sup = str(row.get('Supervisor', 'Supervisor'))
        meta = _num(row.get('Meta definida'))
        dep = _num(row.get('Departamentos'))
        rca = _num(row.get('RCAs'))
        dd = _num(row.get('Dif. departamentos'))
        dr = _num(row.get('Dif. RCAs'))
        okd = abs(dd) <= 0.02
        okr = abs(dr) <= 0.02
        cls = 'ok' if okd and okr else 'pend'
        badge = 'Fechado' if okd and okr else 'Revisar'
        with cols[i % 2]:
            st.markdown(
                f"""
                <div class='gm-ap-sup {cls}'>
                  <div class='gm-ap-sup-head'><strong>{sup}</strong><span>{badge}</span></div>
                  <div class='gm-ap-sup-grid'>
                    <div><span>Meta</span><strong>{_brl(meta)}</strong></div>
                    <div><span>Departamentos</span><strong>{_brl(dep)}</strong></div>
                    <div><span>RCAs</span><strong>{_brl(rca)}</strong></div>
                    <div><span>Dif. final</span><strong>{_brl(dr)}</strong></div>
                  </div>
                </div>
                """,
                unsafe_allow_html=True,
            )


def aplicar_visual_aprovacao():
    st.markdown(
        """
        <style>
        .gm-ap-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;border:1px solid #e4e7ef;border-radius:18px;padding:18px 20px;margin:4px 0 12px;background:#fff}
        .gm-ap-hero.ready{border-color:#cfe6d5;background:#f8fcf9}.gm-ap-hero.wait{border-color:#eadfbd;background:#fffdf7}
        .gm-ap-kicker{font-size:10px;font-weight:850;letter-spacing:.09em;color:#7c8392}.gm-ap-title{font-size:22px;font-weight:900;color:#1e2655;margin-top:3px}.gm-ap-sub{font-size:12px;color:#747b8b;margin-top:5px}
        .gm-ap-meta{border-left:1px solid #e8eaf0;padding-left:20px;min-width:160px}.gm-ap-meta span{display:block;font-size:10px;text-transform:uppercase;color:#8a90a0;font-weight:800;letter-spacing:.05em}.gm-ap-meta strong{font-size:20px;color:#1e2655;display:block;margin-top:3px}
        .gm-ap-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px}.gm-ap-box{background:#fff;border:1px solid #e5e8ef;border-radius:14px;padding:13px 14px}.gm-ap-box span{font-size:10px;text-transform:uppercase;color:#8a90a0;font-weight:800}.gm-ap-box strong{display:block;font-size:17px;color:#1e2655;margin-top:3px}.gm-ap-box small{font-size:10px;color:#8a90a0}
        .gm-ap-checks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 14px}.gm-ap-check{display:flex;align-items:center;gap:10px;border-radius:13px;padding:10px 12px;border:1px solid #e5e8ef;background:#fff}.gm-ap-check-icon{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:900}.gm-ap-check strong{display:block;font-size:12px;color:#293149}.gm-ap-check span{display:block;font-size:10px;color:#8c92a0;margin-top:1px}.gm-ap-check.ok{background:#f7fbf8;border-color:#d9eadf}.gm-ap-check.ok .gm-ap-check-icon{background:#dcefe2;color:#2e6a42}.gm-ap-check.pend{background:#fffaf3;border-color:#eadfc4}.gm-ap-check.pend .gm-ap-check-icon{background:#f3e8c9;color:#8b6a1f}
        .gm-ap-section-title{font-size:16px;font-weight:850;color:#1e2655;margin-top:8px}.gm-ap-section-sub{font-size:11px;color:#858b99;margin:2px 0 8px}
        .gm-ap-sup{background:#fff;border:1px solid #e5e8ef;border-radius:15px;padding:12px 14px;margin-bottom:8px}.gm-ap-sup.ok{border-color:#d9eadf}.gm-ap-sup.pend{border-color:#eadfc4}.gm-ap-sup-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.gm-ap-sup-head strong{font-size:13px;color:#1e2655}.gm-ap-sup-head span{font-size:10px;font-weight:800;border-radius:999px;padding:4px 8px;background:#f1f3f7;color:#6f7585}.gm-ap-sup.ok .gm-ap-sup-head span{background:#e6f3e9;color:#356b46}.gm-ap-sup.pend .gm-ap-sup-head span{background:#f6ecd2;color:#816422}
        .gm-ap-sup-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.gm-ap-sup-grid span{display:block;font-size:9px;color:#8b91a0;text-transform:uppercase}.gm-ap-sup-grid strong{display:block;font-size:11px;color:#343b50;margin-top:2px}
        @media(max-width:900px){.gm-ap-summary{grid-template-columns:1fr 1fr}.gm-ap-checks{grid-template-columns:1fr}.gm-ap-hero{grid-template-columns:1fr}.gm-ap-meta{border-left:0;padding-left:0}.gm-ap-sup-grid{grid-template-columns:1fr 1fr}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    markdown_original = _desembrulhar(st.markdown, 'markdown')
    dataframe_original = _desembrulhar(st.dataframe, 'dataframe')
    button_original = _desembrulhar(st.button, 'button')
    columns_original = _desembrulhar(st.columns, 'columns')

    estado = {'em_aprovacao': False, 'resumo_visto': False, 'validacao_consumida': False}

    def markdown(body, *args, **kwargs):
        if body == '### Validação, aprovação e histórico':
            estado['em_aprovacao'] = True
            _render_topo()
            return None
        if estado['em_aprovacao'] and body == '#### Histórico de alterações':
            return markdown_original('#### Histórico e auditoria')
        return markdown_original(body, *args, **kwargs)

    def dataframe(data=None, *args, **kwargs):
        if estado['em_aprovacao'] and isinstance(data, pd.DataFrame):
            cols = set(map(str, data.columns))
            if {'Supervisor','Meta definida','Departamentos','RCAs'}.issubset(cols):
                estado['resumo_visto'] = True
                _render_supervisores(data)
                return None
            if {'data_hora','usuario','acao'}.issubset(cols):
                with st.expander('Ver histórico completo do ciclo', expanded=False):
                    return dataframe_original(data, *args, **kwargs)
        return dataframe_original(data, *args, **kwargs)

    class _ColSilenciosa:
        def success(self, *args, **kwargs): return None
        def warning(self, *args, **kwargs): return None
        def error(self, *args, **kwargs): return None
        def info(self, *args, **kwargs): return None

    def columns(spec, *args, **kwargs):
        if estado['em_aprovacao'] and estado['resumo_visto'] and not estado['validacao_consumida'] and spec == 3:
            estado['validacao_consumida'] = True
            return (_ColSilenciosa(), _ColSilenciosa(), _ColSilenciosa())
        return columns_original(spec, *args, **kwargs)

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if estado['em_aprovacao']:
            if key.startswith('gm2_review_'):
                label = 'Enviar para análise'
            elif key.startswith('gm2_adjust_'):
                label = 'Solicitar correção'
            elif key.startswith('gm2_approve_'):
                label = '✓ Aprovar e fechar ciclo'
        return button_original(label, *args, **kwargs)

    st.markdown = markdown
    st.dataframe = dataframe
    st.button = button
    st.columns = columns
