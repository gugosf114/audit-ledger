/**
 * ───────────────────────────────────────────────
 *  NEWTON AGENT : AUTONOMOUS INVESTIGATION ENGINE
 * ───────────────────────────────────────────────
 *
 *  A fully agentic AI system that:
 *  1. Autonomously hunts for missing information
 *  2. Searches Gmail, Drive, Calendar for evidence
 *  3. Makes decisions about next actions
 *  4. Self-reflects and adjusts strategy
 *  5. Logs all actions to the Audit Ledger
 *
 *  Core Loop: OBSERVE → THINK → ACT → REFLECT
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// AGENT CONFIGURATION
// ==========================

const AGENT_CONFIG = {
  MAX_ITERATIONS: 10,
  MAX_ACTIONS_PER_ITERATION: 5,
  GEMINI_MODEL: 'gemini-1.5-pro',

  // Action types the agent can take
  ACTIONS: {
    SEARCH_GMAIL: 'SEARCH_GMAIL',
    SEARCH_DRIVE: 'SEARCH_DRIVE',
    READ_EMAIL: 'READ_EMAIL',
    READ_FILE: 'READ_FILE',
    SEARCH_CALENDAR: 'SEARCH_CALENDAR',
    CREATE_VOID: 'CREATE_VOID',
    MARK_FOUND: 'MARK_FOUND',
    REQUEST_HUMAN: 'REQUEST_HUMAN',
    CONCLUDE: 'CONCLUDE'
  },

  // Agent states
  STATES: {
    INITIALIZING: 'INITIALIZING',
    HUNTING: 'HUNTING',
    ANALYZING: 'ANALYZING',
    REFLECTING: 'REFLECTING',
    AWAITING_HUMAN: 'AWAITING_HUMAN',
    COMPLETE: 'COMPLETE',
    FAILED: 'FAILED'
  }
};


// ==========================
// AGENT STATE MANAGEMENT
// ==========================

/**
 * Agent session state - persists across iterations
 */
class AgentSession {
  constructor(goal, checklist) {
    this.sessionId = Utilities.getUuid();
    this.goal = goal;
    this.checklist = checklist;
    this.state = AGENT_CONFIG.STATES.INITIALIZING;
    this.iteration = 0;
    this.startTime = new Date().toISOString();

    // What we're looking for
    this.targets = [];

    // What we've found
    this.evidence = [];

    // Actions taken
    this.actionLog = [];

    // Voids (things we couldn't find)
    this.voids = [];

    // Agent's internal reasoning
    this.thoughtLog = [];

    // Files/emails already examined (avoid loops)
    this.examined = new Set();

    // Current focus (what the agent is investigating)
    this.currentFocus = null;
  }

  addThought(thought) {
    this.thoughtLog.push({
      iteration: this.iteration,
      timestamp: new Date().toISOString(),
      thought: thought
    });
  }

  addAction(action, result) {
    this.actionLog.push({
      iteration: this.iteration,
      timestamp: new Date().toISOString(),
      action: action,
      result: result
    });
  }

  addEvidence(item, source, content) {
    this.evidence.push({
      item: item,
      source: source,
      content: content,
      foundAt: new Date().toISOString()
    });
  }

  addVoid(item, reason, searchesTried) {
    this.voids.push({
      item: item,
      reason: reason,
      searchesTried: searchesTried,
      createdAt: new Date().toISOString()
    });
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      goal: this.goal,
      state: this.state,
      iteration: this.iteration,
      targets: this.targets,
      evidenceCount: this.evidence.length,
      voidsCount: this.voids.length,
      actionsCount: this.actionLog.length
    };
  }
}


// ==========================
// GEMINI BRAIN
// ==========================

/**
 * The agent's "brain" - uses Gemini to decide next actions
 */
function agentThink(session, context) {
  const prompt = buildAgentPrompt(session, context);

  try {
    const response = callGemini(prompt);
    const parsed = extractJSON(response);

    session.addThought(parsed.reasoning || 'No reasoning provided');

    return parsed;
  } catch (e) {
    logSystemEvent('ERROR', 'AGENT', 'Agent think failed', { error: e.message });
    return {
      reasoning: 'Error during reasoning: ' + e.message,
      actions: [{ type: AGENT_CONFIG.ACTIONS.REQUEST_HUMAN, params: { reason: e.message } }]
    };
  }
}

function buildAgentPrompt(session, context) {
  return `*** NEWTON AGENT : AUTONOMOUS INVESTIGATOR ***

SESSION_ID: ${session.sessionId}
ITERATION: ${session.iteration}/${AGENT_CONFIG.MAX_ITERATIONS}
STATE: ${session.state}

GOAL:
${session.goal}

CHECKLIST (items to find/verify):
${session.checklist}

CURRENT TARGETS (still looking for):
${JSON.stringify(session.targets, null, 2)}

EVIDENCE FOUND SO FAR:
${JSON.stringify(session.evidence.map(e => ({ item: e.item, source: e.source })), null, 2)}

VOIDS (confirmed missing):
${JSON.stringify(session.voids, null, 2)}

RECENT ACTIONS:
${JSON.stringify(session.actionLog.slice(-5), null, 2)}

CONTEXT FROM LAST ACTION:
${context || 'No context yet - this is the first iteration.'}

ALREADY EXAMINED (do not re-examine):
${Array.from(session.examined).slice(-20).join(', ') || 'None yet'}

---

You are an autonomous investigation agent. Your job is to HUNT for missing information.

AVAILABLE ACTIONS:
1. SEARCH_GMAIL: { query: "search terms", maxResults: 10 }
   - Search user's Gmail for relevant emails

2. SEARCH_DRIVE: { query: "search terms", maxResults: 10 }
   - Search Google Drive for files

3. READ_EMAIL: { messageId: "id" }
   - Read full content of a specific email

4. READ_FILE: { fileId: "id" }
   - Read content of a Drive file

5. SEARCH_CALENDAR: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", query: "optional" }
   - Search calendar for meetings that might have context

6. CREATE_VOID: { item: "what's missing", reason: "why it matters", searchesTried: ["list"] }
   - Declare an item as VOID (not found after thorough search)

7. MARK_FOUND: { item: "checklist item", source: "where found", evidence: "key content" }
   - Mark a checklist item as found with evidence

8. REQUEST_HUMAN: { reason: "why you need human input", question: "specific question" }
   - Ask the human for help when stuck

9. CONCLUDE: { summary: "final summary", status: "COMPLETE|PARTIAL|FAILED" }
   - End the investigation

RULES:
- Be thorough. Try multiple search strategies before giving up.
- Don't re-examine files/emails you've already seen.
- Create VOIDs only after genuinely trying to find something.
- Always explain your reasoning.
- Stay focused on the goal.

OUTPUT (JSON only, no prose):
{
  "reasoning": "Your step-by-step thinking about what to do next",
  "actions": [
    { "type": "ACTION_TYPE", "params": { ... } }
  ]
}`;
}


// ==========================
// ACTION EXECUTORS
// ==========================

/**
 * Execute a single action and return the result
 */
function executeAction(session, action) {
  const type = action.type;
  const params = action.params || {};

  logSystemEvent('INFO', 'AGENT', 'Executing action', { type, params });

  try {
    switch (type) {
      case AGENT_CONFIG.ACTIONS.SEARCH_GMAIL:
        return executeSearchGmail(session, params);

      case AGENT_CONFIG.ACTIONS.SEARCH_DRIVE:
        return executeSearchDrive(session, params);

      case AGENT_CONFIG.ACTIONS.READ_EMAIL:
        return executeReadEmail(session, params);

      case AGENT_CONFIG.ACTIONS.READ_FILE:
        return executeReadFile(session, params);

      case AGENT_CONFIG.ACTIONS.SEARCH_CALENDAR:
        return executeSearchCalendar(session, params);

      case AGENT_CONFIG.ACTIONS.CREATE_VOID:
        return executeCreateVoid(session, params);

      case AGENT_CONFIG.ACTIONS.MARK_FOUND:
        return executeMarkFound(session, params);

      case AGENT_CONFIG.ACTIONS.REQUEST_HUMAN:
        return executeRequestHuman(session, params);

      case AGENT_CONFIG.ACTIONS.CONCLUDE:
        return executeConclude(session, params);

      default:
        return { success: false, error: 'Unknown action type: ' + type };
    }
  } catch (e) {
    logSystemEvent('ERROR', 'AGENT', 'Action execution failed', { type, error: e.message });
    return { success: false, error: e.message };
  }
}

function executeSearchGmail(session, params) {
  const query = params.query;
  const maxResults = params.maxResults || 10;

  const threads = GmailApp.search(query, 0, maxResults);
  const results = [];

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      const id = msg.getId();
      if (!session.examined.has('email:' + id)) {
        results.push({
          id: id,
          subject: msg.getSubject(),
          from: msg.getFrom(),
          date: msg.getDate().toISOString(),
          snippet: msg.getPlainBody().substring(0, 200)
        });
      }
    }
  }

  session.addAction({ type: 'SEARCH_GMAIL', query }, { found: results.length });

  return {
    success: true,
    message: `Found ${results.length} emails matching "${query}"`,
    data: results
  };
}

function executeSearchDrive(session, params) {
  const query = params.query;
  const maxResults = params.maxResults || 10;

  const files = DriveApp.searchFiles(query);
  const results = [];
  let count = 0;

  while (files.hasNext() && count < maxResults) {
    const file = files.next();
    const id = file.getId();

    if (!session.examined.has('file:' + id)) {
      results.push({
        id: id,
        name: file.getName(),
        mimeType: file.getMimeType(),
        lastUpdated: file.getLastUpdated().toISOString(),
        size: file.getSize()
      });
      count++;
    }
  }

  session.addAction({ type: 'SEARCH_DRIVE', query }, { found: results.length });

  return {
    success: true,
    message: `Found ${results.length} files matching "${query}"`,
    data: results
  };
}

function executeReadEmail(session, params) {
  const messageId = params.messageId;

  session.examined.add('email:' + messageId);

  const message = GmailApp.getMessageById(messageId);
  if (!message) {
    return { success: false, error: 'Email not found: ' + messageId };
  }

  const content = {
    id: messageId,
    subject: message.getSubject(),
    from: message.getFrom(),
    to: message.getTo(),
    date: message.getDate().toISOString(),
    body: message.getPlainBody(),
    attachments: message.getAttachments().map(a => ({
      name: a.getName(),
      type: a.getContentType(),
      size: a.getSize()
    }))
  };

  session.addAction({ type: 'READ_EMAIL', messageId }, { subject: content.subject });

  return {
    success: true,
    message: `Read email: "${content.subject}"`,
    data: content
  };
}

function executeReadFile(session, params) {
  const fileId = params.fileId;

  session.examined.add('file:' + fileId);

  const file = DriveApp.getFileById(fileId);
  if (!file) {
    return { success: false, error: 'File not found: ' + fileId };
  }

  let content = '';
  const mimeType = file.getMimeType();

  // Handle different file types
  if (mimeType === MimeType.GOOGLE_DOCS) {
    const doc = DocumentApp.openById(fileId);
    content = doc.getBody().getText();
  } else if (mimeType === MimeType.GOOGLE_SHEETS) {
    const ss = SpreadsheetApp.openById(fileId);
    const sheets = ss.getSheets();
    content = sheets.map(s => {
      const data = s.getDataRange().getValues();
      return s.getName() + ':\n' + data.map(r => r.join('\t')).join('\n');
    }).join('\n\n');
  } else if (mimeType === MimeType.PLAIN_TEXT || mimeType.includes('text')) {
    content = file.getBlob().getDataAsString();
  } else if (mimeType === MimeType.PDF) {
    content = '[PDF file - cannot read directly. Name: ' + file.getName() + ']';
  } else {
    content = '[Binary file - cannot read directly. Type: ' + mimeType + ']';
  }

  // Truncate if too long
  if (content.length > 10000) {
    content = content.substring(0, 10000) + '\n\n[TRUNCATED - file too large]';
  }

  session.addAction({ type: 'READ_FILE', fileId }, { name: file.getName(), size: content.length });

  return {
    success: true,
    message: `Read file: "${file.getName()}"`,
    data: {
      id: fileId,
      name: file.getName(),
      mimeType: mimeType,
      content: content
    }
  };
}

function executeSearchCalendar(session, params) {
  const startDate = new Date(params.startDate);
  const endDate = new Date(params.endDate);
  const query = params.query || '';

  const calendar = CalendarApp.getDefaultCalendar();
  const events = calendar.getEvents(startDate, endDate);

  const results = events
    .filter(e => !query || e.getTitle().toLowerCase().includes(query.toLowerCase()))
    .map(e => ({
      id: e.getId(),
      title: e.getTitle(),
      start: e.getStartTime().toISOString(),
      end: e.getEndTime().toISOString(),
      description: (e.getDescription() || '').substring(0, 500),
      attendees: e.getGuestList().map(g => g.getEmail())
    }));

  session.addAction({ type: 'SEARCH_CALENDAR', startDate: params.startDate, endDate: params.endDate }, { found: results.length });

  return {
    success: true,
    message: `Found ${results.length} calendar events`,
    data: results
  };
}

function executeCreateVoid(session, params) {
  session.addVoid(params.item, params.reason, params.searchesTried || []);

  // Log to Audit Ledger
  safeNewEntry(
    'System',
    'VOID_DETECTED',
    `[AGENT VOID] Item: ${params.item}\nReason: ${params.reason}\nSearches: ${(params.searchesTried || []).join(', ')}`,
    '',
    'DRAFT'
  );

  session.addAction({ type: 'CREATE_VOID', item: params.item }, { reason: params.reason });

  return {
    success: true,
    message: `Created VOID for: ${params.item}`
  };
}

function executeMarkFound(session, params) {
  session.addEvidence(params.item, params.source, params.evidence);

  // Remove from targets if present
  session.targets = session.targets.filter(t => t !== params.item);

  // Log to Audit Ledger
  safeNewEntry(
    'System',
    'EVIDENCE_FOUND',
    `[AGENT FOUND] Item: ${params.item}\nSource: ${params.source}\nEvidence: ${params.evidence}`,
    '',
    'VERIFIED'
  );

  session.addAction({ type: 'MARK_FOUND', item: params.item }, { source: params.source });

  return {
    success: true,
    message: `Marked as found: ${params.item}`
  };
}

function executeRequestHuman(session, params) {
  session.state = AGENT_CONFIG.STATES.AWAITING_HUMAN;

  // Log to Audit Ledger
  safeNewEntry(
    'System',
    'AGENT_BLOCKED',
    `[AGENT NEEDS HELP] Reason: ${params.reason}\nQuestion: ${params.question}`,
    '',
    'DRAFT'
  );

  session.addAction({ type: 'REQUEST_HUMAN' }, { reason: params.reason });

  return {
    success: true,
    message: `Requesting human input: ${params.question}`,
    needsHuman: true,
    question: params.question
  };
}

function executeConclude(session, params) {
  session.state = params.status === 'COMPLETE'
    ? AGENT_CONFIG.STATES.COMPLETE
    : AGENT_CONFIG.STATES.FAILED;

  // Final log to Audit Ledger
  const entryText = [
    `[AGENT INVESTIGATION COMPLETE]`,
    `Session: ${session.sessionId}`,
    `Goal: ${session.goal}`,
    `Status: ${params.status}`,
    `Evidence Found: ${session.evidence.length}`,
    `Voids Created: ${session.voids.length}`,
    `Actions Taken: ${session.actionLog.length}`,
    `Iterations: ${session.iteration}`,
    ``,
    `Summary: ${params.summary}`
  ].join('\n');

  safeNewEntry(
    'System',
    'AGENT_COMPLETE',
    entryText,
    '',
    params.status === 'COMPLETE' ? 'VERIFIED' : 'DRAFT'
  );

  session.addAction({ type: 'CONCLUDE' }, { status: params.status });

  return {
    success: true,
    message: `Investigation concluded: ${params.status}`,
    complete: true,
    summary: params.summary
  };
}


// ==========================
// MAIN AGENT LOOP
// ==========================

/**
 * Run the autonomous agent investigation
 *
 * @param {string} goal - What we're trying to find/verify
 * @param {string} checklist - List of items to find
 * @returns {Object} - Final investigation results
 */
function runAgentInvestigation(goal, checklist) {
  const session = new AgentSession(goal, checklist);

  // Create audit logging session
  let auditSession = null;
  try {
    auditSession = agentSession('Newton_Agent');
    auditSession.log('Investigation Started', { goal: goal, checklist: checklist });
  } catch (e) {
    // AgentLogger may not be loaded, continue without it
    logSystemEvent('WARN', 'AGENT', 'AgentLogger not available', { error: e.message });
  }

  logSystemEvent('INFO', 'AGENT', 'Starting investigation', {
    sessionId: session.sessionId,
    goal: goal
  });

  // Parse checklist into targets
  session.targets = checklist.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  session.state = AGENT_CONFIG.STATES.HUNTING;

  let context = 'Starting investigation. Targets: ' + session.targets.join(', ');
  let complete = false;

  // Main agent loop
  while (!complete && session.iteration < AGENT_CONFIG.MAX_ITERATIONS) {
    session.iteration++;

    logSystemEvent('INFO', 'AGENT', `Iteration ${session.iteration}`, {
      state: session.state,
      targetsRemaining: session.targets.length,
      evidenceFound: session.evidence.length
    });

    // THINK: Agent decides what to do
    const decision = agentThink(session, context);

    // ACT: Execute each action
    const results = [];
    for (const action of decision.actions || []) {
      // Log action to audit trail
      if (auditSession) {
        auditSession.log(`Execute: ${action.type}`, action.params || {});

        // Log resource access for data operations
        if (action.type === 'SEARCH_GMAIL' || action.type === 'READ_EMAIL') {
          auditSession.access('Gmail', 'READ', action.params);
        } else if (action.type === 'SEARCH_DRIVE' || action.type === 'READ_FILE') {
          auditSession.access('Google Drive', 'READ', action.params);
        } else if (action.type === 'SEARCH_CALENDAR') {
          auditSession.access('Google Calendar', 'READ', action.params);
        }
      }

      const result = executeAction(session, action);
      results.push(result);

      // Log decisions
      if (auditSession && action.type === 'MARK_FOUND') {
        auditSession.decide(`Mark as found: ${action.params?.item}`, 'Evidence matches checklist item');
      } else if (auditSession && action.type === 'CREATE_VOID') {
        auditSession.decide(`Create VOID: ${action.params?.item}`, action.params?.reason || 'Item not found');
      }

      if (result.complete) {
        complete = true;
        break;
      }

      if (result.needsHuman) {
        if (auditSession) auditSession.escalate(action.params?.reason || 'Human input required', action.params);
        complete = true; // Pause for human input
        break;
      }
    }

    // Build context for next iteration
    context = results.map(r =>
      `Action Result: ${r.message}\n${r.data ? 'Data: ' + JSON.stringify(r.data).substring(0, 2000) : ''}`
    ).join('\n\n');

    // Check if all targets found
    if (session.targets.length === 0) {
      complete = true;
      executeConclude(session, {
        summary: 'All checklist items found.',
        status: 'COMPLETE'
      });
    }
  }

  // Max iterations reached
  if (!complete && session.iteration >= AGENT_CONFIG.MAX_ITERATIONS) {
    executeConclude(session, {
      summary: `Max iterations (${AGENT_CONFIG.MAX_ITERATIONS}) reached. Remaining targets: ${session.targets.join(', ')}`,
      status: 'PARTIAL'
    });
  }

  // End audit session
  if (auditSession) {
    const outcome = session.state === AGENT_CONFIG.STATES.COMPLETE ? 'SUCCESS' :
                    session.state === AGENT_CONFIG.STATES.FAILED ? 'FAILED' : 'PARTIAL';
    auditSession.end(outcome, {
      evidenceFound: session.evidence.length,
      voidsCreated: session.voids.length,
      iterations: session.iteration,
      targetsRemaining: session.targets.length
    });
  }

  return {
    sessionId: session.sessionId,
    state: session.state,
    iterations: session.iteration,
    evidence: session.evidence,
    voids: session.voids,
    actionLog: session.actionLog,
    thoughtLog: session.thoughtLog
  };
}


// ==========================
// UI FUNCTIONS
// ==========================

function runAgentFromUI() {
  const ui = SpreadsheetApp.getUi();

  const goalResponse = ui.prompt(
    'Newton Agent - Step 1/2',
    'What should the agent investigate? (Be specific)',
    ui.ButtonSet.OK_CANCEL
  );
  if (goalResponse.getSelectedButton() !== ui.Button.OK) return;
  const goal = goalResponse.getResponseText();

  const checklistResponse = ui.prompt(
    'Newton Agent - Step 2/2',
    'What items should it find? (One per line)',
    ui.ButtonSet.OK_CANCEL
  );
  if (checklistResponse.getSelectedButton() !== ui.Button.OK) return;
  const checklist = checklistResponse.getResponseText();

  ui.alert('Agent Started',
    'Newton Agent is now investigating autonomously.\n\n' +
    'This may take a few minutes. Check the System Log for progress.\n\n' +
    'You will be notified when complete.',
    ui.ButtonSet.OK
  );

  const result = runAgentInvestigation(goal, checklist);

  // Show results
  let resultText = `INVESTIGATION COMPLETE\n\n`;
  resultText += `Session: ${result.sessionId}\n`;
  resultText += `Iterations: ${result.iterations}\n`;
  resultText += `State: ${result.state}\n\n`;

  resultText += `EVIDENCE FOUND: ${result.evidence.length}\n`;
  for (const e of result.evidence) {
    resultText += `  ✓ ${e.item} (from ${e.source})\n`;
  }

  resultText += `\nVOIDS: ${result.voids.length}\n`;
  for (const v of result.voids) {
    resultText += `  ✗ ${v.item}: ${v.reason}\n`;
  }

  ui.alert('Newton Agent Results', resultText, ui.ButtonSet.OK);
}


/**
 * Quick test with sample investigation
 */
function testAgentFlow() {
  const goal = 'Find all documents related to Q4 2024 financial review';
  const checklist = `Q4 2024 Revenue Report
Q4 2024 Expense Summary
Board Meeting Notes (December 2024)
Tax Documents 2024`;

  const result = runAgentInvestigation(goal, checklist);

  Logger.log('=== AGENT TEST RESULT ===');
  Logger.log('Session: ' + result.sessionId);
  Logger.log('State: ' + result.state);
  Logger.log('Iterations: ' + result.iterations);
  Logger.log('Evidence: ' + result.evidence.length);
  Logger.log('Voids: ' + result.voids.length);

  return result;
}


// ==========================
// MENU INTEGRATION
// ==========================

function addAgentMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Newton Agent')
    .addItem('Run Investigation', 'runAgentFromUI')
    .addSeparator()
    .addItem('Test Agent Flow', 'testAgentFlow')
    .addToUi();
}
