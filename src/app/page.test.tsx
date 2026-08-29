import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("presents the initial club and an honest inactive state", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Club Sport Herediano" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No active rating" })).toBeInTheDocument();
    expect(screen.getByText(/results stay hidden while voting is open/i)).toBeInTheDocument();
  });
  it("exposes semantic primary navigation with future destinations disabled", () => {
    render(<Home />);
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(navigation).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(within(navigation).getByText("Matches")).toHaveAttribute("aria-disabled", "true");
    expect(within(navigation).getByText("Players")).toHaveAttribute("aria-disabled", "true");
  });
  it("provides a keyboard skip link and a labeled main region", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
