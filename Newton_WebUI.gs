/**
 * Newton_WebUI.gs
 * Web-based UI for Audit Ledger
 *
 * Deployment: Domain-only (Workspace users)
 * Features:
 * - Ledger view with pagination (client <1k, server ≥1k)
 * - Hash chain integrity status (chunked verification)
 * - New entry form with optional Confidence Declaration
 * - Co-Pilot mutation review
 * - Sentinel signal filtering
 *
 * @version 1.0.0
 * @author George Abrahamyan
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const WEBUI_CONFIG = {
  PAGE_SIZE: 50,
  CLIENT_SIDE_THRESHOLD: 1000,
  HASH_DISPLAY_LENGTH: 8,
  CHUNK_SIZE: 100,  // For chain verification
  VERSION: '1.0.0'
};

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Serves the web UI
 * @param {Object} e - Event object from Apps Script
 * @returns {HtmlOutput} The rendered HTML page
 */
function doGet(e) {
  const html = HtmlService.createHtmlOutput(getWebUIHtml_())
    .setTitle('Newton Audit Ledger')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return html;
}

// ============================================================================
// SERVER-SIDE API FUNCTIONS (called via google.script.run)
// ============================================================================

/**
 * Gets current user email for attribution
 * @returns {string} User email
 */
function WebUI_getCurrentUser() {
  return Session.getActiveUser().getEmail() || 'anonymous';
}

/**
 * Gets ledger data with hybrid pagination
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Rows per page
 * @returns {Object} { rows, totalRows, totalPages, isClientSide, signals }
 */
function WebUI_getLedgerData(page, pageSize) {
  page = page || 1;
  pageSize = pageSize || WEBUI_CONFIG.PAGE_SIZE;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Audit_Ledger');
  if (!sheet) throw new Error('Audit_Ledger sheet not found');

  const lastRow = sheet.getLastRow();
  const totalRows = Math.max(0, lastRow - 1); // Exclude header
  const totalPages = Math.ceil(totalRows / pageSize);
  const isClientSide = totalRows < WEBUI_CONFIG.CLIENT_SIDE_THRESHOLD;

  let rows = [];
  let headers = [];

  if (lastRow >= 1) {
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  if (isClientSide && totalRows > 0) {
    // Client-side: return all data
    const data = sheet.getRange(2, 1, totalRows, sheet.getLastColumn()).getValues();
    rows = data.map((row, idx) => formatLedgerRow_(row, headers, idx + 2));
  } else if (totalRows > 0) {
    // Server-side: return requested page
    const startRow = 2 + (page - 1) * pageSize;
    const numRows = Math.min(pageSize, lastRow - startRow + 1);
    if (numRows > 0) {
      const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
      rows = data.map((row, idx) => formatLedgerRow_(row, headers, startRow + idx));
    }
  }

  // Extract signal summary
  const signalCounts = {};
  rows.forEach(row => {
    if (row.signalTag) {
      signalCounts[row.signalTag] = (signalCounts[row.signalTag] || 0) + 1;
    }
  });

  return {
    rows: rows,
    totalRows: totalRows,
    totalPages: totalPages,
    currentPage: page,
    pageSize: pageSize,
    isClientSide: isClientSide,
    signalCounts: signalCounts,
    headers: headers
  };
}

/**
 * Formats a ledger row for display
 * @private
 */
function formatLedgerRow_(row, headers, rowNum) {
  const getCol = (name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? row[idx] : '';
  };

  const recordHash = getCol('Record Hash') || '';
  const prevHash = getCol('Prev Hash') || '';
  const text = getCol('Text') || '';

  // Detect signal tags in text
  const signalMatch = text.match(/\[(VOID_DETECTED|UNFALSIFIABLE|PARKED|RISK_ACCEPTED|SCHISM_CRITICAL|ADVERSARIAL_SUSPICION|SYSTEM_HALT|FATAL|CASCADE_FAILURE|ARTIFICIAL_STERILITY)\]/);

  return {
    rowNum: rowNum,
    uuid: getCol('UUID'),
    timestamp: getCol('Timestamp'),
    actor: getCol('Actor'),
    eventType: getCol('Event Type'),
    text: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
    fullText: text,
    gift: getCol('Gift'),
    prevHash: prevHash ? prevHash.substring(0, WEBUI_CONFIG.HASH_DISPLAY_LENGTH) + '...' : '',
    prevHashFull: prevHash,
    recordHash: recordHash ? recordHash.substring(0, WEBUI_CONFIG.HASH_DISPLAY_LENGTH) + '...' : '',
    recordHashFull: recordHash,
    status: getCol('Status'),
    signalTag: signalMatch ? signalMatch[1] : null,
    confidenceLevel: getCol('Confidence_Level') || null,
    confidenceUUID: getCol('Confidence_UUID') || null
  };
}

/**
 * Runs chunked hash chain verification
 * @param {number} startRow - Starting row (2-indexed)
 * @param {number} chunkSize - Rows per chunk
 * @returns {Object} { broken, mismatches, rowsChecked, complete, nextStartRow }
 */
function WebUI_auditChainChunk(startRow, chunkSize) {
  startRow = startRow || 2;
  chunkSize = chunkSize || WEBUI_CONFIG.CHUNK_SIZE;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Audit_Ledger');
  if (!sheet) throw new Error('Audit_Ledger sheet not found');

  const lastRow = sheet.getLastRow();
  if (startRow > lastRow) {
    return { broken: [], mismatches: [], rowsChecked: 0, complete: true, nextStartRow: null };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const endRow = Math.min(startRow + chunkSize - 1, lastRow);
  const numRows = endRow - startRow + 1;

  // Need previous row for chain verification
  const dataStartRow = startRow === 2 ? 2 : startRow - 1;
  const dataNumRows = startRow === 2 ? numRows : numRows + 1;
  const data = sheet.getRange(dataStartRow, 1, dataNumRows, sheet.getLastColumn()).getValues();

  const broken = [];
  const mismatches = [];

  const getCol = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? row[idx] : '';
  };

  // Get LEDGER_SECRET for hash verification
  let secret = '';
  try {
    secret = PropertiesService.getScriptProperties().getProperty('LEDGER_SECRET') || '';
  } catch (e) {
    // Can't verify hashes without secret
  }

  const offset = startRow === 2 ? 0 : 1;

  for (let i = offset; i < data.length; i++) {
    const row = data[i];
    const actualRowNum = dataStartRow + i;
    const uuid = getCol(row, 'UUID');
    const prevHash = getCol(row, 'Prev Hash');
    const recordHash = getCol(row, 'Record Hash');

    // Check chain continuity
    if (actualRowNum > 2) {
      const priorRow = data[i - 1];
      const priorRecordHash = getCol(priorRow, 'Record Hash');
      if (prevHash !== priorRecordHash) {
        broken.push({
          row: actualRowNum,
          uuid: uuid,
          expected: priorRecordHash ? priorRecordHash.substring(0, 8) + '...' : '(empty)',
          found: prevHash ? prevHash.substring(0, 8) + '...' : '(empty)'
        });
      }
    }

    // Verify hash if we have the secret
    if (secret && recordHash) {
      const computed = computeRowHash_(row, headers, secret);
      if (computed && computed !== recordHash) {
        mismatches.push({
          row: actualRowNum,
          uuid: uuid,
          stored: recordHash.substring(0, 8) + '...',
          computed: computed.substring(0, 8) + '...'
        });
      }
    }
  }

  return {
    broken: broken,
    mismatches: mismatches,
    rowsChecked: numRows,
    startRow: startRow,
    endRow: endRow,
    complete: endRow >= lastRow,
    nextStartRow: endRow < lastRow ? endRow + 1 : null,
    totalRows: lastRow - 1
  };
}

/**
 * Computes hash for a row (mirrors Code.gs logic)
 * @private
 */
function computeRowHash_(row, headers, secret) {
  const getCol = (name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] || '') : '';
  };

  // Check if this is a 17-column entry (has confidence data)
  const confLevel = getCol('Confidence_Level');
  const confUUID = getCol('Confidence_UUID');
  const confJust = getCol('Confidence_Justification');
  const hasConfidence = confLevel && confLevel.trim() !== '';

  let blob;
  if (hasConfidence) {
    // 17-column format
    blob = [
      getCol('UUID'),
      getCol('Timestamp'),
      getCol('Actor'),
      getCol('Event Type'),
      getCol('Text'),
      getCol('Gift'),
      getCol('Prev Hash'),
      getCol('Status'),
      getCol('Provision IDs'),
      getCol('Provision Titles'),
      getCol('Provision Snippets'),
      getCol('Provision URLs'),
      getCol('Citation Hash'),
      confLevel,
      confUUID,
      confJust
    ].join('|');
  } else {
    // 14-column format
    blob = [
      getCol('UUID'),
      getCol('Timestamp'),
      getCol('Actor'),
      getCol('Event Type'),
      getCol('Text'),
      getCol('Gift'),
      getCol('Prev Hash'),
      getCol('Status'),
      getCol('Provision IDs'),
      getCol('Provision Titles'),
      getCol('Provision Snippets'),
      getCol('Provision URLs'),
      getCol('Citation Hash')
    ].join('|');
  }

  // Compute SHA-256
  const normalized = blob.normalize('NFKD');
  const dataWithSecret = secret + normalized;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, dataWithSecret, Utilities.Charset.UTF_8);
  return hash.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

/**
 * Creates a new ledger entry
 * @param {Object} params - Entry parameters
 * @returns {Object} { success, uuid, error }
 */
function WebUI_createEntry(params) {
  try {
    const actor = params.actor || 'User';
    const eventType = params.eventType || 'NOTE';
    const text = params.text;
    const gift = params.gift || '';
    const status = params.status || 'DRAFT';

    if (!text || text.trim() === '') {
      return { success: false, error: 'Text is required' };
    }

    let result;

    // Check if confidence declaration is included
    if (params.includeConfidence && params.confidenceLevel) {
      // First declare confidence
      if (typeof declareConfidence !== 'function') {
        return { success: false, error: 'Confidence system not available' };
      }

      const confResult = declareConfidence(
        params.confidenceLevel,
        params.confidenceJustification || '',
        actor,
        params.confidenceNumeric || null
      );

      if (!confResult || !confResult.confidence_uuid) {
        return { success: false, error: 'Failed to declare confidence' };
      }

      // Then create entry with confidence
      if (typeof newEntryWithConfidence !== 'function') {
        return { success: false, error: 'Confidence-linked entry not available' };
      }

      result = newEntryWithConfidence(
        confResult.confidence_uuid,
        actor,
        eventType,
        text,
        gift,
        status
      );
    } else {
      // Standard entry
      if (typeof safeNewEntry === 'function') {
        result = safeNewEntry(actor, eventType, text, gift, status);
      } else if (typeof newEntry === 'function') {
        result = newEntry(actor, eventType, text, gift, status);
      } else {
        return { success: false, error: 'Entry creation function not available' };
      }
    }

    return {
      success: true,
      uuid: result.uuid,
      timestamp: result.ts,
      recordHash: result.recordHash ? result.recordHash.substring(0, 8) + '...' : null
    };

  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Gets pending Co-Pilot mutations
 * @returns {Array} Array of pending mutations
 */
function WebUI_getPendingMutations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CoPilot_Mutations');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  const statusIdx = headers.indexOf('Status');
  const pending = [];

  data.forEach((row, idx) => {
    if (row[statusIdx] === 'PENDING_REVIEW') {
      const mutation = {};
      headers.forEach((h, i) => {
        mutation[h] = row[i];
      });
      mutation.rowNum = idx + 2;
      pending.push(mutation);
    }
  });

  return pending;
}

/**
 * Approves a mutation
 * @param {string} mutationId - Mutation ID
 * @param {boolean} autoApply - Apply immediately after approval
 * @returns {Object} { success, error }
 */
function WebUI_approveMutation(mutationId, autoApply) {
  try {
    if (typeof approveCoPilotMutation === 'function') {
      const result = approveCoPilotMutation(mutationId, autoApply);
      return { success: true, result: result };
    } else {
      // Fallback: update directly
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('CoPilot_Mutations');
      if (!sheet) throw new Error('CoPilot_Mutations sheet not found');

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const data = sheet.getDataRange().getValues();

      const idIdx = headers.indexOf('Mutation_ID');
      const statusIdx = headers.indexOf('Status');
      const reviewedByIdx = headers.indexOf('Reviewed_By');
      const reviewedAtIdx = headers.indexOf('Reviewed_At');

      for (let i = 1; i < data.length; i++) {
        if (data[i][idIdx] === mutationId) {
          const row = i + 1;
          sheet.getRange(row, statusIdx + 1).setValue('APPROVED');
          sheet.getRange(row, reviewedByIdx + 1).setValue(Session.getActiveUser().getEmail());
          sheet.getRange(row, reviewedAtIdx + 1).setValue(new Date().toISOString());
          return { success: true };
        }
      }
      throw new Error('Mutation not found: ' + mutationId);
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Rejects a mutation
 * @param {string} mutationId - Mutation ID
 * @param {string} reason - Rejection reason
 * @returns {Object} { success, error }
 */
function WebUI_rejectMutation(mutationId, reason) {
  try {
    if (typeof rejectCoPilotMutation === 'function') {
      const result = rejectCoPilotMutation(mutationId, reason);
      return { success: true, result: result };
    } else {
      // Fallback: update directly
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName('CoPilot_Mutations');
      if (!sheet) throw new Error('CoPilot_Mutations sheet not found');

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const data = sheet.getDataRange().getValues();

      const idIdx = headers.indexOf('Mutation_ID');
      const statusIdx = headers.indexOf('Status');
      const reviewedByIdx = headers.indexOf('Reviewed_By');
      const reviewedAtIdx = headers.indexOf('Reviewed_At');
      const reasonIdx = headers.indexOf('Rejection_Reason');

      for (let i = 1; i < data.length; i++) {
        if (data[i][idIdx] === mutationId) {
          const row = i + 1;
          sheet.getRange(row, statusIdx + 1).setValue('REJECTED');
          sheet.getRange(row, reviewedByIdx + 1).setValue(Session.getActiveUser().getEmail());
          sheet.getRange(row, reviewedAtIdx + 1).setValue(new Date().toISOString());
          if (reasonIdx >= 0) {
            sheet.getRange(row, reasonIdx + 1).setValue(reason || '');
          }
          return { success: true };
        }
      }
      throw new Error('Mutation not found: ' + mutationId);
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Gets signals for Sentinel tab
 * @param {string} filterType - Optional signal type filter
 * @returns {Array} Array of signal entries
 */
function WebUI_getSignals(filterType) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Audit_Ledger');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  const textIdx = headers.indexOf('Text');
  const signals = [];

  const signalPattern = /\[(VOID_DETECTED|UNFALSIFIABLE|PARKED|RISK_ACCEPTED|SCHISM_CRITICAL|ADVERSARIAL_SUSPICION|SYSTEM_HALT|FATAL|CASCADE_FAILURE|ARTIFICIAL_STERILITY)\]/g;

  data.forEach((row, idx) => {
    const text = row[textIdx] || '';
    const matches = text.matchAll(signalPattern);

    for (const match of matches) {
      const signalType = match[1];
      if (!filterType || filterType === signalType) {
        const entry = {
          rowNum: idx + 2,
          signalType: signalType,
          uuid: row[headers.indexOf('UUID')],
          timestamp: row[headers.indexOf('Timestamp')],
          actor: row[headers.indexOf('Actor')],
          eventType: row[headers.indexOf('Event Type')],
          text: text.substring(0, 300) + (text.length > 300 ? '...' : ''),
          fullText: text,
          status: row[headers.indexOf('Status')],
          signalStatus: row[headers.indexOf('Signal_Status')] || 'UNPROCESSED',
          signalAction: row[headers.indexOf('Signal_Action')] || ''
        };
        signals.push(entry);
      }
    }
  });

  // Sort by timestamp descending
  signals.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateB - dateA;
  });

  return signals;
}

/**
 * Gets signal type counts for summary
 * @returns {Object} { signalType: count }
 */
function WebUI_getSignalSummary() {
  const signals = WebUI_getSignals();
  const summary = {};

  signals.forEach(s => {
    summary[s.signalType] = (summary[s.signalType] || 0) + 1;
  });

  return summary;
}

// ============================================================================
// HTML TEMPLATE
// ============================================================================

/**
 * Returns the complete HTML for the web UI
 * @private
 */
function getWebUIHtml_() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newton Audit Ledger</title>
  <style>
    /* ========================================
       CSS RESET & VARIABLES
       ======================================== */
    *, *::before, *::after {
      box-sizing: border-box;
    }

    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border-color: #30363d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --accent-blue: #58a6ff;
      --accent-green: #3fb950;
      --accent-red: #f85149;
      --accent-yellow: #d29922;
      --accent-purple: #a371f7;
      --accent-orange: #db6d28;
      --font-mono: 'SF Mono', 'Consolas', 'Liberation Mono', monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      --radius: 6px;
      --shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      background: var(--bg-primary);
      min-height: 100vh;
    }

    /* ========================================
       LAYOUT
       ======================================== */
    .app-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-title h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    .header-title .version {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .header-user {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .nav-tabs {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      padding: 0 24px;
      gap: 4px;
    }

    .nav-tab {
      padding: 12px 16px;
      cursor: pointer;
      color: var(--text-secondary);
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .nav-tab:hover {
      color: var(--text-primary);
    }

    .nav-tab.active {
      color: var(--text-primary);
      border-bottom-color: var(--accent-orange);
    }

    .nav-tab .badge {
      background: var(--accent-red);
      color: white;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }

    .main-content {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }

    .tab-panel {
      display: none;
    }

    .tab-panel.active {
      display: block;
    }

    /* ========================================
       TABLES
       ======================================== */
    .table-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .table-toolbar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .table-info {
      font-size: 13px;
      color: var(--text-secondary);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    th {
      background: var(--bg-tertiary);
      font-weight: 600;
      color: var(--text-secondary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    tr:hover td {
      background: var(--bg-tertiary);
    }

    .hash {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .uuid {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--accent-blue);
    }

    .timestamp {
      font-family: var(--font-mono);
      font-size: 12px;
      white-space: nowrap;
    }

    .text-cell {
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .text-cell:hover {
      white-space: normal;
      word-break: break-word;
    }

    /* ========================================
       BADGES & STATUS
       ======================================== */
    .status-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-DRAFT { background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); }
    .status-FINAL { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .status-VERIFIED { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .status-ERROR { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
    .status-PENDING_REVIEW { background: rgba(163, 113, 247, 0.2); color: var(--accent-purple); }
    .status-APPROVED { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .status-REJECTED { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
    .status-APPLIED { background: rgba(88, 166, 255, 0.2); color: var(--accent-blue); }

    .signal-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(248, 81, 73, 0.2);
      color: var(--accent-red);
    }

    .signal-badge.VOID_DETECTED { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
    .signal-badge.ADVERSARIAL_SUSPICION { background: rgba(248, 81, 73, 0.3); color: #ff6b6b; }
    .signal-badge.FATAL { background: rgba(248, 81, 73, 0.4); color: #ff4444; }
    .signal-badge.SYSTEM_HALT { background: rgba(248, 81, 73, 0.4); color: #ff4444; }
    .signal-badge.UNFALSIFIABLE { background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); }
    .signal-badge.PARKED { background: rgba(139, 148, 158, 0.2); color: var(--text-secondary); }
    .signal-badge.RISK_ACCEPTED { background: rgba(163, 113, 247, 0.2); color: var(--accent-purple); }

    .confidence-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      font-family: var(--font-mono);
    }

    .confidence-KNOWN_KNOWN { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .confidence-KNOWN_UNKNOWN { background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); }
    .confidence-UNKNOWN_UNKNOWN { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }

    /* ========================================
       FORMS
       ======================================== */
    .form-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
    }

    .form-section h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 600;
    }

    .form-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }

    .form-group {
      flex: 1;
    }

    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 8px 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      color: var(--text-primary);
      font-size: 14px;
      font-family: inherit;
    }

    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2);
    }

    .form-group textarea {
      min-height: 100px;
      resize: vertical;
    }

    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .checkbox-group input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }

    .confidence-section {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      padding: 16px;
      margin-top: 16px;
      display: none;
    }

    .confidence-section.visible {
      display: block;
    }

    .confidence-section h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-purple);
    }

    /* ========================================
       BUTTONS
       ======================================== */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      border: 1px solid transparent;
      border-radius: var(--radius);
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }

    .btn-primary {
      background: var(--accent-green);
      color: white;
    }

    .btn-primary:hover {
      background: #2ea043;
    }

    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-color: var(--border-color);
    }

    .btn-secondary:hover {
      background: var(--border-color);
    }

    .btn-danger {
      background: var(--accent-red);
      color: white;
    }

    .btn-danger:hover {
      background: #da3633;
    }

    .btn-sm {
      padding: 4px 10px;
      font-size: 12px;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-group {
      display: flex;
      gap: 8px;
    }

    /* ========================================
       CHAIN STATUS
       ======================================== */
    .chain-status {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
    }

    .chain-card {
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      padding: 20px;
    }

    .chain-card h4 {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .chain-card .value {
      font-size: 32px;
      font-weight: 600;
    }

    .chain-card .value.ok {
      color: var(--accent-green);
    }

    .chain-card .value.warning {
      color: var(--accent-yellow);
    }

    .chain-card .value.error {
      color: var(--accent-red);
    }

    .progress-bar {
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      margin: 16px 0;
      overflow: hidden;
    }

    .progress-bar .fill {
      height: 100%;
      background: var(--accent-blue);
      transition: width 0.3s;
    }

    .issue-list {
      max-height: 300px;
      overflow-y: auto;
    }

    .issue-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      background: var(--bg-tertiary);
      border-radius: var(--radius);
      margin-bottom: 8px;
    }

    .issue-item .icon {
      font-size: 16px;
    }

    .issue-item .details {
      flex: 1;
    }

    .issue-item .row-num {
      font-weight: 600;
      color: var(--accent-blue);
    }

    .issue-item .uuid {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .issue-item .hash-compare {
      font-family: var(--font-mono);
      font-size: 11px;
      margin-top: 4px;
    }

    .issue-item .expected {
      color: var(--accent-green);
    }

    .issue-item .found {
      color: var(--accent-red);
    }

    /* ========================================
       MUTATION CARDS
       ======================================== */
    .mutation-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 16px;
    }

    .mutation-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      padding: 16px;
    }

    .mutation-card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .mutation-id {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--accent-purple);
    }

    .mutation-type {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--bg-tertiary);
    }

    .mutation-target {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }

    .mutation-diff {
      background: var(--bg-primary);
      border-radius: var(--radius);
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      margin-bottom: 12px;
    }

    .diff-old {
      color: var(--accent-red);
    }

    .diff-old::before {
      content: '- ';
    }

    .diff-new {
      color: var(--accent-green);
    }

    .diff-new::before {
      content: '+ ';
    }

    .mutation-meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .mutation-actions {
      display: flex;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }

    .rejection-input {
      display: none;
      margin-top: 8px;
    }

    .rejection-input.visible {
      display: block;
    }

    /* ========================================
       SIGNAL CARDS
       ======================================== */
    .signal-filters {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .signal-filter {
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s;
    }

    .signal-filter:hover,
    .signal-filter.active {
      background: var(--accent-orange);
      color: white;
      border-color: var(--accent-orange);
    }

    .signal-filter .count {
      margin-left: 6px;
      opacity: 0.7;
    }

    .signal-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .signal-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      padding: 16px;
    }

    .signal-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .signal-text {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-primary);
      padding: 12px;
      background: var(--bg-primary);
      border-radius: var(--radius);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .signal-meta {
      display: flex;
      gap: 16px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ========================================
       PAGINATION
       ======================================== */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px;
      border-top: 1px solid var(--border-color);
    }

    .page-btn {
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 13px;
    }

    .page-btn:hover {
      background: var(--border-color);
    }

    .page-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .page-btn.active {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
    }

    .page-info {
      font-size: 13px;
      color: var(--text-secondary);
      margin: 0 12px;
    }

    /* ========================================
       LOADING & EMPTY STATES
       ======================================== */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .empty-state .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .empty-state h3 {
      margin: 0 0 8px 0;
      color: var(--text-primary);
    }

    /* ========================================
       TOAST NOTIFICATIONS
       ======================================== */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 1000;
    }

    .toast {
      padding: 12px 16px;
      border-radius: var(--radius);
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: slideIn 0.3s ease;
      box-shadow: var(--shadow);
    }

    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .toast.success {
      background: var(--accent-green);
      color: white;
    }

    .toast.error {
      background: var(--accent-red);
      color: white;
    }

    .toast.info {
      background: var(--accent-blue);
      color: white;
    }

    /* ========================================
       MODAL
       ======================================== */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s;
    }

    .modal-overlay.visible {
      opacity: 1;
      visibility: visible;
    }

    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow: auto;
    }

    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-header h3 {
      margin: 0;
      font-size: 16px;
    }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 20px;
      cursor: pointer;
      padding: 4px;
    }

    .modal-close:hover {
      color: var(--text-primary);
    }

    .modal-body {
      padding: 20px;
    }

    .modal-body pre {
      background: var(--bg-primary);
      padding: 16px;
      border-radius: var(--radius);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="app-container">
    <!-- Header -->
    <header class="header">
      <div class="header-title">
        <h1>Newton Audit Ledger</h1>
        <span class="version">v${WEBUI_CONFIG.VERSION}</span>
      </div>
      <div class="header-user" id="headerUser">Loading...</div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="nav-tabs">
      <div class="nav-tab active" data-tab="ledger">Ledger</div>
      <div class="nav-tab" data-tab="chain">Chain Status</div>
      <div class="nav-tab" data-tab="entry">New Entry</div>
      <div class="nav-tab" data-tab="mutations">
        Mutations
        <span class="badge" id="mutationsBadge" style="display:none">0</span>
      </div>
      <div class="nav-tab" data-tab="sentinel">Sentinel</div>
    </nav>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Ledger Tab -->
      <div class="tab-panel active" id="tab-ledger">
        <div class="table-container">
          <div class="table-toolbar">
            <div class="table-info" id="ledgerInfo">Loading...</div>
            <button class="btn btn-secondary btn-sm" onclick="refreshLedger()">Refresh</button>
          </div>
          <div id="ledgerTableWrapper">
            <div class="loading">
              <div class="spinner"></div>
              <div>Loading ledger data...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chain Status Tab -->
      <div class="tab-panel" id="tab-chain">
        <div class="chain-status">
          <div class="chain-card">
            <h4>Rows Verified</h4>
            <div class="value" id="chainRowsVerified">-</div>
          </div>
          <div class="chain-card">
            <h4>Chain Breaks</h4>
            <div class="value" id="chainBreaks">-</div>
          </div>
          <div class="chain-card">
            <h4>Hash Mismatches</h4>
            <div class="value" id="chainMismatches">-</div>
          </div>
        </div>

        <div class="progress-bar">
          <div class="fill" id="chainProgress" style="width: 0%"></div>
        </div>

        <div class="btn-group" style="margin-bottom: 20px;">
          <button class="btn btn-primary" id="startAuditBtn" onclick="startChainAudit()">Start Verification</button>
          <button class="btn btn-secondary" id="stopAuditBtn" onclick="stopChainAudit()" style="display:none">Stop</button>
        </div>

        <div id="chainIssues"></div>
      </div>

      <!-- New Entry Tab -->
      <div class="tab-panel" id="tab-entry">
        <div class="form-section">
          <h3>Create New Ledger Entry</h3>

          <div class="form-row">
            <div class="form-group">
              <label for="entryActor">Actor</label>
              <select id="entryActor">
                <option value="User">User</option>
                <option value="Admin">Admin</option>
                <option value="System">System</option>
              </select>
            </div>
            <div class="form-group">
              <label for="entryEventType">Event Type</label>
              <select id="entryEventType">
                <option value="NOTE">NOTE</option>
                <option value="DECISION">DECISION</option>
                <option value="REVIEW">REVIEW</option>
                <option value="OBSERVATION">OBSERVATION</option>
                <option value="INVESTIGATION">INVESTIGATION</option>
                <option value="FINDING">FINDING</option>
                <option value="CONCLUSION">CONCLUSION</option>
              </select>
            </div>
            <div class="form-group">
              <label for="entryStatus">Status</label>
              <select id="entryStatus">
                <option value="DRAFT">DRAFT</option>
                <option value="FINAL">FINAL</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="entryText">Text *</label>
            <textarea id="entryText" placeholder="Enter the content of your ledger entry..."></textarea>
          </div>

          <div class="form-group">
            <label for="entryGift">Gift (optional metadata)</label>
            <input type="text" id="entryGift" placeholder="Optional tip or metadata">
          </div>

          <div class="checkbox-group">
            <input type="checkbox" id="includeConfidence" onchange="toggleConfidenceSection()">
            <label for="includeConfidence">Include Confidence Declaration</label>
          </div>

          <div class="confidence-section" id="confidenceSection">
            <h4>Confidence Declaration (Rumsfeld Protocol)</h4>

            <div class="form-row">
              <div class="form-group">
                <label for="confidenceLevel">Confidence Level</label>
                <select id="confidenceLevel">
                  <option value="KNOWN_KNOWN">KNOWN_KNOWN (High confidence, direct evidence)</option>
                  <option value="KNOWN_UNKNOWN">KNOWN_UNKNOWN (Identified gap)</option>
                  <option value="UNKNOWN_UNKNOWN">UNKNOWN_UNKNOWN (Speculation)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="confidenceNumeric">Numeric Confidence (0-100, optional)</label>
                <input type="number" id="confidenceNumeric" min="0" max="100" placeholder="e.g., 85">
              </div>
            </div>

            <div class="form-group">
              <label for="confidenceJustification">Justification (required for KNOWN_KNOWN)</label>
              <textarea id="confidenceJustification" placeholder="Explain the basis for your confidence level..."></textarea>
            </div>
          </div>

          <button class="btn btn-primary" onclick="submitEntry()">Create Entry</button>
        </div>
      </div>

      <!-- Mutations Tab -->
      <div class="tab-panel" id="tab-mutations">
        <div id="mutationsContent">
          <div class="loading">
            <div class="spinner"></div>
            <div>Loading mutations...</div>
          </div>
        </div>
      </div>

      <!-- Sentinel Tab -->
      <div class="tab-panel" id="tab-sentinel">
        <div class="signal-filters" id="signalFilters">
          <div class="signal-filter active" data-filter="all">All Signals</div>
        </div>
        <div id="signalsList">
          <div class="loading">
            <div class="spinner"></div>
            <div>Loading signals...</div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Toast Container -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- Modal -->
  <div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="modalTitle">Details</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body" id="modalBody"></div>
    </div>
  </div>

  <script>
    // ========================================
    // STATE
    // ========================================
    const state = {
      currentTab: 'ledger',
      ledgerData: null,
      currentPage: 1,
      isClientSide: true,
      chainAuditRunning: false,
      chainAuditResults: { broken: [], mismatches: [], rowsChecked: 0, totalRows: 0 },
      mutations: [],
      signals: [],
      signalFilter: 'all',
      currentUser: ''
    };

    // ========================================
    // INITIALIZATION
    // ========================================
    document.addEventListener('DOMContentLoaded', init);

    function init() {
      setupTabNavigation();
      loadCurrentUser();
      refreshLedger();
      loadMutations();
      loadSignals();
    }

    function setupTabNavigation() {
      document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const tabName = tab.dataset.tab;
          switchTab(tabName);
        });
      });
    }

    function switchTab(tabName) {
      state.currentTab = tabName;

      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelector(\`.nav-tab[data-tab="\${tabName}"]\`).classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(\`tab-\${tabName}\`).classList.add('active');
    }

    function loadCurrentUser() {
      google.script.run
        .withSuccessHandler(user => {
          state.currentUser = user;
          document.getElementById('headerUser').textContent = user;
        })
        .withFailureHandler(err => {
          document.getElementById('headerUser').textContent = 'Not authenticated';
        })
        .WebUI_getCurrentUser();
    }

    // ========================================
    // LEDGER TAB
    // ========================================
    function refreshLedger() {
      const wrapper = document.getElementById('ledgerTableWrapper');
      wrapper.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading ledger data...</div></div>';

      google.script.run
        .withSuccessHandler(renderLedger)
        .withFailureHandler(err => {
          wrapper.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3><p>' + err.message + '</p></div>';
        })
        .WebUI_getLedgerData(state.currentPage, ${WEBUI_CONFIG.PAGE_SIZE});
    }

    function renderLedger(data) {
      state.ledgerData = data;
      state.isClientSide = data.isClientSide;

      const info = document.getElementById('ledgerInfo');
      info.textContent = \`Showing \${data.rows.length} of \${data.totalRows} entries\${data.isClientSide ? ' (client-side pagination)' : ''}\`;

      if (data.rows.length === 0) {
        document.getElementById('ledgerTableWrapper').innerHTML =
          '<div class="empty-state"><div class="icon">📋</div><h3>No entries</h3><p>The ledger is empty.</p></div>';
        return;
      }

      let html = '<table><thead><tr>';
      html += '<th>Row</th><th>UUID</th><th>Timestamp</th><th>Actor</th><th>Event</th><th>Text</th><th>Status</th><th>Signals</th><th>Hash</th>';
      html += '</tr></thead><tbody>';

      const rows = state.isClientSide ? paginateClientSide(data.rows) : data.rows;

      rows.forEach(row => {
        html += '<tr>';
        html += \`<td>\${row.rowNum}</td>\`;
        html += \`<td><span class="uuid" title="\${row.uuid}">\${row.uuid ? row.uuid.substring(0, 8) + '...' : '-'}</span></td>\`;
        html += \`<td class="timestamp">\${formatTimestamp(row.timestamp)}</td>\`;
        html += \`<td>\${row.actor || '-'}</td>\`;
        html += \`<td>\${row.eventType || '-'}</td>\`;
        html += \`<td class="text-cell" onclick="showFullText('\${escapeJs(row.fullText)}')">\${escapeHtml(row.text)}</td>\`;
        html += \`<td><span class="status-badge status-\${row.status}">\${row.status || '-'}</span></td>\`;
        html += '<td>';
        if (row.signalTag) {
          html += \`<span class="signal-badge \${row.signalTag}">\${row.signalTag}</span>\`;
        }
        if (row.confidenceLevel) {
          html += \` <span class="confidence-badge confidence-\${row.confidenceLevel}">\${row.confidenceLevel}</span>\`;
        }
        html += '</td>';
        html += \`<td><span class="hash" title="\${row.recordHashFull}">\${row.recordHash || '-'}</span></td>\`;
        html += '</tr>';
      });

      html += '</tbody></table>';
      html += renderPagination(data);

      document.getElementById('ledgerTableWrapper').innerHTML = html;
    }

    function paginateClientSide(allRows) {
      const pageSize = ${WEBUI_CONFIG.PAGE_SIZE};
      const start = (state.currentPage - 1) * pageSize;
      return allRows.slice(start, start + pageSize);
    }

    function renderPagination(data) {
      if (data.totalPages <= 1) return '';

      const totalPages = state.isClientSide ? Math.ceil(data.totalRows / ${WEBUI_CONFIG.PAGE_SIZE}) : data.totalPages;

      let html = '<div class="pagination">';
      html += \`<button class="page-btn" onclick="goToPage(\${state.currentPage - 1})" \${state.currentPage <= 1 ? 'disabled' : ''}>← Prev</button>\`;

      // Show page numbers
      const maxButtons = 5;
      let startPage = Math.max(1, state.currentPage - Math.floor(maxButtons / 2));
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      startPage = Math.max(1, endPage - maxButtons + 1);

      if (startPage > 1) {
        html += '<button class="page-btn" onclick="goToPage(1)">1</button>';
        if (startPage > 2) html += '<span class="page-info">...</span>';
      }

      for (let i = startPage; i <= endPage; i++) {
        html += \`<button class="page-btn \${i === state.currentPage ? 'active' : ''}" onclick="goToPage(\${i})">\${i}</button>\`;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += '<span class="page-info">...</span>';
        html += \`<button class="page-btn" onclick="goToPage(\${totalPages})">\${totalPages}</button>\`;
      }

      html += \`<button class="page-btn" onclick="goToPage(\${state.currentPage + 1})" \${state.currentPage >= totalPages ? 'disabled' : ''}>Next →</button>\`;
      html += '</div>';

      return html;
    }

    function goToPage(page) {
      const totalPages = state.isClientSide
        ? Math.ceil(state.ledgerData.totalRows / ${WEBUI_CONFIG.PAGE_SIZE})
        : state.ledgerData.totalPages;

      if (page < 1 || page > totalPages) return;

      state.currentPage = page;

      if (state.isClientSide) {
        renderLedger(state.ledgerData);
      } else {
        refreshLedger();
      }
    }

    // ========================================
    // CHAIN STATUS TAB
    // ========================================
    function startChainAudit() {
      state.chainAuditRunning = true;
      state.chainAuditResults = { broken: [], mismatches: [], rowsChecked: 0, totalRows: 0 };

      document.getElementById('startAuditBtn').style.display = 'none';
      document.getElementById('stopAuditBtn').style.display = 'inline-flex';
      document.getElementById('chainIssues').innerHTML = '';

      updateChainUI();
      runChainChunk(2);
    }

    function stopChainAudit() {
      state.chainAuditRunning = false;
      document.getElementById('startAuditBtn').style.display = 'inline-flex';
      document.getElementById('stopAuditBtn').style.display = 'none';
    }

    function runChainChunk(startRow) {
      if (!state.chainAuditRunning) return;

      google.script.run
        .withSuccessHandler(result => {
          state.chainAuditResults.broken.push(...result.broken);
          state.chainAuditResults.mismatches.push(...result.mismatches);
          state.chainAuditResults.rowsChecked += result.rowsChecked;
          state.chainAuditResults.totalRows = result.totalRows;

          updateChainUI();

          if (!result.complete && state.chainAuditRunning) {
            runChainChunk(result.nextStartRow);
          } else {
            stopChainAudit();
            renderChainIssues();
          }
        })
        .withFailureHandler(err => {
          showToast('Chain audit failed: ' + err.message, 'error');
          stopChainAudit();
        })
        .WebUI_auditChainChunk(startRow, ${WEBUI_CONFIG.CHUNK_SIZE});
    }

    function updateChainUI() {
      const r = state.chainAuditResults;

      document.getElementById('chainRowsVerified').textContent = r.rowsChecked;
      document.getElementById('chainRowsVerified').className = 'value ok';

      document.getElementById('chainBreaks').textContent = r.broken.length;
      document.getElementById('chainBreaks').className = 'value ' + (r.broken.length > 0 ? 'error' : 'ok');

      document.getElementById('chainMismatches').textContent = r.mismatches.length;
      document.getElementById('chainMismatches').className = 'value ' + (r.mismatches.length > 0 ? 'error' : 'ok');

      const progress = r.totalRows > 0 ? (r.rowsChecked / r.totalRows) * 100 : 0;
      document.getElementById('chainProgress').style.width = progress + '%';
    }

    function renderChainIssues() {
      const r = state.chainAuditResults;
      let html = '';

      if (r.broken.length === 0 && r.mismatches.length === 0) {
        html = '<div class="empty-state"><div class="icon">✅</div><h3>Chain Integrity Verified</h3><p>All ' + r.rowsChecked + ' rows passed verification.</p></div>';
      } else {
        html = '<div class="form-section"><h3>Issues Found</h3><div class="issue-list">';

        r.broken.forEach(issue => {
          html += \`<div class="issue-item">
            <div class="icon">🔗</div>
            <div class="details">
              <div class="row-num">Row \${issue.row}</div>
              <div class="uuid">\${issue.uuid}</div>
              <div class="hash-compare">
                <div class="expected">Expected: \${issue.expected}</div>
                <div class="found">Found: \${issue.found}</div>
              </div>
            </div>
          </div>\`;
        });

        r.mismatches.forEach(issue => {
          html += \`<div class="issue-item">
            <div class="icon">⚠️</div>
            <div class="details">
              <div class="row-num">Row \${issue.row} (Hash Mismatch)</div>
              <div class="uuid">\${issue.uuid}</div>
              <div class="hash-compare">
                <div class="expected">Stored: \${issue.stored}</div>
                <div class="found">Computed: \${issue.computed}</div>
              </div>
            </div>
          </div>\`;
        });

        html += '</div></div>';
      }

      document.getElementById('chainIssues').innerHTML = html;
    }

    // ========================================
    // NEW ENTRY TAB
    // ========================================
    function toggleConfidenceSection() {
      const checked = document.getElementById('includeConfidence').checked;
      document.getElementById('confidenceSection').classList.toggle('visible', checked);
    }

    function submitEntry() {
      const text = document.getElementById('entryText').value.trim();
      if (!text) {
        showToast('Text is required', 'error');
        return;
      }

      const params = {
        actor: document.getElementById('entryActor').value,
        eventType: document.getElementById('entryEventType').value,
        text: text,
        gift: document.getElementById('entryGift').value,
        status: document.getElementById('entryStatus').value,
        includeConfidence: document.getElementById('includeConfidence').checked,
        confidenceLevel: document.getElementById('confidenceLevel').value,
        confidenceNumeric: document.getElementById('confidenceNumeric').value || null,
        confidenceJustification: document.getElementById('confidenceJustification').value
      };

      google.script.run
        .withSuccessHandler(result => {
          if (result.success) {
            showToast('Entry created: ' + result.uuid, 'success');
            document.getElementById('entryText').value = '';
            document.getElementById('entryGift').value = '';
            document.getElementById('includeConfidence').checked = false;
            toggleConfidenceSection();
            refreshLedger();
          } else {
            showToast('Failed: ' + result.error, 'error');
          }
        })
        .withFailureHandler(err => {
          showToast('Error: ' + err.message, 'error');
        })
        .WebUI_createEntry(params);
    }

    // ========================================
    // MUTATIONS TAB
    // ========================================
    function loadMutations() {
      google.script.run
        .withSuccessHandler(renderMutations)
        .withFailureHandler(err => {
          document.getElementById('mutationsContent').innerHTML =
            '<div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3><p>' + err.message + '</p></div>';
        })
        .WebUI_getPendingMutations();
    }

    function renderMutations(mutations) {
      state.mutations = mutations;

      // Update badge
      const badge = document.getElementById('mutationsBadge');
      if (mutations.length > 0) {
        badge.textContent = mutations.length;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }

      if (mutations.length === 0) {
        document.getElementById('mutationsContent').innerHTML =
          '<div class="empty-state"><div class="icon">✅</div><h3>No Pending Mutations</h3><p>All mutations have been reviewed.</p></div>';
        return;
      }

      let html = '<div class="mutation-grid">';

      mutations.forEach(m => {
        html += \`<div class="mutation-card" id="mutation-\${m.Mutation_ID}">
          <div class="mutation-card-header">
            <span class="mutation-id">\${m.Mutation_ID}</span>
            <span class="mutation-type">\${m.Mutation_Type}</span>
          </div>
          <div class="mutation-target">
            <strong>\${m.Target_Sheet}</strong> → Row \${m.Target_Row}, Column "\${m.Target_Column}"
          </div>
          <div class="mutation-diff">
            <div class="diff-old">\${escapeHtml(m.Current_Value || '(empty)')}</div>
            <div class="diff-new">\${escapeHtml(m.Proposed_Value || '(empty)')}</div>
          </div>
          <div class="mutation-meta">
            \${m.Confidence_Level ? '<span class="confidence-badge confidence-' + m.Confidence_Level + '">' + m.Confidence_Level + '</span> ' : ''}
            \${m.Justification || ''}
          </div>
          <div class="mutation-actions">
            <button class="btn btn-primary btn-sm" onclick="approveMutation('\${m.Mutation_ID}')">Approve</button>
            <button class="btn btn-secondary btn-sm" onclick="approveMutation('\${m.Mutation_ID}', true)">Approve & Apply</button>
            <button class="btn btn-danger btn-sm" onclick="showRejectInput('\${m.Mutation_ID}')">Reject</button>
          </div>
          <div class="rejection-input" id="reject-\${m.Mutation_ID}">
            <div class="form-group">
              <input type="text" id="reject-reason-\${m.Mutation_ID}" placeholder="Rejection reason...">
            </div>
            <button class="btn btn-danger btn-sm" onclick="rejectMutation('\${m.Mutation_ID}')">Confirm Reject</button>
          </div>
        </div>\`;
      });

      html += '</div>';
      document.getElementById('mutationsContent').innerHTML = html;
    }

    function showRejectInput(mutationId) {
      document.getElementById('reject-' + mutationId).classList.add('visible');
    }

    function approveMutation(mutationId, autoApply) {
      google.script.run
        .withSuccessHandler(result => {
          if (result.success) {
            showToast('Mutation approved' + (autoApply ? ' and applied' : ''), 'success');
            loadMutations();
          } else {
            showToast('Failed: ' + result.error, 'error');
          }
        })
        .withFailureHandler(err => showToast('Error: ' + err.message, 'error'))
        .WebUI_approveMutation(mutationId, autoApply || false);
    }

    function rejectMutation(mutationId) {
      const reason = document.getElementById('reject-reason-' + mutationId).value;

      google.script.run
        .withSuccessHandler(result => {
          if (result.success) {
            showToast('Mutation rejected', 'info');
            loadMutations();
          } else {
            showToast('Failed: ' + result.error, 'error');
          }
        })
        .withFailureHandler(err => showToast('Error: ' + err.message, 'error'))
        .WebUI_rejectMutation(mutationId, reason);
    }

    // ========================================
    // SENTINEL TAB
    // ========================================
    function loadSignals() {
      google.script.run
        .withSuccessHandler(signals => {
          state.signals = signals;
          renderSignalFilters();
          renderSignals();
        })
        .withFailureHandler(err => {
          document.getElementById('signalsList').innerHTML =
            '<div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3><p>' + err.message + '</p></div>';
        })
        .WebUI_getSignals();
    }

    function renderSignalFilters() {
      const counts = {};
      state.signals.forEach(s => {
        counts[s.signalType] = (counts[s.signalType] || 0) + 1;
      });

      let html = '<div class="signal-filter ' + (state.signalFilter === 'all' ? 'active' : '') + '" data-filter="all" onclick="filterSignals(\\'all\\')">All Signals<span class="count">(' + state.signals.length + ')</span></div>';

      Object.keys(counts).sort().forEach(type => {
        html += \`<div class="signal-filter \${state.signalFilter === type ? 'active' : ''}" data-filter="\${type}" onclick="filterSignals('\${type}')">\${type}<span class="count">(\${counts[type]})</span></div>\`;
      });

      document.getElementById('signalFilters').innerHTML = html;
    }

    function filterSignals(filter) {
      state.signalFilter = filter;
      renderSignalFilters();
      renderSignals();
    }

    function renderSignals() {
      const filtered = state.signalFilter === 'all'
        ? state.signals
        : state.signals.filter(s => s.signalType === state.signalFilter);

      if (filtered.length === 0) {
        document.getElementById('signalsList').innerHTML =
          '<div class="empty-state"><div class="icon">🔍</div><h3>No Signals</h3><p>No signals detected in the ledger.</p></div>';
        return;
      }

      let html = '<div class="signal-list">';

      filtered.forEach(s => {
        html += \`<div class="signal-card">
          <div class="signal-card-header">
            <span class="signal-badge \${s.signalType}">\${s.signalType}</span>
            <span class="status-badge status-\${s.status}">\${s.status}</span>
            <span class="uuid">\${s.uuid}</span>
          </div>
          <div class="signal-text">\${escapeHtml(s.text)}</div>
          <div class="signal-meta">
            <span>Row \${s.rowNum}</span>
            <span>\${formatTimestamp(s.timestamp)}</span>
            <span>Actor: \${s.actor}</span>
            <span>Event: \${s.eventType}</span>
            \${s.signalStatus ? '<span>Signal Status: ' + s.signalStatus + '</span>' : ''}
          </div>
        </div>\`;
      });

      html += '</div>';
      document.getElementById('signalsList').innerHTML = html;
    }

    // ========================================
    // UTILITIES
    // ========================================
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escapeJs(str) {
      if (!str) return '';
      return String(str)
        .replace(/\\\\/g, '\\\\\\\\')
        .replace(/'/g, "\\\\'")
        .replace(/"/g, '\\\\"')
        .replace(/\\n/g, '\\\\n')
        .replace(/\\r/g, '\\\\r');
    }

    function formatTimestamp(ts) {
      if (!ts) return '-';
      try {
        const d = new Date(ts);
        return d.toLocaleString();
      } catch (e) {
        return ts;
      }
    }

    function showToast(message, type) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + (type || 'info');
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 4000);
    }

    function showFullText(text) {
      document.getElementById('modalTitle').textContent = 'Full Text';
      document.getElementById('modalBody').innerHTML = '<pre>' + escapeHtml(text) + '</pre>';
      document.getElementById('modalOverlay').classList.add('visible');
    }

    function closeModal(event) {
      if (!event || event.target === document.getElementById('modalOverlay')) {
        document.getElementById('modalOverlay').classList.remove('visible');
      }
    }

    // Close modal on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>`;
}
