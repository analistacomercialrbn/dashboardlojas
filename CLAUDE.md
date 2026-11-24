# Instruções para trabalhar neste projeto

## Sobre o dono
- O dono não programa. Fale sempre em linguagem simples, sem termos técnicos.
- Explique o que vai mudar e o efeito para os usuários antes de mexer em algo importante.

## O que é este projeto
- Central Rebanho / Dashboard de Supervisão: vendas, metas, pedidos em aberto, cobertura, logística, SAC e formação de cargas.
- O sistema roda no Google Apps Script (projeto "Central Rebanho"), que tem um único arquivo de código, "Código", mais o `appsscript.json`.
- `supervisao-web/gas/Code.gs` é a cópia fiel do "Código" do Apps Script (conferido em 24/11/2026 pelo botão de comparação).
- `supervisao-web/gas/` — código do Apps Script e das telas. A tela em uso é `zoom-mapas-20261109/` (usa também `gas-app.css` e `sac-importacao-20261108/tower.css`).
- `supervisao-web/gas/arquivo/` — cópias antigas e datadas, só como histórico; nada ali é usado pela `main`.
- `supervisao-web/cloudflare/` — Worker da Cloudflare (homologação).
- `supervisao-web/assets/` — imagens e mapas.

## Cuidados obrigatórios
- **Este repositório é público.** Nunca colocar senhas, chaves, tokens, e-mails pessoais ou dados de clientes aqui.
- As telas são carregadas pelo Apps Script a partir de **versões fixas** (commits) deste repositório. Não apagar nem mover arquivos que o sistema usa sem antes conferir quais endereços o código lê.
- `supervisao/usuarios.json` **não pode mudar de lugar nem de nome**: o login do Apps Script e do Worker lê este arquivo pela `main`. Ele não guarda senhas; as senhas ficam nas propriedades do script (cadastro pela tela de Usuários).
- Nunca publicar versão nova no Apps Script nem alterar a versão em uso sem autorização explícita do dono.

## Botão "Enviar para o Apps Script" (GitHub → Actions)
- Arquivo: `.github/workflows/enviar-apps-script.yml`. Só roda quando acionado, e só a partir da `main`.
- **comparar**: baixa o "Código" do Apps Script e compara com o `Code.gs` (ligação na lista `MAPA`). Não muda nada. Mostra só nomes, linhas e funções, nunca o código, porque o repositório é público.
- **enviar**: exige digitar `ENVIAR` e autorização explícita do dono. Atualiza só arquivos que já existem no Apps Script; não apaga nada de lá e **não publica versão**.
- A chave do Google fica no segredo `CLASPRC_JSON` do repositório; nunca colocar no código.
- Sempre rodar **comparar** antes de enviar. Se aparecer "Diferente" sem mudança pedida, alguém editou direto no Apps Script: trazer essa versão para o `Code.gs` antes de enviar, para não apagar nada. Se aparecerem funções que "sumiriam ao enviar", parar e avisar o dono.
- Fluxo de mudança: alterar `Code.gs` → PR aprovado → comparar → enviar (com autorização) → o dono publica a versão no Apps Script.
- Mudanças entram por Pull Request para aprovação. Não alterar a `main` direto.
- Ao mesclar, usar merge comum (sem squash ou rebase), para não sumir nenhum commit que o sistema usa como versão fixa.
- Não apagar nem sobrescrever dados das planilhas de vendas e da base auxiliar.
- Regra do SalesSync: nunca apagar Qt Pedida, Vl Lucro ou Vl Desconto quando o app exportar vazio; itens ausentes e duplicados ficam para revisão manual.
- O app Força de Vendas (repositório `rebanhoforcadevendas`) manda pedidos para este sistema: avisar o dono antes de mudar qualquer coisa nessa ligação.

## Pendências de organização
- Apagar as versões paralelas (branches) antigas que já estão contidas na `main`.
- Os testes em `supervisao-web/gas/tests/` estão desatualizados: `platform-access` e `transport-legacy-key` falham com o `Code.gs` atual (o primeiro já falhava antes).
