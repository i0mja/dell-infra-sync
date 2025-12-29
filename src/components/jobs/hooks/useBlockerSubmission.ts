import { useCallback, useEffect, useRef, useState } from "react";

export interface BlockerSubmissionState {
  selectedVmIds: string[];
  isSubmitting: boolean;
  pendingTaskId: string | null;
  submitError: string | null;
  submitStartedAt: number | null;
  timedOut: boolean;
  activeSubmissionId: number | null;
}

export interface BlockerSubmissionControls {
  startSubmission: (vmIds: string[]) => number;
  markSuccess: (taskId: string, submissionId?: number | null) => void;
  markError: (message: string, submissionId?: number | null) => void;
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
  const [activeSubmissionId, setActiveSubmissionId] = useState<number | null>(null);
  const submissionCounterRef = useRef(0);

  const startSubmission = useCallback((vmIds: string[]) => {
    const nextSubmissionId = submissionCounterRef.current + 1;
    submissionCounterRef.current = nextSubmissionId;

    setSelectedVmIds(vmIds);
    setActiveSubmissionId(nextSubmissionId);
    setIsSubmitting(true);
    setPendingTaskId(null);
    setSubmitError(null);
    setTimedOut(false);
    setSubmitStartedAt(Date.now());
    return nextSubmissionId;
  }, []);

  const markSuccess = useCallback(
    (taskId: string, submissionId?: number | null) => {
      if (submissionId !== undefined && submissionId !== activeSubmissionId) {
        return;
      }

      // If no active submission exists, ignore stale completions
      if (submissionId === undefined && activeSubmissionId === null && !isSubmitting) {
        return;
      }

      setPendingTaskId(taskId);
      setIsSubmitting(false);
      setTimedOut(false);
      setSubmitError(null);
      setActiveSubmissionId(null);
    },
    [activeSubmissionId, isSubmitting]
  );

  const markError = useCallback(
    (message: string, submissionId?: number | null) => {
      if (submissionId !== undefined && submissionId !== activeSubmissionId) {
        return;
      }

      if (submissionId === undefined && activeSubmissionId === null && !isSubmitting) {
        return;
      }

      setSubmitError(message);
      setIsSubmitting(false);
      setTimedOut(false);
      setActiveSubmissionId(null);
    },
    [activeSubmissionId, isSubmitting]
  );

  const cancelSubmission = useCallback(() => {
    setIsSubmitting(false);
    setPendingTaskId(null);
    setSubmitStartedAt(null);
    setSubmitError(null);
    setTimedOut(false);
    setActiveSubmissionId(null);
  }, []);

  const resetSubmissionState = useCallback(() => {
    setIsSubmitting(false);
    setPendingTaskId(null);
    setTimedOut(false);
    setSubmitStartedAt(null);
    setSubmitError(null);
    setActiveSubmissionId(null);
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
    activeSubmissionId,
    startSubmission,
    markSuccess,
    markError,
    cancelSubmission,
    resetSubmissionState
  };
};
