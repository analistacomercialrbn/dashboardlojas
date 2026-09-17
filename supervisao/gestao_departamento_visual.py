import streamlit as st


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


def aplicar_visual_departamentos():
    """Recolhe a parte analítica da etapa Departamentos em um painel clicável."""
    st.markdown(
        """
        <style>
        .gm-dep-intro{background:#fff;border:1px solid #e5e8ef;border-radius:16px;padding:16px 18px;margin:4px 0 12px 0}
        .gm-dep-kicker{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7a8091;text-transform:uppercase}
        .gm-dep-title{font-size:20px;font-weight:850;color:#1e2655;margin-top:3px}
        .gm-dep-sub{font-size:12px;color:#767d8d;margin-top:4px}
        div[data-testid="stExpander"] summary p{font-weight:800!important;color:#1e2655!important}
        </style>
        """,
        unsafe_allow_html=True,
    )

    markdown_original = _desembrulhar(st.markdown, 'markdown')
    plotly_original = _desembrulhar(st.plotly_chart, 'plotly_chart')
    selectbox_original = _desembrulhar(st.selectbox, 'selectbox')
    radio_original = _desembrulhar(st.radio, 'radio')

    estado = {'em_departamentos': False, 'painel': None, 'aguardando_grafico': False}

    def markdown(body, *args, **kwargs):
        if body == '### Análise e distribuição por departamento':
            estado['em_departamentos'] = True
            return markdown_original(
                """
                <div class='gm-dep-intro'>
                  <div class='gm-dep-kicker'>ETAPA 3 • DISTRIBUIÇÃO</div>
                  <div class='gm-dep-title'>Como a meta do supervisor será distribuída entre os departamentos?</div>
                  <div class='gm-dep-sub'>Escolha o supervisor, consulte o histórico apenas quando precisar e ajuste a distribuição comercial.</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        return markdown_original(body, *args, **kwargs)

    def selectbox(label, options, *args, **kwargs):
        if estado['em_departamentos'] and label == 'Ver evolução de departamento':
            exp = st.expander('Ver análise histórica e evolução', expanded=False)
            estado['painel'] = exp
            with exp:
                st.caption('Consulte o histórico do supervisor e aprofunde em um departamento específico somente quando necessário.')
                valor = selectbox_original('Departamento para analisar', options, *args, **kwargs)
                estado['aguardando_grafico'] = True
                return valor
        return selectbox_original(label, options, *args, **kwargs)

    def plotly_chart(fig, *args, **kwargs):
        if estado['em_departamentos']:
            painel = estado.get('painel')
            if painel is None:
                # primeiro gráfico da etapa: também vai para o painel recolhido
                exp = st.expander('Ver análise histórica e evolução', expanded=False)
                estado['painel'] = exp
                with exp:
                    st.caption('Comparativo histórico dos departamentos do supervisor selecionado.')
                    return plotly_original(fig, *args, **kwargs)
            if estado.get('aguardando_grafico'):
                estado['aguardando_grafico'] = False
                with painel:
                    return plotly_original(fig, *args, **kwargs)
        return plotly_original(fig, *args, **kwargs)

    def radio(label, options, *args, **kwargs):
        if estado['em_departamentos'] and label == 'Base para sugestão do departamento':
            return radio_original('Base da sugestão', options, *args, **kwargs)
        return radio_original(label, options, *args, **kwargs)

    st.markdown = markdown
    st.plotly_chart = plotly_chart
    st.selectbox = selectbox
    st.radio = radio
