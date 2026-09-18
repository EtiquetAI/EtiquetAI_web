const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const LOG_FILE = path.join(__dirname, 'codes.log.json');

function appendLog(entry) {
  let arr = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8') || '[]');
    }
  } catch (e) {
    arr = [];
  }
  arr.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(arr, null, 2));
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    // CORS preflight
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/qr') {
    try {
      const body = await readBody(req);
      const json = body ? JSON.parse(body) : {};
      const code = json.code;
      const timestamp = json.timestamp || new Date().toISOString();
      if (!code) return sendJSON(res, 400, { error: 'missing code' });
      const entry = { code, timestamp };
      appendLog(entry);
      console.log('Received QR:', entry);
      return sendJSON(res, 200, { ok: true, entry });
    } catch (e) {
      return sendJSON(res, 500, { error: 'invalid json' });
    }
  }

  if (req.method === 'GET' && req.url === '/logs') {
    try {
      const arr = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8') || '[]') : [];
      return sendJSON(res, 200, arr);
    } catch (e) {
      return sendJSON(res, 500, { error: 'failed to read logs' });
    }
  }

  // default
  sendJSON(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`QR backend listening on http://localhost:${PORT}`));
