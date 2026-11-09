export type Attribution = "direct" | "chat" | "deal" | "none";

export interface AttributionResult {
  attributed_user_id: string | null;
  attribution: Attribution;
}

/**
 * Seller attribution for a message (FR-029): message sender → chat attendant → owner of the
 * contact's most recently updated open deal → "Sem responsável". Only seller (USER) messages are attributed.
 */
export function attributeMessage(
  msg: { type: string; user_id: string | null },
  chat: { user_id: string | null },
  openDealOwnerId: string | null,
): AttributionResult {
  if (msg.type !== "USER") return { attributed_user_id: null, attribution: "none" };
  if (msg.user_id) return { attributed_user_id: msg.user_id, attribution: "direct" };
  if (chat.user_id) return { attributed_user_id: chat.user_id, attribution: "chat" };
  if (openDealOwnerId) return { attributed_user_id: openDealOwnerId, attribution: "deal" };
  return { attributed_user_id: null, attribution: "none" };
}
