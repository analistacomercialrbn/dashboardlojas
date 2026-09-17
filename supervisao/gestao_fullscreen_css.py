import streamlit as st


def aplicar_fullscreen_dialog():
    st.markdown(
        """
        <style>
        /* Faz o st.dialog usado pela tabela dinâmica ocupar todo o viewport. */
        div[data-testid="stDialog"] {
            width: 100vw !important;
            height: 100vh !important;
            inset: 0 !important;
            padding: 0 !important;
        }

        div[data-testid="stDialog"] div[role="dialog"] {
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            max-width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
            margin: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
        }

        div[data-testid="stDialog"] div[role="dialog"] > div {
            width: 100% !important;
            max-width: none !important;
            height: 100% !important;
            max-height: none !important;
            overflow: hidden !important;
        }

        div[data-testid="stDialog"] [data-testid="stVerticalBlock"] {
            width: 100% !important;
            max-width: none !important;
        }

        /* Usa melhor a área interna e deixa o grid como foco principal. */
        div[data-testid="stDialog"] [data-testid="stDialogHeader"] {
            padding: 0.75rem 1rem 0.35rem 1rem !important;
        }

        div[data-testid="stDialog"] [data-testid="stDialogBody"] {
            padding: 0.35rem 1rem 0.75rem 1rem !important;
            overflow: hidden !important;
        }

        div[data-testid="stDialog"] iframe {
            width: 100% !important;
            max-width: none !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )
