const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MERCADONA_API_BASE = 'https://tienda.mercadona.es/api/v1/search/';

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // Usamos una forma más robusta de parsear la URL
  const requestUrl = new URL(req.url, 'http://localhost');
  const cleanPath = requestUrl.pathname.replace(/\/+$/, ''); // Quita barras al final

  if (cleanPath !== '/mercadona' && cleanPath !== 'mercadona') {
    console.log(`[Proxy] Ruta no reconocida: ${requestUrl.pathname}`);
    return sendJson(res, 404, { error: 'Usa /mercadona?q=...' });
  }

  const query = requestUrl.searchParams.get('q');
  if (!query) {
    return sendJson(res, 400, { error: 'Parámetro q obligatorio' });
  }

  console.log(`[Proxy] Buscando en Mercadona: "${query}"...`);

  const targetUrl = new URL(MERCADONA_API_BASE);
  targetUrl.searchParams.set('query', query);
  targetUrl.searchParams.set('limit', '1');

  console.log(`[Proxy] Solicitando a Mercadona: ${targetUrl.href}`);

  const options = {
    hostname: targetUrl.hostname,
    path: targetUrl.pathname + targetUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Origin': 'https://tienda.mercadona.es',
      'Referer': 'https://tienda.mercadona.es/',
      'Cache-Control': 'no-cache',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cookie': 'warehouse=vlc1', // Importante: Mercadona necesita contexto de almacén
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    }
  };

  https.get(options, (proxyRes) => {
    const contentEncoding = proxyRes.headers['content-encoding'];
    let bodyStream;

    if (contentEncoding === 'gzip') {
      bodyStream = proxyRes.pipe(zlib.createGunzip());
    } else if (contentEncoding === 'deflate') {
      bodyStream = proxyRes.pipe(zlib.createInflate());
    } else if (contentEncoding === 'br') {
      bodyStream = proxyRes.pipe(zlib.createBrotliDecompress());
    } else {
      bodyStream = proxyRes;
    }

    let body = [];
    bodyStream.on('data', chunk => { body.push(chunk); });
    bodyStream.on('end', () => {
      console.log(`[Proxy] Respuesta de Mercadona recibida (${proxyRes.statusCode})`);
      const finalBody = Buffer.concat(body).toString('utf8');
      
      try {
        if (proxyRes.statusCode >= 400) {
            console.error(`[Proxy Error] Mercadona respondió con error ${proxyRes.statusCode}`);
            return sendJson(res, proxyRes.statusCode, { error: 'Error API Mercadona', status: proxyRes.statusCode });
        }

        const json = JSON.parse(finalBody || '{}');
        sendJson(res, proxyRes.statusCode, json);
      } catch (e) {
        console.error(`[Proxy Error] Fallo al parsear JSON. Longitud body: ${finalBody.length}`);
        sendJson(res, 502, { error: 'Respuesta no válida de Mercadona', html: finalBody.slice(0, 500) });
      }
    });
  }).on('error', (err) => {
    console.error(`[Proxy Error] ${err.message}`);
    sendJson(res, 502, { error: 'Error de conexión', details: err.message });
  });
});

server.listen(PORT, () => {
  console.log('====================================');
  console.log(`Proxy Mercadona OK en puerto ${PORT}`);
  console.log('====================================');
});