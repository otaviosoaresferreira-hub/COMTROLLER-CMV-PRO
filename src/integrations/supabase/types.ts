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
      categories: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          name: string
          org_id: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          org_id?: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          org_id?: string
          parent_id?: string | null
        }
        Relationships: []
      }
      hidden_system_categories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          org_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          org_id?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          org_id?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          item_id: string | null
          multiplier: number
          org_id: string
          stock_quantity: number
          stock_unit_cost: number
          xml_name: string
          xml_quantity: number
          xml_total_price: number
          xml_unit: string | null
          xml_unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          item_id?: string | null
          multiplier?: number
          org_id?: string
          stock_quantity?: number
          stock_unit_cost?: number
          xml_name: string
          xml_quantity?: number
          xml_total_price?: number
          xml_unit?: string | null
          xml_unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          item_id?: string | null
          multiplier?: number
          org_id?: string
          stock_quantity?: number
          stock_unit_cost?: number
          xml_name?: string
          xml_quantity?: number
          xml_total_price?: number
          xml_unit?: string | null
          xml_unit_price?: number
        }
        Relationships: []
      }
      invoices: {
        Row: {
          access_key: string | null
          created_at: string
          id: string
          issue_date: string | null
          nfe_key: string | null
          number: string | null
          org_id: string
          processed_at: string | null
          series: string | null
          source: string
          status: string
          supplier_doc: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_value: number
          updated_at: string
          xml_raw: string | null
        }
        Insert: {
          access_key?: string | null
          created_at?: string
          id?: string
          issue_date?: string | null
          nfe_key?: string | null
          number?: string | null
          org_id?: string
          processed_at?: string | null
          series?: string | null
          source?: string
          status?: string
          supplier_doc?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_value?: number
          updated_at?: string
          xml_raw?: string | null
        }
        Update: {
          access_key?: string | null
          created_at?: string
          id?: string
          issue_date?: string | null
          nfe_key?: string | null
          number?: string | null
          org_id?: string
          processed_at?: string | null
          series?: string | null
          source?: string
          status?: string
          supplier_doc?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_value?: number
          updated_at?: string
          xml_raw?: string | null
        }
        Relationships: []
      }
      item_batches: {
        Row: {
          avg_weight_g: number
          created_at: string
          current_qty: number
          edited_at: string | null
          expiry_date: string | null
          id: string
          initial_qty: number
          invoice_id: string | null
          item_id: string
          lot_number: string | null
          movement_id: string | null
          note: string | null
          org_id: string
          reverted_at: string | null
          source: string
          total_weight_g: number
          unit_cost: number
          units_qty: number
        }
        Insert: {
          avg_weight_g?: number
          created_at?: string
          current_qty?: number
          edited_at?: string | null
          expiry_date?: string | null
          id?: string
          initial_qty?: number
          invoice_id?: string | null
          item_id: string
          lot_number?: string | null
          movement_id?: string | null
          note?: string | null
          org_id?: string
          reverted_at?: string | null
          source?: string
          total_weight_g?: number
          unit_cost?: number
          units_qty?: number
        }
        Update: {
          avg_weight_g?: number
          created_at?: string
          current_qty?: number
          edited_at?: string | null
          expiry_date?: string | null
          id?: string
          initial_qty?: number
          invoice_id?: string | null
          item_id?: string
          lot_number?: string | null
          movement_id?: string | null
          note?: string | null
          org_id?: string
          reverted_at?: string | null
          source?: string
          total_weight_g?: number
          unit_cost?: number
          units_qty?: number
        }
        Relationships: []
      }
      item_categories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          item_id: string
          org_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          item_id: string
          org_id?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          item_id?: string
          org_id?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          avg_weight_g: number
          category_id: string | null
          contabiliza_cmv: boolean
          cost_price: number
          created_at: string
          id: string
          is_active: boolean
          is_free: boolean
          is_operational: boolean
          is_subproduct: boolean
          is_system: boolean
          min_stock: number
          monitor_daily: boolean
          name: string
          org_id: string
          sale_price: number
          shared_unit_enabled: boolean
          standard_weight_g: number
          unit: string
          weight_variable: boolean
        }
        Insert: {
          avg_weight_g?: number
          category_id?: string | null
          contabiliza_cmv?: boolean
          cost_price?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_free?: boolean
          is_operational?: boolean
          is_subproduct?: boolean
          is_system?: boolean
          min_stock?: number
          monitor_daily?: boolean
          name: string
          org_id?: string
          sale_price?: number
          shared_unit_enabled?: boolean
          standard_weight_g?: number
          unit?: string
          weight_variable?: boolean
        }
        Update: {
          avg_weight_g?: number
          category_id?: string | null
          contabiliza_cmv?: boolean
          cost_price?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_free?: boolean
          is_operational?: boolean
          is_subproduct?: boolean
          is_system?: boolean
          min_stock?: number
          monitor_daily?: boolean
          name?: string
          org_id?: string
          sale_price?: number
          shared_unit_enabled?: boolean
          standard_weight_g?: number
          unit?: string
          weight_variable?: boolean
        }
        Relationships: []
      }
      locations: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          location_type: string
          name: string
          operation_type: string
          org_id: string
          parent_id: string | null
          stock_mode: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          location_type?: string
          name: string
          operation_type?: string
          org_id?: string
          parent_id?: string | null
          stock_mode?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          location_type?: string
          name?: string
          operation_type?: string
          org_id?: string
          parent_id?: string | null
          stock_mode?: string
        }
        Relationships: []
      }
      movements: {
        Row: {
          correction_factor: number | null
          created_at: string
          edited_at: string | null
          from_location_id: string | null
          id: string
          invoice_id: string | null
          item_id: string
          note: string | null
          notes: string | null
          operation_id: string | null
          org_id: string
          original_payload: Json | null
          quantity: number
          reason_category: string | null
          reverted_at: string | null
          reverted_by: string | null
          status: string
          to_location_id: string | null
          total_cost: number
          type: string
          unit_cost: number
        }
        Insert: {
          correction_factor?: number | null
          created_at?: string
          edited_at?: string | null
          from_location_id?: string | null
          id?: string
          invoice_id?: string | null
          item_id: string
          note?: string | null
          notes?: string | null
          operation_id?: string | null
          org_id?: string
          original_payload?: Json | null
          quantity: number
          reason_category?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          status?: string
          to_location_id?: string | null
          total_cost?: number
          type?: string
          unit_cost?: number
        }
        Update: {
          correction_factor?: number | null
          created_at?: string
          edited_at?: string | null
          from_location_id?: string | null
          id?: string
          invoice_id?: string | null
          item_id?: string
          note?: string | null
          notes?: string | null
          operation_id?: string | null
          org_id?: string
          original_payload?: Json | null
          quantity?: number
          reason_category?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          status?: string
          to_location_id?: string | null
          total_cost?: number
          type?: string
          unit_cost?: number
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_levels: {
        Row: {
          current_stock: number
          expiry_date: string | null
          id: string
          item_id: string
          location_id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          current_stock?: number
          expiry_date?: string | null
          id?: string
          item_id: string
          location_id: string
          org_id?: string
          updated_at?: string
        }
        Update: {
          current_stock?: number
          expiry_date?: string | null
          id?: string
          item_id?: string
          location_id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_org_id: { Args: never; Returns: string }
      ensure_my_primary_organization: { Args: never; Returns: string }
      ensure_user_primary_organization: {
        Args: { _email?: string; _restaurant_name?: string; _user_id: string }
        Returns: string
      }
      setup_new_organization: { Args: { _org_id: string }; Returns: undefined }
    }
    Enums: {
      org_role: "owner" | "manager" | "staff"
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
      org_role: ["owner", "manager", "staff"],
    },
  },
} as const
