import "./_env";

import { createHmac } from "node:crypto";

// Independent re-implementation of Telegram's initData *signing* half
// (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app),
// deliberately not importing src/lib/telegram/init-data.ts -- this script
// exists to be a genuine, independent producer whose output can round-trip
// through that validator.

function fail(message: string): never {
  console.error(`dev-mock-init-data: ${message}`);
  process.exit(1);
}

function main() {
  const [, , rawUserId] = process.argv;

  if (!rawUserId) {
    fail(
      "Usage: npx tsx scripts/dev-mock-init-data.ts <telegram_user_id>",
    );
  }

  if (!/^-?\d+$/.test(rawUserId)) {
    fail(`<telegram_user_id> must be an integer, got: ${rawUserId}`);
  }
  const telegramUserId = Number(rawUserId);
  if (!Number.isSafeInteger(telegramUserId)) {
    fail(`<telegram_user_id> is not a safe integer: ${rawUserId}`);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    fail("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");
  }

  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: telegramUserId });

  // Fields that go into the data-check-string, unencoded.
  const fields: Record<string, string> = {
    query_id: "dev",
    user,
    auth_date: String(authDate),
  };

  // Data-check-string: keys sorted lexicographically, `key=value` joined by \n.
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const initData = new URLSearchParams({
    ...fields,
    hash,
  }).toString();

  // Only the initData string goes to stdout, so
  // `NEXT_PUBLIC_DEV_MOCK_INIT_DATA=$(npx tsx scripts/dev-mock-init-data.ts <id>)`
  // captures it cleanly; the usage hint goes to stderr.
  console.log(initData);
  console.error(
    `# Paste into NEXT_PUBLIC_DEV_MOCK_INIT_DATA, or: curl -H "X-Telegram-Init-Data: ${initData}" <url>`,
  );
}

main();
