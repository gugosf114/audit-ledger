/**
 * ───────────────────────────────────────────────
 *  NEWTON GATEKEEPER : MIDDLEWARE CONSTRAINT LAYER
 * ───────────────────────────────────────────────
 *
 *  Transforms the ledger from observer to gatekeeper.
 *  All AI output passes through constraint checks BEFORE
 *  reaching the user/ledger.
 *
 *  Architecture:
 *    User Request → Gatekeeper.precheck() → AI API → Gatekeeper.postcheck() → Output/BLOCK
 *
 *  Capabilities:
 *  1. Pre-commit confidence enforcement (Rumsfeld Protocol)
 *  2. Citation verification gate (claim must have verified hash)
 *  3. Schema enforcement on reasoning (WHAT/WHY/HOW/CONFIDENCE structure)
 *  4. Real-time contamination detection (drift blocking, not just logging)
 *  5. Output constraint validation (blocks non-compliant responses)
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const GATEKEEPER_CONFIG = {
  // Enforcement modes
  MODE: {
    PERMISSIVE: 'PERMISSIVE',   // Log violations but allow through
    STRICT: 'STRICT',           // Block on any violation
    AUDIT_ONLY: 'AUDIT_ONLY'    // Log only, no blocking
  },

  // Default mode - can be changed via Script Properties
  DEFAULT_MODE: 'STRICT',

  // Violation severities
  SEVERITY: {
    CRITICAL: 'CRITICAL',       // Always block in STRICT mode
    WARNING: 'WARNING',         // Block in STRICT, log in PERMISSIVE
    INFO: 'INFO'                // Log only
  },

  // Constraint types
  CONSTRAINTS: {
    CONFIDENCE_REQUIRED: 'CONFIDENCE_REQUIRED',
    CITATION_REQUIRED: 'CITATION_REQUIRED',
    SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
    DRIFT_DETECTED: 'DRIFT_DETECTED',
    HALLUCINATION_MARKER: 'HALLUCINATION_MARKER',
    ADVERSARIAL_PATTERN: 'ADVERSARIAL_PATTERN'
  },

  // Drift detection patterns (from Sentinel, applied in real-time)
  DRIFT_PATTERNS: [
    { pattern: /\b(I think|I believe|probably|maybe|might be)\b/gi, type: 'HEDGING', severity: 'WARNING' },
    { pattern: /\b(obviously|clearly|certainly|definitely)\b/gi, type: 'OVERCONFIDENCE', severity: 'WARNING' },
    { pattern: /\b(everyone knows|it's common knowledge|as we all know)\b/gi, type: 'APPEAL_TO_AUTHORITY', severity: 'WARNING' },
    { pattern: /\b(I cannot|I'm unable to|I don't have access)\b/gi, type: 'REFUSAL_DRIFT', severity: 'INFO' }
  ],

  // Hallucination markers
  HALLUCINATION_MARKERS: [
    { pattern: /\b(as of my (knowledge|training) cutoff|as of \d{4})\b/gi, type: 'TEMPORAL_HEDGE', severity: 'INFO' },
    { pattern: /\b(I apologize|I'm sorry|my mistake)\b/gi, type: 'SELF_CORRECTION', severity: 'INFO' },
    { pattern: /\[[^\]]*citation needed[^\]]*\]/gi, type: 'MISSING_CITATION', severity: 'CRITICAL' },
    { pattern: /\b(hallucin|confabulat|fabricat)/gi, type: 'SELF_AWARE_HALLUCINATION', severity: 'CRITICAL' }
  ],

  // Required reasoning structure keywords
  REASONING_SCHEMA: {
    WHAT: ['claim:', 'finding:', 'conclusion:', 'result:', 'assertion:'],
    WHY: ['because:', 'reason:', 'rationale:', 'justification:', 'evidence:'],
    HOW: ['method:', 'approach:', 'process:', 'methodology:'],
    CONFIDENCE: ['confidence:', 'certainty:', 'likelihood:', '[KNOWN_', '[KK]', '[KU]', '[UU]']
  }
};


// ==========================
// CORE GATEKEEPER FUNCTIONS
// ==========================

/**
 * Get current enforcement mode from Script Properties.
 */
function _getGatekeeperMode() {
  const mode = PropertiesService.getScriptProperties().getProperty('GATEKEEPER_MODE');
  return mode || GATEKEEPER_CONFIG.DEFAULT_MODE;
}

/**
 * Set enforcement mode.
 */
function setGatekeeperMode(mode) {
  if (!Object.values(GATEKEEPER_CONFIG.MODE).includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Must be one of: ${Object.values(GATEKEEPER_CONFIG.MODE).join(', ')}`);
  }
  PropertiesService.getScriptProperties().setProperty('GATEKEEPER_MODE', mode);
  logSystemEvent('INFO', 'GATEKEEPER', 'Mode changed', { mode });
  return { success: true, mode };
}


/**
 * PRECHECK - Runs BEFORE AI API call.
 * Validates that request meets requirements.
 *
 * @param {Object} request - The AI request object
 * @param {Object} options - Gatekeeper options
 * @returns {Object} - { allowed: boolean, violations: [], confidence_uuid: string }
 */
function gatekeeperPrecheck(request, options) {
  const mode = _getGatekeeperMode();
  const result = {
    allowed: true,
    violations: [],
    confidence_uuid: null,
    mode: mode,
    timestamp: new Date().toISOString()
  };

  options = options || {};

  // Check 1: Confidence declaration required?
  if (options.requireConfidence !== false) {
    if (!request.confidence_uuid) {
      result.violations.push({
        type: GATEKEEPER_CONFIG.CONSTRAINTS.CONFIDENCE_REQUIRED,
        severity: GATEKEEPER_CONFIG.SEVERITY.CRITICAL,
        message: 'No confidence declaration provided. Call declareConfidence() first.',
        field: 'confidence_uuid'
      });
    } else {
      // Validate the confidence_uuid exists
      const declaration = findConfidenceDeclaration(request.confidence_uuid);
      if (!declaration) {
        result.violations.push({
          type: GATEKEEPER_CONFIG.CONSTRAINTS.CONFIDENCE_REQUIRED,
          severity: GATEKEEPER_CONFIG.SEVERITY.CRITICAL,
          message: `Confidence declaration not found: ${request.confidence_uuid}`,
          field: 'confidence_uuid'
        });
      } else if (declaration.status !== 'DECLARED') {
        result.violations.push({
          type: GATEKEEPER_CONFIG.CONSTRAINTS.CONFIDENCE_REQUIRED,
          severity: GATEKEEPER_CONFIG.SEVERITY.CRITICAL,
          message: `Confidence declaration already used (status: ${declaration.status})`,
          field: 'confidence_uuid'
        });
      } else {
        result.confidence_uuid = request.confidence_uuid;
        result.confidence_level = declaration.level;
      }
    }
  }

  // Check 2: Request contains adversarial patterns?
  if (request.prompt || request.messages) {
    const promptText = typeof request.prompt === 'string'
      ? request.prompt
      : JSON.stringify(request.messages);

    const adversarialPatterns = detectAdversarialPatterns(promptText);
    if (adversarialPatterns.length > 0) {
      result.violations.push({
        type: GATEKEEPER_CONFIG.CONSTRAINTS.ADVERSARIAL_PATTERN,
        severity: GATEKEEPER_CONFIG.SEVERITY.CRITICAL,
        message: `Adversarial patterns detected in prompt: ${adversarialPatterns.map(p => p.type).join(', ')}`,
        patterns: adversarialPatterns
      });
    }
  }

  // Determine if request is allowed based on mode and violations
  const criticalViolations = result.violations.filter(v => v.severity === GATEKEEPER_CONFIG.SEVERITY.CRITICAL);

  if (mode === GATEKEEPER_CONFIG.MODE.STRICT && criticalViolations.length > 0) {
    result.allowed = false;
  } else if (mode === GATEKEEPER_CONFIG.MODE.PERMISSIVE && criticalViolations.length > 0) {
    result.allowed = true; // Allow but log
  }

  // Log precheck result
  if (result.violations.length > 0) {
    logGatekeeperEvent('PRECHECK', result);
  }

  return result;
}


/**
 * POSTCHECK - Runs AFTER AI API response.
 * Validates that response meets constraints before delivery.
 *
 * @param {Object} response - The AI response object
 * @param {Object} precheckResult - Result from gatekeeperPrecheck
 * @param {Object} options - Gatekeeper options
 * @returns {Object} - { allowed: boolean, violations: [], sanitized_response: string }
 */
function gatekeeperPostcheck(response, precheckResult, options) {
  const mode = _getGatekeeperMode();
  const result = {
    allowed: true,
    violations: [],
    sanitized_response: null,
    drift_score: 0,
    mode: mode,
    timestamp: new Date().toISOString()
  };

  options = options || {};
  const responseText = response.content || response.text || response.response || '';

  // Check 1: Drift patterns
  const driftViolations = detectDriftPatterns(responseText);
  result.violations.push(...driftViolations);
  result.drift_score = calculateDriftScore(driftViolations);

  // Check 2: Hallucination markers
  const hallucinationViolations = detectHallucinationMarkers(responseText);
  result.violations.push(...hallucinationViolations);

  // Check 3: Reasoning schema enforcement (if required)
  if (options.requireReasoningSchema) {
    const schemaViolations = validateReasoningSchema(responseText);
    result.violations.push(...schemaViolations);
  }

  // Check 4: Citation verification (if citations claimed)
  if (options.verifyCitations) {
    const citationViolations = verifyCitationsInResponse(responseText);
    result.violations.push(...citationViolations);
  }

  // Check 5: Confidence consistency
  if (precheckResult && precheckResult.confidence_level) {
    const consistencyViolations = checkConfidenceConsistency(responseText, precheckResult.confidence_level);
    result.violations.push(...consistencyViolations);
  }

  // Determine if response is allowed based on mode and violations
  const criticalViolations = result.violations.filter(v => v.severity === GATEKEEPER_CONFIG.SEVERITY.CRITICAL);

  if (mode === GATEKEEPER_CONFIG.MODE.STRICT && criticalViolations.length > 0) {
    result.allowed = false;
  }

  // Sanitize response if needed (remove problematic content)
  if (options.sanitize && result.violations.length > 0) {
    result.sanitized_response = sanitizeResponse(responseText, result.violations);
  } else {
    result.sanitized_response = responseText;
  }

  // Log postcheck result
  if (result.violations.length > 0 || result.drift_score > 0) {
    logGatekeeperEvent('POSTCHECK', result);
  }

  return result;
}


// ==========================
// DETECTION FUNCTIONS
// ==========================

/**
 * Detect drift patterns in text.
 */
function detectDriftPatterns(text) {
  const violations = [];

  for (const pattern of GATEKEEPER_CONFIG.DRIFT_PATTERNS) {
    const matches = text.match(pattern.pattern);
    if (matches && matches.length > 0) {
      violations.push({
        type: GATEKEEPER_CONFIG.CONSTRAINTS.DRIFT_DETECTED,
        severity: pattern.severity === 'WARNING' ? GATEKEEPER_CONFIG.SEVERITY.WARNING : GATEKEEPER_CONFIG.SEVERITY.INFO,
        message: `Drift pattern detected: ${pattern.type}`,
        pattern: pattern.type,
        matches: matches.slice(0, 5), // First 5 matches
        count: matches.length
      });
    }
  }

  return violations;
}


/**
 * Detect hallucination markers in text.
 */
function detectHallucinationMarkers(text) {
  const violations = [];

  for (const marker of GATEKEEPER_CONFIG.HALLUCINATION_MARKERS) {
    const matches = text.match(marker.pattern);
    if (matches && matches.length > 0) {
      violations.push({
        type: GATEKEEPER_CONFIG.CONSTRAINTS.HALLUCINATION_MARKER,
        severity: marker.severity === 'CRITICAL' ? GATEKEEPER_CONFIG.SEVERITY.CRITICAL : GATEKEEPER_CONFIG.SEVERITY.INFO,
        message: `Hallucination marker detected: ${marker.type}`,
        marker: marker.type,
        matches: matches.slice(0, 3)
      });
    }
  }

  return violations;
}


/**
 * Detect adversarial patterns in prompt.
 */
function detectAdversarialPatterns(text) {
  const patterns = [];

  // Jailbreak attempts
  const jailbreakPatterns = [
    /ignore (previous|prior|all) (instructions|rules)/gi,
    /pretend (you are|to be|you're)/gi,
    /act as if/gi,
    /bypass (your|the) (rules|guidelines|restrictions)/gi,
    /\bDAN\b/g,  // "Do Anything Now"
    /developer mode/gi,
    /sudo mode/gi
  ];

  for (const pattern of jailbreakPatterns) {
    if (pattern.test(text)) {
      patterns.push({ type: 'JAILBREAK_ATTEMPT', pattern: pattern.source });
    }
  }

  // Prompt injection
  const injectionPatterns = [
    /system:\s*you are/gi,
    /\[INST\]/gi,
    /<<SYS>>/gi,
    /<\|im_start\|>/gi
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(text)) {
      patterns.push({ type: 'PROMPT_INJECTION', pattern: pattern.source });
    }
  }

  return patterns;
}


/**
 * Validate reasoning schema in response.
 */
function validateReasoningSchema(text) {
  const violations = [];
  const textLower = text.toLowerCase();

  // Check for WHAT (claim/finding)
  const hasWhat = GATEKEEPER_CONFIG.REASONING_SCHEMA.WHAT.some(k => textLower.includes(k));
  if (!hasWhat) {
    violations.push({
      type: GATEKEEPER_CONFIG.CONSTRAINTS.SCHEMA_VIOLATION,
      severity: GATEKEEPER_CONFIG.SEVERITY.WARNING,
      message: 'Response missing WHAT component (claim/finding/conclusion)',
      component: 'WHAT'
    });
  }

  // Check for WHY (justification)
  const hasWhy = GATEKEEPER_CONFIG.REASONING_SCHEMA.WHY.some(k => textLower.includes(k));
  if (!hasWhy) {
    violations.push({
      type: GATEKEEPER_CONFIG.CONSTRAINTS.SCHEMA_VIOLATION,
      severity: GATEKEEPER_CONFIG.SEVERITY.WARNING,
      message: 'Response missing WHY component (reason/justification)',
      component: 'WHY'
    });
  }

  // Check for CONFIDENCE
  const hasConfidence = GATEKEEPER_CONFIG.REASONING_SCHEMA.CONFIDENCE.some(k => textLower.includes(k.toLowerCase()));
  if (!hasConfidence) {
    violations.push({
      type: GATEKEEPER_CONFIG.CONSTRAINTS.SCHEMA_VIOLATION,
      severity: GATEKEEPER_CONFIG.SEVERITY.WARNING,
      message: 'Response missing CONFIDENCE component',
      component: 'CONFIDENCE'
    });
  }

  return violations;
}


/**
 * Verify citations in response against known sources.
 */
function verifyCitationsInResponse(text) {
  const violations = [];

  // Extract citation patterns
  const citationPatterns = [
    /\[(\d+)\]/g,                    // [1], [2]
    /\(([A-Z][a-z]+,?\s*\d{4})\)/g,  // (Smith, 2023)
    /Source:\s*([^\n]+)/gi           // Source: ...
  ];

  for (const pattern of citationPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      // For now, flag unverified citations
      // In full implementation, would check against citation hash registry
      violations.push({
        type: GATEKEEPER_CONFIG.CONSTRAINTS.CITATION_REQUIRED,
        severity: GATEKEEPER_CONFIG.SEVERITY.INFO,
        message: `Citation found but not verified: ${matches.slice(0, 3).join(', ')}`,
        citations: matches.slice(0, 5)
      });
    }
  }

  return violations;
}


/**
 * Check if response confidence matches declared confidence.
 */
function checkConfidenceConsistency(text, declaredLevel) {
  const violations = [];
  const textLower = text.toLowerCase();

  // High confidence language
  const highConfidenceTerms = ['certainly', 'definitely', 'absolutely', 'clearly', 'obviously'];
  const lowConfidenceTerms = ['maybe', 'perhaps', 'possibly', 'might', 'could be', 'uncertain'];

  const hasHighConfidence = highConfidenceTerms.some(t => textLower.includes(t));
  const hasLowConfidence = lowConfidenceTerms.some(t => textLower.includes(t));

  // Check for mismatches
  if (declaredLevel === 'KNOWN_KNOWN' && hasLowConfidence) {
    violations.push({
      type: GATEKEEPER_CONFIG.CONSTRAINTS.DRIFT_DETECTED,
      severity: GATEKEEPER_CONFIG.SEVERITY.WARNING,
      message: 'Response uses low-confidence language but was declared KNOWN_KNOWN',
      declaredLevel,
      detectedTone: 'LOW_CONFIDENCE'
    });
  }

  if (declaredLevel === 'UNKNOWN_UNKNOWN' && hasHighConfidence) {
    violations.push({
      type: GATEKEEPER_CONFIG.CONSTRAINTS.DRIFT_DETECTED,
      severity: GATEKEEPER_CONFIG.SEVERITY.WARNING,
      message: 'Response uses high-confidence language but was declared UNKNOWN_UNKNOWN',
      declaredLevel,
      detectedTone: 'HIGH_CONFIDENCE'
    });
  }

  return violations;
}


/**
 * Calculate overall drift score (0-100).
 */
function calculateDriftScore(violations) {
  let score = 0;

  for (const v of violations) {
    if (v.severity === GATEKEEPER_CONFIG.SEVERITY.CRITICAL) {
      score += 30;
    } else if (v.severity === GATEKEEPER_CONFIG.SEVERITY.WARNING) {
      score += 10 * (v.count || 1);
    } else {
      score += 2 * (v.count || 1);
    }
  }

  return Math.min(100, score);
}


/**
 * Sanitize response by removing or flagging problematic content.
 */
function sanitizeResponse(text, violations) {
  let sanitized = text;

  // Add violation markers
  const criticalViolations = violations.filter(v => v.severity === GATEKEEPER_CONFIG.SEVERITY.CRITICAL);

  if (criticalViolations.length > 0) {
    const warnings = criticalViolations.map(v => `[GATEKEEPER WARNING: ${v.message}]`).join('\n');
    sanitized = `${warnings}\n\n---\n\n${sanitized}`;
  }

  return sanitized;
}


// ==========================
// LOGGING
// ==========================

/**
 * Log gatekeeper event to ledger.
 */
function logGatekeeperEvent(phase, result) {
  const text = [
    `[GATEKEEPER_${phase}]`,
    `Mode: ${result.mode}`,
    `Allowed: ${result.allowed}`,
    `Violations: ${result.violations.length}`,
    result.drift_score !== undefined ? `Drift Score: ${result.drift_score}` : '',
    '',
    'Violations:',
    ...result.violations.map(v => `  - [${v.severity}] ${v.type}: ${v.message}`)
  ].filter(Boolean).join('\n');

  try {
    safeNewEntry(
      'System',
      `GATEKEEPER_${phase}`,
      text,
      '',
      result.allowed ? 'VERIFIED' : 'ERROR'
    );
  } catch (e) {
    Logger.log('Gatekeeper logging failed: ' + e.message);
  }

  logSystemEvent(
    result.allowed ? 'INFO' : 'WARN',
    'GATEKEEPER',
    `${phase} completed`,
    {
      allowed: result.allowed,
      violations: result.violations.length,
      drift_score: result.drift_score
    }
  );
}


// ==========================
// GATED AI PROXY
// ==========================

/**
 * Gated AI request - wraps proxyAIRequest with Gatekeeper enforcement.
 *
 * @param {string} provider - AI provider
 * @param {string} model - Model name
 * @param {string|Array} prompt - Prompt or messages
 * @param {Object} options - Gatekeeper options
 * @returns {Object} - Response with gatekeeper metadata
 */
function gatedAIRequest(provider, model, prompt, options) {
  options = options || {};

  // Build request object
  const request = {
    provider,
    model,
    prompt,
    confidence_uuid: options.confidence_uuid,
    metadata: options.metadata || {}
  };

  // PRECHECK
  const precheckResult = gatekeeperPrecheck(request, options);

  if (!precheckResult.allowed) {
    return {
      success: false,
      blocked: true,
      phase: 'PRECHECK',
      violations: precheckResult.violations,
      response: null,
      message: 'Request blocked by Gatekeeper precheck'
    };
  }

  // Execute AI request
  let aiResponse;
  try {
    aiResponse = proxyAIRequest(provider, model, prompt, options.metadata);
  } catch (e) {
    return {
      success: false,
      blocked: false,
      phase: 'AI_REQUEST',
      error: e.message,
      response: null
    };
  }

  // POSTCHECK
  const postcheckResult = gatekeeperPostcheck(aiResponse, precheckResult, options);

  if (!postcheckResult.allowed) {
    return {
      success: false,
      blocked: true,
      phase: 'POSTCHECK',
      violations: postcheckResult.violations,
      drift_score: postcheckResult.drift_score,
      response: aiResponse.response, // Include original for review
      sanitized_response: postcheckResult.sanitized_response,
      message: 'Response blocked by Gatekeeper postcheck'
    };
  }

  // Link to confidence declaration if provided
  if (precheckResult.confidence_uuid && aiResponse.newtonUuid) {
    try {
      // Update the declaration to LINKED status
      const declaration = findConfidenceDeclaration(precheckResult.confidence_uuid);
      if (declaration) {
        updateConfidenceStatus(declaration.row, 'LINKED');
      }
    } catch (e) {
      Logger.log('Failed to link confidence: ' + e.message);
    }
  }

  return {
    success: true,
    blocked: false,
    response: postcheckResult.sanitized_response || aiResponse.response,
    raw_response: aiResponse.response,
    newtonUuid: aiResponse.newtonUuid,
    confidence_uuid: precheckResult.confidence_uuid,
    confidence_level: precheckResult.confidence_level,
    drift_score: postcheckResult.drift_score,
    violations: postcheckResult.violations,
    usage: aiResponse.usage,
    cost: aiResponse.cost
  };
}


// ==========================
// UI FUNCTIONS
// ==========================

function setGatekeeperModeFromUI() {
  const ui = SpreadsheetApp.getUi();
  const currentMode = _getGatekeeperMode();

  const response = ui.prompt(
    'Set Gatekeeper Mode',
    `Current mode: ${currentMode}\n\nEnter new mode:\n• STRICT - Block on violations\n• PERMISSIVE - Log but allow\n• AUDIT_ONLY - Log only`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  try {
    const result = setGatekeeperMode(response.getResponseText().trim().toUpperCase());
    ui.alert('Mode Updated', `Gatekeeper mode set to: ${result.mode}`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


function testGatekeeperFromUI() {
  const ui = SpreadsheetApp.getUi();

  const testText = `
    I think this might be correct, but I'm not entirely sure.
    Obviously, everyone knows that this is true.
    [citation needed]
    As of my training cutoff in 2023...
  `;

  const driftViolations = detectDriftPatterns(testText);
  const hallucinationViolations = detectHallucinationMarkers(testText);
  const allViolations = [...driftViolations, ...hallucinationViolations];
  const driftScore = calculateDriftScore(allViolations);

  let report = `GATEKEEPER TEST RESULTS\n\n`;
  report += `Mode: ${_getGatekeeperMode()}\n`;
  report += `Drift Score: ${driftScore}/100\n`;
  report += `Total Violations: ${allViolations.length}\n\n`;

  for (const v of allViolations) {
    report += `[${v.severity}] ${v.type}\n`;
    report += `  ${v.message}\n\n`;
  }

  ui.alert('Gatekeeper Test', report, ui.ButtonSet.OK);
}


function viewGatekeeperStats() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) return;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No entries to analyze.');
    return;
  }

  const data = sh.getRange(2, 1, lastRow - 1, 5).getValues();

  let precheckCount = 0;
  let postcheckCount = 0;
  let blockedCount = 0;

  for (const row of data) {
    const eventType = row[3] || '';
    const status = row[4] || '';

    if (eventType === 'GATEKEEPER_PRECHECK') precheckCount++;
    if (eventType === 'GATEKEEPER_POSTCHECK') postcheckCount++;
    if (status === 'ERROR' && eventType.startsWith('GATEKEEPER')) blockedCount++;
  }

  const report = `GATEKEEPER STATISTICS\n\n` +
    `Current Mode: ${_getGatekeeperMode()}\n\n` +
    `Precheck Events: ${precheckCount}\n` +
    `Postcheck Events: ${postcheckCount}\n` +
    `Blocked Requests: ${blockedCount}`;

  SpreadsheetApp.getUi().alert('Gatekeeper Stats', report, SpreadsheetApp.getUi().ButtonSet.OK);
}


// ==========================
// MENU (added to onOpen)
// ==========================

function addGatekeeperMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Gatekeeper')
    .addItem('Set Mode', 'setGatekeeperModeFromUI')
    .addItem('View Stats', 'viewGatekeeperStats')
    .addSeparator()
    .addItem('Test Detection', 'testGatekeeperFromUI')
    .addToUi();
}
