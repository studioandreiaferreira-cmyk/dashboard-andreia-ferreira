// Shapes of the Clint API payloads (checked against the live account, research R1).

export interface ClintDeal {
  id: string;
  origin_id: string | null;
  user: { id: string; email: string; full_name: string } | null;
  contact: { id: string; name: string | null; email: string | null; phone: string | null; ddi: string | null; instagram: string | null } | null;
  created_at: string;
  updated_at: string;
  updated_stage_at: string | null;
  status: "OPEN" | "WON" | "LOST";
  won_at: string | null;
  lost_at: string | null;
  lost_status_id: string | null;
  stage: string | null;
  stage_id: string | null;
  value: number | null;
  fields: Record<string, unknown> | null;
}

export interface ClintOrigin {
  id: string;
  name: string;
  group: { id: string; name: string } | null;
  stages: { id: string; label: string; order: number; type: string }[];
  archived_at: string | null;
}

export interface ClintGroup {
  id: string;
  name: string;
}

export interface ClintLostStatus {
  id: string;
  name: string;
}

export interface ClintUser {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface ClintContact {
  id: string;
  name: string | null;
  email: string | null;
  ddi: string | null;
  phone: string | null;
  fields: Record<string, unknown> | null;
  updated_at: string | null;
}

export interface ClintChannelAccount {
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface ClintChat {
  id: string;
  contact_id: string;
  user_id: string | null;
  status: string;
  replied: boolean;
  last_message_at: string | null;
  last_response_at: string | null;
  channel_account_id: string;
}

export type ClintContentType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "REACTION" | (string & {});

export interface ClintMessage {
  id: string;
  chat_id: string;
  user_id: string | null;
  type: "USER" | "CUSTOMER" | "EVENT";
  created_at: string;
  source: string | null;
  content: string | null;
  content_type: ClintContentType;
  content_url: string | null;
  content_object: { name?: string; type?: string; seconds?: number } | null;
  content_action: { reaction?: { value: string; from_me: boolean; message_id: string } } | null;
}

export interface PageV1<T> {
  status: number;
  data: T[];
  totalCount: number;
  page: number;
  totalPages: number;
  hasNext: boolean;
}

export interface PageV2<T> {
  status: number;
  data: T[];
  total_count: number;
  page: number;
  total_pages: number;
  has_next: boolean;
}
