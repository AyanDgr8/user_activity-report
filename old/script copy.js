// script.js

/* global axios */
const form = document.getElementById('filterForm');
const errorBox = document.getElementById('error');
const table = document.getElementById('reportTable');
const eventsTable = document.getElementById('eventsTable');
const csvBtn = document.getElementById('csvBtn');
const htmlBtn = document.getElementById('htmlBtn');
const eventsCsvBtn = document.getElementById('eventsCsvBtn');
let lastRecords = [];
let lastEvents = [];
let currentView = 'status';

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('is-hidden');
}
function clearError() {
  errorBox.classList.add('is-hidden');
  errorBox.textContent = '';
}

// Tab switching functionality
function showTab(tabName) {
  const statusTab = document.getElementById('statusTab');
  const eventsTab = document.getElementById('eventsTab');
  const statusView = document.getElementById('statusView');
  const eventsView = document.getElementById('eventsView');

  if (tabName === 'status') {
    statusTab.classList.add('is-active');
    eventsTab.classList.remove('is-active');
    statusView.classList.remove('is-hidden');
    eventsView.classList.add('is-hidden');
    currentView = 'status';
  } else {
    eventsTab.classList.add('is-active');
    statusTab.classList.remove('is-active');
    eventsView.classList.remove('is-hidden');
    statusView.classList.add('is-hidden');
    currentView = 'events';
  }
}

// Make showTab globally available
window.showTab = showTab;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  table.innerHTML = '<thead><tr><th>Loading agent status...</th></tr></thead>';
  eventsTable.innerHTML = '<thead><tr><th>Loading activity events...</th></tr></thead>';

  const account = document.getElementById('account').value.trim();
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const nameFilter = document.getElementById('nameFilter').value.trim();
  const extFilter = document.getElementById('extFilter').value.trim();

  try {
    // Fetch both agent status and activity events in parallel
    const [statusResponse, eventsResponse] = await Promise.all([
      axios.get('/api/agents', {
        params: {
          account,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          ...(nameFilter && { name: nameFilter }),
          ...(extFilter && { extension: extFilter })
        },
      }),
      axios.get('/api/agents/events', {
        params: {
          account,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
      })
    ]);

    // Process agent status data
    lastRecords = statusResponse.data.data || [];
    lastRecords = lastRecords.map(r => {
      if (r['First Login time'] && !r['First Login Time']) {
        r['First Login Time'] = r['First Login time'];
      }
      return r;
    });

    // Process activity events data
    lastEvents = eventsResponse.data || [];
    
    renderTable(lastRecords);
    renderEventsTable(lastEvents);
    
    csvBtn.disabled = htmlBtn.disabled = !lastRecords.length;
    eventsCsvBtn.disabled = !lastEvents.length;

  } catch (err) {
    console.error('Fetch error:', err);
    showError(err.response?.data?.error || err.message || 'Request failed');
    csvBtn.disabled = htmlBtn.disabled = eventsCsvBtn.disabled = true;
  }
});

function renderTable(records) {
  // Desired order & labels mapping
  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'extension', label: 'Extension' },
    { key: 'First Login Time', label: 'First Login Time' },
    { key: 'registered_time', label: 'Login Time' },
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

csvBtn.addEventListener('click', () => {
  if (!lastRecords.length) return;
  const rows = lastRecords.map(r => (
    [ 'name','extension','First Login Time','registered_time','not_available_time','wrap_up_time','hold_time',
      'not_available_detailed_report'].map(k => {
        const v = r[k];
        if (timeKeys.has(k)) return secondsToHMS(v);
        if (k === 'not_available_detailed_report' && typeof v === 'object') {
          return Object.entries(v).map(([t,sec])=>`${t}:${secondsToHMS(sec)}`).join('; ');
        }
        return v ?? '';
      })
  ).join(','));
  const csv = ['Name,Extension,First Login Time,Login Time,Not Available Time,Wrap Up Time,Hold Time,Custom States', ...rows].join('\n');
  downloadBlob(csv, 'agents.csv', 'text/csv');
});

htmlBtn.addEventListener('click', () => {
  if (!table.innerHTML) return;
  const html = `<table>${table.innerHTML}</table>`;
  downloadBlob(html, 'agents.html', 'text/html');
});

// Render activity events table
function renderEventsTable(events) {
  if (!events.length) {
    eventsTable.innerHTML = '<thead><tr><th>No activity events found</th></tr></thead>';
    return;
  }

  const headers = ['Event', 'Username', 'Extension', 'State', 'Timestamp', 'User ID', 'Enabled'];
  const headerRow = headers.map(h => `<th>${h}</th>`).join('');
  
  const rows = events.map(event => {
    const timestamp = event.timestamp ? formatTimestamp(event.timestamp) : 'N/A';
    return `
      <tr>
        <td>${event.event || 'N/A'}</td>
        <td>${event.username || 'N/A'}</td>
        <td>${event.ext || 'N/A'}</td>
        <td>${event.state || 'N/A'}</td>
        <td>${timestamp}</td>
        <td>${event.user_id || 'N/A'}</td>
        <td>${event.enabled ? 'Yes' : 'No'}</td>
      </tr>
    `;
  }).join('');

  eventsTable.innerHTML = `
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${rows}</tbody>
  `;
}

// Format timestamp (Unix timestamp to readable format)
function formatTimestamp(timestamp) {
  if (!timestamp) return 'N/A';
  
  // Handle both seconds and milliseconds timestamps
  const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ts);
  
  if (isNaN(date.getTime())) return 'Invalid Date';
  
  // Format as YYYY-MM-DD HH:mm:ss GST
  const gstOffset = 4 * 60 * 60 * 1000; // GST is UTC+4
  const gstDate = new Date(date.getTime() + gstOffset);
  
  return gstDate.toISOString().replace('T', ' ').substring(0, 19) + ' GST';
}

// Events CSV download
eventsCsvBtn.addEventListener('click', () => {
  if (!lastEvents.length) return;
  
  const headers = ['Event', 'Username', 'Extension', 'State', 'Timestamp', 'User_ID', 'Enabled'];
  const rows = lastEvents.map(event => [
    event.event || '',
    event.username || '',
    event.ext || '',
    event.state || '',
    event.timestamp ? formatTimestamp(event.timestamp) : '',
    event.user_id || '',
    event.enabled ? 'Yes' : 'No'
  ]);
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  
  const now = new Date();
  const filename = `agent_activity_events_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.csv`;
  downloadBlob(csvContent, filename, 'text/csv');
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
