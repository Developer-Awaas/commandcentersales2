// src/lib/smm-prompts.ts
// PURPOSE: AI prompt builders for all Social Media Marketing modules.

import { formatProject, formatCompetitors } from './prompt-builders';

// ============================================================
// SMM PLANNER PROMPT
// ============================================================
export function buildSMMPlannerPrompt(data: {
  description: string;
  type: string;        // company_branding, project_branding, holiday, goal_based
  goal: string;        // awareness, engagement, followers, website_traffic, lead_support
  projects: any[];
  duration: string;    // 1 week, 2 weeks, 1 month, 2 months, 3 months, custom
  startDate: string;
  endDate?: string;
  holidays: any[];     // [{name, date}]
  customEvents: any[]; // [{name, date}]
  metrics?: {
    ig_followers?: number;
    ig_avg_likes?: number;
    ig_avg_reach?: number;
    ig_avg_saves?: number;
    ig_engagement_rate?: number;
    ig_best_day?: string;
    ig_best_time?: string;
    fb_page_likes?: number;
    fb_avg_reach?: number;
    fb_avg_engagement?: number;
  };
  contextHistory?: string;
}) {
  const lines = [
    'Create a complete social media content plan for a real estate company.',
    '',
    'USER REQUEST: ' + data.description,
    'TYPE: ' + data.type,
    'GOAL: ' + data.goal,
    'DURATION: ' + data.duration + ' starting ' + data.startDate + (data.endDate ? ' to ' + data.endDate : ''),
    'PROJECTS: ' + data.projects.map(p => formatProject(p)).join(' | '),
    'PLATFORMS: Instagram + Facebook',
  ];

  if (data.holidays.length > 0) {
    lines.push('HOLIDAYS/FESTIVALS in this period:');
    data.holidays.forEach(h => lines.push('  - ' + h.name + ' (' + h.date + ')'));
  }

  if (data.customEvents.length > 0) {
    lines.push('CUSTOM EVENTS:');
    data.customEvents.forEach(e => lines.push('  - ' + e.name + ' (' + e.date + ')'));
  }

  if (data.metrics) {
    lines.push('');
    lines.push('CURRENT SOCIAL MEDIA METRICS:');
    if (data.metrics.ig_followers) lines.push('  Instagram: ' + data.metrics.ig_followers + ' followers, ' + (data.metrics.ig_avg_likes || '?') + ' avg likes, ' + (data.metrics.ig_avg_reach || '?') + ' avg reach, ' + (data.metrics.ig_engagement_rate || '?') + '% engagement rate');
    if (data.metrics.ig_best_day) lines.push('  Best day: ' + data.metrics.ig_best_day + ', Best time: ' + (data.metrics.ig_best_time || '?'));
    if (data.metrics.fb_page_likes) lines.push('  Facebook: ' + data.metrics.fb_page_likes + ' page likes, ' + (data.metrics.fb_avg_reach || '?') + ' avg reach');
  }

  if (data.contextHistory) {
    lines.push('');
    lines.push('PAST PERFORMANCE:');
    lines.push(data.contextHistory);
  }

  lines.push('');
  lines.push('OUTPUT SIZE CRITICAL: The calendar array must be COMPACT. For each post output ONLY: date, day, platform, type, category, topic (max 80 chars), time. DO NOT generate full captions, hashtags, or image prompts here — those are generated per-post later in SMM Creatives. Total output must stay under 8000 tokens. If duration exceeds 60 days, summarize as weekly themes instead of daily entries.');
  lines.push('');
  lines.push('Return JSON:');
  lines.push('{');
  lines.push('  "overview": "plan summary",');
  lines.push('  "contentMix": {"reels": 0, "carousels": 0, "staticPosts": 0, "stories": 0, "videos": 0},');
  lines.push('  "pillars": [{"pillar": "name", "freq": "X/week", "purpose": "why"}],');
  lines.push('  "bestPostingTimes": {"instagram": {"bestDays": ["Tue","Thu"], "bestTimes": ["12:30 PM","6:00 PM"]}, "facebook": {"bestDays": ["Wed","Fri"], "bestTimes": ["11:00 AM"]}},');
  lines.push('  "calendar": [{"date":"May 2","day":"Friday","platform":"Instagram","type":"Reel","category":"Brand Story","topic":"Founder\'s vision: building trust in Bhubaneswar real estate","time":"6:00 PM"}],');
  lines.push('  "kpiTargets": {"reachGrowth": "+X%", "engagementTarget": "X%", "followerGrowth": "+X"},');
  lines.push('  "weeklyBreakdown": [{"week": 1, "theme": "theme", "focus": "what this week emphasizes", "postCount": 5}],');
  lines.push('  "tips": ["engagement tip"]');
  lines.push('}');

  return lines.join('\n');
}

// ============================================================
// SMM CREATIVES PROMPT
// ============================================================
export function buildSMMCreativePrompt(data: {
  type: string;       // company_branding, project_branding, holiday, event, engagement, awareness, milestone
  description: string;
  project?: any;
  holiday?: string;
  event?: string;
  platform: string;   // Nanobanana, Canva, etc.
}) {
  const typeLabels: Record<string, string> = {
    company_branding: 'Company Branding Post — showcase the brand, values, team, office',
    project_branding: 'Project Spotlight Post — highlight project features, USPs, progress',
    holiday: 'Holiday/Festival Post — ' + (data.holiday || 'festival greeting') + ' with brand integration',
    event: 'Event Post — ' + (data.event || 'company event') + ' announcement or coverage',
    engagement: 'Engagement Post — poll, this-or-that, question, quiz to drive interaction',
    awareness: 'Awareness/Educational Post — real estate tips, market updates, buyer guides',
    milestone: 'Milestone Post — units sold, years completed, happy customers, achievement',
  };

  const lines = [
    'Create a social media post for a real estate company.',
    '',
    'POST TYPE: ' + (typeLabels[data.type] || data.type),
    'USER DESCRIPTION: ' + data.description,
  ];

  if (data.project) {
    lines.push('PROJECT: ' + formatProject(data.project));
  }

  lines.push('CREATIVE PLATFORM: ' + data.platform);
  lines.push('');
  lines.push('Return JSON:');
  lines.push('{');
  lines.push('  "concept": "one line post concept",');
  lines.push('  "captionEn": "FULL Instagram caption with emojis, line breaks, CTA",');
  lines.push('  "captionOd": "Odia version",');
  lines.push('  "hashtags": ["15 real relevant hashtags"],');
  lines.push('  "bestTime": "optimal posting time",');
  lines.push('  "bestPlatform": "instagram or facebook or both",');
  lines.push('  "postType": "static or carousel or reel or story",');
  lines.push('  "nanoPrompt": "COMPLETE ' + data.platform + ' prompt for 1080x1080: visual style, elements, colors hex, text overlay, layout, logo placement, mood, brand colors #1B4332 #2DD4A8",');
  lines.push('  "nanoPromptStory": "Same for 1080x1920 story format",');
  lines.push('  "carouselSlides": ["slide 1 content", "slide 2 content"] ,');
  lines.push('  "reelScript": "script with timestamps if reel/video",');
  lines.push('  "engagementHook": "first line that stops the scroll",');
  lines.push('  "ctaSuggestion": "what action to ask followers to take"');
  lines.push('}');

  return lines.join('\n');
}

// ============================================================
// SMM ANALYZER PROMPT
// ============================================================
export function buildSMMAnalyzerPrompt(data: {
  platform: string;
  period: string;
  metrics: {
    followers?: number;
    posts_published?: number;
    avg_reach?: number;
    avg_likes?: number;
    avg_comments?: number;
    avg_saves?: number;
    avg_shares?: number;
    engagement_rate?: number;
    profile_visits?: number;
    website_clicks?: number;
    follower_growth?: number;
  };
  currentPlan?: any; // current SMM calendar if exists
  contextHistory?: string;
}) {
  const lines = [
    'Analyze social media performance for a real estate company and suggest improvements.',
    '',
    'PLATFORM: ' + data.platform,
    'PERIOD: ' + data.period,
    'METRICS:',
    '  Followers: ' + (data.metrics.followers || '?'),
    '  Posts Published: ' + (data.metrics.posts_published || '?'),
    '  Avg Reach/Post: ' + (data.metrics.avg_reach || '?'),
    '  Avg Likes/Post: ' + (data.metrics.avg_likes || '?'),
    '  Avg Comments/Post: ' + (data.metrics.avg_comments || '?'),
    '  Avg Saves/Post: ' + (data.metrics.avg_saves || '?'),
    '  Avg Shares/Post: ' + (data.metrics.avg_shares || '?'),
    '  Engagement Rate: ' + (data.metrics.engagement_rate || '?') + '%',
    '  Profile Visits: ' + (data.metrics.profile_visits || '?'),
    '  Website Clicks: ' + (data.metrics.website_clicks || '?'),
    '  Follower Growth: ' + (data.metrics.follower_growth || '?'),
  ];

  if (data.contextHistory) {
    lines.push('');
    lines.push('PAST DATA:');
    lines.push(data.contextHistory);
  }

  lines.push('');
  lines.push('Return JSON:');
  lines.push('{');
  lines.push('  "healthScore": 7,');
  lines.push('  "assessment": "2-3 sentence overall summary",');
  lines.push('  "scorecard": [{"metric": "Engagement Rate", "value": "4.2%", "benchmark": "3.5% for real estate", "status": "green or yellow or red", "insight": "brief"}],');
  lines.push('  "contentPerformance": {"bestType": "which post type works best", "worstType": "worst", "recommendation": "what to change"},');
  lines.push('  "timingAnalysis": {"bestDay": "day", "bestTime": "time", "worstDay": "day", "recommendation": "timing changes"},');
  lines.push('  "audienceInsights": "what the metrics tell about the audience",');
  lines.push('  "competitorComparison": "how these metrics compare to typical real estate accounts in Bhubaneswar",');
  lines.push('  "suggestions": ["specific actionable suggestion 1", "suggestion 2", "suggestion 3", "suggestion 4", "suggestion 5"],');
  lines.push('  "calendarChanges": ["specific change to current posting plan"],');
  lines.push('  "nextMonthFocus": "what to prioritize next month based on data",');
  lines.push('  "kpiTargets": {"reachGrowth": "+X%", "engagementTarget": "X%", "followerGrowth": "+X", "profileVisitsTarget": "X"}');
  lines.push('}');

  return lines.join('\n');
}

// ============================================================
// SCREENSHOT GUIDANCE — tells user what to screenshot
// ============================================================
export const SCREENSHOT_GUIDES = {
  instagram_reach: {
    title: 'Instagram Accounts Reached',
    steps: [
      'Open Instagram app',
      'Go to your profile',
      'Tap "Professional Dashboard" or "Insights"',
      'Tap "Accounts Reached"',
      'Screenshot the full page showing total reach, top cities, age range, gender split',
    ],
    fields_extracted: ['total_reach', 'top_cities', 'age_range', 'gender_split', 'reach_trend'],
  },
  instagram_engagement: {
    title: 'Instagram Content Interactions',
    steps: [
      'In Insights, tap "Accounts Engaged"',
      'Screenshot showing likes, comments, saves, shares breakdown',
    ],
    fields_extracted: ['avg_likes', 'avg_comments', 'avg_saves', 'avg_shares', 'engagement_rate'],
  },
  instagram_followers: {
    title: 'Instagram Follower Growth',
    steps: [
      'In Insights, tap "Total Followers"',
      'Screenshot showing follower count, growth, top locations, age ranges, most active times',
    ],
    fields_extracted: ['followers', 'follower_growth', 'top_locations', 'active_times', 'active_days'],
  },
  facebook_overview: {
    title: 'Facebook Page Insights Overview',
    steps: [
      'Open Facebook page',
      'Click "Insights" or "Professional Dashboard"',
      'Screenshot the overview page showing page likes, reach, engagement',
    ],
    fields_extracted: ['page_likes', 'total_reach', 'total_engagement', 'post_reach_avg'],
  },
};

// ============================================================
// SCREENSHOT EXTRACTION PROMPT
// ============================================================
export function buildScreenshotExtractionPrompt(screenshotType: string) {
  return `Extract social media metrics from this screenshot. Read ALL numbers and data visible.

SCREENSHOT TYPE: ${screenshotType}

Return JSON with every metric you can read:
{
  "extracted": {
    "followers": null,
    "follower_growth": null,
    "avg_reach": null,
    "avg_impressions": null,
    "avg_likes": null,
    "avg_comments": null,
    "avg_saves": null,
    "avg_shares": null,
    "engagement_rate": null,
    "profile_visits": null,
    "website_clicks": null,
    "top_cities": [],
    "age_ranges": {},
    "gender_split": {},
    "best_days": [],
    "best_times": [],
    "reach_trend": "up or down or flat"
  },
  "confidence": "high or medium or low",
  "missingFields": ["fields that could not be read from screenshot"],
  "notes": "any observations about the data"
}

Only fill values you can actually read from the screenshot. Leave null for anything not visible.`;
}