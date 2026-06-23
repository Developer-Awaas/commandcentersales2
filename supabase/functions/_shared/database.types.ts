/**
 * Hand-written DB types derived from supabase/migrations/*.sql
 *
 * IMPORTANT: Update types must be concrete (not Partial<Insert>) — the
 * self-referential Partial<Database[...]['Insert']> pattern causes
 * @supabase/supabase-js to collapse query builder types to `never`.
 *
 * To regenerate from the live project:
 *   SUPABASE_ACCESS_TOKEN=<token> supabase gen types typescript \
 *     --project-id mpvdpdxzqnidwyihyhbn > supabase/functions/_shared/database.types.ts
 *
 * Update this file whenever a new migration adds/alters columns.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Rel = {
  foreignKeyName: string
  columns: string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: string[]
}

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string | null
          brand_colors: string | null
          tone_of_voice: string | null
          whatsapp_number: string | null
          primary_city: string | null
          secondary_city: string | null
          fb_page_url: string | null
          ig_page_url: string | null
          default_age_range: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name?: string
          slug?: string | null
          brand_colors?: string | null
          tone_of_voice?: string | null
          whatsapp_number?: string | null
          primary_city?: string | null
          secondary_city?: string | null
          fb_page_url?: string | null
          ig_page_url?: string | null
          default_age_range?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string | null
          brand_colors?: string | null
          tone_of_voice?: string | null
          whatsapp_number?: string | null
          primary_city?: string | null
          secondary_city?: string | null
          fb_page_url?: string | null
          ig_page_url?: string | null
          default_age_range?: string | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          org_id: string | null
          module_access: string[] | null
          role: string
          avatar_url: string | null
          learning_mode: boolean | null
          is_active: boolean | null
          daily_ai_limit: number | null
          tier: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          org_id?: string | null
          module_access?: string[] | null
          role?: string
          avatar_url?: string | null
          learning_mode?: boolean | null
          is_active?: boolean | null
          daily_ai_limit?: number | null
          tier?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          org_id?: string | null
          module_access?: string[] | null
          role?: string
          avatar_url?: string | null
          learning_mode?: boolean | null
          is_active?: boolean | null
          daily_ai_limit?: number | null
          tier?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: Rel[]
      }

      projects: {
        Row: {
          id: string
          org_id: string | null
          name: string
          locality: string | null
          city: string | null
          total_units: number | null
          units_remaining: number | null
          price_min: number | null
          price_max: number | null
          priority: string | null
          is_active: boolean | null
          default_ad_format: string | null
          meta_ad_account_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          name?: string
          locality?: string | null
          city?: string | null
          total_units?: number | null
          units_remaining?: number | null
          price_min?: number | null
          price_max?: number | null
          priority?: string | null
          is_active?: boolean | null
          default_ad_format?: string | null
          meta_ad_account_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          name?: string
          locality?: string | null
          city?: string | null
          total_units?: number | null
          units_remaining?: number | null
          price_min?: number | null
          price_max?: number | null
          priority?: string | null
          is_active?: boolean | null
          default_ad_format?: string | null
          meta_ad_account_id?: string | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      campaigns: {
        Row: {
          id: string
          org_id: string | null
          project_id: string | null
          name: string
          platform: string | null
          status: string | null
          budget: number | null
          meta_campaign_id: string | null
          creative_status: 'no_creatives' | 'generating' | 'ready' | 'approved' | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          name?: string
          platform?: string | null
          status?: string | null
          budget?: number | null
          meta_campaign_id?: string | null
          creative_status?: 'no_creatives' | 'generating' | 'ready' | 'approved' | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          name?: string
          platform?: string | null
          status?: string | null
          budget?: number | null
          meta_campaign_id?: string | null
          creative_status?: 'no_creatives' | 'generating' | 'ready' | 'approved' | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      daily_metrics: {
        Row: {
          id: string
          org_id: string | null
          campaign_id: string | null
          date: string
          spend: number | null
          leads: number | null
          impressions: number | null
          clicks: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          campaign_id?: string | null
          date?: string
          spend?: number | null
          leads?: number | null
          impressions?: number | null
          clicks?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          campaign_id?: string | null
          date?: string
          spend?: number | null
          leads?: number | null
          impressions?: number | null
          clicks?: number | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      notifications: {
        Row: {
          id: string
          org_id: string | null
          user_id: string | null
          title: string
          message: string | null
          type: string | null
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          user_id?: string | null
          title?: string
          message?: string | null
          type?: string | null
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          user_id?: string | null
          title?: string
          message?: string | null
          type?: string | null
          is_read?: boolean
          created_at?: string
        }
        Relationships: Rel[]
      }

      ai_sessions: {
        Row: {
          id: string
          org_id: string | null
          user_id: string | null
          type: string | null
          session_type: string | null
          project_id: string | null
          project_ids: string[] | null
          input_summary: string | null
          input_data: Json | null
          output: string | null
          output_data: Json | null
          health_score: number | null
          tokens_used: number | null
          claude_input_tokens: number
          claude_output_tokens: number
          gemini_images_generated: number
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          user_id?: string | null
          type?: string | null
          session_type?: string | null
          project_id?: string | null
          project_ids?: string[] | null
          input_summary?: string | null
          input_data?: Json | null
          output?: string | null
          output_data?: Json | null
          health_score?: number | null
          tokens_used?: number | null
          claude_input_tokens?: number
          claude_output_tokens?: number
          gemini_images_generated?: number
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          user_id?: string | null
          type?: string | null
          session_type?: string | null
          project_id?: string | null
          project_ids?: string[] | null
          input_summary?: string | null
          input_data?: Json | null
          output?: string | null
          output_data?: Json | null
          health_score?: number | null
          tokens_used?: number | null
          claude_input_tokens?: number
          claude_output_tokens?: number
          gemini_images_generated?: number
          created_at?: string
        }
        Relationships: Rel[]
      }

      activity_log: {
        Row: {
          id: string
          org_id: string
          user_id: string
          action: string
          entity_type: string | null
          entity_id: string | null
          details: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id?: string
          action: string
          entity_type?: string | null
          entity_id?: string | null
          details?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          details?: Json | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      awaas_data_pool: {
        Row: Record<string, unknown> & { id: string }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: Rel[]
      }

      targeting_keywords: {
        Row: {
          id: string
          org_id: string | null
          project_id: string | null
          keyword: string
          category: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          keyword: string
          category?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          keyword?: string
          category?: string | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      chatbot_log: {
        Row: {
          id: string
          org_id: string | null
          user_id: string | null
          messages: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          user_id?: string | null
          messages?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          user_id?: string | null
          messages?: Json | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      org_integrations: {
        Row: {
          id: string
          org_id: string
          provider: 'meta' | 'google_ads'
          meta_ad_account_id: string | null
          meta_access_token: string | null
          token_expires_at: string | null
          is_active: boolean
          last_sync_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider: 'meta' | 'google_ads'
          meta_ad_account_id?: string | null
          meta_access_token?: string | null
          token_expires_at?: string | null
          is_active?: boolean
          last_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          provider?: 'meta' | 'google_ads'
          meta_ad_account_id?: string | null
          meta_access_token?: string | null
          token_expires_at?: string | null
          is_active?: boolean
          last_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: Rel[]
      }

      org_user_integrations: {
        Row: {
          id: string
          org_id: string
          user_id: string
          provider: 'canva' | 'adobe_express'
          access_token: string
          refresh_token: string | null
          token_expires_at: string | null
          scopes: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          provider: 'canva' | 'adobe_express'
          access_token: string
          refresh_token?: string | null
          token_expires_at?: string | null
          scopes?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          provider?: 'canva' | 'adobe_express'
          access_token?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          scopes?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Relationships: Rel[]
      }

      campaign_metrics: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          campaign_id: string
          campaign_name: string | null
          ad_account_id: string | null
          date_start: string
          date_stop: string
          impressions: number
          clicks: number
          reach: number
          spend: number
          ctr: number
          frequency: number
          leads: number
          cpl: number | null
          roas: number | null
          platform: 'meta' | 'google'
          synced_at: string
          raw_payload: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          campaign_id: string
          campaign_name?: string | null
          ad_account_id?: string | null
          date_start: string
          date_stop: string
          impressions?: number
          clicks?: number
          reach?: number
          spend?: number
          ctr?: number
          frequency?: number
          leads?: number
          cpl?: number | null
          roas?: number | null
          platform: 'meta' | 'google'
          synced_at?: string
          raw_payload?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string | null
          campaign_id?: string
          campaign_name?: string | null
          ad_account_id?: string | null
          date_start?: string
          date_stop?: string
          impressions?: number
          clicks?: number
          reach?: number
          spend?: number
          ctr?: number
          frequency?: number
          leads?: number
          cpl?: number | null
          roas?: number | null
          platform?: 'meta' | 'google'
          synced_at?: string
          raw_payload?: Json | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      creative_assets: {
        Row: {
          id: string
          org_id: string
          campaign_id: string | null
          creative_id: string | null
          session_id: string | null
          funnel_stage: 'awareness' | 'consideration' | 'conversion'
          angle: 'lifestyle' | 'architecture' | 'amenity' | 'community' | 'value'
          image_url: string
          edited_image_url: string | null
          storage_path: string
          prompt_used: string | null
          model_used: string | null
          canva_design_id: string | null
          canva_edit_url: string | null
          editor_used: 'canva' | 'adobe_express' | null
          status: 'generating' | 'generated' | 'editing' | 'edited' | 'approved' | 'rejected'
          approved_by: string | null
          approved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          campaign_id?: string | null
          creative_id?: string | null
          session_id?: string | null
          funnel_stage: 'awareness' | 'consideration' | 'conversion'
          angle: 'lifestyle' | 'architecture' | 'amenity' | 'community' | 'value'
          image_url: string
          edited_image_url?: string | null
          storage_path: string
          prompt_used?: string | null
          model_used?: string | null
          canva_design_id?: string | null
          canva_edit_url?: string | null
          editor_used?: 'canva' | 'adobe_express' | null
          status?: 'generating' | 'generated' | 'editing' | 'edited' | 'approved' | 'rejected'
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          campaign_id?: string | null
          creative_id?: string | null
          session_id?: string | null
          funnel_stage?: 'awareness' | 'consideration' | 'conversion'
          angle?: 'lifestyle' | 'architecture' | 'amenity' | 'community' | 'value'
          image_url?: string
          edited_image_url?: string | null
          storage_path?: string
          prompt_used?: string | null
          model_used?: string | null
          canva_design_id?: string | null
          canva_edit_url?: string | null
          editor_used?: 'canva' | 'adobe_express' | null
          status?: 'generating' | 'generated' | 'editing' | 'edited' | 'approved' | 'rejected'
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: Rel[]
      }

      integration_sync_log: {
        Row: {
          id: string
          org_id: string
          provider: string
          status: 'success' | 'error' | 'throttled' | 'skipped'
          rows_synced: number
          error: string | null
          throttle_pct: number | null
          duration_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider: string
          status: 'success' | 'error' | 'throttled' | 'skipped'
          rows_synced?: number
          error?: string | null
          throttle_pct?: number | null
          duration_ms?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          provider?: string
          status?: 'success' | 'error' | 'throttled' | 'skipped'
          rows_synced?: number
          error?: string | null
          throttle_pct?: number | null
          duration_ms?: number | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      competitors: {
        Row: {
          id: string
          org_id: string | null
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          name?: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          name?: string
          created_at?: string
        }
        Relationships: Rel[]
      }

      brand_kits: {
        Row: {
          id: string
          /** UNIQUE — one kit per org. No project_id. See CLAUDE.md §brand_kits constraint. */
          org_id: string | null
          primary_color: string | null
          secondary_color: string | null
          accent_color: string | null
          text_color: string | null
          background_color: string | null
          primary_font: string | null
          secondary_font: string | null
          display_font: string | null
          tagline: string | null
          brand_voice: string | null
          brand_story: string | null
          logo_color_url: string | null
          logo_white_url: string | null
          logo_dark_url: string | null
          design_aesthetic: 'premium_minimal' | 'luxury_opulent' | 'warm_aspirational' | 'contemporary_urban' | 'custom' | null
          cultural_motifs: string[] | null
          reference_brands: string[] | null
          default_languages: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          accent_color?: string | null
          text_color?: string | null
          background_color?: string | null
          primary_font?: string | null
          secondary_font?: string | null
          display_font?: string | null
          tagline?: string | null
          brand_voice?: string | null
          brand_story?: string | null
          logo_color_url?: string | null
          logo_white_url?: string | null
          logo_dark_url?: string | null
          design_aesthetic?: 'premium_minimal' | 'luxury_opulent' | 'warm_aspirational' | 'contemporary_urban' | 'custom' | null
          cultural_motifs?: string[] | null
          reference_brands?: string[] | null
          default_languages?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          accent_color?: string | null
          text_color?: string | null
          background_color?: string | null
          primary_font?: string | null
          secondary_font?: string | null
          display_font?: string | null
          tagline?: string | null
          brand_voice?: string | null
          brand_story?: string | null
          logo_color_url?: string | null
          logo_white_url?: string | null
          logo_dark_url?: string | null
          design_aesthetic?: 'premium_minimal' | 'luxury_opulent' | 'warm_aspirational' | 'contemporary_urban' | 'custom' | null
          cultural_motifs?: string[] | null
          reference_brands?: string[] | null
          default_languages?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Relationships: Rel[]
      }

      lead_funnel: {
        Row: {
          id: string
          org_id: string | null
          project_id: string | null
          week_start: string
          total_leads: number
          contacted: number
          sv_done: number
          booked: number
        }
        Insert: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          week_start?: string
          total_leads?: number
          contacted?: number
          sv_done?: number
          booked?: number
        }
        Update: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          week_start?: string
          total_leads?: number
          contacted?: number
          sv_done?: number
          booked?: number
        }
        Relationships: Rel[]
      }

      organic_plans: {
        Row: {
          id: string
          org_id: string | null
          week_start: string
          status: 'draft' | 'published'
          plan_data: Json
          pillars: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          week_start?: string
          status?: 'draft' | 'published'
          plan_data?: Json
          pillars?: Json
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          week_start?: string
          status?: 'draft' | 'published'
          plan_data?: Json
          pillars?: Json
          created_at?: string
        }
        Relationships: Rel[]
      }

      events_calendar: {
        Row: {
          id: string
          org_id: string | null
          name: string
          date: string
          type: 'holiday' | 'festival' | 'custom'
          include_in_plan: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          name?: string
          date?: string
          type?: 'holiday' | 'festival' | 'custom'
          include_in_plan?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          name?: string
          date?: string
          type?: 'holiday' | 'festival' | 'custom'
          include_in_plan?: boolean
          created_at?: string
        }
        Relationships: Rel[]
      }

      smm_calendar: {
        Row: {
          id: string
          org_id: string | null
          post_date: string
          post_time: string | null
          platform: 'instagram' | 'facebook' | 'both'
          post_type: 'reel' | 'carousel' | 'static' | 'story' | 'video'
          category: string | null
          topic: string | null
          caption_en: string | null
          caption_od: string | null
          hashtags: string[] | null
          nano_prompt: string | null
          reel_script: string | null
          status: 'planned' | 'created' | 'posted' | 'skipped'
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          post_date?: string
          post_time?: string | null
          platform?: 'instagram' | 'facebook' | 'both'
          post_type?: 'reel' | 'carousel' | 'static' | 'story' | 'video'
          category?: string | null
          topic?: string | null
          caption_en?: string | null
          caption_od?: string | null
          hashtags?: string[] | null
          nano_prompt?: string | null
          reel_script?: string | null
          status?: 'planned' | 'created' | 'posted' | 'skipped'
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          post_date?: string
          post_time?: string | null
          platform?: 'instagram' | 'facebook' | 'both'
          post_type?: 'reel' | 'carousel' | 'static' | 'story' | 'video'
          category?: string | null
          topic?: string | null
          caption_en?: string | null
          caption_od?: string | null
          hashtags?: string[] | null
          nano_prompt?: string | null
          reel_script?: string | null
          status?: 'planned' | 'created' | 'posted' | 'skipped'
          created_at?: string
        }
        Relationships: Rel[]
      }

      smm_metrics: {
        Row: {
          id: string
          org_id: string | null
          platform: 'instagram' | 'facebook'
          date: string
          followers: number
          posts_published: number
        }
        Insert: {
          id?: string
          org_id?: string | null
          platform: 'instagram' | 'facebook'
          date?: string
          followers?: number
          posts_published?: number
        }
        Update: {
          id?: string
          org_id?: string | null
          platform?: 'instagram' | 'facebook'
          date?: string
          followers?: number
          posts_published?: number
        }
        Relationships: Rel[]
      }

      wizard_sessions: {
        Row: {
          id: string
          org_id: string | null
          status: 'in_progress' | 'completed' | 'abandoned'
          current_step: number
          step_data: Json
          updated_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          status?: 'in_progress' | 'completed' | 'abandoned'
          current_step?: number
          step_data?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          status?: 'in_progress' | 'completed' | 'abandoned'
          current_step?: number
          step_data?: Json
          updated_at?: string
        }
        Relationships: Rel[]
      }

      project_assets: {
        Row: {
          id: string
          project_id: string | null
          org_id: string | null
          asset_type: string | null
          asset_url: string
          thumbnail_url: string | null
          title: string | null
          description: string | null
          is_primary: boolean
          display_order: number
          created_at: string
        }
        Insert: {
          id?: string
          project_id?: string | null
          org_id?: string | null
          asset_type?: string | null
          asset_url?: string
          thumbnail_url?: string | null
          title?: string | null
          description?: string | null
          is_primary?: boolean
          display_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string | null
          org_id?: string | null
          asset_type?: string | null
          asset_url?: string
          thumbnail_url?: string | null
          title?: string | null
          description?: string | null
          is_primary?: boolean
          display_order?: number
          created_at?: string
        }
        Relationships: Rel[]
      }

      project_design_systems: {
        Row: {
          id: string
          project_id: string | null
          org_id: string | null
          best_performing_angles: Json
          best_performing_compositions: Json
          best_performing_color_treatments: Json
          best_performing_copy_angles: Json
          best_performing_lighting_styles: Json
          underperforming_patterns: Json
          total_creatives_analyzed: number
          total_campaigns_analyzed: number
          confidence_level: 'insufficient' | 'low' | 'medium' | 'high' | 'very_high'
          dna_summary: string
          prompt_fragments: Json | null
          last_recomputed_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          project_id?: string | null
          org_id?: string | null
          best_performing_angles?: Json
          best_performing_compositions?: Json
          best_performing_color_treatments?: Json
          best_performing_copy_angles?: Json
          best_performing_lighting_styles?: Json
          underperforming_patterns?: Json
          total_creatives_analyzed?: number
          total_campaigns_analyzed?: number
          confidence_level?: 'insufficient' | 'low' | 'medium' | 'high' | 'very_high'
          dna_summary?: string
          prompt_fragments?: Json | null
          last_recomputed_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string | null
          org_id?: string | null
          best_performing_angles?: Json
          best_performing_compositions?: Json
          best_performing_color_treatments?: Json
          best_performing_copy_angles?: Json
          best_performing_lighting_styles?: Json
          underperforming_patterns?: Json
          total_creatives_analyzed?: number
          total_campaigns_analyzed?: number
          confidence_level?: 'insufficient' | 'low' | 'medium' | 'high' | 'very_high'
          dna_summary?: string
          prompt_fragments?: Json | null
          last_recomputed_at?: string | null
          updated_at?: string
        }
        Relationships: Rel[]
      }

      benchmarks: {
        Row: {
          id: string
          org_id: string | null
          project_id: string | null
          metric_name: string
          current_value: number
          avg_7d: number
          avg_14d: number
          trend: 'up' | 'down' | '→'
          status: string
          date: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          metric_name?: string
          current_value?: number
          avg_7d?: number
          avg_14d?: number
          trend?: 'up' | 'down' | '→'
          status?: string
          date?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          metric_name?: string
          current_value?: number
          avg_7d?: number
          avg_14d?: number
          trend?: 'up' | 'down' | '→'
          status?: string
          date?: string
        }
        Relationships: Rel[]
      }

      creatives: {
        Row: {
          id: string
          org_id: string | null
          project_id: string | null
          variant: string | null
          angle: string | null
          format: string | null
          headline: string | null
          primary_text: string | null
          primary_text_odia: string | null
          nano_prompt: string | null
          nano_prompt_story: string | null
          platform_used: string | null
          review_score: number
          status: 'draft' | 'active' | 'retired'
          ctr: number
          cpl: number
          retirement_reason: string | null
          design_dna_tags: Json
          cta: string | null
          senior_designer_brief: Json
          reference_image_manifest: Json
          languages: string[] | null
          design_dna: Json
          review_data: Json
          follow_up_prompt: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          variant?: string | null
          angle?: string | null
          format?: string | null
          headline?: string | null
          primary_text?: string | null
          primary_text_odia?: string | null
          nano_prompt?: string | null
          nano_prompt_story?: string | null
          platform_used?: string | null
          review_score?: number
          status?: 'draft' | 'active' | 'retired'
          ctr?: number
          cpl?: number
          retirement_reason?: string | null
          design_dna_tags?: Json
          cta?: string | null
          senior_designer_brief?: Json
          reference_image_manifest?: Json
          languages?: string[] | null
          design_dna?: Json
          review_data?: Json
          follow_up_prompt?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string | null
          project_id?: string | null
          variant?: string | null
          angle?: string | null
          format?: string | null
          headline?: string | null
          primary_text?: string | null
          primary_text_odia?: string | null
          nano_prompt?: string | null
          nano_prompt_story?: string | null
          platform_used?: string | null
          review_score?: number
          status?: 'draft' | 'active' | 'retired'
          ctr?: number
          cpl?: number
          retirement_reason?: string | null
          design_dna_tags?: Json
          cta?: string | null
          senior_designer_brief?: Json
          reference_image_manifest?: Json
          languages?: string[] | null
          design_dna?: Json
          review_data?: Json
          follow_up_prompt?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      creative_performance: {
        Row: {
          id: string
          creative_id: string | null
          campaign_id: string | null
          project_id: string | null
          org_id: string | null
          total_spend: number
          total_impressions: number
          total_clicks: number
          total_leads: number
          total_conversions: number
          cpl: number
          ctr: number
          cpm: number
          conversion_rate: number
          performance_score: number
          performance_tier: 'top_25' | 'middle_50' | 'bottom_25' | 'insufficient_data'
          design_dna_snapshot: Json
          period_start: string | null
          period_end: string | null
          created_at: string
        }
        Insert: {
          id?: string
          creative_id?: string | null
          campaign_id?: string | null
          project_id?: string | null
          org_id?: string | null
          total_spend?: number
          total_impressions?: number
          total_clicks?: number
          total_leads?: number
          total_conversions?: number
          cpl?: number
          ctr?: number
          cpm?: number
          conversion_rate?: number
          performance_score?: number
          performance_tier?: 'top_25' | 'middle_50' | 'bottom_25' | 'insufficient_data'
          design_dna_snapshot?: Json
          period_start?: string | null
          period_end?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          creative_id?: string | null
          campaign_id?: string | null
          project_id?: string | null
          org_id?: string | null
          total_spend?: number
          total_impressions?: number
          total_clicks?: number
          total_leads?: number
          total_conversions?: number
          cpl?: number
          ctr?: number
          cpm?: number
          conversion_rate?: number
          performance_score?: number
          performance_tier?: 'top_25' | 'middle_50' | 'bottom_25' | 'insufficient_data'
          design_dna_snapshot?: Json
          period_start?: string | null
          period_end?: string | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      agent_interactions: {
        Row: {
          id: string
          org_id: string
          user_id: string | null
          agent: 'aarav' | 'arjun' | 'aanya'
          trace_id: string | null
          model: string
          input_tokens: number
          output_tokens: number
          cost_usd: number
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id?: string | null
          agent: 'aarav' | 'arjun' | 'aanya'
          trace_id?: string | null
          model: string
          input_tokens?: number
          output_tokens?: number
          cost_usd?: number
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string | null
          agent?: 'aarav' | 'arjun' | 'aanya'
          trace_id?: string | null
          model?: string
          input_tokens?: number
          output_tokens?: number
          cost_usd?: number
          created_at?: string
        }
        Relationships: Rel[]
      }

      agent_turns: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          session_id: string
          status: 'pending' | 'working' | 'awaiting_user' | 'approved' | 'ready_to_launch' | 'failed'
          delegations: Json
          canvas: Json | null
          message: string | null
          awaiting_user: boolean
          approved_at: string | null
          cap_hit: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          session_id: string
          status?: 'pending' | 'working' | 'awaiting_user' | 'approved' | 'ready_to_launch' | 'failed'
          delegations?: Json
          canvas?: Json | null
          message?: string | null
          awaiting_user?: boolean
          approved_at?: string | null
          cap_hit?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string | null
          session_id?: string
          status?: 'pending' | 'working' | 'awaiting_user' | 'approved' | 'ready_to_launch' | 'failed'
          delegations?: Json
          canvas?: Json | null
          message?: string | null
          awaiting_user?: boolean
          approved_at?: string | null
          cap_hit?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: Rel[]
      }

      agent_messages: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          session_id: string
          turn_id: string | null
          role: 'user' | 'aarav'
          content: string
          canvas_snapshot: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          session_id: string
          turn_id?: string | null
          role: 'user' | 'aarav'
          content: string
          canvas_snapshot?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string | null
          session_id?: string
          turn_id?: string | null
          role?: 'user' | 'aarav'
          content?: string
          canvas_snapshot?: Json | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      agent_memory: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          turn_id: string | null
          memory_type: 'approved_campaign'
          strategy: Json | null
          selected_creatives: Json | null
          brand_verdict: Json | null
          summary: string | null
          user_brief: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          turn_id?: string | null
          memory_type?: 'approved_campaign'
          strategy?: Json | null
          selected_creatives?: Json | null
          brand_verdict?: Json | null
          summary?: string | null
          user_brief?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string | null
          turn_id?: string | null
          memory_type?: 'approved_campaign'
          strategy?: Json | null
          selected_creatives?: Json | null
          brand_verdict?: Json | null
          summary?: string | null
          user_brief?: string | null
          created_at?: string
        }
        Relationships: Rel[]
      }

      aanya_training_creatives: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          image_url: string
          storage_path: string
          source: 'own_ad' | 'competitor' | 'industry_reference' | 'winning_template'
          platform: string | null
          performance_tier: 'top_performer' | 'good_performer' | 'average' | 'underperformer' | 'reference_only'
          cpl: number | null
          ctr: number | null
          notes: string | null
          vision_analysis: Json | null
          extracted_patterns: Json | null
          is_live: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          image_url: string
          storage_path: string
          source: 'own_ad' | 'competitor' | 'industry_reference' | 'winning_template'
          platform?: string | null
          performance_tier?: 'top_performer' | 'good_performer' | 'average' | 'underperformer' | 'reference_only'
          cpl?: number | null
          ctr?: number | null
          notes?: string | null
          vision_analysis?: Json | null
          extracted_patterns?: Json | null
          is_live?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string | null
          image_url?: string
          storage_path?: string
          source?: 'own_ad' | 'competitor' | 'industry_reference' | 'winning_template'
          platform?: string | null
          performance_tier?: 'top_performer' | 'good_performer' | 'average' | 'underperformer' | 'reference_only'
          cpl?: number | null
          ctr?: number | null
          notes?: string | null
          vision_analysis?: Json | null
          extracted_patterns?: Json | null
          is_live?: boolean
          created_at?: string
        }
        Relationships: Rel[]
      }

      ad_metrics: {
        Row: {
          id: string
          org_id: string
          ad_account_id: string
          campaign_id: string
          adset_id: string | null
          ad_id: string
          ad_name: string
          date_start: string
          date_stop: string
          impressions: number
          clicks: number
          reach: number
          spend: number
          ctr: number
          leads: number
          cpl: number | null
          platform: string
          synced_at: string
          raw_payload: Json | null
        }
        Insert: {
          id?: string
          org_id: string
          ad_account_id: string
          campaign_id: string
          adset_id?: string | null
          ad_id: string
          ad_name?: string
          date_start: string
          date_stop: string
          impressions?: number
          clicks?: number
          reach?: number
          spend?: number
          ctr?: number
          leads?: number
          cpl?: number | null
          platform?: string
          synced_at?: string
          raw_payload?: Json | null
        }
        Update: {
          id?: string
          org_id?: string
          ad_account_id?: string
          campaign_id?: string
          adset_id?: string | null
          ad_id?: string
          ad_name?: string
          date_start?: string
          date_stop?: string
          impressions?: number
          clicks?: number
          reach?: number
          spend?: number
          ctr?: number
          leads?: number
          cpl?: number | null
          platform?: string
          synced_at?: string
          raw_payload?: Json | null
        }
        Relationships: Rel[]
      }
    }
    Views: Record<string, { Row: Record<string, unknown>; Relationships: Rel[] }>
    Functions: {
      get_current_user_org_id: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: Record<string, string[]>
    CompositeTypes: Record<string, Record<string, unknown> | null>
  }
}
