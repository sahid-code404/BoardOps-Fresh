import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./use-app-store";

describe("useAppStore navigation boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      view: "dashboard",
      sidebarOpen: false,
      commandOpen: false,
      notificationsOpen: false,
      pendingAction: null,
    });
  });

  it("ignores unknown runtime route values instead of touching the loader table", async () => {
    useAppStore.setState({ view: "dashboard" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const unsafeSetView = useAppStore.getState().setView as unknown as (view: string) => void;
    unsafeSetView("not-a-boardops-route");
    await Promise.resolve();

    expect(useAppStore.getState().view).toBe("dashboard");
    expect(warn).toHaveBeenCalledWith("Ignored invalid BoardOps navigation target: not-a-boardops-route");
  });
});
