import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import type { ElectionRound, MunicipalityOverviewRow, MunicipalityRef } from '../types';
import { getCandidateColor } from '../services/colors';
import { formatCandidateSuffix } from '../services/candidate-identity';

const PAGE_SIZE = 40;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatPercent(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

interface MunicipalityResultsPanelProps {
  rows: MunicipalityOverviewRow[];
  loaded: number;
  failed: number;
  completed: number;
  isLoading: boolean;
  simulationActive: boolean;
  indexLoading: boolean;
  indexError: string;
  expectedTotal: number;
  round: ElectionRound;
  roundTwoStarted: boolean;
  onSelect: (municipality: MunicipalityRef) => void;
}

export default function MunicipalityResultsPanel({
  rows,
  loaded,
  failed,
  completed,
  isLoading,
  simulationActive,
  indexLoading,
  indexError,
  expectedTotal,
  round,
  roundTwoStarted,
  onSelect,
}: MunicipalityResultsPanelProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filteredRows = useMemo(() => {
    const search = normalize(query.trim());
    if (!search) return rows;
    return rows.filter((row) => normalize(`${row.municipality.name} ${row.municipality.uf} ${row.candidate?.ballotName ?? ''}`).includes(search));
  }, [query, rows]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const totalCount = rows.length || expectedTotal;
  const progress = totalCount ? Math.round(completed / totalCount * 100) : 0;

  return (
    <aside className="results-panel city-results-panel">
      <div className="panel-heading city-panel-heading">
        <div><p className="eyebrow">RESULTADOS POR MUNICÍPIO</p><h2>{formatInteger(totalCount)} cidades</h2><p className="panel-subtitle">{simulationActive ? 'SIMULAÇÃO' : round === '2' ? '2º turno' : '1º turno'} <span>·</span> líder por município</p></div>
        <span className={`city-load-status${isLoading ? ' is-loading' : ''}`} title={`${formatInteger(loaded)} cidades com resultados · ${formatInteger(failed)} sem dados`}>
          {isLoading ? <LoaderCircle size={13} className="spin" /> : <ShieldCheck size={13} />}{formatInteger(completed)} / {formatInteger(expectedTotal || rows.length)}
        </span>
      </div>
      <p className="city-results-note">
        {simulationActive
          ? 'SIMULAÇÃO DE CARREGAMENTO — resultados oficiais já publicados do 1º turno são consultados em lotes; nenhum voto é inventado e a sequência não é ao vivo.'
          : round === '2' && !roundTwoStarted
          ? 'A apuração do 2º turno começa em 25/10, às 17h (Brasília). As cidades serão consultadas progressivamente quando os votos oficiais começarem.'
          : indexError
            ? 'Não foi possível consultar o cadastro territorial assinado do TSE. Tente novamente mais tarde.'
            : indexLoading
              ? 'Carregando o cadastro oficial de municípios antes de iniciar as consultas de resultados.'
            : round === '2' && roundTwoStarted
              ? 'O TSE atualiza os dados em lotes progressivos, limitados a 50 consultas por segundo; cada lote nacional pode levar alguns minutos. Ao abrir uma cidade, o detalhe local atualiza a cada 30 segundos.'
            : isLoading
            ? 'Carregamento progressivo da fonte oficial do TSE. As cidades já consultadas podem ser abertas enquanto o restante carrega.'
            : 'Cada linha mostra o candidato líder; selecione uma cidade para consultar a votação nominal completa.'}
      </p>
      <div className="city-progress" aria-label={`${progress}% dos municípios consultados`}>
        <div><span style={{ width: `${progress}%` }} /></div>
        <span>{progress}%</span>
      </div>
      <label className="city-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Buscar cidade ou UF" aria-label="Buscar cidade ou unidade federativa" />
        <span>{formatInteger(rows.length ? filteredRows.length : expectedTotal)}</span>
      </label>
      <div className="city-list" role="list" aria-label="Resultados eleitorais por cidade">
        {indexLoading && <div className="city-index-state"><LoaderCircle size={18} className="spin" /><span>Carregando o índice de municípios do TSE…</span></div>}
        {indexError && <div className="city-index-state city-index-state--error"><ShieldCheck size={18} /><span>{indexError}</span></div>}
        {pageRows.map((row) => {
          const isWaitingForRound = round === '2' && !roundTwoStarted;
          const color = row.candidate ? getCandidateColor(row.candidate) : undefined;
          let resultLabel = 'Aguardando consulta';
          if (row.status === 'no-runoff') resultLabel = 'Sem disputa no 2º turno';
          else if (row.status === 'error') resultLabel = 'TSE indisponível';
          else if (isWaitingForRound || row.status === 'loading') resultLabel = round === '2' && !roundTwoStarted ? 'Aguardando 25/10' : 'Carregando';
          else if (row.status === 'ready' && row.countedSections === 0 && round === '2') resultLabel = 'Aguardando apuração';
          return (
            <button type="button" className="city-result-row" key={row.municipality.ibgeCode} onClick={() => onSelect(row.municipality)} aria-label={`Consultar ${row.municipality.name}, ${row.municipality.uf}`}>
              <span className="city-result-place"><strong>{row.municipality.name}</strong><small>{row.municipality.uf}</small></span>
              {row.status === 'ready' && row.candidate && row.countedSections !== 0 && !isWaitingForRound ? (
                <span className="city-result-leader"><i style={{ backgroundColor: color }} /><strong>{row.candidate.ballotName}</strong><small className="city-result-identity">{formatCandidateSuffix(row.candidate)}</small><small className="city-result-votes">{formatInteger(row.candidate.votes)} votos</small></span>
              ) : <span className={`city-result-pending${row.status === 'error' ? ' is-error' : ''}`}>{row.status === 'loading' && !isWaitingForRound && <LoaderCircle size={12} className="spin" />}{resultLabel}</span>}
              <span className="city-result-percent" style={{ color: row.status === 'ready' && row.countedSections !== 0 && !isWaitingForRound ? color : undefined }}>{row.status === 'ready' && row.candidate && row.countedSections !== 0 && !isWaitingForRound ? formatPercent(row.candidate.percent) : '—'}</span>
            </button>
          );
        })}
        {!pageRows.length && !indexLoading && !indexError && <p className="city-no-results">Nenhum município corresponde à busca.</p>}
      </div>
      <div className="city-pagination">
        <span>Página {safePage + 1} de {pageCount}</span>
        <div>
          <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={safePage === 0} aria-label="Página anterior"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={safePage >= pageCount - 1} aria-label="Próxima página"><ChevronRight size={16} /></button>
        </div>
        <span className="city-error-count">{indexLoading ? 'Índice TSE' : indexError ? 'TSE indisponível' : failed ? `${failed} sem dados` : round === '2' && !roundTwoStarted ? '2º turno · 25 out' : isLoading ? 'Consultando TSE' : 'TSE verificado'}</span>
      </div>
    </aside>
  );
}
