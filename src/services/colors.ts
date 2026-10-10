import type { ElectionCandidate } from '../types';

const FIXED_CANDIDATE_COLORS: Array<[string, string]> = [
  ['FLAVIO BOLSONARO', '#272D97'],
  ['LULA', '#D60828'],
  ['AUGUSTO CURY', '#4C8790'],
  ['RENAN SANTOS', '#D8942F'],
  ['RONALDO CAIADO', '#A0A00B'],
  ['ZEMA', '#4083A6'],
  ['SAMARA', '#454545'],
  ['HERTZ DIAS', '#B35454'],
  ['CLARIANA BARAO', '#AB7C24'],
  ['EDMILSON COSTA', '#E54B5A'],
  ['WILSON GRASSI', '#13617C'],
  ['RUI COSTA PIMENTA', '#913D00'],
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

export function getCandidateColor(candidate: Pick<ElectionCandidate, 'id' | 'number' | 'name' | 'ballotName'>): string {
  const identityText = normalize(`${candidate.ballotName} ${candidate.name}`);
  const fixed = FIXED_CANDIDATE_COLORS.find(([alias]) => identityText.includes(alias));
  if (fixed) return fixed[1];

  const identity = candidate.id || `${candidate.number}-${candidate.name}`;
  let hash = 2166136261;
  for (const character of identity) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 70% 63%)`;
}
