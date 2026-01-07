/**
 * Disk sizing utilities for dynamic ZFS appliance provisioning.
 * 
 * Calculates target disk size based on VM storage and headroom percentage.
 */

/**
 * Calculate the target disk size for a ZFS appliance.
 * 
 * @param vmStorageBytes - Total storage used by VMs in bytes
 * @param headroomPercent - Headroom percentage (e.g., 50 for 50%)
 * @param minDiskGb - Minimum disk size in GB (default: 100)
 * @param maxDiskGb - Maximum disk size in GB (default: 10000)
 * @returns Target disk size in GB
 */
export function calculateDiskSize(
  vmStorageBytes: number,
  headroomPercent: number,
  minDiskGb: number = 100,
  maxDiskGb: number = 10000
): number {
  // Convert bytes to GB
  const baseGb = Math.ceil(vmStorageBytes / (1024 ** 3));
  
  // Apply headroom
  const withHeadroom = Math.ceil(baseGb * (1 + headroomPercent / 100));
  
  // Clamp to min/max
  return Math.min(Math.max(withHeadroom, minDiskGb), maxDiskGb);
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Calculate headroom bytes from base storage and percentage.
 */
export function calculateHeadroomBytes(vmStorageBytes: number, headroomPercent: number): number {
  return Math.ceil(vmStorageBytes * (headroomPercent / 100));
}

/**
 * Get sizing summary for display.
 */
export function getDiskSizingSummary(
  vmStorageBytes: number,
  headroomPercent: number,
  vmCount: number
): {
  vmStorageFormatted: string;
  headroomFormatted: string;
  totalFormatted: string;
  targetDiskGb: number;
  vmCount: number;
} {
  const headroomBytes = calculateHeadroomBytes(vmStorageBytes, headroomPercent);
  const totalBytes = vmStorageBytes + headroomBytes;
  const targetDiskGb = calculateDiskSize(vmStorageBytes, headroomPercent);
  
  return {
    vmStorageFormatted: formatBytes(vmStorageBytes),
    headroomFormatted: formatBytes(headroomBytes),
    totalFormatted: formatBytes(totalBytes),
    targetDiskGb,
    vmCount
  };
}
