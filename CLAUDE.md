# CLAUDE.md - Audit Ledger (BayComply Platform)

## Project Context
- **Repo**: audit-ledger (GitHub Pages subdirectory)
- **Live URL**: gugosf114.github.io/audit-ledger
- **API Backend**: Cloud Run at baycomply.com
- **Owner**: George Abrahamyants (Legal Technologist)
- **Focus**: California tax compliance workflows

## WORKFLOW TYPES

### 1. Residency Change (FTB Audit Defense)
- Track domicile change for high-net-worth individuals leaving CA
- 19 Bragg factors, Safe Harbor (R&TC 17014(d)), 183-day rule
- Defense-oriented: survive FTB residency audit

### 2. California Competes Tax Credit (CCTC)
- Track credit application and 8-year compliance lifecycle
- GO-Biz application + FTB books/records review
- Offense-oriented: win the credit, avoid recapture

## THE LEGAL FRAMEWORK (Know This Cold)

### 19 Bragg Factors (*Appeal of Bragg*, 2003)
The FTB uses these factors to determine domicile. Weight matters:
- **Highest**: Real property, family location, children's school, principal residence, voter registration, professional licenses, vehicle registration
- **Moderate**: Driver's license, bank accounts, financial transaction origin, professional service providers, organization memberships, investment property
- **Least**: Mailing address, phone number, mail receipt location
- **Corroborative**: Pet licenses, newspaper subscriptions, time spent in CA vs elsewhere

### Safe Harbor (R&TC 17014(d))
Conclusive presumption of nonresidency requires ALL THREE:
1. 546+ consecutive days outside California
2. ≤45 days in California during that period
3. <$200,000 California-source income

### Key Sources
- FTB RSTM 1030 (Domicile)
- FTB RSTM 1040 (Statutory Residency / 183-day rule)
- R&TC 17014 (Residency definitions)

## TECHNICAL ARCHITECTURE

### Frontend (index.html)
- Single-page app deployed to GitHub Pages
- localStorage for workflow state persistence
- SHA-256 hash chain verification in browser
- All features in one file (~5000+ lines)

### Backend (Cloud Run)
- API at baycomply.com
- Hash-chained entry storage
- Multi-tenant isolation

### Key Modules in index.html
| Module | Purpose |
|--------|---------|
| Day Counter | 183-day statutory residency tracking |
| Safe Harbor | 546-day, 45-day CA limit, $200K income tracking |
| Roadmap | 5-phase residency change timeline (18 tasks) |
| Bragg Grid | 19 factors with weight and evidence status |
| Address Timeline | Chronological residence history |
| Evidence Repository | Documents linked to Bragg factors |
| Realization Events | CA-source income event tracking |
| Third-Party Requests | Subpoenas, document demands |

## IRON LAWS

1. **Hash Chain Integrity**: Every entry must chain to the previous. Never break the chain.
2. **Confidence First**: Use Rumsfeld Protocol - declare confidence BEFORE logging content (KNOWN_KNOWN, KNOWN_UNKNOWN, UNKNOWN_UNKNOWN).
3. **Bragg Factor Mapping**: Every piece of evidence should link to one or more of the 19 factors.
4. **No Guessing Dates**: Timestamps matter for audit defense. Use actual dates, not approximations.
5. **Proactive Validation**: Run validation before declaring tasks done.

## WORKING WITH GEORGE

- **Communication**: Blunt, direct, zero corporate fluff.
- **Voice-to-Text**: Ignore speech patterns/typos; focus on core intent.
- **Push Back**: If George rabbit-holes on low-priority items, redirect to primary goal.
- **Session End**: Listen for "George out" or "Over and out."

## FILESYSTEM SCOPE
- Primary: `C:\Users\georg\Documents\GitHub\audit-ledger\`
- Related: `C:\Users\georg\Documents\GitHub\gugosf114.github.io\` (parent Pages repo)

## PRIORITY STACK

1. **Audit Defense First**: Features should make FTB audits survivable
2. **Evidence > UI Polish**: Functional evidence collection beats pretty dashboards
3. **Hash Chain > Everything**: Tamper-evidence is the core value proposition
4. **Practitioner Credibility**: UI should signal "we know Bragg, we know Safe Harbor"

---

## CALIFORNIA COMPETES TAX CREDIT (CCTC) FRAMEWORK

### Program Structure
- **Administered by**: GO-Biz (Governor's Office of Business and Economic Development)
- **Compliance Review**: FTB Books & Records (not a tax audit - contract compliance)
- **Term**: 5-year performance + 3-year maintenance = 8 years total
- **Risk**: Recapture (clawback) if milestones not maintained

### Phase I: Quantitative Screen
**Cost-Benefit Ratio** (lower is better):
```
Ratio = Credit Requested ÷ (Aggregate Employee Compensation + Aggregate Investment)
```
- Historical cutoffs vary: 0.03 to 1.9, but <0.08 is safer
- Top 200% (lowest ratios) advance to Phase II

### Automatic Phase II Advancement
Bypass ratio competition if:
1. **Flight Risk**: Project would occur in another state without credit
2. **High Need Location**: ≥75% of new FTEs work ≥75% time in High Poverty/Unemployment area

### Phase II: 14 Qualitative Factors
1. Jobs Created/Retained
2. Compensation (wages, benefits)
3. Investment (real/personal property)
4. Duration of commitment
5. Economic Impact
6. Strategic Importance
7. Opportunity for Growth
8. Extent of Poverty/Unemployment in location
9. In-State Incentives available
10. Out-of-State Incentives (flight risk verification)
11. Training opportunities
12. Benefit to State vs Benefit to Business
13. Influence of Credit on decision
14. Workforce Treatment & Fair Labor (includes relocation from discriminatory states)

### Key Calculations

**Annual Full-Time Equivalent (AFTE)**:
- Hourly: Total Hours ÷ 1,750 (max 1.0 per employee)
- Salaried: Total Weeks ÷ 50 (max 1.0 per employee)
- Must average ≥35 hours/week to count

**Aggregate Employee Compensation (AEC)**:
- 5-year cumulative W-2 wages for NET NEW employees only
- Excludes: bonuses, overtime, commissions, benefits, stock options

**Aggregate Investment**:
- Real Property: land, buildings, tenant improvements
- Personal Property: equipment, software, furniture
- Must be purchased AFTER application deadline

### Grant vs Credit Thresholds
Grant requires ONE of:
- ≥500 new full-time jobs
- ≥$10M infrastructure investment
- Located in High Unemployment/Poverty area

### Disqualifiers & Red Flags
- Related party transfers (parent→subsidiary doesn't count as "new")
- Pre-application investments (timing matters)
- Part-time aggregation (cannot combine 2 PT to equal 1 FT)
- Base Year manipulation (understating to inflate "net increase")
- Wage definition violations (including bonuses/benefits in "wages")
- Material litigation or labor/environmental violations (10 years)

### Compliance Calendar
| When | Action |
|------|--------|
| Application Window | Submit online (July, Jan, March windows) |
| Within 30 days of approval | Designate contact person |
| 1st day of 4th month after Tax Year End | Annual Compliance Certification to GO-Biz |
| Tax Return Filing | Claim credit via Form FTB 3531 |
| Within 30 days of FTB IDR | Respond to Information Document Request |
| Years 6-8 | Maintenance certification (avoid recapture) |

### FTB Documentation Requirements
**Jobs**: Payroll registers, I-9, W-2, W-4, offer letters, pay stubs
**Investment**: Invoices, cancelled checks, lease agreements, general ledger
**Site**: Deed, utility bills (proof of operations)
**AFTE Schedule**: Employee list with hire date, term date, hours/weeks per tax year

### Application Windows (FY 2025-26)
- July 21, 2025 – August 11, 2025
- January 5, 2026 – January 26, 2026
- March 2, 2026 – March 16, 2026

### Key Sources
- CalCompetes Application Guide
- FTB Form 3531 Instructions
- GO-Biz Allocation Agreements (Snapchat, Atomic Machines precedents)
- FTB Books & Records Review Protocol
