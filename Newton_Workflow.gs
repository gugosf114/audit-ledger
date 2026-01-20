/**
 * Newton_Workflow.gs - Workflow Engine for Newton Ledger
 *
 * PURPOSE: Multi-step workflow management with dependency tracking,
 * audit logging, and gap analysis.
 *
 * SHEETS REQUIRED:
 * - Workflow_Templates: Stores workflow template definitions
 * - Workflow_Instances: Tracks active workflow instances
 * - Audit_Ledger: All actions logged here for immutability
 *
 * AUTHOR: Newton AI Governance Platform
 * VERSION: 1.0.0
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const WORKFLOW_TEMPLATES_SHEET = 'Workflow_Templates';
const WORKFLOW_INSTANCES_SHEET = 'Workflow_Instances';
const AUDIT_LEDGER_SHEET = 'Audit_Ledger';

// Step statuses
const STEP_STATUS = {
  PENDING: 'PENDING',
  BLOCKED: 'BLOCKED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED'
};

// Workflow statuses
const WORKFLOW_STATUS = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ON_HOLD: 'ON_HOLD'
};

// ============================================================================
// SHEET INITIALIZATION
// ============================================================================

/**
 * Initialize workflow sheets if they don't exist
 */
function initWorkflowSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Create Workflow_Templates sheet
  let templatesSheet = ss.getSheetByName(WORKFLOW_TEMPLATES_SHEET);
  if (!templatesSheet) {
    templatesSheet = ss.insertSheet(WORKFLOW_TEMPLATES_SHEET);
    templatesSheet.appendRow([
      'Template_ID',
      'Name',
      'Description',
      'Steps_JSON',
      'Created_By',
      'Created_At',
      'Updated_At',
      'Active'
    ]);
    templatesSheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    templatesSheet.setFrozenRows(1);
  }

  // Create Workflow_Instances sheet
  let instancesSheet = ss.getSheetByName(WORKFLOW_INSTANCES_SHEET);
  if (!instancesSheet) {
    instancesSheet = ss.insertSheet(WORKFLOW_INSTANCES_SHEET);
    instancesSheet.appendRow([
      'Workflow_ID',
      'Template_ID',
      'Template_Name',
      'Client_Name',
      'Status',
      'Assignees_JSON',
      'Steps_Status_JSON',
      'Started_By',
      'Started_At',
      'Completed_At',
      'Notes'
    ]);
    instancesSheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    instancesSheet.setFrozenRows(1);
  }

  return { templatesSheet, instancesSheet };
}

// ============================================================================
// TEMPLATE MANAGEMENT
// ============================================================================

/**
 * Create a new workflow template
 * @param {string} name - Template name
 * @param {string} description - Template description
 * @param {Array} steps - Array of step objects
 * @returns {Object} - Created template info
 *
 * Step object structure:
 * {
 *   stepNumber: 1,
 *   title: "Change Driver's License",
 *   description: "Visit DMV to update license to new state",
 *   requiredDocs: ["Current CA license", "Proof of new address", "Passport"],
 *   dependencies: [], // Step numbers that must complete first
 *   assigneeRole: "Client",
 *   questions: [
 *     { id: "new_license_number", question: "New license number?", type: "text" },
 *     { id: "issue_date", question: "Date issued?", type: "date" }
 *   ],
 *   estimatedDays: 3,
 *   category: "Legal Documents"
 * }
 */
function createWorkflowTemplate(name, description, steps) {
  const { templatesSheet } = initWorkflowSheets_();

  const templateId = 'TPL_' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const timestamp = new Date().toISOString();
  const user = Session.getActiveUser().getEmail() || 'System';

  // Validate steps
  const validatedSteps = steps.map((step, idx) => ({
    stepNumber: step.stepNumber || (idx + 1),
    title: step.title || `Step ${idx + 1}`,
    description: step.description || '',
    requiredDocs: step.requiredDocs || [],
    dependencies: step.dependencies || [],
    assigneeRole: step.assigneeRole || 'Unassigned',
    questions: step.questions || [],
    estimatedDays: step.estimatedDays || 1,
    category: step.category || 'General'
  }));

  templatesSheet.appendRow([
    templateId,
    name,
    description,
    JSON.stringify(validatedSteps),
    user,
    timestamp,
    timestamp,
    true
  ]);

  // Log to audit ledger
  logToLedger_('WORKFLOW_TEMPLATE_CREATED', user, 'Created workflow template', templateId, {
    templateName: name,
    stepCount: validatedSteps.length
  });

  Logger.log(`Created template: ${name} (${templateId}) with ${validatedSteps.length} steps`);

  return {
    templateId,
    name,
    stepCount: validatedSteps.length
  };
}

/**
 * Get a workflow template by name or ID
 */
function getWorkflowTemplate(nameOrId) {
  const { templatesSheet } = initWorkflowSheets_();
  const data = templatesSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === nameOrId || data[i][1] === nameOrId) {
      return {
        templateId: data[i][0],
        name: data[i][1],
        description: data[i][2],
        steps: JSON.parse(data[i][3] || '[]'),
        createdBy: data[i][4],
        createdAt: data[i][5],
        updatedAt: data[i][6],
        active: data[i][7]
      };
    }
  }

  return null;
}

/**
 * List all active templates
 */
function listWorkflowTemplates() {
  const { templatesSheet } = initWorkflowSheets_();
  const data = templatesSheet.getDataRange().getValues();

  const templates = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === true || data[i][7] === 'TRUE') {
      templates.push({
        templateId: data[i][0],
        name: data[i][1],
        description: data[i][2],
        stepCount: JSON.parse(data[i][3] || '[]').length
      });
    }
  }

  return templates;
}

// ============================================================================
// WORKFLOW INSTANCE MANAGEMENT
// ============================================================================

/**
 * Start a new workflow instance for a client
 * @param {string} templateName - Name or ID of template to use
 * @param {string} clientName - Client name
 * @param {Object} assignees - Role to person mapping, e.g., { "Client": "John Smith", "Accountant": "Jane Doe" }
 * @returns {Object} - Created workflow info
 */
function startWorkflow(templateName, clientName, assignees = {}) {
  const template = getWorkflowTemplate(templateName);
  if (!template) {
    throw new Error(`Template not found: ${templateName}`);
  }

  const { instancesSheet } = initWorkflowSheets_();

  const workflowId = 'WF_' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const timestamp = new Date().toISOString();
  const user = Session.getActiveUser().getEmail() || 'System';

  // Initialize step statuses
  const stepsStatus = template.steps.map(step => ({
    stepNumber: step.stepNumber,
    status: step.dependencies.length === 0 ? STEP_STATUS.PENDING : STEP_STATUS.BLOCKED,
    completedBy: null,
    completedAt: null,
    proof: {},
    answers: {},
    notes: ''
  }));

  instancesSheet.appendRow([
    workflowId,
    template.templateId,
    template.name,
    clientName,
    WORKFLOW_STATUS.ACTIVE,
    JSON.stringify(assignees),
    JSON.stringify(stepsStatus),
    user,
    timestamp,
    null,
    ''
  ]);

  // Log to audit ledger
  logToLedger_('WORKFLOW_STARTED', user, `Started workflow for ${clientName}`, workflowId, {
    templateName: template.name,
    clientName: clientName,
    totalSteps: template.steps.length
  });

  Logger.log(`Started workflow: ${workflowId} for ${clientName} using template ${template.name}`);

  return {
    workflowId,
    templateName: template.name,
    clientName,
    totalSteps: template.steps.length,
    pendingSteps: stepsStatus.filter(s => s.status === STEP_STATUS.PENDING).length,
    blockedSteps: stepsStatus.filter(s => s.status === STEP_STATUS.BLOCKED).length
  };
}

/**
 * Complete a workflow step
 * @param {string} workflowId - Workflow instance ID
 * @param {number} stepNumber - Step number to complete
 * @param {Object} proof - Proof object { documents: [], answers: {}, notes: "" }
 * @returns {Object} - Updated workflow status
 */
function completeStep(workflowId, stepNumber, proof = {}) {
  const { instancesSheet } = initWorkflowSheets_();
  const workflow = getWorkflowInstance_(workflowId);

  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  if (workflow.status !== WORKFLOW_STATUS.ACTIVE) {
    throw new Error(`Workflow is not active: ${workflow.status}`);
  }

  const template = getWorkflowTemplate(workflow.templateId);
  const stepIndex = workflow.stepsStatus.findIndex(s => s.stepNumber === stepNumber);

  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepNumber}`);
  }

  const stepStatus = workflow.stepsStatus[stepIndex];
  const stepDef = template.steps.find(s => s.stepNumber === stepNumber);

  // Check if step is blocked
  if (stepStatus.status === STEP_STATUS.BLOCKED) {
    const blockers = getBlockingSteps_(workflow, stepDef);
    if (blockers.length > 0) {
      throw new Error(`Step ${stepNumber} is blocked by incomplete steps: ${blockers.map(b => b.stepNumber).join(', ')}`);
    }
  }

  const timestamp = new Date().toISOString();
  const user = Session.getActiveUser().getEmail() || 'System';

  // Create proof hash
  const proofString = JSON.stringify({
    stepNumber,
    documents: proof.documents || [],
    answers: proof.answers || {},
    timestamp,
    user
  });
  const proofHash = computeHash_(proofString);

  // Update step status
  workflow.stepsStatus[stepIndex] = {
    ...stepStatus,
    status: STEP_STATUS.COMPLETED,
    completedBy: user,
    completedAt: timestamp,
    proof: {
      documents: proof.documents || [],
      hash: proofHash
    },
    answers: proof.answers || {},
    notes: proof.notes || ''
  };

  // Update blocked steps that may now be unblocked
  updateBlockedSteps_(workflow, template);

  // Save to sheet
  saveWorkflowInstance_(workflow, instancesSheet);

  // Check if workflow is complete
  const completedSteps = workflow.stepsStatus.filter(s => s.status === STEP_STATUS.COMPLETED).length;
  const totalSteps = template.steps.length;

  if (completedSteps === totalSteps) {
    completeWorkflow_(workflow, instancesSheet);
  }

  // Log to audit ledger
  logToLedger_('WORKFLOW_STEP_COMPLETED', user, `Completed step ${stepNumber}: ${stepDef.title}`, workflowId, {
    stepNumber,
    stepTitle: stepDef.title,
    clientName: workflow.clientName,
    proofHash,
    progress: `${completedSteps}/${totalSteps}`
  });

  // Log documents if provided
  if (proof.documents && proof.documents.length > 0) {
    for (const doc of proof.documents) {
      const docHash = computeHash_(JSON.stringify(doc));
      logToLedger_('WORKFLOW_DOC_UPLOADED', user, `Document uploaded: ${doc.name || 'Unnamed'}`, workflowId, {
        stepNumber,
        documentName: doc.name,
        documentType: doc.type,
        documentHash: docHash
      });
    }
  }

  // Log answers if provided
  if (proof.answers && Object.keys(proof.answers).length > 0) {
    logToLedger_('WORKFLOW_QUESTIONS_ANSWERED', user, `Questions answered for step ${stepNumber}`, workflowId, {
      stepNumber,
      answerCount: Object.keys(proof.answers).length,
      answerHash: computeHash_(JSON.stringify(proof.answers))
    });
  }

  return getWorkflowStatus(workflowId);
}

/**
 * Get full workflow status
 */
function getWorkflowStatus(workflowId) {
  const workflow = getWorkflowInstance_(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const template = getWorkflowTemplate(workflow.templateId);

  const completed = workflow.stepsStatus.filter(s => s.status === STEP_STATUS.COMPLETED);
  const blocked = workflow.stepsStatus.filter(s => s.status === STEP_STATUS.BLOCKED);
  const pending = workflow.stepsStatus.filter(s => s.status === STEP_STATUS.PENDING);
  const inProgress = workflow.stepsStatus.filter(s => s.status === STEP_STATUS.IN_PROGRESS);

  // Build detailed step list
  const steps = template.steps.map(stepDef => {
    const status = workflow.stepsStatus.find(s => s.stepNumber === stepDef.stepNumber);
    return {
      ...stepDef,
      status: status.status,
      completedBy: status.completedBy,
      completedAt: status.completedAt,
      proof: status.proof,
      answers: status.answers,
      blockedBy: status.status === STEP_STATUS.BLOCKED ?
        getBlockingSteps_(workflow, stepDef).map(b => ({ stepNumber: b.stepNumber, title: b.title })) : []
    };
  });

  return {
    workflowId: workflow.workflowId,
    templateName: workflow.templateName,
    clientName: workflow.clientName,
    status: workflow.status,
    assignees: workflow.assignees,
    startedAt: workflow.startedAt,
    completedAt: workflow.completedAt,
    progress: {
      completed: completed.length,
      blocked: blocked.length,
      pending: pending.length,
      inProgress: inProgress.length,
      total: template.steps.length,
      percentage: Math.round((completed.length / template.steps.length) * 100)
    },
    steps
  };
}

/**
 * Get blocked steps with details on what's blocking them
 */
function getBlockedSteps(workflowId) {
  const status = getWorkflowStatus(workflowId);

  const blockedSteps = status.steps
    .filter(s => s.status === STEP_STATUS.BLOCKED)
    .map(step => ({
      stepNumber: step.stepNumber,
      title: step.title,
      category: step.category,
      blockedBy: step.blockedBy,
      requiredDocs: step.requiredDocs
    }));

  return {
    workflowId,
    clientName: status.clientName,
    blockedCount: blockedSteps.length,
    blockedSteps
  };
}

/**
 * Get gap analysis - what's missing and what it blocks
 */
function getWorkflowGapAnalysis(workflowId) {
  const status = getWorkflowStatus(workflowId);

  // Find incomplete steps and what they block
  const incompleteSteps = status.steps.filter(s => s.status !== STEP_STATUS.COMPLETED);

  const gaps = incompleteSteps.map(step => {
    // Find all steps that depend on this one
    const blocks = status.steps
      .filter(s => s.dependencies && s.dependencies.includes(step.stepNumber))
      .map(s => ({ stepNumber: s.stepNumber, title: s.title }));

    return {
      stepNumber: step.stepNumber,
      title: step.title,
      status: step.status,
      requiredDocs: step.requiredDocs,
      blocks: blocks,
      blocksCount: blocks.length
    };
  });

  // Sort by impact (how many things it blocks)
  gaps.sort((a, b) => b.blocksCount - a.blocksCount);

  return {
    workflowId,
    clientName: status.clientName,
    totalGaps: gaps.length,
    gaps,
    summary: gaps.slice(0, 5).map(g =>
      `${g.title}${g.blocksCount > 0 ? ` (blocks ${g.blocksCount} steps)` : ''}`
    )
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get workflow instance from sheet
 */
function getWorkflowInstance_(workflowId) {
  const { instancesSheet } = initWorkflowSheets_();
  const data = instancesSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === workflowId) {
      return {
        rowIndex: i + 1,
        workflowId: data[i][0],
        templateId: data[i][1],
        templateName: data[i][2],
        clientName: data[i][3],
        status: data[i][4],
        assignees: JSON.parse(data[i][5] || '{}'),
        stepsStatus: JSON.parse(data[i][6] || '[]'),
        startedBy: data[i][7],
        startedAt: data[i][8],
        completedAt: data[i][9],
        notes: data[i][10]
      };
    }
  }

  return null;
}

/**
 * Save workflow instance back to sheet
 */
function saveWorkflowInstance_(workflow, sheet) {
  sheet.getRange(workflow.rowIndex, 5).setValue(workflow.status);
  sheet.getRange(workflow.rowIndex, 6).setValue(JSON.stringify(workflow.assignees));
  sheet.getRange(workflow.rowIndex, 7).setValue(JSON.stringify(workflow.stepsStatus));
  sheet.getRange(workflow.rowIndex, 10).setValue(workflow.completedAt);
  sheet.getRange(workflow.rowIndex, 11).setValue(workflow.notes);
}

/**
 * Get steps blocking a given step
 */
function getBlockingSteps_(workflow, stepDef) {
  if (!stepDef.dependencies || stepDef.dependencies.length === 0) {
    return [];
  }

  const template = getWorkflowTemplate(workflow.templateId);
  const blockers = [];

  for (const depStepNum of stepDef.dependencies) {
    const depStatus = workflow.stepsStatus.find(s => s.stepNumber === depStepNum);
    if (depStatus && depStatus.status !== STEP_STATUS.COMPLETED) {
      const depDef = template.steps.find(s => s.stepNumber === depStepNum);
      blockers.push({
        stepNumber: depStepNum,
        title: depDef ? depDef.title : `Step ${depStepNum}`,
        status: depStatus.status
      });
    }
  }

  return blockers;
}

/**
 * Update blocked steps after a completion
 */
function updateBlockedSteps_(workflow, template) {
  for (const stepStatus of workflow.stepsStatus) {
    if (stepStatus.status === STEP_STATUS.BLOCKED) {
      const stepDef = template.steps.find(s => s.stepNumber === stepStatus.stepNumber);
      const blockers = getBlockingSteps_(workflow, stepDef);
      if (blockers.length === 0) {
        stepStatus.status = STEP_STATUS.PENDING;
      }
    }
  }
}

/**
 * Mark workflow as complete
 */
function completeWorkflow_(workflow, sheet) {
  const timestamp = new Date().toISOString();
  const user = Session.getActiveUser().getEmail() || 'System';

  workflow.status = WORKFLOW_STATUS.COMPLETED;
  workflow.completedAt = timestamp;

  saveWorkflowInstance_(workflow, sheet);

  logToLedger_('WORKFLOW_COMPLETED', user, `Workflow completed for ${workflow.clientName}`, workflow.workflowId, {
    templateName: workflow.templateName,
    clientName: workflow.clientName,
    totalSteps: workflow.stepsStatus.length
  });
}

/**
 * Compute SHA-256 hash
 */
function computeHash_(data) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data);
  return hash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * Log entry to audit ledger
 */
function logToLedger_(eventType, actor, action, target, details) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ledger = ss.getSheetByName(AUDIT_LEDGER_SHEET);

  if (!ledger) {
    // Create ledger if it doesn't exist
    ledger = ss.insertSheet(AUDIT_LEDGER_SHEET);
    ledger.appendRow(['UUID', 'Timestamp', 'Event_Type', 'Actor', 'Action', 'Target', 'Details', 'Signal', 'Regulatory_Tags']);
    ledger.getRange(1, 1, 1, 9).setFontWeight('bold');
    ledger.setFrozenRows(1);
  }

  const uuid = Utilities.getUuid();
  const timestamp = new Date().toISOString();

  ledger.appendRow([
    uuid,
    timestamp,
    eventType,
    actor,
    action,
    target,
    JSON.stringify(details),
    'WORKFLOW_EVENT',
    ''
  ]);
}

// ============================================================================
// DASHBOARD DATA
// ============================================================================

/**
 * Get workflow data for dashboard
 */
function getWorkflowDashboardData() {
  const { instancesSheet } = initWorkflowSheets_();
  const data = instancesSheet.getDataRange().getValues();

  const activeWorkflows = [];
  let totalBlocked = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === WORKFLOW_STATUS.ACTIVE) {
      const stepsStatus = JSON.parse(data[i][6] || '[]');
      const completed = stepsStatus.filter(s => s.status === STEP_STATUS.COMPLETED).length;
      const blocked = stepsStatus.filter(s => s.status === STEP_STATUS.BLOCKED).length;
      const total = stepsStatus.length;

      totalBlocked += blocked;

      activeWorkflows.push({
        workflowId: data[i][0],
        templateName: data[i][2],
        clientName: data[i][3],
        completed,
        blocked,
        total,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        startedAt: data[i][8]
      });
    }
  }

  // Sort by percentage (least complete first for attention)
  activeWorkflows.sort((a, b) => a.percentage - b.percentage);

  return {
    activeCount: activeWorkflows.length,
    totalBlocked,
    workflows: activeWorkflows
  };
}

/**
 * List workflow templates for dashboard (wrapper for google.script.run)
 * Returns simplified template list for dropdown
 */
function listWorkflowTemplatesForDashboard() {
  return listWorkflowTemplates();
}

// ============================================================================
// MENU FUNCTIONS
// ============================================================================

/**
 * Show create template dialog
 */
function showCreateTemplateDialog() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'Create Workflow Template',
    'Template creation is done programmatically.\n\n' +
    'Use createWorkflowTemplate(name, description, steps) in the script editor,\n' +
    'or use the pre-built CA Residency Change template.\n\n' +
    'To install CA Residency template, run: installCAResidencyTemplate()',
    ui.ButtonSet.OK
  );
}

/**
 * Show start workflow dialog
 */
function showStartWorkflowDialog() {
  const templates = listWorkflowTemplates();

  if (templates.length === 0) {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      'No Templates Available',
      'No workflow templates found.\n\nRun installCAResidencyTemplate() first to create the CA Residency Change template.',
      ui.ButtonSet.OK
    );
    return;
  }

  const html = HtmlService.createHtmlOutput(getStartWorkflowHTML_(templates))
    .setWidth(500)
    .setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(html, 'Start New Workflow');
}

/**
 * Start workflow from dialog
 */
function startWorkflowFromDialog(templateId, clientName, assigneesJson) {
  const assignees = JSON.parse(assigneesJson || '{}');
  const result = startWorkflow(templateId, clientName, assignees);
  return result;
}

/**
 * Show workflow status dialog
 */
function showWorkflowStatusDialog() {
  const dashData = getWorkflowDashboardData();

  if (dashData.activeCount === 0) {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      'No Active Workflows',
      'There are no active workflows to display.\n\nStart a new workflow from Workflow > Start Workflow.',
      ui.ButtonSet.OK
    );
    return;
  }

  const html = HtmlService.createHtmlOutput(getWorkflowStatusHTML_(dashData))
    .setWidth(700)
    .setHeight(500);

  SpreadsheetApp.getUi().showModalDialog(html, 'Workflow Status');
}

/**
 * Show complete step dialog
 */
function showCompleteStepDialog() {
  const dashData = getWorkflowDashboardData();

  if (dashData.activeCount === 0) {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      'No Active Workflows',
      'There are no active workflows.\n\nStart a new workflow from Workflow > Start Workflow.',
      ui.ButtonSet.OK
    );
    return;
  }

  const html = HtmlService.createHtmlOutput(getCompleteStepHTML_(dashData))
    .setWidth(600)
    .setHeight(550);

  SpreadsheetApp.getUi().showModalDialog(html, 'Complete Workflow Step');
}

/**
 * Complete step from dialog
 */
function completeStepFromDialog(workflowId, stepNumber, proofJson) {
  const proof = JSON.parse(proofJson || '{}');
  const result = completeStep(workflowId, parseInt(stepNumber), proof);
  return result;
}

/**
 * Get pending steps for a workflow (for dialog)
 */
function getPendingStepsForDialog(workflowId) {
  const status = getWorkflowStatus(workflowId);
  return status.steps
    .filter(s => s.status === 'PENDING' || s.status === 'IN_PROGRESS')
    .map(s => ({
      stepNumber: s.stepNumber,
      title: s.title,
      description: s.description,
      requiredDocs: s.requiredDocs,
      questions: s.questions
    }));
}

/**
 * HTML for complete step dialog
 */
function getCompleteStepHTML_(dashData) {
  const workflowOptions = dashData.workflows.map(w =>
    `<option value="${w.workflowId}">${w.clientName} - ${w.templateName} (${w.percentage}%)</option>`
  ).join('');

  return `
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      label { display: block; margin-top: 15px; font-weight: bold; }
      input, select, textarea { width: 100%; padding: 8px; margin-top: 5px; box-sizing: border-box; }
      textarea { min-height: 80px; }
      button { margin-top: 20px; padding: 10px 20px; background: #4285f4; color: white; border: none; cursor: pointer; }
      button:hover { background: #3367d6; }
      .error { color: red; margin-top: 10px; }
      .success { color: green; margin-top: 10px; }
      .step-info { background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 10px; font-size: 13px; }
      .step-info strong { display: block; margin-bottom: 5px; }
      #stepSelect { display: none; }
    </style>

    <label>Select Workflow:</label>
    <select id="workflowId" onchange="loadSteps()">${workflowOptions}</select>

    <div id="stepSelect">
      <label>Select Step to Complete:</label>
      <select id="stepNumber" onchange="showStepInfo()"></select>

      <div id="stepInfo" class="step-info" style="display:none;"></div>

      <label>Notes / Proof:</label>
      <textarea id="notes" placeholder="Describe what was done, attach document names, etc."></textarea>

      <label>Document Names (comma-separated, optional):</label>
      <input type="text" id="documents" placeholder="e.g., drivers_license.pdf, utility_bill.pdf">
    </div>

    <div id="error" class="error"></div>
    <div id="success" class="success"></div>

    <button onclick="submitStep()">Complete Step</button>

    <script>
      let pendingSteps = [];

      function loadSteps() {
        const workflowId = document.getElementById('workflowId').value;
        document.getElementById('stepSelect').style.display = 'none';
        document.getElementById('stepInfo').style.display = 'none';
        document.getElementById('error').textContent = '';

        google.script.run
          .withSuccessHandler(function(steps) {
            pendingSteps = steps;
            if (steps.length === 0) {
              document.getElementById('error').textContent = 'No pending steps available for this workflow.';
              return;
            }

            const stepOptions = steps.map(s =>
              '<option value="' + s.stepNumber + '">' + s.stepNumber + '. ' + s.title + '</option>'
            ).join('');

            document.getElementById('stepNumber').innerHTML = stepOptions;
            document.getElementById('stepSelect').style.display = 'block';
            showStepInfo();
          })
          .withFailureHandler(function(err) {
            document.getElementById('error').textContent = 'Error loading steps: ' + err.message;
          })
          .getPendingStepsForDialog(workflowId);
      }

      function showStepInfo() {
        const stepNumber = parseInt(document.getElementById('stepNumber').value);
        const step = pendingSteps.find(s => s.stepNumber === stepNumber);

        if (step) {
          let info = '<strong>' + step.title + '</strong>';
          if (step.description) info += '<p>' + step.description + '</p>';
          if (step.requiredDocs && step.requiredDocs.length > 0) {
            info += '<p><em>Required docs:</em> ' + step.requiredDocs.join(', ') + '</p>';
          }
          document.getElementById('stepInfo').innerHTML = info;
          document.getElementById('stepInfo').style.display = 'block';
        }
      }

      function submitStep() {
        const workflowId = document.getElementById('workflowId').value;
        const stepNumber = document.getElementById('stepNumber').value;
        const notes = document.getElementById('notes').value.trim();
        const docsInput = document.getElementById('documents').value.trim();

        const documents = docsInput ? docsInput.split(',').map(d => ({ name: d.trim() })) : [];

        const proof = {
          notes: notes,
          documents: documents
        };

        document.getElementById('error').textContent = '';
        document.getElementById('success').textContent = '';

        google.script.run
          .withSuccessHandler(function(result) {
            document.getElementById('success').textContent =
              'Step completed! Progress: ' + result.progress.completed + '/' + result.progress.total;
            document.getElementById('notes').value = '';
            document.getElementById('documents').value = '';
            loadSteps(); // Refresh steps
          })
          .withFailureHandler(function(err) {
            document.getElementById('error').textContent = 'Error: ' + err.message;
          })
          .completeStepFromDialog(workflowId, stepNumber, JSON.stringify(proof));
      }

      // Load steps for first workflow on init
      loadSteps();
    </script>
  `;
}

/**
 * HTML for start workflow dialog
 */
function getStartWorkflowHTML_(templates) {
  const templateOptions = templates.map(t =>
    `<option value="${t.templateId}">${t.name} (${t.stepCount} steps)</option>`
  ).join('');

  return `
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      label { display: block; margin-top: 15px; font-weight: bold; }
      input, select { width: 100%; padding: 8px; margin-top: 5px; box-sizing: border-box; }
      button { margin-top: 20px; padding: 10px 20px; background: #4285f4; color: white; border: none; cursor: pointer; }
      button:hover { background: #3367d6; }
      .error { color: red; margin-top: 10px; }
    </style>

    <label>Template:</label>
    <select id="templateId">${templateOptions}</select>

    <label>Client Name:</label>
    <input type="text" id="clientName" placeholder="e.g., John Smith">

    <label>Primary Assignee (Client):</label>
    <input type="text" id="assigneeClient" placeholder="e.g., john@example.com">

    <label>Accountant (optional):</label>
    <input type="text" id="assigneeAccountant" placeholder="e.g., accountant@example.com">

    <div id="error" class="error"></div>

    <button onclick="submitForm()">Start Workflow</button>

    <script>
      function submitForm() {
        const templateId = document.getElementById('templateId').value;
        const clientName = document.getElementById('clientName').value.trim();
        const assigneeClient = document.getElementById('assigneeClient').value.trim();
        const assigneeAccountant = document.getElementById('assigneeAccountant').value.trim();

        if (!clientName) {
          document.getElementById('error').textContent = 'Client name is required';
          return;
        }

        const assignees = { Client: assigneeClient };
        if (assigneeAccountant) assignees.Accountant = assigneeAccountant;

        google.script.run
          .withSuccessHandler(function(result) {
            alert('Workflow started: ' + result.workflowId + '\\n\\nClient: ' + result.clientName + '\\nTotal Steps: ' + result.totalSteps);
            google.script.host.close();
          })
          .withFailureHandler(function(err) {
            document.getElementById('error').textContent = err.message;
          })
          .startWorkflowFromDialog(templateId, clientName, JSON.stringify(assignees));
      }
    </script>
  `;
}

/**
 * HTML for workflow status dialog
 */
function getWorkflowStatusHTML_(dashData) {
  const workflowRows = dashData.workflows.map(w => `
    <tr>
      <td>${w.clientName}</td>
      <td>${w.templateName}</td>
      <td>
        <div style="background:#eee;border-radius:4px;overflow:hidden;">
          <div style="background:#4285f4;height:20px;width:${w.percentage}%;"></div>
        </div>
        <small>${w.completed}/${w.total} (${w.percentage}%)</small>
      </td>
      <td style="color:${w.blocked > 0 ? 'red' : 'green'};">${w.blocked}</td>
      <td><button onclick="viewDetails('${w.workflowId}')">Details</button></td>
    </tr>
  `).join('');

  return `
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
      th { background: #f5f5f5; }
      button { padding: 5px 10px; cursor: pointer; }
      .summary { display: flex; gap: 20px; margin-bottom: 20px; }
      .summary-card { background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; }
      .summary-value { font-size: 24px; font-weight: bold; }
      .summary-label { font-size: 12px; color: #666; }
    </style>

    <div class="summary">
      <div class="summary-card">
        <div class="summary-value">${dashData.activeCount}</div>
        <div class="summary-label">Active Workflows</div>
      </div>
      <div class="summary-card">
        <div class="summary-value" style="color:${dashData.totalBlocked > 0 ? 'red' : 'green'};">${dashData.totalBlocked}</div>
        <div class="summary-label">Blocked Steps</div>
      </div>
    </div>

    <table>
      <tr>
        <th>Client</th>
        <th>Template</th>
        <th>Progress</th>
        <th>Blocked</th>
        <th>Action</th>
      </tr>
      ${workflowRows}
    </table>

    <script>
      function viewDetails(workflowId) {
        google.script.run
          .withSuccessHandler(function(status) {
            let msg = 'Workflow: ' + status.templateName + '\\n';
            msg += 'Client: ' + status.clientName + '\\n';
            msg += 'Progress: ' + status.progress.completed + '/' + status.progress.total + '\\n\\n';
            msg += 'Steps:\\n';
            status.steps.forEach(s => {
              const icon = s.status === 'COMPLETED' ? '✓' : s.status === 'BLOCKED' ? '⛔' : '○';
              msg += icon + ' ' + s.stepNumber + '. ' + s.title + ' [' + s.status + ']\\n';
            });
            alert(msg);
          })
          .withFailureHandler(function(err) {
            alert('Error: ' + err.message);
          })
          .getWorkflowStatus(workflowId);
      }
    </script>
  `;
}

// ============================================================================
// CA RESIDENCY CHANGE TEMPLATE
// ============================================================================

/**
 * Install the pre-built CA Residency Change template
 */
function installCAResidencyTemplate() {
  const existingTemplate = getWorkflowTemplate('CA Residency Change');
  if (existingTemplate) {
    Logger.log('CA Residency Change template already exists');
    SpreadsheetApp.getUi().alert('Template Already Exists', 'The CA Residency Change template is already installed.', SpreadsheetApp.getUi().ButtonSet.OK);
    return existingTemplate;
  }

  const steps = [
    {
      stepNumber: 1,
      title: "Establish Physical Presence in New State",
      description: "Document your arrival and physical presence in the new state. Keep records of travel dates.",
      requiredDocs: ["Flight/travel records", "Lease agreement or property deed"],
      dependencies: [],
      assigneeRole: "Client",
      questions: [
        { id: "arrival_date", question: "Date you arrived in new state?", type: "date" },
        { id: "new_address", question: "New state address?", type: "text" }
      ],
      estimatedDays: 1,
      category: "Domicile"
    },
    {
      stepNumber: 2,
      title: "Change Driver's License",
      description: "Obtain driver's license in new state. Most states require this within 30-60 days of establishing residency.",
      requiredDocs: ["Current CA license", "Proof of new address", "Passport or birth certificate", "Social Security card"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "new_license_number", question: "New license number?", type: "text" },
        { id: "license_issue_date", question: "Date issued?", type: "date" },
        { id: "ca_license_surrendered", question: "CA license surrendered?", type: "boolean" }
      ],
      estimatedDays: 7,
      category: "Legal Documents"
    },
    {
      stepNumber: 3,
      title: "Register to Vote in New State",
      description: "Register to vote at your new address. This is strong evidence of intent to change domicile.",
      requiredDocs: ["New driver's license", "Proof of address"],
      dependencies: [2],
      assigneeRole: "Client",
      questions: [
        { id: "voter_registration_date", question: "Date registered?", type: "date" },
        { id: "voter_registration_number", question: "Registration confirmation number?", type: "text" }
      ],
      estimatedDays: 3,
      category: "Legal Documents"
    },
    {
      stepNumber: 4,
      title: "Change Vehicle Registration",
      description: "Register your vehicle(s) in the new state. May require vehicle inspection depending on state.",
      requiredDocs: ["CA vehicle registration", "New driver's license", "Proof of insurance", "Vehicle title"],
      dependencies: [2],
      assigneeRole: "Client",
      questions: [
        { id: "vehicle_registered", question: "Vehicle make/model?", type: "text" },
        { id: "new_plate_number", question: "New license plate number?", type: "text" },
        { id: "registration_date", question: "Registration date?", type: "date" }
      ],
      estimatedDays: 14,
      category: "Legal Documents"
    },
    {
      stepNumber: 5,
      title: "File Change of Address with USPS",
      description: "Submit official change of address with USPS to forward mail.",
      requiredDocs: ["USPS confirmation"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "usps_confirmation", question: "USPS confirmation number?", type: "text" },
        { id: "forwarding_start_date", question: "Forwarding start date?", type: "date" }
      ],
      estimatedDays: 1,
      category: "Administrative"
    },
    {
      stepNumber: 6,
      title: "Update Bank Accounts",
      description: "Change address on all bank accounts to new state address.",
      requiredDocs: ["Bank statements showing new address"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "banks_updated", question: "List banks updated", type: "text" },
        { id: "bank_update_date", question: "Date updated?", type: "date" }
      ],
      estimatedDays: 7,
      category: "Financial"
    },
    {
      stepNumber: 7,
      title: "Update Brokerage Accounts",
      description: "Change address on all investment/brokerage accounts. Important for tax reporting.",
      requiredDocs: ["Brokerage statements showing new address"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "brokerages_updated", question: "List brokerages updated", type: "text" },
        { id: "brokerage_update_date", question: "Date updated?", type: "date" }
      ],
      estimatedDays: 7,
      category: "Financial"
    },
    {
      stepNumber: 8,
      title: "Update Credit Card Addresses",
      description: "Change billing address on all credit cards.",
      requiredDocs: ["Credit card statements showing new address"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "cards_updated", question: "List cards updated", type: "text" }
      ],
      estimatedDays: 3,
      category: "Financial"
    },
    {
      stepNumber: 9,
      title: "Establish Utility Accounts in New State",
      description: "Set up electricity, gas, water, internet in your name at new address.",
      requiredDocs: ["Utility bills in your name"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "utilities_established", question: "List utilities set up", type: "text" },
        { id: "first_bill_date", question: "Date of first bill?", type: "date" }
      ],
      estimatedDays: 14,
      category: "Administrative"
    },
    {
      stepNumber: 10,
      title: "Cancel CA Utilities",
      description: "Close or transfer utility accounts at CA address.",
      requiredDocs: ["Final utility bills from CA"],
      dependencies: [9],
      assigneeRole: "Client",
      questions: [
        { id: "ca_utilities_cancelled", question: "CA utilities cancelled?", type: "boolean" },
        { id: "cancellation_date", question: "Cancellation date?", type: "date" }
      ],
      estimatedDays: 7,
      category: "Administrative"
    },
    {
      stepNumber: 11,
      title: "Update Professional Licenses",
      description: "If applicable, notify professional licensing boards of address change or apply for new state license.",
      requiredDocs: ["License update confirmation"],
      dependencies: [2],
      assigneeRole: "Client",
      questions: [
        { id: "licenses_applicable", question: "What professional licenses do you hold?", type: "text" },
        { id: "licenses_updated", question: "Have all been updated?", type: "boolean" }
      ],
      estimatedDays: 30,
      category: "Professional"
    },
    {
      stepNumber: 12,
      title: "Update Employer Records",
      description: "Notify employer of address change for tax withholding purposes.",
      requiredDocs: ["Updated W-4", "HR confirmation"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "employer_notified", question: "Employer notified?", type: "boolean" },
        { id: "w4_updated", question: "W-4 updated?", type: "boolean" },
        { id: "notification_date", question: "Date notified?", type: "date" }
      ],
      estimatedDays: 3,
      category: "Employment"
    },
    {
      stepNumber: 13,
      title: "Cancel CA Gym Memberships / Subscriptions",
      description: "Cancel location-based subscriptions tied to CA.",
      requiredDocs: ["Cancellation confirmations"],
      dependencies: [],
      assigneeRole: "Client",
      questions: [
        { id: "subscriptions_cancelled", question: "List cancelled subscriptions", type: "text" }
      ],
      estimatedDays: 14,
      category: "Administrative"
    },
    {
      stepNumber: 14,
      title: "Join New State Organizations",
      description: "Join local clubs, religious organizations, professional groups in new state.",
      requiredDocs: ["Membership cards/confirmations"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "organizations_joined", question: "List organizations joined", type: "text" }
      ],
      estimatedDays: 30,
      category: "Social Ties"
    },
    {
      stepNumber: 15,
      title: "Establish New State Healthcare",
      description: "Register with doctors, dentists, and healthcare providers in new state.",
      requiredDocs: ["New healthcare provider records"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "primary_doctor", question: "New primary care doctor?", type: "text" },
        { id: "dentist", question: "New dentist?", type: "text" }
      ],
      estimatedDays: 30,
      category: "Healthcare"
    },
    {
      stepNumber: 16,
      title: "Update Insurance Policies",
      description: "Update auto, home/renters, and other insurance to reflect new state.",
      requiredDocs: ["Updated insurance declarations"],
      dependencies: [4],
      assigneeRole: "Client",
      questions: [
        { id: "auto_insurance_updated", question: "Auto insurance updated?", type: "boolean" },
        { id: "home_insurance_updated", question: "Home/renters insurance updated?", type: "boolean" }
      ],
      estimatedDays: 14,
      category: "Financial"
    },
    {
      stepNumber: 17,
      title: "Update Estate Planning Documents",
      description: "Review and update will, trust, POA documents for new state laws.",
      requiredDocs: ["Updated estate documents"],
      dependencies: [2],
      assigneeRole: "Client",
      questions: [
        { id: "estate_docs_reviewed", question: "Estate docs reviewed with attorney?", type: "boolean" },
        { id: "attorney_name", question: "Attorney name?", type: "text" }
      ],
      estimatedDays: 60,
      category: "Legal Documents"
    },
    {
      stepNumber: 18,
      title: "Begin Tracking Days in/out of CA",
      description: "Start a log tracking every day spent in and out of California. Critical for FTB audit defense.",
      requiredDocs: ["Day tracking spreadsheet or app export"],
      dependencies: [1],
      assigneeRole: "Client",
      questions: [
        { id: "tracking_method", question: "How are you tracking days?", type: "text" },
        { id: "tracking_started", question: "Date tracking started?", type: "date" }
      ],
      estimatedDays: 1,
      category: "Tax Compliance"
    },
    {
      stepNumber: 19,
      title: "Close or Update CA Safe Deposit Box",
      description: "If you have a safe deposit box in CA, close it or document its necessity.",
      requiredDocs: ["Safe deposit box closure confirmation or documentation"],
      dependencies: [],
      assigneeRole: "Client",
      questions: [
        { id: "has_safe_deposit", question: "Do you have a CA safe deposit box?", type: "boolean" },
        { id: "safe_deposit_action", question: "Action taken?", type: "text" }
      ],
      estimatedDays: 14,
      category: "Financial"
    },
    {
      stepNumber: 20,
      title: "Document Intent to Change Domicile",
      description: "Draft and sign a Declaration of Domicile stating your intent to make the new state your permanent home.",
      requiredDocs: ["Signed Declaration of Domicile"],
      dependencies: [2, 3, 4],
      assigneeRole: "Client",
      questions: [
        { id: "declaration_signed", question: "Declaration signed?", type: "boolean" },
        { id: "declaration_date", question: "Date signed?", type: "date" },
        { id: "notarized", question: "Was it notarized?", type: "boolean" }
      ],
      estimatedDays: 7,
      category: "Legal Documents"
    },
    {
      stepNumber: 21,
      title: "File Final CA Resident Tax Return",
      description: "Work with accountant to file your final CA resident return (or part-year return) for the year of move.",
      requiredDocs: ["CA tax return copy"],
      dependencies: [12, 18],
      assigneeRole: "Accountant",
      questions: [
        { id: "tax_year", question: "Tax year?", type: "text" },
        { id: "return_type", question: "Full year or part-year resident return?", type: "text" },
        { id: "filed_date", question: "Date filed?", type: "date" }
      ],
      estimatedDays: 90,
      category: "Tax Compliance"
    },
    {
      stepNumber: 22,
      title: "Complete Residency Change Checklist Review",
      description: "Final review with advisor to ensure all steps completed and documentation is in order.",
      requiredDocs: ["Completed checklist", "Documentation binder/folder"],
      dependencies: [2, 3, 4, 5, 6, 7, 17, 18, 20, 21],
      assigneeRole: "Accountant",
      questions: [
        { id: "review_completed", question: "Final review completed?", type: "boolean" },
        { id: "review_date", question: "Review date?", type: "date" },
        { id: "issues_identified", question: "Any issues identified?", type: "text" }
      ],
      estimatedDays: 7,
      category: "Final Review"
    }
  ];

  const result = createWorkflowTemplate(
    'CA Residency Change',
    'Complete checklist for changing residency from California to another state. Covers legal documents, financial accounts, tax compliance, and domicile evidence.',
    steps
  );

  SpreadsheetApp.getUi().alert(
    'Template Installed',
    `CA Residency Change template installed successfully!\n\n` +
    `Template ID: ${result.templateId}\n` +
    `Steps: ${result.stepCount}\n\n` +
    `Go to Workflow > Start Workflow to begin a new workflow for a client.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return result;
}

// ============================================================================
// CALCOMPETE TAX CREDIT APPLICATION TEMPLATE
// ============================================================================

/**
 * Install the California Competes (CalCompete) Tax Credit Application template
 * Based on GO-Biz requirements: https://business.ca.gov/california-competes-tax-credit/
 */
function installCalCompeteTemplate() {
  const existingTemplate = getWorkflowTemplate('CalCompete Tax Credit Application');
  if (existingTemplate) {
    Logger.log('CalCompete Tax Credit Application template already exists');
    SpreadsheetApp.getUi().alert('Template Already Exists', 'The CalCompete Tax Credit Application template is already installed.', SpreadsheetApp.getUi().ButtonSet.OK);
    return existingTemplate;
  }

  const steps = [
    // ===== PRE-APPLICATION PHASE =====
    {
      stepNumber: 1,
      title: "Verify Business Eligibility",
      description: "Confirm business qualifies for CalCompete. Any business size/industry can apply. Must be creating jobs or making investments in California.",
      requiredDocs: ["Business entity documentation", "CA Secretary of State registration"],
      dependencies: [],
      assigneeRole: "Business Owner",
      questions: [
        { id: "business_type", question: "Business entity type (LLC, Corp, etc.)?", type: "text" },
        { id: "ca_registered", question: "Is business registered in California?", type: "boolean" },
        { id: "industry", question: "Primary industry/sector?", type: "text" }
      ],
      estimatedDays: 3,
      category: "Pre-Application"
    },
    {
      stepNumber: 2,
      title: "Determine Application Window",
      description: "FY 2025-26 windows: July 21-Aug 11, 2025 ($308M); Jan 5-26, 2026 ($308M); Mar 2-16, 2026 ($306.6M). Select target window.",
      requiredDocs: [],
      dependencies: [1],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "target_window", question: "Which application window are you targeting?", type: "text" },
        { id: "deadline_date", question: "Application deadline date?", type: "date" }
      ],
      estimatedDays: 1,
      category: "Pre-Application"
    },
    {
      stepNumber: 3,
      title: "Calculate Projected Job Creation",
      description: "Document planned full-time employee (FTE) positions to be created. Must meet minimum 35 hrs/week threshold.",
      requiredDocs: ["Hiring plan", "Job descriptions", "Projected org chart"],
      dependencies: [1],
      assigneeRole: "Business Owner",
      questions: [
        { id: "new_fte_count", question: "Number of new FTE positions planned?", type: "number" },
        { id: "avg_salary", question: "Average annual salary for new positions?", type: "number" },
        { id: "job_locations", question: "Where will new employees work?", type: "text" }
      ],
      estimatedDays: 7,
      category: "Pre-Application"
    },
    {
      stepNumber: 4,
      title: "Calculate Projected Investment",
      description: "Document planned capital investments in California (equipment, facilities, etc.).",
      requiredDocs: ["Capital expenditure plan", "Equipment quotes", "Facility plans"],
      dependencies: [1],
      assigneeRole: "Business Owner",
      questions: [
        { id: "investment_amount", question: "Total planned investment amount ($)?", type: "number" },
        { id: "investment_type", question: "Type of investments (equipment, facilities, etc.)?", type: "text" },
        { id: "investment_timeline", question: "Investment timeline (months)?", type: "number" }
      ],
      estimatedDays: 7,
      category: "Pre-Application"
    },
    {
      stepNumber: 5,
      title: "Calculate Cost-Benefit Ratio",
      description: "Phase I uses formula: Credit Amount Requested ÷ (Aggregate Employee Compensation + Aggregate Investment). Lower ratio = more competitive.",
      requiredDocs: ["Cost-benefit calculation worksheet"],
      dependencies: [3, 4],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "credit_requested", question: "Total credit amount requesting ($)?", type: "number" },
        { id: "cost_benefit_ratio", question: "Calculated cost-benefit ratio?", type: "text" },
        { id: "ratio_competitive", question: "Is ratio likely competitive based on historical data?", type: "boolean" }
      ],
      estimatedDays: 3,
      category: "Pre-Application"
    },
    {
      stepNumber: 6,
      title: "Evaluate High Unemployment/Poverty Area Qualification",
      description: "If 75%+ of new hires work in designated high unemployment/poverty areas, you can bypass strict Phase I cutoffs. Check GO-Biz list.",
      requiredDocs: ["GO-Biz High Unemployment and Poverty Areas List"],
      dependencies: [3],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "in_designated_area", question: "Are job locations in designated high unemployment/poverty areas?", type: "boolean" },
        { id: "percentage_in_area", question: "Percentage of new hires in designated areas?", type: "number" }
      ],
      estimatedDays: 2,
      category: "Pre-Application"
    },
    {
      stepNumber: 7,
      title: "Evaluate Out-of-State Competition Factor",
      description: "If project would otherwise leave/not come to CA, you can bypass Phase I cutoffs. Must certify this truthfully.",
      requiredDocs: ["Out-of-state location analysis", "Competitor location offers (if any)"],
      dependencies: [1],
      assigneeRole: "Business Owner",
      questions: [
        { id: "considering_other_states", question: "Is the project considering out-of-state locations?", type: "boolean" },
        { id: "other_states", question: "Which other states are being considered?", type: "text" },
        { id: "can_certify", question: "Can you certify project would otherwise leave/not come to CA?", type: "boolean" }
      ],
      estimatedDays: 3,
      category: "Pre-Application"
    },
    {
      stepNumber: 8,
      title: "Review California Jobs First Blueprint",
      description: "FY25-26 gives special consideration to 'strengthen' and 'accelerate' sectors per CA Jobs First Economic Blueprint.",
      requiredDocs: ["California Jobs First Economic Blueprint review"],
      dependencies: [1],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "in_priority_sector", question: "Is business in a 'strengthen' or 'accelerate' sector?", type: "boolean" },
        { id: "sector_classification", question: "Sector classification per Blueprint?", type: "text" }
      ],
      estimatedDays: 2,
      category: "Pre-Application"
    },
    {
      stepNumber: 9,
      title: "Attend GO-Biz Application Webinar",
      description: "GO-Biz hosts webinars before each application window. Highly recommended for understanding process and Q&A.",
      requiredDocs: ["Webinar attendance notes"],
      dependencies: [2],
      assigneeRole: "Business Owner",
      questions: [
        { id: "webinar_attended", question: "Webinar attended?", type: "boolean" },
        { id: "webinar_date", question: "Date attended?", type: "date" },
        { id: "key_takeaways", question: "Key takeaways from webinar?", type: "text" }
      ],
      estimatedDays: 1,
      category: "Pre-Application"
    },

    // ===== APPLICATION SUBMISSION PHASE =====
    {
      stepNumber: 10,
      title: "Create CalCompetes Online Account",
      description: "Register at calcompetes.ca.gov. Click 'Create an Account' on login screen.",
      requiredDocs: ["Account confirmation email"],
      dependencies: [2],
      assigneeRole: "Business Owner",
      questions: [
        { id: "account_created", question: "Account created?", type: "boolean" },
        { id: "account_email", question: "Email used for account?", type: "text" }
      ],
      estimatedDays: 1,
      category: "Application"
    },
    {
      stepNumber: 11,
      title: "Complete Application - Business Information Section",
      description: "Enter business details: legal name, address, EIN, NAICS code, ownership structure.",
      requiredDocs: ["EIN confirmation", "Business registration docs", "NAICS code documentation"],
      dependencies: [10],
      assigneeRole: "Business Owner",
      questions: [
        { id: "ein", question: "Business EIN?", type: "text" },
        { id: "naics_code", question: "Primary NAICS code?", type: "text" },
        { id: "section_complete", question: "Business Information section complete?", type: "boolean" }
      ],
      estimatedDays: 2,
      category: "Application"
    },
    {
      stepNumber: 12,
      title: "Complete Application - Project Description Section",
      description: "Describe the project, its strategic importance, economic impact, and why California location matters.",
      requiredDocs: ["Project narrative", "Business plan excerpt"],
      dependencies: [10, 3, 4],
      assigneeRole: "Business Owner",
      questions: [
        { id: "project_summary", question: "Brief project summary (2-3 sentences)?", type: "text" },
        { id: "strategic_importance", question: "Why is this strategically important to CA?", type: "text" },
        { id: "section_complete", question: "Project Description section complete?", type: "boolean" }
      ],
      estimatedDays: 5,
      category: "Application"
    },
    {
      stepNumber: 13,
      title: "Complete Application - Employment Data Section",
      description: "Enter current employment, projected new hires by year, salary/wage data, benefits information.",
      requiredDocs: ["Current payroll report", "Hiring projections spreadsheet", "Benefits summary"],
      dependencies: [10, 3],
      assigneeRole: "Business Owner",
      questions: [
        { id: "current_ca_employees", question: "Current CA FTE count?", type: "number" },
        { id: "year1_new_hires", question: "Year 1 projected new hires?", type: "number" },
        { id: "year5_total_new", question: "Total new hires by Year 5?", type: "number" },
        { id: "section_complete", question: "Employment Data section complete?", type: "boolean" }
      ],
      estimatedDays: 3,
      category: "Application"
    },
    {
      stepNumber: 14,
      title: "Complete Application - Investment Data Section",
      description: "Enter capital investment amounts, categories (equipment, facilities, etc.), and timeline.",
      requiredDocs: ["Capital expenditure schedule", "Investment breakdown"],
      dependencies: [10, 4],
      assigneeRole: "Business Owner",
      questions: [
        { id: "total_investment", question: "Total 5-year investment amount ($)?", type: "number" },
        { id: "investment_by_year", question: "Investment by year breakdown?", type: "text" },
        { id: "section_complete", question: "Investment Data section complete?", type: "boolean" }
      ],
      estimatedDays: 3,
      category: "Application"
    },
    {
      stepNumber: 15,
      title: "Complete Application - Credit Request Section",
      description: "Enter requested credit amount. Minimum request is $20,000. Credit is allocated over 5-year agreement.",
      requiredDocs: ["Credit request calculation"],
      dependencies: [10, 5],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "total_credit_request", question: "Total credit amount requested ($)?", type: "number" },
        { id: "annual_allocation", question: "Proposed annual allocation?", type: "text" },
        { id: "section_complete", question: "Credit Request section complete?", type: "boolean" }
      ],
      estimatedDays: 2,
      category: "Application"
    },
    {
      stepNumber: 16,
      title: "Complete Application - Certifications Section",
      description: "Complete required certifications including accuracy of information, out-of-state certification (if applicable).",
      requiredDocs: ["Signed certifications"],
      dependencies: [11, 12, 13, 14, 15],
      assigneeRole: "Business Owner",
      questions: [
        { id: "accuracy_certified", question: "Accuracy of information certified?", type: "boolean" },
        { id: "out_of_state_certified", question: "Out-of-state certification (if applicable)?", type: "boolean" },
        { id: "section_complete", question: "All certifications complete?", type: "boolean" }
      ],
      estimatedDays: 1,
      category: "Application"
    },
    {
      stepNumber: 17,
      title: "Review Application with Tax Advisor",
      description: "Full application review before submission. Check all numbers, narratives, and certifications.",
      requiredDocs: ["Application review checklist"],
      dependencies: [16],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "advisor_reviewed", question: "Tax advisor completed review?", type: "boolean" },
        { id: "changes_needed", question: "Any changes recommended?", type: "text" },
        { id: "ready_to_submit", question: "Application ready to submit?", type: "boolean" }
      ],
      estimatedDays: 3,
      category: "Application"
    },
    {
      stepNumber: 18,
      title: "Submit Application Before Deadline",
      description: "Submit completed application through calcompetes.ca.gov before window closes. Save confirmation.",
      requiredDocs: ["Application submission confirmation", "PDF copy of submitted application"],
      dependencies: [17],
      assigneeRole: "Business Owner",
      questions: [
        { id: "submitted", question: "Application submitted?", type: "boolean" },
        { id: "submission_date", question: "Date/time submitted?", type: "date" },
        { id: "confirmation_number", question: "Confirmation/reference number?", type: "text" }
      ],
      estimatedDays: 1,
      category: "Application"
    },

    // ===== PHASE I REVIEW =====
    {
      stepNumber: 19,
      title: "Await Phase I Results",
      description: "GO-Biz calculates cost-benefit ratios and ranks applications. Top applicants advance to Phase II.",
      requiredDocs: [],
      dependencies: [18],
      assigneeRole: "Business Owner",
      questions: [
        { id: "phase1_result", question: "Phase I result (Advanced/Not Advanced)?", type: "text" },
        { id: "notification_date", question: "Date notified of result?", type: "date" }
      ],
      estimatedDays: 30,
      category: "Review"
    },

    // ===== PHASE II REVIEW (if advanced) =====
    {
      stepNumber: 20,
      title: "Prepare Letters of Support",
      description: "If advancing to Phase II, prepare letters of support from local officials, economic development agencies, partners.",
      requiredDocs: ["Letters of support"],
      dependencies: [19],
      assigneeRole: "Business Owner",
      questions: [
        { id: "letters_obtained", question: "How many letters of support obtained?", type: "number" },
        { id: "letter_sources", question: "Sources of letters (Mayor, EDC, etc.)?", type: "text" }
      ],
      estimatedDays: 14,
      category: "Phase II"
    },
    {
      stepNumber: 21,
      title: "Upload Supporting Documents",
      description: "Upload letters of support and any additional documentation to the application portal.",
      requiredDocs: ["Uploaded document confirmations"],
      dependencies: [20],
      assigneeRole: "Business Owner",
      questions: [
        { id: "documents_uploaded", question: "All supporting documents uploaded?", type: "boolean" },
        { id: "upload_date", question: "Date uploaded?", type: "date" }
      ],
      estimatedDays: 3,
      category: "Phase II"
    },
    {
      stepNumber: 22,
      title: "Await Phase II Evaluation",
      description: "GO-Biz evaluates 14 factors including job creation, compensation, strategic importance, regional impact, training opportunities.",
      requiredDocs: [],
      dependencies: [21],
      assigneeRole: "Business Owner",
      questions: [
        { id: "phase2_result", question: "Phase II result?", type: "text" },
        { id: "selected_for_agreement", question: "Selected for agreement negotiation?", type: "boolean" }
      ],
      estimatedDays: 45,
      category: "Phase II"
    },

    // ===== AGREEMENT NEGOTIATION =====
    {
      stepNumber: 23,
      title: "Negotiate Agreement Terms with GO-Biz",
      description: "Work with GO-Biz to establish 5-year milestones for FTEs, salaries, and investment. Agreement is binding.",
      requiredDocs: ["Draft agreement", "Milestone schedule"],
      dependencies: [22],
      assigneeRole: "Business Owner",
      questions: [
        { id: "year1_fte_milestone", question: "Year 1 FTE milestone?", type: "number" },
        { id: "year1_investment_milestone", question: "Year 1 investment milestone ($)?", type: "number" },
        { id: "year5_fte_milestone", question: "Year 5 cumulative FTE milestone?", type: "number" },
        { id: "negotiations_complete", question: "Agreement terms finalized?", type: "boolean" }
      ],
      estimatedDays: 30,
      category: "Agreement"
    },
    {
      stepNumber: 24,
      title: "Legal Review of Agreement",
      description: "Have business attorney review agreement terms, obligations, and recapture provisions before signing.",
      requiredDocs: ["Attorney review memo"],
      dependencies: [23],
      assigneeRole: "Attorney",
      questions: [
        { id: "attorney_reviewed", question: "Attorney completed review?", type: "boolean" },
        { id: "concerns_raised", question: "Any concerns raised?", type: "text" },
        { id: "approved_to_sign", question: "Approved to sign?", type: "boolean" }
      ],
      estimatedDays: 7,
      category: "Agreement"
    },
    {
      stepNumber: 25,
      title: "Sign Tax Credit Agreement",
      description: "Execute the California Competes Tax Credit agreement with GO-Biz.",
      requiredDocs: ["Signed agreement copy"],
      dependencies: [24],
      assigneeRole: "Business Owner",
      questions: [
        { id: "agreement_signed", question: "Agreement signed?", type: "boolean" },
        { id: "agreement_date", question: "Agreement date?", type: "date" },
        { id: "agreement_number", question: "Agreement/Contract number?", type: "text" }
      ],
      estimatedDays: 3,
      category: "Agreement"
    },

    // ===== COMMITTEE APPROVAL =====
    {
      stepNumber: 26,
      title: "Await Committee Approval",
      description: "The California Competes Tax Credit Committee reviews and approves negotiated agreements.",
      requiredDocs: [],
      dependencies: [25],
      assigneeRole: "Business Owner",
      questions: [
        { id: "committee_approved", question: "Committee approved the agreement?", type: "boolean" },
        { id: "approval_date", question: "Committee approval date?", type: "date" },
        { id: "final_credit_amount", question: "Final approved credit amount ($)?", type: "number" }
      ],
      estimatedDays: 30,
      category: "Approval"
    },

    // ===== ANNUAL COMPLIANCE (Years 1-5) =====
    {
      stepNumber: 27,
      title: "Year 1 - Meet Milestones",
      description: "Achieve Year 1 FTE, salary, and investment milestones as specified in agreement.",
      requiredDocs: ["Payroll reports", "Investment documentation", "Capitalized cost schedules"],
      dependencies: [26],
      assigneeRole: "Business Owner",
      questions: [
        { id: "y1_fte_achieved", question: "Year 1 FTE milestone achieved?", type: "boolean" },
        { id: "y1_investment_achieved", question: "Year 1 investment milestone achieved?", type: "boolean" },
        { id: "y1_salary_achieved", question: "Year 1 salary requirements met?", type: "boolean" }
      ],
      estimatedDays: 365,
      category: "Compliance"
    },
    {
      stepNumber: 28,
      title: "Year 1 - File Annual Compliance Report",
      description: "Submit annual report to GO-Biz documenting milestone achievement. Required to claim credit.",
      requiredDocs: ["GO-Biz annual compliance report"],
      dependencies: [27],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "y1_report_filed", question: "Year 1 report filed with GO-Biz?", type: "boolean" },
        { id: "y1_report_date", question: "Date filed?", type: "date" }
      ],
      estimatedDays: 30,
      category: "Compliance"
    },
    {
      stepNumber: 29,
      title: "Year 1 - Claim Credit on Tax Return",
      description: "File FTB Form 3531 with California tax return to claim earned credit for Year 1.",
      requiredDocs: ["FTB 3531", "California tax return"],
      dependencies: [28],
      assigneeRole: "Tax Advisor",
      questions: [
        { id: "y1_3531_filed", question: "FTB 3531 filed for Year 1?", type: "boolean" },
        { id: "y1_credit_claimed", question: "Credit amount claimed ($)?", type: "number" },
        { id: "y1_return_date", question: "Tax return filing date?", type: "date" }
      ],
      estimatedDays: 90,
      category: "Tax Filing"
    },
    {
      stepNumber: 30,
      title: "Maintain Compliance Records",
      description: "Maintain complete records for potential FTB review: payroll reports, invoices, contracts, deeds, leases, depreciation schedules, general ledger.",
      requiredDocs: ["Organized compliance documentation"],
      dependencies: [29],
      assigneeRole: "Business Owner",
      questions: [
        { id: "records_organized", question: "All compliance records organized and accessible?", type: "boolean" },
        { id: "storage_location", question: "Where are records stored?", type: "text" }
      ],
      estimatedDays: 14,
      category: "Compliance"
    },
    {
      stepNumber: 31,
      title: "Complete 5-Year Agreement",
      description: "Successfully complete all 5 years of milestones and annual reporting. Maintain post-achievement employment for 3 additional years to avoid recapture.",
      requiredDocs: ["All 5 years annual reports", "All 5 years FTB 3531 forms"],
      dependencies: [30],
      assigneeRole: "Business Owner",
      questions: [
        { id: "all_years_complete", question: "All 5 years of milestones achieved?", type: "boolean" },
        { id: "total_credit_received", question: "Total credit received over 5 years ($)?", type: "number" },
        { id: "compliance_notes", question: "Any compliance issues during program?", type: "text" }
      ],
      estimatedDays: 1825,
      category: "Final Review"
    }
  ];

  const result = createWorkflowTemplate(
    'CalCompete Tax Credit Application',
    'California Competes Tax Credit application workflow. Covers pre-application analysis, online application, Phase I/II review, agreement negotiation, committee approval, and 5-year compliance. Based on GO-Biz requirements.',
    steps
  );

  SpreadsheetApp.getUi().alert(
    'Template Installed',
    `CalCompete Tax Credit Application template installed successfully!\n\n` +
    `Template ID: ${result.templateId}\n` +
    `Steps: ${result.stepCount}\n\n` +
    `Go to Workflow > Start Workflow to begin a new workflow for a client.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return result;
}
