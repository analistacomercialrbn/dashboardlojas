# Dashboard de Supervisão RCA

Versão inicial em Streamlit para a reunião de supervisores antes da reunião com os RCAs.

## Fontes
- Venda oficial: Produto (14).xlsx no Google Drive. A aba VENDAS da base consolidada não é usada.
- Auxiliar: BASES_CONSOLIDADAS_SETEMBRO(1).xlsx, usando CLIENTES, RCA, METAS e cadastros auxiliares.

## V1
Faturamento, meta, atingimento, clientes positivados, novos, inativados (regra provisória de 90 dias), ticket médio e mix médio por pedido/RCA.

Margem e desconto ficam pendentes até existir fonte com esses campos.

## Executar
pip install -r requirements.txt
streamlit run app.py

Os arquivos do Drive precisam estar acessíveis ao Streamlit. Na configuração provisória, compartilhe como qualquer pessoa com o link / leitor. Em produção, migrar a leitura para credenciais de serviço/Secrets.
