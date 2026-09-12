export interface TelegramInitDataUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface ValidatedInitData {
  user: TelegramInitDataUser;
  authDate: number;
  startParam?: string;
}

export type InitDataValidationResult =
  | { ok: true; data: ValidatedInitData }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };

// --- Telegram Bot API `Update` (only the shape the webhook route needs) ---

export interface TelegramFrom {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramChat {
  id: number;
  /**
   * "private" | "group" | "supergroup" | "channel". Telegram always sends
   * it; it is optional here only so the many fabricated updates in the test
   * suite (and any legacy caller) stay valid, and an absent value is read as
   * "private" -- see `routeMessage` in ./commands.ts.
   */
  type?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramFrom;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
