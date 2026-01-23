/**
 * Newton_WorkflowUI.gs - Guided Compliance Workflow Interface
 *
 * A dead-simple web UI for compliance workflows:
 * 1. Pick a workflow (ISO 42001, CalCompete, CA Residency)
 * 2. Follow the steps
 * 3. Upload documents / answer questions
 * 4. See your progress + integrity hash
 *
 * Designed for people who don't know what a spreadsheet is.
 *
 * @version 1.0.0
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doGet(e) {
  const html = HtmlService.createHtmlOutput(getWorkflowUIHtml_())
    .setTitle('Newton Compliance')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return html;
}

// ============================================================================
// API FUNCTIONS (called from frontend)
// ============================================================================

/**
 * Get current user info
 */
function WorkflowUI_getUser() {
  return {
    email: Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'anonymous',
    name: Session.getActiveUser().getEmail().split('@')[0] || 'User'
  };
}

/**
 * Get available workflow templates
 */
function WorkflowUI_getTemplates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const templateSheet = ss.getSheetByName('Workflow_Templates');

  if (!templateSheet || templateSheet.getLastRow() < 2) {
    // Return built-in templates if sheet doesn't exist
    return [
      {
        id: 'ISO_42001',
        name: 'ISO 42001 AI Management System',
        description: 'Complete compliance checklist for ISO/IEC 42001 AI governance standard',
        stepCount: 24,
        estimatedTime: '2-4 weeks',
        category: 'AI Governance'
      },
      {
        id: 'CALCOMPETE',
        name: 'CalCompete Tax Credit',
        description: 'California Competes tax credit application workflow',
        stepCount: 15,
        estimatedTime: '1-2 weeks',
        category: 'Tax Incentives'
      },
      {
        id: 'CA_RESIDENCY',
        name: 'California Residency Determination',
        description: 'Tax residency determination checklist for California',
        stepCount: 12,
        estimatedTime: '1 week',
        category: 'Tax Compliance'
      },
      {
        id: 'EU_AI_ACT',
        name: 'EU AI Act Compliance',
        description: 'European Union AI Act compliance assessment',
        stepCount: 21,
        estimatedTime: '3-6 weeks',
        category: 'AI Governance'
      }
    ];
  }

  // Read from sheet
  const data = templateSheet.getDataRange().getValues();
  const headers = data[0];
  const templates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    templates.push({
      id: row[headers.indexOf('Template_ID')] || row[0],
      name: row[headers.indexOf('Name')] || row[1],
      description: row[headers.indexOf('Description')] || row[2],
      stepCount: parseInt(row[headers.indexOf('Step_Count')]) || 0,
      estimatedTime: row[headers.indexOf('Estimated_Time')] || 'Varies',
      category: row[headers.indexOf('Category')] || 'General'
    });
  }

  return templates;
}

/**
 * Get active workflows for current user
 */
function WorkflowUI_getMyWorkflows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  const userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();

  if (!workflowSheet || workflowSheet.getLastRow() < 2) {
    return [];
  }

  const data = workflowSheet.getDataRange().getValues();
  const headers = data[0];
  const workflows = [];

  const idCol = headers.indexOf('Workflow_ID');
  const templateCol = headers.indexOf('Template_ID');
  const clientCol = headers.indexOf('Client_Name');
  const statusCol = headers.indexOf('Status');
  const progressCol = headers.indexOf('Progress');
  const createdCol = headers.indexOf('Created_At');
  const assigneeCol = headers.indexOf('Assignee');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[statusCol];

    // Show active workflows (not completed/archived)
    if (status === 'IN_PROGRESS' || status === 'ACTIVE' || status === 'PENDING') {
      workflows.push({
        id: row[idCol],
        templateId: row[templateCol],
        clientName: row[clientCol] || 'Unnamed',
        status: status,
        progress: parseInt(row[progressCol]) || 0,
        createdAt: row[createdCol],
        assignee: row[assigneeCol]
      });
    }
  }

  return workflows;
}

/**
 * Start a new workflow
 */
function WorkflowUI_startWorkflow(templateId, clientName) {
  const workflowId = 'WF_' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  const now = new Date().toISOString();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let workflowSheet = ss.getSheetByName('Workflow_Instances');

  // Create sheet if it doesn't exist
  if (!workflowSheet) {
    workflowSheet = ss.insertSheet('Workflow_Instances');
    const headers = ['Workflow_ID', 'Template_ID', 'Client_Name', 'Status', 'Progress', 'Created_At', 'Assignee', 'Completed_Steps', 'Total_Steps'];
    workflowSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    workflowSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    workflowSheet.setFrozenRows(1);
  }

  // Get template step count
  const templates = WorkflowUI_getTemplates();
  const template = templates.find(t => t.id === templateId);
  const totalSteps = template ? template.stepCount : 10;

  // Add workflow
  workflowSheet.appendRow([
    workflowId,
    templateId,
    clientName,
    'IN_PROGRESS',
    0,
    now,
    userEmail,
    0,
    totalSteps
  ]);

  // Initialize steps
  initializeWorkflowSteps_(workflowId, templateId);

  // Log to audit ledger
  logWorkflowEvent_(workflowId, 'WORKFLOW_STARTED', {
    templateId: templateId,
    clientName: clientName,
    startedBy: userEmail
  });

  return {
    success: true,
    workflowId: workflowId,
    message: 'Workflow started successfully'
  };
}

/**
 * Get workflow details with steps
 */
function WorkflowUI_getWorkflowDetails(workflowId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  const stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!workflowSheet) {
    return { error: 'No workflows found' };
  }

  // Find workflow
  const wfData = workflowSheet.getDataRange().getValues();
  const wfHeaders = wfData[0];
  let workflow = null;

  for (let i = 1; i < wfData.length; i++) {
    if (wfData[i][wfHeaders.indexOf('Workflow_ID')] === workflowId) {
      workflow = {
        id: wfData[i][wfHeaders.indexOf('Workflow_ID')],
        templateId: wfData[i][wfHeaders.indexOf('Template_ID')],
        clientName: wfData[i][wfHeaders.indexOf('Client_Name')],
        status: wfData[i][wfHeaders.indexOf('Status')],
        progress: parseInt(wfData[i][wfHeaders.indexOf('Progress')]) || 0,
        completedSteps: parseInt(wfData[i][wfHeaders.indexOf('Completed_Steps')]) || 0,
        totalSteps: parseInt(wfData[i][wfHeaders.indexOf('Total_Steps')]) || 0,
        createdAt: wfData[i][wfHeaders.indexOf('Created_At')]
      };
      break;
    }
  }

  if (!workflow) {
    return { error: 'Workflow not found' };
  }

  // Get steps
  workflow.steps = [];

  if (stepsSheet && stepsSheet.getLastRow() > 1) {
    const stepData = stepsSheet.getDataRange().getValues();
    const stepHeaders = stepData[0];

    for (let i = 1; i < stepData.length; i++) {
      if (stepData[i][stepHeaders.indexOf('Workflow_ID')] === workflowId) {
        workflow.steps.push({
          stepNumber: parseInt(stepData[i][stepHeaders.indexOf('Step_Number')]) || i,
          title: stepData[i][stepHeaders.indexOf('Title')],
          description: stepData[i][stepHeaders.indexOf('Description')],
          status: stepData[i][stepHeaders.indexOf('Status')] || 'PENDING',
          evidenceRequired: stepData[i][stepHeaders.indexOf('Evidence_Required')] === true || stepData[i][stepHeaders.indexOf('Evidence_Required')] === 'TRUE',
          evidenceUploaded: stepData[i][stepHeaders.indexOf('Evidence_Uploaded')] || '',
          completedAt: stepData[i][stepHeaders.indexOf('Completed_At')],
          notes: stepData[i][stepHeaders.indexOf('Notes')]
        });
      }
    }

    // Sort by step number
    workflow.steps.sort((a, b) => a.stepNumber - b.stepNumber);
  }

  // If no steps found, generate from template
  if (workflow.steps.length === 0) {
    workflow.steps = getTemplateSteps_(workflow.templateId);
  }

  return workflow;
}

/**
 * Complete a workflow step
 */
function WorkflowUI_completeStep(workflowId, stepNumber, notes, evidenceUrl) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stepsSheet = ss.getSheetByName('Workflow_Steps');
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  const now = new Date().toISOString();
  const userEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();

  if (!stepsSheet) {
    return { success: false, error: 'Steps sheet not found' };
  }

  // Find and update step
  const data = stepsSheet.getDataRange().getValues();
  const headers = data[0];
  let updated = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][headers.indexOf('Workflow_ID')] === workflowId &&
        parseInt(data[i][headers.indexOf('Step_Number')]) === stepNumber) {

      const statusCol = headers.indexOf('Status') + 1;
      const completedCol = headers.indexOf('Completed_At') + 1;
      const notesCol = headers.indexOf('Notes') + 1;
      const evidenceCol = headers.indexOf('Evidence_Uploaded') + 1;
      const completedByCol = headers.indexOf('Completed_By') + 1;

      stepsSheet.getRange(i + 1, statusCol).setValue('COMPLETED');
      stepsSheet.getRange(i + 1, completedCol).setValue(now);
      if (notesCol > 0) stepsSheet.getRange(i + 1, notesCol).setValue(notes || '');
      if (evidenceCol > 0) stepsSheet.getRange(i + 1, evidenceCol).setValue(evidenceUrl || '');
      if (completedByCol > 0) stepsSheet.getRange(i + 1, completedByCol).setValue(userEmail);

      updated = true;
      break;
    }
  }

  // Update workflow progress
  updateWorkflowProgress_(workflowId);

  // Log to audit ledger
  logWorkflowEvent_(workflowId, 'STEP_COMPLETED', {
    stepNumber: stepNumber,
    completedBy: userEmail,
    hasEvidence: !!evidenceUrl
  });

  return {
    success: updated,
    message: updated ? 'Step completed' : 'Step not found'
  };
}

/**
 * Upload evidence for a step
 */
function WorkflowUI_uploadEvidence(workflowId, stepNumber, fileData, fileName) {
  try {
    // Decode base64 file data
    const blob = Utilities.newBlob(Utilities.base64Decode(fileData), MimeType.PDF, fileName);

    // Get or create evidence folder
    const folderId = getEvidenceFolderId_();
    const folder = DriveApp.getFolderById(folderId);

    // Create workflow subfolder
    let wfFolder;
    const wfFolders = folder.getFoldersByName(workflowId);
    if (wfFolders.hasNext()) {
      wfFolder = wfFolders.next();
    } else {
      wfFolder = folder.createFolder(workflowId);
    }

    // Upload file
    const file = wfFolder.createFile(blob);
    const fileUrl = file.getUrl();

    // Update step with evidence URL
    WorkflowUI_completeStep(workflowId, stepNumber, 'Evidence uploaded: ' + fileName, fileUrl);

    return {
      success: true,
      fileUrl: fileUrl,
      fileName: fileName
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * Get compliance summary for a workflow
 */
function WorkflowUI_getComplianceSummary(workflowId) {
  const workflow = WorkflowUI_getWorkflowDetails(workflowId);

  if (workflow.error) {
    return workflow;
  }

  const completed = workflow.steps.filter(s => s.status === 'COMPLETED').length;
  const total = workflow.steps.length;
  const withEvidence = workflow.steps.filter(s => s.status === 'COMPLETED' && s.evidenceUploaded).length;
  const blocked = workflow.steps.filter(s => s.status === 'BLOCKED').length;

  // Calculate integrity hash
  const hashInput = workflow.steps.map(s =>
    s.stepNumber + '|' + s.status + '|' + (s.completedAt || '') + '|' + (s.evidenceUploaded || '')
  ).join('\n');

  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashInput);
  const integrityHash = hash.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');

  return {
    workflowId: workflowId,
    clientName: workflow.clientName,
    templateId: workflow.templateId,
    progress: Math.round((completed / total) * 100),
    completedSteps: completed,
    totalSteps: total,
    stepsWithEvidence: withEvidence,
    blockedSteps: blocked,
    integrityHash: integrityHash.substring(0, 16) + '...',
    fullHash: integrityHash,
    status: completed === total ? 'COMPLETE' : blocked > 0 ? 'BLOCKED' : 'IN_PROGRESS',
    lastUpdated: new Date().toISOString()
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function initializeWorkflowSteps_(workflowId, templateId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!stepsSheet) {
    stepsSheet = ss.insertSheet('Workflow_Steps');
    const headers = ['Workflow_ID', 'Step_Number', 'Title', 'Description', 'Status', 'Evidence_Required', 'Evidence_Uploaded', 'Completed_At', 'Completed_By', 'Notes'];
    stepsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    stepsSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    stepsSheet.setFrozenRows(1);
  }

  // Get template steps
  const steps = getTemplateSteps_(templateId);

  // Add steps to sheet
  steps.forEach((step, index) => {
    stepsSheet.appendRow([
      workflowId,
      index + 1,
      step.title,
      step.description,
      'PENDING',
      step.evidenceRequired ? 'TRUE' : 'FALSE',
      '',
      '',
      '',
      ''
    ]);
  });
}

function getTemplateSteps_(templateId) {
  // Built-in template steps
  const templates = {
    'ISO_42001': [
      { title: 'Define AI Policy', description: 'Establish organizational AI policy aligned with business objectives', evidenceRequired: true },
      { title: 'Risk Assessment', description: 'Identify and assess AI-related risks', evidenceRequired: true },
      { title: 'Define Roles', description: 'Assign AI governance roles and responsibilities', evidenceRequired: true },
      { title: 'Training Plan', description: 'Develop AI competency and training program', evidenceRequired: true },
      { title: 'AI Inventory', description: 'Document all AI systems in use', evidenceRequired: true },
      { title: 'Impact Assessment', description: 'Conduct AI impact assessments', evidenceRequired: true },
      { title: 'Data Governance', description: 'Establish data quality and governance procedures', evidenceRequired: true },
      { title: 'Model Documentation', description: 'Document AI model specifications and limitations', evidenceRequired: true },
      { title: 'Testing Procedures', description: 'Define AI testing and validation procedures', evidenceRequired: true },
      { title: 'Monitoring Plan', description: 'Establish ongoing AI monitoring procedures', evidenceRequired: true },
      { title: 'Incident Response', description: 'Create AI incident response procedures', evidenceRequired: true },
      { title: 'Audit Trail', description: 'Implement audit logging for AI decisions', evidenceRequired: true }
    ],
    'CALCOMPETE': [
      { title: 'Eligibility Check', description: 'Verify business meets CalCompete eligibility requirements', evidenceRequired: false },
      { title: 'Project Description', description: 'Write detailed project narrative', evidenceRequired: true },
      { title: 'Job Creation Plan', description: 'Document job creation commitments', evidenceRequired: true },
      { title: 'Investment Details', description: 'Detail capital investment amounts', evidenceRequired: true },
      { title: 'Location Analysis', description: 'Justify California location choice', evidenceRequired: true },
      { title: 'Economic Impact', description: 'Calculate economic impact metrics', evidenceRequired: true },
      { title: 'Financial Projections', description: 'Prepare 5-year financial projections', evidenceRequired: true },
      { title: 'Supporting Documents', description: 'Gather required supporting documentation', evidenceRequired: true },
      { title: 'Application Review', description: 'Internal review of application', evidenceRequired: false },
      { title: 'Submit Application', description: 'Submit to GO-Biz', evidenceRequired: true }
    ],
    'CA_RESIDENCY': [
      { title: 'Physical Presence', description: 'Document days present in California', evidenceRequired: true },
      { title: 'Domicile Intent', description: 'Assess intent to make CA permanent home', evidenceRequired: false },
      { title: 'Property Ownership', description: 'Document real property ownership', evidenceRequired: true },
      { title: 'Vehicle Registration', description: 'Check vehicle registration state', evidenceRequired: true },
      { title: 'Voter Registration', description: 'Document voter registration', evidenceRequired: true },
      { title: 'Bank Accounts', description: 'Document bank account locations', evidenceRequired: true },
      { title: 'Professional Licenses', description: 'Document professional license states', evidenceRequired: true },
      { title: 'Family Ties', description: 'Document family location and ties', evidenceRequired: false },
      { title: 'Employment Location', description: 'Document primary employment location', evidenceRequired: true },
      { title: 'Final Determination', description: 'Make residency determination', evidenceRequired: false }
    ],
    'EU_AI_ACT': [
      { title: 'AI System Classification', description: 'Determine risk category of AI systems', evidenceRequired: true },
      { title: 'Prohibited Use Check', description: 'Verify no prohibited AI uses', evidenceRequired: true },
      { title: 'High-Risk Assessment', description: 'Complete high-risk AI requirements if applicable', evidenceRequired: true },
      { title: 'Transparency Requirements', description: 'Document transparency obligations', evidenceRequired: true },
      { title: 'Human Oversight', description: 'Implement human oversight mechanisms', evidenceRequired: true },
      { title: 'Data Governance', description: 'Establish compliant data practices', evidenceRequired: true },
      { title: 'Technical Documentation', description: 'Prepare required technical documentation', evidenceRequired: true },
      { title: 'Conformity Assessment', description: 'Complete conformity assessment', evidenceRequired: true },
      { title: 'Registration', description: 'Register in EU AI database if required', evidenceRequired: true },
      { title: 'Ongoing Monitoring', description: 'Establish post-market monitoring', evidenceRequired: true }
    ]
  };

  return templates[templateId] || [
    { title: 'Step 1', description: 'First step', evidenceRequired: false },
    { title: 'Step 2', description: 'Second step', evidenceRequired: false },
    { title: 'Step 3', description: 'Third step', evidenceRequired: false }
  ];
}

function updateWorkflowProgress_(workflowId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const workflowSheet = ss.getSheetByName('Workflow_Instances');
  const stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!workflowSheet || !stepsSheet) return;

  // Count completed steps
  const stepData = stepsSheet.getDataRange().getValues();
  const stepHeaders = stepData[0];
  let completed = 0;
  let total = 0;

  for (let i = 1; i < stepData.length; i++) {
    if (stepData[i][stepHeaders.indexOf('Workflow_ID')] === workflowId) {
      total++;
      if (stepData[i][stepHeaders.indexOf('Status')] === 'COMPLETED') {
        completed++;
      }
    }
  }

  // Update workflow
  const wfData = workflowSheet.getDataRange().getValues();
  const wfHeaders = wfData[0];

  for (let i = 1; i < wfData.length; i++) {
    if (wfData[i][wfHeaders.indexOf('Workflow_ID')] === workflowId) {
      const progressCol = wfHeaders.indexOf('Progress') + 1;
      const completedCol = wfHeaders.indexOf('Completed_Steps') + 1;
      const statusCol = wfHeaders.indexOf('Status') + 1;

      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

      workflowSheet.getRange(i + 1, progressCol).setValue(progress);
      workflowSheet.getRange(i + 1, completedCol).setValue(completed);

      if (progress === 100) {
        workflowSheet.getRange(i + 1, statusCol).setValue('COMPLETED');
      }

      break;
    }
  }
}

function getEvidenceFolderId_() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('EVIDENCE_FOLDER_ID');

  if (!folderId) {
    // Create folder
    const folder = DriveApp.createFolder('Newton_Evidence');
    folderId = folder.getId();
    props.setProperty('EVIDENCE_FOLDER_ID', folderId);
  }

  return folderId;
}

function logWorkflowEvent_(workflowId, eventType, details) {
  try {
    // Try to use existing safeNewEntry if available
    if (typeof safeNewEntry === 'function') {
      safeNewEntry('System', eventType, JSON.stringify(details), workflowId, 'FINAL');
    } else {
      // Fallback to direct logging
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const ledger = ss.getSheetByName('Audit_Ledger');
      if (ledger) {
        const uuid = Utilities.getUuid();
        const ts = new Date().toISOString();
        ledger.appendRow([uuid, ts, 'System', eventType, JSON.stringify(details), workflowId]);
      }
    }
  } catch (e) {
    Logger.log('Failed to log workflow event: ' + e.message);
  }
}

// ============================================================================
// HTML TEMPLATE
// ============================================================================

function getWorkflowUIHtml_() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Newton Compliance</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0a0a0f;
      --bg-card: #12121a;
      --bg-hover: #1a1a25;
      --border: rgba(255,255,255,0.08);
      --text: #ffffff;
      --text-dim: #8b8b9e;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.3);
      --success: #22c55e;
      --warning: #f59e0b;
      --error: #ef4444;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* ========== HEADER ========== */
    .header {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--accent), #a855f7);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .logo-text {
      font-size: 20px;
      font-weight: 700;
    }

    .user-info {
      font-size: 14px;
      color: var(--text-dim);
    }

    /* ========== NAV ========== */
    .nav {
      display: flex;
      gap: 8px;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-card);
    }

    .nav-btn {
      padding: 10px 20px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .nav-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .nav-btn.active {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }

    /* ========== MAIN ========== */
    .main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* ========== VIEW CONTAINERS ========== */
    .view {
      display: none;
    }

    .view.active {
      display: block;
    }

    /* ========== PAGE TITLE ========== */
    .page-title {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .page-subtitle {
      font-size: 16px;
      color: var(--text-dim);
      margin-bottom: 32px;
    }

    /* ========== TEMPLATE GRID ========== */
    .template-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }

    .template-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .template-card:hover {
      transform: translateY(-4px);
      border-color: var(--accent);
      box-shadow: 0 8px 32px var(--accent-glow);
    }

    .template-category {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--accent);
      margin-bottom: 8px;
    }

    .template-name {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .template-desc {
      font-size: 14px;
      color: var(--text-dim);
      margin-bottom: 16px;
      line-height: 1.6;
    }

    .template-meta {
      display: flex;
      gap: 16px;
      font-size: 13px;
      color: var(--text-dim);
    }

    .template-meta span {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ========== WORKFLOW LIST ========== */
    .workflow-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .workflow-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 20px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .workflow-card:hover {
      background: var(--bg-hover);
      border-color: var(--accent);
    }

    .workflow-progress-ring {
      width: 60px;
      height: 60px;
      position: relative;
    }

    .workflow-progress-ring svg {
      transform: rotate(-90deg);
    }

    .workflow-progress-ring .bg {
      fill: none;
      stroke: var(--border);
      stroke-width: 6;
    }

    .workflow-progress-ring .progress {
      fill: none;
      stroke: var(--accent);
      stroke-width: 6;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.5s;
    }

    .workflow-progress-ring .value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 14px;
      font-weight: 600;
    }

    .workflow-info {
      flex: 1;
    }

    .workflow-name {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .workflow-template {
      font-size: 13px;
      color: var(--text-dim);
    }

    .workflow-status {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }

    .workflow-status.in-progress {
      background: rgba(99, 102, 241, 0.15);
      color: var(--accent);
    }

    .workflow-status.complete {
      background: rgba(34, 197, 94, 0.15);
      color: var(--success);
    }

    /* ========== WORKFLOW DETAIL ========== */
    .workflow-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
    }

    .back-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }

    .back-btn:hover {
      background: var(--border);
    }

    .summary-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 20px;
    }

    .summary-item {
      text-align: center;
    }

    .summary-value {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .summary-label {
      font-size: 13px;
      color: var(--text-dim);
    }

    .hash-display {
      background: var(--bg-hover);
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .hash-label {
      font-size: 12px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hash-value {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 12px;
      color: var(--success);
    }

    /* ========== STEPS LIST ========== */
    .steps-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .steps-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .step-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .step-card.completed {
      border-color: var(--success);
      background: rgba(34, 197, 94, 0.05);
    }

    .step-number {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--bg-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .step-card.completed .step-number {
      background: var(--success);
      color: white;
    }

    .step-content {
      flex: 1;
    }

    .step-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .step-desc {
      font-size: 13px;
      color: var(--text-dim);
      margin-bottom: 12px;
    }

    .step-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .step-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }

    .step-btn.primary {
      background: var(--accent);
      color: white;
    }

    .step-btn.primary:hover {
      background: #5558dd;
    }

    .step-btn.secondary {
      background: var(--bg-hover);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .step-btn.secondary:hover {
      background: var(--border);
    }

    .step-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .step-evidence {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }

    .evidence-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(34, 197, 94, 0.15);
      color: var(--success);
      border-radius: 20px;
      font-size: 12px;
    }

    /* ========== MODALS ========== */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s;
    }

    .modal-overlay.active {
      opacity: 1;
      visibility: visible;
    }

    .modal {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 90%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-title {
      font-size: 18px;
      font-weight: 600;
    }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 24px;
      cursor: pointer;
    }

    .modal-body {
      padding: 24px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 8px;
      color: var(--text-dim);
    }

    .form-input {
      width: 100%;
      padding: 12px 16px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
    }

    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .form-textarea {
      min-height: 100px;
      resize: vertical;
    }

    .form-file {
      display: block;
      width: 100%;
      padding: 32px 16px;
      background: var(--bg);
      border: 2px dashed var(--border);
      border-radius: 8px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }

    .form-file:hover {
      border-color: var(--accent);
      background: var(--bg-hover);
    }

    .form-file input {
      display: none;
    }

    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }

    .btn {
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }

    .btn-primary {
      background: var(--accent);
      color: white;
    }

    .btn-primary:hover {
      background: #5558dd;
    }

    .btn-secondary {
      background: var(--bg-hover);
      color: var(--text);
    }

    .btn-secondary:hover {
      background: var(--border);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ========== EMPTY STATE ========== */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
    }

    .empty-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .empty-desc {
      font-size: 14px;
      color: var(--text-dim);
      margin-bottom: 24px;
    }

    /* ========== LOADING ========== */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ========== TOAST ========== */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1001;
    }

    .toast {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideIn 0.3s ease;
      margin-top: 8px;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .toast.success { border-color: var(--success); }
    .toast.error { border-color: var(--error); }

    .toast-icon { font-size: 20px; }
    .toast-message { font-size: 14px; }

    /* ========== RESPONSIVE ========== */
    @media (max-width: 768px) {
      .header { padding: 12px 16px; }
      .nav { padding: 12px 16px; flex-wrap: wrap; }
      .main { padding: 20px 16px; }
      .template-grid { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      .workflow-card { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
  <!-- HEADER -->
  <header class="header">
    <div class="logo">
      <div class="logo-icon">N</div>
      <span class="logo-text">Newton</span>
    </div>
    <div class="user-info" id="userInfo">Loading...</div>
  </header>

  <!-- NAV -->
  <nav class="nav">
    <button class="nav-btn active" data-view="templates" onclick="switchView('templates')">New Workflow</button>
    <button class="nav-btn" data-view="active" onclick="switchView('active')">My Workflows</button>
  </nav>

  <!-- MAIN -->
  <main class="main">
    <!-- TEMPLATES VIEW -->
    <div class="view active" id="view-templates">
      <h1 class="page-title">Start a Compliance Workflow</h1>
      <p class="page-subtitle">Choose a workflow template to begin your compliance journey</p>
      <div class="template-grid" id="templateGrid">
        <div class="loading"><div class="spinner"></div>Loading templates...</div>
      </div>
    </div>

    <!-- ACTIVE WORKFLOWS VIEW -->
    <div class="view" id="view-active">
      <h1 class="page-title">My Workflows</h1>
      <p class="page-subtitle">Continue where you left off</p>
      <div class="workflow-list" id="workflowList">
        <div class="loading"><div class="spinner"></div>Loading workflows...</div>
      </div>
    </div>

    <!-- WORKFLOW DETAIL VIEW -->
    <div class="view" id="view-detail">
      <div class="workflow-header">
        <button class="back-btn" onclick="switchView('active')">
          <span>&larr;</span> Back to Workflows
        </button>
      </div>
      <div id="workflowDetail">
        <div class="loading"><div class="spinner"></div>Loading...</div>
      </div>
    </div>
  </main>

  <!-- START WORKFLOW MODAL -->
  <div class="modal-overlay" id="startModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Start New Workflow</h3>
        <button class="modal-close" onclick="closeModal('startModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Workflow Type</label>
          <div id="selectedTemplateName" style="font-size: 16px; font-weight: 600; margin-bottom: 16px;"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Client / Project Name</label>
          <input type="text" class="form-input" id="clientName" placeholder="e.g., Acme Corp 2026 Assessment">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('startModal')">Cancel</button>
        <button class="btn btn-primary" id="startBtn" onclick="startWorkflow()">Start Workflow</button>
      </div>
    </div>
  </div>

  <!-- COMPLETE STEP MODAL -->
  <div class="modal-overlay" id="completeModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Complete Step</h3>
        <button class="modal-close" onclick="closeModal('completeModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Step</label>
          <div id="completeStepTitle" style="font-size: 16px; font-weight: 600;"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes (optional)</label>
          <textarea class="form-input form-textarea" id="stepNotes" placeholder="Add any relevant notes..."></textarea>
        </div>
        <div class="form-group" id="evidenceGroup" style="display: none;">
          <label class="form-label">Evidence Document</label>
          <label class="form-file">
            <input type="file" id="evidenceFile" accept=".pdf,.doc,.docx,.png,.jpg">
            <span id="fileLabel">Drop file here or click to upload</span>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('completeModal')">Cancel</button>
        <button class="btn btn-primary" id="completeBtn" onclick="completeStep()">Mark Complete</button>
      </div>
    </div>
  </div>

  <!-- TOAST CONTAINER -->
  <div class="toast-container" id="toastContainer"></div>

  <script>
    // ========== STATE ==========
    let currentView = 'templates';
    let templates = [];
    let workflows = [];
    let currentWorkflow = null;
    let selectedTemplate = null;
    let currentStep = null;

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', init);

    function init() {
      loadUser();
      loadTemplates();
      loadWorkflows();

      // File input change handler
      document.getElementById('evidenceFile').addEventListener('change', function(e) {
        const file = e.target.files[0];
        document.getElementById('fileLabel').textContent = file ? file.name : 'Drop file here or click to upload';
      });
    }

    // ========== NAVIGATION ==========
    function switchView(view) {
      currentView = view;

      // Update nav
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
      });

      // Update views
      document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === 'view-' + view);
      });

      // Refresh data if needed
      if (view === 'active') loadWorkflows();
    }

    // ========== LOAD DATA ==========
    function loadUser() {
      google.script.run
        .withSuccessHandler(user => {
          document.getElementById('userInfo').textContent = user.email;
        })
        .withFailureHandler(err => {
          document.getElementById('userInfo').textContent = 'Not signed in';
        })
        .WorkflowUI_getUser();
    }

    function loadTemplates() {
      google.script.run
        .withSuccessHandler(renderTemplates)
        .withFailureHandler(err => {
          document.getElementById('templateGrid').innerHTML =
            '<div class="empty-state"><div class="empty-icon">&#x26A0;</div><div class="empty-title">Failed to load</div><div class="empty-desc">' + err.message + '</div></div>';
        })
        .WorkflowUI_getTemplates();
    }

    function loadWorkflows() {
      google.script.run
        .withSuccessHandler(renderWorkflows)
        .withFailureHandler(err => {
          document.getElementById('workflowList').innerHTML =
            '<div class="empty-state"><div class="empty-icon">&#x26A0;</div><div class="empty-title">Failed to load</div><div class="empty-desc">' + err.message + '</div></div>';
        })
        .WorkflowUI_getMyWorkflows();
    }

    function loadWorkflowDetail(workflowId) {
      document.getElementById('workflowDetail').innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
      switchView('detail');

      google.script.run
        .withSuccessHandler(workflow => {
          currentWorkflow = workflow;
          renderWorkflowDetail(workflow);
        })
        .withFailureHandler(err => {
          document.getElementById('workflowDetail').innerHTML =
            '<div class="empty-state"><div class="empty-icon">&#x26A0;</div><div class="empty-title">Failed to load</div><div class="empty-desc">' + err.message + '</div></div>';
        })
        .WorkflowUI_getWorkflowDetails(workflowId);
    }

    // ========== RENDER ==========
    function renderTemplates(data) {
      templates = data;

      if (!data || data.length === 0) {
        document.getElementById('templateGrid').innerHTML =
          '<div class="empty-state"><div class="empty-icon">&#x1F4CB;</div><div class="empty-title">No templates available</div><div class="empty-desc">Contact your administrator to set up workflow templates.</div></div>';
        return;
      }

      document.getElementById('templateGrid').innerHTML = data.map(t => \`
        <div class="template-card" onclick="selectTemplate('\${t.id}')">
          <div class="template-category">\${t.category}</div>
          <div class="template-name">\${t.name}</div>
          <div class="template-desc">\${t.description}</div>
          <div class="template-meta">
            <span>&#x1F4DD; \${t.stepCount} steps</span>
            <span>&#x23F1; \${t.estimatedTime}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderWorkflows(data) {
      workflows = data;

      if (!data || data.length === 0) {
        document.getElementById('workflowList').innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon">&#x1F4C2;</div>' +
            '<div class="empty-title">No active workflows</div>' +
            '<div class="empty-desc">Start a new workflow to track your compliance progress.</div>' +
            '<button class="btn btn-primary" onclick="switchView(\\'templates\\')">Start New Workflow</button>' +
          '</div>';
        return;
      }

      document.getElementById('workflowList').innerHTML = data.map(w => {
        const circumference = 2 * Math.PI * 24;
        const offset = circumference - (w.progress / 100) * circumference;

        return \`
          <div class="workflow-card" onclick="loadWorkflowDetail('\${w.id}')">
            <div class="workflow-progress-ring">
              <svg viewBox="0 0 60 60">
                <circle class="bg" cx="30" cy="30" r="24"/>
                <circle class="progress" cx="30" cy="30" r="24"
                  stroke-dasharray="\${circumference}"
                  stroke-dashoffset="\${offset}"/>
              </svg>
              <span class="value">\${w.progress}%</span>
            </div>
            <div class="workflow-info">
              <div class="workflow-name">\${w.clientName}</div>
              <div class="workflow-template">\${w.templateId}</div>
            </div>
            <div class="workflow-status \${w.status === 'COMPLETED' ? 'complete' : 'in-progress'}">
              \${w.status === 'COMPLETED' ? 'Complete' : 'In Progress'}
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderWorkflowDetail(workflow) {
      if (workflow.error) {
        document.getElementById('workflowDetail').innerHTML =
          '<div class="empty-state"><div class="empty-icon">&#x26A0;</div><div class="empty-title">' + workflow.error + '</div></div>';
        return;
      }

      const completedSteps = workflow.steps.filter(s => s.status === 'COMPLETED').length;
      const totalSteps = workflow.steps.length;
      const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
      const withEvidence = workflow.steps.filter(s => s.status === 'COMPLETED' && s.evidenceUploaded).length;

      // Calculate hash
      const hashInput = workflow.steps.map(s =>
        s.stepNumber + '|' + s.status + '|' + (s.completedAt || '')
      ).join('|');

      let html = \`
        <h1 class="page-title">\${workflow.clientName}</h1>
        <p class="page-subtitle">\${workflow.templateId}</p>

        <div class="summary-card">
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-value">\${progress}%</div>
              <div class="summary-label">Complete</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">\${completedSteps}/\${totalSteps}</div>
              <div class="summary-label">Steps Done</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">\${withEvidence}</div>
              <div class="summary-label">With Evidence</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">\${totalSteps - completedSteps}</div>
              <div class="summary-label">Remaining</div>
            </div>
          </div>
          <div class="hash-display">
            <div class="hash-label">&#x1F512; Integrity Hash</div>
            <div class="hash-value" id="integrityHash">Calculating...</div>
          </div>
        </div>

        <h2 class="steps-title">Steps</h2>
        <div class="steps-list">
      \`;

      workflow.steps.forEach((step, index) => {
        const isCompleted = step.status === 'COMPLETED';

        html += \`
          <div class="step-card \${isCompleted ? 'completed' : ''}">
            <div class="step-number">\${isCompleted ? '&#x2713;' : (index + 1)}</div>
            <div class="step-content">
              <div class="step-title">\${step.title}</div>
              <div class="step-desc">\${step.description}</div>
              \${!isCompleted ? \`
                <div class="step-actions">
                  <button class="step-btn primary" onclick="openCompleteModal(\${index + 1}, '\${escapeJs(step.title)}', \${step.evidenceRequired})">
                    Mark Complete
                  </button>
                  \${step.evidenceRequired ? '<span style="font-size: 12px; color: var(--text-dim);">Evidence required</span>' : ''}
                </div>
              \` : \`
                <div class="step-evidence">
                  <span class="evidence-badge">&#x2713; Completed\${step.evidenceUploaded ? ' with evidence' : ''}</span>
                </div>
              \`}
            </div>
          </div>
        \`;
      });

      html += '</div>';

      document.getElementById('workflowDetail').innerHTML = html;

      // Get compliance summary for hash
      google.script.run
        .withSuccessHandler(summary => {
          document.getElementById('integrityHash').textContent = summary.integrityHash;
        })
        .WorkflowUI_getComplianceSummary(workflow.id);
    }

    // ========== ACTIONS ==========
    function selectTemplate(templateId) {
      selectedTemplate = templates.find(t => t.id === templateId);
      document.getElementById('selectedTemplateName').textContent = selectedTemplate.name;
      document.getElementById('clientName').value = '';
      openModal('startModal');
    }

    function startWorkflow() {
      const clientName = document.getElementById('clientName').value.trim();

      if (!clientName) {
        showToast('Please enter a client/project name', 'error');
        return;
      }

      const btn = document.getElementById('startBtn');
      btn.disabled = true;
      btn.textContent = 'Starting...';

      google.script.run
        .withSuccessHandler(result => {
          btn.disabled = false;
          btn.textContent = 'Start Workflow';
          closeModal('startModal');

          if (result.success) {
            showToast('Workflow started!', 'success');
            loadWorkflowDetail(result.workflowId);
          } else {
            showToast(result.error || 'Failed to start workflow', 'error');
          }
        })
        .withFailureHandler(err => {
          btn.disabled = false;
          btn.textContent = 'Start Workflow';
          showToast(err.message, 'error');
        })
        .WorkflowUI_startWorkflow(selectedTemplate.id, clientName);
    }

    function openCompleteModal(stepNumber, stepTitle, evidenceRequired) {
      currentStep = { number: stepNumber, title: stepTitle, evidenceRequired: evidenceRequired };
      document.getElementById('completeStepTitle').textContent = stepNumber + '. ' + stepTitle;
      document.getElementById('stepNotes').value = '';
      document.getElementById('evidenceFile').value = '';
      document.getElementById('fileLabel').textContent = 'Drop file here or click to upload';
      document.getElementById('evidenceGroup').style.display = evidenceRequired ? 'block' : 'none';
      openModal('completeModal');
    }

    function completeStep() {
      const notes = document.getElementById('stepNotes').value;
      const fileInput = document.getElementById('evidenceFile');
      const file = fileInput.files[0];

      const btn = document.getElementById('completeBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      if (file && currentStep.evidenceRequired) {
        // Upload file first
        const reader = new FileReader();
        reader.onload = function(e) {
          const base64 = e.target.result.split(',')[1];

          google.script.run
            .withSuccessHandler(result => {
              btn.disabled = false;
              btn.textContent = 'Mark Complete';
              closeModal('completeModal');

              if (result.success) {
                showToast('Step completed with evidence!', 'success');
                loadWorkflowDetail(currentWorkflow.id);
              } else {
                showToast(result.error || 'Failed', 'error');
              }
            })
            .withFailureHandler(err => {
              btn.disabled = false;
              btn.textContent = 'Mark Complete';
              showToast(err.message, 'error');
            })
            .WorkflowUI_uploadEvidence(currentWorkflow.id, currentStep.number, base64, file.name);
        };
        reader.readAsDataURL(file);
      } else {
        // Just complete without file
        google.script.run
          .withSuccessHandler(result => {
            btn.disabled = false;
            btn.textContent = 'Mark Complete';
            closeModal('completeModal');

            if (result.success) {
              showToast('Step completed!', 'success');
              loadWorkflowDetail(currentWorkflow.id);
            } else {
              showToast(result.error || 'Failed', 'error');
            }
          })
          .withFailureHandler(err => {
            btn.disabled = false;
            btn.textContent = 'Mark Complete';
            showToast(err.message, 'error');
          })
          .WorkflowUI_completeStep(currentWorkflow.id, currentStep.number, notes, '');
      }
    }

    // ========== MODALS ==========
    function openModal(id) {
      document.getElementById(id).classList.add('active');
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('active');
    }

    // ========== TOAST ==========
    function showToast(message, type) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + (type || 'info');
      toast.innerHTML = \`
        <span class="toast-icon">\${type === 'success' ? '&#x2713;' : type === 'error' ? '&#x2717;' : 'i'}</span>
        <span class="toast-message">\${message}</span>
      \`;
      container.appendChild(toast);

      setTimeout(() => toast.remove(), 4000);
    }

    // ========== UTILS ==========
    function escapeJs(str) {
      return str.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"');
    }
  </script>
</body>
</html>`;
}

// ============================================================================
// MENU FUNCTIONS
// ============================================================================

function openWorkflowUI_() {
  const url = ScriptApp.getService().getUrl();
  if (url) {
    const html = HtmlService.createHtmlOutput(
      '<script>window.open("' + url + '", "_blank");google.script.host.close();</script>'
    );
    SpreadsheetApp.getUi().showModalDialog(html, 'Opening Workflow UI...');
  } else {
    SpreadsheetApp.getUi().alert(
      'Deploy Required',
      'Deploy this script as a web app first:\n\n' +
      '1. Deploy > New deployment\n' +
      '2. Select "Web app"\n' +
      '3. Execute as: Me\n' +
      '4. Who has access: Anyone within your domain\n' +
      '5. Deploy and copy the URL',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}
