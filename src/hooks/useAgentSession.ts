import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  AaravResponse,
  AgentRequest,
  ApproveResponse,
  CreativeAngle,
  CreativeVariant,
  DelegationStatus,
  StrategyConfig,
} from '../pages/leadgen-v2/contracts';

export type {
  AgentStatus,
  AaravMessage,
  StrategyConfig,
  CreativeVariant,
  BrandVerdict,
  AaravResponse,
  ApproveResponse,
  DelegationStatus,
} from '../pages/leadgen-v2/contracts';

// Shape of the agent_turns Realtime payload we care about.
interface TurnRealtimeRow {
  id: string;
  session_id: string;
  delegations: { arjun: string; aanya: string; diya: string };
  status: string;
}

const AGENT_LABELS: Record<string, string> = {
  arjun: 'Designing campaign strategy',
  aanya: 'Generating creatives',
  diya:  'Checking brand DNA',
};

// Map the compact {arjun: 'working', ...} DB format to the DelegationStatus[]
// array that the chip components consume.
function mapToDelegationStatus(row: TurnRealtimeRow['delegations']): DelegationStatus[] {
  return (['arjun', 'aanya', 'diya'] as const).map(agent => ({
    agent,
    label:  AGENT_LABELS[agent],
    status: row[agent] as DelegationStatus['status'],
  }));
}

interface SendMessageOptions {
  editedStrategy?: StrategyConfig;
}

interface UseAgentSessionResult {
  response: AaravResponse | null;
  loading: boolean;
  error: string | null;
  // Live delegation states from Realtime (animates during a running turn).
  liveDelegations: DelegationStatus[] | null;
  sendMessage: (message: string, opts?: SendMessageOptions) => Promise<void>;
  regenerateCreatives: (strategy: StrategyConfig, opts?: { angle: CreativeAngle; keep: CreativeVariant[] }) => Promise<void>;
  // INVARIANT: approveTurn is idempotent — the server checks approved_at IS
  // NOT NULL and returns early on a second call. The hook also guards with a
  // dedicated approveRef so a double-click can't fire two requests.
  approveTurn: (selectedCreativeIds?: string[]) => Promise<void>;
  // requestChange sends a new turn in the same session carrying the user's
  // adjustment text and the current strategy as context — aarav-orchestrate
  // handles it as a normal send_message turn (no special routing needed).
  requestChange: (adjustmentMessage: string) => Promise<void>;
  approveResult: ApproveResponse | null;
  approveLoading: boolean;
  approveError: string | null;
}

const DEFAULT_GREETING = "Let's set up a new campaign.";

// INVARIANT: this hook is the ONLY place the LeadGen V2 UI talks to the
// network. It calls `aarav-orchestrate` exclusively — never a specialist
// function (arjun/aanya/diya) directly. supabase.functions.invoke attaches
// the signed-in user's JWT automatically; org_id is resolved server-side
// from that JWT, never sent from the client.
export function useAgentSession(initialMessage: string = DEFAULT_GREETING): UseAgentSessionResult {
  const [response, setResponse]             = useState<AaravResponse | null>(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [liveDelegations, setLiveDelegations] = useState<DelegationStatus[] | null>(null);
  const [approveResult, setApproveResult]   = useState<ApproveResponse | null>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError]     = useState<string | null>(null);
  // org_id resolved from auth on mount (in parallel with the greeting turn)
  // so the Realtime subscription is active before the first response arrives.
  // Without this, the greeting turn has no live delegation chips.
  const [mountedOrgId, setMountedOrgId]     = useState<string | null>(null);

  // Stable session id — groups all turns in one conversation in Langfuse
  // Sessions view and in the agent_messages / agent_turns tables.
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Protects the agent_interactions cost ledger from concurrent double-writes
  // if a caller fires two requests before the first one's loading state re-renders.
  const inFlightRef = useRef(false);

  // Separate guard for Approve so it never shares state with send/regen.
  const approveRef = useRef(false);

  // org_id resolved from the first server response — needed for the Realtime
  // filter so we don't need a separate profile fetch on mount.
  const orgIdRef = useRef<string | null>(null);

  // Latest turn_id from the most recent server response — used by approveTurn.
  const currentTurnIdRef = useRef<string | null>(null);

  // Keep a ref to the current canvas so requestChange can inject the strategy.
  const currentCanvasRef = useRef<AaravResponse['canvas'] | null>(null);

  // ── Early org_id fetch (runs in parallel with the greeting turn) ─────────
  // Resolves org_id from the signed-in user's profile before the first
  // orchestrate response arrives, so the Realtime subscription below can
  // subscribe immediately — otherwise the greeting turn has no live chips.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return null;
      return supabase
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .single();
    }).then((result) => {
      if (!result) return;
      const orgId = (result.data as { org_id?: string } | null)?.org_id;
      if (orgId && !orgIdRef.current) {
        orgIdRef.current = orgId;
        setMountedOrgId(orgId);
      }
    }).catch(() => { /* auth failure is non-fatal; chips appear after first response */ });
  }, []);

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Subscribes to agent_turns rows for this org+session. Activates as soon as
  // org_id is known — either from the mount-time profile fetch above (covers
  // the greeting turn) or from the first response (fallback).

  useEffect(() => {
    if (!orgIdRef.current) return;
    const orgId     = orgIdRef.current;
    const sessionId = sessionIdRef.current;

    const channel = supabase
      .channel(`agent-turns-${orgId}-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_turns', filter: `org_id=eq.${orgId}` },
        (payload) => {
          const row = payload.new as TurnRealtimeRow;
          // Only handle rows for the current session.
          if (row.session_id !== sessionId) return;
          if (row.delegations) {
            setLiveDelegations(mapToDelegationStatus(row.delegations));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [mountedOrgId ?? response?.org_id]); // fires on whichever arrives first

  // ── Core invoke helper ────────────────────────────────────────────────────

  async function invoke(payload: AgentRequest): Promise<AaravResponse> {
    const { data, error: fnError } = await supabase.functions.invoke<AaravResponse>(
      'aarav-orchestrate',
      { body: { ...payload, session_id: sessionIdRef.current } }
    );
    if (fnError) throw fnError;
    if (!data)   throw new Error('aarav-orchestrate returned no data');

    // Capture org_id from first successful response to enable Realtime.
    if (data.org_id && !orgIdRef.current) {
      orgIdRef.current = data.org_id;
    }
    if (data.turn_id) {
      currentTurnIdRef.current = data.turn_id;
    }
    if (data.canvas) {
      currentCanvasRef.current = data.canvas;
    }

    // When the function returns, the final delegation state is in the response.
    // Sync it into liveDelegations so the chips show completed state even if
    // the Realtime UPDATE for the final row didn't arrive yet.
    if (data.delegations?.length) {
      setLiveDelegations(data.delegations);
    }

    return data;
  }

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (message: string, opts?: SendMessageOptions) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLiveDelegations(null);
    try {
      const data = await invoke({
        action:          'send_message',
        message,
        edited_strategy: opts?.editedStrategy,
      });
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach Aarav');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // ── regenerateCreatives ───────────────────────────────────────────────────

  const regenerateCreatives = useCallback(async (
    strategy: StrategyConfig,
    opts?: { angle: CreativeAngle; keep: CreativeVariant[] }
  ) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLiveDelegations(null);
    try {
      const data = await invoke({
        action:  'send_message',
        message: opts ? `Regenerate the ${opts.angle} creative.` : 'Regenerate all creatives.',
        regenerate_creatives: { strategy, angle: opts?.angle, keep: opts?.keep },
      });
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach Aarav');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // ── requestChange ─────────────────────────────────────────────────────────
  // Sends a new orchestration turn in the same session, carrying the user's
  // adjustment text and the existing strategy as context so Arjun can revise
  // it. NOT a specialist call — routes through aarav-orchestrate like every
  // other turn so the conversation thread accumulates.

  const requestChange = useCallback(async (adjustmentMessage: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLiveDelegations(null);
    try {
      const data = await invoke({
        action:          'request_change',
        message:         adjustmentMessage,
        // Pass existing strategy as edited_strategy so Arjun has context to
        // revise from rather than starting cold.
        edited_strategy: currentCanvasRef.current?.strategy,
      });
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach Aarav');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // ── approveTurn ───────────────────────────────────────────────────────────
  // INVARIANT: idempotent on double-click (approveRef) and on server
  // (approved_at IS NOT NULL check in handleApprove). Neither guard alone is
  // sufficient — the ref prevents a second HTTP request; the server prevents
  // a double-write if two requests somehow race.

  const approveTurn = useCallback(async (selectedCreativeIds?: string[]) => {
    if (approveRef.current) return;
    if (!currentTurnIdRef.current) {
      setApproveError('No active turn to approve.');
      return;
    }
    approveRef.current = true;
    setApproveLoading(true);
    setApproveError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke<ApproveResponse>(
        'aarav-orchestrate',
        {
          body: {
            action:               'approve',
            turn_id:              currentTurnIdRef.current,
            selected_creative_ids: selectedCreativeIds,
            session_id:           sessionIdRef.current,
          } satisfies AgentRequest,
        }
      );
      if (fnError) throw fnError;
      if (!data)   throw new Error('aarav-orchestrate returned no data');
      setApproveResult(data);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      approveRef.current = false;
      setApproveLoading(false);
    }
  }, []);

  // Trigger greeting on mount.
  useEffect(() => {
    void sendMessage(initialMessage);
    // sendMessage is stable (no deps that change). Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    response,
    loading,
    error,
    liveDelegations,
    sendMessage,
    regenerateCreatives,
    requestChange,
    approveTurn,
    approveResult,
    approveLoading,
    approveError,
  };
}
