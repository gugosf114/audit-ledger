/**
 * ───────────────────────────────────────────────
 *  SENTINEL : SIGNAL DETECTION & PROCESSING
 * ───────────────────────────────────────────────
 *
 *  Scans ledger entries for signal tags and processes them.
 *  Supports: [VOID_DETECTED], [UNFALSIFIABLE], [PARKED],
 *  [RISK_ACCEPTED], [ADVERSARIAL_SUSPICION], etc.
 *
 * ───────────────────────────────────────────────
 */

// ==========================
// CONFIGURATION
// ==========================

const SENTINEL_CONFIG = {
  SIGNALS: {
    VOID_DETECTED: '[VOID_DETECTED]',
    UNFALSIFIABLE: '[UNFALSIFIABLE]',
    PARKED: '[PARKED]',
    RISK_ACCEPTED: '[RISK_ACCEPTED]',
    SCHISM_CRITICAL: '[SCHISM_CRITICAL]',
    ADVERSARIAL_SUSPICION: '[ADVERSARIAL_SUSPICION]',
    SYSTEM_HALT: '[SYSTEM_HALT]',
    FATAL: '[FATAL]',
    CASCADE_FAILURE: '[CASCADE_FAILURE]',
    ARTIFICIAL_STERILITY: '[ARTIFICIAL_STERILITY]'
  },

  STATUS: {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    RECORDED: 'RECORDED',
    ESCALATED: 'ESCALATED',
    SUSPENDED: 'SUSPENDED',
    PARKED: 'PARKED',
    FAILED: 'FAILED'
  },

  COLUMNS: {
    UUID: 1,
    TIMESTAMP: 2,
    ACTOR: 3,
    EVENT_TYPE: 4,
    TEXT: 5,
    GIFT: 6,
    PREV_HASH: 7,
    RECORD_HASH: 8,
    STATUS: 9,
    SIGNAL_TAG: 15,
    SIGNAL_STATUS: 16,
    SIGNAL_ACTION: 17,
    SIGNAL_RESULT: 18
  }
};


// ==========================
// SETUP FUNCTIONS
// ==========================

function setupSentinelColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Audit Ledger');

  if (!sh) {
    SpreadsheetApp.getUi().alert('Audit Ledger sheet not found. Run Setup Sheet first.');
    return;
  }

  const lastCol = sh.getLastColumn();
  if (lastCol >= 18) {
    SpreadsheetApp.getUi().alert('Sentinel columns may already exist. Check columns 15-18.');
    return;
  }

  const newHeaders = ['Signal_Tag', 'Signal_Status', 'Signal_Action', 'Signal_Result'];
  sh.getRange(1, 15, 1, 4).setValues([newHeaders]);
  sh.getRange(1, 15, 1, 4).setFontWeight('bold');
  sh.getRange(1, 15, 1, 4).setBackground('#4a4a4a');
  sh.getRange(1, 15, 1, 4).setFontColor('#ffffff');

  for (let i = 15; i <= 18; i++) sh.autoResizeColumn(i);

  if (typeof logSystemEvent === 'function') {
    logSystemEvent('SUCCESS', 'SENTINEL', 'Sentinel columns added to ledger', { columns: newHeaders });
  }
  SpreadsheetApp.getUi().alert('Sentinel columns (15-18) added successfully!');
}


// ==========================
// SIGNAL DETECTION
// ==========================

function detectSignals() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const textData = sh.getRange(2, SENTINEL_CONFIG.COLUMNS.TEXT, lastRow - 1, 1).getValues();
  const statusData = sh.getRange(2, SENTINEL_CONFIG.COLUMNS.SIGNAL_STATUS, lastRow - 1, 1).getValues();

  const detected = [];

  for (let i = 0; i < textData.length; i++) {
    const text = String(textData[i][0] || '');
    const currentStatus = String(statusData[i][0] || '');

    if (
      currentStatus === SENTINEL_CONFIG.STATUS.RECORDED ||
      currentStatus === SENTINEL_CONFIG.STATUS.ESCALATED ||
      currentStatus === SENTINEL_CONFIG.STATUS.PARKED ||
      currentStatus === SENTINEL_CONFIG.STATUS.SUSPENDED
    ) {
      continue;
    }

    for (const [signalName, signalTag] of Object.entries(SENTINEL_CONFIG.SIGNALS)) {
      if (text.includes(signalTag)) {
        detected.push({
          row: i + 2,
          signal: signalName,
          tag: signalTag,
          text: text
        });
        break;
      }
    }
  }

  return detected;
}


// ==========================
// SIGNAL PARSERS
// ==========================

function parseVoidDetails(text) {
  const result = {
    artifact: null,
    artifactType: null,
    dateRange: null,
    owner: null,
    rawDescription: null
  };

  const canonical = text.match(/\[VOID_DETECTED\]:\s*([A-Z_]+)\s*\|\s*([\s\S]*?)(?=\[|$)/i);
  if (canonical) {
    result.artifactType = canonical[1].trim().toUpperCase();
    result.rawDescription = canonical[2].trim();
    return result;
  }

  const voidMatch = text.match(/\[VOID_DETECTED\]:\s*(.+?)(?=\[|$)/i);
  if (voidMatch) result.rawDescription = voidMatch[1].trim();

  const artifactMatch = text.match(/['"]([^'"]+)['"]/);
  if (artifactMatch) {
    result.artifact = artifactMatch[1];
  } else {
    const missingMatch = text.match(/Missing\s+(\w+)/i);
    if (missingMatch) result.artifact = missingMatch[1];
  }

  const dateMatch = text.match(/between\s+(.+?)(?:\.|$)/i);
  if (dateMatch) result.dateRange = dateMatch[1].trim();

  return result;
}


// ==========================
// MAIN SIGNAL PROCESSOR
// ==========================

function processSignals() {
  const signals = detectSignals();

  if (signals.length === 0) {
    Logger.log('No pending signals detected.');
    return { processed: 0, results: [] };
  }

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  const results = [];

  for (const signal of signals) {
    sh.getRange(signal.row, SENTINEL_CONFIG.COLUMNS.SIGNAL_TAG).setValue(signal.tag);
    sh.getRange(signal.row, SENTINEL_CONFIG.COLUMNS.SIGNAL_STATUS).setValue(SENTINEL_CONFIG.STATUS.PROCESSING);

    let result;

    switch (signal.signal) {
      case 'VOID_DETECTED':
        result = handleVoidDetected(signal);
        break;
      case 'UNFALSIFIABLE':
        result = handleUnfalsifiable(signal);
        break;
      case 'PARKED':
        result = handleParked(signal);
        break;
      case 'RISK_ACCEPTED':
        result = handleRiskAccepted(signal);
        break;
      case 'SCHISM_CRITICAL':
        result = handleSchismCritical(signal);
        break;
      case 'ADVERSARIAL_SUSPICION':
        result = handleAdversarialSuspicion(signal);
        break;
      case 'SYSTEM_HALT':
        result = handleSystemHalt(signal);
        break;
      case 'FATAL':
        result = handleFatal(signal);
        break;
      case 'CASCADE_FAILURE':
        result = handleCascadeFailure(signal);
        break;
      case 'ARTIFICIAL_STERILITY':
        result = handleArtificialSterility(signal);
        break;
      default:
        result = {
          status: SENTINEL_CONFIG.STATUS.ESCALATED,
          action: 'Unknown signal type',
          result: 'Requires manual review'
        };
    }

    sh.getRange(signal.row, SENTINEL_CONFIG.COLUMNS.SIGNAL_STATUS).setValue(result.status);
    sh.getRange(signal.row, SENTINEL_CONFIG.COLUMNS.SIGNAL_ACTION).setValue(result.action);
    sh.getRange(signal.row, SENTINEL_CONFIG.COLUMNS.SIGNAL_RESULT).setValue(result.result);

    // Get the original entry's UUID for reference
    const originalUuid = sh.getRange(signal.row, SENTINEL_CONFIG.COLUMNS.UUID).getValue();

    // Write immutable ledger entry for this signal disposition
    const ledgerText = [
      `SIGNAL: ${signal.signal}`,
      `ORIGINAL_UUID: ${originalUuid}`,
      `ORIGINAL_ROW: ${signal.row}`,
      `ACTION: ${result.action}`,
      `RESULT: ${result.result}`,
      `DISPOSITION: ${result.status}`
    ].join(' | ');

    try {
      safeNewEntry('System', 'SIGNAL_PROCESSED', ledgerText, '', 'FINAL');
    } catch (ledgerErr) {
      // Log failure but don't block signal processing
      if (typeof logSystemEvent === 'function') {
        logSystemEvent('ERROR', 'SENTINEL', 'Failed to write signal ledger entry', {
          originalUuid: originalUuid,
          error: ledgerErr.message
        });
      }
    }

    if (typeof logSystemEvent === 'function') {
      logSystemEvent('INFO', 'SENTINEL', `Processed ${signal.signal}`, {
        row: signal.row,
        originalUuid: originalUuid,
        action: result.action,
        status: result.status
      });
    }

    results.push({ signal: signal, result: result });
  }

  return { processed: results.length, results: results };
}


// ==========================
// SIGNAL HANDLERS
// ==========================

function handleVoidDetected(signal) {
  const details = parseVoidDetails(signal.text);
  const artifactKey = details.artifactType || details.artifact;

  if (!artifactKey) {
    return {
      status: SENTINEL_CONFIG.STATUS.ESCALATED,
      action: 'Could not parse artifact reference',
      result: 'Manual search required: ' + (details.rawDescription || '(no description)')
    };
  }

  const searchResult = searchDriveForArtifact(artifactKey, details.dateRange);

  if (searchResult.found) {
    return {
      status: SENTINEL_CONFIG.STATUS.ESCALATED,
      action: 'Candidate artifact located (verification required)',
      result: `Located candidate: ${searchResult.fileName} (${searchResult.fileUrl}). Existence != authorization/integrity. Verify before clearing VOID.`
    };
  }

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'Artifact not found',
    result: `Searched for "${artifactKey}" - no matches. VOID CONFIRMED.`
  };
}

function handleUnfalsifiable(signal) {
  return {
    status: SENTINEL_CONFIG.STATUS.SUSPENDED,
    action: 'UNFALSIFIABLE - operator disposition required',
    result: 'Claim cannot be falsified with current information. Operator must select disposition.'
  };
}

function handleParked(signal) {
  return {
    status: SENTINEL_CONFIG.STATUS.PARKED,
    action: 'PARKED - deferred by operator',
    result: 'Item intentionally deferred. No further action until reactivated.'
  };
}

function handleRiskAccepted(signal) {
  return {
    status: SENTINEL_CONFIG.STATUS.RECORDED,
    action: 'RISK_ACCEPTED - recorded',
    result: 'Risk acceptance recorded. No further enforcement actions required.'
  };
}

function handleSchismCritical(signal) {
  if (typeof logSystemEvent === 'function') {
    logSystemEvent('CRITICAL', 'SCHISM', 'Class A vs Class A conflict detected', {
      originalRow: signal.row,
      text: signal.text.substring(0, 500)
    });
  }

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'Logged as CRITICAL',
    result: 'Requires human arbitration - two immutable sources conflict'
  };
}

function handleAdversarialSuspicion(signal) {
  addToQuarantine(signal.row, signal.text);

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'Source quarantined',
    result: 'Deception markers detected - source isolated pending review'
  };
}

function handleSystemHalt(signal) {
  const email = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
  if (email) {
    MailApp.sendEmail(
      email,
      '[SENTINEL] SYSTEM HALT TRIGGERED',
      `A critical system halt was triggered.\n\nRow: ${signal.row}\n\nDetails:\n${signal.text}`
    );
  }

  if (typeof logSystemEvent === 'function') {
    logSystemEvent('FATAL', 'SENTINEL', 'SYSTEM HALT TRIGGERED', {
      row: signal.row,
      text: signal.text.substring(0, 1000)
    });
  }

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'HALT - manual intervention required',
    result: 'Data integrity critical - all processing should stop until reviewed'
  };
}

function handleFatal(signal) {
  if (typeof logSystemEvent === 'function') {
    logSystemEvent('FATAL', 'SENTINEL', 'FATAL error detected', {
      row: signal.row,
      text: signal.text.substring(0, 500)
    });
  }

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'Logged as FATAL',
    result: 'Critical conflict / logical impossibility - requires investigation'
  };
}

function handleCascadeFailure(signal) {
  // CASCADE_FAILURE: A failure in one component has propagated to others
  // This requires immediate attention to identify the root cause and scope
  if (typeof logSystemEvent === 'function') {
    logSystemEvent('CRITICAL', 'SENTINEL', 'CASCADE_FAILURE detected', {
      row: signal.row,
      text: signal.text.substring(0, 500)
    });
  }

  const email = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
  if (email) {
    MailApp.sendEmail(
      email,
      '[SENTINEL] CASCADE FAILURE DETECTED',
      `A cascade failure was detected.\n\nRow: ${signal.row}\n\nDetails:\n${signal.text.substring(0, 1000)}`
    );
  }

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'CASCADE_FAILURE - root cause analysis required',
    result: 'Failure has propagated across components - identify origin point and scope before proceeding'
  };
}

function handleArtificialSterility(signal) {
  // ARTIFICIAL_STERILITY: Data appears too clean, too consistent, or lacks expected variance
  // This is a marker for potential fabrication or synthetic data
  if (typeof logSystemEvent === 'function') {
    logSystemEvent('WARN', 'SENTINEL', 'ARTIFICIAL_STERILITY detected', {
      row: signal.row,
      text: signal.text.substring(0, 500)
    });
  }

  return {
    status: SENTINEL_CONFIG.STATUS.ESCALATED,
    action: 'ARTIFICIAL_STERILITY - authenticity review required',
    result: 'Data exhibits unnatural uniformity - verify source authenticity and check for fabrication markers'
  };
}


// ==========================
// ARTIFACT RETRIEVAL
// ==========================

function searchDriveForArtifact(artifactName, dateRange) {
  try {
    let query = `title contains '${artifactName}'`;

    if (dateRange) {
      const dates = parseDateRange(dateRange);
      if (dates.start) query += ` and modifiedDate >= '${dates.start}'`;
      if (dates.end) query += ` and modifiedDate <= '${dates.end}'`;
    }

    const files = DriveApp.searchFiles(query);

    if (files.hasNext()) {
      const file = files.next();
      return {
        found: true,
        fileName: file.getName(),
        fileUrl: file.getUrl(),
        fileId: file.getId(),
        mimeType: file.getMimeType()
      };
    }

    return { found: false };
  } catch (e) {
    Logger.log('Drive search error: ' + e.message);
    return { found: false, error: e.message };
  }
}

/**
 * Parses natural language date ranges into ISO date strings for Drive API.
 * Supports formats like:
 *   - "January 2024 and March 2024"
 *   - "between January 2024 and March 2024"
 *   - "Q1 2024"
 *   - "2024"
 *   - "Jan 1, 2024 - Mar 31, 2024"
 */
function parseDateRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') {
    return { start: null, end: null };
  }

  const s = rangeStr.trim().toLowerCase();

  // Quarter format: "Q1 2024", "q2 2023"
  const quarterMatch = s.match(/q([1-4])\s*(\d{4})/i);
  if (quarterMatch) {
    const q = parseInt(quarterMatch[1]);
    const year = parseInt(quarterMatch[2]);
    const startMonth = (q - 1) * 3;
    const endMonth = startMonth + 2;
    return {
      start: new Date(year, startMonth, 1).toISOString().slice(0, 10),
      end: new Date(year, endMonth + 1, 0).toISOString().slice(0, 10) // last day of end month
    };
  }

  // Year only: "2024"
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) {
    const year = parseInt(yearOnly[1]);
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`
    };
  }

  // Month name mappings
  const months = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'sept': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };

  // Try to extract two dates: "between X and Y", "X - Y", "X to Y", "X and Y"
  const rangePattern = /(?:between\s+)?(\w+\s*\d*,?\s*\d{4})\s*(?:and|to|-)\s*(\w+\s*\d*,?\s*\d{4})/i;
  const rangeMatch = s.match(rangePattern);

  if (rangeMatch) {
    const startDate = parseFlexibleDate(rangeMatch[1], months);
    const endDate = parseFlexibleDate(rangeMatch[2], months, true); // true = end of period
    return { start: startDate, end: endDate };
  }

  // Single month/year: "January 2024"
  const singleMonthYear = s.match(/(\w+)\s+(\d{4})/);
  if (singleMonthYear) {
    const monthName = singleMonthYear[1].toLowerCase();
    const year = parseInt(singleMonthYear[2]);
    if (months.hasOwnProperty(monthName)) {
      const month = months[monthName];
      return {
        start: new Date(year, month, 1).toISOString().slice(0, 10),
        end: new Date(year, month + 1, 0).toISOString().slice(0, 10)
      };
    }
  }

  return { start: null, end: null };
}

/**
 * Helper to parse flexible date strings like "January 2024", "Jan 15, 2024"
 */
function parseFlexibleDate(dateStr, months, endOfPeriod) {
  const s = dateStr.trim().toLowerCase();

  // Try "Month Day, Year" format
  const mdyMatch = s.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (mdyMatch) {
    const monthName = mdyMatch[1];
    const day = parseInt(mdyMatch[2]);
    const year = parseInt(mdyMatch[3]);
    if (months.hasOwnProperty(monthName)) {
      return new Date(year, months[monthName], day).toISOString().slice(0, 10);
    }
  }

  // Try "Month Year" format
  const myMatch = s.match(/(\w+)\s+(\d{4})/);
  if (myMatch) {
    const monthName = myMatch[1];
    const year = parseInt(myMatch[2]);
    if (months.hasOwnProperty(monthName)) {
      const month = months[monthName];
      if (endOfPeriod) {
        // Last day of month
        return new Date(year, month + 1, 0).toISOString().slice(0, 10);
      } else {
        // First day of month
        return new Date(year, month, 1).toISOString().slice(0, 10);
      }
    }
  }

  return null;
}


// ==========================
// QUARANTINE SYSTEM
// ==========================

function addToQuarantine(row, text) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let quarantineSheet = ss.getSheetByName('Quarantine');

  if (!quarantineSheet) {
    quarantineSheet = ss.insertSheet('Quarantine');
    quarantineSheet.getRange(1, 1, 1, 5).setValues([
      ['Timestamp', 'Original_Row', 'Reason', 'Text_Preview', 'Status']
    ]);
    quarantineSheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    quarantineSheet.getRange(1, 1, 1, 5).setBackground('#4a4a4a');
    quarantineSheet.getRange(1, 1, 1, 5).setFontColor('#ffffff');
  }

  const newRow = quarantineSheet.getLastRow() + 1;
  quarantineSheet.getRange(newRow, 1, 1, 5).setValues([[
    new Date().toISOString(),
    row,
    'ADVERSARIAL_SUSPICION',
    String(text || '').substring(0, 300),
    'QUARANTINED'
  ]]);
}


// ==========================
// SESSION LEDGER
// ==========================

function generateSessionLedger() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return null;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { QUARANTINED: [], ESTABLISHED_FACTS: [], ADVERSARIAL_FLAGS: [], GENERATED_AT: new Date().toISOString() };
  }

  const data = sh.getRange(2, 1, lastRow - 1, 18).getValues();

  const ledger = {
    QUARANTINED: [],
    ESTABLISHED_FACTS: [],
    ADVERSARIAL_FLAGS: [],
    GENERATED_AT: new Date().toISOString()
  };

  for (const row of data) {
    const uuid = row[0];
    const status = row[8];
    const signalTag = row[14];

    if (signalTag && String(signalTag).includes('ADVERSARIAL')) {
      ledger.ADVERSARIAL_FLAGS.push(uuid);
      ledger.QUARANTINED.push(uuid);
    }

    if (status === 'VERIFIED') {
      ledger.ESTABLISHED_FACTS.push(uuid);
    }
  }

  return ledger;
}

function showSessionLedger() {
  const ledger = generateSessionLedger();
  const json = JSON.stringify(ledger, null, 2);
  SpreadsheetApp.getUi().alert('Session Ledger (Copy for Next Session)', json, SpreadsheetApp.getUi().ButtonSet.OK);
}


// ==========================
// UI HELPERS
// ==========================

function scanAndReport() {
  const signals = detectSignals();
  const ui = SpreadsheetApp.getUi();

  if (signals.length === 0) {
    ui.alert('Sentinel Scan', 'No pending signals detected.', ui.ButtonSet.OK);
    return;
  }

  let report = `Found ${signals.length} signal(s):\n\n`;
  for (const sig of signals) report += `Row ${sig.row}: ${sig.signal}\n`;

  ui.alert('Sentinel Scan', report, ui.ButtonSet.OK);
}

function processAndReport() {
  const result = processSignals();
  const ui = SpreadsheetApp.getUi();

  if (result.processed === 0) {
    ui.alert('Sentinel Processing', 'No signals to process.', ui.ButtonSet.OK);
    return;
  }

  let report = `Processed ${result.processed} signal(s):\n\n`;
  for (const r of result.results) {
    report += `Row ${r.signal.row}: ${r.signal.signal} → ${r.result.status}\n`;
  }

  ui.alert('Sentinel Processing', report, ui.ButtonSet.OK);
}

function viewQuarantine() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Quarantine');
  if (sheet) {
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('No quarantined items yet.');
  }
}
