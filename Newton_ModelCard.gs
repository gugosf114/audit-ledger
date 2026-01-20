/**
 * ───────────────────────────────────────────────
 *  NEWTON MODEL CARD GENERATOR
 * ───────────────────────────────────────────────
 *
 *  Generates AI Model Cards compliant with:
 *  - EU AI Act Article 13 (Transparency)
 *  - EU AI Act Annex IV (Technical Documentation)
 *  - Model Card standards (Mitchell et al.)
 *
 *  Pulls data from ledger entries to auto-populate:
 *  - System description and intended use
 *  - Known limitations and issues
 *  - Risk flags and regulatory tags
 *  - Incidents from ESCALATED entries
 *  - Known gaps from VOID entries
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// MODEL CARD SCHEMA
// ==========================

const MODEL_CARD_SCHEMA = {
  sections: [
    'model_details',
    'intended_use',
    'factors',
    'metrics',
    'evaluation_data',
    'training_data',
    'quantitative_analyses',
    'ethical_considerations',
    'caveats_recommendations',
    'known_limitations',
    'known_gaps',
    'incidents',
    'regulatory_compliance'
  ],

  // Event types that indicate system info
  SYSTEM_INFO_TYPES: [
    'SYSTEM_DESCRIPTION',
    'MODEL_DEPLOYED',
    'CONFIGURATION',
    'BOOT',
    'INITIALIZATION'
  ],

  // Event types for use cases
  USE_CASE_TYPES: [
    'INTENDED_USE',
    'USE_CASE',
    'DEPLOYMENT',
    'APPLICATION'
  ],

  // Event types for limitations
  LIMITATION_TYPES: [
    'LIMITATION',
    'CONSTRAINT',
    'BOUNDARY',
    'RESTRICTION',
    'KNOWN_ISSUE'
  ],

  // Event types for metrics
  METRICS_TYPES: [
    'METRIC',
    'PERFORMANCE',
    'ACCURACY',
    'EVALUATION',
    'BENCHMARK'
  ],

  // Event types for training data
  TRAINING_DATA_TYPES: [
    'TRAINING_DATA',
    'DATASET',
    'DATA_SOURCE'
  ]
};


// ==========================
// DATA EXTRACTION
// ==========================

/**
 * Extract all entries related to a specific AI system
 */
function extractSystemEntries(systemName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) throw new Error('Audit Ledger sheet not found');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const entries = [];
  const lowerSystemName = systemName.toLowerCase();

  for (const row of data) {
    const text = (row[4] || '').toLowerCase();
    const eventType = (row[3] || '').toLowerCase();
    const tags = (row[14] || '').toLowerCase();

    // Check if entry relates to this system
    if (text.includes(lowerSystemName) ||
        eventType.includes(lowerSystemName) ||
        tags.includes(lowerSystemName)) {
      entries.push({
        uuid: row[0],
        timestamp: row[1],
        actor: row[2],
        eventType: row[3],
        text: row[4],
        status: row[8],
        regulatoryTags: row[14] || ''
      });
    }
  }

  return entries;
}

/**
 * Extract VOID entries (known gaps)
 */
function extractVoidEntries(systemName) {
  const allEntries = extractSystemEntries(systemName);
  return allEntries.filter(e =>
    e.eventType.toUpperCase().includes('VOID') ||
    e.text.toUpperCase().includes('[VOID')
  );
}

/**
 * Extract ESCALATED entries (incidents)
 */
function extractIncidentEntries(systemName) {
  const allEntries = extractSystemEntries(systemName);
  return allEntries.filter(e =>
    e.eventType.toUpperCase().includes('ESCALAT') ||
    e.eventType.toUpperCase().includes('INCIDENT') ||
    e.eventType.toUpperCase().includes('ERROR') ||
    e.eventType.toUpperCase().includes('BREACH')
  );
}

/**
 * Extract entries by type category
 */
function extractEntriesByTypes(entries, typeList) {
  return entries.filter(e => {
    const upperType = e.eventType.toUpperCase();
    return typeList.some(t => upperType.includes(t));
  });
}


// ==========================
// MODEL CARD BUILDER
// ==========================

/**
 * Generate a complete Model Card for an AI system
 *
 * @param {string} systemName - Name of the AI system
 * @returns {Object} - Complete model card data
 */
function generateModelCard(systemName) {
  logSystemEvent('INFO', 'MODEL_CARD', 'Generating model card', { systemName });

  const allEntries = extractSystemEntries(systemName);
  const voidEntries = extractVoidEntries(systemName);
  const incidentEntries = extractIncidentEntries(systemName);

  if (allEntries.length === 0) {
    logSystemEvent('WARN', 'MODEL_CARD', 'No entries found for system', { systemName });
  }

  const modelCard = {
    metadata: {
      cardId: Utilities.getUuid(),
      generatedAt: new Date().toISOString(),
      generatedBy: Session.getEffectiveUser().getEmail(),
      systemName: systemName,
      entriesAnalyzed: allEntries.length,
      version: '1.0'
    },

    modelDetails: buildModelDetails(systemName, allEntries),

    intendedUse: buildIntendedUse(allEntries),

    factors: buildFactors(allEntries),

    metrics: buildMetrics(allEntries),

    evaluationData: buildEvaluationData(allEntries),

    trainingData: buildTrainingData(allEntries),

    ethicalConsiderations: buildEthicalConsiderations(allEntries),

    caveatAndRecommendations: buildCaveatsRecommendations(allEntries),

    knownLimitations: buildKnownLimitations(allEntries),

    knownGaps: buildKnownGaps(voidEntries),

    incidents: buildIncidents(incidentEntries),

    regulatoryCompliance: buildRegulatoryCompliance(allEntries)
  };

  logSystemEvent('SUCCESS', 'MODEL_CARD', 'Model card generated', {
    cardId: modelCard.metadata.cardId,
    gaps: modelCard.knownGaps.length,
    incidents: modelCard.incidents.length
  });

  return modelCard;
}

function buildModelDetails(systemName, entries) {
  const infoEntries = extractEntriesByTypes(entries, MODEL_CARD_SCHEMA.SYSTEM_INFO_TYPES);

  // Try to extract description from entries
  let description = `AI system: ${systemName}`;
  let version = 'Unknown';
  let developers = [];
  let releaseDate = null;

  for (const entry of infoEntries) {
    const text = entry.text;

    // Look for version info
    const versionMatch = text.match(/version[:\s]+([0-9.]+)/i);
    if (versionMatch) version = versionMatch[1];

    // Look for description
    if (text.length > 50 && !description.includes(':')) {
      description = text.substring(0, 500);
    }

    // Track actors as potential developers
    if (entry.actor && !developers.includes(entry.actor)) {
      developers.push(entry.actor);
    }

    // Get earliest date as release
    if (!releaseDate || new Date(entry.timestamp) < new Date(releaseDate)) {
      releaseDate = entry.timestamp;
    }
  }

  return {
    name: systemName,
    version: version,
    description: description,
    developers: developers,
    releaseDate: releaseDate,
    type: 'AI System',
    license: 'See organization policy',
    citation: `Model Card for ${systemName}, generated ${new Date().toISOString()}`
  };
}

function buildIntendedUse(entries) {
  const useEntries = extractEntriesByTypes(entries, MODEL_CARD_SCHEMA.USE_CASE_TYPES);

  const primaryUses = [];
  const primaryUsers = new Set();
  const outOfScope = [];

  for (const entry of useEntries) {
    const text = entry.text;

    // Extract use case info
    if (text.toLowerCase().includes('intended') || text.toLowerCase().includes('use case')) {
      primaryUses.push(text.substring(0, 300));
    }

    // Extract user info
    if (text.toLowerCase().includes('user')) {
      const userMatch = text.match(/user[s]?[:\s]+([^.]+)/i);
      if (userMatch) primaryUsers.add(userMatch[1].trim());
    }

    // Extract out of scope
    if (text.toLowerCase().includes('not intended') || text.toLowerCase().includes('out of scope')) {
      outOfScope.push(text.substring(0, 200));
    }
  }

  return {
    primaryIntendedUses: primaryUses.length > 0 ? primaryUses : ['Not specified in ledger'],
    primaryIntendedUsers: Array.from(primaryUsers).length > 0 ? Array.from(primaryUsers) : ['Not specified'],
    outOfScopeUses: outOfScope.length > 0 ? outOfScope : ['Not specified']
  };
}

function buildFactors(entries) {
  // Factors that affect model performance
  const factors = {
    relevantFactors: [],
    evaluationFactors: []
  };

  for (const entry of entries) {
    const text = entry.text.toLowerCase();

    if (text.includes('bias') || text.includes('demographic') || text.includes('group')) {
      factors.relevantFactors.push({
        factor: extractFactorName(entry.text),
        description: entry.text.substring(0, 200),
        source: entry.uuid
      });
    }
  }

  return factors;
}

function extractFactorName(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('age')) return 'Age';
  if (lowerText.includes('gender')) return 'Gender';
  if (lowerText.includes('race') || lowerText.includes('ethnic')) return 'Race/Ethnicity';
  if (lowerText.includes('language')) return 'Language';
  if (lowerText.includes('geographic') || lowerText.includes('region')) return 'Geographic Region';
  return 'General Factor';
}

function buildMetrics(entries) {
  const metricEntries = extractEntriesByTypes(entries, MODEL_CARD_SCHEMA.METRICS_TYPES);

  const metrics = [];

  for (const entry of metricEntries) {
    const text = entry.text;

    // Try to extract metric values
    const numberMatch = text.match(/(\d+\.?\d*)\s*%/);

    metrics.push({
      name: entry.eventType,
      value: numberMatch ? `${numberMatch[1]}%` : 'See details',
      description: text.substring(0, 200),
      timestamp: entry.timestamp,
      source: entry.uuid
    });
  }

  return {
    performanceMetrics: metrics,
    decisionThresholds: [],
    variationApproaches: 'See evaluation data section'
  };
}

function buildEvaluationData(entries) {
  return {
    datasets: [],
    motivation: 'Evaluation data documentation pending',
    preprocessing: 'See technical documentation'
  };
}

function buildTrainingData(entries) {
  const dataEntries = extractEntriesByTypes(entries, MODEL_CARD_SCHEMA.TRAINING_DATA_TYPES);

  const datasets = [];

  for (const entry of dataEntries) {
    datasets.push({
      name: entry.eventType,
      description: entry.text.substring(0, 300),
      source: entry.uuid,
      timestamp: entry.timestamp
    });
  }

  return {
    datasets: datasets.length > 0 ? datasets : [{ name: 'Not specified in ledger' }],
    dataCollection: 'See technical documentation',
    preprocessing: 'See technical documentation'
  };
}

function buildEthicalConsiderations(entries) {
  const ethical = {
    considerations: [],
    risks: [],
    mitigations: []
  };

  for (const entry of entries) {
    const text = entry.text.toLowerCase();

    if (text.includes('ethic') || text.includes('fair') || text.includes('bias') || text.includes('harm')) {
      ethical.considerations.push({
        topic: entry.eventType,
        description: entry.text.substring(0, 300),
        source: entry.uuid
      });
    }

    if (text.includes('risk')) {
      ethical.risks.push({
        risk: entry.text.substring(0, 200),
        source: entry.uuid
      });
    }

    if (text.includes('mitigat') || text.includes('safeguard') || text.includes('control')) {
      ethical.mitigations.push({
        mitigation: entry.text.substring(0, 200),
        source: entry.uuid
      });
    }
  }

  return ethical;
}

function buildCaveatsRecommendations(entries) {
  return {
    caveats: [],
    recommendations: [
      'Review known limitations before deployment',
      'Monitor for drift in production',
      'Address known gaps documented in this card',
      'Ensure human oversight as required by EU AI Act Art. 14'
    ]
  };
}

function buildKnownLimitations(entries) {
  const limitEntries = extractEntriesByTypes(entries, MODEL_CARD_SCHEMA.LIMITATION_TYPES);

  const limitations = [];

  for (const entry of limitEntries) {
    limitations.push({
      limitation: entry.text.substring(0, 300),
      severity: determineLimitationSeverity(entry.text),
      status: entry.status,
      source: entry.uuid,
      timestamp: entry.timestamp
    });
  }

  // Also check for limitations mentioned in any entry
  for (const entry of entries) {
    if (entry.text.toLowerCase().includes('limitation') ||
        entry.text.toLowerCase().includes('cannot') ||
        entry.text.toLowerCase().includes('does not support')) {

      const alreadyAdded = limitations.some(l => l.source === entry.uuid);
      if (!alreadyAdded) {
        limitations.push({
          limitation: entry.text.substring(0, 300),
          severity: 'MEDIUM',
          status: entry.status,
          source: entry.uuid,
          timestamp: entry.timestamp
        });
      }
    }
  }

  return limitations;
}

function determineLimitationSeverity(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('critical') || lowerText.includes('severe')) return 'CRITICAL';
  if (lowerText.includes('high') || lowerText.includes('significant')) return 'HIGH';
  if (lowerText.includes('low') || lowerText.includes('minor')) return 'LOW';
  return 'MEDIUM';
}

function buildKnownGaps(voidEntries) {
  const gaps = [];

  for (const entry of voidEntries) {
    // Extract the missing item from VOID text
    let missingItem = entry.text;
    const itemMatch = entry.text.match(/Item:\s*([^\n]+)/i);
    if (itemMatch) missingItem = itemMatch[1].trim();

    let reason = 'Not specified';
    const reasonMatch = entry.text.match(/Reason:\s*([^\n]+)/i);
    if (reasonMatch) reason = reasonMatch[1].trim();

    gaps.push({
      gapId: `GAP-${gaps.length + 1}`,
      missingArtifact: missingItem,
      reason: reason,
      status: entry.status,
      regulatoryImpact: parseRegulatoryTags(entry.regulatoryTags, null),
      source: entry.uuid,
      timestamp: entry.timestamp
    });
  }

  return gaps;
}

function buildIncidents(incidentEntries) {
  const incidents = [];

  for (const entry of incidentEntries) {
    incidents.push({
      incidentId: `INC-${incidents.length + 1}`,
      type: entry.eventType,
      description: entry.text.substring(0, 400),
      severity: determineSeverityFromText(entry.text, entry.eventType),
      status: entry.status,
      timestamp: entry.timestamp,
      source: entry.uuid
    });
  }

  return incidents;
}

function determineSeverityFromText(text, eventType) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('critical') || eventType.includes('CRITICAL')) return 'CRITICAL';
  if (lowerText.includes('high') || lowerText.includes('severe')) return 'HIGH';
  if (lowerText.includes('medium') || lowerText.includes('moderate')) return 'MEDIUM';
  return 'LOW';
}

function buildRegulatoryCompliance(entries) {
  // Collect all regulatory tags from entries
  const allTags = new Set();

  for (const entry of entries) {
    if (entry.regulatoryTags) {
      entry.regulatoryTags.split(';').forEach(tag => {
        const trimmed = tag.trim();
        if (trimmed) allTags.add(trimmed);
      });
    }
  }

  // Group by framework
  const byFramework = {
    ISO_42001: [],
    EU_AI_ACT: [],
    NIST_AI_RMF: [],
    OTHER: []
  };

  for (const tag of allTags) {
    if (tag.startsWith('ISO_42001')) byFramework.ISO_42001.push(tag);
    else if (tag.startsWith('EU_AI_ACT')) byFramework.EU_AI_ACT.push(tag);
    else if (tag.startsWith('NIST_AI_RMF')) byFramework.NIST_AI_RMF.push(tag);
    else byFramework.OTHER.push(tag);
  }

  return {
    frameworks: byFramework,
    totalTags: allTags.size,
    euAiActCompliance: {
      article13Transparency: byFramework.EU_AI_ACT.some(t => t.includes('Art.13')),
      article14HumanOversight: byFramework.EU_AI_ACT.some(t => t.includes('Art.14')),
      annexIVDocumentation: byFramework.EU_AI_ACT.some(t => t.includes('Annex-IV'))
    }
  };
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
// OUTPUT GENERATORS
// ==========================

/**
 * Export model card as Markdown
 */
function exportModelCardAsMarkdown(modelCard) {
  const lines = [];

  lines.push(`# Model Card: ${modelCard.metadata.systemName}`);
  lines.push('');
  lines.push(`*Generated: ${modelCard.metadata.generatedAt}*`);
  lines.push(`*Card ID: ${modelCard.metadata.cardId}*`);
  lines.push('');

  // Model Details
  lines.push('## Model Details');
  lines.push('');
  lines.push(`- **Name:** ${modelCard.modelDetails.name}`);
  lines.push(`- **Version:** ${modelCard.modelDetails.version}`);
  lines.push(`- **Type:** ${modelCard.modelDetails.type}`);
  lines.push(`- **Release Date:** ${modelCard.modelDetails.releaseDate || 'N/A'}`);
  lines.push(`- **Developers:** ${modelCard.modelDetails.developers.join(', ') || 'N/A'}`);
  lines.push('');
  lines.push(`**Description:** ${modelCard.modelDetails.description}`);
  lines.push('');

  // Intended Use
  lines.push('## Intended Use');
  lines.push('');
  lines.push('### Primary Intended Uses');
  modelCard.intendedUse.primaryIntendedUses.forEach(u => lines.push(`- ${u}`));
  lines.push('');
  lines.push('### Primary Intended Users');
  modelCard.intendedUse.primaryIntendedUsers.forEach(u => lines.push(`- ${u}`));
  lines.push('');
  lines.push('### Out-of-Scope Uses');
  modelCard.intendedUse.outOfScopeUses.forEach(u => lines.push(`- ${u}`));
  lines.push('');

  // Metrics
  if (modelCard.metrics.performanceMetrics.length > 0) {
    lines.push('## Performance Metrics');
    lines.push('');
    lines.push('| Metric | Value | Description |');
    lines.push('|--------|-------|-------------|');
    modelCard.metrics.performanceMetrics.forEach(m => {
      lines.push(`| ${m.name} | ${m.value} | ${m.description.substring(0, 50)}... |`);
    });
    lines.push('');
  }

  // Training Data
  lines.push('## Training Data');
  lines.push('');
  if (modelCard.trainingData.datasets.length > 0) {
    modelCard.trainingData.datasets.forEach(d => {
      lines.push(`- **${d.name}:** ${d.description || 'See documentation'}`);
    });
  } else {
    lines.push('*Training data documentation pending*');
  }
  lines.push('');

  // Ethical Considerations
  lines.push('## Ethical Considerations');
  lines.push('');
  if (modelCard.ethicalConsiderations.considerations.length > 0) {
    lines.push('### Considerations');
    modelCard.ethicalConsiderations.considerations.forEach(c => {
      lines.push(`- **${c.topic}:** ${c.description}`);
    });
    lines.push('');
  }
  if (modelCard.ethicalConsiderations.risks.length > 0) {
    lines.push('### Identified Risks');
    modelCard.ethicalConsiderations.risks.forEach(r => lines.push(`- ${r.risk}`));
    lines.push('');
  }
  if (modelCard.ethicalConsiderations.mitigations.length > 0) {
    lines.push('### Mitigations');
    modelCard.ethicalConsiderations.mitigations.forEach(m => lines.push(`- ${m.mitigation}`));
    lines.push('');
  }

  // Known Limitations
  lines.push('## Known Limitations');
  lines.push('');
  if (modelCard.knownLimitations.length > 0) {
    lines.push('| Limitation | Severity | Status |');
    lines.push('|------------|----------|--------|');
    modelCard.knownLimitations.forEach(l => {
      lines.push(`| ${l.limitation.substring(0, 60)}... | ${l.severity} | ${l.status} |`);
    });
  } else {
    lines.push('*No limitations documented*');
  }
  lines.push('');

  // Known Gaps (from VOIDs)
  lines.push('## Known Gaps');
  lines.push('');
  if (modelCard.knownGaps.length > 0) {
    lines.push('> ⚠️ The following gaps have been identified through automated void detection.');
    lines.push('');
    modelCard.knownGaps.forEach(g => {
      lines.push(`### ${g.gapId}: ${g.missingArtifact}`);
      lines.push(`- **Reason:** ${g.reason}`);
      lines.push(`- **Status:** ${g.status}`);
      lines.push(`- **Regulatory Impact:** ${g.regulatoryImpact.join(', ') || 'Not mapped'}`);
      lines.push('');
    });
  } else {
    lines.push('*No gaps identified*');
  }
  lines.push('');

  // Incidents
  lines.push('## Incident History');
  lines.push('');
  if (modelCard.incidents.length > 0) {
    lines.push('| ID | Type | Severity | Status | Date |');
    lines.push('|----|------|----------|--------|------|');
    modelCard.incidents.forEach(i => {
      lines.push(`| ${i.incidentId} | ${i.type} | ${i.severity} | ${i.status} | ${i.timestamp.substring(0, 10)} |`);
    });
    lines.push('');
    lines.push('### Incident Details');
    modelCard.incidents.forEach(i => {
      lines.push(`#### ${i.incidentId}`);
      lines.push(i.description);
      lines.push('');
    });
  } else {
    lines.push('*No incidents recorded*');
  }
  lines.push('');

  // Regulatory Compliance
  lines.push('## Regulatory Compliance');
  lines.push('');
  lines.push(`**Total Regulatory Tags:** ${modelCard.regulatoryCompliance.totalTags}`);
  lines.push('');
  lines.push('### EU AI Act Compliance');
  const euCompliance = modelCard.regulatoryCompliance.euAiActCompliance;
  lines.push(`- Article 13 (Transparency): ${euCompliance.article13Transparency ? '✅' : '❌'}`);
  lines.push(`- Article 14 (Human Oversight): ${euCompliance.article14HumanOversight ? '✅' : '❌'}`);
  lines.push(`- Annex IV (Technical Documentation): ${euCompliance.annexIVDocumentation ? '✅' : '❌'}`);
  lines.push('');

  const byFw = modelCard.regulatoryCompliance.frameworks;
  if (byFw.ISO_42001.length > 0) {
    lines.push('### ISO 42001 Coverage');
    byFw.ISO_42001.forEach(t => lines.push(`- ${t}`));
    lines.push('');
  }
  if (byFw.NIST_AI_RMF.length > 0) {
    lines.push('### NIST AI RMF Coverage');
    byFw.NIST_AI_RMF.forEach(t => lines.push(`- ${t}`));
    lines.push('');
  }

  // Recommendations
  lines.push('## Caveats and Recommendations');
  lines.push('');
  modelCard.caveatAndRecommendations.recommendations.forEach(r => lines.push(`- ${r}`));
  lines.push('');

  // Footer
  lines.push('---');
  lines.push(`*This Model Card was auto-generated by Newton Audit System.*`);
  lines.push(`*Entries analyzed: ${modelCard.metadata.entriesAnalyzed}*`);

  return lines.join('\n');
}

/**
 * Export model card as Google Doc
 */
function exportModelCardAsDoc(modelCard) {
  const title = `Model Card: ${modelCard.metadata.systemName}`;
  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  // Title
  body.appendParagraph(title)
    .setHeading(DocumentApp.ParagraphHeading.TITLE);

  body.appendParagraph(`Generated: ${modelCard.metadata.generatedAt}`)
    .setItalic(true);
  body.appendParagraph(`Card ID: ${modelCard.metadata.cardId}`);

  body.appendHorizontalRule();

  // Model Details
  body.appendParagraph('MODEL DETAILS')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Name: ${modelCard.modelDetails.name}`);
  body.appendParagraph(`Version: ${modelCard.modelDetails.version}`);
  body.appendParagraph(`Type: ${modelCard.modelDetails.type}`);
  body.appendParagraph(`Description: ${modelCard.modelDetails.description}`);

  // Intended Use
  body.appendParagraph('INTENDED USE')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph('Primary Uses:').setBold(true);
  modelCard.intendedUse.primaryIntendedUses.forEach(u =>
    body.appendListItem(u)
  );

  body.appendParagraph('Out-of-Scope Uses:').setBold(true);
  modelCard.intendedUse.outOfScopeUses.forEach(u =>
    body.appendListItem(u)
  );

  // Known Limitations
  body.appendParagraph('KNOWN LIMITATIONS')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (modelCard.knownLimitations.length > 0) {
    const limTable = body.appendTable();
    const limHeader = limTable.appendTableRow();
    ['Limitation', 'Severity', 'Status'].forEach(h =>
      limHeader.appendTableCell(h).setBold(true)
    );

    modelCard.knownLimitations.slice(0, 15).forEach(l => {
      const row = limTable.appendTableRow();
      row.appendTableCell(l.limitation.substring(0, 80));
      row.appendTableCell(l.severity);
      row.appendTableCell(l.status);
    });
  } else {
    body.appendParagraph('No limitations documented.');
  }

  // Known Gaps
  body.appendParagraph('KNOWN GAPS (from VOID detection)')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (modelCard.knownGaps.length > 0) {
    modelCard.knownGaps.forEach(g => {
      body.appendParagraph(`${g.gapId}: ${g.missingArtifact}`).setBold(true);
      body.appendParagraph(`Reason: ${g.reason}`);
      body.appendParagraph(`Status: ${g.status}`);
      body.appendParagraph('');
    });
  } else {
    body.appendParagraph('No gaps identified.');
  }

  // Incidents
  body.appendParagraph('INCIDENT HISTORY')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (modelCard.incidents.length > 0) {
    const incTable = body.appendTable();
    const incHeader = incTable.appendTableRow();
    ['ID', 'Type', 'Severity', 'Status', 'Date'].forEach(h =>
      incHeader.appendTableCell(h).setBold(true)
    );

    modelCard.incidents.slice(0, 20).forEach(i => {
      const row = incTable.appendTableRow();
      row.appendTableCell(i.incidentId);
      row.appendTableCell(i.type);
      row.appendTableCell(i.severity);
      row.appendTableCell(i.status);
      row.appendTableCell(i.timestamp.substring(0, 10));
    });
  } else {
    body.appendParagraph('No incidents recorded.');
  }

  // Regulatory Compliance
  body.appendParagraph('REGULATORY COMPLIANCE')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const euCompliance = modelCard.regulatoryCompliance.euAiActCompliance;
  body.appendParagraph('EU AI Act:').setBold(true);
  body.appendListItem(`Article 13 (Transparency): ${euCompliance.article13Transparency ? '✅ Covered' : '❌ Gap'}`);
  body.appendListItem(`Article 14 (Human Oversight): ${euCompliance.article14HumanOversight ? '✅ Covered' : '❌ Gap'}`);
  body.appendListItem(`Annex IV (Technical Doc): ${euCompliance.annexIVDocumentation ? '✅ Covered' : '❌ Gap'}`);

  // Recommendations
  body.appendParagraph('RECOMMENDATIONS')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  modelCard.caveatAndRecommendations.recommendations.forEach(r =>
    body.appendListItem(r)
  );

  // Move to exports folder
  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  if (folderId) {
    const docFile = DriveApp.getFileById(doc.getId());
    DriveApp.getFolderById(folderId).addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  }

  doc.saveAndClose();

  logSystemEvent('SUCCESS', 'MODEL_CARD', 'Doc export created', { docId: doc.getId() });

  return doc;
}

/**
 * Save markdown to Drive
 */
function saveMarkdownToDrive(markdown, systemName) {
  const filename = `ModelCard_${systemName}_${new Date().toISOString().substring(0, 10)}.md`;

  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  let file;

  if (folderId) {
    file = DriveApp.getFolderById(folderId).createFile(filename, markdown, MimeType.PLAIN_TEXT);
  } else {
    file = DriveApp.createFile(filename, markdown, MimeType.PLAIN_TEXT);
  }

  logSystemEvent('SUCCESS', 'MODEL_CARD', 'Markdown export created', { fileId: file.getId() });

  return file;
}


// ==========================
// UI FUNCTIONS
// ==========================

function generateModelCardFromUI() {
  const ui = SpreadsheetApp.getUi();

  const systemResponse = ui.prompt(
    'Generate Model Card',
    'Enter the AI system name (will search ledger entries for this name):',
    ui.ButtonSet.OK_CANCEL
  );
  if (systemResponse.getSelectedButton() !== ui.Button.OK) return;
  const systemName = systemResponse.getResponseText().trim();

  if (!systemName) {
    ui.alert('Error', 'System name is required.', ui.ButtonSet.OK);
    return;
  }

  ui.alert('Generating', 'Creating Model Card. This may take a moment...', ui.ButtonSet.OK);

  try {
    const modelCard = generateModelCard(systemName);

    // Export both formats
    const markdown = exportModelCardAsMarkdown(modelCard);
    const mdFile = saveMarkdownToDrive(markdown, systemName);
    const doc = exportModelCardAsDoc(modelCard);

    let resultText = `MODEL CARD GENERATED\n\n`;
    resultText += `System: ${systemName}\n`;
    resultText += `Card ID: ${modelCard.metadata.cardId}\n`;
    resultText += `Entries Analyzed: ${modelCard.metadata.entriesAnalyzed}\n\n`;

    resultText += `SUMMARY:\n`;
    resultText += `• Known Limitations: ${modelCard.knownLimitations.length}\n`;
    resultText += `• Known Gaps (VOIDs): ${modelCard.knownGaps.length}\n`;
    resultText += `• Incidents: ${modelCard.incidents.length}\n`;
    resultText += `• Regulatory Tags: ${modelCard.regulatoryCompliance.totalTags}\n\n`;

    resultText += `EXPORTS:\n`;
    resultText += `• Markdown: ${mdFile.getName()}\n`;
    resultText += `• Google Doc: ${doc.getName()}\n`;

    ui.alert('Model Card Complete', resultText, ui.ButtonSet.OK);

  } catch (e) {
    logSystemEvent('ERROR', 'MODEL_CARD', 'Generation failed', { error: e.message });
    ui.alert('Error', 'Failed to generate model card: ' + e.message, ui.ButtonSet.OK);
  }
}
