import type {
  VotingWindowNotificationMessage,
  VotingWindowNotifier,
} from "@/application/voting-window-notification";
import type { Locale } from "@/i18n/config";
import { getMessages, type Messages } from "@/i18n/messages";

type Environment = Readonly<Record<string, string | undefined>>;
type Fetch = typeof fetch;

export interface ResendNotificationConfig {
  apiKey: string;
  operatorEmail: string;
  fromEmail: string;
}

export function readResendNotificationConfig(
  environment: Environment = process.env,
): ResendNotificationConfig | null {
  const apiKey = environment.RESEND_API_KEY?.trim();
  const operatorEmail = environment.VOTING_WINDOW_OPERATOR_EMAIL?.trim();
  const fromEmail = environment.VOTING_WINDOW_FROM_EMAIL?.trim();
  if (!apiKey && !operatorEmail && !fromEmail) return null;
  if (
    !apiKey ||
    !operatorEmail ||
    !fromEmail ||
    !validEmail(operatorEmail) ||
    !validSender(fromEmail)
  ) {
    return null;
  }
  return { apiKey, operatorEmail, fromEmail };
}

export function readNotificationSiteUrl(
  environment: Environment = process.env,
): URL | undefined {
  const configured = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export class ResendVotingWindowNotifier implements VotingWindowNotifier {
  constructor(
    private readonly config: ResendNotificationConfig,
    private readonly request: Fetch = fetch,
    private readonly locale: Locale = "es",
  ) {}

  async send(message: VotingWindowNotificationMessage) {
    const response = await this.request("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.config.fromEmail,
        to: [this.config.operatorEmail],
        subject: replace(
          getMessages(this.locale).operatorNotification.subject,
          {
            home: message.homeTeamName,
            away: message.awayTeamName,
          },
        ),
        text: buildMessageText(
          message,
          getMessages(this.locale).operatorNotification,
        ),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Notification delivery failed.");
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.id !== "string" || !body.id) {
      throw new Error("Notification delivery failed.");
    }
    return { providerMessageId: body.id };
  }
}

function buildMessageText(
  message: VotingWindowNotificationMessage,
  messages: Messages["operatorNotification"],
): string {
  const score =
    message.score.home === null || message.score.away === null
      ? messages.scoreUnavailable
      : `${message.score.home}-${message.score.away}`;
  return [
    replace(messages.intro, {
      home: message.homeTeamName,
      away: message.awayTeamName,
    }),
    "",
    replace(messages.score, { score }),
    replace(messages.matchId, { matchId: message.matchId }),
    replace(messages.opened, { opensAt: message.opensAt }),
    replace(messages.closes, { closesAt: message.closesAt }),
    ...(message.ratingUrl === undefined
      ? []
      : [replace(messages.vote, { url: message.ratingUrl })]),
  ].join("\n");
}

function replace(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(`{${key}}`, value),
    template,
  );
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validSender(value: string): boolean {
  const match = value.match(/^(?:[^<>\r\n]+\s)?<([^<>]+)>$/);
  return validEmail(match?.[1] ?? value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
