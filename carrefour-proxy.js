const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const CARREFOUR_API_BASE = 'https://www.carrefour.es/global-api/v1/search-service/queries';

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
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (requestUrl.pathname !== '/carrefour') {
    return sendJson(res, 404, { error: 'Endpoint no encontrado. Usa /carrefour?q=...' });
  }

  const query = requestUrl.searchParams.get('q');
  const rows = requestUrl.searchParams.get('rows') || '1';

  if (!query) {
    return sendJson(res, 400, { error: 'Parámetro q obligatorio' });
  }

  const targetUrl = `${CARREFOUR_API_BASE}?q=${encodeURIComponent(query)}&rows=${encodeURIComponent(rows)}`;

  const parsedUrl = new URL(targetUrl);
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Accept-Encoding': 'identity', // Forzamos a que no comprima para que https.get pueda leerlo fácil
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.carrefour.es/',
      'Origin': 'https://www.carrefour.es',
      'Connection': 'keep-alive',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin'
    }
  };

  https.get(options, (proxyRes) => {
    const { statusCode } = proxyRes;
    let body = '';

    proxyRes.setEncoding('utf8');
    proxyRes.on('data', chunk => { body += chunk; });
    proxyRes.on('end', () => {
      if (statusCode !== 200) {
        console.error(`[Carrefour API Error] Status: ${statusCode} for query: ${query}`);
        if (body.includes('<html')) {
          console.error(`[Carrefour API Full Response]: La respuesta es HTML (posible bloqueo/captcha)`);
        } else {
          console.error(`[Carrefour API Full Response]: ${body}`);
        }
        return sendJson(res, 502, {
          error: 'Error en Carrefour API',
          statusCode,
          body: body.slice(0, 2000),
        });
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end(body);
    });
  }).on('error', (err) => {
    sendJson(res, 502, { error: 'Error de proxy', message: err.message });
  });
});

server.listen(PORT, () => {
  console.log(`Proxy Carrefour escuchando en http://localhost:${PORT}`);
  console.log(`Usa /carrefour?q=EAN&rows=1`);
});
