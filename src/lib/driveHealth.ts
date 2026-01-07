/**
 * Helper utilities for drive health status detection
 */

interface DriveHealthStatus {
  health?: string | null;
  status?: string | null;
  predicted_failure?: boolean | null;
}

/**
 * Check if a drive is in a critical failure state
 * Critical states include: health="Critical", status="Disabled", or status="UnavailableOffline"
 */
export function isDriveCritical(drive: DriveHealthStatus): boolean {
  return (
    drive.health === "Critical" ||
    drive.status === "Disabled" ||
    drive.status === "UnavailableOffline"
  );
}

/**
 * Check if a drive has any issue (critical, warning, or predicted failure)
 */
export function hasDriveIssue(drive: DriveHealthStatus): boolean {
  return (
    isDriveCritical(drive) ||
    drive.predicted_failure === true ||
    drive.health === "Warning"
  );
}

/**
 * Get a human-readable status message for a failed drive
 */
export function getDriveFailureMessage(drive: DriveHealthStatus): string {
  if (drive.health === "Critical") {
    return "Critical failure";
  }
  if (drive.status === "UnavailableOffline") {
    return "Unavailable - Drive offline";
  }
  if (drive.status === "Disabled") {
    return "Disabled - Drive offline";
  }
  return "Unknown failure";
}
