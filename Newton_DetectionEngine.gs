/**
 * Newton_DetectionEngine.gs - AI Gap Detection Core
 *
 * PURPOSE:
 *   The brain of Newton. Scans workflows for:
 *   1. Missing required documents (workflow-level)
 *   2. Incomplete evidence on completed/in-progress steps
 *
 *   This is NOT a UI file. This is pure detection logic.
 *
 * AUTHOR: George Abrahamyan - Newton AI Governance Platform
 * VERSION: 1.0.0
 */

// ============================================================================
// DOCUMENT REQUIREMENTS REGISTRY
// ============================================================================
// Define what documents each workflow TEMPLATE requires.
// This is the "contract" - if a workflow is this type, these docs MUST exist.

const WORKFLOW_REQUIREMENTS = {
  'year_end_audit': {
    name: 'Year-End Audit',
    requiredDocuments: [
      { docType: 'TRIAL_BALANCE', description: 'Trial Balance Report' },
      { docType: 'BANK_RECONCILIATION', description: 'Bank Reconciliation Statement' },
      { docType: 'GL_DETAIL', description: 'General Ledger Detail' },
      { docType: 'AR_AGING', description: 'Accounts Receivable Aging' },
      { docType: 'AP_AGING', description: 'Accounts Payable Aging' },
      { docType: 'FIXED_ASSETS', description: 'Fixed Assets Schedule' },
      { docType: 'DEPRECIATION', description: 'Depreciation Schedule' },
      { docType: 'PAYROLL_SUMMARY', description: 'Payroll Summary Report' },
      { docType: 'TAX_RETURNS', description: 'Prior Year Tax Returns' },
      { docType: 'INVENTORY', description: 'Inventory Valuation Report' }
    ]
  },

  'monthly_close': {
    name: 'Monthly Close',
    requiredDocuments: [
      { docType: 'TRIAL_BALANCE', description: 'Trial Balance' },
      { docType: 'BANK_RECONCILIATION', description: 'Bank Reconciliation' },
      { docType: 'JOURNAL_ENTRIES', description: 'Adjusting Journal Entries' },
      { docType: 'VARIANCE_ANALYSIS', description: 'Budget vs Actual Variance' }
    ]
  },

  'vendor_onboarding': {
    name: 'Vendor Onboarding',
    requiredDocuments: [
      { docType: 'W9', description: 'W-9 Form' },
      { docType: 'VENDOR_APPLICATION', description: 'Vendor Application' },
      { docType: 'INSURANCE_CERT', description: 'Certificate of Insurance' },
      { docType: 'BANK_INFO', description: 'Banking Information / ACH Form' }
    ]
  },

  'expense_report': {
    name: 'Expense Report',
    requiredDocuments: [
      { docType: 'RECEIPTS', description: 'All Receipts' },
      { docType: 'EXPENSE_FORM', description: 'Expense Report Form' },
      { docType: 'APPROVAL', description: 'Manager Approval' }
    ]
  },

  'tax_filing': {
    name: 'Tax Filing',
    requiredDocuments: [
      { docType: 'PRIOR_RETURNS', description: 'Prior Year Returns' },
      { docType: 'INCOME_STATEMENTS', description: 'Income Statements' },
      { docType: 'DEDUCTION_SUPPORT', description: 'Deduction Supporting Docs' },
      { docType: 'K1_FORMS', description: 'K-1 Forms (if applicable)' },
      { docType: '1099_FORMS', description: '1099 Forms Received' }
    ]
  },

  'client_onboarding': {
    name: 'Client Onboarding',
    requiredDocuments: [
      { docType: 'ENGAGEMENT_LETTER', description: 'Signed Engagement Letter' },
      { docType: 'ID_VERIFICATION', description: 'ID Verification' },
      { docType: 'PRIOR_FINANCIALS', description: 'Prior Period Financials' },
      { docType: 'ENTITY_DOCS', description: 'Entity Formation Documents' }
    ]
  },

  // Generic fallback
  'generic': {
    name: 'Generic Workflow',
    requiredDocuments: []
  }
};


// ============================================================================
// STEP EVIDENCE REQUIREMENTS
// ============================================================================
// Steps with these keywords REQUIRE evidence to be marked complete.

const EVIDENCE_REQUIRED_KEYWORDS = [
  'verify', 'confirm', 'reconcile', 'review', 'approve', 'sign',
  'obtain', 'collect', 'upload', 'attach', 'document', 'submit',
  'validate', 'check', 'audit', 'inspect', 'certify'
];

// Steps that are EXEMPT from evidence requirements (pure process steps)
const EVIDENCE_EXEMPT_KEYWORDS = [
  'schedule', 'notify', 'send email', 'call', 'meet', 'discuss',
  'plan', 'assign', 'delegate', 'begin', 'start', 'initiate'
];


// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Scans all active workflows and returns detected gaps.
 * @returns {Object} Detection results with alerts
 */
function runDetectionScan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const instanceSheet = ss.getSheetByName('Workflow_Instances');
  const stepsSheet = ss.getSheetByName('Workflow_Steps');
  const docsSheet = ss.getSheetByName('Workflow_Documents');

  const results = {
    scanTimestamp: new Date().toISOString(),
    totalWorkflowsScanned: 0,
    totalAlertsGenerated: 0,
    alerts: [],
    summary: {
      missingDocuments: 0,
      incompleteEvidence: 0,
      criticalAlerts: 0,
      warningAlerts: 0
    }
  };

  if (!instanceSheet || !stepsSheet) {
    results.error = 'Required sheets not found';
    return results;
  }

  // Load all data
  const workflows = getSheetAsObjects_(instanceSheet);
  const steps = getSheetAsObjects_(stepsSheet);
  const documents = docsSheet ? getSheetAsObjects_(docsSheet) : [];

  // Filter to active workflows only
  const activeWorkflows = workflows.filter(w =>
    w.status === 'ACTIVE' || w.status === 'IN_PROGRESS' || !w.status
  );

  results.totalWorkflowsScanned = activeWorkflows.length;

  // Scan each workflow
  activeWorkflows.forEach(workflow => {
    const workflowSteps = steps.filter(s => s.workflowId === workflow.workflowId);
    const workflowDocs = documents.filter(d => d.workflowId === workflow.workflowId);

    // Detection 1: Missing Required Documents
    const missingDocs = detectMissingDocuments_(workflow, workflowDocs);
    missingDocs.forEach(alert => {
      results.alerts.push(alert);
      results.summary.missingDocuments++;
      if (alert.severity === 'CRITICAL') results.summary.criticalAlerts++;
      else results.summary.warningAlerts++;
    });

    // Detection 2: Incomplete Evidence on Steps
    const incompleteEvidence = detectIncompleteEvidence_(workflow, workflowSteps);
    incompleteEvidence.forEach(alert => {
      results.alerts.push(alert);
      results.summary.incompleteEvidence++;
      if (alert.severity === 'CRITICAL') results.summary.criticalAlerts++;
      else results.summary.warningAlerts++;
    });
  });

  results.totalAlertsGenerated = results.alerts.length;

  // Sort alerts: Critical first, then by workflow
  results.alerts.sort((a, b) => {
    if (a.severity === 'CRITICAL' && b.severity !== 'CRITICAL') return -1;
    if (b.severity === 'CRITICAL' && a.severity !== 'CRITICAL') return 1;
    return a.clientName.localeCompare(b.clientName);
  });

  // Log scan to audit ledger
  logDetectionScan_(results);

  return results;
}


// ============================================================================
// DETECTION: MISSING DOCUMENTS
// ============================================================================

function detectMissingDocuments_(workflow, workflowDocs) {
  const alerts = [];

  // Get template requirements
  const templateKey = normalizeTemplateKey_(workflow.templateName || workflow.templateId);
  const requirements = WORKFLOW_REQUIREMENTS[templateKey] || WORKFLOW_REQUIREMENTS['generic'];

  if (requirements.requiredDocuments.length === 0) {
    return alerts; // No requirements for this type
  }

  // Get uploaded doc types
  const uploadedDocTypes = workflowDocs.map(d => (d.docType || '').toUpperCase());

  // Check each required doc
  requirements.requiredDocuments.forEach(req => {
    const isPresent = uploadedDocTypes.includes(req.docType.toUpperCase());

    if (!isPresent) {
      alerts.push({
        alertId: Utilities.getUuid(),
        alertType: 'MISSING_DOCUMENT',
        severity: 'CRITICAL',
        workflowId: workflow.workflowId,
        clientName: workflow.clientName || 'Unknown',
        templateName: workflow.templateName || templateKey,
        title: 'Missing Required Document',
        description: `"${req.description}" is required but not uploaded.`,
        missingDocType: req.docType,
        missingDocDescription: req.description,
        actionRequired: `Upload ${req.description}`,
        detectedAt: new Date().toISOString()
      });
    }
  });

  return alerts;
}


// ============================================================================
// DETECTION: INCOMPLETE EVIDENCE
// ============================================================================

function detectIncompleteEvidence_(workflow, workflowSteps) {
  const alerts = [];

  workflowSteps.forEach(step => {
    // Only check COMPLETED or IN_PROGRESS steps
    if (step.status !== 'COMPLETED' && step.status !== 'IN_PROGRESS') {
      return;
    }

    // Check if this step requires evidence
    const requiresEvidence = stepRequiresEvidence_(step);

    if (!requiresEvidence) {
      return; // This step is exempt
    }

    // Check if evidence exists
    const hasEvidence = stepHasEvidence_(step);

    if (!hasEvidence) {
      const severity = step.status === 'COMPLETED' ? 'CRITICAL' : 'WARNING';

      alerts.push({
        alertId: Utilities.getUuid(),
        alertType: 'INCOMPLETE_EVIDENCE',
        severity: severity,
        workflowId: workflow.workflowId,
        clientName: workflow.clientName || 'Unknown',
        templateName: workflow.templateName || '',
        stepId: step.stepId,
        stepNumber: step.stepNumber,
        stepTitle: step.title,
        title: step.status === 'COMPLETED'
          ? 'Completed Step Missing Evidence'
          : 'In-Progress Step Needs Evidence',
        description: step.status === 'COMPLETED'
          ? `Step "${step.title}" is marked COMPLETED but has no supporting document or notes.`
          : `Step "${step.title}" is IN PROGRESS but has no evidence attached yet.`,
        actionRequired: 'Attach supporting document or add detailed notes',
        detectedAt: new Date().toISOString()
      });
    }
  });

  return alerts;
}


/**
 * Determines if a step requires evidence based on its title/description.
 */
function stepRequiresEvidence_(step) {
  const text = ((step.title || '') + ' ' + (step.description || '')).toLowerCase();

  // Check if exempt
  for (const exempt of EVIDENCE_EXEMPT_KEYWORDS) {
    if (text.includes(exempt)) {
      return false;
    }
  }

  // Check if requires evidence
  for (const keyword of EVIDENCE_REQUIRED_KEYWORDS) {
    if (text.includes(keyword)) {
      return true;
    }
  }

  // Default: If step is COMPLETED, it probably should have evidence
  // This is a conservative approach - catch more, not less
  return step.status === 'COMPLETED';
}


/**
 * Checks if a step has any form of evidence attached.
 */
function stepHasEvidence_(step) {
  // Has document links?
  if (step.documentLinks && step.documentLinks.trim().length > 0) {
    return true;
  }

  // Has substantive notes? (more than 20 chars, not just "done" or "completed")
  if (step.notes && step.notes.trim().length > 20) {
    const notesLower = step.notes.toLowerCase().trim();
    const trivialNotes = ['done', 'completed', 'finished', 'ok', 'yes', 'n/a', 'na'];
    if (!trivialNotes.includes(notesLower)) {
      return true;
    }
  }

  return false;
}


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getSheetAsObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const objects = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = row[idx];
    });
    if (Object.keys(obj).some(k => obj[k])) { // Skip empty rows
      objects.push(obj);
    }
  }

  return objects;
}


function normalizeTemplateKey_(templateName) {
  if (!templateName) return 'generic';

  const name = templateName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  // Map common variations
  const mappings = {
    'year_end_audit': ['year_end', 'yearend', 'annual_audit', 'audit'],
    'monthly_close': ['month_end', 'monthend', 'monthly', 'month_close'],
    'vendor_onboarding': ['vendor', 'new_vendor', 'supplier'],
    'expense_report': ['expense', 'expenses', 'reimbursement'],
    'tax_filing': ['tax', 'taxes', '1040', '1120', 'tax_return'],
    'client_onboarding': ['client', 'new_client', 'onboarding', 'engagement']
  };

  for (const [key, variations] of Object.entries(mappings)) {
    if (variations.some(v => name.includes(v))) {
      return key;
    }
  }

  return name;
}


function logDetectionScan_(results) {
  if (typeof safeNewEntry === 'function') {
    safeNewEntry(
      'System',
      'DETECTION_SCAN',
      `Scanned ${results.totalWorkflowsScanned} workflows. Found ${results.totalAlertsGenerated} alerts (${results.summary.criticalAlerts} critical).`,
      'SYSTEM',
      'FINAL'
    );
  }
}


// ============================================================================
// PUBLIC API FUNCTIONS (called from Dashboard/UI)
// ============================================================================

/**
 * Get all current alerts for display.
 */
function getDetectionAlerts() {
  return runDetectionScan();
}


/**
 * Get alerts for a specific workflow.
 */
function getWorkflowAlerts(workflowId) {
  const allResults = runDetectionScan();
  return {
    ...allResults,
    alerts: allResults.alerts.filter(a => a.workflowId === workflowId)
  };
}


/**
 * Get summary counts for dashboard widgets.
 */
function getAlertSummary() {
  const results = runDetectionScan();
  return {
    total: results.totalAlertsGenerated,
    critical: results.summary.criticalAlerts,
    warnings: results.summary.warningAlerts,
    missingDocs: results.summary.missingDocuments,
    incompleteEvidence: results.summary.incompleteEvidence,
    lastScan: results.scanTimestamp
  };
}


/**
 * Dismiss an alert (mark as acknowledged).
 * Stores in a separate sheet so it doesn't re-trigger.
 */
function dismissAlert(alertId, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dismissedSheet = ss.getSheetByName('Dismissed_Alerts');

  if (!dismissedSheet) {
    dismissedSheet = ss.insertSheet('Dismissed_Alerts');
    dismissedSheet.appendRow(['alertId', 'dismissedAt', 'dismissedBy', 'reason']);
  }

  dismissedSheet.appendRow([
    alertId,
    new Date(),
    Session.getActiveUser().getEmail() || 'User',
    reason || ''
  ]);

  return { success: true };
}


/**
 * Add custom document requirements for a workflow template.
 */
function addDocumentRequirement(templateKey, docType, description) {
  // This would normally write to a sheet for persistence
  // For now, it's in-memory only
  if (!WORKFLOW_REQUIREMENTS[templateKey]) {
    WORKFLOW_REQUIREMENTS[templateKey] = {
      name: templateKey,
      requiredDocuments: []
    };
  }

  WORKFLOW_REQUIREMENTS[templateKey].requiredDocuments.push({
    docType: docType.toUpperCase(),
    description: description
  });

  return { success: true };
}


// ============================================================================
// SCHEDULED TRIGGER FUNCTION
// ============================================================================

/**
 * Run this on a schedule (daily/hourly) to generate alerts.
 * Can be set up via Apps Script Triggers.
 */
function scheduledDetectionScan() {
  const results = runDetectionScan();

  // If critical alerts found, could send email notification
  if (results.summary.criticalAlerts > 0) {
    // sendAlertNotification_(results); // Implement if needed
    Logger.log(`CRITICAL: ${results.summary.criticalAlerts} critical alerts detected`);
  }

  return results;
}


// ============================================================================
// SETUP FUNCTION - Creates Required Sheets
// ============================================================================

/**
 * Sets up the Workflow_Documents sheet for tracking uploaded documents.
 * Run this once to initialize the detection system.
 */
function setupDetectionEngine() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Create Workflow_Documents sheet if it doesn't exist
  let docsSheet = ss.getSheetByName('Workflow_Documents');
  if (!docsSheet) {
    docsSheet = ss.insertSheet('Workflow_Documents');
    docsSheet.appendRow([
      'docId',
      'workflowId',
      'docType',
      'fileName',
      'fileUrl',
      'uploadedBy',
      'uploadedAt',
      'notes'
    ]);

    // Format header
    const headerRange = docsSheet.getRange(1, 1, 1, 8);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#2d3748');
    headerRange.setFontColor('#ffffff');

    Logger.log('Created Workflow_Documents sheet');
  }

  // Ensure Workflow_Instances has required columns
  let instancesSheet = ss.getSheetByName('Workflow_Instances');
  if (!instancesSheet) {
    instancesSheet = ss.insertSheet('Workflow_Instances');
    instancesSheet.appendRow([
      'workflowId',
      'templateName',
      'templateId',
      'clientName',
      'status',
      'startDate',
      'dueDate',
      'createdBy',
      'createdAt'
    ]);

    const headerRange = instancesSheet.getRange(1, 1, 1, 9);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#2d3748');
    headerRange.setFontColor('#ffffff');

    Logger.log('Created Workflow_Instances sheet');
  }

  // Ensure Workflow_Steps has required columns including documentLinks and notes
  let stepsSheet = ss.getSheetByName('Workflow_Steps');
  if (!stepsSheet) {
    stepsSheet = ss.insertSheet('Workflow_Steps');
    stepsSheet.appendRow([
      'stepId',
      'workflowId',
      'stepNumber',
      'title',
      'description',
      'category',
      'status',
      'assignee',
      'dueDate',
      'completedDate',
      'notes',
      'documentLinks'
    ]);

    const headerRange = stepsSheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#2d3748');
    headerRange.setFontColor('#ffffff');

    Logger.log('Created Workflow_Steps sheet');
  }

  // Create Dismissed_Alerts sheet for tracking acknowledged alerts
  let dismissedSheet = ss.getSheetByName('Dismissed_Alerts');
  if (!dismissedSheet) {
    dismissedSheet = ss.insertSheet('Dismissed_Alerts');
    dismissedSheet.appendRow([
      'alertId',
      'dismissedAt',
      'dismissedBy',
      'reason'
    ]);

    const headerRange = dismissedSheet.getRange(1, 1, 1, 4);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#2d3748');
    headerRange.setFontColor('#ffffff');

    Logger.log('Created Dismissed_Alerts sheet');
  }

  return {
    success: true,
    message: 'Detection Engine setup complete. Sheets created/verified.'
  };
}


/**
 * Upload a document to a workflow (creates entry in Workflow_Documents)
 */
function uploadWorkflowDocument(workflowId, docType, fileName, fileUrl, notes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let docsSheet = ss.getSheetByName('Workflow_Documents');

  if (!docsSheet) {
    setupDetectionEngine();
    docsSheet = ss.getSheetByName('Workflow_Documents');
  }

  const docId = Utilities.getUuid();

  docsSheet.appendRow([
    docId,
    workflowId,
    docType.toUpperCase(),
    fileName,
    fileUrl,
    Session.getActiveUser().getEmail() || 'User',
    new Date(),
    notes || ''
  ]);

  // Log to audit ledger
  if (typeof safeNewEntry === 'function') {
    safeNewEntry(
      Session.getActiveUser().getEmail() || 'User',
      'DOCUMENT_UPLOADED',
      `Uploaded ${docType}: ${fileName}`,
      workflowId,
      'FINAL'
    );
  }

  return { success: true, docId: docId };
}


/**
 * Get all documents for a workflow
 */
function getWorkflowDocuments(workflowId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const docsSheet = ss.getSheetByName('Workflow_Documents');

  if (!docsSheet || docsSheet.getLastRow() < 2) {
    return [];
  }

  const data = docsSheet.getDataRange().getValues();
  const headers = data[0];
  const docs = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);

    if (obj.workflowId === workflowId) {
      docs.push(obj);
    }
  }

  return docs;
}


/**
 * Get required documents for a workflow template
 */
function getRequiredDocuments(templateName) {
  const templateKey = normalizeTemplateKey_(templateName);
  const requirements = WORKFLOW_REQUIREMENTS[templateKey] || WORKFLOW_REQUIREMENTS['generic'];
  return requirements.requiredDocuments || [];
}


// ============================================================================
// DEMO / TEST DATA SEEDER
// ============================================================================

/**
 * Seeds sample data to demonstrate the detection engine.
 * Run this to see alerts in action on the dashboard.
 */
function seedDemoData() {
  // First ensure sheets exist
  setupDetectionEngine();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const instancesSheet = ss.getSheetByName('Workflow_Instances');
  const stepsSheet = ss.getSheetByName('Workflow_Steps');
  const docsSheet = ss.getSheetByName('Workflow_Documents');

  // Clear existing demo data (optional - comment out to accumulate)
  // clearDemoData_();

  const demoWorkflowId = 'DEMO-' + Utilities.getUuid().substring(0, 8);

  // ========== CREATE WORKFLOW INSTANCE ==========
  instancesSheet.appendRow([
    demoWorkflowId,
    'Year-End Audit',          // templateName - triggers 10 required docs
    'year_end_audit',          // templateId
    'Acme Corporation',        // clientName
    'ACTIVE',                  // status
    new Date(),                // startDate
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // dueDate (14 days)
    'demo@newton.ai',          // createdBy
    new Date()                 // createdAt
  ]);

  // ========== CREATE STEPS (some with gaps) ==========
  const steps = [
    {
      num: 1,
      title: 'Obtain prior year financials',
      desc: 'Request and review prior year audited financial statements',
      category: 'PLANNING',
      status: 'COMPLETED',
      notes: 'Received from client 1/15',  // Has notes = OK
      docs: ''
    },
    {
      num: 2,
      title: 'Verify bank reconciliation',
      desc: 'Reconcile bank statements to general ledger',
      category: 'TESTING',
      status: 'COMPLETED',       // COMPLETED but...
      notes: '',                 // No notes
      docs: ''                   // No docs = ALERT!
    },
    {
      num: 3,
      title: 'Review accounts receivable aging',
      desc: 'Analyze AR aging report and confirm balances',
      category: 'TESTING',
      status: 'COMPLETED',
      notes: 'done',             // Trivial note = still flagged
      docs: ''                   // No docs = ALERT!
    },
    {
      num: 4,
      title: 'Confirm fixed asset additions',
      desc: 'Verify all fixed asset additions with supporting invoices',
      category: 'TESTING',
      status: 'IN_PROGRESS',     // In progress...
      notes: '',                 // No evidence yet = WARNING
      docs: ''
    },
    {
      num: 5,
      title: 'Schedule client meeting',
      desc: 'Set up closing meeting with CFO',
      category: 'ADMIN',
      status: 'COMPLETED',       // Exempt - "schedule" keyword
      notes: '',
      docs: ''
    },
    {
      num: 6,
      title: 'Analyze payroll expenses',
      desc: 'Review payroll register and verify calculations',
      category: 'TESTING',
      status: 'PENDING',         // Not started - no alert
      notes: '',
      docs: ''
    }
  ];

  steps.forEach(step => {
    stepsSheet.appendRow([
      'STEP-' + Utilities.getUuid().substring(0, 8),
      demoWorkflowId,
      step.num,
      step.title,
      step.desc,
      step.category,
      step.status,
      '',                        // assignee
      '',                        // dueDate
      step.status === 'COMPLETED' ? new Date() : '',
      step.notes,
      step.docs
    ]);
  });

  // ========== ADD SOME DOCUMENTS (but not all required) ==========
  // Only upload 3 of the 10 required docs = 7 MISSING_DOCUMENT alerts
  docsSheet.appendRow([
    'DOC-' + Utilities.getUuid().substring(0, 8),
    demoWorkflowId,
    'TRIAL_BALANCE',
    'Acme_TrialBalance_2025.xlsx',
    'https://drive.google.com/file/d/xxx',
    'demo@newton.ai',
    new Date(),
    'Year-end trial balance'
  ]);

  docsSheet.appendRow([
    'DOC-' + Utilities.getUuid().substring(0, 8),
    demoWorkflowId,
    'BANK_RECONCILIATION',
    'Acme_BankRec_Dec2025.pdf',
    'https://drive.google.com/file/d/yyy',
    'demo@newton.ai',
    new Date(),
    'December bank reconciliation'
  ]);

  docsSheet.appendRow([
    'DOC-' + Utilities.getUuid().substring(0, 8),
    demoWorkflowId,
    'GL_DETAIL',
    'Acme_GL_Detail_2025.xlsx',
    'https://drive.google.com/file/d/zzz',
    'demo@newton.ai',
    new Date(),
    'General ledger detail report'
  ]);

  // ========== RUN DETECTION AND REPORT ==========
  const results = runDetectionScan();

  Logger.log('='.repeat(50));
  Logger.log('DEMO DATA SEEDED');
  Logger.log('='.repeat(50));
  Logger.log('Workflow ID: ' + demoWorkflowId);
  Logger.log('Client: Acme Corporation');
  Logger.log('Template: Year-End Audit');
  Logger.log('');
  Logger.log('EXPECTED ALERTS:');
  Logger.log('- 7 Missing Documents (10 required, 3 uploaded)');
  Logger.log('- 3 Incomplete Evidence (steps 2, 3, 4)');
  Logger.log('');
  Logger.log('ACTUAL RESULTS:');
  Logger.log('- Total Alerts: ' + results.totalAlertsGenerated);
  Logger.log('- Critical: ' + results.summary.criticalAlerts);
  Logger.log('- Warnings: ' + results.summary.warningAlerts);
  Logger.log('- Missing Docs: ' + results.summary.missingDocuments);
  Logger.log('- Incomplete Evidence: ' + results.summary.incompleteEvidence);
  Logger.log('');
  Logger.log('Open the Dashboard to see these alerts visualized.');
  Logger.log('='.repeat(50));

  return {
    workflowId: demoWorkflowId,
    results: results
  };
}
