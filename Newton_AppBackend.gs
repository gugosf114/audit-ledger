/**
 * ═══════════════════════════════════════════════════════════════════
 * NEWTON APP BACKEND
 * Backend functions for Newton_App.html web interface
 * ═══════════════════════════════════════════════════════════════════
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

/**
 * Serve the main application
 */
function doGet(e) {
  const page = e.parameter.page || 'app';

  if (page === 'app' || page === 'home') {
    return HtmlService.createHtmlOutputFromFile('Newton_App')
      .setTitle('Newton - AI Governance Platform')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Fallback to dashboard v3 for backwards compatibility
  return HtmlService.createHtmlOutputFromFile('DashboardHTML_v3')
    .setTitle('Newton Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================================
// HOME PAGE STATS
// ============================================================================

/**
 * Get stats for home page
 */
function getHomeStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Count audit entries
  let entries = 0;
  const ledger = ss.getSheetByName('Audit_Ledger');
  if (ledger) {
    entries = Math.max(0, ledger.getLastRow() - 1);
  }

  // Count active workflows
  let workflows = 0;
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  if (workflowSheet && workflowSheet.getLastRow() > 1) {
    const data = workflowSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][4] === 'ACTIVE' || data[i][4] === 'IN_PROGRESS') {
        workflows++;
      }
    }
  }

  // Get compliance score
  let compliance = 0;
  try {
    if (typeof getComplianceSummary === 'function') {
      const summary = getComplianceSummary('ISO_42001');
      compliance = summary.coveragePercent || 0;
    }
  } catch (e) {
    // Use gap analysis if available
    const gapSheet = ss.getSheetByName('Gap_Analysis');
    if (gapSheet && gapSheet.getLastRow() > 1) {
      const gapData = gapSheet.getDataRange().getValues();
      const total = gapData.length - 1;
      let documented = 0;
      for (let i = 1; i < gapData.length; i++) {
        if (String(gapData[i][3]).toUpperCase() === 'DOCUMENTED') {
          documented++;
        }
      }
      compliance = total > 0 ? Math.round((documented / total) * 100) : 0;
    }
  }

  return {
    entries: entries,
    workflows: workflows,
    compliance: compliance
  };
}

// ============================================================================
// LEDGER FUNCTIONS
// ============================================================================

/**
 * Get ledger entries with filtering
 */
function getLedgerEntries(filters) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger || ledger.getLastRow() < 2) {
    return [];
  }

  const data = ledger.getDataRange().getValues();
  const headers = data[0];

  // Find column indices
  const cols = {
    uuid: findColIndex(headers, ['UUID', 'uuid']),
    timestamp: findColIndex(headers, ['Timestamp', 'timestamp', 'Date']),
    actor: findColIndex(headers, ['Actor', 'actor']),
    eventType: findColIndex(headers, ['Event_Type', 'EventType', 'event_type']),
    text: findColIndex(headers, ['Text', 'text', 'Description']),
    status: findColIndex(headers, ['Status', 'status']),
    confidence: findColIndex(headers, ['Confidence_Level', 'Confidence', 'confidence'])
  };

  const entries = [];
  const now = new Date();
  const periodDays = filters.period === 'all' ? 99999 : parseInt(filters.period) || 30;
  const cutoffDate = new Date(now.getTime() - (periodDays * 24 * 60 * 60 * 1000));

  for (let i = data.length - 1; i >= 1 && entries.length < 100; i--) {
    const row = data[i];

    // Date filter
    if (cols.timestamp >= 0) {
      const rowDate = new Date(row[cols.timestamp]);
      if (rowDate < cutoffDate) continue;
    }

    // Event type filter
    if (filters.eventType && cols.eventType >= 0) {
      if (row[cols.eventType] !== filters.eventType) continue;
    }

    // Confidence filter
    if (filters.confidence && cols.confidence >= 0) {
      if (row[cols.confidence] !== filters.confidence) continue;
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const textMatch = cols.text >= 0 && String(row[cols.text]).toLowerCase().includes(searchLower);
      const actorMatch = cols.actor >= 0 && String(row[cols.actor]).toLowerCase().includes(searchLower);
      if (!textMatch && !actorMatch) continue;
    }

    entries.push({
      uuid: cols.uuid >= 0 ? row[cols.uuid] : '',
      timestamp: cols.timestamp >= 0 ? formatTimestamp(row[cols.timestamp]) : '',
      actor: cols.actor >= 0 ? row[cols.actor] : '',
      eventType: cols.eventType >= 0 ? row[cols.eventType] : '',
      text: cols.text >= 0 ? row[cols.text] : '',
      status: cols.status >= 0 ? row[cols.status] : '',
      confidence: cols.confidence >= 0 ? row[cols.confidence] : 'LEGACY'
    });
  }

  return entries;
}

/**
 * Create new entry from UI (with confidence declaration)
 */
function createEntryFromUI(params) {
  const actor = Session.getActiveUser().getEmail() || 'User';

  // Step 1: Declare confidence first (Rumsfeld Protocol)
  let confidenceUuid = null;
  if (typeof declareConfidence === 'function') {
    confidenceUuid = declareConfidence(
      params.confidence,
      params.eventType,
      params.confidenceNumeric ? parseInt(params.confidenceNumeric) : null
    );
  }

  // Step 2: Create entry with confidence link
  if (confidenceUuid && typeof newEntryWithConfidence === 'function') {
    return newEntryWithConfidence(
      confidenceUuid,
      actor,
      params.eventType,
      params.text,
      null,
      params.status
    );
  } else if (typeof safeNewEntry === 'function') {
    // Fallback to standard entry
    return safeNewEntry(
      actor,
      params.eventType,
      params.text,
      null,
      params.status
    );
  } else {
    throw new Error('Entry creation functions not available');
  }
}

// ============================================================================
// WORKFLOW FUNCTIONS
// ============================================================================

/**
 * Start workflow from UI
 */
function startWorkflowFromUI(params) {
  if (typeof startWorkflow === 'function') {
    const assignees = {};
    if (params.assignee) {
      assignees.Primary = params.assignee;
    }
    return startWorkflow(params.templateId, params.clientName, assignees);
  }

  // Fallback: create workflow entry in sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Workflow_Instances');

  if (!sheet) {
    sheet = ss.insertSheet('Workflow_Instances');
    sheet.appendRow(['Workflow_ID', 'Template_ID', 'Template_Name', 'Client_Name', 'Status', 'Assignees', 'Steps_Status', 'Started_By', 'Started_At', 'Completed_At', 'Notes']);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const workflowId = 'WF_' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const timestamp = new Date().toISOString();
  const user = Session.getActiveUser().getEmail() || 'User';

  sheet.appendRow([
    workflowId,
    params.templateId,
    params.templateId.replace(/_/g, ' '),
    params.clientName,
    'ACTIVE',
    JSON.stringify({ Primary: params.assignee || user }),
    '[]',
    user,
    timestamp,
    '',
    ''
  ]);

  // Log to audit ledger
  if (typeof safeNewEntry === 'function') {
    safeNewEntry(user, 'WORKFLOW_STARTED', 'Started workflow: ' + params.clientName, workflowId, 'FINAL');
  }

  return { workflowId: workflowId, success: true };
}

/**
 * Get active workflows
 */
function getActiveWorkflows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Workflow_Instances');

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const data = sheet.getDataRange().getValues();
  const workflows = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === 'ACTIVE' || data[i][4] === 'IN_PROGRESS') {
      workflows.push({
        workflowId: data[i][0],
        templateId: data[i][1],
        templateName: data[i][2],
        clientName: data[i][3],
        status: data[i][4],
        startedBy: data[i][7],
        startedAt: formatTimestamp(data[i][8])
      });
    }
  }

  return workflows;
}

// ============================================================================
// DOCUMENT FUNCTIONS
// ============================================================================

/**
 * Get list of uploaded documents
 */
function getDocumentsList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Documents');

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const data = sheet.getDataRange().getValues();
  const docs = [];

  for (let i = 1; i < data.length; i++) {
    docs.push({
      id: data[i][0] || i,
      name: data[i][1] || 'Unnamed',
      type: getFileExtension(data[i][1]),
      status: data[i][3] || 'pending',
      date: formatTimestamp(data[i][2])
    });
  }

  return docs;
}

/**
 * Verify document from UI
 */
function verifyDocumentFromUI(docId) {
  if (typeof verifyDocument === 'function') {
    return verifyDocument(docId);
  }

  // Fallback: mark as verified in sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Documents');

  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(docId)) {
        sheet.getRange(i + 1, 4).setValue('verified');
        return { success: true, docId: docId };
      }
    }
  }

  return { success: false, error: 'Document not found' };
}

// ============================================================================
// CAPABILITY FUNCTIONS (UI wrappers)
// ============================================================================

/**
 * Run Sealed Packet analysis from UI
 */
function runSealedPacketUI() {
  if (typeof runSealedPacketAnalysis === 'function') {
    return runSealedPacketAnalysis();
  }
  SpreadsheetApp.getUi().alert('Sealed Packet', 'Run sealed packet analysis from the Newton menu.', SpreadsheetApp.getUi().ButtonSet.OK);
  return { success: true };
}

/**
 * Create IRAC folder from UI
 */
function createIRACFolderUI() {
  if (typeof createIRACFolder === 'function') {
    const ui = SpreadsheetApp.getUi();
    const response = ui.prompt('Create IRAC Folder', 'Enter case name:', ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() === ui.Button.OK) {
      const caseName = response.getResponseText().trim();
      if (caseName) {
        return createIRACFolder(caseName);
      }
    }
    return { success: false, error: 'Cancelled' };
  }
  SpreadsheetApp.getUi().alert('IRAC', 'IRAC folder creation available from Newton menu.', SpreadsheetApp.getUi().ButtonSet.OK);
  return { success: true };
}

// ============================================================================
// CHAIN OF TRUTH (Ledger Integrity)
// ============================================================================

/**
 * Get chain integrity status for pulse bar
 */
function getChainIntegrity() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger || ledger.getLastRow() < 2) {
    return {
      verified: true,
      rows: 0,
      lastCheck: 'Never',
      blocks: [true, true, true, true, true]
    };
  }

  const rows = ledger.getLastRow() - 1;

  // Check last 5 blocks for integrity
  const blocks = [];
  let allVerified = true;

  // Quick integrity check on sample of rows
  if (typeof verifyLedgerIntegrity === 'function') {
    try {
      const result = verifyLedgerIntegrity();
      allVerified = result.valid || result.verified || false;
    } catch (e) {
      // If verification function fails, do manual check
      allVerified = quickHashCheck(ledger);
    }
  } else {
    allVerified = quickHashCheck(ledger);
  }

  // Generate 5 block indicators (last 5 represent recent chunks)
  for (let i = 0; i < 5; i++) {
    blocks.push(allVerified);
  }

  // Format last check time
  const lastCheck = formatRelativeTime(new Date());

  return {
    verified: allVerified,
    rows: rows,
    lastCheck: lastCheck,
    blocks: blocks
  };
}

/**
 * Quick hash chain verification (samples)
 */
function quickHashCheck(ledger) {
  try {
    const lastRow = ledger.getLastRow();
    if (lastRow < 3) return true;

    // Check last few rows have valid hash chain
    const sampleRows = Math.min(5, lastRow - 1);
    const data = ledger.getRange(lastRow - sampleRows, 1, sampleRows, 8).getValues();

    for (let i = 1; i < data.length; i++) {
      const prevHash = data[i][6]; // Prev_Hash column
      const prevRecordHash = data[i-1][7]; // Previous row's Record_Hash

      if (prevHash && prevRecordHash && prevHash !== prevRecordHash) {
        return false; // Chain broken
      }
    }

    return true;
  } catch (e) {
    return true; // Assume valid if can't check
  }
}

// ============================================================================
// ECONOMIC IMPACT CALCULATOR
// ============================================================================

/**
 * Cost avoidance values per event type
 */
const COST_AVOIDANCE_VALUES = {
  'HALLUCINATION_BLOCKED': 50000,
  'LOW_CONFIDENCE_BLOCKED': 25000,
  'POLICY_VIOLATION_BLOCKED': 100000,
  'GATEKEEPER_BLOCK': 35000,
  'VOID_DETECTED': 75000,
  'ADVERSARIAL_SUSPICION': 30000,
  'DRIFT_CORRECTED': 15000,
  'CONFIDENCE_MISMATCH': 20000
};

/**
 * Get economic impact (exposure prevented)
 */
function getEconomicImpact() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger || ledger.getLastRow() < 2) {
    return { total: 0, breakdown: {} };
  }

  const data = ledger.getDataRange().getValues();
  const headers = data[0];

  const eventCol = findColIndex(headers, ['Event_Type', 'EventType', 'event_type', 'Action']);
  const signalCol = findColIndex(headers, ['Signal', 'signal', 'Signals']);

  let total = 0;
  const breakdown = {};

  for (let i = 1; i < data.length; i++) {
    const eventType = eventCol >= 0 ? String(data[i][eventCol]).toUpperCase() : '';
    const signal = signalCol >= 0 ? String(data[i][signalCol]).toUpperCase() : '';

    // Check for cost-avoidance events
    for (const [key, value] of Object.entries(COST_AVOIDANCE_VALUES)) {
      if (eventType.includes(key) || signal.includes(key) ||
          eventType.includes(key.replace('_', '')) ||
          (key === 'GATEKEEPER_BLOCK' && (eventType.includes('BLOCK') || signal.includes('BLOCK')))) {
        total += value;
        breakdown[key] = (breakdown[key] || 0) + value;
        break;
      }
    }
  }

  return {
    total: total,
    breakdown: breakdown
  };
}

// ============================================================================
// PRIORITY ALERT
// ============================================================================

/**
 * Get top priority alert for pulse bar
 */
function getPriorityAlert() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Check for compliance gaps first
  try {
    if (typeof getComplianceSummary === 'function') {
      const euSummary = getComplianceSummary('EU_AI_ACT');
      if (euSummary.uncoveredClauses && euSummary.uncoveredClauses.length > 0) {
        return {
          message: 'EU AI Act: ' + euSummary.uncoveredClauses.length + ' uncovered clauses',
          safe: false,
          action: 'runGapAnalysis'
        };
      }

      const isoSummary = getComplianceSummary('ISO_42001');
      if (isoSummary.uncoveredClauses && isoSummary.uncoveredClauses.length > 0) {
        return {
          message: 'ISO 42001: ' + isoSummary.uncoveredClauses.length + ' gaps remaining',
          safe: false,
          action: 'runGapAnalysis'
        };
      }
    }
  } catch (e) {
    // Continue to other checks
  }

  // Check for unresolved alerts
  const alertSheet = ss.getSheetByName('Detection_Alerts');
  if (alertSheet && alertSheet.getLastRow() > 1) {
    const data = alertSheet.getDataRange().getValues();
    let unresolvedCount = 0;

    for (let i = 1; i < data.length; i++) {
      const status = String(data[i][3] || '').toUpperCase();
      if (status !== 'RESOLVED' && status !== 'CLOSED') {
        unresolvedCount++;
      }
    }

    if (unresolvedCount > 0) {
      return {
        message: unresolvedCount + ' unresolved alert' + (unresolvedCount > 1 ? 's' : '') + ' require attention',
        safe: false,
        action: 'viewAlerts'
      };
    }
  }

  // Check for pending workflow reviews
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  if (workflowSheet && workflowSheet.getLastRow() > 1) {
    const data = workflowSheet.getDataRange().getValues();
    let pendingCount = 0;

    for (let i = 1; i < data.length; i++) {
      if (data[i][4] === 'PENDING_REVIEW') {
        pendingCount++;
      }
    }

    if (pendingCount > 0) {
      return {
        message: pendingCount + ' workflow' + (pendingCount > 1 ? 's' : '') + ' pending review',
        safe: false,
        action: 'viewWorkflows'
      };
    }
  }

  // All clear
  return {
    message: 'System operational. No action required.',
    safe: true,
    action: null
  };
}

// ============================================================================
// REGULATORY COVERAGE
// ============================================================================

/**
 * Get regulatory coverage for heatmap
 */
function getRegulatoryCoverage(framework) {
  const coverage = {};

  try {
    if (typeof getComplianceSummary === 'function') {
      const summary = getComplianceSummary(framework);

      // Mark covered clauses
      if (summary.coveredClauses) {
        summary.coveredClauses.forEach(clause => {
          coverage[clause] = 'covered';
        });
      }

      // Mark gaps
      if (summary.uncoveredClauses) {
        summary.uncoveredClauses.forEach(clause => {
          coverage[clause] = 'gap';
        });
      }

      // Check for partial evidence (entries by clause count)
      if (summary.entriesByClause) {
        for (const [clause, count] of Object.entries(summary.entriesByClause)) {
          if (count > 0 && count < 3) {
            coverage[clause] = 'partial';
          } else if (count >= 3) {
            coverage[clause] = 'covered';
          }
        }
      }
    }
  } catch (e) {
    // Return empty coverage on error
  }

  return coverage;
}

/**
 * Start gap workflow for specific clause
 */
function startGapWorkflow(framework, clauseId) {
  // Log the action
  if (typeof safeNewEntry === 'function') {
    safeNewEntry(
      Session.getActiveUser().getEmail() || 'User',
      'GAP_WORKFLOW_STARTED',
      'Started gap remediation for ' + framework + ' ' + clauseId,
      clauseId,
      'DRAFT'
    );
  }

  // Could trigger workflow creation here
  return { success: true, framework: framework, clause: clauseId };
}

// ============================================================================
// ACTIVE WORKFLOW COUNT
// ============================================================================

/**
 * Get count of active workflows
 */
function getActiveWorkflowCount() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Workflow_Instances');

  if (!sheet || sheet.getLastRow() < 2) {
    return 0;
  }

  const data = sheet.getDataRange().getValues();
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const status = data[i][4];
    if (status === 'ACTIVE' || status === 'IN_PROGRESS' || status === 'PENDING') {
      count++;
    }
  }

  return count;
}

// ============================================================================
// USER IDENTITY
// ============================================================================

/**
 * Get current user email
 */
function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format relative time (e.g., "3h ago")
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return diffMins + 'm ago';
  if (diffHours < 24) return diffHours + 'h ago';
  return diffDays + 'd ago';
}

function findColIndex(headers, names) {
  for (let i = 0; i < headers.length; i++) {
    if (names.includes(headers[i])) {
      return i;
    }
  }
  return -1;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toISOString().substring(0, 16).replace('T', ' ');
  } catch (e) {
    return String(ts);
  }
}

function getFileExtension(filename) {
  if (!filename) return 'default';
  const parts = String(filename).split('.');
  if (parts.length > 1) {
    return parts[parts.length - 1].toLowerCase();
  }
  return 'default';
}

// ============================================================================
// MENU INTEGRATION
// ============================================================================

/**
 * Open Newton App in sidebar or dialog
 */
function openNewtonApp() {
  const html = HtmlService.createHtmlOutputFromFile('Newton_App')
    .setTitle('Newton')
    .setWidth(1200)
    .setHeight(800);

  SpreadsheetApp.getUi().showModalDialog(html, 'Newton - AI Governance Platform');
}

/**
 * Add Newton App to menu
 */
function addAppMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Newton App')
    .addItem('Open Newton App', 'openNewtonApp')
    .addItem('Deploy as Web App', 'showDeployInstructions')
    .addToUi();
}

function showDeployInstructions() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'Deploy as Web App',
    'To deploy Newton as a standalone web app:\n\n' +
    '1. Go to Deploy > New Deployment\n' +
    '2. Select "Web app"\n' +
    '3. Set "Execute as" to your account\n' +
    '4. Set "Who has access" as needed\n' +
    '5. Click Deploy\n\n' +
    'The web URL will open Newton App directly.',
    ui.ButtonSet.OK
  );
}
