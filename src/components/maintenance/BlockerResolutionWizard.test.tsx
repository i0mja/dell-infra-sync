import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BlockerResolutionWizard } from "./BlockerResolutionWizard";

const baseHostBlockers = {
  "host-1": {
    host_id: "host-1",
    host_name: "Host 1",
    server_id: "server-1",
    can_enter_maintenance: false,
    blockers: [
      {
        vm_id: "vm-1",
        vm_name: "VM 1",
        reason: "passthrough",
        details: "USB passthrough",
        remediation: "Power off",
        severity: "warning" as const,
        auto_fixable: true,
      },
    ],
    warnings: [],
    total_powered_on_vms: 1,
    migratable_vms: 0,
    blocked_vms: 1,
    estimated_evacuation_time: 0,
  },
};

describe("BlockerResolutionWizard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves power-off selections when host data refreshes during polling", async () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <BlockerResolutionWizard
        open={true}
        onOpenChange={() => {}}
        hostBlockers={baseHostBlockers}
        onComplete={onComplete}
      />
    );

    // Finish simulated scanning so navigation is enabled
    act(() => {
      vi.runAllTimers();
    });

    // Navigate to the passthrough step (Scan -> Summary -> Passthrough)
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    const [firstCheckbox] = screen.getAllByRole("checkbox");
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).toBeChecked();

    // Rerender with updated blockers (e.g., polling update adds a new host)
    act(() => {
      rerender(
        <BlockerResolutionWizard
          open={true}
          onOpenChange={() => {}}
          hostBlockers={{
            ...baseHostBlockers,
            "host-2": {
              host_id: "host-2",
              host_name: "Host 2",
              server_id: "server-2",
              can_enter_maintenance: false,
              blockers: [
                {
                  vm_id: "vm-2",
                  vm_name: "VM 2",
                  reason: "local_storage",
                  details: "Local datastore",
                  remediation: "Power off",
                  severity: "warning" as const,
                  auto_fixable: true,
                },
              ],
              warnings: [],
              total_powered_on_vms: 1,
              migratable_vms: 0,
              blocked_vms: 1,
              estimated_evacuation_time: 0,
            },
          }}
          onComplete={onComplete}
        />
      );
    });

    // Original selection should remain checked after polling refresh
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  });
});
