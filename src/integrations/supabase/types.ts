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
          id: string
          idrac_max_concurrent: number | null
          idrac_request_delay_ms: number | null
          job_auto_cleanup_enabled: boolean | null
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
          id?: string
          idrac_max_concurrent?: number | null
          idrac_request_delay_ms?: number | null
          job_auto_cleanup_enabled?: boolean | null
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
          id?: string
          idrac_max_concurrent?: number | null
          idrac_request_delay_ms?: number | null
          job_auto_cleanup_enabled?: boolean | null
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
          created_by: string
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
          created_by: string
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
          created_by?: string
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
          source_vcenter_id?: string | null
          type?: string | null
          updated_at?: string | null
          vcenter_id?: string | null
          vm_count?: number | null
        }
        Relationships: [
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
          created_at: string
          esxi_version: string | null
          id: string
          last_sync: string | null
          maintenance_mode: boolean | null
          name: string
          serial_number: string | null
          server_id: string | null
          source_vcenter_id: string | null
          status: string | null
          updated_at: string
          vcenter_id: string | null
        }
        Insert: {
          cluster?: string | null
          created_at?: string
          esxi_version?: string | null
          id?: string
          last_sync?: string | null
          maintenance_mode?: boolean | null
          name: string
          serial_number?: string | null
          server_id?: string | null
          source_vcenter_id?: string | null
          status?: string | null
          updated_at?: string
          vcenter_id?: string | null
        }
        Update: {
          cluster?: string | null
          created_at?: string
          esxi_version?: string | null
          id?: string
          last_sync?: string | null
          maintenance_mode?: boolean | null
          name?: string
          serial_number?: string | null
          server_id?: string | null
          source_vcenter_id?: string | null
          status?: string | null
          updated_at?: string
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
      vcenter_vms: {
        Row: {
          cluster_name: string | null
          cpu_count: number | null
          created_at: string | null
          disk_gb: number | null
          guest_os: string | null
          host_id: string | null
          id: string
          ip_address: string | null
          last_sync: string | null
          memory_mb: number | null
          name: string
          notes: string | null
          overall_status: string | null
          power_state: string | null
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
          guest_os?: string | null
          host_id?: string | null
          id?: string
          ip_address?: string | null
          last_sync?: string | null
          memory_mb?: number | null
          name: string
          notes?: string | null
          overall_status?: string | null
          power_state?: string | null
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
          guest_os?: string | null
          host_id?: string | null
          id?: string
          ip_address?: string | null
          last_sync?: string | null
          memory_mb?: number | null
          name?: string
          notes?: string | null
          overall_status?: string | null
          power_state?: string | null
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
          host: string
          id: string
          is_primary: boolean | null
          last_sync: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          name: string
          password_encrypted: string | null
          port: number
          sync_enabled: boolean
          sync_interval_minutes: number | null
          updated_at: string
          username: string
          verify_ssl: boolean
        }
        Insert: {
          color?: string | null
          created_at?: string
          datacenter_location?: string | null
          host: string
          id?: string
          is_primary?: boolean | null
          last_sync?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          name: string
          password_encrypted?: string | null
          port?: number
          sync_enabled?: boolean
          sync_interval_minutes?: number | null
          updated_at?: string
          username: string
          verify_ssl?: boolean
        }
        Update: {
          color?: string | null
          created_at?: string
          datacenter_location?: string | null
          host?: string
          id?: string
          is_primary?: boolean | null
          last_sync?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          name?: string
          password_encrypted?: string | null
          port?: number
          sync_enabled?: boolean
          sync_interval_minutes?: number | null
          updated_at?: string
          username?: string
          verify_ssl?: boolean
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      operation_type:
        | "idrac_api"
        | "vcenter_api"
        | "openmanage_api"
        | "ldap_api"
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
      ],
      operation_type: [
        "idrac_api",
        "vcenter_api",
        "openmanage_api",
        "ldap_api",
      ],
    },
  },
} as const
