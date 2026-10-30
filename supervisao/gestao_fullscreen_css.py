import streamlit as st


def aplicar_fullscreen_dialog():
    st.markdown(
        """
        <style>
        /*
        Fullscreen real para o st.dialog da tabela dinâmica.
        O Streamlit mudou a estrutura DOM do dialog em versões recentes;
        por isso cobrimos tanto o container stDialog quanto o próprio
        elemento role="dialog".
        */

        [data-testid="stDialog"] {
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            max-width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        [data-testid="stDialog"][role="dialog"],
        [data-testid="stDialog"] [role="dialog"],
        div[role="dialog"] {
            position: fixed !important;
            inset: 0 !important;
            top: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            min-width: 100vw !important;
            max-width: none !important;
            height: 100vh !important;
            min-height: 100vh !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            transform: none !important;
        }

        [data-testid="stDialog"] > div,
        [data-testid="stDialog"] [role="dialog"] > div,
        div[role="dialog"] > div {
            width: 100% !important;
            min-width: 100% !important;
            max-width: none !important;
            height: 100% !important;
            min-height: 100% !important;
            max-height: none !important;
            margin: 0 !important;
            border-radius: 0 !important;
        }

        [data-testid="stDialog"] [data-testid="stDialogHeader"],
        div[role="dialog"] [data-testid="stDialogHeader"] {
            padding: .55rem .8rem .25rem .8rem !important;
            min-height: 42px !important;
        }

        [data-testid="stDialog"] [data-testid="stDialogBody"],
        div[role="dialog"] [data-testid="stDialogBody"] {
            width: 100% !important;
            max-width: none !important;
            height: calc(100vh - 44px) !important;
            max-height: calc(100vh - 44px) !important;
            padding: .25rem .6rem .5rem .6rem !important;
            overflow: hidden !important;
        }

        [data-testid="stDialog"] [data-testid="stVerticalBlock"],
        div[role="dialog"] [data-testid="stVerticalBlock"] {
            width: 100% !important;
            max-width: none !important;
        }

        [data-testid="stDialog"] iframe,
        div[role="dialog"] iframe {
            width: 100% !important;
            max-width: none !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )
