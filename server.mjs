import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const TSE_PHOTO_ARCHIVE_BASE = 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/';
const PHOTO_REGIONS = 'BR|AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO';
const PHOTO_ARCHIVE_PATH = new RegExp(`^/api/candidate-photos/(foto_cand2026_(?:${PHOTO_REGIONS})_div\\.zip)$`, 'i');

function sendJson(response, status, body, method = 'GET') {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(method === 'HEAD' ? undefined : payload);
}

const server = createServer(async (request, response) => {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD');
    sendJson(response, 405, { error: 'Método não permitido.' }, method);
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    sendJson(response, 400, { error: 'Caminho inválido.' }, method);
    return;
  }

  if (pathname === '/api/health') {
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
    return;
  }

  const match = PHOTO_ARCHIVE_PATH.exec(pathname);
  if (!match) {
    sendJson(response, 404, { error: 'Recurso não encontrado.' }, method);
    return;
  }

  const archiveName = match[1];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  response.on('close', () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(`${TSE_PHOTO_ARCHIVE_BASE}${archiveName}`, {
      method,
      headers: { accept: 'application/zip, application/octet-stream' },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status = upstream.status === 404 ? 404 : 502;
      sendJson(response, status, { error: 'Não foi possível consultar o arquivo oficial de fotos do TSE.' }, method);
      return;
    }

    response.writeHead(200, {
      'content-type': 'application/zip',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    });

    if (method === 'HEAD' || !upstream.body) {
      await upstream.body?.cancel();
      response.end();
      return;
    }

    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch {
    if (!response.headersSent) {
      sendJson(response, 502, { error: 'A fonte oficial de fotos do TSE está temporariamente indisponível.' }, method);
    } else {
      response.destroy();
    }
  } finally {
    clearTimeout(timeout);
  }
});

server.headersTimeout = 15_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Apura photo proxy listening on 0.0.0.0:${PORT}`);
});
