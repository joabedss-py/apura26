import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { ElectionCandidate, FeatureCollection, GeoFeature, Position } from '../types';
import { FEDERAL_UNITS, findUnitByCode } from '../data/states';
import { getIbgeAreaCode } from '../services/ibge';
import { getCandidateColor } from '../services/colors';
import { describeVoteMix, mixCandidateColors } from '../services/vote-color';

interface BrazilMapProps {
  data: FeatureCollection;
  level: 'state' | 'municipality';
  getKey: (feature: GeoFeature) => string;
  getLabel: (feature: GeoFeature) => string;
  voteShares?: Map<string, ElectionCandidate[]>;
  unitBoundaries?: FeatureCollection | null;
  selectedUF?: string | null;
  selectedCandidateId?: string | null;
  candidateFocusReady?: boolean;
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

const WIDTH = 860;
const HEIGHT = 560;
const voteFormatter = new Intl.NumberFormat('pt-BR');
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
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

function viewForBounds(bounds: MapBounds, minimumScale = 1.25): ViewTransform {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const fitted = Math.min((WIDTH - 64) / width, (HEIGHT - 64) / height);
  const scale = Math.min(MAX_ZOOM, Math.max(minimumScale, fitted * 0.82));
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

const MapFeature = memo(function MapFeature({
  feature,
  level,
  shares,
  selected,
  selectedCandidateId,
  onSelect,
}: {
  feature: ProjectedFeature;
  level: 'state' | 'municipality';
  shares?: ElectionCandidate[];
  selected: boolean;
  selectedCandidateId?: string | null;
  onSelect: (feature: GeoFeature) => void;
}) {
  const leader = shares?.[0];
  const isDimmed = Boolean(selectedCandidateId && leader?.id !== selectedCandidateId);
  const fill = level === 'state'
    ? leader ? getCandidateColor(leader) : '#29413b'
    : mixCandidateColors(shares ?? []) ?? '#29413b';
  const fillOpacity = (selected ? 1 : leader ? 0.94 : 0.25) * (isDimmed ? 0.18 : 1);
  const distribution = shares?.length ? describeVoteMix(shares) : '';
  const leaderPercent = leader?.percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const label = leader
    ? level === 'state'
      ? `${feature.label}. Candidato mais votado: ${leader.ballotName}, ${leader.percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%, ${voteFormatter.format(leader.votes)} votos.`
      : `${feature.label}. Mistura proporcional de votos: ${distribution}. Líder: ${leader.ballotName}, ${leaderPercent}%, ${voteFormatter.format(leader.votes)} votos.`
    : `${feature.label}. Selecione para consultar.`;
  return (
    <g className="map-feature-group">
      <path
        d={feature.path}
        className={`map-feature${selected ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}`}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={selected ? '#e6fff1' : '#8aa79b'}
        strokeWidth={selected ? 1.9 : level === 'state' ? 1.15 : 0.62}
        vectorEffect="non-scaling-stroke"
        tabIndex={0}
        role="button"
        aria-label={label}
        onClick={() => onSelect(feature.source)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(feature.source);
          }
        }}
      >
        <title>{leader ? `${feature.label} · ${level === 'state' ? `Mais votado: ${leader.ballotName}, ${leaderPercent}%, ${voteFormatter.format(leader.votes)} votos` : `${distribution} · líder: ${leader.ballotName}, ${leaderPercent}%, ${voteFormatter.format(leader.votes)} votos`}` : feature.label}</title>
      </path>
      {level === 'state' && (
        <text x={feature.centerX} y={feature.centerY} className="map-unit-label" textAnchor="middle" dominantBaseline="central" aria-hidden="true">
          {feature.key.toUpperCase()}
        </text>
      )}
    </g>
  );
});

export default function BrazilMap({ data, level, getKey, getLabel, voteShares, unitBoundaries, selectedUF, selectedCandidateId, candidateFocusReady = true, selectedKey, onSelect, onSelectUF }: BrazilMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointersRef = useRef(new Map<number, MapPoint>());
  const gestureRef = useRef<{ type: 'pan'; start: MapPoint; view: ViewTransform } | { type: 'pinch'; startDistance: number; anchor: MapPoint } | null>(null);
  const suppressClickRef = useRef(false);
  const gestureMovedRef = useRef(false);
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const autoFocusScopeRef = useRef<string | null>(null);
  viewRef.current = view;

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
    viewRef.current = clamped;
    setView(clamped);
  }, []);

  useEffect(() => {
    const territoryScope = [level, selectedUF ?? '', selectedKey ?? ''].join('|');
    const territoryFocusScope = `${territoryScope}|territory`;
    if (level === 'municipality' && selectedUF && !unitBoundaries) return;

    const focusTerritory = () => {
      if (selectedKey) {
        const selectedFeature = features.find((feature) => feature.key === selectedKey);
        if (selectedFeature) {
          updateView(viewForBounds(selectedFeature.bounds, 3.2));
          return;
        }
      }
      if (selectedUF) {
        const selectedUnit = projectedUnits.find((unit) => unit.uf === selectedUF);
        if (selectedUnit) {
          updateView(viewForBounds(selectedUnit.bounds, 2.4));
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
      const leadingFeatures = features.filter((feature) => voteShares?.get(feature.key)?.[0]?.id === selectedCandidateId);
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
      updateView(viewForBounds(target, leadingBounds ? MIN_ZOOM : 1.3));
      autoFocusScopeRef.current = candidateFocusScope;
      return;
    }

    if (autoFocusScopeRef.current === territoryFocusScope) return;
    autoFocusScopeRef.current = territoryFocusScope;
    focusTerritory();
  }, [data, level, selectedUF, selectedKey, selectedCandidateId, candidateFocusReady, features, projectedUnits, unitBoundaries, voteShares, updateView]);

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
    svg.setPointerCapture(event.pointerId);
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
      gestureRef.current = { type: 'pinch', startDistance: distance, anchor: worldAnchor };
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
      const [first, second] = [...pointersRef.current.values()].slice(-2);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewRef.current.scale * distance / gesture.startDistance));
      if (Math.abs(scale - viewRef.current.scale) > 0.003) suppressClickRef.current = true;
      updateView({ scale, tx: midpoint.x - gesture.anchor.x * scale, ty: midpoint.y - gesture.anchor.y * scale });
      return;
    }

    if (gesture.type === 'pan') {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 4) {
        suppressClickRef.current = true;
        gestureMovedRef.current = true;
      }
      updateView({ scale: gesture.view.scale, tx: gesture.view.tx + dx, ty: gesture.view.ty + dy });
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
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 80);
      }
      gestureMovedRef.current = false;
    }
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = clientToMapPoint(event.currentTarget, event.clientX, event.clientY);
    zoomAt(point, event.deltaY < 0 ? 1.16 : 1 / 1.16);
  };

  return (
    <div className="map-viewport">
      <svg
        ref={svgRef}
        className={`brazil-map brazil-map--${level}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label={level === 'state' ? 'Mapa interativo do Brasil por estado. Arraste para mover; use mais e menos para aproximar.' : selectedUF ? `Mapa dos municípios de ${selectedUF}; as outras UFs aparecem escurecidas. Arraste para mover e use os controles para aproximar.` : 'Mapa interativo de municípios. Arraste para mover; use mais e menos para aproximar.'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
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
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
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
              onSelect={onSelect}
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
                transform={`translate(${unit.centerX + offsetX} ${unit.centerY + offsetY}) scale(${1 / view.scale})`}
                role={canSelect ? 'button' : undefined}
                tabIndex={canSelect ? 0 : -1}
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
      <div className="map-zoom-controls" role="group" aria-label="Controles de zoom do mapa">
        <button type="button" aria-label="Aproximar mapa" title="Aproximar" onClick={() => zoomAtCenter(1.35)} disabled={view.scale >= MAX_ZOOM}><Plus size={17} /></button>
        <span className="map-zoom-level" aria-live="polite">{Math.round(view.scale * 100)}%</span>
        <button type="button" aria-label="Afastar mapa" title="Afastar" onClick={() => zoomAtCenter(1 / 1.35)} disabled={view.scale <= MIN_ZOOM}><Minus size={17} /></button>
        <button type="button" className="map-zoom-reset" aria-label="Restaurar enquadramento do mapa" title="Restaurar enquadramento" onClick={() => updateView({ scale: 1, tx: 0, ty: 0 })}><LocateFixed size={16} /></button>
      </div>
    </div>
  );
}
