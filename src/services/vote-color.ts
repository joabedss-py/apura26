import type { ElectionCandidate } from '../types';
import { getCandidateColor } from './colors';

type Rgb = [number, number, number];
type Oklab = [number, number, number];

export type MarginBand = 'close' | 'competitive' | 'decisive';

const LOW_MARGIN_MAX_PP = 5;
const COMPETITIVE_MARGIN_MAX_PP = 20;

const PRESIDENTIAL_MARGIN_COLORS: Record<string, Record<MarginBand, string>> = {
  '#D60828': { close: '#F3B5BF', competitive: '#E66B7E', decisive: '#D60828' },
  '#272D97': { close: '#C8CDDB', competitive: '#919BB6', decisive: '#272D97' },
};

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
    .slice(0, 2);
}

function toLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const bounded = Math.min(1, Math.max(0, channel));
  const encoded = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function toOklab([red, green, blue]: Rgb): Oklab {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([lightness, a, b]: Oklab): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function interpolateOklab(first: string, second: string, secondWeight: number): string {
  const firstRgb = parseColor(first) ?? [130, 145, 136];
  const secondRgb = parseColor(second) ?? [130, 145, 136];
  const firstLab = toOklab(firstRgb);
  const secondLab = toOklab(secondRgb);
  const color = fromOklab(firstLab.map((channel, index) => channel * (1 - secondWeight) + secondLab[index] * secondWeight) as Oklab);
  return `rgb(${color.join(' ')})`;
}

function marginInPoints(leader: ElectionCandidate, runnerUp: ElectionCandidate): number | null {
  if (!Number.isFinite(leader.percent) || !Number.isFinite(runnerUp.percent)) return null;
  return Math.max(0, leader.percent - runnerUp.percent);
}

function marginBandFor(margin: number): MarginBand {
  if (margin <= LOW_MARGIN_MAX_PP) return 'close';
  if (margin <= COMPETITIVE_MARGIN_MAX_PP) return 'competitive';
  return 'decisive';
}

function marginBandLabel(band: MarginBand): string {
  if (band === 'close') return '0 a 5 p.p.';
  if (band === 'competitive') return '5 a 20 p.p.';
  return 'acima de 20 p.p.';
}

/** Mantém o matiz do vencedor e reduz a intensidade nas disputas mais apertadas. */
export function getCandidateColorForMargin(color: string, band: MarginBand): string {
  const exactPalette = PRESIDENTIAL_MARGIN_COLORS[color.toUpperCase()];
  if (exactPalette) return exactPalette[band];

  const neutralBlend = band === 'close' ? 0.72 : band === 'competitive' ? 0.44 : 0;
  return neutralBlend ? interpolateOklab(color, '#F3F4F2', neutralBlend) : color;
}

/** Usa a cor do vencedor; a faixa de diferença para o segundo colocado define sua intensidade. */
export function mixCandidateColors(candidates: ElectionCandidate[]): string | null {
  const [leader, runnerUp] = rankedVotes(candidates);
  if (!leader) return null;
  if (!runnerUp) return getCandidateColor(leader);

  const margin = marginInPoints(leader, runnerUp);
  if (margin === null) return getCandidateColor(leader);
  return getCandidateColorForMargin(getCandidateColor(leader), marginBandFor(margin));
}

/** Descrição acessível do vencedor e da faixa de diferença em pontos percentuais. */
export function describeVoteMix(candidates: ElectionCandidate[]): string {
  const [leader, runnerUp] = rankedVotes(candidates);
  if (!leader) return '';
  if (!runnerUp) return `Cor oficial de ${leader.ballotName}`;

  const margin = marginInPoints(leader, runnerUp);
  if (margin === null) return `Cor oficial de ${leader.ballotName}; diferença para o segundo colocado indisponível`;
  const formattedMargin = margin.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${leader.ballotName}; diferença de ${formattedMargin} p.p. (${marginBandLabel(marginBandFor(margin))})`;
}
