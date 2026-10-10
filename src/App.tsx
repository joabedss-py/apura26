import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Clock3, Database, ExternalLink, Info, LoaderCircle, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import BrazilMap from './components/BrazilMap';
import { FEDERAL_UNITS, OFFICE_OPTIONS, findUnitByCode } from './data/states';
import { getFederalUnitsMap, getIbgeAreaCode, getMunicipalitiesMap } from './services/ibge';
import { getElectionResults, getMunicipalityIndex } from './services/tse';
import type { ElectionCandidate, ElectionResult, FeatureCollection, GeoFeature, LoadState, MunicipalityRef } from './types';
import { getCandidateColor } from './services/colors';

const TSE_RESULTS_URL = 'https://resultados.tse.jus.br/oficial/app/index.html';
const TSE_OPEN_DATA_URL = 'https://dadosabertos.tse.jus.br/dataset/resultados-2026';
const UF_BY_IBGE = new Map(FEDERAL_UNITS.map((unit) => [unit.ibgeCode, unit]));

function formatInteger(value?: number | null): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(value);
}

function formatPercent(value?: number | null): string {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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

function EmptyResults({ officeLabel, national, status, message }: { officeLabel: string; national: boolean; status: LoadState; message?: string }) {
  if (!national && status === 'empty') {
    return <div className="empty-state"><div className="empty-icon"><MapPin size={19} /></div><p className="eyebrow">DISPUTA ESTADUAL</p><h3>Escolha uma UF no mapa</h3><p>A votação de {officeLabel.toLowerCase()} é contabilizada separadamente em cada estado. Selecione um estado para ver candidaturas e votos oficiais.</p></div>;
  }
  if (status === 'loading') {
    return <div className="loading-state"><LoaderCircle className="spin" size={23} /><span>Consultando dados assinados do TSE…</span></div>;
  }
  if (status === 'error') {
    return <div className="empty-state empty-state--error"><div className="empty-icon"><Info size={19} /></div><p className="eyebrow">FONTE TEMPORARIAMENTE INDISPONÍVEL</p><h3>Não foi possível carregar a apuração</h3><p>{message ?? 'Tente novamente. Os resultados são consultados diretamente na fonte oficial.'}</p><a href={TSE_RESULTS_URL} target="_blank" rel="noreferrer">Abrir Resultados do TSE <ExternalLink size={13} /></a></div>;
  }
  return <div className="empty-state"><div className="empty-icon"><Clock3 size={19} /></div><p className="eyebrow">SEM RESULTADO PUBLICADO</p><h3>O TSE ainda não disponibilizou esta consulta</h3><p>Este painel não preenche lacunas com dados ilustrativos. Consulte novamente ou abra a fonte oficial.</p></div>;
}

function CandidateList({ result }: { result: ElectionResult }) {
  if (!result.candidates.length) {
    return <EmptyResults officeLabel={result.cargoName} national={false} status="empty" />;
  }
  const maximum = Math.max(1, result.candidates[0]?.votes ?? 0);
  return (
    <div className="candidate-list">
      {result.candidates.map((candidate, index) => (
        <CandidateRow key={candidate.id} candidate={candidate} index={index} maximum={maximum} />
      ))}
    </div>
  );
}

function CandidateRow({ candidate, index, maximum }: { candidate: ElectionCandidate; index: number; maximum: number }) {
  const color = getCandidateColor(candidate);
  return (
    <article className={`candidate-row${index === 0 ? ' candidate-row--leader' : ''}`}>
      <div className="candidate-rank" style={{ color }}>{String(index + 1).padStart(2, '0')}</div>
      <div className="candidate-main">
        <div className="candidate-name-line"><span className="candidate-color-dot" style={{ backgroundColor: color }} aria-hidden="true" /><strong>{candidate.ballotName}</strong><span className="party-tag">{candidate.party || `Nº ${candidate.number}`}</span></div>
        <div className="candidate-meter"><span style={{ width: `${Math.max(0, Math.min(100, candidate.votes / maximum * 100))}%`, backgroundColor: color }} /></div>
        <div className="candidate-foot"><span className="candidate-votes">{formatInteger(candidate.votes)} votos</span><span className="candidate-status">{candidate.status || 'Candidatura'}</span></div>
      </div>
      <div className="candidate-percent" style={{ color }}>{formatPercent(candidate.percent)}</div>
    </article>
  );
}

function SummaryPanel({
  result,
  status,
  message,
  officeLabel,
  national,
  selectedUF,
  selectedMunicipality,
  leaders,
  onRefresh,
  refreshing,
}: {
  result: ElectionResult | null;
  status: LoadState;
  message: string;
  officeLabel: string;
  national: boolean;
  selectedUF: string | null;
  selectedMunicipality: MunicipalityRef | null;
  leaders: Map<string, ElectionCandidate>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const areaTitle = selectedMunicipality?.name ?? (selectedUF ? FEDERAL_UNITS.find((unit) => unit.uf === selectedUF)?.name : 'Brasil');
  return (
    <aside className="results-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">APURAÇÃO OFICIAL</p><h2>{areaTitle ?? 'Brasil'}</h2><p className="panel-subtitle">{officeLabel} <span>·</span> 1º turno</p></div>
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="Atualizar resultados" title="Consultar o TSE novamente"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </div>
      {result ? (
        <>
          <div className="result-meta"><StatusPill status="ok" text="ASSINATURA TSE VERIFICADA" /><span>Atualizado {result.updatedDate || '—'}{result.updatedTime ? ` · ${result.updatedTime}` : ''}</span></div>
          <div className="stat-grid">
            <div className="stat-card"><span>Seções apuradas</span><strong>{formatInteger(result.countedSections)} <small>/ {formatInteger(result.totalSections)}</small></strong><div className="stat-progress"><span style={{ width: `${Math.max(0, Math.min(100, result.countedPercent ?? 0))}%` }} /></div><em>{formatPercent(result.countedPercent)} totalizado</em></div>
            <div className="stat-card"><span>Comparecimento</span><strong>{formatPercent(result.turnout)}</strong><em>Abstenção {formatPercent(result.abstention)}</em></div>
          </div>
          <div className="candidate-heading"><h3>Votação nominal</h3><span>{result.candidates.length} candidaturas</span></div>
          <CandidateList result={result} />
          {result.validVotes !== null && <div className="valid-votes"><span>Votos válidos</span><strong>{formatInteger(result.validVotes)}</strong></div>}
        </>
      ) : national && !selectedUF && officeLabel !== 'Presidente' ? (
        <div className="state-leaders">
          <StatusPill status={leaders.size ? 'ok' : 'loading'} text={leaders.size ? `${leaders.size} UFs com dados` : 'CONSULTANDO UFs'} />
          <div className="empty-state empty-state--compact"><div className="empty-icon"><MapPin size={19} /></div><h3>Uma disputa em cada estado</h3><p>Os percentuais não são somados nacionalmente. Selecione uma UF para consultar candidaturas, votos e apuração de {officeLabel.toLowerCase()}.</p></div>
          <div className="state-leader-list">{[...leaders.entries()].slice(0, 6).map(([uf, candidate]) => <div key={uf}><span>{uf}</span><strong>{candidate.ballotName}</strong><em>{formatPercent(candidate.percent)}</em></div>)}</div>
        </div>
      ) : <EmptyResults officeLabel={officeLabel} national={!selectedUF} status={status} message={message} />}
      <div className="source-stamp"><ShieldCheck size={14} /><span>Dados assinados pelo TSE</span><a href={TSE_RESULTS_URL} target="_blank" rel="noreferrer" aria-label="Abrir o portal oficial do TSE"><ArrowUpRight size={14} /></a></div>
    </aside>
  );
}

export default function App() {
  const [officeCode, setOfficeCode] = useState('1');
  const [selectedUF, setSelectedUF] = useState<string | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<MunicipalityRef | null>(null);
  const [mapData, setMapData] = useState<FeatureCollection | null>(null);
  const [mapStatus, setMapStatus] = useState<LoadState>('loading');
  const [result, setResult] = useState<ElectionResult | null>(null);
  const [resultStatus, setResultStatus] = useState<LoadState>('loading');
  const [resultMessage, setResultMessage] = useState('');
  const [municipalityIndex, setMunicipalityIndex] = useState<Map<string, MunicipalityRef> | null>(null);
  const [leaders, setLeaders] = useState<Map<string, ElectionCandidate>>(new Map());
  const [leadersLoading, setLeadersLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const office = OFFICE_OPTIONS.find((option) => option.code === officeCode) ?? OFFICE_OPTIONS[0];
  const national = !selectedUF;
  const officeLabel = office.label;
  const currentUnit = selectedUF ? FEDERAL_UNITS.find((unit) => unit.uf === selectedUF) : undefined;

  useEffect(() => {
    let active = true;
    setMapStatus('loading');
    setMapData(null);
    const request = selectedUF ? getMunicipalitiesMap(selectedUF) : getFederalUnitsMap();
    request.then((data) => {
      if (active) {
        setMapData(data);
        setMapStatus(data.features.length ? 'ready' : 'empty');
      }
    }).catch((error: unknown) => {
      if (active) {
        setMapStatus('error');
        setResultMessage(error instanceof Error ? error.message : 'Falha ao carregar o mapa.');
      }
    });
    return () => { active = false; };
  }, [selectedUF]);

  useEffect(() => {
    if (!selectedUF) {
      setMunicipalityIndex(null);
      return;
    }
    let active = true;
    getMunicipalityIndex().then((index) => {
      if (active) setMunicipalityIndex(index);
    }).catch(() => {
      if (active) setMunicipalityIndex(new Map());
    });
    return () => { active = false; };
  }, [selectedUF]);

  useEffect(() => {
    let active = true;
    if (!selectedUF && officeCode !== '1') {
      setResult(null);
      setResultStatus('empty');
      setResultMessage('Selecione uma UF para consultar esta disputa.');
      return () => { active = false; };
    }
    setResultStatus('loading');
    setResultMessage('');
    const request = getElectionResults({
      cargoCode: officeCode,
      uf: selectedUF ?? undefined,
      municipalityCode: selectedMunicipality?.tseCode,
    });
    request.then((value) => {
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
  }, [officeCode, selectedUF, selectedMunicipality, refreshKey]);

  useEffect(() => {
    if (selectedUF) {
      setLeaders(new Map());
      setLeadersLoading(false);
      return;
    }
    let active = true;
    let cursor = 0;
    const results = new Map<string, ElectionCandidate>();
    setLeaders(new Map());
    setLeadersLoading(true);
    const states = FEDERAL_UNITS;
    const workers = Array.from({ length: 5 }, async () => {
      while (active) {
        const index = cursor++;
        if (index >= states.length) return;
        const unit = states[index];
        try {
          const response = await getElectionResults({ cargoCode: officeCode, uf: unit.uf });
          if (response.candidates[0]) results.set(unit.uf, response.candidates[0]);
        } catch {
          // Uma UF indisponível não impede a consulta das demais.
        }
        if (active) setLeaders(new Map(results));
      }
    });
    Promise.all(workers).finally(() => { if (active) setLeadersLoading(false); });
    return () => { active = false; };
  }, [officeCode, selectedUF, refreshKey]);

  const municipalityByIbge = useMemo(() => municipalityIndex ?? new Map<string, MunicipalityRef>(), [municipalityIndex]);
  const getFeatureKey = useCallback((feature: GeoFeature) => {
    if (!selectedUF) return unitFromFeature(feature)?.uf ?? getIbgeAreaCode(feature);
    return getIbgeAreaCode(feature).padStart(7, '0');
  }, [selectedUF]);
  const getFeatureLabel = useCallback((feature: GeoFeature) => {
    if (!selectedUF) return unitFromFeature(feature)?.name ?? 'Unidade da Federação';
    const code = getIbgeAreaCode(feature).padStart(7, '0');
    return municipalityByIbge.get(code)?.name ?? String(feature.properties.nm ?? `Município ${code}`);
  }, [municipalityByIbge, selectedUF]);

  const handleMapSelect = useCallback(async (feature: GeoFeature) => {
    if (!selectedUF) {
      const unit = unitFromFeature(feature);
      if (unit) {
        setSelectedUF(unit.uf);
        setSelectedMunicipality(null);
        setResultMessage('');
      }
      return;
    }
    const ibgeCode = getIbgeAreaCode(feature).padStart(7, '0');
    let reference = municipalityByIbge.get(ibgeCode);
    if (!reference) {
      try {
        const index = await getMunicipalityIndex();
        setMunicipalityIndex(index);
        reference = index.get(ibgeCode);
      } catch {
        setResultMessage('O TSE não disponibilizou o vínculo de códigos municipais neste momento.');
      }
    }
    if (reference) {
      setSelectedMunicipality(reference);
      setResultMessage('');
    }
  }, [municipalityByIbge, selectedUF]);

  const refresh = () => {
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  };
  const returnToCountry = () => {
    setSelectedUF(null);
    setSelectedMunicipality(null);
    setResultStatus('loading');
    setResultMessage('');
  };
  const returnToState = () => {
    setSelectedMunicipality(null);
    setResultMessage('');
  };
  const regionLabel = selectedMunicipality?.name ?? currentUnit?.name ?? 'Brasil';
  const legendLeaders = useMemo(() => {
    const counts = new Map<string, { candidate: ElectionCandidate; count: number }>();
    leaders.forEach((candidate) => {
      const entry = counts.get(candidate.id);
      if (entry) entry.count += 1;
      else counts.set(candidate.id, { candidate, count: 1 });
    });
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  }, [leaders]);
  const showResultLoad = resultStatus === 'loading' || resultStatus === 'error';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); returnToCountry(); }} aria-label="Apura, início">
          <img src="/logo.svg" alt="" className="brand-mark" />
          <span className="brand-word">apura<span>.</span></span>
          <span className="brand-divider" />
          <span className="brand-context">OBSERVATÓRIO ELEITORAL<br /><b>BRASIL · 2026</b></span>
        </a>
        <div className="topbar-right"><span className="topbar-label"><span className="live-dot" /> DADOS ABERTOS</span><a className="topbar-link" href={TSE_RESULTS_URL} target="_blank" rel="noreferrer">Portal do TSE <ArrowUpRight size={14} /></a></div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> ELEIÇÕES GERAIS · PRIMEIRO TURNO</p>
            <h1>A eleição,<br /><em>território por território.</em></h1>
            <p className="hero-description">Explore os resultados oficiais de 2026 da escala nacional ao seu município.</p>
          </div>
          <div className="hero-status">
            <div className="hero-status-kicker"><Activity size={14} /> CENTRAL DE APURAÇÃO</div>
            <div className="hero-status-main"><span className="hero-status-number">01</span><div><strong>1º turno</strong><span>04 OUT 2026</span></div></div>
            <div className="hero-status-foot"><StatusPill status="ok" text="DADOS OFICIAIS DISPONÍVEIS" /><span>2º turno · 25 out</span></div>
          </div>
        </section>

        <section className="notice-bar" aria-label="Status dos resultados">
          <span className="notice-icon"><Info size={16} /></span>
          <p><strong>Fonte oficial do TSE.</strong> Os resultados exibidos são do 1º turno. O 2º turno está previsto para 25 de outubro e ainda não tem apuração publicada.</p>
          <a href={TSE_OPEN_DATA_URL} target="_blank" rel="noreferrer">Dados abertos <ArrowUpRight size={14} /></a>
        </section>

        <section className="control-row">
          <div className="breadcrumbs" aria-label="Navegação territorial">
            <button type="button" className={!selectedUF ? 'crumb is-current' : 'crumb'} onClick={returnToCountry}>Brasil</button>
            {currentUnit && <><ChevronRight size={13} /><button type="button" className={!selectedMunicipality ? 'crumb is-current' : 'crumb'} onClick={returnToState}>{currentUnit.uf}</button></>}
            {selectedMunicipality && <><ChevronRight size={13} /><span className="crumb is-current">{selectedMunicipality.name}</span></>}
          </div>
          <div className="filters">
            <label htmlFor="office-select">CARGO</label>
            <div className="select-wrap"><select id="office-select" value={officeCode} onChange={(event) => { setOfficeCode(event.target.value); setSelectedMunicipality(null); }}>
              {OFFICE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select><ChevronDown size={15} aria-hidden="true" /></div>
            <div className="round-switch"><span className="round-switch-active">1º</span><span className="round-switch-next" title="O segundo turno ainda não tem apuração publicada">2º <small>25 OUT</small></span></div>
          </div>
        </section>

        <section className="workspace">
          <div className="map-panel">
            <div className="map-panel-heading">
              <div><div className="map-title-line"><MapPin size={16} /><h2>{regionLabel}</h2>{selectedUF && <span className="unit-chip">{selectedUF}</span>}</div><p>{selectedUF ? 'Selecione um município para detalhar a votação.' : 'Selecione um estado para explorar os resultados locais.'}</p></div>
              <div className="map-control"><span className="map-scale-label">{selectedUF ? `${mapData?.features.length ?? '—'} MUNICÍPIOS` : '26 ESTADOS + DF'}</span><button type="button" className="map-back" onClick={selectedMunicipality ? returnToState : returnToCountry} title={selectedUF ? 'Voltar ao Brasil' : 'Brasil'} disabled={!selectedUF && !selectedMunicipality}>{selectedUF ? <ArrowLeft size={15} /> : <MapPin size={15} />}</button></div>
            </div>
            <div className={`map-stage${mapStatus === 'loading' ? ' map-stage--loading' : ''}`}>
              {mapData && mapStatus === 'ready' ? (
                <BrazilMap
                  data={mapData}
                  level={selectedUF ? 'municipality' : 'state'}
                  getKey={getFeatureKey}
                  getLabel={getFeatureLabel}
                  winners={selectedUF ? undefined : leaders}
                  selectedKey={selectedUF && selectedMunicipality ? selectedMunicipality.ibgeCode : undefined}
                  onSelect={handleMapSelect}
                />
              ) : <div className="map-placeholder">{mapStatus === 'loading' ? <><LoaderCircle size={24} className="spin" /><span>Carregando malha oficial do IBGE…</span></> : <><Info size={20} /><span>Não foi possível carregar o mapa.</span></>}</div>}
              {selectedUF && selectedMunicipality && <div className="map-selection"><span className="selection-pin"><MapPin size={14} /></span><div><strong>{selectedMunicipality.name}</strong><span>{selectedMunicipality.uf} · código TSE {selectedMunicipality.tseCode}</span></div></div>}
            </div>
            <div className="map-footer"><div className="map-legend">{selectedUF ? <><span className="legend-swatch" /><span>Municípios · clique para consultar</span></> : <><span className="legend-label">LÍDER POR UF</span><div className="map-legend-items">{legendLeaders.map(({ candidate }) => <span className="map-legend-item" key={candidate.id} title={candidate.ballotName}><i style={{ backgroundColor: getCandidateColor(candidate) }} />{candidate.ballotName}</span>)}</div></>}</div><div className="map-source"><Database size={13} /> MALHA: IBGE{leadersLoading && !selectedUF ? <span className="loading-tiny"><LoaderCircle size={12} className="spin" /> TSE</span> : null}</div></div>
          </div>

          <SummaryPanel result={result} status={resultStatus} message={resultMessage} officeLabel={officeLabel} national={national} selectedUF={selectedUF} selectedMunicipality={selectedMunicipality} leaders={leaders} onRefresh={refresh} refreshing={refreshing || showResultLoad} />
        </section>

        <section className="bottom-strip">
          <div className="bottom-source"><ShieldCheck size={15} /><span>Resultados assinados digitalmente pelo Tribunal Superior Eleitoral</span><span className="source-separator">/</span><span>Malhas territoriais do IBGE</span></div>
          <div className="bottom-links"><a href={TSE_OPEN_DATA_URL} target="_blank" rel="noreferrer">Portal de dados abertos <ArrowUpRight size={12} /></a><span>APURA · 2026</span></div>
        </section>
      </main>
    </div>
  );
}
