import type { FeatureCollection } from '../types';

const IBGE_API = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const COMMON_QUERY = 'formato=application/vnd.geo+json&qualidade=minima';

async function fetchGeoJson(url: string): Promise<FeatureCollection> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.geo+json, application/json' } });
  if (!response.ok) throw new Error(`Não foi possível carregar a malha territorial do IBGE (${response.status}).`);
  const data = await response.json() as FeatureCollection;
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('O IBGE retornou uma malha territorial em formato inesperado.');
  }
  return data;
}

export function getFederalUnitsMap(): Promise<FeatureCollection> {
  return fetchGeoJson(`${IBGE_API}/paises/BR?${COMMON_QUERY}&intrarregiao=UF`);
}

export function getMunicipalitiesMap(uf: string): Promise<FeatureCollection> {
  return fetchGeoJson(`${IBGE_API}/estados/${encodeURIComponent(uf.toUpperCase())}?${COMMON_QUERY}&intrarregiao=municipio`);
}

export function getIbgeAreaCode(feature: { properties: Record<string, unknown> }): string {
  return String(feature.properties.codarea ?? feature.properties.CD_MUN ?? feature.properties.cd_mun ?? '').replace(/\D/g, '');
}
