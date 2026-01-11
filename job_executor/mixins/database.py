"""Database operations mixin for Job Executor"""

import json
import time
import requests
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone
from job_executor.utils import _safe_json_parse


class DatabaseMixin:
    """Mixin providing database operations for Job Executor"""
    
    def get_pending_jobs(self) -> List[Dict]:
        """
        Fetch pending jobs from the database
        
        Returns:
            List of pending job dicts ready for execution
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            url = f"{DSM_URL}/rest/v1/jobs"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                "status": "eq.pending",
                "select": "*",
                "order": "created_at.asc"
            }

            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "fetching pending jobs")
            
            if response.status_code == 200:
                jobs = _safe_json_parse(response)
                # Filter by schedule_at
                ready_jobs = []
                for job in jobs:
                    # Check if scheduled time has passed
                    if job.get('schedule_at'):
                        try:
                            schedule_str = job['schedule_at']
                            # Handle ISO format with Z suffix
                            if schedule_str.endswith('Z'):
                                schedule_str = schedule_str[:-1] + '+00:00'
                            scheduled_time = datetime.fromisoformat(schedule_str)
                            # Ensure timezone-aware comparison
                            if scheduled_time.tzinfo is None:
                                scheduled_time = scheduled_time.replace(tzinfo=timezone.utc)
                            if scheduled_time > datetime.now(timezone.utc):
                                continue
                        except Exception as e:
                            self.log(f"Error parsing schedule_at for job {job.get('id')}: {e}", "WARN")
                            continue
                    
                    ready_jobs.append(job)
                
                # Prioritize user-triggered jobs over internal/scheduled jobs
                # This ensures PDU discover, test, and sync jobs run before background vcenter_sync
                def job_priority(j):
                    details = j.get('details') or {}
                    is_internal = details.get('is_internal', False)
                    triggered_by = details.get('triggered_by', '')
                    is_scheduled = triggered_by in ('scheduled', 'scheduled_sync', 'automatic')
                    # Priority: 0 = user-triggered (highest), 1 = internal/scheduled (lowest)
                    priority = 1 if (is_internal or is_scheduled) else 0
                    return (priority, j.get('created_at', ''))
                
                ready_jobs.sort(key=job_priority)
                return ready_jobs
            else:
                self.log(f"Error fetching jobs: {response.status_code}", "ERROR")
                return []
        except Exception as e:
            self.log(f"Error fetching jobs: {e}", "ERROR")
            return []

    def get_job_tasks(self, job_id: str) -> List[Dict]:
        """
        Fetch all tasks for a job
        
        Args:
            job_id: Job UUID
            
        Returns:
            List of task dicts
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            url = f"{DSM_URL}/rest/v1/job_tasks"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}"
            }
            params = {
                "job_id": f"eq.{job_id}",
                "select": "*"
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                return _safe_json_parse(response)
            else:
                self.log(f"Error fetching tasks for job {job_id}: {response.status_code}", "WARN")
                return []
        except Exception as e:
            self.log(f"Error fetching tasks: {e}", "ERROR")
            return []

    def get_server_by_id(self, server_id: str) -> Optional[Dict]:
        """
        Fetch server record from database
        
        Args:
            server_id: Server UUID
            
        Returns:
            Server dict or None if not found
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            url = f"{DSM_URL}/rest/v1/servers"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}"
            }
            params = {
                "id": f"eq.{server_id}",
                "select": "*"
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                servers = _safe_json_parse(response)
                return servers[0] if servers else None
            else:
                self.log(f"Error fetching server {server_id}: {response.status_code}", "WARN")
                return None
        except Exception as e:
            self.log(f"Error fetching server: {e}", "ERROR")
            return None

    def _deep_sanitize_for_json(self, obj: Any) -> Any:
        """
        Recursively ensure all values are JSON-serializable.
        Converts complex objects (pyvmomi references, etc.) to simple types.
        """
        if obj is None:
            return None
        if isinstance(obj, (str, int, float, bool)):
            return obj
        if isinstance(obj, dict):
            return {str(k): self._deep_sanitize_for_json(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._deep_sanitize_for_json(i) for i in obj]
        if isinstance(obj, (datetime,)):
            return obj.isoformat()
        # Convert anything else to string representation
        try:
            return str(obj)
        except:
            return "<non-serializable>"

    def update_job_status(
        self,
        job_id: str,
        status: str,
        details: Optional[Dict] = None,
        error: Optional[str] = None,
        completed_at: Optional[str] = None,
        started_at: Optional[str] = None
    ) -> bool:
        """
        Update job status in database with robust JSON serialization and fallback.
        
        Args:
            job_id: Job UUID
            status: New status (pending, running, completed, failed, cancelled, paused)
            details: Optional details dict to merge with existing details
            error: Optional error message for failed jobs
            completed_at: Optional ISO timestamp for completion (auto-set if not provided)
            started_at: Optional ISO timestamp for start (auto-set if not provided)
            
        Returns:
            True if update successful, False otherwise
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            url = f"{DSM_URL}/rest/v1/jobs"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            params = {"id": f"eq.{job_id}"}
            
            # Build update payload
            payload = {"status": status}
            
            # Set timestamps - use provided values or auto-generate
            if status == "running":
                payload["started_at"] = started_at or datetime.now().isoformat()
            elif status in ["completed", "failed", "cancelled"]:
                payload["completed_at"] = completed_at or datetime.now().isoformat()
            
            # Merge details if provided
            merged_details = {}
            if details:
                # Fetch current details first
                try:
                    get_response = requests.get(
                        url,
                        headers=headers,
                        params={**params, "select": "details"},
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    if get_response.status_code == 200:
                        jobs = _safe_json_parse(get_response)
                        if jobs:
                            current_details = jobs[0].get('details') or {}
                            merged_details = {**current_details, **details}
                    else:
                        merged_details = details
                except Exception as fetch_err:
                    self.log(f"Warning: Could not fetch current details: {fetch_err}", "WARN")
                    merged_details = details
                
                payload["details"] = merged_details
            
            # Add error message if provided
            if error:
                current_details = payload.get("details", {})
                current_details["error"] = error
                payload["details"] = current_details
            
            # Test JSON serialization and sanitize if needed
            try:
                json.dumps(payload)
            except (TypeError, ValueError) as json_err:
                self.log(f"Payload contains non-serializable data, sanitizing: {json_err}", "WARN")
                payload = self._deep_sanitize_for_json(payload)
            
            # Retry logic for race condition handling
            max_retries = 3
            last_error = None
            
            for attempt in range(max_retries):
                response = requests.patch(
                    url,
                    headers=headers,
                    params=params,
                    json=payload,
                    verify=VERIFY_SSL,
                    timeout=10
                )
                
                if response.status_code in [200, 204]:
                    # Verify update took effect for terminal statuses
                    if status in ['completed', 'failed', 'cancelled']:
                        verified = False
                        for verify_attempt in range(3):
                            try:
                                verify_resp = requests.get(
                                    url,
                                    headers=headers,
                                    params={**params, "select": "status"},
                                    verify=VERIFY_SSL,
                                    timeout=5
                                )
                                if verify_resp.ok:
                                    jobs = _safe_json_parse(verify_resp)
                                    if jobs and jobs[0].get('status') == status:
                                        verified = True
                                        break
                                    else:
                                        self.log(f"Status verification failed (attempt {verify_attempt+1}/3), retrying...", "WARN")
                                        time.sleep(0.3)
                            except Exception as verify_err:
                                self.log(f"Status verification error: {verify_err}", "WARN")
                        
                        if verified:
                            return True
                        else:
                            # Verification failed - retry the full PATCH instead of fallback
                            self.log(f"Status verification failed after 3 attempts (PATCH attempt {attempt+1}/{max_retries}), retrying PATCH...", "WARN")
                            last_error = "Verification failed - status update not persisted"
                            time.sleep(0.5 * (attempt + 1))  # Backoff before retry
                            continue  # RETRY THE FULL PATCH
                    else:
                        return True  # Non-terminal status, no verification needed
                else:
                    # Log detailed error information
                    try:
                        error_body = response.json()
                        error_detail = json.dumps(error_body, default=str)[:500]
                    except:
                        error_detail = response.text[:500] if response.text else "No response body"
                    
                    last_error = f"status={response.status_code}, body={error_detail}"
                    
                    # Retry on server errors or conflicts
                    if response.status_code in [409, 500, 502, 503, 504] and attempt < max_retries - 1:
                        self.log(f"Job update retry {attempt+1}/{max_retries}: {last_error}", "WARN")
                        time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                        continue
                    
                    self.log(f"Job update failed: {last_error}", "ERROR")
                    break  # Exit loop to attempt fallback
            
            # FALLBACK: Only reached after ALL retries exhausted
            if status in ['paused', 'failed', 'cancelled', 'completed']:
                self.log(f"All {max_retries} PATCH retries exhausted, attempting fallback minimal update...", "WARN")
                minimal_payload = {"status": status}
                
                if status == 'completed':
                    # Include essential completion details
                    minimal_payload["completed_at"] = completed_at or datetime.now().isoformat()
                    minimal_payload["details"] = {
                        "progress_percent": 100,
                        "current_step": "Complete (fallback update)",
                        "fallback_update": True,
                        "vms_synced": details.get("vms_synced", 0) if details else 0,
                        "total_vms": details.get("total_vms", 0) if details else 0
                    }
                elif status == 'paused':
                    # Include only essential pause fields plus blockers if small enough
                    minimal_payload["details"] = {
                        "pause_reason": details.get("pause_reason", "Paused - check workflow steps") if details else "Paused",
                        "awaiting_blocker_resolution": details.get("awaiting_blocker_resolution", False) if details else False,
                        "hosts_with_blockers": details.get("hosts_with_blockers", 0) if details else 0,
                        "total_critical_blockers": details.get("total_critical_blockers", 0) if details else 0,
                        "can_retry": True,
                        "fallback_update": True
                    }
                    # Try to include blockers if small enough (under 50KB)
                    if details and details.get('current_blockers'):
                        try:
                            blockers_json = json.dumps(details['current_blockers'])
                            if len(blockers_json) < 50000:
                                minimal_payload["details"]["current_blockers"] = details['current_blockers']
                                self.log(f"Including blockers in fallback ({len(blockers_json)} bytes)", "DEBUG")
                            else:
                                self.log(f"Blockers too large for fallback ({len(blockers_json)} bytes), stored in workflow step", "WARN")
                        except Exception as blocker_err:
                            self.log(f"Could not serialize blockers for fallback: {blocker_err}", "WARN")
                
                try:
                    fallback_response = requests.patch(
                        url,
                        headers=headers,
                        params=params,
                        json=minimal_payload,
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    if fallback_response.status_code in [200, 204]:
                        self.log("Fallback minimal update succeeded", "INFO")
                        return True
                    else:
                        self.log(f"Fallback update also failed: {fallback_response.status_code}", "ERROR")
                except Exception as fallback_err:
                    self.log(f"Fallback update exception: {fallback_err}", "ERROR")
            
            return False
                
        except Exception as e:
            self.log(f"Error updating job status: {e}", "ERROR")
            return False

    def update_task_status(
        self,
        task_id: str,
        status: str,
        progress: Optional[int] = None,
        log_message: Optional[str] = None
    ) -> bool:
        """
        Update task status in database
        
        Args:
            task_id: Task UUID
            status: New status (pending, running, completed, failed)
            progress: Optional progress percentage (0-100)
            log_message: Optional log message to append
            
        Returns:
            True if update successful, False otherwise
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            url = f"{DSM_URL}/rest/v1/job_tasks"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            params = {"id": f"eq.{task_id}"}
            
            # Build update payload
            payload = {"status": status}
            
            # Set timestamps
            if status == "running":
                payload["started_at"] = datetime.now().isoformat()
            elif status in ["completed", "failed"]:
                payload["completed_at"] = datetime.now().isoformat()
            
            # Add progress if provided
            if progress is not None:
                payload["progress"] = progress
            
            # Append log message if provided
            if log_message:
                # Fetch current log first
                get_response = requests.get(
                    url,
                    headers=headers,
                    params={**params, "select": "log"},
                    verify=VERIFY_SSL
                )
                if get_response.status_code == 200:
                    tasks = _safe_json_parse(get_response)
                    if tasks:
                        current_log = tasks[0].get('log') or ""
                        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        new_log = f"{current_log}\n[{timestamp}] {log_message}" if current_log else f"[{timestamp}] {log_message}"
                        payload["log"] = new_log
                else:
                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    payload["log"] = f"[{timestamp}] {log_message}"
            
            response = requests.patch(
                url,
                headers=headers,
                params=params,
                json=payload,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code in [200, 204]:
                return True
            else:
                self.log(f"Failed to update task {task_id}: {response.status_code}", "WARN")
                return False
                
        except Exception as e:
            self.log(f"Error updating task status: {e}", "ERROR")
            return False

    def create_task(
        self,
        job_id: str,
        server_id: Optional[str] = None,
        vcenter_host_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Create a new task for a job
        
        Args:
            job_id: Parent job UUID
            server_id: Optional server UUID
            vcenter_host_id: Optional vCenter host UUID
            
        Returns:
            Task UUID if created successfully, None otherwise
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            url = f"{DSM_URL}/rest/v1/job_tasks"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            }
            
            payload = {
                "job_id": job_id,
                "status": "pending"
            }
            
            if server_id:
                payload["server_id"] = server_id
            if vcenter_host_id:
                payload["vcenter_host_id"] = vcenter_host_id
            
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                tasks = _safe_json_parse(response)
                if tasks and len(tasks) > 0:
                    return tasks[0]['id']
            else:
                self.log(f"Failed to create task: {response.status_code}", "WARN")
                
            return None
                
        except Exception as e:
            self.log(f"Error creating task: {e}", "ERROR")
            return None

    def is_job_cancelled(self, job_id: str) -> bool:
        """
        Check if a job has been cancelled by the user.
        Call this periodically during long-running operations.
        
        Args:
            job_id: Job UUID to check
            
        Returns:
            True if job status is 'cancelled', False otherwise
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/jobs?id=eq.{job_id}&select=status",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL,
                timeout=5
            )
            if response.status_code == 200:
                jobs = _safe_json_parse(response)
                if jobs and jobs[0].get('status') == 'cancelled':
                    return True
            return False
        except Exception:
            return False  # Assume not cancelled on error
    
    def get_job_status(self, job_id: str) -> dict:
        """
        Get the current job status and details from database.
        Used for checking cancellation flags and graceful cancel options.
        
        Args:
            job_id: Job UUID to check
            
        Returns:
            Dict with 'status' and 'details' keys, or empty dict on error
        """
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/jobs?id=eq.{job_id}&select=status,details",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL,
                timeout=5
            )
            if response.status_code == 200:
                jobs = _safe_json_parse(response)
                if jobs:
                    return {
                        'status': jobs[0].get('status'),
                        'details': jobs[0].get('details')
                    }
            return {}
        except Exception:
            return {}  # Return empty on error
