import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Database, ExternalLink, Info, Layers3, LoaderCircle, MapPin, Maximize2, Minimize2, Pause, Play, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import BrazilMap from './components/BrazilMap';
import MunicipalityResultsPanel from './components/MunicipalityResultsPanel';
import ElectionScopeControls from './components/ElectionScopeControls';
import CandidatePortrait from './components/CandidatePortrait';
import { FEDERAL_UNITS, GOVERNOR_RUNOFF_UFS, OFFICE_OPTIONS, findUnitByCode } from './data/states';
import { getAllMunicipalitiesMap, getFederalUnitsMap, getIbgeAreaCode, getMunicipalitiesMap } from './services/ibge';
import { getCandidateColor } from './services/colors';
import { formatCandidateLabel, formatCandidateSuffix } from './services/candidate-identity';
import { getCandidateColorForMargin, type MarginBand } from './services/vote-color';
import { getElectionResults, getMunicipalityIndex } from './services/tse';
import type { ElectionCandidate, ElectionResult, ElectionRound, FeatureCollection, GeoFeature, LoadState, MunicipalityOverviewRow, MunicipalityRef } from './types';

const TSE_RESULTS_URL = 'https://resultados.tse.jus.br/oficial/app/index.html';
const TSE_OPEN_DATA_URL = 'https://dadosabertos.tse.jus.br/dataset/resultados-2026';
const UF_BY_IBGE = new Map(FEDERAL_UNITS.map((unit) => [unit.ibgeCode, unit]));
const ROUND_TWO_START = Date.parse('2026-10-25T20:00:00Z');
const ROUND_TWO_LOCAL_POLL_MS = 30_000;
const ROUND_TWO_CITIES_POLL_MS = 180_000;
const MUNICIPALITY_REQUEST_WORKERS = 32;
const MUNICIPALITY_PROGRESS_BATCH = 50;
const MARGIN_LEGEND_BANDS: Array<{ band: MarginBand; label: string }> = [
  { band: 'close', label: '0–5 p.p.' },
  { band: 'competitive', label: '5–20 p.p.' },
  { band: 'decisive', label: 'Acima de 20 p.p.' },
];
const PRESIDENT_MARGIN_LEGEND = [
  { id: 'lula', label: 'LULA', color: '#D60828' },
  { id: 'flavio', label: 'FLÁVIO', color: '#272D97' },
];

function formatInteger(value?: number | null): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(value);
}

function formatPercent(value?: number | null): string {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function isGovernorRunoff(uf?: string | null): boolean {
  return Boolean(uf && GOVERNOR_RUNOFF_UFS.includes(uf as (typeof GOVERNOR_RUNOFF_UFS)[number]));
}

function unitFromFeature(feature: GeoFeature) {
  const properties = feature.properties;
  const directUf = properties.sigla ?? properties.SIGLA_UF ?? properties.uf ?? properties.UF;
  if (directUf) return findUnitByCode(directUf);
  const code = getIbgeAreaCode(feature);
  return UF_BY_IBGE.get(code.padStart(2, '0').slice(0, 2)) ?? findUnitByCode(code);
}

function StatusPill({ status, text }: { status: 'ok' | 'loading' | 'warning'; text: string }) {
  const Icon = status === 'ok' ? Check : status === 'loading' ? LoaderCircle : Info;
  return <span className={`status-pill status-pill--${status}`}><Icon size={13} className={status === 'loading' ? 'spin' : ''} />{text}</span>;
}

function EmptyResults({
  officeLabel,
  officeCode,
  national,
  selectedUF,
  status,
  message,
  round,
  roundTwoStarted,
}: {
  officeLabel: string;
  officeCode: string;
  national: boolean;
  selectedUF: string | null;
  status: LoadState;
  message?: string;
  round: ElectionRound;
  roundTwoStarted: boolean;
}) {
  if (round === '2' && !roundTwoStarted) {
    return <div className="empty-state"><div className="empty-icon"><Clock3 size={19} /></div><p className="eyebrow">SEGUNDO TURNO · 25 OUT</p><h3>A apuração começa às 17h</h3><p>O painel acompanhará os arquivos oficiais do TSE quando a totalização começar. Nenhum voto foi presumido ou estimado.</p></div>;
  }
  if (round === '2' && officeCode === '3' && selectedUF && !isGovernorRunoff(selectedUF)) {
    return <div className="empty-state"><div className="empty-icon"><Info size={19} /></div><p className="eyebrow">SEM SEGUNDO TURNO NESTA UF</p><h3>{selectedUF} não tem disputa para governador no 2º turno</h3><p>Os resultados de governador desta unidade da Federação foram definidos no 1º turno.</p></div>;
  }
  if (status === 'loading') {
    return <div className="loading-state"><LoaderCircle className="spin" size={23} /><span>Consultando dados assinados do TSE…</span></div>;
  }
  if (status === 'error') {
    return <div className="empty-state empty-state--error"><div className="empty-icon"><Info size={19} /></div><p className="eyebrow">FONTE TEMPORARIAMENTE INDISPONÍVEL</p><h3>Não foi possível carregar a apuração</h3><p>{message ?? 'Tente novamente. Os resultados são consultados diretamente na fonte oficial.'}</p><a href={TSE_RESULTS_URL} target="_blank" rel="noreferrer">Abrir Resultados do TSE <ExternalLink size={13} /></a></div>;
  }
  if (!national && !selectedUF && status === 'empty') {
    return <div className="empty-state"><div className="empty-icon"><MapPin size={19} /></div><p className="eyebrow">DISPUTA ESTADUAL</p><h3>Escolha uma UF no mapa</h3><p>A votação de {officeLabel.toLowerCase()} é contabilizada separadamente em cada estado. Selecione uma unidade para ver candidaturas e votos oficiais.</p></div>;
  }
  return <div className="empty-state"><div className="empty-icon"><Clock3 size={19} /></div><p className="eyebrow">SEM RESULTADO PUBLICADO</p><h3>O TSE ainda não disponibilizou esta consulta</h3><p>{message || 'Este painel não preenche lacunas com dados ilustrativos. Consulte novamente ou abra a fonte oficial.'}</p></div>;
}

function CandidateList({ result, waitingForCount = false, selectedCandidateId, photoRegion, onSelectCandidate }: {
  result: ElectionResult;
  waitingForCount?: boolean;
  selectedCandidateId: string | null;
  photoRegion: string;
  onSelectCandidate: (candidate: ElectionCandidate) => void;
}) {
  if (!result.candidates.length) {
    return <div className="empty-state empty-state--compact"><div className="empty-icon"><Info size={18} /></div><h3>Sem candidaturas publicadas neste arquivo</h3><p>Consulte novamente após a próxima atualização oficial.</p></div>;
  }
  const maximum = Math.max(1, result.candidates[0]?.votes ?? 0);
  return (
    <div className="candidate-list">
      {result.candidates.map((candidate, index) => {
        const color = getCandidateColor(candidate);
        const focused = selectedCandidateId === candidate.id;
        const candidateDetails = formatCandidateSuffix(candidate);
        return (
          <button
            type="button"
            className={`candidate-row candidate-row--selectable${index === 0 ? ' candidate-row--leader' : ''}${focused ? ' candidate-row--focused' : ''}`}
            key={candidate.id}
            onClick={() => onSelectCandidate(candidate)}
            aria-pressed={focused}
            disabled={waitingForCount}
            title={`Focar o mapa nas áreas onde ${formatCandidateLabel(candidate)} lidera`}
            style={{ borderLeftColor: focused ? color : 'transparent' }}
          >
            <CandidatePortrait candidate={candidate} region={photoRegion} className="candidate-photo--list" />
            <div className="candidate-main">
              <div className="candidate-name-line"><span className="candidate-color-dot" style={{ backgroundColor: color }} aria-hidden="true" /><strong>{candidate.ballotName}</strong>{candidateDetails && <span className="party-tag">{candidateDetails}</span>}</div>
              <div className="candidate-meter"><span style={{ width: waitingForCount ? '0%' : `${Math.max(0, Math.min(100, candidate.votes / maximum * 100))}%`, backgroundColor: color }} /></div>
              <div className="candidate-foot"><span className="candidate-votes">{waitingForCount ? 'Aguardando apuração' : `${formatInteger(candidate.votes)} votos`}</span><span className="candidate-status">{candidate.status || 'Candidatura'}</span></div>
            </div>
            <div className="candidate-percent" style={{ color }}>{waitingForCount ? '—' : formatPercent(candidate.percent)}</div>
          </button>
        );
      })}
    </div>
  );
}

function SummaryPanel({
  result,
  status,
  message,
  officeLabel,
  officeCode,
  round,
  roundTwoStarted,
  national,
  selectedUF,
  selectedMunicipality,
  leaders,
  leadersLoading,
  selectedCandidateId,
  onSelectCandidate,
  onBack,
  onRefresh,
  refreshing,
  canUseSecondRound,
  simulationActive,
  onSelectOffice,
  onSelectRound,
}: {
  result: ElectionResult | null;
  status: LoadState;
  message: string;
  officeLabel: string;
  officeCode: string;
  round: ElectionRound;
  roundTwoStarted: boolean;
  canUseSecondRound: boolean;
  simulationActive: boolean;
  national: boolean;
  selectedUF: string | null;
  selectedMunicipality: MunicipalityRef | null;
  leaders: Map<string, ElectionCandidate>;
  leadersLoading: boolean;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidate: ElectionCandidate) => void;
  onBack: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onSelectOffice: (officeCode: string) => void;
  onSelectRound: (round: ElectionRound) => void;
}) {
  const areaTitle = selectedMunicipality?.name ?? (selectedUF ? FEDERAL_UNITS.find((unit) => unit.uf === selectedUF)?.name : 'Brasil');
  const waitingForCount = Boolean(round === '2' && roundTwoStarted && result?.countedSections === 0);
  const roundLabel = round === '1' ? '1º turno' : '2º turno';
  const municipalityLeader = selectedMunicipality && !waitingForCount
    ? result?.candidates.find((candidate) => candidate.votes > 0)
    : undefined;
  const municipalityCounted = Boolean(selectedMunicipality && status === 'ready' && municipalityLeader);
  return (
    <aside className="results-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">APURAÇÃO OFICIAL</p><h2>{areaTitle ?? 'Brasil'}</h2><p className="panel-subtitle">{officeLabel} <span>·</span> {roundLabel}</p></div>
        <div className="panel-heading-actions">
          <button className="back-button" type="button" onClick={onBack} disabled={!selectedUF} title={selectedMunicipality ? 'Voltar ao mapa da UF' : 'Voltar ao mapa do Brasil'}><ChevronLeft size={15} /><span>Voltar</span></button>
          <button className="icon-button refresh-button" type="button" onClick={onRefresh} aria-label="Atualizar resultados" title="Consultar o TSE novamente" disabled={round === '2' && !roundTwoStarted}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /><span>Atualizar</span></button>
        </div>
      </div>
      <ElectionScopeControls
        officeCode={officeCode}
        round={round}
        roundTwoStarted={roundTwoStarted}
        canUseSecondRound={canUseSecondRound}
        simulationActive={simulationActive}
        onOfficeChange={onSelectOffice}
        onRoundChange={onSelectRound}
      />
      {selectedMunicipality && <div className="municipality-focus" aria-live="polite" aria-atomic="true">
        <div className="municipality-focus-place">
          <span className="municipality-focus-kicker">MUNICÍPIO SELECIONADO · {selectedMunicipality.uf}</span>
          <strong>{selectedMunicipality.name}</strong>
          <small>{selectedMunicipality.tseCode ? `Código TSE ${selectedMunicipality.tseCode} · IBGE ${selectedMunicipality.ibgeCode}` : `IBGE ${selectedMunicipality.ibgeCode} · identificando código TSE`}</small>
        </div>
        <div className="municipality-focus-votes">
          {municipalityCounted && municipalityLeader ? <>
            <span className="municipality-focus-kicker"><i style={{ backgroundColor: getCandidateColor(municipalityLeader) }} /> LÍDER LOCAL</span>
            <strong>{formatCandidateLabel(municipalityLeader)}</strong>
            <b>{formatInteger(municipalityLeader.votes)} votos</b>
            <small>{formatPercent(municipalityLeader.percent)} dos votos nominais</small>
          </> : <span className={`municipality-focus-state${status === 'error' ? ' is-error' : ''}`}>
            {round === '2' && !roundTwoStarted
              ? 'Aguardando o início da apuração do 2º turno.'
              : waitingForCount
                ? 'Aguardando votos totalizados pelo TSE.'
                : status === 'loading'
                  ? 'Consultando votos nominais no TSE…'
                  : status === 'error'
                    ? 'Não foi possível consultar os votos deste município.'
                    : 'Ainda não há votos publicados para este município.'}
          </span>}
        </div>
      </div>}
      {result ? (
        <>
          <div className="result-meta"><StatusPill status={waitingForCount ? 'warning' : 'ok'} text={waitingForCount ? 'AGUARDANDO APURAÇÃO' : 'ASSINATURA TSE VERIFICADA'} /><span>Atualizado {result.updatedDate || '—'}{result.updatedTime ? ` · ${result.updatedTime}` : ''}</span></div>
          {waitingForCount && <div className="round-waiting-notice"><Clock3 size={14} /><span>Arquivo oficial do TSE recebido; ainda não há seções totalizadas nem votos apurados.</span></div>}
          {round === '2' && roundTwoStarted && <p className="live-update-note"><span className="live-dot" /> Atualização automática a cada 30 segundos</p>}
          {waitingForCount ? <div className="stat-grid">
            <div className="stat-card"><span>Seções apuradas</span><strong>0 <small>/ {formatInteger(result.totalSections)}</small></strong><div className="stat-progress"><span style={{ width: '0%' }} /></div><em>Votos ainda não totalizados</em></div>
            <div className="stat-card"><span>Totalização</span><strong>Aguardando</strong><em>Nenhum voto apurado ainda</em></div>
          </div> : <div className="stat-grid">
            <div className="stat-card"><span>Seções apuradas</span><strong>{formatInteger(result.countedSections)} <small>/ {formatInteger(result.totalSections)}</small></strong><div className="stat-progress"><span style={{ width: `${Math.max(0, Math.min(100, result.countedPercent ?? 0))}%` }} /></div><em>{formatPercent(result.countedPercent)} totalizado</em></div>
            <div className="stat-card"><span>Comparecimento</span><strong>{formatPercent(result.turnout)}</strong><em>Abstenção {formatPercent(result.abstention)}</em></div>
          </div>}
          <div className="candidate-heading"><h3>Votação nominal</h3><span>{result.candidates.length} candidaturas{selectedMunicipality ? ' · votos deste município' : ' · clique para focar'}</span></div>
          <CandidateList result={result} waitingForCount={waitingForCount} selectedCandidateId={selectedCandidateId} photoRegion={officeCode === '1' ? 'BR' : selectedUF ?? 'BR'} onSelectCandidate={onSelectCandidate} />
          {!waitingForCount && result.validVotes !== null && <div className="valid-votes"><span>Votos válidos</span><strong>{formatInteger(result.validVotes)}</strong></div>}
        </>
      ) : round === '2' && !roundTwoStarted ? (
        <EmptyResults officeLabel={officeLabel} officeCode={officeCode} national={!selectedUF} selectedUF={selectedUF} status="empty" message={message} round={round} roundTwoStarted={roundTwoStarted} />
      ) : national && !selectedUF && round === '2' && officeCode === '3' ? (
        <div className="state-leaders">
          <StatusPill status={leadersLoading ? 'loading' : leaders.size ? 'ok' : 'warning'} text={leadersLoading ? 'CONSULTANDO UFs' : `${leaders.size} UFs com disputa`} />
          <div className="empty-state empty-state--compact"><div className="empty-icon"><MapPin size={19} /></div><h3>Governador: resultados por UF</h3><p>O 2º turno ocorre no Acre, Amazonas, Espírito Santo, Rio Grande do Norte, Tocantins e Distrito Federal. Selecione uma dessas UFs para consultar a apuração local.</p></div>
          <div className="state-leader-list">{[...leaders.entries()].map(([uf, candidate]) => <div key={uf}><span>{uf}</span><strong>{formatCandidateLabel(candidate)}</strong><em>{formatPercent(candidate.percent)}</em></div>)}</div>
        </div>
      ) : national && !selectedUF && officeCode !== '1' ? (
        <div className="state-leaders">
          <StatusPill status={leadersLoading ? 'loading' : leaders.size ? 'ok' : 'warning'} text={leadersLoading ? 'CONSULTANDO UFs' : `${leaders.size} UFs com dados`} />
          <div className="empty-state empty-state--compact"><div className="empty-icon"><MapPin size={19} /></div><h3>Uma disputa em cada estado</h3><p>Os percentuais não são somados nacionalmente. Selecione uma UF para consultar candidaturas, votos e apuração de {officeLabel.toLowerCase()}.</p></div>
          <div className="state-leader-list">{[...leaders.entries()].slice(0, 8).map(([uf, candidate]) => <div key={uf}><span>{uf}</span><strong>{formatCandidateLabel(candidate)}</strong><em>{formatPercent(candidate.percent)}</em></div>)}</div>
        </div>
      ) : (
        <EmptyResults officeLabel={officeLabel} officeCode={officeCode} national={!selectedUF} selectedUF={selectedUF} status={status} message={message} round={round} roundTwoStarted={roundTwoStarted} />
      )}
      <div className="source-stamp"><ShieldCheck size={14} /><span>Dados assinados pelo TSE</span><a href={TSE_RESULTS_URL} target="_blank" rel="noreferrer" aria-label="Abrir o portal oficial do TSE"><ArrowUpRight size={14} /></a></div>
    </aside>
  );
}

function interleaveMunicipalitiesByUF(values: MunicipalityRef[]): MunicipalityRef[] {
  const groups = new Map<string, MunicipalityRef[]>();
  values.forEach((municipality) => {
    const group = groups.get(municipality.uf) ?? [];
    group.push(municipality);
    groups.set(municipality.uf, group);
  });
  const ordered: MunicipalityRef[] = [];
  for (let index = 0; ordered.length < values.length; index += 1) {
    let added = false;
    FEDERAL_UNITS.forEach((unit) => {
      const municipality = groups.get(unit.uf)?.[index];
      if (municipality) {
        ordered.push(municipality);
        added = true;
      }
    });
    if (!added) break;
  }
  return ordered;
}

export default function App() {
  const [officeCode, setOfficeCode] = useState('1');
  const [round, setRound] = useState<ElectionRound>('1');
  const [clock, setClock] = useState(Date.now());
  const [selectedUF, setSelectedUF] = useState<string | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<MunicipalityRef | null>(null);
  const [showAllMunicipalities, setShowAllMunicipalities] = useState(false);
  const [mapData, setMapData] = useState<FeatureCollection | null>(null);
  const [mapDataScope, setMapDataScope] = useState<{ selectedUF: string | null; showAllMunicipalities: boolean }>({ selectedUF: null, showAllMunicipalities: false });
  const [mapStatus, setMapStatus] = useState<LoadState>('loading');
  const [mapMessage, setMapMessage] = useState('');
  const [unitBoundaries, setUnitBoundaries] = useState<FeatureCollection | null>(null);
  const [result, setResult] = useState<ElectionResult | null>(null);
  const [resultStatus, setResultStatus] = useState<LoadState>('loading');
  const [resultMessage, setResultMessage] = useState('');
  const [municipalityIndex, setMunicipalityIndex] = useState<Map<string, MunicipalityRef> | null>(null);
  const [municipalityIndexRound, setMunicipalityIndexRound] = useState<ElectionRound | null>(null);
  const [municipalityIndexError, setMunicipalityIndexError] = useState('');
  const [municipalityIndexRetryKey, setMunicipalityIndexRetryKey] = useState(0);
  const [leaders, setLeaders] = useState<Map<string, ElectionCandidate[]>>(new Map());
  const [leadersLoading, setLeadersLoading] = useState(true);
  const [municipalityResults, setMunicipalityResults] = useState<Map<string, MunicipalityOverviewRow>>(new Map());
  const [municipalityProgress, setMunicipalityProgress] = useState({ loaded: 0, failed: 0, completed: 0, isLoading: false });
  const [refreshKey, setRefreshKey] = useState(0);
  const [municipalityRefreshKey, setMunicipalityRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [simulationActive, setSimulationActive] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const territoryRequestRef = useRef(0);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMapFullscreen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mapFullscreen]);

  useEffect(() => {
    if (round !== '2') return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [round]);

  const roundTwoStarted = round === '2' && clock >= ROUND_TWO_START;
  const isOfficialRealtime = round === '2' && roundTwoStarted;
  const office = OFFICE_OPTIONS.find((option) => option.code === officeCode) ?? OFFICE_OPTIONS[0];
  const national = !selectedUF;
  const officeLabel = officeCode === '7' && selectedUF === 'DF' ? 'Deputado distrital' : office.label;
  const currentUnit = selectedUF ? FEDERAL_UNITS.find((unit) => unit.uf === selectedUF) : undefined;
  const municipalityByIbge = useMemo(() => municipalityIndex ?? new Map<string, MunicipalityRef>(), [municipalityIndex]);
  const canUseSecondRound = officeCode === '1' || officeCode === '3';
  const needsMunicipalityData = Boolean(selectedUF) || showAllMunicipalities;

  const clearCurrentResult = useCallback(() => {
    setResult(null);
    setResultStatus('loading');
    setResultMessage('');
  }, []);

  const selectOffice = useCallback((nextOfficeCode: string) => {
    territoryRequestRef.current += 1;
    setSimulationActive(false);
    setSelectedCandidateId(null);
    clearCurrentResult();
    setOfficeCode(nextOfficeCode);
    setSelectedMunicipality(null);
    if (nextOfficeCode !== '1' && nextOfficeCode !== '3') setRound('1');
  }, [clearCurrentResult]);

  const selectRound = useCallback((nextRound: ElectionRound) => {
    if (nextRound === '2' && !canUseSecondRound) return;
    territoryRequestRef.current += 1;
    setSimulationActive(false);
    setSelectedCandidateId(null);
    clearCurrentResult();
    setRound(nextRound);
  }, [canUseSecondRound, clearCurrentResult]);

  useEffect(() => {
    let active = true;
    setMapStatus('loading');
    setMapMessage('');
    const request = selectedUF
      ? getMunicipalitiesMap(selectedUF)
      : showAllMunicipalities
        ? getAllMunicipalitiesMap()
        : getFederalUnitsMap();
    request.then((data) => {
      if (active) {
        setMapData(data);
        setMapDataScope({ selectedUF, showAllMunicipalities });
        setMapStatus(data.features.length ? 'ready' : 'empty');
      }
    }).catch((error: unknown) => {
      if (active) {
        setMapStatus('error');
        setMapMessage(error instanceof Error ? error.message : 'Falha ao carregar o mapa.');
      }
    });
    return () => { active = false; };
  }, [selectedUF, showAllMunicipalities]);

  useEffect(() => {
    let active = true;
    getFederalUnitsMap().then((data) => {
      if (active) setUnitBoundaries(data);
    }).catch(() => {
      if (active) setUnitBoundaries(null);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!needsMunicipalityData) {
      setMunicipalityIndex(null);
      setMunicipalityIndexRound(null);
      setMunicipalityIndexError('');
      setMunicipalityProgress({ loaded: 0, failed: 0, completed: 0, isLoading: false });
      return () => { active = false; };
    }
    if (round === '2' && !roundTwoStarted) {
      setMunicipalityIndex(null);
      setMunicipalityIndexRound(null);
      setMunicipalityIndexError('');
      setMunicipalityProgress({ loaded: 0, failed: 0, completed: 0, isLoading: false });
      return () => { active = false; };
    }
    let retryTimer: number | undefined;
    setMunicipalityIndexRound(null);
    setMunicipalityIndexError('');
    setMunicipalityProgress({ loaded: 0, failed: 0, completed: 0, isLoading: true });
    getMunicipalityIndex(round).then((index) => {
      if (active) {
        setMunicipalityIndex(index);
        setMunicipalityIndexRound(round);
        setMunicipalityIndexError('');
      }
    }).catch((error: unknown) => {
      if (active) {
        setMunicipalityIndex(null);
        setMunicipalityIndexRound(null);
        setMunicipalityIndexError(error instanceof Error ? error.message : 'Não foi possível carregar o cadastro do TSE.');
        setMunicipalityProgress({ loaded: 0, failed: 0, completed: 0, isLoading: false });
        retryTimer = window.setTimeout(() => {
          if (active) setMunicipalityIndexRetryKey((value) => value + 1);
        }, ROUND_TWO_LOCAL_POLL_MS);
      }
    });
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [needsMunicipalityData, round, roundTwoStarted, municipalityIndexRetryKey]);

  useEffect(() => {
    let active = true;
    if (round === '2' && !roundTwoStarted) {
      setResult(null);
      setResultStatus('empty');
      setResultMessage('A apuração oficial do segundo turno começa em 25/10/2026, às 17h (horário de Brasília).');
      setRefreshing(false);
      return () => { active = false; };
    }
    if (round === '2' && officeCode === '3' && selectedUF && !isGovernorRunoff(selectedUF)) {
      setResult(null);
      setResultStatus('empty');
      setResultMessage(`${selectedUF} não terá segundo turno para governador.`);
      setRefreshing(false);
      return () => { active = false; };
    }
    if (selectedMunicipality && !selectedMunicipality.tseCode) {
      setResult(null);
      setResultStatus('loading');
      setResultMessage('Identificando o código oficial deste município…');
      return () => { active = false; };
    }
    if (!selectedUF && officeCode !== '1') {
      setResult(null);
      setResultStatus('empty');
      setResultMessage(round === '2' && officeCode === '3' ? '' : 'Selecione uma UF para consultar esta disputa.');
      setRefreshing(false);
      return () => { active = false; };
    }
    setResult(null);
    setResultStatus('loading');
    setResultMessage('');
    getElectionResults({
      cargoCode: officeCode,
      uf: selectedUF ?? undefined,
      municipalityCode: selectedMunicipality?.tseCode,
      round,
    }).then((value) => {
      if (active) {
        setResult(value);
        setResultStatus(value.candidates.length ? 'ready' : 'empty');
        setRefreshing(false);
      }
    }).catch((error: unknown) => {
      if (active) {
        setResult(null);
        setResultStatus('error');
        setResultMessage(error instanceof Error ? error.message : 'Não foi possível consultar o TSE.');
        setRefreshing(false);
      }
    });
    return () => { active = false; };
  }, [officeCode, round, roundTwoStarted, selectedUF, selectedMunicipality, refreshKey]);

  useEffect(() => {
    if (selectedUF || (round === '2' && !roundTwoStarted)) {
      setLeaders(new Map());
      setLeadersLoading(false);
      return;
    }
    let active = true;
    let cursor = 0;
    const results = new Map<string, ElectionCandidate[]>();
    const units = round === '2' && officeCode === '3'
      ? FEDERAL_UNITS.filter((unit) => isGovernorRunoff(unit.uf))
      : FEDERAL_UNITS;
    setLeaders(new Map());
    setLeadersLoading(true);
    const workers = Array.from({ length: 5 }, async () => {
      while (active) {
        const index = cursor++;
        if (index >= units.length) return;
        const unit = units[index];
        try {
          const response = await getElectionResults({ cargoCode: officeCode, uf: unit.uf, round });
          const candidates = response.candidates.filter((candidate) => candidate.votes > 0);
          if (candidates.length && (response.countedSections ?? 0) > 0) results.set(unit.uf, candidates);
        } catch {
          // Uma UF indisponível não impede a consulta das demais.
        }
        if (active) setLeaders(new Map(results));
      }
    });
    Promise.all(workers).finally(() => { if (active) setLeadersLoading(false); });
    return () => { active = false; };
  }, [officeCode, round, roundTwoStarted, selectedUF, refreshKey]);

  const municipalityList = useMemo(() => {
    const all = [...municipalityByIbge.values()];
    return all
      .filter((municipality) => !selectedUF || municipality.uf === selectedUF)
      .sort((a, b) => a.uf.localeCompare(b.uf) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [municipalityByIbge, selectedUF]);

  useEffect(() => {
    const needsMunicipalities = showAllMunicipalities || Boolean(selectedUF);
    if (!needsMunicipalities || !municipalityIndex || municipalityIndexRound !== round) {
      if (!needsMunicipalities) {
        setMunicipalityResults(new Map());
        setMunicipalityProgress({ loaded: 0, failed: 0, completed: 0, isLoading: false });
      } else if (!municipalityIndex || municipalityIndexRound !== round) {
        setMunicipalityResults(new Map());
        setMunicipalityProgress({ loaded: 0, failed: 0, completed: 0, isLoading: round === '1' || roundTwoStarted });
      }
      return;
    }
    let active = true;
    const scope = [...municipalityIndex.values()]
      .filter((municipality) => !selectedUF || municipality.uf === selectedUF)
      .sort((a, b) => a.uf.localeCompare(b.uf) || a.name.localeCompare(b.name, 'pt-BR'));
    const results = new Map<string, MunicipalityOverviewRow>();
    const requestable: MunicipalityRef[] = [];
    let noRunoffCount = 0;
    for (const municipality of scope) {
      const noRunoff = round === '2' && officeCode === '3' && !isGovernorRunoff(municipality.uf);
      results.set(municipality.ibgeCode, { municipality, candidate: null, countedSections: null, status: noRunoff ? 'no-runoff' : 'loading' });
      if (noRunoff) noRunoffCount += 1;
      else requestable.push(municipality);
    }
    if (!selectedUF) {
      const interleaved = interleaveMunicipalitiesByUF(requestable);
      requestable.length = 0;
      requestable.push(...interleaved);
    }
    setMunicipalityResults(new Map(results));
    setMunicipalityProgress({ loaded: 0, failed: 0, completed: noRunoffCount, isLoading: false });
    if (round === '2' && !roundTwoStarted) return () => { active = false; };
    setMunicipalityProgress({ loaded: 0, failed: 0, completed: noRunoffCount, isLoading: requestable.length > 0 });

    let cursor = 0;
    let loaded = 0;
    let failed = 0;
    let completed = noRunoffCount;
    const publishProgress = () => {
      if (!active) return;
      setMunicipalityResults(new Map(results));
      setMunicipalityProgress({ loaded, failed, completed, isLoading: completed < scope.length });
    };
    const workers = Array.from({ length: Math.min(MUNICIPALITY_REQUEST_WORKERS, requestable.length) }, async () => {
      while (active) {
        const index = cursor++;
        if (index >= requestable.length) return;
        const municipality = requestable[index];
        try {
          const response = await getElectionResults({
            cargoCode: officeCode,
            uf: municipality.uf,
            municipalityCode: municipality.tseCode,
            round,
          });
          const candidate = response.candidates[0] ?? null;
          if (candidate) {
            results.set(municipality.ibgeCode, {
              municipality,
              candidate,
              candidates: response.candidates,
              countedSections: response.countedSections,
              status: 'ready',
            });
            loaded += 1;
          } else {
            results.set(municipality.ibgeCode, { municipality, candidate: null, countedSections: response.countedSections, status: 'error' });
            failed += 1;
          }
        } catch {
          results.set(municipality.ibgeCode, { municipality, candidate: null, countedSections: null, status: 'error' });
          failed += 1;
        }
        completed += 1;
        if (completed % MUNICIPALITY_PROGRESS_BATCH === 0 || completed === scope.length) publishProgress();
      }
    });
    Promise.all(workers).then(() => {
      if (active) {
        setMunicipalityResults(new Map(results));
        setMunicipalityProgress({ loaded, failed, completed, isLoading: false });
      }
    });
    return () => { active = false; };
  }, [showAllMunicipalities, municipalityIndex, municipalityIndexRound, selectedUF, officeCode, round, roundTwoStarted, municipalityRefreshKey]);

  useEffect(() => {
    if (round !== '2' || !roundTwoStarted || !liveUpdates) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setRefreshKey((value) => value + 1);
    }, ROUND_TWO_LOCAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [round, roundTwoStarted, liveUpdates]);

  useEffect(() => {
    if (round !== '2' || !roundTwoStarted || !liveUpdates) return;
    if (!showAllMunicipalities && !selectedUF) return;
    if (municipalityProgress.isLoading) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setMunicipalityRefreshKey((value) => value + 1);
    }, ROUND_TWO_CITIES_POLL_MS);
    return () => window.clearInterval(timer);
  }, [round, roundTwoStarted, showAllMunicipalities, selectedUF, municipalityProgress.isLoading, liveUpdates]);

  const municipalVoteShares = useMemo(() => {
    const resultMap = new Map<string, ElectionCandidate[]>();
    municipalityResults.forEach((row, ibgeCode) => {
      if (row.status === 'ready' && row.candidate && row.candidate.votes > 0 && (row.countedSections ?? 0) > 0) {
        resultMap.set(ibgeCode, row.candidates ?? [row.candidate]);
      }
    });
    return resultMap;
  }, [municipalityResults]);

  const summaryLeaders = useMemo(() => new Map([...leaders].map(([uf, candidates]) => [uf, candidates[0]]).filter((entry): entry is [string, ElectionCandidate] => Boolean(entry[1]))), [leaders]);

  const getFeatureKey = useCallback((feature: GeoFeature) => {
    if (!mapDataScope.selectedUF && !mapDataScope.showAllMunicipalities) return unitFromFeature(feature)?.uf ?? getIbgeAreaCode(feature);
    return getIbgeAreaCode(feature).padStart(7, '0');
  }, [mapDataScope]);

  const getFeatureLabel = useCallback((feature: GeoFeature) => {
    if (!mapDataScope.selectedUF && !mapDataScope.showAllMunicipalities) return unitFromFeature(feature)?.name ?? 'Unidade da Federação';
    const code = getIbgeAreaCode(feature).padStart(7, '0');
    return municipalityByIbge.get(code)?.name ?? String(feature.properties.nome ?? feature.properties.nm ?? `Município ${code}`);
  }, [mapDataScope, municipalityByIbge]);

  const handleMapSelect = useCallback(async (feature: GeoFeature) => {
    if (!selectedUF && !showAllMunicipalities) {
      territoryRequestRef.current += 1;
      const unit = unitFromFeature(feature);
      if (unit) {
        setSimulationActive(false);
        setSelectedCandidateId(null);
        setOfficeCode('1');
        setSelectedUF(unit.uf);
        setSelectedMunicipality(null);
        setShowAllMunicipalities(false);
        clearCurrentResult();
      }
      return;
    }
    const ibgeCode = getIbgeAreaCode(feature).padStart(7, '0');
    if (selectedMunicipality?.ibgeCode === ibgeCode) return;
    const requestId = ++territoryRequestRef.current;
    let reference = municipalityByIbge.get(ibgeCode);
    if (!reference) {
      const unit = FEDERAL_UNITS.find((candidate) => candidate.ibgeCode === ibgeCode.slice(0, 2));
      if (!unit) {
        clearCurrentResult();
        setResultStatus('error');
        setResultMessage('Não foi possível identificar a UF desta geometria municipal.');
        return;
      }
      reference = { ibgeCode, tseCode: '', name: getFeatureLabel(feature), uf: unit.uf };
    }

    setSimulationActive(false);
    setSelectedCandidateId(null);
    setSelectedUF(reference.uf);
    setSelectedMunicipality(reference);
    setShowAllMunicipalities(false);
    clearCurrentResult();

    if (!reference.tseCode) {
      try {
        const index = await getMunicipalityIndex(round);
        if (territoryRequestRef.current !== requestId) return;
        setMunicipalityIndex(index);
        setMunicipalityIndexRound(round);
        reference = index.get(ibgeCode);
        if (!reference) throw new Error('O cadastro do TSE não contém o código deste município.');
        setSelectedMunicipality(reference);
      } catch {
        if (territoryRequestRef.current !== requestId) return;
        setResultStatus('error');
        setResultMessage('O TSE não disponibilizou o vínculo de códigos municipais neste momento.');
      }
    }
  }, [clearCurrentResult, getFeatureLabel, municipalityByIbge, selectedMunicipality, selectedUF, showAllMunicipalities, round]);

  const refresh = () => {
    if (round === '2' && !roundTwoStarted) return;
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
    if (showAllMunicipalities || selectedUF) setMunicipalityRefreshKey((value) => value + 1);
  };
  const returnToCountry = () => {
    territoryRequestRef.current += 1;
    setSimulationActive(false);
    setSelectedCandidateId(null);
    setSelectedUF(null);
    setSelectedMunicipality(null);
    setShowAllMunicipalities(false);
    clearCurrentResult();
  };
  const returnToState = () => {
    territoryRequestRef.current += 1;
    setSimulationActive(false);
    setSelectedCandidateId(null);
    setSelectedMunicipality(null);
    setShowAllMunicipalities(false);
    clearCurrentResult();
  };
  const goBack = () => {
    if (selectedMunicipality) returnToState();
    else if (selectedUF) returnToCountry();
  };
  const regionLabel = showAllMunicipalities && !selectedUF ? 'Brasil · municípios' : selectedMunicipality?.name ?? currentUnit?.name ?? 'Brasil';

  const legendCandidates = useMemo(() => {
    const candidates: ElectionCandidate[] = showAllMunicipalities || selectedUF
      ? [...municipalityResults.values()].filter((row) => row.candidate && row.status === 'ready' && row.candidate.votes > 0).map((row) => row.candidate as ElectionCandidate)
      : [...summaryLeaders.values()];
    const counts = new Map<string, { candidate: ElectionCandidate; count: number }>();
    candidates.forEach((candidate) => {
      const entry = counts.get(candidate.id);
      if (entry) entry.count += 1;
      else counts.set(candidate.id, { candidate, count: 1 });
    });
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  }, [summaryLeaders, municipalityResults, selectedUF, showAllMunicipalities]);

  const showCityMode = () => {
    territoryRequestRef.current += 1;
    setSimulationActive(false);
    setSelectedCandidateId(null);
    setShowAllMunicipalities((value) => !value);
    setSelectedMunicipality(null);
  };
  const cityWinners = selectedUF || showAllMunicipalities;
  const simulationVisible = simulationActive && round === '1';
  const focusedCandidate = result?.candidates.find((candidate) => candidate.id === selectedCandidateId);
  const candidateFocusReady = cityWinners
    ? Boolean(municipalityIndexError) || (municipalityIndexRound === round && (municipalityProgress.loaded + municipalityProgress.failed >= MUNICIPALITY_PROGRESS_BATCH || !municipalityProgress.isLoading))
    : !leadersLoading;
  const handleCandidateSelection = useCallback((candidate: ElectionCandidate) => {
    setSelectedCandidateId((current) => current === candidate.id ? null : candidate.id);
    if (!window.matchMedia('(max-width: 790px)').matches) return;
    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      mapPanelRef.current?.scrollIntoView({ behavior, block: 'start' });
    });
  }, []);
  const mapDescription = focusedCandidate
    ? `Foco automático em ${formatCandidateLabel(focusedCandidate)}. As UFs e cidades onde lidera ficam destacadas; selecione novamente para limpar o foco.`
    : simulationVisible
    ? municipalityProgress.isLoading
      ? `SIMULAÇÃO — resultados oficiais do 1º turno chegando em lotes; ${formatInteger(municipalityProgress.completed)} de ${formatInteger(municipalityList.length || mapData?.features.length || 5571)} municípios carregados. Nenhum voto é inventado.`
      : 'SIMULAÇÃO — resultados oficiais já publicados do 1º turno; a ordem de carregamento é demonstrativa, não ao vivo.'
    : showAllMunicipalities
      ? 'A cor identifica o candidato vencedor em cada município; tons mais escuros indicam uma vantagem maior sobre o segundo colocado. Selecione uma cidade para abrir a votação nominal.'
      : selectedUF
        ? municipalityProgress.isLoading
          ? `Resultados municipais carregados progressivamente: ${formatInteger(municipalityProgress.completed)} de ${formatInteger(municipalityList.length)}.`
          : 'A cor identifica o candidato vencedor; tons mais escuros indicam maior vantagem sobre o segundo colocado. Selecione uma cidade para detalhar a votação nominal.'
        : 'Cada UF recebe a cor do candidato mais votado. Selecione um estado para abrir o mapa municipal ou veja todas as cidades.';
  const mapLegendMessage = simulationVisible
    ? 'Simulação progressiva · dados oficiais do TSE'
    : round === '2' && !roundTwoStarted
      ? 'Apuração começa em 25/10 · 17h'
      : showAllMunicipalities
        ? 'Aguardando resultados municipais'
        : selectedUF
          ? municipalityIndexError
            ? 'Cadastro municipal do TSE indisponível'
            : municipalityProgress.isLoading
              ? 'Carregando resultados municipais'
              : 'Aguardando resultados municipais'
          : 'Vencedores por UF';
  const marginLegendCandidates: Array<{ id: string; label: string; color: string }> = officeCode === '1'
    ? PRESIDENT_MARGIN_LEGEND.map((entry) => {
      const candidate = result?.candidates.find((item) => getCandidateColor(item).toUpperCase() === entry.color);
      return { ...entry, id: candidate?.id ?? entry.id, label: candidate ? formatCandidateLabel(candidate) : entry.label };
    })
    : legendCandidates.slice(0, 2).map(({ candidate }) => ({ id: candidate.id, label: formatCandidateLabel(candidate), color: getCandidateColor(candidate) }));
  const realtimeActive = isOfficialRealtime ? liveUpdates : simulationVisible;
  const realtimeDisabled = round === '2' && !roundTwoStarted;
  const realtimeLabel = isOfficialRealtime
    ? liveUpdates ? 'Ao vivo' : 'Retomar ao vivo'
    : 'Ao vivo';
  const realtimeTitle = realtimeDisabled
    ? 'A demonstração usa os dados do 1º turno; selecione 1º turno. A apuração oficial do 2º turno começa em 25/10.'
    : isOfficialRealtime
      ? liveUpdates ? 'Pausar atualizações oficiais do TSE' : 'Retomar atualizações oficiais do TSE'
      : simulationVisible
        ? 'Encerrar a demonstração. Os resultados são oficiais, mas a sequência de chegada não é ao vivo.'
        : 'Simular o carregamento progressivo dos resultados oficiais já publicados; nenhum voto será inventado.';
  const toggleRealtime = () => {
    if (realtimeDisabled) return;
    if (isOfficialRealtime) {
      setLiveUpdates((value) => !value);
      return;
    }
    if (simulationVisible) {
      territoryRequestRef.current += 1;
      setSimulationActive(false);
      setSelectedCandidateId(null);
      setShowAllMunicipalities(false);
      setSelectedMunicipality(null);
      return;
    }
    territoryRequestRef.current += 1;
    setSimulationActive(true);
    setSelectedCandidateId(null);
    setSelectedMunicipality(null);
    setShowAllMunicipalities(true);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); returnToCountry(); }} aria-label="Apura, início">
          <img src="/logo.svg" alt="" className="brand-mark" />
          <span className="brand-word">apura<span>.</span></span>
          <span className="brand-divider" />
          <span className="brand-context">OBSERVATÓRIO ELEITORAL<br /><b>BRASIL · 2026</b></span>
        </a>
        <div className="topbar-right"><span className="topbar-label"><span className="live-dot" /> {isOfficialRealtime ? liveUpdates ? 'AO VIVO · TSE' : 'TSE · PAUSADO' : round === '2' ? '2º TURNO · 25 OUT' : simulationVisible ? 'SIMULAÇÃO · DADOS TSE' : 'DADOS ABERTOS'}</span><a className="topbar-link" href={TSE_RESULTS_URL} target="_blank" rel="noreferrer">Portal do TSE <ArrowUpRight size={14} /></a></div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> ELEIÇÕES GERAIS · {round === '1' ? 'PRIMEIRO' : 'SEGUNDO'} TURNO</p>
            <h1>A eleição,<br /><em>território por território.</em></h1>
            <p className="hero-description">Explore os resultados oficiais de 2026 do Brasil à sua cidade — agora com navegação livre pelo mapa.</p>
          </div>
          <div className="hero-status">
            <div className="hero-status-kicker"><Activity size={14} /> CENTRAL DE APURAÇÃO</div>
            <div className="hero-status-main"><span className="hero-status-number">{round === '1' ? '01' : '02'}</span><div><strong>{round === '1' ? '1º turno' : '2º turno'}</strong><span>{round === '1' ? '04 OUT 2026' : '25 OUT 2026 · 17H'}</span></div></div>
            <div className="hero-status-foot"><StatusPill status={round === '2' && !roundTwoStarted ? 'warning' : 'ok'} text={round === '2' && !roundTwoStarted ? 'AGUARDANDO APURAÇÃO' : round === '2' ? 'DADOS DO TSE · ATUALIZAÇÃO AUTOMÁTICA' : 'DADOS OFICIAIS DISPONÍVEIS'} /><span>{simulationVisible ? 'Simulação · dados oficiais' : round === '1' ? '2º turno · 25 out' : roundTwoStarted ? showAllMunicipalities ? 'Cidades · lote progressivo' : 'Consulta local · 30s' : 'Início · 17h BRT'}</span></div>
          </div>
        </section>

        <section className={`notice-bar${round === '2' ? ' notice-bar--round-two' : simulationVisible ? ' notice-bar--simulation' : ''}`} aria-label="Status dos resultados">
          <span className="notice-icon"><Info size={16} /></span>
          {simulationVisible
            ? <p><strong>Simulação de carregamento, não de votos.</strong> A lista e o mapa mostram progressivamente resultados oficiais já publicados do 1º turno; nenhum voto é inventado e esta sequência não é transmissão ao vivo.</p>
            : round === '1'
              ? <p><strong>Fonte oficial do TSE.</strong> Resultados do 1º turno de 2026. O 2º turno será acompanhado automaticamente a partir de 25 de outubro, às 17h (horário de Brasília).</p>
              : roundTwoStarted
                ? <p><strong>2º turno em acompanhamento.</strong> A consulta da localidade é atualizada a cada 30 segundos; o mapa completo por municípios é recarregado em lotes progressivos, respeitando o limite do TSE.</p>
                : <p><strong>2º turno previsto para 25/10, às 17h (Brasília).</strong> A apuração ainda não começou; arquivos zerados do TSE não são mostrados como votos apurados. O acompanhamento automático começará no horário oficial.</p>}
          <a href={TSE_OPEN_DATA_URL} target="_blank" rel="noreferrer">Dados abertos <ArrowUpRight size={14} /></a>
        </section>

        <section className="control-row">
          <div className="breadcrumbs" aria-label="Navegação territorial">
            <button type="button" className={!selectedUF ? 'crumb is-current' : 'crumb'} onClick={returnToCountry}>Brasil</button>
            {currentUnit && <><ChevronRight size={13} /><button type="button" className={!selectedMunicipality && !showAllMunicipalities ? 'crumb is-current' : 'crumb'} onClick={returnToState}>{currentUnit.uf}</button></>}
            {showAllMunicipalities && <><ChevronRight size={13} /><span className="crumb is-current">Municípios</span></>}
            {selectedMunicipality && <><ChevronRight size={13} /><span className="crumb is-current">{selectedMunicipality.name}</span></>}
          </div>
        </section>

        <section className={`workspace${mapFullscreen ? ' workspace--fullscreen' : ''}`} aria-label="Mapa e apuração eleitoral">
          <div className="map-panel" ref={mapPanelRef}>
            <div className="map-panel-heading">
              <div><div className="map-title-line"><MapPin size={16} /><h2>{regionLabel}</h2>{selectedUF && <span className="unit-chip">{selectedUF}</span>}</div><p>{mapDescription}</p></div>
              <div className="map-control">
                <span className="map-scale-label">{showAllMunicipalities ? `${formatInteger(mapData?.features.length ?? 5571)} CIDADES` : selectedUF ? `${formatInteger(mapData?.features.length ?? 0)} MUNICÍPIOS` : '27 UFs · INCLUI DF'}</span>
                {!selectedUF && <label className="map-uf-select-label" htmlFor="map-uf-select">UF
                  <select id="map-uf-select" value="" onChange={(event) => {
                    const uf = event.target.value;
                    if (!uf) return;
                    territoryRequestRef.current += 1;
                    setSimulationActive(false);
                    setSelectedCandidateId(null);
                    setOfficeCode('1');
                    clearCurrentResult();
                    setSelectedUF(uf);
                    setSelectedMunicipality(null);
                    setShowAllMunicipalities(false);
                  }} aria-label="Selecionar uma UF para ver a votação nominal">
                    <option value="">Escolher…</option>
                    {FEDERAL_UNITS.map((unit) => <option key={unit.uf} value={unit.uf}>{unit.uf}</option>)}
                  </select><ChevronDown size={12} aria-hidden="true" />
                </label>}
                <button type="button" className={`map-mode-toggle${showAllMunicipalities ? ' is-active' : ''}`} onClick={showCityMode} aria-pressed={showAllMunicipalities} title={showAllMunicipalities ? 'Voltar à visualização territorial' : selectedUF ? 'Ver resultados de todos os municípios desta UF' : 'Ver resultados de todos os municípios do Brasil'}><Layers3 size={14} /><span>{showAllMunicipalities ? 'Mapa por UF' : selectedUF ? 'Resultados municipais' : 'Todas as cidades'}</span></button>
                <button type="button" className={`live-toggle${realtimeActive ? ' is-active' : ''}`} onClick={toggleRealtime} aria-pressed={realtimeActive} title={realtimeTitle} disabled={realtimeDisabled}>
                  {isOfficialRealtime && liveUpdates ? <Radio size={14} /> : simulationVisible ? <Activity size={14} /> : <Play size={14} />}<span>{realtimeLabel}</span>{isOfficialRealtime && liveUpdates ? <i aria-hidden="true" /> : simulationVisible ? <Pause size={12} /> : null}
                </button>
                <button type="button" className="map-fullscreen-toggle" onClick={() => setMapFullscreen((value) => !value)} aria-label={mapFullscreen ? 'Sair da tela inteira' : 'Expandir mapa e apuração para tela inteira'} aria-pressed={mapFullscreen} title={mapFullscreen ? 'Sair da tela inteira (Esc)' : 'Expandir mapa e apuração para tela inteira'}>
                  {mapFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}<span>{mapFullscreen ? 'Fechar' : 'Tela inteira'}</span>
                </button>
              </div>
            </div>
            <div className={`map-stage${mapStatus === 'loading' ? ' map-stage--loading' : ''}`}>
              {mapData && (mapStatus === 'ready' || mapStatus === 'loading') ? (
                <>
                <BrazilMap
                  data={mapData}
                  level={mapDataScope.selectedUF || mapDataScope.showAllMunicipalities ? 'municipality' : 'state'}
                  getKey={getFeatureKey}
                  getLabel={getFeatureLabel}
                  voteShares={mapDataScope.selectedUF || mapDataScope.showAllMunicipalities ? municipalVoteShares : leaders}
                  unitBoundaries={unitBoundaries}
                  selectedUF={mapDataScope.selectedUF}
                  candidatePhotoRegion={officeCode === '1' ? 'BR' : null}
                  selectedCandidateId={selectedCandidateId}
                  selectedCandidate={focusedCandidate}
                  candidateFocusReady={candidateFocusReady}
                  suspended={mapStatus === 'loading'}
                  selectedKey={mapDataScope.selectedUF && selectedMunicipality?.uf === mapDataScope.selectedUF ? selectedMunicipality.ibgeCode : undefined}
                  onSelect={handleMapSelect}
                  onSelectUF={(uf) => {
                    territoryRequestRef.current += 1;
                    setSimulationActive(false);
                    setSelectedCandidateId(null);
                    setOfficeCode('1');
                    clearCurrentResult();
                    setSelectedUF(uf);
                    setSelectedMunicipality(null);
                    setShowAllMunicipalities(false);
                  }}
                />
                <div className={`map-loading-overlay${mapStatus === 'loading' ? ' is-active' : ''}`} role="status" aria-live="polite" aria-hidden={mapStatus !== 'loading'}>
                  {mapStatus === 'loading' && <><LoaderCircle size={16} className="spin" /><span>Atualizando malha para {regionLabel}…</span></>}
                </div>
                </>
              ) : <div className="map-placeholder">{mapStatus === 'loading' ? <><LoaderCircle size={24} className="spin" /><span>Carregando malha oficial do IBGE…</span></> : <><Info size={20} /><span>{mapMessage || 'Não foi possível carregar o mapa.'}</span></>}</div>}
            </div>
            <div className={`map-footer${cityWinners ? ' map-footer--scale' : ''}`}>
              {cityWinners ? <div className="margin-legend" aria-label="Legenda de diferença em pontos percentuais">
                <div className="margin-legend-copy">
                  <strong>Diferença em pontos percentuais</strong>
                  <p>O mapa mostra a cor do partido do candidato vencedor em cada município. Quanto mais escura a cor, maior a vantagem do primeiro colocado.</p>
                </div>
                <div className="margin-legend-table" role="table" aria-label="Faixas de vantagem do candidato vencedor">
                  <div className="margin-legend-grid" role="row">
                    <span className="margin-legend-heading" role="columnheader">CANDIDATO</span>
                    {MARGIN_LEGEND_BANDS.map(({ band, label }) => <span className="margin-legend-heading" role="columnheader" key={band}>{label}</span>)}
                  </div>
                  {marginLegendCandidates.map((candidate) => <div className="margin-legend-grid" role="row" key={candidate.id}>
                    <span className="margin-legend-candidate" role="rowheader" title={candidate.label}>{candidate.label}</span>
                    {MARGIN_LEGEND_BANDS.map(({ band, label }) => {
                      const color = getCandidateColorForMargin(candidate.color, band);
                      return <span className="margin-legend-swatch" role="cell" key={`${candidate.id}-${band}`} style={{ backgroundColor: color }} title={`${candidate.label} · ${label} · ${color}`} aria-label={`${candidate.label}, ${label}, ${color}`} />;
                    })}
                  </div>)}
                  {!marginLegendCandidates.length && <div className="margin-legend-empty">Aguardando os candidatos líderes publicados pelo TSE.</div>}
                </div>
              </div> : <div className="map-legend">
                {legendCandidates.length ? (
                  <>
                    <span className="legend-label">{showAllMunicipalities || selectedUF ? 'CANDIDATOS' : 'VENCEDORES'}</span>
                    <div className="map-legend-items">
                      {legendCandidates.map(({ candidate }) => <span className="map-legend-item" key={candidate.id} title={formatCandidateLabel(candidate)}><i style={{ backgroundColor: getCandidateColor(candidate) }} /><span className="map-legend-candidate-copy"><span className="map-legend-candidate-name">{candidate.ballotName}</span>{candidate.number && <span className="map-legend-candidate-number">- {candidate.number}</span>}{candidate.party.trim() && <span className="map-legend-party">{candidate.party.trim().toLocaleUpperCase('pt-BR')}</span>}</span></span>)}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="legend-swatch" />
                    <span>{mapLegendMessage}</span>
                  </>
                )}
              </div>}
              <div className="map-source"><Database size={13} /> MALHA: IBGE · 2025{(leadersLoading || municipalityProgress.isLoading) && <span className="loading-tiny"><LoaderCircle size={12} className="spin" /> {selectedUF && municipalityList.length ? `${formatInteger(municipalityProgress.completed)}/${formatInteger(municipalityList.length)}` : 'TSE'}</span>}</div>
            </div>
          </div>

          {showAllMunicipalities ? (
            <MunicipalityResultsPanel
              rows={municipalityList.map((municipality) => municipalityResults.get(municipality.ibgeCode) ?? { municipality, candidate: null, countedSections: null, status: 'loading' as const })}
              loaded={municipalityProgress.loaded}
              failed={municipalityProgress.failed}
              completed={municipalityProgress.completed}
              isLoading={municipalityProgress.isLoading}
              simulationActive={simulationVisible}
              indexLoading={showAllMunicipalities && municipalityIndexRound !== round && !municipalityIndexError}
              indexError={municipalityIndexError}
              expectedTotal={municipalityList.length || mapData?.features.length || (!selectedUF ? 5571 : 0)}
              round={round}
              roundTwoStarted={roundTwoStarted}
              officeCode={officeCode}
              canUseSecondRound={canUseSecondRound}
              onOfficeChange={selectOffice}
              onRoundChange={selectRound}
              onSelect={(municipality) => {
                territoryRequestRef.current += 1;
                setSimulationActive(false);
                setSelectedCandidateId(null);
                clearCurrentResult();
                setSelectedUF(municipality.uf);
                setSelectedMunicipality(municipality);
                setShowAllMunicipalities(false);
              }}
            />
          ) : (
            <SummaryPanel
              result={result}
              status={resultStatus}
              message={resultMessage}
              officeLabel={officeLabel}
              officeCode={officeCode}
              round={round}
              roundTwoStarted={roundTwoStarted}
              canUseSecondRound={canUseSecondRound}
              simulationActive={simulationVisible}
              national={national}
              selectedUF={selectedUF}
              selectedMunicipality={selectedMunicipality}
              leaders={summaryLeaders}
              leadersLoading={leadersLoading}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={handleCandidateSelection}
              onBack={goBack}
              onRefresh={refresh}
              refreshing={refreshing || resultStatus === 'loading'}
              onSelectOffice={selectOffice}
              onSelectRound={selectRound}
            />
          )}
        </section>

        <section className="bottom-strip">
          <div className="bottom-source"><ShieldCheck size={15} /><span>Resultados assinados digitalmente pelo Tribunal Superior Eleitoral</span><span className="source-separator">/</span><span>Malhas territoriais do IBGE</span></div>
          <div className="bottom-links"><a href={TSE_OPEN_DATA_URL} target="_blank" rel="noreferrer">Portal de dados abertos <ArrowUpRight size={12} /></a><span>APURA · 2026</span></div>
        </section>
      </main>
    </div>
  );
}
