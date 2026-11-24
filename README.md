# Supervisão Rebanho

Sistema de supervisão comercial e logística da Rebanho (Dashboard de Supervisão / Central).

## Onde está cada coisa

- `supervisao-web/gas/` — código do Google Apps Script (servidor e telas).
  - `Code.gs` — cópia fiel do "Código" do projeto Central Rebanho no Apps Script.
  - `zoom-mapas-20261109/` — tela em uso hoje.
  - `arquivo/` — cópias antigas e datadas, só como histórico.
- `.github/workflows/enviar-apps-script.yml` — botão em Actions para comparar e enviar o código ao Apps Script (não publica versão).
- `supervisao-web/cloudflare/` — Worker da Cloudflare que prepara a base de vendas.
- `supervisao-web/assets/` — imagens e mapas usados pelas telas.
- `supervisao/usuarios.json` — lista de usuários do login. **Não mover nem renomear:** o Apps Script e o Worker leem este arquivo por este endereço.

## Observação

As telas são carregadas pelo Apps Script a partir de um commit fixo deste repositório.
Uma alteração aqui só aparece no sistema quando esse commit é atualizado no `Code.gs`.

Os apps antigos em Streamlit foram removidos (não estão mais em uso). Continuam disponíveis no histórico do Git, se precisar.
