/**
 * ───────────────────────────────────────────────
 *  NEWTON CONFIDENCE PLANNER : EPISTEMIC NAVIGATOR
 * ───────────────────────────────────────────────
 *
 *  Thinks ahead about what it knows it doesn't know.
 *  Picks models and Gatekeeper modes based on planned
 *  confidence level BEFORE asking the question.
 *
 *  Stays speculative and loose until it gathers enough
 *  evidence, then locks down to STRICT mode with KK
 *  declarations only when actually sure.
 *
 *  Flow:
 *  1. createPlan(goal) → decomposes into knowledge requirements
 *  2. For each step: assess confidence, pick mode, execute
 *  3. As evidence accumulates: escalate UU → KU → KK
 *  4. Final output only when confidence threshold met
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const PLANNER_CONFIG = {
  PLAN_SHEET: 'Confidence_Plans',

  // Confidence progression thresholds
  THRESHOLDS: {
    UU_TO_KU: 0.3,   // 30% evidence coverage → upgrade to KU
    KU_TO_KK: 0.8,   // 80% evidence coverage → upgrade to KK
    FINAL_MIN: 0.9   // 90% required for final output
  },

  // Model selection by confidence level
  MODEL_SELECTION: {
    UNKNOWN_UNKNOWN: { provider: 'gemini', model: 'gemini-1.5-flash', reason: 'Fast exploration' },
    KNOWN_UNKNOWN: { provider: 'gemini', model: 'gemini-1.5-pro', reason: 'Deeper analysis' },
    KNOWN_KNOWN: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', reason: 'High-stakes verification' }
  },

  // Gatekeeper mode by confidence level
  GATEKEEPER_MODE: {
    UNKNOWN_UNKNOWN: 'AUDIT_ONLY',   // Just log, don't block exploration
    KNOWN_UNKNOWN: 'PERMISSIVE',     // Warn but allow
    KNOWN_KNOWN: 'STRICT'            // Full enforcement
  },

  // Routes that require KK before final output
  HIGH_STAKES_ROUTES: [
    'CUSTOMER_REPLY',
    'TAX_WORKFLOW',
    'TAX_POSITION',
    'LEGAL_OPINION',
    'COMPLIANCE_CHECK'
  ]
};


// ==========================
// PLAN SHEET SETUP
// ==========================

function setupPlanSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PLANNER_CONFIG.PLAN_SHEET);

  if (!sh) {
    sh = ss.insertSheet(PLANNER_CONFIG.PLAN_SHEET);
    const headers = [
      'Plan_UUID', 'Created_At', 'Goal', 'Route', 'Customer_ID',
      'Status', 'Current_Confidence', 'Evidence_Score',
      'Steps_Total', 'Steps_Completed', 'Final_Confidence_UUID',
      'Requirements_JSON', 'Evidence_JSON', 'Last_Updated'
    ];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#4a4a4a')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);

    logSystemEvent('SUCCESS', 'PLANNER', 'Plan sheet created');
  }

  return sh;
}


// ==========================
// KNOWLEDGE REQUIREMENTS
// ==========================

/**
 * Decompose a goal into knowledge requirements.
 * Returns what we need to know to confidently answer.
 */
function decomposeGoal(goal, route) {
  const requirements = [];
  const goalLower = goal.toLowerCase();

  // Tax-specific requirements
  if (route === 'TAX_WORKFLOW' || route === 'TAX_POSITION' || goalLower.includes('tax')) {
    requirements.push(
      { id: 'authority', desc: 'Identify governing tax authority (IRC, state code, treaty)', weight: 0.2 },
      { id: 'facts', desc: 'Establish relevant facts of the situation', weight: 0.2 },
      { id: 'law', desc: 'Locate applicable statute/regulation/case law', weight: 0.25 },
      { id: 'application', desc: 'Apply law to facts', weight: 0.2 },
      { id: 'precedent', desc: 'Check for contrary authority or exceptions', weight: 0.15 }
    );
  }

  // Legal-specific requirements
  else if (route === 'LEGAL_OPINION' || goalLower.includes('legal')) {
    requirements.push(
      { id: 'jurisdiction', desc: 'Identify governing jurisdiction', weight: 0.15 },
      { id: 'facts', desc: 'Establish relevant facts', weight: 0.2 },
      { id: 'issues', desc: 'Frame the legal issues', weight: 0.15 },
      { id: 'rules', desc: 'Identify applicable rules/statutes/cases', weight: 0.2 },
      { id: 'analysis', desc: 'Apply rules to facts (IRAC)', weight: 0.2 },
      { id: 'conclusion', desc: 'Reach defensible conclusion', weight: 0.1 }
    );
  }

  // Customer reply requirements
  else if (route === 'CUSTOMER_REPLY') {
    requirements.push(
      { id: 'context', desc: 'Understand customer context and history', weight: 0.2 },
      { id: 'question', desc: 'Identify exact question being asked', weight: 0.2 },
      { id: 'answer', desc: 'Formulate accurate answer', weight: 0.3 },
      { id: 'verify', desc: 'Verify answer against authoritative source', weight: 0.2 },
      { id: 'tone', desc: 'Appropriate tone and completeness', weight: 0.1 }
    );
  }

  // Generic requirements
  else {
    requirements.push(
      { id: 'understand', desc: 'Understand the question/task', weight: 0.25 },
      { id: 'research', desc: 'Gather relevant information', weight: 0.25 },
      { id: 'analyze', desc: 'Analyze and synthesize', weight: 0.25 },
      { id: 'conclude', desc: 'Form conclusion', weight: 0.25 }
    );
  }

  return requirements;
}


// ==========================
// PLAN CREATION
// ==========================

/**
 * Create a new confidence plan for a goal.
 * Returns plan_uuid to track this workflow.
 */
function createPlan(goal, route, customerId) {
  const sh = setupPlanSheet();

  const plan_uuid = Utilities.getUuid();
  const requirements = decomposeGoal(goal, route);
  const now = new Date().toISOString();

  // Initialize evidence as empty
  const evidence = {};
  for (const req of requirements) {
    evidence[req.id] = { satisfied: false, source: null, confidence: 0 };
  }

  sh.appendRow([
    plan_uuid,
    now,
    goal,
    route || 'GENERAL',
    customerId || '',
    'ACTIVE',
    'UNKNOWN_UNKNOWN',
    0,
    requirements.length,
    0,
    '',
    JSON.stringify(requirements),
    JSON.stringify(evidence),
    now
  ]);

  logSystemEvent('INFO', 'PLANNER', 'Plan created', {
    plan_uuid,
    goal: goal.substring(0, 50),
    route,
    requirements: requirements.length
  });

  return {
    plan_uuid,
    goal,
    route,
    requirements,
    evidence,
    currentConfidence: 'UNKNOWN_UNKNOWN',
    evidenceScore: 0
  };
}


// ==========================
// EVIDENCE TRACKING
// ==========================

/**
 * Record evidence that satisfies a requirement.
 * Automatically recalculates confidence level.
 */
function recordEvidence(plan_uuid, requirementId, source, confidence) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLANNER_CONFIG.PLAN_SHEET);
  if (!sh) return { error: 'Plan sheet not found' };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { error: 'No plans found' };

  const data = sh.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === plan_uuid) {
      const row = i + 2;
      const requirements = JSON.parse(data[i][11] || '[]');
      const evidence = JSON.parse(data[i][12] || '{}');

      // Update evidence for this requirement
      if (evidence[requirementId] !== undefined) {
        evidence[requirementId] = {
          satisfied: confidence >= 0.5,
          source: source,
          confidence: confidence
        };
      }

      // Calculate new evidence score
      let weightedScore = 0;
      let stepsCompleted = 0;
      for (const req of requirements) {
        const ev = evidence[req.id];
        if (ev && ev.satisfied) {
          weightedScore += req.weight * ev.confidence;
          stepsCompleted++;
        }
      }

      // Determine new confidence level
      let newConfidence = 'UNKNOWN_UNKNOWN';
      if (weightedScore >= PLANNER_CONFIG.THRESHOLDS.KU_TO_KK) {
        newConfidence = 'KNOWN_KNOWN';
      } else if (weightedScore >= PLANNER_CONFIG.THRESHOLDS.UU_TO_KU) {
        newConfidence = 'KNOWN_UNKNOWN';
      }

      // Update sheet
      sh.getRange(row, 7).setValue(newConfidence);
      sh.getRange(row, 8).setValue(weightedScore);
      sh.getRange(row, 10).setValue(stepsCompleted);
      sh.getRange(row, 13).setValue(JSON.stringify(evidence));
      sh.getRange(row, 14).setValue(new Date().toISOString());

      logSystemEvent('INFO', 'PLANNER', 'Evidence recorded', {
        plan_uuid,
        requirementId,
        newScore: weightedScore,
        newConfidence
      });

      return {
        plan_uuid,
        requirementId,
        evidenceScore: weightedScore,
        currentConfidence: newConfidence,
        stepsCompleted,
        stepsTotal: requirements.length
      };
    }
  }

  return { error: 'Plan not found', plan_uuid };
}


// ==========================
// PLAN STATUS
// ==========================

/**
 * Get current status of a plan.
 */
function getPlanStatus(plan_uuid) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLANNER_CONFIG.PLAN_SHEET);
  if (!sh) return null;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const data = sh.getRange(2, 1, lastRow - 1, 14).getValues();

  for (const row of data) {
    if (row[0] === plan_uuid) {
      const requirements = JSON.parse(row[11] || '[]');
      const evidence = JSON.parse(row[12] || '{}');

      // Calculate what's still needed
      const missing = requirements.filter(req => {
        const ev = evidence[req.id];
        return !ev || !ev.satisfied;
      });

      return {
        plan_uuid: row[0],
        createdAt: row[1],
        goal: row[2],
        route: row[3],
        customerId: row[4],
        status: row[5],
        currentConfidence: row[6],
        evidenceScore: row[7],
        stepsTotal: row[8],
        stepsCompleted: row[9],
        finalConfidenceUuid: row[10],
        requirements,
        evidence,
        missing,
        readyForFinal: row[7] >= PLANNER_CONFIG.THRESHOLDS.FINAL_MIN
      };
    }
  }

  return null;
}


// ==========================
// PLANNED EXECUTION
// ==========================

/**
 * Execute a step within a plan.
 * Automatically selects model and gatekeeper mode based on current confidence.
 */
function executePlanStep(plan_uuid, stepPrompt, requirementId, metadata) {
  const plan = getPlanStatus(plan_uuid);
  if (!plan) {
    return { error: 'Plan not found', plan_uuid };
  }

  const currentConfidence = plan.currentConfidence;

  // Select model based on confidence
  const modelConfig = PLANNER_CONFIG.MODEL_SELECTION[currentConfidence];
  const gatekeeperMode = PLANNER_CONFIG.GATEKEEPER_MODE[currentConfidence];

  // Build options
  const options = {
    mode: gatekeeperMode,
    requireConfidence: currentConfidence === 'KNOWN_KNOWN',
    requireReasoningSchema: currentConfidence !== 'UNKNOWN_UNKNOWN',
    metadata: {
      ...metadata,
      plan_uuid,
      requirementId,
      plannedConfidence: currentConfidence
    }
  };

  // If KK, require a confidence declaration
  let confidence_uuid = null;
  if (currentConfidence === 'KNOWN_KNOWN') {
    const declaration = declareConfidence(
      'KNOWN_KNOWN',
      `Plan ${plan_uuid} step: ${requirementId}. Evidence score: ${plan.evidenceScore}`,
      'System'
    );
    confidence_uuid = declaration.confidence_uuid;
    options.confidence_uuid = confidence_uuid;
  }

  // Execute via gated request
  let result;
  try {
    result = gatedAIRequest(modelConfig.provider, modelConfig.model, stepPrompt, options);
  } catch (e) {
    return {
      error: e.message,
      plan_uuid,
      requirementId,
      model: modelConfig
    };
  }

  // If successful and this satisfies a requirement, record evidence
  if (result.success && requirementId) {
    // Use drift score to estimate confidence in this step's output
    const stepConfidence = Math.max(0, 1 - (result.drift_score || 0) / 100);
    recordEvidence(plan_uuid, requirementId, result.newtonUuid, stepConfidence);
  }

  return {
    ...result,
    plan_uuid,
    requirementId,
    modelUsed: modelConfig,
    gatekeeperMode,
    confidence_uuid
  };
}


// ==========================
// FINAL OUTPUT
// ==========================

/**
 * Generate final output for a plan.
 * Only allowed if evidence score meets threshold.
 */
function generateFinalOutput(plan_uuid, finalPrompt, metadata) {
  const plan = getPlanStatus(plan_uuid);
  if (!plan) {
    return { error: 'Plan not found', plan_uuid };
  }

  // Check if ready for final
  const isHighStakes = PLANNER_CONFIG.HIGH_STAKES_ROUTES.includes(plan.route);
  const minThreshold = isHighStakes ? PLANNER_CONFIG.THRESHOLDS.FINAL_MIN : PLANNER_CONFIG.THRESHOLDS.KU_TO_KK;

  if (plan.evidenceScore < minThreshold) {
    return {
      error: 'Not ready for final output',
      plan_uuid,
      evidenceScore: plan.evidenceScore,
      required: minThreshold,
      missing: plan.missing
    };
  }

  // Force STRICT mode and KK declaration for final
  const declaration = declareConfidence(
    'KNOWN_KNOWN',
    `Final output for plan ${plan_uuid}. Evidence score: ${plan.evidenceScore}. ` +
    `All requirements satisfied: ${plan.missing.length === 0}`,
    'System'
  );

  const options = {
    mode: 'STRICT',
    requireConfidence: true,
    requireReasoningSchema: true,
    confidence_uuid: declaration.confidence_uuid,
    metadata: {
      ...metadata,
      plan_uuid,
      isFinal: true,
      evidenceScore: plan.evidenceScore
    }
  };

  // Use best model for final
  const modelConfig = PLANNER_CONFIG.MODEL_SELECTION.KNOWN_KNOWN;

  let result;
  try {
    result = gatedAIRequest(modelConfig.provider, modelConfig.model, finalPrompt, options);
  } catch (e) {
    return {
      error: e.message,
      plan_uuid,
      confidence_uuid: declaration.confidence_uuid
    };
  }

  // Mark plan as complete
  if (result.success) {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLANNER_CONFIG.PLAN_SHEET);
    const lastRow = sh.getLastRow();
    const data = sh.getRange(2, 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === plan_uuid) {
        sh.getRange(i + 2, 6).setValue('COMPLETED');
        sh.getRange(i + 2, 11).setValue(declaration.confidence_uuid);
        sh.getRange(i + 2, 14).setValue(new Date().toISOString());
        break;
      }
    }

    logSystemEvent('SUCCESS', 'PLANNER', 'Plan completed with final output', {
      plan_uuid,
      evidenceScore: plan.evidenceScore,
      confidence_uuid: declaration.confidence_uuid
    });
  }

  return {
    ...result,
    plan_uuid,
    confidence_uuid: declaration.confidence_uuid,
    evidenceScore: plan.evidenceScore,
    planStatus: 'COMPLETED'
  };
}


// ==========================
// CONVENIENCE: AUTO-PLAN
// ==========================

/**
 * Full auto-plan flow:
 * 1. Create plan
 * 2. Execute steps to gather evidence
 * 3. Generate final output when ready
 *
 * For simple queries, this runs fast.
 * For complex queries, it may loop until confidence is achieved.
 */
function autoPlan(goal, route, customerId, maxSteps) {
  maxSteps = maxSteps || 5;

  // Create plan
  const plan = createPlan(goal, route, customerId);

  // Execute steps until ready or max reached
  let stepCount = 0;
  let status = getPlanStatus(plan.plan_uuid);

  while (!status.readyForFinal && stepCount < maxSteps) {
    // Pick next missing requirement
    const nextReq = status.missing[0];
    if (!nextReq) break;

    // Generate step prompt
    const stepPrompt = `
      Goal: ${goal}

      I need to satisfy this requirement: ${nextReq.desc}

      Please provide information that addresses this requirement.
      Be specific and cite sources where possible.
    `;

    // Execute step
    const stepResult = executePlanStep(plan.plan_uuid, stepPrompt, nextReq.id, { customerId });

    if (!stepResult.success) {
      logSystemEvent('WARN', 'PLANNER', 'Step failed', { plan_uuid: plan.plan_uuid, req: nextReq.id });
    }

    stepCount++;
    status = getPlanStatus(plan.plan_uuid);
  }

  // If ready, generate final
  if (status.readyForFinal) {
    const finalPrompt = `
      Goal: ${goal}

      Based on the evidence gathered, provide a final, authoritative answer.

      Evidence summary:
      ${JSON.stringify(status.evidence, null, 2)}

      Provide your answer with:
      [WHAT]: The conclusion
      [WHY]: The reasoning
      [HOW]: How you reached this conclusion
      [CONFIDENCE]: Your confidence level and justification
    `;

    return generateFinalOutput(plan.plan_uuid, finalPrompt, { customerId });
  }

  // Not ready yet
  return {
    success: false,
    plan_uuid: plan.plan_uuid,
    status: 'INCOMPLETE',
    evidenceScore: status.evidenceScore,
    stepsCompleted: status.stepsCompleted,
    stepsTotal: status.stepsTotal,
    missing: status.missing,
    message: `Plan incomplete after ${stepCount} steps. Evidence score: ${status.evidenceScore}`
  };
}


// ==========================
// UI FUNCTIONS
// ==========================

function createPlanFromUI() {
  const ui = SpreadsheetApp.getUi();

  const goalResponse = ui.prompt(
    'Create Plan - Step 1/2',
    'What is the goal/question?',
    ui.ButtonSet.OK_CANCEL
  );
  if (goalResponse.getSelectedButton() !== ui.Button.OK) return;
  const goal = goalResponse.getResponseText();

  const routeResponse = ui.prompt(
    'Create Plan - Step 2/2',
    'Route type:\n• TAX_WORKFLOW\n• LEGAL_OPINION\n• CUSTOMER_REPLY\n• GENERAL',
    ui.ButtonSet.OK_CANCEL
  );
  if (routeResponse.getSelectedButton() !== ui.Button.OK) return;
  const route = routeResponse.getResponseText().trim().toUpperCase() || 'GENERAL';

  const plan = createPlan(goal, route, '');

  ui.alert(
    'Plan Created',
    `Plan UUID: ${plan.plan_uuid}\n\n` +
    `Requirements: ${plan.requirements.length}\n` +
    `Starting confidence: ${plan.currentConfidence}\n\n` +
    `Use this UUID to execute steps and track progress.`,
    ui.ButtonSet.OK
  );
}

function viewPlanStatusFromUI() {
  const ui = SpreadsheetApp.getUi();

  const uuidResponse = ui.prompt(
    'View Plan Status',
    'Enter Plan UUID:',
    ui.ButtonSet.OK_CANCEL
  );
  if (uuidResponse.getSelectedButton() !== ui.Button.OK) return;
  const plan_uuid = uuidResponse.getResponseText().trim();

  const status = getPlanStatus(plan_uuid);
  if (!status) {
    ui.alert('Plan not found.');
    return;
  }

  let report = `PLAN STATUS: ${status.plan_uuid}\n\n`;
  report += `Goal: ${status.goal}\n`;
  report += `Route: ${status.route}\n`;
  report += `Status: ${status.status}\n`;
  report += `Confidence: ${status.currentConfidence}\n`;
  report += `Evidence Score: ${(status.evidenceScore * 100).toFixed(1)}%\n`;
  report += `Steps: ${status.stepsCompleted}/${status.stepsTotal}\n\n`;

  if (status.missing.length > 0) {
    report += `Missing requirements:\n`;
    for (const m of status.missing) {
      report += `  - ${m.id}: ${m.desc}\n`;
    }
  } else {
    report += `All requirements satisfied!\n`;
  }

  report += `\nReady for final: ${status.readyForFinal ? 'YES' : 'NO'}`;

  ui.alert('Plan Status', report, ui.ButtonSet.OK);
}

function runAutoPlanFromUI() {
  const ui = SpreadsheetApp.getUi();

  const goalResponse = ui.prompt(
    'Auto-Plan',
    'What is your goal/question?\n\n(This will automatically plan, execute steps, and generate output)',
    ui.ButtonSet.OK_CANCEL
  );
  if (goalResponse.getSelectedButton() !== ui.Button.OK) return;
  const goal = goalResponse.getResponseText();

  const routeResponse = ui.prompt(
    'Route Type',
    '• TAX_WORKFLOW\n• LEGAL_OPINION\n• CUSTOMER_REPLY\n• GENERAL',
    ui.ButtonSet.OK_CANCEL
  );
  if (routeResponse.getSelectedButton() !== ui.Button.OK) return;
  const route = routeResponse.getResponseText().trim().toUpperCase() || 'GENERAL';

  ui.alert('Starting auto-plan... This may take a moment.');

  const result = autoPlan(goal, route, '', 5);

  if (result.success) {
    ui.alert(
      'Auto-Plan Complete',
      `Plan completed successfully!\n\n` +
      `Evidence Score: ${(result.evidenceScore * 100).toFixed(1)}%\n` +
      `Confidence UUID: ${result.confidence_uuid}\n\n` +
      `Response logged to ledger.`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      'Auto-Plan Incomplete',
      `Plan did not reach required confidence.\n\n` +
      `Evidence Score: ${(result.evidenceScore * 100).toFixed(1)}%\n` +
      `Steps: ${result.stepsCompleted}/${result.stepsTotal}\n\n` +
      `Missing: ${result.missing.map(m => m.id).join(', ')}`,
      ui.ButtonSet.OK
    );
  }
}

function viewPlanSheet() {
  const sh = setupPlanSheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
}


// ==========================
// MENU
// ==========================

function addPlannerMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Planner')
    .addItem('Create Plan', 'createPlanFromUI')
    .addItem('View Plan Status', 'viewPlanStatusFromUI')
    .addSeparator()
    .addItem('Run Auto-Plan', 'runAutoPlanFromUI')
    .addSeparator()
    .addItem('View Plans Sheet', 'viewPlanSheet')
    .addToUi();
}
