import { findUnitByCode, GOVERNOR_RUNOFF_UFS } from '../data/states';
import type { ElectionCandidate, ElectionResult, ElectionRound, MunicipalityRef } from '../types';

const TSE_ROOT = 'https://resultados.tse.jus.br/oficial/ele2026';
const ELECTION_BY_ROUND_CARGO: Record<ElectionRound, Record<string, string>> = {
  '1': { '1': '6257', '3': '6259', '5': '6259', '6': '6259', '7': '6259' },
  '2': { '1': '6258', '3': '6260' },
};
const TSE_KEY_ID = 'sNbt9Q_fLS65zE1_ZLNV-XRRwPY';
const TSE_PUBLIC_KEY: JsonWebKey = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'kWlpNHjuws1csyQZwzn3Fhzbi3RD435RbpThtSr4hMc',
  ext: true,
};
const TSE_REQUESTS_PER_SECOND = 50;
const TSE_REQUEST_INTERVAL_MS = 1_000 / TSE_REQUESTS_PER_SECOND;

interface RawObject {
  [key: string]: unknown;
}

interface RawCargo extends RawObject {
  cd?: string;
  nmn?: string;
  agr?: RawObject[];
}

interface RawPayload extends RawObject {
  ele?: string;
  tpabr?: string;
  cdabr?: string;
  dg?: string;
  ht?: string;
  carg?: RawCargo[];
  e?: RawObject;
  s?: RawObject;
  v?: RawObject;
}

let publicKeyPromise: Promise<CryptoKey> | undefined;
const municipalityIndexPromises = new Map<ElectionRound, Promise<Map<string, MunicipalityRef>>>();
let nextTseRequestAt = 0;
const responseCache = new Map<string, { expiresAt: number; value: Promise<RawPayload> }>();

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(segment: string): RawPayload {
  const bytes = decodeBase64Url(segment);
  return JSON.parse(new TextDecoder().decode(bytes)) as RawPayload;
}

async function verifyJws(token: string): Promise<RawPayload> {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.trim().split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra !== undefined) {
    throw new Error('O TSE retornou um arquivo de apuração em formato inesperado.');
  }

  const header = decodeJsonSegment(encodedHeader) as RawObject;
  if (header.alg !== 'EdDSA' || header.kid !== TSE_KEY_ID) {
    throw new Error('A assinatura do arquivo não corresponde à chave pública oficial do TSE.');
  }

  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador não oferece verificação criptográfica segura para os dados do TSE.');
  }

  publicKeyPromise ??= crypto.subtle.importKey(
    'jwk',
    TSE_PUBLIC_KEY,
    { name: 'Ed25519' } as AlgorithmIdentifier,
    false,
    ['verify'],
  );
  const [publicKey, signature] = await Promise.all([
    publicKeyPromise,
    Promise.resolve(decodeBase64Url(encodedSignature)),
  ]);
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signatureSource = signature as unknown as BufferSource;
  const signingInputSource = signingInput as unknown as BufferSource;
  const valid = await crypto.subtle.verify(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    publicKey,
    signatureSource,
    signingInputSource,
  );
  if (!valid) throw new Error('Não foi possível confirmar a assinatura digital do TSE.');
  return decodeJsonSegment(encodedPayload);
}

async function waitForTseRequestSlot(): Promise<void> {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextTseRequestAt);
  nextTseRequestAt = scheduledAt + TSE_REQUEST_INTERVAL_MS;
  const delay = scheduledAt - now;
  if (delay > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}

async function fetchSignedPayload(url: string): Promise<RawPayload> {
  const now = Date.now();
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value;

  const isSecondRound = /\/6258\/|\/6260\//.test(url);
  const cacheDuration = isSecondRound ? 15_000 : 60_000;
  const request = (async () => {
    await waitForTseRequestSlot();
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/jose, application/json, text/plain' },
    });
    if (!response.ok) {
      const error = new Error(`O TSE respondeu com erro ${response.status}.`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return verifyJws(await response.text());
  })();
  responseCache.set(url, { expiresAt: now + cacheDuration, value: request });
  try {
    return await request;
  } catch (error) {
    responseCache.delete(url);
    throw error;
  }
}

function electionCodeFor(cargoCode: string, round: ElectionRound): string {
  const code = ELECTION_BY_ROUND_CARGO[round][cargoCode];
  if (!code) throw new Error(round === '2' ? 'Este cargo não tem disputa no segundo turno.' : 'Cargo não disponível na consulta do TSE.');
  return code;
}

export function getTseEndpoint(cargoCode: string, uf?: string, municipalityCode?: string, round: ElectionRound = '1'): string {
  const electionCode = electionCodeFor(cargoCode, round);
  const region = uf ? uf.toLowerCase() : 'br';
  const cargo = cargoCode.padStart(4, '0');
  const election = electionCode.padStart(6, '0');
  const municipalityPrefix = municipalityCode ? `${region}${municipalityCode.padStart(5, '0')}` : region;
  return `${TSE_ROOT}/${electionCode}/dados/${region}/${municipalityPrefix}-c${cargo}-e${election}-u.jws`;
}

function asNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function parsePercent(value: unknown): number {
  return asNumber(value) ?? 0;
}

function collectCandidates(cargo: RawCargo): ElectionCandidate[] {
  const found = new Map<string, ElectionCandidate>();
  const visit = (value: unknown, inheritedParty = ''): void => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, inheritedParty));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as RawObject;
    const party = String(node.sg ?? node.com ?? inheritedParty).trim().toLocaleUpperCase('pt-BR');
    if ('vap' in node && ('pvap' in node || 'pvapn' in node)) {
      const id = String(node.sqcand ?? `${node.n ?? ''}-${node.nmu ?? node.nm ?? ''}`);
      found.set(id, {
        id,
        name: String(node.nm ?? node.nmu ?? 'Candidatura sem nome'),
        ballotName: String(node.nmu ?? node.nm ?? 'Candidatura'),
        party,
        number: String(node.n ?? ''),
        votes: asNumber(node.vap) ?? 0,
        percent: parsePercent(node.pvapn ?? node.pvap),
        status: String(node.st ?? node.dvt ?? ''),
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'par' || key === 'cand' || key === 'agr' || key === 'fed') {
        visit(child, party || inheritedParty);
      }
    }
  };
  visit(cargo.agr ?? []);
  return [...found.values()].sort((a, b) => b.votes - a.votes);
}

export function normalizeResults(payload: RawPayload, cargoCode: string, sourceUrl: string): ElectionResult {
  const cargo = payload.carg?.find((entry) => entry.cd === cargoCode) ?? payload.carg?.[0];
  if (!cargo) throw new Error('Ainda não há dados de votação para este cargo nesta localidade.');
  const turnout = asNumber(payload.e?.pcn ?? payload.e?.pc);
  const abstention = asNumber(payload.e?.pan ?? payload.e?.pa);
  return {
    electionCode: String(payload.ele ?? ''),
    cargoCode,
    cargoName: String(cargo.nmn ?? cargo.nmm ?? 'Cargo eleitoral'),
    ufCode: String(payload.cdabr ?? 'br'),
    updatedDate: String(payload.dg ?? ''),
    updatedTime: String(payload.ht ?? ''),
    turnout,
    abstention,
    validVotes: asNumber(payload.v?.vv),
    totalVotes: asNumber(payload.v?.tv),
    totalSections: asNumber(payload.s?.ts),
    countedSections: asNumber(payload.s?.st),
    countedPercent: asNumber(payload.s?.pstn ?? payload.s?.pst),
    candidates: collectCandidates(cargo),
    sourceUrl,
  };
}

export async function getElectionResults(options: {
  cargoCode: string;
  uf?: string;
  municipalityCode?: string;
  round?: ElectionRound;
}): Promise<ElectionResult> {
  const round = options.round ?? '1';
  if (round === '2' && options.cargoCode === '3' && options.uf && !GOVERNOR_RUNOFF_UFS.includes(options.uf as (typeof GOVERNOR_RUNOFF_UFS)[number])) {
    throw new Error(`Não há segundo turno para governador em ${options.uf}.`);
  }
  const sourceUrl = getTseEndpoint(options.cargoCode, options.uf, options.municipalityCode, round);
  const payload = await fetchSignedPayload(sourceUrl);
  return normalizeResults(payload, options.cargoCode, sourceUrl);
}

export function getMunicipalityIndex(round: ElectionRound = '1'): Promise<Map<string, MunicipalityRef>> {
  const cached = municipalityIndexPromises.get(round);
  if (cached) return cached;
  const electionCode = electionCodeFor('1', round);
  const request = (async () => {
    const endpoint = `${TSE_ROOT}/${electionCode}/config/mun-e${electionCode.padStart(6, '0')}-cm.jws`;
    const payload = await fetchSignedPayload(endpoint);
    const result = new Map<string, MunicipalityRef>();
    const states = Array.isArray(payload.abr) ? payload.abr as RawObject[] : [];
    for (const state of states) {
      const unit = findUnitByCode(state.cd);
      if (!unit) continue;
      const municipalities = Array.isArray(state.mu) ? state.mu as RawObject[] : [];
      for (const municipality of municipalities) {
        const ibgeCode = String(municipality.cdi ?? '').padStart(7, '0');
        const tseCode = String(municipality.cd ?? '').padStart(5, '0');
        if (!municipality.cdi || !municipality.cd || result.has(ibgeCode)) continue;
        result.set(ibgeCode, {
          ibgeCode,
          tseCode,
          name: String(municipality.nm ?? ''),
          uf: unit.uf,
        });
      }
    }
    if (result.size === 0) throw new Error('O TSE não retornou o índice de municípios.');
    return result;
  })();
  municipalityIndexPromises.set(round, request);
  return request.catch((error: unknown) => {
    municipalityIndexPromises.delete(round);
    throw error;
  });
}
