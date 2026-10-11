const VALID_REGIONS = new Set([
  'BR', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

interface ZipPhotoEntry {
  compressedSize: number;
  compression: number;
  localHeaderOffset: number;
}

interface PhotoArchive {
  bytes: Uint8Array;
  entries: Map<string, ZipPhotoEntry>;
}

const archivePromises = new Map<string, Promise<PhotoArchive>>();
const photoPromises = new Map<string, Promise<string | null>>();

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function indexArchive(bytes: Uint8Array): Map<string, ZipPhotoEntry> {
  const view = viewOf(bytes);
  const firstEndRecord = Math.max(0, bytes.length - 22 - 0xffff);
  let endRecord = -1;

  for (let offset = bytes.length - 22; offset >= firstEndRecord; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) throw new Error('O arquivo de fotos do TSE não contém um índice ZIP válido.');

  const entryCount = view.getUint16(endRecord + 10, true);
  let cursor = view.getUint32(endRecord + 16, true);
  const entries = new Map<string, ZipPhotoEntry>();
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('O índice de fotos do TSE está incompleto.');
    }
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const fileName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength));
    const baseName = fileName.split('/').pop()?.toUpperCase() ?? '';
    if (/^F(?:BR|AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)\d+_DIV\.JPG$/.test(baseName)) {
      entries.set(baseName, {
        compression: view.getUint16(cursor + 10, true),
        compressedSize: view.getUint32(cursor + 20, true),
        localHeaderOffset: view.getUint32(cursor + 42, true),
      });
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function loadArchive(region: string): Promise<PhotoArchive> {
  const normalizedRegion = region.trim().toUpperCase();
  if (!VALID_REGIONS.has(normalizedRegion)) return Promise.reject(new Error('UF inválida para fotos do TSE.'));

  const existing = archivePromises.get(normalizedRegion);
  if (existing) return existing;

  const request = (async () => {
    const url = `/api/candidate-photos/foto_cand2026_${normalizedRegion}_div.zip`;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`O TSE respondeu com erro ${response.status} ao consultar as fotos.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, entries: indexArchive(bytes) };
  })();

  archivePromises.set(normalizedRegion, request);
  return request.catch((error: unknown) => {
    archivePromises.delete(normalizedRegion);
    throw error;
  });
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function extractJpeg(archive: PhotoArchive, entry: ZipPhotoEntry): Promise<Blob> {
  const view = viewOf(archive.bytes);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > archive.bytes.length || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error('A foto não pôde ser lida no arquivo oficial do TSE.');
  }
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressedBytes = archive.bytes.subarray(start, start + entry.compressedSize);

  if (entry.compression === 0) return new Blob([arrayBufferFor(compressedBytes)], { type: 'image/jpeg' });
  if (entry.compression !== 8 || typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador não oferece suporte à extração desta foto.');
  }

  const compressedBlob = new Blob([arrayBufferFor(compressedBytes)]);
  const rawDeflate = 'deflate-raw' as unknown as CompressionFormat;
  const stream = compressedBlob.stream().pipeThrough(new DecompressionStream(rawDeflate));
  return new Response(stream).blob();
}

export function getCandidatePhotoUrl(candidateId: string, region: string): Promise<string | null> {
  const id = candidateId.replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(id)) return Promise.resolve(null);

  const normalizedRegion = region.trim().toUpperCase();
  const cacheKey = `${normalizedRegion}:${id}`;
  const existing = photoPromises.get(cacheKey);
  if (existing) return existing;

  const request = loadArchive(normalizedRegion)
    .then(async (archive) => {
      const fileName = `F${normalizedRegion}${id}_div.jpg`.toUpperCase();
      const entry = archive.entries.get(fileName);
      if (!entry) return null;
      return URL.createObjectURL(await extractJpeg(archive, entry));
    })
    .catch(() => null);

  photoPromises.set(cacheKey, request);
  return request;
}
