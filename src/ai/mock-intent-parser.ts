import { TaskPriority } from '@/contexts/tasks-context';
import { AIAction, ParseIntentResult } from './ai-types';
import { getTodayString, getDateString, parseNaturalDateString } from '@/lib/date-time';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDurationMinutes(text: string): number | null {
  const lower = text.toLowerCase();

  // 1. Special phrases: "half an hour" / "half hour"
  if (/\bhalf\s+(?:an?\s+)?hour\b/i.test(lower)) {
    return 30;
  }

  // 2. Special phrases: "one and a half hours" / "1.5 hours"
  if (
    /\b(?:one|1)\s+and\s+(?:a\s+)?half\s+hours?\b/i.test(lower) ||
    /\b1\.5\s*(?:hours|hour|hrs|hr|h\b)/i.test(lower)
  ) {
    return 90;
  }

  const wordToNum: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  // Match hour expressions: "for about an hour", "around 90 minutes", "two hours", "for 2 hours"
  const hoursMatch = lower.match(
    /\b(?:for|about|around|approx|approximately)?\s*(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours|hour|hrs|hr|h\b)/i
  );
  if (hoursMatch) {
    const valStr = hoursMatch[1].toLowerCase();
    const num = wordToNum[valStr] !== undefined ? wordToNum[valStr] : parseFloat(valStr);
    if (!isNaN(num) && num > 0) {
      return Math.round(num * 60);
    }
  }

  const wordToMins: Record<string, number> = {
    ten: 10,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    fortyfive: 45,
    sixty: 60,
    ninety: 90,
  };

  const minsMatch = lower.match(
    /\b(?:for|about|around|approx|approximately)?\s*(\d+|ten|fifteen|twenty|thirty|fortyfive|sixty|ninety)\s*(?:minutes|minute|mins|min|m\b)/i
  );
  if (minsMatch) {
    const valStr = minsMatch[1].toLowerCase();
    const num = wordToMins[valStr] !== undefined ? wordToMins[valStr] : parseInt(valStr, 10);
    if (!isNaN(num) && num > 0) {
      return num;
    }
  }

  return null;
}

function parsePriority(text: string): TaskPriority {
  const lower = text.toLowerCase();
  if (lower.includes('high priority') || lower.includes('priority high')) return 'high';
  if (lower.includes('low priority') || lower.includes('priority low')) return 'low';
  return 'medium';
}

type ExtractedDateResult = {
  date: string | null;
  cleanedText: string;
  unresolvedTemporalPhrase?: string;
};

function extractDateAndCleanText(text: string): ExtractedDateResult {
  const unresolvedPatterns = [
    /\bnext\s+week\b/i,
    /\bthis\s+week\b/i,
    /\bnext\s+month\b/i,
    /\bin\s+\d+\s+(?:days|weeks|months)\b/i,
    /\bnext\s+next\b/i,
  ];

  for (const pattern of unresolvedPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        date: null,
        cleanedText: text,
        unresolvedTemporalPhrase: match[0],
      };
    }
  }

  const parseResult = parseNaturalDateString(text);
  let cleaned = text;

  if (parseResult.matchedPhrase) {
    const escaped = parseResult.matchedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const phraseRegex = new RegExp(`(?:\\b(?:on|for)\\s+)?\\b${escaped}\\b`, 'gi');
    cleaned = cleaned.replace(phraseRegex, '');
  }

  cleaned = cleaned.replace(/\b(?:in\s+the\s+)?(?:morning|afternoon|evening|night)\b/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return { date: parseResult.date, cleanedText: cleaned };
}

function cleanTaskTitle(text: string): string {
  let title = text;

  // 1. Remove leading intent prefixes / verbs
  const prefixRegex =
    /^(?:add|create|task|i\s+need\s+to\s+study|i\s+need\s+to|need\s+to|remind\s+me\s+to|i\s+have\s+to\s+study|i\s+have\s+to|have\s+to|must|i\s+want\s+to\s+study|i\s+want\s+to|want\s+to|i\s+should\s+study|i\s+should|study|work\s+on|do|practice|read|write|prepare|review|fit|schedule)\s+/i;
  title = title.replace(prefixRegex, '');

  // Secondary check for leftover prefix words
  title = title.replace(
    /^(?:i\s+need\s+to|need\s+to|i\s+want\s+to|want\s+to|i\s+have\s+to|have\s+to|study|work\s+on|fit)\s+/i,
    ''
  );

  // 2. Remove priority phrases
  title = title.replace(/\b(?:high|medium|low)\s+priority\b/gi, '');
  title = title.replace(/\bpriority\s+(?:high|medium|low)\b/gi, '');

  // 3. Remove duration phrases
  title = title.replace(
    /\b(?:for|about|around|approx|approximately)?\s*(?:\d+(?:\.\d+)?|half|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(?:and\s+a\s+half\s+)?(?:hours|hour|hrs|hr|h|minutes|minute|mins|min|m)\b/gi,
    ''
  );
  title = title.replace(/\b(?:for|about|around|approx|approximately)?\s*an?\s+hour\b/gi, '');

  // 4. Remove filler phrases & trailing prepositions
  title = title.replace(/,?\s*(?:can|could)\s+you\s+fit\s+(?:it|this)?\s*(?:in|into\s+my\s+day)?\??$/i, '');
  title = title.replace(/\b(?:fit|fit\s+it)\s+(?:in|into)\s+my\s+day\b/gi, '');
  title = title.replace(/\binto\s+my\s+day\b/gi, '');
  title = title.replace(/\bmy\s+day\b/gi, '');
  title = title.replace(/\b(?:for|on|at|in|to)\b\s*$/gi, '');

  title = title.replace(/\s+/g, ' ').trim();

  return title ? title.charAt(0).toUpperCase() + title.slice(1) : title;
}

export function parseIntent(userMessage: string): ParseIntentResult {
  const rawTrimmed = userMessage.trim();
  if (!rawTrimmed) {
    return { success: false, error: 'Please enter a message.' };
  }

  const normalized = normalizeText(userMessage);

  // Check for non-action / conversational / question intents
  const conversationQuestions = [
    /^(?:hey|hello|hi|greetings|good\s+morning|good\s+evening)\b/i,
    /^(?:do\s+you\s+think|should\s+i|how\s+should\s+i|how\s+can\s+i|what\s+should\s+i|can\s+you\s+advise)\b/i,
    /^(?:i\s+studied|i\s+finished|i\s+was\s+studying|i\s+did|i\s+went|i\s+was|i\s+am\s+tired|i\s+feel)\b/i,
    /^yesterday\s+i\s+(?:spent|studied|finished|was|did)\b/i,
  ];

  for (const pattern of conversationQuestions) {
    if (pattern.test(normalized)) {
      if (/^(?:hey|hello|hi|greetings)\b/i.test(normalized)) {
        return {
          success: false,
          error: 'Hello Mukhesh! How can I help you plan your day?',
        };
      }
      if (/^(?:i\s+studied|i\s+finished|i\s+was\s+studying|i\s+did|i\s+went|yesterday)/i.test(normalized)) {
        return {
          success: false,
          error: 'Great job completing your study session!',
        };
      }
      return {
        success: false,
        error: 'I am here to help you manage your Life OS plan. Would you like me to schedule a task for you?',
      };
    }
  }

  // 1. Get schedule queries
  if (
    normalized === 'schedule' ||
    normalized.includes('whats my schedule') ||
    normalized.includes('what is my schedule') ||
    normalized.includes('show my schedule') ||
    normalized.includes('get schedule') ||
    normalized.includes('view my schedule')
  ) {
    return {
      success: true,
      actions: [{ type: 'get_schedule' }],
    };
  }

  // 2. Free time queries
  if (
    normalized.includes('whats my free time') ||
    normalized.includes('what is my free time') ||
    normalized.includes('free time')
  ) {
    return {
      success: true,
      actions: [{ type: 'get_free_time' }],
    };
  }

  // 3. Replan day
  if (
    normalized === 'replan' ||
    normalized.includes('replan my day') ||
    normalized.includes('replan day') ||
    normalized.includes('replan the day')
  ) {
    return {
      success: true,
      actions: [{ type: 'replan_day' }],
    };
  }

  // 4. Update task patterns
  // A. Anytime / Remove date
  const anytimeMatch =
    normalized.match(/^(?:make|set|change)\s+(.+?)\s+(?:an\s+)?anytime\s*(?:task)?$/i) ||
    normalized.match(/^(?:remove|clear)\s+(?:the\s+)?date\s+(?:from|for)\s+(.+)$/i) ||
    normalized.match(/^undate\s+(.+)$/i);

  if (anytimeMatch && anytimeMatch[1]?.trim()) {
    return {
      success: true,
      actions: [
        {
          type: 'update_task',
          payload: {
            taskTitleQuery: anytimeMatch[1].trim(),
            date: null,
          },
        },
      ],
    };
  }

  // B. Priority update
  const priorityMatch =
    normalized.match(/^(?:make|set|change|update)\s+(.+?)\s+(high|medium|low)\s+priority$/i) ||
    normalized.match(/^(?:change|set|update)\s+(.+?)\s+priority\s+to\s+(high|medium|low)$/i);

  if (priorityMatch) {
    const taskTitleQuery = priorityMatch[1].trim();
    const priority = priorityMatch[2].toLowerCase() as TaskPriority;
    return {
      success: true,
      actions: [
        {
          type: 'update_task',
          payload: { taskTitleQuery, priority },
        },
      ],
    };
  }

  // C. Duration update
  const durationMatch =
    normalized.match(
      /^(?:change|set|update|make)\s+(.+?)\s+(?:duration\s+)?to\s+(\d+(?:\.\d+)?\s*(?:hours|hour|hrs|hr|h|minutes|minute|mins|min|m)|two\s+hours|one\s+hour|an?\s+hour|half\s+an?\s+hour|\d+\s+hours?)$/i
    ) ||
    normalized.match(
      /^(?:make)\s+(.+?)\s+(two\s+hours|one\s+hour|an?\s+hour|half\s+an?\s+hour|\d+\s+hours?|\d+\s+minutes?)$/i
    );

  if (durationMatch) {
    const taskTitleQuery = durationMatch[1].trim();
    const durationMinutes = parseDurationMinutes(durationMatch[2]);
    if (durationMinutes !== null) {
      return {
        success: true,
        actions: [
          {
            type: 'update_task',
            payload: { taskTitleQuery, durationMinutes },
          },
        ],
      };
    }
  }

  // D. Date update / Move / Reschedule
  const moveMatch =
    normalized.match(/^(?:move|reschedule|shift|postpone)\s+(.+?)\s+to\s+(.+)$/i) ||
    normalized.match(/^(?:change|update|set)\s+(.+?)\s+(?:date\s+)?to\s+(.+)$/i);

  if (moveMatch) {
    const taskTitleQuery = moveMatch[1].trim();
    const datePhrase = moveMatch[2].trim();
    const dateResult = parseNaturalDateString(datePhrase);
    if (dateResult.date !== null) {
      return {
        success: true,
        actions: [
          {
            type: 'update_task',
            payload: { taskTitleQuery, date: dateResult.date },
          },
        ],
      };
    }
  }

  // 5. Complete task patterns
  const completeRegexes = [
    /^(?:i\s+have\s+|i\s+)?(?:complete|completed|finish|finished)\s+(.+)$/,
    /^mark\s+(.+?)\s+(?:as\s+)?(?:complete|completed|done|finished)$/,
    /^(.+?)\s+is\s+(?:complete|completed|done|finished)$/,
    /^done\s+(?:with\s+)?(.+)$/,
  ];

  for (const regex of completeRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]?.trim()) {
      return {
        success: true,
        actions: [
          {
            type: 'complete_task',
            payload: { taskTitleQuery: match[1].trim() },
          },
        ],
      };
    }
  }

  // 6. Skip task patterns
  const skipRegexes = [
    /^(?:i\s+)?(?:skip|skipped)\s+(.+)$/,
    /^(?:i\s+)?(?:cant\s+do|cannot\s+do|dont\s+do)\s+(.+)$/,
  ];

  for (const regex of skipRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]?.trim()) {
      return {
        success: true,
        actions: [
          {
            type: 'skip_task',
            payload: { taskTitleQuery: match[1].trim() },
          },
        ],
      };
    }
  }

  // 7. Delete task patterns
  const deleteRegexes = [/^(?:i\s+)?(?:delete|deleted|remove|removed)\s+(.+)$/];

  for (const regex of deleteRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]?.trim()) {
      return {
        success: true,
        actions: [
          {
            type: 'delete_task',
            payload: { taskTitleQuery: match[1].trim() },
          },
        ],
      };
    }
  }

  // 8. Create task patterns (with sentence tolerance & filler stripping)
  let cleanMsg = normalized
    .replace(/,?\s*(?:can|could)\s+you\s+fit\s+(?:it|this)\s+(?:in|into\s+my\s+day)?\??$/i, '')
    .replace(/^\s*(?:can|could)\s+you\s+(?:please\s+)?(?:add|schedule|fit)?\s*/i, 'add ')
    .replace(/^\s*please\s+add\s+/i, 'add ')
    .replace(
      /^\s*put\s+(.+?)\s+on\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)'s\s+plan$/i,
      'add $1'
    )
    .trim();

  const createPrefixes = [
    /^(?:add|create)\s+(?:task\s+)?(.+)$/i,
    /^(?:i\s+need\s+to|need\s+to|remind\s+me\s+to|i\s+have\s+to|have\s+to|must|i\s+want\s+to|want\s+to|i\s+should)\s+(.+)$/i,
    /^(?:study|work\s+on|do|practice|read|write|prepare|review|fit)\s+(.+)$/i,
    /^(?:tomorrow|today|day\s+after\s+tomorrow)\s+(?:i\s+(?:need|want|have|should)\s+to\s+)?(.+)$/i,
  ];

  let createMatch: RegExpMatchArray | null = null;
  for (const prefix of createPrefixes) {
    createMatch = cleanMsg.match(prefix);
    if (createMatch) break;
  }

  if (createMatch) {
    const priority = parsePriority(cleanMsg);
    const durationMinutes = parseDurationMinutes(cleanMsg);
    const dateResult = extractDateAndCleanText(cleanMsg);

    if (dateResult.unresolvedTemporalPhrase) {
      return {
        success: false,
        error: `Date-aware AI parsing is temporarily unavailable. Unable to resolve date phrase "${dateResult.unresolvedTemporalPhrase}" in basic command mode. Please specify "today", "tomorrow", "26th September", or a weekday.`,
      };
    }

    const title = cleanTaskTitle(dateResult.cleanedText);

    const payload: {
      title: string;
      durationMinutes: number;
      priority: TaskPriority;
      date?: string;
    } = {
      title,
      durationMinutes: durationMinutes ?? 0,
      priority,
    };

    if (dateResult.date) {
      payload.date = dateResult.date;
    }

    return {
      success: true,
      actions: [
        {
          type: 'create_task',
          payload,
        },
      ],
    };
  }

  // Unrecognized command fallback
  return {
    success: false,
    error: `I didn't recognize that command. Try asking "what's my schedule?", "add gym for 1 hour", "completed study", "skip gym", or "replan my day".`,
  };
}
