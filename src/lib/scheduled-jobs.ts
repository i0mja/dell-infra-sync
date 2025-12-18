import { LucideIcon, Clock, Activity, RefreshCw, Shield, Server, Database } from "lucide-react";

/**
 * Centralized registry for all scheduled/background job types.
 * This is the single source of truth for metadata about jobs that run on a schedule.
 */

export interface ScheduledJobConfig {
  jobType: string;
  label: string;
  description: string;
  icon: LucideIcon;
  schedule: {
    interval: string;
    configurable: boolean;
    settingsPath?: string;
  };
  relatedEntity?: {
    type: 'protection_group' | 'maintenance_window' | 'vcenter' | 'server' | 'all';
    getEntityId: (jobDetails: any) => string | null;
    label: string;
  };
  actions?: {
    viewSettings?: string;
    viewEntities?: string;
  };
}

export const SCHEDULED_JOB_REGISTRY: Record<string, ScheduledJobConfig> = {
  scheduled_replication_check: {
    jobType: 'scheduled_replication_check',
    label: 'Scheduled Replication Check',
    description: 'Monitors protection groups and triggers replication syncs based on configured schedules. Runs continuously to ensure data protection SLAs are met.',
    icon: Clock,
    schedule: { 
      interval: 'Every 60 seconds', 
      configurable: false 
    },
    relatedEntity: { 
      type: 'protection_group', 
      getEntityId: (d) => d?.protection_group_id || null,
      label: 'Protection Groups'
    },
    actions: {
      viewEntities: '/replication?tab=protection-groups',
    }
  },
  
  rpo_monitoring: {
    jobType: 'rpo_monitoring',
    label: 'RPO Monitoring',
    description: 'Continuously monitors RPO compliance for all protection groups. Sends alerts when SLAs are breached and records violations for reporting.',
    icon: Activity,
    schedule: { 
      interval: 'Every 5 minutes', 
      configurable: false 
    },
    relatedEntity: { 
      type: 'all', 
      getEntityId: () => null,
      label: 'All Protection Groups'
    },
    actions: {
      viewEntities: '/replication?tab=protection-groups',
    }
  },

  vcenter_sync: {
    jobType: 'vcenter_sync',
    label: 'vCenter Sync',
    description: 'Synchronizes inventory from vCenter servers including hosts, clusters, VMs, and datastores.',
    icon: RefreshCw,
    schedule: { 
      interval: 'On-demand or scheduled', 
      configurable: true,
      settingsPath: '/vcenter'
    },
    relatedEntity: { 
      type: 'vcenter', 
      getEntityId: (d) => d?.vcenter_id || null,
      label: 'vCenter Servers'
    },
    actions: {
      viewSettings: '/vcenter',
      viewEntities: '/vcenter',
    }
  },

  scheduled_vcenter_sync: {
    jobType: 'scheduled_vcenter_sync',
    label: 'Scheduled vCenter Sync',
    description: 'Automatically synchronizes inventory from vCenter servers on a configured schedule. Keeps VM, host, and datastore data up to date.',
    icon: RefreshCw,
    schedule: { 
      interval: 'Configurable (default: 15 min)', 
      configurable: true,
      settingsPath: '/vcenter?settings=true'
    },
    relatedEntity: { 
      type: 'vcenter', 
      getEntityId: (d) => d?.vcenter_id || null,
      label: 'vCenter Servers'
    },
    actions: {
      viewSettings: '/vcenter?settings=true',
      viewEntities: '/vcenter',
    }
  },

  cluster_safety_check: {
    jobType: 'cluster_safety_check',
    label: 'Cluster Safety Check',
    description: 'Verifies cluster health before maintenance operations. Ensures minimum host requirements are met.',
    icon: Shield,
    schedule: { 
      interval: 'Before maintenance', 
      configurable: false 
    },
    relatedEntity: { 
      type: 'vcenter', 
      getEntityId: (d) => d?.cluster_id || null,
      label: 'vCenter Clusters'
    },
  },

  health_check: {
    jobType: 'health_check',
    label: 'Health Check',
    description: 'Monitors server health and connectivity. Can be scheduled or run on-demand.',
    icon: Server,
    schedule: { 
      interval: 'On-demand', 
      configurable: true 
    },
    relatedEntity: { 
      type: 'server', 
      getEntityId: (d) => d?.server_id || null,
      label: 'Servers'
    },
  },

  discovery_scan: {
    jobType: 'discovery_scan',
    label: 'Discovery Scan',
    description: 'Scans network ranges for new servers. Can be scheduled or run on-demand.',
    icon: Database,
    schedule: { 
      interval: 'On-demand', 
      configurable: true 
    },
    relatedEntity: { 
      type: 'server', 
      getEntityId: () => null,
      label: 'Discovered Servers'
    },
    actions: {
      viewEntities: '/servers',
    }
  },
};

/**
 * Check if a job type is a scheduled/background job
 */
export function isScheduledJob(jobType: string): boolean {
  return jobType in SCHEDULED_JOB_REGISTRY;
}

/**
 * Get the configuration for a scheduled job type
 */
export function getScheduledJobConfig(jobType: string): ScheduledJobConfig | null {
  return SCHEDULED_JOB_REGISTRY[jobType] || null;
}

/**
 * Get all scheduled job types
 */
export function getAllScheduledJobTypes(): string[] {
  return Object.keys(SCHEDULED_JOB_REGISTRY);
}
