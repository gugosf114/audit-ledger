# BayComply Technical Specification

## Executive Summary

Rebuild the Newton AI Governance Platform on enterprise-grade infrastructure (Google Cloud) to make it sellable to real customers.

**Current State:** Google Sheets + Apps Script (not enterprise-credible)
**Target State:** Cloud SQL + Cloud Run + Firebase Auth (enterprise-ready)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
│                   (Same Newton_App.html)                        │
│                   Hosted on Cloud Run                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FIREBASE AUTH                               │
│              - Email/Password                                    │
│              - Google SSO                                        │
│              - Enterprise SAML/OIDC (paid tier)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLOUD RUN API                               │
│                   Node.js / TypeScript                          │
│                                                                  │
│  Endpoints:                                                      │
│  - POST /api/ledger/entry        (create audit entry)           │
│  - GET  /api/ledger              (read entries)                 │
│  - POST /api/gatekeeper/check    (AI output validation)         │
│  - GET  /api/compliance/:framework (regulatory coverage)        │
│  - POST /api/workflow/start      (start workflow)               │
│  - GET  /api/dashboard/:role     (role-based metrics)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌───────────────────────┐   ┌───────────────────────┐
│      CLOUD SQL        │   │       BIGQUERY        │
│     (PostgreSQL)      │   │   (Immutable Mirror)  │
│                       │   │                       │
│  - audit_entries      │──▶│  - audit_log_archive  │
│  - workflows          │   │    (append-only)      │
│  - users              │   │                       │
│  - tenants            │   └───────────────────────┘
│  - confidence_decl    │
│  - gatekeeper_events  │
└───────────────────────┘
            │
            ▼
┌───────────────────────┐
│    CLOUD STORAGE      │
│                       │
│  - Evidence documents │
│  - Exported reports   │
│  - Hash snapshots     │
└───────────────────────┘
```

---

## Database Schema (Cloud SQL - PostgreSQL)

### Core Tables

```sql
-- Tenants (multi-tenant isolation)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    settings JSONB DEFAULT '{}'
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    email VARCHAR(255) NOT NULL UNIQUE,
    firebase_uid VARCHAR(255) UNIQUE,
    role VARCHAR(50) DEFAULT 'viewer', -- admin, compliance, engineer, viewer
    created_at TIMESTAMP DEFAULT NOW()
);

-- Audit Ledger (CORE - tamper-evident)
CREATE TABLE audit_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) NOT NULL,
    sequence_num BIGSERIAL,  -- Monotonic sequence per tenant
    timestamp TIMESTAMP DEFAULT NOW(),
    actor VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    content TEXT,
    metadata JSONB DEFAULT '{}',

    -- Hash chain
    prev_hash VARCHAR(64),
    record_hash VARCHAR(64) NOT NULL,

    -- Confidence (Rumsfeld Protocol)
    confidence_level VARCHAR(50),  -- KNOWN_KNOWN, KNOWN_UNKNOWN, UNKNOWN_UNKNOWN
    confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
    confidence_justification TEXT,

    -- Regulatory tagging
    regulatory_tags JSONB DEFAULT '[]',  -- [{framework, clause, confidence}]

    -- Status
    status VARCHAR(50) DEFAULT 'FINAL',

    -- Immutability enforcement
    created_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_sequence_per_tenant UNIQUE (tenant_id, sequence_num)
);

-- CRITICAL: Prevent updates and deletes on audit_entries
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit entries cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_update_audit
    BEFORE UPDATE ON audit_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER no_delete_audit
    BEFORE DELETE ON audit_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Confidence Declarations (pre-commit)
CREATE TABLE confidence_declarations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    declared_by VARCHAR(255) NOT NULL,
    confidence_level VARCHAR(50) NOT NULL,
    domain VARCHAR(100),
    score INTEGER,
    declared_at TIMESTAMP DEFAULT NOW(),
    used_at TIMESTAMP,
    linked_entry_id UUID REFERENCES audit_entries(id)
);

-- Gatekeeper Events
CREATE TABLE gatekeeper_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    timestamp TIMESTAMP DEFAULT NOW(),
    input_hash VARCHAR(64),
    decision VARCHAR(20) NOT NULL,  -- ALLOWED, BLOCKED
    reason VARCHAR(255),
    confidence_score NUMERIC(5,4),
    signals JSONB DEFAULT '[]',
    cost_avoidance INTEGER DEFAULT 0
);

-- Workflows
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    template_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    step_number INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'PENDING',
    dependencies INTEGER[] DEFAULT '{}',
    evidence_required BOOLEAN DEFAULT FALSE,
    evidence_uploaded JSONB DEFAULT '[]',
    completed_by VARCHAR(255),
    completed_at TIMESTAMP
);

-- Sealed Packets (adversarial verification)
CREATE TABLE sealed_packets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    created_at TIMESTAMP DEFAULT NOW(),

    -- Generator output
    generator_claims JSONB NOT NULL,
    generator_hash VARCHAR(64) NOT NULL,

    -- Auditor verification
    auditor_verdict VARCHAR(20),  -- PASS, FAIL, PENDING
    auditor_notes TEXT,
    audited_at TIMESTAMP,

    -- Regenerator (if failed)
    regenerator_claims JSONB,
    regenerator_hash VARCHAR(64),
    regenerated_at TIMESTAMP,

    -- Final status
    status VARCHAR(50) DEFAULT 'PENDING'
);
```

### Indexes

```sql
CREATE INDEX idx_audit_tenant_time ON audit_entries(tenant_id, timestamp DESC);
CREATE INDEX idx_audit_event_type ON audit_entries(event_type);
CREATE INDEX idx_audit_regulatory ON audit_entries USING GIN(regulatory_tags);
CREATE INDEX idx_gatekeeper_tenant ON gatekeeper_events(tenant_id, timestamp DESC);
CREATE INDEX idx_workflow_tenant ON workflows(tenant_id, status);
```

---

## API Endpoints (Cloud Run)

### Authentication
All endpoints require Firebase Auth JWT in header:
```
Authorization: Bearer <firebase_jwt>
```

### Audit Ledger

```
POST /api/ledger/entry
Body: {
    actor: string,
    event_type: string,
    content: string,
    confidence_level?: string,
    confidence_score?: number,
    confidence_justification?: string,
    metadata?: object
}
Response: { id, sequence_num, record_hash, timestamp }

GET /api/ledger
Query: ?limit=100&offset=0&event_type=&start_date=&end_date=
Response: { entries: [...], total: number, verified: boolean }

GET /api/ledger/verify
Response: { valid: boolean, rows_checked: number, first_broken_at?: number }
```

### Gatekeeper

```
POST /api/gatekeeper/check
Body: {
    content: string,
    context?: object,
    source?: string
}
Response: {
    allowed: boolean,
    reason: string,
    confidence: number,
    signals: string[],
    cost_avoidance: number
}
```

### Compliance

```
GET /api/compliance/:framework
Params: framework = ISO_42001 | EU_AI_ACT | NIST_AI_RMF
Response: {
    framework: string,
    coverage_percent: number,
    covered_clauses: string[],
    gap_clauses: string[],
    partial_clauses: string[],
    entries_by_clause: { [clause]: number }
}

POST /api/compliance/gap-workflow
Body: { framework: string, clause_id: string }
Response: { workflow_id: string, success: boolean }
```

### Dashboard

```
GET /api/dashboard/:role
Params: role = briefing | exec | compliance | engineer
Response: {
    // Role-specific metrics
    chain_integrity: { verified, rows, last_check },
    economic_impact: { total, breakdown },
    priority_alert: { message, safe, action },
    active_workflows: number,
    // Role-specific additional data
    ...
}
```

### Workflows

```
GET /api/workflows
Response: { workflows: [...] }

POST /api/workflows
Body: { template_id: string, name?: string }
Response: { workflow_id, steps: [...] }

PATCH /api/workflows/:id/steps/:step_number
Body: { status: string, evidence?: object }
Response: { success: boolean }
```

---

## Security Model

### Authentication
- Firebase Auth handles all user authentication
- Supports email/password, Google SSO
- Enterprise tier: SAML/OIDC for corporate SSO

### Authorization
- Row-level security via tenant_id
- Role-based access control (RBAC):
  - **admin**: Full access, manage users
  - **compliance**: Read all, write entries, manage workflows
  - **engineer**: Read all, write entries
  - **viewer**: Read only

### Audit Immutability
1. **Database triggers** prevent UPDATE/DELETE on audit_entries
2. **BigQuery mirror** provides independent append-only copy
3. **Hash chain** detects any tampering that bypasses triggers
4. **Periodic snapshots** to Cloud Storage with checksums

### Data Isolation
- All queries filtered by tenant_id
- Cloud SQL IAM restricts direct database access
- API validates tenant ownership on every request

---

## BigQuery Immutable Mirror

```sql
-- BigQuery table (append-only by design)
CREATE TABLE baycomply.audit_log_archive (
    id STRING,
    tenant_id STRING,
    sequence_num INT64,
    timestamp TIMESTAMP,
    actor STRING,
    event_type STRING,
    content STRING,
    prev_hash STRING,
    record_hash STRING,
    confidence_level STRING,
    regulatory_tags STRING,  -- JSON string
    ingested_at TIMESTAMP
)
PARTITION BY DATE(timestamp)
CLUSTER BY tenant_id;
```

Cloud Function triggers on Cloud SQL insert → writes to BigQuery.

---

## Deployment

### Infrastructure (Terraform/Pulumi)
```
- GCP Project: baycomply-prod
- Region: us-central1 (or customer-preferred)
- Cloud SQL: db-f1-micro (scale as needed)
- Cloud Run: 1 vCPU, 512MB (auto-scales)
- Firebase: Blaze plan (pay as you go)
```

### CI/CD
- GitHub Actions
- On push to main → deploy to staging
- Manual approval → deploy to prod

### Domain
- baycomply.com → Cloud Run service
- Custom domain via Cloud Run domain mapping (no iframe/masking needed)

---

## Cost Estimate (Monthly)

| Service | Estimate |
|---------|----------|
| Cloud SQL (db-f1-micro) | $10-30 |
| Cloud Run | $0-50 (scales with usage) |
| BigQuery | $0-20 (first 1TB free) |
| Cloud Storage | $1-5 |
| Firebase Auth | Free tier covers 50k MAU |
| **Total** | **~$50-100/month to start** |

---

## Migration Path

### Phase 1: Infrastructure Setup
1. Create GCP project
2. Enable APIs (Cloud SQL, Cloud Run, Firebase, BigQuery)
3. Set up Cloud SQL instance
4. Run database migrations
5. Deploy Cloud Run service (empty shell)
6. Configure Firebase Auth
7. Point baycomply.com to Cloud Run

### Phase 2: Port Core Logic
1. Port hash chain logic (Code.gs → TypeScript)
2. Port Gatekeeper (Newton_Gatekeeper.gs → TypeScript)
3. Port Confidence/Rumsfeld (Newton_Confidence.gs → TypeScript)
4. Port Regulatory mapping (Newton_Regulatory.gs → TypeScript)
5. Port Workflows (Newton_Workflow.gs → TypeScript)

### Phase 3: Frontend Update
1. Update Newton_App.html to call Cloud Run API
2. Add Firebase Auth login flow
3. Remove google.script.run calls
4. Test all features

### Phase 4: Production Hardening
1. Set up BigQuery mirror
2. Add monitoring/alerting (Cloud Monitoring)
3. Load testing
4. Security review
5. SOC 2 readiness checklist

---

## What This Fixes

| Original Problem | How It's Fixed |
|------------------|----------------|
| Spreadsheet as database | Cloud SQL (PostgreSQL) |
| Anyone can delete data | Database triggers + BigQuery mirror |
| No real auth | Firebase Auth with SSO |
| Apps Script credibility | Cloud Run (enterprise standard) |
| No uptime SLA | GCP 99.95% SLA |
| SOC 2 concerns | GCP is SOC 2 certified |

---

## Open Questions for George

1. **Multi-tenant from day 1?** Or single-tenant initially?
2. **Gemini API for Gatekeeper?** Keep using it, or switch to Claude/OpenAI?
3. **Pricing model?** Per-seat, per-entry, flat rate?
4. **First customer target?** SMB, mid-market, enterprise?

---

## Next Steps

1. George reviews and approves this spec
2. Create GCP project and enable services
3. Run database migrations
4. Begin porting Code.gs → TypeScript
5. Ship MVP to baycomply.com

