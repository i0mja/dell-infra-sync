// Shared types for update availability components

export type ScanType = 'cluster' | 'group' | 'servers' | 'single_host';
export type FirmwareSource = 'local_repository' | 'dell_online_catalog';
export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ResultStatus = 'pending' | 'scanning' | 'completed' | 'failed' | 'skipped';
export type ComponentStatus = 'up-to-date' | 'update-available' | 'critical-update' | 'not-in-catalog';
export type Criticality = 'Critical' | 'Recommended' | 'Optional';

export interface FirmwareComponent {
  name: string;
  type: string;
  installedVersion: string;
  availableVersion?: string;
  status: ComponentStatus;
  criticality?: Criticality;
  componentId?: string;
}

export interface ScanBlocker {
  type: 'connectivity' | 'authentication' | 'timeout' | 'unsupported' | 'other';
  message: string;
}

export interface ScanSummary {
  hostsScanned?: number;
  hostsSuccessful?: number;
  hostsFailed?: number;
  totalComponents?: number;
  updatesAvailable?: number;
  criticalUpdates?: number;
  upToDate?: number;
  esxiUpdatesAvailable?: number;
  uniqueUpdates?: number;
  uniqueCriticalUpdates?: number;
}

export interface ComponentTypeSummary {
  type: string;
  hostsOutdated: number;
  versionRange: string;
  availableVersion?: string;
  criticality?: string;
}

export interface ScanTarget {
  type: ScanType;
  id?: string;
  name?: string;
  serverIds?: string[];
  vcenterHostIds?: string[];
}
