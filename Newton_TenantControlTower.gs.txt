/**
 * ───────────────────────────────────────────────
 *  NEWTON TENANT CONTROL TOWER : PER-TENANT POLICY
 * ───────────────────────────────────────────────
 *
 *  Every customer gets their own programmable governance
 *  cockpit. Configure per-tenant, per-route AI policy
 *  like AWS IAM but for epistemic risk.
 *
 *  Examples:
 *  - "customer replies = full lockdown"
 *  - "internal drafts = wild west but never hits the ledger"
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const TENANT_POLICY_SHEET = 'Tenant_Policy';

const DEFAULT_TENANT_POLICY = {
  mode: 'STRICT',                  // STRICT | PERMISSIVE | AUDIT_ONLY
  requireConfidence: true,         // Gatekeeper precheck confidence required
  requireReasoningSchema: false,   // Gatekeeper postcheck schema enforcement
  verifyCitations: false,          // Gatekeeper postcheck citation verification
  ledgerWrite: true,               // if false, skip writing request/response to ledger
  allowOverrides: false,           // if true, allow caller to request less strict behavior
  notes: ''
};

/**
 * Route taxonomy.
 */
const ROUTES = {
  CUSTOMER_REPLY: 'CUSTOMER_REPLY',
  INTERNAL_DRAFT: 'INTERNAL_DRAFT',
  TAX_WORKFLOW: 'TAX_WORKFLOW',
  LEGAL_OPINION: 'LEGAL_OPINION',
  ENGINEERING_BRAINSTORM: 'ENGINEERING_BRAINSTORM',
  GENERAL: 'GENERAL'
};


// ==========================
// SHEET SETUP
// ==========================

function _getTenantPolicySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TENANT_POLICY_SHEET);

  if (!sh) {
    sh = ss.insertSheet(TENANT_POLICY_SHEET);
    const headers = [
      'Customer_ID',
      'Route',
      'Mode',
      'Require_Confidence',
      'Require_Reasoning_Schema',
      'Verify_Citations',
      'Ledger_Write',
      'Allow_Overrides',
      'Notes',
      'Updated_At'
    ];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#4a4a4a')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);

    logSystemEvent('SUCCESS', 'TENANT', 'Tenant policy sheet created');
  }

  return sh;
}


// ==========================
// POLICY LOOKUP
// ==========================

/**
 * Get tenant policy for a customer and route.
 * Falls back to default if not found.
 */
function getTenantPolicy(customerId, route) {
  const sh = _getTenantPolicySheet();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    return { ...DEFAULT_TENANT_POLICY };
  }

  const data = sh.getRange(2, 1, lastRow - 1, 10).getValues();

  // First pass: exact match (customer + route)
  for (const row of data) {
    if (row[0] === customerId && row[1] === route) {
      return {
        mode: row[2] || DEFAULT_TENANT_POLICY.mode,
        requireConfidence: row[3] !== '' ? !!row[3] : DEFAULT_TENANT_POLICY.requireConfidence,
        requireReasoningSchema: row[4] !== '' ? !!row[4] : DEFAULT_TENANT_POLICY.requireReasoningSchema,
        verifyCitations: row[5] !== '' ? !!row[5] : DEFAULT_TENANT_POLICY.verifyCitations,
        ledgerWrite: row[6] !== '' ? !!row[6] : DEFAULT_TENANT_POLICY.ledgerWrite,
        allowOverrides: row[7] !== '' ? !!row[7] : DEFAULT_TENANT_POLICY.allowOverrides,
        notes: row[8] || '',
        updatedAt: row[9] || ''
      };
    }
  }

  // Second pass: customer default (customer + '*')
  for (const row of data) {
    if (row[0] === customerId && row[1] === '*') {
      return {
        mode: row[2] || DEFAULT_TENANT_POLICY.mode,
        requireConfidence: row[3] !== '' ? !!row[3] : DEFAULT_TENANT_POLICY.requireConfidence,
        requireReasoningSchema: row[4] !== '' ? !!row[4] : DEFAULT_TENANT_POLICY.requireReasoningSchema,
        verifyCitations: row[5] !== '' ? !!row[5] : DEFAULT_TENANT_POLICY.verifyCitations,
        ledgerWrite: row[6] !== '' ? !!row[6] : DEFAULT_TENANT_POLICY.ledgerWrite,
        allowOverrides: row[7] !== '' ? !!row[7] : DEFAULT_TENANT_POLICY.allowOverrides,
        notes: row[8] || '',
        updatedAt: row[9] || ''
      };
    }
  }

  // Third pass: route default ('*' + route)
  for (const row of data) {
    if (row[0] === '*' && row[1] === route) {
      return {
        mode: row[2] || DEFAULT_TENANT_POLICY.mode,
        requireConfidence: row[3] !== '' ? !!row[3] : DEFAULT_TENANT_POLICY.requireConfidence,
        requireReasoningSchema: row[4] !== '' ? !!row[4] : DEFAULT_TENANT_POLICY.requireReasoningSchema,
        verifyCitations: row[5] !== '' ? !!row[5] : DEFAULT_TENANT_POLICY.verifyCitations,
        ledgerWrite: row[6] !== '' ? !!row[6] : DEFAULT_TENANT_POLICY.ledgerWrite,
        allowOverrides: row[7] !== '' ? !!row[7] : DEFAULT_TENANT_POLICY.allowOverrides,
        notes: row[8] || '',
        updatedAt: row[9] || ''
      };
    }
  }

  // Fallback to default
  return { ...DEFAULT_TENANT_POLICY };
}


// ==========================
// POLICY MANAGEMENT
// ==========================

/**
 * Set tenant policy for a customer and route.
 */
function setTenantPolicy(customerId, route, policyPatch) {
  const sh = _getTenantPolicySheet();
  const now = new Date().toISOString();
  const policy = { ...DEFAULT_TENANT_POLICY, ...policyPatch, updatedAt: now };

  const lastRow = sh.getLastRow();

  // Check if exists
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, 2).getValues();

    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === customerId && data[i][1] === route) {
        // Update existing
        const r = i + 2;
        sh.getRange(r, 3, 1, 8).setValues([[
          policy.mode,
          policy.requireConfidence,
          policy.requireReasoningSchema,
          policy.verifyCitations,
          policy.ledgerWrite,
          policy.allowOverrides,
          policy.notes || '',
          now
        ]]);

        logSystemEvent('SUCCESS', 'TENANT', 'Policy updated', { customerId, route });
        return { success: true, customerId, route, policy, action: 'updated' };
      }
    }
  }

  // Insert new
  sh.appendRow([
    customerId,
    route,
    policy.mode,
    policy.requireConfidence,
    policy.requireReasoningSchema,
    policy.verifyCitations,
    policy.ledgerWrite,
    policy.allowOverrides,
    policy.notes || '',
    now
  ]);

  logSystemEvent('SUCCESS', 'TENANT', 'Policy created', { customerId, route });
  return { success: true, customerId, route, policy, action: 'created' };
}

/**
 * Delete tenant policy.
 */
function deleteTenantPolicy(customerId, route) {
  const sh = _getTenantPolicySheet();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) return { success: false, error: 'No policies found' };

  const data = sh.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === customerId && data[i][1] === route) {
      sh.deleteRow(i + 2);
      logSystemEvent('SUCCESS', 'TENANT', 'Policy deleted', { customerId, route });
      return { success: true, customerId, route };
    }
  }

  return { success: false, error: 'Policy not found' };
}

/**
 * List all policies for a customer.
 */
function listTenantPolicies(customerId) {
  const sh = _getTenantPolicySheet();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) return [];

  const data = sh.getRange(2, 1, lastRow - 1, 10).getValues();
  const policies = [];

  for (const row of data) {
    if (!customerId || row[0] === customerId) {
      policies.push({
        customerId: row[0],
        route: row[1],
        mode: row[2],
        requireConfidence: row[3],
        requireReasoningSchema: row[4],
        verifyCitations: row[5],
        ledgerWrite: row[6],
        allowOverrides: row[7],
        notes: row[8],
        updatedAt: row[9]
      });
    }
  }

  return policies;
}


// ==========================
// CONFIDENCE PLANNER INTEGRATION
// ==========================

/**
 * Normalize a confidence plan from metadata.
 */
function normalizeConfidencePlan(metadata) {
  const cp = (metadata && metadata.confidencePlan) || {};
  const plannedConfidence = (cp.plannedConfidence || 'MED').toUpperCase();

  return {
    plannedConfidence: ['LOW', 'MED', 'HIGH'].includes(plannedConfidence) ? plannedConfidence : 'MED',
    evidenceGoal: cp.evidenceGoal || 'NORMAL',
    requireKKForFinal: cp.requireKKForFinal !== undefined ? !!cp.requireKKForFinal : true
  };
}

/**
 * Decide Gatekeeper options for a request based on tenant policy and route.
 */
function planGatekeeperOptions(customerId, route, tenantPolicy, metadata) {
  const confidencePlan = normalizeConfidencePlan(metadata);

  // Base options from tenant policy
  const options = {
    mode: tenantPolicy.mode,
    requireConfidence: tenantPolicy.requireConfidence,
    requireReasoningSchema: tenantPolicy.requireReasoningSchema,
    verifyCitations: tenantPolicy.verifyCitations,
    confidence_uuid: metadata && metadata.confidence_uuid ? metadata.confidence_uuid : null,
    metadata: metadata || {}
  };

  // Route-specific tightening (never loosens, only tightens)
  if (route === ROUTES.CUSTOMER_REPLY || route === ROUTES.TAX_WORKFLOW) {
    options.requireReasoningSchema = true;
    options.requireConfidence = true;
  }

  if (route === ROUTES.LEGAL_OPINION) {
    options.mode = 'STRICT';
    options.requireReasoningSchema = true;
    options.requireConfidence = true;
  }

  // Confidence plan adjustments (only if allowOverrides)
  if (tenantPolicy.allowOverrides && confidencePlan.plannedConfidence === 'LOW') {
    if (route === ROUTES.INTERNAL_DRAFT || route === ROUTES.ENGINEERING_BRAINSTORM) {
      options.requireReasoningSchema = false;
      options.requireConfidence = false;
      options.mode = 'PERMISSIVE';
    }
  }

  return { options, confidencePlan };
}


// ==========================
// UI FUNCTIONS
// ==========================

function viewTenantPolicySheet() {
  const sh = _getTenantPolicySheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
}

function setTenantPolicyFromUI() {
  const ui = SpreadsheetApp.getUi();

  const customerResponse = ui.prompt(
    'Set Tenant Policy - Step 1/4',
    'Customer ID (or * for default):',
    ui.ButtonSet.OK_CANCEL
  );
  if (customerResponse.getSelectedButton() !== ui.Button.OK) return;
  const customerId = customerResponse.getResponseText().trim();

  const routeResponse = ui.prompt(
    'Set Tenant Policy - Step 2/4',
    'Route (or * for default):\n\n' +
    '• CUSTOMER_REPLY\n' +
    '• INTERNAL_DRAFT\n' +
    '• TAX_WORKFLOW\n' +
    '• LEGAL_OPINION\n' +
    '• ENGINEERING_BRAINSTORM\n' +
    '• GENERAL',
    ui.ButtonSet.OK_CANCEL
  );
  if (routeResponse.getSelectedButton() !== ui.Button.OK) return;
  const route = routeResponse.getResponseText().trim().toUpperCase();

  const modeResponse = ui.prompt(
    'Set Tenant Policy - Step 3/4',
    'Mode:\n• STRICT - Block violations\n• PERMISSIVE - Warn but allow\n• AUDIT_ONLY - Log only',
    ui.ButtonSet.OK_CANCEL
  );
  if (modeResponse.getSelectedButton() !== ui.Button.OK) return;
  const mode = modeResponse.getResponseText().trim().toUpperCase();

  const requireConfResponse = ui.prompt(
    'Set Tenant Policy - Step 4/4',
    'Require confidence declaration? (yes/no):',
    ui.ButtonSet.OK_CANCEL
  );
  if (requireConfResponse.getSelectedButton() !== ui.Button.OK) return;
  const requireConfidence = requireConfResponse.getResponseText().trim().toLowerCase() === 'yes';

  const result = setTenantPolicy(customerId, route, {
    mode,
    requireConfidence
  });

  ui.alert(
    'Policy Set',
    `${result.action.toUpperCase()}: ${customerId} / ${route}\n\n` +
    `Mode: ${mode}\n` +
    `Require Confidence: ${requireConfidence}`,
    ui.ButtonSet.OK
  );
}

function listTenantPoliciesFromUI() {
  const ui = SpreadsheetApp.getUi();

  const customerResponse = ui.prompt(
    'List Policies',
    'Customer ID (leave blank for all):',
    ui.ButtonSet.OK_CANCEL
  );
  if (customerResponse.getSelectedButton() !== ui.Button.OK) return;
  const customerId = customerResponse.getResponseText().trim() || null;

  const policies = listTenantPolicies(customerId);

  if (policies.length === 0) {
    ui.alert('No policies found.');
    return;
  }

  let report = `TENANT POLICIES${customerId ? ` for ${customerId}` : ''}\n\n`;

  for (const p of policies) {
    report += `${p.customerId} / ${p.route}\n`;
    report += `  Mode: ${p.mode}\n`;
    report += `  Require Confidence: ${p.requireConfidence}\n`;
    report += `  Require Schema: ${p.requireReasoningSchema}\n`;
    if (p.notes) report += `  Notes: ${p.notes}\n`;
    report += '\n';
  }

  ui.alert('Tenant Policies', report, ui.ButtonSet.OK);
}


// ==========================
// MENU
// ==========================

function addTenantPolicyMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Tenant Policy')
    .addItem('View Policies', 'viewTenantPolicySheet')
    .addItem('Set Policy', 'setTenantPolicyFromUI')
    .addItem('List Policies', 'listTenantPoliciesFromUI')
    .addToUi();
}
