// server.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { fetchAgentStatus } from './agentStatus.js';
import axios from 'axios';
import bodyParser from 'body-parser';
import { httpsAgent, getPortalToken } from './tokenService.js';
import { createProxyMiddleware } from 'http-proxy-middleware';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5555;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 ensures the server binds to all network interfaces
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Helper to resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store agent state changes with timestamps
const agentStateChanges = new Map();
const AVAILABLE_STATE_ID = '18f56f25d9624a18ab11024b20f7b7ad';

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.text());

// Generic reverse proxy for all /ucp traffic to the upstream PBX
app.use('/ucp', createProxyMiddleware({
  target: process.env.BASE_URL,
  changeOrigin: true,
  secure: false, // allow self-signed if PBX uses it
  logLevel: process.env.DEBUG ? 'debug' : 'warn',
  onProxyRes(proxyRes, req) {
    // Capture first login time on AVAILABLE state PUT
    if (req.method === 'PUT' && /^\/ucp\/v2\/callcenter\/agent\/state\//.test(req.originalUrl)) {
      const dateHeader = proxyRes.headers.date;
      const urlParts = req.originalUrl.split('/');
      const stateId = urlParts[urlParts.length - 1].split('?')[0];
      if (stateId === AVAILABLE_STATE_ID && dateHeader) {
        // Try to read extension from query string
        let extKey;
        try {
          const q = new URL(`http://dummy${req.originalUrl}`).searchParams;
          extKey = q.get('extension');
        } catch (_) { /* ignore */ }
        extKey = extKey || '_all_agents';
        if (!agentStateChanges.has(extKey)) {
          const ts = new Date(dateHeader);
          const formatted = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
          agentStateChanges.set(extKey, [{ stateId, timestamp: ts, formattedTime: formatted }]);
          console.log(`Proxy captured first login for ${extKey}: ${formatted}`);
        }
      }
    }
  },
}));

// GET /api/agents?account=mc_int&start=ISO&end=ISO
app.get('/api/agents', async (req, res) => {
  const { account, start, end } = req.query;
  if (!account || !start || !end) {
    return res.status(400).json({ error: 'Missing account, start or end query params' });
  }
  const startDate = Date.parse(start);
  const endDate = Date.parse(end);
  if (Number.isNaN(startDate) || Number.isNaN(endDate)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  try {
    const data = await fetchAgentStatus(account, { startDate, endDate });
    
    // Enrich data with state change timestamps from our tracking
    for (const agent of data) {
      const extension = agent.extension;
      if (extension && agentStateChanges.has(extension)) {
        const stateChanges = agentStateChanges.get(extension);
        
        // Find the first state change within the requested time range
        const firstInRange = stateChanges
          .filter(change => {
            const changeTime = new Date(change.timestamp).getTime();
            return changeTime >= startDate && changeTime <= endDate;
          })
          .reduce((min, cur) => (!min || cur.timestamp < min.timestamp ? cur : min), null);
        
        if (firstInRange) {
          agent["First Login Time"] = firstInRange.formattedTime;
        }
      }
    }
    
    res.json({ data });
  } catch (err) {
    console.error(err.response?.data || err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});


// Proxy endpoint to track state changes
app.put('/api/track-state/:stateId', async (req, res) => {
  const { stateId } = req.params;
  const { extension } = req.query;

  if (!extension) {
    return res.status(400).json({ error: 'Extension query param is required' });
  }

  // Only handle the AVAILABLE state; other states are simply proxied
  const upstreamUrl = `${process.env.BASE_URL}/ucp/v2/callcenter/agent/state/${stateId}`;

  try {
    // Always obtain a fresh portal token – safer than trusting caller headers
    const acct = process.env.ACCOUNT_ID_HEADER;
    const token = await getPortalToken(acct);

    const upstreamRes = await axios.put(
      upstreamUrl,
      null,
      {
        headers: {
          'X-Account-ID': acct,
          'X-User-Agent': 'ucp',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent,
        validateStatus: s => s < 500,
      }
    );

    // Forward upstream response to caller regardless of tracking logic
    res.status(upstreamRes.status).set(upstreamRes.headers).send(upstreamRes.data);

    // Only record if this is the AVAILABLE state
    if (stateId === AVAILABLE_STATE_ID) {
      const dateHeader = upstreamRes.headers.date;
      const ts = dateHeader ? new Date(dateHeader) : new Date();

      // Keep only the earliest record per extension
      if (!agentStateChanges.has(extension)) {
        const formatted = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
        agentStateChanges.set(extension, [{ stateId, timestamp: ts, formattedTime: formatted }]);
        console.log(`Captured FIRST login for ${extension} at ${formatted}`);
      }
    }
  } catch (err) {
    console.error('Upstream state change failed:', err.message);
    return res.status(502).json({ error: 'Failed to reach upstream state API' });
  }
});

// Transparent proxy for UCP state changes so existing clients need no URL change
app.put('/ucp/v2/callcenter/agent/state/:stateId', async (req, res) => {
  const { stateId } = req.params;
  const { extension: queryExt } = req.query; // optional, else derive from body

  const upstreamUrl = `${process.env.BASE_URL}/ucp/v2/callcenter/agent/state/${stateId}`;

  try {
    const acct = process.env.ACCOUNT_ID_HEADER;
    const token = await getPortalToken(acct);

    const upstreamRes = await axios.put(upstreamUrl, req.body, {
      headers: {
        ...req.headers, // forward caller headers (may include body-specific headers)
        'X-Account-ID': acct,
        'X-User-Agent': 'ucp',
        Authorization: `Bearer ${token}`,
      },
      httpsAgent,
      validateStatus: s => s < 500,
    });

    // Relay upstream response
    res.status(upstreamRes.status).set(upstreamRes.headers).send(upstreamRes.data);

    // Capture first-login timestamp (Date header) only for AVAILABLE state
    if (stateId === AVAILABLE_STATE_ID) {
      const dateHeader = upstreamRes.headers.date;
      if (dateHeader) {
        const ts = new Date(dateHeader);
        // Derive extension: priority query param > JSON body field > form key > fallback
        let extKey = queryExt;
        if (!extKey) {
          if (req.is('application/json') && typeof req.body === 'object') {
            extKey = req.body.extension || req.body.ext || req.body.userId || req.body.id;
          } else if (typeof req.body === 'string') {
            try {
              const parsed = JSON.parse(req.body);
              extKey = parsed.extension || parsed.ext || parsed.userId || parsed.id;
            } catch (_) { /* ignore invalid json */ }
          }
        }
        extKey = extKey || '_all_agents';

        if (!agentStateChanges.has(extKey)) {
          const formatted = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
          agentStateChanges.set(extKey, [{ stateId, timestamp: ts, formattedTime: formatted }]);
          console.log(`Transparent proxy captured first login for ${extKey}: ${formatted}`);
        }
      }
    }
  } catch (err) {
    console.error('Transparent proxy error:', err.message);
    res.status(502).json({ error: 'Upstream state API failed' });
  }
});

// API endpoint to get tracked state changes
app.get('/api/state-changes', (req, res) => {
  const { start, end } = req.query;
  const startDate = start ? new Date(start).getTime() : 0;
  const endDate = end ? new Date(end).getTime() : Date.now();
  
  const result = {};
  
  for (const [extension, changes] of agentStateChanges.entries()) {
    const filteredChanges = changes.filter(change => {
      const changeTime = new Date(change.timestamp).getTime();
      return changeTime >= startDate && changeTime <= endDate;
    });
    
    if (filteredChanges.length > 0) {
      result[extension] = filteredChanges;
    }
  }
  
  res.json(result);
});

app.listen(PORT, HOST, () => {
  console.log(`Web app running at ${PUBLIC_URL}`);
});
