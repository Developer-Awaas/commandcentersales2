// src/lib/chatbot-service.ts
// PURPOSE: Powers the floating AI chatbot. Context-aware, page-aware, database-aware.
// 30 messages/day limit. Logs all conversations.

import { getOrgId } from './constants';

const DAILY_LIMIT = 30;
const STORAGE_KEY = 'chatbot_usage';

// ============================================================
// MESSAGE LIMIT TRACKING
// ============================================================
export function getChatUsage(): { count: number; date: string } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const today = new Date().toISOString().split('T')[0];
      if (parsed.date === today) return parsed;
    }
  } catch {}
  return { count: 0, date: new Date().toISOString().split('T')[0] };
}

export function incrementChatUsage(): boolean {
  const usage = getChatUsage();
  if (usage.count >= DAILY_LIMIT) return false;
  const updated = { count: usage.count + 1, date: new Date().toISOString().split('T')[0] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return true;
}

export function getRemainingMessages(): number {
  return DAILY_LIMIT - getChatUsage().count;
}

// ============================================================
// BUILD CONTEXT FOR CHATBOT
// Reads current page + displayed data to make bot context-aware
// ============================================================
export function buildChatbotContext(pageInfo: {
  currentPage: string;
  currentSection: string; // 'lead_gen' or 'smm'
  displayedData?: any;    // whatever is currently shown on screen
  formValues?: any;       // current form state if any
  resultData?: any;       // AI result if any is displayed
}) {
  const lines = [
    'You are the AI Assistant for NH Marketing Command Center, a real estate performance marketing tool.',
    'You are helpful, concise, and specific. Give actionable answers.',
    'You know the tool inside out — every module, every feature, every field.',
    '',
    'CURRENT CONTEXT:',
    'Page: ' + pageInfo.currentPage,
    'Section: ' + pageInfo.currentSection,
  ];

  if (pageInfo.displayedData) {
    lines.push('Currently displayed data: ' + JSON.stringify(pageInfo.displayedData).substring(0, 1500));
  }

  if (pageInfo.formValues) {
    lines.push('Current form values: ' + JSON.stringify(pageInfo.formValues).substring(0, 500));
  }

  if (pageInfo.resultData) {
    lines.push('AI result currently showing: ' + JSON.stringify(pageInfo.resultData).substring(0, 1500));
  }

  lines.push('');
  lines.push('RULES:');
  lines.push('- Talk like a helpful colleague, not a manual. Be conversational, concise, direct.');
  lines.push('- NEVER tell the user to navigate elsewhere or click buttons. You have access to their data — use it. Read what\'s needed and answer directly.');
  lines.push('- NO numbered steps unless the user explicitly asks "how do I do X".');
  lines.push('- NO bold markdown headings. NO emoji decorations. NO "Steps:", "Alternatively:", "Want me to help?" patterns.');
  lines.push('- Just answer the question with real information. If you need data you don\'t have, ask one specific clarifying question.');
  lines.push('- For data questions (best project, current CPL, total leads, etc.), give a direct data-backed answer in 1-3 sentences.');
  lines.push('- For "how to" questions, give brief instructions in plain prose.');
  lines.push('- Match user\'s energy — short questions get short answers.');
  lines.push('- Indian context: use ₹, write in business-casual Indian English.');

  return lines.join('\n');
}

// ============================================================
// PAGE-SPECIFIC CONTEXT BUILDERS
// ============================================================
export const PAGE_CONTEXTS: Record<string, string> = {
  dashboard: 'User is on the Dashboard. They can see KPIs (projects, campaigns, spend, leads, CPL, alerts), project list, recent AI sessions, and quick action buttons.',
  projects: 'User is on the Projects page. They can view, add, edit, delete projects. Each project has name, location, price, units, USPs, amenities.',
  strategy: 'User is on the Strategy page. Two modes: Quick Generate (single ad) and Full Strategy (multi-project). Quick Generate needs: description, project, objective, platform. Full Strategy needs: budget, targets, project selection.',
  'ad-config': 'User is on Ad Config page. Generates exact field-by-field configuration for Meta Ads Manager or AiSensy. Needs: project, funnel stage, platform.',
  creatives: 'User is on Creatives page. Generates 3 creative variants with ad copy + Nanobanana prompts. Has creative library below. Can upload reference image.',
  'ad-review': 'User is on Ad Review page. Upload a creative image for AI analysis. Gets score, issues, category reviews, revised prompt. Full design DNA extraction.',
  analyzer: 'User is on Lead Gen Analyzer. Enter campaign metrics (spend, leads, CPL, CTR etc.) for AI analysis. Can import CSV. Metrics history table at bottom.',
  organic: 'User is on Organic Planner. Generates weekly content calendar for Instagram and Facebook.',
  notifications: 'User is on Notifications page. Shows proactive alerts: performance warnings, creative refresh reminders, analysis reminders, budget alerts.',
  reports: 'User is on Reports page. Admin overview: KPIs, campaign table, AI sessions, activity log, data export, AWAAS pipeline.',
  settings: 'User is on Settings. Configure: brand info, social URLs, competitors, API keys.',
  'smm-planner': 'User is on SMM Planner. Step-by-step: describe what to create → enter metrics → AI generates content plan → review calendar.',
  'smm-calendar': 'User is on SMM Calendar. Visual calendar showing planned posts. Can edit individual posts, change dates, update status.',
  'smm-creatives': 'User is on SMM Creatives. Generate social media post designs: branding, holidays, events, engagement, awareness.',
  'smm-analyzer': 'User is on SMM Analyzer. Enter Instagram/Facebook account metrics for analysis. Gets engagement analysis, timing recommendations, content suggestions.',
};

// ============================================================
// LOG CHAT MESSAGE TO DATABASE
// ============================================================
export async function logChatMessage(supabase: any, data: {
  pageContext: string;
  dataContext?: string;
  userMessage: string;
  botResponse: string;
  tokensUsed?: number;
}) {
  try {
    await supabase.from('chatbot_log').insert({
      org_id: getOrgId(),
      user_id: 'dev-user-001', // TODO: Replace with real user ID
      page_context: data.pageContext,
      data_context: data.dataContext?.substring(0, 2000) || null,
      user_message: data.userMessage,
      bot_response: data.botResponse,
      tokens_used: data.tokensUsed || 0,
    });
  } catch (e) {
    console.error('Failed to log chat:', e);
  }
}