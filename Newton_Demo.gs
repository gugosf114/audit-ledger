/**
 * Newton_Demo.gs - Demo Data Generator & Compliance Digest
 *
 * PURPOSE: Generate realistic sample data for demos and send
 * scheduled compliance digest emails to stakeholders.
 *
 * FEATURES:
 * - generateDemoData(numDays) - Populates ledger with realistic AI requests
 * - sendComplianceDigest(email) - Emails usage summary and compliance status
 * - setupWeeklyDigest() - Creates time-based trigger for weekly emails
 *
 * AUTHOR: Newton AI Governance Platform
 * VERSION: 1.0.0
 */

// ============================================================================
// DEMO DATA CONFIGURATION
// ============================================================================

const DEMO_CONFIG = {
  // AI Providers and their models
  providers: {
    'openai': {
      models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      weight: 0.45  // 45% of requests
    },
    'anthropic': {
      models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
      weight: 0.35  // 35% of requests
    },
    'google': {
      models: ['gemini-pro', 'gemini-pro-vision', 'gemini-ultra'],
      weight: 0.20  // 20% of requests
    }
  },

  // Sample customer names for multi-tenant demo
  customers: [
    { name: 'Acme Corp', plan: 'enterprise' },
    { name: 'TechStart Inc', plan: 'startup' },
    { name: 'HealthCare Plus', plan: 'enterprise' },
    { name: 'FinServ Global', plan: 'enterprise' },
    { name: 'EduTech Academy', plan: 'startup' },
    { name: 'RetailMax', plan: 'basic' },
    { name: 'LegalEagle LLP', plan: 'enterprise' },
    { name: 'GreenEnergy Co', plan: 'startup' }
  ],

  // Sample use cases for realistic prompts
  useCases: [
    {
      category: 'Document Analysis',
      prompts: [
        'Analyze this contract for risk clauses',
        'Summarize the key points of this policy document',
        'Extract action items from meeting notes',
        'Review this compliance document for gaps'
      ],
      tags: ['ISO_42001:6.1', 'NIST_AI_RMF:GOVERN-1']
    },
    {
      category: 'Code Review',
      prompts: [
        'Review this code for security vulnerabilities',
        'Suggest optimizations for this function',
        'Explain what this code does',
        'Find potential bugs in this implementation'
      ],
      tags: ['NIST_AI_RMF:MAP-1', 'ISO_42001:8.1']
    },
    {
      category: 'Customer Support',
      prompts: [
        'Draft a response to this customer complaint',
        'Classify this support ticket by urgency',
        'Generate FAQ answers for common questions',
        'Analyze customer sentiment from feedback'
      ],
      tags: ['EU_AI_ACT:Art.13', 'ISO_42001:9.1']
    },
    {
      category: 'Data Analysis',
      prompts: [
        'Analyze trends in this sales data',
        'Generate insights from survey responses',
        'Predict next quarter performance',
        'Identify anomalies in transaction data'
      ],
      tags: ['NIST_AI_RMF:MEASURE-1', 'EU_AI_ACT:Art.10']
    },
    {
      category: 'Content Generation',
      prompts: [
        'Write a blog post about AI governance',
        'Create marketing copy for new product',
        'Draft an internal memo about policy changes',
        'Generate social media posts for campaign'
      ],
      tags: ['EU_AI_ACT:Art.52', 'ISO_42001:7.4']
    },
    {
      category: 'Risk Assessment',
      prompts: [
        'Evaluate risk factors in this proposal',
        'Assess compliance with GDPR requirements',
        'Review vendor for security risks',
        'Analyze potential impact of system change'
      ],
      tags: ['ISO_42001:6.1', 'NIST_AI_RMF:GOVERN-3', 'EU_AI_ACT:Art.9']
    }
  ],

  // VOID scenarios for compliance gaps
  voidScenarios: [
    {
      description: 'Missing model documentation for production AI system',
      tags: ['ISO_42001:7.5', 'EU_AI_ACT:Art.11']
    },
    {
      description: 'Training data lineage not documented',
      tags: ['EU_AI_ACT:Art.10', 'NIST_AI_RMF:MAP-3']
    },
    {
      description: 'Human oversight procedure not defined for automated decisions',
      tags: ['EU_AI_ACT:Art.14', 'ISO_42001:8.2']
    },
    {
      description: 'Bias testing results not recorded',
      tags: ['NIST_AI_RMF:MEASURE-2', 'EU_AI_ACT:Art.10']
    },
    {
      description: 'Incident response plan for AI failures missing',
      tags: ['ISO_42001:10.1', 'NIST_AI_RMF:GOVERN-4']
    },
    {
      description: 'Third-party AI model risk assessment not completed',
      tags: ['ISO_42001:8.1', 'NIST_AI_RMF:MAP-1']
    },
    {
      description: 'User notification for AI-generated content not implemented',
      tags: ['EU_AI_ACT:Art.52', 'ISO_42001:7.4']
    },
    {
      description: 'Model performance metrics not being tracked',
      tags: ['NIST_AI_RMF:MEASURE-1', 'ISO_42001:9.1']
    }
  ],

  // ESCALATION scenarios
  escalationScenarios: [
    {
      description: 'AI system generated potentially harmful content - requires review',
      severity: 'HIGH',
      tags: ['EU_AI_ACT:Art.5', 'ISO_42001:10.1']
    },
    {
      description: 'Unusual spike in token usage detected - possible abuse',
      severity: 'MEDIUM',
      tags: ['NIST_AI_RMF:GOVERN-3', 'ISO_42001:9.2']
    },
    {
      description: 'Model accuracy dropped below threshold in production',
      severity: 'HIGH',
      tags: ['NIST_AI_RMF:MEASURE-1', 'ISO_42001:9.1']
    },
    {
      description: 'Customer reported biased output from AI assistant',
      severity: 'HIGH',
      tags: ['EU_AI_ACT:Art.10', 'NIST_AI_RMF:MEASURE-2']
    },
    {
      description: 'API key potentially compromised - suspicious activity',
      severity: 'CRITICAL',
      tags: ['ISO_42001:8.1', 'NIST_AI_RMF:GOVERN-4']
    }
  ]
};

// ============================================================================
// DEMO DATA GENERATOR
// ============================================================================

/**
 * Generate realistic demo data for the Newton audit ledger
 * @param {number} numDays - Number of days to generate data for (default 30)
 * @param {number} requestCount - Approximate number of AI requests (default 75)
 */
function generateDemoData(numDays = 30, requestCount = 75) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger) {
    SpreadsheetApp.getUi().alert('Error: Audit_Ledger sheet not found. Please run initial setup first.');
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Generate Demo Data',
    `This will add approximately ${requestCount} AI proxy requests, VOIDs, and escalations ` +
    `spread across the last ${numDays} days.\n\n` +
    'This is for DEMO PURPOSES ONLY.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    return;
  }

  const startTime = new Date();
  let entriesCreated = 0;

  try {
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (numDays * 24 * 60 * 60 * 1000));

    // Generate AI proxy requests
    const proxyRequests = generateProxyRequests_(requestCount, startDate, endDate);
    entriesCreated += proxyRequests.length;

    // Generate VOID entries (10-15% of request count)
    const voidCount = Math.floor(requestCount * 0.12);
    const voidEntries = generateVoidEntries_(voidCount, startDate, endDate);
    entriesCreated += voidEntries.length;

    // Generate ESCALATION entries (3-5% of request count)
    const escalationCount = Math.floor(requestCount * 0.04);
    const escalationEntries = generateEscalationEntries_(escalationCount, startDate, endDate);
    entriesCreated += escalationEntries.length;

    // Combine and sort by timestamp
    const allEntries = [...proxyRequests, ...voidEntries, ...escalationEntries];
    allEntries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Write entries to ledger
    writeEntriesToLedger_(ledger, allEntries);

    const elapsed = ((new Date() - startTime) / 1000).toFixed(1);

    ui.alert(
      'Demo Data Generated',
      `Successfully created ${entriesCreated} entries:\n\n` +
      `• ${proxyRequests.length} AI proxy requests\n` +
      `• ${voidEntries.length} VOID (compliance gap) entries\n` +
      `• ${escalationEntries.length} ESCALATION entries\n\n` +
      `Time elapsed: ${elapsed}s`,
      ui.ButtonSet.OK
    );

    Logger.log(`Demo data generation complete: ${entriesCreated} entries in ${elapsed}s`);

  } catch (error) {
    ui.alert('Error', `Failed to generate demo data: ${error.message}`, ui.ButtonSet.OK);
    Logger.log(`Demo data error: ${error.message}`);
  }
}

/**
 * Generate AI proxy request entries
 */
function generateProxyRequests_(count, startDate, endDate) {
  const entries = [];
  const dateRange = endDate.getTime() - startDate.getTime();

  for (let i = 0; i < count; i++) {
    // Random timestamp within range (weighted toward recent)
    const randomOffset = Math.pow(Math.random(), 0.7) * dateRange;
    const timestamp = new Date(startDate.getTime() + randomOffset);

    // Select provider based on weights
    const provider = selectWeightedProvider_();
    const model = selectRandomModel_(provider);

    // Select use case
    const useCase = DEMO_CONFIG.useCases[Math.floor(Math.random() * DEMO_CONFIG.useCases.length)];
    const prompt = useCase.prompts[Math.floor(Math.random() * useCase.prompts.length)];

    // Select customer
    const customer = DEMO_CONFIG.customers[Math.floor(Math.random() * DEMO_CONFIG.customers.length)];

    // Generate realistic token counts
    const inputTokens = Math.floor(100 + Math.random() * 900);
    const outputTokens = Math.floor(50 + Math.random() * 450);
    const totalTokens = inputTokens + outputTokens;

    // Calculate cost (simplified)
    const cost = calculateDemoCost_(provider, model, inputTokens, outputTokens);

    // Generate latency (100ms - 5000ms)
    const latency = Math.floor(100 + Math.random() * 4900);

    entries.push({
      timestamp: timestamp.toISOString(),
      eventType: 'AI_PROXY_REQUEST',
      actor: customer.name,
      action: `${provider}/${model}`,
      target: useCase.category,
      details: JSON.stringify({
        prompt_preview: prompt.substring(0, 50) + '...',
        provider: provider,
        model: model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cost_usd: cost,
        latency_ms: latency,
        customer_plan: customer.plan,
        use_case: useCase.category,
        status: 'SUCCESS',
        demo_data: true
      }),
      tags: useCase.tags,
      signal: 'AI_REQUEST'
    });
  }

  return entries;
}

/**
 * Generate VOID (compliance gap) entries
 */
function generateVoidEntries_(count, startDate, endDate) {
  const entries = [];
  const dateRange = endDate.getTime() - startDate.getTime();

  for (let i = 0; i < count; i++) {
    const randomOffset = Math.pow(Math.random(), 0.5) * dateRange;
    const timestamp = new Date(startDate.getTime() + randomOffset);

    const scenario = DEMO_CONFIG.voidScenarios[Math.floor(Math.random() * DEMO_CONFIG.voidScenarios.length)];
    const customer = DEMO_CONFIG.customers[Math.floor(Math.random() * DEMO_CONFIG.customers.length)];

    // Some VOIDs are detected by agent, some by gap analysis
    const detectedBy = Math.random() > 0.6 ? 'Newton Agent' : 'Gap Analysis';

    entries.push({
      timestamp: timestamp.toISOString(),
      eventType: 'VOID_DETECTED',
      actor: detectedBy,
      action: 'COMPLIANCE_GAP',
      target: customer.name,
      details: JSON.stringify({
        description: scenario.description,
        detected_by: detectedBy,
        status: Math.random() > 0.3 ? 'OPEN' : 'RESOLVED',
        priority: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
        frameworks_affected: scenario.tags.map(t => t.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i),
        demo_data: true
      }),
      tags: scenario.tags,
      signal: 'VOID_DETECTED'
    });
  }

  return entries;
}

/**
 * Generate ESCALATION entries
 */
function generateEscalationEntries_(count, startDate, endDate) {
  const entries = [];
  const dateRange = endDate.getTime() - startDate.getTime();

  for (let i = 0; i < count; i++) {
    const randomOffset = Math.pow(Math.random(), 0.5) * dateRange;
    const timestamp = new Date(startDate.getTime() + randomOffset);

    const scenario = DEMO_CONFIG.escalationScenarios[Math.floor(Math.random() * DEMO_CONFIG.escalationScenarios.length)];
    const customer = DEMO_CONFIG.customers[Math.floor(Math.random() * DEMO_CONFIG.customers.length)];

    entries.push({
      timestamp: timestamp.toISOString(),
      eventType: 'ESCALATED',
      actor: 'Newton Monitor',
      action: 'INCIDENT_ESCALATION',
      target: customer.name,
      details: JSON.stringify({
        description: scenario.description,
        severity: scenario.severity,
        status: Math.random() > 0.4 ? 'RESOLVED' : 'INVESTIGATING',
        assigned_to: 'Compliance Team',
        resolution_notes: Math.random() > 0.4 ? 'Issue addressed and controls strengthened' : null,
        demo_data: true
      }),
      tags: scenario.tags,
      signal: 'ESCALATED'
    });
  }

  return entries;
}

/**
 * Select provider based on configured weights
 */
function selectWeightedProvider_() {
  const random = Math.random();
  let cumulative = 0;

  for (const [provider, config] of Object.entries(DEMO_CONFIG.providers)) {
    cumulative += config.weight;
    if (random < cumulative) {
      return provider;
    }
  }

  return 'openai'; // fallback
}

/**
 * Select random model from provider
 */
function selectRandomModel_(provider) {
  const models = DEMO_CONFIG.providers[provider].models;
  return models[Math.floor(Math.random() * models.length)];
}

/**
 * Calculate demo cost based on provider/model
 */
function calculateDemoCost_(provider, model, inputTokens, outputTokens) {
  // Simplified pricing (per 1K tokens)
  const pricing = {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
    'gemini-pro': { input: 0.00025, output: 0.0005 },
    'gemini-pro-vision': { input: 0.00025, output: 0.0005 },
    'gemini-ultra': { input: 0.00125, output: 0.00375 }
  };

  const rates = pricing[model] || { input: 0.001, output: 0.002 };
  const cost = (inputTokens / 1000 * rates.input) + (outputTokens / 1000 * rates.output);

  return Math.round(cost * 10000) / 10000; // 4 decimal places
}

/**
 * Write entries to the audit ledger
 */
function writeEntriesToLedger_(ledger, entries) {
  let prevHash = '';
  const lastRow = ledger.getLastRow();

  // Get previous hash if entries exist
  if (lastRow > 1) {
    prevHash = ledger.getRange(lastRow, 13).getValue() || '';
  }

  const rows = [];

  for (const entry of entries) {
    const uuid = Utilities.getUuid();
    const timestamp = entry.timestamp;

    // Create hash chain
    const hashInput = prevHash + timestamp + entry.eventType + entry.actor + entry.action;
    const currentHash = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      hashInput
    ).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').substring(0, 16);

    rows.push([
      uuid,                          // A: UUID
      timestamp,                     // B: Timestamp
      entry.eventType,               // C: Event_Type
      entry.actor,                   // D: Actor
      entry.action,                  // E: Action
      entry.target,                  // F: Target
      entry.details,                 // G: Details
      '',                            // H: Evidence_Link
      entry.signal || '',            // I: Signal (for VOID_DETECTED, ESCALATED)
      '',                            // J: Verified_By
      '',                            // K: Verification_Timestamp
      prevHash,                      // L: Prev_Hash
      currentHash,                   // M: Current_Hash
      '',                            // N: Notes
      entry.tags ? entry.tags.join(', ') : ''  // O: Regulatory_Tags
    ]);

    prevHash = currentHash;
  }

  // Batch write all rows
  if (rows.length > 0) {
    ledger.getRange(lastRow + 1, 1, rows.length, 15).setValues(rows);
  }
}

// ============================================================================
// COMPLIANCE DIGEST
// ============================================================================

/**
 * Send compliance digest email with AI usage summary and compliance status
 * @param {string} email - Recipient email address
 */
function sendComplianceDigest(email) {
  if (!email) {
    const ui = SpreadsheetApp.getUi();
    const response = ui.prompt(
      'Compliance Digest',
      'Enter recipient email address:',
      ui.ButtonSet.OK_CANCEL
    );

    if (response.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    email = response.getResponseText().trim();
  }

  if (!email || !email.includes('@')) {
    SpreadsheetApp.getUi().alert('Error', 'Please provide a valid email address.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  try {
    const digest = generateDigestContent_();

    const subject = `Newton AI Compliance Digest - ${new Date().toLocaleDateString()}`;

    const htmlBody = buildDigestEmail_(digest);

    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody
    });

    // Log the digest send
    logEntry('COMPLIANCE_DIGEST', 'Newton Digest', 'SENT', email, JSON.stringify({
      recipient: email,
      period_days: 7,
      total_requests: digest.usage.totalRequests,
      total_cost: digest.usage.totalCost,
      open_voids: digest.compliance.openVoids,
      open_escalations: digest.compliance.openEscalations
    }));

    SpreadsheetApp.getUi().alert('Success', `Compliance digest sent to ${email}`, SpreadsheetApp.getUi().ButtonSet.OK);

  } catch (error) {
    SpreadsheetApp.getUi().alert('Error', `Failed to send digest: ${error.message}`, SpreadsheetApp.getUi().ButtonSet.OK);
    Logger.log(`Digest error: ${error.message}`);
  }
}

/**
 * Generate digest content from ledger data
 */
function generateDigestContent_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger || ledger.getLastRow() < 2) {
    return {
      usage: { totalRequests: 0, totalTokens: 0, totalCost: 0, byProvider: {}, byCustomer: {} },
      compliance: { openVoids: 0, openEscalations: 0, resolvedThisWeek: 0, tagCoverage: {} },
      trends: { requestTrend: 'stable', costTrend: 'stable' }
    };
  }

  const data = ledger.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // Get column indices
  const cols = {
    timestamp: headers.indexOf('Timestamp'),
    eventType: headers.indexOf('Event_Type'),
    actor: headers.indexOf('Actor'),
    action: headers.indexOf('Action'),
    details: headers.indexOf('Details'),
    signal: headers.indexOf('Signal'),
    tags: headers.indexOf('Regulatory_Tags')
  };

  // Calculate date range (last 7 days)
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Initialize counters
  const usage = {
    totalRequests: 0,
    totalTokens: 0,
    totalCost: 0,
    byProvider: {},
    byCustomer: {},
    byModel: {}
  };

  const compliance = {
    openVoids: 0,
    openEscalations: 0,
    resolvedThisWeek: 0,
    tagCoverage: {
      'ISO_42001': 0,
      'EU_AI_ACT': 0,
      'NIST_AI_RMF': 0
    },
    gaps: []
  };

  let lastWeekRequests = 0;
  let previousWeekRequests = 0;
  let lastWeekCost = 0;
  let previousWeekCost = 0;

  // Process rows
  for (const row of rows) {
    const timestamp = new Date(row[cols.timestamp]);
    const eventType = row[cols.eventType];
    const signal = row[cols.signal];
    const tags = row[cols.tags] || '';

    let details = {};
    try {
      details = JSON.parse(row[cols.details] || '{}');
    } catch (e) {}

    // Count AI proxy requests
    if (eventType === 'AI_PROXY_REQUEST' || signal === 'AI_REQUEST') {
      if (timestamp >= weekAgo) {
        usage.totalRequests++;
        usage.totalTokens += details.total_tokens || 0;
        usage.totalCost += details.cost_usd || 0;
        lastWeekRequests++;
        lastWeekCost += details.cost_usd || 0;

        // By provider
        const provider = details.provider || 'unknown';
        usage.byProvider[provider] = (usage.byProvider[provider] || 0) + 1;

        // By customer
        const customer = row[cols.actor] || 'unknown';
        usage.byCustomer[customer] = (usage.byCustomer[customer] || 0) + 1;

        // By model
        const model = details.model || 'unknown';
        usage.byModel[model] = (usage.byModel[model] || 0) + 1;
      } else if (timestamp >= twoWeeksAgo) {
        previousWeekRequests++;
        previousWeekCost += details.cost_usd || 0;
      }
    }

    // Count VOIDs
    if (eventType === 'VOID_DETECTED' || signal === 'VOID_DETECTED') {
      if (details.status === 'OPEN') {
        compliance.openVoids++;
        compliance.gaps.push({
          description: details.description || 'Compliance gap detected',
          tags: tags
        });
      } else if (details.status === 'RESOLVED' && timestamp >= weekAgo) {
        compliance.resolvedThisWeek++;
      }
    }

    // Count escalations
    if (eventType === 'ESCALATED' || signal === 'ESCALATED') {
      if (details.status !== 'RESOLVED') {
        compliance.openEscalations++;
      }
    }

    // Count tag coverage
    if (tags) {
      if (tags.includes('ISO_42001')) compliance.tagCoverage['ISO_42001']++;
      if (tags.includes('EU_AI_ACT')) compliance.tagCoverage['EU_AI_ACT']++;
      if (tags.includes('NIST_AI_RMF')) compliance.tagCoverage['NIST_AI_RMF']++;
    }
  }

  // Calculate trends
  const requestTrend = lastWeekRequests > previousWeekRequests * 1.1 ? 'increasing' :
                       lastWeekRequests < previousWeekRequests * 0.9 ? 'decreasing' : 'stable';
  const costTrend = lastWeekCost > previousWeekCost * 1.1 ? 'increasing' :
                    lastWeekCost < previousWeekCost * 0.9 ? 'decreasing' : 'stable';

  return {
    usage: usage,
    compliance: compliance,
    trends: {
      requestTrend: requestTrend,
      costTrend: costTrend,
      lastWeekRequests: lastWeekRequests,
      previousWeekRequests: previousWeekRequests
    }
  };
}

/**
 * Build HTML email template for digest
 */
function buildDigestEmail_(digest) {
  const trendIcon = (trend) => {
    if (trend === 'increasing') return '📈';
    if (trend === 'decreasing') return '📉';
    return '➡️';
  };

  const statusColor = (count) => {
    if (count === 0) return '#28a745';
    if (count <= 3) return '#ffc107';
    return '#dc3545';
  };

  // Build provider breakdown
  let providerRows = '';
  for (const [provider, count] of Object.entries(digest.usage.byProvider)) {
    const percentage = ((count / digest.usage.totalRequests) * 100).toFixed(1);
    providerRows += `<tr><td>${provider}</td><td>${count}</td><td>${percentage}%</td></tr>`;
  }

  // Build top customers
  let customerRows = '';
  const sortedCustomers = Object.entries(digest.usage.byCustomer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [customer, count] of sortedCustomers) {
    customerRows += `<tr><td>${customer}</td><td>${count}</td></tr>`;
  }

  // Build gaps list
  let gapsList = '';
  for (const gap of digest.compliance.gaps.slice(0, 5)) {
    gapsList += `<li>${gap.description} <small style="color:#666">(${gap.tags})</small></li>`;
  }
  if (digest.compliance.gaps.length > 5) {
    gapsList += `<li><em>... and ${digest.compliance.gaps.length - 5} more</em></li>`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 10px 0 0 0; opacity: 0.9; }
    .content { background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 30px; border-radius: 0 0 10px 10px; }
    .section { margin-bottom: 30px; }
    .section-title { font-size: 18px; font-weight: 600; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; margin-bottom: 15px; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #667eea; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .alert-card { padding: 15px; border-radius: 8px; margin-bottom: 10px; }
    .alert-success { background: #d4edda; border-left: 4px solid #28a745; }
    .alert-warning { background: #fff3cd; border-left: 4px solid #ffc107; }
    .alert-danger { background: #f8d7da; border-left: 4px solid #dc3545; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f8f9fa; font-weight: 600; }
    .trend { font-size: 14px; color: #666; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    ul { margin: 10px 0; padding-left: 20px; }
    li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Newton AI Compliance Digest</h1>
    <p>Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
  </div>

  <div class="content">
    <div class="section">
      <div class="section-title">AI Usage Summary</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">${digest.usage.totalRequests.toLocaleString()}</div>
          <div class="stat-label">Total Requests</div>
          <div class="trend">${trendIcon(digest.trends.requestTrend)} ${digest.trends.requestTrend}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${(digest.usage.totalTokens / 1000).toFixed(1)}K</div>
          <div class="stat-label">Tokens Used</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${digest.usage.totalCost.toFixed(2)}</div>
          <div class="stat-label">Total Cost</div>
          <div class="trend">${trendIcon(digest.trends.costTrend)} ${digest.trends.costTrend}</div>
        </div>
      </div>

      <h4>By Provider</h4>
      <table>
        <tr><th>Provider</th><th>Requests</th><th>Share</th></tr>
        ${providerRows || '<tr><td colspan="3">No data</td></tr>'}
      </table>

      <h4>Top Customers</h4>
      <table>
        <tr><th>Customer</th><th>Requests</th></tr>
        ${customerRows || '<tr><td colspan="2">No data</td></tr>'}
      </table>
    </div>

    <div class="section">
      <div class="section-title">Compliance Status</div>

      <div class="alert-card ${digest.compliance.openVoids === 0 ? 'alert-success' : digest.compliance.openVoids <= 3 ? 'alert-warning' : 'alert-danger'}">
        <strong>${digest.compliance.openVoids}</strong> Open Compliance Gaps (VOIDs)
        ${digest.compliance.resolvedThisWeek > 0 ? ` | <span style="color:#28a745">${digest.compliance.resolvedThisWeek} resolved this week</span>` : ''}
      </div>

      <div class="alert-card ${digest.compliance.openEscalations === 0 ? 'alert-success' : 'alert-danger'}">
        <strong>${digest.compliance.openEscalations}</strong> Open Escalations
      </div>

      ${digest.compliance.gaps.length > 0 ? `
      <h4>Active Gaps</h4>
      <ul>${gapsList}</ul>
      ` : ''}

      <h4>Regulatory Coverage</h4>
      <table>
        <tr><th>Framework</th><th>Tagged Entries</th></tr>
        <tr><td>ISO 42001</td><td>${digest.compliance.tagCoverage['ISO_42001']}</td></tr>
        <tr><td>EU AI Act</td><td>${digest.compliance.tagCoverage['EU_AI_ACT']}</td></tr>
        <tr><td>NIST AI RMF</td><td>${digest.compliance.tagCoverage['NIST_AI_RMF']}</td></tr>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Recommendations</div>
      <ul>
        ${digest.compliance.openVoids > 0 ? '<li>Review and address open compliance gaps to maintain audit readiness</li>' : ''}
        ${digest.compliance.openEscalations > 0 ? '<li>Prioritize resolution of open escalations</li>' : ''}
        ${digest.trends.costTrend === 'increasing' ? '<li>Monitor AI spending - costs trending upward</li>' : ''}
        ${digest.compliance.openVoids === 0 && digest.compliance.openEscalations === 0 ? '<li>Excellent compliance posture - maintain current practices</li>' : ''}
        <li>Run gap analysis to identify coverage improvements</li>
      </ul>
    </div>
  </div>

  <div class="footer">
    <p>Generated by Newton AI Governance Platform</p>
    <p>This is an automated digest. Reply to this email for support.</p>
  </div>
</body>
</html>
  `;
}

// ============================================================================
// SCHEDULED TRIGGERS
// ============================================================================

/**
 * Setup weekly compliance digest trigger
 */
function setupWeeklyDigest() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Setup Weekly Digest',
    'Enter the email address to receive weekly compliance digests:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const email = response.getResponseText().trim();

  if (!email || !email.includes('@')) {
    ui.alert('Error', 'Please provide a valid email address.', ui.ButtonSet.OK);
    return;
  }

  // Store email in document properties
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('DIGEST_EMAIL', email);

  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendScheduledDigest_') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new weekly trigger (every Monday at 9 AM)
  ScriptApp.newTrigger('sendScheduledDigest_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  ui.alert(
    'Weekly Digest Configured',
    `Compliance digest will be sent to ${email} every Monday at 9:00 AM.\n\n` +
    'You can also send a digest manually from the Admin menu.',
    ui.ButtonSet.OK
  );

  Logger.log(`Weekly digest configured for ${email}`);
}

/**
 * Trigger handler for scheduled digest
 */
function sendScheduledDigest_() {
  const props = PropertiesService.getDocumentProperties();
  const email = props.getProperty('DIGEST_EMAIL');

  if (email) {
    sendComplianceDigest(email);
  } else {
    Logger.log('No digest email configured');
  }
}

/**
 * Remove weekly digest trigger
 */
function removeWeeklyDigest() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendScheduledDigest_') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }

  const props = PropertiesService.getDocumentProperties();
  props.deleteProperty('DIGEST_EMAIL');

  SpreadsheetApp.getUi().alert(
    'Weekly Digest Removed',
    `Removed ${removed} trigger(s). Weekly digest emails have been disabled.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ============================================================================
// MENU ITEMS
// ============================================================================

/**
 * Add Demo & Digest menu items (call from onOpen)
 */
function addDemoMenuItems_(ui, menu) {
  menu.addSeparator()
    .addItem('Generate Demo Data', 'generateDemoData')
    .addItem('Send Compliance Digest', 'sendComplianceDigest')
    .addItem('Setup Weekly Digest', 'setupWeeklyDigest')
    .addItem('Remove Weekly Digest', 'removeWeeklyDigest');
}

/**
 * Clear demo data from ledger
 */
function clearDemoData() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Clear Demo Data',
    'This will remove all entries marked as demo data from the ledger.\n\n' +
    'This cannot be undone. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = ss.getSheetByName('Audit_Ledger');

  if (!ledger || ledger.getLastRow() < 2) {
    ui.alert('No data to clear.');
    return;
  }

  const data = ledger.getDataRange().getValues();
  const headers = data[0];
  const detailsCol = headers.indexOf('Details');

  const rowsToDelete = [];

  for (let i = data.length - 1; i >= 1; i--) {
    try {
      const details = JSON.parse(data[i][detailsCol] || '{}');
      if (details.demo_data === true) {
        rowsToDelete.push(i + 1); // 1-indexed
      }
    } catch (e) {}
  }

  // Delete rows from bottom to top
  for (const row of rowsToDelete) {
    ledger.deleteRow(row);
  }

  ui.alert('Demo Data Cleared', `Removed ${rowsToDelete.length} demo entries.`, ui.ButtonSet.OK);
}
