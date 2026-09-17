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


def aplicar_visual_supervisores():
    st.markdown(
        """
        <style>
        .gm-sup-intro{background:#fff;border:1px solid #e5e8ef;border-radius:16px;padding:16px 18px;margin:4px 0 12px 0}
        .gm-sup-kicker{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7a8091;text-transform:uppercase}
        .gm-sup-title{font-size:20px;font-weight:850;color:#1e2655;margin-top:3px}
        .gm-sup-sub{font-size:12px;color:#767d8d;margin-top:4px}
        .gm-sup-card{background:#fff;border:1px solid #e4e7ee;border-radius:15px;padding:13px 14px;margin:4px 0 6px 0;min-height:132px}
        .gm-sup-card-name{font-size:14px;font-weight:850;color:#1e2655;margin-bottom:8px}
        .gm-sup-mini{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px}
        .gm-sup-mini span{font-size:10px;color:#8a90a0;text-transform:uppercase;letter-spacing:.04em;display:block}
        .gm-sup-mini strong{font-size:12px;color:#31384d;display:block;margin-top:1px}
        .gm-sup-suggest{margin-top:9px;padding-top:8px;border-top:1px solid #eef0f4;display:flex;justify-content:space-between;gap:8px;align-items:center}
        .gm-sup-suggest span{font-size:11px;color:#777e8d}.gm-sup-suggest strong{font-size:13px;color:#1e2655}
        .gm-sup-progress-wrap{background:#fff;border:1px solid #e6e8ef;border-radius:14px;padding:12px 14px;margin:10px 0}
        @media(max-width:800px){.gm-sup-mini{grid-template-columns:1fr}.gm-sup-card{min-height:auto}}
        </style>
        """,
        unsafe_allow_html=True,
    )

    data_editor_original = _desembrulhar(st.data_editor, 'data_editor')
    button_original = _desembrulhar(st.button, 'button')
    markdown_original = _desembrulhar(st.markdown, 'markdown')
    caption_original = _desembrulhar(st.caption, 'caption')

    def markdown(body, *args, **kwargs):
        if body == '### Análise histórica dos supervisores':
            return markdown_original(
                """
                <div class='gm-sup-intro'>
                  <div class='gm-sup-kicker'>ETAPA 2 • DISTRIBUIÇÃO</div>
                  <div class='gm-sup-title'>Como a meta será dividida entre os supervisores?</div>
                  <div class='gm-sup-sub'>Use o histórico como referência, ajuste a meta de cada supervisor e feche exatamente o total da empresa.</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        if body == '### Distribuição da meta por supervisor':
            return markdown_original('#### Defina a meta de cada supervisor')
        return markdown_original(body, *args, **kwargs)

    def caption(body, *args, **kwargs):
        if body == 'Use a análise acima como referência para definir a distribuição sem sair da tela.':
            return caption_original('Escolha a base da sugestão e ajuste apenas o que fizer sentido comercialmente.')
        return caption_original(body, *args, **kwargs)

    def data_editor(data=None, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if not key.startswith('gm2_sup_editor_') or not isinstance(data, pd.DataFrame):
            return data_editor_original(data, *args, **kwargs)

        df = data.copy()
        if df.empty or 'Supervisor' not in df.columns or 'Meta definida' not in df.columns:
            return data_editor_original(data, *args, **kwargs)

        st.caption('Edite a meta diretamente no card de cada supervisor.')
        saida = df.copy()
        cols = st.columns(2)
        for idx, row in df.reset_index(drop=True).iterrows():
            col = cols[idx % 2]
            sup = str(row.get('Supervisor', 'Supervisor'))
            hist_rec = float(row.get('Hist. recente', 0) or 0)
            hist_a1 = float(row.get('Hist. A-1', 0) or 0)
            part = float(row.get('Participação ref. %', 0) or 0)
            sugerida = float(row.get('Meta sugerida', 0) or 0)
            atual = float(row.get('Meta definida', 0) or 0)
            with col:
                st.markdown(
                    f"""
                    <div class='gm-sup-card'>
                      <div class='gm-sup-card-name'>{sup}</div>
                      <div class='gm-sup-mini'>
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
                    f'Meta definida • {sup}',
                    min_value=0.0,
                    value=atual,
                    step=10000.0,
                    format='%.2f',
                    key=f'gm_sup_card_meta_{key}_{idx}',
                )
                saida.loc[saida.index[idx], 'Meta definida'] = float(novo)

        total = float(pd.to_numeric(saida['Meta definida'], errors='coerce').fillna(0).sum())
        st.markdown("<div class='gm-sup-progress-wrap'>", unsafe_allow_html=True)
        st.progress(1.0 if total > 0 else 0.0)
        st.caption(f'Total definido nos cards: {_fmt_brl(total)}')
        st.markdown('</div>', unsafe_allow_html=True)
        return saida

    def button(label, *args, **kwargs):
        key = str(kwargs.get('key') or '')
        if key.startswith('gm2_auto_sup_'):
            label = 'Usar sugestão do histórico'
        elif key.startswith('gm2_save_sup_'):
            label = 'Salvar e avançar para Departamentos →'
        return button_original(label, *args, **kwargs)

    st.markdown = markdown
    st.caption = caption
    st.data_editor = data_editor
    st.button = button
