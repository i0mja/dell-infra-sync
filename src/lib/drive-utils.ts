/**
 * Extract Dell part number from full manufacturing string
 * Input: "CN-0RWR8F-SGW00-2CC-00A4-A05"
 * Output: "0RWR8F"
 */
export function formatDellPartNumber(partNumber: string | null): string | null {
  if (!partNumber) return null;
  
  // Dell part numbers typically start with CN- followed by the actual part number
  const match = partNumber.match(/^CN-([A-Z0-9]+)-/i);
  if (match) {
    return match[1]; // Returns "0RWR8F"
  }
  
  // If it doesn't match Dell format, return as-is (might be a different vendor)
  return partNumber;
}
