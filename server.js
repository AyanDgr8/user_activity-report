// server.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { fetchAgentStatus } from './agentStatus.js';
import { fetchAgentEvents, getAgentLoginLogoffTimes } from './agentEvents.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5556;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 ensures the server binds to all network interfaces
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Helper to resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

// GET /api/agents?account=mcint&start=ISO&end=ISO
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
    // Fetch agent status data
    const statusData = await fetchAgentStatus(account, { startDate, endDate });
    
    // Fetch agent events data to get login/logoff times
    const startTimestamp = Math.floor(startDate / 1000);
    const endTimestamp = Math.floor(endDate / 1000);
    
    let loginLogoffData = [];
    try {
      // Fetch all raw events (not filtered) by setting filterResults to false
      const allEventsData = await fetchAgentEvents(account, { 
        startDate: startTimestamp, 
        endDate: endTimestamp,
        filterResults: false
      });
      
      // Extract login/logoff times per agent
      loginLogoffData = getAgentLoginLogoffTimes(allEventsData || []);
    } catch (eventsErr) {
      console.warn('Could not fetch agent events for login/logoff data:', eventsErr.message);
      loginLogoffData = [];
    }
    
    // Merge status data with login/logoff data
    const enrichedData = statusData.map(agent => {
      // Find matching login/logoff data by extension
      const loginLogoffInfo = loginLogoffData.find(ll => 
        ll.ext === agent.extension || ll.username === agent.name
      );
      
      return {
        ...agent,
        first_login_time: loginLogoffInfo?.firstLoginTime || '',
        last_logoff_time: loginLogoffInfo?.lastLogoffTime || ''
      };
    });
    
    res.json({ data: enrichedData });
  } catch (err) {
    console.error(err.response?.data || err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events?account=mcint&startDate=1753251240&endDate=1753258440
app.get('/api/events', async (req, res) => {
  const { account = 'mcint', startDate, endDate, timeRange, pageSize } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Missing startDate or endDate query params' });
  }
  
  const start = parseInt(startDate);
  const end = parseInt(endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return res.status(400).json({ error: 'Invalid timestamp format for startDate or endDate' });
  }
  
  try {
    // Fetch all raw events (not filtered) to get login/logoff data
    const allEventsData = await fetchAgentEvents(account, { 
      startDate: start, 
      endDate: end,
      timeRange,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      filterResults: false
    });
    
    // Extract login/logoff times per agent
    const loginLogoffData = getAgentLoginLogoffTimes(allEventsData || []);
    
    res.json({ data: loginLogoffData });
  } catch (err) {
    console.error(err.response?.data || err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Web app running at ${PUBLIC_URL}`);
});