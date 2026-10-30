# Dashboard de Supervisão RCA

Dashboard novo e independente do dashboard atual de performance por porte.

## Fontes
- Venda oficial: `Produto (14).xlsx` no Google Drive.
- Base auxiliar: `BASES_CONSOLIDADAS_SETEMBRO(1).xlsx`, usando `CLIENTES`, `RCA`, `METAS` e `ROTAS`.
- A aba `VENDAS` da base consolidada não é utilizada.

## V1
A versão `app_v1.py` já traz:
- filtros de mês, supervisor, RCA e departamento;
- faturamento, meta e atingimento;
- resumo por supervisão e por RCA;
- clientes positivados, novos e inativados (regra provisória de 90 dias);
- ticket médio;
- mix médio por pedido, calculado pela média de seções distintas por pedido;
- detalhe por RCA e faturamento por departamento/seção.

Margem e desconto ficam pendentes até existir fonte confiável para esses campos.

## Executar
```bash
pip install -r requirements.txt
streamlit run app_v1.py
```

## Publicar no Streamlit Community Cloud
Use este repositório e informe `supervisao/app_v1.py` como **Main file path**. Isso cria um app separado do dashboard atual.

## Observação de segurança
A configuração atual usa arquivos do Drive liberados como “qualquer pessoa com o link – leitor”. Para produção, o ideal é usar repositório privado e/ou leitura autenticada por Secrets/credenciais de serviço.
