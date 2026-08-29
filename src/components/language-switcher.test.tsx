import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localeCookieName } from "@/i18n/config";

import { LanguageSwitcher } from "./language-switcher";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    refresh.mockClear();
    document.cookie = `${localeCookieName}=; Max-Age=0; Path=/`;
  });

  it("shows compact ES and exposes both languages with Spanish current", async () => {
    const user = userEvent.setup();
    render(
      <LanguageSwitcher
        locale="es"
        label="Idioma"
        languageNames={{ es: "Español", en: "English" }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Idioma: Español" });
    expect(trigger).toHaveTextContent("ES");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "Idioma" });
    expect(within(menu).getByText("Español")).toBeInTheDocument();
    expect(within(menu).getByText("English")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Español" }),
    ).toHaveAttribute("aria-checked", "true");

    await user.click(
      within(menu).getByRole("menuitemradio", { name: "English" }),
    );

    expect(document.cookie).toContain(`${localeCookieName}=en`);
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows compact EN and persists a Spanish selection", async () => {
    const user = userEvent.setup();
    render(
      <LanguageSwitcher
        locale="en"
        label="Language"
        languageNames={{ es: "Español", en: "English" }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Language: English",
    });
    expect(trigger).toHaveTextContent("EN");
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Language" });
    expect(
      within(menu).getByRole("menuitemradio", { name: "English" }),
    ).toHaveAttribute("aria-checked", "true");

    await user.click(
      within(menu).getByRole("menuitemradio", { name: "Español" }),
    );

    expect(document.cookie).toContain(`${localeCookieName}=es`);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <LanguageSwitcher
        locale="es"
        label="Idioma"
        languageNames={{ es: "Español", en: "English" }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Idioma: Español" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
