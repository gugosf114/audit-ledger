/**
 * ───────────────────────────────────────────────
 *  NEWTON AGENT AUDIT LOGGER
 * ───────────────────────────────────────────────
 *
 *  Comprehensive audit logging for AI agent actions.
 *  Every action, decision, and resource access is:
 *  - Logged to the tamper-evident ledger
 *  - Auto-tagged with regulatory references
 *  - Hashed for integrity verification
 *
 *  Supports session-based logging with:
 *  - session.log() - log any action
 *  - session.access() - log data/API access
 *  - session.decide() - log decisions with reasoning
 *  - session.end() - close session with summary
 *
 *  Compliant with:
 *  - EU AI Act Article 12 (Record-keeping)
 *  - EU AI Act Article 20 (Automatically generated logs)
 *  - ISO 42001 Clause 7.5 (Documented information)
 *  - NIST AI RMF MEASURE-3 (Tracking identified risks)
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const AGENT_LOGGER_CONFIG = {
  // Action types for classification
  ACTION_TYPES: {
    SEARCH: 'SEARCH',
    READ: 'READ',
    WRITE: 'WRITE',
    API_CALL: 'API_CALL',
    DECISION: 'DECISION',
    INFERENCE: 'INFERENCE',
    DATA_ACCESS: 'DATA_ACCESS',
    TRANSFORMATION: 'TRANSFORMATION',
    COMMUNICATION: 'COMMUNICATION',
    ESCALATION: 'ESCALATION',
    ERROR: 'ERROR',
    SESSION_START: 'SESSION_START',
    SESSION_END: 'SESSION_END'
  },

  // Permission levels for resource access
  PERMISSIONS: {
    READ: 'READ',
    WRITE: 'WRITE',
    DELETE: 'DELETE',
    EXECUTE: 'EXECUTE',
    ADMIN: 'ADMIN'
  },

  // Regulatory mappings for agent actions
  REGULATORY_MAPPINGS: {
    // Actions that trigger specific regulatory tags
    DATA_ACCESS: ['EU_AI_ACT:Art.10', 'EU_AI_ACT:Art.12', 'ISO_42001:7.5', 'NIST_AI_RMF:GOVERN-1'],
    DECISION: ['EU_AI_ACT:Art.13', 'EU_AI_ACT:Art.14', 'ISO_42001:8.1', 'NIST_AI_RMF:MANAGE-1'],
    INFERENCE: ['EU_AI_ACT:Art.13', 'EU_AI_ACT:Art.15', 'ISO_42001:9.1', 'NIST_AI_RMF:MEASURE-2'],
    ERROR: ['EU_AI_ACT:Art.72', 'ISO_42001:10.2', 'NIST_AI_RMF:MANAGE-2'],
    ESCALATION: ['EU_AI_ACT:Art.14', 'EU_AI_ACT:Art.72', 'ISO_42001:10.2', 'NIST_AI_RMF:GOVERN-2'],
    API_CALL: ['EU_AI_ACT:Art.12', 'ISO_42001:8.1', 'NIST_AI_RMF:GOVERN-6'],
    SEARCH: ['EU_AI_ACT:Art.12', 'ISO_42001:7.5'],
    READ: ['EU_AI_ACT:Art.12', 'ISO_42001:7.5'],
    WRITE: ['EU_AI_ACT:Art.12', 'ISO_42001:7.5'],
    SESSION_START: ['EU_AI_ACT:Art.12', 'EU_AI_ACT:Art.20'],
    SESSION_END: ['EU_AI_ACT:Art.12', 'EU_AI_ACT:Art.20']
  }
};


// ==========================
// CORE LOGGING FUNCTION
// ==========================

/**
 * Log an AI agent action to the audit ledger
 *
 * @param {string} agentName - Name/identifier of the AI agent
 * @param {string} actionType - Type of action (see ACTION_TYPES)
 * @param {Object} inputs - Input data/parameters for the action
 * @param {Object} outputs - Output/result of the action
 * @param {Array} resourcesAccessed - List of resources accessed
 * @param {string} decision - Decision made (if applicable)
 * @param {string} reasoning - Explanation/reasoning for the action
 * @returns {Object} - Result with UUID and hash
 */
function logAgentAction(agentName, actionType, inputs, outputs, resourcesAccessed, decision, reasoning) {
  const timestamp = new Date().toISOString();
  const actionId = Utilities.getUuid();

  // Build the complete action record
  const actionRecord = {
    actionId: actionId,
    timestamp: timestamp,
    agent: {
      name: agentName,
      type: 'AI_AGENT'
    },
    action: {
      type: actionType,
      inputs: sanitizeForLog(inputs),
      outputs: sanitizeForLog(outputs),
      resourcesAccessed: resourcesAccessed || []
    },
    decision: {
      made: decision || null,
      reasoning: reasoning || null
    },
    metadata: {
      loggedBy: 'Newton_AgentLogger',
      version: '1.0'
    }
  };

  // Hash the complete action record
  const recordString = JSON.stringify(actionRecord);
  const actionHash = hashRecord(recordString);
  actionRecord.metadata.actionHash = actionHash;

  // Determine regulatory tags based on action type
  const regulatoryTags = determineRegulatoryTags(actionType, resourcesAccessed, decision);

  // Build ledger entry text
  const entryText = formatActionForLedger(actionRecord);

  // Write to ledger
  try {
    const ledgerResult = safeNewEntry(
      'System',
      `AGENT_${actionType}`,
      entryText,
      '',
      'VERIFIED'
    );

    // Apply regulatory tags
    if (ledgerResult.uuid && regulatoryTags.length > 0) {
      tagEntry(ledgerResult.uuid, regulatoryTags);
    }

    logSystemEvent('INFO', 'AGENT_LOGGER', 'Agent action logged', {
      agentName: agentName,
      actionType: actionType,
      actionId: actionId,
      ledgerUuid: ledgerResult.uuid
    });

    return {
      success: true,
      actionId: actionId,
      ledgerUuid: ledgerResult.uuid,
      actionHash: actionHash,
      timestamp: timestamp,
      regulatoryTags: regulatoryTags
    };

  } catch (e) {
    logSystemEvent('ERROR', 'AGENT_LOGGER', 'Failed to log agent action', {
      agentName: agentName,
      actionType: actionType,
      error: e.message
    });

    return {
      success: false,
      actionId: actionId,
      error: e.message
    };
  }
}

/**
 * Sanitize objects for logging (remove sensitive data, truncate large values)
 */
function sanitizeForLog(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return String(obj).substring(0, 1000);

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip sensitive keys
    if (/password|secret|key|token|credential/i.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Truncate large values
    if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 1000) + '...[truncated]';
    } else if (Array.isArray(value)) {
      sanitized[key] = value.slice(0, 10).map(v => sanitizeForLog(v));
      if (value.length > 10) sanitized[key].push(`...[${value.length - 10} more]`);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeForLog(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Hash a record string for integrity
 */
function hashRecord(recordString) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, recordString)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}

/**
 * Determine regulatory tags based on action type and context
 */
function determineRegulatoryTags(actionType, resourcesAccessed, decision) {
  const tags = new Set();

  // Base tags for action type
  const baseTags = AGENT_LOGGER_CONFIG.REGULATORY_MAPPINGS[actionType] || [];
  baseTags.forEach(t => tags.add(t));

  // Add tags based on resources accessed
  if (resourcesAccessed && resourcesAccessed.length > 0) {
    // Data access triggers data governance tags
    tags.add('EU_AI_ACT:Art.10');
    tags.add('ISO_42001:7.5');

    // Check for PII access
    const piiKeywords = ['email', 'name', 'address', 'phone', 'ssn', 'personal'];
    const accessedPII = resourcesAccessed.some(r =>
      piiKeywords.some(k => r.toLowerCase().includes(k))
    );
    if (accessedPII) {
      tags.add('EU_AI_ACT:Art.10'); // Data governance
      tags.add('NIST_AI_RMF:MAP-5'); // Impact characterization
    }
  }

  // Add tags based on decision making
  if (decision) {
    tags.add('EU_AI_ACT:Art.13'); // Transparency
    tags.add('EU_AI_ACT:Art.14'); // Human oversight
    tags.add('ISO_42001:8.1'); // Operational control
  }

  return Array.from(tags);
}

/**
 * Format action record for ledger entry
 */
function formatActionForLedger(actionRecord) {
  const lines = [
    `[AGENT_ACTION_LOG]`,
    `Action ID: ${actionRecord.actionId}`,
    `Agent: ${actionRecord.agent.name}`,
    `Type: ${actionRecord.action.type}`,
    `Timestamp: ${actionRecord.timestamp}`,
    ``,
    `INPUTS:`,
    JSON.stringify(actionRecord.action.inputs, null, 2).substring(0, 500),
    ``,
    `OUTPUTS:`,
    JSON.stringify(actionRecord.action.outputs, null, 2).substring(0, 500),
    ``
  ];

  if (actionRecord.action.resourcesAccessed.length > 0) {
    lines.push(`RESOURCES ACCESSED:`);
    actionRecord.action.resourcesAccessed.forEach(r => lines.push(`  - ${r}`));
    lines.push(``);
  }

  if (actionRecord.decision.made) {
    lines.push(`DECISION: ${actionRecord.decision.made}`);
    if (actionRecord.decision.reasoning) {
      lines.push(`REASONING: ${actionRecord.decision.reasoning}`);
    }
    lines.push(``);
  }

  lines.push(`Action Hash: ${actionRecord.metadata.actionHash}`);

  return lines.join('\n');
}


// ==========================
// SESSION-BASED LOGGING
// ==========================

/**
 * Create an agent logging session
 *
 * @param {string} agentName - Name/identifier of the AI agent
 * @returns {Object} - Session logger object
 */
function agentSession(agentName) {
  const sessionId = Utilities.getUuid();
  const startTime = new Date().toISOString();
  const actionLog = [];
  const resourceLog = [];
  const decisionLog = [];

  // Log session start
  logAgentAction(
    agentName,
    AGENT_LOGGER_CONFIG.ACTION_TYPES.SESSION_START,
    { sessionId: sessionId },
    { status: 'STARTED' },
    [],
    null,
    'Agent session initialized'
  );

  const session = {
    sessionId: sessionId,
    agentName: agentName,
    startTime: startTime,
    isActive: true,

    /**
     * Log a general action
     *
     * @param {string} action - Action description
     * @param {Object} details - Action details
     * @returns {Object} - Log result
     */
    log: function(action, details) {
      if (!this.isActive) {
        throw new Error('Session has ended. Cannot log new actions.');
      }

      const actionType = categorizeAction(action);
      const result = logAgentAction(
        this.agentName,
        actionType,
        { action: action },
        details || {},
        [],
        null,
        null
      );

      actionLog.push({
        timestamp: new Date().toISOString(),
        action: action,
        details: details,
        result: result
      });

      return result;
    },

    /**
     * Log a resource/data access
     *
     * @param {string} resource - Resource being accessed
     * @param {string} permission - Permission level (READ, WRITE, etc.)
     * @param {Object} context - Additional context
     * @returns {Object} - Log result
     */
    access: function(resource, permission, context) {
      if (!this.isActive) {
        throw new Error('Session has ended. Cannot log new actions.');
      }

      const result = logAgentAction(
        this.agentName,
        AGENT_LOGGER_CONFIG.ACTION_TYPES.DATA_ACCESS,
        { resource: resource, permission: permission },
        context || {},
        [resource],
        null,
        `Accessed ${resource} with ${permission} permission`
      );

      resourceLog.push({
        timestamp: new Date().toISOString(),
        resource: resource,
        permission: permission,
        context: context,
        result: result
      });

      return result;
    },

    /**
     * Log a decision with reasoning
     *
     * @param {string} decision - The decision made
     * @param {string} reasoning - Explanation/reasoning
     * @param {Object} context - Additional context
     * @returns {Object} - Log result
     */
    decide: function(decision, reasoning, context) {
      if (!this.isActive) {
        throw new Error('Session has ended. Cannot log new actions.');
      }

      const result = logAgentAction(
        this.agentName,
        AGENT_LOGGER_CONFIG.ACTION_TYPES.DECISION,
        context || {},
        { decision: decision },
        [],
        decision,
        reasoning
      );

      decisionLog.push({
        timestamp: new Date().toISOString(),
        decision: decision,
        reasoning: reasoning,
        context: context,
        result: result
      });

      return result;
    },

    /**
     * Log an error
     *
     * @param {string} error - Error message
     * @param {Object} context - Additional context
     * @returns {Object} - Log result
     */
    error: function(error, context) {
      if (!this.isActive) {
        throw new Error('Session has ended. Cannot log new actions.');
      }

      return logAgentAction(
        this.agentName,
        AGENT_LOGGER_CONFIG.ACTION_TYPES.ERROR,
        context || {},
        { error: error },
        [],
        null,
        'Error occurred during agent operation'
      );
    },

    /**
     * Log an escalation to human
     *
     * @param {string} reason - Reason for escalation
     * @param {Object} context - Additional context
     * @returns {Object} - Log result
     */
    escalate: function(reason, context) {
      if (!this.isActive) {
        throw new Error('Session has ended. Cannot log new actions.');
      }

      return logAgentAction(
        this.agentName,
        AGENT_LOGGER_CONFIG.ACTION_TYPES.ESCALATION,
        context || {},
        { escalationReason: reason },
        [],
        'ESCALATE_TO_HUMAN',
        reason
      );
    },

    /**
     * End the session and write summary
     *
     * @param {string} outcome - Session outcome (SUCCESS, PARTIAL, FAILED)
     * @param {Object} summary - Optional summary data
     * @returns {Object} - Final log result
     */
    end: function(outcome, summary) {
      if (!this.isActive) {
        throw new Error('Session has already ended.');
      }

      this.isActive = false;
      const endTime = new Date().toISOString();

      // Calculate duration
      const durationMs = new Date(endTime) - new Date(this.startTime);
      const durationSec = Math.round(durationMs / 1000);

      // Build session summary
      const sessionSummary = {
        sessionId: this.sessionId,
        agentName: this.agentName,
        startTime: this.startTime,
        endTime: endTime,
        durationSeconds: durationSec,
        outcome: outcome,
        stats: {
          totalActions: actionLog.length,
          totalResourceAccesses: resourceLog.length,
          totalDecisions: decisionLog.length
        },
        summary: summary || {}
      };

      // Log session end
      const result = logAgentAction(
        this.agentName,
        AGENT_LOGGER_CONFIG.ACTION_TYPES.SESSION_END,
        { sessionId: this.sessionId },
        sessionSummary,
        [],
        null,
        `Session ended with outcome: ${outcome}`
      );

      // Write comprehensive session entry
      const sessionEntryText = [
        `[AGENT_SESSION_COMPLETE]`,
        `Session ID: ${this.sessionId}`,
        `Agent: ${this.agentName}`,
        `Duration: ${durationSec} seconds`,
        `Outcome: ${outcome}`,
        ``,
        `STATISTICS:`,
        `  Actions: ${actionLog.length}`,
        `  Resource Accesses: ${resourceLog.length}`,
        `  Decisions: ${decisionLog.length}`,
        ``,
        `RESOURCES ACCESSED:`,
        ...resourceLog.map(r => `  - ${r.resource} (${r.permission})`),
        ``,
        `DECISIONS MADE:`,
        ...decisionLog.map(d => `  - ${d.decision}`),
        ``,
        `Summary: ${JSON.stringify(summary || {})}`
      ].join('\n');

      safeNewEntry(
        'System',
        'AGENT_SESSION_SUMMARY',
        sessionEntryText,
        '',
        outcome === 'SUCCESS' ? 'VERIFIED' : 'DRAFT'
      );

      return {
        ...result,
        sessionSummary: sessionSummary
      };
    },

    /**
     * Get current session stats
     */
    getStats: function() {
      return {
        sessionId: this.sessionId,
        agentName: this.agentName,
        startTime: this.startTime,
        isActive: this.isActive,
        actionsCount: actionLog.length,
        resourceAccessCount: resourceLog.length,
        decisionsCount: decisionLog.length
      };
    }
  };

  return session;
}

/**
 * Categorize action string into action type
 */
function categorizeAction(actionString) {
  const lowerAction = actionString.toLowerCase();

  if (lowerAction.includes('search') || lowerAction.includes('find') || lowerAction.includes('query')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.SEARCH;
  }
  if (lowerAction.includes('read') || lowerAction.includes('get') || lowerAction.includes('fetch')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.READ;
  }
  if (lowerAction.includes('write') || lowerAction.includes('create') || lowerAction.includes('update')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.WRITE;
  }
  if (lowerAction.includes('api') || lowerAction.includes('call') || lowerAction.includes('request')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.API_CALL;
  }
  if (lowerAction.includes('decide') || lowerAction.includes('choose') || lowerAction.includes('select')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.DECISION;
  }
  if (lowerAction.includes('infer') || lowerAction.includes('predict') || lowerAction.includes('analyze')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.INFERENCE;
  }
  if (lowerAction.includes('transform') || lowerAction.includes('convert') || lowerAction.includes('process')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.TRANSFORMATION;
  }
  if (lowerAction.includes('send') || lowerAction.includes('email') || lowerAction.includes('notify')) {
    return AGENT_LOGGER_CONFIG.ACTION_TYPES.COMMUNICATION;
  }

  return AGENT_LOGGER_CONFIG.ACTION_TYPES.INFERENCE; // Default
}


// ==========================
// QUERY FUNCTIONS
// ==========================

/**
 * Get all actions by an agent within a date range
 */
function getAgentActions(agentName, startDate, endDate) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();

  const actions = [];

  for (const row of data) {
    const timestamp = new Date(row[1]);
    const eventType = row[3] || '';
    const text = row[4] || '';

    // Check if this is an agent action for the specified agent
    if (eventType.startsWith('AGENT_') &&
        text.includes(agentName) &&
        timestamp >= start &&
        timestamp <= end) {

      actions.push({
        uuid: row[0],
        timestamp: row[1],
        eventType: eventType,
        text: text,
        status: row[8],
        regulatoryTags: row[14]
      });
    }
  }

  return actions;
}

/**
 * Get all sessions for an agent
 */
function getAgentSessions(agentName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const sessions = [];

  for (const row of data) {
    const eventType = row[3] || '';
    const text = row[4] || '';

    if (eventType === 'AGENT_SESSION_SUMMARY' && text.includes(agentName)) {
      // Extract session info from text
      const sessionIdMatch = text.match(/Session ID:\s*([a-f0-9-]+)/i);
      const outcomeMatch = text.match(/Outcome:\s*(\w+)/i);
      const durationMatch = text.match(/Duration:\s*(\d+)/i);

      sessions.push({
        uuid: row[0],
        timestamp: row[1],
        sessionId: sessionIdMatch ? sessionIdMatch[1] : 'Unknown',
        outcome: outcomeMatch ? outcomeMatch[1] : 'Unknown',
        durationSeconds: durationMatch ? parseInt(durationMatch[1]) : 0,
        status: row[8]
      });
    }
  }

  return sessions;
}

/**
 * Generate agent activity report
 */
function generateAgentActivityReport(agentName, startDate, endDate) {
  const actions = getAgentActions(agentName, startDate, endDate);
  const sessions = getAgentSessions(agentName);

  // Count action types
  const actionCounts = {};
  for (const action of actions) {
    const type = action.eventType.replace('AGENT_', '');
    actionCounts[type] = (actionCounts[type] || 0) + 1;
  }

  // Calculate session stats
  const sessionStats = {
    total: sessions.length,
    successful: sessions.filter(s => s.outcome === 'SUCCESS').length,
    failed: sessions.filter(s => s.outcome === 'FAILED').length,
    avgDuration: sessions.length > 0
      ? Math.round(sessions.reduce((sum, s) => sum + s.durationSeconds, 0) / sessions.length)
      : 0
  };

  return {
    agentName: agentName,
    period: { startDate, endDate },
    totalActions: actions.length,
    actionsByType: actionCounts,
    sessionStats: sessionStats,
    regulatoryCompliance: {
      actionsLogged: actions.length,
      sessionsDocumented: sessions.length,
      euAiActArt12: true, // Record-keeping
      euAiActArt20: true  // Automatically generated logs
    }
  };
}


// ==========================
// INTEGRATION WITH NEWTON AGENT
// ==========================

/**
 * Wrapper to create a logged agent session for Newton Agent
 */
function createLoggedAgentSession(goal) {
  const session = agentSession('Newton_Agent');

  // Log the goal
  session.log('Investigation Started', { goal: goal });

  return {
    session: session,

    // Wrapped action executor that logs everything
    executeAction: function(actionType, params) {
      // Log the action
      session.log(`Execute: ${actionType}`, params);

      // Log any resource access
      if (actionType === 'SEARCH_GMAIL' || actionType === 'READ_EMAIL') {
        session.access('Gmail', 'READ', params);
      } else if (actionType === 'SEARCH_DRIVE' || actionType === 'READ_FILE') {
        session.access('Google Drive', 'READ', params);
      } else if (actionType === 'SEARCH_CALENDAR') {
        session.access('Google Calendar', 'READ', params);
      }

      return true;
    },

    // Log a decision
    logDecision: function(decision, reasoning) {
      return session.decide(decision, reasoning);
    },

    // End session
    complete: function(outcome, summary) {
      return session.end(outcome, summary);
    }
  };
}


// ==========================
// UI FUNCTIONS
// ==========================

function viewAgentActivityFromUI() {
  const ui = SpreadsheetApp.getUi();

  const agentResponse = ui.prompt(
    'Agent Activity Report',
    'Enter agent name (e.g., "Newton_Agent"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (agentResponse.getSelectedButton() !== ui.Button.OK) return;
  const agentName = agentResponse.getResponseText().trim();

  const report = generateAgentActivityReport(agentName, null, null);

  let text = `AGENT ACTIVITY REPORT\n\n`;
  text += `Agent: ${report.agentName}\n`;
  text += `Total Actions: ${report.totalActions}\n\n`;

  text += `ACTIONS BY TYPE:\n`;
  for (const [type, count] of Object.entries(report.actionsByType)) {
    text += `  ${type}: ${count}\n`;
  }

  text += `\nSESSION STATISTICS:\n`;
  text += `  Total Sessions: ${report.sessionStats.total}\n`;
  text += `  Successful: ${report.sessionStats.successful}\n`;
  text += `  Failed: ${report.sessionStats.failed}\n`;
  text += `  Avg Duration: ${report.sessionStats.avgDuration}s\n`;

  text += `\nCOMPLIANCE:\n`;
  text += `  EU AI Act Art.12: ✅\n`;
  text += `  EU AI Act Art.20: ✅\n`;

  ui.alert('Agent Activity', text, ui.ButtonSet.OK);
}


// ==========================
// TEST FUNCTION
// ==========================

function testAgentLogging() {
  // Create a session
  const session = agentSession('Test_Agent');

  // Log some actions
  session.log('Initialized test', { test: true });
  session.access('Test Database', 'READ', { table: 'users' });
  session.decide('Process data', 'Data meets quality requirements');

  // End session
  const result = session.end('SUCCESS', { itemsProcessed: 10 });

  Logger.log('Session completed:');
  Logger.log(JSON.stringify(result.sessionSummary, null, 2));

  return result;
}
