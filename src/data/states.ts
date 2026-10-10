export interface FederalUnit {
  uf: string;
  name: string;
  region: string;
  ibgeCode: string;
}

export const FEDERAL_UNITS: FederalUnit[] = [
  { uf: 'AC', name: 'Acre', region: 'Norte', ibgeCode: '12' },
  { uf: 'AL', name: 'Alagoas', region: 'Nordeste', ibgeCode: '27' },
  { uf: 'AM', name: 'Amazonas', region: 'Norte', ibgeCode: '13' },
  { uf: 'AP', name: 'Amapá', region: 'Norte', ibgeCode: '16' },
  { uf: 'BA', name: 'Bahia', region: 'Nordeste', ibgeCode: '29' },
  { uf: 'CE', name: 'Ceará', region: 'Nordeste', ibgeCode: '23' },
  { uf: 'DF', name: 'Distrito Federal', region: 'Centro-Oeste', ibgeCode: '53' },
  { uf: 'ES', name: 'Espírito Santo', region: 'Sudeste', ibgeCode: '32' },
  { uf: 'GO', name: 'Goiás', region: 'Centro-Oeste', ibgeCode: '52' },
  { uf: 'MA', name: 'Maranhão', region: 'Nordeste', ibgeCode: '21' },
  { uf: 'MT', name: 'Mato Grosso', region: 'Centro-Oeste', ibgeCode: '51' },
  { uf: 'MS', name: 'Mato Grosso do Sul', region: 'Centro-Oeste', ibgeCode: '50' },
  { uf: 'MG', name: 'Minas Gerais', region: 'Sudeste', ibgeCode: '31' },
  { uf: 'PA', name: 'Pará', region: 'Norte', ibgeCode: '15' },
  { uf: 'PB', name: 'Paraíba', region: 'Nordeste', ibgeCode: '25' },
  { uf: 'PR', name: 'Paraná', region: 'Sul', ibgeCode: '41' },
  { uf: 'PE', name: 'Pernambuco', region: 'Nordeste', ibgeCode: '26' },
  { uf: 'PI', name: 'Piauí', region: 'Nordeste', ibgeCode: '22' },
  { uf: 'RJ', name: 'Rio de Janeiro', region: 'Sudeste', ibgeCode: '33' },
  { uf: 'RN', name: 'Rio Grande do Norte', region: 'Nordeste', ibgeCode: '24' },
  { uf: 'RS', name: 'Rio Grande do Sul', region: 'Sul', ibgeCode: '43' },
  { uf: 'RO', name: 'Rondônia', region: 'Norte', ibgeCode: '11' },
  { uf: 'RR', name: 'Roraima', region: 'Norte', ibgeCode: '14' },
  { uf: 'SC', name: 'Santa Catarina', region: 'Sul', ibgeCode: '42' },
  { uf: 'SP', name: 'São Paulo', region: 'Sudeste', ibgeCode: '35' },
  { uf: 'SE', name: 'Sergipe', region: 'Nordeste', ibgeCode: '28' },
  { uf: 'TO', name: 'Tocantins', region: 'Norte', ibgeCode: '17' },
];

export const GOVERNOR_RUNOFF_UFS = ['AC', 'AM', 'ES', 'RN', 'TO', 'DF'] as const;

export const OFFICE_OPTIONS = [
  { code: '1', label: 'Presidente', scope: 'Brasil' },
  { code: '3', label: 'Governador', scope: 'Estado' },
  { code: '5', label: 'Senador', scope: 'Estado' },
  { code: '6', label: 'Deputado federal', scope: 'Estado' },
  { code: '7', label: 'Deputado estadual/distrital', scope: 'Estado' },
] as const;

export function findUnitByCode(code: unknown): FederalUnit | undefined {
  const normalized = String(code ?? '').trim().toUpperCase();
  return FEDERAL_UNITS.find((unit) => unit.uf === normalized || unit.ibgeCode === normalized.padStart(2, '0'));
}
