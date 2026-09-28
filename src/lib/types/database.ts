// Generated via `supabase gen types typescript --linked --schema public`
// against the calibur-inventory Supabase project. Do not hand-edit;
// regenerate after schema changes. The `test` schema is built from the same
// migrations (scripts/migrate.ts), so these types describe it too.

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
      asset_units: {
        Row: {
          active: boolean
          condition: string
          created_at: string
          id: string
          labelled: boolean | null
          last_checked_on: string | null
          last_seen_location: string | null
          legacy_ref: string | null
          loan_due: string | null
          loaned_from: string | null
          notes: string | null
          ownership: string
          product_id: string
          serial_number: string | null
          unit_code: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          condition?: string
          created_at?: string
          id?: string
          labelled?: boolean | null
          last_checked_on?: string | null
          last_seen_location?: string | null
          legacy_ref?: string | null
          loan_due?: string | null
          loaned_from?: string | null
          notes?: string | null
          ownership?: string
          product_id: string
          serial_number?: string | null
          unit_code: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          condition?: string
          created_at?: string
          id?: string
          labelled?: boolean | null
          last_checked_on?: string | null
          last_seen_location?: string | null
          legacy_ref?: string | null
          loan_due?: string | null
          loaned_from?: string | null
          notes?: string | null
          ownership?: string
          product_id?: string
          serial_number?: string | null
          unit_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      holders: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          member_id: string | null
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind: string
          member_id?: string | null
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          member_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "holders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      join_code_attempts: {
        Row: {
          code_entered: string
          created_at: string
          id: number
          join_code_id: string | null
          member_id: string | null
          outcome: string
          telegram_user_id: number
          telegram_username: string | null
        }
        Insert: {
          code_entered: string
          created_at?: string
          id?: number
          join_code_id?: string | null
          member_id?: string | null
          outcome: string
          telegram_user_id: number
          telegram_username?: string | null
        }
        Update: {
          code_entered?: string
          created_at?: string
          id?: number
          join_code_id?: string | null
          member_id?: string | null
          outcome?: string
          telegram_user_id?: number
          telegram_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_code_attempts_join_code_id_fkey"
            columns: ["join_code_id"]
            isOneToOne: false
            referencedRelation: "join_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_code_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      join_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          max_uses: number
          note: string | null
          revoked_at: string | null
          used_count: number
          valid_minutes: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          max_uses: number
          note?: string | null
          revoked_at?: string | null
          used_count?: number
          valid_minutes: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          max_uses?: number
          note?: string | null
          revoked_at?: string | null
          used_count?: number
          valid_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "join_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          active: boolean
          created_at: string
          display_name: string | null
          full_name: string
          id: string
          join_code_id: string | null
          joined_at: string | null
          left_at: string | null
          notice_accepted_at: string | null
          nus_email: string | null
          role: string
          telegram_bound_at: string | null
          telegram_user_id: number | null
          telegram_username: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          full_name: string
          id?: string
          join_code_id?: string | null
          joined_at?: string | null
          left_at?: string | null
          notice_accepted_at?: string | null
          nus_email?: string | null
          role?: string
          telegram_bound_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          full_name?: string
          id?: string
          join_code_id?: string | null
          joined_at?: string | null
          left_at?: string | null
          notice_accepted_at?: string | null
          nus_email?: string | null
          role?: string
          telegram_bound_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_join_code_id_fkey"
            columns: ["join_code_id"]
            isOneToOne: false
            referencedRelation: "join_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          criticality: string
          id: string
          legacy_ref: string | null
          legacy_row: number | null
          loan_due: string | null
          loaned_from: string | null
          location_id: string | null
          min_stock: number | null
          name: string
          notes: string | null
          ownership: string
          part_number: string | null
          returnable: boolean
          spec: Json | null
          supplier: string | null
          tier: string
          unit: string
          unit_cost_sgd: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          criticality?: string
          id?: string
          legacy_ref?: string | null
          legacy_row?: number | null
          loan_due?: string | null
          loaned_from?: string | null
          location_id?: string | null
          min_stock?: number | null
          name: string
          notes?: string | null
          ownership?: string
          part_number?: string | null
          returnable?: boolean
          spec?: Json | null
          supplier?: string | null
          tier: string
          unit?: string
          unit_cost_sgd?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          criticality?: string
          id?: string
          legacy_ref?: string | null
          legacy_row?: number | null
          loan_due?: string | null
          loaned_from?: string | null
          location_id?: string | null
          min_stock?: number | null
          name?: string
          notes?: string | null
          ownership?: string
          part_number?: string | null
          returnable?: boolean
          spec?: Json | null
          supplier?: string | null
          tier?: string
          unit?: string
          unit_cost_sgd?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      review_items: {
        Row: {
          created_at: string
          entity: string
          id: number
          issue: string
          product_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string | null
          status: string
          subject: string
        }
        Insert: {
          created_at?: string
          entity: string
          id?: number
          issue: string
          product_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source?: string | null
          status?: string
          subject: string
        }
        Update: {
          created_at?: string
          entity?: string
          id?: number
          issue?: string
          product_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "review_items_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          kind: string
          label: string | null
          location_id: string | null
          product_id: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          kind: string
          label?: string | null
          location_id?: string | null
          product_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          kind?: string
          label?: string | null
          location_id?: string | null
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_codes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_summary"
            referencedColumns: ["product_id"]
          },
        ]
      }
      scan_misses: {
        Row: {
          code: string
          created_at: string
          id: number
          member_id: string | null
          outcome: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: number
          member_id?: string | null
          outcome: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: number
          member_id?: string | null
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_misses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          client_token: string | null
          committed_at: string | null
          dest_holder_id: string | null
          id: string
          location_id: string | null
          member_id: string
          mode: string
          note: string | null
          source: string
          started_at: string
        }
        Insert: {
          client_token?: string | null
          committed_at?: string | null
          dest_holder_id?: string | null
          id?: string
          location_id?: string | null
          member_id: string
          mode: string
          note?: string | null
          source: string
          started_at?: string
        }
        Update: {
          client_token?: string | null
          committed_at?: string | null
          dest_holder_id?: string | null
          id?: string
          location_id?: string | null
          member_id?: string
          mode?: string
          note?: string | null
          source?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_dest_holder_id_fkey"
            columns: ["dest_holder_id"]
            isOneToOne: false
            referencedRelation: "holders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          counted_by: string | null
          counted_qty: number
          created_at: string
          expected_qty: number
          holder_id: string
          id: string
          movement_id: number | null
          note: string | null
          product_id: string
          session_id: string
        }
        Insert: {
          counted_by?: string | null
          counted_qty: number
          created_at?: string
          expected_qty: number
          holder_id: string
          id?: string
          movement_id?: number | null
          note?: string | null
          product_id: string
          session_id: string
        }
        Update: {
          counted_by?: string | null
          counted_qty?: number
          created_at?: string
          expected_qty?: number
          holder_id?: string
          id?: string
          movement_id?: number | null
          note?: string | null
          product_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_holder_id_fkey"
            columns: ["holder_id"]
            isOneToOne: false
            referencedRelation: "holders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_counts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          actor_member_id: string | null
          created_at: string
          entry_method: string | null
          from_holder_id: string
          id: number
          product_id: string
          qty: number
          reason: string | null
          reverses_movement_id: number | null
          scan_code: string | null
          session_id: string | null
          to_holder_id: string
        }
        Insert: {
          actor_member_id?: string | null
          created_at?: string
          entry_method?: string | null
          from_holder_id: string
          id?: number
          product_id: string
          qty: number
          reason?: string | null
          reverses_movement_id?: number | null
          scan_code?: string | null
          session_id?: string | null
          to_holder_id: string
        }
        Update: {
          actor_member_id?: string | null
          created_at?: string
          entry_method?: string | null
          from_holder_id?: string
          id?: number
          product_id?: string
          qty?: number
          reason?: string | null
          reverses_movement_id?: number | null
          scan_code?: string | null
          session_id?: string | null
          to_holder_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_holder_id_fkey"
            columns: ["from_holder_id"]
            isOneToOne: false
            referencedRelation: "holders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_holder_id_fkey"
            columns: ["to_holder_id"]
            isOneToOne: false
            referencedRelation: "holders"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bind_attempts: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          resolved_member: string | null
          scan_code: string | null
          telegram_user_id: number
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          resolved_member?: string | null
          scan_code?: string | null
          telegram_user_id: number
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          resolved_member?: string | null
          scan_code?: string | null
          telegram_user_id?: number
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_bind_attempts_resolved_member_fkey"
            columns: ["resolved_member"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      holdings: {
        Row: {
          holder_id: string | null
          product_id: string | null
          qty: number | null
        }
        Relationships: []
      }
      stock_summary: {
        Row: {
          location_id: string | null
          min_stock: number | null
          name: string | null
          product_id: string | null
          qty_consumed: number | null
          qty_in_store: number | null
          qty_out: number | null
          tier: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_actor_member_id: { Args: { p_fallback: string }; Returns: string }
      admin_commit_stocktake: {
        Args: {
          p_actor_member_id?: string
          p_client_token?: string
          p_counts: Json
          p_holder_id?: string
          p_location_id?: string
          p_note?: string
        }
        Returns: string
      }
      admin_restock: {
        Args: {
          p_actor_member_id?: string
          p_client_token?: string
          p_lines: Json
          p_note?: string
        }
        Returns: string
      }
      admin_reverse_movement: {
        Args: {
          p_actor_member_id?: string
          p_client_token?: string
          p_movement_id: number
          p_note?: string
        }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      join_with_code: {
        Args: {
          p_code: string
          p_display_name: string
          p_email: string
          p_full_name: string
          p_telegram_user_id: number
          p_telegram_username: string
        }
        Returns: Json
      }
      submit_cart: {
        Args: {
          p_client_token?: string
          p_dest_holder_id: string
          p_lines: Json
          p_member_id: string
          p_mode: string
          p_source: string
          p_source_holder_id: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
