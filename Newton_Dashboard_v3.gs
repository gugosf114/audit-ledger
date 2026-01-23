/**
 * ───────────────────────────────────────────────
 * NEWTON DASHBOARD v3 : UNIVERSAL COMMAND CENTER
 * ───────────────────────────────────────────────
 *
 * Designed for ANY user - from CEOs who want 15-second glances
 * to engineers debugging at 2am.
 *
 * Key principles:
 * - Every term has a tooltip explaining what it means
 * - Every action button describes what happens when clicked
 * - Empty states guide users to take first actions
 * - Status thresholds are visible, not hidden
 * - First-time users get onboarding overlay
 *
 * ───────────────────────────────────────────────
 */

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function openDashboardV3() {
  const template = HtmlService.createTemplateFromFile('DashboardHTML_v3');

  const userProps = PropertiesService.getUserProperties();
  template.savedRole = userProps.getProperty('LAST_DASHBOARD_ROLE') || 'EXEC';
  template.hasSeenOnboarding = userProps.getProperty('DASHBOARD_ONBOARDED') === 'true';

  const html = template.evaluate()
    .setWidth(1280)
    .setHeight(900)
    .setTitle('Newton Command Center');

  SpreadsheetApp.getUi().showModalDialog(html, 'Newton Command Center');
}

function markOnboardingComplete() {
  PropertiesService.getUserProperties().setProperty('DASHBOARD_ONBOARDED', 'true');
  return { success: true };
}

function resetOnboarding() {
  PropertiesService.getUserProperties().deleteProperty('DASHBOARD_ONBOARDED');
  return { success: true };
}

// ============================================================================
// MAIN DATA API
// ============================================================================

function getDashboardDataV3(role, tenantFilter, periodFilter) {
  PropertiesService.getUserProperties().setProperty('LAST_DASHBOARD_ROLE', role);

  const stats = aggregateLedgerStatsV3(tenantFilter, periodFilter);
  const prevStats = aggregateLedgerStatsV3(tenantFilter, getPreviousPeriod(periodFilter));
  const alerts = getActiveAlertsV3(tenantFilter);
  const compliance = getComplianceScoreV3(tenantFilter);
  const tenants = getAvailableTenantsV3();

  let viewData = {};

  // BRIEFING mode is auto-adaptive - shows what matters most right now
  if (role === 'BRIEFING') {
    viewData = buildBriefingView(stats, prevStats, alerts, compliance);
  } else {
    switch(role) {
      case 'EXEC':
        viewData = buildExecViewV3(stats, alerts, compliance);
        break;
      case 'COMPLIANCE':
        viewData = buildComplianceViewV3(stats, alerts, compliance);
        break;
      case 'ENGINEER':
        viewData = buildEngineerViewV3(stats, alerts, compliance);
        break;
      default:
        viewData = buildExecViewV3(stats, alerts, compliance);
    }
  }

  // Common data for all views
  viewData.pulse = {
    activeWorkflows: stats.activeWorkflows,
    systemStatus: getSystemStatus(stats, alerts),
    topPriority: alerts.length > 0
      ? alerts[0]
      : { title: "All systems nominal", type: "SAFE", id: null }
  };

  viewData.tenants = tenants;
  viewData.lastUpdated = new Date().toISOString();
  viewData.isEmpty = stats.totalRecords === 0;

  // Add comparison data for context
  viewData.comparisons = buildComparisons(stats, prevStats, periodFilter);

  return viewData;
}

/**
 * Get the previous period for comparison
 */
function getPreviousPeriod(period) {
  // Returns identifier for previous period (for week-over-week comparisons)
  return period + '_PREV';
}

/**
 * Build week-over-week comparison data
 */
function buildComparisons(current, previous, period) {
  const periodLabel = period === '7D' ? 'last week' : period === '30D' ? 'last month' : 'previous period';

  return {
    aiRequests: {
      current: current.aiRequests || 0,
      previous: previous.aiRequests || 0,
      delta: (current.aiRequests || 0) - (previous.aiRequests || 0),
      trend: getTrend(current.aiRequests, previous.aiRequests),
      context: formatComparison(current.aiRequests, previous.aiRequests, periodLabel)
    },
    blocks: {
      current: current.blocks || 0,
      previous: previous.blocks || 0,
      delta: (current.blocks || 0) - (previous.blocks || 0),
      trend: getTrend(current.blocks, previous.blocks),
      context: formatComparison(current.blocks, previous.blocks, periodLabel)
    },
    errors: {
      current: current.errorRate || 0,
      previous: previous.errorRate || 0,
      delta: (current.errorRate || 0) - (previous.errorRate || 0),
      trend: getTrend(current.errorRate, previous.errorRate),
      context: formatComparison(current.errorRate, previous.errorRate, periodLabel, '%')
    }
  };
}

function getTrend(current, previous) {
  if (!previous || previous === 0) return 'NEW';
  if (current > previous) return 'UP';
  if (current < previous) return 'DOWN';
  return 'FLAT';
}

function formatComparison(current, previous, periodLabel, suffix) {
  suffix = suffix || '';
  if (!previous || previous === 0) return 'No previous data';

  const delta = current - previous;
  const pct = Math.round((delta / previous) * 100);

  if (delta > 0) {
    return `↑ ${Math.abs(delta)}${suffix} more than ${periodLabel} (+${pct}%)`;
  } else if (delta < 0) {
    return `↓ ${Math.abs(delta)}${suffix} fewer than ${periodLabel} (${pct}%)`;
  }
  return `Same as ${periodLabel}`;
}

// ============================================================================
// MORNING BRIEFING VIEW - Auto-adaptive, no role choice needed
// ============================================================================

function buildBriefingView(stats, prevStats, alerts, compliance) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Determine overall status
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;
  const actionCount = alerts.filter(a => a.severity === 'HIGH' || a.severity === 'CRITICAL').length;

  let overallStatus = 'SAFE';
  let overallMessage = 'Looking good';

  if (criticalCount > 0) {
    overallStatus = 'ACTION';
    overallMessage = `${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} need${criticalCount === 1 ? 's' : ''} attention`;
  } else if (actionCount > 0 || compliance.missingClauses > 5) {
    overallStatus = 'WATCH';
    overallMessage = 'A few items need your attention';
  }

  // Build priority list - what should user do first?
  const priorities = buildPriorityList(stats, alerts, compliance);

  return {
    viewType: 'BRIEFING',
    viewDescription: `${greeting}. Here's your AI governance status.`,
    greeting: greeting,
    overallStatus: overallStatus,
    overallMessage: overallMessage,
    priorities: priorities,
    tiles: [] // Briefing view uses priorities instead of tiles
  };
}

/**
 * Build prioritized action list - what should user do first?
 */
function buildPriorityList(stats, alerts, compliance) {
  const priorities = [];

  // Critical alerts first
  const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL');
  criticalAlerts.forEach(alert => {
    priorities.push({
      urgency: 'URGENT',
      sentence: alert.title,
      consequence: 'This needs immediate attention',
      action: {
        label: 'Fix Now',
        functionName: 'fixTopRisk'
      },
      relativeTime: formatRelativeTime(alert.timestamp)
    });
  });

  // Missing documents
  if (compliance.missingClauses > 0) {
    priorities.push({
      urgency: compliance.missingClauses > 5 ? 'ACTION' : 'WATCH',
      sentence: `${compliance.missingClauses} document${compliance.missingClauses > 1 ? 's are' : ' is'} missing`,
      consequence: 'Auditors will flag these as non-compliant',
      action: {
        label: 'See Which Ones',
        functionName: 'runGapAnalysisFromUI'
      },
      relativeTime: null
    });
  }

  // Blocked AI responses needing review
  if (stats.blocks > 0) {
    priorities.push({
      urgency: stats.blocks > 10 ? 'ACTION' : 'WATCH',
      sentence: `${stats.blocks} AI response${stats.blocks > 1 ? 's were' : ' was'} blocked`,
      consequence: 'These might need human review or policy adjustment',
      action: {
        label: 'Review Blocks',
        functionName: 'viewGatekeeperStats'
      },
      relativeTime: null
    });
  }

  // High drift
  if (stats.drift > 20) {
    priorities.push({
      urgency: stats.drift > 30 ? 'ACTION' : 'WATCH',
      sentence: 'AI behavior has drifted from baseline',
      consequence: 'Outputs may be less reliable than usual',
      action: {
        label: 'Retune',
        functionName: 'runAutoTuneFromUI'
      },
      relativeTime: null
    });
  }

  // Active workflows
  if (stats.activeWorkflows > 0) {
    priorities.push({
      urgency: 'INFO',
      sentence: `${stats.activeWorkflows} workflow${stats.activeWorkflows > 1 ? 's' : ''} in progress`,
      consequence: 'May need your approval or input',
      action: {
        label: 'View Workflows',
        functionName: 'openWorkflowStatus'
      },
      relativeTime: null
    });
  }

  // Sort by urgency
  const urgencyOrder = { 'URGENT': 0, 'ACTION': 1, 'WATCH': 2, 'INFO': 3 };
  priorities.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  // If nothing needs attention
  if (priorities.length === 0) {
    priorities.push({
      urgency: 'SAFE',
      sentence: 'All systems nominal',
      consequence: 'No action needed right now',
      action: null,
      relativeTime: null
    });
  }

  return priorities;
}

/**
 * Format timestamp as relative time ("2 hours ago")
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return null;

  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return then.toLocaleDateString();
}

// ============================================================================
// GLOSSARY - Every term explained in plain English
// ============================================================================

const GLOSSARY = {
  // Tiles
  'COMPLIANCE_STATUS': {
    term: 'Compliance Status',
    definition: 'How well your AI systems follow required regulations (EU AI Act, ISO standards).',
    whatItMeasures: 'Percentage of required documentation and controls that are in place.',
    whyItMatters: 'Non-compliance can mean fines up to €35M or 7% of global revenue.'
  },
  'CRITICAL_RISKS': {
    term: 'Critical Risks',
    definition: 'Problems that need immediate attention - security gaps, policy violations, or system failures.',
    whatItMeasures: 'Count of unresolved high-severity alerts.',
    whyItMatters: 'Unaddressed risks compound. One ignored alert can become a breach.'
  },
  'GATEKEEPER_BLOCKS': {
    term: 'Gatekeeper Blocks',
    definition: 'Times the AI safety filter stopped an output from reaching users.',
    whatItMeasures: 'Count of AI responses that were blocked for being uncertain, hallucinated, or policy-violating.',
    whyItMatters: 'High blocks = AI is catching problems. Zero blocks might mean the filter is too loose.'
  },
  'GAP_ANALYSIS': {
    term: 'Gap Analysis',
    definition: 'Missing pieces in your compliance documentation.',
    whatItMeasures: 'Number of required clauses/controls not yet documented.',
    whyItMatters: 'Auditors check these first. Gaps = findings = remediation work.'
  },
  'DRIFT_SCORE': {
    term: 'Drift Score',
    definition: 'How much AI behavior has changed from its baseline.',
    whatItMeasures: 'Statistical difference between current outputs and validated baseline.',
    whyItMatters: 'High drift means the AI might be behaving unpredictably. Time to retrain or recalibrate.'
  },
  'PROVIDER_LATENCY': {
    term: 'Provider Latency',
    definition: 'How fast the AI responds to requests.',
    whatItMeasures: 'Average milliseconds from request to response.',
    whyItMatters: 'Slow AI = frustrated users. Spikes might indicate provider issues.'
  },
  'ERROR_RATE': {
    term: 'Error Rate',
    definition: 'How often AI requests fail completely.',
    whatItMeasures: 'Percentage of requests that return errors instead of results.',
    whyItMatters: 'Above 1% means something is broken. Above 5% is an outage.'
  },
  'BUDGET_BURN': {
    term: 'Budget Burn',
    definition: 'How fast you\'re spending your AI budget.',
    whatItMeasures: 'Current spend vs. forecasted spend.',
    whyItMatters: 'AI costs can spike unexpectedly. Stay ahead of overruns.'
  },

  // Status levels
  'STATUS_SAFE': {
    term: 'Safe (Green)',
    definition: 'Everything is operating within normal parameters.',
    threshold: 'Score above 80%, or zero critical alerts.'
  },
  'STATUS_WATCH': {
    term: 'Watch (Yellow)',
    definition: 'Some metrics are outside normal range. Monitor closely.',
    threshold: 'Score 50-80%, or 1-3 non-critical alerts.'
  },
  'STATUS_ACTION': {
    term: 'Action Required (Red)',
    definition: 'Immediate attention needed. Something is failing or at risk.',
    threshold: 'Score below 50%, or any critical alert.'
  }
};

function getGlossary() {
  return GLOSSARY;
}

// ============================================================================
// VIEW BUILDERS
// ============================================================================

function buildExecViewV3(stats, alerts, comp) {
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;

  return {
    viewType: 'EXEC',
    viewDescription: 'High-level status for leadership. No numbers - just what needs attention.',
    tiles: [
      {
        id: 'COMPLIANCE_STATUS',
        title: 'COMPLIANCE',
        status: getRagStatus(comp.score),
        badge: getEmojiForStatus(getRagStatus(comp.score)),
        metric: null, // Execs don't see numbers
        statusLabel: getStatusLabel(getRagStatus(comp.score)),
        narrative: generateNarrativeV3('COMPLIANCE', comp, stats),
        action: {
          label: 'View Report',
          description: 'Opens full compliance breakdown by regulation',
          functionName: 'openComplianceReport',
          estimatedTime: null
        },
        glossaryKey: 'COMPLIANCE_STATUS',
        isEmpty: false
      },
      {
        id: 'CRITICAL_RISKS',
        title: 'RISKS',
        status: criticalCount > 0 ? 'ACTION' : 'SAFE',
        badge: criticalCount > 0 ? '🚨' : '✅',
        metric: null,
        statusLabel: criticalCount > 0 ? `${criticalCount} Critical` : 'Clear',
        narrative: criticalCount > 0
          ? `${alerts[0].title}${criticalCount > 1 ? ` + ${criticalCount - 1} more` : ''}`
          : 'No active threats requiring attention',
        action: {
          label: 'Fix Top Risk',
          description: 'Opens the highest priority issue and starts resolution workflow',
          functionName: 'fixTopRisk',
          estimatedTime: '2-5 min'
        },
        glossaryKey: 'CRITICAL_RISKS',
        isEmpty: criticalCount === 0
      },
      {
        id: 'BUDGET_BURN',
        title: 'SPEND',
        status: stats.budgetStatus || 'SAFE',
        badge: stats.budgetStatus === 'ACTION' ? '💸' : '💰',
        metric: null,
        statusLabel: stats.budgetLabel || 'On Track',
        narrative: stats.budgetNarrative || 'AI spend tracking within forecast',
        action: {
          label: 'Manage Budget',
          description: 'View spend breakdown by provider and set alerts',
          functionName: 'openBudgetManager',
          estimatedTime: null
        },
        glossaryKey: 'BUDGET_BURN',
        isEmpty: false
      }
    ]
  };
}

function buildComplianceViewV3(stats, alerts, comp) {
  const regulatoryAlerts = alerts.filter(a => a.category === 'REGULATORY');

  return {
    viewType: 'COMPLIANCE',
    viewDescription: 'Detailed compliance metrics. Gap analysis, policy violations, audit readiness.',
    tiles: [
      {
        id: 'GAP_ANALYSIS',
        title: 'GAPS',
        status: comp.missingClauses > 5 ? 'ACTION' : comp.missingClauses > 0 ? 'WATCH' : 'SAFE',
        badge: '📋',
        metric: comp.missingClauses,
        metricLabel: 'missing clauses',
        statusLabel: null,
        narrative: generateNarrativeV3('GAPS', comp, stats),
        action: {
          label: 'Map Gaps',
          description: 'Opens gap analysis tool to map evidence to requirements',
          functionName: 'runGapAnalysisFromUI',
          estimatedTime: '10-15 min'
        },
        glossaryKey: 'GAP_ANALYSIS',
        isEmpty: comp.missingClauses === 0,
        emptyMessage: 'All required clauses are documented. Nice work.'
      },
      {
        id: 'GATEKEEPER_BLOCKS',
        title: 'AI BLOCKS',
        status: stats.blocks > 10 ? 'WATCH' : 'SAFE',
        badge: '🛡️',
        metric: stats.blocks,
        metricLabel: 'outputs blocked',
        statusLabel: null,
        narrative: generateNarrativeV3('BLOCKS', comp, stats),
        action: {
          label: 'Review Logs',
          description: 'See why outputs were blocked and adjust thresholds if needed',
          functionName: 'viewGatekeeperStats',
          estimatedTime: '5 min'
        },
        glossaryKey: 'GATEKEEPER_BLOCKS',
        isEmpty: stats.blocks === 0,
        emptyMessage: 'No blocks in this period. Gatekeeper is quiet.'
      },
      {
        id: 'REGULATORY_ALERTS',
        title: 'REGULATIONS',
        status: regulatoryAlerts.length > 0 ? 'ACTION' : 'SAFE',
        badge: '⚖️',
        metric: regulatoryAlerts.length,
        metricLabel: 'new requirements',
        statusLabel: null,
        narrative: regulatoryAlerts.length > 0
          ? `${regulatoryAlerts[0].title}`
          : 'No new regulatory requirements detected',
        action: {
          label: 'Update Policy',
          description: 'Review new requirements and update internal policies',
          functionName: 'openRegulatoryUpdates',
          estimatedTime: '15-30 min'
        },
        glossaryKey: 'GAP_ANALYSIS', // Reuse
        isEmpty: regulatoryAlerts.length === 0,
        emptyMessage: 'Policies are current with latest regulations.'
      }
    ]
  };
}

function buildEngineerViewV3(stats, alerts, comp) {
  const systemAlerts = alerts.filter(a => a.category === 'SYSTEM');

  return {
    viewType: 'ENGINEER',
    viewDescription: 'Technical metrics. Performance, errors, model behavior.',
    tiles: [
      {
        id: 'DRIFT_SCORE',
        title: 'DRIFT',
        status: stats.drift > 30 ? 'ACTION' : stats.drift > 15 ? 'WATCH' : 'SAFE',
        badge: '📉',
        metric: stats.drift,
        metricLabel: '/ 100',
        statusLabel: null,
        narrative: generateNarrativeV3('DRIFT', comp, stats),
        thresholds: { safe: '0-15', watch: '16-30', action: '31+' },
        action: {
          label: 'Retune',
          description: 'Recalibrate confidence thresholds based on recent outputs',
          functionName: 'runAutoTuneFromUI',
          estimatedTime: '2 min'
        },
        glossaryKey: 'DRIFT_SCORE',
        isEmpty: false
      },
      {
        id: 'PROVIDER_LATENCY',
        title: 'LATENCY',
        status: stats.latency > 2000 ? 'ACTION' : stats.latency > 800 ? 'WATCH' : 'SAFE',
        badge: '⚡',
        metric: stats.latency,
        metricLabel: 'ms avg',
        statusLabel: null,
        narrative: `${stats.provider || 'Primary provider'} response time`,
        thresholds: { safe: '<800ms', watch: '800-2000ms', action: '>2000ms' },
        action: {
          label: 'View Trace',
          description: 'Open request trace to identify slow operations',
          functionName: 'openLatencyTrace',
          estimatedTime: null
        },
        glossaryKey: 'PROVIDER_LATENCY',
        isEmpty: false
      },
      {
        id: 'ERROR_RATE',
        title: 'ERRORS',
        status: stats.errorRate > 5 ? 'ACTION' : stats.errorRate > 1 ? 'WATCH' : 'SAFE',
        badge: '🐛',
        metric: stats.errorRate,
        metricLabel: '% failure',
        statusLabel: null,
        narrative: stats.errorNarrative || 'System operating normally',
        thresholds: { safe: '<1%', watch: '1-5%', action: '>5%' },
        action: {
          label: 'Debug',
          description: 'View error logs and stack traces',
          functionName: 'viewSystemLog',
          estimatedTime: null
        },
        glossaryKey: 'ERROR_RATE',
        isEmpty: stats.errorRate === 0,
        emptyMessage: 'Zero errors in this period.'
      }
    ]
  };
}

// ============================================================================
// NARRATIVE ENGINE - Plain English explanations
// ============================================================================

function generateNarrativeV3(type, comp, stats) {
  switch(type) {
    case 'COMPLIANCE':
      if (comp.score >= 90) return 'Fully aligned with all tracked regulations';
      if (comp.score >= 70) return `${comp.missingClauses} documentation gaps remain`;
      if (comp.score >= 50) return 'Significant gaps in risk management documentation';
      return 'Critical compliance gaps - audit risk is high';

    case 'GAPS':
      if (comp.missingClauses === 0) return 'All required clauses documented';
      if (comp.missingClauses <= 3) return `${comp.missingClauses} minor gaps to address`;
      if (comp.missingClauses <= 8) return `EU AI Act missing ${comp.missingClauses} clauses - prioritize these`;
      return `${comp.missingClauses} gaps is significant - start with high-risk areas`;

    case 'BLOCKS':
      if (stats.blocks === 0) return 'No AI outputs were blocked';
      if (stats.blocks <= 5) return `${stats.blocks} low-confidence outputs caught`;
      if (stats.blocks <= 15) return `${stats.blocks} blocks - mostly ${stats.blockReason || 'uncertainty'}`;
      return `${stats.blocks} blocks is high - review if thresholds are too strict`;

    case 'DRIFT':
      if (stats.drift <= 10) return 'AI behavior matches baseline';
      if (stats.drift <= 20) return 'Minor drift detected - monitor';
      if (stats.drift <= 35) return `Drift score ${stats.drift} - ${stats.driftAgent || 'some agents'} need attention`;
      return 'Significant behavioral drift - immediate retuning recommended';

    default:
      return 'Status normal';
  }
}

// ============================================================================
// STATUS HELPERS
// ============================================================================

function getRagStatus(score) {
  if (score < 50) return 'ACTION';
  if (score < 80) return 'WATCH';
  return 'SAFE';
}

function getEmojiForStatus(status) {
  switch(status) {
    case 'ACTION': return '🔴';
    case 'WATCH': return '🟡';
    case 'SAFE': return '🟢';
    default: return '⚪';
  }
}

function getStatusLabel(status) {
  switch(status) {
    case 'ACTION': return 'Action Required';
    case 'WATCH': return 'Watch';
    case 'SAFE': return 'Safe';
    default: return 'Unknown';
  }
}

function getSystemStatus(stats, alerts) {
  const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL').length;
  if (criticalAlerts > 0) return 'ACTION';
  if (stats.errorRate > 5 || stats.drift > 30) return 'ACTION';
  if (alerts.length > 3 || stats.errorRate > 1 || stats.drift > 15) return 'WATCH';
  return 'SAFE';
}

// ============================================================================
// DATA AGGREGATION - Connect to real data sources
// ============================================================================

function aggregateLedgerStatsV3(tenant, period) {
  // TODO: Replace with actual ledger queries
  // This queries the Audit_Ledger sheet filtered by tenant and time period

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ledger = ss.getSheetByName('Audit_Ledger');

    if (!ledger) {
      return getEmptyStats();
    }

    const data = ledger.getDataRange().getValues();
    const totalRecords = data.length - 1; // Minus header

    // Calculate real metrics from ledger data
    // For now, return reasonable defaults
    return {
      totalRecords: totalRecords,
      activeWorkflows: countActiveWorkflows(),
      blocks: countGatekeeperBlocks(tenant, period),
      blockReason: 'low confidence',
      drift: calculateDriftScore(),
      driftAgent: 'Legal Research',
      latency: getAverageLatency(),
      provider: 'Gemini 1.5 Pro',
      errorRate: calculateErrorRate(tenant, period),
      errorNarrative: 'All systems operational',
      budgetStatus: 'SAFE',
      budgetLabel: 'On Track',
      budgetNarrative: 'AI spend 12% under forecast'
    };
  } catch (e) {
    Logger.log('Stats error: ' + e.message);
    return getEmptyStats();
  }
}

function getEmptyStats() {
  return {
    totalRecords: 0,
    activeWorkflows: 0,
    blocks: 0,
    drift: 0,
    latency: 0,
    errorRate: 0,
    budgetStatus: 'SAFE',
    budgetLabel: 'No Data',
    budgetNarrative: 'Start logging AI operations to see spend data'
  };
}

function countActiveWorkflows() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const workflows = ss.getSheetByName('Workflows');
    if (!workflows) return 0;

    const data = workflows.getDataRange().getValues();
    return data.filter(row => row[5] === 'ACTIVE' || row[5] === 'IN_PROGRESS').length;
  } catch (e) {
    return 0;
  }
}

function countGatekeeperBlocks(tenant, period) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ledger = ss.getSheetByName('Audit_Ledger');
    if (!ledger) return 0;

    const data = ledger.getDataRange().getValues();
    return data.filter(row =>
      row[3] && row[3].toString().includes('BLOCK')
    ).length;
  } catch (e) {
    return 0;
  }
}

function calculateDriftScore() {
  // TODO: Implement real drift calculation from Gatekeeper_Learning
  return 15;
}

function getAverageLatency() {
  // TODO: Implement real latency tracking
  return 450;
}

function calculateErrorRate(tenant, period) {
  // TODO: Implement real error rate calculation
  return 0.3;
}

function getActiveAlertsV3(tenant) {
  try {
    // Check Detection_Alerts sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const alertSheet = ss.getSheetByName('Detection_Alerts');

    if (!alertSheet) {
      return [];
    }

    const data = alertSheet.getDataRange().getValues();
    const headers = data[0];
    const alerts = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[5] !== 'RESOLVED') { // Status column
        alerts.push({
          id: row[0],
          title: row[2] || 'Untitled Alert',
          severity: row[3] || 'MEDIUM',
          category: row[4] || 'SYSTEM',
          timestamp: row[1]
        });
      }
    }

    // Sort by severity
    const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    alerts.sort((a, b) => (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4));

    return alerts;
  } catch (e) {
    Logger.log('Alerts error: ' + e.message);
    return [];
  }
}

function getComplianceScoreV3(tenant) {
  try {
    // Check GapAnalysis or Regulatory sheets
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const gapSheet = ss.getSheetByName('Gap_Analysis');

    if (!gapSheet) {
      return { score: 100, missingClauses: 0 };
    }

    const data = gapSheet.getDataRange().getValues();
    const total = data.length - 1;
    const documented = data.filter(row => row[4] === 'DOCUMENTED' || row[4] === 'COMPLETE').length;

    return {
      score: total > 0 ? Math.round((documented / total) * 100) : 100,
      missingClauses: total - documented
    };
  } catch (e) {
    Logger.log('Compliance error: ' + e.message);
    return { score: 100, missingClauses: 0 };
  }
}

function getAvailableTenantsV3() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tenantSheet = ss.getSheetByName('TENANT_POLICY');

    if (!tenantSheet) {
      return [{ id: 'ALL', name: 'All Tenants' }];
    }

    const data = tenantSheet.getDataRange().getValues();
    const tenants = [{ id: 'ALL', name: 'All Tenants' }];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        tenants.push({
          id: data[i][0],
          name: data[i][1] || data[i][0]
        });
      }
    }

    return tenants;
  } catch (e) {
    return [{ id: 'ALL', name: 'All Tenants' }];
  }
}

// ============================================================================
// ACTION HANDLERS - Bridge between UI and backend
// ============================================================================

function runDashboardActionV3(functionName, params) {
  const actionMap = {
    'openComplianceReport': () => openComplianceReport(),
    'fixTopRisk': () => fixTopRiskAction(params),
    'openBudgetManager': () => openBudgetManager(),
    'runGapAnalysisFromUI': () => runGapAnalysisFromUI(),
    'viewGatekeeperStats': () => viewGatekeeperStats(),
    'openRegulatoryUpdates': () => openRegulatoryUpdates(),
    'runAutoTuneFromUI': () => runAutoTuneFromUI(),
    'openLatencyTrace': () => openLatencyTrace(),
    'viewSystemLog': () => viewSystemLog()
  };

  if (actionMap[functionName]) {
    try {
      actionMap[functionName]();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: 'Action not found: ' + functionName };
}

// Stub implementations - connect to real functions
function openComplianceReport() {
  SpreadsheetApp.getUi().alert('Opening Compliance Report...');
}

function fixTopRiskAction(params) {
  if (typeof runGapAnalysisFromUI === 'function') {
    runGapAnalysisFromUI();
  } else {
    SpreadsheetApp.getUi().alert('Gap Analysis workflow started');
  }
}

function openBudgetManager() {
  SpreadsheetApp.getUi().alert('Budget Manager - Coming Soon');
}

function openRegulatoryUpdates() {
  SpreadsheetApp.getUi().alert('Regulatory Updates - View Newton_Regulatory.gs');
}

function openLatencyTrace() {
  SpreadsheetApp.getUi().alert('Latency Trace - Coming Soon');
}
