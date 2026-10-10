# Fontes oficiais de dados

Verificadas em 10 de outubro de 2026.

## Resultados eleitorais

- Página pública do TSE: https://resultados.tse.jus.br/oficial/app/index.html
- Notícia do TSE confirmando consulta do 1º turno por país, estado, município ou zona e por cargo: https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/resultados-do-1o-turno-das-eleicoes-2026-estao-disponiveis-em-pagina-do-tse
- Dados abertos do TSE para resultados de 2026: https://dadosabertos.tse.jus.br/dataset/resultados-2026
- Exemplo oficial nacional (Presidente, eleição 6257): https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.jws
- Exemplo oficial municipal (Presidente, município TSE 71072): https://resultados.tse.jus.br/oficial/ele2026/6257/dados/sp/sp71072-c0001-e006257-u.jws
- Exemplo oficial estadual (Governador, eleição 6259): https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0003-e006259-u.jws
- Configuração oficial que mapeia o código IBGE `cdi` ao código eleitoral TSE `cd`: https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.jws

A aplicação consome as respostas compactas JWS utilizadas pelo portal oficial, verifica a assinatura Ed25519 com a chave pública publicada pelo próprio aplicativo Resultados e só então normaliza os dados. Os endpoints aceitam consulta entre origens (CORS) e podem ser atualizados pelo controle da interface. O arquivo ZIP de votação nominal por município e zona (292 MB) não é baixado pela aplicação.

## Malhas territoriais

- Página de malhas do IBGE: https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html
- Documentação oficial da API: https://servicodados.ibge.gov.br/api/docs/malhas?versao=3
- Brasil dividido por UF: https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=UF
- Municípios de uma UF: https://servicodados.ibge.gov.br/api/v3/malhas/estados/SP?formato=application%2Fvnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio

A chave de ligação do mapa municipal é o código territorial do IBGE; a consulta eleitoral usa o código municipal retornado na configuração oficial do TSE.
