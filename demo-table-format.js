// Demo script to show formatted agent events table
// Usage: node demo-table-format.js

/**
 * Convert Unix timestamp to dd/mm/yyyy, hh:mm:ss format
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} - Formatted date string
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000); // Convert to milliseconds
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

/**
 * Format agent events data into a properly aligned table
 * @param {object} responseData - The API response containing agent events
 * @returns {string} - Formatted table string
 */
function formatAgentEventsTable(responseData) {
  if (!responseData || !responseData.data || !Array.isArray(responseData.data)) {
    return 'No data available';
  }

  const data = responseData.data;
  
  // Define column headers and their display widths
  const headers = {
    event: 'Event',
    enabled: 'Enabled',
    user_id: 'User ID',
    ext: 'Ext',
    username: 'Username',
    state: 'State',
    timestamp: 'Timestamp'
  };

  // Calculate column widths based on content
  const columnWidths = {
    event: Math.max(headers.event.length, Math.max(...data.map(row => row.event?.length || 0))),
    enabled: Math.max(headers.enabled.length, 7), // 'true'/'false'
    user_id: Math.max(headers.user_id.length, Math.max(...data.map(row => row.user_id?.length || 0))),
    ext: Math.max(headers.ext.length, Math.max(...data.map(row => String(row.ext || '').length))),
    username: Math.max(headers.username.length, Math.max(...data.map(row => row.username?.length || 0))),
    state: Math.max(headers.state.length, Math.max(...data.map(row => row.state?.length || 0))),
    timestamp: Math.max(headers.timestamp.length, 19) // dd/mm/yyyy, hh:mm:ss
  };

  // Helper function to pad strings
  const pad = (str, width) => String(str || '').padEnd(width);

  // Create table header
  const headerRow = `| ${pad(headers.event, columnWidths.event)} | ${pad(headers.enabled, columnWidths.enabled)} | ${pad(headers.user_id, columnWidths.user_id)} | ${pad(headers.ext, columnWidths.ext)} | ${pad(headers.username, columnWidths.username)} | ${pad(headers.state, columnWidths.state)} | ${pad(headers.timestamp, columnWidths.timestamp)} |`;
  
  // Create separator row
  const separatorRow = `|${'-'.repeat(columnWidths.event + 2)}|${'-'.repeat(columnWidths.enabled + 2)}|${'-'.repeat(columnWidths.user_id + 2)}|${'-'.repeat(columnWidths.ext + 2)}|${'-'.repeat(columnWidths.username + 2)}|${'-'.repeat(columnWidths.state + 2)}|${'-'.repeat(columnWidths.timestamp + 2)}|`;

  // Create data rows
  const dataRows = data.map(row => {
    const formattedTimestamp = formatTimestamp(row.Timestamp);
    return `| ${pad(row.event, columnWidths.event)} | ${pad(row.enabled, columnWidths.enabled)} | ${pad(row.user_id, columnWidths.user_id)} | ${pad(row.ext, columnWidths.ext)} | ${pad(row.username, columnWidths.username)} | ${pad(row.state, columnWidths.state)} | ${pad(formattedTimestamp, columnWidths.timestamp)} |`;
  });

  // Combine all parts
  return [headerRow, separatorRow, ...dataRows].join('\n');
}

/**
 * Display agent events data in a formatted table
 * @param {object} responseData - The API response containing agent events
 */
function displayAgentEventsTable(responseData) {
  console.log('\n=== Agent Events Report ===');
  console.log(formatAgentEventsTable(responseData));
  console.log(`\nTotal Events: ${responseData?.data?.length || 0}`);
}

// Sample data from your request
const sampleData = {
  "data": [
    {
      "event": "agent_not_avail_state",
      "enabled": true,
      "user_id": "8f6a60f07d8b09cb2c28431917fc5a66",
      "ext": "1007",
      "username": "Prashant Rajput",
      "state": "Login",
      "Timestamp": 1753370100
    },
    {
      "event": "agent_not_avail_state",
      "enabled": false,
      "user_id": "8f6a60f07d8b09cb2c28431917fc5a66",
      "ext": "1007",
      "username": "Prashant Rajput",
      "state": "none",
      "Timestamp": 1753370100
    },
    {
      "event": "agent_not_avail_state",
      "enabled": true,
      "user_id": "8f6a60f07d8b09cb2c28431917fc5a66",
      "ext": "1007",
      "username": "Prashant Rajput",
      "state": "Login",
      "Timestamp": 1753370101
    },
    {
      "event": "agent_not_avail_state",
      "enabled": false,
      "user_id": "8f6a60f07d8b09cb2c28431917fc5a66",
      "ext": "1007",
      "username": "Prashant Rajput",
      "state": "none",
      "Timestamp": 1753370101
    },
    {
      "event": "agent_not_avail_state",
      "enabled": true,
      "user_id": "8f6a60f07d8b09cb2c28431917fc5a66",
      "ext": "1007",
      "username": "Prashant Rajput",
      "state": "Login",
      "Timestamp": 1753370102
    }
  ]
};

// Display the formatted table
displayAgentEventsTable(sampleData);

// Also show a few individual timestamp conversions as examples
console.log('\n=== Timestamp Conversion Examples ===');
console.log(`1753370100 → ${formatTimestamp(1753370100)}`);
console.log(`1753370150 → ${formatTimestamp(1753370150)}`);
