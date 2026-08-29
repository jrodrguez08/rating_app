import { enMessages } from "./messages/en";
import { esMessages } from "./messages/es";
import type { Locale } from "./config";

type StringShape<T> = {
  [Key in keyof T]: T[Key] extends string ? string : StringShape<T[Key]>;
};

export type Messages = StringShape<typeof esMessages>;

const messages: Record<Locale, Messages> = {
  es: esMessages,
  en: enMessages,
};

export function getMessages(locale: Locale): Messages {
  return messages[locale] ?? messages.es;
}
