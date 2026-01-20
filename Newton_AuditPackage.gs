/**
 * ───────────────────────────────────────────────
 *  NEWTON AUDIT PACKAGE GENERATOR
 * ───────────────────────────────────────────────
 *
 *  Generates comprehensive audit packages containing:
 *  1. Risk Register (from VOIDs and ESCALATIONs)
 *  2. Control Effectiveness Report (signal processing outcomes)
 *  3. Decision Traceability Matrix (actions → evidence → UUIDs)
 *  4. Incident Log (escalations with dispositions)
 *
 *  Output: Structured JSON + Formatted Google Doc
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const AUDIT_PACKAGE_CONFIG = {
  // Event types that indicate risks/voids
  RISK_EVENT_TYPES: [
    'VOID_DETECTED',
    'ESCALATED',
    'AGENT_BLOCKED',
    'ERROR',
    'COMPLIANCE_FAIL',
    'RISK_IDENTIFIED',
    'CONTROL_FAILURE'
  ],

  // Event types that indicate incidents
  INCIDENT_EVENT_TYPES: [
    'ESCALATED',
    'INCIDENT',
    'BREACH',
    'VIOLATION',
    'CRITICAL_ERROR'
  ],

  // Event types that indicate control effectiveness
  CONTROL_EVENT_TYPES: [
    'COMPLIANCE_CHECK',
    'AGENTIC_CHECK_P1',
    'AGENTIC_CHECK_P3',
    'AUDIT',
    'VERIFICATION',
    'SEALED_PACKET'
  ],

  // Event types for decisions
  DECISION_EVENT_TYPES: [
    'DECISION',
    'APPROVAL',
    'REJECTION',
    'REVIEW',
    'DISPOSITION'
  ]
};


// ==========================
// DATA EXTRACTION
// ==========================

/**
 * Extract all ledger entries within a date range
 */
function extractEntriesInRange(startDate, endDate) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit_Ledger');
  if (!sh) throw new Error('Audit_Ledger sheet not found');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // Include full end day

  const entries = [];

  for (const row of data) {
    const timestamp = new Date(row[1]);

    if (timestamp >= start && timestamp <= end) {
      entries.push({
        uuid: row[0],
        timestamp: row[1],
        actor: row[2],
        eventType: row[3],
        text: row[4],
        gift: row[5],
        prevHash: row[6],
        recordHash: row[7],
        status: row[8],
        provisionIds: row[9],
        provisionTitles: row[10],
        provisionSnippets: row[11],
        provisionUrls: row[12],
        citationHash: row[13],
        regulatoryTags: row[14] || ''
      });
    }
  }

  return entries;
}


// ==========================
// RISK REGISTER BUILDER
// ==========================

/**
 * Build Risk Register from VOID and ESCALATION entries
 */
function buildRiskRegister(entries, framework) {
  const risks = [];
  let riskId = 1;

  for (const entry of entries) {
    const isRiskEvent = AUDIT_PACKAGE_CONFIG.RISK_EVENT_TYPES.some(
      t => entry.eventType.toUpperCase().includes(t)
    );

    if (!isRiskEvent) continue;

    // Parse risk details from text
    const text = entry.text || '';
    const severity = determineSeverity(text, entry.eventType);
    const category = determineRiskCategory(text);

    const risk = {
      riskId: `RISK-${String(riskId).padStart(4, '0')}`,
      sourceUuid: entry.uuid,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      description: extractRiskDescription(text),
      severity: severity,
      category: category,
      status: entry.status,
      regulatoryMapping: parseRegulatoryTags(entry.regulatoryTags, framework),
      evidence: {
        recordHash: entry.recordHash,
        citationHash: entry.citationHash
      },
      mitigationStatus: determineMitigationStatus(entry.status)
    };

    risks.push(risk);
    riskId++;
  }

  // Sort by severity (CRITICAL > HIGH > MEDIUM > LOW)
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  risks.sort((a, b) => (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4));

  return {
    totalRisks: risks.length,
    bySeverity: {
      critical: risks.filter(r => r.severity === 'CRITICAL').length,
      high: risks.filter(r => r.severity === 'HIGH').length,
      medium: risks.filter(r => r.severity === 'MEDIUM').length,
      low: risks.filter(r => r.severity === 'LOW').length
    },
    byCategory: groupBy(risks, 'category'),
    risks: risks
  };
}

function determineSeverity(text, eventType) {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('critical') || lowerText.includes('fatal') || eventType.includes('CRITICAL')) {
    return 'CRITICAL';
  }
  if (lowerText.includes('high') || lowerText.includes('severe') || lowerText.includes('escalat')) {
    return 'HIGH';
  }
  if (lowerText.includes('medium') || lowerText.includes('moderate')) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function determineRiskCategory(text) {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('data') || lowerText.includes('privacy')) return 'DATA_GOVERNANCE';
  if (lowerText.includes('security') || lowerText.includes('breach')) return 'SECURITY';
  if (lowerText.includes('compliance') || lowerText.includes('regulation')) return 'COMPLIANCE';
  if (lowerText.includes('bias') || lowerText.includes('fairness')) return 'FAIRNESS';
  if (lowerText.includes('accuracy') || lowerText.includes('performance')) return 'PERFORMANCE';
  if (lowerText.includes('transparency') || lowerText.includes('explainability')) return 'TRANSPARENCY';
  if (lowerText.includes('human') || lowerText.includes('oversight')) return 'HUMAN_OVERSIGHT';
  return 'OPERATIONAL';
}

function extractRiskDescription(text) {
  // Extract the core risk description
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.includes('Item:') || line.includes('Reason:') || line.includes('VOID')) {
      return line.replace(/^\[.*?\]/, '').trim();
    }
  }
  return text.substring(0, 200);
}

function determineMitigationStatus(status) {
  if (status === 'VERIFIED' || status === 'RESOLVED') return 'MITIGATED';
  if (status === 'DRAFT') return 'OPEN';
  if (status === 'ERROR') return 'REQUIRES_ACTION';
  return 'UNDER_REVIEW';
}

function parseRegulatoryTags(tagString, filterFramework) {
  if (!tagString) return [];

  const tags = tagString.split(';').map(t => t.trim()).filter(t => t);

  if (filterFramework) {
    return tags.filter(t => t.startsWith(filterFramework));
  }
  return tags;
}


// ==========================
// CONTROL EFFECTIVENESS REPORT
// ==========================

/**
 * Build Control Effectiveness Report from verification entries
 */
function buildControlEffectivenessReport(entries) {
  const controls = [];
  const outcomes = { pass: 0, fail: 0, partial: 0 };

  for (const entry of entries) {
    const isControlEvent = AUDIT_PACKAGE_CONFIG.CONTROL_EVENT_TYPES.some(
      t => entry.eventType.toUpperCase().includes(t)
    );

    if (!isControlEvent) continue;

    const outcome = determineControlOutcome(entry.text, entry.status);
    outcomes[outcome.toLowerCase()]++;

    controls.push({
      uuid: entry.uuid,
      timestamp: entry.timestamp,
      controlType: entry.eventType,
      outcome: outcome,
      status: entry.status,
      details: extractControlDetails(entry.text),
      regulatoryMapping: parseRegulatoryTags(entry.regulatoryTags, null)
    });
  }

  const total = outcomes.pass + outcomes.fail + outcomes.partial;
  const effectivenessRate = total > 0 ? Math.round((outcomes.pass / total) * 100) : 0;

  return {
    summary: {
      totalControls: total,
      passed: outcomes.pass,
      failed: outcomes.fail,
      partial: outcomes.partial,
      effectivenessRate: effectivenessRate
    },
    trend: calculateControlTrend(controls),
    controls: controls
  };
}

function determineControlOutcome(text, status) {
  const lowerText = text.toLowerCase();

  if (status === 'VERIFIED' || lowerText.includes('passed') || lowerText.includes('complete')) {
    return 'PASS';
  }
  if (lowerText.includes('partial') || lowerText.includes('some')) {
    return 'PARTIAL';
  }
  if (status === 'ERROR' || lowerText.includes('fail') || lowerText.includes('void')) {
    return 'FAIL';
  }
  return 'PARTIAL';
}

function extractControlDetails(text) {
  const details = {};

  // Extract claims count
  const claimsMatch = text.match(/CLAIMS:\s*(\d+)/i);
  if (claimsMatch) details.claims = parseInt(claimsMatch[1]);

  // Extract voids count
  const voidsMatch = text.match(/VOIDS:\s*(\d+)/i);
  if (voidsMatch) details.voids = parseInt(voidsMatch[1]);

  // Extract attempts
  const attemptsMatch = text.match(/ATTEMPTS:\s*(\d+)/i);
  if (attemptsMatch) details.attempts = parseInt(attemptsMatch[1]);

  return details;
}

function calculateControlTrend(controls) {
  if (controls.length < 5) return 'INSUFFICIENT_DATA';

  // Compare recent vs older outcomes
  const recent = controls.slice(-5);
  const older = controls.slice(0, -5);

  const recentPassRate = recent.filter(c => c.outcome === 'PASS').length / recent.length;
  const olderPassRate = older.length > 0
    ? older.filter(c => c.outcome === 'PASS').length / older.length
    : 0;

  if (recentPassRate > olderPassRate + 0.1) return 'IMPROVING';
  if (recentPassRate < olderPassRate - 0.1) return 'DECLINING';
  return 'STABLE';
}


// ==========================
// DECISION TRACEABILITY MATRIX
// ==========================

/**
 * Build Decision Traceability Matrix linking decisions to evidence
 */
function buildDecisionTraceabilityMatrix(entries) {
  const decisions = [];

  for (const entry of entries) {
    const isDecisionEvent = AUDIT_PACKAGE_CONFIG.DECISION_EVENT_TYPES.some(
      t => entry.eventType.toUpperCase().includes(t)
    );

    // Also include entries with citations (evidence-backed)
    const hasEvidence = entry.citationHash && entry.citationHash !== 'no_citations';

    if (!isDecisionEvent && !hasEvidence) continue;

    decisions.push({
      decisionId: entry.uuid,
      timestamp: entry.timestamp,
      actor: entry.actor,
      decisionType: entry.eventType,
      description: entry.text.substring(0, 300),
      status: entry.status,
      evidence: {
        citationHash: entry.citationHash,
        provisionIds: entry.provisionIds ? entry.provisionIds.split(';') : [],
        provisionTitles: entry.provisionTitles ? entry.provisionTitles.split(';') : [],
        sourceUrls: entry.provisionUrls ? entry.provisionUrls.split(';') : []
      },
      chainIntegrity: {
        recordHash: entry.recordHash,
        prevHash: entry.prevHash
      },
      regulatoryMapping: parseRegulatoryTags(entry.regulatoryTags, null)
    });
  }

  return {
    totalDecisions: decisions.length,
    byActor: groupBy(decisions, 'actor'),
    byType: groupBy(decisions, 'decisionType'),
    decisions: decisions
  };
}


// ==========================
// INCIDENT LOG
// ==========================

/**
 * Build Incident Log from escalations and incidents
 */
function buildIncidentLog(entries) {
  const incidents = [];
  let incidentId = 1;

  for (const entry of entries) {
    const isIncident = AUDIT_PACKAGE_CONFIG.INCIDENT_EVENT_TYPES.some(
      t => entry.eventType.toUpperCase().includes(t)
    );

    if (!isIncident) continue;

    incidents.push({
      incidentId: `INC-${String(incidentId).padStart(4, '0')}`,
      sourceUuid: entry.uuid,
      timestamp: entry.timestamp,
      reportedBy: entry.actor,
      type: entry.eventType,
      description: entry.text,
      severity: determineSeverity(entry.text, entry.eventType),
      disposition: determineDisposition(entry.status),
      resolutionTime: null, // Would need linked resolution entry
      evidence: {
        recordHash: entry.recordHash,
        citationHash: entry.citationHash
      },
      regulatoryNotifiable: isRegulatoryNotifiable(entry.text, entry.eventType)
    });

    incidentId++;
  }

  return {
    totalIncidents: incidents.length,
    openIncidents: incidents.filter(i => i.disposition === 'OPEN').length,
    resolvedIncidents: incidents.filter(i => i.disposition === 'RESOLVED').length,
    notifiableIncidents: incidents.filter(i => i.regulatoryNotifiable).length,
    bySeverity: groupBy(incidents, 'severity'),
    incidents: incidents
  };
}

function determineDisposition(status) {
  if (status === 'VERIFIED' || status === 'RESOLVED') return 'RESOLVED';
  if (status === 'DRAFT') return 'OPEN';
  return 'UNDER_INVESTIGATION';
}

function isRegulatoryNotifiable(text, eventType) {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('serious incident') ||
    lowerText.includes('data breach') ||
    lowerText.includes('safety') ||
    eventType.includes('BREACH') ||
    eventType.includes('CRITICAL')
  );
}


// ==========================
// MAIN GENERATOR
// ==========================

/**
 * Generate complete audit package
 *
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} framework - Optional framework filter (ISO_42001, EU_AI_ACT, NIST_AI_RMF)
 * @returns {Object} - Complete audit package
 */
function generateAuditPackage(startDate, endDate, framework) {
  logSystemEvent('INFO', 'AUDIT_PACKAGE', 'Generating audit package', {
    startDate, endDate, framework
  });

  const entries = extractEntriesInRange(startDate, endDate);

  if (entries.length === 0) {
    return {
      error: 'No entries found in date range',
      startDate,
      endDate
    };
  }

  const pkg = {
    metadata: {
      packageId: Utilities.getUuid(),
      generatedAt: new Date().toISOString(),
      generatedBy: Session.getEffectiveUser().getEmail(),
      period: { startDate, endDate },
      framework: framework || 'ALL',
      totalEntries: entries.length
    },

    executiveSummary: null, // Filled below

    riskRegister: buildRiskRegister(entries, framework),

    controlEffectiveness: buildControlEffectivenessReport(entries),

    decisionTraceability: buildDecisionTraceabilityMatrix(entries),

    incidentLog: buildIncidentLog(entries),

    regulatoryCoverage: framework ? getComplianceSummary(framework) : null,

    integrityVerification: {
      entriesVerified: entries.length,
      chainIntact: verifyChainIntegrity(entries),
      generationHash: null // Filled below
    }
  };

  // Generate executive summary
  pkg.executiveSummary = generateExecutiveSummary(pkg);

  // Hash the package for integrity
  pkg.integrityVerification.generationHash = hashPackage(pkg);

  logSystemEvent('SUCCESS', 'AUDIT_PACKAGE', 'Package generated', {
    packageId: pkg.metadata.packageId,
    risks: pkg.riskRegister.totalRisks,
    controls: pkg.controlEffectiveness.summary.totalControls,
    incidents: pkg.incidentLog.totalIncidents
  });

  return pkg;
}

function generateExecutiveSummary(pkg) {
  return {
    period: `${pkg.metadata.period.startDate} to ${pkg.metadata.period.endDate}`,
    keyMetrics: {
      totalRisks: pkg.riskRegister.totalRisks,
      criticalRisks: pkg.riskRegister.bySeverity.critical,
      controlEffectiveness: `${pkg.controlEffectiveness.summary.effectivenessRate}%`,
      controlTrend: pkg.controlEffectiveness.trend,
      openIncidents: pkg.incidentLog.openIncidents,
      notifiableIncidents: pkg.incidentLog.notifiableIncidents
    },
    riskPosture: determineOverallRiskPosture(pkg),
    recommendations: generateRecommendations(pkg)
  };
}

function determineOverallRiskPosture(pkg) {
  const criticalRisks = pkg.riskRegister.bySeverity.critical;
  const openIncidents = pkg.incidentLog.openIncidents;
  const effectiveness = pkg.controlEffectiveness.summary.effectivenessRate;

  if (criticalRisks > 0 || openIncidents > 5 || effectiveness < 50) {
    return 'HIGH_RISK';
  }
  if (pkg.riskRegister.bySeverity.high > 3 || effectiveness < 70) {
    return 'MODERATE_RISK';
  }
  return 'LOW_RISK';
}

function generateRecommendations(pkg) {
  const recs = [];

  if (pkg.riskRegister.bySeverity.critical > 0) {
    recs.push('URGENT: Address critical risks immediately');
  }

  if (pkg.controlEffectiveness.trend === 'DECLINING') {
    recs.push('Review and strengthen control processes');
  }

  if (pkg.incidentLog.notifiableIncidents > 0) {
    recs.push('Verify regulatory notification requirements for incidents');
  }

  if (pkg.regulatoryCoverage && pkg.regulatoryCoverage.coveragePercent < 50) {
    recs.push(`Improve ${pkg.metadata.framework} coverage (currently ${pkg.regulatoryCoverage.coveragePercent}%)`);
  }

  if (recs.length === 0) {
    recs.push('Maintain current controls and monitoring');
  }

  return recs;
}

function verifyChainIntegrity(entries) {
  // Quick chain verification
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].prevHash !== entries[i - 1].recordHash) {
      return false;
    }
  }
  return true;
}

function hashPackage(pkg) {
  const content = JSON.stringify({
    metadata: pkg.metadata,
    riskCount: pkg.riskRegister.totalRisks,
    controlCount: pkg.controlEffectiveness.summary.totalControls,
    incidentCount: pkg.incidentLog.totalIncidents
  });

  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}

function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = item[key] || 'UNKNOWN';
    if (!result[groupKey]) result[groupKey] = [];
    result[groupKey].push(item);
    return result;
  }, {});
}


// ==========================
// OUTPUT GENERATORS
// ==========================

/**
 * Export audit package as JSON to Drive
 */
function exportPackageAsJSON(pkg) {
  const filename = `AuditPackage_${pkg.metadata.period.startDate}_to_${pkg.metadata.period.endDate}.json`;
  const content = JSON.stringify(pkg, null, 2);

  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  let file;

  if (folderId) {
    file = DriveApp.getFolderById(folderId).createFile(filename, content, MimeType.PLAIN_TEXT);
  } else {
    file = DriveApp.createFile(filename, content, MimeType.PLAIN_TEXT);
  }

  logSystemEvent('SUCCESS', 'AUDIT_PACKAGE', 'JSON export created', { fileId: file.getId() });

  return file;
}

/**
 * Export audit package as formatted Google Doc
 */
function exportPackageAsDoc(pkg) {
  const title = `Audit Package: ${pkg.metadata.period.startDate} to ${pkg.metadata.period.endDate}`;
  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  // Title
  body.appendParagraph(title)
    .setHeading(DocumentApp.ParagraphHeading.TITLE);

  body.appendParagraph(`Generated: ${pkg.metadata.generatedAt}`)
    .setItalic(true);

  body.appendParagraph(`Package ID: ${pkg.metadata.packageId}`);
  body.appendParagraph(`Framework: ${pkg.metadata.framework}`);

  body.appendHorizontalRule();

  // Executive Summary
  body.appendParagraph('EXECUTIVE SUMMARY')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Period: ${pkg.executiveSummary.period}`);
  body.appendParagraph(`Risk Posture: ${pkg.executiveSummary.riskPosture}`);

  body.appendParagraph('Key Metrics:')
    .setBold(true);

  const metrics = pkg.executiveSummary.keyMetrics;
  body.appendListItem(`Total Risks: ${metrics.totalRisks} (${metrics.criticalRisks} critical)`);
  body.appendListItem(`Control Effectiveness: ${metrics.controlEffectiveness}`);
  body.appendListItem(`Control Trend: ${metrics.controlTrend}`);
  body.appendListItem(`Open Incidents: ${metrics.openIncidents}`);

  body.appendParagraph('Recommendations:')
    .setBold(true);

  for (const rec of pkg.executiveSummary.recommendations) {
    body.appendListItem(rec);
  }

  body.appendHorizontalRule();

  // Risk Register
  body.appendParagraph('RISK REGISTER')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Total Risks: ${pkg.riskRegister.totalRisks}`);
  body.appendParagraph(`Critical: ${pkg.riskRegister.bySeverity.critical} | High: ${pkg.riskRegister.bySeverity.high} | Medium: ${pkg.riskRegister.bySeverity.medium} | Low: ${pkg.riskRegister.bySeverity.low}`);

  if (pkg.riskRegister.risks.length > 0) {
    // Create risk table
    const riskTable = body.appendTable();
    const headerRow = riskTable.appendTableRow();
    ['Risk ID', 'Severity', 'Category', 'Description', 'Status'].forEach(h => {
      headerRow.appendTableCell(h).setBold(true);
    });

    for (const risk of pkg.riskRegister.risks.slice(0, 20)) {
      const row = riskTable.appendTableRow();
      row.appendTableCell(risk.riskId);
      row.appendTableCell(risk.severity);
      row.appendTableCell(risk.category);
      row.appendTableCell(risk.description.substring(0, 100));
      row.appendTableCell(risk.mitigationStatus);
    }

    if (pkg.riskRegister.risks.length > 20) {
      body.appendParagraph(`... and ${pkg.riskRegister.risks.length - 20} more risks (see JSON export)`);
    }
  }

  body.appendHorizontalRule();

  // Control Effectiveness
  body.appendParagraph('CONTROL EFFECTIVENESS REPORT')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const ctrl = pkg.controlEffectiveness.summary;
  body.appendParagraph(`Effectiveness Rate: ${ctrl.effectivenessRate}%`);
  body.appendParagraph(`Passed: ${ctrl.passed} | Failed: ${ctrl.failed} | Partial: ${ctrl.partial}`);
  body.appendParagraph(`Trend: ${pkg.controlEffectiveness.trend}`);

  body.appendHorizontalRule();

  // Decision Traceability
  body.appendParagraph('DECISION TRACEABILITY MATRIX')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Total Decisions: ${pkg.decisionTraceability.totalDecisions}`);

  if (pkg.decisionTraceability.decisions.length > 0) {
    const decTable = body.appendTable();
    const decHeader = decTable.appendTableRow();
    ['UUID', 'Timestamp', 'Actor', 'Type', 'Has Evidence'].forEach(h => {
      decHeader.appendTableCell(h).setBold(true);
    });

    for (const dec of pkg.decisionTraceability.decisions.slice(0, 15)) {
      const row = decTable.appendTableRow();
      row.appendTableCell(dec.decisionId.substring(0, 8) + '...');
      row.appendTableCell(dec.timestamp.substring(0, 10));
      row.appendTableCell(dec.actor);
      row.appendTableCell(dec.decisionType);
      row.appendTableCell(dec.evidence.citationHash !== 'no_citations' ? 'Yes' : 'No');
    }
  }

  body.appendHorizontalRule();

  // Incident Log
  body.appendParagraph('INCIDENT LOG')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Total Incidents: ${pkg.incidentLog.totalIncidents}`);
  body.appendParagraph(`Open: ${pkg.incidentLog.openIncidents} | Resolved: ${pkg.incidentLog.resolvedIncidents}`);
  body.appendParagraph(`Regulatory Notifiable: ${pkg.incidentLog.notifiableIncidents}`);

  if (pkg.incidentLog.incidents.length > 0) {
    const incTable = body.appendTable();
    const incHeader = incTable.appendTableRow();
    ['ID', 'Timestamp', 'Severity', 'Type', 'Disposition'].forEach(h => {
      incHeader.appendTableCell(h).setBold(true);
    });

    for (const inc of pkg.incidentLog.incidents.slice(0, 15)) {
      const row = incTable.appendTableRow();
      row.appendTableCell(inc.incidentId);
      row.appendTableCell(inc.timestamp.substring(0, 10));
      row.appendTableCell(inc.severity);
      row.appendTableCell(inc.type);
      row.appendTableCell(inc.disposition);
    }
  }

  body.appendHorizontalRule();

  // Integrity
  body.appendParagraph('INTEGRITY VERIFICATION')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Entries Verified: ${pkg.integrityVerification.entriesVerified}`);
  body.appendParagraph(`Chain Intact: ${pkg.integrityVerification.chainIntact ? 'YES' : 'NO - INVESTIGATE'}`);
  body.appendParagraph(`Package Hash: ${pkg.integrityVerification.generationHash}`);

  // Move to exports folder if configured
  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  if (folderId) {
    const docFile = DriveApp.getFileById(doc.getId());
    DriveApp.getFolderById(folderId).addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  }

  doc.saveAndClose();

  logSystemEvent('SUCCESS', 'AUDIT_PACKAGE', 'Doc export created', { docId: doc.getId() });

  return doc;
}


// ==========================
// UI FUNCTIONS
// ==========================

function generateAuditPackageFromUI() {
  const ui = SpreadsheetApp.getUi();

  const startResponse = ui.prompt(
    'Audit Package - Step 1/3',
    'Start date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );
  if (startResponse.getSelectedButton() !== ui.Button.OK) return;
  const startDate = startResponse.getResponseText().trim();

  const endResponse = ui.prompt(
    'Audit Package - Step 2/3',
    'End date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );
  if (endResponse.getSelectedButton() !== ui.Button.OK) return;
  const endDate = endResponse.getResponseText().trim();

  const fwResponse = ui.prompt(
    'Audit Package - Step 3/3',
    'Framework filter (ISO_42001, EU_AI_ACT, NIST_AI_RMF) or leave blank for all:',
    ui.ButtonSet.OK_CANCEL
  );
  if (fwResponse.getSelectedButton() !== ui.Button.OK) return;
  const framework = fwResponse.getResponseText().trim() || null;

  ui.alert('Generating', 'Creating audit package. This may take a moment...', ui.ButtonSet.OK);

  try {
    const pkg = generateAuditPackage(startDate, endDate, framework);

    if (pkg.error) {
      ui.alert('Error', pkg.error, ui.ButtonSet.OK);
      return;
    }

    // Export both formats
    const jsonFile = exportPackageAsJSON(pkg);
    const doc = exportPackageAsDoc(pkg);

    let resultText = `AUDIT PACKAGE GENERATED\n\n`;
    resultText += `Package ID: ${pkg.metadata.packageId}\n`;
    resultText += `Period: ${startDate} to ${endDate}\n\n`;

    resultText += `SUMMARY:\n`;
    resultText += `• Risk Posture: ${pkg.executiveSummary.riskPosture}\n`;
    resultText += `• Total Risks: ${pkg.riskRegister.totalRisks}\n`;
    resultText += `• Control Effectiveness: ${pkg.controlEffectiveness.summary.effectivenessRate}%\n`;
    resultText += `• Open Incidents: ${pkg.incidentLog.openIncidents}\n\n`;

    resultText += `EXPORTS:\n`;
    resultText += `• JSON: ${jsonFile.getName()}\n`;
    resultText += `• Doc: ${doc.getName()}\n`;

    ui.alert('Audit Package Complete', resultText, ui.ButtonSet.OK);

  } catch (e) {
    logSystemEvent('ERROR', 'AUDIT_PACKAGE', 'Generation failed', { error: e.message });
    ui.alert('Error', 'Failed to generate package: ' + e.message, ui.ButtonSet.OK);
  }
}


// ==========================
// MENU
// ==========================

function addAuditPackageMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Audit Package')
    .addItem('Generate Audit Package', 'generateAuditPackageFromUI')
    .addSeparator()
    .addItem('Export Last Package as JSON', 'exportLastPackageJSON')
    .addItem('Export Last Package as Doc', 'exportLastPackageDoc')
    .addToUi();
}
