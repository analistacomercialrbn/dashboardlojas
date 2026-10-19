# Worker de supervisão

Este diretório contém o processador de dados usado pelo Worker Cloudflare `supervisao-rebanho-homologacao`.

## Build e configuração

Execute `node build-worker.mjs`. O bundle usa o descompactador Pako e o parser XLSX por fluxo implementado em `worker.js`.

O Worker precisa destas configurações:

- Binding R2 `DATA_CACHE` apontando para `rebanho-supervisao-data`.
- Secret `SESSION_SECRET` existente para sessões.
- Secrets `SALES_FILE_ID` e `AUX_FILE_ID` com os IDs dos arquivos do Drive.

O bucket guarda apenas o conjunto NDJSON compactado; as planilhas do Drive são lidas e nunca são modificadas. O acesso às rotas `/api/dataset` e `/api/rebuild` mantém a verificação de sessão e o bloqueio para ADMIN/GERENTE.

A rota `POST /api/rebuild` processa as abas necessárias sem carregar o XML inteiro em memória. Para faturamento, percorre `Sheet1` duas vezes: primeiro valida linhas e identifica a data mais recente; depois transmite os registros normalizados e gzip para R2.
