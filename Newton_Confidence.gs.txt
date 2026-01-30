/**
 * ───────────────────────────────────────────────
 *  NEWTON CONFIDENCE : PRE-COMMIT DECLARATION
 * ───────────────────────────────────────────────
 *
 *  Implements the Rumsfeld Protocol - forces confidence
 *  declaration BEFORE content can be logged.
 *
 *  Confidence Levels:
 *  - KNOWN_KNOWN (KK): High confidence, direct evidence
 *  - KNOWN_UNKNOWN (KU): I know what I don't know
 *  - UNKNOWN_UNKNOWN (UU): Speculation, treat accordingly
 *
 *  The declaration is hashed into the chain BEFORE the
 *  content entry. If content later proves wrong and
 *  confidence was KK, you have prosecutable evidence.
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const CONFIDENCE_CONFIG = {
  LEVELS: {
    KNOWN_KNOWN: 'KNOWN_KNOWN',       // High confidence, direct evidence
    KNOWN_UNKNOWN: 'KNOWN_UNKNOWN',   // Known gap, specific uncertainty
    UNKNOWN_UNKNOWN: 'UNKNOWN_UNKNOWN' // Speculation, no basis
  },

  // Numeric confidence thresholds
  THRESHOLDS: {
    HIGH: 80,    // >= 80 should be KK
    MEDIUM: 50,  // 50-79 should be KU
    LOW: 0       // < 50 should be UU
  },

  // Event types for confidence entries
  EVENT_TYPES: {
    DECLARATION: 'CONFIDENCE_DECLARATION',
    LINKED_CONTENT: 'CONFIDENCE_LINKED',
    VIOLATION: 'CONFIDENCE_VIOLATION',
    AUDIT: 'CONFIDENCE_AUDIT'
  },

  // Status values
  STATUS: {
    DECLARED: 'DECLARED',      // Confidence declared, awaiting content
    LINKED: 'LINKED',          // Content has been linked to declaration
    VIOLATED: 'VIOLATED',      // Post-hoc audit found mismatch
    EXPIRED: 'EXPIRED',        // Declaration never used (timeout)
    LEGACY: 'LEGACY'           // Pre-confidence-system entry
  }
};


// ==========================
// CORE FUNCTIONS
// ==========================

/**
 * Declare confidence level BEFORE generating content.
 * Returns a confidence_uuid that MUST be passed to newEntryWithConfidence().
 *
 * @param {string} level - KNOWN_KNOWN | KNOWN_UNKNOWN | UNKNOWN_UNKNOWN
 * @param {string} justification - Why this confidence level (required for KK)
 * @param {string} actor - User | Admin | System
 * @param {number} numericConfidence - Optional 0-100 percentage
 * @returns {Object} - { confidence_uuid, timestamp, level }
 */
function declareConfidence(level, justification, actor, numericConfidence) {
  // Validate level
  const validLevels = Object.values(CONFIDENCE_CONFIG.LEVELS);
  if (!validLevels.includes(level)) {
    throw new Error(`Invalid confidence level: ${level}. Must be one of: ${validLevels.join(', ')}`);
  }

  // KK requires justification
  if (level === CONFIDENCE_CONFIG.LEVELS.KNOWN_KNOWN && (!justification || justification.trim().length < 10)) {
    throw new Error('KNOWN_KNOWN declarations require justification of at least 10 characters explaining the evidence basis.');
  }

  // Validate numeric confidence if provided
  if (numericConfidence !== undefined && numericConfidence !== null) {
    if (typeof numericConfidence !== 'number' || numericConfidence < 0 || numericConfidence > 100) {
      throw new Error('Numeric confidence must be a number between 0 and 100.');
    }

    // Warn if numeric doesn't match level
    const expectedLevel = getExpectedLevel(numericConfidence);
    if (expectedLevel !== level) {
      logSystemEvent('WARN', 'CONFIDENCE', 'Numeric confidence does not match declared level', {
        declared: level,
        expected: expectedLevel,
        numeric: numericConfidence
      });
    }
  }

  // Validate actor
  if (!['User', 'Admin', 'System'].includes(actor)) {
    throw new Error('Actor must be User, Admin, or System.');
  }

  const confidence_uuid = Utilities.getUuid();
  const timestamp = new Date().toISOString();

  // Build declaration text
  const declarationText = [
    `[CONFIDENCE_DECLARATION]`,
    `Level: ${level}`,
    numericConfidence !== undefined ? `Numeric: ${numericConfidence}%` : '',
    `Justification: ${justification || '(none provided)'}`,
    `Declared by: ${actor}`,
    `Declaration UUID: ${confidence_uuid}`
  ].filter(Boolean).join('\n');

  // Write to ledger using extended schema
  const result = newEntryWithConfidenceFields(
    actor,
    CONFIDENCE_CONFIG.EVENT_TYPES.DECLARATION,
    declarationText,
    '',  // gift
    CONFIDENCE_CONFIG.STATUS.DECLARED,
    level,
    confidence_uuid,
    justification || ''
  );

  logSystemEvent('INFO', 'CONFIDENCE', 'Confidence declared', {
    confidence_uuid,
    level,
    actor,
    numeric: numericConfidence
  });

  return {
    confidence_uuid: confidence_uuid,
    timestamp: timestamp,
    level: level,
    ledger_uuid: result.uuid
  };
}


/**
 * Create a new ledger entry linked to a prior confidence declaration.
 * The confidence_uuid MUST reference an existing DECLARED entry.
 *
 * @param {string} confidence_uuid - UUID from declareConfidence()
 * @param {string} actor - User | Admin | System
 * @param {string} eventType - Event type for this entry
 * @param {string} text - Content text
 * @param {string} gift - Optional gift/tip
 * @param {string} status - Entry status (defaults to DRAFT)
 * @returns {Object} - { uuid, ts, recordHash, confidence_uuid }
 */
function newEntryWithConfidence(confidence_uuid, actor, eventType, text, gift, status) {
  // Validate confidence_uuid exists and is in DECLARED status
  const declaration = findConfidenceDeclaration(confidence_uuid);

  if (!declaration) {
    throw new Error(`Confidence declaration not found: ${confidence_uuid}. You must call declareConfidence() first.`);
  }

  if (declaration.status !== CONFIDENCE_CONFIG.STATUS.DECLARED) {
    throw new Error(`Confidence declaration ${confidence_uuid} has status "${declaration.status}". Only DECLARED can be linked.`);
  }

  // Create the content entry with confidence fields
  const result = newEntryWithConfidenceFields(
    actor,
    eventType,
    text,
    gift || '',
    status || 'DRAFT',
    declaration.level,
    confidence_uuid,
    declaration.justification
  );

  // Update the declaration status to LINKED
  updateConfidenceStatus(declaration.row, CONFIDENCE_CONFIG.STATUS.LINKED);

  logSystemEvent('INFO', 'CONFIDENCE', 'Content linked to confidence declaration', {
    content_uuid: result.uuid,
    confidence_uuid: confidence_uuid,
    level: declaration.level
  });

  return {
    uuid: result.uuid,
    ts: result.ts,
    recordHash: result.recordHash,
    confidence_uuid: confidence_uuid,
    confidence_level: declaration.level
  };
}


/**
 * Find a confidence declaration by UUID.
 * Returns null if not found.
 */
function findConfidenceDeclaration(confidence_uuid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) return null;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  // Search for the declaration
  // Column 16 is Confidence_UUID in 17-column schema
  const data = sh.getRange(2, 1, lastRow - 1, 17).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const eventType = row[3];
    const conf_uuid = row[15]; // Column 16 (0-indexed = 15)

    if (conf_uuid === confidence_uuid && eventType === CONFIDENCE_CONFIG.EVENT_TYPES.DECLARATION) {
      return {
        row: i + 2,
        uuid: row[0],
        timestamp: row[1],
        actor: row[2],
        eventType: row[3],
        text: row[4],
        status: row[8],
        level: row[14],       // Column 15
        confidence_uuid: row[15], // Column 16
        justification: row[16]    // Column 17
      };
    }
  }

  return null;
}


/**
 * Update the status of a confidence declaration row.
 */
function updateConfidenceStatus(row, newStatus) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) return;

  // Status is column 9
  sh.getRange(row, 9).setValue(newStatus);
}


/**
 * Get expected confidence level from numeric percentage.
 */
function getExpectedLevel(numeric) {
  if (numeric >= CONFIDENCE_CONFIG.THRESHOLDS.HIGH) {
    return CONFIDENCE_CONFIG.LEVELS.KNOWN_KNOWN;
  } else if (numeric >= CONFIDENCE_CONFIG.THRESHOLDS.MEDIUM) {
    return CONFIDENCE_CONFIG.LEVELS.KNOWN_UNKNOWN;
  } else {
    return CONFIDENCE_CONFIG.LEVELS.UNKNOWN_UNKNOWN;
  }
}


// ==========================
// SCHEMA EXTENSION (17 COLUMNS)
// ==========================

const LEDGER_HEADERS_17 = [
  'UUID','Timestamp','Actor','Event Type','Text','Gift',           // 1-6
  'Prev Hash','Record Hash','Status',                              // 7-9
  'Provision IDs','Provision Titles','Provision Snippets','Provision URLs', // 10-13
  'Citation Hash',                                                  // 14
  'Confidence_Level', 'Confidence_UUID', 'Confidence_Justification' // 15-17
];


/**
 * Upgrade existing 14-column schema to 17 columns.
 * Marks existing entries as LEGACY.
 */
function upgradeSchemaTo17Columns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LEDGER_SHEET_NAME);

  if (!sh) {
    SpreadsheetApp.getUi().alert('Audit_Ledger sheet not found. Run Setup Sheet first.');
    return;
  }

  const lastCol = sh.getLastColumn();

  // Check if already upgraded
  if (lastCol >= 17) {
    const headers = sh.getRange(1, 1, 1, 17).getValues()[0];
    if (headers[14] === 'Confidence_Level') {
      SpreadsheetApp.getUi().alert('Schema already at 17 columns.');
      return;
    }
  }

  // Add new headers
  const newHeaders = ['Confidence_Level', 'Confidence_UUID', 'Confidence_Justification'];
  sh.getRange(1, 15, 1, 3).setValues([newHeaders]);
  sh.getRange(1, 15, 1, 3).setFontWeight('bold');
  sh.getRange(1, 15, 1, 3).setBackground('#4a4a4a');
  sh.getRange(1, 15, 1, 3).setFontColor('#ffffff');

  // Mark existing entries as LEGACY
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    const legacyValues = [];
    for (let i = 2; i <= lastRow; i++) {
      legacyValues.push([CONFIDENCE_CONFIG.STATUS.LEGACY, '', '']);
    }
    sh.getRange(2, 15, lastRow - 1, 3).setValues(legacyValues);
  }

  // Auto-resize columns
  for (let i = 15; i <= 17; i++) {
    sh.autoResizeColumn(i);
  }

  logSystemEvent('SUCCESS', 'CONFIDENCE', 'Schema upgraded to 17 columns', {
    rowsMarkedLegacy: lastRow - 1
  });

  SpreadsheetApp.getUi().alert(`Schema upgraded to 17 columns.\n${lastRow - 1} existing entries marked as LEGACY.`);
}


/**
 * Extended entry function that writes all 17 columns.
 * Internal use - called by declareConfidence and newEntryWithConfidence.
 */
function newEntryWithConfidenceFields(actor, eventType, text, gift, status, confLevel, confUuid, confJustification) {
  return withLock(() => {
    try {
      if (!['User', 'Admin', 'System'].includes(actor)) {
        logSystemEvent('ERROR', 'ENTRY', 'Unauthorized actor', { actor });
        throw new Error('Unauthorized actor: ' + actor);
      }

      const sh = _getLedgerSheet();
      const lastCol = sh.getLastColumn();

      // Check if schema is 17 columns
      if (lastCol < 17) {
        throw new Error('Schema not upgraded to 17 columns. Run "Confidence > Upgrade Schema to 17 Columns" first.');
      }

      const last = sh.getLastRow();
      const prevHash = (last > 1) ? (sh.getRange(last, 8).getValue() || '') : '';
      const uuid = Utilities.getUuid();
      const ts = new Date().toISOString();

      // Standard citation fields (empty for confidence entries)
      const provisionIds = '';
      const provisionTitles = '';
      const provisionSnippets = '';
      const provisionUrls = '';
      const citationHash = 'no_citations';

      // Build hash blob with all 17 fields
      const blob = [
        uuid, ts, actor, eventType, text, gift, prevHash, status,
        provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash,
        confLevel || '', confUuid || '', confJustification || ''
      ].join('|');

      const recordHash = sha(blob);

      // Write all 17 columns
      sh.getRange(last + 1, 1, 1, 17).setValues([[
        uuid, ts, actor, eventType, text, gift, prevHash, recordHash, status,
        provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash,
        confLevel || '', confUuid || '', confJustification || ''
      ]]);

      logSystemEvent('INFO', 'ENTRY', 'New 17-column entry created', {
        eventType, status, uuid, confidenceLevel: confLevel
      });

      return { uuid, ts, recordHash };

    } catch (e) {
      logSystemEvent('ERROR', 'ENTRY', 'Failed to create 17-column entry', { err: e.message, eventType, actor });
      throw e;
    }
  });
}


// ==========================
// CONFIDENCE AUDIT
// ==========================

/**
 * Audit confidence declarations - find mismatches between
 * declared confidence and actual outcomes.
 *
 * @param {string} outcomeFilter - Optional: CORRECT | INCORRECT | ALL
 * @returns {Object} - Audit results
 */
function auditConfidenceDeclarations(outcomeFilter) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) return { error: 'Ledger not found' };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { declarations: 0, results: [] };

  const data = sh.getRange(2, 1, lastRow - 1, 17).getValues();

  const results = {
    totalDeclarations: 0,
    byLevel: {
      KNOWN_KNOWN: { total: 0, linked: 0, unlinked: 0 },
      KNOWN_UNKNOWN: { total: 0, linked: 0, unlinked: 0 },
      UNKNOWN_UNKNOWN: { total: 0, linked: 0, unlinked: 0 }
    },
    unlinkedDeclarations: [],
    auditedAt: new Date().toISOString()
  };

  for (const row of data) {
    const eventType = row[3];
    const status = row[8];
    const confLevel = row[14];
    const confUuid = row[15];

    if (eventType === CONFIDENCE_CONFIG.EVENT_TYPES.DECLARATION) {
      results.totalDeclarations++;

      if (confLevel && results.byLevel[confLevel]) {
        results.byLevel[confLevel].total++;

        if (status === CONFIDENCE_CONFIG.STATUS.LINKED) {
          results.byLevel[confLevel].linked++;
        } else if (status === CONFIDENCE_CONFIG.STATUS.DECLARED) {
          results.byLevel[confLevel].unlinked++;
          results.unlinkedDeclarations.push({
            uuid: row[0],
            timestamp: row[1],
            level: confLevel,
            confidence_uuid: confUuid
          });
        }
      }
    }
  }

  // Log audit
  safeNewEntry(
    'System',
    CONFIDENCE_CONFIG.EVENT_TYPES.AUDIT,
    `Confidence Audit: ${results.totalDeclarations} declarations, ${results.unlinkedDeclarations.length} unlinked`,
    '',
    'FINAL'
  );

  return results;
}


/**
 * Flag a confidence declaration as violated (post-hoc review found it wrong).
 *
 * @param {string} confidence_uuid - The declaration to flag
 * @param {string} reason - Why it was violated
 * @param {string} actor - Who flagged it
 */
function flagConfidenceViolation(confidence_uuid, reason, actor) {
  const declaration = findConfidenceDeclaration(confidence_uuid);

  if (!declaration) {
    throw new Error(`Confidence declaration not found: ${confidence_uuid}`);
  }

  // Create violation entry
  const violationText = [
    `[CONFIDENCE_VIOLATION]`,
    `Original Declaration: ${confidence_uuid}`,
    `Declared Level: ${declaration.level}`,
    `Declared At: ${declaration.timestamp}`,
    `Violation Reason: ${reason}`,
    `Flagged By: ${actor}`,
    `Flagged At: ${new Date().toISOString()}`
  ].join('\n');

  newEntryWithConfidenceFields(
    actor,
    CONFIDENCE_CONFIG.EVENT_TYPES.VIOLATION,
    violationText,
    '',
    CONFIDENCE_CONFIG.STATUS.VIOLATED,
    declaration.level,
    confidence_uuid,
    reason
  );

  // Update original declaration status
  updateConfidenceStatus(declaration.row, CONFIDENCE_CONFIG.STATUS.VIOLATED);

  logSystemEvent('WARN', 'CONFIDENCE', 'Confidence violation flagged', {
    confidence_uuid,
    original_level: declaration.level,
    reason
  });

  return { success: true, confidence_uuid, original_level: declaration.level };
}


// ==========================
// UI FUNCTIONS
// ==========================

function declareConfidenceFromUI() {
  const ui = SpreadsheetApp.getUi();

  // Level selection
  const levelResponse = ui.prompt(
    'Declare Confidence - Step 1/3',
    'Enter confidence level:\n• KNOWN_KNOWN (high confidence, direct evidence)\n• KNOWN_UNKNOWN (known gap)\n• UNKNOWN_UNKNOWN (speculation)',
    ui.ButtonSet.OK_CANCEL
  );
  if (levelResponse.getSelectedButton() !== ui.Button.OK) return;
  const level = levelResponse.getResponseText().trim().toUpperCase();

  // Justification
  const justResponse = ui.prompt(
    'Declare Confidence - Step 2/3',
    'Enter justification (required for KNOWN_KNOWN, recommended for others):',
    ui.ButtonSet.OK_CANCEL
  );
  if (justResponse.getSelectedButton() !== ui.Button.OK) return;
  const justification = justResponse.getResponseText().trim();

  // Optional numeric
  const numResponse = ui.prompt(
    'Declare Confidence - Step 3/3',
    'Enter numeric confidence 0-100 (optional, press OK to skip):',
    ui.ButtonSet.OK_CANCEL
  );
  if (numResponse.getSelectedButton() !== ui.Button.OK) return;
  const numText = numResponse.getResponseText().trim();
  const numeric = numText ? parseInt(numText) : undefined;

  try {
    const result = declareConfidence(level, justification, 'User', numeric);
    ui.alert(
      'Confidence Declared',
      `Your confidence declaration has been recorded.\n\nConfidence UUID: ${result.confidence_uuid}\n\nCopy this UUID - you will need it when creating linked content.`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


function createLinkedEntryFromUI() {
  const ui = SpreadsheetApp.getUi();

  // Get confidence UUID
  const uuidResponse = ui.prompt(
    'Create Linked Entry - Step 1/4',
    'Enter the Confidence UUID from your prior declaration:',
    ui.ButtonSet.OK_CANCEL
  );
  if (uuidResponse.getSelectedButton() !== ui.Button.OK) return;
  const confidence_uuid = uuidResponse.getResponseText().trim();

  // Event type
  const typeResponse = ui.prompt(
    'Create Linked Entry - Step 2/4',
    'Enter event type (e.g., DECISION, CLAIM, ANALYSIS):',
    ui.ButtonSet.OK_CANCEL
  );
  if (typeResponse.getSelectedButton() !== ui.Button.OK) return;
  const eventType = typeResponse.getResponseText().trim();

  // Content
  const textResponse = ui.prompt(
    'Create Linked Entry - Step 3/4',
    'Enter content text:',
    ui.ButtonSet.OK_CANCEL
  );
  if (textResponse.getSelectedButton() !== ui.Button.OK) return;
  const text = textResponse.getResponseText();

  // Status
  const statusResponse = ui.prompt(
    'Create Linked Entry - Step 4/4',
    'Enter status (DRAFT, VERIFIED, FINAL):',
    ui.ButtonSet.OK_CANCEL
  );
  if (statusResponse.getSelectedButton() !== ui.Button.OK) return;
  const status = statusResponse.getResponseText().trim().toUpperCase() || 'DRAFT';

  try {
    const result = newEntryWithConfidence(confidence_uuid, 'User', eventType, text, '', status);
    ui.alert(
      'Entry Created',
      `Content entry created and linked to confidence declaration.\n\nEntry UUID: ${result.uuid}\nConfidence Level: ${result.confidence_level}`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


function auditConfidenceFromUI() {
  const ui = SpreadsheetApp.getUi();

  try {
    const results = auditConfidenceDeclarations();

    let report = `CONFIDENCE AUDIT RESULTS\n\n`;
    report += `Total Declarations: ${results.totalDeclarations}\n\n`;

    for (const [level, stats] of Object.entries(results.byLevel)) {
      report += `${level}:\n`;
      report += `  Total: ${stats.total}\n`;
      report += `  Linked: ${stats.linked}\n`;
      report += `  Unlinked: ${stats.unlinked}\n\n`;
    }

    if (results.unlinkedDeclarations.length > 0) {
      report += `\nWARNING: ${results.unlinkedDeclarations.length} unlinked declarations found.\n`;
      report += `These declarations were made but never used.`;
    }

    ui.alert('Confidence Audit', report, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


function flagViolationFromUI() {
  const ui = SpreadsheetApp.getUi();

  const uuidResponse = ui.prompt(
    'Flag Violation - Step 1/2',
    'Enter the Confidence UUID to flag as violated:',
    ui.ButtonSet.OK_CANCEL
  );
  if (uuidResponse.getSelectedButton() !== ui.Button.OK) return;
  const confidence_uuid = uuidResponse.getResponseText().trim();

  const reasonResponse = ui.prompt(
    'Flag Violation - Step 2/2',
    'Enter reason for violation (why was the confidence wrong?):',
    ui.ButtonSet.OK_CANCEL
  );
  if (reasonResponse.getSelectedButton() !== ui.Button.OK) return;
  const reason = reasonResponse.getResponseText().trim();

  try {
    const result = flagConfidenceViolation(confidence_uuid, reason, 'User');
    ui.alert(
      'Violation Flagged',
      `Confidence declaration has been flagged as violated.\n\nOriginal Level: ${result.original_level}\nReason: ${reason}`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


// ==========================
// MENU (added to onOpen)
// ==========================

function addConfidenceMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Confidence')
    .addItem('Declare Confidence', 'declareConfidenceFromUI')
    .addItem('Create Linked Entry', 'createLinkedEntryFromUI')
    .addSeparator()
    .addItem('Audit Declarations', 'auditConfidenceFromUI')
    .addItem('Flag Violation', 'flagViolationFromUI')
    .addSeparator()
    .addItem('Upgrade Schema to 17 Columns', 'upgradeSchemaTo17Columns')
    .addToUi();
}
