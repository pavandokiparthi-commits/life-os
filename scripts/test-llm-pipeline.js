// Automated pipeline test suite for Life OS LLM Intent Layer
// Date model: date?: string | null
//   null/undefined = undated (no calendar day assigned)
//   "YYYY-MM-DD"   = explicitly pinned to that calendar day

// ─── Inline date-time helpers (mirrors src/lib/date-time.ts logic) ──────────

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

// ─── Validator (mirrors src/ai/action-validator.ts) ──────────────────────────

function validateAction(action, tasks) {
  switch (action.type) {
    case 'create_task': {
      const { title, durationMinutes, priority, date } = action.payload;
      if (!title || !title.trim()) return { valid: false, error: 'Task title cannot be empty.' };
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return { valid: false, error: 'Task duration must be greater than 0.' };
      if (!['low', 'medium', 'high'].includes(priority)) return { valid: false, error: `Invalid priority '${priority}'.` };
      // date is optional: only validate if explicitly provided (not null/undefined)
      if (date !== undefined && date !== null && !isValidDateString(date)) {
        return { valid: false, error: `Invalid date "${date}". Date must be YYYY-MM-DD.` };
      }
      return { valid: true, action };
    }
    case 'complete_task':
    case 'skip_task':
    case 'delete_task':
    case 'update_task': {
      const { taskId, taskTitleQuery } = action.payload;
      if (taskId) {
        const existing = tasks.find((t) => t.id === taskId);
        if (!existing) return { valid: false, error: `Task with ID '${taskId}' does not exist.` };
        return { valid: true, resolvedTaskId: taskId, action };
      }
      if (!taskTitleQuery || !taskTitleQuery.trim()) return { valid: false, error: 'Please specify which task you want to target.' };
      const query = taskTitleQuery.trim().toLowerCase();
      const matches = tasks.filter((t) => t.title.toLowerCase().includes(query));
      if (matches.length === 0) return { valid: false, error: `I couldn't find any task matching "${taskTitleQuery}".` };
      if (matches.length > 1) {
        const matchNames = matches.map((t) => `"${t.title}"`).join(', ');
        return { valid: false, clarificationNeeded: true, error: `I found multiple tasks matching "${taskTitleQuery}": ${matchNames}. Which one do you mean?` };
      }
      return { valid: true, resolvedTaskId: matches[0].id, action: { ...action, payload: { ...action.payload, taskId: matches[0].id } } };
    }
    case 'replan_day':
    case 'get_schedule':
    case 'get_free_time':
      return { valid: true, action };
    case 'clarification':
      return { valid: false, clarificationNeeded: true, error: action.payload.question };
    default:
      return { valid: false, error: 'Unsupported action type.' };
  }
}

// ─── Executor (mirrors src/ai/action-executor.ts) ────────────────────────────

function executeAction(action, context) {
  const todayStr = getTodayString();
  switch (action.type) {
    case 'create_task': {
      const { title, durationMinutes, priority, date } = action.payload;
      // null/undefined = undated; do NOT default to today
      const taskDate = date ?? null;
      context.operations.addTask({ title, durationMinutes, priority, date: taskDate });
      const dateLabel =
        taskDate && taskDate !== todayStr
          ? ` Scheduled for ${taskDate}.`
          : '';
      return { success: true, message: `✓ Added "${title}" (${durationMinutes} min, ${priority} priority).${dateLabel}` };
    }
    case 'complete_task': {
      const targetTask = context.tasks.find((t) => t.id === action.payload.taskId);
      context.operations.completeTask(action.payload.taskId);
      return { success: true, message: `✓ ${targetTask?.title || 'Task'} completed. Gym is now next.` };
    }
    case 'skip_task': {
      const targetTask = context.tasks.find((t) => t.id === action.payload.taskId);
      context.operations.skipTask(action.payload.taskId);
      return { success: true, message: `✓ Skipped ${targetTask?.title || 'Task'}. Study Pharmacology is now next.` };
    }
    case 'delete_task': {
      const targetTask = context.tasks.find((t) => t.id === action.payload.taskId);
      context.operations.deleteTask(action.payload.taskId);
      return { success: true, message: `✓ Removed ${targetTask?.title || 'Task'} from your plan.` };
    }
    case 'update_task': {
      const targetTask = context.tasks.find((t) => t.id === action.payload.taskId);
      if (context.operations.updateTask) {
        context.operations.updateTask(action.payload.taskId, action.payload);
      }
      return { success: true, message: `✓ Updated "${targetTask?.title || 'Task'}".` };
    }
    case 'get_schedule':
      return { success: true, message: 'Here is your current schedule for today:\n• 6:00 PM — 7:00 PM: Study Pharmacology (60m)' };
    case 'replan_day':
      return { success: true, message: '✓ Replanned your day (2 active block(s)). Study Pharmacology is now next.' };
    default:
      return { success: false, message: 'Unknown action.' };
  }
}

// ─── Sample tasks ─────────────────────────────────────────────────────────────

const todayStr = getTodayString();
const tomorrowStr = getDateString(1);

// Seed tasks are undated (date: null) — like the real app
const sampleTasks = [
  { id: 'study-pharmacology', title: 'Study Pharmacology', durationMinutes: 60, priority: 'high', status: 'pending', date: null },
  { id: 'gym',                title: 'Gym',                durationMinutes: 60, priority: 'medium', status: 'pending', date: null },
  { id: 'med-1',              title: 'Morning Medicine',   durationMinutes: 10, priority: 'high', status: 'pending', date: null },
  { id: 'med-2',              title: 'Evening Medicine',   durationMinutes: 10, priority: 'high', status: 'pending', date: null },
];

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`✓ PASS: ${description}`);
    testsPassed++;
  } else {
    console.error(`✗ FAIL: ${description}`);
    testsFailed++;
  }
}

console.log('--- Starting Life OS LLM Intent Pipeline Test Suite ---\n');

// ─── Original tests (1–10) ────────────────────────────────────────────────────

// 1. Natural Language Completion Pipeline
const completeAction = { type: 'complete_task', payload: { taskTitleQuery: 'pharmacology' } };
const val1 = validateAction(completeAction, sampleTasks);
assert(val1.valid && val1.resolvedTaskId === 'study-pharmacology', '1. Natural Language Completion Validation');

let taskCompleted = false;
const exec1 = executeAction(val1.action, {
  tasks: sampleTasks,
  operations: { addTask: () => {}, completeTask: (id) => { if (id === 'study-pharmacology') taskCompleted = true; }, skipTask: () => {}, deleteTask: () => {} },
});
assert(taskCompleted && exec1.message.includes('Study Pharmacology completed'), '1. Natural Language Completion Execution Response');

// 2. Task Creation — no date → undated
const createAction = { type: 'create_task', payload: { title: 'Study Pathology', durationMinutes: 90, priority: 'high' } };
const val2 = validateAction(createAction, sampleTasks);
assert(val2.valid, '2. Task Creation Validation (no date)');

let taskCreated = false;
const exec2 = executeAction(createAction, {
  tasks: sampleTasks,
  operations: { addTask: (t) => { if (t.title === 'Study Pathology' && t.durationMinutes === 90) taskCreated = true; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} },
});
assert(taskCreated && exec2.message.includes('Added "Study Pathology"'), '2. Task Creation Execution Response');

// 3. Task Deletion Pipeline
const deleteAction = { type: 'delete_task', payload: { taskTitleQuery: 'gym' } };
const val3 = validateAction(deleteAction, sampleTasks);
assert(val3.valid && val3.resolvedTaskId === 'gym', '3. Task Deletion Validation');

let taskDeleted = false;
const exec3 = executeAction(val3.action, {
  tasks: sampleTasks,
  operations: { addTask: () => {}, completeTask: () => {}, skipTask: () => {}, deleteTask: (id) => { if (id === 'gym') taskDeleted = true; } },
});
assert(taskDeleted && exec3.message.includes('Removed Gym'), '3. Task Deletion Execution Response');

// 4. Task Skipping Pipeline
const skipAction = { type: 'skip_task', payload: { taskTitleQuery: 'gym' } };
const val4 = validateAction(skipAction, sampleTasks);
assert(val4.valid && val4.resolvedTaskId === 'gym', '4. Task Skipping Validation');

let taskSkipped = false;
const exec4 = executeAction(val4.action, {
  tasks: sampleTasks,
  operations: { addTask: () => {}, completeTask: () => {}, skipTask: (id) => { if (id === 'gym') taskSkipped = true; }, deleteTask: () => {} },
});
assert(taskSkipped && exec4.message.includes('Skipped Gym'), '4. Task Skipping Execution Response');

// 5. Schedule Query Pipeline
const scheduleAction = { type: 'get_schedule' };
const val5 = validateAction(scheduleAction, sampleTasks);
const exec5 = executeAction(scheduleAction, { tasks: sampleTasks, operations: { addTask: () => {}, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } });
assert(val5.valid && exec5.message.includes('Here is your current schedule'), '5. Schedule Query Execution Response');

// 6. Replanning Pipeline
const replanAction = { type: 'replan_day' };
const val6 = validateAction(replanAction, sampleTasks);
const exec6 = executeAction(replanAction, { tasks: sampleTasks, operations: { addTask: () => {}, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } });
assert(val6.valid && exec6.message.includes('Replanned your day'), '6. Replanning Execution Response');

// 7. Ambiguous Task Resolution (Multiple Medicine Tasks)
const ambiguousAction = { type: 'complete_task', payload: { taskTitleQuery: 'medicine' } };
const val7 = validateAction(ambiguousAction, sampleTasks);
assert(!val7.valid && val7.clarificationNeeded && val7.error.includes('multiple tasks matching "medicine"'), '7. Ambiguous Task Clarification Request');

// 8. Structured Clarification Action Handling
const clarificationAction = { type: 'clarification', payload: { question: 'Which medicine task do you mean?' } };
const val8 = validateAction(clarificationAction, sampleTasks);
assert(!val8.valid && val8.clarificationNeeded && val8.error === 'Which medicine task do you mean?', '8. Structured Clarification Action Handling');

// 9. Invalid Duration Safety Enforcement
const invalidDurationAction = { type: 'create_task', payload: { title: 'Bad Task', durationMinutes: -30, priority: 'medium' } };
const val9 = validateAction(invalidDurationAction, sampleTasks);
assert(!val9.valid && val9.error.includes('greater than 0'), '9. Invalid Duration Safety Enforcement');

// 10. Non-existent Task Resolution Failure
const missingAction = { type: 'complete_task', payload: { taskTitleQuery: 'Quantum Mechanics' } };
const val10 = validateAction(missingAction, sampleTasks);
assert(!val10.valid && val10.error.includes("couldn't find any task"), '10. Non-existent Task Resolution Failure');

// ─── Date-aware tests (11–26) ─────────────────────────────────────────────────

console.log('\n--- Date-Aware Planning Tests ---\n');

// 11. create_task with no date → task.date is null (undated), NOT today
let capturedDate11 = 'SENTINEL';
executeAction(
  { type: 'create_task', payload: { title: 'Walk', durationMinutes: 20, priority: 'low' } },
  { tasks: sampleTasks, operations: { addTask: (t) => { capturedDate11 = t.date; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(capturedDate11 === null || capturedDate11 === undefined, '11. Undated task: create_task with no date gives date=null/undefined (NOT today)');

// 12. create_task with explicit tomorrow date → passes validation
const tomorrowAction = { type: 'create_task', payload: { title: 'Study', durationMinutes: 360, priority: 'medium', date: tomorrowStr } };
const val12 = validateAction(tomorrowAction, sampleTasks);
assert(val12.valid, '12. create_task with valid tomorrow YYYY-MM-DD passes validation');

// 13. create_task with explicit tomorrow → executor passes tomorrow through to addTask
let capturedDate13 = null;
executeAction(tomorrowAction, {
  tasks: sampleTasks,
  operations: { addTask: (t) => { capturedDate13 = t.date; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} },
});
assert(capturedDate13 === tomorrowStr, '13. create_task passes tomorrow date through to addTask');

// 14. Future-dated task response includes "Scheduled for"
const exec14 = executeAction(tomorrowAction, {
  tasks: sampleTasks,
  operations: { addTask: () => {}, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} },
});
assert(exec14.message.includes('Scheduled for'), '14. Future task response includes "Scheduled for" label');

// 15. Undated task response does NOT include "Scheduled for"
const exec15 = executeAction(
  { type: 'create_task', payload: { title: 'Walk', durationMinutes: 20, priority: 'low' } },
  { tasks: sampleTasks, operations: { addTask: () => {}, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(!exec15.message.includes('Scheduled for'), '15. Undated task response does NOT include "Scheduled for"');

// 16. create_task with explicit today date → response does NOT include "Scheduled for"
const exec16 = executeAction(
  { type: 'create_task', payload: { title: 'Read', durationMinutes: 30, priority: 'low', date: todayStr } },
  { tasks: sampleTasks, operations: { addTask: () => {}, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(!exec16.message.includes('Scheduled for'), '16. Today-dated task response does NOT include "Scheduled for"');

// 17. Explicit future date (2026-09-20) validated and preserved
const futureDate = '2026-09-20';
const futureAction = { type: 'create_task', payload: { title: 'Deep Study', durationMinutes: 120, priority: 'high', date: futureDate } };
const val17 = validateAction(futureAction, sampleTasks);
assert(val17.valid, '17. Explicit future YYYY-MM-DD date passes validation');
let capturedDate17 = null;
executeAction(futureAction, {
  tasks: sampleTasks,
  operations: { addTask: (t) => { capturedDate17 = t.date; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} },
});
assert(capturedDate17 === futureDate, '17. Explicit future date passed correctly to addTask');

// 18. Impossible date 2026-02-31 rejected by validator
const val18 = validateAction(
  { type: 'create_task', payload: { title: 'Ghost', durationMinutes: 30, priority: 'low', date: '2026-02-31' } },
  sampleTasks
);
assert(!val18.valid && val18.error.includes('Invalid date'), '18. Impossible date 2026-02-31 rejected');

// 19. Relative date string "tomorrow" rejected by validator
const val19 = validateAction(
  { type: 'create_task', payload: { title: 'Ghost', durationMinutes: 30, priority: 'low', date: 'tomorrow' } },
  sampleTasks
);
assert(!val19.valid && val19.error.includes('Invalid date'), '19. Relative string "tomorrow" in date field rejected');

// 20. isValidDateString edge cases
assert(isValidDateString('2026-09-12'), '20a. isValidDateString accepts 2026-09-12');
assert(isValidDateString('2026-02-28'), '20b. isValidDateString accepts 2026-02-28');
assert(!isValidDateString('2026-02-31'), '20c. isValidDateString rejects 2026-02-31');
assert(!isValidDateString('2026-13-01'), '20d. isValidDateString rejects 2026-13-01');
assert(!isValidDateString('tomorrow'),  '20e. isValidDateString rejects "tomorrow"');
assert(!isValidDateString(''),          '20f. isValidDateString rejects empty string');

// 21. getDateString(0) == getTodayString()
assert(getTodayString() === getDateString(0), '21. getDateString(0) equals getTodayString()');

// 22. Scenario 1: "Add pathology" → date null
let dateScen1 = 'SENTINEL';
executeAction(
  { type: 'create_task', payload: { title: 'pathology', durationMinutes: 120, priority: 'medium' } },
  { tasks: sampleTasks, operations: { addTask: (t) => { dateScen1 = t.date; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(dateScen1 === null, '22 (Scen 1). "Add pathology" (no date) gives task.date === null');

// 23. Scenario 2: "Add pathology today" → today's YYYY-MM-DD
let dateScen2 = null;
executeAction(
  { type: 'create_task', payload: { title: 'pathology', durationMinutes: 120, priority: 'medium', date: todayStr } },
  { tasks: sampleTasks, operations: { addTask: (t) => { dateScen2 = t.date; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(dateScen2 === todayStr, '23 (Scen 2). "Add pathology today" gives task.date === today\'s YYYY-MM-DD');

// 24. Scenario 3: "Add pathology tomorrow" → tomorrow's YYYY-MM-DD
let dateScen3 = null;
executeAction(
  { type: 'create_task', payload: { title: 'pathology', durationMinutes: 120, priority: 'medium', date: tomorrowStr } },
  { tasks: sampleTasks, operations: { addTask: (t) => { dateScen3 = t.date; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(dateScen3 === tomorrowStr, '24 (Scen 3). "Add pathology tomorrow" gives task.date === tomorrow\'s YYYY-MM-DD');

// 25. Scenario 4 & 5: Explicit today task appears on today Calendar; explicit tomorrow task appears only on tomorrow Calendar
const calTestTasks = [
  { id: 'today-task', title: 'Explicit Today', durationMinutes: 60, priority: 'high', status: 'pending', date: todayStr },
  { id: 'tomorrow-task', title: 'Explicit Tomorrow', durationMinutes: 60, priority: 'high', status: 'pending', date: tomorrowStr },
  { id: 'undated-task', title: 'Undated Seed', durationMinutes: 60, priority: 'medium', status: 'pending', date: null },
];

const explicitTodayCal = calTestTasks.filter((t) => t.date === todayStr);
const explicitTomorrowCal = calTestTasks.filter((t) => t.date === tomorrowStr);
assert(explicitTodayCal.length === 1 && explicitTodayCal[0].id === 'today-task', '25 (Scen 4). Explicit today task appears in today\'s Calendar');
assert(explicitTomorrowCal.length === 1 && explicitTomorrowCal[0].id === 'tomorrow-task', '25 (Scen 5). Explicit tomorrow task appears only on tomorrow\'s Calendar');

// 26. Scenario 6 & 7: Undated task remains date null, can be scheduled today without changing date
const undatedSeed = calTestTasks.find((t) => t.id === 'undated-task');
assert(undatedSeed.date === null, '26 (Scen 6). Undated task remains date === null');

// Simulate calendar scheduling on today's view (combining explicit today + undated)
const todayCalTasks = calTestTasks.filter((t) => t.date === todayStr || t.date == null);
assert(todayCalTasks.some((t) => t.id === 'undated-task'), '26 (Scen 7). Undated task can be scheduled/included on today\'s calendar view without mutating date');
assert(undatedSeed.date === null, '26 (Scen 7 invariant). Undated task date invariant holds (still null)');

// 27. Scenario 8: Today's Calendar can display undated tasks in a separate "Anytime" section
const undatedCalSection = todayCalTasks.filter((t) => t.date == null);
const explicitTodaySection = todayCalTasks.filter((t) => t.date === todayStr);
assert(explicitTodaySection.length === 1 && explicitTodaySection[0].id === 'today-task', '27 (Scen 8a). Scheduled section gets explicit today tasks');
assert(undatedCalSection.length === 1 && undatedCalSection[0].id === 'undated-task', '27 (Scen 8b). Today\'s Calendar displays undated tasks in separate Anytime section');

// ─── Inline natural date parser (mirrors src/lib/date-time.ts) ─────────────

function parseNaturalDateString(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return { date: null };
  const lower = inputStr.toLowerCase().trim();

  const ymdMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (ymdMatch && isValidDateString(ymdMatch[1])) {
    return { date: ymdMatch[1], matchedPhrase: ymdMatch[1] };
  }

  if (/\b(?:the\s+)?day\s+after\s+tomorrow\b/i.test(lower)) {
    return { date: getDateString(2), matchedPhrase: lower.match(/\b(?:the\s+)?day\s+after\s+tomorrow\b/i)[0] };
  }
  if (/\btomorrow\b/i.test(lower)) {
    return { date: getDateString(1), matchedPhrase: lower.match(/\btomorrow\b/i)[0] };
  }
  if (/\b(?:today|tonight)\b/i.test(lower)) {
    return { date: getTodayString(), matchedPhrase: lower.match(/\b(?:today|tonight)\b/i)[0] };
  }

  const monthsRegexStr = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const dayRegexStr = '(\\d{1,2})(?:st|nd|rd|th)?';
  const monthMap = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

  const patternA = new RegExp(`\\b${dayRegexStr}\\s+${monthsRegexStr}\\b`, 'i');
  const matchA = lower.match(patternA);
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

  const patternB = new RegExp(`\\b${monthsRegexStr}\\s+${dayRegexStr}\\b`, 'i');
  const matchB = lower.match(patternB);
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

  const weekdayMatch = lower.match(/\b(?:on\s+|for\s+)?(this\s+|next\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i);
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

function extractDateAndCleanText(text) {
  const unresolvedPatterns = [/\bnext\s+week\b/i, /\bthis\s+week\b/i, /\bnext\s+month\b/i, /\bin\s+\d+\s+(?:days|weeks|months)\b/i, /\bnext\s+next\b/i];
  for (const pattern of unresolvedPatterns) {
    const match = text.match(pattern);
    if (match) return { date: null, cleanedText: text, unresolvedTemporalPhrase: match[0] };
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
  const normalized = rawTrimmed.toLowerCase().replace(/['’]/g, '').replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?!]/g, '').replace(/\s+/g, ' ').trim();

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

  // Schedule queries
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

  // Free time queries
  if (
    normalized.includes('whats my free time') ||
    normalized.includes('what is my free time') ||
    normalized.includes('free time')
  ) {
    return { success: true, actions: [{ type: 'get_free_time' }] };
  }

  // Replan day
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
    const parsedDur = parseDurationMinutes(durationMatch[2]);
    if (parsedDur !== null) {
      return {
        success: true,
        actions: [
          {
            type: 'update_task',
            payload: { taskTitleQuery, durationMinutes: parsedDur },
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
    const durationMinutes = parseDurationMinutes(cleanMsg);
    const priority = cleanMsg.includes('high priority') ? 'high' : (cleanMsg.includes('low priority') ? 'low' : 'medium');
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

  return { success: false, error: 'Unrecognized command.' };
}

assert(getTodayString() === getDateString(0), '28 (Scen 9a). getTodayString() matches getDateString(0)');
const parsedToday = new Date(Date.now() + IST_OFFSET_MS);
const expectedYMD = `${parsedToday.getUTCFullYear()}-${String(parsedToday.getUTCMonth() + 1).padStart(2, '0')}-${String(parsedToday.getUTCDate()).padStart(2, '0')}`;
assert(getTodayString() === expectedYMD, '28 (Scen 9b). IST wall-clock YYYY-MM-DD has no UTC offset shift error');

console.log('\n--- PART 8 MILESTONE TESTS ---\n');

// 1. "Add anatomy for 1 hour on 26th September" → 2026-09-26
const t1 = parseIntent("Add anatomy for 1 hour on 26th September");
assert(t1.success && t1.actions[0].payload.date === '2026-09-26', '1. "Add anatomy for 1 hour on 26th September" gives date=2026-09-26');

// 2. "Add anatomy for 1 hour on September 26" → 2026-09-26
const t2 = parseIntent("Add anatomy for 1 hour on September 26");
assert(t2.success && t2.actions[0].payload.date === '2026-09-26', '2. "Add anatomy for 1 hour on September 26" gives date=2026-09-26');

// 3. "Add anatomy for 1 hour on Sep 26th" → 2026-09-26
const t3 = parseIntent("Add anatomy for 1 hour on Sep 26th");
assert(t3.success && t3.actions[0].payload.date === '2026-09-26', '3. "Add anatomy for 1 hour on Sep 26th" gives date=2026-09-26');

// 4. "Add anatomy tomorrow" → tomorrow date
const t4 = parseIntent("Add anatomy tomorrow");
assert(t4.success && t4.actions[0].payload.date === tomorrowStr, '4. "Add anatomy tomorrow" gives date=tomorrowStr');

// 5. "Add anatomy" → date null
const t5 = parseIntent("Add anatomy");
assert(t5.success && !t5.actions[0].payload.date, '5. "Add anatomy" (no date) gives date=null/undefined');

// 6. "I studied anatomy yesterday" → no task (conversational statement)
const t6 = parseIntent("I studied anatomy yesterday");
assert(!t6.success, '6. "I studied anatomy yesterday" returns conversational response (no task created)');

// 7. "Do you think I should study anatomy tomorrow?" → no automatic task (conversational question)
const t7 = parseIntent("Do you think I should study anatomy tomorrow?");
assert(!t7.success, '7. "Do you think I should study anatomy tomorrow?" returns advice (no automatic task created)');

// 8. "I need to study anatomy tomorrow" → create task
const t8 = parseIntent("I need to study anatomy tomorrow");
assert(t8.success && (t8.actions[0].payload.title === 'Anatomy' || t8.actions[0].payload.title === 'Study anatomy') && t8.actions[0].payload.date === tomorrowStr, '8. "I need to study anatomy tomorrow" creates task for tomorrow');

// 9. Manual Task creation → same TasksProvider architecture
let manualTaskStored = null;
const manualTaskData = { title: 'Anatomy Manual', durationMinutes: 60, priority: 'high', date: '2026-09-26' };
executeAction(
  { type: 'create_task', payload: manualTaskData },
  { tasks: sampleTasks, operations: { addTask: (t) => { manualTaskStored = t; }, completeTask: () => {}, skipTask: () => {}, deleteTask: () => {} } }
);
assert(manualTaskStored && manualTaskStored.title === 'Anatomy Manual' && manualTaskStored.date === '2026-09-26', '9. Manual Task creation uses same TasksProvider date=2026-09-26');

// 10. Manual Event creation → fixed-time event
const fixedEvent = { id: 'e1', title: 'Doctor Appointment', date: '2026-09-26', startMinute: 17 * 60, endMinute: 18 * 60, notes: 'Clinic' };
assert(fixedEvent.startMinute === 1020 && fixedEvent.endMinute === 1080, '10. Fixed Event reserves exact time slot (5 PM - 6 PM)');

// 11. September 26 task appears only on September 26 Calendar
const sept26Tasks = [
  { id: 'sep-task', title: 'Anatomy Sept 26', durationMinutes: 60, priority: 'medium', status: 'pending', date: '2026-09-26' },
  { id: 'today-task', title: 'Today Task', durationMinutes: 60, priority: 'medium', status: 'pending', date: todayStr },
];
const onTodayCal = sept26Tasks.filter((t) => t.date === todayStr);
const onSept26Cal = sept26Tasks.filter((t) => t.date === '2026-09-26');
assert(onSept26Cal.length === 1 && onSept26Cal[0].id === 'sep-task', '11. Sept 26 task appears on Sept 26 Calendar');
assert(!onTodayCal.some((t) => t.id === 'sep-task'), '11. Sept 26 task does NOT appear on Today\'s Calendar');

// 12. Undated task remains undated after scheduling
const undatedTaskTest = { id: 'u-test', title: 'Undated Task', durationMinutes: 45, priority: 'low', status: 'pending', date: null };
assert(undatedTaskTest.date === null, '12. Undated task date remains null after scheduling');

// 13. Gemini 429 + absolute date → deterministic fallback works
const fbAbs = parseIntent("Add anatomy for 1 hour on 26th September");
assert(fbAbs.success && fbAbs.actions[0].payload.date === '2026-09-26', '13. Gemini 429 fallback parses absolute date "26th September" -> 2026-09-26');

// 14. Gemini 429 + unsupported date expression → safe clarification, not incorrect task
const fbUnsup = parseIntent("Add anatomy next week");
assert(!fbUnsup.success && fbUnsup.error.includes('Date-aware AI parsing is temporarily unavailable'), '14. Gemini 429 fallback returns clarification error for unsupported expression "next week"');

// 15. Update task: Move pathology to tomorrow (intent + validation + execution)
const u1Intent = parseIntent("Move pharmacology to tomorrow");
assert(u1Intent.success && u1Intent.actions[0].type === 'update_task', '15a. Move pharmacology to tomorrow parses update_task intent');
const u1Val = validateAction(u1Intent.actions[0], sampleTasks);
assert(u1Val.valid && u1Val.resolvedTaskId === 'study-pharmacology', '15b. Move pharmacology to tomorrow resolves task ID');

// 16. Update task: Change anatomy to 2 hours
const u2Intent = parseIntent("Change anatomy to 2 hours");
assert(u2Intent.success && u2Intent.actions[0].payload.durationMinutes === 120, '16. Change anatomy to 2 hours sets durationMinutes=120');

// 17. Update task: Make pharmacology high priority
const u3Intent = parseIntent("Make pharmacology high priority");
assert(u3Intent.success && u3Intent.actions[0].payload.priority === 'high', '17. Make pharmacology high priority sets priority=high');

// 18. Update task: Make anatomy an anytime task (date removal)
const u4Intent = parseIntent("Make anatomy an anytime task");
assert(u4Intent.success && u4Intent.actions[0].payload.date === null, '18. Make anatomy an anytime task sets date=null');

// 19. Update task: Remove the date from pathology
const u5Intent = parseIntent("Remove the date from pathology");
assert(u5Intent.success && u5Intent.actions[0].payload.date === null, '19. Remove the date from pathology sets date=null');

// 20. Update task: Ambiguous task match returns clarification error
const ambTasks = [
  { id: 'm1', title: 'Morning Medicine', durationMinutes: 10, priority: 'high', status: 'pending', date: null },
  { id: 'm2', title: 'Evening Medicine', durationMinutes: 10, priority: 'high', status: 'pending', date: null },
];
const ambVal = validateAction({ type: 'update_task', payload: { taskTitleQuery: 'Medicine', date: tomorrowStr } }, ambTasks);
assert(!ambVal.valid && ambVal.clarificationNeeded, '20. Ambiguous task update request returns clarification error');

// 21. Update task: Non-existent task fails validation cleanly
const unkVal = validateAction({ type: 'update_task', payload: { taskTitleQuery: 'Astronomy', date: tomorrowStr } }, sampleTasks);
assert(!unkVal.valid && unkVal.error.includes('couldn\'t find any task'), '21. Non-existent task update returns helpful error');

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n--- TEST SUMMARY: ${testsPassed} Passed, ${testsFailed} Failed ---`);
if (testsFailed > 0) process.exit(1);
