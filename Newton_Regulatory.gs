/**
 * ───────────────────────────────────────────────
 *  NEWTON REGULATORY : TAG MAPPING ENGINE
 * ───────────────────────────────────────────────
 *
 *  Maps ledger entries to regulatory frameworks:
 *  - ISO 42001 (AI Management System)
 *  - EU AI Act (Articles & Annexes)
 *  - NIST AI RMF (Functions & Categories)
 *
 *  Auto-tags entries based on content analysis.
 *  Enables compliance queries by framework/clause.
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// REGULATORY FRAMEWORKS
// ==========================

const REGULATORY_FRAMEWORKS = {

  // ISO/IEC 42001:2023 - AI Management System
  ISO_42001: {
    name: 'ISO/IEC 42001:2023',
    description: 'Artificial Intelligence Management System',
    clauses: {
      '4.1': { title: 'Understanding the organization and its context', keywords: ['context', 'stakeholder', 'environment', 'scope'] },
      '4.2': { title: 'Understanding needs and expectations', keywords: ['requirement', 'expectation', 'interested party', 'stakeholder'] },
      '4.3': { title: 'Scope of the AI management system', keywords: ['scope', 'boundary', 'applicability'] },
      '4.4': { title: 'AI management system', keywords: ['management system', 'process', 'maintain'] },
      '5.1': { title: 'Leadership and commitment', keywords: ['leadership', 'commitment', 'policy', 'executive'] },
      '5.2': { title: 'AI policy', keywords: ['policy', 'principle', 'objective'] },
      '5.3': { title: 'Roles, responsibilities and authorities', keywords: ['role', 'responsibility', 'authority', 'accountability'] },
      '6.1': { title: 'Actions to address risks and opportunities', keywords: ['risk', 'opportunity', 'mitigation', 'treatment'] },
      '6.2': { title: 'AI objectives and planning', keywords: ['objective', 'target', 'planning', 'goal'] },
      '6.3': { title: 'Planning of changes', keywords: ['change', 'modification', 'update'] },
      '7.1': { title: 'Resources', keywords: ['resource', 'budget', 'infrastructure', 'personnel'] },
      '7.2': { title: 'Competence', keywords: ['competence', 'training', 'skill', 'qualification'] },
      '7.3': { title: 'Awareness', keywords: ['awareness', 'communication', 'understanding'] },
      '7.4': { title: 'Communication', keywords: ['communication', 'inform', 'notify', 'report'] },
      '7.5': { title: 'Documented information', keywords: ['document', 'record', 'evidence', 'log'] },
      '8.1': { title: 'Operational planning and control', keywords: ['operation', 'control', 'procedure', 'process'] },
      '8.2': { title: 'AI risk assessment', keywords: ['risk assessment', 'impact', 'likelihood', 'severity'] },
      '8.3': { title: 'AI risk treatment', keywords: ['risk treatment', 'mitigation', 'control', 'measure'] },
      '8.4': { title: 'AI system impact assessment', keywords: ['impact assessment', 'consequence', 'effect'] },
      '9.1': { title: 'Monitoring, measurement, analysis and evaluation', keywords: ['monitor', 'measure', 'analyze', 'evaluate', 'metric'] },
      '9.2': { title: 'Internal audit', keywords: ['audit', 'review', 'assessment', 'compliance'] },
      '9.3': { title: 'Management review', keywords: ['management review', 'executive review', 'board'] },
      '10.1': { title: 'Continual improvement', keywords: ['improvement', 'enhance', 'optimize'] },
      '10.2': { title: 'Nonconformity and corrective action', keywords: ['nonconformity', 'corrective', 'remediation', 'fix'] }
    }
  },

  // EU AI Act (2024)
  EU_AI_ACT: {
    name: 'EU AI Act',
    description: 'European Union Artificial Intelligence Act',
    clauses: {
      'Art.5': { title: 'Prohibited AI practices', keywords: ['prohibited', 'ban', 'forbidden', 'manipulation', 'social scoring'] },
      'Art.6': { title: 'Classification rules for high-risk AI', keywords: ['high-risk', 'classification', 'category', 'annex'] },
      'Art.9': { title: 'Risk management system', keywords: ['risk management', 'risk system', 'continuous'] },
      'Art.10': { title: 'Data and data governance', keywords: ['data governance', 'training data', 'data quality', 'bias'] },
      'Art.11': { title: 'Technical documentation', keywords: ['technical documentation', 'specification', 'design'] },
      'Art.12': { title: 'Record-keeping', keywords: ['record', 'log', 'audit trail', 'traceability'] },
      'Art.13': { title: 'Transparency and information', keywords: ['transparency', 'explainability', 'information', 'disclosure'] },
      'Art.14': { title: 'Human oversight', keywords: ['human oversight', 'human-in-the-loop', 'intervention', 'override'] },
      'Art.15': { title: 'Accuracy, robustness and cybersecurity', keywords: ['accuracy', 'robustness', 'security', 'resilience'] },
      'Art.16': { title: 'Obligations of providers', keywords: ['provider', 'obligation', 'duty', 'responsibility'] },
      'Art.17': { title: 'Quality management system', keywords: ['quality management', 'QMS', 'quality system'] },
      'Art.19': { title: 'Conformity assessment', keywords: ['conformity', 'assessment', 'certification', 'compliance'] },
      'Art.20': { title: 'Automatically generated logs', keywords: ['automatic log', 'generated log', 'system log'] },
      'Art.26': { title: 'Obligations of deployers', keywords: ['deployer', 'user obligation', 'deployment'] },
      'Art.27': { title: 'Fundamental rights impact assessment', keywords: ['fundamental rights', 'impact assessment', 'FRIA'] },
      'Art.50': { title: 'Transparency obligations for certain AI', keywords: ['deepfake', 'synthetic', 'generated content', 'chatbot'] },
      'Art.52': { title: 'Transparency for emotion recognition', keywords: ['emotion', 'biometric', 'categorization'] },
      'Art.71': { title: 'Post-market monitoring', keywords: ['post-market', 'monitoring', 'surveillance'] },
      'Art.72': { title: 'Reporting of serious incidents', keywords: ['incident', 'serious', 'report', 'notification'] },
      'Annex-III': { title: 'High-risk AI systems', keywords: ['high-risk', 'biometric', 'critical infrastructure', 'employment', 'law enforcement'] },
      'Annex-IV': { title: 'Technical documentation', keywords: ['technical documentation', 'annex IV'] }
    }
  },

  // NIST AI Risk Management Framework
  NIST_AI_RMF: {
    name: 'NIST AI RMF 1.0',
    description: 'NIST Artificial Intelligence Risk Management Framework',
    clauses: {
      'GOVERN-1': { title: 'Policies, processes, procedures', keywords: ['policy', 'procedure', 'governance', 'process'] },
      'GOVERN-2': { title: 'Accountability structures', keywords: ['accountability', 'responsibility', 'authority', 'structure'] },
      'GOVERN-3': { title: 'Workforce diversity and culture', keywords: ['workforce', 'diversity', 'culture', 'team'] },
      'GOVERN-4': { title: 'Organizational risk tolerance', keywords: ['risk tolerance', 'risk appetite', 'threshold'] },
      'GOVERN-5': { title: 'Stakeholder engagement', keywords: ['stakeholder', 'engagement', 'feedback', 'input'] },
      'GOVERN-6': { title: 'Policies for third-party AI', keywords: ['third-party', 'vendor', 'supplier', 'procurement'] },
      'MAP-1': { title: 'Context establishment', keywords: ['context', 'intended purpose', 'use case', 'application'] },
      'MAP-2': { title: 'AI system categorization', keywords: ['categorization', 'classification', 'taxonomy'] },
      'MAP-3': { title: 'AI capabilities and limitations', keywords: ['capability', 'limitation', 'constraint', 'boundary'] },
      'MAP-4': { title: 'Risks and benefits mapping', keywords: ['risk', 'benefit', 'tradeoff', 'impact'] },
      'MAP-5': { title: 'Impact characterization', keywords: ['impact', 'consequence', 'effect', 'outcome'] },
      'MEASURE-1': { title: 'Risk measurement approaches', keywords: ['measure', 'metric', 'indicator', 'KPI'] },
      'MEASURE-2': { title: 'AI system evaluation', keywords: ['evaluate', 'test', 'validate', 'assess'] },
      'MEASURE-3': { title: 'Tracking identified risks', keywords: ['track', 'monitor', 'status', 'progress'] },
      'MEASURE-4': { title: 'Feedback and information gathering', keywords: ['feedback', 'information', 'data collection'] },
      'MANAGE-1': { title: 'Risk prioritization', keywords: ['prioritize', 'priority', 'rank', 'order'] },
      'MANAGE-2': { title: 'Risk treatment strategies', keywords: ['treatment', 'mitigation', 'strategy', 'response'] },
      'MANAGE-3': { title: 'Risk management resources', keywords: ['resource', 'allocation', 'budget', 'personnel'] },
      'MANAGE-4': { title: 'Residual risk management', keywords: ['residual', 'remaining', 'accepted risk'] }
    }
  }
};


// ==========================
// AUTO-TAGGING ENGINE
// ==========================

/**
 * Analyze text content and return applicable regulatory tags
 *
 * @param {string} text - Entry text to analyze
 * @param {string} eventType - Event type for context
 * @returns {Array} - Array of regulatory tags
 */
function autoTagContent(text, eventType) {
  const tags = [];
  const lowerText = (text || '').toLowerCase();
  const lowerType = (eventType || '').toLowerCase();

  // Check each framework
  for (const [frameworkId, framework] of Object.entries(REGULATORY_FRAMEWORKS)) {
    for (const [clauseId, clause] of Object.entries(framework.clauses)) {
      // Check if any keywords match
      const matchScore = clause.keywords.reduce((score, keyword) => {
        if (lowerText.includes(keyword.toLowerCase()) || lowerType.includes(keyword.toLowerCase())) {
          return score + 1;
        }
        return score;
      }, 0);

      // Require at least 2 keyword matches for auto-tagging
      if (matchScore >= 2) {
        tags.push({
          framework: frameworkId,
          clause: clauseId,
          title: clause.title,
          confidence: Math.min(matchScore / clause.keywords.length, 1.0)
        });
      }
    }
  }

  // Sort by confidence descending
  tags.sort((a, b) => b.confidence - a.confidence);

  // Return top 5 most relevant tags
  return tags.slice(0, 5);
}

/**
 * Format tags as a string for storage
 */
function formatTagsForStorage(tags) {
  return tags.map(t => `${t.framework}:${t.clause}`).join('; ');
}

/**
 * Parse stored tag string back to structured format
 */
function parseStoredTags(tagString) {
  if (!tagString) return [];

  return tagString.split(';').map(t => {
    const [framework, clause] = t.trim().split(':');
    const fw = REGULATORY_FRAMEWORKS[framework];
    const cl = fw?.clauses?.[clause];
    return {
      framework,
      clause,
      title: cl?.title || 'Unknown',
      frameworkName: fw?.name || framework
    };
  }).filter(t => t.framework && t.clause);
}


// ==========================
// TAG MANAGEMENT FUNCTIONS
// ==========================

/**
 * Manually tag an entry with regulatory references
 *
 * @param {string} uuid - Entry UUID
 * @param {Array} tags - Array of tag strings like "ISO_42001:6.1" or objects
 * @returns {Object} - Result
 */
function tagEntry(uuid, tags) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) throw new Error('Audit Ledger sheet not found');

  const lastRow = sh.getLastRow();

  // Find the entry
  for (let r = 2; r <= lastRow; r++) {
    const rowUuid = sh.getRange(r, 1).getValue();
    if (rowUuid === uuid) {
      // Get current tags
      const currentTags = sh.getRange(r, 15).getValue() || '';

      // Format new tags
      const newTagStr = Array.isArray(tags)
        ? tags.map(t => typeof t === 'string' ? t : `${t.framework}:${t.clause}`).join('; ')
        : tags;

      // Merge (avoid duplicates)
      const allTags = new Set([
        ...currentTags.split(';').map(t => t.trim()).filter(t => t),
        ...newTagStr.split(';').map(t => t.trim()).filter(t => t)
      ]);

      const mergedTags = Array.from(allTags).join('; ');
      sh.getRange(r, 15).setValue(mergedTags);

      logSystemEvent('INFO', 'REGULATORY', 'Entry tagged', { uuid, tags: mergedTags });

      return { success: true, uuid, tags: mergedTags };
    }
  }

  return { success: false, error: 'UUID not found', uuid };
}

/**
 * Get all entries matching a specific regulation/clause
 *
 * @param {string} framework - Framework ID (ISO_42001, EU_AI_ACT, NIST_AI_RMF)
 * @param {string} clause - Optional clause ID (e.g., "6.1", "Art.9")
 * @returns {Array} - Matching entries
 */
function getEntriesByRegulation(framework, clause) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) throw new Error('Audit Ledger sheet not found');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const results = [];

  const searchPattern = clause ? `${framework}:${clause}` : framework;

  for (const row of data) {
    const tags = row[14] || ''; // Column 15 (0-indexed = 14)

    if (tags.includes(searchPattern)) {
      results.push({
        uuid: row[0],
        timestamp: row[1],
        actor: row[2],
        eventType: row[3],
        text: row[4],
        status: row[8],
        tags: parseStoredTags(tags)
      });
    }
  }

  return results;
}

/**
 * Get compliance summary by framework
 */
function getComplianceSummary(framework) {
  const fw = REGULATORY_FRAMEWORKS[framework];
  if (!fw) throw new Error('Unknown framework: ' + framework);

  const summary = {
    framework: framework,
    frameworkName: fw.name,
    totalClauses: Object.keys(fw.clauses).length,
    coveredClauses: [],
    uncoveredClauses: [],
    entriesByClause: {}
  };

  for (const clauseId of Object.keys(fw.clauses)) {
    const entries = getEntriesByRegulation(framework, clauseId);
    summary.entriesByClause[clauseId] = entries.length;

    if (entries.length > 0) {
      summary.coveredClauses.push(clauseId);
    } else {
      summary.uncoveredClauses.push(clauseId);
    }
  }

  summary.coveragePercent = Math.round(
    (summary.coveredClauses.length / summary.totalClauses) * 100
  );

  return summary;
}


// ==========================
// SCHEMA UPDATE
// ==========================

/**
 * Add Regulatory_Tags column to existing ledger
 */
function addRegulatoryTagsColumn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Audit Ledger');
  if (!sh) throw new Error('Audit Ledger sheet not found');

  // Check if column 15 already exists
  const headers = sh.getRange(1, 1, 1, 16).getValues()[0];

  if (headers[14] === 'Regulatory_Tags') {
    logSystemEvent('INFO', 'REGULATORY', 'Regulatory_Tags column already exists', {});
    if (_inUi()) SpreadsheetApp.getUi().alert('Regulatory_Tags column already exists.');
    return;
  }

  // Add the header
  sh.getRange(1, 15).setValue('Regulatory_Tags');
  sh.getRange(1, 15).setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
  sh.setColumnWidth(15, 250);

  logSystemEvent('SUCCESS', 'REGULATORY', 'Regulatory_Tags column added', {});
  if (_inUi()) SpreadsheetApp.getUi().alert('Regulatory_Tags column added to Audit Ledger.');
}


// ==========================
// BATCH AUTO-TAGGING
// ==========================

/**
 * Auto-tag all existing entries that don't have tags
 */
function autoTagAllEntries() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) throw new Error('Audit Ledger sheet not found');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { tagged: 0 };

  let tagged = 0;

  for (let r = 2; r <= lastRow; r++) {
    const currentTags = sh.getRange(r, 15).getValue();

    // Skip if already tagged
    if (currentTags && currentTags.trim()) continue;

    const eventType = sh.getRange(r, 4).getValue();
    const text = sh.getRange(r, 5).getValue();

    const tags = autoTagContent(text, eventType);

    if (tags.length > 0) {
      sh.getRange(r, 15).setValue(formatTagsForStorage(tags));
      tagged++;
    }
  }

  logSystemEvent('SUCCESS', 'REGULATORY', 'Batch auto-tagging complete', { tagged });

  return { tagged };
}


// ==========================
// UI FUNCTIONS
// ==========================

function viewRegulatoryCompliance() {
  const ui = SpreadsheetApp.getUi();

  const fwResponse = ui.prompt(
    'Compliance Summary',
    'Enter framework (ISO_42001, EU_AI_ACT, or NIST_AI_RMF):',
    ui.ButtonSet.OK_CANCEL
  );
  if (fwResponse.getSelectedButton() !== ui.Button.OK) return;

  const framework = fwResponse.getResponseText().trim().toUpperCase();

  try {
    const summary = getComplianceSummary(framework);

    let text = `${summary.frameworkName} COMPLIANCE SUMMARY\n\n`;
    text += `Coverage: ${summary.coveragePercent}%\n`;
    text += `Covered Clauses: ${summary.coveredClauses.length}/${summary.totalClauses}\n\n`;

    text += `COVERED:\n`;
    for (const c of summary.coveredClauses.slice(0, 10)) {
      text += `  ✓ ${c}: ${summary.entriesByClause[c]} entries\n`;
    }
    if (summary.coveredClauses.length > 10) {
      text += `  ... and ${summary.coveredClauses.length - 10} more\n`;
    }

    text += `\nGAPS (Not Covered):\n`;
    for (const c of summary.uncoveredClauses.slice(0, 10)) {
      const fw = REGULATORY_FRAMEWORKS[framework];
      text += `  ✗ ${c}: ${fw.clauses[c].title}\n`;
    }
    if (summary.uncoveredClauses.length > 10) {
      text += `  ... and ${summary.uncoveredClauses.length - 10} more\n`;
    }

    ui.alert('Compliance Summary', text, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}

function manualTagEntryUI() {
  const ui = SpreadsheetApp.getUi();

  const uuidResponse = ui.prompt(
    'Tag Entry - Step 1/2',
    'Enter the UUID of the entry to tag:',
    ui.ButtonSet.OK_CANCEL
  );
  if (uuidResponse.getSelectedButton() !== ui.Button.OK) return;
  const uuid = uuidResponse.getResponseText().trim();

  const tagsResponse = ui.prompt(
    'Tag Entry - Step 2/2',
    'Enter tags (e.g., "ISO_42001:6.1; EU_AI_ACT:Art.9"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (tagsResponse.getSelectedButton() !== ui.Button.OK) return;
  const tags = tagsResponse.getResponseText().trim();

  const result = tagEntry(uuid, tags);

  if (result.success) {
    ui.alert('Success', `Entry tagged:\n${result.tags}`, ui.ButtonSet.OK);
  } else {
    ui.alert('Error', result.error, ui.ButtonSet.OK);
  }
}

function runAutoTaggingUI() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    'Auto-Tag Entries',
    'This will analyze all untagged entries and apply regulatory tags based on content.\n\nProceed?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const result = autoTagAllEntries();

  ui.alert('Auto-Tagging Complete', `Tagged ${result.tagged} entries.`, ui.ButtonSet.OK);
}

function queryByRegulationUI() {
  const ui = SpreadsheetApp.getUi();

  const fwResponse = ui.prompt(
    'Query by Regulation - Step 1/2',
    'Enter framework (ISO_42001, EU_AI_ACT, or NIST_AI_RMF):',
    ui.ButtonSet.OK_CANCEL
  );
  if (fwResponse.getSelectedButton() !== ui.Button.OK) return;
  const framework = fwResponse.getResponseText().trim().toUpperCase();

  const clauseResponse = ui.prompt(
    'Query by Regulation - Step 2/2',
    'Enter clause (e.g., "6.1", "Art.9") or leave blank for all:',
    ui.ButtonSet.OK_CANCEL
  );
  if (clauseResponse.getSelectedButton() !== ui.Button.OK) return;
  const clause = clauseResponse.getResponseText().trim();

  const entries = getEntriesByRegulation(framework, clause || null);

  let text = `ENTRIES FOR ${framework}${clause ? ':' + clause : ''}\n\n`;
  text += `Found: ${entries.length} entries\n\n`;

  for (const e of entries.slice(0, 10)) {
    text += `• ${e.eventType} (${e.timestamp.substring(0, 10)})\n`;
    text += `  ${e.text.substring(0, 80)}...\n\n`;
  }

  if (entries.length > 10) {
    text += `... and ${entries.length - 10} more entries`;
  }

  ui.alert('Query Results', text, ui.ButtonSet.OK);
}


// ==========================
// MENU
// ==========================

function addRegulatoryMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Regulatory')
    .addItem('View Compliance Summary', 'viewRegulatoryCompliance')
    .addItem('Query by Regulation', 'queryByRegulationUI')
    .addSeparator()
    .addItem('Tag Entry Manually', 'manualTagEntryUI')
    .addItem('Auto-Tag All Entries', 'runAutoTaggingUI')
    .addSeparator()
    .addItem('Add Regulatory_Tags Column', 'addRegulatoryTagsColumn')
    .addToUi();
}
