// Pure JS test runner for parser logic verification (Life OS AI/Core)

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function nowInIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function toYMD(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTodayString() {
  const d = nowInIST();
  return toYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function getDateString(offsetDays) {
  const utcMs = Date.now() + IST_OFFSET_MS;
  const shifted = new Date(utcMs + offsetDays * 86400_000);
  return toYMD(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function isValidDateString(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr), month = Number(monthStr), day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day
  );
}

function parseNaturalDateString(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return { date: null };
  const lower = inputStr.toLowerCase().trim();

  // 1. Explicit YYYY-MM-DD
  const ymdMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (ymdMatch && isValidDateString(ymdMatch[1])) {
    return { date: ymdMatch[1], matchedPhrase: ymdMatch[1] };
  }

  // 2. Relative day: "day after tomorrow"
  if (/\b(?:the\s+)?day\s+after\s+tomorrow\b/i.test(lower)) {
    const matched = lower.match(/\b(?:the\s+)?day\s+after\s+tomorrow\b/i)[0];
    return { date: getDateString(2), matchedPhrase: matched };
  }

  // 3. Relative day: "tomorrow"
  if (/\btomorrow\b/i.test(lower)) {
    const matched = lower.match(/\btomorrow\b/i)[0];
    return { date: getDateString(1), matchedPhrase: matched };
  }

  // 4. Relative day: "today" / "tonight"
  if (/\b(?:today|tonight)\b/i.test(lower)) {
    const matched = lower.match(/\b(?:today|tonight)\b/i)[0];
    return { date: getTodayString(), matchedPhrase: matched };
  }

  // 5. Month name + Day number
  const monthsRegexStr = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const dayRegexStr = '(\\d{1,2})(?:st|nd|rd|th)?';

  const monthMap = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  const matchA = lower.match(new RegExp(`\\b${dayRegexStr}\\s+${monthsRegexStr}\\b`, 'i'));
  if (matchA) {
    const day = parseInt(matchA[1], 10);
    const month = monthMap[matchA[2].toLowerCase()];
    if (month && day >= 1 && day <= 31) {
      const [currY, currM, currD] = getTodayString().split('-').map(Number);
      let year = currY;
      if (month < currM || (month === currM && day < currD)) year = currY + 1;
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isValidDateString(candidate)) return { date: candidate, matchedPhrase: matchA[0] };
    }
  }

  const matchB = lower.match(new RegExp(`\\b${monthsRegexStr}\\s+${dayRegexStr}\\b`, 'i'));
  if (matchB) {
    const month = monthMap[matchB[1].toLowerCase()];
    const day = parseInt(matchB[2], 10);
    if (month && day >= 1 && day <= 31) {
      const [currY, currM, currD] = getTodayString().split('-').map(Number);
      let year = currY;
      if (month < currM || (month === currM && day < currD)) year = currY + 1;
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isValidDateString(candidate)) return { date: candidate, matchedPhrase: matchB[0] };
    }
  }

  // 6. Numeric slash/dash date
  const numericMatch = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}|\d{2}))?\b/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    let year = numericMatch[3] ? parseInt(numericMatch[3], 10) : undefined;
    if (year !== undefined && year < 100) year += 2000;
    const [currY, currM, currD] = getTodayString().split('-').map(Number);
    if (!year) {
      year = currY;
      if (month < currM || (month === currM && day < currD)) year = currY + 1;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isValidDateString(candidate)) return { date: candidate, matchedPhrase: numericMatch[0] };
    }
  }

  // 7. Weekday terms: "weekday", "weekdays", "next weekday"
  const weekdayTermMatch = lower.match(/\b(?:on\s+|for\s+)?(this\s+|next\s+)?(weekdays?|weekday)\b/i);
  if (weekdayTermMatch) {
    const prefix = weekdayTermMatch[1] ? weekdayTermMatch[1].trim().toLowerCase() : '';
    const [y, m, d] = getTodayString().split('-').map(Number);
    const utcDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const currWeekIndex = utcDow === 0 ? 7 : utcDow;

    let daysAhead = 0;
    if (prefix === 'next') {
      if (currWeekIndex >= 1 && currWeekIndex <= 4) daysAhead = 1;
      else if (currWeekIndex === 5) daysAhead = 3;
      else if (currWeekIndex === 6) daysAhead = 2;
      else if (currWeekIndex === 7) daysAhead = 1;
    } else {
      if (currWeekIndex >= 1 && currWeekIndex <= 5) daysAhead = 0;
      else if (currWeekIndex === 6) daysAhead = 2;
      else if (currWeekIndex === 7) daysAhead = 1;
    }
    return { date: getDateString(daysAhead), matchedPhrase: weekdayTermMatch[0] };
  }

  // 8. Specific Weekdays
  const weekdayMatch = lower.match(
    /\b(?:on\s+|for\s+)?(this\s+|next\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i
  );
  if (weekdayMatch) {
    const weekDowMap = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7 };
    const prefix = weekdayMatch[1] ? weekdayMatch[1].trim().toLowerCase() : '';
    const dayName = weekdayMatch[2].toLowerCase();
    const targetWeekIndex = weekDowMap[dayName];
    if (targetWeekIndex !== undefined) {
      const [y, m, d] = getTodayString().split('-').map(Number);
      const utcDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const currWeekIndex = utcDow === 0 ? 7 : utcDow;

      let daysAhead = 0;
      if (prefix === 'next') {
        daysAhead = (targetWeekIndex - currWeekIndex) + 7;
      } else if (prefix === 'this') {
        daysAhead = targetWeekIndex - currWeekIndex;
      } else {
        if (targetWeekIndex >= currWeekIndex) {
          daysAhead = targetWeekIndex - currWeekIndex;
        } else {
          daysAhead = (targetWeekIndex - currWeekIndex) + 7;
        }
      }
      return { date: getDateString(daysAhead), matchedPhrase: weekdayMatch[0] };
    }
  }

  return { date: null };
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDateAndCleanText(text) {
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

function parseDurationMinutes(text) {
  const lower = text.toLowerCase();

  if (/\bhalf\s+(?:an?\s+)?hour\b/i.test(lower)) return 30;
  if (
    /\b(?:one|1)\s+and\s+(?:a\s+)?half\s+hours?\b/i.test(lower) ||
    /\b1\.5\s*(?:hours|hour|hrs|hr|h\b)/i.test(lower)
  ) {
    return 90;
  }

  const wordToNum = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };

  const hoursMatch = lower.match(
    /\b(?:for|about|around|approx|approximately)?\s*(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hours|hour|hrs|hr|h\b)/i
  );
  if (hoursMatch) {
    const valStr = hoursMatch[1].toLowerCase();
    const num = wordToNum[valStr] !== undefined ? wordToNum[valStr] : parseFloat(valStr);
    if (!isNaN(num) && num > 0) return Math.round(num * 60);
  }

  const wordToMins = {
    ten: 10, fifteen: 15, twenty: 20, thirty: 30, fortyfive: 45,
    sixty: 60, ninety: 90,
  };

  const minsMatch = lower.match(
    /\b(?:for|about|around|approx|approximately)?\s*(\d+|ten|fifteen|twenty|thirty|fortyfive|sixty|ninety)\s*(?:minutes|minute|mins|min|m\b)/i
  );
  if (minsMatch) {
    const valStr = minsMatch[1].toLowerCase();
    const num = wordToMins[valStr] !== undefined ? wordToMins[valStr] : parseInt(valStr, 10);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

function parsePriority(text) {
  const lower = text.toLowerCase();
  if (lower.includes('high priority') || lower.includes('priority high')) return 'high';
  if (lower.includes('low priority') || lower.includes('priority low')) return 'low';
  return 'medium';
}

function cleanTaskTitle(text) {
  let title = text;

  const prefixRegex =
    /^(?:add|create|task|i\s+need\s+to\s+study|i\s+need\s+to|need\s+to|remind\s+me\s+to|i\s+have\s+to\s+study|i\s+have\s+to|have\s+to|must|i\s+want\s+to\s+study|i\s+want\s+to|want\s+to|i\s+should\s+study|i\s+should|study|work\s+on|do|practice|read|write|prepare|review|fit|schedule)\s+/i;
  title = title.replace(prefixRegex, '');

  title = title.replace(
    /^(?:i\s+need\s+to|need\s+to|i\s+want\s+to|want\s+to|i\s+have\s+to|have\s+to|study|work\s+on|fit)\s+/i,
    ''
  );

  title = title.replace(/\b(?:high|medium|low)\s+priority\b/gi, '');
  title = title.replace(/\bpriority\s+(?:high|medium|low)\b/gi, '');

  title = title.replace(
    /\b(?:for|about|around|approx|approximately)?\s*(?:\d+(?:\.\d+)?|half|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(?:and\s+a\s+half\s+)?(?:hours|hour|hrs|hr|h|minutes|minute|mins|min|m)\b/gi,
    ''
  );
  title = title.replace(/\b(?:for|about|around|approx|approximately)?\s*an?\s+hour\b/gi, '');

  title = title.replace(/,?\s*(?:can|could)\s+you\s+fit\s+(?:it|this)?\s*(?:in|into\s+my\s+day)?\??$/i, '');
  title = title.replace(/\b(?:fit|fit\s+it)\s+(?:in|into)\s+my\s+day\b/gi, '');
  title = title.replace(/\binto\s+my\s+day\b/gi, '');
  title = title.replace(/\bmy\s+day\b/gi, '');
  title = title.replace(/\b(?:for|on|at|in|to)\b\s*$/gi, '');

  title = title.replace(/\s+/g, ' ').trim();

  return title ? title.charAt(0).toUpperCase() + title.slice(1) : title;
}

function parseIntent(userMessage) {
  const rawTrimmed = userMessage.trim();
  if (!rawTrimmed) return { success: false, error: 'Please enter a message.' };
  const normalized = normalizeText(userMessage);

  const conversationQuestions = [
    /^(?:hey|hello|hi|greetings|good\s+morning|good\s+evening)\b/i,
    /^(?:do\s+you\s+think|should\s+i|how\s+should\s+i|how\s+can\s+i|what\s+should\s+i|can\s+you\s+advise)\b/i,
    /^(?:i\s+studied|i\s+finished|i\s+was\s+studying|i\s+did|i\s+went|i\s+was|i\s+am\s+tired|i\s+feel)\b/i,
    /^yesterday\s+i\s+(?:spent|studied|finished|was|did)\b/i,
  ];

  for (const pattern of conversationQuestions) {
    if (pattern.test(normalized)) {
      return { success: false, error: 'Conversational response (no task created).' };
    }
  }

  if (
    normalized === 'schedule' ||
    normalized.includes('whats my schedule') ||
    normalized.includes('what is my schedule') ||
    normalized.includes('show my schedule') ||
    normalized.includes('get schedule') ||
    normalized.includes('view my schedule')
  ) {
    return { success: true, actions: [{ type: 'get_schedule' }] };
  }

  if (
    normalized.includes('whats my free time') ||
    normalized.includes('what is my free time') ||
    normalized.includes('free time')
  ) {
    return { success: true, actions: [{ type: 'get_free_time' }] };
  }

  if (
    normalized === 'replan' ||
    normalized.includes('replan my day') ||
    normalized.includes('replan day') ||
    normalized.includes('replan the day')
  ) {
    return { success: true, actions: [{ type: 'replan_day' }] };
  }

  // Update task patterns
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

  const priorityMatch =
    normalized.match(/^(?:make|set|change|update)\s+(.+?)\s+(high|medium|low)\s+priority$/i) ||
    normalized.match(/^(?:change|set|update)\s+(.+?)\s+priority\s+to\s+(high|medium|low)$/i);

  if (priorityMatch) {
    const taskTitleQuery = priorityMatch[1].trim();
    const priority = priorityMatch[2].toLowerCase();
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

  const completeRegexes = [
    /^(?:i\s+have\s+|i\s+)?(?:complete|completed|finish|finished)\s+(.+)$/,
    /^mark\s+(.+?)\s+(?:as\s+)?(?:complete|completed|done|finished)$/,
    /^(.+?)\s+is\s+(?:complete|completed|done|finished)$/,
    /^done\s+(?:with\s+)?(.+)$/,
  ];

  for (const regex of completeRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]?.trim()) {
      return { success: true, actions: [{ type: 'complete_task', payload: { taskTitleQuery: match[1].trim() } }] };
    }
  }

  const skipRegexes = [
    /^(?:i\s+)?(?:skip|skipped)\s+(.+)$/,
    /^(?:i\s+)?(?:cant\s+do|cannot\s+do|dont\s+do)\s+(.+)$/,
  ];

  for (const regex of skipRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]?.trim()) {
      return { success: true, actions: [{ type: 'skip_task', payload: { taskTitleQuery: match[1].trim() } }] };
    }
  }

  const deleteRegexes = [/^(?:i\s+)?(?:delete|deleted|remove|removed)\s+(.+)$/];

  for (const regex of deleteRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]?.trim()) {
      return { success: true, actions: [{ type: 'delete_task', payload: { taskTitleQuery: match[1].trim() } }] };
    }
  }

  // Create task patterns
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

  let createMatch = null;
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
        error: `Date-aware AI parsing is temporarily unavailable. Unable to resolve date phrase "${dateResult.unresolvedTemporalPhrase}" in basic command mode.`,
      };
    }

    const title = cleanTaskTitle(dateResult.cleanedText);
    const payload = { title, durationMinutes: durationMinutes ?? 0, priority };
    if (dateResult.date) payload.date = dateResult.date;

    return { success: true, actions: [{ type: 'create_task', payload }] };
  }

  return { success: false, error: 'Unrecognized' };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

const todayStr = getTodayString();
const [currY, currM, currD] = todayStr.split('-').map(Number);
const utcDow = new Date(Date.UTC(currY, currM - 1, currD)).getUTCDay();
const currWeekIndex = utcDow === 0 ? 7 : utcDow;

function getExpectedWeekdayDate(targetWeekIndex, mode) {
  let daysAhead = 0;
  if (mode === 'next') {
    daysAhead = (targetWeekIndex - currWeekIndex) + 7;
  } else if (mode === 'this') {
    daysAhead = targetWeekIndex - currWeekIndex;
  } else {
    if (targetWeekIndex >= currWeekIndex) daysAhead = targetWeekIndex - currWeekIndex;
    else daysAhead = (targetWeekIndex - currWeekIndex) + 7;
  }
  return getDateString(daysAhead);
}

const tests = [
  // 1. Required Prompt Examples (1-11)
  {
    label: 'Example 1: "I need to study anatomy tomorrow for about an hour"',
    input: 'I need to study anatomy tomorrow for about an hour',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'create_task' &&
      (res.actions[0].payload.title === 'Anatomy' || res.actions[0].payload.title === 'Study anatomy') &&
      res.actions[0].payload.durationMinutes === 60 &&
      res.actions[0].payload.date === getDateString(1),
  },
  {
    label: 'Example 2: "I need to study anatomy tomorrow for about an hour, can you fit it into my day?"',
    input: 'I need to study anatomy tomorrow for about an hour, can you fit it into my day?',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'create_task' &&
      (res.actions[0].payload.title === 'Anatomy' || res.actions[0].payload.title === 'Study anatomy') &&
      res.actions[0].payload.durationMinutes === 60 &&
      res.actions[0].payload.date === getDateString(1),
  },
  {
    label: 'Example 3: "Tomorrow I need to study anatomy for an hour"',
    input: 'Tomorrow I need to study anatomy for an hour',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'create_task' &&
      (res.actions[0].payload.title === 'Anatomy' || res.actions[0].payload.title === 'Study anatomy') &&
      res.actions[0].payload.durationMinutes === 60 &&
      res.actions[0].payload.date === getDateString(1),
  },
  {
    label: 'Example 4: "Can you add anatomy tomorrow for around 90 minutes?"',
    input: 'Can you add anatomy tomorrow for around 90 minutes?',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'create_task' &&
      (res.actions[0].payload.title === 'Anatomy' || res.actions[0].payload.title === 'Study anatomy') &&
      res.actions[0].payload.durationMinutes === 90 &&
      res.actions[0].payload.date === getDateString(1),
  },
  {
    label: 'Example 5: "I want to study pathology for two hours on Monday"',
    input: 'I want to study pathology for two hours on Monday',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'create_task' &&
      (res.actions[0].payload.title === 'Pathology' || res.actions[0].payload.title === 'Study pathology') &&
      res.actions[0].payload.durationMinutes === 120 &&
      res.actions[0].payload.date === getExpectedWeekdayDate(1, 'plain'),
  },
  {
    label: 'Example 6: "Move anatomy to tomorrow"',
    input: 'Move anatomy to tomorrow',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'update_task' &&
      res.actions[0].payload.taskTitleQuery === 'anatomy' &&
      res.actions[0].payload.date === getDateString(1),
  },
  {
    label: 'Example 7: "Make anatomy two hours"',
    input: 'Make anatomy two hours',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'update_task' &&
      res.actions[0].payload.taskTitleQuery === 'anatomy' &&
      res.actions[0].payload.durationMinutes === 120,
  },
  {
    label: 'Example 8: "Make anatomy high priority"',
    input: 'Make anatomy high priority',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'update_task' &&
      res.actions[0].payload.taskTitleQuery === 'anatomy' &&
      res.actions[0].payload.priority === 'high',
  },
  {
    label: 'Example 9: "Make anatomy anytime"',
    input: 'Make anatomy anytime',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'update_task' &&
      res.actions[0].payload.taskTitleQuery === 'anatomy' &&
      res.actions[0].payload.date === null,
  },
  {
    label: 'Example 10: "What\'s my schedule tomorrow?"',
    input: "What's my schedule tomorrow?",
    checkIntent: (res) => res.success && res.actions[0].type === 'get_schedule',
  },
  {
    label: 'Example 11: "Do I have free time tomorrow afternoon?"',
    input: 'Do I have free time tomorrow afternoon?',
    checkIntent: (res) => res.success && res.actions[0].type === 'get_free_time',
  },

  // 2. Safety Cases (Must NOT create/update tasks)
  { label: 'Safety: I studied anatomy yesterday.', input: 'I studied anatomy yesterday.', checkIntent: (res) => !res.success },
  { label: 'Safety: I studied anatomy for two hours.', input: 'I studied anatomy for two hours.', checkIntent: (res) => !res.success },
  { label: 'Safety: I finished pathology yesterday.', input: 'I finished pathology yesterday.', checkIntent: (res) => !res.success },
  { label: 'Safety: I was studying anatomy tomorrow.', input: 'I was studying anatomy tomorrow.', checkIntent: (res) => !res.success },
  { label: 'Safety: Should I study anatomy tomorrow?', input: 'Should I study anatomy tomorrow?', checkIntent: (res) => !res.success },
  { label: 'Safety: Do you think I should study anatomy tomorrow?', input: 'Do you think I should study anatomy tomorrow?', checkIntent: (res) => !res.success },
  { label: 'Safety: Yesterday I spent an hour studying anatomy.', input: 'Yesterday I spent an hour studying anatomy.', checkIntent: (res) => !res.success },
  { label: 'Safety: I studied anatomy for two hours yesterday', input: 'I studied anatomy for two hours yesterday', checkIntent: (res) => !res.success },

  // 3. Positive Intent & NLP variation cases
  {
    label: 'Positive: "Can you fit anatomy into my day tomorrow?"',
    input: 'Can you fit anatomy into my day tomorrow?',
    checkIntent: (res) =>
      res.success &&
      res.actions[0].type === 'create_task' &&
      (res.actions[0].payload.title === 'Anatomy' || res.actions[0].payload.title === 'Study anatomy') &&
      res.actions[0].payload.date === getDateString(1),
  },

  // 4. Natural Language Date Format Parsing Tests
  { label: 'Date: today', input: 'today', expectedDate: getTodayString() },
  { label: 'Date: tomorrow', input: 'tomorrow', expectedDate: getDateString(1) },
  { label: 'Date: day after tomorrow', input: 'day after tomorrow', expectedDate: getDateString(2) },
  { label: 'Date: 26th September', input: '26th September', checkFn: (d) => d.endsWith('-09-26') },
  { label: 'Date: September 26', input: 'September 26', checkFn: (d) => d.endsWith('-09-26') },
  { label: 'Date: Monday', input: 'Monday', expectedDate: getExpectedWeekdayDate(1, 'plain') },
  { label: 'Date: this Monday', input: 'this Monday', expectedDate: getExpectedWeekdayDate(1, 'this') },
  { label: 'Date: next Monday', input: 'next Monday', expectedDate: getExpectedWeekdayDate(1, 'next') },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  if (t.expectedDate !== undefined || t.checkFn) {
    const res = parseNaturalDateString(t.input);
    const dateVal = res.date;
    const isOk = t.checkFn ? t.checkFn(dateVal) : dateVal === t.expectedDate;
    if (isOk) {
      passed++;
      console.log(`✓ PASS: ${t.label} -> ${dateVal}`);
    } else {
      failed++;
      console.error(`✗ FAIL: ${t.label} (expected ${t.expectedDate}, got ${dateVal})`);
    }
  } else if (t.checkIntent) {
    const res = parseIntent(t.input);
    const isOk = t.checkIntent(res);
    if (isOk) {
      passed++;
      console.log(`✓ PASS: ${t.label}`);
    } else {
      failed++;
      console.error(`✗ FAIL: ${t.label} (got ${JSON.stringify(res)})`);
    }
  }
}

console.log(`\nPARSER TEST RESULTS: ${passed}/${tests.length} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
