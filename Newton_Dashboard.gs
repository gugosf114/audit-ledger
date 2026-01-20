/**
 * Newton_Dashboard.gs - Visual Compliance Dashboard
 *
 * PURPOSE: Deployable Web App dashboard showing real-time
 * compliance metrics, AI usage, and audit status.
 *
 * DEPLOYMENT:
 * 1. Deploy > New Deployment > Web App
 * 2. Execute as: Me
 * 3. Who has access: Anyone (or Anyone with Google Account)
 * 4. Copy the web app URL
 *
 * AUTHOR: Newton AI Governance Platform
 * VERSION: 1.0.0
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

/**
 * Serves the HTML dashboard
 * @param {Object} e - Event parameter from web app
 * @returns {HtmlOutput} - The dashboard page
 */
function doGet(e) {
  const template = HtmlService.createTemplate(getDashboardHTML_());

  // Inject data into template
  const dashboardData = getDashboardData_();
  template.data = JSON.stringify(dashboardData);

  return template.evaluate()
    .setTitle('Newton AI Governance Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * API endpoint for refreshing dashboard data via AJAX
 * @param {Object} e - Event parameter
 * @returns {TextOutput} - JSON data
 */
function doPost(e) {
  try {
    const action = e.parameter.action;

    if (action === 'refresh') {
      const data = getDashboardData_();
      return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================================
// DATA COLLECTION
// ============================================================================

/**
 * Collect all dashboard metrics from ledger
 */
function getDashboardData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  // Default empty state
  const emptyData = {
    lastUpdated: new Date().toISOString(),
    complianceScore: 0,
    aiRequests: { total: 0, thisWeek: 0, byProvider: {}, byDay: [] },
    totalSpend: 0,
    openVoids: 0,
    openEscalations: 0,
    recentActivity: [],
    gapAnalysis: { covered: 0, total: 0, gaps: [] },
    tagCoverage: {}
  };

  if (!ledger || ledger.getLastRow() < 2) {
    return emptyData;
  }

  const data = ledger.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // Get column indices
  const cols = {
    uuid: headers.indexOf('UUID'),
    timestamp: headers.indexOf('Timestamp'),
    eventType: headers.indexOf('Event_Type') !== -1 ? headers.indexOf('Event_Type') : headers.indexOf('Event Type'),
    actor: headers.indexOf('Actor'),
    action: headers.indexOf('Action'),
    target: headers.indexOf('Target'),
    details: headers.indexOf('Details'),
    signal: headers.indexOf('Signal'),
    tags: headers.indexOf('Regulatory_Tags')
  };

  // Time boundaries
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Initialize counters
  let aiRequestsTotal = 0;
  let aiRequestsThisWeek = 0;
  let totalSpend = 0;
  let openVoids = 0;
  let openEscalations = 0;
  const byProvider = {};
  const byDay = {};
  const recentActivity = [];
  const tagCoverage = {
    'ISO_42001': new Set(),
    'EU_AI_ACT': new Set(),
    'NIST_AI_RMF': new Set()
  };

  // Process rows
  for (const row of rows) {
    const timestamp = new Date(row[cols.timestamp]);
    const eventType = row[cols.eventType] || '';
    const actor = row[cols.actor] || '';
    const action = row[cols.action] || '';
    const target = row[cols.target] || '';
    const signal = row[cols.signal] || '';
    const tags = row[cols.tags] || '';

    let details = {};
    try {
      details = JSON.parse(row[cols.details] || '{}');
    } catch (e) {}

    // Count AI proxy requests
    if (eventType === 'AI_PROXY_REQUEST' || signal === 'AI_REQUEST') {
      aiRequestsTotal++;
      totalSpend += details.cost_usd || 0;

      if (timestamp >= weekAgo) {
        aiRequestsThisWeek++;
      }

      // By provider
      const provider = details.provider || 'unknown';
      byProvider[provider] = (byProvider[provider] || 0) + 1;

      // By day (last 7 days)
      if (timestamp >= weekAgo) {
        const dayKey = timestamp.toISOString().split('T')[0];
        byDay[dayKey] = (byDay[dayKey] || 0) + 1;
      }
    }

    // Count VOIDs
    if (eventType === 'VOID_DETECTED' || signal === 'VOID_DETECTED') {
      if (details.status === 'OPEN' || !details.status) {
        openVoids++;
      }
    }

    // Count escalations
    if (eventType === 'ESCALATED' || signal === 'ESCALATED') {
      if (details.status !== 'RESOLVED') {
        openEscalations++;
      }
    }

    // Track tag coverage
    if (tags) {
      const tagMatches = tags.match(/(ISO_42001|EU_AI_ACT|NIST_AI_RMF):([^\s,]+)/g) || [];
      for (const match of tagMatches) {
        const [framework, clause] = match.split(':');
        if (tagCoverage[framework]) {
          tagCoverage[framework].add(clause);
        }
      }
    }

    // Recent activity (last 10 from past month)
    if (timestamp >= monthAgo && recentActivity.length < 10) {
      recentActivity.push({
        timestamp: timestamp.toISOString(),
        eventType: eventType,
        actor: actor,
        action: action,
        target: target,
        signal: signal
      });
    }
  }

  // Sort recent activity by timestamp (newest first)
  recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Calculate compliance score
  const requiredClauses = {
    'ISO_42001': 24,
    'EU_AI_ACT': 21,
    'NIST_AI_RMF': 19
  };

  let totalCovered = 0;
  let totalRequired = 0;
  const tagCoverageStats = {};

  for (const [framework, clauses] of Object.entries(tagCoverage)) {
    const covered = clauses.size;
    const required = requiredClauses[framework] || 0;
    totalCovered += covered;
    totalRequired += required;
    tagCoverageStats[framework] = {
      covered: covered,
      required: required,
      percentage: required > 0 ? Math.round((covered / required) * 100) : 0
    };
  }

  const complianceScore = totalRequired > 0 ? Math.round((totalCovered / totalRequired) * 100) : 0;

  // Build gap analysis summary
  const gaps = [];
  for (const [framework, stats] of Object.entries(tagCoverageStats)) {
    if (stats.covered < stats.required) {
      gaps.push({
        framework: framework,
        missing: stats.required - stats.covered,
        percentage: stats.percentage
      });
    }
  }

  // Convert byDay to sorted array for chart
  const byDayArray = Object.entries(byDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Fill in missing days
  const filledByDay = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateKey = d.toISOString().split('T')[0];
    const existing = byDayArray.find(x => x.date === dateKey);
    filledByDay.push({
      date: dateKey,
      count: existing ? existing.count : 0,
      label: d.toLocaleDateString('en-US', { weekday: 'short' })
    });
  }

  return {
    lastUpdated: now.toISOString(),
    complianceScore: complianceScore,
    aiRequests: {
      total: aiRequestsTotal,
      thisWeek: aiRequestsThisWeek,
      byProvider: byProvider,
      byDay: filledByDay
    },
    totalSpend: Math.round(totalSpend * 100) / 100,
    openVoids: openVoids,
    openEscalations: openEscalations,
    recentActivity: recentActivity.slice(0, 10),
    gapAnalysis: {
      covered: totalCovered,
      total: totalRequired,
      gaps: gaps
    },
    tagCoverage: tagCoverageStats
  };
}

// ============================================================================
// HTML TEMPLATE
// ============================================================================

function getDashboardHTML_() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newton AI Governance Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #e0e0e0;
      padding: 20px;
    }

    .dashboard {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header .subtitle {
      font-size: 14px;
      color: #888;
      margin-top: 5px;
    }

    .last-updated {
      font-size: 12px;
      color: #666;
    }

    .refresh-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .refresh-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
    }

    .refresh-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .metric-card {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255,255,255,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .metric-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }

    .metric-card.alert {
      border-color: #dc3545;
      background: rgba(220, 53, 69, 0.1);
    }

    .metric-card.success {
      border-color: #28a745;
      background: rgba(40, 167, 69, 0.1);
    }

    .metric-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #888;
      margin-bottom: 10px;
    }

    .metric-value {
      font-size: 36px;
      font-weight: 700;
      color: #fff;
    }

    .metric-value.alert {
      color: #dc3545;
    }

    .metric-value.success {
      color: #28a745;
    }

    .metric-value.warning {
      color: #ffc107;
    }

    .metric-detail {
      font-size: 13px;
      color: #888;
      margin-top: 8px;
    }

    .compliance-ring {
      position: relative;
      width: 100px;
      height: 100px;
      margin: 0 auto 10px;
    }

    .compliance-ring svg {
      transform: rotate(-90deg);
    }

    .compliance-ring .bg {
      fill: none;
      stroke: rgba(255,255,255,0.1);
      stroke-width: 8;
    }

    .compliance-ring .progress {
      fill: none;
      stroke: url(#gradient);
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dashoffset 1s ease;
    }

    .compliance-ring .value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 24px;
      font-weight: 700;
    }

    .content-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 20px;
    }

    @media (max-width: 900px) {
      .content-grid {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .panel-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 20px;
      color: #fff;
    }

    .chart-container {
      height: 200px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
      padding-top: 20px;
    }

    .chart-bar-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }

    .chart-bar {
      width: 100%;
      max-width: 40px;
      background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
      border-radius: 4px 4px 0 0;
      transition: height 0.5s ease;
      min-height: 4px;
    }

    .chart-label {
      font-size: 11px;
      color: #666;
      margin-top: 8px;
    }

    .chart-value {
      font-size: 12px;
      color: #888;
      margin-bottom: 5px;
    }

    .activity-feed {
      max-height: 400px;
      overflow-y: auto;
    }

    .activity-item {
      display: flex;
      align-items: flex-start;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;
      font-size: 14px;
      flex-shrink: 0;
    }

    .activity-icon.request { background: rgba(102, 126, 234, 0.2); }
    .activity-icon.void { background: rgba(255, 193, 7, 0.2); }
    .activity-icon.escalation { background: rgba(220, 53, 69, 0.2); }
    .activity-icon.other { background: rgba(108, 117, 125, 0.2); }

    .activity-content {
      flex: 1;
      min-width: 0;
    }

    .activity-title {
      font-size: 13px;
      color: #fff;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .activity-meta {
      font-size: 11px;
      color: #666;
    }

    .gap-list {
      list-style: none;
    }

    .gap-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }

    .gap-item:last-child {
      border-bottom: none;
    }

    .gap-framework {
      font-size: 13px;
      color: #fff;
    }

    .gap-bar {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      margin: 0 15px;
      overflow: hidden;
    }

    .gap-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      border-radius: 3px;
      transition: width 0.5s ease;
    }

    .gap-percentage {
      font-size: 13px;
      color: #888;
      min-width: 45px;
      text-align: right;
    }

    .provider-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 15px;
    }

    .provider-badge {
      background: rgba(255,255,255,0.1);
      padding: 8px 14px;
      border-radius: 20px;
      font-size: 12px;
    }

    .provider-badge .count {
      font-weight: 600;
      color: #667eea;
      margin-left: 5px;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #666;
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 15px;
    }

    ::-webkit-scrollbar {
      width: 6px;
    }

    ::-webkit-scrollbar-track {
      background: rgba(255,255,255,0.05);
      border-radius: 3px;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.2);
      border-radius: 3px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.3);
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <div>
        <h1>Newton AI Governance</h1>
        <p class="subtitle">Real-time Compliance Dashboard</p>
      </div>
      <div style="text-align: right;">
        <button class="refresh-btn" onclick="refreshData()" id="refreshBtn">Refresh</button>
        <p class="last-updated" id="lastUpdated">Loading...</p>
      </div>
    </div>

    <!-- SVG Gradient Definition -->
    <svg width="0" height="0">
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#667eea"/>
          <stop offset="100%" style="stop-color:#764ba2"/>
        </linearGradient>
      </defs>
    </svg>

    <!-- Top Metrics -->
    <div class="metrics-grid">
      <div class="metric-card" id="complianceCard">
        <div class="metric-label">Compliance Score</div>
        <div class="compliance-ring">
          <svg viewBox="0 0 100 100">
            <circle class="bg" cx="50" cy="50" r="42"/>
            <circle class="progress" cx="50" cy="50" r="42"
                    stroke-dasharray="264"
                    stroke-dashoffset="264"
                    id="complianceRing"/>
          </svg>
          <span class="value" id="complianceValue">0%</span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-label">AI Requests (This Week)</div>
        <div class="metric-value" id="aiRequestsWeek">0</div>
        <div class="metric-detail" id="aiRequestsTotal">0 total all-time</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Total Spend</div>
        <div class="metric-value">$<span id="totalSpend">0.00</span></div>
        <div class="metric-detail">All-time AI costs</div>
      </div>

      <div class="metric-card" id="voidsCard">
        <div class="metric-label">Open VOIDs</div>
        <div class="metric-value" id="openVoids">0</div>
        <div class="metric-detail">Compliance gaps requiring attention</div>
      </div>

      <div class="metric-card" id="escalationsCard">
        <div class="metric-label">Open Escalations</div>
        <div class="metric-value" id="openEscalations">0</div>
        <div class="metric-detail">Incidents under review</div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="content-grid">
      <div class="panel">
        <div class="panel-title">AI Requests (Last 7 Days)</div>
        <div class="chart-container" id="requestsChart">
          <!-- Chart bars will be inserted here -->
        </div>
        <div class="provider-list" id="providerList">
          <!-- Provider badges will be inserted here -->
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Framework Coverage</div>
        <ul class="gap-list" id="gapList">
          <!-- Gap items will be inserted here -->
        </ul>
      </div>
    </div>

    <div class="content-grid" style="margin-top: 20px;">
      <div class="panel">
        <div class="panel-title">Recent Activity</div>
        <div class="activity-feed" id="activityFeed">
          <!-- Activity items will be inserted here -->
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Quick Stats</div>
        <div id="quickStats">
          <!-- Quick stats will be inserted here -->
        </div>
      </div>
    </div>
  </div>

  <script>
    // Initial data from server
    let dashboardData = JSON.parse('<?= data ?>');

    function renderDashboard(data) {
      // Last updated
      const updated = new Date(data.lastUpdated);
      document.getElementById('lastUpdated').textContent =
        'Updated: ' + updated.toLocaleTimeString();

      // Compliance score
      const score = data.complianceScore;
      document.getElementById('complianceValue').textContent = score + '%';
      const circumference = 264;
      const offset = circumference - (score / 100) * circumference;
      document.getElementById('complianceRing').style.strokeDashoffset = offset;

      // Update compliance card color
      const compCard = document.getElementById('complianceCard');
      compCard.className = 'metric-card ' + (score >= 70 ? 'success' : score >= 40 ? '' : 'alert');

      // AI Requests
      document.getElementById('aiRequestsWeek').textContent =
        data.aiRequests.thisWeek.toLocaleString();
      document.getElementById('aiRequestsTotal').textContent =
        data.aiRequests.total.toLocaleString() + ' total all-time';

      // Total spend
      document.getElementById('totalSpend').textContent =
        data.totalSpend.toFixed(2);

      // VOIDs
      const voids = data.openVoids;
      document.getElementById('openVoids').textContent = voids;
      document.getElementById('openVoids').className =
        'metric-value ' + (voids > 0 ? 'alert' : 'success');
      document.getElementById('voidsCard').className =
        'metric-card ' + (voids > 0 ? 'alert' : 'success');

      // Escalations
      const esc = data.openEscalations;
      document.getElementById('openEscalations').textContent = esc;
      document.getElementById('openEscalations').className =
        'metric-value ' + (esc > 0 ? 'alert' : 'success');
      document.getElementById('escalationsCard').className =
        'metric-card ' + (esc > 0 ? 'alert' : 'success');

      // Requests chart
      renderChart(data.aiRequests.byDay);

      // Provider badges
      renderProviders(data.aiRequests.byProvider);

      // Gap analysis
      renderGaps(data.tagCoverage);

      // Activity feed
      renderActivity(data.recentActivity);

      // Quick stats
      renderQuickStats(data);
    }

    function renderChart(byDay) {
      const container = document.getElementById('requestsChart');
      if (!byDay || byDay.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div>No data yet</div>';
        return;
      }

      const maxCount = Math.max(...byDay.map(d => d.count), 1);

      container.innerHTML = byDay.map(day => {
        const height = (day.count / maxCount) * 150;
        return \`
          <div class="chart-bar-wrapper">
            <span class="chart-value">\${day.count}</span>
            <div class="chart-bar" style="height: \${Math.max(height, 4)}px"></div>
            <span class="chart-label">\${day.label}</span>
          </div>
        \`;
      }).join('');
    }

    function renderProviders(byProvider) {
      const container = document.getElementById('providerList');
      const entries = Object.entries(byProvider || {});

      if (entries.length === 0) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = entries
        .sort((a, b) => b[1] - a[1])
        .map(([provider, count]) => \`
          <div class="provider-badge">
            \${provider}<span class="count">\${count}</span>
          </div>
        \`).join('');
    }

    function renderGaps(tagCoverage) {
      const container = document.getElementById('gapList');
      const frameworks = Object.entries(tagCoverage || {});

      if (frameworks.length === 0) {
        container.innerHTML = '<li class="empty-state">No coverage data</li>';
        return;
      }

      container.innerHTML = frameworks.map(([framework, stats]) => \`
        <li class="gap-item">
          <span class="gap-framework">\${framework.replace(/_/g, ' ')}</span>
          <div class="gap-bar">
            <div class="gap-bar-fill" style="width: \${stats.percentage}%"></div>
          </div>
          <span class="gap-percentage">\${stats.percentage}%</span>
        </li>
      \`).join('');
    }

    function renderActivity(activities) {
      const container = document.getElementById('activityFeed');

      if (!activities || activities.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div>No recent activity</div>';
        return;
      }

      container.innerHTML = activities.map(a => {
        const icon = getActivityIcon(a.eventType, a.signal);
        const time = new Date(a.timestamp);
        const timeStr = time.toLocaleDateString() + ' ' + time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        return \`
          <div class="activity-item">
            <div class="activity-icon \${icon.class}">\${icon.emoji}</div>
            <div class="activity-content">
              <div class="activity-title">\${a.action || a.eventType}</div>
              <div class="activity-meta">\${a.actor} • \${timeStr}</div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function getActivityIcon(eventType, signal) {
      if (eventType === 'AI_PROXY_REQUEST' || signal === 'AI_REQUEST') {
        return { emoji: '🤖', class: 'request' };
      }
      if (eventType === 'VOID_DETECTED' || signal === 'VOID_DETECTED') {
        return { emoji: '⚠️', class: 'void' };
      }
      if (eventType === 'ESCALATED' || signal === 'ESCALATED') {
        return { emoji: '🚨', class: 'escalation' };
      }
      return { emoji: '📝', class: 'other' };
    }

    function renderQuickStats(data) {
      const container = document.getElementById('quickStats');

      const totalGaps = data.gapAnalysis.gaps.reduce((sum, g) => sum + g.missing, 0);

      container.innerHTML = \`
        <div style="margin-bottom: 20px;">
          <div class="metric-label">Total Framework Clauses</div>
          <div style="font-size: 24px; font-weight: 600; color: #fff;">
            \${data.gapAnalysis.covered} / \${data.gapAnalysis.total}
          </div>
          <div class="metric-detail">clauses documented</div>
        </div>
        <div style="margin-bottom: 20px;">
          <div class="metric-label">Outstanding Gaps</div>
          <div style="font-size: 24px; font-weight: 600; color: \${totalGaps > 0 ? '#ffc107' : '#28a745'};">
            \${totalGaps}
          </div>
          <div class="metric-detail">clauses need coverage</div>
        </div>
        <div>
          <div class="metric-label">Frameworks Tracked</div>
          <div style="font-size: 24px; font-weight: 600; color: #fff;">3</div>
          <div class="metric-detail">ISO 42001, EU AI Act, NIST AI RMF</div>
        </div>
      \`;
    }

    function refreshData() {
      const btn = document.getElementById('refreshBtn');
      btn.disabled = true;
      btn.textContent = 'Loading...';

      // For web app, we reload the page to get fresh data
      // In a production app, you might use google.script.run
      window.location.reload();
    }

    // Initial render
    renderDashboard(dashboardData);
  </script>
</body>
</html>`;
}

// ============================================================================
// UI MENU FUNCTION
// ============================================================================

/**
 * Open dashboard in new browser tab
 */
function openDashboard() {
  const ui = SpreadsheetApp.getUi();

  // Check if already deployed
  const deploymentUrl = PropertiesService.getDocumentProperties().getProperty('DASHBOARD_URL');

  if (deploymentUrl) {
    ui.alert(
      'Dashboard Available',
      `Your dashboard is deployed at:\n\n${deploymentUrl}\n\n` +
      'Open this URL in your browser to view the dashboard.',
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      'Deploy Dashboard',
      'To use the dashboard:\n\n' +
      '1. Go to Extensions > Apps Script\n' +
      '2. Click "Deploy" > "New deployment"\n' +
      '3. Select type: "Web app"\n' +
      '4. Set "Execute as": Me\n' +
      '5. Set "Who has access": Anyone\n' +
      '6. Click "Deploy"\n' +
      '7. Copy the web app URL\n\n' +
      'The URL will be your live dashboard.',
      ui.ButtonSet.OK
    );
  }
}

/**
 * Store deployment URL after manual deploy
 */
function setDashboardUrl() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Set Dashboard URL',
    'Enter the deployed web app URL:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const url = response.getResponseText().trim();
    PropertiesService.getDocumentProperties().setProperty('DASHBOARD_URL', url);
    ui.alert('URL saved! You can now share this dashboard link.');
  }
}

/**
 * Preview dashboard data (for testing)
 */
function previewDashboardData() {
  const data = getDashboardData_();
  Logger.log(JSON.stringify(data, null, 2));

  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'Dashboard Data Preview',
    `Compliance Score: ${data.complianceScore}%\n` +
    `AI Requests (Week): ${data.aiRequests.thisWeek}\n` +
    `Total Spend: $${data.totalSpend}\n` +
    `Open VOIDs: ${data.openVoids}\n` +
    `Open Escalations: ${data.openEscalations}\n` +
    `Recent Activities: ${data.recentActivity.length}\n\n` +
    'Full data logged to Apps Script console.',
    ui.ButtonSet.OK
  );
}
