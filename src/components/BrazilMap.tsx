import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { ElectionCandidate, FeatureCollection, GeoFeature, Position } from '../types';
import { FEDERAL_UNITS, findUnitByCode } from '../data/states';
import { getIbgeAreaCode } from '../services/ibge';
import { getCandidateColor } from '../services/colors';
import { candidateMatchesSelection, formatCandidateLabel } from '../services/candidate-identity';
import { describeVoteMix, mixCandidateColors } from '../services/vote-color';
import CandidatePortrait from './CandidatePortrait';

interface BrazilMapProps {
  data: FeatureCollection;
  level: 'state' | 'municipality';
  getKey: (feature: GeoFeature) => string;
  getLabel: (feature: GeoFeature) => string;
  voteShares?: Map<string, ElectionCandidate[]>;
  unitBoundaries?: FeatureCollection | null;
  selectedUF?: string | null;
  candidatePhotoRegion?: string | null;
  selectedCandidateId?: string | null;
  selectedCandidate?: ElectionCandidate | null;
  candidateFocusReady?: boolean;
  suspended?: boolean;
  selectedKey?: string;
  onSelect: (feature: GeoFeature) => void;
  onSelectUF?: (uf: string) => void;
}

interface MapPoint {
  x: number;
  y: number;
}

interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface ProjectedFeature {
  source: GeoFeature;
  key: string;
  label: string;
  path: string;
  centerX: number;
  centerY: number;
  bounds: MapBounds;
}

interface ProjectedUnit {
  uf: string;
  name: string;
  path: string;
  centerX: number;
  centerY: number;
  bounds: MapBounds;
}

interface MunicipalityHoverCardState {
  key: string;
  municipality: string;
  uf: string;
  photoRegion: string;
  candidates: ElectionCandidate[];
  x: number;
  y: number;
}

const WIDTH = 860;
const HEIGHT = 560;
const voteFormatter = new Intl.NumberFormat('pt-BR');
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
const UF_LABEL_OFFSETS: Record<string, readonly [number, number]> = {
  AL: [10, -2], AP: [6, 0], DF: [0, 9], ES: [7, 2], PB: [9, -4], PE: [9, 0], RJ: [7, 5], RN: [7, -5], SE: [8, 4],
};

function collectPositions(value: unknown, output: Position[]): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    output.push(value as Position);
    return;
  }
  value.forEach((child) => collectPositions(child, output));
}

function ringsFor(feature: GeoFeature): Position[][] {
  const coordinates = feature.geometry.coordinates as unknown;
  const polygons: Position[][] = [];
  const visitPolygon = (value: unknown): void => {
    if (!Array.isArray(value) || value.length === 0) return;
    if (Array.isArray(value[0]) && typeof value[0][0] === 'number') {
      const ring = value as Position[];
      if (ring.length > 2) polygons.push(ring);
      return;
    }
    value.forEach(visitPolygon);
  };
  visitPolygon(coordinates);
  return polygons;
}

function buildProjection(features: GeoFeature[]) {
  const positions: Position[] = [];
  features.forEach((feature) => collectPositions(feature.geometry.coordinates, positions));
  if (!positions.length) return (_point: Position) => [WIDTH / 2, HEIGHT / 2] as const;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  positions.forEach(([longitude, latitude]) => {
    minX = Math.min(minX, longitude);
    maxX = Math.max(maxX, longitude);
    minY = Math.min(minY, latitude);
    maxY = Math.max(maxY, latitude);
  });
  const pad = 24;
  const scale = Math.min((WIDTH - pad * 2) / Math.max(maxX - minX, 0.1), (HEIGHT - pad * 2) / Math.max(maxY - minY, 0.1));
  const drawingWidth = (maxX - minX) * scale;
  const drawingHeight = (maxY - minY) * scale;
  const left = (WIDTH - drawingWidth) / 2;
  const top = (HEIGHT - drawingHeight) / 2;
  return (point: Position) => [left + (point[0] - minX) * scale, HEIGHT - top - (point[1] - minY) * scale] as const;
}

function pathFor(feature: GeoFeature, project: (point: Position) => readonly [number, number]): string {
  return ringsFor(feature).map((ring) => ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ') + ' Z').join(' ');
}

function boundsForPoints(points: MapPoint[]): MapBounds {
  if (!points.length) return { minX: WIDTH / 2, minY: HEIGHT / 2, maxX: WIDTH / 2, maxY: HEIGHT / 2 };
  return points.reduce<MapBounds>((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function mergeBounds(bounds: MapBounds[]): MapBounds | null {
  if (!bounds.length) return null;
  return bounds.reduce<MapBounds>((merged, current) => ({
    minX: Math.min(merged.minX, current.minX),
    minY: Math.min(merged.minY, current.minY),
    maxX: Math.max(merged.maxX, current.maxX),
    maxY: Math.max(merged.maxY, current.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function viewForBounds(bounds: MapBounds, minimumScale = 1.25, maximumScale = MAX_ZOOM): ViewTransform {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const fitted = Math.min((WIDTH - 64) / width, (HEIGHT - 64) / height);
  const scale = Math.min(maximumScale, Math.max(minimumScale, fitted * 0.82));
  return {
    scale,
    tx: WIDTH / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    ty: HEIGHT / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

function unitFromFeature(feature: GeoFeature) {
  const properties = feature.properties;
  const direct = properties.sigla ?? properties.SIGLA_UF ?? properties.uf ?? properties.UF;
  const match = findUnitByCode(direct);
  if (match) return match;
  const rawCode = String(properties.CD_GEOCUF ?? properties.CD_UF ?? properties.codarea ?? properties.codigo ?? getIbgeAreaCode(feature));
  const digits = rawCode.replace(/\D/g, '');
  const prefix = digits.slice(0, 2);
  return FEDERAL_UNITS.find((unit) => unit.ibgeCode === prefix) ?? findUnitByCode(prefix);
}

function clientToMapPoint(svg: SVGSVGElement, clientX: number, clientY: number): MapPoint {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM()?.inverse();
  if (!matrix) return { x: WIDTH / 2, y: HEIGHT / 2 };
  const result = point.matrixTransform(matrix);
  return { x: result.x, y: result.y };
}

function clampTransform(value: ViewTransform): ViewTransform {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value.scale));
  const maxX = WIDTH * (scale - 1);
  const maxY = HEIGHT * (scale - 1);
  return {
    scale,
    tx: Math.min(0, Math.max(-maxX, value.tx)),
    ty: Math.min(0, Math.max(-maxY, value.ty)),
  };
}

function syncUnitLabelScale(group: SVGGElement | null, scale: number): void {
  if (!group) return;
  group.querySelectorAll<SVGGElement>('.map-uf-label').forEach((label) => {
    const x = label.getAttribute('data-map-x');
    const y = label.getAttribute('data-map-y');
    if (x !== null && y !== null) label.setAttribute('transform', `translate(${x} ${y}) scale(${1 / scale})`);
  });
}

function MunicipalityHoverCard({ card }: { card: MunicipalityHoverCardState }) {
  return (
    <div className="map-hover-card" role="tooltip" style={{ left: card.x, top: card.y }}>
      <div className="map-hover-heading"><span>{card.uf}</span><i aria-hidden="true" /><strong>{card.municipality}</strong></div>
      <div className="map-hover-candidates">
        {card.candidates.map((candidate) => {
          const elected = /\beleit[oa]\b/i.test(candidate.status);
          return (
            <div className="map-hover-candidate" key={`${card.key}-${candidate.id}`}>
              <CandidatePortrait candidate={candidate} region={card.photoRegion} className="candidate-photo--map" />
              <span className="map-hover-candidate-info">
                <span className="map-hover-candidate-name">{candidate.ballotName || candidate.name}</span>
                <span className="map-hover-candidate-meta">
                  {candidate.number && <span className="map-hover-number">{candidate.number}</span>}
                  {candidate.party.trim() && <span className="map-hover-party">{candidate.party.trim().toLocaleUpperCase('pt-BR')}</span>}
                  {elected && <span className="map-hover-elected">Eleito</span>}
                </span>
              </span>
              <span className="map-hover-result"><strong>{candidate.percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong><small>{voteFormatter.format(candidate.votes)} votos</small></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MapFeature = memo(function MapFeature({
  feature,
  level,
  shares,
  selected,
  selectedCandidateId,
  selectedCandidate,
  disabled,
  onSelect,
  onHover,
}: {
  feature: ProjectedFeature;
  level: 'state' | 'municipality';
  shares?: ElectionCandidate[];
  selected: boolean;
  selectedCandidateId?: string | null;
  selectedCandidate?: ElectionCandidate | null;
  disabled: boolean;
  onSelect: (feature: GeoFeature) => void;
  onHover: (feature: ProjectedFeature | null, shares: ElectionCandidate[], clientX?: number, clientY?: number) => void;
}) {
  const leader = shares?.[0];
  const isCandidateLeader = candidateMatchesSelection(leader, selectedCandidate, selectedCandidateId);
  const isDimmed = Boolean(selectedCandidateId && !isCandidateLeader);
  const fill = level === 'state'
    ? leader ? getCandidateColor(leader) : '#29413b'
    : mixCandidateColors(shares ?? []) ?? '#29413b';
  const fillOpacity = (selected ? 1 : leader ? 0.94 : 0.25) * (isDimmed ? 0.18 : 1);
  const distribution = shares?.length ? describeVoteMix(shares) : '';
  const leaderPercent = leader?.percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const label = leader
    ? level === 'state'
      ? `${feature.label}. Candidato mais votado: ${formatCandidateLabel(leader)}, ${leader.percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%, ${voteFormatter.format(leader.votes)} votos.`
      : `${feature.label}. Candidato vencedor: ${formatCandidateLabel(leader)}. Diferença para o segundo colocado: ${distribution}. ${leaderPercent}%, ${voteFormatter.format(leader.votes)} votos.`
    : `${feature.label}. Selecione para consultar.`;
  return (
    <g className="map-feature-group">
      <path
        d={feature.path}
        className={`map-feature${selected ? ' is-selected' : ''}${isCandidateLeader ? ' is-candidate-leader' : ''}${isDimmed ? ' is-dimmed' : ''}`}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={selected ? 'rgba(220, 238, 226, .74)' : isCandidateLeader ? 'rgba(255, 255, 255, .34)' : level === 'municipality' ? '#07110d' : '#8aa79b'}
        strokeWidth={selected ? 1.15 : isCandidateLeader ? 1.05 : level === 'state' ? 1.15 : 1.05}
        vectorEffect="non-scaling-stroke"
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-pressed={selected}
        aria-disabled={disabled}
        aria-label={label}
        onClick={disabled ? undefined : () => onSelect(feature.source)}
        onPointerEnter={(event) => {
          if (!disabled && level === 'municipality' && event.pointerType !== 'touch') {
            onHover(feature, shares ?? [], event.clientX, event.clientY);
          }
        }}
        onPointerLeave={() => onHover(null, [])}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(feature.source);
          }
        }}
      />
      {level === 'state' && (
        <text x={feature.centerX} y={feature.centerY} className="map-unit-label" textAnchor="middle" dominantBaseline="central" aria-hidden="true">
          {feature.key.toUpperCase()}
        </text>
      )}
    </g>
  );
});

export default function BrazilMap({ data, level, getKey, getLabel, voteShares, unitBoundaries, selectedUF, candidatePhotoRegion, selectedCandidateId, selectedCandidate, candidateFocusReady = true, suspended = false, selectedKey, onSelect, onSelectUF }: BrazilMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewGroupRef = useRef<SVGGElement | null>(null);
  const viewAnimationRef = useRef<number | null>(null);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const zoomInButtonRef = useRef<HTMLButtonElement | null>(null);
  const zoomOutButtonRef = useRef<HTMLButtonElement | null>(null);
  const zoomLevelRef = useRef<HTMLSpanElement | null>(null);
  const pointersRef = useRef(new Map<number, MapPoint>());
  const gestureRef = useRef<{ type: 'pan'; start: MapPoint; view: ViewTransform } | { type: 'pinch'; startDistance: number; startScale: number; anchor: MapPoint } | null>(null);
  const suppressClickRef = useRef(false);
  const gestureMovedRef = useRef(false);
  const [, setViewRevision] = useState(0);
  const [hoverCard, setHoverCard] = useState<MunicipalityHoverCardState | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const autoFocusScopeRef = useRef<string | null>(null);

  const writeViewToDom = useCallback((view: ViewTransform) => {
    viewGroupRef.current?.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.scale})`);
    syncUnitLabelScale(viewGroupRef.current, view.scale);
    if (zoomLevelRef.current) zoomLevelRef.current.textContent = `${Math.round(view.scale * 100)}%`;
    if (zoomInButtonRef.current) zoomInButtonRef.current.disabled = view.scale >= MAX_ZOOM;
    if (zoomOutButtonRef.current) zoomOutButtonRef.current.disabled = view.scale <= MIN_ZOOM;
  }, []);

  const handleFeatureHover = useCallback((feature: ProjectedFeature | null, shares: ElectionCandidate[], clientX?: number, clientY?: number) => {
    if (!feature || level !== 'municipality' || !shares.length || clientX === undefined || clientY === undefined) {
      setHoverCard(null);
      return;
    }
    const bounds = svgRef.current?.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const unit = selectedUF ? findUnitByCode(selectedUF) : unitFromFeature(feature.source);
    const cardWidth = 294;
    const cardHeight = shares.length > 1 ? 154 : 108;
    setHoverCard({
      key: feature.key,
      municipality: feature.label,
      uf: unit?.uf ?? selectedUF ?? '',
      photoRegion: candidatePhotoRegion ?? selectedUF ?? unit?.uf ?? 'BR',
      candidates: shares.slice(0, 2),
      x: Math.max(8, Math.min(bounds.width - cardWidth - 8, clientX - bounds.left + 16)),
      y: Math.max(8, Math.min(bounds.height - cardHeight - 8, clientY - bounds.top + 16)),
    });
  }, [candidatePhotoRegion, level, selectedUF]);

  useEffect(() => setHoverCard(null), [data, level, selectedUF]);

  const projection = useMemo(() => buildProjection(level === 'municipality' && selectedUF && unitBoundaries ? unitBoundaries.features : data.features), [data, level, selectedUF, unitBoundaries]);
  const features = useMemo<ProjectedFeature[]>(() => data.features.map((feature) => {
    const key = getKey(feature);
    const label = getLabel(feature);
    const points = ringsFor(feature).flat();
    const centerPoint = points.length
      ? points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length] as Position, [0, 0] as Position)
      : [0, 0] as Position;
    const [centerX, centerY] = projection(centerPoint);
    const projectedPoints = points.map((point) => {
      const [x, y] = projection(point);
      return { x, y };
    });
    return { source: feature, key, label, path: pathFor(feature, projection), centerX, centerY, bounds: boundsForPoints(projectedPoints) };
  }), [data, getKey, getLabel, projection]);

  const projectedUnits = useMemo<ProjectedUnit[]>(() => {
    if (level !== 'municipality' || !unitBoundaries) return [];
    return unitBoundaries.features.flatMap((source) => {
      const unit = unitFromFeature(source);
      if (!unit) return [];
      const points = ringsFor(source).flat();
      if (!points.length) return [];
      const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length] as Position, [0, 0] as Position);
      const [centerX, centerY] = projection(center);
      const projectedPoints = points.map((point) => {
        const [x, y] = projection(point);
        return { x, y };
      });
      return [{ uf: unit.uf, name: unit.name, path: pathFor(source, projection), centerX, centerY, bounds: boundsForPoints(projectedPoints) }];
    });
  }, [unitBoundaries, projection, level]);

  const updateView = useCallback((next: ViewTransform) => {
    const clamped = clampTransform(next);
    const start = viewRef.current;
    if (viewAnimationRef.current !== null) window.cancelAnimationFrame(viewAnimationRef.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      viewAnimationRef.current = null;
      viewRef.current = clamped;
      writeViewToDom(clamped);
      setViewRevision((revision) => revision + 1);
      return;
    }
    const startedAt = performance.now();
    const duration = 720;
    const animate = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const current = {
        scale: start.scale + (clamped.scale - start.scale) * eased,
        tx: start.tx + (clamped.tx - start.tx) * eased,
        ty: start.ty + (clamped.ty - start.ty) * eased,
      };
      viewRef.current = current;
      writeViewToDom(current);
      if (progress < 1) {
        viewAnimationRef.current = window.requestAnimationFrame(animate);
      } else {
        viewAnimationRef.current = null;
        setViewRevision((revision) => revision + 1);
      }
    };
    viewAnimationRef.current = window.requestAnimationFrame(animate);
  }, [writeViewToDom]);

  const applyGestureView = useCallback((next: ViewTransform) => {
    if (viewAnimationRef.current !== null) {
      window.cancelAnimationFrame(viewAnimationRef.current);
      viewAnimationRef.current = null;
    }
    const clamped = clampTransform(next);
    viewRef.current = clamped;
    writeViewToDom(clamped);
  }, [writeViewToDom]);

  const commitView = useCallback(() => setViewRevision((revision) => revision + 1), []);

  useEffect(() => () => {
    if (viewAnimationRef.current !== null) window.cancelAnimationFrame(viewAnimationRef.current);
  }, []);

  useEffect(() => {
    if (suspended) return;
    const territoryScope = [level, selectedUF ?? '', selectedKey ?? ''].join('|');
    const territoryFocusScope = `${territoryScope}|territory`;
    if (level === 'municipality' && selectedUF && !unitBoundaries) return;

    const focusTerritory = () => {
      if (selectedKey) {
        const selectedFeature = features.find((feature) => feature.key === selectedKey);
        if (selectedFeature) {
          const currentScale = viewRef.current.scale;
          const gentleMunicipalityScale = currentScale > 3.2 ? currentScale : Math.min(3.2, Math.max(1.6, currentScale * 1.25));
          updateView(viewForBounds(selectedFeature.bounds, 1.2, level === 'municipality' ? gentleMunicipalityScale : MAX_ZOOM));
          return;
        }
      }
      if (selectedUF) {
        const selectedUnit = projectedUnits.find((unit) => unit.uf === selectedUF);
        if (selectedUnit) {
          updateView(viewForBounds(selectedUnit.bounds, 1.6, 2.4));
          return;
        }
      }
      updateView({ scale: 1, tx: 0, ty: 0 });
    };

    if (selectedCandidateId && !candidateFocusReady) {
      if (autoFocusScopeRef.current !== territoryFocusScope) {
        autoFocusScopeRef.current = territoryFocusScope;
        focusTerritory();
      }
      return;
    }
    if (selectedCandidateId) {
      const leadingFeatures = features.filter((feature) => candidateMatchesSelection(voteShares?.get(feature.key)?.[0], selectedCandidate, selectedCandidateId));
      const leadingBounds = mergeBounds(leadingFeatures.map((feature) => feature.bounds));
      const boundsSignature = leadingBounds
        ? [leadingBounds.minX, leadingBounds.minY, leadingBounds.maxX, leadingBounds.maxY].map((value) => value.toFixed(2)).join(':')
        : 'no-leading-area';
      const candidateFocusScope = `${territoryScope}|candidate:${selectedCandidateId}|${boundsSignature}`;
      if (autoFocusScopeRef.current === candidateFocusScope) return;
      const fallback = (selectedKey ? features.find((feature) => feature.key === selectedKey)?.bounds : undefined)
        ?? projectedUnits.find((unit) => unit.uf === selectedUF)?.bounds
        ?? mergeBounds(features.map((feature) => feature.bounds));
      const target = leadingBounds ?? fallback;
      if (!target) return;
      updateView(viewForBounds(target, 1.3));
      autoFocusScopeRef.current = candidateFocusScope;
      return;
    }

    if (autoFocusScopeRef.current === territoryFocusScope) return;
    autoFocusScopeRef.current = territoryFocusScope;
    focusTerritory();
  }, [data, level, selectedUF, selectedKey, selectedCandidateId, selectedCandidate, candidateFocusReady, suspended, features, projectedUnits, unitBoundaries, voteShares, updateView]);

  const zoomAt = useCallback((anchor: MapPoint, factor: number) => {
    const current = viewRef.current;
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * factor));
    const ratio = scale / current.scale;
    updateView({
      scale,
      tx: anchor.x - (anchor.x - current.tx) * ratio,
      ty: anchor.y - (anchor.y - current.ty) * ratio,
    });
  }, [updateView]);

  const zoomAtCenter = useCallback((factor: number) => zoomAt({ x: WIDTH / 2, y: HEIGHT / 2 }, factor), [zoomAt]);

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const svg = event.currentTarget;
    const point = clientToMapPoint(svg, event.clientX, event.clientY);
    const pointers = pointersRef.current;
    if (pointers.size === 0) gestureMovedRef.current = false;
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      gestureRef.current = { type: 'pan', start: point, view: viewRef.current };
    } else if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()].slice(-2);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const current = viewRef.current;
      const worldAnchor = { x: (midpoint.x - current.tx) / current.scale, y: (midpoint.y - current.ty) / current.scale };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      gestureRef.current = { type: 'pinch', startDistance: distance, startScale: current.scale, anchor: worldAnchor };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = clientToMapPoint(svg, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (pointersRef.current.size >= 2 && gesture.type === 'pinch') {
      gestureMovedRef.current = true;
      pointersRef.current.forEach((_, pointerId) => {
        if (!svg.hasPointerCapture(pointerId)) svg.setPointerCapture(pointerId);
      });
      const [first, second] = [...pointersRef.current.values()].slice(-2);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.startScale * distance / gesture.startDistance));
      if (Math.abs(scale - viewRef.current.scale) > 0.003) suppressClickRef.current = true;
      applyGestureView({ scale, tx: midpoint.x - gesture.anchor.x * scale, ty: midpoint.y - gesture.anchor.y * scale });
      return;
    }

    if (gesture.type === 'pan') {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 4) {
        if (!svg.hasPointerCapture(event.pointerId)) svg.setPointerCapture(event.pointerId);
        suppressClickRef.current = true;
        gestureMovedRef.current = true;
      }
      applyGestureView({ scale: gesture.view.scale, tx: gesture.view.tx + dx, ty: gesture.view.ty + dy });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    pointersRef.current.delete(event.pointerId);
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [pointerId, point] = [...pointersRef.current.entries()][0];
      if (svg.hasPointerCapture(pointerId)) gestureRef.current = { type: 'pan', start: point, view: viewRef.current };
    } else if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      if (gestureMovedRef.current) {
        commitView();
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 150);
      }
      gestureMovedRef.current = false;
    }
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const svg = event.currentTarget as SVGSVGElement;
    const point = clientToMapPoint(svg, event.clientX, event.clientY);
    const current = viewRef.current;
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * (event.deltaY < 0 ? 1.16 : 1 / 1.16)));
    const ratio = scale / current.scale;
    applyGestureView({ scale, tx: point.x - (point.x - current.tx) * ratio, ty: point.y - (point.y - current.ty) * ratio });
    if (wheelCommitTimerRef.current !== null) window.clearTimeout(wheelCommitTimerRef.current);
    wheelCommitTimerRef.current = window.setTimeout(() => {
      wheelCommitTimerRef.current = null;
      commitView();
    }, 120);
  }, [applyGestureView, commitView]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', handleWheel);
      if (wheelCommitTimerRef.current !== null) window.clearTimeout(wheelCommitTimerRef.current);
    };
  }, [handleWheel]);

  const renderedView = viewRef.current;

  return (
    <div className="map-viewport">
      <svg
        ref={svgRef}
        className={`brazil-map brazil-map--${level}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-hidden={suspended || undefined}
        aria-busy={suspended}
        aria-label={level === 'state' ? 'Mapa interativo do Brasil por estado. Arraste para mover; use mais e menos para aproximar.' : selectedUF ? `Mapa dos municípios de ${selectedUF}; as outras UFs aparecem escurecidas. Arraste para mover e use os controles para aproximar.` : 'Mapa interativo de municípios. Arraste para mover; use mais e menos para aproximar.'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={(event) => {
          if (suppressClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          zoomAt(clientToMapPoint(event.currentTarget, event.clientX, event.clientY), 1.45);
        }}
      >
        <defs>
          <pattern id="mapGrid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#b6dfce" strokeOpacity=".045" strokeWidth="1" />
          </pattern>
        </defs>
        <g ref={viewGroupRef} transform={`translate(${renderedView.tx} ${renderedView.ty}) scale(${renderedView.scale})`}>
          <rect width={WIDTH} height={HEIGHT} fill="url(#mapGrid)" />
          {level === 'municipality' && selectedUF && projectedUnits.map((unit) => (
            <path key={`uf-context-${unit.uf}`} d={unit.path} className={`map-uf-context${unit.uf === selectedUF ? ' is-focus' : ''}`} fillRule="evenodd" pointerEvents="none" />
          ))}
          {features.map((feature) => (
            <MapFeature
              key={feature.key}
              feature={feature}
              level={level}
              shares={voteShares?.get(feature.key)}
              selected={feature.key === selectedKey}
              selectedCandidateId={selectedCandidateId}
              selectedCandidate={selectedCandidate}
              disabled={suspended}
              onSelect={onSelect}
              onHover={handleFeatureHover}
            />
          ))}
          {projectedUnits.map((unit) => {
            const isCurrent = unit.uf === selectedUF;
            return <path key={`uf-boundary-${unit.uf}`} d={unit.path} className={`map-uf-boundary${selectedUF ? isCurrent ? ' is-focus' : ' is-dimmed' : ''}`} pointerEvents="none" vectorEffect="non-scaling-stroke" />;
          })}
          {projectedUnits.map((unit) => {
            const [offsetX, offsetY] = UF_LABEL_OFFSETS[unit.uf] ?? [0, 0];
            const isCurrent = unit.uf === selectedUF;
            const canSelect = !selectedUF || !isCurrent;
            return (
              <g
                key={`uf-label-${unit.uf}`}
                className={`map-uf-label${selectedUF && !isCurrent ? ' is-muted' : ''}${isCurrent ? ' is-current' : ''}`}
                transform={`translate(${unit.centerX + offsetX} ${unit.centerY + offsetY}) scale(${1 / renderedView.scale})`}
                data-map-x={unit.centerX + offsetX}
                data-map-y={unit.centerY + offsetY}
                role={canSelect ? 'button' : undefined}
                tabIndex={canSelect ? 0 : -1}
                aria-pressed={canSelect ? isCurrent : undefined}
                aria-label={canSelect ? `${unit.uf}, ${unit.name}. Ver votação nominal desta UF.` : undefined}
                pointerEvents={canSelect ? 'auto' : 'none'}
                onPointerDown={canSelect ? (event) => event.stopPropagation() : undefined}
                onClick={canSelect ? (event) => { event.stopPropagation(); onSelectUF?.(unit.uf); } : undefined}
                onKeyDown={canSelect ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectUF?.(unit.uf);
                  }
                } : undefined}
              >
                <title>{unit.uf} — {unit.name}; abrir votação por UF</title>
                <rect x="-16" y="-10" width="32" height="20" rx="4" />
                <text x="0" y="0" dominantBaseline="central" textAnchor="middle">{unit.uf}</text>
              </g>
            );
          })}
        </g>
      </svg>
      {hoverCard && !suspended && <MunicipalityHoverCard card={hoverCard} />}
      <div className="map-zoom-controls" role="group" aria-label="Controles de zoom do mapa">
        <button ref={zoomInButtonRef} type="button" aria-label="Aproximar mapa" title="Aproximar" onClick={() => zoomAtCenter(1.35)} disabled={renderedView.scale >= MAX_ZOOM}><Plus size={17} /></button>
        <span ref={zoomLevelRef} className="map-zoom-level" aria-live="off">{Math.round(renderedView.scale * 100)}%</span>
        <button ref={zoomOutButtonRef} type="button" aria-label="Afastar mapa" title="Afastar" onClick={() => zoomAtCenter(1 / 1.35)} disabled={renderedView.scale <= MIN_ZOOM}><Minus size={17} /></button>
        <button type="button" className="map-zoom-reset" aria-label="Restaurar enquadramento do mapa" title="Restaurar enquadramento" onClick={() => updateView({ scale: 1, tx: 0, ty: 0 })}><LocateFixed size={16} /></button>
      </div>
    </div>
  );
}
