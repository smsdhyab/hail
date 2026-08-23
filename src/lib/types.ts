/**
 * Hand-written Supabase schema contract for the cafe DB. Kept in sync with the
 * migrations under supabase/migrations. Cost columns exist in the type (the
 * service-role client reads them) but are revoked from anon/authenticated at the
 * database — the grant, not the type, is the security boundary.
 *
 * When the schema grows, regenerate with `supabase gen types` or extend by hand.
 */

export type OrderChannel = "qr" | "kiosk" | "cashier" | "delivery";
export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded";
export type VariantKind = "size" | "flavor";
/** The two cash registers: separate books, one system. */
export type StationSlug = "pastry" | "cafe";

type Timestamped = { id: string; created_at: string };

export type Database = {
  public: {
    Tables: {
      stations: {
        Row: Timestamped & { slug: StationSlug; name_ar: string; sort: number };
        Insert: { id?: string; slug: StationSlug; name_ar: string; sort?: number; created_at?: string };
        Update: Partial<{ slug: StationSlug; name_ar: string; sort: number }>;
        Relationships: [];
      };
      roles: {
        Row: Timestamped & { name_ar: string; name_en: string };
        Insert: { id?: string; name_ar: string; name_en: string; created_at?: string };
        Update: Partial<{ name_ar: string; name_en: string }>;
        Relationships: [];
      };
      employees: {
        Row: Timestamped & {
          name_ar: string; role_id: string | null; station_id: string | null; auth_user_id: string | null; is_active: boolean;
          wage_amount: number; wage_period: "daily" | "weekly" | "monthly" | null;
        };
        Insert: {
          id?: string; name_ar: string; role_id?: string | null; station_id?: string | null; auth_user_id?: string | null; is_active?: boolean;
          wage_amount?: number; wage_period?: "daily" | "weekly" | "monthly" | null; created_at?: string;
        };
        Update: Partial<{
          name_ar: string; role_id: string | null; station_id: string | null; auth_user_id: string | null; is_active: boolean;
          wage_amount: number; wage_period: "daily" | "weekly" | "monthly" | null;
        }>;
        // Declared so `select("...,roles(name_en),stations(slug)")` type-checks —
        // one round trip instead of three, which matters a lot from Iraq.
        Relationships: [
          {
            foreignKeyName: "employees_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_station_id_fkey";
            columns: ["station_id"];
            isOneToOne: false;
            referencedRelation: "stations";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: Timestamped & { name_ar: string; image_url: string | null; sort: number; is_active: boolean; station_id: string | null };
        Insert: { id?: string; name_ar: string; image_url?: string | null; sort?: number; is_active?: boolean; station_id?: string | null; created_at?: string };
        Update: Partial<{ name_ar: string; image_url: string | null; sort: number; is_active: boolean; station_id: string | null }>;
        Relationships: [];
      };
      menu_items: {
        Row: Timestamped & {
          category_id: string; name_ar: string; description_ar: string | null; image_url: string | null;
          price: number; cost: number; flavors: string[]; is_active: boolean; sort: number;
          sold_by: "piece" | "weight"; unit_label: string | null;
          /** رمز الصنف في الميزان — ملصق الميزان يحمله لا اسم الصنف */
          plu: number | null; barcode: string | null;
        };
        Insert: {
          id?: string; category_id: string; name_ar: string; description_ar?: string | null; image_url?: string | null;
          price?: number; cost?: number; flavors?: string[]; is_active?: boolean; sort?: number; created_at?: string;
          sold_by?: "piece" | "weight"; unit_label?: string | null;
          plu?: number | null; barcode?: string | null;
        };
        Update: Partial<{
          category_id: string; name_ar: string; description_ar: string | null; image_url: string | null;
          price: number; cost: number; flavors: string[]; is_active: boolean; sort: number;
          sold_by: "piece" | "weight"; unit_label: string | null;
          plu: number | null; barcode: string | null;
        }>;
        Relationships: [];
      };
      item_variants: {
        Row: Timestamped & {
          item_id: string; kind: VariantKind; name_ar: string;
          price_override: number | null; cost_override: number | null; is_active: boolean; sort: number;
        };
        Insert: {
          id?: string; item_id: string; kind?: VariantKind; name_ar: string;
          price_override?: number | null; cost_override?: number | null; is_active?: boolean; sort?: number; created_at?: string;
        };
        Update: Partial<{
          item_id: string; kind: VariantKind; name_ar: string;
          price_override: number | null; cost_override: number | null; is_active: boolean; sort: number;
        }>;
        Relationships: [];
      };
      customers: {
        Row: Timestamped & { card_serial: string; phone: string | null; name_ar: string | null; points: number };
        Insert: { id?: string; card_serial?: string; phone?: string | null; name_ar?: string | null; points?: number; created_at?: string };
        Update: Partial<{ phone: string | null; name_ar: string | null; points: number }>;
        Relationships: [];
      };
      debt_entries: {
        Row: Timestamped & { customer_name: string; phone: string | null; kind: "debit" | "credit"; amount: number; note: string | null; created_by: string | null; business_day: string };
        Insert: { id?: string; customer_name: string; phone?: string | null; kind: "debit" | "credit"; amount: number; note?: string | null; created_by?: string | null; business_day?: string; created_at?: string };
        Update: Partial<{ customer_name: string; phone: string | null; note: string | null }>;
        Relationships: [];
      };
      daily_resets: {
        Row: Timestamped & { reset_at: string; by_employee: string | null };
        Insert: { id?: string; reset_at?: string; by_employee?: string | null; created_at?: string };
        Update: Partial<{ reset_at: string; by_employee: string | null }>;
        Relationships: [];
      };
      item_offers: {
        Row: Timestamped & { item_id: string; offer_price: number; business_day: string; note: string | null };
        Insert: { id?: string; item_id: string; offer_price: number; business_day?: string; note?: string | null; created_at?: string };
        Update: Partial<{ offer_price: number; note: string | null }>;
        Relationships: [];
      };
      pastry_batches: {
        Row: Timestamped & { item_name: string; quantity: number; deposited_on: string; shelf_days: number; active: boolean; note: string | null };
        Insert: { id?: string; item_name: string; quantity?: number; deposited_on?: string; shelf_days?: number; active?: boolean; note?: string | null; created_at?: string };
        Update: Partial<{ item_name: string; quantity: number; deposited_on: string; shelf_days: number; active: boolean; note: string | null }>;
        Relationships: [];
      };
      offers: {
        Row: Timestamped & { title: string; description: string | null; active: boolean; auto: boolean; batch_id: string | null; ends_on: string | null };
        Insert: { id?: string; title: string; description?: string | null; active?: boolean; auto?: boolean; batch_id?: string | null; ends_on?: string | null; created_at?: string };
        Update: Partial<{ title: string; description: string | null; active: boolean; ends_on: string | null }>;
        Relationships: [];
      };
      app_settings: {
        Row: { key: string; value: number; updated_at: string };
        Insert: { key: string; value?: number; updated_at?: string };
        Update: Partial<{ value: number; updated_at: string }>;
        Relationships: [];
      };
      combos: {
        Row: Timestamped & { slug: string; title_ar: string; price: number; is_active: boolean; sort: number };
        Insert: { id?: string; slug: string; title_ar: string; price: number; is_active?: boolean; sort?: number; created_at?: string };
        Update: Partial<{ slug: string; title_ar: string; price: number; is_active: boolean; sort: number }>;
        Relationships: [];
      };
      combo_items: {
        Row: { combo_id: string; item_id: string };
        Insert: { combo_id: string; item_id: string };
        Update: Partial<{ combo_id: string; item_id: string }>;
        Relationships: [];
      };
      cafe_tables: {
        Row: { name: string; kind: string; floor: number; active: boolean; pos_x: number; pos_y: number; sort: number; updated_at: string };
        Insert: { name: string; kind?: string; floor?: number; active?: boolean; pos_x?: number; pos_y?: number; sort?: number; updated_at?: string };
        Update: Partial<{ kind: string; floor: number; active: boolean; pos_x: number; pos_y: number; sort: number; updated_at: string }>;
        Relationships: [];
      };
      monthly_costs: {
        Row: { category: string; amount: number; updated_at: string };
        Insert: { category: string; amount?: number; updated_at?: string };
        Update: Partial<{ amount: number; updated_at: string }>;
        Relationships: [];
      };
      register_closures: {
        Row: { business_day: string; station_id: string | null; remaining: number; note: string | null; closed_by: string | null; created_at: string; updated_at: string };
        Insert: { business_day: string; station_id?: string | null; remaining: number; note?: string | null; closed_by?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<{ remaining: number; note: string | null; closed_by: string | null; updated_at: string }>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: Timestamped & { endpoint: string; p256dh: string; auth: string };
        Insert: { id?: string; endpoint: string; p256dh: string; auth: string; created_at?: string };
        Update: Partial<{ endpoint: string; p256dh: string; auth: string }>;
        Relationships: [];
      };
      order_counters: {
        Row: { business_day: string; scope: string; last_seq: number };
        Insert: { business_day: string; scope: string; last_seq?: number };
        Update: Partial<{ last_seq: number }>;
        Relationships: [];
      };
      orders: {
        Row: Timestamped & {
          business_day: string; order_seq: number; channel: OrderChannel; status: OrderStatus;
          station_id: string; group_no: number; collected_by_station_id: string | null;
          /** combo price − Σ list prices; recorded once per ticket, on the shop */
          promo_adjust: number;
          subtotal: number; cost_total: number; discount: number; extra: number; extra_note: string | null;
          table_no: string | null; floor: number | null; note: string | null;
          /** delivery only — the fee is central money, not either station's sales */
          address: string | null; geo: string | null; deliver_at: string | null; delivery_fee: number;
          customer_id: string | null; cashier_id: string | null; paid_at: string | null;
        };
        Insert: {
          id?: string; business_day?: string; order_seq: number; channel: OrderChannel; status?: OrderStatus;
          station_id: string; group_no: number; collected_by_station_id?: string | null;
          promo_adjust?: number;
          subtotal?: number; cost_total?: number; discount?: number; extra?: number; extra_note?: string | null;
          table_no?: string | null; floor?: number | null; note?: string | null;
          address?: string | null; geo?: string | null; deliver_at?: string | null;
          customer_id?: string | null; cashier_id?: string | null; paid_at?: string | null; created_at?: string;
        };
        Update: Partial<{ status: OrderStatus; discount: number; extra: number; extra_note: string | null; customer_id: string | null; collected_by_station_id: string | null; paid_at: string | null }>;
        Relationships: [];
      };
      order_items: {
        Row: Timestamped & {
          order_id: string; item_id: string | null; variant_id: string | null; name_ar: string; flavor_ar: string | null;
          /** كسرية للأصناف الموزونة: ٠٫٣٥٠ = ٣٥٠ غم */
          qty: number; unit_price: number; unit_cost: number; line_total: number;
          sold_by: "piece" | "weight";
        };
        Insert: {
          id?: string; order_id: string; item_id?: string | null; variant_id?: string | null; name_ar: string; flavor_ar?: string | null;
          qty: number; unit_price: number; unit_cost?: number; created_at?: string;
        };
        Update: Partial<{ qty: number; unit_price: number }>;
        Relationships: [];
      };
      expenses: {
        Row: Timestamped & { business_day: string; amount: number; category: string | null; note: string | null; created_by: string | null; station_id: string | null };
        Insert: { id?: string; business_day?: string; amount: number; category?: string | null; note?: string | null; created_by?: string | null; station_id?: string | null; created_at?: string };
        Update: Partial<{ business_day: string; amount: number; category: string | null; note: string | null }>;
        Relationships: [];
      };
      loyalty_events: {
        Row: Timestamped & {
          customer_id: string; delta: number; reason: string; order_id: string | null; idempotency_key: string | null; created_by: string | null;
        };
        Insert: {
          id?: string; customer_id: string; delta: number; reason: string; order_id?: string | null; idempotency_key?: string | null; created_by?: string | null; created_at?: string;
        };
        Update: Partial<{ delta: number; reason: string }>;
        Relationships: [];
      };
    };
    Views: {
      menu_public: {
        Row: {
          id: string; category_id: string; name_ar: string; description_ar: string | null; image_url: string | null;
          price: number; flavors: string[]; sort: number;
          sold_by: "piece" | "weight"; unit_label: string;
          plu: number | null; barcode: string | null;
          category_name: string; category_image: string | null; category_sort: number;
          /** the register that owns this category — drives order routing */
          station_slug: "pastry" | "cafe" | null;
        };
        Relationships: [];
      };
      variant_public: {
        Row: { id: string; item_id: string; kind: VariantKind; name_ar: string; price: number; sort: number };
        Relationships: [];
      };
      active_offers: {
        Row: { id: string; title: string; description: string | null };
        Relationships: [];
      };
      active_item_offers: {
        Row: { item_id: string; offer_price: number };
        Relationships: [];
      };
      combo_public: {
        Row: {
          id: string; slug: string; title_ar: string; price: number; sort: number;
          item_ids: string[]; item_names: string[]; list_total: number;
        };
        Relationships: [];
      };
      debtor_balances: {
        Row: { customer_name: string; phone: string | null; total_debt: number; total_paid: number; balance: number; last_activity: string };
        Relationships: [];
      };
    };
    Functions: {
      /** Splits the lines by station → one order row per station, all sharing group_no. */
      place_order: {
        Args: {
          p_channel: OrderChannel; p_lines: Json; p_customer?: string | null;
          p_table?: string | null; p_note?: string | null; p_combos?: Json;
          p_address?: string | null; p_geo?: string | null; p_deliver_at?: string | null;
        };
        Returns: { order_id: string; order_seq: number; group_no: number; station_slug: StationSlug }[];
      };
      mark_order_paid: {
        Args: { p_order: string; p_discount?: number; p_customer?: string | null; p_award_points?: number; p_extra?: number; p_extra_note?: string | null };
        Returns: number;
      };
      /** One payment for a whole group; prorates discount/extra across stations. */
      pay_order_group: {
        Args: {
          p_group: number; p_day?: string | null; p_discount?: number; p_extra?: number;
          p_extra_note?: string | null; p_customer?: string | null; p_award_points?: number;
          p_collected_by?: string | null;
        };
        Returns: { order_id: string; station_slug: StationSlug; net: number }[];
      };
      cancel_order_group: { Args: { p_group: number; p_day?: string | null }; Returns: undefined };
      cancel_order: { Args: { p_order: string }; Returns: undefined };
      refund_order: { Args: { p_order: string }; Returns: undefined };
      get_card: { Args: { p_serial: string }; Returns: { id: string; name_ar: string | null; points: number }[] };
      create_card: { Args: { p_phone: string | null; p_name: string | null }; Returns: string };
      adjust_points: { Args: { p_customer: string; p_delta: number; p_reason: string; p_key?: string | null }; Returns: number };
      redeem_points: { Args: { p_customer: string; p_cost: number; p_key: string }; Returns: number };
      get_orders_public: { Args: { p_orders: string[] }; Returns: Json };
      save_cafe_tables: { Args: { p_tables: Json }; Returns: undefined };
      guest_estimate: { Args: { p_from: string; p_to: string }; Returns: number };
      range_summary: {
        Args: { p_from: string; p_to: string; p_station?: string | null };
        Returns: {
          day: string; sales: number; orders_count: number; profit: number;
          expenses: number; net: number; promo: number; delivery: number; collected: number;
        }[];
      };
      set_setting: { Args: { p_key: string; p_value: number }; Returns: number };
    };
    Enums: {
      order_channel: OrderChannel;
      order_status: OrderStatus;
      variant_kind: VariantKind;
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
