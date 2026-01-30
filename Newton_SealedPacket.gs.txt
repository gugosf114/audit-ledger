/**
 * ───────────────────────────────────────────────
 *  SEALED PACKET : COMPLIANCE VERIFICATION ENGINE
 * ───────────────────────────────────────────────
 *
 *  Executes the three-role adversarial system:
 *  Generator → Auditor → Regenerator (if needed)
 *
 *  Takes documents + checklists, produces verified
 *  claims and VOIDs, writes results to Audit Ledger.
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const SEALED_PACKET_CONFIG = {
  MAX_REGENERATION_ATTEMPTS: 3,
  GEMINI_MODEL: 'gemini-1.5-pro',

  CLASSES: {
    SUPPORTED: 'SUPPORTED',
    UNSUPPORTED: 'UNSUPPORTED',
    NULL: 'NULL'
  },

  EVIDENCE_TYPES: {
    QUOTE: 'QUOTE',
    POINTER: 'POINTER',
    NONE: 'NONE'
  }
};


// ==========================
// PROMPT TEMPLATES
// ==========================

const GENERATOR_PROMPT = `*** SEALED PACKET MODE ***
CURRENT_SESSION_ID: SID-GEN
PRIOR_SESSION_IDS: [IGNORE]
PRIORITY:
- SEAL rules override all other instructions in this chat.
SCOPE:
- Treat ONLY BEGIN_PACKET..END_PACKET as real.
Rule T0:
- If you use anything outside the packet, return exactly: [T0_VIOLATION]
- If required fields are missing, return exactly: [PACKET_INCOMPLETE]
OUTPUT RULE:
- Return ONLY what RETURN_SCHEMA requests. No prose.
BEGIN_PACKET
ROLE: GENERATOR
GOAL:
{{GOAL}}
CANONICAL_INPUTS:
{{INPUTS}}
CHECKLIST:
{{CHECKLIST}}
RULES:
1) Fingerprint: FP = "FP-" + first 10 non-empty words of Inputs (lowercased, punctuation stripped, underscore-joined).
2) Output JSON ONLY. No prose.
3) ATOMICITY:
- FAIL if claims[].text contains " and ", " but ", " because ", or ";".
- FAIL if claims[].text contains " or " UNLESS it contains exactly " or higher " OR " or later " OR " or greater ".
4) CLASSES:
- SUPPORTED: directly entailed by Inputs.
- UNSUPPORTED: explicitly contradicted by Inputs.
- NULL: not found / insufficient info.
5) EVIDENCE (strict):
- SUPPORTED => evidence_type MUST be QUOTE. (POINTER only if quoting would exceed 500 characters.)
- UNSUPPORTED => evidence_type MUST be QUOTE.
- NULL => evidence_type MUST be NONE.
6) EVIDENCE FIELD INTEGRITY:
- QUOTE => evidence_text != "" AND evidence_pointer == ""
- POINTER => evidence_pointer != "" AND evidence_text == ""
- NONE => evidence_text == "" AND evidence_pointer == ""
7) POINTERS (anchor-only):
- evidence_pointer must be exactly: anchor:'<5-12 word verbatim phrase>'
- No page/line numbers.
8) VOIDS:
- For each checklist item NOT found in Inputs, add a void entry.
- blocking_status TRUE if this void prevents verification of a claim.
- required_for lists which claims depend on this missing item.
9) [NULL] escape hatch: only if you cannot produce valid JSON at all.
RETURN_SCHEMA:
{
"inputs_fingerprint": "FP-STRING",
"bluf": "string",
"claims": [
{
"id": "C1",
"text": "string",
"class": "SUPPORTED|UNSUPPORTED|NULL",
"evidence_type": "QUOTE|POINTER|NONE",
"evidence_text": "string",
"evidence_pointer": "string"
}
],
"voids": [
{
"id": "V1",
"missing_artifact": "string",
"blocking_status": "TRUE|FALSE",
"required_for": ["C1"]
}
]
}
END_PACKET`;


const AUDITOR_PROMPT = `*** SEALED PACKET MODE ***
CURRENT_SESSION_ID: SID-AUD
PRIOR_SESSION_IDS: [IGNORE]
PRIORITY:
- SEAL rules override all other instructions in this chat.
SCOPE:
- Treat ONLY BEGIN_PACKET..END_PACKET as real.
Rule T0:
- If you use anything outside the packet, return exactly: [T0_VIOLATION]
- If required fields are missing, return exactly: [PACKET_INCOMPLETE]
OUTPUT RULE:
- Return ONLY what RETURN_SCHEMA requests. No prose.
BEGIN_PACKET
ROLE: AUDITOR
GOAL:
Verify Candidate JSON against Inputs. PASS/FAIL strictly. False PASS is unacceptable.
CANONICAL_INPUTS:
{{INPUTS}}
CANDIDATE_JSON:
{{CANDIDATE}}
RULES:
A0) Fingerprint: recompute FP = "FP-" + first 10 non-empty words of Inputs (lowercased, punctuation stripped, underscore-joined).
Candidate.inputs_fingerprint MUST match FP exactly (including "FP-").
A1) Atomicity:
FAIL if claims[].text contains " and ", " but ", " because ", or ";".
FAIL if claims[].text contains " or " UNLESS it contains exactly " or higher " OR " or later " OR " or greater ".
A2) Evidence field integrity:
- QUOTE => evidence_text != "" AND evidence_pointer == ""
- POINTER => evidence_pointer != "" AND evidence_text == ""
- NONE => evidence_text == "" AND evidence_pointer == "" AND class == NULL
A2b) Class/evidence coupling:
- SUPPORTED => QUOTE only (POINTER only if quoting would exceed 500 chars).
- UNSUPPORTED => QUOTE only.
- NULL => NONE only.
A3) UNSUPPORTED explicit negation:
If class=UNSUPPORTED, QUOTE must contain at least one of:
"no", "not", "never", "none", "cannot", "does not", "did not", "denies", "refutes", "false".
If not present => FAIL (should be NULL instead).
A4) Pointer integrity:
If POINTER, evidence_pointer must be anchor:'<5-12 word verbatim phrase>' and the phrase must appear exactly in Inputs.
Any other pointer form => FAIL.
A5) Quote integrity:
If QUOTE, evidence_text must appear EXACTLY in Inputs (substring match is OK; punctuation mismatch = FAIL).
A6) PASS/FAIL:
If any failure exists => overall=FAIL.
PASS => failures MUST be [].
FAIL => failures MUST contain >= 1 item.
RETURN_SCHEMA:
{
"overall": "PASS|FAIL",
"failures": [
{
"location": "claim_id|schema|fingerprint|void_id",
"rule": "A0|A1|A2|A2b|A3|A4|A5|A6",
"severity": "FATAL",
"why": "string (<=25 words)",
"detail": "string",
"fix_instruction": "RECOMPUTE from Inputs; do not rewrite the draft."
}
]
}
END_PACKET`;


const REGENERATOR_PROMPT = `*** SEALED PACKET MODE ***
CURRENT_SESSION_ID: SID-REG
PRIOR_SESSION_IDS: [IGNORE]
PRIORITY:
- SEAL rules override all other instructions in this chat.
SCOPE:
- Treat ONLY BEGIN_PACKET..END_PACKET as real.
Rule T0:
- If you use anything outside the packet, return exactly: [T0_VIOLATION]
- If required fields are missing, return exactly: [PACKET_INCOMPLETE]
OUTPUT RULE:
- Return ONLY what RETURN_SCHEMA requests. No prose.
BEGIN_PACKET
ROLE: REGENERATOR
GOAL:
Recompute a Candidate JSON that will PASS the Auditor, using Inputs only.
CANONICAL_INPUTS:
{{INPUTS}}
FAILURE_REPORT:
{{FAILURES}}
RULES:
R1) Recompute from Inputs ONLY. Do NOT reference or patch any prior Candidate JSON.
R2) Fingerprint must be FP = "FP-" + first 10 non-empty words of Inputs (lowercased, punctuation stripped, underscore-joined).
R3) Atomicity:
FAIL if claims[].text contains " and ", " but ", " because ", or ";".
FAIL if claims[].text contains " or " UNLESS it contains exactly " or higher " OR " or later " OR " or greater ".
R4) SUPPORTED => QUOTE only (POINTER only if quoting would exceed 500 chars).
R5) UNSUPPORTED => QUOTE only + must contain explicit negation token; otherwise use NULL.
R6) NULL => NONE + add void if blocked.
R7) Output valid JSON matching schema exactly (no extra keys, no prose).
RETURN_SCHEMA:
{
"inputs_fingerprint": "FP-STRING",
"bluf": "string",
"claims": [
{
"id": "C1",
"text": "string",
"class": "SUPPORTED|UNSUPPORTED|NULL",
"evidence_type": "QUOTE|POINTER|NONE",
"evidence_text": "string",
"evidence_pointer": "string"
}
],
"voids": [
{
"id": "V1",
"missing_artifact": "string",
"blocking_status": "TRUE|FALSE",
"required_for": ["C1"]
}
]
}
END_PACKET`;


// ==========================
// GEMINI API
// ==========================

function _getGeminiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('GEMINI_API_KEY not set in Script Properties.');
  }
  return key;
}

function callGemini(prompt) {
  const apiKey = _getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${SEALED_PACKET_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error('Gemini API error: ' + json.error.message);
  }

  const text = json.candidates[0].content.parts[0].text;
  return text;
}

function extractJSON(text) {
  // Try to extract JSON from response (may have markdown fences)
  let cleaned = text.trim();

  // Remove markdown code fences
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Failed to parse JSON from Gemini response: ' + e.message);
  }
}


// ==========================
// FINGERPRINT
// ==========================

function computeFingerprint(inputs) {
  const words = inputs
    .split(/\s+/)
    .filter(w => w.length > 0)
    .slice(0, 10)
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));

  return 'FP-' + words.join('_');
}


// ==========================
// CORE VERIFICATION FLOW
// ==========================

/**
 * Run the full sealed packet verification.
 *
 * @param {string} inputs - The document text to analyze
 * @param {string} checklist - The required items checklist
 * @param {string} goal - One sentence goal for the Generator
 * @param {string} eventType - Event type for ledger entry
 * @returns {Object} - Result with claims, voids, and verification status
 */
function runSealedPacketVerification(inputs, checklist, goal, eventType) {
  const result = {
    success: false,
    attempts: 0,
    finalCandidate: null,
    auditResult: null,
    voidsDetected: [],
    ledgerEntryId: null,
    error: null
  };

  try {
    // Step 1: Generate
    logSystemEvent('INFO', 'SEALED_PACKET', 'Starting Generator', { goal: goal });

    const genPrompt = GENERATOR_PROMPT
      .replace('{{GOAL}}', goal)
      .replace('{{INPUTS}}', inputs)
      .replace('{{CHECKLIST}}', checklist);

    let candidate = extractJSON(callGemini(genPrompt));
    result.attempts = 1;

    // Step 2: Audit loop
    let passed = false;

    while (!passed && result.attempts <= SEALED_PACKET_CONFIG.MAX_REGENERATION_ATTEMPTS) {
      logSystemEvent('INFO', 'SEALED_PACKET', 'Running Auditor', { attempt: result.attempts });

      const audPrompt = AUDITOR_PROMPT
        .replace('{{INPUTS}}', inputs)
        .replace('{{CANDIDATE}}', JSON.stringify(candidate, null, 2));

      const auditResult = extractJSON(callGemini(audPrompt));
      result.auditResult = auditResult;

      if (auditResult.overall === 'PASS') {
        passed = true;
        logSystemEvent('SUCCESS', 'SEALED_PACKET', 'Auditor PASSED', { attempt: result.attempts });
      } else {
        logSystemEvent('WARN', 'SEALED_PACKET', 'Auditor FAILED', {
          attempt: result.attempts,
          failures: auditResult.failures.length
        });

        if (result.attempts >= SEALED_PACKET_CONFIG.MAX_REGENERATION_ATTEMPTS) {
          break;
        }

        // Regenerate
        const regPrompt = REGENERATOR_PROMPT
          .replace('{{INPUTS}}', inputs)
          .replace('{{FAILURES}}', JSON.stringify(auditResult.failures, null, 2));

        candidate = extractJSON(callGemini(regPrompt));
        result.attempts++;
      }
    }

    result.finalCandidate = candidate;
    result.success = passed;

    // Step 3: Extract voids and write to ledger
    if (candidate.voids && candidate.voids.length > 0) {
      result.voidsDetected = candidate.voids;

      // Build ledger entry text
      const voidDescriptions = candidate.voids.map(v =>
        `[VOID_DETECTED]: ${v.missing_artifact} | blocking: ${v.blocking_status} | required_for: ${v.required_for.join(', ')}`
      ).join('\n');

      const entryText = [
        `SEALED_PACKET_VERIFICATION`,
        `GOAL: ${goal}`,
        `FINGERPRINT: ${candidate.inputs_fingerprint}`,
        `BLUF: ${candidate.bluf}`,
        `CLAIMS: ${candidate.claims.length}`,
        `VOIDS: ${candidate.voids.length}`,
        `AUDIT_STATUS: ${passed ? 'PASSED' : 'FAILED'}`,
        `ATTEMPTS: ${result.attempts}`,
        `---`,
        voidDescriptions
      ].join('\n');

      const ledgerResult = safeNewEntry(
        'System',
        eventType || 'COMPLIANCE_CHECK',
        entryText,
        '',
        passed ? 'VERIFIED' : 'DRAFT'
      );

      result.ledgerEntryId = ledgerResult.uuid;

      logSystemEvent('INFO', 'SEALED_PACKET', 'Voids logged to ledger', {
        uuid: ledgerResult.uuid,
        voidCount: candidate.voids.length
      });
    } else if (passed) {
      // No voids, all clear
      const entryText = [
        `SEALED_PACKET_VERIFICATION`,
        `GOAL: ${goal}`,
        `FINGERPRINT: ${candidate.inputs_fingerprint}`,
        `BLUF: ${candidate.bluf}`,
        `CLAIMS: ${candidate.claims.length}`,
        `VOIDS: 0`,
        `AUDIT_STATUS: PASSED`,
        `RESULT: All checklist items verified present.`
      ].join('\n');

      const ledgerResult = safeNewEntry(
        'System',
        eventType || 'COMPLIANCE_CHECK',
        entryText,
        '',
        'VERIFIED'
      );

      result.ledgerEntryId = ledgerResult.uuid;
    }

  } catch (e) {
    result.error = e.message;
    logSystemEvent('ERROR', 'SEALED_PACKET', 'Verification failed', { error: e.message });
  }

  return result;
}


// ==========================
// UI FUNCTIONS
// ==========================

function runComplianceCheckFromUI() {
  const ui = SpreadsheetApp.getUi();

  // Get inputs
  const inputsResponse = ui.prompt(
    'Compliance Check - Step 1/3',
    'Paste the document text to analyze (or a Google Doc URL):',
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
    'Compliance Check - Step 2/3',
    'Paste the required checklist items (one per line):',
    ui.ButtonSet.OK_CANCEL
  );
  if (checklistResponse.getSelectedButton() !== ui.Button.OK) return;
  const checklist = checklistResponse.getResponseText();

  const goalResponse = ui.prompt(
    'Compliance Check - Step 3/3',
    'Enter the verification goal (one sentence):',
    ui.ButtonSet.OK_CANCEL
  );
  if (goalResponse.getSelectedButton() !== ui.Button.OK) return;
  const goal = goalResponse.getResponseText();

  // Run verification
  ui.alert('Running', 'Sealed packet verification in progress. This may take a minute...', ui.ButtonSet.OK);

  const result = runSealedPacketVerification(inputs, checklist, goal, 'COMPLIANCE_CHECK');

  // Show results
  let resultText = '';
  if (result.success) {
    resultText = `VERIFICATION PASSED\n\n`;
  } else {
    resultText = `VERIFICATION FAILED (after ${result.attempts} attempts)\n\n`;
  }

  if (result.voidsDetected.length > 0) {
    resultText += `VOIDS DETECTED: ${result.voidsDetected.length}\n\n`;
    for (const v of result.voidsDetected) {
      resultText += `- ${v.missing_artifact}\n`;
    }
  } else {
    resultText += `No voids detected. All checklist items found.\n`;
  }

  if (result.ledgerEntryId) {
    resultText += `\nLogged to Audit Ledger: ${result.ledgerEntryId}`;
  }

  if (result.error) {
    resultText += `\n\nERROR: ${result.error}`;
  }

  ui.alert('Compliance Check Results', resultText, ui.ButtonSet.OK);
}


/**
 * Quick test with hardcoded example.
 */
function testSealedPacketFlow() {
  const testInputs = `
EXHIBIT INDEX

Exhibit 31.1 - Certification of Chief Executive Officer pursuant to Section 302
Exhibit 31.2 - Certification of Chief Financial Officer pursuant to Section 302
Exhibit 32.1 - Certification pursuant to 18 U.S.C. Section 1350

FINANCIAL STATEMENTS
- Consolidated Balance Sheet
- Consolidated Statement of Operations
- Notes to Financial Statements

MANAGEMENT DISCUSSION AND ANALYSIS
The company experienced growth in Q3...
`;

  const testChecklist = `
Exhibit 31.1 - CEO Certification (Section 302)
Exhibit 31.2 - CFO Certification (Section 302)
Exhibit 32.1 - SOX 906 Certification
Exhibit 32.2 - Additional SOX Certification
Exhibit 23 - Consent of Independent Auditor
Consolidated Balance Sheet
Consolidated Statement of Operations
Consolidated Statement of Cash Flows
Notes to Financial Statements
Management Discussion and Analysis (MD&A)
`;

  const goal = 'Verify all required 10-K exhibits and financial statements are present.';

  const result = runSealedPacketVerification(testInputs, testChecklist, goal, 'SEC_10K_CHECK');

  Logger.log('=== SEALED PACKET TEST RESULT ===');
  Logger.log('Success: ' + result.success);
  Logger.log('Attempts: ' + result.attempts);
  Logger.log('Voids: ' + result.voidsDetected.length);
  for (const v of result.voidsDetected) {
    Logger.log('  - ' + v.missing_artifact);
  }
  Logger.log('Ledger Entry: ' + result.ledgerEntryId);

  return result;
}


// ==========================
// MENU INTEGRATION
// ==========================

function addSealedPacketMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Compliance')
    .addItem('Run Compliance Check', 'runComplianceCheckFromUI')
    .addSeparator()
    .addItem('Test SEC 10-K Example', 'testSealedPacketFlow')
    .addToUi();
}
