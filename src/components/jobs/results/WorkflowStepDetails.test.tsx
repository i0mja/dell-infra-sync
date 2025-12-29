import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WorkflowStepDetails } from "./WorkflowStepDetails";

describe("WorkflowStepDetails", () => {
  it("hides raw JSON by default and reveals it on toggle", () => {
    render(
      <WorkflowStepDetails
        stepName="maintenance"
        stepNumber={1}
        details={{ maintenance_mode: true, raw_response: { foo: "bar" } }}
      />
    );

    expect(screen.queryByTestId("raw-json-block")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /view raw json/i }));

    expect(screen.getByTestId("raw-json-block")).toBeInTheDocument();
  });

  it("shows VMware context summary before raw details", () => {
    render(
      <WorkflowStepDetails
        stepName="evacuate"
        stepNumber={2}
        details={{ maintenance_mode: true, vms_evacuated: 4 }}
      />
    );

    expect(screen.getByText(/Maintenance mode enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/4 VMs evacuated/i)).toBeInTheDocument();
  });

  it("summarizes Redfish firmware jobs into human readable text", () => {
    render(
      <WorkflowStepDetails
        stepName="redfish"
        stepNumber={3}
        details={{
          firmware_jobs: [
            { name: "iDRAC Update", component: "BIOS", percent_complete: 50, status: "Running" },
          ],
        }}
      />
    );

    expect(screen.getByText(/iDRAC Update · BIOS · 50% · Running/i)).toBeInTheDocument();
  });

  it("renders maintenance evacuation context with migrations and remaining VMs", () => {
    render(
      <WorkflowStepDetails
        stepName="Maintenance"
        stepNumber={4}
        details={{
          active_migrations: [{ vm_name: "vm-01", task_key: "task-1", progress: 20, state: "running" }],
          vms_remaining: [{ name: "vm-02", reason: "Waiting for capacity" }],
          human_readable_status: "Evacuation in progress",
          stall_duration_seconds: 120,
        }}
      />
    );

    expect(screen.getAllByText(/Evacuation in progress/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/vm-01/i)).toBeInTheDocument();
    expect(screen.getByText(/Remaining VMs/i)).toBeInTheDocument();
  });
});
