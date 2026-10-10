export type Position = [number, number, ...number[]];
export type PolygonCoordinates = Position[][];
export type MultiPolygonCoordinates = Position[][][];

export interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry:
    | { type: 'Polygon'; coordinates: PolygonCoordinates }
    | { type: 'MultiPolygon'; coordinates: MultiPolygonCoordinates };
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface ElectionCandidate {
  id: string;
  name: string;
  ballotName: string;
  party: string;
  number: string;
  votes: number;
  percent: number;
  status: string;
  vice?: string;
}

export interface ElectionResult {
  electionCode: string;
  cargoCode: string;
  cargoName: string;
  ufCode: string;
  updatedDate: string;
  updatedTime: string;
  turnout: number | null;
  abstention: number | null;
  validVotes: number | null;
  totalVotes: number | null;
  totalSections: number | null;
  countedSections: number | null;
  countedPercent: number | null;
  candidates: ElectionCandidate[];
  sourceUrl: string;
}

export type LoadState = 'loading' | 'ready' | 'empty' | 'error';
export type ElectionRound = '1' | '2';

export interface MunicipalityRef {
  ibgeCode: string;
  tseCode: string;
  name: string;
  uf: string;
}

export interface MunicipalityOverviewRow {
  municipality: MunicipalityRef;
  candidate: ElectionCandidate | null;
  candidates?: ElectionCandidate[];
  countedSections: number | null;
  status: 'loading' | 'ready' | 'error' | 'no-runoff';
}
