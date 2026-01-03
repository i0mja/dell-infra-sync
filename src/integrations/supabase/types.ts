export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_settings: {
        Row: {
          alert_on_failures: boolean
          alert_on_slow_commands: boolean
          auto_cancel_stale_jobs: boolean | null
          auto_cleanup_enabled: boolean
          created_at: string
          discovery_max_threads: number | null
          encryption_key: string | null
          executor_shared_secret_encrypted: string | null
          id: string
          idrac_max_concurrent: number | null
          idrac_request_delay_ms: number | null
          job_auto_cleanup_enabled: boolean | null
          job_executor_url: string | null
          job_last_cleanup_at: string | null
          job_retention_days: number | null
          keep_statistics: boolean
          last_cleanup_at: string | null
          log_level: string
          log_retention_days: number
          max_request_body_kb: number
          max_response_body_kb: number
          pause_idrac_operations: boolean | null
          scp_share_enabled: boolean | null
          scp_share_password_encrypted: string | null
          scp_share_path: string | null
          scp_share_type: string | null
          scp_share_username: string | null
          show_sla_monitoring_jobs: boolean | null
          slow_command_threshold_ms: number
          stale_pending_hours: number | null
          stale_running_hours: number | null
          statistics_retention_days: number
          updated_at: string
          use_job_executor_for_idrac: boolean | null
        }
        Insert: {
          alert_on_failures?: boolean
          alert_on_slow_commands?: boolean
          auto_cancel_stale_jobs?: boolean | null
          auto_cleanup_enabled?: boolean
          created_at?: string
          discovery_max_threads?: number | null
          encryption_key?: string | null
          executor_shared_secret_encrypted?: string | null
          id?: string
          idrac_max_concurrent?: number | null
          idrac_request_delay_ms?: number | null
          job_auto_cleanup_enabled?: boolean | null
          job_executor_url?: string | null
          job_last_cleanup_at?: string | null
          job_retention_days?: number | null
          keep_statistics?: boolean
          last_cleanup_at?: string | null
          log_level?: string
          log_retention_days?: number
          max_request_body_kb?: number
          max_response_body_kb?: number
          pause_idrac_operations?: boolean | null
          scp_share_enabled?: boolean | null
          scp_share_password_encrypted?: string | null
          scp_share_path?: string | null
          scp_share_type?: string | null
          scp_share_username?: string | null
          show_sla_monitoring_jobs?: boolean | null
          slow_command_threshold_ms?: number
          stale_pending_hours?: number | null
          stale_running_hours?: number | null
          statistics_retention_days?: number
          updated_at?: string
          use_job_executor_for_idrac?: boolean | null
        }
        Update: {
          alert_on_failures?: boolean
          alert_on_slow_commands?: boolean
          auto_cancel_stale_jobs?: boolean | null
          auto_cleanup_enabled?: boolean
          created_at?: string
          discovery_max_threads?: number | null
          encryption_key?: string | null
          executor_shared_secret_encrypted?: string | null
          id?: string
          idrac_max_concurrent?: number | null
          idrac_request_delay_ms?: number | null
          job_auto_cleanup_enabled?: boolean | null
          job_executor_url?: string | null
          job_last_cleanup_at?: string | null
          job_retention_days?: number | null
          keep_statistics?: boolean
          last_cleanup_at?: string | null
          log_level?: string
          log_retention_days?: number
          max_request_body_kb?: number
          max_response_body_kb?: number
          pause_idrac_operations?: boolean | null
          scp_share_enabled?: boolean | null
          scp_share_password_encrypted?: string | null
          scp_share_path?: string | null
          scp_share_type?: string | null
          scp_share_username?: string | null
          show_sla_monitoring_jobs?: boolean | null
          slow_command_threshold_ms?: number
          stale_pending_hours?: number | null
          stale_running_hours?: number | null
          statistics_retention_days?: number
          updated_at?: string
          use_job_executor_for_idrac?: boolean | null
        }
        Relationships: []
      }
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          auth_method: string | null
          auth_source: string | null
          created_at: string
          details: Json | null
          id: string
          idm_groups_at_login: Json | null
          idm_user_dn: string | null
          ip_address: string | null
          timestamp: string
          user_id: string | null
        }
        Insert: {
          action: string
          auth_method?: string | null
          auth_source?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          idm_groups_at_login?: Json | null
          idm_user_dn?: string | null
          ip_address?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          auth_method?: string | null
          auth_source?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          idm_groups_at_login?: Json | null
          idm_user_dn?: string | null
          ip_address?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_rate_limits: {
        Row: {
          attempt_count: number | null
          first_attempt_at: string | null
          id: string
          identifier: string
          identifier_type: string
          last_attempt_at: string | null
          locked_until: string | null
        }
        Insert: {
          attempt_count?: number | null
          first_attempt_at?: string | null
          id?: string
          identifier: string
          identifier_type: string
          last_attempt_at?: string | null
          locked_until?: string | null
        }
        Update: {
          attempt_count?: number | null
          first_attempt_at?: string | null
          id?: string
          identifier?: string
          identifier_type?: string
          last_attempt_at?: string | null
          locked_until?: string | null
        }
        Relationships: []
      }
      bios_configurations: {
        Row: {
          attributes: Json
          bios_version: string | null
          captured_at: string | null
          created_at: string | null
          created_by: string | null
          id: string
          job_id: string | null
          notes: string | null
          pending_attributes: Json | null
          server_id: string
          snapshot_type: string
        }
        Insert: {
          attributes: Json
          bios_version?: string | null
          captured_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          pending_attributes?: Json | null
          server_id: string
          snapshot_type: string
        }
        Update: {
          attributes?: Json
          bios_version?: string | null
          captured_at?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          pending_attributes?: Json | null
          server_id?: string
          snapshot_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bios_configurations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bios_configurations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bios_configurations_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      break_glass_admins: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          activation_reason: string | null
          created_at: string | null
          created_by: string | null
          deactivated_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          last_used_at: string | null
          password_hash: string
          use_count: number | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason?: string | null
          created_at?: string | null
          created_by?: string | null
          deactivated_at?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          password_hash: string
          use_count?: number | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason?: string | null
          created_at?: string | null
          created_by?: string | null
          deactivated_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          password_hash?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "break_glass_admins_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_glass_admins_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_safety_checks: {
        Row: {
          check_timestamp: string | null
          cluster_id: string
          created_at: string | null
          details: Json | null
          healthy_hosts: number
          id: string
          is_scheduled: boolean | null
          job_id: string | null
          min_required_hosts: number
          previous_status: string | null
          safe_to_proceed: boolean
          scheduled_check_id: string | null
          status_changed: boolean | null
          total_hosts: number
        }
        Insert: {
          check_timestamp?: string | null
          cluster_id: string
          created_at?: string | null
          details?: Json | null
          healthy_hosts: number
          id?: string
          is_scheduled?: boolean | null
          job_id?: string | null
          min_required_hosts: number
          previous_status?: string | null
          safe_to_proceed: boolean
          scheduled_check_id?: string | null
          status_changed?: boolean | null
          total_hosts: number
        }
        Update: {
          check_timestamp?: string | null
          cluster_id?: string
          created_at?: string | null
          details?: Json | null
          healthy_hosts?: number
          id?: string
          is_scheduled?: boolean | null
          job_id?: string | null
          min_required_hosts?: number
          previous_status?: string | null
          safe_to_proceed?: boolean
          scheduled_check_id?: string | null
          status_changed?: boolean | null
          total_hosts?: number
        }
        Relationships: [
          {
            foreignKeyName: "cluster_safety_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_safety_checks_scheduled_check_id_fkey"
            columns: ["scheduled_check_id"]
            isOneToOne: false
            referencedRelation: "scheduled_safety_checks"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_ip_ranges: {
        Row: {
          created_at: string | null
          credential_set_id: string
          description: string | null
          id: string
          ip_range: string
          priority: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          credential_set_id: string
          description?: string | null
          id?: string
          ip_range: string
          priority?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          credential_set_id?: string
          description?: string | null
          id?: string
          ip_range?: string
          priority?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_ip_ranges_credential_set_id_fkey"
            columns: ["credential_set_id"]
            isOneToOne: false
            referencedRelation: "credential_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_sets: {
        Row: {
          created_at: string | null
          credential_type: Database["public"]["Enums"]["credential_type"]
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          password_encrypted: string | null
          priority: number | null
          updated_at: string | null
          username: string
          vcenter_host_id: string | null
        }
        Insert: {
          created_at?: string | null
          credential_type?: Database["public"]["Enums"]["credential_type"]
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          password_encrypted?: string | null
          priority?: number | null
          updated_at?: string | null
          username: string
          vcenter_host_id?: string | null
        }
        Update: {
          created_at?: string | null
          credential_type?: Database["public"]["Enums"]["credential_type"]
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          password_encrypted?: string | null
          priority?: number | null
          updated_at?: string | null
          username?: string
          vcenter_host_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_sets_vcenter_host_id_fkey"
            columns: ["vcenter_host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      esxi_upgrade_history: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          job_id: string | null
          profile_id: string | null
          server_id: string | null
          ssh_output: string | null
          started_at: string | null
          status: string | null
          vcenter_host_id: string | null
          version_after: string | null
          version_before: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          profile_id?: string | null
          server_id?: string | null
          ssh_output?: string | null
          started_at?: string | null
          status?: string | null
          vcenter_host_id?: string | null
          version_after?: string | null
          version_before: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          profile_id?: string | null
          server_id?: string | null
          ssh_output?: string | null
          started_at?: string | null
          status?: string | null
          vcenter_host_id?: string | null
          version_after?: string | null
          version_before?: string
        }
        Relationships: [
          {
            foreignKeyName: "esxi_upgrade_history_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esxi_upgrade_history_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "esxi_upgrade_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esxi_upgrade_history_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esxi_upgrade_history_vcenter_host_id_fkey"
            columns: ["vcenter_host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      esxi_upgrade_profiles: {
        Row: {
          bundle_path: string
          created_at: string | null
          created_by: string | null
          datastore_name: string | null
          description: string | null
          id: string
          is_active: boolean | null
          min_source_version: string | null
          name: string
          profile_name: string
          release_date: string | null
          target_version: string
          updated_at: string | null
        }
        Insert: {
          bundle_path: string
          created_at?: string | null
          created_by?: string | null
          datastore_name?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          min_source_version?: string | null
          name: string
          profile_name: string
          release_date?: string | null
          target_version: string
          updated_at?: string | null
        }
        Update: {
          bundle_path?: string
          created_at?: string | null
          created_by?: string | null
          datastore_name?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          min_source_version?: string | null
          name?: string
          profile_name?: string
          release_date?: string | null
          target_version?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esxi_upgrade_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      executor_heartbeats: {
        Row: {
          capabilities: Json | null
          created_at: string | null
          executor_id: string
          hostname: string | null
          id: string
          ip_address: string | null
          jobs_processed: number | null
          last_error: string | null
          last_seen_at: string | null
          poll_count: number | null
          startup_time: string | null
          version: string | null
        }
        Insert: {
          capabilities?: Json | null
          created_at?: string | null
          executor_id: string
          hostname?: string | null
          id?: string
          ip_address?: string | null
          jobs_processed?: number | null
          last_error?: string | null
          last_seen_at?: string | null
          poll_count?: number | null
          startup_time?: string | null
          version?: string | null
        }
        Update: {
          capabilities?: Json | null
          created_at?: string | null
          executor_id?: string
          hostname?: string | null
          id?: string
          ip_address?: string | null
          jobs_processed?: number | null
          last_error?: string | null
          last_seen_at?: string | null
          poll_count?: number | null
          startup_time?: string | null
          version?: string | null
        }
        Relationships: []
      }
      failover_events: {
        Row: {
          checkpoint_time: string | null
          commit_delay_minutes: number | null
          commit_policy: string | null
          committed_at: string | null
          created_at: string | null
          error_message: string | null
          failover_type: string
          id: string
          initiated_by: string | null
          protection_group_id: string
          reverse_protection: boolean | null
          rolled_back_at: string | null
          shutdown_source_vms: string | null
          started_at: string | null
          status: string | null
          test_network_id: string | null
          vms_recovered: number | null
        }
        Insert: {
          checkpoint_time?: string | null
          commit_delay_minutes?: number | null
          commit_policy?: string | null
          committed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          failover_type: string
          id?: string
          initiated_by?: string | null
          protection_group_id: string
          reverse_protection?: boolean | null
          rolled_back_at?: string | null
          shutdown_source_vms?: string | null
          started_at?: string | null
          status?: string | null
          test_network_id?: string | null
          vms_recovered?: number | null
        }
        Update: {
          checkpoint_time?: string | null
          commit_delay_minutes?: number | null
          commit_policy?: string | null
          committed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          failover_type?: string
          id?: string
          initiated_by?: string | null
          protection_group_id?: string
          reverse_protection?: boolean | null
          rolled_back_at?: string | null
          shutdown_source_vms?: string | null
          started_at?: string | null
          status?: string | null
          test_network_id?: string | null
          vms_recovered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "failover_events_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "failover_events_protection_group_id_fkey"
            columns: ["protection_group_id"]
            isOneToOne: false
            referencedRelation: "protection_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      firmware_packages: {
        Row: {
          applicable_models: string[] | null
          baseline_for_models: string[] | null
          checksum: string | null
          component_name_pattern: string | null
          component_type: string
          created_at: string | null
          created_by: string | null
          criticality: string | null
          dell_package_version: string | null
          dell_version: string
          description: string | null
          file_size_bytes: number
          filename: string
          id: string
          is_baseline: boolean | null
          last_used_at: string | null
          local_path: string | null
          reboot_required: boolean | null
          release_date: string | null
          served_url: string | null
          tags: string[] | null
          updated_at: string | null
          upload_progress: number | null
          upload_status: string
          use_count: number | null
        }
        Insert: {
          applicable_models?: string[] | null
          baseline_for_models?: string[] | null
          checksum?: string | null
          component_name_pattern?: string | null
          component_type: string
          created_at?: string | null
          created_by?: string | null
          criticality?: string | null
          dell_package_version?: string | null
          dell_version: string
          description?: string | null
          file_size_bytes: number
          filename: string
          id?: string
          is_baseline?: boolean | null
          last_used_at?: string | null
          local_path?: string | null
          reboot_required?: boolean | null
          release_date?: string | null
          served_url?: string | null
          tags?: string[] | null
          updated_at?: string | null
          upload_progress?: number | null
          upload_status?: string
          use_count?: number | null
        }
        Update: {
          applicable_models?: string[] | null
          baseline_for_models?: string[] | null
          checksum?: string | null
          component_name_pattern?: string | null
          component_type?: string
          created_at?: string | null
          created_by?: string | null
          criticality?: string | null
          dell_package_version?: string | null
          dell_version?: string
          description?: string | null
          file_size_bytes?: number
          filename?: string
          id?: string
          is_baseline?: boolean | null
          last_used_at?: string | null
          local_path?: string | null
          reboot_required?: boolean | null
          release_date?: string | null
          served_url?: string | null
          tags?: string[] | null
          updated_at?: string | null
          upload_progress?: number | null
          upload_status?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "firmware_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      idm_auth_sessions: {
        Row: {
          auth_method: string | null
          id: string
          idm_groups: Json | null
          idm_uid: string
          idm_user_dn: string
          invalidated_at: string | null
          invalidation_reason: string | null
          ip_address: string | null
          is_active: boolean | null
          last_activity_at: string | null
          mapped_role: Database["public"]["Enums"]["app_role"]
          session_expires_at: string | null
          session_started_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          auth_method?: string | null
          id?: string
          idm_groups?: Json | null
          idm_uid: string
          idm_user_dn: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          ip_address?: string | null
          is_active?: boolean | null
          last_activity_at?: string | null
          mapped_role: Database["public"]["Enums"]["app_role"]
          session_expires_at?: string | null
          session_started_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          auth_method?: string | null
          id?: string
          idm_groups?: Json | null
          idm_uid?: string
          idm_user_dn?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          ip_address?: string | null
          is_active?: boolean | null
          last_activity_at?: string | null
          mapped_role?: Database["public"]["Enums"]["app_role"]
          session_expires_at?: string | null
          session_started_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idm_auth_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      idm_group_mappings: {
        Row: {
          app_role: Database["public"]["Enums"]["app_role"]
          created_at: string | null
          description: string | null
          id: string
          idm_group_dn: string
          idm_group_name: string
          is_active: boolean | null
          priority: number | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          app_role: Database["public"]["Enums"]["app_role"]
          created_at?: string | null
          description?: string | null
          id?: string
          idm_group_dn: string
          idm_group_name: string
          is_active?: boolean | null
          priority?: number | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          app_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string | null
          description?: string | null
          id?: string
          idm_group_dn?: string
          idm_group_name?: string
          is_active?: boolean | null
          priority?: number | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      idm_settings: {
        Row: {
          ad_bind_dn: string | null
          ad_bind_password_encrypted: string | null
          ad_dc_host: string | null
          ad_dc_port: number | null
          ad_dc_use_ssl: boolean | null
          ad_domain_fqdn: string | null
          auth_mode: string
          base_dn: string | null
          bind_dn: string | null
          bind_password_encrypted: string | null
          ca_certificate: string | null
          connection_timeout_seconds: number | null
          created_at: string | null
          failover_behavior: string | null
          group_search_base: string | null
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          ldaps_port: number | null
          lockout_duration_minutes: number | null
          max_failed_attempts: number | null
          require_ldaps: boolean | null
          server_host: string | null
          server_port: number | null
          session_timeout_minutes: number | null
          sync_enabled: boolean | null
          sync_interval_minutes: number | null
          trusted_domains: string[] | null
          updated_at: string | null
          use_ldaps: boolean | null
          user_search_base: string | null
          verify_certificate: boolean | null
        }
        Insert: {
          ad_bind_dn?: string | null
          ad_bind_password_encrypted?: string | null
          ad_dc_host?: string | null
          ad_dc_port?: number | null
          ad_dc_use_ssl?: boolean | null
          ad_domain_fqdn?: string | null
          auth_mode?: string
          base_dn?: string | null
          bind_dn?: string | null
          bind_password_encrypted?: string | null
          ca_certificate?: string | null
          connection_timeout_seconds?: number | null
          created_at?: string | null
          failover_behavior?: string | null
          group_search_base?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          ldaps_port?: number | null
          lockout_duration_minutes?: number | null
          max_failed_attempts?: number | null
          require_ldaps?: boolean | null
          server_host?: string | null
          server_port?: number | null
          session_timeout_minutes?: number | null
          sync_enabled?: boolean | null
          sync_interval_minutes?: number | null
          trusted_domains?: string[] | null
          updated_at?: string | null
          use_ldaps?: boolean | null
          user_search_base?: string | null
          verify_certificate?: boolean | null
        }
        Update: {
          ad_bind_dn?: string | null
          ad_bind_password_encrypted?: string | null
          ad_dc_host?: string | null
          ad_dc_port?: number | null
          ad_dc_use_ssl?: boolean | null
          ad_domain_fqdn?: string | null
          auth_mode?: string
          base_dn?: string | null
          bind_dn?: string | null
          bind_password_encrypted?: string | null
          ca_certificate?: string | null
          connection_timeout_seconds?: number | null
          created_at?: string | null
          failover_behavior?: string | null
          group_search_base?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          ldaps_port?: number | null
          lockout_duration_minutes?: number | null
          max_failed_attempts?: number | null
          require_ldaps?: boolean | null
          server_host?: string | null
          server_port?: number | null
          session_timeout_minutes?: number | null
          sync_enabled?: boolean | null
          sync_interval_minutes?: number | null
          trusted_domains?: string[] | null
          updated_at?: string | null
          use_ldaps?: boolean | null
          user_search_base?: string | null
          verify_certificate?: boolean | null
        }
        Relationships: []
      }
      idrac_commands: {
        Row: {
          command_type: string
          created_at: string
          endpoint: string
          error_message: string | null
          full_url: string
          id: string
          initiated_by: string | null
          job_id: string | null
          operation_type: Database["public"]["Enums"]["operation_type"]
          request_body: Json | null
          request_headers: Json | null
          response_body: Json | null
          response_time_ms: number | null
          server_id: string | null
          source: string | null
          status_code: number | null
          success: boolean
          task_id: string | null
          timestamp: string
        }
        Insert: {
          command_type: string
          created_at?: string
          endpoint: string
          error_message?: string | null
          full_url: string
          id?: string
          initiated_by?: string | null
          job_id?: string | null
          operation_type: Database["public"]["Enums"]["operation_type"]
          request_body?: Json | null
          request_headers?: Json | null
          response_body?: Json | null
          response_time_ms?: number | null
          server_id?: string | null
          source?: string | null
          status_code?: number | null
          success?: boolean
          task_id?: string | null
          timestamp?: string
        }
        Update: {
          command_type?: string
          created_at?: string
          endpoint?: string
          error_message?: string | null
          full_url?: string
          id?: string
          initiated_by?: string | null
          job_id?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"]
          request_body?: Json | null
          request_headers?: Json | null
          response_body?: Json | null
          response_time_ms?: number | null
          server_id?: string | null
          source?: string | null
          status_code?: number | null
          success?: boolean
          task_id?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "idrac_commands_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idrac_commands_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idrac_commands_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idrac_commands_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "job_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      idrac_network_configurations: {
        Row: {
          captured_at: string | null
          created_at: string | null
          created_by: string | null
          dhcp_enabled: boolean | null
          dns_from_dhcp: boolean | null
          dns1: string | null
          dns2: string | null
          gateway: string | null
          id: string
          ip_address: string | null
          ipv4_enabled: boolean | null
          job_id: string | null
          netmask: string | null
          nic_duplex: string | null
          nic_mtu: number | null
          nic_selection: string | null
          nic_speed: string | null
          notes: string | null
          ntp_enabled: boolean | null
          ntp_server1: string | null
          ntp_server2: string | null
          ntp_server3: string | null
          raw_attributes: Json | null
          server_id: string
          timezone: string | null
          vlan_enabled: boolean | null
          vlan_id: number | null
          vlan_priority: number | null
        }
        Insert: {
          captured_at?: string | null
          created_at?: string | null
          created_by?: string | null
          dhcp_enabled?: boolean | null
          dns_from_dhcp?: boolean | null
          dns1?: string | null
          dns2?: string | null
          gateway?: string | null
          id?: string
          ip_address?: string | null
          ipv4_enabled?: boolean | null
          job_id?: string | null
          netmask?: string | null
          nic_duplex?: string | null
          nic_mtu?: number | null
          nic_selection?: string | null
          nic_speed?: string | null
          notes?: string | null
          ntp_enabled?: boolean | null
          ntp_server1?: string | null
          ntp_server2?: string | null
          ntp_server3?: string | null
          raw_attributes?: Json | null
          server_id: string
          timezone?: string | null
          vlan_enabled?: boolean | null
          vlan_id?: number | null
          vlan_priority?: number | null
        }
        Update: {
          captured_at?: string | null
          created_at?: string | null
          created_by?: string | null
          dhcp_enabled?: boolean | null
          dns_from_dhcp?: boolean | null
          dns1?: string | null
          dns2?: string | null
          gateway?: string | null
          id?: string
          ip_address?: string | null
          ipv4_enabled?: boolean | null
          job_id?: string | null
          netmask?: string | null
          nic_duplex?: string | null
          nic_mtu?: number | null
          nic_selection?: string | null
          nic_speed?: string | null
          notes?: string | null
          ntp_enabled?: boolean | null
          ntp_server1?: string | null
          ntp_server2?: string | null
          ntp_server3?: string | null
          raw_attributes?: Json | null
          server_id?: string
          timezone?: string | null
          vlan_enabled?: boolean | null
          vlan_id?: number | null
          vlan_priority?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "idrac_network_configurations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idrac_network_configurations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idrac_network_configurations_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      iso_images: {
        Row: {
          checksum: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          file_size_bytes: number
          filename: string
          id: string
          last_mounted_at: string | null
          local_path: string | null
          mount_count: number | null
          served_url: string | null
          source_type: string | null
          source_url: string | null
          tags: string[] | null
          updated_at: string | null
          upload_progress: number | null
          upload_status: string
        }
        Insert: {
          checksum?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          file_size_bytes: number
          filename: string
          id?: string
          last_mounted_at?: string | null
          local_path?: string | null
          mount_count?: number | null
          served_url?: string | null
          source_type?: string | null
          source_url?: string | null
          tags?: string[] | null
          updated_at?: string | null
          upload_progress?: number | null
          upload_status?: string
        }
        Update: {
          checksum?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          file_size_bytes?: number
          filename?: string
          id?: string
          last_mounted_at?: string | null
          local_path?: string | null
          mount_count?: number | null
          served_url?: string | null
          source_type?: string | null
          source_url?: string | null
          tags?: string[] | null
          updated_at?: string | null
          upload_progress?: number | null
          upload_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "iso_images_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          job_id: string
          log: string | null
          progress: number | null
          server_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          vcenter_host_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          job_id: string
          log?: string | null
          progress?: number | null
          server_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          vcenter_host_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          job_id?: string
          log?: string | null
          progress?: number | null
          server_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          vcenter_host_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tasks_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tasks_vcenter_host_id_fkey"
            columns: ["vcenter_host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          auto_select_latest: boolean | null
          completed_at: string | null
          component_order: number | null
          created_at: string
          created_by: string | null
          credential_set_ids: string[] | null
          dell_catalog_url: string | null
          details: Json | null
          firmware_source: string | null
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          notes: string | null
          parent_job_id: string | null
          priority: string | null
          schedule_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          target_scope: Json | null
        }
        Insert: {
          auto_select_latest?: boolean | null
          completed_at?: string | null
          component_order?: number | null
          created_at?: string
          created_by?: string | null
          credential_set_ids?: string[] | null
          dell_catalog_url?: string | null
          details?: Json | null
          firmware_source?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          notes?: string | null
          parent_job_id?: string | null
          priority?: string | null
          schedule_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_scope?: Json | null
        }
        Update: {
          auto_select_latest?: boolean | null
          completed_at?: string | null
          component_order?: number | null
          created_at?: string
          created_by?: string | null
          credential_set_ids?: string[] | null
          dell_catalog_url?: string | null
          details?: Json | null
          firmware_source?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
          notes?: string | null
          parent_job_id?: string | null
          priority?: string | null
          schedule_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_scope?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_blocker_resolutions: {
        Row: {
          blocker_reason: string
          created_at: string | null
          executed_at: string | null
          execution_result: string | null
          host_id: string
          host_name: string
          id: string
          maintenance_window_id: string | null
          powered_on_at: string | null
          resolution_details: Json | null
          resolution_type: string
          resolved_at: string | null
          resolved_by: string | null
          vm_id: string
          vm_name: string
        }
        Insert: {
          blocker_reason: string
          created_at?: string | null
          executed_at?: string | null
          execution_result?: string | null
          host_id: string
          host_name: string
          id?: string
          maintenance_window_id?: string | null
          powered_on_at?: string | null
          resolution_details?: Json | null
          resolution_type: string
          resolved_at?: string | null
          resolved_by?: string | null
          vm_id: string
          vm_name: string
        }
        Update: {
          blocker_reason?: string
          created_at?: string | null
          executed_at?: string | null
          execution_result?: string | null
          host_id?: string
          host_name?: string
          id?: string
          maintenance_window_id?: string | null
          powered_on_at?: string | null
          resolution_details?: Json | null
          resolution_type?: string
          resolved_at?: string | null
          resolved_by?: string | null
          vm_id?: string
          vm_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_blocker_resolutions_maintenance_window_id_fkey"
            columns: ["maintenance_window_id"]
            isOneToOne: false
            referencedRelation: "maintenance_windows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_blocker_resolutions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_windows: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          auto_execute: boolean | null
          cluster_ids: string[] | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          credential_set_ids: string[] | null
          description: string | null
          details: Json | null
          id: string
          job_ids: string[] | null
          last_executed_at: string | null
          maintenance_type: string
          notification_sent: boolean | null
          notify_before_hours: number | null
          planned_end: string
          planned_start: string
          recurrence_enabled: boolean | null
          recurrence_pattern: string | null
          recurrence_type: string | null
          requires_approval: boolean | null
          safety_check_snapshot: Json | null
          server_group_ids: string[] | null
          server_ids: string[] | null
          skip_count: number | null
          started_at: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          auto_execute?: boolean | null
          cluster_ids?: string[] | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          credential_set_ids?: string[] | null
          description?: string | null
          details?: Json | null
          id?: string
          job_ids?: string[] | null
          last_executed_at?: string | null
          maintenance_type: string
          notification_sent?: boolean | null
          notify_before_hours?: number | null
          planned_end: string
          planned_start: string
          recurrence_enabled?: boolean | null
          recurrence_pattern?: string | null
          recurrence_type?: string | null
          requires_approval?: boolean | null
          safety_check_snapshot?: Json | null
          server_group_ids?: string[] | null
          server_ids?: string[] | null
          skip_count?: number | null
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          auto_execute?: boolean | null
          cluster_ids?: string[] | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          credential_set_ids?: string[] | null
          description?: string | null
          details?: Json | null
          id?: string
          job_ids?: string[] | null
          last_executed_at?: string | null
          maintenance_type?: string
          notification_sent?: boolean | null
          notify_before_hours?: number | null
          planned_end?: string
          planned_start?: string
          recurrence_enabled?: boolean | null
          recurrence_pattern?: string | null
          recurrence_type?: string | null
          requires_approval?: boolean | null
          safety_check_snapshot?: Json | null
          server_group_ids?: string[] | null
          server_ids?: string[] | null
          skip_count?: number | null
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_windows_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_windows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_users: {
        Row: {
          ad_domain: string
          ad_username: string
          app_role: Database["public"]["Enums"]["app_role"]
          created_at: string | null
          created_by: string | null
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          ad_domain: string
          ad_username: string
          app_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string | null
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_domain?: string
          ad_username?: string
          app_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string | null
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      network_settings: {
        Row: {
          connection_timeout_seconds: number
          created_at: string
          id: string
          latency_alert_threshold_ms: number
          max_concurrent_connections: number
          max_requests_per_minute: number
          max_retry_attempts: number
          monitor_latency: boolean
          operation_timeout_seconds: number
          read_timeout_seconds: number
          require_prereq_validation: boolean
          retry_backoff_type: string
          retry_delay_seconds: number
          updated_at: string
        }
        Insert: {
          connection_timeout_seconds?: number
          created_at?: string
          id?: string
          latency_alert_threshold_ms?: number
          max_concurrent_connections?: number
          max_requests_per_minute?: number
          max_retry_attempts?: number
          monitor_latency?: boolean
          operation_timeout_seconds?: number
          read_timeout_seconds?: number
          require_prereq_validation?: boolean
          retry_backoff_type?: string
          retry_delay_seconds?: number
          updated_at?: string
        }
        Update: {
          connection_timeout_seconds?: number
          created_at?: string
          id?: string
          latency_alert_threshold_ms?: number
          max_concurrent_connections?: number
          max_requests_per_minute?: number
          max_retry_attempts?: number
          monitor_latency?: boolean
          operation_timeout_seconds?: number
          read_timeout_seconds?: number
          require_prereq_validation?: boolean
          retry_backoff_type?: string
          retry_delay_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          created_at: string
          delivery_details: Json | null
          error_message: string | null
          id: string
          is_test: boolean
          job_id: string | null
          notification_type: string
          severity: string | null
          status: string
        }
        Insert: {
          created_at?: string
          delivery_details?: Json | null
          error_message?: string | null
          id?: string
          is_test?: boolean
          job_id?: string | null
          notification_type: string
          severity?: string | null
          status: string
        }
        Update: {
          created_at?: string
          delivery_details?: Json | null
          error_message?: string | null
          id?: string
          is_test?: boolean
          job_id?: string | null
          notification_type?: string
          severity?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          created_at: string
          critical_job_types: string[] | null
          id: string
          mention_on_critical_failures: boolean | null
          notify_on_cluster_status_change: boolean | null
          notify_on_cluster_warning: boolean | null
          notify_on_job_complete: boolean | null
          notify_on_job_failed: boolean | null
          notify_on_job_started: boolean | null
          notify_on_unsafe_cluster: boolean | null
          smtp_from_email: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_user: string | null
          teams_mention_users: string | null
          teams_webhook_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          critical_job_types?: string[] | null
          id?: string
          mention_on_critical_failures?: boolean | null
          notify_on_cluster_status_change?: boolean | null
          notify_on_cluster_warning?: boolean | null
          notify_on_job_complete?: boolean | null
          notify_on_job_failed?: boolean | null
          notify_on_job_started?: boolean | null
          notify_on_unsafe_cluster?: boolean | null
          smtp_from_email?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_user?: string | null
          teams_mention_users?: string | null
          teams_webhook_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          critical_job_types?: string[] | null
          id?: string
          mention_on_critical_failures?: boolean | null
          notify_on_cluster_status_change?: boolean | null
          notify_on_cluster_warning?: boolean | null
          notify_on_job_complete?: boolean | null
          notify_on_job_failed?: boolean | null
          notify_on_job_started?: boolean | null
          notify_on_unsafe_cluster?: boolean | null
          smtp_from_email?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_user?: string | null
          teams_mention_users?: string | null
          teams_webhook_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      openmanage_settings: {
        Row: {
          created_at: string
          host: string
          id: string
          last_sync: string | null
          password: string | null
          port: number
          sync_enabled: boolean
          updated_at: string
          username: string
          verify_ssl: boolean
        }
        Insert: {
          created_at?: string
          host: string
          id?: string
          last_sync?: string | null
          password?: string | null
          port?: number
          sync_enabled?: boolean
          updated_at?: string
          username: string
          verify_ssl?: boolean
        }
        Update: {
          created_at?: string
          host?: string
          id?: string
          last_sync?: string | null
          password?: string | null
          port?: number
          sync_enabled?: boolean
          updated_at?: string
          username?: string
          verify_ssl?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          idm_department: string | null
          idm_disabled: boolean | null
          idm_groups: Json | null
          idm_mail: string | null
          idm_source: string | null
          idm_title: string | null
          idm_uid: string | null
          idm_user_dn: string | null
          last_idm_sync: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          idm_department?: string | null
          idm_disabled?: boolean | null
          idm_groups?: Json | null
          idm_mail?: string | null
          idm_source?: string | null
          idm_title?: string | null
          idm_uid?: string | null
          idm_user_dn?: string | null
          last_idm_sync?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          idm_department?: string | null
          idm_disabled?: boolean | null
          idm_groups?: Json | null
          idm_mail?: string | null
          idm_source?: string | null
          idm_title?: string | null
          idm_uid?: string | null
          idm_user_dn?: string | null
          last_idm_sync?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      protected_vms: {
        Row: {
          created_at: string | null
          current_dataset_size: number | null
          current_datastore: string | null
          dr_shell_vm_created: boolean | null
          dr_shell_vm_id: string | null
          dr_shell_vm_name: string | null
          failover_check_result: Json | null
          failover_ready: boolean | null
          failover_status: string | null
          id: string
          last_failover_at: string | null
          last_failover_check: string | null
          last_replication_at: string | null
          last_snapshot_at: string | null
          last_snapshot_name: string | null
          last_sync_bytes: number | null
          needs_storage_vmotion: boolean | null
          priority: number | null
          protection_group_id: string
          replication_status: string | null
          site_b_verified: boolean | null
          status_message: string | null
          target_datastore: string | null
          total_bytes_synced: number | null
          updated_at: string | null
          vm_id: string | null
          vm_name: string
          vm_vcenter_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_dataset_size?: number | null
          current_datastore?: string | null
          dr_shell_vm_created?: boolean | null
          dr_shell_vm_id?: string | null
          dr_shell_vm_name?: string | null
          failover_check_result?: Json | null
          failover_ready?: boolean | null
          failover_status?: string | null
          id?: string
          last_failover_at?: string | null
          last_failover_check?: string | null
          last_replication_at?: string | null
          last_snapshot_at?: string | null
          last_snapshot_name?: string | null
          last_sync_bytes?: number | null
          needs_storage_vmotion?: boolean | null
          priority?: number | null
          protection_group_id: string
          replication_status?: string | null
          site_b_verified?: boolean | null
          status_message?: string | null
          target_datastore?: string | null
          total_bytes_synced?: number | null
          updated_at?: string | null
          vm_id?: string | null
          vm_name: string
          vm_vcenter_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_dataset_size?: number | null
          current_datastore?: string | null
          dr_shell_vm_created?: boolean | null
          dr_shell_vm_id?: string | null
          dr_shell_vm_name?: string | null
          failover_check_result?: Json | null
          failover_ready?: boolean | null
          failover_status?: string | null
          id?: string
          last_failover_at?: string | null
          last_failover_check?: string | null
          last_replication_at?: string | null
          last_snapshot_at?: string | null
          last_snapshot_name?: string | null
          last_sync_bytes?: number | null
          needs_storage_vmotion?: boolean | null
          priority?: number | null
          protection_group_id?: string
          replication_status?: string | null
          site_b_verified?: boolean | null
          status_message?: string | null
          target_datastore?: string | null
          total_bytes_synced?: number | null
          updated_at?: string | null
          vm_id?: string | null
          vm_name?: string
          vm_vcenter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protected_vms_protection_group_id_fkey"
            columns: ["protection_group_id"]
            isOneToOne: false
            referencedRelation: "protection_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protected_vms_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "vcenter_vms"
            referencedColumns: ["id"]
          },
        ]
      }
      protection_group_network_mappings: {
        Row: {
          created_at: string | null
          id: string
          is_test_network: boolean | null
          protection_group_id: string
          source_network: string
          target_network: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_test_network?: boolean | null
          protection_group_id: string
          source_network: string
          target_network: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_test_network?: boolean | null
          protection_group_id?: string
          source_network?: string
          target_network?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protection_group_network_mappings_protection_group_id_fkey"
            columns: ["protection_group_id"]
            isOneToOne: false
            referencedRelation: "protection_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      protection_groups: {
        Row: {
          active_failover_event_id: string | null
          boot_order: Json | null
          created_at: string | null
          created_by: string | null
          current_rpo_seconds: number | null
          description: string | null
          dr_dataset: string | null
          dr_datastore: string | null
          failover_status: string | null
          id: string
          is_enabled: boolean | null
          journal_history_hours: number | null
          last_failover_at: string | null
          last_failover_type: string | null
          last_replication_at: string | null
          last_test_at: string | null
          name: string
          next_replication_at: string | null
          next_scheduled_sync: string | null
          pause_reason: string | null
          paused_at: string | null
          priority: string | null
          protection_datastore: string | null
          replication_pair_id: string | null
          replication_schedule: string | null
          retention_policy: Json | null
          rpo_minutes: number | null
          source_vcenter_id: string | null
          status: string | null
          sync_in_progress: boolean | null
          target_id: string | null
          test_reminder_days: number | null
          updated_at: string | null
        }
        Insert: {
          active_failover_event_id?: string | null
          boot_order?: Json | null
          created_at?: string | null
          created_by?: string | null
          current_rpo_seconds?: number | null
          description?: string | null
          dr_dataset?: string | null
          dr_datastore?: string | null
          failover_status?: string | null
          id?: string
          is_enabled?: boolean | null
          journal_history_hours?: number | null
          last_failover_at?: string | null
          last_failover_type?: string | null
          last_replication_at?: string | null
          last_test_at?: string | null
          name: string
          next_replication_at?: string | null
          next_scheduled_sync?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          priority?: string | null
          protection_datastore?: string | null
          replication_pair_id?: string | null
          replication_schedule?: string | null
          retention_policy?: Json | null
          rpo_minutes?: number | null
          source_vcenter_id?: string | null
          status?: string | null
          sync_in_progress?: boolean | null
          target_id?: string | null
          test_reminder_days?: number | null
          updated_at?: string | null
        }
        Update: {
          active_failover_event_id?: string | null
          boot_order?: Json | null
          created_at?: string | null
          created_by?: string | null
          current_rpo_seconds?: number | null
          description?: string | null
          dr_dataset?: string | null
          dr_datastore?: string | null
          failover_status?: string | null
          id?: string
          is_enabled?: boolean | null
          journal_history_hours?: number | null
          last_failover_at?: string | null
          last_failover_type?: string | null
          last_replication_at?: string | null
          last_test_at?: string | null
          name?: string
          next_replication_at?: string | null
          next_scheduled_sync?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          priority?: string | null
          protection_datastore?: string | null
          replication_pair_id?: string | null
          replication_schedule?: string | null
          retention_policy?: Json | null
          rpo_minutes?: number | null
          source_vcenter_id?: string | null
          status?: string | null
          sync_in_progress?: boolean | null
          target_id?: string | null
          test_reminder_days?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protection_groups_active_failover_event_fkey"
            columns: ["active_failover_event_id"]
            isOneToOne: false
            referencedRelation: "failover_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protection_groups_replication_pair_id_fkey"
            columns: ["replication_pair_id"]
            isOneToOne: false
            referencedRelation: "replication_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protection_groups_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protection_groups_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "replication_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      replication_jobs: {
        Row: {
          bytes_transferred: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          details: Json | null
          error_message: string | null
          expected_bytes: number | null
          id: string
          incremental: boolean | null
          incremental_from: string | null
          job_type: string
          log: string | null
          protected_vm_id: string | null
          protection_group_id: string | null
          site_b_verified: boolean | null
          snapshot_name: string | null
          source_snapshot: string | null
          started_at: string | null
          status: string
          target_snapshot: string | null
          transfer_rate_mbps: number | null
          updated_at: string | null
          vm_sync_details: Json | null
        }
        Insert: {
          bytes_transferred?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          error_message?: string | null
          expected_bytes?: number | null
          id?: string
          incremental?: boolean | null
          incremental_from?: string | null
          job_type: string
          log?: string | null
          protected_vm_id?: string | null
          protection_group_id?: string | null
          site_b_verified?: boolean | null
          snapshot_name?: string | null
          source_snapshot?: string | null
          started_at?: string | null
          status?: string
          target_snapshot?: string | null
          transfer_rate_mbps?: number | null
          updated_at?: string | null
          vm_sync_details?: Json | null
        }
        Update: {
          bytes_transferred?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          error_message?: string | null
          expected_bytes?: number | null
          id?: string
          incremental?: boolean | null
          incremental_from?: string | null
          job_type?: string
          log?: string | null
          protected_vm_id?: string | null
          protection_group_id?: string | null
          site_b_verified?: boolean | null
          snapshot_name?: string | null
          source_snapshot?: string | null
          started_at?: string | null
          status?: string
          target_snapshot?: string | null
          transfer_rate_mbps?: number | null
          updated_at?: string | null
          vm_sync_details?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "replication_jobs_protected_vm_id_fkey"
            columns: ["protected_vm_id"]
            isOneToOne: false
            referencedRelation: "protected_vms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_jobs_protection_group_id_fkey"
            columns: ["protection_group_id"]
            isOneToOne: false
            referencedRelation: "protection_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      replication_metrics: {
        Row: {
          current_rpo_seconds: number | null
          id: string
          iops: number | null
          journal_used_bytes: number | null
          pending_bytes: number | null
          protection_group_id: string
          throughput_mbps: number | null
          timestamp: string | null
          wan_traffic_mbps: number | null
        }
        Insert: {
          current_rpo_seconds?: number | null
          id?: string
          iops?: number | null
          journal_used_bytes?: number | null
          pending_bytes?: number | null
          protection_group_id: string
          throughput_mbps?: number | null
          timestamp?: string | null
          wan_traffic_mbps?: number | null
        }
        Update: {
          current_rpo_seconds?: number | null
          id?: string
          iops?: number | null
          journal_used_bytes?: number | null
          pending_bytes?: number | null
          protection_group_id?: string
          throughput_mbps?: number | null
          timestamp?: string | null
          wan_traffic_mbps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "replication_metrics_protection_group_id_fkey"
            columns: ["protection_group_id"]
            isOneToOne: false
            referencedRelation: "protection_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      replication_pairs: {
        Row: {
          bytes_transferred_total: number | null
          connection_status: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          destination_dataset: string | null
          destination_target_id: string | null
          destination_vcenter_id: string | null
          id: string
          is_enabled: boolean | null
          last_connection_error: string | null
          last_connection_test: string | null
          name: string
          replication_method: string | null
          source_dataset: string | null
          source_target_id: string | null
          source_vcenter_id: string | null
          updated_at: string | null
          use_compression: boolean | null
          use_encryption: boolean | null
        }
        Insert: {
          bytes_transferred_total?: number | null
          connection_status?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          destination_dataset?: string | null
          destination_target_id?: string | null
          destination_vcenter_id?: string | null
          id?: string
          is_enabled?: boolean | null
          last_connection_error?: string | null
          last_connection_test?: string | null
          name: string
          replication_method?: string | null
          source_dataset?: string | null
          source_target_id?: string | null
          source_vcenter_id?: string | null
          updated_at?: string | null
          use_compression?: boolean | null
          use_encryption?: boolean | null
        }
        Update: {
          bytes_transferred_total?: number | null
          connection_status?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          destination_dataset?: string | null
          destination_target_id?: string | null
          destination_vcenter_id?: string | null
          id?: string
          is_enabled?: boolean | null
          last_connection_error?: string | null
          last_connection_test?: string | null
          name?: string
          replication_method?: string | null
          source_dataset?: string | null
          source_target_id?: string | null
          source_vcenter_id?: string | null
          updated_at?: string | null
          use_compression?: boolean | null
          use_encryption?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "replication_pairs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_pairs_destination_target_id_fkey"
            columns: ["destination_target_id"]
            isOneToOne: false
            referencedRelation: "replication_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_pairs_destination_vcenter_id_fkey"
            columns: ["destination_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_pairs_source_target_id_fkey"
            columns: ["source_target_id"]
            isOneToOne: false
            referencedRelation: "replication_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_pairs_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      replication_targets: {
        Row: {
          archived_at: string | null
          created_at: string | null
          created_by: string | null
          datastore_name: string | null
          deployed_ip_source: string | null
          deployed_job_id: string | null
          deployed_vm_moref: string | null
          description: string | null
          dr_vcenter_id: string | null
          health_status: string | null
          hosting_vm_id: string | null
          hostname: string
          id: string
          is_active: boolean | null
          last_health_check: string | null
          name: string
          nfs_export_path: string | null
          partner_target_id: string | null
          port: number | null
          site_location: string | null
          site_role: string | null
          source_template_id: string | null
          ssh_key_encrypted: string | null
          ssh_key_id: string | null
          ssh_trust_established: boolean | null
          ssh_username: string | null
          target_type: string
          updated_at: string | null
          zfs_dataset_prefix: string | null
          zfs_pool: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          datastore_name?: string | null
          deployed_ip_source?: string | null
          deployed_job_id?: string | null
          deployed_vm_moref?: string | null
          description?: string | null
          dr_vcenter_id?: string | null
          health_status?: string | null
          hosting_vm_id?: string | null
          hostname: string
          id?: string
          is_active?: boolean | null
          last_health_check?: string | null
          name: string
          nfs_export_path?: string | null
          partner_target_id?: string | null
          port?: number | null
          site_location?: string | null
          site_role?: string | null
          source_template_id?: string | null
          ssh_key_encrypted?: string | null
          ssh_key_id?: string | null
          ssh_trust_established?: boolean | null
          ssh_username?: string | null
          target_type?: string
          updated_at?: string | null
          zfs_dataset_prefix?: string | null
          zfs_pool: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          datastore_name?: string | null
          deployed_ip_source?: string | null
          deployed_job_id?: string | null
          deployed_vm_moref?: string | null
          description?: string | null
          dr_vcenter_id?: string | null
          health_status?: string | null
          hosting_vm_id?: string | null
          hostname?: string
          id?: string
          is_active?: boolean | null
          last_health_check?: string | null
          name?: string
          nfs_export_path?: string | null
          partner_target_id?: string | null
          port?: number | null
          site_location?: string | null
          site_role?: string | null
          source_template_id?: string | null
          ssh_key_encrypted?: string | null
          ssh_key_id?: string | null
          ssh_trust_established?: boolean | null
          ssh_username?: string | null
          target_type?: string
          updated_at?: string | null
          zfs_dataset_prefix?: string | null
          zfs_pool?: string
        }
        Relationships: [
          {
            foreignKeyName: "replication_targets_deployed_job_id_fkey"
            columns: ["deployed_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_targets_dr_vcenter_id_fkey"
            columns: ["dr_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_targets_hosting_vm_id_fkey"
            columns: ["hosting_vm_id"]
            isOneToOne: false
            referencedRelation: "vcenter_vms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_targets_partner_target_id_fkey"
            columns: ["partner_target_id"]
            isOneToOne: false
            referencedRelation: "replication_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_targets_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "zfs_target_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replication_targets_ssh_key_id_fkey"
            columns: ["ssh_key_id"]
            isOneToOne: false
            referencedRelation: "ssh_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_safety_checks: {
        Row: {
          check_all_clusters: boolean | null
          created_at: string | null
          enabled: boolean | null
          id: string
          last_run_at: string | null
          last_status: string | null
          min_required_hosts: number | null
          notify_on_safe_to_unsafe_change: boolean | null
          notify_on_unsafe: boolean | null
          notify_on_warnings: boolean | null
          schedule_cron: string | null
          specific_clusters: string[] | null
          updated_at: string | null
        }
        Insert: {
          check_all_clusters?: boolean | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_run_at?: string | null
          last_status?: string | null
          min_required_hosts?: number | null
          notify_on_safe_to_unsafe_change?: boolean | null
          notify_on_unsafe?: boolean | null
          notify_on_warnings?: boolean | null
          schedule_cron?: string | null
          specific_clusters?: string[] | null
          updated_at?: string | null
        }
        Update: {
          check_all_clusters?: boolean | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_run_at?: string | null
          last_status?: string | null
          min_required_hosts?: number | null
          notify_on_safe_to_unsafe_change?: boolean | null
          notify_on_unsafe?: boolean | null
          notify_on_warnings?: boolean | null
          schedule_cron?: string | null
          specific_clusters?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      scp_backups: {
        Row: {
          backup_name: string
          checksum: string | null
          components: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          export_job_id: string | null
          exported_at: string | null
          id: string
          import_job_id: string | null
          include_bios: boolean | null
          include_idrac: boolean | null
          include_nic: boolean | null
          include_raid: boolean | null
          is_valid: boolean | null
          last_imported_at: string | null
          scp_checksum: string | null
          scp_content: Json | null
          scp_file_path: string | null
          scp_file_size_bytes: number | null
          scp_format: string | null
          scp_raw_content: string | null
          server_id: string
          validation_errors: string | null
        }
        Insert: {
          backup_name: string
          checksum?: string | null
          components?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          export_job_id?: string | null
          exported_at?: string | null
          id?: string
          import_job_id?: string | null
          include_bios?: boolean | null
          include_idrac?: boolean | null
          include_nic?: boolean | null
          include_raid?: boolean | null
          is_valid?: boolean | null
          last_imported_at?: string | null
          scp_checksum?: string | null
          scp_content?: Json | null
          scp_file_path?: string | null
          scp_file_size_bytes?: number | null
          scp_format?: string | null
          scp_raw_content?: string | null
          server_id: string
          validation_errors?: string | null
        }
        Update: {
          backup_name?: string
          checksum?: string | null
          components?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          export_job_id?: string | null
          exported_at?: string | null
          id?: string
          import_job_id?: string | null
          include_bios?: boolean | null
          include_idrac?: boolean | null
          include_nic?: boolean | null
          include_raid?: boolean | null
          is_valid?: boolean | null
          last_imported_at?: string | null
          scp_checksum?: string | null
          scp_content?: Json | null
          scp_file_path?: string | null
          scp_file_size_bytes?: number | null
          scp_format?: string | null
          scp_raw_content?: string | null
          server_id?: string
          validation_errors?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scp_backups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scp_backups_export_job_id_fkey"
            columns: ["export_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scp_backups_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scp_backups_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_boot_config_history: {
        Row: {
          boot_mode: string | null
          boot_order: Json | null
          boot_source_override_enabled: string | null
          boot_source_override_target: string | null
          changed_by: string | null
          created_at: string
          id: string
          job_id: string | null
          server_id: string
          timestamp: string
        }
        Insert: {
          boot_mode?: string | null
          boot_order?: Json | null
          boot_source_override_enabled?: string | null
          boot_source_override_target?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          server_id: string
          timestamp?: string
        }
        Update: {
          boot_mode?: string | null
          boot_order?: Json | null
          boot_source_override_enabled?: string | null
          boot_source_override_target?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          server_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_boot_config_history_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_boot_config_history_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_drives: {
        Row: {
          capable_speed_gbps: number | null
          capacity_bytes: number | null
          capacity_gb: number | null
          controller: string | null
          created_at: string | null
          enclosure: string | null
          firmware_version: string | null
          health: string | null
          id: string
          last_sync: string | null
          life_remaining_percent: number | null
          manufacturer: string | null
          media_type: string | null
          model: string | null
          name: string | null
          part_number: string | null
          predicted_failure: boolean | null
          protocol: string | null
          rotation_speed_rpm: number | null
          serial_number: string | null
          server_id: string
          slot: string | null
          status: string | null
        }
        Insert: {
          capable_speed_gbps?: number | null
          capacity_bytes?: number | null
          capacity_gb?: number | null
          controller?: string | null
          created_at?: string | null
          enclosure?: string | null
          firmware_version?: string | null
          health?: string | null
          id?: string
          last_sync?: string | null
          life_remaining_percent?: number | null
          manufacturer?: string | null
          media_type?: string | null
          model?: string | null
          name?: string | null
          part_number?: string | null
          predicted_failure?: boolean | null
          protocol?: string | null
          rotation_speed_rpm?: number | null
          serial_number?: string | null
          server_id: string
          slot?: string | null
          status?: string | null
        }
        Update: {
          capable_speed_gbps?: number | null
          capacity_bytes?: number | null
          capacity_gb?: number | null
          controller?: string | null
          created_at?: string | null
          enclosure?: string | null
          firmware_version?: string | null
          health?: string | null
          id?: string
          last_sync?: string | null
          life_remaining_percent?: number | null
          manufacturer?: string | null
          media_type?: string | null
          model?: string | null
          name?: string | null
          part_number?: string | null
          predicted_failure?: boolean | null
          protocol?: string | null
          rotation_speed_rpm?: number | null
          serial_number?: string | null
          server_id?: string
          slot?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "server_drives_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_event_logs: {
        Row: {
          category: string | null
          created_at: string
          event_id: string | null
          id: string
          message: string | null
          raw_data: Json | null
          sensor_number: string | null
          sensor_type: string | null
          server_id: string
          severity: string | null
          timestamp: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          message?: string | null
          raw_data?: Json | null
          sensor_number?: string | null
          sensor_type?: string | null
          server_id: string
          severity?: string | null
          timestamp: string
        }
        Update: {
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          message?: string | null
          raw_data?: Json | null
          sensor_number?: string | null
          sensor_type?: string | null
          server_id?: string
          severity?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_event_logs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_firmware_inventory: {
        Row: {
          collected_at: string
          component_category: string | null
          component_id: string
          component_name: string
          component_type: string | null
          created_at: string
          device_id: string | null
          id: string
          job_id: string | null
          server_id: string
          status: string | null
          updateable: boolean | null
          version: string
        }
        Insert: {
          collected_at?: string
          component_category?: string | null
          component_id: string
          component_name: string
          component_type?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          job_id?: string | null
          server_id: string
          status?: string | null
          updateable?: boolean | null
          version: string
        }
        Update: {
          collected_at?: string
          component_category?: string | null
          component_id?: string
          component_name?: string
          component_type?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          job_id?: string | null
          server_id?: string
          status?: string | null
          updateable?: boolean | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_firmware_inventory_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_firmware_inventory_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_group_members: {
        Row: {
          added_at: string | null
          id: string
          priority: number | null
          role: string | null
          server_group_id: string | null
          server_id: string | null
        }
        Insert: {
          added_at?: string | null
          id?: string
          priority?: number | null
          role?: string | null
          server_group_id?: string | null
          server_id?: string | null
        }
        Update: {
          added_at?: string | null
          id?: string
          priority?: number | null
          role?: string | null
          server_group_id?: string | null
          server_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "server_group_members_server_group_id_fkey"
            columns: ["server_group_id"]
            isOneToOne: false
            referencedRelation: "server_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_group_members_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_group_safety_checks: {
        Row: {
          check_timestamp: string | null
          created_at: string | null
          details: Json | null
          healthy_servers: number
          id: string
          is_scheduled: boolean | null
          job_id: string | null
          min_required_servers: number
          previous_status: string | null
          safe_to_proceed: boolean
          scheduled_check_id: string | null
          server_group_id: string | null
          status_changed: boolean | null
          total_servers: number
          warnings: string[] | null
        }
        Insert: {
          check_timestamp?: string | null
          created_at?: string | null
          details?: Json | null
          healthy_servers: number
          id?: string
          is_scheduled?: boolean | null
          job_id?: string | null
          min_required_servers: number
          previous_status?: string | null
          safe_to_proceed: boolean
          scheduled_check_id?: string | null
          server_group_id?: string | null
          status_changed?: boolean | null
          total_servers: number
          warnings?: string[] | null
        }
        Update: {
          check_timestamp?: string | null
          created_at?: string | null
          details?: Json | null
          healthy_servers?: number
          id?: string
          is_scheduled?: boolean | null
          job_id?: string | null
          min_required_servers?: number
          previous_status?: string | null
          safe_to_proceed?: boolean
          scheduled_check_id?: string | null
          server_group_id?: string | null
          status_changed?: boolean | null
          total_servers?: number
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "server_group_safety_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_group_safety_checks_scheduled_check_id_fkey"
            columns: ["scheduled_check_id"]
            isOneToOne: false
            referencedRelation: "scheduled_safety_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_group_safety_checks_server_group_id_fkey"
            columns: ["server_group_id"]
            isOneToOne: false
            referencedRelation: "server_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      server_groups: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          group_type: string
          icon: string | null
          id: string
          min_healthy_servers: number | null
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          group_type?: string
          icon?: string | null
          id?: string
          min_healthy_servers?: number | null
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          group_type?: string
          icon?: string | null
          id?: string
          min_healthy_servers?: number | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "server_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      server_health: {
        Row: {
          cpu_health: string | null
          created_at: string
          fan_health: string | null
          id: string
          memory_health: string | null
          network_health: string | null
          overall_health: string | null
          power_state: string | null
          psu_health: string | null
          sensors: Json | null
          server_id: string
          storage_health: string | null
          temperature_celsius: number | null
          timestamp: string
        }
        Insert: {
          cpu_health?: string | null
          created_at?: string
          fan_health?: string | null
          id?: string
          memory_health?: string | null
          network_health?: string | null
          overall_health?: string | null
          power_state?: string | null
          psu_health?: string | null
          sensors?: Json | null
          server_id: string
          storage_health?: string | null
          temperature_celsius?: number | null
          timestamp?: string
        }
        Update: {
          cpu_health?: string | null
          created_at?: string
          fan_health?: string | null
          id?: string
          memory_health?: string | null
          network_health?: string | null
          overall_health?: string | null
          power_state?: string | null
          psu_health?: string | null
          sensors?: Json | null
          server_id?: string
          storage_health?: string | null
          temperature_celsius?: number | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_health_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_nics: {
        Row: {
          auto_negotiate: boolean | null
          created_at: string | null
          current_speed_mbps: number | null
          description: string | null
          duplex: string | null
          firmware_version: string | null
          fqdd: string
          health: string | null
          id: string
          ipv4_addresses: Json | null
          ipv6_addresses: Json | null
          last_sync: string | null
          link_status: string | null
          mac_address: string | null
          manufacturer: string | null
          max_speed_mbps: number | null
          model: string | null
          mtu: number | null
          name: string | null
          part_number: string | null
          permanent_mac_address: string | null
          port_id: string | null
          serial_number: string | null
          server_id: string
          status: string | null
          switch_connection_id: string | null
          switch_name: string | null
          switch_port_description: string | null
          updated_at: string | null
          vlan_id: number | null
        }
        Insert: {
          auto_negotiate?: boolean | null
          created_at?: string | null
          current_speed_mbps?: number | null
          description?: string | null
          duplex?: string | null
          firmware_version?: string | null
          fqdd: string
          health?: string | null
          id?: string
          ipv4_addresses?: Json | null
          ipv6_addresses?: Json | null
          last_sync?: string | null
          link_status?: string | null
          mac_address?: string | null
          manufacturer?: string | null
          max_speed_mbps?: number | null
          model?: string | null
          mtu?: number | null
          name?: string | null
          part_number?: string | null
          permanent_mac_address?: string | null
          port_id?: string | null
          serial_number?: string | null
          server_id: string
          status?: string | null
          switch_connection_id?: string | null
          switch_name?: string | null
          switch_port_description?: string | null
          updated_at?: string | null
          vlan_id?: number | null
        }
        Update: {
          auto_negotiate?: boolean | null
          created_at?: string | null
          current_speed_mbps?: number | null
          description?: string | null
          duplex?: string | null
          firmware_version?: string | null
          fqdd?: string
          health?: string | null
          id?: string
          ipv4_addresses?: Json | null
          ipv6_addresses?: Json | null
          last_sync?: string | null
          link_status?: string | null
          mac_address?: string | null
          manufacturer?: string | null
          max_speed_mbps?: number | null
          model?: string | null
          mtu?: number | null
          name?: string | null
          part_number?: string | null
          permanent_mac_address?: string | null
          port_id?: string | null
          serial_number?: string | null
          server_id?: string
          status?: string | null
          switch_connection_id?: string | null
          switch_name?: string | null
          switch_port_description?: string | null
          updated_at?: string | null
          vlan_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "server_nics_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      servers: {
        Row: {
          bios_version: string | null
          boot_mode: string | null
          boot_order: Json | null
          boot_source_override_enabled: string | null
          boot_source_override_target: string | null
          connection_error: string | null
          connection_status: string | null
          cpu_cores_per_socket: number | null
          cpu_count: number | null
          cpu_model: string | null
          cpu_speed: string | null
          created_at: string
          credential_last_tested: string | null
          credential_set_id: string | null
          credential_test_status: string | null
          discovered_by_credential_set_id: string | null
          discovery_job_id: string | null
          hostname: string | null
          id: string
          idrac_firmware: string | null
          idrac_password_encrypted: string | null
          idrac_username: string | null
          ip_address: string
          last_boot_config_check: string | null
          last_connection_test: string | null
          last_health_check: string | null
          last_openmanage_sync: string | null
          last_seen: string | null
          manager_mac_address: string | null
          manufacturer: string | null
          memory_gb: number | null
          model: string | null
          notes: string | null
          openmanage_device_id: string | null
          overall_health: string | null
          power_state: string | null
          product_name: string | null
          redfish_version: string | null
          secure_boot: string | null
          service_tag: string | null
          supported_endpoints: Json | null
          total_drives: number | null
          total_storage_tb: number | null
          updated_at: string
          vcenter_host_id: string | null
          virtualization_enabled: boolean | null
        }
        Insert: {
          bios_version?: string | null
          boot_mode?: string | null
          boot_order?: Json | null
          boot_source_override_enabled?: string | null
          boot_source_override_target?: string | null
          connection_error?: string | null
          connection_status?: string | null
          cpu_cores_per_socket?: number | null
          cpu_count?: number | null
          cpu_model?: string | null
          cpu_speed?: string | null
          created_at?: string
          credential_last_tested?: string | null
          credential_set_id?: string | null
          credential_test_status?: string | null
          discovered_by_credential_set_id?: string | null
          discovery_job_id?: string | null
          hostname?: string | null
          id?: string
          idrac_firmware?: string | null
          idrac_password_encrypted?: string | null
          idrac_username?: string | null
          ip_address: string
          last_boot_config_check?: string | null
          last_connection_test?: string | null
          last_health_check?: string | null
          last_openmanage_sync?: string | null
          last_seen?: string | null
          manager_mac_address?: string | null
          manufacturer?: string | null
          memory_gb?: number | null
          model?: string | null
          notes?: string | null
          openmanage_device_id?: string | null
          overall_health?: string | null
          power_state?: string | null
          product_name?: string | null
          redfish_version?: string | null
          secure_boot?: string | null
          service_tag?: string | null
          supported_endpoints?: Json | null
          total_drives?: number | null
          total_storage_tb?: number | null
          updated_at?: string
          vcenter_host_id?: string | null
          virtualization_enabled?: boolean | null
        }
        Update: {
          bios_version?: string | null
          boot_mode?: string | null
          boot_order?: Json | null
          boot_source_override_enabled?: string | null
          boot_source_override_target?: string | null
          connection_error?: string | null
          connection_status?: string | null
          cpu_cores_per_socket?: number | null
          cpu_count?: number | null
          cpu_model?: string | null
          cpu_speed?: string | null
          created_at?: string
          credential_last_tested?: string | null
          credential_set_id?: string | null
          credential_test_status?: string | null
          discovered_by_credential_set_id?: string | null
          discovery_job_id?: string | null
          hostname?: string | null
          id?: string
          idrac_firmware?: string | null
          idrac_password_encrypted?: string | null
          idrac_username?: string | null
          ip_address?: string
          last_boot_config_check?: string | null
          last_connection_test?: string | null
          last_health_check?: string | null
          last_openmanage_sync?: string | null
          last_seen?: string | null
          manager_mac_address?: string | null
          manufacturer?: string | null
          memory_gb?: number | null
          model?: string | null
          notes?: string | null
          openmanage_device_id?: string | null
          overall_health?: string | null
          power_state?: string | null
          product_name?: string | null
          redfish_version?: string | null
          secure_boot?: string | null
          service_tag?: string | null
          supported_endpoints?: Json | null
          total_drives?: number | null
          total_storage_tb?: number | null
          updated_at?: string
          vcenter_host_id?: string | null
          virtualization_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_servers_vcenter_host"
            columns: ["vcenter_host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servers_credential_set_id_fkey"
            columns: ["credential_set_id"]
            isOneToOne: false
            referencedRelation: "credential_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servers_discovered_by_credential_set_id_fkey"
            columns: ["discovered_by_credential_set_id"]
            isOneToOne: false
            referencedRelation: "credential_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servers_discovery_job_id_fkey"
            columns: ["discovery_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_violations: {
        Row: {
          created_at: string | null
          details: Json | null
          detected_at: string | null
          id: string
          notification_sent: boolean | null
          protection_group_id: string | null
          resolved_at: string | null
          severity: string | null
          violation_type: string
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          detected_at?: string | null
          id?: string
          notification_sent?: boolean | null
          protection_group_id?: string | null
          resolved_at?: string | null
          severity?: string | null
          violation_type: string
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          detected_at?: string | null
          id?: string
          notification_sent?: boolean | null
          protection_group_id?: string | null
          resolved_at?: string | null
          severity?: string | null
          violation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_violations_protection_group_id_fkey"
            columns: ["protection_group_id"]
            isOneToOne: false
            referencedRelation: "protection_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ssh_key_deployments: {
        Row: {
          created_at: string
          deployed_at: string | null
          id: string
          last_error: string | null
          removed_at: string | null
          replication_target_id: string | null
          retry_count: number | null
          ssh_key_id: string
          status: string
          updated_at: string
          verified_at: string | null
          zfs_template_id: string | null
        }
        Insert: {
          created_at?: string
          deployed_at?: string | null
          id?: string
          last_error?: string | null
          removed_at?: string | null
          replication_target_id?: string | null
          retry_count?: number | null
          ssh_key_id: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          zfs_template_id?: string | null
        }
        Update: {
          created_at?: string
          deployed_at?: string | null
          id?: string
          last_error?: string | null
          removed_at?: string | null
          replication_target_id?: string | null
          retry_count?: number | null
          ssh_key_id?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          zfs_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ssh_key_deployments_replication_target_id_fkey"
            columns: ["replication_target_id"]
            isOneToOne: false
            referencedRelation: "replication_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ssh_key_deployments_ssh_key_id_fkey"
            columns: ["ssh_key_id"]
            isOneToOne: false
            referencedRelation: "ssh_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ssh_key_deployments_zfs_template_id_fkey"
            columns: ["zfs_template_id"]
            isOneToOne: false
            referencedRelation: "zfs_target_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ssh_keys: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          key_algorithm: string | null
          key_type: string
          last_used_at: string | null
          name: string
          private_key_encrypted: string
          public_key: string
          public_key_fingerprint: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          updated_at: string
          use_count: number | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          key_algorithm?: string | null
          key_type?: string
          last_used_at?: string | null
          name: string
          private_key_encrypted: string
          public_key: string
          public_key_fingerprint: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
          use_count?: number | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          key_algorithm?: string | null
          key_type?: string
          last_used_at?: string | null
          name?: string
          private_key_encrypted?: string
          public_key?: string
          public_key_fingerprint?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ssh_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ssh_keys_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      update_availability_results: {
        Row: {
          blockers: Json | null
          created_at: string | null
          critical_updates: number | null
          esxi_target_version: string | null
          esxi_update_available: boolean | null
          esxi_version: string | null
          firmware_components: Json | null
          hostname: string | null
          id: string
          not_in_catalog: number | null
          scan_id: string
          scan_status: string | null
          scanned_at: string | null
          server_id: string | null
          server_model: string | null
          service_tag: string | null
          total_components: number | null
          up_to_date: number | null
          updates_available: number | null
          vcenter_host_id: string | null
        }
        Insert: {
          blockers?: Json | null
          created_at?: string | null
          critical_updates?: number | null
          esxi_target_version?: string | null
          esxi_update_available?: boolean | null
          esxi_version?: string | null
          firmware_components?: Json | null
          hostname?: string | null
          id?: string
          not_in_catalog?: number | null
          scan_id: string
          scan_status?: string | null
          scanned_at?: string | null
          server_id?: string | null
          server_model?: string | null
          service_tag?: string | null
          total_components?: number | null
          up_to_date?: number | null
          updates_available?: number | null
          vcenter_host_id?: string | null
        }
        Update: {
          blockers?: Json | null
          created_at?: string | null
          critical_updates?: number | null
          esxi_target_version?: string | null
          esxi_update_available?: boolean | null
          esxi_version?: string | null
          firmware_components?: Json | null
          hostname?: string | null
          id?: string
          not_in_catalog?: number | null
          scan_id?: string
          scan_status?: string | null
          scanned_at?: string | null
          server_id?: string | null
          server_model?: string | null
          service_tag?: string | null
          total_components?: number | null
          up_to_date?: number | null
          updates_available?: number | null
          vcenter_host_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "update_availability_results_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "update_availability_scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_availability_results_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "update_availability_results_vcenter_host_id_fkey"
            columns: ["vcenter_host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      update_availability_scans: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          firmware_source: string
          id: string
          scan_type: string
          started_at: string | null
          status: string
          summary: Json | null
          target_id: string | null
          target_name: string | null
          target_server_ids: string[] | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          firmware_source: string
          id?: string
          scan_type: string
          started_at?: string | null
          status?: string
          summary?: Json | null
          target_id?: string | null
          target_name?: string | null
          target_server_ids?: string[] | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          firmware_source?: string
          id?: string
          scan_type?: string
          started_at?: string | null
          status?: string
          summary?: Json | null
          target_id?: string | null
          target_name?: string | null
          target_server_ids?: string[] | null
        }
        Relationships: []
      }
      user_activity: {
        Row: {
          activity_type: string
          created_at: string
          details: Json | null
          duration_ms: number | null
          error_message: string | null
          id: string
          success: boolean | null
          target_id: string | null
          target_name: string | null
          target_type: string | null
          timestamp: string
          user_id: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          success?: boolean | null
          target_id?: string | null
          target_name?: string | null
          target_type?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          success?: boolean | null
          target_id?: string | null
          target_name?: string | null
          target_type?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_alarms: {
        Row: {
          acknowledged: boolean | null
          alarm_key: string
          alarm_name: string | null
          alarm_status: string | null
          created_at: string | null
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
          id: string
          source_vcenter_id: string | null
          triggered_at: string | null
          updated_at: string | null
        }
        Insert: {
          acknowledged?: boolean | null
          alarm_key: string
          alarm_name?: string | null
          alarm_status?: string | null
          created_at?: string | null
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          source_vcenter_id?: string | null
          triggered_at?: string | null
          updated_at?: string | null
        }
        Update: {
          acknowledged?: boolean | null
          alarm_key?: string
          alarm_name?: string | null
          alarm_status?: string | null
          created_at?: string | null
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          source_vcenter_id?: string | null
          triggered_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_alarms_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_clusters: {
        Row: {
          cluster_name: string
          created_at: string | null
          drs_automation_level: string | null
          drs_enabled: boolean | null
          ha_enabled: boolean | null
          host_count: number | null
          id: string
          last_sync: string | null
          overall_status: string | null
          source_vcenter_id: string | null
          total_cpu_mhz: number | null
          total_memory_bytes: number | null
          total_storage_bytes: number | null
          updated_at: string | null
          used_cpu_mhz: number | null
          used_memory_bytes: number | null
          used_storage_bytes: number | null
          vcenter_id: string | null
          vm_count: number | null
        }
        Insert: {
          cluster_name: string
          created_at?: string | null
          drs_automation_level?: string | null
          drs_enabled?: boolean | null
          ha_enabled?: boolean | null
          host_count?: number | null
          id?: string
          last_sync?: string | null
          overall_status?: string | null
          source_vcenter_id?: string | null
          total_cpu_mhz?: number | null
          total_memory_bytes?: number | null
          total_storage_bytes?: number | null
          updated_at?: string | null
          used_cpu_mhz?: number | null
          used_memory_bytes?: number | null
          used_storage_bytes?: number | null
          vcenter_id?: string | null
          vm_count?: number | null
        }
        Update: {
          cluster_name?: string
          created_at?: string | null
          drs_automation_level?: string | null
          drs_enabled?: boolean | null
          ha_enabled?: boolean | null
          host_count?: number | null
          id?: string
          last_sync?: string | null
          overall_status?: string | null
          source_vcenter_id?: string | null
          total_cpu_mhz?: number | null
          total_memory_bytes?: number | null
          total_storage_bytes?: number | null
          updated_at?: string | null
          used_cpu_mhz?: number | null
          used_memory_bytes?: number | null
          used_storage_bytes?: number | null
          vcenter_id?: string | null
          vm_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_clusters_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_datastore_hosts: {
        Row: {
          accessible: boolean | null
          created_at: string | null
          datastore_id: string
          host_id: string
          id: string
          last_sync: string | null
          mount_path: string | null
          read_only: boolean | null
          source_vcenter_id: string | null
        }
        Insert: {
          accessible?: boolean | null
          created_at?: string | null
          datastore_id: string
          host_id: string
          id?: string
          last_sync?: string | null
          mount_path?: string | null
          read_only?: boolean | null
          source_vcenter_id?: string | null
        }
        Update: {
          accessible?: boolean | null
          created_at?: string | null
          datastore_id?: string
          host_id?: string
          id?: string
          last_sync?: string | null
          mount_path?: string | null
          read_only?: boolean | null
          source_vcenter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_datastore_hosts_datastore_id_fkey"
            columns: ["datastore_id"]
            isOneToOne: false
            referencedRelation: "vcenter_datastores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_datastore_hosts_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_datastore_hosts_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_datastore_vms: {
        Row: {
          committed_bytes: number | null
          created_at: string | null
          datastore_id: string
          id: string
          is_primary_datastore: boolean | null
          last_sync: string | null
          source_vcenter_id: string | null
          uncommitted_bytes: number | null
          vm_id: string
        }
        Insert: {
          committed_bytes?: number | null
          created_at?: string | null
          datastore_id: string
          id?: string
          is_primary_datastore?: boolean | null
          last_sync?: string | null
          source_vcenter_id?: string | null
          uncommitted_bytes?: number | null
          vm_id: string
        }
        Update: {
          committed_bytes?: number | null
          created_at?: string | null
          datastore_id?: string
          id?: string
          is_primary_datastore?: boolean | null
          last_sync?: string | null
          source_vcenter_id?: string | null
          uncommitted_bytes?: number | null
          vm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_datastore_vms_datastore_id_fkey"
            columns: ["datastore_id"]
            isOneToOne: false
            referencedRelation: "vcenter_datastores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_datastore_vms_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_datastore_vms_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "vcenter_vms"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_datastores: {
        Row: {
          accessible: boolean | null
          capacity_bytes: number | null
          created_at: string | null
          free_bytes: number | null
          host_count: number | null
          id: string
          last_sync: string | null
          maintenance_mode: string | null
          name: string
          replication_target_id: string | null
          source_vcenter_id: string | null
          type: string | null
          updated_at: string | null
          vcenter_id: string | null
          vm_count: number | null
        }
        Insert: {
          accessible?: boolean | null
          capacity_bytes?: number | null
          created_at?: string | null
          free_bytes?: number | null
          host_count?: number | null
          id?: string
          last_sync?: string | null
          maintenance_mode?: string | null
          name: string
          replication_target_id?: string | null
          source_vcenter_id?: string | null
          type?: string | null
          updated_at?: string | null
          vcenter_id?: string | null
          vm_count?: number | null
        }
        Update: {
          accessible?: boolean | null
          capacity_bytes?: number | null
          created_at?: string | null
          free_bytes?: number | null
          host_count?: number | null
          id?: string
          last_sync?: string | null
          maintenance_mode?: string | null
          name?: string
          replication_target_id?: string | null
          source_vcenter_id?: string | null
          type?: string | null
          updated_at?: string | null
          vcenter_id?: string | null
          vm_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_datastores_replication_target_id_fkey"
            columns: ["replication_target_id"]
            isOneToOne: false
            referencedRelation: "replication_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_datastores_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_hosts: {
        Row: {
          cluster: string | null
          cpu_usage_mhz: number | null
          created_at: string
          esxi_version: string | null
          id: string
          last_sync: string | null
          maintenance_mode: boolean | null
          memory_size: number | null
          memory_usage_mb: number | null
          name: string
          serial_number: string | null
          server_id: string | null
          source_vcenter_id: string | null
          status: string | null
          updated_at: string
          uptime_seconds: number | null
          vcenter_id: string | null
        }
        Insert: {
          cluster?: string | null
          cpu_usage_mhz?: number | null
          created_at?: string
          esxi_version?: string | null
          id?: string
          last_sync?: string | null
          maintenance_mode?: boolean | null
          memory_size?: number | null
          memory_usage_mb?: number | null
          name: string
          serial_number?: string | null
          server_id?: string | null
          source_vcenter_id?: string | null
          status?: string | null
          updated_at?: string
          uptime_seconds?: number | null
          vcenter_id?: string | null
        }
        Update: {
          cluster?: string | null
          cpu_usage_mhz?: number | null
          created_at?: string
          esxi_version?: string | null
          id?: string
          last_sync?: string | null
          maintenance_mode?: boolean | null
          memory_size?: number | null
          memory_usage_mb?: number | null
          name?: string
          serial_number?: string | null
          server_id?: string | null
          source_vcenter_id?: string | null
          status?: string | null
          updated_at?: string
          uptime_seconds?: number | null
          vcenter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_hosts_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_hosts_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_network_vms: {
        Row: {
          adapter_type: string | null
          connected: boolean | null
          created_at: string | null
          id: string
          ip_addresses: string[] | null
          last_sync: string | null
          mac_address: string | null
          network_id: string
          nic_label: string | null
          source_vcenter_id: string | null
          vm_id: string
        }
        Insert: {
          adapter_type?: string | null
          connected?: boolean | null
          created_at?: string | null
          id?: string
          ip_addresses?: string[] | null
          last_sync?: string | null
          mac_address?: string | null
          network_id: string
          nic_label?: string | null
          source_vcenter_id?: string | null
          vm_id: string
        }
        Update: {
          adapter_type?: string | null
          connected?: boolean | null
          created_at?: string | null
          id?: string
          ip_addresses?: string[] | null
          last_sync?: string | null
          mac_address?: string | null
          network_id?: string
          nic_label?: string | null
          source_vcenter_id?: string | null
          vm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_network_vms_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "vcenter_networks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_network_vms_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_network_vms_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "vcenter_vms"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_networks: {
        Row: {
          accessible: boolean | null
          created_at: string | null
          host_count: number | null
          id: string
          last_sync: string | null
          name: string
          network_type: string | null
          parent_switch_id: string | null
          parent_switch_name: string | null
          source_vcenter_id: string | null
          updated_at: string | null
          uplink_port_group: boolean | null
          vcenter_id: string | null
          vlan_id: number | null
          vlan_range: string | null
          vlan_type: string | null
          vm_count: number | null
        }
        Insert: {
          accessible?: boolean | null
          created_at?: string | null
          host_count?: number | null
          id?: string
          last_sync?: string | null
          name: string
          network_type?: string | null
          parent_switch_id?: string | null
          parent_switch_name?: string | null
          source_vcenter_id?: string | null
          updated_at?: string | null
          uplink_port_group?: boolean | null
          vcenter_id?: string | null
          vlan_id?: number | null
          vlan_range?: string | null
          vlan_type?: string | null
          vm_count?: number | null
        }
        Update: {
          accessible?: boolean | null
          created_at?: string | null
          host_count?: number | null
          id?: string
          last_sync?: string | null
          name?: string
          network_type?: string | null
          parent_switch_id?: string | null
          parent_switch_name?: string | null
          source_vcenter_id?: string | null
          updated_at?: string | null
          uplink_port_group?: boolean | null
          vcenter_id?: string | null
          vlan_id?: number | null
          vlan_range?: string | null
          vlan_type?: string | null
          vm_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_networks_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_settings: {
        Row: {
          created_at: string
          host: string
          id: string
          last_sync: string | null
          password: string | null
          port: number
          sync_enabled: boolean
          updated_at: string
          username: string
          verify_ssl: boolean
        }
        Insert: {
          created_at?: string
          host: string
          id?: string
          last_sync?: string | null
          password?: string | null
          port?: number
          sync_enabled?: boolean
          updated_at?: string
          username: string
          verify_ssl?: boolean
        }
        Update: {
          created_at?: string
          host?: string
          id?: string
          last_sync?: string | null
          password?: string | null
          port?: number
          sync_enabled?: boolean
          updated_at?: string
          username?: string
          verify_ssl?: boolean
        }
        Relationships: []
      }
      vcenter_vm_custom_attributes: {
        Row: {
          attribute_key: string
          attribute_value: string | null
          id: string
          last_sync: string | null
          source_vcenter_id: string | null
          vm_id: string
        }
        Insert: {
          attribute_key: string
          attribute_value?: string | null
          id?: string
          last_sync?: string | null
          source_vcenter_id?: string | null
          vm_id: string
        }
        Update: {
          attribute_key?: string
          attribute_value?: string | null
          id?: string
          last_sync?: string | null
          source_vcenter_id?: string | null
          vm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_vm_custom_attributes_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_vm_custom_attributes_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "vcenter_vms"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_vm_snapshots: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_current: boolean | null
          last_sync: string | null
          name: string
          parent_snapshot_id: string | null
          size_bytes: number | null
          snapshot_id: string
          source_vcenter_id: string | null
          vm_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_current?: boolean | null
          last_sync?: string | null
          name: string
          parent_snapshot_id?: string | null
          size_bytes?: number | null
          snapshot_id: string
          source_vcenter_id?: string | null
          vm_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_current?: boolean | null
          last_sync?: string | null
          name?: string
          parent_snapshot_id?: string | null
          size_bytes?: number | null
          snapshot_id?: string
          source_vcenter_id?: string | null
          vm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_vm_snapshots_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_vm_snapshots_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "vcenter_vms"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenter_vms: {
        Row: {
          cluster_name: string | null
          cpu_count: number | null
          created_at: string | null
          disk_gb: number | null
          folder_path: string | null
          guest_os: string | null
          hardware_version: string | null
          host_id: string | null
          id: string
          ip_address: string | null
          is_template: boolean | null
          last_sync: string | null
          memory_mb: number | null
          name: string
          notes: string | null
          overall_status: string | null
          power_state: string | null
          resource_pool: string | null
          snapshot_count: number | null
          source_vcenter_id: string | null
          tools_status: string | null
          tools_version: string | null
          updated_at: string | null
          vcenter_id: string | null
        }
        Insert: {
          cluster_name?: string | null
          cpu_count?: number | null
          created_at?: string | null
          disk_gb?: number | null
          folder_path?: string | null
          guest_os?: string | null
          hardware_version?: string | null
          host_id?: string | null
          id?: string
          ip_address?: string | null
          is_template?: boolean | null
          last_sync?: string | null
          memory_mb?: number | null
          name: string
          notes?: string | null
          overall_status?: string | null
          power_state?: string | null
          resource_pool?: string | null
          snapshot_count?: number | null
          source_vcenter_id?: string | null
          tools_status?: string | null
          tools_version?: string | null
          updated_at?: string | null
          vcenter_id?: string | null
        }
        Update: {
          cluster_name?: string | null
          cpu_count?: number | null
          created_at?: string | null
          disk_gb?: number | null
          folder_path?: string | null
          guest_os?: string | null
          hardware_version?: string | null
          host_id?: string | null
          id?: string
          ip_address?: string | null
          is_template?: boolean | null
          last_sync?: string | null
          memory_mb?: number | null
          name?: string
          notes?: string | null
          overall_status?: string | null
          power_state?: string | null
          resource_pool?: string | null
          snapshot_count?: number | null
          source_vcenter_id?: string | null
          tools_status?: string | null
          tools_version?: string | null
          updated_at?: string | null
          vcenter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenter_vms_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vcenter_vms_source_vcenter_id_fkey"
            columns: ["source_vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
      vcenters: {
        Row: {
          color: string | null
          created_at: string
          datacenter_location: string | null
          default_zfs_template_id: string | null
          host: string
          id: string
          is_primary: boolean | null
          last_sync: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          name: string
          next_sync_at: string | null
          password_encrypted: string | null
          port: number
          site_code: string | null
          sync_enabled: boolean
          sync_interval_minutes: number | null
          updated_at: string
          username: string
          verify_ssl: boolean
          vm_prefix: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          datacenter_location?: string | null
          default_zfs_template_id?: string | null
          host: string
          id?: string
          is_primary?: boolean | null
          last_sync?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          name: string
          next_sync_at?: string | null
          password_encrypted?: string | null
          port?: number
          site_code?: string | null
          sync_enabled?: boolean
          sync_interval_minutes?: number | null
          updated_at?: string
          username: string
          verify_ssl?: boolean
          vm_prefix?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          datacenter_location?: string | null
          default_zfs_template_id?: string | null
          host?: string
          id?: string
          is_primary?: boolean | null
          last_sync?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          name?: string
          next_sync_at?: string | null
          password_encrypted?: string | null
          port?: number
          site_code?: string | null
          sync_enabled?: boolean
          sync_interval_minutes?: number | null
          updated_at?: string
          username?: string
          verify_ssl?: boolean
          vm_prefix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vcenters_default_zfs_template_id_fkey"
            columns: ["default_zfs_template_id"]
            isOneToOne: false
            referencedRelation: "zfs_target_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      virtual_media_sessions: {
        Row: {
          created_at: string | null
          id: string
          image_name: string
          inserted: boolean | null
          is_mounted: boolean | null
          media_type: string
          mount_job_id: string | null
          mounted_at: string | null
          remote_image_url: string
          server_id: string
          share_password_encrypted: string | null
          share_username: string | null
          unmount_job_id: string | null
          unmounted_at: string | null
          updated_at: string | null
          write_protected: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_name: string
          inserted?: boolean | null
          is_mounted?: boolean | null
          media_type: string
          mount_job_id?: string | null
          mounted_at?: string | null
          remote_image_url: string
          server_id: string
          share_password_encrypted?: string | null
          share_username?: string | null
          unmount_job_id?: string | null
          unmounted_at?: string | null
          updated_at?: string | null
          write_protected?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_name?: string
          inserted?: boolean | null
          is_mounted?: boolean | null
          media_type?: string
          mount_job_id?: string | null
          mounted_at?: string | null
          remote_image_url?: string
          server_id?: string
          share_password_encrypted?: string | null
          share_username?: string | null
          unmount_job_id?: string | null
          unmounted_at?: string | null
          updated_at?: string | null
          write_protected?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "virtual_media_sessions_mount_job_id_fkey"
            columns: ["mount_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "virtual_media_sessions_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "virtual_media_sessions_unmount_job_id_fkey"
            columns: ["unmount_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      virtual_media_settings: {
        Row: {
          created_at: string
          export_path: string | null
          host: string
          id: string
          iso_path: string | null
          notes: string | null
          password: string | null
          share_type: string
          updated_at: string
          use_auth: boolean
          username: string | null
        }
        Insert: {
          created_at?: string
          export_path?: string | null
          host: string
          id?: string
          iso_path?: string | null
          notes?: string | null
          password?: string | null
          share_type?: string
          updated_at?: string
          use_auth?: boolean
          username?: string | null
        }
        Update: {
          created_at?: string
          export_path?: string | null
          host?: string
          id?: string
          iso_path?: string | null
          notes?: string | null
          password?: string | null
          share_type?: string
          updated_at?: string
          use_auth?: boolean
          username?: string | null
        }
        Relationships: []
      }
      workflow_executions: {
        Row: {
          cluster_id: string | null
          created_at: string | null
          host_id: string | null
          id: string
          job_id: string
          server_id: string | null
          step_completed_at: string | null
          step_details: Json | null
          step_error: string | null
          step_name: string
          step_number: number
          step_started_at: string | null
          step_status: string
          workflow_type: string
        }
        Insert: {
          cluster_id?: string | null
          created_at?: string | null
          host_id?: string | null
          id?: string
          job_id: string
          server_id?: string | null
          step_completed_at?: string | null
          step_details?: Json | null
          step_error?: string | null
          step_name: string
          step_number: number
          step_started_at?: string | null
          step_status: string
          workflow_type: string
        }
        Update: {
          cluster_id?: string | null
          created_at?: string | null
          host_id?: string | null
          id?: string
          job_id?: string
          server_id?: string | null
          step_completed_at?: string | null
          step_details?: Json | null
          step_error?: string | null
          step_name?: string
          step_number?: number
          step_started_at?: string | null
          step_status?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_executions_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "vcenter_hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["id"]
          },
        ]
      }
      zfs_target_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          default_cluster: string | null
          default_cpu_count: number | null
          default_datacenter: string | null
          default_datastore: string | null
          default_memory_gb: number | null
          default_network: string | null
          default_nfs_network: string | null
          default_resource_pool: string | null
          default_ssh_username: string | null
          default_zfs_disk_gb: number | null
          default_zfs_disk_path: string | null
          default_zfs_pool_name: string | null
          deployment_count: number | null
          description: string | null
          id: string
          is_active: boolean | null
          last_deployed_at: string | null
          name: string
          preparation_job_id: string | null
          ssh_key_encrypted: string | null
          ssh_key_id: string | null
          status: string
          template_moref: string
          template_name: string
          updated_at: string | null
          use_template_disk: boolean | null
          vcenter_id: string | null
          version: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          default_cluster?: string | null
          default_cpu_count?: number | null
          default_datacenter?: string | null
          default_datastore?: string | null
          default_memory_gb?: number | null
          default_network?: string | null
          default_nfs_network?: string | null
          default_resource_pool?: string | null
          default_ssh_username?: string | null
          default_zfs_disk_gb?: number | null
          default_zfs_disk_path?: string | null
          default_zfs_pool_name?: string | null
          deployment_count?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_deployed_at?: string | null
          name: string
          preparation_job_id?: string | null
          ssh_key_encrypted?: string | null
          ssh_key_id?: string | null
          status?: string
          template_moref: string
          template_name: string
          updated_at?: string | null
          use_template_disk?: boolean | null
          vcenter_id?: string | null
          version?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          default_cluster?: string | null
          default_cpu_count?: number | null
          default_datacenter?: string | null
          default_datastore?: string | null
          default_memory_gb?: number | null
          default_network?: string | null
          default_nfs_network?: string | null
          default_resource_pool?: string | null
          default_ssh_username?: string | null
          default_zfs_disk_gb?: number | null
          default_zfs_disk_path?: string | null
          default_zfs_pool_name?: string | null
          deployment_count?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_deployed_at?: string | null
          name?: string
          preparation_job_id?: string | null
          ssh_key_encrypted?: string | null
          ssh_key_id?: string | null
          status?: string
          template_moref?: string
          template_name?: string
          updated_at?: string | null
          use_template_disk?: boolean | null
          vcenter_id?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zfs_target_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zfs_target_templates_preparation_job_id_fkey"
            columns: ["preparation_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zfs_target_templates_ssh_key_id_fkey"
            columns: ["ssh_key_id"]
            isOneToOne: false
            referencedRelation: "ssh_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zfs_target_templates_vcenter_id_fkey"
            columns: ["vcenter_id"]
            isOneToOne: false
            referencedRelation: "vcenters"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_job_console_log: {
        Args: { p_job_id: string; p_log_entry: string }
        Returns: undefined
      }
      auto_complete_stale_replication_jobs: { Args: never; Returns: Json }
      check_auth_rate_limit: {
        Args: {
          p_identifier: string
          p_identifier_type: string
          p_lockout_minutes?: number
          p_max_attempts?: number
        }
        Returns: Json
      }
      cleanup_activity_logs: { Args: never; Returns: undefined }
      cleanup_old_jobs: { Args: never; Returns: undefined }
      decrypt_password: {
        Args: { encrypted: string; key: string }
        Returns: string
      }
      encrypt_password: {
        Args: { key: string; password: string }
        Returns: string
      }
      get_encryption_key: { Args: never; Returns: string }
      get_idm_auth_mode: {
        Args: never
        Returns: {
          auth_mode: string
          session_timeout_minutes: number
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_template_deployment: {
        Args: { template_id: string }
        Returns: undefined
      }
      record_auth_attempt: {
        Args: {
          p_identifier: string
          p_identifier_type: string
          p_lockout_minutes?: number
          p_max_attempts?: number
          p_success: boolean
        }
        Returns: undefined
      }
      run_scheduled_cluster_safety_checks: { Args: never; Returns: undefined }
      send_maintenance_reminders: { Args: never; Returns: undefined }
      validate_api_token: { Args: { token_input: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
      credential_type: "idrac" | "esxi"
      job_status: "pending" | "running" | "completed" | "failed" | "cancelled"
      job_type:
        | "firmware_update"
        | "discovery_scan"
        | "vcenter_sync"
        | "full_server_update"
        | "test_credentials"
        | "power_action"
        | "health_check"
        | "fetch_event_logs"
        | "boot_configuration"
        | "virtual_media_mount"
        | "virtual_media_unmount"
        | "bios_config_read"
        | "bios_config_write"
        | "scp_export"
        | "scp_import"
        | "vcenter_connectivity_test"
        | "openmanage_sync"
        | "cluster_safety_check"
        | "prepare_host_for_update"
        | "verify_host_after_update"
        | "rolling_cluster_update"
        | "server_group_safety_check"
        | "iso_upload"
        | "console_launch"
        | "firmware_upload"
        | "catalog_sync"
        | "scan_local_isos"
        | "register_iso_url"
        | "esxi_upgrade"
        | "esxi_then_firmware"
        | "firmware_then_esxi"
        | "browse_datastore"
        | "esxi_preflight_check"
        | "idm_authenticate"
        | "idm_sync_users"
        | "idm_test_connection"
        | "firmware_inventory_scan"
        | "idm_search_groups"
        | "idm_test_auth"
        | "idm_network_check"
        | "idm_search_ad_groups"
        | "idm_search_ad_users"
        | "idm_test_ad_connection"
        | "idrac_network_read"
        | "idrac_network_write"
        | "storage_vmotion"
        | "deploy_zfs_target"
        | "copy_template_cross_vcenter"
        | "ssh_key_deploy"
        | "ssh_key_verify"
        | "ssh_key_remove"
        | "ssh_key_rotate"
        | "ssh_key_health_check"
        | "validate_zfs_template"
        | "test_replication_pair"
        | "pause_protection_group"
        | "resume_protection_group"
        | "test_failover"
        | "live_failover"
        | "commit_failover"
        | "rollback_failover"
        | "collect_replication_metrics"
        | "run_replication_sync"
        | "prepare_zfs_template"
        | "onboard_zfs_target"
        | "test_ssh_connection"
        | "detect_disks"
        | "retry_onboard_step"
        | "rollback_zfs_onboard"
        | "sync_protection_config"
        | "clone_zfs_template"
        | "partial_vcenter_sync"
        | "inspect_zfs_appliance"
        | "decommission_zfs_target"
        | "manage_datastore"
        | "scan_datastore_status"
        | "exchange_ssh_keys"
        | "check_zfs_target_health"
        | "repair_zfs_pool"
        | "repair_cross_site_ssh"
        | "repair_syncoid_cron"
        | "create_dr_shell"
        | "scheduled_replication_check"
        | "rpo_monitoring"
        | "failover_preflight_check"
        | "group_failover"
        | "scheduled_vcenter_sync"
        | "repair_data_transfer"
        | "repair_nfs_export"
      operation_type:
        | "idrac_api"
        | "vcenter_api"
        | "openmanage_api"
        | "ldap_api"
        | "ssh_command"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator", "viewer"],
      credential_type: ["idrac", "esxi"],
      job_status: ["pending", "running", "completed", "failed", "cancelled"],
      job_type: [
        "firmware_update",
        "discovery_scan",
        "vcenter_sync",
        "full_server_update",
        "test_credentials",
        "power_action",
        "health_check",
        "fetch_event_logs",
        "boot_configuration",
        "virtual_media_mount",
        "virtual_media_unmount",
        "bios_config_read",
        "bios_config_write",
        "scp_export",
        "scp_import",
        "vcenter_connectivity_test",
        "openmanage_sync",
        "cluster_safety_check",
        "prepare_host_for_update",
        "verify_host_after_update",
        "rolling_cluster_update",
        "server_group_safety_check",
        "iso_upload",
        "console_launch",
        "firmware_upload",
        "catalog_sync",
        "scan_local_isos",
        "register_iso_url",
        "esxi_upgrade",
        "esxi_then_firmware",
        "firmware_then_esxi",
        "browse_datastore",
        "esxi_preflight_check",
        "idm_authenticate",
        "idm_sync_users",
        "idm_test_connection",
        "firmware_inventory_scan",
        "idm_search_groups",
        "idm_test_auth",
        "idm_network_check",
        "idm_search_ad_groups",
        "idm_search_ad_users",
        "idm_test_ad_connection",
        "idrac_network_read",
        "idrac_network_write",
        "storage_vmotion",
        "deploy_zfs_target",
        "copy_template_cross_vcenter",
        "ssh_key_deploy",
        "ssh_key_verify",
        "ssh_key_remove",
        "ssh_key_rotate",
        "ssh_key_health_check",
        "validate_zfs_template",
        "test_replication_pair",
        "pause_protection_group",
        "resume_protection_group",
        "test_failover",
        "live_failover",
        "commit_failover",
        "rollback_failover",
        "collect_replication_metrics",
        "run_replication_sync",
        "prepare_zfs_template",
        "onboard_zfs_target",
        "test_ssh_connection",
        "detect_disks",
        "retry_onboard_step",
        "rollback_zfs_onboard",
        "sync_protection_config",
        "clone_zfs_template",
        "partial_vcenter_sync",
        "inspect_zfs_appliance",
        "decommission_zfs_target",
        "manage_datastore",
        "scan_datastore_status",
        "exchange_ssh_keys",
        "check_zfs_target_health",
        "repair_zfs_pool",
        "repair_cross_site_ssh",
        "repair_syncoid_cron",
        "create_dr_shell",
        "scheduled_replication_check",
        "rpo_monitoring",
        "failover_preflight_check",
        "group_failover",
        "scheduled_vcenter_sync",
        "repair_data_transfer",
        "repair_nfs_export",
      ],
      operation_type: [
        "idrac_api",
        "vcenter_api",
        "openmanage_api",
        "ldap_api",
        "ssh_command",
      ],
    },
  },
} as const
