import { render, screen } from "@testing-library/react";
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

  it("exposes the current language and persists an English selection", async () => {
    const user = userEvent.setup();
    render(
      <LanguageSwitcher
        locale="es"
        label="Idioma"
        languageNames={{ es: "Español", en: "English" }}
      />,
    );

    const group = screen.getByRole("group", { name: "Idioma" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(document.cookie).toContain(`${localeCookieName}=en`);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
