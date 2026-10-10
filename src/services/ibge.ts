import type { FeatureCollection } from '../types';
import { findUnitByCode } from '../data/states';
import { feature as topojsonFeature } from 'topojson-client';

const IBGE_API = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const COMMON_QUERY = 'formato=application/vnd.geo+json&qualidade=minima';
const MUNICIPAL_MESH_URL = '/maps/brazil-municipalities-2025.topojson';
let allMunicipalitiesPromise: Promise<FeatureCollection> | undefined;

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
  const unit = findUnitByCode(uf);
  if (!unit) return Promise.reject(new Error(`UF não reconhecida: ${uf}.`));
  return getAllMunicipalitiesMap().then((data) => ({
    ...data,
    features: data.features.filter((feature) => getIbgeAreaCode(feature).startsWith(unit.ibgeCode)),
  }));
}

export function getAllMunicipalitiesMap(): Promise<FeatureCollection> {
  allMunicipalitiesPromise ??= fetchMunicipalTopology().catch((error: unknown) => {
    allMunicipalitiesPromise = undefined;
    throw error;
  });
  return allMunicipalitiesPromise;
}

async function fetchMunicipalTopology(): Promise<FeatureCollection> {
  const response = await fetch(MUNICIPAL_MESH_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Não foi possível carregar a malha municipal do IBGE (${response.status}).`);
  const topology = await response.json() as Parameters<typeof topojsonFeature>[0];
  const object = Object.values(topology.objects)[0];
  if (!object) throw new Error('A malha municipal do IBGE não contém geometrias.');
  const decoded = topojsonFeature(topology, object);
  if (decoded.type !== 'FeatureCollection') throw new Error('A malha municipal do IBGE está em formato inesperado.');
  return decoded as unknown as FeatureCollection;
}

export function getIbgeAreaCode(feature: { properties: Record<string, unknown> }): string {
  return String(feature.properties.codarea ?? feature.properties.CD_MUN ?? feature.properties.CD_GEOCMU ?? feature.properties.cd_mun ?? '').replace(/\D/g, '');
}
