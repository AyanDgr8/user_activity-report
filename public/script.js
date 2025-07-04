// script.js

/* global axios */
const form = document.getElementById('filterForm');
const errorBox = document.getElementById('error');
const table = document.getElementById('reportTable');
const csvBtn = document.getElementById('csvBtn');
const htmlBtn = document.getElementById('htmlBtn');
let lastRecords = [];

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('is-hidden');
}
function clearError() {
  errorBox.classList.add('is-hidden');
  errorBox.textContent = '';
}

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

function renderTable(records) {
  // Desired order & labels mapping
  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'extension', label: 'Extension' },
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
