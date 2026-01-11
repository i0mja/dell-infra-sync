/**
 * Extract Dell part number from full manufacturing string
 * 
 * Dell-branded components use various vendor prefixes:
 * - CN-0RWR8F-SGW00-2CC-00A4-A05 (Dell)
 * - MY-0T2GFX-MCP00-1CK-024I-A00 (Micron)
 * - PH-0F9NWJ-TB200-1AQ-2VRH-A04 (Toshiba)
 * - SG-0T2GFX-MCS00-1CE-12TC-A00 (Seagate)
 * - CN0CK3MNSGW0071I00EMA01 (Dell, no dashes)
 * 
 * All extract to the 6-7 char Dell part number: 0RWR8F, 0T2GFX, etc.
 */
export function formatDellPartNumber(partNumber: string | null): string | null {
  if (!partNumber) return null;
  
  // Format 1: With dashes - XX-0XXXXXX-... (any 2-letter vendor prefix)
  // Matches: CN-, MY-, PH-, SG-, WD-, etc.
  const dashMatch = partNumber.match(/^[A-Z]{2}-([0-9A-Z]{6,7})-/i);
  if (dashMatch) {
    return dashMatch[1];
  }
  
  // Format 2: Without dashes - CNXXXXXX... (Dell-specific, 6 chars after CN)
  const noDashMatch = partNumber.match(/^CN([A-Z0-9]{6})/i);
  if (noDashMatch) {
    return noDashMatch[1];
  }
  
  // Format 3: Toshiba/Seagate HDDs without dashes - PHxxxPARTNUM...
  // Pattern: 2-letter prefix + 1 digit + Dell part number (starts with 0, 6-7 chars)
  // Example: PH0F9NWJ... -> 0F9NWJ
  const hddMatch = partNumber.match(/^[A-Z]{2}(0[0-9A-Z]{5,6})/i);
  if (hddMatch) {
    return hddMatch[1];
  }
  
  // If it doesn't match known formats, return as-is
  return partNumber;
}
