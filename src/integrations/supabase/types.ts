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
      ai_response_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          function_name: string
          id: string
          input_tokens: number
          model: string | null
          output_tokens: number
          response_data: Json
          team_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at?: string
          function_name: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          response_data: Json
          team_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          function_name?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          response_data?: Json
          team_id?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          created_at: string
          error_message: string | null
          estimated_cost_usd: number
          function_name: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          proposal_id: string | null
          provider: string
          status: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number
          function_name: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          proposal_id?: string | null
          provider?: string
          status?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number
          function_name?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          proposal_id?: string | null
          provider?: string
          status?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
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
          team_id: string
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
          team_id: string
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
          team_id?: string
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
          team_id: string
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
          team_id: string
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
          team_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          cage_code: string | null
          capabilities_narrative: string | null
          certifications: string[]
          contract_vehicles: string[]
          created_at: string
          created_by: string | null
          duns: string | null
          external_ref: Json | null
          has_nda: boolean
          has_teaming_agreement: boolean
          id: string
          is_existing_partner: boolean
          is_own_company: boolean
          marketplace_listing: Json
          marketplace_visibility: string
          naics_codes: string[]
          name: string
          notes: string | null
          past_performance: Json
          poc_email: string | null
          poc_name: string | null
          poc_phone: string | null
          prior_contract_together: boolean
          relationship_status: string
          relationship_strength: number | null
          set_asides: string[]
          source: string
          team_id: string
          uei: string | null
          updated_at: string
          website: string | null
          worked_together_before: boolean
        }
        Insert: {
          cage_code?: string | null
          capabilities_narrative?: string | null
          certifications?: string[]
          contract_vehicles?: string[]
          created_at?: string
          created_by?: string | null
          duns?: string | null
          external_ref?: Json | null
          has_nda?: boolean
          has_teaming_agreement?: boolean
          id?: string
          is_existing_partner?: boolean
          is_own_company?: boolean
          marketplace_listing?: Json
          marketplace_visibility?: string
          naics_codes?: string[]
          name: string
          notes?: string | null
          past_performance?: Json
          poc_email?: string | null
          poc_name?: string | null
          poc_phone?: string | null
          prior_contract_together?: boolean
          relationship_status?: string
          relationship_strength?: number | null
          set_asides?: string[]
          source?: string
          team_id: string
          uei?: string | null
          updated_at?: string
          website?: string | null
          worked_together_before?: boolean
        }
        Update: {
          cage_code?: string | null
          capabilities_narrative?: string | null
          certifications?: string[]
          contract_vehicles?: string[]
          created_at?: string
          created_by?: string | null
          duns?: string | null
          external_ref?: Json | null
          has_nda?: boolean
          has_teaming_agreement?: boolean
          id?: string
          is_existing_partner?: boolean
          is_own_company?: boolean
          marketplace_listing?: Json
          marketplace_visibility?: string
          naics_codes?: string[]
          name?: string
          notes?: string | null
          past_performance?: Json
          poc_email?: string | null
          poc_name?: string | null
          poc_phone?: string | null
          prior_contract_together?: boolean
          relationship_status?: string
          relationship_strength?: number | null
          set_asides?: string[]
          source?: string
          team_id?: string
          uei?: string | null
          updated_at?: string
          website?: string | null
          worked_together_before?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "companies_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profile: {
        Row: {
          id: string
          profile_data: Json
          team_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          profile_data: Json
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          profile_data?: Json
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profile_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_vehicles: {
        Row: {
          awarding_agency: string | null
          ceiling_value: number | null
          contract_number: string | null
          created_at: string
          created_by: string | null
          id: string
          naics_codes: string[]
          notes: string | null
          ordering_guide_url: string | null
          period_of_performance_end: string | null
          period_of_performance_start: string | null
          status: string
          team_id: string
          updated_at: string
          vehicle_name: string
          vehicle_type: string | null
        }
        Insert: {
          awarding_agency?: string | null
          ceiling_value?: number | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          naics_codes?: string[]
          notes?: string | null
          ordering_guide_url?: string | null
          period_of_performance_end?: string | null
          period_of_performance_start?: string | null
          status?: string
          team_id: string
          updated_at?: string
          vehicle_name: string
          vehicle_type?: string | null
        }
        Update: {
          awarding_agency?: string | null
          ceiling_value?: number | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          naics_codes?: string[]
          notes?: string | null
          ordering_guide_url?: string | null
          period_of_performance_end?: string | null
          period_of_performance_start?: string | null
          status?: string
          team_id?: string
          updated_at?: string
          vehicle_name?: string
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_vehicles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: string
          content: string
          created_at: string
          id: string
          source_filename: string | null
          tags: string[]
          team_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          content: string
          created_at?: string
          id?: string
          source_filename?: string | null
          tags?: string[]
          team_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          id?: string
          source_filename?: string | null
          tags?: string[]
          team_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      opportunity_intel: {
        Row: {
          body: string | null
          created_at: string
          file_storage_path: string | null
          id: string
          intel_type: string
          occurred_on: string | null
          proposal_id: string
          source_name: string | null
          team_id: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          file_storage_path?: string | null
          id?: string
          intel_type: string
          occurred_on?: string | null
          proposal_id: string
          source_name?: string | null
          team_id?: string | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          file_storage_path?: string | null
          id?: string
          intel_type?: string
          occurred_on?: string | null
          proposal_id?: string
          source_name?: string | null
          team_id?: string | null
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_intel_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      past_performance: {
        Row: {
          agency: string
          annual_value: number | null
          client_poc_email: string | null
          client_poc_name: string | null
          client_poc_phone: string | null
          client_poc_title: string | null
          contract_number: string | null
          contract_title: string
          contract_type: string | null
          contract_vehicle: string | null
          cpars_rating: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          lessons_learned: string | null
          naics_code: string | null
          period_of_performance_end: string | null
          period_of_performance_start: string | null
          place_of_performance: string | null
          prime_or_sub: string | null
          psc_code: string | null
          relevance_keywords: string[]
          sub_agency: string | null
          task_order_number: string | null
          team_id: string
          total_value: number | null
          updated_at: string
        }
        Insert: {
          agency: string
          annual_value?: number | null
          client_poc_email?: string | null
          client_poc_name?: string | null
          client_poc_phone?: string | null
          client_poc_title?: string | null
          contract_number?: string | null
          contract_title: string
          contract_type?: string | null
          contract_vehicle?: string | null
          cpars_rating?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lessons_learned?: string | null
          naics_code?: string | null
          period_of_performance_end?: string | null
          period_of_performance_start?: string | null
          place_of_performance?: string | null
          prime_or_sub?: string | null
          psc_code?: string | null
          relevance_keywords?: string[]
          sub_agency?: string | null
          task_order_number?: string | null
          team_id: string
          total_value?: number | null
          updated_at?: string
        }
        Update: {
          agency?: string
          annual_value?: number | null
          client_poc_email?: string | null
          client_poc_name?: string | null
          client_poc_phone?: string | null
          client_poc_title?: string | null
          contract_number?: string | null
          contract_title?: string
          contract_type?: string | null
          contract_vehicle?: string | null
          cpars_rating?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lessons_learned?: string | null
          naics_code?: string | null
          period_of_performance_end?: string | null
          period_of_performance_start?: string | null
          place_of_performance?: string | null
          prime_or_sub?: string | null
          psc_code?: string | null
          relevance_keywords?: string[]
          sub_agency?: string | null
          task_order_number?: string | null
          team_id?: string
          total_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "past_performance_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
          notes: string | null
          parsed_content: string | null
          proposal_id: string
          size_bytes: number | null
          source: string | null
          storage_path: string | null
          uploaded_at: string
        }
        Insert: {
          file_type?: string | null
          filename: string
          id?: string
          notes?: string | null
          parsed_content?: string | null
          proposal_id: string
          size_bytes?: number | null
          source?: string | null
          storage_path?: string | null
          uploaded_at?: string
        }
        Update: {
          file_type?: string | null
          filename?: string
          id?: string
          notes?: string | null
          parsed_content?: string | null
          proposal_id?: string
          size_bytes?: number | null
          source?: string | null
          storage_path?: string | null
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
          team_id: string | null
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
          team_id?: string | null
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
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_drafts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_milestones: {
        Row: {
          assignee_id: string | null
          created_at: string
          due_date: string
          id: string
          notes: string | null
          proposal_id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          due_date: string
          id?: string
          notes?: string | null
          proposal_id: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          due_date?: string
          id?: string
          notes?: string | null
          proposal_id?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_milestones_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_outreach_drafts: {
        Row: {
          content: string
          created_at: string
          fit_rationale: Json
          generated_by: string
          id: string
          outreach_type: string
          partner_id: string | null
          partner_name: string
          proposal_id: string
          relationship_model: string
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          fit_rationale?: Json
          generated_by: string
          id?: string
          outreach_type?: string
          partner_id?: string | null
          partner_name: string
          proposal_id: string
          relationship_model?: string
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          fit_rationale?: Json
          generated_by?: string
          id?: string
          outreach_type?: string
          partner_id?: string | null
          partner_name?: string
          proposal_id?: string
          relationship_model?: string
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_outreach_drafts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "teaming_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_outreach_drafts_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_teaming: {
        Row: {
          company_id: string
          created_at: string
          id: string
          naics_contribution: string[]
          notes: string | null
          partner_id: string | null
          proposal_id: string
          role: string
          updated_at: string
          work_share_pct: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          naics_contribution?: string[]
          notes?: string | null
          partner_id?: string | null
          proposal_id: string
          role?: string
          updated_at?: string
          work_share_pct?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          naics_contribution?: string[]
          notes?: string | null
          partner_id?: string | null
          proposal_id?: string
          role?: string
          updated_at?: string
          work_share_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_teaming_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_teaming_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "teaming_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_teaming_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          agency: string | null
          capture_analysis: Json | null
          capture_analysis_at: string | null
          capture_notes: string | null
          capture_stage: string
          clearance_requirement: string | null
          competitive_notes: string | null
          compliance_gaps: number | null
          compliance_matrix: Json | null
          contract_type: string | null
          created_at: string
          customer_intel: Json | null
          customer_intel_verified: boolean | null
          customer_notes: string | null
          engagement_type: string
          estimated_value: number | null
          id: string
          incumbent_notes: string | null
          known_incumbent: string | null
          management_approach: Json | null
          market_snapshot: Json | null
          market_snapshot_at: string | null
          naics_code: string | null
          notice_id: string | null
          oci_screening: Json
          opportunity_data: Json | null
          opportunity_source: string | null
          opportunity_source_id: string | null
          opportunity_team_id: string | null
          opportunity_title: string | null
          opportunity_type: string | null
          parsing_status: string
          pop_base_months: number | null
          pop_option_months: number | null
          price_strategy: Json | null
          pricing: Json | null
          prime_contractor_id: string | null
          prime_contractor_name: string | null
          pursuit_type: string
          readiness_score: number | null
          response_deadline: string | null
          sections: Json | null
          selected_past_performance: string[]
          set_aside: string | null
          solicitation_number: string
          staffing_plan: Json | null
          status: string
          targeted_scope_areas: string | null
          team_id: string | null
          technical_approach: Json | null
          transition_plan: Json | null
          updated_at: string
          user_id: string
          user_notes: string | null
        }
        Insert: {
          agency?: string | null
          capture_analysis?: Json | null
          capture_analysis_at?: string | null
          capture_notes?: string | null
          capture_stage?: string
          clearance_requirement?: string | null
          competitive_notes?: string | null
          compliance_gaps?: number | null
          compliance_matrix?: Json | null
          contract_type?: string | null
          created_at?: string
          customer_intel?: Json | null
          customer_intel_verified?: boolean | null
          customer_notes?: string | null
          engagement_type?: string
          estimated_value?: number | null
          id?: string
          incumbent_notes?: string | null
          known_incumbent?: string | null
          management_approach?: Json | null
          market_snapshot?: Json | null
          market_snapshot_at?: string | null
          naics_code?: string | null
          notice_id?: string | null
          oci_screening?: Json
          opportunity_data?: Json | null
          opportunity_source?: string | null
          opportunity_source_id?: string | null
          opportunity_team_id?: string | null
          opportunity_title?: string | null
          opportunity_type?: string | null
          parsing_status?: string
          pop_base_months?: number | null
          pop_option_months?: number | null
          price_strategy?: Json | null
          pricing?: Json | null
          prime_contractor_id?: string | null
          prime_contractor_name?: string | null
          pursuit_type?: string
          readiness_score?: number | null
          response_deadline?: string | null
          sections?: Json | null
          selected_past_performance?: string[]
          set_aside?: string | null
          solicitation_number: string
          staffing_plan?: Json | null
          status?: string
          targeted_scope_areas?: string | null
          team_id?: string | null
          technical_approach?: Json | null
          transition_plan?: Json | null
          updated_at?: string
          user_id: string
          user_notes?: string | null
        }
        Update: {
          agency?: string | null
          capture_analysis?: Json | null
          capture_analysis_at?: string | null
          capture_notes?: string | null
          capture_stage?: string
          clearance_requirement?: string | null
          competitive_notes?: string | null
          compliance_gaps?: number | null
          compliance_matrix?: Json | null
          contract_type?: string | null
          created_at?: string
          customer_intel?: Json | null
          customer_intel_verified?: boolean | null
          customer_notes?: string | null
          engagement_type?: string
          estimated_value?: number | null
          id?: string
          incumbent_notes?: string | null
          known_incumbent?: string | null
          management_approach?: Json | null
          market_snapshot?: Json | null
          market_snapshot_at?: string | null
          naics_code?: string | null
          notice_id?: string | null
          oci_screening?: Json
          opportunity_data?: Json | null
          opportunity_source?: string | null
          opportunity_source_id?: string | null
          opportunity_team_id?: string | null
          opportunity_title?: string | null
          opportunity_type?: string | null
          parsing_status?: string
          pop_base_months?: number | null
          pop_option_months?: number | null
          price_strategy?: Json | null
          pricing?: Json | null
          prime_contractor_id?: string | null
          prime_contractor_name?: string | null
          pursuit_type?: string
          readiness_score?: number | null
          response_deadline?: string | null
          sections?: Json | null
          selected_past_performance?: string[]
          set_aside?: string | null
          solicitation_number?: string
          staffing_plan?: Json | null
          status?: string
          targeted_scope_areas?: string | null
          team_id?: string | null
          technical_approach?: Json | null
          transition_plan?: Json | null
          updated_at?: string
          user_id?: string
          user_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_opportunity_team_id_fkey"
            columns: ["opportunity_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pwin_scenarios: {
        Row: {
          created_at: string
          created_by: string
          engagement_type: string
          factor_scores: Json
          id: string
          opportunity_context: Json
          perspective_company_id: string | null
          proposal_id: string | null
          pwin_score: number
          recommended_action: string | null
          relationship_model: string
          scenario_name: string
          scope_label: string | null
          strengths: Json
          targeted_scope_areas: string | null
          team_composition: Json
          tracked_opportunity_id: string | null
          updated_at: string
          weaknesses: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          engagement_type?: string
          factor_scores?: Json
          id?: string
          opportunity_context?: Json
          perspective_company_id?: string | null
          proposal_id?: string | null
          pwin_score?: number
          recommended_action?: string | null
          relationship_model?: string
          scenario_name: string
          scope_label?: string | null
          strengths?: Json
          targeted_scope_areas?: string | null
          team_composition?: Json
          tracked_opportunity_id?: string | null
          updated_at?: string
          weaknesses?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          engagement_type?: string
          factor_scores?: Json
          id?: string
          opportunity_context?: Json
          perspective_company_id?: string | null
          proposal_id?: string | null
          pwin_score?: number
          recommended_action?: string | null
          relationship_model?: string
          scenario_name?: string
          scope_label?: string | null
          strengths?: Json
          targeted_scope_areas?: string | null
          team_composition?: Json
          tracked_opportunity_id?: string | null
          updated_at?: string
          weaknesses?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pwin_scenarios_perspective_company_id_fkey"
            columns: ["perspective_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pwin_scenarios_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pwin_scenarios_tracked_opportunity_id_fkey"
            columns: ["tracked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "tracked_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      starred_opportunities: {
        Row: {
          created_at: string
          id: string
          naics_code: string | null
          notice_id: string
          posted_date: string | null
          response_deadline: string | null
          set_aside_description: string | null
          source_data: Json | null
          team_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          naics_code?: string | null
          notice_id: string
          posted_date?: string | null
          response_deadline?: string | null
          set_aside_description?: string | null
          source_data?: Json | null
          team_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          naics_code?: string | null
          notice_id?: string
          posted_date?: string | null
          response_deadline?: string | null
          set_aside_description?: string | null
          source_data?: Json | null
          team_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tango_api_usage: {
        Row: {
          cached: boolean
          called_at: string
          endpoint: string
          id: string
          params: Json | null
          response_status: number | null
          team_id: string
        }
        Insert: {
          cached?: boolean
          called_at?: string
          endpoint: string
          id?: string
          params?: Json | null
          response_status?: number | null
          team_id: string
        }
        Update: {
          cached?: boolean
          called_at?: string
          endpoint?: string
          id?: string
          params?: Json | null
          response_status?: number | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tango_api_usage_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tango_cached_contracts: {
        Row: {
          agency: string | null
          award_date: string | null
          base_and_all_options: number | null
          contract_type: string | null
          description: string | null
          fetched_at: string
          id: string
          idv_piid: string | null
          naics_code: string | null
          obligated_amount: number | null
          parent_award_id: string | null
          period_of_performance_end: string | null
          period_of_performance_start: string | null
          piid: string | null
          psc_code: string | null
          raw_data: Json | null
          set_aside: string | null
          tango_id: string
          team_id: string
          vehicle: string | null
          vendor_duns: string | null
          vendor_name: string | null
          vendor_uei: string | null
        }
        Insert: {
          agency?: string | null
          award_date?: string | null
          base_and_all_options?: number | null
          contract_type?: string | null
          description?: string | null
          fetched_at?: string
          id?: string
          idv_piid?: string | null
          naics_code?: string | null
          obligated_amount?: number | null
          parent_award_id?: string | null
          period_of_performance_end?: string | null
          period_of_performance_start?: string | null
          piid?: string | null
          psc_code?: string | null
          raw_data?: Json | null
          set_aside?: string | null
          tango_id: string
          team_id: string
          vehicle?: string | null
          vendor_duns?: string | null
          vendor_name?: string | null
          vendor_uei?: string | null
        }
        Update: {
          agency?: string | null
          award_date?: string | null
          base_and_all_options?: number | null
          contract_type?: string | null
          description?: string | null
          fetched_at?: string
          id?: string
          idv_piid?: string | null
          naics_code?: string | null
          obligated_amount?: number | null
          parent_award_id?: string | null
          period_of_performance_end?: string | null
          period_of_performance_start?: string | null
          piid?: string | null
          psc_code?: string | null
          raw_data?: Json | null
          set_aside?: string | null
          tango_id?: string
          team_id?: string
          vehicle?: string | null
          vendor_duns?: string | null
          vendor_name?: string | null
          vendor_uei?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tango_cached_contracts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tango_cached_entities: {
        Row: {
          cage_code: string | null
          city: string | null
          country: string | null
          dba_name: string | null
          fetched_at: string
          id: string
          legal_name: string | null
          naics_codes: string[] | null
          raw_data: Json | null
          small_business_types: string[] | null
          state: string | null
          tango_id: string
          team_id: string
          uei: string | null
        }
        Insert: {
          cage_code?: string | null
          city?: string | null
          country?: string | null
          dba_name?: string | null
          fetched_at?: string
          id?: string
          legal_name?: string | null
          naics_codes?: string[] | null
          raw_data?: Json | null
          small_business_types?: string[] | null
          state?: string | null
          tango_id: string
          team_id: string
          uei?: string | null
        }
        Update: {
          cage_code?: string | null
          city?: string | null
          country?: string | null
          dba_name?: string | null
          fetched_at?: string
          id?: string
          legal_name?: string | null
          naics_codes?: string[] | null
          raw_data?: Json | null
          small_business_types?: string[] | null
          state?: string | null
          tango_id?: string
          team_id?: string
          uei?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tango_cached_entities_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tango_cached_opportunities: {
        Row: {
          agency: string | null
          archive_date: string | null
          award_info: Json | null
          classification_code: string | null
          description: string | null
          fetched_at: string
          id: string
          naics_code: string | null
          naics_description: string | null
          notice_id: string | null
          office: string | null
          place_of_performance: Json | null
          point_of_contact: Json | null
          posted_date: string | null
          raw_data: Json | null
          response_deadline: string | null
          set_aside: string | null
          set_aside_description: string | null
          solicitation_number: string | null
          source_url: string | null
          tango_id: string
          team_id: string
          title: string
        }
        Insert: {
          agency?: string | null
          archive_date?: string | null
          award_info?: Json | null
          classification_code?: string | null
          description?: string | null
          fetched_at?: string
          id?: string
          naics_code?: string | null
          naics_description?: string | null
          notice_id?: string | null
          office?: string | null
          place_of_performance?: Json | null
          point_of_contact?: Json | null
          posted_date?: string | null
          raw_data?: Json | null
          response_deadline?: string | null
          set_aside?: string | null
          set_aside_description?: string | null
          solicitation_number?: string | null
          source_url?: string | null
          tango_id: string
          team_id: string
          title: string
        }
        Update: {
          agency?: string | null
          archive_date?: string | null
          award_info?: Json | null
          classification_code?: string | null
          description?: string | null
          fetched_at?: string
          id?: string
          naics_code?: string | null
          naics_description?: string | null
          notice_id?: string | null
          office?: string | null
          place_of_performance?: Json | null
          point_of_contact?: Json | null
          posted_date?: string | null
          raw_data?: Json | null
          response_deadline?: string | null
          set_aside?: string | null
          set_aside_description?: string | null
          solicitation_number?: string | null
          source_url?: string | null
          tango_id?: string
          team_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tango_cached_opportunities_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          id: string
          joined_at: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_settings: {
        Row: {
          created_at: string
          monthly_ai_budget_usd: number
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          monthly_ai_budget_usd?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          monthly_ai_budget_usd?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      teaming_partners: {
        Row: {
          cage_code: string | null
          capabilities_summary: string | null
          certifications: string[]
          company_name: string
          contract_vehicles: string[]
          created_at: string
          created_by: string | null
          external_ref: Json | null
          id: string
          is_existing_partner: boolean
          naics_codes: string[]
          notes: string | null
          past_performance_summary: string | null
          poc_email: string | null
          poc_name: string | null
          poc_phone: string | null
          relationship_status: string
          relationship_strength: number | null
          source: string
          team_id: string
          uei: string | null
          updated_at: string
          worked_together_before: boolean
        }
        Insert: {
          cage_code?: string | null
          capabilities_summary?: string | null
          certifications?: string[]
          company_name: string
          contract_vehicles?: string[]
          created_at?: string
          created_by?: string | null
          external_ref?: Json | null
          id?: string
          is_existing_partner?: boolean
          naics_codes?: string[]
          notes?: string | null
          past_performance_summary?: string | null
          poc_email?: string | null
          poc_name?: string | null
          poc_phone?: string | null
          relationship_status?: string
          relationship_strength?: number | null
          source?: string
          team_id: string
          uei?: string | null
          updated_at?: string
          worked_together_before?: boolean
        }
        Update: {
          cage_code?: string | null
          capabilities_summary?: string | null
          certifications?: string[]
          company_name?: string
          contract_vehicles?: string[]
          created_at?: string
          created_by?: string | null
          external_ref?: Json | null
          id?: string
          is_existing_partner?: boolean
          naics_codes?: string[]
          notes?: string | null
          past_performance_summary?: string | null
          poc_email?: string | null
          poc_name?: string | null
          poc_phone?: string | null
          relationship_status?: string
          relationship_strength?: number | null
          source?: string
          team_id?: string
          uei?: string | null
          updated_at?: string
          worked_together_before?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "teaming_partners_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_team_id: string | null
          slug: string
          status: string
          team_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_team_id?: string | null
          slug: string
          status?: string
          team_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_team_id?: string | null
          slug?: string
          status?: string
          team_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_team_id_fkey"
            columns: ["parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_opportunities: {
        Row: {
          agency: string
          contract_vehicle: string
          contract_vehicle_other: string | null
          created_at: string
          description: string | null
          estimated_value: number | null
          id: string
          naics_code: string
          notes: string | null
          response_deadline: string | null
          source_url: string | null
          status: string
          sub_agency: string | null
          team_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agency: string
          contract_vehicle: string
          contract_vehicle_other?: string | null
          created_at?: string
          description?: string | null
          estimated_value?: number | null
          id?: string
          naics_code: string
          notes?: string | null
          response_deadline?: string | null
          source_url?: string | null
          status?: string
          sub_agency?: string | null
          team_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agency?: string
          contract_vehicle?: string
          contract_vehicle_other?: string | null
          created_at?: string
          description?: string | null
          estimated_value?: number | null
          id?: string
          naics_code?: string
          notes?: string | null
          response_deadline?: string | null
          source_url?: string | null
          status?: string
          sub_agency?: string | null
          team_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_opportunities_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_settings: {
        Row: {
          created_at: string
          monthly_ai_budget_usd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          monthly_ai_budget_usd?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          monthly_ai_budget_usd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          team_id: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          team_id?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          team_id?: string | null
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
      has_opp_team_access_to_org: {
        Args: { _org_team_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_opp_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      team_role: {
        Args: { _team_id: string; _user_id: string }
        Returns: string
      }
      team_role_in: {
        Args: { _roles: string[]; _team_id: string; _user_id: string }
        Returns: boolean
      }
      team_type: { Args: { _team_id: string }; Returns: string }
      user_can_see_proposal: {
        Args: { _proposal_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_see_tracked: {
        Args: { _id: string; _user_id: string }
        Returns: boolean
      }
      users_share_team: { Args: { _a: string; _b: string }; Returns: boolean }
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
