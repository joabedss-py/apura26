import type { ElectionCandidate } from '../types';

type CandidateLabelSource = Pick<ElectionCandidate, 'ballotName' | 'name' | 'number' | 'party'>;

type CandidateNumberParty = Pick<ElectionCandidate, 'number' | 'party'>;

function normalizeIdentity(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCandidateSuffix(candidate: CandidateNumberParty): string {
  const number = candidate.number.trim();
  const party = candidate.party.trim().toLocaleUpperCase('pt-BR');
  return [number ? `- ${number}` : '', party ? `(${party})` : ''].filter(Boolean).join(' ');
}

export function formatCandidateLabel(candidate: CandidateLabelSource): string {
  const name = candidate.ballotName.trim() || candidate.name.trim() || 'Candidato';
  const suffix = formatCandidateSuffix(candidate);
  return suffix ? `${name} ${suffix}` : name;
}

export function candidateMatchesSelection(
  candidate: ElectionCandidate | undefined,
  selectedCandidate: ElectionCandidate | null | undefined,
  selectedCandidateId?: string | null,
): boolean {
  if (!candidate) return false;
  if (selectedCandidateId && candidate.id === selectedCandidateId) return true;
  if (!selectedCandidate) return false;
  if (candidate.id === selectedCandidate.id) return true;

  const candidateNumber = candidate.number.replace(/\D/g, '');
  const selectedNumber = selectedCandidate.number.replace(/\D/g, '');
  if (candidateNumber && selectedNumber && candidateNumber === selectedNumber) return true;

  const candidateNames = [candidate.ballotName, candidate.name].map(normalizeIdentity).filter(Boolean);
  const selectedNames = [selectedCandidate.ballotName, selectedCandidate.name].map(normalizeIdentity).filter(Boolean);
  return candidateNames.some((name) => selectedNames.includes(name));
}
