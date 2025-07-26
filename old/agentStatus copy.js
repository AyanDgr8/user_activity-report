// agentStatus.js
// Fetch Agents Status & Activity report for a tenant and output to
// stdout (table) or write to a file (CSV or JSON).
//
// Usage examples:
//   node -r dotenv/config agentStatus.js mc_int 2025-07-02T08:00:00Z 2025-07-02T12:00:00Z
//   node -r dotenv/config agentStatus.js mc_int 2025-07-02T08:00:00Z 2025-07-02T12:00:00Z report.csv
//
// The script automatically handles pagination, retries (exp backoff),
// and self-signed certificates (inherits httpsAgent from tokenService).

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getPortalToken, httpsAgent } from './tokenService.js';

const MAX_RETRIES = 3;

// New constants for state history
const AVAILABLE_STATE_ID = '2dc22f830e444cf885e5724a804f51e9';

/**
 * Convert an array of plain objects to a CSV string.
 * Very small helper to avoid a new dependency.
 */
function toCsv(records, delimiter = ',') {
  if (!records.length) return '';
  const header = Object.keys(records[0]).join(delimiter);
  const rows = records.map(r =>
    Object.values(r)
      .map(v => {
        if (v == null) return '';
        const str = String(v);
        return str.includes(delimiter) || str.includes('\n') || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"` // escape quotes per RFC4180
          : str;
      })
      .join(delimiter)
  );
  return [header, ...rows].join('\n');
}

/**
 * Helper to format Unix ms to 'YYYY-MM-DD HH:mm' (24-hour)
 */
// Gulf Standard Time (GST) is UTC + 4 hours
function formatTs(ts) {
  const gstMs = ts + 4 * 60 * 60 * 1000; // add 4h
  const d = new Date(gstMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Retrieve the first time within the range that each agent entered the
 * AVAILABLE state.
 *
 * Returns a map keyed by extension with formatted timestamp strings.
 */
async function fetchFirstLoginMap(acct, { startDate, endDate }) {
  const url = `${process.env.BASE_URL}${process.env.STATE_HISTORY_ENDPOINT || '/ucp/v2/callcenter/agent/state'}`;
  const token = await getPortalToken(acct);
  const params = {
    startDate: Math.floor(startDate / 1000),
    endDate: Math.floor(endDate / 1000),
    state_id: AVAILABLE_STATE_ID,
  };

  try {
    const { data } = await axios.get(url, {
      params,
      headers: {
        'X-Account-ID': process.env.ACCOUNT_ID_HEADER ?? acct,
        'X-User-Agent': 'ucp',
        Authorization: `Bearer ${token}`,
      },
      httpsAgent,
    });

    console.log('State history response structure:', Object.keys(data || {}));
    
    // Handle different possible response formats
    /** @type {Record<string,string>} */
    const firstMap = {};
    
    if (Array.isArray(data)) {
      // Format: array of events
      for (const ev of data) {
        if (!ev || ev.state_id !== AVAILABLE_STATE_ID) continue;
        const ext = ev.extension ?? ev.userId ?? ev.id;
        if (!ext) continue;
        const ts = (ev.timestamp ?? ev.time ?? 0) * (ev.timestamp < 1e12 ? 1000 : 1); // sec→ms if needed
        if (!firstMap[ext] || ts < firstMap[ext]) {
          firstMap[ext] = ts;
        }
      }
    } else if (data && typeof data === 'object') {
      // Format: object with nested data
      const events = data.data || data.events || data.items || [];
      if (Array.isArray(events)) {
        for (const ev of events) {
          if (!ev || ev.state_id !== AVAILABLE_STATE_ID) continue;
          const ext = ev.extension ?? ev.userId ?? ev.id;
          if (!ext) continue;
          const ts = (ev.timestamp ?? ev.time ?? 0) * (ev.timestamp < 1e12 ? 1000 : 1);
          if (!firstMap[ext] || ts < firstMap[ext]) {
            firstMap[ext] = ts;
          }
        }
      } else if (typeof events === 'object') {
        // Format: object keyed by extension/userId
        for (const [ext, info] of Object.entries(events)) {
          if (!info || info.state_id !== AVAILABLE_STATE_ID) continue;
          const ts = (info.timestamp ?? info.time ?? 0) * (info.timestamp < 1e12 ? 1000 : 1);
          if (!firstMap[ext] || ts < firstMap[ext]) {
            firstMap[ext] = ts;
          }
        }
      }
    }
    
    // Format
    for (const key of Object.keys(firstMap)) {
      firstMap[key] = formatTs(firstMap[key]);
    }
    
    console.log(`Found first login times for ${Object.keys(firstMap).length} agents`);
    return firstMap;
  } catch (err) {
    console.warn('Failed to fetch first-login map:', err.response?.status || err.message);
    return {};
  }
}

/**
 * Directly monitors the state change API for the AVAILABLE state.
 * This function will make a request to the specific state change endpoint
 * and capture the timestamp from the response headers.
 * 
 * @param {string} acct - The account ID
 * @param {object} options - Options for the request
 * @param {number} options.startDate - Start date in Unix ms
 * @param {number} options.endDate - End date in Unix ms
 * @returns {Promise<object>} - Map of extensions to their first login times
 */
async function monitorStateChangeApi(acct, { startDate, endDate }) {
  const stateUrl = `${process.env.BASE_URL}/ucp/v2/callcenter/agent/state/${AVAILABLE_STATE_ID}`;
  const token = await getPortalToken(acct);
  
  try {
    // Make a HEAD request to check the headers without changing state
    const response = await axios.head(stateUrl, {
      headers: {
        'X-Account-ID': process.env.ACCOUNT_ID_HEADER ?? acct,
        'X-User-Agent': 'ucp',
        Authorization: `Bearer ${token}`,
      },
      httpsAgent,
      validateStatus: status => status < 500, // Accept any non-server error status
    });
    
    // Extract the date from response headers
    const dateHeader = response.headers.date;
    if (!dateHeader) {
      console.warn('No date header found in response');
      return {};
    }
    
    // Parse the date header
    const timestamp = new Date(dateHeader);
    const timestampMs = timestamp.getTime();
    
    // Check if the timestamp is within the requested range
    if (timestampMs < startDate || timestampMs > endDate) {
      console.log(`State change timestamp ${dateHeader} is outside requested range`);
      return {};
    }
    
    console.log(`Found state change to AVAILABLE at ${dateHeader}`);
    
    // Format the timestamp
    const formattedTime = formatTs(timestampMs);
    
    // Since we don't know the extension from this request, we'll return a special key
    // that can be matched with extensions later
    return {
      '_all_agents': formattedTime
    };
  } catch (err) {
    console.warn('Failed to monitor state change API:', err.response?.status || err.message);
    return {};
  }
}

/**
 * Fetch the report, automatically traversing pages until completion.
 * @param {string} acct                         – tenant / account id.
 * @param {object} opts                         – query options.
 * @param {number} opts.startDate               – unix ms start of range.
 * @param {number} opts.endDate                 – unix ms end of range.
 * @param {string} [opts.name]                  – filter by agent name.
 * @param {string} [opts.extension]             – filter by extension.
 * @returns {Promise<object[]>}                 – concatenated rows.
 */
export async function fetchAgentStatus(
  acct,
  { startDate, endDate, name, extension } = {}
) {
  // Use env-configurable endpoint; fall back to the common REST path.
  const url = `${process.env.BASE_URL}${process.env.AGENT_STATUS_ENDPOINT || '/api/v2/reports/callcenter/agents/stats'}`;
  const records = [];
  let startKey;

  retry: for (let attempt = 0, delay = 1_000; attempt < MAX_RETRIES; attempt++, delay *= 2) {
    try {
      while (true) {
        const params = {
          startDate: Math.floor(startDate / 1000),
          endDate: Math.floor(endDate / 1000),
          ...(name && { name }),
          ...(extension && { extension }),
          ...(startKey && { start_key: startKey })
        };

        // Obtain JWT once and log the first 40 chars for debugging
        const token = await getPortalToken(acct);
        console.log('REQ', url, params, {
          'X-Account-ID': process.env.ACCOUNT_ID_HEADER ?? acct,
          'X-User-Agent': 'portal',
          Authorization: `Bearer ${token ? token.slice(0,40) + '…' : 'undefined'}`
        });

        const { data } = await axios.get(url, {
          params,
          headers: {
            'X-Account-ID': process.env.ACCOUNT_ID_HEADER ?? acct,
            'X-User-Agent': 'portal',
            Authorization: `Bearer ${token}`
          },
          httpsAgent
        });

        let chunk;
        const ensureExt = r => ({
          extension: r.extension ?? r.ext ?? r.userId ?? r.user_id ?? r.id ?? '',
          ...r
        });

        if (Array.isArray(data.data)) {
          chunk = data.data.map(ensureExt);
        } else if (data && typeof data === 'object') {
          // Newer portal returns an object keyed by extension/userId
          // Preserve the key (extension) by merging it into each record
          chunk = Object.entries(data).map(([ext, info]) => ensureExt({ extension: ext, ...info }));
        } else {
          console.error('Unexpected API payload; dumping full response:', JSON.stringify(data, null, 2));
          throw new Error('Unrecognised API response format');
        }
        records.push(...chunk);
        if (!data.next_start_key) break;
        startKey = data.next_start_key; // continue to next page
      }
      break retry; // success
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      console.warn(`Request failed (${err.message}); retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Try to get first login times from state history API first
  let firstLoginMap = await fetchFirstLoginMap(acct, { startDate, endDate });
  
  // If that fails, try the direct monitoring approach
  if (Object.keys(firstLoginMap).length === 0) {
    console.log('Falling back to direct state change monitoring');
    firstLoginMap = await monitorStateChangeApi(acct, { startDate, endDate });
  }
  
  // Apply first login times to records
  for (const rec of records) {
    if (rec && rec.extension && firstLoginMap[rec.extension]) {
      rec["First Login time"] = firstLoginMap[rec.extension];
    }
  }

  return records;
}
