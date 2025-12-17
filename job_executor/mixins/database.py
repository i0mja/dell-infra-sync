"""Database operations mixin for Job Executor"""

import requests
from typing import List, Dict, Optional
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
                            scheduled_time = datetime.fromisoformat(job['schedule_at'].replace('Z', '+00:00'))
                            if scheduled_time > datetime.now(timezone.utc):
                                continue
                        except Exception as e:
                            self.log(f"Error parsing schedule_at for job {job.get('id')}: {e}", "WARN")
                            continue
                    
                    ready_jobs.append(job)
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

    def update_job_status(
        self,
        job_id: str,
        status: str,
        details: Optional[Dict] = None,
        error: Optional[str] = None
    ) -> bool:
        """
        Update job status in database
        
        Args:
            job_id: Job UUID
            status: New status (pending, running, completed, failed, cancelled)
            details: Optional details dict to merge with existing details
            error: Optional error message for failed jobs
            
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
            
            # Set timestamps
            if status == "running":
                payload["started_at"] = datetime.now().isoformat()
            elif status in ["completed", "failed", "cancelled"]:
                payload["completed_at"] = datetime.now().isoformat()
            
            # Merge details if provided
            if details:
                # Fetch current details first
                get_response = requests.get(
                    url,
                    headers=headers,
                    params={**params, "select": "details"},
                    verify=VERIFY_SSL
                )
                if get_response.status_code == 200:
                    jobs = _safe_json_parse(get_response)
                    if jobs:
                        current_details = jobs[0].get('details') or {}
                        merged_details = {**current_details, **details}
                        payload["details"] = merged_details
                else:
                    payload["details"] = details
            
            # Add error message if provided
            if error:
                current_details = payload.get("details", {})
                current_details["error"] = error
                payload["details"] = current_details
            
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
                self.log(f"Failed to update job {job_id}: {response.status_code}", "WARN")
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
