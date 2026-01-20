/**
 * ───────────────────────────────────────────────
 *  NEWTON GAP ANALYSIS ENGINE
 * ───────────────────────────────────────────────
 *
 *  Analyzes compliance gaps against regulatory frameworks:
 *  - ISO/IEC 42001:2023
 *  - EU AI Act
 *  - NIST AI RMF
 *
 *  Compares ledger entries against required documentation
 *  checklists and identifies missing artifacts.
 *
 *  Auto-creates VOID entries for gaps so the agentic
 *  controller can autonomously hunt for missing items.
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// FRAMEWORK REQUIREMENTS
// ==========================

/**
 * Required documentation/evidence for each framework clause
 * Each requirement maps to expected evidence types
 */
const FRAMEWORK_REQUIREMENTS = {

  // ISO/IEC 42001:2023 Requirements
  ISO_42001: {
    '4.1': {
      title: 'Understanding the organization and its context',
      required: [
        'Context analysis document',
        'Stakeholder register',
        'External/internal factors assessment',
        'AI technology landscape review'
      ],
      evidenceTypes: ['DECISION', 'REVIEW', 'ASSESSMENT', 'DOCUMENTATION']
    },
    '4.2': {
      title: 'Understanding needs and expectations',
      required: [
        'Interested party analysis',
        'Requirements register',
        'Stakeholder expectations documentation'
      ],
      evidenceTypes: ['ASSESSMENT', 'DOCUMENTATION', 'REVIEW']
    },
    '4.3': {
      title: 'Scope of the AI management system',
      required: [
        'Scope statement',
        'Boundaries definition',
        'AI systems inventory'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION']
    },
    '4.4': {
      title: 'AI management system',
      required: [
        'AIMS documentation',
        'Process definitions',
        'System architecture'
      ],
      evidenceTypes: ['DOCUMENTATION', 'SYSTEM_DESCRIPTION']
    },
    '5.1': {
      title: 'Leadership and commitment',
      required: [
        'Management commitment statement',
        'Resource allocation evidence',
        'Leadership review records'
      ],
      evidenceTypes: ['DECISION', 'APPROVAL', 'REVIEW']
    },
    '5.2': {
      title: 'AI policy',
      required: [
        'AI policy document',
        'Policy approval record',
        'Policy communication evidence'
      ],
      evidenceTypes: ['DOCUMENTATION', 'APPROVAL', 'COMMUNICATION']
    },
    '5.3': {
      title: 'Roles, responsibilities and authorities',
      required: [
        'Role definitions',
        'RACI matrix',
        'Authority assignments'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION']
    },
    '6.1': {
      title: 'Actions to address risks and opportunities',
      required: [
        'Risk register',
        'Opportunity register',
        'Risk treatment plans'
      ],
      evidenceTypes: ['RISK_IDENTIFIED', 'RISK_ASSESSMENT', 'DECISION']
    },
    '6.2': {
      title: 'AI objectives and planning',
      required: [
        'AI objectives document',
        'Achievement plan',
        'KPI definitions'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION', 'METRIC']
    },
    '6.3': {
      title: 'Planning of changes',
      required: [
        'Change management procedure',
        'Change log',
        'Impact assessments'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION', 'ASSESSMENT']
    },
    '7.1': {
      title: 'Resources',
      required: [
        'Resource plan',
        'Budget allocation',
        'Infrastructure documentation'
      ],
      evidenceTypes: ['DECISION', 'APPROVAL', 'DOCUMENTATION']
    },
    '7.2': {
      title: 'Competence',
      required: [
        'Competence requirements',
        'Training records',
        'Qualification evidence'
      ],
      evidenceTypes: ['DOCUMENTATION', 'TRAINING']
    },
    '7.3': {
      title: 'Awareness',
      required: [
        'Awareness program',
        'Communication records',
        'Training completion records'
      ],
      evidenceTypes: ['TRAINING', 'COMMUNICATION']
    },
    '7.4': {
      title: 'Communication',
      required: [
        'Communication plan',
        'Stakeholder communication records',
        'Internal communication evidence'
      ],
      evidenceTypes: ['COMMUNICATION', 'DOCUMENTATION']
    },
    '7.5': {
      title: 'Documented information',
      required: [
        'Document control procedure',
        'Document register',
        'Version control records'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION']
    },
    '8.1': {
      title: 'Operational planning and control',
      required: [
        'Operational procedures',
        'Process controls documentation',
        'Performance monitoring records'
      ],
      evidenceTypes: ['DOCUMENTATION', 'METRIC', 'MONITORING']
    },
    '8.2': {
      title: 'AI risk assessment',
      required: [
        'Risk assessment methodology',
        'Risk assessment records',
        'Risk criteria documentation'
      ],
      evidenceTypes: ['RISK_ASSESSMENT', 'DOCUMENTATION', 'DECISION']
    },
    '8.3': {
      title: 'AI risk treatment',
      required: [
        'Risk treatment plans',
        'Control implementation records',
        'Residual risk acceptance'
      ],
      evidenceTypes: ['DECISION', 'DOCUMENTATION', 'APPROVAL']
    },
    '8.4': {
      title: 'AI system impact assessment',
      required: [
        'Impact assessment methodology',
        'Impact assessment records',
        'Stakeholder impact analysis'
      ],
      evidenceTypes: ['ASSESSMENT', 'DOCUMENTATION', 'REVIEW']
    },
    '9.1': {
      title: 'Monitoring, measurement, analysis and evaluation',
      required: [
        'Monitoring plan',
        'KPI tracking records',
        'Performance analysis reports'
      ],
      evidenceTypes: ['METRIC', 'MONITORING', 'EVALUATION']
    },
    '9.2': {
      title: 'Internal audit',
      required: [
        'Audit program',
        'Audit reports',
        'Audit findings register'
      ],
      evidenceTypes: ['AUDIT', 'REVIEW', 'DOCUMENTATION']
    },
    '9.3': {
      title: 'Management review',
      required: [
        'Management review schedule',
        'Review meeting minutes',
        'Action items tracking'
      ],
      evidenceTypes: ['REVIEW', 'DECISION', 'DOCUMENTATION']
    },
    '10.1': {
      title: 'Continual improvement',
      required: [
        'Improvement plan',
        'Improvement tracking register',
        'Lessons learned documentation'
      ],
      evidenceTypes: ['DECISION', 'DOCUMENTATION', 'REVIEW']
    },
    '10.2': {
      title: 'Nonconformity and corrective action',
      required: [
        'Nonconformity register',
        'Corrective action records',
        'Root cause analyses'
      ],
      evidenceTypes: ['INCIDENT', 'ESCALATED', 'DECISION', 'DOCUMENTATION']
    }
  },

  // EU AI Act Requirements
  EU_AI_ACT: {
    'Art.9': {
      title: 'Risk management system',
      required: [
        'Risk management system documentation',
        'Risk identification records',
        'Risk evaluation methodology',
        'Continuous risk monitoring evidence'
      ],
      evidenceTypes: ['RISK_ASSESSMENT', 'DOCUMENTATION', 'MONITORING']
    },
    'Art.10': {
      title: 'Data and data governance',
      required: [
        'Data governance framework',
        'Training data documentation',
        'Data quality assessment',
        'Bias testing records'
      ],
      evidenceTypes: ['DOCUMENTATION', 'ASSESSMENT', 'EVALUATION']
    },
    'Art.11': {
      title: 'Technical documentation',
      required: [
        'System architecture documentation',
        'Algorithm documentation',
        'Design specifications',
        'Development methodology'
      ],
      evidenceTypes: ['DOCUMENTATION', 'SYSTEM_DESCRIPTION']
    },
    'Art.12': {
      title: 'Record-keeping',
      required: [
        'Audit logging system',
        'Record retention policy',
        'Traceability documentation'
      ],
      evidenceTypes: ['DOCUMENTATION', 'AUDIT']
    },
    'Art.13': {
      title: 'Transparency and information',
      required: [
        'User instructions',
        'Transparency documentation',
        'Capability and limitation disclosures',
        'Model card or equivalent'
      ],
      evidenceTypes: ['DOCUMENTATION', 'COMMUNICATION']
    },
    'Art.14': {
      title: 'Human oversight',
      required: [
        'Human oversight mechanism design',
        'Override capability documentation',
        'Human-in-the-loop procedures',
        'Intervention protocols'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION', 'REVIEW']
    },
    'Art.15': {
      title: 'Accuracy, robustness and cybersecurity',
      required: [
        'Accuracy metrics documentation',
        'Robustness testing records',
        'Cybersecurity assessment',
        'Resilience testing evidence'
      ],
      evidenceTypes: ['METRIC', 'EVALUATION', 'ASSESSMENT']
    },
    'Art.17': {
      title: 'Quality management system',
      required: [
        'QMS documentation',
        'Quality objectives',
        'Quality procedures',
        'Quality records'
      ],
      evidenceTypes: ['DOCUMENTATION', 'AUDIT', 'REVIEW']
    },
    'Art.19': {
      title: 'Conformity assessment',
      required: [
        'Conformity assessment records',
        'Self-assessment documentation',
        'Third-party assessment (if applicable)'
      ],
      evidenceTypes: ['ASSESSMENT', 'DOCUMENTATION', 'AUDIT']
    },
    'Art.27': {
      title: 'Fundamental rights impact assessment',
      required: [
        'FRIA methodology',
        'Impact assessment records',
        'Stakeholder consultation records',
        'Mitigation measures documentation'
      ],
      evidenceTypes: ['ASSESSMENT', 'DOCUMENTATION', 'DECISION']
    },
    'Art.71': {
      title: 'Post-market monitoring',
      required: [
        'Monitoring plan',
        'Performance tracking records',
        'Incident detection procedures',
        'Corrective action records'
      ],
      evidenceTypes: ['MONITORING', 'METRIC', 'INCIDENT']
    },
    'Art.72': {
      title: 'Reporting of serious incidents',
      required: [
        'Incident reporting procedure',
        'Incident log',
        'Authority notification records',
        'Investigation records'
      ],
      evidenceTypes: ['INCIDENT', 'ESCALATED', 'DOCUMENTATION', 'COMMUNICATION']
    },
    'Annex-IV': {
      title: 'Technical documentation requirements',
      required: [
        'General description of AI system',
        'Detailed description of elements',
        'Monitoring, functioning and control',
        'Risk management system description',
        'Lifecycle changes documentation',
        'Standards applied list',
        'EU declaration of conformity'
      ],
      evidenceTypes: ['DOCUMENTATION', 'SYSTEM_DESCRIPTION']
    }
  },

  // NIST AI RMF Requirements
  NIST_AI_RMF: {
    'GOVERN-1': {
      title: 'Policies, processes, procedures',
      required: [
        'AI governance policy',
        'Risk management procedures',
        'Decision-making processes'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION', 'APPROVAL']
    },
    'GOVERN-2': {
      title: 'Accountability structures',
      required: [
        'Accountability framework',
        'Role definitions',
        'Escalation procedures'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION']
    },
    'GOVERN-3': {
      title: 'Workforce diversity and culture',
      required: [
        'Diversity policy',
        'Team composition records',
        'Culture assessment'
      ],
      evidenceTypes: ['DOCUMENTATION', 'ASSESSMENT']
    },
    'GOVERN-4': {
      title: 'Organizational risk tolerance',
      required: [
        'Risk appetite statement',
        'Risk tolerance thresholds',
        'Risk acceptance criteria'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION', 'APPROVAL']
    },
    'GOVERN-5': {
      title: 'Stakeholder engagement',
      required: [
        'Stakeholder engagement plan',
        'Feedback collection records',
        'Consultation documentation'
      ],
      evidenceTypes: ['COMMUNICATION', 'DOCUMENTATION', 'REVIEW']
    },
    'GOVERN-6': {
      title: 'Policies for third-party AI',
      required: [
        'Third-party AI policy',
        'Vendor assessment records',
        'Supply chain risk documentation'
      ],
      evidenceTypes: ['DOCUMENTATION', 'ASSESSMENT', 'DECISION']
    },
    'MAP-1': {
      title: 'Context establishment',
      required: [
        'Use case documentation',
        'Context analysis',
        'Operational environment description'
      ],
      evidenceTypes: ['DOCUMENTATION', 'ASSESSMENT']
    },
    'MAP-2': {
      title: 'AI system categorization',
      required: [
        'System classification',
        'Risk categorization',
        'Taxonomy mapping'
      ],
      evidenceTypes: ['DOCUMENTATION', 'DECISION', 'ASSESSMENT']
    },
    'MAP-3': {
      title: 'AI capabilities and limitations',
      required: [
        'Capability documentation',
        'Limitation disclosure',
        'Boundary conditions'
      ],
      evidenceTypes: ['DOCUMENTATION', 'EVALUATION']
    },
    'MAP-4': {
      title: 'Risks and benefits mapping',
      required: [
        'Benefit analysis',
        'Risk mapping',
        'Tradeoff documentation'
      ],
      evidenceTypes: ['ASSESSMENT', 'DOCUMENTATION', 'DECISION']
    },
    'MAP-5': {
      title: 'Impact characterization',
      required: [
        'Impact assessment',
        'Affected populations analysis',
        'Consequence documentation'
      ],
      evidenceTypes: ['ASSESSMENT', 'DOCUMENTATION']
    },
    'MEASURE-1': {
      title: 'Risk measurement approaches',
      required: [
        'Metrics framework',
        'Measurement methodology',
        'Indicator definitions'
      ],
      evidenceTypes: ['DOCUMENTATION', 'METRIC']
    },
    'MEASURE-2': {
      title: 'AI system evaluation',
      required: [
        'Evaluation plan',
        'Testing records',
        'Validation documentation'
      ],
      evidenceTypes: ['EVALUATION', 'DOCUMENTATION', 'METRIC']
    },
    'MEASURE-3': {
      title: 'Tracking identified risks',
      required: [
        'Risk tracking register',
        'Status updates',
        'Progress monitoring'
      ],
      evidenceTypes: ['MONITORING', 'DOCUMENTATION', 'RISK_ASSESSMENT']
    },
    'MEASURE-4': {
      title: 'Feedback and information gathering',
      required: [
        'Feedback collection system',
        'Information gathering procedures',
        'Stakeholder input records'
      ],
      evidenceTypes: ['COMMUNICATION', 'DOCUMENTATION']
    },
    'MANAGE-1': {
      title: 'Risk prioritization',
      required: [
        'Prioritization methodology',
        'Priority ranking',
        'Resource allocation decisions'
      ],
      evidenceTypes: ['DECISION', 'DOCUMENTATION', 'RISK_ASSESSMENT']
    },
    'MANAGE-2': {
      title: 'Risk treatment strategies',
      required: [
        'Treatment options analysis',
        'Strategy selection documentation',
        'Implementation plans'
      ],
      evidenceTypes: ['DECISION', 'DOCUMENTATION']
    },
    'MANAGE-3': {
      title: 'Risk management resources',
      required: [
        'Resource allocation',
        'Budget documentation',
        'Capability assessment'
      ],
      evidenceTypes: ['DECISION', 'DOCUMENTATION', 'APPROVAL']
    },
    'MANAGE-4': {
      title: 'Residual risk management',
      required: [
        'Residual risk documentation',
        'Acceptance decisions',
        'Ongoing monitoring plans'
      ],
      evidenceTypes: ['DECISION', 'DOCUMENTATION', 'APPROVAL']
    }
  }
};


// ==========================
// GAP ANALYSIS ENGINE
// ==========================

/**
 * Run comprehensive gap analysis against a framework
 *
 * @param {string} framework - Framework ID (ISO_42001, EU_AI_ACT, NIST_AI_RMF)
 * @param {boolean} autoCreateVoids - Whether to auto-create VOID entries for gaps
 * @returns {Object} - Gap analysis results
 */
function runGapAnalysis(framework, autoCreateVoids = true) {
  const requirements = FRAMEWORK_REQUIREMENTS[framework];
  if (!requirements) {
    throw new Error('Unknown framework: ' + framework + '. Use ISO_42001, EU_AI_ACT, or NIST_AI_RMF');
  }

  logSystemEvent('INFO', 'GAP_ANALYSIS', 'Starting gap analysis', { framework, autoCreateVoids });

  const results = {
    analysisId: Utilities.getUuid(),
    framework: framework,
    frameworkName: getFrameworkName(framework),
    analyzedAt: new Date().toISOString(),
    analyzedBy: Session.getEffectiveUser().getEmail(),

    summary: {
      totalClauses: Object.keys(requirements).length,
      coveredClauses: 0,
      partialClauses: 0,
      missingClauses: 0,
      coveragePercent: 0
    },

    coveredClauses: [],
    partialClauses: [],
    missingClauses: [],
    gaps: [],
    voidsCreated: []
  };

  // Get all ledger entries with regulatory tags
  const taggedEntries = getAllTaggedEntries();

  // Analyze each clause
  for (const [clauseId, clauseReq] of Object.entries(requirements)) {
    const fullTag = `${framework}:${clauseId}`;
    const clauseEntries = taggedEntries.filter(e =>
      e.regulatoryTags.includes(fullTag)
    );

    // Also check for evidence types
    const evidenceEntries = taggedEntries.filter(e =>
      clauseReq.evidenceTypes.some(et =>
        e.eventType.toUpperCase().includes(et)
      )
    );

    // Determine coverage status
    const coverage = analyzeClauseCoverage(clauseReq, clauseEntries, evidenceEntries);

    if (coverage.status === 'COVERED') {
      results.summary.coveredClauses++;
      results.coveredClauses.push({
        clauseId: clauseId,
        title: clauseReq.title,
        entriesFound: clauseEntries.length,
        evidenceTypes: coverage.evidenceTypesFound
      });
    } else if (coverage.status === 'PARTIAL') {
      results.summary.partialClauses++;
      results.partialClauses.push({
        clauseId: clauseId,
        title: clauseReq.title,
        entriesFound: clauseEntries.length,
        missingRequirements: coverage.missingRequirements,
        coveragePercent: coverage.coveragePercent
      });

      // Add gaps for missing requirements
      for (const missing of coverage.missingRequirements) {
        results.gaps.push({
          gapId: `GAP-${results.gaps.length + 1}`,
          framework: framework,
          clauseId: clauseId,
          clauseTitle: clauseReq.title,
          missingArtifact: missing,
          severity: determinGapSeverity(clauseId, framework),
          status: 'OPEN'
        });
      }
    } else {
      results.summary.missingClauses++;
      results.missingClauses.push({
        clauseId: clauseId,
        title: clauseReq.title,
        requiredArtifacts: clauseReq.required
      });

      // Add gap for entire clause
      results.gaps.push({
        gapId: `GAP-${results.gaps.length + 1}`,
        framework: framework,
        clauseId: clauseId,
        clauseTitle: clauseReq.title,
        missingArtifact: `All documentation for ${clauseId}: ${clauseReq.title}`,
        severity: determinGapSeverity(clauseId, framework),
        status: 'OPEN'
      });
    }
  }

  // Calculate coverage percentage
  results.summary.coveragePercent = Math.round(
    ((results.summary.coveredClauses + (results.summary.partialClauses * 0.5)) /
      results.summary.totalClauses) * 100
  );

  // Auto-create VOID entries for gaps
  if (autoCreateVoids && results.gaps.length > 0) {
    results.voidsCreated = createVoidsForGaps(results.gaps, framework);
  }

  logSystemEvent('SUCCESS', 'GAP_ANALYSIS', 'Analysis complete', {
    analysisId: results.analysisId,
    coverage: results.summary.coveragePercent,
    gaps: results.gaps.length,
    voidsCreated: results.voidsCreated.length
  });

  return results;
}

function getFrameworkName(framework) {
  const names = {
    ISO_42001: 'ISO/IEC 42001:2023',
    EU_AI_ACT: 'EU AI Act',
    NIST_AI_RMF: 'NIST AI RMF 1.0'
  };
  return names[framework] || framework;
}

function getAllTaggedEntries() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();

  return data.map(row => ({
    uuid: row[0],
    timestamp: row[1],
    actor: row[2],
    eventType: row[3],
    text: row[4],
    status: row[8],
    regulatoryTags: row[14] || ''
  }));
}

function analyzeClauseCoverage(clauseReq, taggedEntries, evidenceEntries) {
  const allRelevantEntries = [...new Set([...taggedEntries, ...evidenceEntries])];

  if (allRelevantEntries.length === 0) {
    return {
      status: 'MISSING',
      entriesFound: 0,
      missingRequirements: clauseReq.required,
      evidenceTypesFound: [],
      coveragePercent: 0
    };
  }

  // Check which required artifacts are covered
  const foundRequirements = [];
  const missingRequirements = [];
  const evidenceTypesFound = new Set();

  for (const req of clauseReq.required) {
    const reqLower = req.toLowerCase();
    const found = allRelevantEntries.some(e => {
      const textLower = (e.text || '').toLowerCase();
      const typeLower = (e.eventType || '').toLowerCase();

      // Check for keyword matches
      const keywords = reqLower.split(/\s+/).filter(k => k.length > 3);
      const matchCount = keywords.filter(k =>
        textLower.includes(k) || typeLower.includes(k)
      ).length;

      return matchCount >= Math.ceil(keywords.length * 0.5);
    });

    if (found) {
      foundRequirements.push(req);
    } else {
      missingRequirements.push(req);
    }
  }

  // Track evidence types found
  for (const entry of allRelevantEntries) {
    for (const et of clauseReq.evidenceTypes) {
      if (entry.eventType.toUpperCase().includes(et)) {
        evidenceTypesFound.add(et);
      }
    }
  }

  const coveragePercent = Math.round((foundRequirements.length / clauseReq.required.length) * 100);

  if (coveragePercent >= 80) {
    return {
      status: 'COVERED',
      entriesFound: allRelevantEntries.length,
      missingRequirements: missingRequirements,
      evidenceTypesFound: Array.from(evidenceTypesFound),
      coveragePercent: coveragePercent
    };
  } else if (coveragePercent > 0) {
    return {
      status: 'PARTIAL',
      entriesFound: allRelevantEntries.length,
      missingRequirements: missingRequirements,
      evidenceTypesFound: Array.from(evidenceTypesFound),
      coveragePercent: coveragePercent
    };
  } else {
    return {
      status: 'MISSING',
      entriesFound: 0,
      missingRequirements: clauseReq.required,
      evidenceTypesFound: [],
      coveragePercent: 0
    };
  }
}

function determinGapSeverity(clauseId, framework) {
  // Critical clauses that have higher severity
  const criticalClauses = {
    ISO_42001: ['6.1', '8.2', '8.3', '9.2', '10.2'],
    EU_AI_ACT: ['Art.9', 'Art.10', 'Art.14', 'Art.72', 'Annex-IV'],
    NIST_AI_RMF: ['GOVERN-1', 'MAP-4', 'MEASURE-2', 'MANAGE-2']
  };

  if (criticalClauses[framework]?.includes(clauseId)) {
    return 'HIGH';
  }
  return 'MEDIUM';
}

/**
 * Create VOID entries for identified gaps so agent can hunt
 */
function createVoidsForGaps(gaps, framework) {
  const voidsCreated = [];

  for (const gap of gaps) {
    const voidText = [
      `[GAP_ANALYSIS_VOID]`,
      `Framework: ${framework}`,
      `Clause: ${gap.clauseId} - ${gap.clauseTitle}`,
      `Missing: ${gap.missingArtifact}`,
      `Severity: ${gap.severity}`,
      ``,
      `This void was auto-generated by Gap Analysis.`,
      `The Newton Agent can hunt for this missing documentation.`
    ].join('\n');

    try {
      const result = safeNewEntry(
        'System',
        'GAP_VOID',
        voidText,
        '',
        'DRAFT'
      );

      // Tag the entry with the regulatory reference
      if (result.uuid) {
        tagEntry(result.uuid, [`${framework}:${gap.clauseId}`]);
      }

      voidsCreated.push({
        gapId: gap.gapId,
        voidUuid: result.uuid,
        clause: gap.clauseId
      });
    } catch (e) {
      logSystemEvent('WARN', 'GAP_ANALYSIS', 'Failed to create void entry', {
        gapId: gap.gapId,
        error: e.message
      });
    }
  }

  return voidsCreated;
}


// ==========================
// OUTPUT GENERATORS
// ==========================

/**
 * Export gap analysis as Google Doc
 */
function exportGapAnalysisAsDoc(results) {
  const title = `Gap Analysis: ${results.frameworkName}`;
  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  // Title
  body.appendParagraph(title)
    .setHeading(DocumentApp.ParagraphHeading.TITLE);

  body.appendParagraph(`Generated: ${results.analyzedAt}`)
    .setItalic(true);
  body.appendParagraph(`Analysis ID: ${results.analysisId}`);
  body.appendParagraph(`Analyzed By: ${results.analyzedBy}`);

  body.appendHorizontalRule();

  // Executive Summary
  body.appendParagraph('EXECUTIVE SUMMARY')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Framework: ${results.frameworkName}`);
  body.appendParagraph(`Overall Coverage: ${results.summary.coveragePercent}%`);
  body.appendParagraph('');

  const summaryTable = body.appendTable();
  const summaryHeader = summaryTable.appendTableRow();
  ['Status', 'Clauses', 'Percentage'].forEach(h =>
    summaryHeader.appendTableCell(h).setBold(true)
  );

  const total = results.summary.totalClauses;
  summaryTable.appendTableRow()
    .appendTableCell('Fully Covered')
    .getParentRow().appendTableCell(String(results.summary.coveredClauses))
    .getParentRow().appendTableCell(`${Math.round((results.summary.coveredClauses / total) * 100)}%`);

  summaryTable.appendTableRow()
    .appendTableCell('Partially Covered')
    .getParentRow().appendTableCell(String(results.summary.partialClauses))
    .getParentRow().appendTableCell(`${Math.round((results.summary.partialClauses / total) * 100)}%`);

  summaryTable.appendTableRow()
    .appendTableCell('Missing')
    .getParentRow().appendTableCell(String(results.summary.missingClauses))
    .getParentRow().appendTableCell(`${Math.round((results.summary.missingClauses / total) * 100)}%`);

  body.appendHorizontalRule();

  // Covered Clauses
  body.appendParagraph('COVERED CLAUSES')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (results.coveredClauses.length > 0) {
    results.coveredClauses.forEach(c => {
      body.appendParagraph(`✅ ${c.clauseId}: ${c.title}`).setBold(true);
      body.appendParagraph(`   Entries: ${c.entriesFound} | Evidence Types: ${c.evidenceTypes.join(', ')}`);
    });
  } else {
    body.appendParagraph('No clauses fully covered.');
  }

  body.appendHorizontalRule();

  // Partial Coverage
  body.appendParagraph('PARTIAL COVERAGE')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (results.partialClauses.length > 0) {
    results.partialClauses.forEach(c => {
      body.appendParagraph(`⚠️ ${c.clauseId}: ${c.title} (${c.coveragePercent}%)`).setBold(true);
      body.appendParagraph('Missing:');
      c.missingRequirements.forEach(m =>
        body.appendListItem(m)
      );
    });
  } else {
    body.appendParagraph('No clauses with partial coverage.');
  }

  body.appendHorizontalRule();

  // Missing Clauses (Gaps)
  body.appendParagraph('MISSING CLAUSES (GAPS)')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (results.missingClauses.length > 0) {
    results.missingClauses.forEach(c => {
      body.appendParagraph(`❌ ${c.clauseId}: ${c.title}`).setBold(true);
      body.appendParagraph('Required artifacts:');
      c.requiredArtifacts.forEach(r =>
        body.appendListItem(r)
      );
    });
  } else {
    body.appendParagraph('No completely missing clauses.');
  }

  body.appendHorizontalRule();

  // Gap Summary
  body.appendParagraph('GAP SUMMARY')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph(`Total Gaps Identified: ${results.gaps.length}`);
  body.appendParagraph(`VOID Entries Created: ${results.voidsCreated.length}`);

  if (results.gaps.length > 0) {
    const gapTable = body.appendTable();
    const gapHeader = gapTable.appendTableRow();
    ['Gap ID', 'Clause', 'Missing Artifact', 'Severity'].forEach(h =>
      gapHeader.appendTableCell(h).setBold(true)
    );

    results.gaps.forEach(g => {
      const row = gapTable.appendTableRow();
      row.appendTableCell(g.gapId);
      row.appendTableCell(g.clauseId);
      row.appendTableCell(g.missingArtifact.substring(0, 50));
      row.appendTableCell(g.severity);
    });
  }

  body.appendHorizontalRule();

  // Recommended Actions
  body.appendParagraph('RECOMMENDED ACTIONS')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const recommendations = generateRecommendations(results);
  recommendations.forEach(r => body.appendListItem(r));

  body.appendHorizontalRule();

  // Footer
  body.appendParagraph('VOID entries have been created for all gaps.')
    .setItalic(true);
  body.appendParagraph('Run Newton Agent > Run Investigation to hunt for missing artifacts.')
    .setItalic(true);

  // Move to exports folder
  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  if (folderId) {
    const docFile = DriveApp.getFileById(doc.getId());
    DriveApp.getFolderById(folderId).addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  }

  doc.saveAndClose();

  logSystemEvent('SUCCESS', 'GAP_ANALYSIS', 'Doc export created', { docId: doc.getId() });

  return doc;
}

function generateRecommendations(results) {
  const recs = [];

  if (results.summary.missingClauses > 0) {
    recs.push(`URGENT: Address ${results.summary.missingClauses} completely missing clause(s) - these represent significant compliance gaps`);
  }

  if (results.summary.coveragePercent < 50) {
    recs.push(`Coverage is below 50% - prioritize establishing foundational documentation for ${results.frameworkName}`);
  }

  if (results.gaps.filter(g => g.severity === 'HIGH').length > 0) {
    const highGaps = results.gaps.filter(g => g.severity === 'HIGH');
    recs.push(`Address ${highGaps.length} HIGH severity gap(s) first: ${highGaps.map(g => g.clauseId).join(', ')}`);
  }

  // Framework-specific recommendations
  if (results.framework === 'EU_AI_ACT') {
    const annex4Gap = results.gaps.find(g => g.clauseId === 'Annex-IV');
    if (annex4Gap) {
      recs.push('Annex IV Technical Documentation is mandatory for high-risk AI systems under EU AI Act');
    }

    const art72Gap = results.gaps.find(g => g.clauseId === 'Art.72');
    if (art72Gap) {
      recs.push('Establish incident reporting procedures immediately - Art. 72 requires timely notification');
    }
  }

  if (results.framework === 'ISO_42001') {
    const riskGaps = results.gaps.filter(g => ['6.1', '8.2', '8.3'].includes(g.clauseId));
    if (riskGaps.length > 0) {
      recs.push('Risk management clauses (6.1, 8.2, 8.3) are core requirements - prioritize these');
    }
  }

  if (results.voidsCreated.length > 0) {
    recs.push(`Use Newton Agent to autonomously hunt for ${results.voidsCreated.length} missing artifact(s)`);
  }

  if (recs.length === 0) {
    recs.push('Maintain current documentation and monitoring practices');
    recs.push('Consider scheduling regular gap analyses (quarterly recommended)');
  }

  return recs;
}


// ==========================
// UI FUNCTIONS
// ==========================

function runGapAnalysisFromUI() {
  const ui = SpreadsheetApp.getUi();

  const fwResponse = ui.prompt(
    'Gap Analysis',
    'Enter framework (ISO_42001, EU_AI_ACT, or NIST_AI_RMF):',
    ui.ButtonSet.OK_CANCEL
  );
  if (fwResponse.getSelectedButton() !== ui.Button.OK) return;

  const framework = fwResponse.getResponseText().trim().toUpperCase();

  if (!['ISO_42001', 'EU_AI_ACT', 'NIST_AI_RMF'].includes(framework)) {
    ui.alert('Error', 'Invalid framework. Use ISO_42001, EU_AI_ACT, or NIST_AI_RMF.', ui.ButtonSet.OK);
    return;
  }

  const voidResponse = ui.alert(
    'Create VOIDs?',
    'Auto-create VOID entries for gaps so Newton Agent can hunt for them?',
    ui.ButtonSet.YES_NO
  );
  const autoCreateVoids = (voidResponse === ui.Button.YES);

  ui.alert('Analyzing', 'Running gap analysis. This may take a moment...', ui.ButtonSet.OK);

  try {
    const results = runGapAnalysis(framework, autoCreateVoids);
    const doc = exportGapAnalysisAsDoc(results);

    let resultText = `GAP ANALYSIS COMPLETE\n\n`;
    resultText += `Framework: ${results.frameworkName}\n`;
    resultText += `Analysis ID: ${results.analysisId}\n\n`;

    resultText += `COVERAGE SUMMARY:\n`;
    resultText += `• Overall: ${results.summary.coveragePercent}%\n`;
    resultText += `• Covered: ${results.summary.coveredClauses}/${results.summary.totalClauses}\n`;
    resultText += `• Partial: ${results.summary.partialClauses}\n`;
    resultText += `• Missing: ${results.summary.missingClauses}\n\n`;

    resultText += `GAPS:\n`;
    resultText += `• Total Gaps: ${results.gaps.length}\n`;
    resultText += `• VOIDs Created: ${results.voidsCreated.length}\n\n`;

    resultText += `Report saved: ${doc.getName()}\n`;

    if (autoCreateVoids && results.voidsCreated.length > 0) {
      resultText += `\nRun "Newton Agent > Run Investigation" to hunt for missing artifacts.`;
    }

    ui.alert('Gap Analysis Results', resultText, ui.ButtonSet.OK);

  } catch (e) {
    logSystemEvent('ERROR', 'GAP_ANALYSIS', 'Analysis failed', { error: e.message });
    ui.alert('Error', 'Gap analysis failed: ' + e.message, ui.ButtonSet.OK);
  }
}


// ==========================
// QUICK MULTI-FRAMEWORK ANALYSIS
// ==========================

/**
 * Run gap analysis across all three frameworks
 */
function runMultiFrameworkAnalysis() {
  const frameworks = ['ISO_42001', 'EU_AI_ACT', 'NIST_AI_RMF'];
  const allResults = {};

  for (const fw of frameworks) {
    try {
      allResults[fw] = runGapAnalysis(fw, false); // Don't auto-create voids yet
    } catch (e) {
      allResults[fw] = { error: e.message };
    }
  }

  return allResults;
}

function runMultiFrameworkFromUI() {
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    'Multi-Framework Analysis',
    'This will analyze compliance against ISO 42001, EU AI Act, and NIST AI RMF.\n\nProceed?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  ui.alert('Analyzing', 'Running analysis across all frameworks...', ui.ButtonSet.OK);

  const results = runMultiFrameworkAnalysis();

  let text = 'MULTI-FRAMEWORK GAP ANALYSIS\n\n';

  for (const [fw, result] of Object.entries(results)) {
    if (result.error) {
      text += `${fw}: ERROR - ${result.error}\n`;
    } else {
      text += `${result.frameworkName}:\n`;
      text += `  Coverage: ${result.summary.coveragePercent}%\n`;
      text += `  Gaps: ${result.gaps.length}\n\n`;
    }
  }

  ui.alert('Results', text, ui.ButtonSet.OK);
}
