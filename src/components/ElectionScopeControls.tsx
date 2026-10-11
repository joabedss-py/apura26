import { ChevronDown } from 'lucide-react';
import { OFFICE_OPTIONS } from '../data/states';
import type { ElectionRound } from '../types';

interface ElectionScopeControlsProps {
  officeCode: string;
  round: ElectionRound;
  roundTwoStarted: boolean;
  canUseSecondRound: boolean;
  simulationActive: boolean;
  onOfficeChange: (officeCode: string) => void;
  onRoundChange: (round: ElectionRound) => void;
}

export default function ElectionScopeControls({
  officeCode,
  round,
  roundTwoStarted,
  canUseSecondRound,
  simulationActive,
  onOfficeChange,
  onRoundChange,
}: ElectionScopeControlsProps) {
  const secondRoundStatus = !canUseSecondRound
    ? 'Indisponível para este cargo'
    : roundTwoStarted
      ? 'Acompanhamento do TSE'
      : 'Previsto · 17h BRT';
  const summary = simulationActive
    ? 'Demonstração de carregamento: os votos continuam oficiais; apenas a sequência é simulada.'
    : round === '1'
      ? '1º turno · resultados oficiais publicados em 04/10/2026. 2º turno previsto para 25/10/2026, às 17h (Brasília).'
      : roundTwoStarted
        ? '2º turno · acompanhamento oficial do TSE; atualização automática da localidade a cada 30 segundos.'
        : '2º turno previsto para 25/10/2026, às 17h (Brasília). A apuração ainda não começou.';

  return (
    <section className="election-scope-controls" aria-label="Cargo e turno da eleição">
      <label className="election-office-control" htmlFor="election-office-select">
        <span>CARGO</span>
        <div className="select-wrap">
          <select
            id="election-office-select"
            value={officeCode}
            onChange={(event) => onOfficeChange(event.target.value)}
            aria-label="Selecionar cargo da apuração"
          >
            {OFFICE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
      </label>

      <div className="election-round-choices" role="group" aria-label="Selecionar turno da eleição">
        <button
          type="button"
          className={`election-round-option${round === '1' ? ' is-active' : ''}`}
          onClick={() => onRoundChange('1')}
          aria-pressed={round === '1'}
        >
          <strong>1º TURNO</strong>
          <span className="election-round-badge">OFICIAL</span>
          <small>04 OUT 2026</small>
        </button>
        <button
          type="button"
          className={`election-round-option${round === '2' ? ' is-active' : ''}`}
          onClick={() => onRoundChange('2')}
          disabled={!canUseSecondRound}
          aria-pressed={round === '2'}
          title={canUseSecondRound ? 'Segundo turno · 25 de outubro de 2026, às 17h (Brasília)' : 'O segundo turno está disponível para Presidente e Governador'}
        >
          <strong>2º TURNO</strong>
          <span className="election-round-badge">{secondRoundStatus}</span>
          <small>25 OUT 2026 · 17H</small>
        </button>
      </div>

      <p className={`election-round-summary${round === '2' && !roundTwoStarted ? ' is-waiting' : ''}`} aria-live="polite">{summary}</p>
    </section>
  );
}
