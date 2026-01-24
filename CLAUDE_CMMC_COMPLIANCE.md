# CLAUDE.md - CMMC/NIST 800-171 Compliance Tracking

## Framework Overview

This compliance tracking application implements the **CMMC Level 2** framework based on **NIST SP 800-171 Revision 2**, which contains **110 security controls** organized into **14 control families** with **320 assessment objectives**.

### Regulatory Context
- **CMMC Final Rule Effective**: December 16, 2024
- **Acquisition Rule Effective**: November 10, 2025
- **NIST Rev 2 Status**: Withdrawn by NIST but required via DoD class deviation
- **Current Enforcement**: DoD contractors must comply with Rev 2 indefinitely per DFARS 252.204-7012

---

## Control Family Reference

| ID | Family Name | Abbrev | Controls | Point Range |
|----|-------------|--------|----------|-------------|
| 3.1 | Access Control | AC | 22 | 1-5 |
| 3.2 | Awareness and Training | AT | 3 | 3 |
| 3.3 | Audit and Accountability | AU | 9 | 1-5 |
| 3.4 | Configuration Management | CM | 9 | 1-5 |
| 3.5 | Identification and Authentication | IA | 11 | 1-5 |
| 3.6 | Incident Response | IR | 3 | 3-5 |
| 3.7 | Maintenance | MA | 6 | 1-5 |
| 3.8 | Media Protection | MP | 9 | 1-5 |
| 3.9 | Personnel Security | PS | 2 | 3-5 |
| 3.10 | Physical Protection | PE | 6 | 1-5 |
| 3.11 | Risk Assessment | RA | 3 | 5 |
| 3.12 | Security Assessment | CA | 4 | 5 |
| 3.13 | System and Communications Protection | SC | 16 | 1-5 |
| 3.14 | System and Information Integrity | SI | 7 | 3-5 |
| **Total** | | | **110** | |

---

## Scoring Model

### Point Values
- **5 Points**: High-impact controls - NO POA&M allowed
- **3 Points**: Moderate-impact controls - NO POA&M allowed
- **1 Point**: Lower-impact controls - POA&M eligible

### Assessment Scoring
- **Maximum Score**: 110 points
- **Minimum Passing Score**: 88 points (80%)
- **Score Formula**: Start at 110, subtract point values for NOT MET controls
- **Automatic Fail**: Score below 88

### POA&M Eligibility
- Only controls worth **1 point** may be placed on POA&M
- **Exception**: SC.L2-3.13.11 (CUI Encryption) can be on POA&M if encryption is used but not FIPS-validated
- **Closeout Period**: 180 days from Conditional CMMC Status Date
- POA&M items must be remediated and verified by C3PAO within this window

---

## CMMC Level Comparison

### Level 1 (Foundational)
- **Controls**: 17 (FAR 52.204-21)
- **Data**: Federal Contract Information (FCI)
- **Assessment**: Self-assessment only
- **POA&M**: Not permitted
- **Cost**: $4,000 - $15,000
- **Timeline**: 4-8 weeks

### Level 2 (Advanced)
- **Controls**: 110 (NIST SP 800-171 Rev 2)
- **Data**: Controlled Unclassified Information (CUI)
- **Assessment**: Third-party C3PAO required
- **POA&M**: Permitted for 1-point controls
- **Cost**: $50,000 - $200,000+
- **Timeline**: 6-12 months
- **Validity**: 3 years (annual re-affirmation)

### Level 3 (Expert)
- **Controls**: 134 (NIST 800-171 + 800-172)
- **Data**: High-risk CUI / Critical Programs
- **Assessment**: Government-led DIBCAC
- **Prerequisite**: Must hold Level 2 certification
- **Timeline**: 12-18 months

---

## System Security Plan (SSP) Structure

### Required Sections
1. **System Identification** - Name, description, unique identifiers
2. **System Categorization** - CUI categories and data classification
3. **System Owner Information** - Contacts for owner and security personnel
4. **Authorization Boundary** - Scope and boundary definitions
5. **Network Architecture** - Network diagrams showing CUI flow
6. **System Environment** - Hardware/software/firmware inventory
7. **System Interconnections** - External connections and third parties
8. **Security Control Implementation** - All 110 controls with status
9. **Roles and Responsibilities** - Information Owner, System Owner, SSO
10. **Asset Inventory** - Categorized asset listing

### Asset Categories
- **CUI Assets**: Systems that process, store, or transmit CUI
- **Security Protection Assets**: Systems providing security services
- **Contractor Risk Managed Assets**: Assets with limited CUI exposure
- **Specialized Assets**: IoT, OT, GFE, restricted systems
- **Out-of-Scope Assets**: No CUI connection

---

## POA&M Requirements

### Required Fields
- Control ID and description
- POA&M item unique identifier
- Weakness/gap description
- Risk rating
- Responsible party
- Planned remediation actions
- Required resources (budget, personnel)
- Milestone dates
- Status tracking
- Completion evidence

### Timeline Rules
- **180-Day Closeout**: All POA&M items must be remediated within 180 days
- **Closeout Assessment**: Required by authorized C3PAO
- **Failure Consequence**: Conditional CMMC Status expires

### Best Practices
- Monthly or bi-weekly progress reviews
- Detailed remediation plans per item
- Realistic milestone setting
- Resource pre-allocation
- Evidence collection during remediation

---

## C3PAO Assessment Process

### Assessment Steps
1. **SSP Review** - First document reviewed for completeness
2. **Evidence Collection** - Gather artifacts for 320 objectives
3. **On-Site Assessment** - Physical and logical inspection
4. **Personnel Interviews** - Key stakeholder discussions
5. **Technical Validation** - Configuration and system testing
6. **Physical Security Review** - Facility inspection
7. **Final Findings Briefing** - Results presentation
8. **SPRS Score Submission** - Official score posting

### Evidence Types Expected
| Type | Examples |
|------|----------|
| Documentary | Policies, procedures, plans, reports |
| Demonstrative | Screenshots, configurations, exports |
| Operational | Logs, records, audit trails |
| Interview | Verbal responses from personnel |

### Independence Requirement
C3PAOs maintain strict independence - they identify compliance gaps but CANNOT provide consulting advice on how to remediate. This is a hard separation.

---

## Evidence Organization

### Recommended Folder Structure
```
/CMMC_Evidence
  /3.1_Access_Control
    /3.1.1_Authorized_Access
      - Policy_AccessControl_v2.1.pdf
      - AD_Config_Export_2026Q1.xlsx
      - User_Access_Review_2026Q1.pdf
    /3.1.2_Transaction_Control
      - RBAC_Matrix.xlsx
      - GPO_Export_Permissions.html
  /3.2_Awareness_Training
    /3.2.1_Security_Awareness
      - Training_Policy.pdf
      - LMS_Completion_Report.csv
  ...
```

### Naming Convention
`{ControlID}_{Description}_{Date/Version}.{ext}`

Example: `3.1.1_User_Provisioning_SOP_v1.2.docx`

### Evidence Checklist Per Control
- [ ] Policy document
- [ ] Detailed procedures/SOP
- [ ] Technical configuration evidence
- [ ] Operational logs/records
- [ ] Periodic review documentation

---

## High-Priority Controls (5-Point)

These controls are critical and cannot be on POA&M:

### Access Control (AC)
- 3.1.1, 3.1.2, 3.1.3, 3.1.5, 3.1.7, 3.1.19

### Audit and Accountability (AU)
- 3.3.1, 3.3.2

### Configuration Management (CM)
- 3.4.1, 3.4.2

### Identification and Authentication (IA)
- 3.5.1, 3.5.2, 3.5.3, 3.5.10

### Incident Response (IR)
- 3.6.1, 3.6.2

### Maintenance (MA)
- 3.7.5

### Media Protection (MP)
- 3.8.1, 3.8.2, 3.8.3, 3.8.6, 3.8.9

### Personnel Security (PS)
- 3.9.2

### Physical Protection (PE)
- 3.10.1, 3.10.2

### Risk Assessment (RA)
- 3.11.1, 3.11.2, 3.11.3

### Security Assessment (CA)
- 3.12.1, 3.12.2, 3.12.3, 3.12.4

### System and Communications Protection (SC)
- 3.13.1, 3.13.2, 3.13.5, 3.13.8, 3.13.11, 3.13.16

### System and Information Integrity (SI)
- 3.14.1, 3.14.2, 3.14.4, 3.14.6

---

## Common Evidence Types by Family

### Access Control (3.1)
- Access control policies
- User account configurations (AD/IAM exports)
- RBAC matrices and permission documentation
- VPN/remote access configurations
- Session timeout settings
- Mobile device management (MDM) policies
- DLP configurations

### Awareness and Training (3.2)
- Training policy and curriculum
- LMS completion reports
- Role-based training matrices
- Insider threat training materials
- Training attendance records

### Audit and Accountability (3.3)
- Audit logging policy
- SIEM configurations and rules
- Sample audit logs
- Log retention settings
- NTP server configurations
- Alert notification rules

### Configuration Management (3.4)
- Baseline configuration documents
- Hardware/software inventories
- Change management records (CAB minutes)
- Security impact analyses
- Hardening standards (CIS/STIG)
- Application control configurations

### Identification and Authentication (3.5)
- Authentication policies
- MFA enrollment records
- Password policy configurations
- Account lifecycle procedures
- Service account inventory

### Incident Response (3.6)
- Incident response plan
- IR playbooks
- Tabletop exercise records
- Incident tracking system
- After-action reports

### Maintenance (3.7)
- Maintenance policies and schedules
- Approved tools list
- Sanitization procedures
- Remote maintenance MFA configurations

### Media Protection (3.8)
- Media handling policy
- Encryption configurations
- Sanitization/destruction certificates
- CUI marking templates
- Transport chain of custody forms

### Personnel Security (3.9)
- Background check policy
- Screening procedures
- Termination checklists
- Access revocation evidence

### Physical Protection (3.10)
- Physical access policy
- Badge system documentation
- Visitor logs
- Security camera/alarm documentation
- Alternate work site security

### Risk Assessment (3.11)
- Risk assessment policy
- Risk register
- Vulnerability scan reports
- Remediation tracking

### Security Assessment (3.12)
- Security assessment plans/reports
- POA&M document
- Continuous monitoring plan
- System Security Plan (SSP)

### System and Communications Protection (3.13)
- Network architecture diagrams
- Firewall configurations
- Encryption configurations (FIPS evidence)
- VPN settings
- DMZ documentation
- Key management procedures

### System and Information Integrity (3.14)
- Patch management policy
- Anti-malware configurations
- Vulnerability tracking
- SIEM monitoring dashboards
- Security advisory subscriptions

---

## Key Dates and Milestones

| Date | Event |
|------|-------|
| December 16, 2024 | CMMC Final Rule effective |
| November 10, 2025 | Acquisition rule takes effect |
| Ongoing | DoD class deviation requires NIST 800-171 Rev 2 |
| 3-year cycle | Certification validity period |
| Annual | Re-affirmation requirement |
| 180 days | POA&M closeout window |

---

## Data Model Reference

The complete control schema is available in:
`C:\Users\georg\Documents\GitHub\audit-ledger\CMMC_NIST_800-171_SCHEMA.json`

### Schema Structure
```json
{
  "control_families": [
    {
      "id": "3.1",
      "name": "Access Control",
      "controls": [
        {
          "control_id": "3.1.1",
          "cmmc_id": "AC.L2-3.1.1",
          "title": "...",
          "requirement": "...",
          "type": "Basic|Derived",
          "point_value": 1|3|5,
          "evidence_types": ["..."]
        }
      ]
    }
  ]
}
```

---

## Sources

- [NIST SP 800-171 Rev 2](https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final)
- [CMMC Assessment Guide Level 2](https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL2.pdf)
- [DoD CMMC Information](https://dodcio.defense.gov/cmmc/About/)
- [CSF Tools NIST 800-171 Reference](https://csf.tools/reference/nist-sp-800-171/r2/)
- [32 CFR Part 170 - CMMC Program](https://www.federalregister.gov/documents/2024/10/15/2024-22905/cybersecurity-maturity-model-certification-cmmc-program)
