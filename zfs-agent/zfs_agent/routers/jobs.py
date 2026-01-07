"""
Job listing and management endpoints.
"""

from datetime import datetime
from typing import Optional, List
from collections import deque

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from zfs_agent.models.job import AgentJob, JobStatus, JobType, JobListResponse

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])

# In-memory job storage (circular buffer for last 1000 jobs)
MAX_JOBS = 1000
_jobs: deque[AgentJob] = deque(maxlen=MAX_JOBS)
_jobs_by_id: dict[str, AgentJob] = {}


def add_job(job: AgentJob):
    """Add a job to the storage."""
    _jobs.append(job)
    _jobs_by_id[job.id] = job
    
    # Clean up old jobs from dict if we hit the limit
    if len(_jobs_by_id) > MAX_JOBS:
        # Remove jobs not in the deque
        valid_ids = {j.id for j in _jobs}
        for job_id in list(_jobs_by_id.keys()):
            if job_id not in valid_ids:
                del _jobs_by_id[job_id]


def update_job(job_id: str, updates: dict):
    """Update a job."""
    if job_id in _jobs_by_id:
        job = _jobs_by_id[job_id]
        for key, value in updates.items():
            if hasattr(job, key):
                setattr(job, key, value)


@router.get("", response_model=JobListResponse)
async def list_jobs(
    state: Optional[str] = Query(None, description="Filter by status"),
    job_type: Optional[str] = Query(None, description="Filter by job type"),
    limit: int = Query(50, ge=1, le=500)
):
    """
    List recent jobs.
    
    Args:
        state: Filter by status (pending, running, success, failed, cancelled)
        job_type: Filter by type (snapshot, replication, prune, etc.)
        limit: Maximum number of jobs to return
    """
    jobs = list(_jobs)
    
    # Apply filters
    if state:
        jobs = [j for j in jobs if j.status.value == state]
    if job_type:
        jobs = [j for j in jobs if j.job_type.value == job_type]
    
    # Sort by created_at (newest first) and limit
    jobs.sort(key=lambda j: j.created_at, reverse=True)
    jobs = jobs[:limit]
    
    return JobListResponse(jobs=jobs, count=len(jobs))


@router.get("/{job_id}", response_model=AgentJob)
async def get_job(job_id: str):
    """
    Get a specific job.
    """
    if job_id not in _jobs_by_id:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    
    return _jobs_by_id[job_id]


class JobLogsResponse(BaseModel):
    job_id: str
    logs: List[str]
    count: int


@router.get("/{job_id}/logs", response_model=JobLogsResponse)
async def get_job_logs(
    job_id: str,
    tail: int = Query(100, ge=1, le=1000)
):
    """
    Get logs for a specific job.
    
    Args:
        job_id: Job ID
        tail: Number of log lines to return (from end)
    """
    if job_id not in _jobs_by_id:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    
    job = _jobs_by_id[job_id]
    logs = job.logs[-tail:] if job.logs else []
    
    return JobLogsResponse(
        job_id=job_id,
        logs=logs,
        count=len(logs)
    )
