export interface RecurrenceConfig {
  enabled: boolean;
  interval: number;
  unit: 'hours' | 'days' | 'weeks' | 'months' | 'years';
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  weekOfMonth?: 'first' | 'second' | 'third' | 'fourth' | 'last';
  customCron?: string;
}

/**
 * Calculate next N execution times based on recurrence config
 */
export function getNextExecutionsFromConfig(
  config: RecurrenceConfig, 
  startFrom: Date,
  count: number
): Date[] {
  const results: Date[] = [];
  
  if (!config.enabled) return results;
  
  // If custom cron is provided, use cron pattern matching
  if (config.customCron) {
    return getNextExecutions(config.customCron, count);
  }
  
  let candidate = new Date(startFrom);
  
  for (let i = 0; i < count; i++) {
    candidate = calculateNextExecutionFromConfig(config, candidate);
    results.push(new Date(candidate));
  }
  
  return results;
}

/**
 * Calculate single next execution from config
 */
function calculateNextExecutionFromConfig(config: RecurrenceConfig, from: Date): Date {
  const next = new Date(from);
  
  switch (config.unit) {
    case 'hours':
      next.setHours(next.getHours() + config.interval);
      next.setMinutes(config.minute);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
      
    case 'days':
      next.setDate(next.getDate() + config.interval);
      next.setHours(config.hour);
      next.setMinutes(config.minute);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
      
    case 'weeks':
      next.setDate(next.getDate() + (config.interval * 7));
      if (config.dayOfWeek !== undefined) {
        // Adjust to specific day of week
        const currentDay = next.getDay();
        const daysToAdd = (config.dayOfWeek - currentDay + 7) % 7;
        next.setDate(next.getDate() + daysToAdd);
      }
      next.setHours(config.hour);
      next.setMinutes(config.minute);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
      
    case 'months':
      next.setMonth(next.getMonth() + config.interval);
      if (config.dayOfMonth !== undefined) {
        next.setDate(Math.min(config.dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      }
      next.setHours(config.hour);
      next.setMinutes(config.minute);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
      
    case 'years':
      next.setFullYear(next.getFullYear() + config.interval);
      if (config.dayOfMonth !== undefined) {
        next.setDate(Math.min(config.dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      }
      next.setHours(config.hour);
      next.setMinutes(config.minute);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
  }
  
  return next;
}

/**
 * Generate human-readable schedule description
 */
export function getHumanReadableSchedule(config: RecurrenceConfig): string {
  if (!config.enabled) return 'Not scheduled';
  
  if (config.customCron) {
    return `Custom schedule: ${config.customCron}`;
  }
  
  const time = `${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')}`;
  const intervalText = config.interval === 1 ? '' : `${config.interval} `;
  
  const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  switch (config.unit) {
    case 'hours':
      return `Every ${intervalText}${config.interval === 1 ? 'hour' : 'hours'} at :${String(config.minute).padStart(2, '0')}`;
    
    case 'days':
      return `Every ${intervalText}${config.interval === 1 ? 'day' : 'days'} at ${time}`;
    
    case 'weeks':
      const dayName = config.dayOfWeek !== undefined ? dayOfWeekNames[config.dayOfWeek] : 'week';
      return `Every ${intervalText}${config.interval === 1 ? '' : 'weeks on '}${dayName} at ${time}`;
    
    case 'months':
      const dayNum = config.dayOfMonth !== undefined ? `${config.dayOfMonth}${getOrdinalSuffix(config.dayOfMonth)}` : '1st';
      return `Every ${intervalText}${config.interval === 1 ? 'month' : 'months'} on the ${dayNum} at ${time}`;
    
    case 'years':
      const yearDay = config.dayOfMonth !== undefined ? `${config.dayOfMonth}${getOrdinalSuffix(config.dayOfMonth)}` : '1st';
      return `Every ${intervalText}${config.interval === 1 ? 'year' : 'years'} on ${yearDay} at ${time}`;
    
    default:
      return 'Invalid configuration';
  }
}

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Calculate next N execution times based on cron pattern
 */
export function getNextExecutions(cronPattern: string, count: number): Date[] {
  const results: Date[] = [];
  
  // Parse cron pattern (minute hour day month weekday)
  const parts = cronPattern.split(' ');
  if (parts.length !== 5) {
    return results;
  }
  
  const [minute, hour, day, month, weekday] = parts;
  
  // Determine optimal increment strategy based on pattern
  let incrementMs = 60000; // Default: 1 minute
  let maxIterations = 1000;
  
  // If looking for specific day of month, increment by days
  if (day !== '*' && !day.includes(',') && !day.includes('-')) {
    incrementMs = 86400000; // 1 day in milliseconds
    maxIterations = 10000; // Can search ~27 years ahead
  } 
  // If looking for specific month or month steps, also use day increments
  else if (month !== '*') {
    incrementMs = 86400000; // 1 day
    maxIterations = 10000;
  }
  
  let candidate = new Date();
  
  // Find next matches
  for (let i = 0; i < maxIterations && results.length < count; i++) {
    candidate = new Date(candidate.getTime() + incrementMs);
    
    if (matchesCronPattern(candidate, minute, hour, day, month, weekday)) {
      results.push(new Date(candidate));
    }
  }
  
  return results;
}

/**
 * Check if a date matches a cron pattern
 */
function matchesCronPattern(
  date: Date,
  minute: string,
  hour: string,
  day: string,
  month: string,
  weekday: string
): boolean {
  const m = date.getMinutes();
  const h = date.getHours();
  const d = date.getDate();
  const mon = date.getMonth() + 1; // 0-indexed to 1-indexed
  const w = date.getDay(); // 0=Sunday
  
  return (
    matchesCronValue(m, minute, 0, 59) &&
    matchesCronValue(h, hour, 0, 23) &&
    matchesCronValue(d, day, 1, 31) &&
    matchesCronValue(mon, month, 1, 12) &&
    matchesCronValue(w, weekday, 0, 6)
  );
}

/**
 * Check if a value matches a cron field (supports *, numbers, ranges, lists, steps)
 */
function matchesCronValue(
  value: number,
  pattern: string,
  min: number,
  max: number
): boolean {
  // * matches everything
  if (pattern === '*') return true;
  
  // */n step values
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2));
    return value % step === 0;
  }
  
  // Comma-separated list
  if (pattern.includes(',')) {
    return pattern.split(',').some(p => matchesCronValue(value, p.trim(), min, max));
  }
  
  // Range (e.g., 1-5)
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(n => parseInt(n));
    return value >= start && value <= end;
  }
  
  // Single number
  return value === parseInt(pattern);
}
