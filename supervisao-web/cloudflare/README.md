# Worker de supervisão

Este diretório contém o processador usado pelo Worker Cloudflare `supervisao-rebanho-homologacao`.

Execute `node build-worker.mjs` para gerar o arquivo de implantação `worker.bundle.js`. O processador usa os streams nativos do runtime para ler os arquivos XLSX e comprimir o conjunto NDJSON.

O Worker precisa destas configurações:

- Binding R2 `DATA_CACHE` apontando para `rebanho-supervisao-data`.
- Secret `SESSION_SECRET` existente para sessões.
- Secrets `SALES_FILE_ID` e `AUX_FILE_ID` com os IDs dos arquivos do Drive.

O bucket guarda apenas o conjunto NDJSON compactado. As planilhas do Drive são lidas e nunca são modificadas. O acesso às rotas `/api/dataset` e `/api/rebuild` mantém a verificação de sessão e o bloqueio para ADMIN/GERENTE.

A rota `POST /api/rebuild` seleciona somente as abas necessárias, percorre a aba de faturamento duas vezes e transmite os registros normalizados por fluxo ao R2.
