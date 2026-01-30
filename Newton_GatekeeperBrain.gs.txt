/**
 * ───────────────────────────────────────────────
 *  NEWTON GATEKEEPER BRAIN : SELF-LEARNING POLICY
 * ───────────────────────────────────────────────
 *
 *  Watches every Gatekeeper decision, learns which rules
 *  catch real problems vs create noise, then rewrites
 *  policy automatically.
 *
 *  Over time:
 *  - Tax workflows → tighter confidence requirements
 *  - Engineering brainstorming → loose mode
 *  - All without touching a single regex
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const BRAIN_CONFIG = {
  POLICY_SHEET: 'Gatekeeper_Policy',
  LEARNING_SHEET: 'Gatekeeper_Learning',

  // Minimum samples before adjusting policy
  MIN_SAMPLES: 10,

  // If a rule fires but entries are later marked VERIFIED, it's noise
  NOISE_THRESHOLD: 0.7,  // 70% false positive = noise

  // If a rule fires and entries are later marked VIOLATED, it's signal
  SIGNAL_THRESHOLD: 0.3, // 30% true positive = useful signal

  // Auto-tune bounds
  DRIFT_SCORE_MIN: 1,
  DRIFT_SCORE_MAX: 20,

  // Event type categories (can be extended)
  CATEGORIES: {
    TAX: ['TAX_POSITION', 'TAX_ANALYSIS', 'TAX_OPINION', 'COMPLIANCE_CHECK'],
    LEGAL: ['LEGAL_OPINION', 'DETERMINATION', 'FINDING', 'CONCLUSION'],
    ENGINEERING: ['BRAINSTORM', 'DRAFT', 'EXPLORATION', 'RESEARCH'],
    CUSTOMER: ['CUSTOMER_REPLY', 'CLIENT_COMMUNICATION', 'EXTERNAL']
  },

  // Default policy per category
  DEFAULT_POLICY: {
    TAX: { mode: 'STRICT', maxDrift: 3, requiredConfidence: 'KNOWN_KNOWN' },
    LEGAL: { mode: 'STRICT', maxDrift: 5, requiredConfidence: 'KNOWN_KNOWN' },
    ENGINEERING: { mode: 'PERMISSIVE', maxDrift: 15, requiredConfidence: null },
    CUSTOMER: { mode: 'STRICT', maxDrift: 2, requiredConfidence: 'KNOWN_KNOWN' },
    DEFAULT: { mode: 'WARN', maxDrift: 5, requiredConfidence: null }
  }
};


// ==========================
// POLICY SHEET SETUP
// ==========================

/**
 * Create or get the policy sheet.
 */
function setupPolicySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BRAIN_CONFIG.POLICY_SHEET);

  if (!sh) {
    sh = ss.insertSheet(BRAIN_CONFIG.POLICY_SHEET);
    const headers = [
      'Category', 'Event_Type', 'Mode', 'Max_Drift_Score',
      'Required_Confidence', 'Pattern_Overrides', 'Last_Updated',
      'Samples', 'Signal_Rate', 'Noise_Rate', 'Auto_Tuned'
    ];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#4a4a4a')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);

    // Seed with defaults
    const defaults = [];
    for (const [category, policy] of Object.entries(BRAIN_CONFIG.DEFAULT_POLICY)) {
      defaults.push([
        category,
        '*',  // All event types in category
        policy.mode,
        policy.maxDrift,
        policy.requiredConfidence || '',
        '{}',  // No pattern overrides yet
        new Date().toISOString(),
        0,
        0,
        0,
        false
      ]);
    }
    sh.getRange(2, 1, defaults.length, 11).setValues(defaults);

    logSystemEvent('SUCCESS', 'BRAIN', 'Policy sheet created with defaults');
  }

  return sh;
}

/**
 * Create or get the learning sheet (tracks outcomes).
 */
function setupLearningSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BRAIN_CONFIG.LEARNING_SHEET);

  if (!sh) {
    sh = ss.insertSheet(BRAIN_CONFIG.LEARNING_SHEET);
    const headers = [
      'Entry_UUID', 'Timestamp', 'Event_Type', 'Category',
      'Gatekeeper_Decision', 'Violations_Fired', 'Drift_Score',
      'Confidence_Level', 'Outcome', 'Outcome_Timestamp',
      'Pattern_Details'
    ];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#4a4a4a')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);

    logSystemEvent('SUCCESS', 'BRAIN', 'Learning sheet created');
  }

  return sh;
}


// ==========================
// CATEGORY DETECTION
// ==========================

/**
 * Determine category for an event type.
 */
function getCategoryForEventType(eventType) {
  const upper = String(eventType).toUpperCase();

  for (const [category, types] of Object.entries(BRAIN_CONFIG.CATEGORIES)) {
    if (types.includes(upper)) {
      return category;
    }
  }

  // Fuzzy matching
  if (upper.includes('TAX')) return 'TAX';
  if (upper.includes('LEGAL') || upper.includes('COMPLIANCE')) return 'LEGAL';
  if (upper.includes('DRAFT') || upper.includes('BRAINSTORM')) return 'ENGINEERING';
  if (upper.includes('CUSTOMER') || upper.includes('CLIENT')) return 'CUSTOMER';

  return 'DEFAULT';
}


// ==========================
// POLICY LOOKUP
// ==========================

/**
 * Get effective policy for an event type.
 * Checks specific event type first, then category, then default.
 */
function getEffectivePolicy(eventType) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BRAIN_CONFIG.POLICY_SHEET);
  if (!sh) {
    return BRAIN_CONFIG.DEFAULT_POLICY.DEFAULT;
  }

  const category = getCategoryForEventType(eventType);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return BRAIN_CONFIG.DEFAULT_POLICY[category] || BRAIN_CONFIG.DEFAULT_POLICY.DEFAULT;
  }

  const data = sh.getRange(2, 1, lastRow - 1, 11).getValues();

  // First pass: exact event type match
  for (const row of data) {
    if (row[1].toUpperCase() === eventType.toUpperCase()) {
      return {
        mode: row[2],
        maxDrift: row[3],
        requiredConfidence: row[4] || null,
        patternOverrides: JSON.parse(row[5] || '{}'),
        autoTuned: row[10]
      };
    }
  }

  // Second pass: category match
  for (const row of data) {
    if (row[0].toUpperCase() === category && row[1] === '*') {
      return {
        mode: row[2],
        maxDrift: row[3],
        requiredConfidence: row[4] || null,
        patternOverrides: JSON.parse(row[5] || '{}'),
        autoTuned: row[10]
      };
    }
  }

  // Fallback
  return BRAIN_CONFIG.DEFAULT_POLICY.DEFAULT;
}


// ==========================
// LEARNING RECORDER
// ==========================

/**
 * Record a gatekeeper decision for learning.
 * Called automatically by gatedAIRequest() after postcheck.
 */
function recordGatekeeperDecision(entryUuid, eventType, decision, violations, driftScore, confidenceLevel) {
  const sh = setupLearningSheet();
  const category = getCategoryForEventType(eventType);

  const violationTypes = violations.map(v => v.type).join(', ');
  const patternDetails = JSON.stringify(violations.map(v => ({
    type: v.type,
    pattern: v.pattern || v.marker || null,
    count: v.count || 1
  })));

  sh.appendRow([
    entryUuid,
    new Date().toISOString(),
    eventType,
    category,
    decision,  // ALLOWED, BLOCKED, WARNING
    violationTypes,
    driftScore,
    confidenceLevel || '',
    'PENDING',  // Outcome TBD
    '',
    patternDetails
  ]);

  logSystemEvent('INFO', 'BRAIN', 'Decision recorded for learning', {
    entryUuid,
    eventType,
    category,
    decision,
    driftScore
  });
}

/**
 * Mark an entry outcome (was the gatekeeper decision correct?).
 * Call this when an entry is later verified or flagged as wrong.
 */
function recordOutcome(entryUuid, outcome) {
  // outcome: 'CORRECT' (gatekeeper was right) or 'WRONG' (false positive/negative)
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BRAIN_CONFIG.LEARNING_SHEET);
  if (!sh) return;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const data = sh.getRange(2, 1, lastRow - 1, 11).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === entryUuid) {
      sh.getRange(i + 2, 9).setValue(outcome);
      sh.getRange(i + 2, 10).setValue(new Date().toISOString());

      logSystemEvent('INFO', 'BRAIN', 'Outcome recorded', {
        entryUuid,
        outcome,
        originalDecision: data[i][4]
      });

      return;
    }
  }
}


// ==========================
// LEARNING ANALYSIS
// ==========================

/**
 * Analyze learning data and compute signal/noise rates.
 */
function analyzeLearningData() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BRAIN_CONFIG.LEARNING_SHEET);
  if (!sh) return null;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const data = sh.getRange(2, 1, lastRow - 1, 11).getValues();

  // Group by category and pattern
  const stats = {};

  for (const row of data) {
    const category = row[3];
    const decision = row[4];
    const violations = row[5];
    const outcome = row[8];

    if (outcome === 'PENDING') continue;  // Skip unresolved

    if (!stats[category]) {
      stats[category] = {
        total: 0,
        blocked: 0,
        warnings: 0,
        correct: 0,
        wrong: 0,
        byPattern: {}
      };
    }

    stats[category].total++;
    if (decision === 'BLOCKED') stats[category].blocked++;
    if (decision === 'WARNING') stats[category].warnings++;
    if (outcome === 'CORRECT') stats[category].correct++;
    if (outcome === 'WRONG') stats[category].wrong++;

    // Track by violation pattern
    if (violations) {
      const patterns = violations.split(', ');
      for (const pattern of patterns) {
        if (!stats[category].byPattern[pattern]) {
          stats[category].byPattern[pattern] = { fired: 0, correct: 0, wrong: 0 };
        }
        stats[category].byPattern[pattern].fired++;
        if (outcome === 'CORRECT') stats[category].byPattern[pattern].correct++;
        if (outcome === 'WRONG') stats[category].byPattern[pattern].wrong++;
      }
    }
  }

  // Compute rates
  for (const category of Object.keys(stats)) {
    const s = stats[category];
    s.signalRate = s.total > 0 ? s.correct / s.total : 0;
    s.noiseRate = s.total > 0 ? s.wrong / s.total : 0;

    for (const pattern of Object.keys(s.byPattern)) {
      const p = s.byPattern[pattern];
      p.signalRate = p.fired > 0 ? p.correct / p.fired : 0;
      p.noiseRate = p.fired > 0 ? p.wrong / p.fired : 0;
    }
  }

  return stats;
}


// ==========================
// AUTO-TUNING
// ==========================

/**
 * Run auto-tuning based on learning data.
 * Adjusts policy sheet based on signal/noise analysis.
 */
function autoTunePolicy() {
  const stats = analyzeLearningData();
  if (!stats) {
    logSystemEvent('INFO', 'BRAIN', 'No learning data to analyze');
    return { tuned: false, reason: 'No data' };
  }

  const policySh = setupPolicySheet();
  const lastRow = policySh.getLastRow();
  const policyData = lastRow > 1 ? policySh.getRange(2, 1, lastRow - 1, 11).getValues() : [];

  const changes = [];

  for (const [category, s] of Object.entries(stats)) {
    if (s.total < BRAIN_CONFIG.MIN_SAMPLES) {
      continue;  // Not enough data
    }

    // Find policy row for this category
    let rowIndex = -1;
    for (let i = 0; i < policyData.length; i++) {
      if (policyData[i][0] === category && policyData[i][1] === '*') {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex === -1) continue;

    const currentMode = policyData[rowIndex][2];
    const currentMaxDrift = policyData[rowIndex][3];

    let newMode = currentMode;
    let newMaxDrift = currentMaxDrift;

    // High noise rate → loosen policy
    if (s.noiseRate > BRAIN_CONFIG.NOISE_THRESHOLD) {
      if (currentMode === 'STRICT') newMode = 'WARN';
      newMaxDrift = Math.min(currentMaxDrift + 2, BRAIN_CONFIG.DRIFT_SCORE_MAX);

      changes.push({
        category,
        change: 'LOOSENED',
        reason: `Noise rate ${(s.noiseRate * 100).toFixed(1)}% exceeds threshold`,
        from: { mode: currentMode, maxDrift: currentMaxDrift },
        to: { mode: newMode, maxDrift: newMaxDrift }
      });
    }

    // High signal rate + many blocks → could tighten
    if (s.signalRate > BRAIN_CONFIG.SIGNAL_THRESHOLD && s.blocked > s.total * 0.1) {
      if (currentMode === 'WARN') newMode = 'STRICT';
      newMaxDrift = Math.max(currentMaxDrift - 1, BRAIN_CONFIG.DRIFT_SCORE_MIN);

      changes.push({
        category,
        change: 'TIGHTENED',
        reason: `Signal rate ${(s.signalRate * 100).toFixed(1)}% with ${s.blocked} blocks`,
        from: { mode: currentMode, maxDrift: currentMaxDrift },
        to: { mode: newMode, maxDrift: newMaxDrift }
      });
    }

    // Apply changes
    if (newMode !== currentMode || newMaxDrift !== currentMaxDrift) {
      policySh.getRange(rowIndex + 2, 3).setValue(newMode);
      policySh.getRange(rowIndex + 2, 4).setValue(newMaxDrift);
      policySh.getRange(rowIndex + 2, 7).setValue(new Date().toISOString());
      policySh.getRange(rowIndex + 2, 8).setValue(s.total);
      policySh.getRange(rowIndex + 2, 9).setValue(s.signalRate);
      policySh.getRange(rowIndex + 2, 10).setValue(s.noiseRate);
      policySh.getRange(rowIndex + 2, 11).setValue(true);
    }

    // Pattern-specific overrides
    const patternOverrides = {};
    for (const [pattern, p] of Object.entries(s.byPattern)) {
      if (p.fired >= 5) {  // Enough samples
        if (p.noiseRate > 0.8) {
          // This pattern is almost pure noise - disable it
          patternOverrides[pattern] = { enabled: false, reason: 'noise' };
        } else if (p.signalRate > 0.8) {
          // This pattern is high signal - boost weight
          patternOverrides[pattern] = { weight: 2, reason: 'high_signal' };
        }
      }
    }

    if (Object.keys(patternOverrides).length > 0) {
      policySh.getRange(rowIndex + 2, 6).setValue(JSON.stringify(patternOverrides));
      changes.push({
        category,
        change: 'PATTERN_OVERRIDES',
        overrides: patternOverrides
      });
    }
  }

  if (changes.length > 0) {
    logSystemEvent('SUCCESS', 'BRAIN', 'Auto-tune completed', { changes });

    // Record the tuning event in the ledger
    safeNewEntry(
      'System',
      'BRAIN_AUTOTUNE',
      `[GATEKEEPER_BRAIN]\nAuto-tuned ${changes.length} policies\n\n` +
      changes.map(c => `${c.category}: ${c.change}`).join('\n'),
      '',
      'FINAL'
    );
  }

  return { tuned: changes.length > 0, changes };
}


// ==========================
// INTEGRATION WITH GATEKEEPER
// ==========================

/**
 * Enhanced gatekeeper postcheck that uses learned policy.
 * Replace or wrap the existing gatekeeperPostcheck.
 */
function brainAwarePostcheck(response, precheckResult, options) {
  const eventType = options.eventType || 'UNKNOWN';
  const policy = getEffectivePolicy(eventType);

  // Override gatekeeper config with learned policy
  const enhancedOptions = {
    ...options,
    mode: policy.mode,
    maxDriftScore: policy.maxDrift,
    requireConfidence: policy.requiredConfidence,
    patternOverrides: policy.patternOverrides
  };

  // Run standard postcheck with learned settings
  const result = gatekeeperPostcheck(response, precheckResult, enhancedOptions);

  // Apply pattern overrides
  if (policy.patternOverrides) {
    result.violations = result.violations.filter(v => {
      const override = policy.patternOverrides[v.type];
      if (override && override.enabled === false) {
        return false;  // Disabled pattern
      }
      return true;
    });

    // Recalculate drift score with weights
    result.drift_score = result.violations.reduce((score, v) => {
      const override = policy.patternOverrides[v.type];
      const weight = override?.weight || 1;
      const baseScore = v.severity === 'CRITICAL' ? 30 : (v.severity === 'WARNING' ? 10 : 2);
      return score + (baseScore * weight * (v.count || 1));
    }, 0);
  }

  // Re-evaluate allowed based on learned maxDrift
  if (result.drift_score > policy.maxDrift && policy.mode === 'STRICT') {
    result.allowed = false;
  }

  // Record for learning (async)
  if (precheckResult.entry_uuid) {
    recordGatekeeperDecision(
      precheckResult.entry_uuid,
      eventType,
      result.allowed ? 'ALLOWED' : (policy.mode === 'STRICT' ? 'BLOCKED' : 'WARNING'),
      result.violations,
      result.drift_score,
      precheckResult.confidence_level
    );
  }

  return result;
}


// ==========================
// SCHEDULED LEARNING
// ==========================

/**
 * Run daily learning analysis and tuning.
 * Set up as a time-driven trigger.
 */
function dailyBrainTuning() {
  logSystemEvent('INFO', 'BRAIN', 'Starting daily tuning');

  const result = autoTunePolicy();

  if (result.tuned) {
    // Send alert about policy changes
    const email = _getProp('ALERT_EMAIL', null);
    if (email) {
      const subject = '[Newton] Gatekeeper Brain: Policy Auto-Tuned';
      const body = `The Gatekeeper Brain has automatically adjusted policies based on learning data:\n\n` +
        result.changes.map(c =>
          `${c.category}: ${c.change}\n  Reason: ${c.reason || 'Pattern overrides'}`
        ).join('\n\n');

      MailApp.sendEmail(email, subject, body);
    }
  }

  logSystemEvent('SUCCESS', 'BRAIN', 'Daily tuning completed', result);
}

/**
 * Set up daily trigger for brain tuning.
 */
function setupBrainTrigger() {
  // Remove existing
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'dailyBrainTuning') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create new - run at 3 AM daily
  ScriptApp.newTrigger('dailyBrainTuning')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  logSystemEvent('SUCCESS', 'BRAIN', 'Daily tuning trigger set for 3 AM');

  if (_inUi()) {
    SpreadsheetApp.getUi().alert('Brain trigger set. Auto-tuning will run daily at 3 AM.');
  }
}


// ==========================
// UI FUNCTIONS
// ==========================

function viewPolicySheet() {
  const sh = setupPolicySheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
}

function viewLearningSheet() {
  const sh = setupLearningSheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
}

function runAutoTuneFromUI() {
  const ui = SpreadsheetApp.getUi();

  const result = autoTunePolicy();

  if (!result.tuned) {
    ui.alert('Auto-Tune', `No changes made.\nReason: ${result.reason || 'Not enough data or no adjustments needed'}`, ui.ButtonSet.OK);
    return;
  }

  let report = `AUTO-TUNE RESULTS\n\n${result.changes.length} policy changes:\n\n`;
  for (const c of result.changes) {
    report += `${c.category}: ${c.change}\n`;
    if (c.reason) report += `  Reason: ${c.reason}\n`;
    if (c.from && c.to) {
      report += `  From: ${c.from.mode}, maxDrift=${c.from.maxDrift}\n`;
      report += `  To: ${c.to.mode}, maxDrift=${c.to.maxDrift}\n`;
    }
    report += '\n';
  }

  ui.alert('Auto-Tune Complete', report, ui.ButtonSet.OK);
}

function markOutcomeFromUI() {
  const ui = SpreadsheetApp.getUi();

  const uuidResponse = ui.prompt(
    'Mark Outcome - Step 1/2',
    'Enter the Entry UUID to mark:',
    ui.ButtonSet.OK_CANCEL
  );
  if (uuidResponse.getSelectedButton() !== ui.Button.OK) return;
  const uuid = uuidResponse.getResponseText().trim();

  const outcomeResponse = ui.prompt(
    'Mark Outcome - Step 2/2',
    'Was the gatekeeper decision correct?\n\n• CORRECT - Gatekeeper was right\n• WRONG - False positive/negative',
    ui.ButtonSet.OK_CANCEL
  );
  if (outcomeResponse.getSelectedButton() !== ui.Button.OK) return;
  const outcome = outcomeResponse.getResponseText().trim().toUpperCase();

  if (!['CORRECT', 'WRONG'].includes(outcome)) {
    ui.alert('Invalid outcome. Must be CORRECT or WRONG.');
    return;
  }

  recordOutcome(uuid, outcome);
  ui.alert('Outcome recorded. This will be used in the next auto-tune cycle.');
}

function viewBrainStats() {
  const ui = SpreadsheetApp.getUi();
  const stats = analyzeLearningData();

  if (!stats) {
    ui.alert('No learning data yet.');
    return;
  }

  let report = `GATEKEEPER BRAIN STATISTICS\n\n`;

  for (const [category, s] of Object.entries(stats)) {
    report += `${category}:\n`;
    report += `  Total: ${s.total}\n`;
    report += `  Signal Rate: ${(s.signalRate * 100).toFixed(1)}%\n`;
    report += `  Noise Rate: ${(s.noiseRate * 100).toFixed(1)}%\n`;
    report += `  Blocked: ${s.blocked}, Warnings: ${s.warnings}\n`;

    const patternCount = Object.keys(s.byPattern).length;
    if (patternCount > 0) {
      report += `  Patterns tracked: ${patternCount}\n`;
    }
    report += '\n';
  }

  ui.alert('Brain Statistics', report, ui.ButtonSet.OK);
}


// ==========================
// MENU
// ==========================

function addBrainMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Brain')
    .addItem('View Policy', 'viewPolicySheet')
    .addItem('View Learning Data', 'viewLearningSheet')
    .addSeparator()
    .addItem('Run Auto-Tune Now', 'runAutoTuneFromUI')
    .addItem('View Statistics', 'viewBrainStats')
    .addSeparator()
    .addItem('Mark Outcome', 'markOutcomeFromUI')
    .addSeparator()
    .addItem('Setup Daily Tuning', 'setupBrainTrigger')
    .addToUi();
}
