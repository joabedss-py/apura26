import type { ElectionCandidate } from '../types';
import { getCandidateColor } from './colors';

type Rgb = [number, number, number];

function parseColor(color: string): Rgb | null {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const value = hex[1].length === 3
      ? hex[1].split('').map((digit) => parseInt(digit + digit, 16))
      : [0, 2, 4].map((index) => parseInt(hex[1].slice(index, index + 2), 16));
    return value as Rgb;
  }

  const rgb = color.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hsl = color.match(/^hsl\(\s*([\d.-]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i);
  if (!hsl) return null;
  const hue = ((Number(hsl[1]) % 360) + 360) % 360 / 360;
  const saturation = Number(hsl[2]) / 100;
  const lightness = Number(hsl[3]) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue * 12) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255);
  };
  return [channel(0), channel(8), channel(4)];
}

function rankedVotes(candidates: ElectionCandidate[]): ElectionCandidate[] {
  return candidates
    .filter((candidate) => candidate.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 3);
}

/** Combina até três candidaturas mais votadas na proporção dos votos oficiais locais. */
export function mixCandidateColors(candidates: ElectionCandidate[]): string | null {
  const visible = candidates.filter((candidate) => candidate.votes > 0).sort((a, b) => b.votes - a.votes);
  const totalVotes = visible.reduce((total, candidate) => total + candidate.votes, 0);
  if (!totalVotes) return null;

  const total = visible.reduce<Rgb>((sum, candidate) => {
    const rgb = parseColor(getCandidateColor(candidate)) ?? [130, 145, 136];
    const weight = candidate.votes / totalVotes;
    return [sum[0] + rgb[0] * weight, sum[1] + rgb[1] * weight, sum[2] + rgb[2] * weight];
  }, [0, 0, 0]);

  return `rgb(${total.map((channel) => Math.round(channel)).join(' ')})`;
}

/** Texto acessível com os percentuais dos candidatos que compõem a cor do polígono. */
export function describeVoteMix(candidates: ElectionCandidate[]): string {
  return rankedVotes(candidates)
    .map((candidate) => `${candidate.ballotName} ${candidate.percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`)
    .join(' · ');
}
