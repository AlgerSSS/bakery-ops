# Hot Crush Bakery Ops

AI-powered operations platform for Hot Crush, a Malaysian chain bakery. Integrates WhatsApp bot, web dashboard, and automated workflows to manage recruitment, supply chain, production forecasting, marketing, and employee operations.

## Architecture

```
WhatsApp ──┐
            ├── Orchestrator (Intent Router) ── Skills (15) ── Domain Services
Web UI ────┘                                                        │
                                                              Supabase (PostgreSQL)
```

- **Skill-based routing**: Messages are classified by intent (keyword → LLM → fallback) and dispatched to modular skill handlers
- **Multi-channel**: WhatsApp bot + Next.js web dashboard + REST API
- **AI-driven**: GPT-5.5 (via OpenRouter) for intent detection, candidate scoring, forecasting, daily reviews

## Skills

| Skill | Description |
|-------|-------------|
| recruitment_sourcing | Auto-search candidates from JobStreet, AJobThing, Indeed |
| candidate_outreach | Automated messaging to matched candidates |
| job_posting | Post openings to job platforms |
| active_jobs | Query active job listings |
| resume_upload | Upload & parse resumes |
| forecast_order | Revenue forecasting & shipment planning |
| kitchen_production_plan | Kitchen production scheduling |
| supply_order | Supply chain ordering & consolidation |
| arrival_check | Inventory arrival verification |
| supply_send | Send orders to suppliers via WhatsApp |
| employee_management | Employee data & event tracking |
| daily_review_chat | Daily business review & AI insights |
| kol_discovery | Discover influencers on TikTok/Instagram |
| kol_outreach | Automated KOL messaging |
| knowledge_query | Knowledge graph queries (LightRAG) |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Web**: Next.js 16, React 19, Tailwind CSS 4
- **Bot**: whatsapp-web.js
- **Database**: PostgreSQL (Supabase)
- **AI**: OpenRouter (GPT-5.5), LightRAG
- **Scraping**: Playwright + stealth plugin
- **Testing**: Vitest
- **Build**: esbuild (bot), Next.js (web)

## Project Structure

```
src/
├── app/                    # Next.js pages & API routes
├── modules/
│   ├── skills/             # 15 skill handlers
│   ├── domain/             # Business logic
│   │   ├── recruitment/    # Talent sourcing pipeline
│   │   ├── forecast/       # Revenue & production forecasting
│   │   ├── supplychain/    # Order consolidation & supplier messaging
│   │   ├── marketing/      # KOL discovery & outreach
│   │   ├── employee/       # Employee management
│   │   ├── production-plan/# Kitchen scheduling
│   │   ├── ai/             # AI provider abstraction
│   │   ├── lark/           # Feishu integration
│   │   ├── knowledge/      # LightRAG client
│   │   ├── resume/         # Resume parsing
│   │   └── files/          # File management
│   ├── orchestrator/       # Intent routing & skill dispatch
│   ├── channel/            # WhatsApp adapter
│   ├── data/               # Repositories (direct PostgreSQL via DATABASE_URL)
│   └── shared/             # Logger, types, utilities
├── ui/                     # React components & hooks
└── __tests__/              # Unit & integration tests
config/                     # Business rules, product aliases, planning rules
supabase/                   # Database migrations
templates/                  # Excel templates
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL (Supabase project)
- WhatsApp account for bot

### Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env  # Fill in credentials
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string — the single database connection (Supabase JS client retired) |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `JOBSTREET_EMAIL/PASSWORD` | JobStreet employer account |
| `AJOBTHING_EMAIL/PASSWORD` | AJobThing employer account |
| `WHATSAPP_SESSION_PATH` | WhatsApp session storage |
| `TZ` | Timezone (Asia/Kuala_Lumpur) |

### Run

```bash
# WhatsApp bot only
npm run dev:bot

# Full stack (web + bot)
npm run dev

# Run with tsx (no bundle)
npm run dev:tsx
```

### Test

```bash
npx vitest
```

## Deployment

**`main` is the deploy source.** Deploy scripts rsync the local working tree to the
server — they do not reference a branch name — so whatever is checked out is what
ships. Check out `main` before deploying.

Until 2026-08-25 production tracked the feature branch `codex/fabric-agent-blueprint`
while `main` sat three weeks behind. That branch has been fast-forwarded into `main`;
don't let it drift again.

| Service | Script | Server |
| --- | --- | --- |
| R6 RAG worker + Lark Wiki sync | `services/data-platform/deploy-rag-worker.sh` | tokyo-01 (45.77.12.118) |

The data-platform deploy runs `pytest` and `ruff` as gates before it touches the
server, then rebuilds the venv from `requirements.lock` and restarts the units.

## Key Workflows

**Recruitment**: Parse JD → Search 3 job sites (stealth) → Deduplicate → AI score → Generate resume PDFs → Auto-outreach → Sync to Feishu

**Forecasting**: Monthly targets (seasonal coefficients) → Daily targets (weekday weights) → Product suggestions → Time-slot allocation → Excel export

**Supply Chain**: Staff report orders → Consolidate by supplier → Send via WhatsApp → Track arrivals

**Marketing**: Discover KOLs on TikTok/Instagram → Auto-DM with daily budget → Track collaborations

## License

Private — Hot Crush internal use only.
