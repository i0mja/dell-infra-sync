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
