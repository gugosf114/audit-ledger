/**
 * ===============================================================================
 *  NEWTON GOVERNANCE CO-PILOT v1.7.0
 * ===============================================================================
 *
 *  AI-assisted governance analysis with human-in-the-loop review.
 *
 *  Architecture:
 *    Analysis Request → Co-Pilot Analysis → Mutation Generation →
 *    Human Review → Apply/Reject → Audit Ledger
 *
 *  Key Features:
 *  1. Template-based analysis patterns
 *  2. Mutation tracking (proposed changes before they happen)
 *  3. Human review workflow with approval gates
 *  4. Full audit trail with confidence declarations
 *  5. Version control for templates
 *
 *  Sheets Required:
 *  - CoPilot_Templates: Analysis template definitions
 *  - CoPilot_Mutations: Pending/applied mutation log
 *  - CoPilot_Outcomes: Historical analysis outcomes
 *  - Audit_Ledger: All actions logged here
 *
 * ===============================================================================
 */


// ==========================
// CONFIGURATION
// ==========================

const COPILOT_CONFIG = {
  // Sheet names
  SHEETS: {
    TEMPLATES: 'CoPilot_Templates',
    MUTATIONS: 'CoPilot_Mutations',
    OUTCOMES: 'CoPilot_Outcomes',
    LEDGER: 'Audit_Ledger'
  },

  // Template schema (column order is critical)
  TEMPLATE_HEADERS: [
    'Template_ID',
    'Name',
    'Description',
    'Analysis_Type',
    'Prompt_Template',
    'Required_Inputs',
    'Output_Schema',
    'Auto_Apply_Rules',
    'Version',
    'Created_By',
    'Created_At',
    'Updated_At',
    'Active'
  ],

  // Mutation schema (column order is critical)
  MUTATION_HEADERS: [
    'Mutation_ID',
    'Template_ID',
    'Analysis_ID',
    'Mutation_Type',
    'Target_Sheet',
    'Target_Row',
    'Target_Column',
    'Current_Value',
    'Proposed_Value',
    'Confidence_Level',
    'Confidence_UUID',
    'Justification',
    'Status',
    'Reviewed_By',
    'Reviewed_At',
    'Applied_At',
    'Rejection_Reason'
  ],

  // Outcome schema (column order is critical)
  OUTCOME_HEADERS: [
    'Outcome_ID',
    'Template_ID',
    'Template_Name',
    'Analysis_ID',
    'Input_Data',
    'AI_Response',
    'Mutations_Generated',
    'Mutations_Applied',
    'Mutations_Rejected',
    'Confidence_Level',
    'Confidence_UUID',
    'Duration_MS',
    'Status',
    'Error_Message',
    'Created_At',
    'Completed_At'
  ],

  // Mutation statuses
  MUTATION_STATUS: {
    PENDING_REVIEW: 'PENDING_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    APPLIED: 'APPLIED',
    FAILED: 'FAILED',
    EXPIRED: 'EXPIRED'
  },

  // Analysis types
  ANALYSIS_TYPES: {
    GAP_ANALYSIS: 'GAP_ANALYSIS',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK',
    RISK_ASSESSMENT: 'RISK_ASSESSMENT',
    DOCUMENT_REVIEW: 'DOCUMENT_REVIEW',
    DATA_QUALITY: 'DATA_QUALITY',
    CUSTOM: 'CUSTOM'
  },

  // Auto-apply rules
  AUTO_APPLY_RULES: {
    NEVER: 'NEVER',                      // Always require human review
    HIGH_CONFIDENCE: 'HIGH_CONFIDENCE',  // Auto-apply if KK and >90%
    LOW_RISK: 'LOW_RISK',                // Auto-apply if mutation is additive only
    ALWAYS: 'ALWAYS'                     // Auto-apply all (dangerous, use sparingly)
  },

  // Confidence thresholds for auto-apply
  THRESHOLDS: {
    AUTO_APPLY_MIN_CONFIDENCE: 90,       // Minimum confidence % for auto-apply
    HIGH_CONFIDENCE: 80,
    MEDIUM_CONFIDENCE: 50,
    LOW_CONFIDENCE: 20
  },

  // Event types for ledger
  EVENT_TYPES: {
    ANALYSIS_STARTED: 'COPILOT_ANALYSIS_STARTED',
    ANALYSIS_COMPLETED: 'COPILOT_ANALYSIS_COMPLETED',
    ANALYSIS_FAILED: 'COPILOT_ANALYSIS_FAILED',
    MUTATION_CREATED: 'COPILOT_MUTATION_CREATED',
    MUTATION_APPROVED: 'COPILOT_MUTATION_APPROVED',
    MUTATION_REJECTED: 'COPILOT_MUTATION_REJECTED',
    MUTATION_APPLIED: 'COPILOT_MUTATION_APPLIED',
    MUTATION_FAILED: 'COPILOT_MUTATION_FAILED',
    TEMPLATE_CREATED: 'COPILOT_TEMPLATE_CREATED',
    TEMPLATE_UPDATED: 'COPILOT_TEMPLATE_UPDATED'
  }
};


// ==========================
// SHEET INITIALIZATION
// ==========================

/**
 * Get ordered headers for a sheet type - ensures consistent column order.
 * @param {string} sheetType - 'TEMPLATES' | 'MUTATIONS' | 'OUTCOMES'
 * @returns {string[]} - Ordered header array
 */
function getCoPilotHeaders_(sheetType) {
  switch (sheetType) {
    case 'TEMPLATES':
      return COPILOT_CONFIG.TEMPLATE_HEADERS;
    case 'MUTATIONS':
      return COPILOT_CONFIG.MUTATION_HEADERS;
    case 'OUTCOMES':
      return COPILOT_CONFIG.OUTCOME_HEADERS;
    default:
      throw new Error(`Unknown sheet type: ${sheetType}`);
  }
}

/**
 * Initialize Co-Pilot sheets with proper headers.
 */
function setupCoPilotSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToCreate = [
    { name: COPILOT_CONFIG.SHEETS.TEMPLATES, type: 'TEMPLATES' },
    { name: COPILOT_CONFIG.SHEETS.MUTATIONS, type: 'MUTATIONS' },
    { name: COPILOT_CONFIG.SHEETS.OUTCOMES, type: 'OUTCOMES' }
  ];

  for (const sheetDef of sheetsToCreate) {
    let sheet = ss.getSheetByName(sheetDef.name);
    const headers = getCoPilotHeaders_(sheetDef.type);

    if (!sheet) {
      sheet = ss.insertSheet(sheetDef.name);
      // Set headers using setValues for atomic write
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.getRange(1, 1, 1, headers.length).setBackground('#4a4a4a').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      for (let i = 1; i <= headers.length; i++) {
        sheet.autoResizeColumn(i);
      }
      logSystemEvent('INFO', 'COPILOT', `Created sheet: ${sheetDef.name}`, { headers: headers.length });
    } else {
      // Validate existing headers match expected order
      const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
      const headersMatch = headers.every((h, i) => existingHeaders[i] === h);
      if (!headersMatch) {
        logSystemEvent('WARN', 'COPILOT', `Sheet ${sheetDef.name} headers mismatch`, {
          expected: headers,
          actual: existingHeaders
        });
      }
    }
  }

  logToCoPilotLedger_('COPILOT_SETUP', 'System', 'Co-Pilot sheets initialized', null, {
    sheets: sheetsToCreate.map(s => s.name)
  });

  if (_inUi()) {
    SpreadsheetApp.getUi().alert('Co-Pilot sheets initialized successfully.');
  }
}


// ==========================
// SAFE WRITE OPERATIONS
// ==========================

/**
 * Append a row using object with column-order safety.
 * Uses getCoPilotHeaders_ to ensure consistent column order regardless of object key order.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {string} sheetType - 'TEMPLATES' | 'MUTATIONS' | 'OUTCOMES'
 * @param {Object} rowData - Object with column names as keys
 * @returns {number} - Row number of appended row
 */
function coPilotAppendObject_(sheet, sheetType, rowData) {
  const headers = getCoPilotHeaders_(sheetType);
  const rowArray = headers.map(header => {
    const value = rowData[header];
    // Handle special cases
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  });

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, rowArray.length).setValues([rowArray]);
  return lastRow + 1;
}

/**
 * Update a row using object with column-order safety.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {string} sheetType - 'TEMPLATES' | 'MUTATIONS' | 'OUTCOMES'
 * @param {number} row - Row number to update
 * @param {Object} updates - Object with column names as keys (partial updates allowed)
 */
function coPilotUpdateObject_(sheet, sheetType, row, updates) {
  const headers = getCoPilotHeaders_(sheetType);
  const currentRow = sheet.getRange(row, 1, 1, headers.length).getValues()[0];

  const newRow = headers.map((header, idx) => {
    if (updates.hasOwnProperty(header)) {
      const value = updates[header];
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return value;
    }
    return currentRow[idx];
  });

  sheet.getRange(row, 1, 1, newRow.length).setValues([newRow]);
}

/**
 * Read a row as an object with proper typing.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Source sheet
 * @param {string} sheetType - 'TEMPLATES' | 'MUTATIONS' | 'OUTCOMES'
 * @param {number} row - Row number to read
 * @returns {Object} - Row data as object with column names as keys
 */
function coPilotReadObject_(sheet, sheetType, row) {
  const headers = getCoPilotHeaders_(sheetType);
  const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];

  const obj = {};
  headers.forEach((header, idx) => {
    obj[header] = values[idx];
  });
  return obj;
}


// ==========================
// LOGGING FUNCTIONS
// ==========================

/**
 * Log an event to the Audit Ledger.
 *
 * @param {string} eventType - Type of event
 * @param {string} actor - User | Admin | System
 * @param {string} description - Human-readable description
 * @param {string} referenceId - Optional reference ID (mutation, template, etc.)
 * @param {Object} metadata - Additional metadata to include
 */
function logToCoPilotLedger_(eventType, actor, description, referenceId, metadata) {
  try {
    const text = [
      `[${eventType}]`,
      description,
      referenceId ? `Reference: ${referenceId}` : '',
      metadata ? `Metadata: ${JSON.stringify(metadata)}` : ''
    ].filter(Boolean).join('\n');

    // Use existing ledger function if available
    if (typeof safeNewEntry === 'function') {
      safeNewEntry(actor || 'System', eventType, text, '', 'VERIFIED');
    } else {
      Logger.log(`[LEDGER] ${eventType}: ${description}`);
    }
  } catch (e) {
    Logger.log(`Failed to log to ledger: ${e.message}`);
  }
}

/**
 * Load outcomes from the CoPilot_Outcomes sheet.
 *
 * @param {Object} filters - Optional filters { templateId, status, startDate, endDate }
 * @returns {Object[]} - Array of outcome objects
 */
function loadCoPilotOutcomes_(filters) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.OUTCOMES);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const headers = getCoPilotHeaders_('OUTCOMES');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  let outcomes = data.map((row, idx) => {
    const obj = {};
    headers.forEach((header, colIdx) => {
      obj[header] = row[colIdx];
    });
    obj._row = idx + 2; // Track row number for updates
    return obj;
  });

  // Apply filters
  if (filters) {
    if (filters.templateId) {
      outcomes = outcomes.filter(o => o.Template_ID === filters.templateId);
    }
    if (filters.status) {
      outcomes = outcomes.filter(o => o.Status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      outcomes = outcomes.filter(o => new Date(o.Created_At) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      outcomes = outcomes.filter(o => new Date(o.Created_At) <= end);
    }
  }

  return outcomes;
}


// ==========================
// TEMPLATE MANAGEMENT
// ==========================

// Template config cache
let _coPilotTemplateCache = null;
let _coPilotTemplateCacheTime = 0;
const COPILOT_TEMPLATE_CACHE_TTL = 60000; // 1 minute

/**
 * Get template config map with caching.
 * @returns {Map<string, Object>} - Map of template ID to config object
 */
function getCoPilotTemplateConfigMap_() {
  const now = Date.now();
  if (_coPilotTemplateCache && (now - _coPilotTemplateCacheTime) < COPILOT_TEMPLATE_CACHE_TTL) {
    return _coPilotTemplateCache;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.TEMPLATES);

  if (!sheet || sheet.getLastRow() < 2) {
    _coPilotTemplateCache = new Map();
    _coPilotTemplateCacheTime = now;
    return _coPilotTemplateCache;
  }

  const headers = getCoPilotHeaders_('TEMPLATES');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  const map = new Map();
  data.forEach((row, idx) => {
    const obj = {};
    headers.forEach((header, colIdx) => {
      obj[header] = row[colIdx];
    });
    obj._row = idx + 2;
    if (obj.Active === true || obj.Active === 'TRUE' || obj.Active === 'true') {
      map.set(obj.Template_ID, obj);
    }
  });

  _coPilotTemplateCache = map;
  _coPilotTemplateCacheTime = now;
  return map;
}

/**
 * Clear template cache (call after updates).
 */
function clearCoPilotTemplateCache_() {
  _coPilotTemplateCache = null;
  _coPilotTemplateCacheTime = 0;
}

/**
 * Create a new analysis template.
 *
 * @param {Object} templateData - Template configuration
 * @returns {Object} - Created template info
 */
function createCoPilotTemplate(templateData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.TEMPLATES);

  if (!sheet) {
    setupCoPilotSheets();
    sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.TEMPLATES);
  }

  const templateId = 'TPL_' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const timestamp = new Date().toISOString();
  const user = Session.getEffectiveUser().getEmail() || 'System';

  const rowData = {
    'Template_ID': templateId,
    'Name': templateData.name || 'Unnamed Template',
    'Description': templateData.description || '',
    'Analysis_Type': templateData.analysisType || COPILOT_CONFIG.ANALYSIS_TYPES.CUSTOM,
    'Prompt_Template': templateData.promptTemplate || '',
    'Required_Inputs': JSON.stringify(templateData.requiredInputs || []),
    'Output_Schema': JSON.stringify(templateData.outputSchema || {}),
    'Auto_Apply_Rules': templateData.autoApplyRules || COPILOT_CONFIG.AUTO_APPLY_RULES.NEVER,
    'Version': 1,
    'Created_By': user,
    'Created_At': timestamp,
    'Updated_At': timestamp,
    'Active': true
  };

  const row = coPilotAppendObject_(sheet, 'TEMPLATES', rowData);
  clearCoPilotTemplateCache_();

  logToCoPilotLedger_(
    COPILOT_CONFIG.EVENT_TYPES.TEMPLATE_CREATED,
    user,
    `Created template: ${rowData.Name}`,
    templateId,
    { analysisType: rowData.Analysis_Type }
  );

  return {
    templateId,
    name: rowData.Name,
    version: 1,
    row
  };
}

/**
 * Get a template by ID.
 *
 * @param {string} templateId - Template ID
 * @returns {Object|null} - Template object or null if not found
 */
function getCoPilotTemplate(templateId) {
  const map = getCoPilotTemplateConfigMap_();
  return map.get(templateId) || null;
}

/**
 * List all active templates.
 *
 * @returns {Object[]} - Array of template objects
 */
function listCoPilotTemplates() {
  const map = getCoPilotTemplateConfigMap_();
  return Array.from(map.values());
}

/**
 * Get current template version.
 *
 * @param {string} templateId - Template ID
 * @returns {number} - Current version number
 */
function getCurrentCoPilotTemplateVersion_(templateId) {
  const template = getCoPilotTemplate(templateId);
  return template ? (template.Version || 1) : 0;
}

/**
 * Create a new version of a template.
 *
 * @param {string} templateId - Template ID to version
 * @param {Object} updates - Updates to apply
 * @returns {Object} - New version info
 */
function createCoPilotTemplateVersion_(templateId, updates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.TEMPLATES);
  const template = getCoPilotTemplate(templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const newVersion = (template.Version || 1) + 1;
  const timestamp = new Date().toISOString();
  const user = Session.getEffectiveUser().getEmail() || 'System';

  // Update the existing row
  const updateData = {
    ...updates,
    'Version': newVersion,
    'Updated_At': timestamp
  };

  coPilotUpdateObject_(sheet, 'TEMPLATES', template._row, updateData);
  clearCoPilotTemplateCache_();

  logToCoPilotLedger_(
    COPILOT_CONFIG.EVENT_TYPES.TEMPLATE_UPDATED,
    user,
    `Updated template: ${template.Name} to v${newVersion}`,
    templateId,
    { previousVersion: template.Version, newVersion }
  );

  return {
    templateId,
    version: newVersion,
    updatedAt: timestamp
  };
}


// ==========================
// MUTATION MANAGEMENT
// ==========================

/**
 * Create a mutation record (proposed change).
 *
 * @param {Object} mutationData - Mutation details
 * @returns {Object} - Created mutation info
 */
function createCoPilotMutation_(mutationData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.MUTATIONS);

  if (!sheet) {
    setupCoPilotSheets();
    sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.MUTATIONS);
  }

  const mutationId = 'MUT_' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const timestamp = new Date().toISOString();

  const rowData = {
    'Mutation_ID': mutationId,
    'Template_ID': mutationData.templateId || '',
    'Analysis_ID': mutationData.analysisId || '',
    'Mutation_Type': mutationData.mutationType || 'UPDATE',
    'Target_Sheet': mutationData.targetSheet || '',
    'Target_Row': mutationData.targetRow || '',
    'Target_Column': mutationData.targetColumn || '',
    'Current_Value': mutationData.currentValue || '',
    'Proposed_Value': mutationData.proposedValue || '',
    'Confidence_Level': mutationData.confidenceLevel || 'UNKNOWN_UNKNOWN',
    'Confidence_UUID': mutationData.confidenceUuid || '',
    'Justification': mutationData.justification || '',
    'Status': COPILOT_CONFIG.MUTATION_STATUS.PENDING_REVIEW,
    'Reviewed_By': '',
    'Reviewed_At': '',
    'Applied_At': '',
    'Rejection_Reason': ''
  };

  const row = coPilotAppendObject_(sheet, 'MUTATIONS', rowData);

  logToCoPilotLedger_(
    COPILOT_CONFIG.EVENT_TYPES.MUTATION_CREATED,
    'System',
    `Created mutation: ${mutationData.mutationType} on ${mutationData.targetSheet}`,
    mutationId,
    {
      targetRow: mutationData.targetRow,
      targetColumn: mutationData.targetColumn,
      confidenceLevel: mutationData.confidenceLevel
    }
  );

  return {
    mutationId,
    status: COPILOT_CONFIG.MUTATION_STATUS.PENDING_REVIEW,
    row
  };
}

/**
 * Get a mutation by ID.
 *
 * @param {string} mutationId - Mutation ID
 * @returns {Object|null} - Mutation object or null
 */
function getCoPilotMutation_(mutationId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.MUTATIONS);

  if (!sheet || sheet.getLastRow() < 2) {
    return null;
  }

  const headers = getCoPilotHeaders_('MUTATIONS');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === mutationId) {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = data[i][idx];
      });
      obj._row = i + 2;
      return obj;
    }
  }

  return null;
}

/**
 * Get pending mutations for review.
 *
 * @param {Object} filters - Optional filters
 * @returns {Object[]} - Array of pending mutations
 */
function getPendingCoPilotMutations_(filters) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.MUTATIONS);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const headers = getCoPilotHeaders_('MUTATIONS');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  let mutations = [];
  data.forEach((row, idx) => {
    const status = row[headers.indexOf('Status')];
    if (status === COPILOT_CONFIG.MUTATION_STATUS.PENDING_REVIEW) {
      const obj = {};
      headers.forEach((header, colIdx) => {
        obj[header] = row[colIdx];
      });
      obj._row = idx + 2;
      mutations.push(obj);
    }
  });

  // Apply filters
  if (filters) {
    if (filters.templateId) {
      mutations = mutations.filter(m => m.Template_ID === filters.templateId);
    }
    if (filters.analysisId) {
      mutations = mutations.filter(m => m.Analysis_ID === filters.analysisId);
    }
  }

  return mutations;
}

/**
 * Check if a mutation can be auto-applied based on rules and confidence.
 *
 * @param {Object} mutation - Mutation object
 * @param {Object} template - Template object with auto-apply rules
 * @returns {boolean} - True if can auto-apply
 */
function canCoPilotAutoApply_(mutation, template) {
  if (!mutation || !template) {
    return false;
  }

  const rule = template.Auto_Apply_Rules || COPILOT_CONFIG.AUTO_APPLY_RULES.NEVER;

  switch (rule) {
    case COPILOT_CONFIG.AUTO_APPLY_RULES.NEVER:
      return false;

    case COPILOT_CONFIG.AUTO_APPLY_RULES.ALWAYS:
      return true;

    case COPILOT_CONFIG.AUTO_APPLY_RULES.HIGH_CONFIDENCE:
      // Require KNOWN_KNOWN and high numeric confidence
      if (mutation.Confidence_Level !== 'KNOWN_KNOWN') {
        return false;
      }
      // Check if we have a confidence declaration with high confidence
      if (mutation.Confidence_UUID) {
        try {
          if (typeof findConfidenceDeclaration === 'function') {
            const declaration = findConfidenceDeclaration(mutation.Confidence_UUID);
            if (declaration && declaration.numericConfidence >= COPILOT_CONFIG.THRESHOLDS.AUTO_APPLY_MIN_CONFIDENCE) {
              return true;
            }
          }
        } catch (e) {
          // If can't verify confidence, don't auto-apply
          return false;
        }
      }
      return false;

    case COPILOT_CONFIG.AUTO_APPLY_RULES.LOW_RISK:
      // Only auto-apply additive mutations (INSERT, not UPDATE or DELETE)
      const mutationType = mutation.Mutation_Type || '';
      return mutationType === 'INSERT' || mutationType === 'ADD';

    default:
      return false;
  }
}

/**
 * Save a mutation update.
 *
 * @param {Object} mutation - Mutation object with _row
 * @param {Object} updates - Updates to apply
 */
function saveCoPilotMutation_(mutation, updates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.MUTATIONS);

  if (!sheet || !mutation._row) {
    throw new Error('Cannot save mutation: invalid mutation or missing row');
  }

  coPilotUpdateObject_(sheet, 'MUTATIONS', mutation._row, updates);
}

/**
 * Apply a mutation (execute the proposed change).
 *
 * @param {string} mutationId - Mutation ID to apply
 * @returns {Object} - Result of application
 */
function applyCoPilotMutation_(mutationId) {
  const mutation = getCoPilotMutation_(mutationId);

  if (!mutation) {
    throw new Error(`Mutation not found: ${mutationId}`);
  }

  if (mutation.Status !== COPILOT_CONFIG.MUTATION_STATUS.APPROVED &&
      mutation.Status !== COPILOT_CONFIG.MUTATION_STATUS.PENDING_REVIEW) {
    throw new Error(`Mutation ${mutationId} cannot be applied (status: ${mutation.Status})`);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = ss.getSheetByName(mutation.Target_Sheet);

  if (!targetSheet) {
    saveCoPilotMutation_(mutation, {
      'Status': COPILOT_CONFIG.MUTATION_STATUS.FAILED,
      'Rejection_Reason': `Target sheet not found: ${mutation.Target_Sheet}`
    });
    throw new Error(`Target sheet not found: ${mutation.Target_Sheet}`);
  }

  try {
    const targetRow = parseInt(mutation.Target_Row, 10);
    const targetColumn = mutation.Target_Column;

    // Find column index if column is a name
    let colIndex;
    if (typeof targetColumn === 'number') {
      colIndex = targetColumn;
    } else {
      const headers = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
      colIndex = headers.indexOf(targetColumn) + 1;
      if (colIndex === 0) {
        throw new Error(`Column not found: ${targetColumn}`);
      }
    }

    // Apply the mutation based on type
    const mutationType = mutation.Mutation_Type || 'UPDATE';

    switch (mutationType) {
      case 'UPDATE':
        targetSheet.getRange(targetRow, colIndex).setValue(mutation.Proposed_Value);
        break;

      case 'INSERT':
        targetSheet.insertRowAfter(targetRow);
        targetSheet.getRange(targetRow + 1, colIndex).setValue(mutation.Proposed_Value);
        break;

      case 'DELETE':
        targetSheet.getRange(targetRow, colIndex).setValue('');
        break;

      default:
        targetSheet.getRange(targetRow, colIndex).setValue(mutation.Proposed_Value);
    }

    // Update mutation status
    const timestamp = new Date().toISOString();
    saveCoPilotMutation_(mutation, {
      'Status': COPILOT_CONFIG.MUTATION_STATUS.APPLIED,
      'Applied_At': timestamp
    });

    logToCoPilotLedger_(
      COPILOT_CONFIG.EVENT_TYPES.MUTATION_APPLIED,
      Session.getEffectiveUser().getEmail() || 'System',
      `Applied mutation ${mutationId}`,
      mutationId,
      {
        targetSheet: mutation.Target_Sheet,
        targetRow,
        targetColumn,
        mutationType
      }
    );

    return {
      success: true,
      mutationId,
      appliedAt: timestamp
    };

  } catch (e) {
    saveCoPilotMutation_(mutation, {
      'Status': COPILOT_CONFIG.MUTATION_STATUS.FAILED,
      'Rejection_Reason': e.message
    });

    logToCoPilotLedger_(
      COPILOT_CONFIG.EVENT_TYPES.MUTATION_FAILED,
      'System',
      `Failed to apply mutation ${mutationId}: ${e.message}`,
      mutationId,
      { error: e.message }
    );

    throw e;
  }
}

/**
 * Approve a mutation for application.
 *
 * @param {string} mutationId - Mutation ID to approve
 * @param {boolean} autoApply - Whether to immediately apply after approval
 * @returns {Object} - Result
 */
function approveCoPilotMutation(mutationId, autoApply) {
  const mutation = getCoPilotMutation_(mutationId);

  if (!mutation) {
    throw new Error(`Mutation not found: ${mutationId}`);
  }

  if (mutation.Status !== COPILOT_CONFIG.MUTATION_STATUS.PENDING_REVIEW) {
    throw new Error(`Mutation ${mutationId} is not pending review (status: ${mutation.Status})`);
  }

  const user = Session.getEffectiveUser().getEmail() || 'System';
  const timestamp = new Date().toISOString();

  saveCoPilotMutation_(mutation, {
    'Status': COPILOT_CONFIG.MUTATION_STATUS.APPROVED,
    'Reviewed_By': user,
    'Reviewed_At': timestamp
  });

  logToCoPilotLedger_(
    COPILOT_CONFIG.EVENT_TYPES.MUTATION_APPROVED,
    user,
    `Approved mutation ${mutationId}`,
    mutationId,
    {}
  );

  if (autoApply) {
    return applyCoPilotMutation_(mutationId);
  }

  return {
    success: true,
    mutationId,
    status: COPILOT_CONFIG.MUTATION_STATUS.APPROVED,
    approvedBy: user,
    approvedAt: timestamp
  };
}

/**
 * Reject a mutation.
 *
 * @param {string} mutationId - Mutation ID to reject
 * @param {string} reason - Rejection reason
 * @returns {Object} - Result
 */
function rejectCoPilotMutation(mutationId, reason) {
  const mutation = getCoPilotMutation_(mutationId);

  if (!mutation) {
    throw new Error(`Mutation not found: ${mutationId}`);
  }

  if (mutation.Status !== COPILOT_CONFIG.MUTATION_STATUS.PENDING_REVIEW) {
    throw new Error(`Mutation ${mutationId} is not pending review (status: ${mutation.Status})`);
  }

  const user = Session.getEffectiveUser().getEmail() || 'System';
  const timestamp = new Date().toISOString();

  saveCoPilotMutation_(mutation, {
    'Status': COPILOT_CONFIG.MUTATION_STATUS.REJECTED,
    'Reviewed_By': user,
    'Reviewed_At': timestamp,
    'Rejection_Reason': reason || 'No reason provided'
  });

  logToCoPilotLedger_(
    COPILOT_CONFIG.EVENT_TYPES.MUTATION_REJECTED,
    user,
    `Rejected mutation ${mutationId}: ${reason || 'No reason'}`,
    mutationId,
    { reason }
  );

  return {
    success: true,
    mutationId,
    status: COPILOT_CONFIG.MUTATION_STATUS.REJECTED,
    rejectedBy: user,
    rejectedAt: timestamp,
    reason
  };
}


// ==========================
// ANALYSIS EXECUTION
// ==========================

/**
 * Run Co-Pilot analysis using a template.
 *
 * @param {string} templateId - Template ID to use
 * @param {Object} inputData - Input data for analysis
 * @param {Object} options - Analysis options
 * @returns {Object} - Analysis result
 */
function runCoPilotAnalysis(templateId, inputData, options) {
  const startTime = Date.now();
  const analysisId = 'ANA_' + Utilities.getUuid().substring(0, 8).toUpperCase();

  // Initialize results object early
  const results = {
    analysisId,
    templateId,
    success: false,
    mutations: [],
    mutationsApplied: 0,
    mutationsRejected: 0,
    aiResponse: null,
    error: null,
    duration: 0
  };

  options = options || {};

  try {
    // Get template
    const template = getCoPilotTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Log analysis start
    logToCoPilotLedger_(
      COPILOT_CONFIG.EVENT_TYPES.ANALYSIS_STARTED,
      Session.getEffectiveUser().getEmail() || 'System',
      `Started analysis with template: ${template.Name}`,
      analysisId,
      { templateId, inputDataKeys: Object.keys(inputData || {}) }
    );

    // Declare confidence if not provided
    let confidenceUuid = options.confidenceUuid;
    let confidenceLevel = options.confidenceLevel || 'KNOWN_UNKNOWN';

    if (!confidenceUuid && typeof declareConfidence === 'function') {
      try {
        const declaration = declareConfidence(
          confidenceLevel,
          `Co-Pilot analysis using template ${template.Name}`,
          'System'
        );
        confidenceUuid = declaration.confidence_uuid;
      } catch (e) {
        Logger.log('Could not declare confidence: ' + e.message);
      }
    }

    // Build prompt from template
    let prompt = template.Prompt_Template || '';

    // Replace template variables
    if (inputData) {
      for (const [key, value] of Object.entries(inputData)) {
        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        prompt = prompt.replace(placeholder, String(value));
      }
    }

    // Call AI API
    let aiResponse;
    if (typeof gatedAIRequest === 'function') {
      const aiResult = gatedAIRequest(
        options.provider || 'gemini',
        options.model || 'gemini-pro',
        prompt,
        {
          confidence_uuid: confidenceUuid,
          requireConfidence: false, // Already declared
          metadata: {
            analysisId,
            templateId
          }
        }
      );

      if (aiResult.blocked) {
        throw new Error(`AI request blocked: ${aiResult.message}`);
      }

      aiResponse = aiResult.response;
    } else if (typeof proxyAIRequest === 'function') {
      const aiResult = proxyAIRequest(
        options.provider || 'gemini',
        options.model || 'gemini-pro',
        prompt,
        { analysisId, templateId }
      );
      aiResponse = aiResult.response;
    } else {
      throw new Error('No AI proxy available. Configure AI Proxy first.');
    }

    results.aiResponse = aiResponse;

    // Parse AI response for mutations
    const mutations = parseCoPilotAIResponseForMutations_(aiResponse, template, analysisId, confidenceLevel, confidenceUuid);
    results.mutations = mutations;

    // Create mutation records
    for (const mutationData of mutations) {
      const created = createCoPilotMutation_(mutationData);

      // Check for auto-apply (NO await - synchronous call)
      if (canCoPilotAutoApply_(mutationData, template)) {
        try {
          applyCoPilotMutation_(created.mutationId);
          results.mutationsApplied++;
        } catch (e) {
          Logger.log(`Auto-apply failed for ${created.mutationId}: ${e.message}`);
        }
      }
    }

    results.success = true;
    results.duration = Date.now() - startTime;

    // Save outcome
    saveCoPilotOutcome_(results, template, inputData, confidenceLevel, confidenceUuid);

    // Log completion
    logToCoPilotLedger_(
      COPILOT_CONFIG.EVENT_TYPES.ANALYSIS_COMPLETED,
      'System',
      `Completed analysis: ${mutations.length} mutations generated`,
      analysisId,
      {
        mutationsGenerated: mutations.length,
        mutationsApplied: results.mutationsApplied,
        duration: results.duration
      }
    );

    return results;

  } catch (e) {
    results.error = e.message;
    results.duration = Date.now() - startTime;

    // Save failed outcome
    saveCoPilotOutcome_(results, null, inputData, null, null);

    logToCoPilotLedger_(
      COPILOT_CONFIG.EVENT_TYPES.ANALYSIS_FAILED,
      'System',
      `Analysis failed: ${e.message}`,
      analysisId,
      { error: e.message }
    );

    throw e;
  }
}

/**
 * Parse AI response to extract mutation proposals.
 *
 * @param {string} response - AI response text
 * @param {Object} template - Template object
 * @param {string} analysisId - Analysis ID
 * @param {string} confidenceLevel - Confidence level
 * @param {string} confidenceUuid - Confidence UUID
 * @returns {Object[]} - Array of mutation data objects
 */
function parseCoPilotAIResponseForMutations_(response, template, analysisId, confidenceLevel, confidenceUuid) {
  const mutations = [];

  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed.mutations)) {
      for (const m of parsed.mutations) {
        mutations.push({
          templateId: template.Template_ID,
          analysisId,
          mutationType: m.type || 'UPDATE',
          targetSheet: m.sheet || m.targetSheet,
          targetRow: m.row || m.targetRow,
          targetColumn: m.column || m.targetColumn,
          currentValue: m.currentValue || '',
          proposedValue: m.proposedValue || m.newValue,
          confidenceLevel,
          confidenceUuid,
          justification: m.justification || m.reason || ''
        });
      }
    }
  } catch (e) {
    // Not JSON, try to parse structured text
    const lines = response.split('\n');
    let currentMutation = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Look for mutation markers
      if (trimmed.startsWith('MUTATION:') || trimmed.startsWith('CHANGE:')) {
        if (currentMutation) {
          mutations.push(currentMutation);
        }
        currentMutation = {
          templateId: template.Template_ID,
          analysisId,
          mutationType: 'UPDATE',
          confidenceLevel,
          confidenceUuid
        };
      } else if (currentMutation) {
        // Parse mutation fields
        if (trimmed.startsWith('Sheet:')) {
          currentMutation.targetSheet = trimmed.replace('Sheet:', '').trim();
        } else if (trimmed.startsWith('Row:')) {
          currentMutation.targetRow = parseInt(trimmed.replace('Row:', '').trim(), 10);
        } else if (trimmed.startsWith('Column:')) {
          currentMutation.targetColumn = trimmed.replace('Column:', '').trim();
        } else if (trimmed.startsWith('Current:')) {
          currentMutation.currentValue = trimmed.replace('Current:', '').trim();
        } else if (trimmed.startsWith('Proposed:') || trimmed.startsWith('New:')) {
          currentMutation.proposedValue = trimmed.replace(/^(Proposed|New):/, '').trim();
        } else if (trimmed.startsWith('Reason:') || trimmed.startsWith('Justification:')) {
          currentMutation.justification = trimmed.replace(/^(Reason|Justification):/, '').trim();
        }
      }
    }

    if (currentMutation && currentMutation.targetSheet) {
      mutations.push(currentMutation);
    }
  }

  return mutations;
}

/**
 * Save analysis outcome.
 *
 * @param {Object} results - Analysis results
 * @param {Object} template - Template object (can be null if failed early)
 * @param {Object} inputData - Input data
 * @param {string} confidenceLevel - Confidence level
 * @param {string} confidenceUuid - Confidence UUID
 */
function saveCoPilotOutcome_(results, template, inputData, confidenceLevel, confidenceUuid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.OUTCOMES);

  if (!sheet) {
    setupCoPilotSheets();
    sheet = ss.getSheetByName(COPILOT_CONFIG.SHEETS.OUTCOMES);
  }

  const timestamp = new Date().toISOString();

  const rowData = {
    'Outcome_ID': 'OUT_' + Utilities.getUuid().substring(0, 8).toUpperCase(),
    'Template_ID': results.templateId || '',
    'Template_Name': template ? template.Name : '',
    'Analysis_ID': results.analysisId,
    'Input_Data': JSON.stringify(inputData || {}),
    'AI_Response': results.aiResponse || '',
    'Mutations_Generated': results.mutations ? results.mutations.length : 0,
    'Mutations_Applied': results.mutationsApplied || 0,
    'Mutations_Rejected': results.mutationsRejected || 0,
    'Confidence_Level': confidenceLevel || '',
    'Confidence_UUID': confidenceUuid || '',
    'Duration_MS': results.duration || 0,
    'Status': results.success ? 'COMPLETED' : 'FAILED',
    'Error_Message': results.error || '',
    'Created_At': timestamp,
    'Completed_At': results.success ? timestamp : ''
  };

  coPilotAppendObject_(sheet, 'OUTCOMES', rowData);
}


// ==========================
// REVIEW UI
// ==========================

/**
 * Generate HTML for a mutation card.
 *
 * @param {Object} mutation - Mutation object
 * @returns {string} - HTML string
 */
function getCoPilotMutationCardHTML_(mutation) {
  const escapeHtml = (text) => {
    if (!text) return '';
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const statusClass = mutation.Status === 'PENDING_REVIEW' ? 'pending' :
                      mutation.Status === 'APPROVED' ? 'approved' :
                      mutation.Status === 'REJECTED' ? 'rejected' : 'other';

  return `
    <div class="mutation-card ${statusClass}">
      <div class="mutation-header">
        <span class="mutation-id">${escapeHtml(mutation.Mutation_ID)}</span>
        <span class="mutation-status badge-${statusClass}">${escapeHtml(mutation.Status)}</span>
      </div>
      <div class="mutation-body">
        <div class="mutation-field">
          <label>Target:</label>
          <span>${escapeHtml(mutation.Target_Sheet)} [Row ${escapeHtml(mutation.Target_Row)}, Col ${escapeHtml(mutation.Target_Column)}]</span>
        </div>
        <div class="mutation-field">
          <label>Current Value:</label>
          <span class="value-current">${escapeHtml(mutation.Current_Value) || '(empty)'}</span>
        </div>
        <div class="mutation-field">
          <label>Proposed Value:</label>
          <span class="value-proposed">${escapeHtml(mutation.Proposed_Value) || '(empty)'}</span>
        </div>
        <div class="mutation-field">
          <label>Confidence:</label>
          <span class="confidence-${escapeHtml(mutation.Confidence_Level)}">${escapeHtml(mutation.Confidence_Level)}</span>
        </div>
        <div class="mutation-field">
          <label>Justification:</label>
          <span>${escapeHtml(mutation.Justification) || 'No justification provided'}</span>
        </div>
      </div>
      <div class="mutation-actions">
        <button class="btn-approve" onclick="approveMutation('${escapeHtml(mutation.Mutation_ID)}')">
          Approve & Apply
        </button>
        <button class="btn-reject" onclick="promptReject('${escapeHtml(mutation.Mutation_ID)}')">
          Reject
        </button>
      </div>
    </div>
  `;
}

/**
 * Show review approval dialog for pending mutations.
 */
function showCoPilotReviewDialog() {
  const pendingMutations = getPendingCoPilotMutations_();

  if (pendingMutations.length === 0) {
    if (_inUi()) {
      SpreadsheetApp.getUi().alert('No pending mutations to review.');
    }
    return;
  }

  const mutationCards = pendingMutations.map(m => getCoPilotMutationCardHTML_(m)).join('\n');

  const html = HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <style>
        body { font-family: Arial, sans-serif; padding: 16px; }
        .mutation-card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .mutation-card.pending { border-left: 4px solid #ffc107; }
        .mutation-card.approved { border-left: 4px solid #28a745; }
        .mutation-card.rejected { border-left: 4px solid #dc3545; }
        .mutation-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
        .mutation-id { font-weight: bold; font-family: monospace; }
        .mutation-status { padding: 2px 8px; border-radius: 4px; font-size: 12px; }
        .badge-pending { background: #ffc107; color: #000; }
        .badge-approved { background: #28a745; color: #fff; }
        .badge-rejected { background: #dc3545; color: #fff; }
        .mutation-field { margin-bottom: 8px; }
        .mutation-field label { font-weight: bold; display: inline-block; width: 120px; }
        .value-current { color: #666; text-decoration: line-through; }
        .value-proposed { color: #007bff; font-weight: bold; }
        .confidence-KNOWN_KNOWN { color: #28a745; }
        .confidence-KNOWN_UNKNOWN { color: #ffc107; }
        .confidence-UNKNOWN_UNKNOWN { color: #dc3545; }
        .mutation-actions { margin-top: 12px; display: flex; gap: 8px; }
        .btn-approve { background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .btn-reject { background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .btn-approve:hover { background: #218838; }
        .btn-reject:hover { background: #c82333; }
        h2 { margin-top: 0; }
        .summary { background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 16px; }
      </style>
    </head>
    <body>
      <h2>Pending Mutations Review</h2>
      <div class="summary">
        <strong>${pendingMutations.length}</strong> mutation(s) awaiting review
      </div>
      ${mutationCards}
      <script>
        function approveMutation(mutationId) {
          google.script.run
            .withSuccessHandler(function(result) {
              alert('Mutation approved and applied: ' + mutationId);
              google.script.host.close();
            })
            .withFailureHandler(function(error) {
              alert('Error: ' + error.message);
            })
            .approveCoPilotMutation(mutationId, true);
        }

        function promptReject(mutationId) {
          var reason = prompt('Enter rejection reason:');
          if (reason !== null) {
            google.script.run
              .withSuccessHandler(function(result) {
                alert('Mutation rejected: ' + mutationId);
                google.script.host.close();
              })
              .withFailureHandler(function(error) {
                alert('Error: ' + error.message);
              })
              .rejectCoPilotMutation(mutationId, reason);
          }
        }
      </script>
    </body>
    </html>
  `)
  .setWidth(600)
  .setHeight(600);

  SpreadsheetApp.getUi().showModalDialog(html, 'Review Pending Mutations');
}


// ==========================
// UI FUNCTIONS
// ==========================

/**
 * Setup Co-Pilot from UI menu.
 */
function setupCoPilotFromUI() {
  setupCoPilotSheets();
}

/**
 * Create template from UI prompt.
 */
function createCoPilotTemplateFromUI() {
  const ui = SpreadsheetApp.getUi();

  const nameResponse = ui.prompt('Create Template', 'Enter template name:', ui.ButtonSet.OK_CANCEL);
  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;

  const descResponse = ui.prompt('Create Template', 'Enter description:', ui.ButtonSet.OK_CANCEL);
  if (descResponse.getSelectedButton() !== ui.Button.OK) return;

  const typeResponse = ui.prompt('Create Template',
    'Enter analysis type (GAP_ANALYSIS, COMPLIANCE_CHECK, RISK_ASSESSMENT, DOCUMENT_REVIEW, DATA_QUALITY, CUSTOM):',
    ui.ButtonSet.OK_CANCEL);
  if (typeResponse.getSelectedButton() !== ui.Button.OK) return;

  const promptResponse = ui.prompt('Create Template',
    'Enter prompt template (use {{variable}} for placeholders):',
    ui.ButtonSet.OK_CANCEL);
  if (promptResponse.getSelectedButton() !== ui.Button.OK) return;

  try {
    const result = createCoPilotTemplate({
      name: nameResponse.getResponseText(),
      description: descResponse.getResponseText(),
      analysisType: typeResponse.getResponseText() || 'CUSTOM',
      promptTemplate: promptResponse.getResponseText(),
      autoApplyRules: COPILOT_CONFIG.AUTO_APPLY_RULES.NEVER
    });

    ui.alert('Template Created', `Template "${result.name}" created with ID: ${result.templateId}`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Run analysis from UI.
 */
function runCoPilotAnalysisFromUI() {
  const ui = SpreadsheetApp.getUi();

  const templates = listCoPilotTemplates();
  if (templates.length === 0) {
    ui.alert('No Templates', 'Please create a template first using "Create Template".', ui.ButtonSet.OK);
    return;
  }

  const templateList = templates.map(t => `${t.Template_ID}: ${t.Name}`).join('\n');
  const templateResponse = ui.prompt('Run Analysis',
    `Enter template ID:\n\n${templateList}`,
    ui.ButtonSet.OK_CANCEL);
  if (templateResponse.getSelectedButton() !== ui.Button.OK) return;

  const inputResponse = ui.prompt('Run Analysis',
    'Enter input data as JSON (e.g., {"subject": "test"}):',
    ui.ButtonSet.OK_CANCEL);
  if (inputResponse.getSelectedButton() !== ui.Button.OK) return;

  try {
    let inputData = {};
    if (inputResponse.getResponseText().trim()) {
      inputData = JSON.parse(inputResponse.getResponseText());
    }

    ui.alert('Starting Analysis', 'Analysis is running. This may take a moment...', ui.ButtonSet.OK);

    const result = runCoPilotAnalysis(
      templateResponse.getResponseText().trim(),
      inputData,
      {}
    );

    ui.alert('Analysis Complete',
      `Analysis ${result.analysisId} completed.\n\n` +
      `Mutations generated: ${result.mutations.length}\n` +
      `Mutations auto-applied: ${result.mutationsApplied}\n` +
      `Duration: ${result.duration}ms`,
      ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Analysis Failed', e.message, ui.ButtonSet.OK);
  }
}

/**
 * View pending mutations from UI.
 */
function viewPendingCoPilotMutationsFromUI() {
  showCoPilotReviewDialog();
}

/**
 * View Co-Pilot sheets.
 */
function viewCoPilotTemplates() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COPILOT_CONFIG.SHEETS.TEMPLATES);
  if (sheet) {
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('Templates sheet not found. Run Setup first.');
  }
}

function viewCoPilotMutations() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COPILOT_CONFIG.SHEETS.MUTATIONS);
  if (sheet) {
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('Mutations sheet not found. Run Setup first.');
  }
}

function viewCoPilotOutcomes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COPILOT_CONFIG.SHEETS.OUTCOMES);
  if (sheet) {
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('Outcomes sheet not found. Run Setup first.');
  }
}


// ==========================
// MENU INTEGRATION
// ==========================

/**
 * Add Co-Pilot menu to spreadsheet.
 * Called from onOpen() in Code.gs
 */
function addCoPilotMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Co-Pilot')
    .addItem('Setup Co-Pilot Sheets', 'setupCoPilotFromUI')
    .addSeparator()
    .addItem('Create Template', 'createCoPilotTemplateFromUI')
    .addItem('Run Analysis', 'runCoPilotAnalysisFromUI')
    .addSeparator()
    .addItem('Review Pending Mutations', 'viewPendingCoPilotMutationsFromUI')
    .addSeparator()
    .addItem('View Templates', 'viewCoPilotTemplates')
    .addItem('View Mutations', 'viewCoPilotMutations')
    .addItem('View Outcomes', 'viewCoPilotOutcomes')
    .addToUi();
}
