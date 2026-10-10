import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature as topojsonFeature } from 'topojson-client';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(projectRoot, 'public/maps/brazil-municipalities-2025.topojson');
const outputDirectory = path.join(projectRoot, 'public/maps/municipalities-by-uf');
const stateSourcePath = path.join(projectRoot, 'src/data/states.ts');

const topology = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const topologyObject = Object.values(topology.objects)[0];
if (!topologyObject) throw new Error('A malha municipal de origem não contém geometrias.');

const decoded = topojsonFeature(topology, topologyObject);
if (decoded.type !== 'FeatureCollection') {
  throw new Error('A malha municipal de origem não é uma FeatureCollection.');
}

const expectedIbgeCodes = [...fs.readFileSync(stateSourcePath, 'utf8').matchAll(/ibgeCode:\s*['"](\d{2})['"]/g)]
  .map((match) => match[1]);
if (expectedIbgeCodes.length !== 27) {
  throw new Error(`Esperadas 27 UFs em src/data/states.ts; encontradas ${expectedIbgeCodes.length}.`);
}

const municipalitiesByIbgeCode = new Map();
const seenMunicipalityCodes = new Set();
for (const municipality of decoded.features) {
  const municipalityCode = String(municipality.properties?.codarea ?? municipality.properties?.CD_MUN ?? municipality.properties?.CD_GEOCMU ?? '')
    .replace(/\D/g, '');
  if (municipalityCode.length !== 7) {
    throw new Error(`Código IBGE municipal inválido na malha: ${municipalityCode || '(vazio)'}.`);
  }
  if (seenMunicipalityCodes.has(municipalityCode)) {
    throw new Error(`Código IBGE municipal duplicado na malha: ${municipalityCode}.`);
  }
  seenMunicipalityCodes.add(municipalityCode);

  const ibgeCode = municipalityCode.slice(0, 2);
  const municipalities = municipalitiesByIbgeCode.get(ibgeCode) ?? [];
  municipalities.push(municipality);
  municipalitiesByIbgeCode.set(ibgeCode, municipalities);
}

const expected = new Set(expectedIbgeCodes);
const actual = new Set(municipalitiesByIbgeCode.keys());
const missing = [...expected].filter((code) => !actual.has(code));
const unexpected = [...actual].filter((code) => !expected.has(code));
if (missing.length || unexpected.length) {
  throw new Error(`A cobertura de UFs da malha diverge do cadastro: ausentes ${missing.join(', ') || 'nenhuma'}; inesperadas ${unexpected.join(', ') || 'nenhuma'}.`);
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const fileName of fs.readdirSync(outputDirectory)) {
  if (fileName.endsWith('.geojson')) fs.unlinkSync(path.join(outputDirectory, fileName));
}

for (const [ibgeCode, municipalities] of municipalitiesByIbgeCode) {
  const stateMap = { type: 'FeatureCollection', features: municipalities };
  fs.writeFileSync(
    path.join(outputDirectory, `${ibgeCode}.geojson`),
    JSON.stringify(stateMap),
  );
}

console.log(`Gerados ${municipalitiesByIbgeCode.size} mapas por UF com ${decoded.features.length.toLocaleString('pt-BR')} municípios.`);
