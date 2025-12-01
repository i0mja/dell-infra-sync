import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface MinimizedJob {
  jobId: string;
  jobType: string;
  minimizedAt: number;
}

interface MinimizedJobsContextType {
  minimizedJobs: MinimizedJob[];
  minimizeJob: (jobId: string, jobType: string) => void;
  maximizeJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  isMinimized: (jobId: string) => boolean;
}

const MinimizedJobsContext = createContext<MinimizedJobsContextType | undefined>(undefined);

const STORAGE_KEY = 'minimized-jobs';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export const MinimizedJobsProvider = ({ children }: { children: ReactNode }) => {
  const [minimizedJobs, setMinimizedJobs] = useState<MinimizedJob[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const jobs: MinimizedJob[] = JSON.parse(stored);
        const now = Date.now();
        // Filter out stale jobs older than 24 hours
        const validJobs = jobs.filter(job => (now - job.minimizedAt) < MAX_AGE_MS);
        setMinimizedJobs(validJobs);
        if (validJobs.length !== jobs.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(validJobs));
        }
      }
    } catch (error) {
      console.error('Failed to load minimized jobs from localStorage:', error);
    }
  }, []);

  // Save to localStorage whenever minimizedJobs changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(minimizedJobs));
    } catch (error) {
      console.error('Failed to save minimized jobs to localStorage:', error);
    }
  }, [minimizedJobs]);

  const minimizeJob = (jobId: string, jobType: string) => {
    setMinimizedJobs(prev => {
      // Don't add duplicate
      if (prev.some(j => j.jobId === jobId)) {
        return prev;
      }
      return [...prev, { jobId, jobType, minimizedAt: Date.now() }];
    });
  };

  const maximizeJob = (jobId: string) => {
    setMinimizedJobs(prev => prev.filter(j => j.jobId !== jobId));
  };

  const removeJob = (jobId: string) => {
    setMinimizedJobs(prev => prev.filter(j => j.jobId !== jobId));
  };

  const isMinimized = (jobId: string) => {
    return minimizedJobs.some(j => j.jobId === jobId);
  };

  return (
    <MinimizedJobsContext.Provider
      value={{
        minimizedJobs,
        minimizeJob,
        maximizeJob,
        removeJob,
        isMinimized,
      }}
    >
      {children}
    </MinimizedJobsContext.Provider>
  );
};

export const useMinimizedJobs = () => {
  const context = useContext(MinimizedJobsContext);
  if (context === undefined) {
    throw new Error('useMinimizedJobs must be used within a MinimizedJobsProvider');
  }
  return context;
};
