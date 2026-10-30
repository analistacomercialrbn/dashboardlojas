import pandas as pd
import streamlit as st


def _fmt_brl(valor):
    try:
        v = float(valor or 0)
    except Exception:
        v = 0.0
    return f"R$ {v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _fmt_pct(valor):
    try:
        v = float(valor or 0)
    except Exception:
        v = 0.0
    return f"{v:.1f}%".replace('.', ',')


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


def aplicar_visual_rcas():
    st.markdown(
        """
        <style>
        .gm-rca-intro{background:#fff;border:1px solid #e5e8ef;border-radius:16px;padding:16px 18px;margin:4px 0 12px 0}
        .gm-rca-kicker{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7a8091;text-transform:uppercase}
        .gm-rca-title{font-size:20px;font-weight:850;color:#1e2655;margin-top:3px}
        .gm-rca-sub{font-size:12px;color:#767d8d;margin-top:4px}
        .gm-rca-card{background:#fff;border:1px solid #e4e7ee;border-radius:15px;padding:13px 14px;margin:4px 0 6px 0;min-height:132px}
        .gm-rca-card-name{font-size:14px;font-weight:850;color:#1e2655;margin-bottom:8px}
        .gm-rca-mini{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px}
        .gm-rca-mini span{font-size:10px;color:#8a90a0;text-transform:uppercase;letter-spacing:.04em;display:block}
        .gm-rca-mini strong{font-size:12px;color:#31384d;display:block;margin-top:1px}
        .gm-rca-summary{background:#fff;border:1px solid #e6e8ef;border-radius:14px;padding:12px 14px;margin:10px 0}
        div[data-testid="stExpander"] summary p{font-weight:800!important;color:#1e2655!important}
        @media(max-width:800px){.gm-rca-mini{grid-template-columns:1fr}.gm-rca-card{min-height:auto}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    markdown_original = _desembrulhar(st.markdown, 'markdown')
    plotly_original = _desembrulhar(st.plotly_chart, 'plotly_chart')
    data_editor_original = _desembrulhar(st.data_editor, 'data_editor')
    button_original = _desembrulhar(st.button, 'button')
    selectbox_original = _desembrulhar(st.selectbox, 'selectbox')

    estado = {'em_rca': False, 'analise_aberta': None}

    def markdown(body, *args, **kwargs):
        if body == '### Distribuição da meta do supervisor entre RCAs':
            estado['em_rca'] = True
            return markdown_original(
                """
                <div class='gm-rca-intro'>
                  <div class='gm-rca-kicker'>ETAPA 4 • DISTRIBUIÇÃO</div>
                  <div class='gm-rca-title'>Como a meta do supervisor será distribuída entre os RCAs?</div>
                  <div class='gm-rca-sub'>Escolha o supervisor, consulte o histórico apenas quando precisar e ajuste a meta de cada RCA diretamente.</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        return markdown_original(body, *args, **kwargs)

    def plotly_chart(fig, *args, **kwargs):
        if estado['em_rca']:
            exp = st.expander('Ver análise histórica dos RCAs', expanded=False)
            estado['analise_aberta'] = exp
            with exp:
                st.caption('Comparativo de desempenho dos RCAs do supervisor selecionado.')
                try:
                    fig.update_layout(height=300, margin=dict(l=10, r=10, t=45, b=10))
                except Exception:
                    pass
                return plotly_original(fig, *args, **kwargs)
        return plotly_original(fig, *args, **kwargs)

    def data_editor(data=None, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if not key.startswith('gm2_rca_edit_') or not isinstance(data, pd.DataFrame):
            return data_editor_original(data, *args, **kwargs)

        df = data.copy()
        if df.empty or 'RCA' not in df.columns or 'Meta proposta' not in df.columns:
            return data_editor_original(data, *args, **kwargs)

        st.markdown('#### Defina a meta de cada RCA')
        st.caption('Edite apenas as metas que precisarem de ajuste. O histórico e a sugestão ficam visíveis no próprio card.')
        saida = df.copy()
        cols = st.columns(2)
        for idx, row in df.reset_index(drop=True).iterrows():
            with cols[idx % 2]:
                nome = str(row.get('RCA', 'RCA'))
                cod = row.get('COD_RCA', '')
                hist_rec = float(row.get('Hist. recente', 0) or 0)
                hist_a1 = float(row.get('Hist. A-1', 0) or 0)
                part = float(row.get('Participação ref. %', 0) or 0)
                sugerida = float(row.get('Meta sugerida', 0) or 0)
                atual = float(row.get('Meta proposta', 0) or 0)
                st.markdown(
                    f"""
                    <div class='gm-rca-card'>
                      <div class='gm-rca-card-name'>{cod} • {nome}</div>
                      <div class='gm-rca-mini'>
                        <div><span>Histórico recente</span><strong>{_fmt_brl(hist_rec)}</strong></div>
                        <div><span>Mesmo período A-1</span><strong>{_fmt_brl(hist_a1)}</strong></div>
                        <div><span>Participação ref.</span><strong>{_fmt_pct(part)}</strong></div>
                        <div><span>Meta sugerida</span><strong>{_fmt_brl(sugerida)}</strong></div>
                      </div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
                novo = st.number_input(
                    f'Meta proposta • {nome}',
                    min_value=0.0,
                    value=atual,
                    step=10000.0,
                    format='%.2f',
                    key=f'gm_rca_card_meta_{key}_{idx}',
                )
                saida.loc[saida.index[idx], 'Meta proposta'] = float(novo)

        total = float(pd.to_numeric(saida['Meta proposta'], errors='coerce').fillna(0).sum())
        st.markdown("<div class='gm-rca-summary'>", unsafe_allow_html=True)
        st.caption(f'Total distribuído aos RCAs: {_fmt_brl(total)}')
        st.markdown('</div>', unsafe_allow_html=True)
        return saida

    def selectbox(label, options, *args, **kwargs):
        if estado['em_rca'] and label == 'Justificativa do RCA':
            return selectbox_original('RCA para detalhar / justificar', options, *args, **kwargs)
        return selectbox_original(label, options, *args, **kwargs)

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if key.startswith('gm2_auto_rca_'):
            label = 'Usar sugestão do histórico'
        elif key.startswith('gm2_save_rca_'):
            label = 'Salvar e avançar para Aprovação →'
        return button_original(label, *args, **kwargs)

    st.markdown = markdown
    st.plotly_chart = plotly_chart
    st.data_editor = data_editor
    st.selectbox = selectbox
    st.button = button
