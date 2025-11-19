/**
 * Calculate next N execution times based on cron pattern
 */
export function getNextExecutions(cronPattern: string, count: number): Date[] {
  const results: Date[] = [];
  let candidate = new Date();
  
  // Parse cron pattern (minute hour day month weekday)
  const parts = cronPattern.split(' ');
  if (parts.length !== 5) {
    return results;
  }
  
  const [minute, hour, day, month, weekday] = parts;
  
  // Find next matches
  for (let i = 0; i < 1000 && results.length < count; i++) {
    candidate = new Date(candidate.getTime() + 60000); // Increment by 1 minute
    
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
