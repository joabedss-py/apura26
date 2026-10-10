# Fontes oficiais de dados

Verificadas em 10 de outubro de 2026.

## Resultados eleitorais

- Página pública do TSE: https://resultados.tse.jus.br/oficial/app/index.html
- Notícia do TSE confirmando consulta do 1º turno por país, estado, município ou zona e por cargo: https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/resultados-do-1o-turno-das-eleicoes-2026-estao-disponiveis-em-pagina-do-tse
- Dados abertos do TSE para resultados de 2026: https://dadosabertos.tse.jus.br/dataset/resultados-2026
- Exemplo oficial nacional (Presidente, eleição 6257): https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.jws
- Exemplo oficial municipal (Presidente, município TSE 71072): https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp71072-c0001-e006257-u.jws
- Exemplo oficial estadual (Governador, eleição 6259): https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0003-e006259-u.jws
- Configuração do TSE com o vínculo entre código IBGE `cdi` e código eleitoral `cd`: https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.jws

## Segundo turno e atualização

- Instruções técnicas do TSE para divulgação dos resultados 2026 (códigos de eleição, formato, consulta e limites): https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados
- O TSE define os códigos 6258 para a eleição federal e 6260 para as eleições estaduais do segundo turno de 25/10/2026. A apuração oficial começa às 17h (horário de Brasília).
- Exemplo oficial pré-configurado para Presidente no 2º turno: https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.jws
- Exemplo oficial pré-configurado para Governador no DF: https://resultados.tse.jus.br/oficial/ele2026/6260/dados/df/df-c0003-e006260-u.jws
- A lista atualizada de UFs com 2º turno para governador (após retotalização em 08/10/2026) é Acre, Amazonas, Espírito Santo, Rio Grande do Norte, Tocantins e Distrito Federal: https://g1.globo.com/politica/eleicoes/2026/noticia/2026/10/08/eleicoes-2026-quais-estados-ja-elegeram-governador-e-onde-havera-segundo-turno.ghtml
- A documentação do TSE limita o acesso a 100 requisições por IP por segundo e adverte que muitos erros 404 podem provocar bloqueio temporário. A aplicação limita suas consultas a 50 por segundo e não faz polling automático do 2º turno antes de 25/10/2026, 17h.

As respostas compactas JWS usadas pela aplicação são verificadas com Ed25519 e a chave pública publicada no próprio aplicativo Resultados antes da normalização. Os arquivos de 2º turno podem já existir com 0 seções e 0 votos antes do início da apuração; esses valores representam estado pré-apuração e não devem ser apresentados como votos apurados. O arquivo ZIP nominal por município e zona, de grande porte, não é baixado pela aplicação.

## Malhas territoriais

- Página de malhas do IBGE: https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html
- Documentação oficial da API: https://servicodados.ibge.gov.br/api/docs/malhas?versao=3
- Brasil dividido por UF: https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=UF
- Municípios de uma UF: https://servicodados.ibge.gov.br/api/v3/malhas/estados/SP?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio
- Todos os municípios do Brasil: https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio
- Malha Municipal Digital 2025 do IBGE, ZIP unificado do Brasil: https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip
- Catálogo do IBGE para a malha 2025, também distribuída pelo Earth Engine: https://developers.google.com/earth-engine/datasets/catalog/IBGE_MUNICIPIOS_V2025
- Comunicado de atualização do IBGE de março de 2026, referente à malha 2025: https://agenciadenoticias.ibge.gov.br/en/agencia-news/2184-news-agency/news/46276-ibge-atualiza-dados-geograficos-de-estados-e-municipios-brasileiros-para-o-ano-de-2026

O TSE pode repetir municípios no cadastro por incluir pleitos suplementares; a aplicação liga e deduplica os mapas pelo código IBGE, mantendo o primeiro código eleitoral geral encontrado. A malha municipal oficial de 2025 do IBGE contém 5.573 geocódigos: 5.569 municípios (incluindo Boa Esperança do Norte, MT), o Distrito Federal, Fernando de Noronha e duas áreas operacionais de água. O site utiliza as 5.571 localidades da configuração eleitoral assinada pelo TSE (incluindo DF e Fernando de Noronha) e exclui as duas áreas de água sem disputa municipal.
O arquivo `public/maps/brazil-municipalities-2025.topojson` foi gerado a partir do ZIP do IBGE; a simplificação cartográfica e a quantização diminuem o peso de transferência, preservando as 5.571 localidades eleitorais e seus códigos `CD_MUN` ligados ao cadastro assinado do TSE. A origem é atribuída ao IBGE; o TSE é a autoridade para a relação de localidades e códigos de consulta.
