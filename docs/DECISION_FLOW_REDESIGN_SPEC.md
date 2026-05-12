# Decision Flow Redesign Spec

## Vision

The decision flow is a consulting engagement. An AI analyst researches
a problem, presents findings to the decision maker, asks targeted
questions, then comes back with tailored solutions and an execution plan.

This is NOT software-specific. Decisions can be anything:
- What platform should we use?
- Should we build or buy?
- Should we hire this person?
- Which vendor do we go with?
- Should we enlist this client?
- How should we restructure the team?

The system must be completely domain-agnostic.

## Flow (Single Path)

There is ONE flow. "Classic mode" is just step 0 (research).
"Guided mode" is the full engagement. There is no alternative path.

```
user enters prompt
  |
  v
STEP 0: RESEARCH (async, job-runner)
  AI investigates. reads codebase if relevant, searches web if
  relevant, reasons about the problem. produces the BRIEF.
  NO options. NO recommendation. just the brief.
  |
  v
ROUND 1: THE BRIEF + QUESTIONS (presentation to decision maker)
  slide 1: "here's the situation" - headline + key findings
  slide 2: "here's what we found" - details, sources, impact
  slide 3: "here's what we need from you" - tradeoff questions
  user answers each question (binary A/B cards)
  |
  v
ROUND 2: OPTIONS (async, job-runner)
  AI takes brief + preference answers, generates 4 tailored options.
  presented as another set of slides.
  user picks one.
  |
  v
ROUND 3: PLAN (async, job-runner)
  AI generates execution plan for selected option.
  task tree with phases, dependencies, estimates.
  user approves -> creates tasks (native sqlite).
```

### Auto Mode

AI answers its own tradeoff questions based on what it learned
during research. Skips human input. Goes straight from
brief -> options -> plan. For when the boss says "just handle it."

The auto mode preference answers should include rationale for
each choice so the decision maker can review WHY the AI chose
what it chose.

## Template Redesign

### Principles

1. AGNOSTIC: never assume software. the prompt might be about
   hiring, vendor selection, market entry, anything.

2. EXAMPLES ARE THE QUALITY BAR: the model will produce output
   that matches the quality and depth of the examples. if the
   example has 2 sentences, you get 2 sentences. if the example
   has a paragraph with specific reasoning, you get that.

3. TWO LAYERS: every template produces both:
   - data layer: full structured data for the next AI round
   - presentation layer: human-readable copy for the slides

4. CONTEXT FLOWS FORWARD: every round gets the FULL context
   from all previous rounds. nothing gets dropped.

### Template 1: Research (Step 0)

Purpose: investigate the problem, produce the brief.
NO options. NO recommendation.

```
You are a senior analyst conducting research for a decision briefing.
Your job is to deeply understand the problem, gather evidence, and
prepare a comprehensive brief that a decision maker can act on.

USER REQUEST:
{{USER_PROMPT}}

RESEARCH INSTRUCTIONS:
1. Understand what the user is actually deciding. What's the real
   question behind the question?
2. Investigate thoroughly. If this involves code, read the relevant
   files. If this involves external tools or services, research them.
3. Identify the stakeholders, constraints, and risks.
4. Map out what areas are affected and why this matters.
5. Find specific evidence - file paths, documentation, data points,
   market information, whatever is relevant.

DO NOT generate options or recommendations. Your job is ONLY to
understand the problem and prepare the brief.

Output ONLY valid JSON matching this schema:

{
  "title": "clear, specific title (not the user's raw input - refined)",
  "priority": "p0|p1|p2|p3|p4",
  "category": "category that fits the decision domain",
  "brief": {
    "headline": "one sentence that captures the core decision",
    "situation": "2-4 sentences describing the current state of things",
    "problem": "2-4 sentences on what specifically needs to be decided and why now",
    "impact": "what happens if we get this wrong, what happens if we get this right",
    "scope": "who and what is affected"
  },
  "context": {
    "problem": "detailed problem statement",
    "currentState": "how things work or stand right now",
    "whyProblem": "why this matters - business impact, risk, opportunity cost",
    "affectedAreas": ["area 1", "area 2"],
    "constraints": ["constraint 1", "constraint 2"],
    "references": ["specific sources, file paths, URLs, data points"]
  }
}

EXAMPLE 1 (software architecture decision):

User input: "should we keep using sqlite or move to postgres for the auth system"

{
  "title": "Auth database migration: SQLite to PostgreSQL evaluation",
  "priority": "p2",
  "category": "infrastructure",
  "brief": {
    "headline": "The auth system runs on SQLite which works for single-server deployment but won't survive horizontal scaling or concurrent write loads beyond ~50 req/s.",
    "situation": "The platform currently uses better-sqlite3 for authentication, storing sessions, users, and org membership in a single auth.db file. This was chosen for simplicity during early development and works well for the current single-server setup. A managed PostgreSQL option is available for production deployments.",
    "problem": "As the platform moves toward multi-tenant SaaS with multiple server instances, SQLite becomes a bottleneck. It doesn't support concurrent writers, can't be shared across instances, and backup/restore requires file-level operations. The question isn't whether to migrate eventually - it's whether to migrate now or defer until scaling pressure forces it.",
    "impact": "Getting this wrong means either: (a) migrating under pressure during a scaling crisis with data at risk, or (b) investing engineering time now that could go toward features, on a migration that might not be needed for 6+ months. The auth database is the most sensitive data store - a botched migration means users can't log in.",
    "scope": "Auth system, session management, org membership, all API routes that touch user identity. Every authenticated request hits this database."
  },
  "context": {
    "problem": "SQLite auth.db handles ~50 concurrent writes/sec max. Multi-instance deployment requires shared database. Current backup strategy is file copy which requires downtime.",
    "currentState": "Single auth.db file at ~/.mentiko/data/auth.db, accessed via better-sqlite3 synchronous API. ~12 tables covering users, sessions, accounts, organizations, members. Production can run as a single instance, while managed deployments may already use PostgreSQL.",
    "whyProblem": "Platform roadmap includes multi-tenant isolation with per-tenant compute. This requires either shared auth database (PostgreSQL) or distributed auth (JWT-only). Current architecture assumes single-file database locality. Migration cost increases with data volume - easier now with <1000 users than later with 50k.",
    "affectedAreas": [
      "~/.mentiko/data/auth.db - the database file itself",
      "web/lib/auth.ts - better-auth configuration and schema",
      "web/middleware.ts - session validation on every request",
      "All API routes using checkAuth() - ~40 endpoints",
      "Docker deployment - needs PostgreSQL container",
      "Backup/restore procedures"
    ],
    "constraints": [
      "Zero-downtime migration required - users cannot be locked out",
      "better-auth must support the target database (it supports both)",
      "Local development must remain simple (no mandatory PostgreSQL install)",
      "Session tokens must survive the migration (no mass logout)",
      "Managed PostgreSQL is available - could use a shared service or run a separate instance"
    ],
    "references": [
      "web/lib/auth.ts - current better-auth SQLite configuration",
      "~/.mentiko/data/auth.db - production database (12 tables, ~800KB)",
      "docker-compose.production.yml - current production stack",
      "managed PostgreSQL deployment docs",
      "better-auth docs: https://www.better-auth.com/docs/adapters"
    ]
  }
}

EXAMPLE 2 (business/hiring decision):

User input: "should we hire a dedicated devops engineer or keep using the founding team for infrastructure"

{
  "title": "DevOps hire vs founding team infrastructure ownership",
  "priority": "p2",
  "category": "hiring",
  "brief": {
    "headline": "Infrastructure work is consuming ~30% of the founding engineers' time, but a full-time DevOps hire at current burn rate means 4 fewer months of runway.",
    "situation": "The three founding engineers currently split infrastructure duties - deployments, monitoring, incident response, and scaling. This worked when the platform had 20 users and deployed weekly. Now with 200+ users, daily deploys, and two production environments, infra work is eating into feature development time. Last month, 47 of 160 engineering hours went to infrastructure tasks.",
    "problem": "The founding team is context-switching between feature work and infrastructure firefighting. Neither gets full attention. Deploys are manual and error-prone (3 incidents last quarter from deployment mistakes). But hiring means $150-180k/year fully loaded, which at current burn rate shortens runway from 14 months to 10 months. The question is whether the productivity gain from freeing up founding engineers justifies the runway cost.",
    "impact": "If we hire: founding engineers recover ~50 hours/month for feature work, deploys become reliable, monitoring improves. If we don't: feature velocity continues declining as infra complexity grows, risk of major outage increases, founding team burns out. If we hire wrong: we spend 3 months onboarding, the person doesn't work out, we've burned $45k and still have the same problem.",
    "scope": "All engineering output, deployment reliability, production uptime, team morale, company runway, hiring pipeline."
  },
  "context": {
    "problem": "Infrastructure is no longer a side task - it's a full workload being handled part-time by people whose core value is product development. The opportunity cost is features not shipped and technical debt accumulating.",
    "currentState": "3 founding engineers each spend ~10 hrs/week on infra. Manual deploys via SSH + docker compose. Monitoring is basic (uptime checks + manual log review). No IaC, no CI/CD pipeline, no automated rollbacks. Production infrastructure is split across management and platform services.",
    "whyProblem": "Every hour a $200/hr founding engineer spends on routine deploys is an hour not spent on the product that generates revenue. Infrastructure complexity grows with user count - this problem gets worse, not better. The team is already showing signs of burnout from context-switching.",
    "affectedAreas": [
      "Engineering velocity - feature output per sprint",
      "Production reliability - deploy success rate, MTTR",
      "Company runway - cash burn rate vs remaining funding",
      "Team morale - founding engineers doing work below their skill level",
      "Hiring pipeline - recruiting, interviewing, onboarding costs"
    ],
    "constraints": [
      "Current runway: 14 months at $85k/month burn",
      "Next funding round planned in 8 months",
      "DevOps market rate: $150-180k/year fully loaded in US",
      "Alternative: contractor at $100-150/hr for specific projects",
      "Founding engineers unwilling to fully hand off infra without trust built"
    ],
    "references": [
      "Last quarter incident reports: 3 deploy-related outages",
      "Time tracking data: 47/160 engineering hours on infra (March 2026)",
      "Current infra: single VPS, Docker Compose, manual SSH deploys",
      "Comparable startup benchmarks: first DevOps hire typically at $2-5M ARR"
    ]
  }
}

EXAMPLE 3 (vendor/platform selection):

User input: "evaluate switching from stripe to lemonsqueezy for payment processing"

{
  "title": "Payment processor evaluation: Stripe vs LemonSqueezy",
  "priority": "p3",
  "category": "vendor",
  "brief": {
    "headline": "Stripe handles everything but costs us ~15 hours/month in tax compliance overhead that LemonSqueezy would eliminate as a Merchant of Record, but migrating means rebuilding the billing integration and losing Stripe's ecosystem.",
    "situation": "The platform uses Stripe for subscription billing, processing ~$12k MRR across 180 paying customers. Stripe works well for payment processing but requires us to handle sales tax, VAT, and invoicing compliance ourselves. We currently use a cobbled-together setup of Stripe + TaxJar + manual quarterly filings. LemonSqueezy is a Merchant of Record (MoR) that handles all tax compliance, but has a smaller ecosystem and higher per-transaction fees.",
    "problem": "Tax compliance is becoming a real burden as we expand internationally. We have customers in 14 countries now. Each country has different VAT rules, thresholds, and filing requirements. Last quarter we spent $4,200 on TaxJar + accounting fees, plus ~15 hours of engineering time maintaining the tax integration. LemonSqueezy would eliminate this entirely but takes a larger cut (5% + 50c vs Stripe's 2.9% + 30c) and has fewer features.",
    "impact": "Staying with Stripe: tax compliance costs grow linearly with international expansion, risk of tax audit in unfamiliar jurisdictions. Switching to LemonSqueezy: ~$200/month more in processing fees at current volume, but saves $1,400/month in tax overhead + 15 engineering hours. Net positive now, but the fee difference grows as revenue scales.",
    "scope": "Billing system, subscription management, invoicing, tax compliance, international expansion strategy, customer payment experience."
  },
  "context": {
    "problem": "Tax compliance overhead is consuming engineering time and external costs that exceed the fee difference between processors. But Stripe's ecosystem (Connect, Billing Portal, Revenue Recognition) provides value that LemonSqueezy can't match.",
    "currentState": "Stripe integration via @stripe/stripe-node SDK. Webhook handlers for subscription lifecycle. Customer portal for self-service billing. TaxJar integration for tax calculation. Manual quarterly tax filings in 6 jurisdictions. 180 customers, 14 countries, $12k MRR.",
    "whyProblem": "International expansion is a growth priority. Each new country adds tax complexity. Current approach doesn't scale - we can't hire a tax specialist for our size, and engineering time on tax compliance is time not spent on product. LemonSqueezy eliminates this category of work entirely.",
    "affectedAreas": [
      "Billing integration code - complete rewrite required",
      "Customer payment experience - new checkout flow",
      "Subscription management - different API, different webhooks",
      "Financial reporting - new data source for revenue metrics",
      "International expansion - removes tax barrier entirely",
      "Existing customer migration - must move 180 subscriptions"
    ],
    "constraints": [
      "Cannot disrupt existing subscriber billing during migration",
      "Must maintain subscription history for accounting/audit",
      "LemonSqueezy doesn't support Stripe Connect (used for marketplace)",
      "Migration window: ideally between billing cycles",
      "Must evaluate LemonSqueezy API stability and support quality"
    ],
    "references": [
      "Current Stripe integration: web/lib/infra/stripe-client.ts",
      "Webhook handlers: web/app/api/webhooks/stripe/route.ts",
      "TaxJar monthly cost: $89/month + $0.03/transaction",
      "Accounting firm quarterly filing: ~$1,000/quarter",
      "LemonSqueezy pricing: https://lemonsqueezy.com/pricing",
      "Stripe pricing: https://stripe.com/pricing"
    ]
  }
}
```

### Template 2: Guided Questions (Round 1)

Purpose: generate 5-8 binary tradeoff questions based on the brief.
These questions isolate the decision maker's priorities so the AI
can tailor options in round 2.

```
You are a senior consultant preparing preference questions for a
decision maker. You've completed your research and now need to
understand what the decision maker values most before presenting
solutions.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

Generate 5-8 binary preference questions. Each question presents
two legitimate approaches - neither is wrong. They represent
different priorities, values, or risk appetites.

The questions should help you understand:
- What the decision maker is optimizing for
- Their risk tolerance
- Their time horizon (short-term vs long-term thinking)
- What constraints they consider flexible vs non-negotiable
- What they'd sacrifice to get what matters most

Output ONLY valid JSON:

{
  "questions": [
    {
      "id": "q1",
      "text": "The tradeoff being presented - phrased as a clear either/or",
      "optionA": {
        "label": "Short action-oriented label (max 40 chars)",
        "value": "snake_case_value"
      },
      "optionB": {
        "label": "Short action-oriented label (max 40 chars)",
        "value": "snake_case_value"
      },
      "category": "what dimension this question measures",
      "weight": 0.8
    }
  ]
}

RULES:
1. Each question must isolate ONE tradeoff dimension
2. Labels must be concise and action-oriented - not academic
3. Neither option should be obviously better
4. Weight reflects how much this tradeoff matters (0.1-1.0)
5. Categories should be distinct (don't repeat dimensions)
6. Questions should feel like a real consultant asking a real
   executive - direct, clear, no jargon
7. The first 2-3 questions should address the BIGGEST tradeoffs
   in this specific decision (highest weight)
8. Avoid generic questions that apply to every decision

EXAMPLE (for auth database migration decision):

{
  "questions": [
    {
      "id": "q1",
      "text": "Would you rather migrate now while the system is small and the risk is low, or wait until scaling pressure forces the move and accept higher migration risk later?",
      "optionA": {
        "label": "Migrate now while it's safe",
        "value": "migrate_early"
      },
      "optionB": {
        "label": "Wait until we actually need it",
        "value": "defer_until_needed"
      },
      "category": "timing",
      "weight": 0.95
    },
    {
      "id": "q2",
      "text": "Is it more important that local development stays dead simple (no database server required) or that dev and production environments are identical?",
      "optionA": {
        "label": "Keep local dev simple",
        "value": "dev_simplicity"
      },
      "optionB": {
        "label": "Match production exactly",
        "value": "prod_parity"
      },
      "category": "developer_experience",
      "weight": 0.8
    },
    {
      "id": "q3",
      "text": "If the migration goes wrong, would you rather have lost a week of engineering time on a failed attempt, or have shipped a workaround that buys 6 months but adds technical debt?",
      "optionA": {
        "label": "Accept the risk of failed attempt",
        "value": "accept_failure_risk"
      },
      "optionB": {
        "label": "Ship a workaround instead",
        "value": "prefer_workaround"
      },
      "category": "risk_tolerance",
      "weight": 0.85
    },
    {
      "id": "q4",
      "text": "Should the auth system be designed for the scale you have today (200 users) or the scale you're planning for (50k users in 18 months)?",
      "optionA": {
        "label": "Build for today's needs",
        "value": "current_scale"
      },
      "optionB": {
        "label": "Build for projected scale",
        "value": "future_scale"
      },
      "category": "planning_horizon",
      "weight": 0.7
    },
    {
      "id": "q5",
      "text": "Would you spend 2 extra days building an abstraction layer that makes future database swaps painless, or skip it and do the simplest thing that works?",
      "optionA": {
        "label": "Invest in abstraction layer",
        "value": "invest_in_flexibility"
      },
      "optionB": {
        "label": "Simplest thing that works",
        "value": "keep_it_simple"
      },
      "category": "complexity_budget",
      "weight": 0.6
    }
  ]
}

EXAMPLE (for hiring decision):

{
  "questions": [
    {
      "id": "q1",
      "text": "Would you rather hire someone who can start contributing in week 1 with less long-term upside, or invest 3 months onboarding someone exceptional who'll transform the team?",
      "optionA": {
        "label": "Immediate contributor",
        "value": "immediate_impact"
      },
      "optionB": {
        "label": "Invest in exceptional talent",
        "value": "long_term_talent"
      },
      "category": "hiring_strategy",
      "weight": 0.9
    },
    {
      "id": "q2",
      "text": "If budget is tight, would you rather have a full-time junior DevOps engineer or a part-time senior contractor who costs the same annually?",
      "optionA": {
        "label": "Full-time junior hire",
        "value": "fulltime_junior"
      },
      "optionB": {
        "label": "Part-time senior contractor",
        "value": "parttime_senior"
      },
      "category": "resource_model",
      "weight": 0.85
    },
    {
      "id": "q3",
      "text": "Is it more important that the new hire reduces founding engineer workload immediately, or that they build systems that prevent future infrastructure problems?",
      "optionA": {
        "label": "Reduce current workload",
        "value": "reduce_workload"
      },
      "optionB": {
        "label": "Build preventive systems",
        "value": "build_systems"
      },
      "category": "mandate",
      "weight": 0.75
    },
    {
      "id": "q4",
      "text": "Would you extend runway by 2 months if it meant the founding engineers stay at 30% infra overhead, or shorten runway to free them up completely?",
      "optionA": {
        "label": "Preserve runway",
        "value": "preserve_runway"
      },
      "optionB": {
        "label": "Free up founders",
        "value": "free_founders"
      },
      "category": "financial_tradeoff",
      "weight": 0.9
    },
    {
      "id": "q5",
      "text": "Should the DevOps role own infrastructure end-to-end (including architecture decisions) or execute on architecture set by the founding team?",
      "optionA": {
        "label": "Full ownership",
        "value": "full_ownership"
      },
      "optionB": {
        "label": "Execute on our architecture",
        "value": "execute_our_vision"
      },
      "category": "autonomy",
      "weight": 0.65
    }
  ]
}
```

### Template 3: Preference Synthesis (NEW - between Round 1 and Round 2)

Purpose: synthesize raw Q&A answers into a coherent preference
profile that the options template can use effectively.

This is a NEW step. Currently the raw answers go directly to the
options template. This step produces a human-readable summary.

```
You are synthesizing a decision maker's preferences from their
answers to tradeoff questions.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

QUESTIONS AND ANSWERS:
{{QUESTIONS_AND_ANSWERS}}

Analyze the pattern of answers and produce a preference profile.
Don't just restate the answers - interpret what they reveal about
this person's priorities, risk appetite, and decision-making style.

Output ONLY valid JSON:

{
  "summary": "2-3 sentence narrative of what this decision maker values most and how they think about this specific decision",
  "priorities": [
    "most important thing to this person (from highest-weight answers)",
    "second most important",
    "third most important"
  ],
  "willing_to_sacrifice": [
    "thing they're okay giving up (inferred from their B choices on A/B tradeoffs)"
  ],
  "non_negotiables": [
    "thing they absolutely won't compromise on"
  ],
  "risk_profile": "conservative|moderate|aggressive",
  "time_horizon": "short_term|medium_term|long_term",
  "decision_style": "one sentence characterizing how they approach decisions"
}

EXAMPLE:

Questions answered:
- timing: "migrate now while it's safe" (A)
- developer_experience: "keep local dev simple" (A)
- risk_tolerance: "accept the risk of failed attempt" (A)
- planning_horizon: "build for today's needs" (A)
- complexity_budget: "simplest thing that works" (B)

{
  "summary": "This decision maker values action over analysis paralysis. They'd rather attempt something now while stakes are low than wait for a crisis. But they strongly prefer simplicity - they want the pragmatic solution, not the theoretically perfect one.",
  "priorities": [
    "Act now while risk is low rather than defer",
    "Keep things simple for the development team",
    "Minimize complexity even at the cost of future flexibility"
  ],
  "willing_to_sacrifice": [
    "Production parity in local development",
    "Future-proofing and abstraction layers",
    "Building for scale they don't have yet"
  ],
  "non_negotiables": [
    "Taking action rather than waiting",
    "Developer experience must stay simple"
  ],
  "risk_profile": "moderate",
  "time_horizon": "short_term",
  "decision_style": "Pragmatic executor - prefers shipping a good solution now over designing a perfect solution later."
}
```

### Template 4: Tailored Options (Round 2)

Purpose: generate 4 genuinely different options based on the brief
and the decision maker's preference profile.

```
You are a senior consultant presenting tailored solutions to a
decision maker. You've done the research, you understand what they
value, and now you're presenting 4 genuinely different approaches.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

DECISION MAKER'S PREFERENCE PROFILE:
{{PREFERENCE_PROFILE}}

CONSTRAINTS:
{{CONSTRAINTS}}

Generate exactly 4 options. Each option must be a genuinely
different approach - not just variations on a scale from "do less"
to "do more." Think about different philosophies, different
strategies, different ways to solve the same problem.

DO NOT use this formula:
  A = minimum viable
  B = comprehensive
  C = alternative approach
  D = hybrid

Instead, think about what 4 experienced consultants with different
backgrounds would each recommend. A finance person thinks about it
differently than an engineer. An operator thinks about it
differently than a strategist.

For each option, the description must explain:
- WHAT: exactly what this approach entails
- HOW: the key implementation steps or actions
- WHY THIS FITS: how it connects to the decision maker's stated preferences
- WHAT YOU GIVE UP: the honest tradeoff

Output ONLY valid JSON:

{
  "options": [
    {
      "id": "opt-a",
      "letter": "A",
      "name": "option name (max 50 chars)",
      "description": "detailed description (see requirements below)",
      "effort": "low|medium|high",
      "risk": "low|medium|high",
      "estimatedTime": "human-readable estimate",
      "matchScore": 85,
      "matchLabel": "strong match",
      "pros": ["specific advantage with evidence", "another advantage"],
      "cons": ["specific disadvantage with honest assessment", "another con"]
    }
  ],
  "recommendation": {
    "choiceId": "opt-a",
    "confidence": "high|medium|low",
    "rationale": "3-4 sentences explaining why this option best fits the decision maker's stated preferences, with specific references to their priority answers"
  }
}

RULES:
1. Each option must represent a genuinely different strategy
2. matchScore: 0-100 based on alignment with preference profile
   - 90+: directly addresses top priorities, acceptable tradeoffs
   - 70-89: addresses most priorities, minor conflicts
   - 50-69: addresses some priorities, notable tradeoffs
   - <50: conflicts with stated preferences (include anyway if it's
     the objectively right answer - sometimes the boss needs to hear it)
3. matchLabel: "strong match" (80+), "good match" (60-79),
   "partial match" (40-59), "worth considering" (<40)
4. Description must be substantive - minimum 4 sentences covering
   WHAT, HOW, WHY THIS FITS, and WHAT YOU GIVE UP
5. Pros must be specific and evidence-based, not generic
6. Cons must be honest, not softened
7. The recommendation rationale must reference specific preferences

EXAMPLE (for auth database migration, decision maker prefers:
pragmatic, act now, keep dev simple, short-term focus):

{
  "options": [
    {
      "id": "opt-a",
      "letter": "A",
      "name": "SQLite with connection pooling and WAL mode",
      "description": "Keep SQLite but optimize it for higher concurrency. Enable WAL (Write-Ahead Logging) mode which allows concurrent reads during writes, add a connection pool wrapper around better-sqlite3, and implement read replicas for query-heavy endpoints. This directly matches your preference for simplicity - no new database server, no migration risk, no changes to local dev. What you give up is true horizontal scaling - this buys you 6-12 months before you hit SQLite's ceiling again, and when you do, the migration will be harder because you've built more on top of it.",
      "effort": "low",
      "risk": "low",
      "estimatedTime": "2-3 days",
      "matchScore": 92,
      "matchLabel": "strong match",
      "pros": [
        "Zero migration risk - optimizing what already works",
        "Local dev stays exactly the same (no database server needed)",
        "WAL mode alone typically gives 5-10x write throughput improvement",
        "Can be done incrementally - enable WAL first, add pooling later",
        "Fully reversible if it doesn't help"
      ],
      "cons": [
        "Ceiling: WAL mode helps but SQLite still can't do multi-instance",
        "Delays the eventual PostgreSQL migration (more code built on SQLite)",
        "No concurrent write scaling beyond ~500 req/s",
        "Team might view this as avoiding the real problem"
      ]
    },
    {
      "id": "opt-b",
      "letter": "B",
      "name": "PostgreSQL for auth, SQLite stays for local dev",
      "description": "Migrate production auth to PostgreSQL 16 while keeping SQLite as the local development database. better-auth supports both via adapter configuration. Production uses PostgreSQL connection string, local dev defaults to SQLite file. This means you act now (matching your timing preference) but local dev stays simple (matching your DX preference). What you give up is true dev-prod parity - bugs that only appear in PostgreSQL won't be caught locally, and you'll maintain two code paths for database-specific queries.",
      "effort": "medium",
      "risk": "medium",
      "estimatedTime": "1-2 weeks",
      "matchScore": 78,
      "matchLabel": "good match",
      "pros": [
        "Production gets PostgreSQL's concurrency, ACID, and tooling",
        "Can use existing managed PostgreSQL - no new infrastructure",
        "Local dev stays simple: npm run dev just works, no docker required",
        "better-auth handles adapter switching - not a full rewrite"
      ],
      "cons": [
        "Two database adapters means two code paths to maintain",
        "PostgreSQL-specific bugs won't surface in local testing",
        "Migration script needs thorough testing - auth is the riskiest data",
        "1-2 week timeline competes with feature development priorities"
      ]
    },
    {
      "id": "opt-c",
      "letter": "C",
      "name": "Externalize auth entirely to a managed service",
      "description": "Replace the self-hosted auth system with a managed service like Clerk, Auth0, or Supabase Auth. Eliminates the database question entirely - auth becomes an API call, not a database query. This is the 'make it someone else's problem' approach. It matches your simplicity preference (less code to maintain) but conflicts with your preference to act quickly - the migration to an external provider is larger scope than a database swap. What you give up is control and cost predictability - managed auth services charge per-MAU and you're subject to their API changes, outages, and pricing changes.",
      "effort": "high",
      "risk": "medium",
      "estimatedTime": "3-4 weeks",
      "matchScore": 45,
      "matchLabel": "worth considering",
      "pros": [
        "Eliminates the database scaling question permanently",
        "Gets enterprise auth features for free (MFA, SSO, social login)",
        "Reduces security liability - auth is their problem, not yours",
        "Frees engineering time from auth maintenance forever"
      ],
      "cons": [
        "Largest migration scope - touching every auth touchpoint in the app",
        "Ongoing cost: $0.02-0.05/MAU adds up fast at scale",
        "Vendor lock-in: switching auth providers later is extremely painful",
        "Loss of control over auth behavior and data locality",
        "Conflicts with your preference for quick, pragmatic action"
      ]
    },
    {
      "id": "opt-d",
      "letter": "D",
      "name": "Stateless JWT auth with SQLite as backup store",
      "description": "Shift the auth model from session-based (database lookup on every request) to JWT-based (cryptographic verification, no database hit). SQLite stays but becomes a write-only audit log rather than the critical path for every authenticated request. This eliminates the read-scaling problem entirely while keeping your simple infrastructure. What you give up is immediate session revocation - JWTs are valid until they expire, so 'log out everywhere' has a delay window. You also need to handle token refresh carefully to avoid security gaps.",
      "effort": "medium",
      "risk": "medium",
      "estimatedTime": "1 week",
      "matchScore": 68,
      "matchLabel": "good match",
      "pros": [
        "Eliminates database as bottleneck for reads (90%+ of auth traffic)",
        "Works across multiple instances without shared database",
        "SQLite stays but is no longer on the critical path",
        "Better-auth supports JWT mode with minimal configuration change"
      ],
      "cons": [
        "Cannot instantly revoke sessions (JWT valid until expiry)",
        "Token refresh logic adds complexity to frontend",
        "Security model change requires thorough audit",
        "Doesn't solve the write-scaling problem (just the read problem)"
      ]
    }
  ],
  "recommendation": {
    "choiceId": "opt-a",
    "confidence": "high",
    "rationale": "You told us you want to act now, keep things simple, and build for today's needs rather than theoretical future scale. Option A does exactly that - it's the lowest risk, fastest to implement, and doesn't change anything about your development workflow. WAL mode alone is a one-line configuration change that typically gives 5-10x write throughput improvement. The honest tradeoff is that you'll probably need to revisit this in 6-12 months, but by then you'll have more data on actual scaling needs rather than guessing now. Given your stated preference for pragmatic solutions over theoretical perfection, optimizing what works beats replacing it."
  }
}

EXAMPLE (for hiring decision, decision maker prefers:
immediate impact, preserve runway, full ownership, part-time senior):

{
  "options": [
    {
      "id": "opt-a",
      "letter": "A",
      "name": "Senior DevOps contractor, 20 hrs/week",
      "description": "Engage a senior DevOps contractor at $120-150/hr for 20 hours/week. They own infrastructure end-to-end: set up CI/CD, monitoring, IaC, and train the founding team. 6-month engagement with option to convert to full-time. This matches your preference for immediate impact (senior people deliver from day 1) and preserves runway ($10-12k/month vs $15k/month for a full-time hire). What you give up is continuity - contractors can leave, and 20 hrs/week means prioritization is critical. Not everything gets fixed.",
      "effort": "low",
      "risk": "low",
      "estimatedTime": "Can start within 2 weeks",
      "matchScore": 91,
      "matchLabel": "strong match",
      "pros": [
        "Senior expertise from day 1 - no 3-month ramp",
        "$10-12k/month vs $12-15k/month for full-time (runway preserved)",
        "Flexible: scale hours up/down as needs change",
        "Try-before-you-buy: convert to full-time if it works",
        "Can start in 2 weeks vs 6-8 week hiring process"
      ],
      "cons": [
        "20 hrs/week means tough prioritization choices",
        "Less invested than a full-time employee (no equity, no mission)",
        "Contractor market is competitive - good ones are booked",
        "Knowledge leaves when contractor leaves",
        "No after-hours incident response unless negotiated separately"
      ]
    },
    {
      "id": "opt-b",
      "letter": "B",
      "name": "Platform engineering bootcamp for founding team",
      "description": "Instead of hiring, invest 2 weeks in a structured infrastructure bootcamp for the founding team. Bring in a consultant for 40 hours to set up CI/CD, IaC, and monitoring templates, then train the team to maintain them. The founding engineers keep ownership but with proper tooling that reduces the 30% overhead to ~10%. This matches your autonomy preference (execute on our architecture) but challenges your timing preference - the 2-week investment has to come from somewhere. What you give up is the long-term solution - the team gets better tooling but still owns infra.",
      "effort": "medium",
      "risk": "low",
      "estimatedTime": "2-week intensive + 2 weeks settling",
      "matchScore": 62,
      "matchLabel": "good match",
      "pros": [
        "No ongoing headcount cost - one-time $6-8k investment",
        "Founding team retains full control and context",
        "Proper tooling (CI/CD, IaC) reduces overhead from 30% to ~10%",
        "Knowledge stays in-house permanently",
        "Team levels up their infrastructure skills"
      ],
      "cons": [
        "2 weeks of zero feature output during bootcamp",
        "Founding engineers still own infra (just with better tools)",
        "Doesn't solve the scaling problem if team grows",
        "Requires founding team buy-in to invest the time",
        "~10% overhead is still 16+ hours/month of infra work"
      ]
    },
    {
      "id": "opt-c",
      "letter": "C",
      "name": "Managed infrastructure platform (Render/Railway)",
      "description": "Eliminate the DevOps role entirely by migrating to a managed platform like Render or Railway. They handle deployments, scaling, SSL, monitoring, and rollbacks. Your infra becomes a YAML file. This is the most aggressive simplification - it matches your preference for immediate impact and freeing up founders, but conflicts with full ownership (you're dependent on the platform's abstractions). What you give up is customization and cost control at scale - managed platforms charge a premium over raw VPS, and you can't do anything they don't support.",
      "effort": "high",
      "risk": "medium",
      "estimatedTime": "2-3 weeks migration",
      "matchScore": 55,
      "matchLabel": "partial match",
      "pros": [
        "Eliminates DevOps as a role entirely",
        "Founding engineers recover 100% of infra time",
        "Deployments become git push (zero manual work)",
        "Built-in monitoring, logging, auto-scaling",
        "No hiring process, no contractor management"
      ],
      "cons": [
        "Platform lock-in: migrating away is painful",
        "Higher cost at scale ($50-200/month premium per service)",
        "Can't do anything the platform doesn't support",
        "Loss of infrastructure customization (specific provider configs)",
        "Existing Docker Compose setup needs full rewrite"
      ]
    },
    {
      "id": "opt-d",
      "letter": "D",
      "name": "Junior DevOps hire + founding engineer mentor",
      "description": "Hire a junior/mid DevOps engineer ($90-110k) paired with a founding engineer as mentor for the first 3 months. The junior handles day-to-day operations immediately (deploys, monitoring, tickets) while the mentor guides architecture decisions. After 3 months, the junior owns operations fully and the founding engineer steps back to pure product work. This preserves more runway than a senior hire while still adding dedicated headcount. What you give up is speed - a junior needs more guidance, makes more mistakes, and takes 3 months to reach full autonomy.",
      "effort": "medium",
      "risk": "medium",
      "estimatedTime": "4-6 weeks to hire, 3 months to full autonomy",
      "matchScore": 58,
      "matchLabel": "partial match",
      "pros": [
        "Lower salary preserves more runway ($7.5-9k/month vs $12-15k)",
        "Full-time dedication - no prioritization conflicts",
        "Grows into the role: builds loyalty, learns your specific stack",
        "Founding engineer mentorship transfers knowledge intentionally",
        "Equity compensation possible: junior more likely to accept"
      ],
      "cons": [
        "3-month ramp before full impact (conflicts with immediate impact preference)",
        "Founding engineer spends MORE time on infra during mentorship period",
        "Higher risk of bad hire - junior track record harder to evaluate",
        "Junior may outgrow the role and leave in 12-18 months",
        "Hiring process takes 4-6 weeks minimum"
      ]
    }
  ],
  "recommendation": {
    "choiceId": "opt-a",
    "confidence": "high",
    "rationale": "You told us three things clearly: you want immediate impact, you want to preserve runway, and you want someone senior enough to own infrastructure with full autonomy. The 20hr/week senior contractor hits all three. They start contributing in week 1 (no ramp), cost $10-12k/month (vs $12-15k for full-time, saving ~$3k/month), and senior contractors are used to owning systems end-to-end. The convert-to-hire option also keeps the door open - if they're great and you have runway after the next funding round, you bring them on full-time with zero ramp time. The biggest risk is contractor availability, so we'd recommend starting the search immediately."
  }
}
```

### Template 5: Execution Plan (Round 3)

Purpose: generate a phased execution plan for the selected option.

```
You are building an execution plan for a decision that has been
approved. The decision maker has selected their preferred option
and you need to break it into actionable tasks with clear phases,
dependencies, and estimates.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

SELECTED OPTION:
{{SELECTED_OPTION}}

DECISION MAKER'S PREFERENCES:
{{USER_PREFERENCES}}

Create a detailed execution plan. Be specific about what needs to
happen, in what order, and how long each step takes.

Output ONLY valid JSON:

{
  "summary": "2-3 sentence execution brief - what we're doing and the expected outcome",
  "totalEstimate": "human-readable total estimate",
  "tasks": [
    {
      "id": "task-1",
      "title": "specific action item (imperative form)",
      "description": "what needs to be done and why this step matters",
      "subtasks": ["concrete subtask 1", "concrete subtask 2"],
      "estimate": "time estimate",
      "priority": 2,
      "phase": 1
    }
  ],
  "dependencies": [
    { "from": "task-1", "to": "task-2" }
  ]
}

RULES:
1. Break into 2-4 phases (preparation, execution, validation, rollout)
2. 5-15 total tasks - enough detail to act on, not so much it's noise
3. Dependencies must not be circular
4. Priority: 0=critical, 1=high, 2=medium, 3=low, 4=backlog
5. Each task must be independently completable by one person
6. Include verification/testing/validation tasks
7. Task titles should be imperative: "Set up X" not "X setup"
8. Estimates should be realistic, not optimistic
9. Phase 1 should be the smallest possible step that proves the
   approach works (de-risk early)

EXAMPLE (for "SQLite with WAL mode" option):

{
  "summary": "Optimize SQLite auth database with WAL mode and connection pooling. Expected outcome: 5-10x write throughput improvement with zero migration risk and no changes to local development workflow.",
  "totalEstimate": "2-3 days",
  "tasks": [
    {
      "id": "task-1",
      "title": "Benchmark current SQLite write throughput",
      "description": "Establish baseline metrics before changes. Run concurrent write tests against auth.db to measure current ceiling. This gives us a number to compare against after optimization.",
      "subtasks": [
        "Write a load test script that simulates concurrent auth requests",
        "Measure: writes/sec, p50/p95/p99 latency, lock contention rate",
        "Document baseline in a test report"
      ],
      "estimate": "2 hours",
      "priority": 1,
      "phase": 1
    },
    {
      "id": "task-2",
      "title": "Enable WAL mode on auth.db",
      "description": "Switch SQLite from default journal mode to WAL (Write-Ahead Logging). This is a one-line PRAGMA change that allows concurrent reads during writes. Reversible by switching back to DELETE mode.",
      "subtasks": [
        "Add PRAGMA journal_mode=WAL to database initialization",
        "Add PRAGMA busy_timeout=5000 for write contention handling",
        "Verify WAL mode persists across restarts",
        "Test that better-auth operations work correctly in WAL mode"
      ],
      "estimate": "1 hour",
      "priority": 0,
      "phase": 2
    },
    {
      "id": "task-3",
      "title": "Add connection pool wrapper",
      "description": "Wrap better-sqlite3 in a connection pool that manages multiple read connections and serializes writes. This prevents connection starvation under load.",
      "subtasks": [
        "Create pool wrapper with configurable max connections",
        "Separate read pool (multiple connections) from write pool (single connection)",
        "Add connection health checks and auto-reconnect",
        "Integrate with existing auth.ts database access"
      ],
      "estimate": "4 hours",
      "priority": 1,
      "phase": 2
    },
    {
      "id": "task-4",
      "title": "Re-run benchmark and compare",
      "description": "Run the same load test from task-1 against the optimized database. Compare write throughput, latency, and lock contention. If improvement is <3x, investigate further optimizations.",
      "subtasks": [
        "Run identical load test script from task-1",
        "Compare metrics: writes/sec, latency percentiles, lock contention",
        "Document results and publish comparison"
      ],
      "estimate": "1 hour",
      "priority": 1,
      "phase": 3
    },
    {
      "id": "task-5",
      "title": "Deploy to production and monitor",
      "description": "Apply WAL mode and connection pool changes to production auth.db. Monitor for 48 hours before declaring success.",
      "subtasks": [
        "Backup production auth.db before changes",
        "Apply PRAGMA changes and deploy pool wrapper",
        "Monitor error rates, response times, and database size",
        "Verify WAL checkpoint behavior (auto-checkpoint at 1000 pages)",
        "Document the change and rollback procedure"
      ],
      "estimate": "2 hours + 48hr monitoring",
      "priority": 0,
      "phase": 4
    }
  ],
  "dependencies": [
    { "from": "task-1", "to": "task-2" },
    { "from": "task-2", "to": "task-3" },
    { "from": "task-3", "to": "task-4" },
    { "from": "task-4", "to": "task-5" }
  ]
}
```

### Template 6: Auto Mode Preference Synthesis

Purpose: AI answers its own tradeoff questions when the decision
maker wants to skip the preference round.

```
You are a senior analyst who has thoroughly researched a decision
and must now make the preference calls yourself. The decision maker
has asked you to "just handle it" - they trust your judgment based
on the research.

RESEARCH BRIEF:
{{DECISION_CONTEXT}}

TRADEOFF QUESTIONS:
{{QUESTIONS}}

Answer each question as if you were the decision maker, based on
what you learned during research. For each answer, provide your
rationale - the decision maker will review your choices.

Output ONLY valid JSON:

{
  "answers": [
    {
      "questionId": "q1",
      "choice": "a",
      "rationale": "2-3 sentences explaining why this choice makes sense given the research findings"
    }
  ],
  "overall_rationale": "1-2 sentences summarizing your overall approach and what you optimized for"
}

RULES:
1. Base every answer on evidence from the research brief
2. Be consistent - don't contradict yourself across answers
3. Optimize for the most pragmatic outcome given the constraints
4. The rationale must reference specific findings from the research
5. If a question is genuinely 50/50, lean toward lower risk
```

## Code Changes Required

### 1. Templates (web/lib/generation-template-storage.ts)

Replace these templates with the versions above:
- DEFAULT_DECISION_RESEARCH_TEMPLATE → research-only, no options
- DEFAULT_GUIDED_QUESTIONS_TEMPLATE → with examples
- DEFAULT_GUIDED_OPTIONS_TEMPLATE → with examples, no formulaic slots
- DEFAULT_GUIDED_PLAN_TEMPLATE → with examples

Add new templates:
- DEFAULT_PREFERENCE_SYNTHESIS_TEMPLATE (new step)
- DEFAULT_AUTO_PREFERENCE_TEMPLATE (auto mode)

Remove:
- DEFAULT_DECISION_STEERING_TEMPLATE (replaced by re-running research)

Update GenerationTemplateId type to add new IDs.

### 2. Research Route (web/app/api/decisions/[id]/research/route.ts)

- Research produces brief ONLY (no options, no recommendation)
- After research completes, status goes to "briefed" not "pending"
- Remove buildPreviousAnalysis and steering logic (or move to
  a separate re-research endpoint)
- Update the job result handler to NOT write options/recommendation

### 3. New: Preference Synthesis Step

Add synthesis between round 1 answers and round 2 options:

- After all questions answered → trigger synthesis job
- Synthesis produces PreferenceProfile with real narrative summary
- Store in guidedFlow.round1.preferenceProfile
- Round 2 uses this profile, not raw answers

Could be:
- New API route: POST /api/decisions/[id]/guided/synthesize
- Or: inline in the options route before spawning the job

### 4. Options Route (web/app/api/decisions/[id]/guided/options/route.ts)

- Use FULL context (add back whyProblem, affectedAreas, references)
- Use synthesized preference profile (not raw Q&A pairs)
- Use the buildDecisionContext() helper from questions route
  (or a shared version) instead of inline context building

### 5. Plan Route (web/app/api/decisions/[id]/guided/plan/route.ts)

- Use FULL context (add back whyProblem, affectedAreas, currentState)
- Use the shared buildDecisionContext() helper

### 6. Auto Mode

New API route: POST /api/decisions/[id]/guided/auto
- Takes the generated questions
- Runs auto-preference template to answer them
- Runs synthesis on those answers
- Runs options generation
- Runs plan generation for the recommended option
- Returns the full completed flow

### 7. Decision Types (web/lib/decision-types.ts)

- Add "briefed" to DecisionStatus (between "researching" and "pending")
- Update PreferenceProfile to match new synthesis template output:
  - priorities: string[]
  - willing_to_sacrifice: string[]
  - non_negotiables: string[]
  - risk_profile: string
  - time_horizon: string
  - decision_style: string

### 8. Decision Storage (web/lib/decision-storage.ts)

- No structural changes needed (it's already flexible)

### 9. Job Runner (lib/job-runner.mjs)

- Add validation for guided round outputs:
  - decision_guided_questions: must have questions array with 5+ items
  - decision_guided_options: must have options array with 4 items
  - decision_guided_plan: must have tasks array with 5+ items
  - preference_synthesis: must have summary + priorities

### 10. UI Changes

Minimal UI changes needed for this phase:

- decision-detail.tsx: add "briefed" status handling, auto mode button
- guided-flow-shell.tsx: add synthesis step between round 1 and round 2
- briefing-carousel.tsx: update cards to use new brief structure
  (headline, situation, problem, impact, scope)

The presentation layer improvements (making slides look like a
deck) can be a follow-up phase. The data quality improvement from
better templates is the priority.

## File List (all changes)

```
MODIFY:
  web/lib/generation-template-storage.ts    - all 6 decision templates
  web/lib/decision-types.ts                 - PreferenceProfile, DecisionStatus
  web/app/api/decisions/[id]/research/route.ts      - brief-only output
  web/app/api/decisions/[id]/guided/options/route.ts - full context + profile
  web/app/api/decisions/[id]/guided/plan/route.ts    - full context
  web/components/decision/decision-detail.tsx         - briefed status, auto mode
  web/components/guided-flow/guided-flow-shell.tsx    - synthesis step
  web/components/decision/briefing-carousel.tsx       - new brief structure
  lib/job-runner.mjs                                  - validation for guided rounds

CREATE:
  web/app/api/decisions/[id]/guided/synthesize/route.ts  - preference synthesis
  web/app/api/decisions/[id]/guided/auto/route.ts        - auto mode endpoint
```

## Testing

After implementation:
1. Create a new decision with a non-software prompt (e.g., hiring)
2. Verify research produces brief only (no options)
3. Verify questions are specific to the domain
4. Answer questions, verify synthesis produces real narrative
5. Verify options are genuinely different (not scope sliders)
6. Verify plan is specific and actionable
7. Test auto mode end-to-end
8. Puppeteer QA on all screens
