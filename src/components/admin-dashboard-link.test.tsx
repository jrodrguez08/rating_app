import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AdminDashboardLink } from "./admin-dashboard-link";

it("links back to the admin dashboard without issuing a mutation", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<AdminDashboardLink label="← Volver al dashboard" />);

  const link = screen.getByRole("link", { name: "← Volver al dashboard" });
  expect(link).toHaveAttribute("href", "/admin");
  expect(fetchMock).not.toHaveBeenCalled();
});
