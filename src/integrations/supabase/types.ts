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
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          timestamp: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
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
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          password_encrypted: string | null
          priority: number | null
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          password_encrypted?: string | null
          priority?: number | null
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          password_encrypted?: string | null
          priority?: number | null
          updated_at?: string | null
          username?: string
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
      job_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          job_id: string
          log: string | null
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
          completed_at: string | null
          component_order: number | null
          created_at: string
          created_by: string
          credential_set_ids: string[] | null
          details: Json | null
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          parent_job_id: string | null
          schedule_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          target_scope: Json | null
        }
        Insert: {
          completed_at?: string | null
          component_order?: number | null
          created_at?: string
          created_by: string
          credential_set_ids?: string[] | null
          details?: Json | null
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          parent_job_id?: string | null
          schedule_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_scope?: Json | null
        }
        Update: {
          completed_at?: string | null
          component_order?: number | null
          created_at?: string
          created_by?: string
          credential_set_ids?: string[] | null
          details?: Json | null
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
          parent_job_id?: string | null
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
          notify_on_job_complete: boolean | null
          notify_on_job_failed: boolean | null
          notify_on_job_started: boolean | null
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
          notify_on_job_complete?: boolean | null
          notify_on_job_failed?: boolean | null
          notify_on_job_started?: boolean | null
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
          notify_on_job_complete?: boolean | null
          notify_on_job_failed?: boolean | null
          notify_on_job_started?: boolean | null
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scp_backups: {
        Row: {
          backup_name: string
          checksum: string | null
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
          scp_content: Json | null
          scp_file_path: string | null
          scp_file_size_bytes: number | null
          server_id: string
          validation_errors: string | null
        }
        Insert: {
          backup_name: string
          checksum?: string | null
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
          scp_content?: Json | null
          scp_file_path?: string | null
          scp_file_size_bytes?: number | null
          server_id: string
          validation_errors?: string | null
        }
        Update: {
          backup_name?: string
          checksum?: string | null
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
          scp_content?: Json | null
          scp_file_path?: string | null
          scp_file_size_bytes?: number | null
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
          cpu_count: number | null
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
          service_tag: string | null
          supported_endpoints: Json | null
          updated_at: string
          vcenter_host_id: string | null
        }
        Insert: {
          bios_version?: string | null
          boot_mode?: string | null
          boot_order?: Json | null
          boot_source_override_enabled?: string | null
          boot_source_override_target?: string | null
          connection_error?: string | null
          connection_status?: string | null
          cpu_count?: number | null
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
          service_tag?: string | null
          supported_endpoints?: Json | null
          updated_at?: string
          vcenter_host_id?: string | null
        }
        Update: {
          bios_version?: string | null
          boot_mode?: string | null
          boot_order?: Json | null
          boot_source_override_enabled?: string | null
          boot_source_override_target?: string | null
          connection_error?: string | null
          connection_status?: string | null
          cpu_count?: number | null
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
          service_tag?: string | null
          supported_endpoints?: Json | null
          updated_at?: string
          vcenter_host_id?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      validate_api_token: { Args: { token_input: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
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
      operation_type: "idrac_api" | "vcenter_api" | "openmanage_api"
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
      ],
      operation_type: ["idrac_api", "vcenter_api", "openmanage_api"],
    },
  },
} as const
