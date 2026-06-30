/**
 * Row shapes for the core schema. Repositories return these typed records.
 * numeric columns are surfaced as strings by node-postgres and parsed where needed.
 */
export type SubscriptionTierName = 'basic' | 'premium' | 'enterprise';
export type UserRole = 'owner' | 'manager' | 'viewer';
export type AccountStatus = 'active' | 'read_only' | 'suspended';
export type TenderStatus = 'open' | 'closed';
export type KnownStatus = 'known' | 'unknown';
export type PursuitStage = 'watching' | 'preparing' | 'submitted' | 'won' | 'lost' | 'closed';
export type NotificationChannel = 'email' | 'sms' | 'in_app';
export type NotificationStatus = 'pending' | 'delivered' | 'failed';
export type SubscriptionStatus = 'active' | 'past_due' | 'read_only' | 'canceled';

export interface BusinessAccount {
  id: string;
  name: string;
  owner_user_id: string | null;
  subscription_tier: SubscriptionTierName;
  status: AccountStatus;
  created_at: Date;
}

export interface BusinessUser {
  id: string;
  business_account_id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  last_active_at: Date | null;
  created_at: Date;
}

export interface Tender {
  source_portal: string;
  source_identifier: string;
  title: string;
  product_category: string | null;
  region: string | null;
  estimated_value: string | null;
  estimated_value_status: KnownStatus;
  deadline: Date | null;
  deadline_status: KnownStatus;
  status: TenderStatus;
  retrieved_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MatchFilter {
  id: string;
  business_account_id: string;
  regions: string[];
  product_categories: string[];
  min_value: string | null;
  max_value: string | null;
  updated_at: Date;
}

export interface TenderMatch {
  id: string;
  business_account_id: string;
  tender_source_portal: string;
  tender_source_identifier: string;
  match_score: number;
  created_at: Date;
}

export interface PursuedTender {
  id: string;
  business_account_id: string;
  tender_source_portal: string;
  tender_source_identifier: string;
  stage: PursuitStage;
  tracked_deadline: Date | null;
  reminder_offsets_days: number[] | null;
  closed_at: Date | null;
  created_at: Date;
}

export interface HistoricalTenderRecord {
  id: string;
  product_category: string | null;
  region: string | null;
  source_portal: string | null;
  source_identifier: string | null;
  attributes_json: Record<string, unknown>;
  awarded_price: string | null;
  awarded_price_status: KnownStatus;
  closed_at: Date;
  created_at: Date;
}

export interface PricePrediction {
  id: string;
  business_account_id: string;
  tender_source_portal: string;
  tender_source_identifier: string;
  lower_bound: string;
  upper_bound: string;
  confidence: string;
  sample_size: number;
  computed_at: Date;
}

export interface BusinessDocument {
  id: string;
  business_account_id: string;
  storage_key: string;
  file_name: string;
  doc_type: string | null;
  expiry_date: string | null;
  size_bytes: string;
  content_sha256: string | null;
  uploaded_at: Date;
  deleted_at: Date | null;
}

export interface Subscription {
  id: string;
  business_account_id: string;
  tier: SubscriptionTierName;
  status: SubscriptionStatus;
  pending_tier: SubscriptionTierName | null;
  current_period_start: Date;
  current_period_end: Date;
  retry_count: number;
  last_charge_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationPref {
  id: string;
  business_account_id: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationLog {
  id: string;
  business_account_id: string;
  channel: NotificationChannel;
  type: string;
  status: NotificationStatus;
  retry_count: number;
  dedupe_key: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  sent_at: Date | null;
}

export interface SourcePortalRow {
  id: string;
  name: string;
  base_url: string;
  rate_limit_rpm: number;
  public_flag: boolean;
  access_policy: string | null;
  poll_interval_minutes: number;
  last_polled_at: Date | null;
  last_status: string | null;
  last_error: string | null;
  created_at: Date;
}
