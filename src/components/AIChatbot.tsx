import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Minus, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import {
  buildChatbotContext,
  getRemainingMessages,
  incrementChatUsage,
  logChatMessage,
  PAGE_CONTEXTS,
} from '../lib/chatbot-service';
import { useNavigation } from '../contexts/NavigationContext';
import { useChatbot } from '../contexts/ChatbotContext';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: Date;
}

const GREETING = "Hi! I'm your marketing AI assistant. Ask me anything about your campaigns, projects, or this page.";

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 max-w-[80%]">
      <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-surface">
        AI
      </div>
      <div className="bg-surface-elevated rounded-lg px-3 py-2.5 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[#7a9988] animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function formatTime(d: Date) {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function AIChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 'greeting', role: 'bot', text: GREETING, timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [remaining, setRemaining] = useState(getRemainingMessages());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { activePage, activeSection } = useNavigation();
  const { currentData } = useChatbot();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  function addMessage(msg: Omit<Message, 'id'>) {
    const id = Math.random().toString(36).slice(2);
    setMessages((prev) => [...prev, { ...msg, id }]);
  }

  async function fetchLiveData(): Promise<string> {
    const orgId = getOrgId();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const [projectsRes, campaignsRes, metricsRes, sessionsRes, funnelRes] = await Promise.all([
      supabase.from('projects').select('name,locality,configurations,units_remaining,total_units,status,priority').eq('is_active', true).eq('org_id', orgId),
      supabase.from('campaigns').select('campaign_name,project_id,status,budget,started_at').eq('status', 'active').eq('org_id', orgId).limit(10),
      supabase.from('daily_metrics').select('spend,leads,cpl,ctr,date,project_id').eq('org_id', orgId).gte('date', thirtyDaysAgo),
      supabase.from('ai_sessions').select('session_type,input_summary,health_score,created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(10),
      supabase.from('lead_funnel').select('total_leads,sv_done,booked,week_start').eq('org_id', orgId).gte('week_start', thirtyDaysAgo),
    ]);

    const lines: string[] = ['LIVE_DATA:'];

    // Projects
    const projects = (projectsRes.data ?? []) as Array<{ name: string; locality: string; configurations: unknown; units_remaining: number | null; total_units: number | null; status: string; priority: string }>;
    if (projects.length > 0) {
      lines.push('PROJECTS: ' + projects.map((p) => `${p.name} (${p.locality || 'N/A'}, ${p.status}, priority:${p.priority}, ${p.units_remaining ?? '?'}/${p.total_units ?? '?'} units)`).join(' | '));
    }

    // Active campaigns
    const campaigns = (campaignsRes.data ?? []) as Array<{ campaign_name: string; budget: unknown; started_at: string }>;
    if (campaigns.length > 0) {
      lines.push('ACTIVE CAMPAIGNS: ' + campaigns.map((c) => {
        const days = c.started_at ? Math.floor((Date.now() - new Date(c.started_at).getTime()) / 86400000) : '?';
        const budgetStr = c.budget && typeof c.budget === 'object' ? (c.budget as Record<string, unknown>).daily ?? '' : '';
        return `${c.campaign_name} (₹${budgetStr}/day, ${days}d ago)`;
      }).join(' | '));
    }

    // Metrics — aggregate by project_id
    const metrics = (metricsRes.data ?? []) as Array<{ spend: number; leads: number; cpl: number; ctr: number; project_id: string }>;
    if (metrics.length > 0) {
      const byProject: Record<string, { spend: number; leads: number; cpls: number[]; ctrs: number[] }> = {};
      for (const m of metrics) {
        const key = m.project_id || 'unknown';
        if (!byProject[key]) byProject[key] = { spend: 0, leads: 0, cpls: [], ctrs: [] };
        byProject[key].spend += m.spend || 0;
        byProject[key].leads += m.leads || 0;
        if (m.cpl) byProject[key].cpls.push(m.cpl);
        if (m.ctr) byProject[key].ctrs.push(m.ctr);
      }
      const projectMap = Object.fromEntries(projects.map((p) => [p.name, p.name]));
      const metricLines = Object.entries(byProject).map(([pid, d]) => {
        const name = projectMap[pid] || pid.substring(0, 8);
        const avgCpl = d.cpls.length ? Math.round(d.cpls.reduce((a, b) => a + b, 0) / d.cpls.length) : (d.leads > 0 ? Math.round(d.spend / d.leads) : 0);
        const avgCtr = d.ctrs.length ? (d.ctrs.reduce((a, b) => a + b, 0) / d.ctrs.length).toFixed(2) : '?';
        return `${name}: ₹${d.spend} spend, ${d.leads} leads, CPL ₹${avgCpl}, CTR ${avgCtr}%`;
      });
      lines.push('30D METRICS: ' + metricLines.join(' | '));
    }

    // AI sessions
    const sessions = (sessionsRes.data ?? []) as Array<{ session_type: string; input_summary: string; health_score: number | null; created_at: string }>;
    if (sessions.length > 0) {
      lines.push('RECENT AI SESSIONS: ' + sessions.slice(0, 5).map((s) => `${s.session_type} (${s.input_summary?.substring(0, 40)}, score:${s.health_score ?? 'n/a'})`).join(' | '));
    }

    // Funnel
    const funnel = (funnelRes.data ?? []) as Array<{ total_leads: number; sv_done: number; booked: number }>;
    if (funnel.length > 0) {
      const totals = funnel.reduce((acc, f) => ({ leads: acc.leads + (f.total_leads || 0), svs: acc.svs + (f.sv_done || 0), booked: acc.booked + (f.booked || 0) }), { leads: 0, svs: 0, booked: 0 });
      lines.push(`30D FUNNEL: ${totals.leads} leads → ${totals.svs} SVs → ${totals.booked} bookings`);
    }

    return lines.join('\n').substring(0, 1500);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || typing) return;
    setInput('');

    if (!isAiEnabled()) {
      addMessage({ role: 'bot', text: 'AI is not configured. Add your Claude API key in Settings.', timestamp: new Date() });
      return;
    }

    const rem = getRemainingMessages();
    if (rem <= 0) {
      addMessage({ role: 'bot', text: 'Daily limit reached (30 messages). Resets at midnight.', timestamp: new Date() });
      return;
    }

    const ok = incrementChatUsage();
    if (!ok) {
      addMessage({ role: 'bot', text: 'Daily limit reached (30 messages). Resets at midnight.', timestamp: new Date() });
      return;
    }

    setRemaining(getRemainingMessages());
    addMessage({ role: 'user', text, timestamp: new Date() });
    setTyping(true);

    const pageContext = PAGE_CONTEXTS[activePage] || `User is on the ${activePage} page.`;

    try {
      // Fetch live data and build system prompt in parallel with nothing else blocking
      const liveData = await fetchLiveData();

      const systemPrompt = buildChatbotContext({
        currentPage: activePage,
        currentSection: activeSection,
        displayedData: Object.keys(currentData).length > 0 ? currentData : undefined,
      }) + '\n\n' + liveData;

      // Build conversation history for context (last 6 messages)
      const historyPrompt = messages
        .filter((m) => m.id !== 'greeting')
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n');

      const fullPrompt = historyPrompt ? `${historyPrompt}\nUser: ${text}` : text;

      const res = await aiCall(fullPrompt, systemPrompt);
      const botText = res.error
        ? 'Sorry, I ran into an error. Please try again.'
        : typeof res === 'string'
          ? res
          : (res as Record<string, unknown>).raw
            ? String((res as Record<string, unknown>).raw)
            : JSON.stringify(res);

      addMessage({ role: 'bot', text: botText, timestamp: new Date() });

      logChatMessage(supabase, {
        pageContext,
        dataContext: liveData.substring(0, 500),
        userMessage: text,
        botResponse: botText,
      });
    } catch {
      addMessage({ role: 'bot', text: 'Something went wrong. Please try again.', timestamp: new Date() });
    }

    setTyping(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const dailyLimitReached = remaining <= 0;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3">
      {open && (
        <div className="w-[380px] h-[500px] flex flex-col rounded-2xl border border-border bg-surface-elevated shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-surface-sunken border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center">
                <MessageCircle size={14} className="text-surface" />
              </div>
              <span className="text-sm font-semibold text-text-primary">AI Assistant</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${dailyLimitReached ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-surface-elevated text-text-tertiary border-border'}`}>
                {remaining}/30 today
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <Minus size={15} />
              </button>
              <button
                onClick={() => { setOpen(false); setMessages([{ id: 'greeting', role: 'bot', text: GREETING, timestamp: new Date() }]); }}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'items-end gap-2'}`}>
                {msg.role === 'bot' && (
                  <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-surface">
                    AI
                  </div>
                )}
                <div className={`flex flex-col gap-0.5 max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-brand text-surface font-medium rounded-br-sm'
                        : 'bg-surface-elevated text-text-primary rounded-bl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-text-tertiary/60">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            ))}
            {typing && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer */}
          <div className="px-3 py-3 border-t border-border bg-surface-sunken flex-shrink-0">
            {dailyLimitReached ? (
              <p className="text-xs text-text-tertiary text-center py-1">Daily limit reached. Resets at midnight.</p>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={typing}
                  placeholder="Ask anything…"
                  className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand transition-colors disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || typing}
                  className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-brand text-surface hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => { setOpen((v) => !v); setRemaining(getRemainingMessages()); }}
        className="w-14 h-14 rounded-full bg-brand text-surface flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-150 active:scale-95"
        title="AI Assistant"
      >
        {open
          ? <Minus size={22} />
          : <MessageCircle size={22} />
        }
      </button>
    </div>
  );
}
