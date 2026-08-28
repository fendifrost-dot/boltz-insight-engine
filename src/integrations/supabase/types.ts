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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          action: Database["public"]["Enums"]["agent_action"]
          audit_summary: string | null
          correlation_id: string | null
          created_at: string
          escalation_category:
            | Database["public"]["Enums"]["escalation_category"]
            | null
          id: string
          inbound_message_id: string | null
          lead_field_updates: Json | null
          lead_id: string | null
          model: string
          outbound_message_id: string | null
          policy_tags: string[] | null
          prompt_version: string
          proposed_lifecycle:
            | Database["public"]["Enums"]["lead_lifecycle"]
            | null
          raw_decision: Json | null
          thread_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["agent_action"]
          audit_summary?: string | null
          correlation_id?: string | null
          created_at?: string
          escalation_category?:
            | Database["public"]["Enums"]["escalation_category"]
            | null
          id?: string
          inbound_message_id?: string | null
          lead_field_updates?: Json | null
          lead_id?: string | null
          model: string
          outbound_message_id?: string | null
          policy_tags?: string[] | null
          prompt_version: string
          proposed_lifecycle?:
            | Database["public"]["Enums"]["lead_lifecycle"]
            | null
          raw_decision?: Json | null
          thread_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["agent_action"]
          audit_summary?: string | null
          correlation_id?: string | null
          created_at?: string
          escalation_category?:
            | Database["public"]["Enums"]["escalation_category"]
            | null
          id?: string
          inbound_message_id?: string | null
          lead_field_updates?: Json | null
          lead_id?: string | null
          model?: string
          outbound_message_id?: string | null
          policy_tags?: string[] | null
          prompt_version?: string
          proposed_lifecycle?:
            | Database["public"]["Enums"]["lead_lifecycle"]
            | null
          raw_decision?: Json | null
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_outbound_message_id_fkey"
            columns: ["outbound_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      escalations: {
        Row: {
          agent_run_id: string | null
          category: Database["public"]["Enums"]["escalation_category"]
          created_at: string
          id: string
          lead_id: string
          reason: string
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["escalation_status"]
          thread_id: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          category: Database["public"]["Enums"]["escalation_category"]
          created_at?: string
          id?: string
          lead_id: string
          reason: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          thread_id: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          category?: Database["public"]["Enums"]["escalation_category"]
          created_at?: string
          id?: string
          lead_id?: string
          reason?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalations_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_health_snapshots: {
        Row: {
          check_name: string
          created_at: string
          detail: string | null
          id: string
          metadata_redacted: Json | null
          ok: boolean
          provider: string
        }
        Insert: {
          check_name: string
          created_at?: string
          detail?: string | null
          id?: string
          metadata_redacted?: Json | null
          ok: boolean
          provider: string
        }
        Update: {
          check_name?: string
          created_at?: string
          detail?: string | null
          id?: string
          metadata_redacted?: Json | null
          ok?: boolean
          provider?: string
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          actor: string | null
          correlation_id: string | null
          created_at: string
          event_type: string
          from_lifecycle: Database["public"]["Enums"]["lead_lifecycle"] | null
          id: string
          lead_id: string
          metadata: Json | null
          summary: string | null
          to_lifecycle: Database["public"]["Enums"]["lead_lifecycle"] | null
        }
        Insert: {
          actor?: string | null
          correlation_id?: string | null
          created_at?: string
          event_type: string
          from_lifecycle?: Database["public"]["Enums"]["lead_lifecycle"] | null
          id?: string
          lead_id: string
          metadata?: Json | null
          summary?: string | null
          to_lifecycle?: Database["public"]["Enums"]["lead_lifecycle"] | null
        }
        Update: {
          actor?: string | null
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          from_lifecycle?: Database["public"]["Enums"]["lead_lifecycle"] | null
          id?: string
          lead_id?: string
          metadata?: Json | null
          summary?: string | null
          to_lifecycle?: Database["public"]["Enums"]["lead_lifecycle"] | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_owner: string | null
          attachment_urls: Json | null
          consent_evidence: Json | null
          consent_status: Database["public"]["Enums"]["consent_status"]
          consent_updated_at: string | null
          created_at: string
          email: string | null
          follow_up_at: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          lead_source: string | null
          lifecycle: Database["public"]["Enums"]["lead_lifecycle"]
          name: string | null
          notes: string | null
          phone_e164: string | null
          photo_urls: Json | null
          symptoms: string | null
          unread_count: number
          updated_at: string
          vehicle_make: string | null
          vehicle_mileage: number | null
          vehicle_model: string | null
          vehicle_year: number | null
          vin: string | null
        }
        Insert: {
          assigned_owner?: string | null
          attachment_urls?: Json | null
          consent_evidence?: Json | null
          consent_status?: Database["public"]["Enums"]["consent_status"]
          consent_updated_at?: string | null
          created_at?: string
          email?: string | null
          follow_up_at?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_source?: string | null
          lifecycle?: Database["public"]["Enums"]["lead_lifecycle"]
          name?: string | null
          notes?: string | null
          phone_e164?: string | null
          photo_urls?: Json | null
          symptoms?: string | null
          unread_count?: number
          updated_at?: string
          vehicle_make?: string | null
          vehicle_mileage?: number | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vin?: string | null
        }
        Update: {
          assigned_owner?: string | null
          attachment_urls?: Json | null
          consent_evidence?: Json | null
          consent_status?: Database["public"]["Enums"]["consent_status"]
          consent_updated_at?: string | null
          created_at?: string
          email?: string | null
          follow_up_at?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          lead_source?: string | null
          lifecycle?: Database["public"]["Enums"]["lead_lifecycle"]
          name?: string | null
          notes?: string | null
          phone_e164?: string | null
          photo_urls?: Json | null
          symptoms?: string | null
          unread_count?: number
          updated_at?: string
          vehicle_make?: string | null
          vehicle_mileage?: number | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vin?: string | null
        }
        Relationships: []
      }
      message_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          id: string
          inbound_provider_message_id: string | null
          job_type: Database["public"]["Enums"]["message_job_type"]
          last_error: string | null
          lead_id: string | null
          locked_at: string | null
          max_attempts: number
          message_id: string | null
          payload: Json | null
          run_after: string
          status: Database["public"]["Enums"]["message_job_status"]
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          inbound_provider_message_id?: string | null
          job_type: Database["public"]["Enums"]["message_job_type"]
          last_error?: string | null
          lead_id?: string | null
          locked_at?: string | null
          max_attempts?: number
          message_id?: string | null
          payload?: Json | null
          run_after?: string
          status?: Database["public"]["Enums"]["message_job_status"]
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          inbound_provider_message_id?: string | null
          job_type?: Database["public"]["Enums"]["message_job_type"]
          last_error?: string | null
          lead_id?: string | null
          locked_at?: string | null
          max_attempts?: number
          message_id?: string | null
          payload?: Json | null
          run_after?: string
          status?: Database["public"]["Enums"]["message_job_status"]
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_send_reservations: {
        Row: {
          body_hash: string
          claim_generation: number
          correlation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          lead_id: string
          locked_at: string | null
          message_id: string | null
          provider_message_id: string | null
          recipient_e164: string
          retryable: boolean
          sent_at: string | null
          status: Database["public"]["Enums"]["outbound_send_status"]
          thread_id: string
          updated_at: string
        }
        Insert: {
          body_hash: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          lead_id: string
          locked_at?: string | null
          message_id?: string | null
          provider_message_id?: string | null
          recipient_e164: string
          retryable?: boolean
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbound_send_status"]
          thread_id: string
          updated_at?: string
        }
        Update: {
          body_hash?: string
          claim_generation?: number
          correlation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          lead_id?: string
          locked_at?: string | null
          message_id?: string | null
          provider_message_id?: string | null
          recipient_e164?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbound_send_status"]
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_send_reservations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_send_reservations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_send_reservations_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      message_threads: {
        Row: {
          control_mode: Database["public"]["Enums"]["thread_control_mode"]
          created_at: string
          id: string
          last_message_at: string | null
          lead_id: string
          phone_e164: string
          subject: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          control_mode?: Database["public"]["Enums"]["thread_control_mode"]
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id: string
          phone_e164: string
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          control_mode?: Database["public"]["Enums"]["thread_control_mode"]
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string
          phone_e164?: string
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_threads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_urls: Json | null
          body: string | null
          channel: Database["public"]["Enums"]["message_channel"]
          correlation_id: string | null
          created_at: string
          delivery_state: Database["public"]["Enums"]["message_delivery_state"]
          direction: Database["public"]["Enums"]["message_direction"]
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          lead_id: string
          provider: string
          provider_created_at: string | null
          provider_message_id: string | null
          provider_metadata_redacted: Json | null
          provider_updated_at: string | null
          recipients_e164: string[] | null
          sender_e164: string | null
          thread_id: string
          updated_at: string
        }
        Insert: {
          attachment_urls?: Json | null
          body?: string | null
          channel?: Database["public"]["Enums"]["message_channel"]
          correlation_id?: string | null
          created_at?: string
          delivery_state?: Database["public"]["Enums"]["message_delivery_state"]
          direction: Database["public"]["Enums"]["message_direction"]
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id: string
          provider?: string
          provider_created_at?: string | null
          provider_message_id?: string | null
          provider_metadata_redacted?: Json | null
          provider_updated_at?: string | null
          recipients_e164?: string[] | null
          sender_e164?: string | null
          thread_id: string
          updated_at?: string
        }
        Update: {
          attachment_urls?: Json | null
          body?: string | null
          channel?: Database["public"]["Enums"]["message_channel"]
          correlation_id?: string | null
          created_at?: string
          delivery_state?: Database["public"]["Enums"]["message_delivery_state"]
          direction?: Database["public"]["Enums"]["message_direction"]
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id?: string
          provider?: string
          provider_created_at?: string | null
          provider_message_id?: string | null
          provider_metadata_redacted?: Json | null
          provider_updated_at?: string | null
          recipients_e164?: string[] | null
          sender_e164?: string | null
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ringcentral_subscriptions: {
        Row: {
          created_at: string
          delivery_address: string
          event_filters: string[]
          expires_at: string | null
          extension_id: string | null
          from_number_e164: string | null
          id: string
          last_notification_at: string | null
          last_renewal_error: string | null
          last_renewed_at: string | null
          metadata_redacted: Json | null
          provider_subscription_id: string
          sms_capability: Database["public"]["Enums"]["sms_capability"]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_address: string
          event_filters: string[]
          expires_at?: string | null
          extension_id?: string | null
          from_number_e164?: string | null
          id?: string
          last_notification_at?: string | null
          last_renewal_error?: string | null
          last_renewed_at?: string | null
          metadata_redacted?: Json | null
          provider_subscription_id: string
          sms_capability?: Database["public"]["Enums"]["sms_capability"]
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_address?: string
          event_filters?: string[]
          expires_at?: string | null
          extension_id?: string | null
          from_number_e164?: string | null
          id?: string
          last_notification_at?: string | null
          last_renewal_error?: string | null
          last_renewed_at?: string | null
          metadata_redacted?: Json | null
          provider_subscription_id?: string
          sms_capability?: Database["public"]["Enums"]["sms_capability"]
          status?: string
          updated_at?: string
        }
        Relationships: []
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
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_lead_lifecycle_transition: {
        Args: {
          _lead_id: string
          _expected_from: Database["public"]["Enums"]["lead_lifecycle"]
          _to: Database["public"]["Enums"]["lead_lifecycle"]
          _event_type: string
          _summary: string
          _actor: string
          _metadata?: Json
        }
        Returns: Json
      }
      claim_message_jobs: {
        Args: { _lease_ms?: number; _limit: number }
        Returns: Json
      }
      complete_message_job: {
        Args: { _expected_attempts: number; _job_id: string }
        Returns: Json
      }
      complete_outbound_send: {
        Args: {
          _expected_claim_generation: number
          _idempotency_key: string
          _message_id: string | null
          _provider_message_id: string | null
        }
        Returns: Json
      }
      derive_inbound_correlation_id: {
        Args: { _provider: string; _provider_message_id: string }
        Returns: string
      }
      enqueue_inbound_message_job: {
        Args: { _inbound_provider_message_id: string; _payload: Json }
        Returns: Json
      }
      fail_message_job: {
        Args: { _error: string; _expected_attempts: number; _job_id: string }
        Returns: Json
      }
      fail_outbound_send: {
        Args: { _error: string; _expected_claim_generation: number; _idempotency_key: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      mark_outbound_send_ambiguous: {
        Args: {
          _detail: string
          _expected_claim_generation: number
          _idempotency_key: string
          _provider_message_id: string | null
        }
        Returns: Json
      }
      reserve_outbound_send: {
        Args: {
          _body: string
          _correlation_id: string | null
          _idempotency_key: string
          _lead_id: string
          _lease_ms?: number
          _recipient_e164: string
          _thread_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      agent_action: "send" | "escalate" | "no_reply"
      app_role: "owner" | "staff"
      consent_status: "unknown" | "opted_in" | "opted_out"
      escalation_category:
        | "threat"
        | "injury"
        | "legal_claim"
        | "insurance_liability"
        | "payment_dispute"
        | "harassment"
        | "unsupported_discount"
        | "human_requested"
        | "other_high_risk"
      escalation_status: "open" | "acknowledged" | "resolved"
      lead_lifecycle:
        | "New"
        | "Contacted"
        | "Qualified"
        | "Appointment Scheduled"
        | "Inspected"
        | "Estimate Sent"
        | "Approved"
        | "In Progress"
        | "Completed"
        | "Paid"
        | "Lost"
        | "No response"
        | "No-show"
        | "Duplicate"
        | "Spam"
        | "Outside service capability"
      message_channel: "SMS" | "MMS"
      message_delivery_state:
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "failed"
        | "received"
      message_direction: "inbound" | "outbound"
      message_job_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "dead"
      message_job_type:
        | "process_inbound"
        | "send_outbound"
        | "reconcile"
        | "renew_subscription"
      outbound_send_status: "queued" | "sending" | "sent" | "failed" | "ambiguous"
      sms_capability: "SmsSender" | "A2PSmsSender" | "none" | "unknown"
      thread_control_mode: "auto" | "human"
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
      agent_action: ["send", "escalate", "no_reply"],
      app_role: ["owner", "staff"],
      consent_status: ["unknown", "opted_in", "opted_out"],
      escalation_category: [
        "threat",
        "injury",
        "legal_claim",
        "insurance_liability",
        "payment_dispute",
        "harassment",
        "unsupported_discount",
        "human_requested",
        "other_high_risk",
      ],
      escalation_status: ["open", "acknowledged", "resolved"],
      lead_lifecycle: [
        "New",
        "Contacted",
        "Qualified",
        "Appointment Scheduled",
        "Inspected",
        "Estimate Sent",
        "Approved",
        "In Progress",
        "Completed",
        "Paid",
        "Lost",
        "No response",
        "No-show",
        "Duplicate",
        "Spam",
        "Outside service capability",
      ],
      message_channel: ["SMS", "MMS"],
      message_delivery_state: [
        "queued",
        "sending",
        "sent",
        "delivered",
        "failed",
        "received",
      ],
      message_direction: ["inbound", "outbound"],
      message_job_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "dead",
      ],
      message_job_type: [
        "process_inbound",
        "send_outbound",
        "reconcile",
        "renew_subscription",
      ],
      sms_capability: ["SmsSender", "A2PSmsSender", "none", "unknown"],
      thread_control_mode: ["auto", "human"],
    },
  },
} as const
