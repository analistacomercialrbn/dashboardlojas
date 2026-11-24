# Instruções para trabalhar neste projeto

## Sobre o dono
- O dono não programa. Fale sempre em linguagem simples, sem termos técnicos.
- Explique o que vai mudar e o efeito para os usuários antes de mexer em algo importante.

## O que é este projeto
- Central Rebanho / Dashboard de Supervisão: vendas, metas, pedidos em aberto, cobertura, logística, SAC e formação de cargas.
- O sistema roda no Google Apps Script (projeto "Central Rebanho"). A `main` deste repositório corresponde à versão 152 publicada em 24/11/2026.
- `supervisao-web/gas/` — código do Apps Script e das telas.
- `supervisao-web/cloudflare/` — Worker da Cloudflare (homologação).
- `supervisao-web/assets/` — imagens e mapas.

## Cuidados obrigatórios
- **Este repositório é público.** Nunca colocar senhas, chaves, tokens, e-mails pessoais ou dados de clientes aqui.
- As telas são carregadas pelo Apps Script a partir de **versões fixas** (commits) deste repositório. Não apagar nem mover arquivos que o sistema usa sem antes conferir quais endereços o código lê.
- `supervisao/usuarios.json` **não pode mudar de lugar nem de nome**: o login do Apps Script e do Worker lê este arquivo pela `main`. Ele não guarda senhas; as senhas ficam nas propriedades do script (cadastro pela tela de Usuários).
- Nunca publicar versão nova no Apps Script nem alterar a versão em uso sem autorização explícita do dono.
- Mudanças entram por Pull Request para aprovação. Não alterar a `main` direto.
- Ao mesclar, usar merge comum (sem squash ou rebase), para não sumir nenhum commit que o sistema usa como versão fixa.
- Não apagar nem sobrescrever dados das planilhas de vendas e da base auxiliar.
- Regra do SalesSync: nunca apagar Qt Pedida, Vl Lucro ou Vl Desconto quando o app exportar vazio; itens ausentes e duplicados ficam para revisão manual.
- O app Força de Vendas (repositório `rebanhoforcadevendas`) manda pedidos para este sistema: avisar o dono antes de mudar qualquer coisa nessa ligação.

## Pendências de organização
- Arquivar as cópias antigas e datadas das telas em `supervisao-web/gas/` (conferir antes se alguma é usada por versão fixa).
- Apagar as versões paralelas (branches) antigas que já estão contidas na `main`.
