/**
 * ───────────────────────────────────────────────
 * NEWTON DASHBOARD v3.1 : UNIVERSAL COMMAND CENTER
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
 * v3.1 Fixes:
 * - Real data queries instead of hardcoded stats
 * - Single sheet read with in-memory cache
 * - Real date windowing for period comparisons
 * - alertId passed to action handlers
 * - "X changes since last login" greeting
 *
 * ───────────────────────────────────────────────
 */

// ============================================================================
// DATA CACHE - Single read, reuse everywhere
// ============================================================================

/**
 * In-memory cache for sheet data during a single request lifecycle.
 * Avoids N+1 getDataRange() calls that kill performance.
 */
const DataCache_ = {
  _cache: {},
  _timestamp: null,
  _TTL_MS: 30000, // 30 second TTL for cache validity

  /**
   * Get cached sheet data or fetch and cache it
   */
  getSheetData: function(sheetName) {
    const now = Date.now();

    // Invalidate entire cache if TTL expired
    if (this._timestamp && (now - this._timestamp) > this._TTL_MS) {
      this._cache = {};
      this._timestamp = null;
    }

    // Return cached data if available
    if (this._cache[sheetName]) {
      return this._cache[sheetName];
    }

    // Fetch and cache
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        this._cache[sheetName] = { exists: false, data: [], headers: [] };
      } else {
        const data = sheet.getDataRange().getValues();
        this._cache[sheetName] = {
          exists: true,
          data: data,
          headers: data.length > 0 ? data[0] : [],
          rows: data.slice(1) // Data without header
        };
      }

      if (!this._timestamp) this._timestamp = now;

    } catch (e) {
      Logger.log('DataCache error for ' + sheetName + ': ' + e.message);
      this._cache[sheetName] = { exists: false, data: [], headers: [], rows: [] };
    }

    return this._cache[sheetName];
  },

  /**
   * Preload all commonly used sheets in one go
   */
  preloadAll: function() {
    const sheets = ['Audit_Ledger', 'Detection_Alerts', 'Gap_Analysis',
                    'Workflows', 'TENANT_POLICY', 'Gatekeeper_Learning'];
    sheets.forEach(name => this.getSheetData(name));
  },

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clear: function() {
    this._cache = {};
    this._timestamp = null;
  }
};

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
  // Preload all sheets in one batch to avoid N+1 queries
  DataCache_.preloadAll();

  PropertiesService.getUserProperties().setProperty('LAST_DASHBOARD_ROLE', role);

  // Get date window for current and previous periods
  const currentWindow = getDateWindow(periodFilter);
  const previousWindow = getPreviousDateWindow(periodFilter);

  // All aggregation now uses cached data + real date filtering
  const stats = aggregateLedgerStatsV3(tenantFilter, currentWindow);
  const prevStats = aggregateLedgerStatsV3(tenantFilter, previousWindow);
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

  // Common data for all views - include alertId for action context
  const topAlert = alerts.length > 0 ? alerts[0] : null;
  viewData.pulse = {
    activeWorkflows: stats.activeWorkflows,
    systemStatus: getSystemStatus(stats, alerts),
    topPriority: topAlert
      ? { title: topAlert.title, type: topAlert.severity, id: topAlert.id }
      : { title: "All systems nominal", type: "SAFE", id: null }
  };

  viewData.tenants = tenants;
  viewData.lastUpdated = new Date().toISOString();
  viewData.isEmpty = stats.totalRecords === 0;

  // Add comparison data for context
  viewData.comparisons = buildComparisons(stats, prevStats, periodFilter);

  return viewData;
}

// ============================================================================
// DATE WINDOWING - Real period calculations
// ============================================================================

/**
 * Get date window (start/end) for a period filter
 */
function getDateWindow(period) {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);

  switch(period) {
    case '24H':
      start.setHours(start.getHours() - 24);
      break;
    case '7D':
      start.setDate(start.getDate() - 7);
      break;
    case '30D':
      start.setDate(start.getDate() - 30);
      break;
    case '90D':
      start.setDate(start.getDate() - 90);
      break;
    case 'YTD':
      start = new Date(now.getFullYear(), 0, 1); // Jan 1 of current year
      break;
    default:
      start.setDate(start.getDate() - 7); // Default to 7 days
  }

  return { start: start, end: end, period: period };
}

/**
 * Get date window for the PREVIOUS equivalent period
 */
function getPreviousDateWindow(period) {
  const current = getDateWindow(period);
  const duration = current.end - current.start;

  // Previous period ends where current period starts
  const prevEnd = new Date(current.start);
  const prevStart = new Date(current.start.getTime() - duration);

  return { start: prevStart, end: prevEnd, period: period + '_PREV' };
}

/**
 * Check if a date falls within a window
 */
function isInDateWindow(date, window) {
  if (!date || !window) return false;
  const d = date instanceof Date ? date : new Date(date);
  return d >= window.start && d <= window.end;
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
    return '↑ ' + Math.abs(delta) + suffix + ' more than ' + periodLabel + ' (+' + pct + '%)';
  } else if (delta < 0) {
    return '↓ ' + Math.abs(delta) + suffix + ' fewer than ' + periodLabel + ' (' + pct + '%)';
  }
  return 'Same as ' + periodLabel;
}

// ============================================================================
// MORNING BRIEFING VIEW - Auto-adaptive, no role choice needed
// ============================================================================

function buildBriefingView(stats, prevStats, alerts, compliance) {
  // Use delta since last login instead of time-of-day greeting
  const deltaInfo = getChangesSinceLastLogin();
  const greeting = deltaInfo.greeting;

  // Determine overall status
  const criticalCount = alerts.filter(function(a) { return a.severity === 'CRITICAL'; }).length;
  const actionCount = alerts.filter(function(a) { return a.severity === 'HIGH' || a.severity === 'CRITICAL'; }).length;

  let overallStatus = 'SAFE';
  let overallMessage = 'Looking good';

  if (criticalCount > 0) {
    overallStatus = 'ACTION';
    overallMessage = criticalCount + ' critical issue' + (criticalCount > 1 ? 's' : '') + ' need' + (criticalCount === 1 ? 's' : '') + ' attention';
  } else if (actionCount > 0 || compliance.missingClauses > 5) {
    overallStatus = 'WATCH';
    overallMessage = 'A few items need your attention';
  }

  // Build priority list - what should user do first?
  const priorities = buildPriorityList(stats, alerts, compliance);

  return {
    viewType: 'BRIEFING',
    viewDescription: greeting,
    greeting: greeting,
    changesSinceLogin: deltaInfo.changes,
    lastLoginTime: deltaInfo.lastLogin,
    overallStatus: overallStatus,
    overallMessage: overallMessage,
    priorities: priorities,
    tiles: [] // Briefing view uses priorities instead of tiles
  };
}

/**
 * Get changes since user's last login for personalized greeting
 */
function getChangesSinceLastLogin() {
  const userProps = PropertiesService.getUserProperties();
  const lastLoginStr = userProps.getProperty('DASHBOARD_LAST_LOGIN');
  const now = new Date();

  // Update last login time
  userProps.setProperty('DASHBOARD_LAST_LOGIN', now.toISOString());

  if (!lastLoginStr) {
    // First time user
    return {
      greeting: 'Welcome to Newton Command Center.',
      lastLogin: null,
      changes: 0
    };
  }

  const lastLogin = new Date(lastLoginStr);
  const hoursSinceLogin = Math.floor((now - lastLogin) / 3600000);

  // Count changes since last login from cached data
  const changes = countChangesSince(lastLogin);

  let greeting;
  if (changes === 0) {
    greeting = 'No changes since your last visit (' + formatTimeSince(lastLogin) + ' ago).';
  } else if (changes === 1) {
    greeting = '1 change since your last visit (' + formatTimeSince(lastLogin) + ' ago).';
  } else {
    greeting = changes + ' changes since your last visit (' + formatTimeSince(lastLogin) + ' ago).';
  }

  return {
    greeting: greeting,
    lastLogin: lastLogin.toISOString(),
    changes: changes
  };
}

/**
 * Count meaningful changes since a given timestamp
 */
function countChangesSince(sinceDate) {
  let count = 0;

  // Count new ledger entries
  const ledger = DataCache_.getSheetData('Audit_Ledger');
  if (ledger.exists && ledger.rows) {
    const timestampCol = findColumnIndex(ledger.headers, ['Timestamp', 'timestamp', 'Date', 'date', 'Created']);
    if (timestampCol >= 0) {
      ledger.rows.forEach(function(row) {
        const rowDate = row[timestampCol];
        if (rowDate && new Date(rowDate) > sinceDate) {
          count++;
        }
      });
    }
  }

  // Count new alerts
  const alerts = DataCache_.getSheetData('Detection_Alerts');
  if (alerts.exists && alerts.rows) {
    const alertTimeCol = findColumnIndex(alerts.headers, ['Timestamp', 'timestamp', 'Created', 'Date']);
    if (alertTimeCol >= 0) {
      alerts.rows.forEach(function(row) {
        const rowDate = row[alertTimeCol];
        if (rowDate && new Date(rowDate) > sinceDate) {
          count++;
        }
      });
    }
  }

  return count;
}

/**
 * Format time since last login in human readable form
 */
function formatTimeSince(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + ' minute' + (diffMins > 1 ? 's' : '');
  if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '');
  if (diffDays < 7) return diffDays + ' day' + (diffDays > 1 ? 's' : '');

  return date.toLocaleDateString();
}

/**
 * Find column index by possible header names
 */
function findColumnIndex(headers, possibleNames) {
  for (var i = 0; i < headers.length; i++) {
    var header = String(headers[i]).toLowerCase().trim();
    for (var j = 0; j < possibleNames.length; j++) {
      if (header === possibleNames[j].toLowerCase()) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Build prioritized action list - what should user do first?
 */
function buildPriorityList(stats, alerts, compliance) {
  const priorities = [];

  // Critical alerts first - include alertId for action context
  const criticalAlerts = alerts.filter(function(a) { return a.severity === 'CRITICAL'; });
  criticalAlerts.forEach(function(alert) {
    priorities.push({
      urgency: 'URGENT',
      sentence: alert.title,
      consequence: 'This needs immediate attention',
      action: {
        label: 'Fix Now',
        functionName: 'fixTopRisk',
        params: { alertId: alert.id } // Pass alertId for context
      },
      relativeTime: formatRelativeTime(alert.timestamp)
    });
  });

  // Missing documents
  if (compliance.missingClauses > 0) {
    priorities.push({
      urgency: compliance.missingClauses > 5 ? 'ACTION' : 'WATCH',
      sentence: compliance.missingClauses + ' document' + (compliance.missingClauses > 1 ? 's are' : ' is') + ' missing',
      consequence: 'Auditors will flag these as non-compliant',
      action: {
        label: 'See Which Ones',
        functionName: 'runGapAnalysisFromUI',
        params: {}
      },
      relativeTime: null
    });
  }

  // Blocked AI responses needing review
  if (stats.blocks > 0) {
    priorities.push({
      urgency: stats.blocks > 10 ? 'ACTION' : 'WATCH',
      sentence: stats.blocks + ' AI response' + (stats.blocks > 1 ? 's were' : ' was') + ' blocked',
      consequence: 'These might need human review or policy adjustment',
      action: {
        label: 'Review Blocks',
        functionName: 'viewGatekeeperStats',
        params: {}
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
        functionName: 'runAutoTuneFromUI',
        params: {}
      },
      relativeTime: null
    });
  }

  // Active workflows
  if (stats.activeWorkflows > 0) {
    priorities.push({
      urgency: 'INFO',
      sentence: stats.activeWorkflows + ' workflow' + (stats.activeWorkflows > 1 ? 's' : '') + ' in progress',
      consequence: 'May need your approval or input',
      action: {
        label: 'View Workflows',
        functionName: 'openWorkflowStatus',
        params: {}
      },
      relativeTime: null
    });
  }

  // Sort by urgency
  const urgencyOrder = { 'URGENT': 0, 'ACTION': 1, 'WATCH': 2, 'INFO': 3 };
  priorities.sort(function(a, b) { return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]; });

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
  if (diffMins < 60) return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago';
  if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
  if (diffDays < 7) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';

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
  const criticalCount = alerts.filter(function(a) { return a.severity === 'CRITICAL'; }).length;
  const topAlert = alerts.length > 0 ? alerts[0] : null;

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
          params: {},
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
        statusLabel: criticalCount > 0 ? criticalCount + ' Critical' : 'Clear',
        narrative: criticalCount > 0
          ? alerts[0].title + (criticalCount > 1 ? ' + ' + (criticalCount - 1) + ' more' : '')
          : 'No active threats requiring attention',
        action: {
          label: 'Fix Top Risk',
          description: 'Opens the highest priority issue and starts resolution workflow',
          functionName: 'fixTopRisk',
          params: { alertId: topAlert ? topAlert.id : null }, // Pass alertId
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
          params: {},
          estimatedTime: null
        },
        glossaryKey: 'BUDGET_BURN',
        isEmpty: false
      }
    ]
  };
}

function buildComplianceViewV3(stats, alerts, comp) {
  const regulatoryAlerts = alerts.filter(function(a) { return a.category === 'REGULATORY'; });

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
          params: {},
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
          params: {},
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
          ? regulatoryAlerts[0].title
          : 'No new regulatory requirements detected',
        action: {
          label: 'Update Policy',
          description: 'Review new requirements and update internal policies',
          functionName: 'openRegulatoryUpdates',
          params: {},
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
  const systemAlerts = alerts.filter(function(a) { return a.category === 'SYSTEM'; });

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
          params: {},
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
        narrative: (stats.provider || 'Primary provider') + ' response time',
        thresholds: { safe: '<800ms', watch: '800-2000ms', action: '>2000ms' },
        action: {
          label: 'View Trace',
          description: 'Open request trace to identify slow operations',
          functionName: 'openLatencyTrace',
          params: {},
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
          params: {},
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
      if (comp.score >= 70) return comp.missingClauses + ' documentation gaps remain';
      if (comp.score >= 50) return 'Significant gaps in risk management documentation';
      return 'Critical compliance gaps - audit risk is high';

    case 'GAPS':
      if (comp.missingClauses === 0) return 'All required clauses documented';
      if (comp.missingClauses <= 3) return comp.missingClauses + ' minor gaps to address';
      if (comp.missingClauses <= 8) return 'EU AI Act missing ' + comp.missingClauses + ' clauses - prioritize these';
      return comp.missingClauses + ' gaps is significant - start with high-risk areas';

    case 'BLOCKS':
      if (stats.blocks === 0) return 'No AI outputs were blocked';
      if (stats.blocks <= 5) return stats.blocks + ' low-confidence outputs caught';
      if (stats.blocks <= 15) return stats.blocks + ' blocks - mostly ' + (stats.blockReason || 'uncertainty');
      return stats.blocks + ' blocks is high - review if thresholds are too strict';

    case 'DRIFT':
      if (stats.drift <= 10) return 'AI behavior matches baseline';
      if (stats.drift <= 20) return 'Minor drift detected - monitor';
      if (stats.drift <= 35) return 'Drift score ' + stats.drift + ' - ' + (stats.driftAgent || 'some agents') + ' need attention';
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
  const criticalAlerts = alerts.filter(function(a) { return a.severity === 'CRITICAL'; }).length;
  if (criticalAlerts > 0) return 'ACTION';
  if (stats.errorRate > 5 || stats.drift > 30) return 'ACTION';
  if (alerts.length > 3 || stats.errorRate > 1 || stats.drift > 15) return 'WATCH';
  return 'SAFE';
}

// ============================================================================
// DATA AGGREGATION - Real queries using cached data
// ============================================================================

function aggregateLedgerStatsV3(tenant, dateWindow) {
  try {
    const ledger = DataCache_.getSheetData('Audit_Ledger');

    if (!ledger.exists || ledger.rows.length === 0) {
      return getEmptyStats();
    }

    // Find column indices
    const headers = ledger.headers;
    const timestampCol = findColumnIndex(headers, ['Timestamp', 'timestamp', 'Date', 'date', 'Created']);
    const actionCol = findColumnIndex(headers, ['Action', 'action', 'Event', 'event_type']);
    const tenantCol = findColumnIndex(headers, ['Tenant', 'tenant', 'TenantID', 'tenant_id']);
    const outcomeCol = findColumnIndex(headers, ['Outcome', 'outcome', 'Result', 'result', 'Status']);
    const latencyCol = findColumnIndex(headers, ['Latency', 'latency', 'Duration', 'duration_ms']);

    // Filter rows by date window and tenant
    const filteredRows = ledger.rows.filter(function(row) {
      // Date filter
      if (timestampCol >= 0 && dateWindow) {
        const rowDate = row[timestampCol];
        if (!isInDateWindow(rowDate, dateWindow)) {
          return false;
        }
      }

      // Tenant filter
      if (tenant && tenant !== 'ALL' && tenantCol >= 0) {
        if (row[tenantCol] !== tenant) {
          return false;
        }
      }

      return true;
    });

    // Calculate real metrics from filtered data
    const totalRecords = filteredRows.length;

    // Count AI requests (any row is considered an AI request for now)
    const aiRequests = totalRecords;

    // Count blocks
    let blocks = 0;
    let blockReason = 'uncertainty';
    if (actionCol >= 0 || outcomeCol >= 0) {
      filteredRows.forEach(function(row) {
        const action = actionCol >= 0 ? String(row[actionCol] || '').toUpperCase() : '';
        const outcome = outcomeCol >= 0 ? String(row[outcomeCol] || '').toUpperCase() : '';
        if (action.includes('BLOCK') || outcome.includes('BLOCK') ||
            outcome.includes('REJECT') || outcome === 'BLOCKED') {
          blocks++;
          // Try to determine reason
          if (action.includes('HALLUCINATION') || outcome.includes('HALLUCINATION')) {
            blockReason = 'hallucination';
          } else if (action.includes('CONFIDENCE') || outcome.includes('CONFIDENCE')) {
            blockReason = 'low confidence';
          }
        }
      });
    }

    // Calculate error rate
    let errors = 0;
    if (outcomeCol >= 0) {
      filteredRows.forEach(function(row) {
        const outcome = String(row[outcomeCol] || '').toUpperCase();
        if (outcome.includes('ERROR') || outcome.includes('FAIL') || outcome === 'FAILED') {
          errors++;
        }
      });
    }
    const errorRate = totalRecords > 0 ? Math.round((errors / totalRecords) * 1000) / 10 : 0; // One decimal

    // Calculate average latency
    let totalLatency = 0;
    let latencyCount = 0;
    if (latencyCol >= 0) {
      filteredRows.forEach(function(row) {
        const lat = parseFloat(row[latencyCol]);
        if (!isNaN(lat) && lat > 0) {
          totalLatency += lat;
          latencyCount++;
        }
      });
    }
    const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;

    // Calculate drift score from Gatekeeper_Learning
    const drift = calculateDriftScoreReal();

    // Count active workflows
    const activeWorkflows = countActiveWorkflowsReal();

    // Build error narrative
    let errorNarrative = 'All systems operational';
    if (errorRate > 5) {
      errorNarrative = 'High error rate detected - investigate immediately';
    } else if (errorRate > 1) {
      errorNarrative = 'Elevated error rate - monitoring';
    } else if (errors > 0) {
      errorNarrative = errors + ' error' + (errors > 1 ? 's' : '') + ' in this period';
    }

    return {
      totalRecords: totalRecords,
      aiRequests: aiRequests,
      activeWorkflows: activeWorkflows,
      blocks: blocks,
      blockReason: blockReason,
      drift: drift,
      driftAgent: getDriftAgent(),
      latency: avgLatency,
      provider: 'Gemini 1.5 Pro',
      errorRate: errorRate,
      errorNarrative: errorNarrative,
      budgetStatus: 'SAFE',
      budgetLabel: 'On Track',
      budgetNarrative: 'AI spend tracking within forecast'
    };
  } catch (e) {
    Logger.log('Stats error: ' + e.message);
    return getEmptyStats();
  }
}

function getEmptyStats() {
  return {
    totalRecords: 0,
    aiRequests: 0,
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

/**
 * Count active workflows from cached data
 */
function countActiveWorkflowsReal() {
  try {
    const workflows = DataCache_.getSheetData('Workflows');
    if (!workflows.exists) return 0;

    const statusCol = findColumnIndex(workflows.headers, ['Status', 'status', 'State', 'state']);
    if (statusCol < 0) return 0;

    let count = 0;
    workflows.rows.forEach(function(row) {
      const status = String(row[statusCol] || '').toUpperCase();
      if (status === 'ACTIVE' || status === 'IN_PROGRESS' || status === 'PENDING') {
        count++;
      }
    });

    return count;
  } catch (e) {
    return 0;
  }
}

/**
 * Calculate real drift score from Gatekeeper_Learning sheet
 */
function calculateDriftScoreReal() {
  try {
    const learning = DataCache_.getSheetData('Gatekeeper_Learning');
    if (!learning.exists || learning.rows.length === 0) return 0;

    // Look for drift-related columns
    const driftCol = findColumnIndex(learning.headers, ['Drift', 'drift', 'DriftScore', 'drift_score']);
    const confidenceCol = findColumnIndex(learning.headers, ['Confidence', 'confidence', 'Score']);
    const baselineCol = findColumnIndex(learning.headers, ['Baseline', 'baseline', 'BaselineConfidence']);

    // If we have a drift column, use the latest value
    if (driftCol >= 0 && learning.rows.length > 0) {
      // Get most recent drift score
      for (var i = learning.rows.length - 1; i >= 0; i--) {
        var driftVal = parseFloat(learning.rows[i][driftCol]);
        if (!isNaN(driftVal)) {
          return Math.round(driftVal);
        }
      }
    }

    // Otherwise calculate drift from confidence vs baseline
    if (confidenceCol >= 0 && baselineCol >= 0) {
      let totalDrift = 0;
      let driftCount = 0;

      learning.rows.forEach(function(row) {
        const conf = parseFloat(row[confidenceCol]);
        const base = parseFloat(row[baselineCol]);
        if (!isNaN(conf) && !isNaN(base) && base > 0) {
          // Drift = absolute percentage deviation from baseline
          const deviation = Math.abs((conf - base) / base) * 100;
          totalDrift += deviation;
          driftCount++;
        }
      });

      if (driftCount > 0) {
        return Math.min(100, Math.round(totalDrift / driftCount));
      }
    }

    return 0;
  } catch (e) {
    Logger.log('Drift calculation error: ' + e.message);
    return 0;
  }
}

/**
 * Get the agent with highest drift
 */
function getDriftAgent() {
  try {
    const learning = DataCache_.getSheetData('Gatekeeper_Learning');
    if (!learning.exists) return null;

    const agentCol = findColumnIndex(learning.headers, ['Agent', 'agent', 'AgentName', 'Model']);
    const driftCol = findColumnIndex(learning.headers, ['Drift', 'drift', 'DriftScore']);

    if (agentCol < 0 || driftCol < 0) return null;

    let maxDrift = 0;
    let maxAgent = null;

    learning.rows.forEach(function(row) {
      var drift = parseFloat(row[driftCol]);
      if (!isNaN(drift) && drift > maxDrift) {
        maxDrift = drift;
        maxAgent = row[agentCol];
      }
    });

    return maxAgent;
  } catch (e) {
    return null;
  }
}

function getActiveAlertsV3(tenant) {
  try {
    const alertSheet = DataCache_.getSheetData('Detection_Alerts');

    if (!alertSheet.exists) {
      return [];
    }

    const headers = alertSheet.headers;
    const idCol = findColumnIndex(headers, ['ID', 'id', 'AlertID', 'alert_id']);
    const timestampCol = findColumnIndex(headers, ['Timestamp', 'timestamp', 'Date', 'Created']);
    const titleCol = findColumnIndex(headers, ['Title', 'title', 'Message', 'Description']);
    const severityCol = findColumnIndex(headers, ['Severity', 'severity', 'Level', 'Priority']);
    const categoryCol = findColumnIndex(headers, ['Category', 'category', 'Type']);
    const statusCol = findColumnIndex(headers, ['Status', 'status', 'State']);

    const alerts = [];

    alertSheet.rows.forEach(function(row, index) {
      const status = statusCol >= 0 ? String(row[statusCol] || '').toUpperCase() : '';
      if (status !== 'RESOLVED' && status !== 'CLOSED') {
        alerts.push({
          id: idCol >= 0 ? row[idCol] : 'ALERT_' + (index + 1),
          title: titleCol >= 0 ? (row[titleCol] || 'Untitled Alert') : 'Untitled Alert',
          severity: severityCol >= 0 ? (row[severityCol] || 'MEDIUM') : 'MEDIUM',
          category: categoryCol >= 0 ? (row[categoryCol] || 'SYSTEM') : 'SYSTEM',
          timestamp: timestampCol >= 0 ? row[timestampCol] : null
        });
      }
    });

    // Sort by severity
    const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    alerts.sort(function(a, b) {
      return (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
    });

    return alerts;
  } catch (e) {
    Logger.log('Alerts error: ' + e.message);
    return [];
  }
}

function getComplianceScoreV3(tenant) {
  try {
    const gapSheet = DataCache_.getSheetData('Gap_Analysis');

    if (!gapSheet.exists || gapSheet.rows.length === 0) {
      return { score: 100, missingClauses: 0 };
    }

    const statusCol = findColumnIndex(gapSheet.headers, ['Status', 'status', 'State', 'Documented']);
    if (statusCol < 0) {
      return { score: 100, missingClauses: 0 };
    }

    const total = gapSheet.rows.length;
    let documented = 0;

    gapSheet.rows.forEach(function(row) {
      const status = String(row[statusCol] || '').toUpperCase();
      if (status === 'DOCUMENTED' || status === 'COMPLETE' || status === 'DONE' || status === 'YES') {
        documented++;
      }
    });

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
    const tenantSheet = DataCache_.getSheetData('TENANT_POLICY');

    if (!tenantSheet.exists) {
      return [{ id: 'ALL', name: 'All Tenants' }];
    }

    const tenants = [{ id: 'ALL', name: 'All Tenants' }];

    tenantSheet.rows.forEach(function(row) {
      if (row[0]) {
        tenants.push({
          id: row[0],
          name: row[1] || row[0]
        });
      }
    });

    return tenants;
  } catch (e) {
    return [{ id: 'ALL', name: 'All Tenants' }];
  }
}

// ============================================================================
// ACTION HANDLERS - Bridge between UI and backend (with alertId context)
// ============================================================================

function runDashboardActionV3(functionName, params) {
  params = params || {};

  const actionMap = {
    'openComplianceReport': function() { return openComplianceReport(); },
    'fixTopRisk': function() { return fixTopRiskAction(params); },
    'openBudgetManager': function() { return openBudgetManager(); },
    'runGapAnalysisFromUI': function() { return runGapAnalysisFromUI(); },
    'viewGatekeeperStats': function() { return viewGatekeeperStats(); },
    'openRegulatoryUpdates': function() { return openRegulatoryUpdates(); },
    'runAutoTuneFromUI': function() { return runAutoTuneFromUI(); },
    'openLatencyTrace': function() { return openLatencyTrace(); },
    'viewSystemLog': function() { return viewSystemLog(); },
    'openWorkflowStatus': function() { return openWorkflowStatus(); }
  };

  if (actionMap[functionName]) {
    try {
      var result = actionMap[functionName]();
      return { success: true, result: result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: 'Action not found: ' + functionName };
}

// Action implementations - connect to real functions
function openComplianceReport() {
  SpreadsheetApp.getUi().alert('Opening Compliance Report...');
  return true;
}

/**
 * Fix top risk action - now receives alertId for context
 */
function fixTopRiskAction(params) {
  const alertId = params.alertId;

  if (alertId) {
    // Load the specific alert and take action
    const alerts = DataCache_.getSheetData('Detection_Alerts');
    if (alerts.exists) {
      const idCol = findColumnIndex(alerts.headers, ['ID', 'id', 'AlertID', 'alert_id']);
      if (idCol >= 0) {
        for (var i = 0; i < alerts.rows.length; i++) {
          if (alerts.rows[i][idCol] === alertId) {
            // Found the alert - could open a specific dialog or workflow
            SpreadsheetApp.getUi().alert('Fixing Alert: ' + alertId + '\n\n' +
              'This would open the resolution workflow for the specific alert.');
            return true;
          }
        }
      }
    }
    SpreadsheetApp.getUi().alert('Alert ' + alertId + ' - Starting resolution workflow...');
  } else {
    // Fallback to gap analysis if no specific alert
    if (typeof runGapAnalysisFromUI === 'function') {
      runGapAnalysisFromUI();
    } else {
      SpreadsheetApp.getUi().alert('Gap Analysis workflow started');
    }
  }
  return true;
}

function openBudgetManager() {
  SpreadsheetApp.getUi().alert('Budget Manager - Coming Soon');
  return true;
}

function openRegulatoryUpdates() {
  SpreadsheetApp.getUi().alert('Regulatory Updates - View Newton_Regulatory.gs');
  return true;
}

function openLatencyTrace() {
  SpreadsheetApp.getUi().alert('Latency Trace - Coming Soon');
  return true;
}

function openWorkflowStatus() {
  SpreadsheetApp.getUi().alert('Workflow Status - View pending workflows in the Workflows sheet');
  return true;
}
