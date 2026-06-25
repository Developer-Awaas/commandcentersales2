---
name: agent-builder
description: Use this skill whenever adding a new agent to Command Center V2's multi-agent system. Covers the full agent build lifecycle — personality prompt, Edge Function, Aarav orchestrator wiring, regression tests, and cost tracking. Trigger on any mention of building Kavya, Dhruv, Vihaan, Publisher, or any new agent. Also trigger when iterating on existing agent prompts, adding agent capabilities, or debugging agent routing issues.
---

# Agent Builder — Command Center V2

Reusable pattern for building any new agent in the AWAAS Command Center V2 multi-agent system.

## Architecture rules (non-negotiable)

1. All agents route through Aarav (master conductor). No direct user → specialist calls.
2. Specialists return structured JSON. Aarav handles natural-language presentation.
3. Every agent interaction is logged: tokens, model, cost, org_id, conversation_id.
4. Token budget enforced per interaction at orchestrator level, not inside agents.
5. Agent prompts are versioned in `agent_personality_versions` table with rollback.
6. Memory is loaded per-agent: each specialist reads their domain memory only.

## Build checklist — 6 files per agent

For any new agent `{name}`, create these in order:

### 1. Personality prompt: `prompts/{name}/v1.ts`

```typescript
export const AGENT_META = {
  name: '{Name}',
  role: '{one-line role}',
  version: '1.0',
  model: 'claude-sonnet-4-6',  // or claude-haiku-4-5 for volume work
  maxTokens: 4096,
}

export const SYSTEM_PROMPT = `
You are {Name}, {role description} at AWAAS Command Center.

## Identity
- {2-3 voice signatures — how this agent talks}
- You NEVER say "As an AI" or break character
- You always respond in structured JSON matching the output schema below

## Capabilities
- {bullet list of what this agent can do}

## Constraints
- You only operate within your domain. For other domains, tell Aarav.
- You always respect the Brand Kit provided in context.
- You reference project and memory context — never hallucinate facts.

## Output schema
{JSON schema for this agent's structured output}

## Context provided to you
- brand_kit: {BrandKit JSON}
- project: {ProjectContext JSON}
- memory: {relevant memory snippets}
- {agent-specific context, e.g., metrics for Dhruv, competitor data for Vihaan}
`
```

**Model selection rule:**
- Sonnet 4.6: default for all agents (reasoning + speed balance)
- Haiku 4.5: volume text generation (captions, calendar entries) where speed > depth
- Opus 4.7: async deep analysis only (Strategic Aarav, weekly reports)

### 2. Specialist module: `supabase/functions/_shared/agents/{name}.ts`

Agents in this repo are shared specialist modules invoked by aarav-orchestrate — NOT separate routable Edge Functions. Follow the pattern of arjun.ts/aanya.ts/kavya.ts exactly:

```typescript
import { loadAgentPrompt } from './prompts.ts'
import { parseJsonObject } from './json-extract.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const {NAME}_MODEL = 'claude-sonnet-4-6'

export interface Run{Name}Input { orgId: string; projectId?: string; message: string; context?: Record<string, unknown> }
export interface Run{Name}Result { output: {Name}Output; model: string; inputTokens: number; outputTokens: number }
export class {Name}OutputError extends Error { usage?: { inputTokens: number; outputTokens: number } }

export async function run{Name}(input: Run{Name}Input): Promise<Run{Name}Result> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret is not set')
  // ... LLM call → parseJsonObject → return result
}
```

### 3. Register prompt in prompts.ts

In `supabase/functions/_shared/agents/prompts.ts`:

1. Add agent name to `AgentName` union type
2. Add `{NAME}_PROMPT` constant
3. Add version to `PROMPT_VERSIONS`
4. Add to `PROMPTS` record

### 4. Wire into Aarav's orchestrator

In `supabase/functions/aarav-orchestrate/index.ts`:

1. Import the new specialist: `import { run{Name}, ... } from '../_shared/agents/{name}.ts'`
2. Add `'{name}'` to `DelegationStatus.agent` union
3. Add `{name}?: DelegationState` to `DelegationMap`
4. Add intent detection function `detect{Name}Intent(message: string): boolean`
5. Add `handle{Name}Turn()` function following the pattern of handleKavyaTurn
6. Add routing before the main Arjun→Aanya chain

### 5. Add migration for agent_interactions CHECK

```sql
DO $$ BEGIN
  ALTER TABLE agent_interactions
    DROP CONSTRAINT agent_interactions_agent_check;
  ALTER TABLE agent_interactions
    ADD CONSTRAINT agent_interactions_agent_check
    CHECK (agent IN ('aarav', 'arjun', 'aanya', 'diya', 'kavya', '{name}'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
```

Update `database.types.ts` to add `'{name}'` to the `agent` field union in `agent_interactions`.

### 6. Regression tests: `supabase/functions/_shared/agents/{name}_test.ts`

```typescript
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('{name}: basic request produces structured output', async () => { ... })
// 8-10 tests covering: happy path, invalid intent, character voice, edge cases
```

## Token budget allocation

| Agent | Model | Max tokens | Typical cost/call |
|-------|-------|------------|------------------|
| Kavya (plan) | Sonnet 4.6 | 4096 | $0.05 |
| Kavya (caption/reel) | Haiku 4.5 | 1024 | $0.002 |
| Dhruv | Sonnet 4.6 | 4096 | $0.05 |
| Vihaan | Sonnet 4.6 | 4096 | $0.05 |
| Publisher | Sonnet 4.6 | 2048 | $0.03 |

## Common mistakes

1. **Creating a separate kavya-invoke/ Edge Function** — wrong. All specialists are shared modules under `_shared/agents/`. Only `aarav-orchestrate/index.ts` is a routable Edge Function.
2. **Calling Claude API without the ANTHROPIC_API_KEY secret** — always: `Deno.env.get('ANTHROPIC_API_KEY')`
3. **Forgetting to update Aarav's routing** — new agent exists but Aarav never delegates to it
4. **Not updating database.types.ts** — TypeScript will fail on the new agent name at the `agent_interactions.Insert` call
5. **Returning raw LLM text** — always use `parseJsonObject()` from json-extract.ts
6. **Not adding the migration** — the DB CHECK constraint will reject inserts at runtime
7. **Not updating CLAUDE.md** — mandatory per project rules before finishing any task
