import { useMemo } from 'react';
import type { ElectionCandidate, FeatureCollection, GeoFeature, Position } from '../types';
import { getCandidateColor } from '../services/colors';

interface BrazilMapProps {
  data: FeatureCollection;
  level: 'state' | 'municipality';
  getKey: (feature: GeoFeature) => string;
  getLabel: (feature: GeoFeature) => string;
  winners?: Map<string, ElectionCandidate>;
  selectedKey?: string;
  onSelect: (feature: GeoFeature) => void;
}

const WIDTH = 860;
const HEIGHT = 560;

function colorFor(candidate?: ElectionCandidate): string {
  if (!candidate) return '#29413b';
  return getCandidateColor(candidate);
}

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

export default function BrazilMap({ data, level, getKey, getLabel, winners, selectedKey, onSelect }: BrazilMapProps) {
  const projection = useMemo(() => buildProjection(data.features), [data]);
  const features = useMemo(() => data.features.map((feature) => {
    const key = getKey(feature);
    const label = getLabel(feature);
    const winner = winners?.get(key);
    const isSelected = key === selectedKey;
    const points = ringsFor(feature).flat();
    const centerPoint = points.length ? points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length] as Position, [0, 0] as Position) : [0, 0] as Position;
    const [centerX, centerY] = projection(centerPoint);
    return {
      source: feature,
      key,
      label,
      winner,
      isSelected,
      path: pathFor(feature, projection),
      centerX,
      centerY,
    };
  }), [data, getKey, getLabel, projection, selectedKey, winners]);

  return (
    <svg className={`brazil-map brazil-map--${level}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={level === 'state' ? 'Mapa interativo do Brasil por estado' : 'Mapa interativo de municípios'}>
      <defs>
        <pattern id="mapGrid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#b6dfce" strokeOpacity=".045" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill="url(#mapGrid)" />
      {features.map((feature) => (
        <g key={feature.key} className="map-feature-group">
          <path
            d={feature.path}
            className={`map-feature${feature.isSelected ? ' is-selected' : ''}`}
            fill={feature.isSelected ? '#53e0a1' : colorFor(feature.winner)}
            fillOpacity={feature.winner || feature.isSelected ? 0.82 : 0.52}
            stroke={feature.isSelected ? '#e6fff1' : '#8aa79b'}
            strokeWidth={feature.isSelected ? 1.9 : level === 'state' ? 1.15 : 0.62}
            vectorEffect="non-scaling-stroke"
            tabIndex={0}
            role="button"
            aria-label={feature.winner ? `${feature.label}. Mais votado: ${feature.winner.ballotName}, ${feature.winner.percent.toFixed(2)} por cento.` : `${feature.label}. Selecionar no mapa.`}
            onClick={() => onSelect(feature.source)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(feature.source);
              }
            }}
          >
            <title>{feature.winner ? `${feature.label} · ${feature.winner.ballotName} (${feature.winner.percent.toFixed(2)}%)` : feature.label}</title>
          </path>
          {level === 'state' && feature.key && (
            <text x={feature.centerX} y={feature.centerY} className="map-unit-label" textAnchor="middle" dominantBaseline="central" aria-hidden="true">
              {feature.key.toUpperCase()}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
