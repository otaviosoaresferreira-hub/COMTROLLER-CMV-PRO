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
      adjustment_requests: {
        Row: {
          applied_at: string | null
          batch_id: string | null
          created_at: string
          current_value: Json
          id: string
          item_id: string | null
          justification: string
          kind: string
          location_id: string | null
          new_value: Json
          org_id: string
          requested_by: string
          requester_email: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_email: string | null
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          batch_id?: string | null
          created_at?: string
          current_value?: Json
          id?: string
          item_id?: string | null
          justification: string
          kind: string
          location_id?: string | null
          new_value?: Json
          org_id?: string
          requested_by: string
          requester_email?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_email?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          batch_id?: string | null
          created_at?: string
          current_value?: Json
          id?: string
          item_id?: string | null
          justification?: string
          kind?: string
          location_id?: string | null
          new_value?: Json
          org_id?: string
          requested_by?: string
          requester_email?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_email?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_user_roles: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          module: string
          new_value: Json | null
          old_value: Json | null
          org_id: string
          reason: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          module: string
          new_value?: Json | null
          old_value?: Json | null
          org_id?: string
          reason?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          module?: string
          new_value?: Json | null
          old_value?: Json | null
          org_id?: string
          reason?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
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
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_run_items: {
        Row: {
          created_at: string
          done_at: string | null
          done_by: string | null
          id: string
          is_done: boolean
          note: string | null
          org_id: string
          photo_path: string | null
          position: number
          requires_photo: boolean
          run_id: string
          template_item_id: string | null
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          note?: string | null
          org_id?: string
          photo_path?: string | null
          position?: number
          requires_photo?: boolean
          run_id: string
          template_item_id?: string | null
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          note?: string | null
          org_id?: string
          photo_path?: string | null
          position?: number
          requires_photo?: boolean
          run_id?: string
          template_item_id?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "checklist_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_run_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_runs: {
        Row: {
          assignee: string | null
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          notes: string | null
          org_id: string
          run_date: string
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          run_date?: string
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          run_date?: string
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          created_at: string
          id: string
          org_id: string
          position: number
          requires_photo: boolean
          template_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string
          position?: number
          requires_photo?: boolean
          template_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          position?: number
          requires_photo?: boolean
          template_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          recurrence: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string
          recurrence?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          recurrence?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          name: string
          org_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string
          expense_date: string
          id: string
          kind: string
          note: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          expense_date?: string
          id?: string
          kind?: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          expense_date?: string
          id?: string
          kind?: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "hidden_system_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_items: {
        Row: {
          count_id: string
          counted_quantity: number
          created_at: string
          id: string
          item_id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          count_id: string
          counted_quantity?: number
          created_at?: string
          id?: string
          item_id: string
          org_id?: string
          updated_at?: string
        }
        Update: {
          count_id?: string
          counted_quantity?: number
          created_at?: string
          id?: string
          item_id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          confirmed_at: string | null
          created_at: string
          id: string
          location_id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          location_id: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          location_id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_discrepancies: {
        Row: {
          central_location_id: string
          count_id: string
          counted_qty: number
          created_at: string
          delta_qty: number
          display_unit: string
          expected_qty: number
          id: string
          item_id: string
          kind: string
          org_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          central_location_id: string
          count_id: string
          counted_qty?: number
          created_at?: string
          delta_qty?: number
          display_unit?: string
          expected_qty?: number
          id?: string
          item_id: string
          kind: string
          org_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          central_location_id?: string
          count_id?: string
          counted_qty?: number
          created_at?: string
          delta_qty?: number
          display_unit?: string
          expected_qty?: number
          id?: string
          item_id?: string
          kind?: string
          org_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_discrepancy_audits: {
        Row: {
          counted_at: string | null
          counted_by: string | null
          counted_qty: number | null
          created_at: string
          discrepancy_id: string
          id: string
          location_id: string
          note: string | null
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          created_at?: string
          discrepancy_id: string
          id?: string
          location_id: string
          note?: string | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          created_at?: string
          discrepancy_id?: string
          id?: string
          location_id?: string
          note?: string | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_discrepancy_audits_discrepancy_id_fkey"
            columns: ["discrepancy_id"]
            isOneToOne: false
            referencedRelation: "inventory_discrepancies"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "item_batches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_batches_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_batches_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
        ]
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
      item_suppliers: {
        Row: {
          created_at: string
          id: string
          is_preferred: boolean
          item_id: string
          org_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_preferred?: boolean
          item_id: string
          org_id?: string
          supplier_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_preferred?: boolean
          item_id?: string
          org_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      location_item_factors: {
        Row: {
          created_at: string
          factor: number
          id: string
          item_id: string
          location_id: string
          note: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          factor?: number
          id?: string
          item_id: string
          location_id: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          factor?: number
          id?: string
          item_id?: string
          location_id?: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_item_factors_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_item_factors_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_item_stock_overrides: {
        Row: {
          created_at: string
          id: string
          item_id: string
          location_id: string
          note: string | null
          org_id: string
          skip_auto_deduction: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          location_id: string
          note?: string | null
          org_id?: string
          skip_auto_deduction?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          location_id?: string
          note?: string | null
          org_id?: string
          skip_auto_deduction?: boolean
          updated_at?: string
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
      movement_incidents: {
        Row: {
          created_at: string
          id: string
          item_id: string
          location_id: string
          missing_qty: number
          movement_id: string | null
          movement_type: string | null
          note: string | null
          org_id: string
          reason_category: string | null
          resolved_at: string | null
          resolved_by: string | null
          resulting_balance: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          location_id: string
          missing_qty?: number
          movement_id?: string | null
          movement_type?: string | null
          note?: string | null
          org_id?: string
          reason_category?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resulting_balance?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          location_id?: string
          missing_qty?: number
          movement_id?: string | null
          movement_type?: string | null
          note?: string | null
          org_id?: string
          reason_category?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resulting_balance?: number
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
        Relationships: [
          {
            foreignKeyName: "movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name: string
          org_id?: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          status?: string
        }
        Relationships: []
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          buyer_name: string | null
          created_at: string
          id: string
          name: string
          target_coverage_days: number
          updated_at: string
          whatsapp_greeting: string | null
        }
        Insert: {
          buyer_name?: string | null
          created_at?: string
          id?: string
          name: string
          target_coverage_days?: number
          updated_at?: string
          whatsapp_greeting?: string | null
        }
        Update: {
          buyer_name?: string | null
          created_at?: string
          id?: string
          name?: string
          target_coverage_days?: number
          updated_at?: string
          whatsapp_greeting?: string | null
        }
        Relationships: []
      }
      recipe_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id?: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "recipe_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          org_id: string
          quantity: number
          recipe_id: string
          sub_recipe_id: string | null
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          org_id?: string
          quantity?: number
          recipe_id: string
          sub_recipe_id?: string | null
          unit?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          org_id?: string
          quantity?: number
          recipe_id?: string
          sub_recipe_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_sub_recipe_id_fkey"
            columns: ["sub_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_unit_overrides: {
        Row: {
          cost_override: number | null
          created_at: string
          id: string
          location_id: string
          org_id: string
          recipe_id: string
          sale_price: number
          updated_at: string
        }
        Insert: {
          cost_override?: number | null
          created_at?: string
          id?: string
          location_id: string
          org_id?: string
          recipe_id: string
          sale_price?: number
          updated_at?: string
        }
        Update: {
          cost_override?: number | null
          created_at?: string
          id?: string
          location_id?: string
          org_id?: string
          recipe_id?: string
          sale_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_unit_overrides_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_unit_overrides_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          category_id: string | null
          created_at: string
          customize_composition: boolean
          explode_on_consume: boolean
          fraction: number | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          operation_location_id: string | null
          org_id: string
          parent_recipe_id: string | null
          portions: number
          produced_item_id: string | null
          sale_price: number
          type: string
          unit_location_id: string | null
          unit_name: string | null
          unit_weight_g: number | null
          updated_at: string
          yield_quantity: number
          yield_unit: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          customize_composition?: boolean
          explode_on_consume?: boolean
          fraction?: number | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          operation_location_id?: string | null
          org_id?: string
          parent_recipe_id?: string | null
          portions?: number
          produced_item_id?: string | null
          sale_price?: number
          type?: string
          unit_location_id?: string | null
          unit_name?: string | null
          unit_weight_g?: number | null
          updated_at?: string
          yield_quantity?: number
          yield_unit?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          customize_composition?: boolean
          explode_on_consume?: boolean
          fraction?: number | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          operation_location_id?: string | null
          org_id?: string
          parent_recipe_id?: string | null
          portions?: number
          produced_item_id?: string | null
          sale_price?: number
          type?: string
          unit_location_id?: string | null
          unit_name?: string | null
          unit_weight_g?: number | null
          updated_at?: string
          yield_quantity?: number
          yield_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "recipe_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_operation_location_id_fkey"
            columns: ["operation_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_parent_recipe_id_fkey"
            columns: ["parent_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_unit_location_id_fkey"
            columns: ["unit_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_channels: {
        Row: {
          created_at: string
          fee_percent: number
          id: string
          is_active: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fee_percent?: number
          id?: string
          is_active?: boolean
          name: string
          org_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fee_percent?: number
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_entries: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          entry_date: string
          gross_amount: number
          id: string
          note: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          gross_amount?: number
          id?: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          gross_amount?: number
          id?: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_entries_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "revenue_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_item_mappings: {
        Row: {
          created_at: string
          id: string
          multiplier: number
          org_id: string
          recipe_id: string
          source_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          multiplier?: number
          org_id?: string
          recipe_id: string
          source_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          multiplier?: number
          org_id?: string
          recipe_id?: string
          source_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      shift_audit_entries: {
        Row: {
          audit_id: string
          created_at: string
          final_count_qty: number
          id: string
          item_id: string
          opening_qty: number
          org_id: string
          received_qty: number
          sales_qty: number
          staff_qty: number
          variance_qty: number
          waste_qty: number
        }
        Insert: {
          audit_id: string
          created_at?: string
          final_count_qty?: number
          id?: string
          item_id: string
          opening_qty?: number
          org_id?: string
          received_qty?: number
          sales_qty?: number
          staff_qty?: number
          variance_qty?: number
          waste_qty?: number
        }
        Update: {
          audit_id?: string
          created_at?: string
          final_count_qty?: number
          id?: string
          item_id?: string
          opening_qty?: number
          org_id?: string
          received_qty?: number
          sales_qty?: number
          staff_qty?: number
          variance_qty?: number
          waste_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_audit_entries_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "shift_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_audits: {
        Row: {
          audit_date: string
          created_at: string
          id: string
          location_id: string
          notes: string | null
          org_id: string
          shift_label: string | null
          updated_at: string
        }
        Insert: {
          audit_date?: string
          created_at?: string
          id?: string
          location_id: string
          notes?: string | null
          org_id?: string
          shift_label?: string | null
          updated_at?: string
        }
        Update: {
          audit_date?: string
          created_at?: string
          id?: string
          location_id?: string
          notes?: string | null
          org_id?: string
          shift_label?: string | null
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
        Relationships: [
          {
            foreignKeyName: "stock_levels_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_name: string | null
          created_at: string
          document: string | null
          id: string
          lead_time_days: number
          name: string
          notes: string | null
          org_id: string
          updated_at: string
          whatsapp_phone: string | null
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          document?: string | null
          id?: string
          lead_time_days?: number
          name: string
          notes?: string | null
          org_id?: string
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          document?: string | null
          id?: string
          lead_time_days?: number
          name?: string
          notes?: string | null
          org_id?: string
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      xml_item_mappings: {
        Row: {
          created_at: string
          id: string
          item_id: string
          multiplier: number
          org_id: string
          updated_at: string
          xml_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          multiplier?: number
          org_id?: string
          updated_at?: string
          xml_name: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          multiplier?: number
          org_id?: string
          updated_at?: string
          xml_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "xml_item_mappings_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_stock_fefo: {
        Args: { _item_id: string; _qty: number }
        Returns: {
          batch_id: string
          expiry_date: string
          taken: number
          unit_cost: number
        }[]
      }
      consume_stock_fefo_units: {
        Args: { _item_id: string; _units: number }
        Returns: {
          batch_id: string
          expiry_date: string
          kg_taken: number
          unit_cost: number
          units_taken: number
        }[]
      }
      current_user_org_id: { Args: never; Returns: string }
      current_user_org_ids: { Args: never; Returns: string[] }
      ensure_my_primary_organization: { Args: never; Returns: string }
      ensure_uncategorized_category: {
        Args: { _org_id: string }
        Returns: string
      }
      ensure_user_primary_organization: {
        Args: { _email?: string; _restaurant_name?: string; _user_id: string }
        Returns: string
      }
      has_app_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["org_role"]
        }
        Returns: boolean
      }
      is_gestor: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      list_active_batches: {
        Args: { _item_id: string }
        Returns: {
          avg_weight_g: number
          created_at: string
          current_qty: number
          edited_at: string
          expiry_date: string
          id: string
          initial_qty: number
          invoice_id: string
          lot_number: string
          movement_id: string
          reverted_at: string
          source: string
          unit_cost: number
        }[]
      }
      reorganize_org_categories: {
        Args: { _org_id: string }
        Returns: undefined
      }
      seed_suggested_categories: { Args: { _org_id: string }; Returns: number }
      setup_new_organization: { Args: { _org_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "gestor" | "operacional"
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
      app_role: ["gestor", "operacional"],
      org_role: ["owner", "manager", "staff"],
    },
  },
} as const
