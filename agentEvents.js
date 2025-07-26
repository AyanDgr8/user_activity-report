// agentEvents.js
// Fetch Agent Activity Events for a tenant
//
// Usage examples:
//   node -r dotenv/config agentEvents.js mc_int 1753251240 1753258440
//
// The script automatically handles pagination, retries (exp backoff),
// and self-signed certificates (inherits httpsAgent from tokenService).

import axios from 'axios';
import { httpsAgent } from './tokenService.js';
import { displayAgentEventsTable } from './agentStatus.js';

const MAX_RETRIES = 3;

/**
 * Get token specifically for the UC events server with tenant subdomain
 * @returns {Promise<string>} access token
 */
async function getUCToken() {
  const baseUrl = `https://ucdemo.voicemeetme.com:9443`;
  
  const candidates = [
    { url: `${baseUrl}/api/v2/config/login/oauth`, body: { domain: process.env.TENANT, username: process.env.API_USERNAME, password: process.env.API_PASSWORD } },
    { url: `${baseUrl}/api/v2/login`, body: { domain: process.env.TENANT, username: process.env.API_USERNAME, password: process.env.API_PASSWORD } },
    { url: `${baseUrl}/api/login`, body: { domain: process.env.TENANT, username: process.env.API_USERNAME, password: process.env.API_PASSWORD } },
  ];

  for (const { url, body } of candidates) {
    for (let attempt = 0, delay = 1000; attempt < MAX_RETRIES; attempt++, delay *= 2) {
      try {
        const { data } = await axios.post(url, body, {
          timeout: 5000,
          httpsAgent,
          headers: { Accept: 'application/json' }
        });

        const access = data.accessToken || data.access_token;
        if (!access) throw new Error('No access token in response');

        console.log(` UC server login succeeded at ${url}`);
        return access;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          console.warn(`Login failed at ${url}: ${err.response?.status || err.message}`);
        } else {
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
  }
  throw new Error('All UC server login attempts failed – check credentials/endpoints');
}

/**
 * Filter events to show only the first login time for each user
 * @param {object[]} events - Array of all events
 * @returns {object[]} - Array of first login events per user
 */
function getFirstLoginPerUser(events) {
  console.log(`\n🔍 FILTERING EVENTS FOR FIRST LOGIN:`);
  console.log(`📊 Total events to process: ${events.length}`);
  
  const userFirstLogins = new Map();
  const allUsers = new Set();
  
  // Sort events by timestamp (earliest first)
  const sortedEvents = events
    .filter(event => event && event.Timestamp && event.username)
    .sort((a, b) => a.Timestamp - b.Timestamp);
  
  console.log(`📊 Events after basic filtering: ${sortedEvents.length}`);
  
  // Debug: Show all unique users in the dataset
  sortedEvents.forEach(event => {
    allUsers.add(`${event.username} (${event.ext})`);
  });
  console.log(`👥 All users found in events:`, Array.from(allUsers));
  
  // Find first login event for each user
  for (const event of sortedEvents) {
    const userId = event.username || event.user_id;
    
    // More inclusive login detection
    const isLoginEvent = event.state === 'Login' || 
                        event.event === 'agent_login' || 
                        event.event === 'login' ||
                        event.event === 'agent_avail_state' ||
                        event.event === 'agent_state_change' ||
                        (event.enabled === true && event.state) ||
                        (event.enabled === true && event.event);
    
    // Debug: Log first few events for each user
    if (!userFirstLogins.has(userId)) {
      console.log(`🔍 Checking first event for ${userId}:`, {
        event: event.event,
        state: event.state,
        enabled: event.enabled,
        timestamp: event.Timestamp,
        isLoginEvent
      });
    }
    
    if (isLoginEvent && !userFirstLogins.has(userId)) {
      userFirstLogins.set(userId, event);
      console.log(`✅ Found first login for ${userId}: ${event.event} - ${event.state}`);
    }
  }
  
  const result = Array.from(userFirstLogins.values());
  console.log(`🎯 Final result: ${result.length} first login events found`);
  
  return result;
}

/**
 * Filter events to show timestamps where agent state is "available" OR "Logoff" AND enabled is true
 * @param {object[]} events - Array of all events
 * @returns {object[]} - Array of enabled available/logoff state events with timestamps
 */
function getAvailableStateTimestamps(events) {
  console.log(`\n🔍 FILTERING FOR AVAILABLE & LOGOFF STATES (ENABLED ONLY):`);
  console.log(`📊 Total events to filter: ${events.length}`);
  
  // Filter for events where state is "available" OR "Logoff" AND enabled is true
  const targetEvents = events.filter(event => 
    event && 
    event.state && 
    (event.state.toLowerCase() === 'available' || event.state.toLowerCase() === 'logoff') &&
    event.enabled === true
  );
  
  console.log(`✅ Found ${targetEvents.length} events with state "available" or "Logoff" and enabled: true`);
  
  // Show breakdown by state type
  const availableEvents = targetEvents.filter(event => event.state.toLowerCase() === 'available');
  const logoffEvents = targetEvents.filter(event => event.state.toLowerCase() === 'logoff');
  console.log(`   📊 Available events: ${availableEvents.length}`);
  console.log(`   📊 Logoff events: ${logoffEvents.length}`);
  
  // Show how many were filtered out due to enabled: false or wrong state
  const allAvailableEvents = events.filter(event => 
    event && event.state && event.state.toLowerCase() === 'available'
  );
  const allLogoffEvents = events.filter(event => 
    event && event.state && event.state.toLowerCase() === 'logoff'
  );
  const disabledAvailableEvents = allAvailableEvents.length - availableEvents.length;
  const disabledLogoffEvents = allLogoffEvents.length - logoffEvents.length;
  
  if (disabledAvailableEvents > 0) {
    console.log(`⚠️  Filtered out ${disabledAvailableEvents} "available" events with enabled: false`);
  }
  if (disabledLogoffEvents > 0) {
    console.log(`⚠️  Filtered out ${disabledLogoffEvents} "Logoff" events with enabled: false`);
  }
  
  // Extract and format the results
  const results = targetEvents.map(event => ({
    username: event.username,
    ext: event.ext,
    user_id: event.user_id,
    event: event.event,
    state: event.state,
    timestamp: event.Timestamp,
    // Convert timestamp to IST for display
    timestampIST: new Date(event.Timestamp * 1000).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }),
    enabled: event.enabled
  }));
  
  // Sort results by timestamp for chronological order
  results.sort((a, b) => a.timestamp - b.timestamp);
  
  // Log the results for debugging
  if (results.length > 0) {
    console.log(`\n📋 ENABLED AVAILABLE & LOGOFF STATE EVENTS FOUND:`);
    results.forEach((event, index) => {
      console.log(`${index + 1}. ${event.username} (${event.ext}) - State: ${event.state} - Timestamp: ${event.timestamp} (${event.timestampIST}) - Enabled: ${event.enabled}`);
    });
  } else {
    console.log(`❌ No events found with state "available" or "Logoff" and enabled: true in the selected time range`);
  }
  
  return results;
}

/**
 * Extract first login and last logoff timestamps per agent for the given time range
 * @param {object[]} events - Array of all events
 * @returns {object} - Object with agent data containing first login and last logoff timestamps
 */
export function getAgentLoginLogoffTimes(events) {
  console.log(`\n🔍 EXTRACTING FIRST LOGIN & LAST LOGOFF TIMES PER AGENT:`);
  console.log(`📊 Total events to process: ${events.length}`);
  
  const agentData = new Map();
  
  // Process events to find login and logoff times per agent
  events.forEach(event => {
    if (!event || !event.user_id || !event.username || !event.ext) return;
    
    const agentKey = `${event.user_id}_${event.ext}`;
    
    if (!agentData.has(agentKey)) {
      agentData.set(agentKey, {
        user_id: event.user_id,
        username: event.username,
        ext: event.ext,
        firstLoginTime: null,
        firstLoginTimestamp: null,
        lastLogoffTime: null,
        lastLogoffTimestamp: null,
        loginEvents: [],
        logoffEvents: []
      });
    }
    
    const agent = agentData.get(agentKey);
    
    // Check for Login events (state: "Login" and enabled: true)
    if (event.state && event.state.toLowerCase() === 'login' && event.enabled === true) {
      agent.loginEvents.push({
        timestamp: event.Timestamp,
        timestampIST: new Date(event.Timestamp * 1000).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      });
    }
    
    // Check for Logoff events (state: "Logoff" and enabled: true)
    if (event.state && event.state.toLowerCase() === 'logoff' && event.enabled === true) {
      agent.logoffEvents.push({
        timestamp: event.Timestamp,
        timestampIST: new Date(event.Timestamp * 1000).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      });
    }
  });
  
  // Process each agent to find first login and last logoff
  agentData.forEach((agent, agentKey) => {
    // Sort login events by timestamp (ascending) to get first login
    if (agent.loginEvents.length > 0) {
      agent.loginEvents.sort((a, b) => a.timestamp - b.timestamp);
      const firstLogin = agent.loginEvents[0];
      agent.firstLoginTime = firstLogin.timestampIST;
      agent.firstLoginTimestamp = firstLogin.timestamp;
    }
    
    // Sort logoff events by timestamp (descending) to get last logoff
    if (agent.logoffEvents.length > 0) {
      agent.logoffEvents.sort((a, b) => b.timestamp - a.timestamp);
      const lastLogoff = agent.logoffEvents[0];
      agent.lastLogoffTime = lastLogoff.timestampIST;
      agent.lastLogoffTimestamp = lastLogoff.timestamp;
    }
    
    // Clean up temporary arrays
    delete agent.loginEvents;
    delete agent.logoffEvents;
  });
  
  const results = Array.from(agentData.values());
  
  // Log results for debugging
  console.log(`\n📋 AGENT LOGIN/LOGOFF SUMMARY:`);
  console.log(`👥 Total agents processed: ${results.length}`);
  
  results.forEach((agent, index) => {
    console.log(`${index + 1}. ${agent.username} (${agent.ext}):`);
    console.log(`   📅 First Login: ${agent.firstLoginTime || 'Not found'}`);
    console.log(`   📅 Last Logoff: ${agent.lastLogoffTime || 'Not found'}`);
  });
  
  return results;
}

/**
 * Fetch agent activity events, automatically traversing pages until completion.
 * @param {string} acct                         – tenant / account id.
 * @param {object} opts                         – query options.
 * @param {number} opts.startDate               – unix timestamp start of range.
 * @param {number} opts.endDate                 – unix timestamp end of range.
 * @param {string} [opts.timeRange]             – time range in format like 1d, 1w, 1h, etc.
 * @param {number} [opts.pageSize]              – number of records per page.
 * @param {string} [opts.startKey]              – start key for pagination.
 * @param {boolean} [opts.filterResults=true]   – whether to filter results or return raw events.
 * @returns {Promise<object[]>}                 – concatenated rows.
 */
export async function fetchAgentEvents(
  acct,
  { startDate, endDate, timeRange, pageSize = 1000, startKey, filterResults = true }
) {
  const token = await getUCToken(acct);
  
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'X-Account-ID': process.env.ACCOUNT_ID_HEADER || acct,
    'X-User-Agent': 'portal'
  };

  const params = {
    startDate: String(startDate),
    endDate: String(endDate)
  };

  // Add potential parameters that might be needed for all agents
  if (timeRange) params.timeRange = timeRange;
  if (pageSize) params.pageSize = pageSize;
  if (startKey) params.startKey = startKey;
  
  console.log(`🔍 API Parameters being sent:`, JSON.stringify(params, null, 2));

  const allRecords = [];
  let currentStartKey = startKey;

  // Try both tenant subdomain and base server URLs
  const possibleBaseUrls = [
    `https://${acct}.ucdemo.voicemeetme.com:9443`, // tenant subdomain
    `https://ucdemo.voicemeetme.com:9443` // base server
  ];
  
  // Try multiple possible endpoint paths
  const possibleEndpoints = [
    '/api/v2/reports/callcenter/agents/activity/events',
    '/api/v2/callcenter/agents/activity/events', 
    '/ucp/v2/callcenter/agents/activity/events',
    '/api/v2/reports/callcenter/agents/events',
    '/api/v2/callcenter/agents/events',
    '/api/v2/agents/activity/events',
    '/api/v2/agents/events',
    '/api/callcenter/agents/activity/events',
    '/api/callcenter/agents/events'
  ];

  let response;
  let successfulEndpoint = null;
  let successfulBaseUrl = null;

  do {
    if (currentStartKey) {
      params.startKey = currentStartKey;
    }

    // Try each base URL and endpoint combination until we find one that works
    for (const baseUrl of possibleBaseUrls) {
      console.log(`\n🌐 Trying base URL: ${baseUrl}`);
      
      for (const endpoint of possibleEndpoints) {
        console.log(`\n🔍 Trying endpoint: ${endpoint}`);
        
        for (let i = 0, delay = 1000; i < MAX_RETRIES; i++, delay *= 2) {
          try {
            const fullUrl = `${baseUrl}${endpoint}`;
            console.log(`🔍 Attempting API call to: ${fullUrl}`);
            console.log(`📋 Query params:`, params);
            console.log(`🔑 Headers:`, headers);
            
            response = await axios.get(fullUrl, { params, headers, timeout: 30000, httpsAgent });
            console.log(`✅ API call succeeded with status: ${response.status}`);
            successfulEndpoint = endpoint;
            successfulBaseUrl = baseUrl;
            break;
          } catch (err) {
            console.error(`❌ Attempt ${i + 1} failed:`, {
              status: err.response?.status,
              statusText: err.response?.statusText,
              url: err.config?.url,
              method: err.config?.method,
              responseData: err.response?.data
            });
            if (i === MAX_RETRIES - 1) {
              console.log(`❌ All attempts failed for ${baseUrl}${endpoint}`);
            } else {
              await new Promise(r => setTimeout(r, delay));
            }
          }
        }
        
        if (successfulEndpoint && successfulBaseUrl) {
          console.log(`🎉 Found working combination: ${successfulBaseUrl}${successfulEndpoint}`);
          break;
        }
      }
      
      if (successfulEndpoint && successfulBaseUrl) {
        break;
      }
    }
    
    if (!successfulEndpoint || !successfulBaseUrl) {
      throw new Error('All endpoint paths failed - no working agent events API found on tenant server');
    }

    const { data } = response;
    
    // Add comprehensive debugging
    console.log(`\n🔍 DEBUGGING API RESPONSE:`);
    console.log(`📊 Response status: ${response.status}`);
    console.log(`📋 Response headers:`, JSON.stringify(response.headers, null, 2));
    console.log(`📦 Raw response data type:`, typeof data);
    console.log(`📦 Raw response data:`, JSON.stringify(data, null, 2));
    
    if (Array.isArray(data)) {
      allRecords.push(...data);
      console.log(`📊 Fetched ${data.length} records (total so far: ${allRecords.length})`);
      
      // Debug: Show unique agents in this batch
      const agentsInBatch = new Set();
      const eventTypesInBatch = new Set();
      data.forEach(event => {
        if (event && event.username) {
          agentsInBatch.add(`${event.username} (${event.ext})`);
        }
        if (event && event.event) {
          eventTypesInBatch.add(event.event);
        }
      });
      console.log(`👥 Unique agents in this batch:`, Array.from(agentsInBatch));
      console.log(`🎯 Event types in this batch:`, Array.from(eventTypesInBatch));
      
      // Debug: Show sample events for each unique agent
      const samplesByAgent = new Map();
      data.forEach(event => {
        if (event && event.username && !samplesByAgent.has(event.username)) {
          samplesByAgent.set(event.username, {
            username: event.username,
            ext: event.ext,
            event: event.event,
            state: event.state,
            enabled: event.enabled,
            timestamp: event.Timestamp
          });
        }
      });
      console.log(`📋 Sample event for each agent:`, Object.fromEntries(samplesByAgent));
      
      // Debug: Analyze event structure for timestamp fields
      if (data.length > 0) {
        console.log(`\n🔍 EVENT STRUCTURE ANALYSIS:`);
        const firstEvent = data[0];
        console.log(`📋 All fields in first event:`, Object.keys(firstEvent));
        console.log(`📋 First event sample:`, JSON.stringify(firstEvent, null, 2));
        
        console.log(`\n⏰ TIMESTAMP FIELD ANALYSIS:`);
        console.log(`timestamp:`, firstEvent.timestamp);
        console.log(`time:`, firstEvent.time);
        console.log(`created_at:`, firstEvent.created_at);
        console.log(`event_time:`, firstEvent.event_time);
        console.log(`date:`, firstEvent.date);
        console.log(`created:`, firstEvent.created);
        console.log(`updated:`, firstEvent.updated);
        console.log(`event_date:`, firstEvent.event_date);
      }
    } else {
      console.log(`❌ Data is not an array:`, data);
    }

    // Check if there's more data (try multiple pagination indicators)
    currentStartKey = response.headers['x-next-start-key'] || 
                     response.headers['x-next-page-token'] ||
                     response.data?.nextPageToken ||
                     response.data?.pagination?.nextKey ||
                     null;
    
    // Break if no more pages or if we got less than pageSize records
    // Also break if we've fetched a reasonable maximum to prevent infinite loops
    if (!currentStartKey || 
        (Array.isArray(data) && data.length < pageSize) ||
        allRecords.length >= 10000) {
      console.log(`🏁 Pagination complete. Total records: ${allRecords.length}`);
      break;
    }
    
    console.log(`🔄 More pages available, continuing with startKey: ${currentStartKey}`);
  } while (currentStartKey);

  if (filterResults) {
    return getAvailableStateTimestamps(allRecords);
  } else {
    return allRecords;
  }
}

/**
 * CLI interface for testing
 */
async function cli() {
  const [, , acct, startDate, endDate, timeRange] = process.argv;
  if (!acct || !startDate || !endDate) {
    console.error('Usage: node agentEvents.js <account> <startDate> <endDate> [timeRange]');
    process.exit(1);
  }

  try {
    const events = await fetchAgentEvents(acct, {
      startDate: parseInt(startDate),
      endDate: parseInt(endDate),
      timeRange
    });
    displayAgentEventsTable(events);
  } catch (err) {
    console.error('Error fetching agent events:', err.message);
    process.exit(1);
  }
}

// Execute when run directly
if (import.meta.url === process.argv[1] || import.meta.url === `file://${process.argv[1]}`) {
  cli().catch(err => {
    console.error(err.response?.data || err.stack || err.message);
    process.exit(1);
  });
}
