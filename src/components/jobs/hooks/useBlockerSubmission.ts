import { useCallback, useEffect, useState } from "react";

export interface BlockerSubmissionState {
  selectedVmIds: string[];
  isSubmitting: boolean;
  pendingTaskId: string | null;
  submitError: string | null;
  submitStartedAt: number | null;
  timedOut: boolean;
}

export interface BlockerSubmissionControls {
  startSubmission: (vmIds: string[]) => void;
  markSuccess: (taskId: string) => void;
  markError: (message: string) => void;
  cancelSubmission: () => void;
  resetSubmissionState: () => void;
}

/**
 * Centralizes the transient UI state while we submit blocker resolutions to the backend.
 * Keeps selection stable across polling updates and guards against long-running submissions
 * with a timeout + retry surface.
 */
export const useBlockerSubmission = (
  timeoutMs = 20000
): BlockerSubmissionState & BlockerSubmissionControls => {
  const [selectedVmIds, setSelectedVmIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStartedAt, setSubmitStartedAt] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const startSubmission = useCallback((vmIds: string[]) => {
    setSelectedVmIds(vmIds);
    setIsSubmitting(true);
    setPendingTaskId(null);
    setSubmitError(null);
    setTimedOut(false);
    setSubmitStartedAt(Date.now());
  }, []);

  const markSuccess = useCallback((taskId: string) => {
    setPendingTaskId(taskId);
    setIsSubmitting(false);
    setTimedOut(false);
    setSubmitError(null);
  }, []);

  const markError = useCallback((message: string) => {
    setSubmitError(message);
    setIsSubmitting(false);
    setTimedOut(false);
  }, []);

  const cancelSubmission = useCallback(() => {
    setIsSubmitting(false);
    setPendingTaskId(null);
    setSubmitStartedAt(null);
    setSubmitError(null);
    setTimedOut(false);
  }, []);

  const resetSubmissionState = useCallback(() => {
    setIsSubmitting(false);
    setPendingTaskId(null);
    setSubmitError(null);
    setTimedOut(false);
    setSubmitStartedAt(null);
  }, []);

  useEffect(() => {
    if (!isSubmitting || !submitStartedAt) return;

    const timer = setTimeout(() => {
      setTimedOut(true);
      setIsSubmitting(false);
      setSubmitError(
        'Submission is taking longer than expected. You can retry without losing your VM selections.'
      );
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [isSubmitting, submitStartedAt, timeoutMs]);

  return {
    selectedVmIds,
    isSubmitting,
    pendingTaskId,
    submitError,
    submitStartedAt,
    timedOut,
    startSubmission,
    markSuccess,
    markError,
    cancelSubmission,
    resetSubmissionState
  };
};
