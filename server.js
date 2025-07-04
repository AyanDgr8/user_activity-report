// server.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { fetchAgentStatus } from './agentStatus.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5555;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 ensures the server binds to all network interfaces
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Helper to resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

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
    res.json({ data });
  } catch (err) {
    console.error(err.response?.data || err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Web app running at ${PUBLIC_URL}`);
});
