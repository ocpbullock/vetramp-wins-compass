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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cached_competitive_intel: {
        Row: {
          agency: string | null
          cache_key: string
          created_at: string
          expires_at: string
          id: string
          naics_code: string | null
          payload: Json
          set_aside: string | null
        }
        Insert: {
          agency?: string | null
          cache_key: string
          created_at?: string
          expires_at: string
          id?: string
          naics_code?: string | null
          payload: Json
          set_aside?: string | null
        }
        Update: {
          agency?: string | null
          cache_key?: string
          created_at?: string
          expires_at?: string
          id?: string
          naics_code?: string | null
          payload?: Json
          set_aside?: string | null
        }
        Relationships: []
      }
      cached_searches: {
        Row: {
          cache_key: string
          created_at: string
          date_from: string | null
          date_to: string | null
          expires_at: string
          historical: Json | null
          id: string
          keyword: string | null
          naics_codes: string[]
          opportunities: Json | null
          summary: Json | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          expires_at: string
          historical?: Json | null
          id?: string
          keyword?: string | null
          naics_codes: string[]
          opportunities?: Json | null
          summary?: Json | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          expires_at?: string
          historical?: Json | null
          id?: string
          keyword?: string | null
          naics_codes?: string[]
          opportunities?: Json | null
          summary?: Json | null
        }
        Relationships: []
      }
      company_profile: {
        Row: {
          id: string
          profile_data: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          profile_data: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          profile_data?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proposal_attachments: {
        Row: {
          file_type: string | null
          filename: string
          id: string
          parsed_content: string | null
          proposal_id: string
          size_bytes: number | null
          source: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          file_type?: string | null
          filename: string
          id?: string
          parsed_content?: string | null
          proposal_id: string
          size_bytes?: number | null
          source?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          file_type?: string | null
          filename?: string
          id?: string
          parsed_content?: string | null
          proposal_id?: string
          size_bytes?: number | null
          source?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_attachments_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_drafts: {
        Row: {
          agency: string | null
          created_at: string
          draft_content: string | null
          id: string
          naics_code: string | null
          opportunity_title: string | null
          response_deadline: string | null
          solicitation_number: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agency?: string | null
          created_at?: string
          draft_content?: string | null
          id?: string
          naics_code?: string | null
          opportunity_title?: string | null
          response_deadline?: string | null
          solicitation_number: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agency?: string | null
          created_at?: string
          draft_content?: string | null
          id?: string
          naics_code?: string | null
          opportunity_title?: string | null
          response_deadline?: string | null
          solicitation_number?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          agency: string | null
          clearance_requirement: string | null
          compliance_gaps: number | null
          compliance_matrix: Json | null
          contract_type: string | null
          created_at: string
          customer_intel: Json | null
          customer_intel_verified: boolean | null
          estimated_value: number | null
          id: string
          management_approach: Json | null
          naics_code: string | null
          notice_id: string | null
          opportunity_data: Json | null
          opportunity_title: string | null
          opportunity_type: string | null
          pop_base_months: number | null
          pop_option_months: number | null
          price_strategy: Json | null
          readiness_score: number | null
          response_deadline: string | null
          sections: Json | null
          set_aside: string | null
          solicitation_number: string
          staffing_plan: Json | null
          status: string
          technical_approach: Json | null
          transition_plan: Json | null
          updated_at: string
          user_id: string
          user_notes: string | null
        }
        Insert: {
          agency?: string | null
          clearance_requirement?: string | null
          compliance_gaps?: number | null
          compliance_matrix?: Json | null
          contract_type?: string | null
          created_at?: string
          customer_intel?: Json | null
          customer_intel_verified?: boolean | null
          estimated_value?: number | null
          id?: string
          management_approach?: Json | null
          naics_code?: string | null
          notice_id?: string | null
          opportunity_data?: Json | null
          opportunity_title?: string | null
          opportunity_type?: string | null
          pop_base_months?: number | null
          pop_option_months?: number | null
          price_strategy?: Json | null
          readiness_score?: number | null
          response_deadline?: string | null
          sections?: Json | null
          set_aside?: string | null
          solicitation_number: string
          staffing_plan?: Json | null
          status?: string
          technical_approach?: Json | null
          transition_plan?: Json | null
          updated_at?: string
          user_id: string
          user_notes?: string | null
        }
        Update: {
          agency?: string | null
          clearance_requirement?: string | null
          compliance_gaps?: number | null
          compliance_matrix?: Json | null
          contract_type?: string | null
          created_at?: string
          customer_intel?: Json | null
          customer_intel_verified?: boolean | null
          estimated_value?: number | null
          id?: string
          management_approach?: Json | null
          naics_code?: string | null
          notice_id?: string | null
          opportunity_data?: Json | null
          opportunity_title?: string | null
          opportunity_type?: string | null
          pop_base_months?: number | null
          pop_option_months?: number | null
          price_strategy?: Json | null
          readiness_score?: number | null
          response_deadline?: string | null
          sections?: Json | null
          set_aside?: string | null
          solicitation_number?: string
          staffing_plan?: Json | null
          status?: string
          technical_approach?: Json | null
          transition_plan?: Json | null
          updated_at?: string
          user_id?: string
          user_notes?: string | null
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          default_date_range_months: number
          default_naics: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_date_range_months?: number
          default_naics?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_date_range_months?: number
          default_naics?: string[]
          updated_at?: string
          user_id?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "member"
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
      app_role: ["admin", "member"],
    },
  },
} as const
