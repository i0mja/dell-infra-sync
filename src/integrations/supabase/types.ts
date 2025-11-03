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
          created_at: string
          created_by: string
          details: Json | null
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          schedule_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          target_scope: Json | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          details?: Json | null
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          schedule_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_scope?: Json | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          details?: Json | null
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
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
        ]
      }
      notification_settings: {
        Row: {
          created_at: string
          id: string
          notify_on_job_complete: boolean | null
          notify_on_job_failed: boolean | null
          notify_on_job_started: boolean | null
          smtp_from_email: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_user: string | null
          teams_webhook_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notify_on_job_complete?: boolean | null
          notify_on_job_failed?: boolean | null
          notify_on_job_started?: boolean | null
          smtp_from_email?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_user?: string | null
          teams_webhook_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notify_on_job_complete?: boolean | null
          notify_on_job_failed?: boolean | null
          notify_on_job_started?: boolean | null
          smtp_from_email?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_user?: string | null
          teams_webhook_url?: string | null
          updated_at?: string
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
      servers: {
        Row: {
          bios_version: string | null
          cpu_count: number | null
          created_at: string
          hostname: string | null
          id: string
          idrac_firmware: string | null
          ip_address: string
          last_seen: string | null
          memory_gb: number | null
          model: string | null
          notes: string | null
          service_tag: string | null
          updated_at: string
          vcenter_host_id: string | null
        }
        Insert: {
          bios_version?: string | null
          cpu_count?: number | null
          created_at?: string
          hostname?: string | null
          id?: string
          idrac_firmware?: string | null
          ip_address: string
          last_seen?: string | null
          memory_gb?: number | null
          model?: string | null
          notes?: string | null
          service_tag?: string | null
          updated_at?: string
          vcenter_host_id?: string | null
        }
        Update: {
          bios_version?: string | null
          cpu_count?: number | null
          created_at?: string
          hostname?: string | null
          id?: string
          idrac_firmware?: string | null
          ip_address?: string
          last_seen?: string | null
          memory_gb?: number | null
          model?: string | null
          notes?: string | null
          service_tag?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
      job_status: "pending" | "running" | "completed" | "failed" | "cancelled"
      job_type: "firmware_update" | "discovery_scan" | "vcenter_sync"
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
      job_type: ["firmware_update", "discovery_scan", "vcenter_sync"],
    },
  },
} as const
