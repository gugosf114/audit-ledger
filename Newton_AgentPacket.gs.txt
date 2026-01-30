/**
 * ───────────────────────────────────────────────
 *  NEWTON AGENT-PACKET INTEGRATION
 * ───────────────────────────────────────────────
 *
 *  Combines the autonomous Agent with Sealed Packet
 *  verification for end-to-end compliance hunting.
 *
 *  Flow:
 *  1. Sealed Packet runs → identifies VOIDs
 *  2. Agent takes VOIDs → hunts for missing items
 *  3. Agent finds evidence → feeds back to Sealed Packet
 *  4. Sealed Packet re-verifies with new evidence
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// INTEGRATED HUNT FLOW
// ==========================

/**
 * Run full agentic compliance check:
 * 1. Initial Sealed Packet verification
 * 2. Agent hunts for any VOIDs
 * 3. Re-verify with found evidence
 *
 * @param {string} inputs - Document text to analyze
 * @param {string} checklist - Required items
 * @param {string} goal - Verification goal
 * @returns {Object} - Complete results
 */
function runAgenticComplianceCheck(inputs, checklist, goal) {
  const result = {
    sessionId: Utilities.getUuid(),
    startTime: new Date().toISOString(),
    phases: [],
    finalStatus: null,
    allEvidence: [],
    remainingVoids: [],
    iterations: 0
  };

  logSystemEvent('INFO', 'AGENTIC_COMPLIANCE', 'Starting agentic compliance check', {
    sessionId: result.sessionId,
    goal: goal
  });

  try {
    // ============================================
    // PHASE 1: Initial Sealed Packet Verification
    // ============================================
    logSystemEvent('INFO', 'AGENTIC_COMPLIANCE', 'Phase 1: Initial Sealed Packet', {});

    const phase1 = runSealedPacketVerification(inputs, checklist, goal, 'AGENTIC_CHECK_P1');

    result.phases.push({
      phase: 1,
      name: 'Initial Verification',
      success: phase1.success,
      voidsDetected: phase1.voidsDetected.length,
      claims: phase1.finalCandidate?.claims?.length || 0
    });

    // If no voids, we're done!
    if (!phase1.voidsDetected || phase1.voidsDetected.length === 0) {
      result.finalStatus = 'COMPLETE';
      logSystemEvent('SUCCESS', 'AGENTIC_COMPLIANCE', 'No voids detected - all items verified', {});
      return result;
    }

    // ============================================
    // PHASE 2: Agent Hunts for Missing Items
    // ============================================
    logSystemEvent('INFO', 'AGENTIC_COMPLIANCE', 'Phase 2: Agent Hunt', {
      voidsToHunt: phase1.voidsDetected.length
    });

    // Build hunt checklist from voids
    const huntChecklist = phase1.voidsDetected
      .map(v => v.missing_artifact)
      .join('\n');

    const huntGoal = `Find evidence for these missing items from the compliance check:\n${huntChecklist}`;

    const agentResult = runAgentInvestigation(huntGoal, huntChecklist);

    result.phases.push({
      phase: 2,
      name: 'Agent Hunt',
      iterations: agentResult.iterations,
      evidenceFound: agentResult.evidence.length,
      voidsRemaining: agentResult.voids.length,
      state: agentResult.state
    });

    result.allEvidence = agentResult.evidence;
    result.iterations = agentResult.iterations;

    // If agent found nothing, we're done with remaining voids
    if (agentResult.evidence.length === 0) {
      result.finalStatus = 'PARTIAL';
      result.remainingVoids = phase1.voidsDetected;
      logSystemEvent('WARN', 'AGENTIC_COMPLIANCE', 'Agent found no evidence - voids remain', {
        remainingVoids: result.remainingVoids.length
      });
      return result;
    }

    // ============================================
    // PHASE 3: Re-verify with New Evidence
    // ============================================
    logSystemEvent('INFO', 'AGENTIC_COMPLIANCE', 'Phase 3: Re-verification', {
      newEvidence: agentResult.evidence.length
    });

    // Append found evidence to inputs
    const evidenceText = agentResult.evidence
      .map(e => `\n\n[AGENT FOUND - ${e.source}]\n${e.content}`)
      .join('\n');

    const augmentedInputs = inputs + evidenceText;

    const phase3 = runSealedPacketVerification(augmentedInputs, checklist, goal, 'AGENTIC_CHECK_P3');

    result.phases.push({
      phase: 3,
      name: 'Re-verification',
      success: phase3.success,
      voidsDetected: phase3.voidsDetected.length,
      claims: phase3.finalCandidate?.claims?.length || 0
    });

    result.remainingVoids = phase3.voidsDetected;
    result.finalStatus = phase3.voidsDetected.length === 0 ? 'COMPLETE' : 'PARTIAL';

    // ============================================
    // FINAL LOGGING
    // ============================================
    const summaryText = [
      `[AGENTIC COMPLIANCE CHECK COMPLETE]`,
      `Session: ${result.sessionId}`,
      `Status: ${result.finalStatus}`,
      ``,
      `Phase 1 (Initial): ${phase1.voidsDetected.length} voids detected`,
      `Phase 2 (Agent): ${agentResult.evidence.length} items found, ${agentResult.iterations} iterations`,
      `Phase 3 (Re-verify): ${phase3.voidsDetected.length} voids remaining`,
      ``,
      `Evidence Found:`,
      ...result.allEvidence.map(e => `  ✓ ${e.item} (${e.source})`),
      ``,
      `Remaining Voids:`,
      ...result.remainingVoids.map(v => `  ✗ ${v.missing_artifact}`)
    ].join('\n');

    safeNewEntry(
      'System',
      'AGENTIC_COMPLIANCE_COMPLETE',
      summaryText,
      '',
      result.finalStatus === 'COMPLETE' ? 'VERIFIED' : 'DRAFT'
    );

    logSystemEvent('SUCCESS', 'AGENTIC_COMPLIANCE', 'Check complete', {
      status: result.finalStatus,
      evidenceFound: result.allEvidence.length,
      voidsRemaining: result.remainingVoids.length
    });

  } catch (e) {
    result.finalStatus = 'ERROR';
    result.error = e.message;
    logSystemEvent('ERROR', 'AGENTIC_COMPLIANCE', 'Check failed', { error: e.message });
  }

  result.endTime = new Date().toISOString();
  return result;
}


// ==========================
// CONTINUOUS MONITORING
// ==========================

/**
 * Set up a trigger to run agentic compliance checks periodically
 */
function setupAgenticMonitoring() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'runScheduledAgenticCheck') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create daily trigger
  ScriptApp.newTrigger('runScheduledAgenticCheck')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  logSystemEvent('SUCCESS', 'AGENTIC_COMPLIANCE', 'Daily monitoring trigger created', {});

  if (_inUi()) {
    SpreadsheetApp.getUi().alert('Agentic monitoring scheduled for 9 AM daily.');
  }
}

function runScheduledAgenticCheck() {
  // Get config from properties
  const config = PropertiesService.getScriptProperties();
  const monitoringGoal = config.getProperty('MONITORING_GOAL');
  const monitoringChecklist = config.getProperty('MONITORING_CHECKLIST');
  const monitoringInputsDocId = config.getProperty('MONITORING_INPUTS_DOC_ID');

  if (!monitoringGoal || !monitoringChecklist) {
    logSystemEvent('WARN', 'AGENTIC_COMPLIANCE', 'Scheduled check skipped - no config', {});
    return;
  }

  // Fetch inputs from doc if configured
  let inputs = '';
  if (monitoringInputsDocId) {
    try {
      const doc = DocumentApp.openById(monitoringInputsDocId);
      inputs = doc.getBody().getText();
    } catch (e) {
      logSystemEvent('ERROR', 'AGENTIC_COMPLIANCE', 'Could not read monitoring inputs doc', { error: e.message });
      return;
    }
  }

  // Run the check
  const result = runAgenticComplianceCheck(inputs, monitoringChecklist, monitoringGoal);

  // Send alert email if voids found
  if (result.remainingVoids.length > 0) {
    const alertEmail = config.getProperty('ALERT_EMAIL');
    if (alertEmail) {
      const subject = `[Newton Agent] ${result.remainingVoids.length} compliance voids detected`;
      const body = [
        `Newton Agent Compliance Check Results`,
        ``,
        `Status: ${result.finalStatus}`,
        `Goal: ${monitoringGoal}`,
        ``,
        `Remaining Voids:`,
        ...result.remainingVoids.map(v => `  - ${v.missing_artifact}`),
        ``,
        `Evidence Found by Agent:`,
        ...result.allEvidence.map(e => `  - ${e.item} (${e.source})`),
        ``,
        `Check the Audit Ledger for full details.`
      ].join('\n');

      MailApp.sendEmail(alertEmail, subject, body);
      logSystemEvent('INFO', 'AGENTIC_COMPLIANCE', 'Alert email sent', { to: alertEmail });
    }
  }
}


// ==========================
// GHOST CLIENT HUNTER
// ==========================

/**
 * Special agent mode: Find "ghost" clients - ordered in 2024, silent in 2025/2026
 */
function runGhostClientHunt() {
  const goal = `Find corporate clients who placed orders in 2024 but have not contacted us in 2025 or 2026.
These are "ghost" leads that may be ready for re-engagement.`;

  const checklist = `Corporate cookie orders from 2024
Corporate event orders from 2024
Clients who ordered $500+ in 2024
Clients with multiple orders in 2024
Any 2024 client with no emails in 2025-2026`;

  logSystemEvent('INFO', 'GHOST_HUNT', 'Starting ghost client hunt', {});

  // Custom agent investigation focused on client hunting
  const result = runAgentInvestigation(goal, checklist);

  // Build ghost list
  const ghostClients = [];
  for (const evidence of result.evidence) {
    if (evidence.source.includes('2024') && !evidence.content.includes('2025') && !evidence.content.includes('2026')) {
      ghostClients.push({
        name: evidence.item,
        lastContact: evidence.source,
        details: evidence.content.substring(0, 200)
      });
    }
  }

  // Log results
  const summaryText = [
    `[GHOST CLIENT HUNT COMPLETE]`,
    ``,
    `Potential Ghost Clients: ${ghostClients.length}`,
    ``,
    ...ghostClients.map(g => `  - ${g.name} (last: ${g.lastContact})`)
  ].join('\n');

  safeNewEntry('System', 'GHOST_HUNT', summaryText, '', 'DRAFT');

  logSystemEvent('SUCCESS', 'GHOST_HUNT', 'Hunt complete', {
    ghostsFound: ghostClients.length
  });

  return {
    ghostClients: ghostClients,
    fullResult: result
  };
}


// ==========================
// UI FUNCTIONS
// ==========================

function runAgenticComplianceFromUI() {
  const ui = SpreadsheetApp.getUi();

  // Get inputs
  const inputsResponse = ui.prompt(
    'Agentic Compliance - Step 1/3',
    'Paste document text or Google Doc URL:',
    ui.ButtonSet.OK_CANCEL
  );
  if (inputsResponse.getSelectedButton() !== ui.Button.OK) return;
  let inputs = inputsResponse.getResponseText();

  // If URL, fetch the doc
  if (inputs.startsWith('https://docs.google.com/document')) {
    try {
      const docId = inputs.match(/\/d\/([a-zA-Z0-9-_]+)/)[1];
      const doc = DocumentApp.openById(docId);
      inputs = doc.getBody().getText();
    } catch (e) {
      ui.alert('Error', 'Could not read Google Doc: ' + e.message, ui.ButtonSet.OK);
      return;
    }
  }

  const checklistResponse = ui.prompt(
    'Agentic Compliance - Step 2/3',
    'Required checklist items (one per line):',
    ui.ButtonSet.OK_CANCEL
  );
  if (checklistResponse.getSelectedButton() !== ui.Button.OK) return;
  const checklist = checklistResponse.getResponseText();

  const goalResponse = ui.prompt(
    'Agentic Compliance - Step 3/3',
    'Verification goal (one sentence):',
    ui.ButtonSet.OK_CANCEL
  );
  if (goalResponse.getSelectedButton() !== ui.Button.OK) return;
  const goal = goalResponse.getResponseText();

  ui.alert('Agent Starting',
    'Newton Agent is running a full agentic compliance check.\n\n' +
    'This involves:\n' +
    '1. Initial document verification\n' +
    '2. Autonomous hunting for missing items\n' +
    '3. Re-verification with found evidence\n\n' +
    'This may take several minutes.',
    ui.ButtonSet.OK
  );

  const result = runAgenticComplianceCheck(inputs, checklist, goal);

  // Show results
  let resultText = `AGENTIC COMPLIANCE CHECK COMPLETE\n\n`;
  resultText += `Session: ${result.sessionId}\n`;
  resultText += `Status: ${result.finalStatus}\n`;
  resultText += `Phases: ${result.phases.length}\n\n`;

  for (const phase of result.phases) {
    resultText += `Phase ${phase.phase}: ${phase.name}\n`;
    if (phase.voidsDetected !== undefined) resultText += `  Voids: ${phase.voidsDetected}\n`;
    if (phase.evidenceFound !== undefined) resultText += `  Evidence: ${phase.evidenceFound}\n`;
  }

  resultText += `\nEVIDENCE FOUND: ${result.allEvidence.length}\n`;
  for (const e of result.allEvidence) {
    resultText += `  ✓ ${e.item}\n`;
  }

  resultText += `\nREMAINING VOIDS: ${result.remainingVoids.length}\n`;
  for (const v of result.remainingVoids) {
    resultText += `  ✗ ${v.missing_artifact || v.item}\n`;
  }

  ui.alert('Agentic Compliance Results', resultText, ui.ButtonSet.OK);
}

function runGhostHuntFromUI() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    'Ghost Client Hunt',
    'This will search your Gmail and Drive for corporate clients who ordered in 2024 but have gone silent in 2025-2026.\n\nProceed?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  ui.alert('Hunting', 'Newton Agent is hunting for ghost clients. This may take a few minutes.', ui.ButtonSet.OK);

  const result = runGhostClientHunt();

  let resultText = `GHOST CLIENT HUNT COMPLETE\n\n`;
  resultText += `Potential Ghost Clients: ${result.ghostClients.length}\n\n`;

  for (const ghost of result.ghostClients) {
    resultText += `• ${ghost.name}\n`;
    resultText += `  Last contact: ${ghost.lastContact}\n\n`;
  }

  if (result.ghostClients.length === 0) {
    resultText += `No ghost clients found. Your client engagement is strong!`;
  }

  ui.alert('Ghost Hunt Results', resultText, ui.ButtonSet.OK);
}


// ==========================
// MENU INTEGRATION
// ==========================

function addAgenticComplianceMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Newton Agent')
    .addItem('Run Investigation', 'runAgentFromUI')
    .addItem('Agentic Compliance Check', 'runAgenticComplianceFromUI')
    .addSeparator()
    .addItem('Ghost Client Hunt', 'runGhostHuntFromUI')
    .addSeparator()
    .addItem('Setup Daily Monitoring', 'setupAgenticMonitoring')
    .addSeparator()
    .addItem('Test Agent Flow', 'testAgentFlow')
    .addToUi();
}
