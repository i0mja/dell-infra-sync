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
});
