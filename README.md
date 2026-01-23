# Audit Ledger

Tamper-evident AI governance platform using SHA-256 hash chains, adversarial verification, and regulatory compliance mapping.

## The Problem

AI systems produce outputs that organizations act on. When those outputs are wrong - hallucinated, overconfident, or drifting from baseline behavior - there's often no record of what was checked, what confidence level was declared, or what safeguards were bypassed.

Regulated industries need more than "the AI said so." They need cryptographic proof of what was verified, when, and by whom.

## What This Solves

1. **Tamper-evident audit trail** - Every entry is hash-chained; modifications break the chain and are detected
2. **Pre-commit confidence declaration** - Forces confidence level BEFORE content is logged (Rumsfeld Protocol)
3. **Adversarial verification** - Three-role sealed packet system prevents AI drift and hallucination
4. **AI output gatekeeper** - Blocks low-confidence, hallucinated, or policy-violating outputs before they reach users
5. **Regulatory mapping** - Auto-tags entries to ISO 42001, EU AI Act, and NIST AI RMF clauses
6. **Compliance workflows** - Multi-step checklists with dependencies, document collection, and gap analysis

## Architecture

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Audit Ledger | `Code.gs` | Hash-chained entry system, tamper detection |
| Confidence Declaration | `Newton_Confidence.gs` | Pre-commit confidence levels (KNOWN_KNOWN, etc.) |
| Sealed Packets | `Newton_SealedPacket.gs` | Generator/Auditor/Regenerator verification |
| Gatekeeper | `Newton_Gatekeeper.gs` | Blocks unsafe AI outputs |
| Gatekeeper Brain | `Newton_GatekeeperBrain.gs` | Auto-tuning, learning mode |
| Sentinel | `Newton_Sentinel.gs` | Signal detection (VOID_DETECTED, etc.) |
| Regulatory Mapping | `Newton_Regulatory.gs` | ISO 42001, EU AI Act, NIST AI RMF tagging |
| Gap Analysis | `Newton_GapAnalysis.gs` | Compliance gap identification |

### Workflow System

| Component | File | Purpose |
|-----------|------|---------|
| Workflow Engine | `Newton_Workflow.gs` | Multi-step workflows with dependencies |
| Workflow UI | `Newton_WorkflowUI.gs` | Web dashboard for workflow management |
| Workflow View | `Newton_WorkflowView.gs` | Single workflow execution page |

### Governance & Dashboard

| Component | File | Purpose |
|-----------|------|---------|
| Dashboard v3 | `Newton_Dashboard_v3.gs` | Role-based command center (EXEC/COMPLIANCE/ENGINEER/BRIEFING) |
| Dashboard HTML | `DashboardHTML_v3.html` | Frontend for Dashboard v3 |
| Governance Co-Pilot | `Newton_Governance_CoPilot.gs` | AI-assisted governance with mutation tracking |

### Integration & API

| Component | File | Purpose |
|-----------|------|---------|
| API Endpoint | `Newton_API_Endpoint.gs` | External write access via POST |
| Web UI | `Newton_WebUI.gs` | Web-based ledger interface |
| AI Proxy | `Newton_AIProxy.gs` | Gemini API integration |
| Multi-Tenant | `Newton_MultiTenant.gs` | Tenant isolation |

### Supporting Modules

| Component | File | Purpose |
|-----------|------|---------|
| IRAC Folders | `Newton_IRAC.gs` | Legal research folder creation |
| Document Verifier | `Newton_Verifier.gs` | Document verification via Gemini |
| Model Card | `Newton_ModelCard.gs` | AI model documentation |
| Detection Engine | `Newton_DetectionEngine.gs` | Pattern detection |
| Agent System | `Newton_Agent.gs`, `Newton_AgentLogger.gs`, `Newton_AgentPacket.gs` | Agent orchestration |
| Tenant Control | `Newton_TenantControlTower.gs` | Tenant policy management |
| Audit Package | `Newton_AuditPackage.gs` | Audit export |
| Confidence Planner | `Newton_ConfidencePlanner.gs` | Confidence planning |
| Demo | `Newton_Demo.gs` | Demo scenarios |

## How It Works

### Hash-Chained Audit Ledger

Each entry contains:
- UUID, timestamp, actor, event type, text content
- Previous row's record hash
- Current row's record hash (SHA-256 of all fields + secret)

Tampering breaks the chain. Run `verifyLedgerIntegrity()` to detect modifications.

### Confidence Declaration (Rumsfeld Protocol)

Before logging content, declare confidence:

```javascript
// Step 1: Declare confidence
const uuid = declareConfidence('KNOWN_KNOWN', 'REGULATORY', 85);

// Step 2: Log content with confidence UUID
newEntryWithConfidence(uuid, 'Analyst', 'FINDING', 'Policy violates Art.9', null, 'FINAL');
```

Confidence levels:
- **KNOWN_KNOWN** - High confidence, direct evidence
- **KNOWN_UNKNOWN** - Identified gap, specific uncertainty
- **UNKNOWN_UNKNOWN** - Speculation
- **NUMERIC (0-100)** - Optional percentage

Both entries are hashed. Confidence cannot be retroactively softened.

### Sealed Packet Architecture

Three-role adversarial verification:

1. **Generator** - Produces atomic claims with evidence from inputs
2. **Auditor** - Verifies output against original inputs (PASS/FAIL)
3. **Regenerator** - Rebuilds from scratch on failure (never patches)

Key rules:
- T0 Rule: Catches context bleed
- Fingerprinting: Detects input tampering
- Atomicity: No compound claims
- Evidence coupling: SUPPORTED needs quotes, NULL needs nothing

### AI Gatekeeper

Filters AI outputs before they reach users:

```javascript
const result = gatekeeperCheck(aiOutput, context);
// { allowed: true/false, reason: "...", confidence: 0.85 }
```

Blocks:
- Low-confidence outputs (below threshold)
- Hallucinated content (claims without evidence)
- Policy violations (PII, prohibited content)

Learning mode auto-tunes thresholds based on feedback.

### Regulatory Mapping

Auto-tags entries to compliance frameworks:

```javascript
const tags = autoTagContent(text, eventType);
// [{ framework: 'ISO_42001', clause: '6.1', title: 'Risk Assessment', confidence: 0.8 }]

const summary = getComplianceSummary('ISO_42001');
// { coveragePercent: 75, coveredClauses: [...], uncoveredClauses: [...] }
```

Supported frameworks:
- **ISO/IEC 42001:2023** - AI Management System (24 clauses)
- **EU AI Act** - European AI Regulation (20+ articles)
- **NIST AI RMF 1.0** - Risk Management Framework (GOVERN/MAP/MEASURE/MANAGE)

### Dashboard v3

Role-based command center with four views:

| View | Audience | Shows |
|------|----------|-------|
| BRIEFING | Everyone | "X changes since your last visit", prioritized actions |
| EXEC | Leadership | Status labels (Safe/Watch/Action), no raw numbers |
| COMPLIANCE | Compliance officers | Gap counts, blocked outputs, regulatory alerts |
| ENGINEER | Technical | Drift score, latency, error rate with thresholds |

### Workflow System

Built-in compliance templates:
- ISO 42001 AI Management System (12 steps)
- CalCompete Grant Application (10 steps)
- CA Residency Change (10 steps)
- EU AI Act Compliance (8 steps)

Features:
- Step dependencies (Step 5 blocked until Steps 1,2,3 complete)
- Document/evidence collection per step
- Gap analysis (what's missing and what it blocks)
- Deadline tracking with warnings

## Schema (14-17 columns)

| Column | Field |
|--------|-------|
| 1 | UUID |
| 2 | Timestamp |
| 3 | Actor |
| 4 | Event Type |
| 5 | Text |
| 6 | Gift |
| 7 | Prev Hash |
| 8 | Record Hash |
| 9 | Status |
| 10-13 | Citation fields |
| 14 | Citation Hash |
| 15 | Confidence_Level (optional) |
| 16 | Confidence_UUID (optional) |
| 17 | Confidence_Justification (optional) |

## Setup

1. Create a new Google Sheet
2. Open Extensions → Apps Script
3. Copy all `.gs` files into the project
4. Copy `DashboardHTML_v3.html` as an HTML file
5. Run `setupSheet()` to create the ledger structure
6. Run `setupLedgerSecret()` to set your hash secret (minimum 32 characters)
7. Optional: Set `GEMINI_API_KEY` in Script Properties for AI features
8. Optional: Deploy as web app for dashboard/API access

## File Structure

```
/
├── Code.gs                      # Main ledger logic
├── Newton_Confidence.gs         # Rumsfeld Protocol
├── Newton_SealedPacket.gs       # Adversarial verification
├── Newton_Gatekeeper.gs         # AI output filtering
├── Newton_GatekeeperBrain.gs    # Auto-tuning
├── Newton_Sentinel.gs           # Signal detection
├── Newton_Regulatory.gs         # Regulatory mapping
├── Newton_GapAnalysis.gs        # Gap identification
├── Newton_Workflow.gs           # Workflow engine
├── Newton_WorkflowUI.gs         # Workflow dashboard
├── Newton_WorkflowView.gs       # Workflow execution
├── Newton_Dashboard_v3.gs       # Command center
├── DashboardHTML_v3.html        # Dashboard frontend
├── Newton_Governance_CoPilot.gs # AI governance with mutations
├── Newton_API_Endpoint.gs       # External API
├── Newton_WebUI.gs              # Web interface
├── Newton_AIProxy.gs            # Gemini integration
├── Newton_MultiTenant.gs        # Tenant isolation
├── Newton_IRAC.gs               # Legal research folders
├── Newton_Verifier.gs           # Document verification
├── Newton_ModelCard.gs          # Model documentation
├── Newton_DetectionEngine.gs    # Pattern detection
├── Newton_Agent.gs              # Agent orchestration
├── Newton_AgentLogger.gs        # Agent logging
├── Newton_AgentPacket.gs        # Agent packets
├── Newton_TenantControlTower.gs # Tenant policies
├── Newton_AuditPackage.gs       # Audit export
├── Newton_ConfidencePlanner.gs  # Confidence planning
├── Newton_Demo.gs               # Demo scenarios
├── SEALED_PACKETS.md            # Prompt documentation
├── appsscript.json              # Apps Script manifest
└── README.md
```

## Use Cases

| Industry | What Gets Verified |
|----------|-------------------|
| AI Governance | Model outputs, confidence levels, drift detection |
| SEC/Finance | 10-K exhibits, certifications, MD&A |
| FDA/Pharma | IND/NDA sections, clinical protocols |
| Banking | AML/KYC, loan docs, disclosures |
| Legal | Discovery, privilege logs, IRAC research |
| Gov Contracting | FAR/DFARS, cost accounting |

## License

MIT

## Author

George Abrahamyants
[LinkedIn](https://www.linkedin.com/in/gabrahamyants/)
