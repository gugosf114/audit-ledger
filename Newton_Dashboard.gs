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
    lastEventTime: null,
    complianceScore: 0,
    aiRequests: { total: 0, thisWeek: 0, byProvider: {}, byDay: [] },
    totalSpend: 0,
    openVoids: 0,
    openEscalations: 0,
    voidDetails: [],
    escalationDetails: [],
    recentActivity: [],
    gapAnalysis: { covered: 0, total: 0, gaps: [] },
    tagCoverage: {},
    integrityHash: null
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
  const voidDetails = [];
  const escalationDetails = [];
  let lastEventTime = null;
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

    // Count VOIDs and collect details
    if (eventType === 'VOID_DETECTED' || signal === 'VOID_DETECTED') {
      if (details.status === 'OPEN' || !details.status) {
        openVoids++;
        voidDetails.push({
          target: target,
          details: typeof row[cols.details] === 'string' ? row[cols.details] : JSON.stringify(details),
          timestamp: timestamp.toISOString(),
          actor: actor
        });
      }
    }

    // Count escalations and collect details
    if (eventType === 'ESCALATED' || signal === 'ESCALATED') {
      if (details.status !== 'RESOLVED') {
        openEscalations++;
        escalationDetails.push({
          action: action,
          target: target,
          timestamp: timestamp.toISOString(),
          actor: actor
        });
      }
    }

    // Track last event time for pulse indicator
    if (!lastEventTime || timestamp > new Date(lastEventTime)) {
      lastEventTime = timestamp.toISOString();
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

  // Get workflow data (wrapped in try-catch in case Newton_Workflow.gs not loaded)
  let workflowData = { activeCount: 0, totalBlocked: 0, workflows: [] };
  try {
    if (typeof getWorkflowDashboardData === 'function') {
      workflowData = getWorkflowDashboardData();
    }
  } catch (e) {
    Logger.log('Workflow data not available: ' + e.message);
  }

  return {
    lastUpdated: now.toISOString(),
    lastEventTime: lastEventTime,
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
    voidDetails: voidDetails.slice(0, 10),
    escalationDetails: escalationDetails.slice(0, 10),
    recentActivity: recentActivity.slice(0, 10),
    gapAnalysis: {
      covered: totalCovered,
      total: totalRequired,
      gaps: gaps
    },
    tagCoverage: tagCoverageStats,
    integrityHash: calculateLedgerHash_(),
    workflowData: workflowData
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

    /* ========== RED BUTTON - MANUAL OVERRIDE FAB ========== */
    .override-fab {
      position: fixed;
      bottom: 30px;
      right: 30px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(220, 53, 69, 0.5);
      transition: transform 0.2s, box-shadow 0.2s;
      z-index: 1000;
    }

    .override-fab:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 30px rgba(220, 53, 69, 0.7);
    }

    .override-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      z-index: 1001;
      align-items: center;
      justify-content: center;
    }

    .override-modal.active {
      display: flex;
    }

    .override-form {
      background: #1e2a3a;
      border-radius: 16px;
      padding: 30px;
      width: 90%;
      max-width: 500px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .override-form h3 {
      margin-bottom: 20px;
      color: #dc3545;
      font-size: 20px;
    }

    .override-form label {
      display: block;
      margin-bottom: 5px;
      color: #888;
      font-size: 12px;
      text-transform: uppercase;
    }

    .override-form input,
    .override-form select,
    .override-form textarea {
      width: 100%;
      padding: 12px;
      margin-bottom: 15px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
    }

    .override-form textarea {
      min-height: 100px;
      resize: vertical;
    }

    .override-form .btn-row {
      display: flex;
      gap: 10px;
      margin-top: 10px;
    }

    .override-form button {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }

    .override-form .btn-cancel {
      background: rgba(255,255,255,0.1);
      color: #888;
    }

    .override-form .btn-submit {
      background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
      color: white;
    }

    /* ========== LIVE PULSE INDICATOR ========== */
    .pulse-container {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-right: 15px;
    }

    .pulse-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #28a745;
      position: relative;
    }

    .pulse-dot::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: #28a745;
      animation: pulse-ring 2s ease-out infinite;
    }

    .pulse-dot.inactive {
      background: #666;
    }

    .pulse-dot.inactive::before {
      display: none;
    }

    @keyframes pulse-ring {
      0% {
        transform: scale(1);
        opacity: 1;
      }
      100% {
        transform: scale(2.5);
        opacity: 0;
      }
    }

    .pulse-label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
    }

    /* ========== WHY DRAWER ========== */
    .drawer-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 999;
    }

    .drawer-overlay.active {
      display: block;
    }

    .why-drawer {
      position: fixed;
      top: 0;
      right: -450px;
      width: 450px;
      height: 100%;
      background: #1e2a3a;
      border-left: 1px solid rgba(255,255,255,0.1);
      z-index: 1000;
      transition: right 0.3s ease;
      overflow-y: auto;
      padding: 30px;
    }

    .why-drawer.active {
      right: 0;
    }

    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25px;
      padding-bottom: 15px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .drawer-header h3 {
      color: #fff;
      font-size: 18px;
    }

    .drawer-close {
      background: none;
      border: none;
      color: #888;
      font-size: 24px;
      cursor: pointer;
    }

    .drawer-content {
      color: #e0e0e0;
    }

    .drawer-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 13px;
    }

    .drawer-row-label {
      color: #888;
    }

    .drawer-row-value {
      color: #fff;
      font-weight: 500;
    }

    .metric-card.clickable {
      cursor: pointer;
    }

    .metric-card.clickable:hover {
      border-color: #667eea;
    }

    /* ========== THRESHOLD ALERTS ========== */
    .alerts-panel {
      margin-top: 20px;
    }

    .alert-config {
      background: rgba(255,193,7,0.1);
      border: 1px solid rgba(255,193,7,0.3);
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
    }

    .alert-config-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .alert-config-name {
      font-weight: 600;
      color: #ffc107;
    }

    .alert-toggle {
      width: 40px;
      height: 22px;
      background: rgba(255,255,255,0.2);
      border-radius: 11px;
      position: relative;
      cursor: pointer;
      transition: background 0.2s;
    }

    .alert-toggle.active {
      background: #28a745;
    }

    .alert-toggle::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      transition: left 0.2s;
    }

    .alert-toggle.active::after {
      left: 21px;
    }

    /* ========== INTEGRITY HASH ========== */
    .integrity-hash {
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 8px;
      padding: 15px;
      margin-top: 20px;
    }

    .hash-label {
      font-size: 11px;
      text-transform: uppercase;
      color: #667eea;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hash-value {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 11px;
      color: #888;
      word-break: break-all;
      line-height: 1.6;
    }

    .hash-valid {
      color: #28a745;
      font-size: 14px;
    }

    .hash-invalid {
      color: #dc3545;
      font-size: 14px;
    }

    /* ========== WORKFLOW SECTION ========== */
    .workflow-section {
      margin-top: 30px;
      padding-top: 30px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
    }

    .workflow-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 15px;
      margin-bottom: 25px;
    }

    .workflow-stat {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      text-align: center;
    }

    .workflow-stat-value {
      font-size: 32px;
      font-weight: 700;
      color: #fff;
    }

    .workflow-stat-value.alert {
      color: #dc3545;
    }

    .workflow-stat-label {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      margin-top: 5px;
    }

    .workflow-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .workflow-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      cursor: pointer;
      transition: all 0.2s;
    }

    .workflow-card:hover {
      background: rgba(255,255,255,0.08);
      border-color: #667eea;
    }

    .workflow-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15px;
    }

    .workflow-client {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }

    .workflow-template {
      font-size: 12px;
      color: #888;
      margin-top: 3px;
    }

    .workflow-percentage {
      font-size: 24px;
      font-weight: 700;
      color: #667eea;
    }

    .workflow-progress-bar {
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      height: 8px;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .workflow-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    .workflow-stats {
      display: flex;
      gap: 20px;
      font-size: 12px;
    }

    .workflow-stats span {
      color: #888;
    }

    .workflow-stats .completed {
      color: #28a745;
    }

    .workflow-stats .blocked {
      color: #dc3545;
    }

    .workflow-stats .pending {
      color: #ffc107;
    }

    .workflow-details {
      display: none;
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }

    .workflow-card.expanded .workflow-details {
      display: block;
    }

    .workflow-step {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      font-size: 13px;
    }

    .step-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      flex-shrink: 0;
    }

    .step-icon.completed {
      background: #28a745;
      color: white;
    }

    .step-icon.blocked {
      background: #dc3545;
      color: white;
    }

    .step-icon.pending {
      background: rgba(255,255,255,0.2);
      color: #888;
    }

    .step-title {
      flex: 1;
      color: #e0e0e0;
    }

    .step-title.completed {
      color: #888;
      text-decoration: line-through;
    }

    .step-blocker {
      font-size: 11px;
      color: #dc3545;
    }

    .no-workflows {
      text-align: center;
      padding: 40px;
      color: #666;
    }

    .no-workflows-icon {
      font-size: 48px;
      margin-bottom: 15px;
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
      <div style="text-align: right; display: flex; align-items: center; gap: 15px;">
        <div class="pulse-container">
          <div class="pulse-dot" id="pulseDot"></div>
          <span class="pulse-label" id="pulseLabel">Live</span>
        </div>
        <button class="refresh-btn" onclick="refreshData()" id="refreshBtn">Refresh</button>
        <p class="last-updated" id="lastUpdated" style="margin-top: 5px;">Loading...</p>
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
      <div class="metric-card clickable" id="complianceCard" onclick="openDrawer('compliance')">
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

      <div class="metric-card clickable" onclick="openDrawer('requests')">
        <div class="metric-label">AI Requests (This Week)</div>
        <div class="metric-value" id="aiRequestsWeek">0</div>
        <div class="metric-detail" id="aiRequestsTotal">0 total all-time</div>
      </div>

      <div class="metric-card clickable" onclick="openDrawer('spend')">
        <div class="metric-label">Total Spend</div>
        <div class="metric-value">$<span id="totalSpend">0.00</span></div>
        <div class="metric-detail">All-time AI costs</div>
      </div>

      <div class="metric-card clickable" id="voidsCard" onclick="openDrawer('voids')">
        <div class="metric-label">Open VOIDs</div>
        <div class="metric-value" id="openVoids">0</div>
        <div class="metric-detail">Compliance gaps requiring attention</div>
      </div>

      <div class="metric-card clickable" id="escalationsCard" onclick="openDrawer('escalations')">
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

        <!-- Integrity Hash -->
        <div class="integrity-hash">
          <div class="hash-label">
            <span class="hash-valid" id="hashStatus">&#10003;</span>
            Ledger Integrity (SHA-256)
          </div>
          <div class="hash-value" id="hashValue">Calculating...</div>
        </div>

        <!-- Threshold Alerts Config -->
        <div class="alerts-panel">
          <div class="panel-title" style="margin-top: 20px; font-size: 14px;">Alert Thresholds</div>
          <div class="alert-config">
            <div class="alert-config-header">
              <span class="alert-config-name">Spend > $100/week</span>
              <div class="alert-toggle" id="alertSpend" onclick="toggleAlert('spend')"></div>
            </div>
          </div>
          <div class="alert-config">
            <div class="alert-config-header">
              <span class="alert-config-name">Compliance < 70%</span>
              <div class="alert-toggle active" id="alertCompliance" onclick="toggleAlert('compliance')"></div>
            </div>
          </div>
          <div class="alert-config">
            <div class="alert-config-header">
              <span class="alert-config-name">Any Open VOIDs</span>
              <div class="alert-toggle active" id="alertVoids" onclick="toggleAlert('voids')"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Workflow Section -->
    <div class="workflow-section" id="workflowSection">
      <div class="section-header">
        <h2 class="section-title">Active Workflows</h2>
      </div>

      <div class="workflow-summary">
        <div class="workflow-stat">
          <div class="workflow-stat-value" id="activeWorkflowCount">0</div>
          <div class="workflow-stat-label">Active Workflows</div>
        </div>
        <div class="workflow-stat">
          <div class="workflow-stat-value" id="blockedStepsCount">0</div>
          <div class="workflow-stat-label">Blocked Steps</div>
        </div>
        <div class="workflow-stat">
          <div class="workflow-stat-value" id="avgProgress">0%</div>
          <div class="workflow-stat-label">Avg Progress</div>
        </div>
      </div>

      <div class="workflow-list" id="workflowList">
        <!-- Workflow cards will be inserted here -->
      </div>
    </div>
  </div>

  <!-- Red Button: Manual Override FAB -->
  <button class="override-fab" onclick="openOverrideModal()" title="Log Manual Override">&#9888;</button>

  <!-- Manual Override Modal -->
  <div class="override-modal" id="overrideModal">
    <div class="override-form">
      <h3>&#9888; Log Manual Override</h3>
      <label>Override Type</label>
      <select id="overrideType">
        <option value="AI_BYPASS">AI Recommendation Bypassed</option>
        <option value="POLICY_EXCEPTION">Policy Exception Granted</option>
        <option value="MANUAL_APPROVAL">Manual Approval (No AI)</option>
        <option value="EMERGENCY_ACTION">Emergency Action Taken</option>
      </select>
      <label>Decision Made</label>
      <input type="text" id="overrideDecision" placeholder="What was decided?">
      <label>Justification</label>
      <textarea id="overrideJustification" placeholder="Why was this override necessary?"></textarea>
      <label>Your Name/Role</label>
      <input type="text" id="overrideActor" placeholder="e.g., John Smith - Compliance Officer">
      <div class="btn-row">
        <button class="btn-cancel" onclick="closeOverrideModal()">Cancel</button>
        <button class="btn-submit" onclick="submitOverride()">Log Override</button>
      </div>
    </div>
  </div>

  <!-- Why Drawer -->
  <div class="drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>
  <div class="why-drawer" id="whyDrawer">
    <div class="drawer-header">
      <h3 id="drawerTitle">Details</h3>
      <button class="drawer-close" onclick="closeDrawer()">&times;</button>
    </div>
    <div class="drawer-content" id="drawerContent">
      <!-- Drawer content will be inserted here -->
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
      compCard.className = 'metric-card clickable ' + (score >= 70 ? 'success' : score >= 40 ? '' : 'alert');

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
        'metric-card clickable ' + (voids > 0 ? 'alert' : 'success');

      // Escalations
      const esc = data.openEscalations;
      document.getElementById('openEscalations').textContent = esc;
      document.getElementById('openEscalations').className =
        'metric-value ' + (esc > 0 ? 'alert' : 'success');
      document.getElementById('escalationsCard').className =
        'metric-card clickable ' + (esc > 0 ? 'alert' : 'success');

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

    // ========== LIVE PULSE ==========
    let lastEventTime = dashboardData.lastEventTime || null;
    let pulseInterval;

    function updatePulse() {
      const dot = document.getElementById('pulseDot');
      const label = document.getElementById('pulseLabel');

      if (!lastEventTime) {
        dot.classList.add('inactive');
        label.textContent = 'No Events';
        return;
      }

      const now = new Date();
      const lastEvent = new Date(lastEventTime);
      const minutesAgo = Math.floor((now - lastEvent) / 60000);

      if (minutesAgo < 60) {
        dot.classList.remove('inactive');
        label.textContent = minutesAgo < 1 ? 'Live' : minutesAgo + 'm ago';
      } else if (minutesAgo < 1440) {
        dot.classList.add('inactive');
        label.textContent = Math.floor(minutesAgo / 60) + 'h ago';
      } else {
        dot.classList.add('inactive');
        label.textContent = Math.floor(minutesAgo / 1440) + 'd ago';
      }
    }

    // ========== WHY DRAWER ==========
    function openDrawer(metric) {
      const drawer = document.getElementById('whyDrawer');
      const overlay = document.getElementById('drawerOverlay');
      const title = document.getElementById('drawerTitle');
      const content = document.getElementById('drawerContent');

      let html = '';
      switch(metric) {
        case 'compliance':
          title.textContent = 'Compliance Score Breakdown';
          const tagCoverage = dashboardData.tagCoverage || {};
          html = '<div style="margin-bottom: 20px; color: #888;">Your compliance score is calculated from coverage across regulatory frameworks.</div>';
          Object.entries(tagCoverage).forEach(([framework, stats]) => {
            html += \`
              <div class="drawer-row">
                <span class="drawer-row-label">\${framework.replace(/_/g, ' ')}</span>
                <span class="drawer-row-value">\${stats.covered}/\${stats.total} (\${stats.percentage}%)</span>
              </div>
            \`;
          });
          if (Object.keys(tagCoverage).length === 0) {
            html += '<div style="color: #666; padding: 20px 0;">No framework coverage data yet. Tag your AI events with regulatory frameworks to track compliance.</div>';
          }
          break;

        case 'requests':
          title.textContent = 'AI Requests Detail';
          html = \`
            <div class="drawer-row">
              <span class="drawer-row-label">This Week</span>
              <span class="drawer-row-value">\${dashboardData.aiRequests.thisWeek}</span>
            </div>
            <div class="drawer-row">
              <span class="drawer-row-label">All Time</span>
              <span class="drawer-row-value">\${dashboardData.aiRequests.total}</span>
            </div>
            <div style="margin-top: 20px; margin-bottom: 10px; color: #888;">By Provider:</div>
          \`;
          Object.entries(dashboardData.aiRequests.byProvider || {}).forEach(([provider, count]) => {
            html += \`
              <div class="drawer-row">
                <span class="drawer-row-label">\${provider}</span>
                <span class="drawer-row-value">\${count} requests</span>
              </div>
            \`;
          });
          break;

        case 'spend':
          title.textContent = 'AI Spend Breakdown';
          html = \`
            <div class="drawer-row">
              <span class="drawer-row-label">Total Spend</span>
              <span class="drawer-row-value">$\${dashboardData.totalSpend.toFixed(2)}</span>
            </div>
            <div style="margin-top: 20px; color: #666; font-size: 12px;">
              Spend is calculated from logged AI requests with cost metadata.
              Ensure your AI proxy logs include cost fields for accurate tracking.
            </div>
          \`;
          break;

        case 'voids':
          title.textContent = 'Open VOIDs';
          const voids = dashboardData.voidDetails || [];
          if (voids.length === 0 && dashboardData.openVoids === 0) {
            html = '<div style="color: #28a745; padding: 20px 0;">&#10003; No open VOIDs. All compliance gaps have been addressed.</div>';
          } else {
            html = '<div style="margin-bottom: 15px; color: #888;">VOIDs are compliance gaps requiring attention:</div>';
            voids.forEach(v => {
              html += \`
                <div style="background: rgba(220,53,69,0.1); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                  <div style="color: #dc3545; font-weight: 600;">\${v.target || 'Unknown'}</div>
                  <div style="color: #888; font-size: 12px; margin-top: 5px;">\${v.details || 'No details'}</div>
                </div>
              \`;
            });
            if (voids.length === 0 && dashboardData.openVoids > 0) {
              html += '<div style="color: #888;">VOID details not available in current data.</div>';
            }
          }
          break;

        case 'escalations':
          title.textContent = 'Open Escalations';
          const escalations = dashboardData.escalationDetails || [];
          if (escalations.length === 0 && dashboardData.openEscalations === 0) {
            html = '<div style="color: #28a745; padding: 20px 0;">&#10003; No open escalations. All incidents have been resolved.</div>';
          } else {
            html = '<div style="margin-bottom: 15px; color: #888;">Escalations are incidents requiring human review:</div>';
            escalations.forEach(e => {
              html += \`
                <div style="background: rgba(220,53,69,0.1); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                  <div style="color: #dc3545; font-weight: 600;">\${e.action || 'Unknown'}</div>
                  <div style="color: #888; font-size: 12px; margin-top: 5px;">\${e.actor} - \${new Date(e.timestamp).toLocaleString()}</div>
                </div>
              \`;
            });
            if (escalations.length === 0 && dashboardData.openEscalations > 0) {
              html += '<div style="color: #888;">Escalation details not available in current data.</div>';
            }
          }
          break;
      }

      content.innerHTML = html;
      drawer.classList.add('active');
      overlay.classList.add('active');
    }

    function closeDrawer() {
      document.getElementById('whyDrawer').classList.remove('active');
      document.getElementById('drawerOverlay').classList.remove('active');
    }

    // ========== MANUAL OVERRIDE MODAL ==========
    function openOverrideModal() {
      document.getElementById('overrideModal').classList.add('active');
    }

    function closeOverrideModal() {
      document.getElementById('overrideModal').classList.remove('active');
      // Clear form
      document.getElementById('overrideDecision').value = '';
      document.getElementById('overrideJustification').value = '';
      document.getElementById('overrideActor').value = '';
    }

    function submitOverride() {
      const type = document.getElementById('overrideType').value;
      const decision = document.getElementById('overrideDecision').value;
      const justification = document.getElementById('overrideJustification').value;
      const actor = document.getElementById('overrideActor').value;

      if (!decision || !justification || !actor) {
        alert('Please fill in all fields.');
        return;
      }

      // Submit to backend
      google.script.run
        .withSuccessHandler(function() {
          alert('Override logged successfully. This has been recorded in the audit ledger.');
          closeOverrideModal();
          setTimeout(() => window.location.reload(), 1000);
        })
        .withFailureHandler(function(err) {
          alert('Error logging override: ' + err.message);
        })
        .logManualOverride(type, decision, justification, actor);
    }

    // ========== THRESHOLD ALERTS ==========
    let alertSettings = {
      spend: false,
      compliance: true,
      voids: true
    };

    function toggleAlert(alertType) {
      alertSettings[alertType] = !alertSettings[alertType];
      const toggle = document.getElementById('alert' + alertType.charAt(0).toUpperCase() + alertType.slice(1));
      toggle.classList.toggle('active');

      // Save to backend
      google.script.run.saveAlertSettings(alertSettings);
    }

    // ========== INTEGRITY HASH ==========
    function displayHash() {
      const hashEl = document.getElementById('hashValue');
      const statusEl = document.getElementById('hashStatus');

      if (dashboardData.integrityHash) {
        hashEl.textContent = dashboardData.integrityHash;
        statusEl.innerHTML = '&#10003;';
        statusEl.className = 'hash-valid';
      } else {
        hashEl.textContent = 'No ledger entries to hash';
        statusEl.innerHTML = '-';
        statusEl.className = '';
      }
    }

    // ========== WORKFLOW SECTION ==========
    function renderWorkflows(workflowData) {
      if (!workflowData) {
        workflowData = { activeCount: 0, totalBlocked: 0, workflows: [] };
      }

      // Update summary stats
      document.getElementById('activeWorkflowCount').textContent = workflowData.activeCount;

      const blockedEl = document.getElementById('blockedStepsCount');
      blockedEl.textContent = workflowData.totalBlocked;
      blockedEl.className = 'workflow-stat-value' + (workflowData.totalBlocked > 0 ? ' alert' : '');

      // Calculate average progress
      let avgProgress = 0;
      if (workflowData.workflows.length > 0) {
        avgProgress = Math.round(
          workflowData.workflows.reduce((sum, w) => sum + w.percentage, 0) / workflowData.workflows.length
        );
      }
      document.getElementById('avgProgress').textContent = avgProgress + '%';

      // Render workflow list
      const container = document.getElementById('workflowList');

      if (workflowData.workflows.length === 0) {
        container.innerHTML = \`
          <div class="no-workflows">
            <div class="no-workflows-icon">&#128203;</div>
            <p>No active workflows</p>
            <p style="font-size: 12px; margin-top: 10px;">Start a workflow from the spreadsheet menu:<br>Workflow > Start Workflow</p>
          </div>
        \`;
        return;
      }

      container.innerHTML = workflowData.workflows.map(w => \`
        <div class="workflow-card" onclick="toggleWorkflowDetails('\${w.workflowId}')">
          <div class="workflow-card-header">
            <div>
              <div class="workflow-client">\${w.clientName}</div>
              <div class="workflow-template">\${w.templateName}</div>
            </div>
            <div class="workflow-percentage">\${w.percentage}%</div>
          </div>
          <div class="workflow-progress-bar">
            <div class="workflow-progress-fill" style="width: \${w.percentage}%"></div>
          </div>
          <div class="workflow-stats">
            <span class="completed">&#10003; \${w.completed} completed</span>
            <span class="blocked">&#9940; \${w.blocked} blocked</span>
            <span class="pending">&#9675; \${w.total - w.completed - w.blocked} pending</span>
          </div>
          <div class="workflow-details" id="details-\${w.workflowId}">
            <div style="text-align: center; color: #888; padding: 10px;">Loading steps...</div>
          </div>
        </div>
      \`).join('');
    }

    function toggleWorkflowDetails(workflowId) {
      const card = event.currentTarget;
      const detailsEl = document.getElementById('details-' + workflowId);

      if (card.classList.contains('expanded')) {
        card.classList.remove('expanded');
        return;
      }

      // Collapse other cards
      document.querySelectorAll('.workflow-card.expanded').forEach(c => c.classList.remove('expanded'));

      // Expand this card
      card.classList.add('expanded');

      // Load details if not already loaded
      if (detailsEl.innerHTML.includes('Loading')) {
        google.script.run
          .withSuccessHandler(function(status) {
            renderWorkflowSteps(detailsEl, status.steps);
          })
          .withFailureHandler(function(err) {
            detailsEl.innerHTML = '<div style="color: #dc3545;">Error loading details: ' + err.message + '</div>';
          })
          .getWorkflowStatus(workflowId);
      }
    }

    function renderWorkflowSteps(container, steps) {
      if (!steps || steps.length === 0) {
        container.innerHTML = '<div style="color: #888;">No steps found</div>';
        return;
      }

      container.innerHTML = steps.map(step => {
        let iconClass = 'pending';
        let icon = '&#9675;'; // circle
        if (step.status === 'COMPLETED') {
          iconClass = 'completed';
          icon = '&#10003;'; // checkmark
        } else if (step.status === 'BLOCKED') {
          iconClass = 'blocked';
          icon = '&#9940;'; // no entry
        }

        const titleClass = step.status === 'COMPLETED' ? 'step-title completed' : 'step-title';
        const blockerText = step.blockedBy && step.blockedBy.length > 0 ?
          '<div class="step-blocker">Blocked by: ' + step.blockedBy.map(b => b.title).join(', ') + '</div>' : '';

        return \`
          <div class="workflow-step">
            <div class="step-icon \${iconClass}">\${icon}</div>
            <div>
              <div class="\${titleClass}">\${step.stepNumber}. \${step.title}</div>
              \${blockerText}
            </div>
          </div>
        \`;
      }).join('');
    }

    // ========== INITIALIZATION ==========
    // Initial render
    renderDashboard(dashboardData);
    updatePulse();
    displayHash();
    renderWorkflows(dashboardData.workflowData);
    pulseInterval = setInterval(updatePulse, 60000); // Update pulse every minute
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

// ============================================================================
// MANUAL OVERRIDE LOGGING
// ============================================================================

/**
 * Log a manual override to the audit ledger
 * Called from the dashboard's Red Button
 */
function logManualOverride(type, decision, justification, actor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger) {
    throw new Error('Audit_Ledger sheet not found');
  }

  const uuid = Utilities.getUuid();
  const timestamp = new Date().toISOString();

  // Get headers to find column positions
  const headers = ledger.getRange(1, 1, 1, ledger.getLastColumn()).getValues()[0];
  const newRow = new Array(headers.length).fill('');

  // Map values to columns
  const colMap = {
    'UUID': uuid,
    'Timestamp': timestamp,
    'Event_Type': 'MANUAL_OVERRIDE',
    'Event Type': 'MANUAL_OVERRIDE',
    'Actor': actor,
    'Action': decision,
    'Target': type,
    'Details': justification,
    'Signal': 'HUMAN_DECISION',
    'Regulatory_Tags': ''
  };

  headers.forEach((header, idx) => {
    if (colMap[header] !== undefined) {
      newRow[idx] = colMap[header];
    }
  });

  ledger.appendRow(newRow);

  // Log to Apps Script console
  Logger.log(`Manual Override Logged: ${type} - ${decision} by ${actor}`);

  return { success: true, uuid: uuid };
}

// ============================================================================
// ALERT SETTINGS
// ============================================================================

/**
 * Save alert threshold settings
 */
function saveAlertSettings(settings) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('ALERT_SETTINGS', JSON.stringify(settings));
  return { success: true };
}

/**
 * Get alert threshold settings
 */
function getAlertSettings() {
  const props = PropertiesService.getDocumentProperties();
  const settingsJson = props.getProperty('ALERT_SETTINGS');
  return settingsJson ? JSON.parse(settingsJson) : {
    spend: false,
    compliance: true,
    voids: true
  };
}

/**
 * Check thresholds and send email alerts if triggered
 * Can be set up as a time-based trigger
 */
function checkAlertThresholds() {
  const settings = getAlertSettings();
  const data = getDashboardData_();
  const alerts = [];

  if (settings.spend && data.totalSpend > 100) {
    alerts.push(`Spend Alert: Weekly spend ($${data.totalSpend.toFixed(2)}) exceeds $100 threshold.`);
  }

  if (settings.compliance && data.complianceScore < 70) {
    alerts.push(`Compliance Alert: Score (${data.complianceScore}%) is below 70% threshold.`);
  }

  if (settings.voids && data.openVoids > 0) {
    alerts.push(`VOID Alert: ${data.openVoids} open compliance gap(s) require attention.`);
  }

  if (alerts.length > 0) {
    const email = Session.getActiveUser().getEmail();
    const subject = 'Newton AI Governance - Alert Triggered';
    const body = 'The following alert thresholds have been triggered:\n\n' +
                 alerts.join('\n\n') +
                 '\n\nView dashboard for details.';

    MailApp.sendEmail(email, subject, body);
    Logger.log('Alert email sent: ' + alerts.join(', '));
  }

  return { alertsTriggered: alerts.length, alerts: alerts };
}

// ============================================================================
// INTEGRITY HASH
// ============================================================================

/**
 * Calculate SHA-256 hash of recent ledger entries
 * Provides tamper-evident proof of ledger integrity
 */
function calculateLedgerHash_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger || ledger.getLastRow() < 2) {
    return null;
  }

  // Get last 100 rows (or all if less than 100)
  const lastRow = ledger.getLastRow();
  const startRow = Math.max(2, lastRow - 99);
  const numRows = lastRow - startRow + 1;

  const data = ledger.getRange(startRow, 1, numRows, ledger.getLastColumn()).getValues();

  // Create a canonical string representation
  const canonical = data.map(row => row.join('|')).join('\\n');

  // Calculate SHA-256
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical);

  // Convert to hex string
  return hash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
