import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useBlockerSubmission } from "./useBlockerSubmission";

describe("useBlockerSubmission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("captures selected VM ids and marks submission in progress", () => {
    const { result } = renderHook(() => useBlockerSubmission(10000));

    let submissionId: number;
    act(() => {
      submissionId = result.current.startSubmission(["vm-1", "vm-2"]);
    });

    expect(submissionId).toBe(1);
    expect(result.current.selectedVmIds).toEqual(["vm-1", "vm-2"]);
    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.pendingTaskId).toBeNull();
    expect(result.current.activeSubmissionId).toBe(1);
  });

  it("records success and stops blocking overlay", () => {
    const { result } = renderHook(() => useBlockerSubmission());

    let submissionId: number;
    act(() => {
      submissionId = result.current.startSubmission(["vm-1"]);
    });

    act(() => {
      result.current.markSuccess("task-123", submissionId);
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.pendingTaskId).toBe("task-123");
    expect(result.current.submitError).toBeNull();
    expect(result.current.timedOut).toBe(false);
    expect(result.current.activeSubmissionId).toBeNull();
  });

  it("times out long submissions and surfaces retry messaging", () => {
    const { result } = renderHook(() => useBlockerSubmission(100));

    act(() => {
      result.current.startSubmission(["vm-1"]);
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.timedOut).toBe(true);
    expect(result.current.submitError).toContain("longer than expected");
  });

  it("allows cancel without losing VM selection", () => {
    const { result } = renderHook(() => useBlockerSubmission(10000));

    let submissionId: number;
    act(() => {
      submissionId = result.current.startSubmission(["vm-1", "vm-2"]);
    });

    act(() => {
      result.current.cancelSubmission();
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.pendingTaskId).toBeNull();
    expect(result.current.selectedVmIds).toEqual(["vm-1", "vm-2"]);
    expect(result.current.activeSubmissionId).toBeNull();
    expect(submissionId).toBe(1);
  });

  it("captures explicit errors and keeps selection for retries", () => {
    const { result } = renderHook(() => useBlockerSubmission());

    let submissionId: number;
    act(() => {
      submissionId = result.current.startSubmission(["vm-1"]);
    });

    act(() => {
      result.current.markError("Failed to submit", submissionId);
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.submitError).toBe("Failed to submit");
    expect(result.current.selectedVmIds).toEqual(["vm-1"]);
    expect(result.current.activeSubmissionId).toBeNull();
  });

  it("ignores stale completions after a cancellation or retry", () => {
    const { result } = renderHook(() => useBlockerSubmission());

    let firstSubmissionId: number;
    act(() => {
      firstSubmissionId = result.current.startSubmission(["vm-1"]);
    });

    act(() => {
      result.current.cancelSubmission();
    });

    act(() => {
      result.current.markSuccess("task-ignored", firstSubmissionId);
    });

    expect(result.current.pendingTaskId).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.submitError).toBeNull();

    let secondSubmissionId: number;
    act(() => {
      secondSubmissionId = result.current.startSubmission(["vm-2"]);
    });

    act(() => {
      result.current.markError("stale error", firstSubmissionId);
    });

    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.pendingTaskId).toBeNull();
    expect(result.current.submitError).toBeNull();
    expect(result.current.activeSubmissionId).toBe(secondSubmissionId);

    act(() => {
      result.current.markSuccess("task-200", secondSubmissionId);
    });

    expect(result.current.pendingTaskId).toBe("task-200");
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.activeSubmissionId).toBeNull();
  });
});
