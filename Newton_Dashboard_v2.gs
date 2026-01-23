/**
 * ───────────────────────────────────────────────
 *  NEWTON DASHBOARD v2 : ROLE-BASED COMMAND CENTER
 * ───────────────────────────────────────────────
 *
 *  Three views, one dashboard:
 *  - EXEC: Giant status badges, no numbers, just Safe/Watch/Action
 *  - COMPLIANCE: Gap analysis, Gatekeeper blocks, policy violations
 *  - ENGINEER: Provider charts, drift scores, technical metrics
 *
 *  Every metric has plain English. Every alert has a Fix It button.
 *
 * ───────────────────────────────────────────────
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doGet(e) {
  const template = HtmlService.createTemplate(getDashboardHTML_v2_());
  const dashboardData = collectDashboardData_v2_();
  template.data = JSON.stringify(dashboardData);

  return template.evaluate()
    .setTitle('Newton Command Center')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const action = e.parameter.action;

    if (action === 'refresh') {
      return ContentService.createTextOutput(JSON.stringify(collectDashboardData_v2_()))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'fixIt') {
      const alertType = e.parameter.alertType;
      const result = triggerFixWorkflow_(alertType, e.parameter);
      return ContentService.createTextOutput(JSON.stringify(result))
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

function collectDashboardData_v2_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Initialize data structure
  const data = {
    timestamp: now.toISOString(),

    // Hero pulse bar
    pulse: {
      activeWorkflows: 0,
      topAlert: null,
      systemStatus: 'SAFE' // SAFE | WATCH | ACTION
    },

    // Executive view (3 giant tiles)
    exec: {
      compliance: { status: 'SAFE', label: 'Safe', emoji: '🟢' },
      spend: { status: 'SAFE', label: 'Safe', emoji: '🟢' },
      alerts: { status: 'SAFE', label: 'Safe', emoji: '🟢' }
    },

    // Compliance view
    compliance: {
      gapAnalysis: { frameworks: [], totalGaps: 0, narrative: '' },
      gatekeeperBlocks: { count: 0, narrative: '', topReasons: [] },
      policyViolations: { count: 0, narrative: '', items: [] },
      openVoids: { count: 0, narrative: '', items: [] }
    },

    // Engineer view
    engineer: {
      aiRequests: { total: 0, thisWeek: 0, byProvider: {}, byDay: [] },
      driftScores: { average: 0, narrative: '', recent: [] },
      gatekeeperStats: { prechecks: 0, postchecks: 0, blocked: 0 },
      confidencePlans: { active: 0, avgEvidence: 0, narrative: '' }
    },

    // Shared data for filters
    tenants: [],

    // Action items (all views)
    actionItems: []
  };

  // Collect from various sheets
  try { collectLedgerMetrics_(ss, data, weekAgo); } catch (e) { Logger.log('Ledger: ' + e.message); }
  try { collectGatekeeperMetrics_(ss, data); } catch (e) { Logger.log('Gatekeeper: ' + e.message); }
  try { collectWorkflowMetrics_(ss, data); } catch (e) { Logger.log('Workflow: ' + e.message); }
  try { collectConfidenceMetrics_(ss, data); } catch (e) { Logger.log('Confidence: ' + e.message); }
  try { collectTenantMetrics_(ss, data); } catch (e) { Logger.log('Tenant: ' + e.message); }

  // Calculate executive status badges
  calculateExecStatus_(data);

  // Build action items with Fix It workflows
  buildActionItems_(data);

  // Set top alert for pulse bar
  if (data.actionItems.length > 0) {
    data.pulse.topAlert = data.actionItems[0];
  }

  return data;
}

function collectLedgerMetrics_(ss, data, weekAgo) {
  const ledger = ss.getSheetByName('Audit_Ledger');
  if (!ledger || ledger.getLastRow() < 2) return;

  const rows = ledger.getDataRange().getValues();
  const headers = rows[0];
  const cols = {
    timestamp: headers.indexOf('Timestamp'),
    eventType: Math.max(headers.indexOf('Event Type'), headers.indexOf('Event_Type')),
    status: headers.indexOf('Status'),
    text: headers.indexOf('Text')
  };

  let aiTotal = 0, aiWeek = 0, totalSpend = 0;
  const byProvider = {};
  const byDay = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const ts = new Date(row[cols.timestamp]);
    const eventType = row[cols.eventType] || '';
    const text = row[cols.text] || '';

    if (eventType === 'AI_PROXY_REQUEST' || eventType.includes('AI_')) {
      aiTotal++;
      if (ts >= weekAgo) aiWeek++;

      // Extract provider and cost from text if available
      const providerMatch = text.match(/provider[:\s]+(\w+)/i);
      const provider = providerMatch ? providerMatch[1] : 'unknown';
      byProvider[provider] = (byProvider[provider] || 0) + 1;

      const costMatch = text.match(/cost[:\s]+\$?([\d.]+)/i);
      if (costMatch) totalSpend += parseFloat(costMatch[1]);

      // By day
      if (ts >= weekAgo) {
        const dayKey = ts.toISOString().split('T')[0];
        byDay[dayKey] = (byDay[dayKey] || 0) + 1;
      }
    }

    if (eventType === 'VOID_DETECTED' || eventType === 'VOID') {
      data.compliance.openVoids.count++;
      data.compliance.openVoids.items.push({
        text: text.substring(0, 100),
        timestamp: ts.toISOString()
      });
    }
  }

  data.engineer.aiRequests = {
    total: aiTotal,
    thisWeek: aiWeek,
    byProvider,
    byDay: Object.entries(byDay).map(([date, count]) => ({ date, count })),
    spend: totalSpend
  };

  // Spend narrative
  if (totalSpend > 100) {
    data.exec.spend.status = 'ACTION';
    data.exec.spend.label = 'Action';
    data.exec.spend.emoji = '🔴';
  } else if (totalSpend > 50) {
    data.exec.spend.status = 'WATCH';
    data.exec.spend.label = 'Watch';
    data.exec.spend.emoji = '🟡';
  }
}

function collectGatekeeperMetrics_(ss, data) {
  const ledger = ss.getSheetByName('Audit_Ledger');
  if (!ledger || ledger.getLastRow() < 2) return;

  const rows = ledger.getDataRange().getValues();
  const headers = rows[0];
  const eventTypeCol = Math.max(headers.indexOf('Event Type'), headers.indexOf('Event_Type'));
  const textCol = headers.indexOf('Text');

  let prechecks = 0, postchecks = 0, blocked = 0;
  const blockReasons = {};
  const driftScores = [];

  for (let i = 1; i < rows.length; i++) {
    const eventType = rows[i][eventTypeCol] || '';
    const text = rows[i][textCol] || '';

    if (eventType === 'GATEKEEPER_PRECHECK') {
      prechecks++;
      if (text.includes('Allowed: false')) blocked++;
    }
    if (eventType === 'GATEKEEPER_POSTCHECK') {
      postchecks++;
      if (text.includes('Allowed: false')) blocked++;

      // Extract drift score
      const driftMatch = text.match(/Drift Score[:\s]+(\d+)/i);
      if (driftMatch) driftScores.push(parseInt(driftMatch[1]));

      // Count violation types
      const violationMatch = text.match(/\[(\w+)\]\s+(\w+):/g);
      if (violationMatch) {
        violationMatch.forEach(v => {
          const type = v.match(/(\w+):/)?.[1] || 'OTHER';
          blockReasons[type] = (blockReasons[type] || 0) + 1;
        });
      }
    }
  }

  data.engineer.gatekeeperStats = { prechecks, postchecks, blocked };
  data.compliance.gatekeeperBlocks.count = blocked;

  // Top 3 reasons
  const sortedReasons = Object.entries(blockReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  data.compliance.gatekeeperBlocks.topReasons = sortedReasons.map(([reason, count]) => ({
    reason,
    count,
    label: formatReasonLabel_(reason)
  }));

  // Narrative
  if (blocked > 0) {
    const topReason = sortedReasons[0] ? sortedReasons[0][0].toLowerCase() : 'violations';
    data.compliance.gatekeeperBlocks.narrative =
      `${blocked} Gatekeeper blocks, mostly ${topReason}`;
  } else {
    data.compliance.gatekeeperBlocks.narrative = 'No blocks this period';
  }

  // Drift score average
  if (driftScores.length > 0) {
    const avg = Math.round(driftScores.reduce((a, b) => a + b, 0) / driftScores.length);
    data.engineer.driftScores.average = avg;
    data.engineer.driftScores.narrative = avg > 30
      ? `High drift (${avg}) - tighten prompts`
      : `Drift under control (${avg})`;
  }
}

function collectWorkflowMetrics_(ss, data) {
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  if (!workflowSheet || workflowSheet.getLastRow() < 2) return;

  const rows = workflowSheet.getDataRange().getValues();
  const headers = rows[0];
  const statusCol = headers.indexOf('Status');
  const blockedCol = headers.indexOf('Blocked_Steps');

  let active = 0, totalBlocked = 0;

  for (let i = 1; i < rows.length; i++) {
    const status = rows[i][statusCol];
    if (status === 'IN_PROGRESS' || status === 'ACTIVE') {
      active++;
      const blockedSteps = parseInt(rows[i][blockedCol]) || 0;
      totalBlocked += blockedSteps;
    }
  }

  data.pulse.activeWorkflows = active;

  if (totalBlocked > 0) {
    data.actionItems.push({
      type: 'BLOCKED_WORKFLOWS',
      severity: 'WATCH',
      title: `${totalBlocked} blocked workflow steps`,
      narrative: 'Workflows waiting on documentation or approval',
      fixAction: 'Review Workflows',
      fixWorkflow: 'WORKFLOW_REVIEW'
    });
  }
}

function collectConfidenceMetrics_(ss, data) {
  const confSheet = ss.getSheetByName('Confidence_Declarations');
  if (!confSheet || confSheet.getLastRow() < 2) return;

  const rows = confSheet.getDataRange().getValues();
  const headers = rows[0];
  const statusCol = headers.indexOf('Status');
  const levelCol = headers.indexOf('Level');

  let declared = 0, linked = 0, violated = 0;
  const levels = { KNOWN_KNOWN: 0, KNOWN_UNKNOWN: 0, UNKNOWN_UNKNOWN: 0 };

  for (let i = 1; i < rows.length; i++) {
    const status = rows[i][statusCol];
    const level = rows[i][levelCol];

    declared++;
    if (status === 'LINKED') linked++;
    if (status === 'VIOLATED') violated++;
    if (levels[level] !== undefined) levels[level]++;
  }

  if (violated > 0) {
    data.compliance.policyViolations.count = violated;
    data.compliance.policyViolations.narrative =
      `${violated} confidence violations need review`;
  }

  data.engineer.confidencePlans = {
    active: declared - linked,
    avgEvidence: 0, // Would calculate from plans
    narrative: declared > 0
      ? `${Math.round((linked/declared)*100)}% declarations linked`
      : 'No declarations yet'
  };
}

function collectTenantMetrics_(ss, data) {
  const tenantSheet = ss.getSheetByName('Tenant_Policy');
  if (!tenantSheet || tenantSheet.getLastRow() < 2) return;

  const rows = tenantSheet.getDataRange().getValues();
  const tenants = new Set();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0] !== '*') {
      tenants.add(rows[i][0]);
    }
  }

  data.tenants = Array.from(tenants);
}

function calculateExecStatus_(data) {
  // Compliance status - based on gaps and violations
  const totalIssues =
    data.compliance.openVoids.count +
    data.compliance.policyViolations.count +
    data.compliance.gatekeeperBlocks.count;

  if (totalIssues > 10) {
    data.exec.compliance = { status: 'ACTION', label: 'Action', emoji: '🔴' };
    data.pulse.systemStatus = 'ACTION';
  } else if (totalIssues > 3) {
    data.exec.compliance = { status: 'WATCH', label: 'Watch', emoji: '🟡' };
    if (data.pulse.systemStatus !== 'ACTION') data.pulse.systemStatus = 'WATCH';
  } else {
    data.exec.compliance = { status: 'SAFE', label: 'Safe', emoji: '🟢' };
  }

  // Alerts status - based on critical items
  const criticalAlerts = data.actionItems.filter(a => a.severity === 'ACTION').length;
  if (criticalAlerts > 0) {
    data.exec.alerts = { status: 'ACTION', label: 'Action', emoji: '🔴' };
    data.pulse.systemStatus = 'ACTION';
  } else if (data.actionItems.length > 0) {
    data.exec.alerts = { status: 'WATCH', label: 'Watch', emoji: '🟡' };
    if (data.pulse.systemStatus !== 'ACTION') data.pulse.systemStatus = 'WATCH';
  }
}

function buildActionItems_(data) {
  // Gatekeeper blocks
  if (data.compliance.gatekeeperBlocks.count > 0) {
    data.actionItems.push({
      type: 'GATEKEEPER_BLOCKS',
      severity: data.compliance.gatekeeperBlocks.count > 5 ? 'ACTION' : 'WATCH',
      title: data.compliance.gatekeeperBlocks.narrative,
      narrative: 'Review blocked requests and adjust policies',
      fixAction: 'Review Blocks',
      fixWorkflow: 'GATEKEEPER_REVIEW'
    });
  }

  // Open VOIDs
  if (data.compliance.openVoids.count > 0) {
    data.actionItems.push({
      type: 'OPEN_VOIDS',
      severity: data.compliance.openVoids.count > 3 ? 'ACTION' : 'WATCH',
      title: `${data.compliance.openVoids.count} open compliance voids`,
      narrative: 'Documentation gaps need filling',
      fixAction: 'Map Evidence',
      fixWorkflow: 'VOID_RESOLUTION'
    });
  }

  // Policy violations
  if (data.compliance.policyViolations.count > 0) {
    data.actionItems.push({
      type: 'POLICY_VIOLATIONS',
      severity: 'ACTION',
      title: `${data.compliance.policyViolations.count} policy violations`,
      narrative: 'Confidence declarations violated - review urgently',
      fixAction: 'Investigate',
      fixWorkflow: 'VIOLATION_REVIEW'
    });
  }

  // High drift
  if (data.engineer.driftScores.average > 40) {
    data.actionItems.push({
      type: 'HIGH_DRIFT',
      severity: 'WATCH',
      title: `High drift score: ${data.engineer.driftScores.average}`,
      narrative: 'AI outputs drifting - review prompts and constraints',
      fixAction: 'Tune Policy',
      fixWorkflow: 'POLICY_TUNE'
    });
  }

  // Sort by severity
  const severityOrder = { ACTION: 0, WATCH: 1, SAFE: 2 };
  data.actionItems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

function formatReasonLabel_(reason) {
  const labels = {
    DRIFT_DETECTED: 'Drift',
    HALLUCINATION_MARKER: 'Hallucinations',
    SCHEMA_VIOLATION: 'Schema issues',
    CONFIDENCE_REQUIRED: 'Missing confidence',
    CITATION_REQUIRED: 'Missing citations',
    ADVERSARIAL_PATTERN: 'Adversarial patterns'
  };
  return labels[reason] || reason.toLowerCase().replace(/_/g, ' ');
}

function triggerFixWorkflow_(alertType, params) {
  // This would kick off the appropriate workflow
  // For now, return success with instructions
  const workflows = {
    GATEKEEPER_REVIEW: 'Open Gatekeeper > View Stats to review blocks',
    VOID_RESOLUTION: 'Open Compliance > Map Evidence to fill gaps',
    VIOLATION_REVIEW: 'Open Confidence > Audit Declarations',
    POLICY_TUNE: 'Open Brain > Run Auto-Tune',
    WORKFLOW_REVIEW: 'Open Workflow > View Status'
  };

  return {
    success: true,
    workflow: alertType,
    instruction: workflows[alertType] || 'Check the relevant menu'
  };
}

// ============================================================================
// HTML TEMPLATE
// ============================================================================

function getDashboardHTML_v2_() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newton Command Center</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg-dark: #0f0f1a;
      --bg-card: #1a1a2e;
      --bg-hover: #252542;
      --border: rgba(255,255,255,0.08);
      --text-primary: #ffffff;
      --text-secondary: #888;
      --text-muted: #555;
      --accent: #667eea;
      --safe: #10b981;
      --watch: #f59e0b;
      --action: #ef4444;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      min-height: 100vh;
    }

    /* ========== HERO PULSE BAR ========== */
    .pulse-bar {
      background: linear-gradient(90deg, var(--bg-card), var(--bg-dark));
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .pulse-left {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .pulse-status {
      font-size: 32px;
      line-height: 1;
    }

    .pulse-workflows {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--bg-hover);
      border-radius: 20px;
      font-size: 14px;
    }

    .pulse-workflows .count {
      font-weight: 700;
      color: var(--accent);
    }

    .pulse-alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .pulse-alert:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    .pulse-alert.watch {
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.3);
    }

    .pulse-alert-text {
      font-size: 14px;
      font-weight: 500;
    }

    .pulse-alert-arrow {
      font-size: 18px;
      opacity: 0.5;
    }

    /* ========== ROLE PICKER ========== */
    .role-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
    }

    .role-picker {
      display: flex;
      gap: 8px;
    }

    .role-btn {
      padding: 10px 24px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .role-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .role-btn.active {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }

    /* ========== FILTER BAR ========== */
    .filter-bar {
      display: flex;
      gap: 12px;
    }

    .filter-bar select,
    .filter-bar input {
      padding: 8px 14px;
      background: var(--bg-dark);
      border: 1px solid var(--border);
      color: var(--text-primary);
      border-radius: 6px;
      font-size: 13px;
      min-width: 120px;
    }

    .filter-bar input {
      min-width: 200px;
    }

    /* ========== MAIN CONTENT ========== */
    .main-content {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* ========== EXEC VIEW - GIANT TILES ========== */
    .exec-view {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
    }

    .exec-tile {
      background: var(--bg-card);
      border-radius: 24px;
      padding: 48px 32px;
      text-align: center;
      border: 2px solid var(--border);
      transition: all 0.3s;
      cursor: pointer;
    }

    .exec-tile:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    }

    .exec-tile.safe { border-color: var(--safe); }
    .exec-tile.watch { border-color: var(--watch); }
    .exec-tile.action { border-color: var(--action); animation: pulse-border 2s infinite; }

    @keyframes pulse-border {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
      50% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
    }

    .exec-emoji {
      font-size: 80px;
      line-height: 1;
      margin-bottom: 16px;
    }

    .exec-label {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .exec-status {
      font-size: 32px;
      font-weight: 700;
    }

    .exec-tile.safe .exec-status { color: var(--safe); }
    .exec-tile.watch .exec-status { color: var(--watch); }
    .exec-tile.action .exec-status { color: var(--action); }

    /* ========== COMPLIANCE VIEW ========== */
    .compliance-view,
    .engineer-view {
      display: none;
    }

    .view-active {
      display: block !important;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .metric-card {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid var(--border);
    }

    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .metric-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
    }

    .metric-badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }

    .metric-badge.safe { background: rgba(16, 185, 129, 0.15); color: var(--safe); }
    .metric-badge.watch { background: rgba(245, 158, 11, 0.15); color: var(--watch); }
    .metric-badge.action { background: rgba(239, 68, 68, 0.15); color: var(--action); }

    .metric-value {
      font-size: 48px;
      font-weight: 700;
      line-height: 1;
      margin-bottom: 8px;
    }

    .metric-narrative {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.5;
      margin-bottom: 16px;
    }

    .metric-expand {
      display: none;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      margin-top: 16px;
    }

    .metric-card.expanded .metric-expand {
      display: block;
    }

    .expand-btn {
      background: var(--bg-hover);
      border: none;
      color: var(--text-secondary);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }

    .expand-btn:hover {
      background: var(--accent);
      color: white;
    }

    .expand-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }

    .expand-item:last-child {
      border-bottom: none;
    }

    /* ========== ACTION ITEMS ========== */
    .action-section {
      margin-top: 32px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .action-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .action-item {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--bg-card);
      border-radius: 12px;
      padding: 16px 20px;
      border-left: 4px solid var(--border);
      transition: all 0.2s;
    }

    .action-item:hover {
      background: var(--bg-hover);
    }

    .action-item.action { border-left-color: var(--action); }
    .action-item.watch { border-left-color: var(--watch); }

    .action-icon {
      font-size: 24px;
    }

    .action-content {
      flex: 1;
    }

    .action-title {
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 4px;
    }

    .action-narrative {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .fix-btn {
      padding: 10px 20px;
      background: var(--accent);
      border: none;
      color: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .fix-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    /* ========== ENGINEER VIEW - CHARTS ========== */
    .chart-container {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid var(--border);
      margin-bottom: 20px;
    }

    .chart-title {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 16px;
    }

    .bar-chart {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      height: 150px;
      padding-top: 20px;
    }

    .bar-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }

    .bar {
      width: 100%;
      max-width: 40px;
      background: linear-gradient(180deg, var(--accent), #764ba2);
      border-radius: 4px 4px 0 0;
      min-height: 4px;
      transition: height 0.5s;
    }

    .bar-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 8px;
    }

    .bar-value {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    .provider-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }

    .provider-badge {
      padding: 6px 12px;
      background: var(--bg-hover);
      border-radius: 16px;
      font-size: 12px;
    }

    .provider-badge .count {
      font-weight: 600;
      color: var(--accent);
      margin-left: 6px;
    }

    /* ========== RESPONSIVE ========== */
    @media (max-width: 900px) {
      .exec-view {
        grid-template-columns: 1fr;
      }

      .role-bar {
        flex-direction: column;
        gap: 16px;
      }

      .filter-bar {
        flex-wrap: wrap;
      }

      .pulse-bar {
        flex-direction: column;
        gap: 12px;
        text-align: center;
      }

      .pulse-left {
        flex-direction: column;
      }
    }

    /* ========== EMPTY STATE ========== */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .empty-emoji {
      font-size: 64px;
      margin-bottom: 16px;
    }

    /* ========== REFRESH ========== */
    .refresh-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--accent);
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      transform: scale(1.1);
    }

    .refresh-btn.loading {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <!-- HERO PULSE BAR -->
  <div class="pulse-bar">
    <div class="pulse-left">
      <div class="pulse-status" id="systemStatus">🟢</div>
      <div class="pulse-workflows">
        <span class="count" id="workflowCount">0</span> active workflows
      </div>
    </div>
    <div class="pulse-alert watch" id="topAlert" onclick="scrollToActions()" style="display: none;">
      <span class="pulse-alert-text" id="topAlertText">Loading...</span>
      <span class="pulse-alert-arrow">→</span>
    </div>
  </div>

  <!-- ROLE PICKER + FILTERS -->
  <div class="role-bar">
    <div class="role-picker">
      <button class="role-btn active" data-role="exec" onclick="switchRole('exec')">Executive</button>
      <button class="role-btn" data-role="compliance" onclick="switchRole('compliance')">Compliance</button>
      <button class="role-btn" data-role="engineer" onclick="switchRole('engineer')">Engineer</button>
    </div>
    <div class="filter-bar">
      <select id="tenantFilter" onchange="applyFilters()">
        <option value="">All Tenants</option>
      </select>
      <select id="timeFilter" onchange="applyFilters()">
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
        <option value="90d">Last 90 Days</option>
      </select>
      <input type="text" id="searchFilter" placeholder="Search..." oninput="applyFilters()">
    </div>
  </div>

  <!-- MAIN CONTENT -->
  <div class="main-content">

    <!-- EXECUTIVE VIEW -->
    <div class="exec-view view-active" id="execView">
      <div class="exec-tile safe" id="complianceTile" onclick="drillDown('compliance')">
        <div class="exec-emoji" id="complianceEmoji">🟢</div>
        <div class="exec-label">Compliance</div>
        <div class="exec-status" id="complianceStatus">Safe</div>
      </div>
      <div class="exec-tile safe" id="spendTile" onclick="drillDown('spend')">
        <div class="exec-emoji" id="spendEmoji">🟢</div>
        <div class="exec-label">AI Spend</div>
        <div class="exec-status" id="spendStatus">Safe</div>
      </div>
      <div class="exec-tile safe" id="alertsTile" onclick="drillDown('alerts')">
        <div class="exec-emoji" id="alertsEmoji">🟢</div>
        <div class="exec-label">Alerts</div>
        <div class="exec-status" id="alertsStatus">Safe</div>
      </div>
    </div>

    <!-- COMPLIANCE VIEW -->
    <div class="compliance-view" id="complianceView">
      <div class="metric-grid">
        <div class="metric-card" id="gatekeeperCard">
          <div class="metric-header">
            <span class="metric-title">Gatekeeper Blocks</span>
            <span class="metric-badge safe" id="gatekeeperBadge">Safe</span>
          </div>
          <div class="metric-value" id="gatekeeperValue">0</div>
          <div class="metric-narrative" id="gatekeeperNarrative">No blocks this period</div>
          <button class="expand-btn" onclick="toggleExpand('gatekeeperCard')">Show Top 3</button>
          <div class="metric-expand" id="gatekeeperExpand"></div>
        </div>

        <div class="metric-card" id="voidsCard">
          <div class="metric-header">
            <span class="metric-title">Open VOIDs</span>
            <span class="metric-badge safe" id="voidsBadge">Safe</span>
          </div>
          <div class="metric-value" id="voidsValue">0</div>
          <div class="metric-narrative" id="voidsNarrative">All compliance gaps closed</div>
          <button class="expand-btn" onclick="toggleExpand('voidsCard')">Show Top 3</button>
          <div class="metric-expand" id="voidsExpand"></div>
        </div>

        <div class="metric-card" id="violationsCard">
          <div class="metric-header">
            <span class="metric-title">Policy Violations</span>
            <span class="metric-badge safe" id="violationsBadge">Safe</span>
          </div>
          <div class="metric-value" id="violationsValue">0</div>
          <div class="metric-narrative" id="violationsNarrative">No violations detected</div>
          <button class="expand-btn" onclick="toggleExpand('violationsCard')">Show Details</button>
          <div class="metric-expand" id="violationsExpand"></div>
        </div>
      </div>
    </div>

    <!-- ENGINEER VIEW -->
    <div class="engineer-view" id="engineerView">
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">AI Requests (This Week)</span>
          </div>
          <div class="metric-value" id="aiRequestsValue">0</div>
          <div class="metric-narrative" id="aiRequestsNarrative">0 total all-time</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Avg Drift Score</span>
            <span class="metric-badge safe" id="driftBadge">Safe</span>
          </div>
          <div class="metric-value" id="driftValue">0</div>
          <div class="metric-narrative" id="driftNarrative">Drift under control</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Gatekeeper Stats</span>
          </div>
          <div class="metric-value" id="gatekeeperStatsValue">0</div>
          <div class="metric-narrative" id="gatekeeperStatsNarrative">prechecks / postchecks</div>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-title">AI Requests (Last 7 Days)</div>
        <div class="bar-chart" id="requestsChart"></div>
        <div class="provider-badges" id="providerBadges"></div>
      </div>
    </div>

    <!-- ACTION ITEMS (visible in all views) -->
    <div class="action-section" id="actionSection">
      <div class="section-title">⚡ Action Required</div>
      <div class="action-list" id="actionList">
        <div class="empty-state">
          <div class="empty-emoji">✅</div>
          <div>All clear! No action items.</div>
        </div>
      </div>
    </div>

  </div>

  <!-- REFRESH FAB -->
  <button class="refresh-btn" id="refreshBtn" onclick="refreshData()">↻</button>

  <script>
    let dashboardData = JSON.parse('<?= data ?>');
    let currentRole = 'exec';

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      renderDashboard(dashboardData);
    });

    function switchRole(role) {
      currentRole = role;

      // Update buttons
      document.querySelectorAll('.role-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.role === role);
      });

      // Update views
      document.getElementById('execView').classList.toggle('view-active', role === 'exec');
      document.getElementById('complianceView').classList.toggle('view-active', role === 'compliance');
      document.getElementById('engineerView').classList.toggle('view-active', role === 'engineer');
    }

    function renderDashboard(data) {
      // Pulse bar
      const statusEmoji = { SAFE: '🟢', WATCH: '🟡', ACTION: '🔴' };
      document.getElementById('systemStatus').textContent = statusEmoji[data.pulse.systemStatus] || '🟢';
      document.getElementById('workflowCount').textContent = data.pulse.activeWorkflows;

      // Top alert
      const topAlertEl = document.getElementById('topAlert');
      if (data.pulse.topAlert) {
        topAlertEl.style.display = 'flex';
        topAlertEl.className = 'pulse-alert ' + data.pulse.topAlert.severity.toLowerCase();
        document.getElementById('topAlertText').textContent = data.pulse.topAlert.title;
      } else {
        topAlertEl.style.display = 'none';
      }

      // Executive tiles
      renderExecTile('compliance', data.exec.compliance);
      renderExecTile('spend', data.exec.spend);
      renderExecTile('alerts', data.exec.alerts);

      // Compliance view
      renderMetricCard('gatekeeper', data.compliance.gatekeeperBlocks.count,
        data.compliance.gatekeeperBlocks.narrative,
        data.compliance.gatekeeperBlocks.count > 5 ? 'action' : data.compliance.gatekeeperBlocks.count > 0 ? 'watch' : 'safe');

      renderMetricCard('voids', data.compliance.openVoids.count,
        data.compliance.openVoids.count > 0 ? data.compliance.openVoids.count + ' documentation gaps need filling' : 'All compliance gaps closed',
        data.compliance.openVoids.count > 3 ? 'action' : data.compliance.openVoids.count > 0 ? 'watch' : 'safe');

      renderMetricCard('violations', data.compliance.policyViolations.count,
        data.compliance.policyViolations.narrative || 'No violations detected',
        data.compliance.policyViolations.count > 0 ? 'action' : 'safe');

      // Expand content for gatekeeper
      const gatekeeperExpand = document.getElementById('gatekeeperExpand');
      if (data.compliance.gatekeeperBlocks.topReasons.length > 0) {
        gatekeeperExpand.innerHTML = data.compliance.gatekeeperBlocks.topReasons
          .map(r => '<div class="expand-item"><span>' + r.label + '</span><span>' + r.count + '</span></div>')
          .join('');
      }

      // Engineer view
      document.getElementById('aiRequestsValue').textContent = data.engineer.aiRequests.thisWeek.toLocaleString();
      document.getElementById('aiRequestsNarrative').textContent =
        data.engineer.aiRequests.total.toLocaleString() + ' total all-time • $' + (data.engineer.aiRequests.spend || 0).toFixed(2) + ' spent';

      document.getElementById('driftValue').textContent = data.engineer.driftScores.average;
      document.getElementById('driftNarrative').textContent = data.engineer.driftScores.narrative || 'No drift data';
      document.getElementById('driftBadge').className = 'metric-badge ' +
        (data.engineer.driftScores.average > 40 ? 'action' : data.engineer.driftScores.average > 20 ? 'watch' : 'safe');
      document.getElementById('driftBadge').textContent =
        data.engineer.driftScores.average > 40 ? 'High' : data.engineer.driftScores.average > 20 ? 'Watch' : 'Safe';

      document.getElementById('gatekeeperStatsValue').textContent = data.engineer.gatekeeperStats.blocked;
      document.getElementById('gatekeeperStatsNarrative').textContent =
        data.engineer.gatekeeperStats.prechecks + ' prechecks / ' + data.engineer.gatekeeperStats.postchecks + ' postchecks';

      // Chart
      renderChart(data.engineer.aiRequests.byDay);
      renderProviders(data.engineer.aiRequests.byProvider);

      // Tenants filter
      const tenantSelect = document.getElementById('tenantFilter');
      tenantSelect.innerHTML = '<option value="">All Tenants</option>' +
        data.tenants.map(t => '<option value="' + t + '">' + t + '</option>').join('');

      // Action items
      renderActionItems(data.actionItems);
    }

    function renderExecTile(id, status) {
      const tile = document.getElementById(id + 'Tile');
      tile.className = 'exec-tile ' + status.status.toLowerCase();
      document.getElementById(id + 'Emoji').textContent = status.emoji;
      document.getElementById(id + 'Status').textContent = status.label;
    }

    function renderMetricCard(id, value, narrative, status) {
      document.getElementById(id + 'Value').textContent = value;
      document.getElementById(id + 'Narrative').textContent = narrative;
      document.getElementById(id + 'Badge').className = 'metric-badge ' + status;
      document.getElementById(id + 'Badge').textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }

    function renderChart(byDay) {
      const container = document.getElementById('requestsChart');
      if (!byDay || byDay.length === 0) {
        container.innerHTML = '<div class="empty-state">No data for this period</div>';
        return;
      }

      const max = Math.max(...byDay.map(d => d.count), 1);

      // Fill in missing days
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().split('T')[0];
        const existing = byDay.find(x => x.date === key);
        days.push({
          date: key,
          count: existing ? existing.count : 0,
          label: d.toLocaleDateString('en-US', { weekday: 'short' })
        });
      }

      container.innerHTML = days.map(d =>
        '<div class="bar-wrapper">' +
          '<div class="bar-value">' + d.count + '</div>' +
          '<div class="bar" style="height: ' + (d.count / max * 100) + '%"></div>' +
          '<div class="bar-label">' + d.label + '</div>' +
        '</div>'
      ).join('');
    }

    function renderProviders(byProvider) {
      const container = document.getElementById('providerBadges');
      if (!byProvider || Object.keys(byProvider).length === 0) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = Object.entries(byProvider)
        .map(([provider, count]) =>
          '<div class="provider-badge">' + provider + '<span class="count">' + count + '</span></div>'
        ).join('');
    }

    function renderActionItems(items) {
      const container = document.getElementById('actionList');

      if (!items || items.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-emoji">✅</div><div>All clear! No action items.</div></div>';
        return;
      }

      container.innerHTML = items.map(item =>
        '<div class="action-item ' + item.severity.toLowerCase() + '">' +
          '<div class="action-icon">' + (item.severity === 'ACTION' ? '🔴' : '🟡') + '</div>' +
          '<div class="action-content">' +
            '<div class="action-title">' + item.title + '</div>' +
            '<div class="action-narrative">' + item.narrative + '</div>' +
          '</div>' +
          '<button class="fix-btn" onclick="fixIt(\'' + item.fixWorkflow + '\')">' + item.fixAction + '</button>' +
        '</div>'
      ).join('');
    }

    function toggleExpand(cardId) {
      document.getElementById(cardId).classList.toggle('expanded');
    }

    function drillDown(category) {
      if (category === 'compliance') {
        switchRole('compliance');
      } else if (category === 'alerts') {
        scrollToActions();
      } else if (category === 'spend') {
        switchRole('engineer');
      }
    }

    function scrollToActions() {
      document.getElementById('actionSection').scrollIntoView({ behavior: 'smooth' });
    }

    function fixIt(workflow) {
      // Show loading
      const btn = event.target;
      const originalText = btn.textContent;
      btn.textContent = '...';
      btn.disabled = true;

      // Call backend
      google.script.run
        .withSuccessHandler(result => {
          btn.textContent = '✓ Done';
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 2000);

          if (result.instruction) {
            alert(result.instruction);
          }
        })
        .withFailureHandler(err => {
          btn.textContent = 'Error';
          btn.disabled = false;
          console.error(err);
        })
        .triggerFixWorkflow_(workflow, {});
    }

    function applyFilters() {
      // Filters would re-fetch with params
      // For now just log
      console.log('Filters:', {
        tenant: document.getElementById('tenantFilter').value,
        time: document.getElementById('timeFilter').value,
        search: document.getElementById('searchFilter').value
      });
    }

    function refreshData() {
      const btn = document.getElementById('refreshBtn');
      btn.classList.add('loading');

      google.script.run
        .withSuccessHandler(data => {
          dashboardData = data;
          renderDashboard(data);
          btn.classList.remove('loading');
        })
        .withFailureHandler(err => {
          btn.classList.remove('loading');
          console.error(err);
        })
        .collectDashboardData_v2_();
    }
  </script>
</body>
</html>`;
}

// ============================================================================
// UI FUNCTIONS
// ============================================================================

function openDashboardV2() {
  const url = ScriptApp.getService().getUrl();
  if (url) {
    SpreadsheetApp.getUi().alert('Dashboard URL', url, SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    SpreadsheetApp.getUi().alert('Deploy the script as a web app first:\nDeploy > New Deployment > Web App');
  }
}

function previewDashboardDataV2() {
  const data = collectDashboardData_v2_();
  const ui = SpreadsheetApp.getUi();

  let summary = 'DASHBOARD DATA PREVIEW\n\n';
  summary += 'System Status: ' + data.pulse.systemStatus + '\n';
  summary += 'Active Workflows: ' + data.pulse.activeWorkflows + '\n\n';

  summary += 'EXECUTIVE VIEW:\n';
  summary += '  Compliance: ' + data.exec.compliance.emoji + ' ' + data.exec.compliance.label + '\n';
  summary += '  Spend: ' + data.exec.spend.emoji + ' ' + data.exec.spend.label + '\n';
  summary += '  Alerts: ' + data.exec.alerts.emoji + ' ' + data.exec.alerts.label + '\n\n';

  summary += 'ACTION ITEMS: ' + data.actionItems.length + '\n';
  data.actionItems.slice(0, 3).forEach(item => {
    summary += '  • ' + item.title + '\n';
  });

  ui.alert('Dashboard Preview', summary, ui.ButtonSet.OK);
}
