/**
 * Newton_WorkflowView.gs - Dedicated Workflow Execution Page
 *
 * PURPOSE:
 *   Full-page view for working through a single workflow.
 *   Shows all steps, progress bars, document uploads, notes, and deadline tracking.
 *   Linked from the main dashboard - opens in new tab.
 *
 * AUTHOR: George Abrahamyan - Newton AI Governance Platform
 * VERSION: 1.0.0
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doGetWorkflowView(e) {
  const workflowId = e.parameter.workflowId;

  if (!workflowId) {
    return HtmlService.createHtmlOutput('<h1>Error: No workflow ID provided</h1><p><a href="javascript:window.close()">Close</a></p>');
  }

  const workflowData = getWorkflowViewData_(workflowId);

  if (!workflowData) {
    return HtmlService.createHtmlOutput('<h1>Error: Workflow not found</h1><p><a href="javascript:window.close()">Close</a></p>');
  }

  const template = HtmlService.createTemplate(getWorkflowViewHTML_());
  template.data = JSON.stringify(workflowData);
  template.workflowId = workflowId;

  return template.evaluate()
    .setTitle(workflowData.clientName + ' - ' + workflowData.templateName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================================
// DATA FETCHING
// ============================================================================

function getWorkflowViewData_(workflowId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const instanceSheet = ss.getSheetByName('Workflow_Instances');
  const stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!instanceSheet || !stepsSheet) {
    return null;
  }

  // Get workflow instance
  const instanceData = instanceSheet.getDataRange().getValues();
  const instanceHeaders = instanceData[0];
  let workflow = null;

  for (let i = 1; i < instanceData.length; i++) {
    const row = instanceData[i];
    const rowObj = {};
    instanceHeaders.forEach((h, idx) => rowObj[h] = row[idx]);

    if (rowObj.workflowId === workflowId) {
      workflow = rowObj;
      break;
    }
  }

  if (!workflow) {
    return null;
  }

  // Get all steps for this workflow
  const stepsData = stepsSheet.getDataRange().getValues();
  const stepsHeaders = stepsData[0];
  const steps = [];

  for (let i = 1; i < stepsData.length; i++) {
    const row = stepsData[i];
    const rowObj = {};
    stepsHeaders.forEach((h, idx) => rowObj[h] = row[idx]);

    if (rowObj.workflowId === workflowId) {
      steps.push({
        stepId: rowObj.stepId,
        stepNumber: rowObj.stepNumber,
        title: rowObj.title,
        description: rowObj.description,
        status: rowObj.status || 'PENDING',
        assignee: rowObj.assignee || '',
        notes: rowObj.notes || '',
        documentLinks: rowObj.documentLinks || '',
        completedDate: rowObj.completedDate || '',
        dueDate: rowObj.dueDate || '',
        category: rowObj.category || ''
      });
    }
  }

  // Sort by step number
  steps.sort((a, b) => a.stepNumber - b.stepNumber);

  // Calculate progress
  const totalSteps = steps.length;
  const completedSteps = steps.filter(s => s.status === 'COMPLETED').length;
  const blockedSteps = steps.filter(s => s.status === 'BLOCKED').length;
  const inProgressSteps = steps.filter(s => s.status === 'IN_PROGRESS').length;
  const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Calculate time remaining
  const startDate = workflow.startDate ? new Date(workflow.startDate) : new Date();
  const dueDate = workflow.dueDate ? new Date(workflow.dueDate) : null;
  let daysRemaining = null;
  let daysElapsed = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));

  if (dueDate) {
    daysRemaining = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
  }

  return {
    workflowId: workflowId,
    clientName: workflow.clientName || 'Unknown Client',
    templateName: workflow.templateName || 'Unknown Template',
    status: workflow.status || 'ACTIVE',
    startDate: startDate.toISOString(),
    dueDate: dueDate ? dueDate.toISOString() : null,
    daysElapsed: daysElapsed,
    daysRemaining: daysRemaining,
    totalSteps: totalSteps,
    completedSteps: completedSteps,
    blockedSteps: blockedSteps,
    inProgressSteps: inProgressSteps,
    percentage: percentage,
    steps: steps,
    lastUpdated: new Date().toISOString()
  };
}

// ============================================================================
// STEP ACTIONS (called from client-side)
// ============================================================================

function updateStepStatus(workflowId, stepId, newStatus) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!stepsSheet) {
    throw new Error('Workflow_Steps sheet not found');
  }

  const data = stepsSheet.getDataRange().getValues();
  const headers = data[0];
  const stepIdCol = headers.indexOf('stepId');
  const statusCol = headers.indexOf('status');
  const completedDateCol = headers.indexOf('completedDate');

  for (let i = 1; i < data.length; i++) {
    if (data[i][stepIdCol] === stepId) {
      stepsSheet.getRange(i + 1, statusCol + 1).setValue(newStatus);

      if (newStatus === 'COMPLETED' && completedDateCol >= 0) {
        stepsSheet.getRange(i + 1, completedDateCol + 1).setValue(new Date());
      }

      // Log to audit ledger
      if (typeof safeNewEntry === 'function') {
        safeNewEntry(
          Session.getActiveUser().getEmail() || 'User',
          'WORKFLOW_STEP_' + newStatus,
          `Step ${stepId} marked as ${newStatus}`,
          workflowId,
          'FINAL'
        );
      }

      return { success: true, newStatus: newStatus };
    }
  }

  throw new Error('Step not found: ' + stepId);
}

function updateStepNotes(workflowId, stepId, notes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!stepsSheet) {
    throw new Error('Workflow_Steps sheet not found');
  }

  const data = stepsSheet.getDataRange().getValues();
  const headers = data[0];
  const stepIdCol = headers.indexOf('stepId');
  const notesCol = headers.indexOf('notes');

  if (notesCol < 0) {
    throw new Error('Notes column not found');
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][stepIdCol] === stepId) {
      stepsSheet.getRange(i + 1, notesCol + 1).setValue(notes);
      return { success: true };
    }
  }

  throw new Error('Step not found: ' + stepId);
}

function updateStepDocuments(workflowId, stepId, documentLinks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stepsSheet = ss.getSheetByName('Workflow_Steps');

  if (!stepsSheet) {
    throw new Error('Workflow_Steps sheet not found');
  }

  const data = stepsSheet.getDataRange().getValues();
  const headers = data[0];
  const stepIdCol = headers.indexOf('stepId');
  const docsCol = headers.indexOf('documentLinks');

  if (docsCol < 0) {
    throw new Error('documentLinks column not found');
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][stepIdCol] === stepId) {
      stepsSheet.getRange(i + 1, docsCol + 1).setValue(documentLinks);
      return { success: true };
    }
  }

  throw new Error('Step not found: ' + stepId);
}

function setWorkflowDueDate(workflowId, dueDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const instanceSheet = ss.getSheetByName('Workflow_Instances');

  if (!instanceSheet) {
    throw new Error('Workflow_Instances sheet not found');
  }

  const data = instanceSheet.getDataRange().getValues();
  const headers = data[0];
  const wfIdCol = headers.indexOf('workflowId');
  const dueDateCol = headers.indexOf('dueDate');

  if (dueDateCol < 0) {
    throw new Error('dueDate column not found');
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][wfIdCol] === workflowId) {
      instanceSheet.getRange(i + 1, dueDateCol + 1).setValue(new Date(dueDate));
      return { success: true };
    }
  }

  throw new Error('Workflow not found: ' + workflowId);
}

// ============================================================================
// HTML TEMPLATE
// ============================================================================

function getWorkflowViewHTML_() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow View</title>
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

    .workflow-view {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* ========== HEADER ========== */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .header-left h1 {
      font-size: 28px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 5px;
    }

    .header-left .template-name {
      font-size: 14px;
      color: #667eea;
      margin-bottom: 10px;
    }

    .header-left .workflow-id {
      font-size: 11px;
      color: #666;
      font-family: monospace;
    }

    .header-right {
      text-align: right;
    }

    .back-btn {
      background: rgba(255,255,255,0.1);
      border: none;
      color: #888;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      margin-bottom: 10px;
      transition: all 0.2s;
    }

    .back-btn:hover {
      background: rgba(255,255,255,0.2);
      color: #fff;
    }

    /* ========== PROGRESS SECTION ========== */
    .progress-section {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 25px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }

    .progress-percentage {
      font-size: 48px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .progress-stats {
      display: flex;
      gap: 20px;
      text-align: center;
    }

    .stat-item {
      padding: 10px 15px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 600;
      color: #fff;
    }

    .stat-value.completed { color: #28a745; }
    .stat-value.in-progress { color: #ffc107; }
    .stat-value.blocked { color: #dc3545; }
    .stat-value.pending { color: #888; }

    .stat-label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
      margin-top: 3px;
    }

    .progress-bar-container {
      background: rgba(255,255,255,0.1);
      border-radius: 10px;
      height: 20px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      border-radius: 10px;
      transition: width 0.5s ease;
    }

    /* ========== DEADLINE SECTION ========== */
    .deadline-section {
      display: flex;
      gap: 20px;
      margin-bottom: 25px;
    }

    .deadline-card {
      flex: 1;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .deadline-card.warning {
      border-color: rgba(255,193,7,0.5);
      background: rgba(255,193,7,0.1);
    }

    .deadline-card.danger {
      border-color: rgba(220,53,69,0.5);
      background: rgba(220,53,69,0.1);
    }

    .deadline-label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .deadline-value {
      font-size: 24px;
      font-weight: 600;
      color: #fff;
    }

    .deadline-value.warning { color: #ffc107; }
    .deadline-value.danger { color: #dc3545; }

    .deadline-sub {
      font-size: 12px;
      color: #888;
      margin-top: 5px;
    }

    .set-deadline-btn {
      background: rgba(102,126,234,0.2);
      border: 1px solid rgba(102,126,234,0.3);
      color: #667eea;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      margin-top: 10px;
    }

    .set-deadline-btn:hover {
      background: rgba(102,126,234,0.3);
    }

    /* ========== STEPS LIST ========== */
    .steps-section {
      margin-bottom: 30px;
    }

    .steps-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }

    .steps-title {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
    }

    .steps-filter {
      display: flex;
      gap: 8px;
    }

    .filter-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #888;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }

    .filter-btn:hover, .filter-btn.active {
      background: rgba(102,126,234,0.2);
      border-color: rgba(102,126,234,0.3);
      color: #667eea;
    }

    .step-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      margin-bottom: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      overflow: hidden;
      transition: all 0.2s;
    }

    .step-card:hover {
      border-color: rgba(255,255,255,0.2);
    }

    .step-card.completed {
      opacity: 0.7;
    }

    .step-card.blocked {
      border-color: rgba(220,53,69,0.3);
    }

    .step-card.in-progress {
      border-color: rgba(255,193,7,0.3);
    }

    .step-main {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      cursor: pointer;
    }

    .step-checkbox {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 15px;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .step-checkbox:hover {
      border-color: #667eea;
      background: rgba(102,126,234,0.1);
    }

    .step-checkbox.completed {
      background: #28a745;
      border-color: #28a745;
      color: white;
    }

    .step-checkbox.in-progress {
      background: #ffc107;
      border-color: #ffc107;
      color: #333;
    }

    .step-checkbox.blocked {
      background: #dc3545;
      border-color: #dc3545;
      color: white;
    }

    .step-number {
      font-size: 14px;
      color: #888;
      width: 30px;
      flex-shrink: 0;
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .step-title {
      font-size: 15px;
      font-weight: 500;
      color: #fff;
      margin-bottom: 3px;
    }

    .step-card.completed .step-title {
      text-decoration: line-through;
      color: #888;
    }

    .step-description {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .step-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .step-category {
      font-size: 10px;
      padding: 3px 8px;
      background: rgba(102,126,234,0.2);
      color: #667eea;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .step-expand {
      color: #888;
      font-size: 18px;
      transition: transform 0.2s;
    }

    .step-card.expanded .step-expand {
      transform: rotate(180deg);
    }

    /* ========== STEP DETAILS (expanded) ========== */
    .step-details {
      display: none;
      padding: 0 20px 20px 73px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }

    .step-card.expanded .step-details {
      display: block;
    }

    .step-details-section {
      margin-top: 15px;
    }

    .step-details-label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .step-notes-input {
      width: 100%;
      padding: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 13px;
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
    }

    .step-notes-input:focus {
      outline: none;
      border-color: #667eea;
    }

    .step-docs-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }

    .step-doc-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.1);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
    }

    .step-doc-badge a {
      color: #667eea;
      text-decoration: none;
    }

    .step-doc-badge a:hover {
      text-decoration: underline;
    }

    .add-doc-input {
      display: flex;
      gap: 8px;
    }

    .add-doc-input input {
      flex: 1;
      padding: 8px 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      color: #fff;
      font-size: 12px;
    }

    .add-doc-input input:focus {
      outline: none;
      border-color: #667eea;
    }

    .add-doc-input button {
      padding: 8px 12px;
      background: rgba(102,126,234,0.2);
      border: 1px solid rgba(102,126,234,0.3);
      color: #667eea;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }

    .add-doc-input button:hover {
      background: rgba(102,126,234,0.3);
    }

    .step-actions {
      display: flex;
      gap: 8px;
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }

    .step-action-btn {
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      border: none;
      transition: all 0.2s;
    }

    .step-action-btn.complete {
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      color: white;
    }

    .step-action-btn.complete:hover {
      transform: translateY(-1px);
      box-shadow: 0 3px 10px rgba(40,167,69,0.3);
    }

    .step-action-btn.in-progress {
      background: rgba(255,193,7,0.2);
      color: #ffc107;
      border: 1px solid rgba(255,193,7,0.3);
    }

    .step-action-btn.block {
      background: rgba(220,53,69,0.2);
      color: #dc3545;
      border: 1px solid rgba(220,53,69,0.3);
    }

    .step-action-btn.save {
      background: rgba(102,126,234,0.2);
      color: #667eea;
      border: 1px solid rgba(102,126,234,0.3);
    }

    /* ========== TOAST NOTIFICATION ========== */
    .toast {
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #333;
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 1000;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    .toast.success {
      background: #28a745;
    }

    .toast.error {
      background: #dc3545;
    }

    /* ========== DEADLINE MODAL ========== */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal-content {
      background: #1e2a3a;
      border-radius: 16px;
      padding: 30px;
      width: 90%;
      max-width: 400px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .modal-content h3 {
      color: #fff;
      margin-bottom: 20px;
    }

    .modal-content label {
      display: block;
      color: #888;
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .modal-content input {
      width: 100%;
      padding: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
    }

    .modal-content input:focus {
      outline: none;
      border-color: #667eea;
    }

    .modal-buttons {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }

    .modal-buttons button {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      border: none;
    }

    .modal-buttons .cancel {
      background: rgba(255,255,255,0.1);
      color: #888;
    }

    .modal-buttons .save {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    /* ========== RESPONSIVE ========== */
    @media (max-width: 768px) {
      .progress-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 15px;
      }

      .progress-stats {
        width: 100%;
        justify-content: space-between;
      }

      .deadline-section {
        flex-direction: column;
      }

      .step-main {
        flex-wrap: wrap;
      }

      .step-meta {
        width: 100%;
        margin-top: 10px;
        padding-left: 43px;
      }
    }
  </style>
</head>
<body>
  <div class="workflow-view">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <h1 id="clientName">Loading...</h1>
        <div class="template-name" id="templateName"></div>
        <div class="workflow-id" id="workflowIdDisplay"></div>
      </div>
      <div class="header-right">
        <button class="back-btn" onclick="window.close()">Close Window</button>
      </div>
    </div>

    <!-- Progress Section -->
    <div class="progress-section">
      <div class="progress-header">
        <div class="progress-percentage" id="progressPercentage">0%</div>
        <div class="progress-stats">
          <div class="stat-item">
            <div class="stat-value completed" id="completedCount">0</div>
            <div class="stat-label">Completed</div>
          </div>
          <div class="stat-item">
            <div class="stat-value in-progress" id="inProgressCount">0</div>
            <div class="stat-label">In Progress</div>
          </div>
          <div class="stat-item">
            <div class="stat-value blocked" id="blockedCount">0</div>
            <div class="stat-label">Blocked</div>
          </div>
          <div class="stat-item">
            <div class="stat-value pending" id="pendingCount">0</div>
            <div class="stat-label">Pending</div>
          </div>
        </div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" id="progressBar" style="width: 0%"></div>
      </div>
    </div>

    <!-- Deadline Section -->
    <div class="deadline-section">
      <div class="deadline-card" id="elapsedCard">
        <div class="deadline-label">Time Elapsed</div>
        <div class="deadline-value" id="daysElapsed">0 days</div>
        <div class="deadline-sub" id="startDate">Started: --</div>
      </div>
      <div class="deadline-card" id="remainingCard">
        <div class="deadline-label">Time Remaining</div>
        <div class="deadline-value" id="daysRemaining">No deadline set</div>
        <div class="deadline-sub" id="dueDate">Due: --</div>
        <button class="set-deadline-btn" onclick="openDeadlineModal()">Set Deadline</button>
      </div>
    </div>

    <!-- Steps Section -->
    <div class="steps-section">
      <div class="steps-header">
        <div class="steps-title">Workflow Steps</div>
        <div class="steps-filter">
          <button class="filter-btn active" data-filter="all" onclick="filterSteps('all')">All</button>
          <button class="filter-btn" data-filter="pending" onclick="filterSteps('pending')">Pending</button>
          <button class="filter-btn" data-filter="completed" onclick="filterSteps('completed')">Completed</button>
        </div>
      </div>
      <div id="stepsList">
        <!-- Steps will be rendered here -->
      </div>
    </div>
  </div>

  <!-- Deadline Modal -->
  <div class="modal-overlay" id="deadlineModal">
    <div class="modal-content">
      <h3>Set Deadline</h3>
      <label>Due Date</label>
      <input type="date" id="deadlineInput">
      <div class="modal-buttons">
        <button class="cancel" onclick="closeDeadlineModal()">Cancel</button>
        <button class="save" onclick="saveDeadline()">Save</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script>
    // Initial data from server
    let workflowData = JSON.parse('<?= data ?>');
    const workflowId = '<?= workflowId ?>';
    let currentFilter = 'all';

    // ========== RENDER FUNCTIONS ==========
    function renderWorkflow(data) {
      // Header
      document.getElementById('clientName').textContent = data.clientName;
      document.getElementById('templateName').textContent = data.templateName;
      document.getElementById('workflowIdDisplay').textContent = 'ID: ' + data.workflowId;

      // Progress
      document.getElementById('progressPercentage').textContent = data.percentage + '%';
      document.getElementById('progressBar').style.width = data.percentage + '%';
      document.getElementById('completedCount').textContent = data.completedSteps;
      document.getElementById('inProgressCount').textContent = data.inProgressSteps;
      document.getElementById('blockedCount').textContent = data.blockedSteps;
      document.getElementById('pendingCount').textContent = data.totalSteps - data.completedSteps - data.inProgressSteps - data.blockedSteps;

      // Deadline
      document.getElementById('daysElapsed').textContent = data.daysElapsed + ' days';
      document.getElementById('startDate').textContent = 'Started: ' + new Date(data.startDate).toLocaleDateString();

      if (data.daysRemaining !== null) {
        const remainingEl = document.getElementById('daysRemaining');
        const cardEl = document.getElementById('remainingCard');
        remainingEl.textContent = data.daysRemaining + ' days';

        if (data.daysRemaining <= 3) {
          remainingEl.className = 'deadline-value danger';
          cardEl.className = 'deadline-card danger';
        } else if (data.daysRemaining <= 7) {
          remainingEl.className = 'deadline-value warning';
          cardEl.className = 'deadline-card warning';
        } else {
          remainingEl.className = 'deadline-value';
          cardEl.className = 'deadline-card';
        }
        document.getElementById('dueDate').textContent = 'Due: ' + new Date(data.dueDate).toLocaleDateString();
      } else {
        document.getElementById('daysRemaining').textContent = 'No deadline';
        document.getElementById('dueDate').textContent = '';
      }

      // Steps
      renderSteps(data.steps);
    }

    function renderSteps(steps) {
      const container = document.getElementById('stepsList');

      const filteredSteps = steps.filter(s => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'pending') return s.status !== 'COMPLETED';
        if (currentFilter === 'completed') return s.status === 'COMPLETED';
        return true;
      });

      container.innerHTML = filteredSteps.map(step => {
        const statusClass = step.status.toLowerCase().replace('_', '-');
        const checkIcon = step.status === 'COMPLETED' ? '&#10003;' :
                         step.status === 'IN_PROGRESS' ? '&#9679;' :
                         step.status === 'BLOCKED' ? '&#10007;' : '';

        const docs = step.documentLinks ? step.documentLinks.split(',').filter(d => d.trim()) : [];
        const docsHtml = docs.map(d => \`<div class="step-doc-badge"><a href="\${d.trim()}" target="_blank">\${d.trim().split('/').pop() || 'Document'}</a></div>\`).join('');

        return \`
          <div class="step-card \${statusClass}" id="step-\${step.stepId}">
            <div class="step-main" onclick="toggleStep('\${step.stepId}')">
              <div class="step-checkbox \${statusClass}" onclick="event.stopPropagation(); cycleStatus('\${step.stepId}', '\${step.status}')">\${checkIcon}</div>
              <div class="step-number">\${step.stepNumber}.</div>
              <div class="step-content">
                <div class="step-title">\${step.title}</div>
                <div class="step-description">\${step.description || ''}</div>
              </div>
              <div class="step-meta">
                \${step.category ? \`<span class="step-category">\${step.category}</span>\` : ''}
                <span class="step-expand">&#9662;</span>
              </div>
            </div>
            <div class="step-details">
              <div class="step-details-section">
                <div class="step-details-label">Notes</div>
                <textarea class="step-notes-input" id="notes-\${step.stepId}" placeholder="Add notes...">\${step.notes || ''}</textarea>
              </div>
              <div class="step-details-section">
                <div class="step-details-label">Documents</div>
                <div class="step-docs-list">\${docsHtml || '<span style="color:#666">No documents attached</span>'}</div>
                <div class="add-doc-input">
                  <input type="text" id="doc-input-\${step.stepId}" placeholder="Paste document URL...">
                  <button onclick="addDocument('\${step.stepId}')">Add</button>
                </div>
              </div>
              <div class="step-actions">
                <button class="step-action-btn complete" onclick="setStatus('\${step.stepId}', 'COMPLETED')">Mark Complete</button>
                <button class="step-action-btn in-progress" onclick="setStatus('\${step.stepId}', 'IN_PROGRESS')">In Progress</button>
                <button class="step-action-btn block" onclick="setStatus('\${step.stepId}', 'BLOCKED')">Blocked</button>
                <button class="step-action-btn save" onclick="saveNotes('\${step.stepId}')">Save Notes</button>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    // ========== INTERACTIONS ==========
    function toggleStep(stepId) {
      const card = document.getElementById('step-' + stepId);
      card.classList.toggle('expanded');
    }

    function filterSteps(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      renderSteps(workflowData.steps);
    }

    function cycleStatus(stepId, currentStatus) {
      const order = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];
      const currentIndex = order.indexOf(currentStatus);
      const nextStatus = order[(currentIndex + 1) % order.length];
      setStatus(stepId, nextStatus);
    }

    function setStatus(stepId, newStatus) {
      showToast('Updating...', '');

      google.script.run
        .withSuccessHandler(function(result) {
          // Update local data
          const step = workflowData.steps.find(s => s.stepId === stepId);
          if (step) {
            step.status = newStatus;
            if (newStatus === 'COMPLETED') {
              step.completedDate = new Date().toISOString();
            }
          }
          // Recalculate progress
          updateProgress();
          renderSteps(workflowData.steps);
          showToast('Step updated!', 'success');
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .updateStepStatus(workflowId, stepId, newStatus);
    }

    function saveNotes(stepId) {
      const notes = document.getElementById('notes-' + stepId).value;

      google.script.run
        .withSuccessHandler(function() {
          const step = workflowData.steps.find(s => s.stepId === stepId);
          if (step) step.notes = notes;
          showToast('Notes saved!', 'success');
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .updateStepNotes(workflowId, stepId, notes);
    }

    function addDocument(stepId) {
      const input = document.getElementById('doc-input-' + stepId);
      const url = input.value.trim();

      if (!url) {
        showToast('Enter a URL', 'error');
        return;
      }

      const step = workflowData.steps.find(s => s.stepId === stepId);
      const currentDocs = step.documentLinks ? step.documentLinks.split(',').filter(d => d.trim()) : [];
      currentDocs.push(url);
      const newDocs = currentDocs.join(',');

      google.script.run
        .withSuccessHandler(function() {
          step.documentLinks = newDocs;
          input.value = '';
          renderSteps(workflowData.steps);
          showToast('Document added!', 'success');
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .updateStepDocuments(workflowId, stepId, newDocs);
    }

    function updateProgress() {
      const total = workflowData.steps.length;
      const completed = workflowData.steps.filter(s => s.status === 'COMPLETED').length;
      const inProgress = workflowData.steps.filter(s => s.status === 'IN_PROGRESS').length;
      const blocked = workflowData.steps.filter(s => s.status === 'BLOCKED').length;

      workflowData.completedSteps = completed;
      workflowData.inProgressSteps = inProgress;
      workflowData.blockedSteps = blocked;
      workflowData.percentage = Math.round((completed / total) * 100);

      document.getElementById('progressPercentage').textContent = workflowData.percentage + '%';
      document.getElementById('progressBar').style.width = workflowData.percentage + '%';
      document.getElementById('completedCount').textContent = completed;
      document.getElementById('inProgressCount').textContent = inProgress;
      document.getElementById('blockedCount').textContent = blocked;
      document.getElementById('pendingCount').textContent = total - completed - inProgress - blocked;
    }

    // ========== DEADLINE ==========
    function openDeadlineModal() {
      document.getElementById('deadlineModal').classList.add('active');
      if (workflowData.dueDate) {
        document.getElementById('deadlineInput').value = workflowData.dueDate.split('T')[0];
      }
    }

    function closeDeadlineModal() {
      document.getElementById('deadlineModal').classList.remove('active');
    }

    function saveDeadline() {
      const dateValue = document.getElementById('deadlineInput').value;
      if (!dateValue) {
        showToast('Select a date', 'error');
        return;
      }

      google.script.run
        .withSuccessHandler(function() {
          workflowData.dueDate = new Date(dateValue).toISOString();
          workflowData.daysRemaining = Math.ceil((new Date(dateValue) - new Date()) / (1000 * 60 * 60 * 24));
          renderWorkflow(workflowData);
          closeDeadlineModal();
          showToast('Deadline set!', 'success');
        })
        .withFailureHandler(function(err) {
          showToast('Error: ' + err.message, 'error');
        })
        .setWorkflowDueDate(workflowId, dateValue);
    }

    // ========== TOAST ==========
    function showToast(message, type) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast ' + type + ' show';
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    // ========== INIT ==========
    renderWorkflow(workflowData);
  </script>
</body>
</html>`;
}
