/**
 * Extract Dell part number from full manufacturing string
 * 
 * Dell uses two formats:
 * - With dashes: "CN-0RWR8F-SGW00-2CC-00A4-A05" → "0RWR8F"
 * - Without dashes: "CN0CK3MNSGW0071I00EMA01" → "0CK3MN"
 */
export function formatDellPartNumber(partNumber: string | null): string | null {
  if (!partNumber) return null;
  
  // Format 1: With dashes - CN-XXXXXX-...
  const dashMatch = partNumber.match(/^CN-([A-Z0-9]+)-/i);
  if (dashMatch) {
    return dashMatch[1];
  }
  
  // Format 2: Without dashes - CNXXXXXX... (6 chars after CN)
  const noDashMatch = partNumber.match(/^CN([A-Z0-9]{6})/i);
  if (noDashMatch) {
    return noDashMatch[1];
  }
  
  // If it doesn't match Dell format, return as-is (might be a different vendor)
  return partNumber;
}
