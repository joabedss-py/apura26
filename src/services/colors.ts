import type { ElectionCandidate } from '../types';

export function getCandidateColor(candidate: Pick<ElectionCandidate, 'id' | 'number' | 'name'>): string {
  const identity = candidate.id || `${candidate.number}-${candidate.name}`;
  let hash = 2166136261;
  for (const character of identity) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 70% 63%)`;
}
