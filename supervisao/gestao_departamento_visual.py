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


def _compactar_figura(fig, altura=290):
    try:
        fig.update_layout(
            height=altura,
            margin=dict(l=8, r=8, t=42, b=8),
            title_font_size=14,
            legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='left', x=0),
        )
    except Exception:
        pass
    return fig


def aplicar_visual_departamentos():
    """Recolhe a análise da etapa Departamentos em um único painel compacto."""
    st.markdown(
        """
        <style>
        .gm-dep-intro{background:#fff;border:1px solid #e5e8ef;border-radius:16px;padding:16px 18px;margin:4px 0 12px 0}
        .gm-dep-kicker{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7a8091;text-transform:uppercase}
        .gm-dep-title{font-size:20px;font-weight:850;color:#1e2655;margin-top:3px}
        .gm-dep-sub{font-size:12px;color:#767d8d;margin-top:4px}
        div[data-testid="stExpander"] summary p{font-weight:800!important;color:#1e2655!important}
        .gm-dep-analysis-note{font-size:11px;color:#7b8190;margin:0 0 6px 0}
        </style>
        """,
        unsafe_allow_html=True,
    )

    markdown_original = _desembrulhar(st.markdown, 'markdown')
    plotly_original = _desembrulhar(st.plotly_chart, 'plotly_chart')
    selectbox_original = _desembrulhar(st.selectbox, 'selectbox')
    radio_original = _desembrulhar(st.radio, 'radio')

    estado = {
        'em_departamentos': False,
        'primeiro_grafico': None,
        'painel_criado': False,
        'slot_segundo_grafico': None,
        'aguardando_segundo_grafico': False,
    }

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

    def plotly_chart(fig, *args, **kwargs):
        if not estado['em_departamentos']:
            return plotly_original(fig, *args, **kwargs)

        # O primeiro gráfico é guardado até o seletor de departamento aparecer.
        # Assim conseguimos montar apenas um painel e posicionar os dois gráficos lado a lado.
        if estado['primeiro_grafico'] is None and not estado['painel_criado']:
            estado['primeiro_grafico'] = fig
            return None

        if estado.get('aguardando_segundo_grafico') and estado.get('slot_segundo_grafico') is not None:
            estado['aguardando_segundo_grafico'] = False
            fig = _compactar_figura(fig)
            kw = dict(kwargs)
            kw['use_container_width'] = True
            return estado['slot_segundo_grafico'].plotly_chart(fig, *args, **kw)

        return plotly_original(fig, *args, **kwargs)

    def selectbox(label, options, *args, **kwargs):
        if estado['em_departamentos'] and label == 'Ver evolução de departamento':
            exp = st.expander('Ver análise histórica e evolução', expanded=False)
            estado['painel_criado'] = True

            with exp:
                tabs = st.tabs(['📊 Gráficos'])
                with tabs[0]:
                    st.markdown(
                        "<div class='gm-dep-analysis-note'>Compare o período de referência e consulte a evolução de um departamento específico.</div>",
                        unsafe_allow_html=True,
                    )
                    valor = selectbox_original('Departamento para analisar', options, *args, **kwargs)
                    c1, c2 = st.columns(2, gap='medium')
                    with c1:
                        if estado.get('primeiro_grafico') is not None:
                            fig1 = _compactar_figura(estado['primeiro_grafico'])
                            plotly_original(fig1, use_container_width=True)
                    with c2:
                        estado['slot_segundo_grafico'] = st.empty()
                        estado['slot_segundo_grafico'].caption('Evolução mensal do departamento selecionado')

            estado['aguardando_segundo_grafico'] = True
            return valor

        return selectbox_original(label, options, *args, **kwargs)

    def radio(label, options, *args, **kwargs):
        if estado['em_departamentos'] and label == 'Base para sugestão do departamento':
            return radio_original('Base da sugestão', options, *args, **kwargs)
        return radio_original(label, options, *args, **kwargs)

    st.markdown = markdown
    st.plotly_chart = plotly_chart
    st.selectbox = selectbox
    st.radio = radio
