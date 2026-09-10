# Dashboard de Logística Operacional — V1

Aplicação Streamlit para acompanhamento de formação de cargas, rotas, entregas, motoristas, pendências, ocorrências e custos.

## Segurança da fonte
A aplicação opera em **somente leitura**. A planilha-base não é alterada; os tratamentos acontecem apenas em memória.

## Fonte de dados
No Streamlit Cloud, configure em Secrets:

```toml
DATA_XLSX_URL = "LINK_DE_DOWNLOAD_OU_EXPORTACAO_SOMENTE_LEITURA"
```

A URL deve entregar o Excel que contém, no mínimo, as abas `FORMAÇÃO 2026` e `CADASTRO REGIAO`.

## Execução

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Telas da V1
- Visão Geral
- Formação de Cargas
- Rotas e Entregas
- Motoristas e Frota
- Pendências
- Ocorrências
- Custos

## Próximas evoluções
- Reaproveitar a base de coordenadas/mapa do Dashboard de Supervisão RCA.
- Login e perfis de acesso.
- Conexão autenticada com Google Drive.
- Drill-down por carga quando houver uma chave única confiável de formação.
- Estruturação da agenda de motoristas a partir de `DESTINO MOTORISTAS`.
