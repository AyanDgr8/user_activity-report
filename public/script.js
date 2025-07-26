// script.js

/* global axios */
const form = document.getElementById('filterForm');
const eventsForm = document.getElementById('eventsForm');
const errorBox = document.getElementById('error');
const eventsErrorBox = document.getElementById('eventsError');
const table = document.getElementById('reportTable');
const eventsResponse = document.getElementById('eventsResponse');
const csvBtn = document.getElementById('csvBtn');
const htmlBtn = document.getElementById('htmlBtn');
let lastRecords = [];

// Set default datetime values on page load
document.addEventListener('DOMContentLoaded', function() {
  // Set default time range (last 2 hours)
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000));
  
  // Format for datetime-local input (YYYY-MM-DDTHH:MM)
  const formatForInput = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };
  
  // Set default values for both forms
  document.getElementById('start').value = formatForInput(twoHoursAgo);
  document.getElementById('end').value = formatForInput(now);
  document.getElementById('eventsStart').value = formatForInput(twoHoursAgo);
  document.getElementById('eventsEnd').value = formatForInput(now);

  // Tab switching functionality
  const tabLinks = document.querySelectorAll('.tabs li');
  const tabContents = document.querySelectorAll('.tab-content');

  tabLinks.forEach(tab => {
    tab.addEventListener('click', function() {
      const targetTab = this.getAttribute('data-tab');
      
      // Remove active class from all tabs and contents
      tabLinks.forEach(t => t.classList.remove('is-active'));
      tabContents.forEach(content => content.classList.remove('is-active'));
      
      // Add active class to clicked tab and corresponding content
      this.classList.add('is-active');
      document.getElementById(targetTab + '-tab').classList.add('is-active');
    });
  });
});

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('is-hidden');
}

function clearError() {
  errorBox.classList.add('is-hidden');
  errorBox.textContent = '';
}

function showEventsError(msg) {
  eventsErrorBox.textContent = msg;
  eventsErrorBox.classList.remove('is-hidden');
}

function clearEventsError() {
  eventsErrorBox.classList.add('is-hidden');
  eventsErrorBox.textContent = '';
}

// Agent Status Form Handler (existing functionality)
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  table.innerHTML = '<thead><tr><th>Loading…</th></tr></thead>';

  const account = document.getElementById('account').value.trim();
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;

  try {
    const { data } = await axios.get('/api/agents', {
      params: {
        account,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      },
    });
    lastRecords = data.data || [];
    renderTable(lastRecords);
    csvBtn.disabled = htmlBtn.disabled = !lastRecords.length;
  } catch (err) {
    console.error(err);
    showError(err.response?.data?.error || err.message);
    table.innerHTML = '';
  }
});

// Agent Events Form Handler (new functionality)
eventsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearEventsError();
  eventsResponse.style.display = 'block';
  eventsResponse.textContent = 'Loading events...';

  const account = document.getElementById('eventsAccount').value.trim();
  const start = document.getElementById('eventsStart').value;
  const end = document.getElementById('eventsEnd').value;

  // Validate that dates are selected
  if (!start || !end) {
    showEventsError('Please select both start and end dates');
    eventsResponse.style.display = 'none';
    return;
  }

  // Convert datetime-local to Unix timestamps
  // datetime-local input gives us local time (IST), JavaScript Date handles timezone correctly
  const startDate = new Date(start);
  const endDate = new Date(end);
  
  // Validate dates
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    showEventsError('Invalid date format');
    eventsResponse.style.display = 'none';
    return;
  }
  
  if (startDate >= endDate) {
    showEventsError('Start date must be before end date');
    eventsResponse.style.display = 'none';
    return;
  }

  // Convert to Unix timestamps (JavaScript automatically handles local timezone to UTC conversion)
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  console.log('Event request timestamps (UTC for API):', { 
    startTimestamp, 
    endTimestamp, 
    startDate: startDate.toISOString(), 
    endDate: endDate.toISOString(),
    originalStart: start,
    originalEnd: end
  });

  const params = {
    account,
    startDate: startTimestamp,
    endDate: endTimestamp
  };

  try {
    const { data } = await axios.get('/api/events', { params });
    
    // Debug: Log the complete API response structure
    console.log('=== FULL API RESPONSE DEBUG ===');
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data && data.events && data.events.length > 0) {
      console.log('=== FIRST EVENT SAMPLE ===');
      console.log('First event:', JSON.stringify(data.events[0], null, 2));
      console.log('Available keys in first event:', Object.keys(data.events[0]));
      
      console.log('=== TIMESTAMP FIELD ANALYSIS ===');
      const firstEvent = data.events[0];
      console.log('timestamp field:', firstEvent.timestamp);
      console.log('time field:', firstEvent.time);
      console.log('created_at field:', firstEvent.created_at);
      console.log('event_time field:', firstEvent.event_time);
      console.log('date field:', firstEvent.date);
    }
    
    // Render the events data in a table format
    renderEventsTable(data);
    
    // Log to console as well for debugging
    console.log('Agent Events Response:', data);
    
  } catch (err) {
    console.error('Events API Error:', err);
    showEventsError(err.response?.data?.error || err.message);
    eventsResponse.style.display = 'none';
  }
});

function renderTable(records) {
  // Desired order & labels mapping
  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'extension', label: 'Extension' },
    { key: 'registered_time', label: 'Login Time' },
    { key: 'first_login_time', label: 'First Login Time' },
    { key: 'last_logoff_time', label: 'Last LogOff Time' },
    { key: 'not_available_time', label: 'Not Available Time' },
    { key: 'wrap_up_time', label: 'Wrap Up Time' },
    { key: 'hold_time', label: 'Hold Time' },
    { key: 'not_available_detailed_report', label: 'Custom States' },
  ];

  if (!records.length) {
    table.innerHTML = '<thead><tr><th>No records</th></tr></thead>';
    return;
  }
  const thead = `<thead><tr>${cols.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead>`;
  const tbodyRows = records.map(rec => {
    return `<tr>${cols.map(c => formatCell(rec[c.key], c.key)).join('')}</tr>`;
  });
  table.innerHTML = `${thead}<tbody>${tbodyRows.join('')}</tbody>`;
  lastRecords = records;
  csvBtn.disabled = false;
  htmlBtn.disabled = false;
}

function renderEventsTable(data) {
  if (!data) {
    eventsResponse.innerHTML = '<div class="notification is-danger">No data received</div>';
    return;
  }

  // Handle different possible data structures
  let events = [];
  if (Array.isArray(data)) {
    events = data;
  } else if (data.events && Array.isArray(data.events)) {
    events = data.events;
  } else if (data.data && Array.isArray(data.data)) {
    events = data.data;
  } else {
    // If it's not an array, show the raw data structure in a formatted way
    eventsResponse.innerHTML = `
      <div class="notification is-info">
        <strong>Response Structure:</strong>
        <pre style="background: #f5f5f5; padding: 10px; margin-top: 10px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(data, null, 2)}</pre>
      </div>
    `;
    return;
  }

  if (events.length === 0) {
    eventsResponse.innerHTML = '<div class="notification is-warning">No agent login/logoff data found for the specified time range</div>';
    return;
  }

  // Create table with only the 4 requested columns
  const tableHeaders = ['Agent Name', 'Extension', 'First Login Time', 'Last LogOff Time'];
  
  let tableHTML = `
    <div class="notification is-success">
      <strong>Agent Login/LogOff Summary</strong> - Showing first login and last logoff times for each agent in the selected time range
    </div>
    <div class="notification is-info is-light">
      <strong>Summary:</strong> Found ${events.length} agent(s) with login/logoff activity in the selected time range
    </div>
    <div class="table-container">
      <table class="table is-striped is-hoverable is-fullwidth">
        <thead>
          <tr>
            ${tableHeaders.map(header => `<th>${header}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;
  
  // Sort events by agent name for better display
  const sortedEvents = events.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
  
  // Add each agent's login/logoff data as a separate row
  sortedEvents.forEach(agent => {
    if (!agent || typeof agent !== 'object') return;
    
    const username = agent.username || 'N/A';
    const ext = agent.ext || agent.extension || 'N/A';
    const firstLoginTime = agent.firstLoginTime || '';
    const lastLogoffTime = agent.lastLogoffTime || '';
    
    tableHTML += `
      <tr>
        <td><strong>${username}</strong></td>
        <td><span class="tag is-info">${ext}</span></td>
        <td>${firstLoginTime ? `<span class="tag is-success">${firstLoginTime}</span>` : '<span class="tag is-light">No Login</span>'}</td>
        <td>${lastLogoffTime ? `<span class="tag is-warning">${lastLogoffTime}</span>` : '<span class="tag is-light">No Logoff</span>'}</td>
      </tr>
    `;
  });
  
  tableHTML += `
        </tbody>
      </table>
    </div>
    <div class="notification is-info is-light">
      <strong>Note:</strong> Times are displayed in IST (Indian Standard Time). Empty cells indicate no login/logoff events found for that agent in the selected time range.
    </div>
  `;
  
  eventsResponse.innerHTML = tableHTML;
  eventsResponse.style.display = 'block';
}

// Helper function to format timestamps consistently
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

// Helper function to format timestamps to IST timezone
function formatTimestampToIST(timestamp) {
  if (!timestamp || timestamp === 0) {
    return 'N/A';
  }
  
  // Debug: Log timestamp conversion details
  console.log(` Converting timestamp: ${timestamp}`);
  
  // Convert Unix timestamp to JavaScript Date object
  const date = new Date(timestamp * 1000);
  console.log(` UTC Date: ${date.toISOString()}`);
  console.log(` IST Date (built-in): ${date.toLocaleString("en-IN", {timeZone: "Asia/Kolkata"})}`);
  
  // Use JavaScript's built-in timezone conversion for IST
  const options = {
    timeZone: "Asia/Kolkata",
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  
  const istString = date.toLocaleString("en-GB", options);
  console.log(` Formatted IST: ${istString}`);
  
  // Parse the formatted string to get individual components
  const [datePart, timePart] = istString.split(', ');
  const [day, month, year] = datePart.split('/');
  const [hours, minutes, seconds] = timePart.split(':');
  
  const result = `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
  console.log(` Final result: ${result}`);
  
  return result;
}

// Helper function to format boolean values with tags
function formatBoolean(value) {
  if (value === true || value === 'true') {
    return '<span class="tag is-success is-small">Yes</span>';
  } else if (value === false || value === 'false') {
    return '<span class="tag is-danger is-small">No</span>';
  } else {
    return '<span class="tag is-light is-small">N/A</span>';
  }
}

const timeKeys = new Set(['registered_time','not_available_time','wrap_up_time','hold_time','on_call_time']);

function formatCell(val, key) {
  if (val == null) return '<td></td>';
  if (typeof val === 'object') {
    return `<td>${Object.entries(val).map(([k,v])=>`${k}: ${secondsToHMS(v)}`).join('<br>')}</td>`;
  }
  if (timeKeys.has(key)) {
    return `<td>${secondsToHMS(val)}</td>`;
  }
  return `<td>${val}</td>`;
}

function formatHeaderName(header) {
  return header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatEventCell(value, key) {
  if (value == null || value === undefined) {
    return '<span class="has-text-grey-light">—</span>';
  }
  
  if (key === 'timestamp') {
    const date = new Date(value * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
  }
  
  if (key === 'enabled') {
    return value === true || value === 'true' ? 
      '<span class="tag is-success">true</span>' : 
      '<span class="tag is-light">false</span>';
  }
  
  if (typeof value === 'object') {
    return Object.entries(value).map(([k,v])=>`${k}: ${v}`).join('<br>');
  }
  
  return String(value);
}

csvBtn.addEventListener('click', () => {
  if (!lastRecords.length) return;
  const rows = lastRecords.map(r => (
    [ 'name','extension','registered_time','not_available_time','wrap_up_time','hold_time',
      'not_available_detailed_report'].map(k => {
        const v = r[k];
        if (timeKeys.has(k)) return secondsToHMS(v);
        if (k === 'not_available_detailed_report' && typeof v === 'object') {
          return Object.entries(v).map(([t,sec])=>`${t}:${secondsToHMS(sec)}`).join('; ');
        }
        return v ?? '';
      })
  ).join(','));
  const csv = ['Name,Extension,Login Time,Not Available Time,Wrap Up Time,Hold Time,Custom States', ...rows].join('\n');
  downloadBlob(csv, 'agents.csv', 'text/csv');
});

htmlBtn.addEventListener('click', () => {
  if (!table.innerHTML) return;
  const html = `<table>${table.innerHTML}</table>`;
  downloadBlob(html, 'agents.html', 'text/html');
});

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function secondsToHMS(sec) {
  const total = parseInt(sec, 10);
  const days = Math.floor(total / 86400);
  const rem = total % 86400;
  const h = Math.floor(rem / 3600).toString().padStart(2, '0');
  const m = Math.floor((rem % 3600) / 60).toString().padStart(2, '0');
  const s = (rem % 60).toString().padStart(2, '0');
  return days ? `${days} day${days > 1 ? 's' : ''} ${h}:${m}:${s}` : `${h}:${m}:${s}`;
}