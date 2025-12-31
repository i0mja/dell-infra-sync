"""
SLA Monitoring Handler for Protection Groups

Handles:
- scheduled_replication_check: Auto-triggers syncs based on schedule
- rpo_monitoring: Monitors RPO compliance and sends alerts
"""

import re
import time
from typing import Dict, Optional, List
from datetime import datetime, timezone, timedelta

import requests

from job_executor.handlers.base import BaseHandler
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL, SUPABASE_URL
from job_executor.utils import utc_now_iso


class SLAMonitoringHandler(BaseHandler):
    """
    Handler for SLA monitoring operations.
    
    Ensures protection groups meet their configured SLA targets
    by auto-scheduling syncs and monitoring RPO compliance.
    """
    
    # =========================================================================
    # Scheduled Replication Check
    # =========================================================================
    
    def execute_scheduled_replication_check(self, job: Dict):
        """
        Check all protection groups and trigger syncs based on their schedules.
        
        This job should run every minute to check if any groups need syncing.
        """
        job_id = job['id']
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            # Get all enabled, non-paused protection groups
            groups = self._get_eligible_protection_groups()
            
            triggered = []
            skipped = []
            
            for group in groups:
                group_name = group.get('name', 'Unknown')
                schedule = group.get('replication_schedule')
                last_sync = group.get('last_replication_at')
                sync_in_progress = group.get('sync_in_progress', False)
                
                # Skip if no schedule configured
                if not schedule:
                    skipped.append({'name': group_name, 'reason': 'No schedule'})
                    continue
                
                # Skip if already syncing
                if sync_in_progress:
                    skipped.append({'name': group_name, 'reason': 'Sync in progress'})
                    continue
                
                # Check if it's time to sync
                if self._should_sync_now(schedule, last_sync):
                    # Check for no active sync jobs
                    if not self._has_pending_sync_job(group['id']):
                        self._create_sync_job(group['id'], group.get('created_by'))
                        triggered.append(group_name)
                        
                        # Update next_scheduled_sync
                        next_sync = self._calculate_next_sync(schedule)
                        self._update_protection_group(group['id'], next_scheduled_sync=next_sync)
                        
                        self.executor.log(f"[SLA] Triggered scheduled sync for: {group_name}")
            
            self.executor.log(f"[SLA] Scheduled check complete: {len(triggered)} triggered, {len(skipped)} skipped")
            
            self.update_job_status(
                job_id, 'completed',
                completed_at=utc_now_iso(),
                details={
                    'triggered_syncs': triggered,
                    'skipped': skipped,
                    'groups_checked': len(groups),
                    'next_run_scheduled': True
                }
            )
            
            # Schedule next run (every 60 seconds)
            self._schedule_next_sla_job('scheduled_replication_check', 60)
            
        except Exception as e:
            self.executor.log(f"[SLA] Scheduled replication check failed: {e}", "ERROR")
            self.update_job_status(
                job_id, 'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
            # Still reschedule even on failure to maintain continuous monitoring
            self._schedule_next_sla_job('scheduled_replication_check', 60)
    
    # =========================================================================
    # RPO Monitoring
    # =========================================================================
    
    def execute_rpo_monitoring(self, job: Dict):
        """
        Monitor RPO compliance for all protection groups and send alerts.
        
        This job should run every 5 minutes to check SLA status.
        """
        job_id = job['id']
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            groups = self._get_all_protection_groups()
            violations = []
            test_overdue = []
            
            for group in groups:
                group_name = group.get('name', 'Unknown')
                group_id = group['id']
                
                # Skip paused groups for RPO calculation
                is_paused = group.get('paused_at') is not None
                
                # Calculate current RPO
                last_sync = group.get('last_replication_at')
                current_rpo_seconds = self._calculate_current_rpo(last_sync)
                target_rpo_minutes = group.get('rpo_minutes', 60)
                target_rpo_seconds = target_rpo_minutes * 60
                
                # Determine SLA status
                if is_paused:
                    status = 'paused'
                elif current_rpo_seconds <= target_rpo_seconds:
                    status = 'meeting_sla'
                elif current_rpo_seconds <= target_rpo_seconds * 1.5:
                    status = 'warning'
                else:
                    status = 'not_meeting_sla'
                
                # Update group's current_rpo_seconds and status
                self._update_protection_group(
                    group_id,
                    current_rpo_seconds=current_rpo_seconds,
                    status=status
                )
                
                # Record RPO violation if applicable (only for enabled groups)
                if group.get('is_enabled', True) and not is_paused and status == 'not_meeting_sla':
                    severity = 'critical' if current_rpo_seconds > target_rpo_seconds * 2 else 'warning'
                    violation = {
                        'group_id': group_id,
                        'group_name': group_name,
                        'current_rpo_minutes': current_rpo_seconds // 60,
                        'target_rpo_minutes': target_rpo_minutes,
                        'severity': severity
                    }
                    violations.append(violation)
                    self._record_sla_violation(group_id, 'rpo_breach', violation, severity)
                else:
                    # Resolve any existing RPO violations
                    self._resolve_sla_violations(group_id, 'rpo_breach')
                
                # Check test reminder (for all groups, even paused)
                if group.get('test_reminder_days'):
                    if self._is_test_overdue(group):
                        test_overdue.append({
                            'group_id': group_id,
                            'group_name': group_name,
                            'last_test_at': group.get('last_test_at'),
                            'created_at': group.get('created_at'),
                            'reminder_days': group.get('test_reminder_days')
                        })
                        self._record_sla_violation(group_id, 'test_overdue', {
                            'group_name': group_name,
                            'reminder_days': group.get('test_reminder_days')
                        }, 'warning')
                    else:
                        self._resolve_sla_violations(group_id, 'test_overdue')
            
            # Send batch notification if violations exist
            if violations:
                self._send_sla_alert(violations, 'rpo_breach')
            
            if test_overdue:
                self._send_sla_alert(test_overdue, 'test_overdue')
            
            self.executor.log(f"[SLA] RPO monitoring complete: {len(violations)} RPO violations, {len(test_overdue)} test overdue")
            
            self.update_job_status(
                job_id, 'completed',
                completed_at=utc_now_iso(),
                details={
                    'groups_checked': len(groups),
                    'rpo_violations': len(violations),
                    'test_overdue': len(test_overdue),
                    'next_run_scheduled': True
                }
            )
            
            # Schedule next run (every 5 minutes = 300 seconds)
            self._schedule_next_sla_job('rpo_monitoring', 300)
            
        except Exception as e:
            self.executor.log(f"[SLA] RPO monitoring failed: {e}", "ERROR")
            self.update_job_status(
                job_id, 'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
            # Still reschedule even on failure to maintain continuous monitoring
            self._schedule_next_sla_job('rpo_monitoring', 300)
    
    # =========================================================================
    # Helper Methods
    # =========================================================================
    
    def _schedule_next_sla_job(self, job_type: str, interval_seconds: int):
        """
        Schedule the next SLA monitoring job after current one completes.
        
        This ensures continuous monitoring by creating a new pending job
        that will run after the specified interval.
        Also detects and recovers stale running jobs to prevent blocking.
        """
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            # Check for existing pending/running jobs
            check_response = requests.get(
                f"{DSM_URL}/rest/v1/jobs",
                params={
                    'job_type': f'eq.{job_type}',
                    'status': 'in.(pending,running)',
                    'select': 'id,status,started_at'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if check_response.ok:
                existing_jobs = check_response.json() or []
                
                for job in existing_jobs:
                    # Check if running job is stale (> 10 minutes)
                    if job['status'] == 'running' and job.get('started_at'):
                        started_str = job['started_at']
                        if started_str.endswith('Z'):
                            started_str = started_str[:-1] + '+00:00'
                        started = datetime.fromisoformat(started_str)
                        if started.tzinfo is None:
                            started = started.replace(tzinfo=timezone.utc)
                        
                        if datetime.now(timezone.utc) - started > timedelta(minutes=10):
                            # Mark stale job as failed
                            self.executor.log(f"[SLA] Recovering stale {job_type} job {job['id']}")
                            self.update_job_status(
                                job['id'], 'failed',
                                completed_at=utc_now_iso(),
                                details={'error': 'Job exceeded 10min maximum runtime', 'auto_recovered': True}
                            )
                            continue  # Don't count this as blocking
                    
                    # Found a valid pending/running job that isn't stale
                    self.executor.log(f"[SLA] {job_type} already has pending job, skipping reschedule")
                    return
            
            # Calculate when next job should start
            next_run = datetime.now(timezone.utc) + timedelta(seconds=interval_seconds)
            
            # Create next monitoring job with schedule_at
            response = requests.post(
                f"{DSM_URL}/rest/v1/jobs",
                json={
                    'job_type': job_type,
                    'status': 'pending',
                    'schedule_at': next_run.isoformat(),
                    'details': {
                        'is_internal': True,
                        'interval_seconds': interval_seconds,
                        'scheduled_at': utc_now_iso(),
                        'auto_rescheduled': True
                    }
                },
                headers={
                    **headers,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                self.executor.log(f"[SLA] Scheduled next {job_type} in {interval_seconds}s")
            else:
                self.executor.log(f"[SLA] Failed to schedule next {job_type}: {response.status_code}", "WARN")
                
        except Exception as e:
            self.executor.log(f"[SLA] Error scheduling next {job_type}: {e}", "ERROR")
    
    def _get_eligible_protection_groups(self) -> List[Dict]:
        """Get protection groups that are enabled, not paused, and have a schedule"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={
                    'is_enabled': 'eq.true',
                    'paused_at': 'is.null',
                    'select': '*'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            if response.ok:
                return response.json() or []
        except Exception as e:
            self.executor.log(f"Error fetching eligible groups: {e}", "ERROR")
        return []
    
    def _get_all_protection_groups(self) -> List[Dict]:
        """Get all protection groups for monitoring"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={'select': '*'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            if response.ok:
                return response.json() or []
        except Exception as e:
            self.executor.log(f"Error fetching all groups: {e}", "ERROR")
        return []
    
    def _should_sync_now(self, schedule: str, last_sync: Optional[str]) -> bool:
        """
        Check if a sync should run based on cron-like schedule.
        
        Schedule formats:
        - "0 * * * *" = hourly (at minute 0)
        - "*/15 * * * *" = every 15 minutes
        - "0 */4 * * *" = every 4 hours
        - "Daily", "Hourly", "Every 15 minutes" = human-readable
        """
        if not schedule:
            return False
        
        interval_minutes = self._parse_schedule_interval(schedule)
        
        if interval_minutes is None:
            return False
        
        # If never synced, should sync now
        if not last_sync:
            return True
        
        try:
            # Parse last sync time
            if last_sync.endswith('Z'):
                last_sync = last_sync[:-1] + '+00:00'
            last = datetime.fromisoformat(last_sync)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            
            now = datetime.now(timezone.utc)
            elapsed_minutes = (now - last).total_seconds() / 60
            
            return elapsed_minutes >= interval_minutes
        except Exception as e:
            self.executor.log(f"Error parsing last_sync time: {e}", "WARN")
            return False
    
    def _parse_schedule_interval(self, schedule: str) -> Optional[int]:
        """
        Parse schedule string to interval in minutes.
        
        Supports cron-like and human-readable formats.
        """
        schedule_lower = schedule.lower().strip()
        
        # Human-readable formats
        if 'hourly' in schedule_lower:
            return 60
        if 'daily' in schedule_lower:
            return 1440
        if 'every 15 min' in schedule_lower:
            return 15
        if 'every 30 min' in schedule_lower:
            return 30
        if 'every 4 hour' in schedule_lower:
            return 240
        if 'every 6 hour' in schedule_lower:
            return 360
        if 'every 12 hour' in schedule_lower:
            return 720
        
        # Cron format: "minute hour day month weekday"
        # e.g., "0 * * * *" = hourly, "*/15 * * * *" = every 15 min
        cron_parts = schedule.split()
        if len(cron_parts) >= 2:
            minute_part = cron_parts[0]
            hour_part = cron_parts[1]
            
            # Every N minutes: "*/N * * * *"
            if minute_part.startswith('*/'):
                try:
                    return int(minute_part[2:])
                except ValueError:
                    pass
            
            # Every N hours: "0 */N * * *"
            if hour_part.startswith('*/') and minute_part == '0':
                try:
                    return int(hour_part[2:]) * 60
                except ValueError:
                    pass
            
            # Hourly: "0 * * * *" or "X * * * *"
            if hour_part == '*' and not minute_part.startswith('*/'):
                return 60
            
            # Daily: "0 0 * * *"
            if minute_part == '0' and hour_part == '0':
                return 1440
        
        # Default to hourly if we can't parse
        self.executor.log(f"Could not parse schedule '{schedule}', defaulting to hourly", "WARN")
        return 60
    
    def _calculate_next_sync(self, schedule: str) -> str:
        """Calculate when the next sync should occur"""
        interval_minutes = self._parse_schedule_interval(schedule) or 60
        next_sync = datetime.now(timezone.utc) + timedelta(minutes=interval_minutes)
        return next_sync.isoformat()
    
    def _calculate_current_rpo(self, last_sync: Optional[str]) -> int:
        """Calculate current RPO in seconds since last sync"""
        if not last_sync:
            return 999999  # Very large number for never-synced
        
        try:
            if last_sync.endswith('Z'):
                last_sync = last_sync[:-1] + '+00:00'
            last = datetime.fromisoformat(last_sync)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            
            now = datetime.now(timezone.utc)
            return int((now - last).total_seconds())
        except Exception:
            return 999999
    
    def _is_test_overdue(self, group: Dict) -> bool:
        """Check if failover test is overdue"""
        reminder_days = group.get('test_reminder_days')
        if not reminder_days:
            return False
        
        # Use last_test_at if available, otherwise use created_at
        reference_date = group.get('last_test_at') or group.get('created_at')
        if not reference_date:
            return True  # No reference date, consider overdue
        
        try:
            if reference_date.endswith('Z'):
                reference_date = reference_date[:-1] + '+00:00'
            ref = datetime.fromisoformat(reference_date)
            if ref.tzinfo is None:
                ref = ref.replace(tzinfo=timezone.utc)
            
            now = datetime.now(timezone.utc)
            days_since = (now - ref).days
            
            return days_since > reminder_days
        except Exception:
            return False
    
    def _has_pending_sync_job(self, group_id: str) -> bool:
        """Check if there's already a pending/running sync job for this group"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/jobs",
                params={
                    'job_type': 'eq.run_replication_sync',
                    'status': 'in.(pending,running)',
                    'select': 'id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                jobs = response.json() or []
                # Check if any job is for this group
                for job in jobs:
                    # The group_id is in details, but we'd need to fetch full job
                    # For now, just check if there are any pending sync jobs
                    pass
                return False  # TODO: Improve this check
        except Exception as e:
            self.executor.log(f"Error checking pending jobs: {e}", "WARN")
        return False
    
    def _create_sync_job(self, group_id: str, created_by: Optional[str] = None):
        """Create a new sync job for the protection group"""
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/jobs",
                json={
                    'job_type': 'run_replication_sync',
                    'status': 'pending',
                    'created_by': created_by,
                    'details': {
                        'protection_group_id': group_id,
                        'triggered_by': 'scheduled_replication_check',
                        'auto_scheduled': True
                    }
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error creating sync job: {e}", "ERROR")
            return False
    
    def _update_protection_group(self, group_id: str, **kwargs) -> bool:
        """Update protection group fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={'id': f'eq.{group_id}'},
                json={**kwargs, 'updated_at': utc_now_iso()},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error updating protection group: {e}", "ERROR")
            return False
    
    def _record_sla_violation(self, group_id: str, violation_type: str, 
                               details: Dict, severity: str = 'warning'):
        """Record an SLA violation in the database"""
        try:
            # Check if there's already an unresolved violation of this type
            check_response = requests.get(
                f"{DSM_URL}/rest/v1/sla_violations",
                params={
                    'protection_group_id': f'eq.{group_id}',
                    'violation_type': f'eq.{violation_type}',
                    'resolved_at': 'is.null',
                    'select': 'id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if check_response.ok and check_response.json():
                # Already have an unresolved violation, don't create duplicate
                return
            
            # Create new violation record
            response = requests.post(
                f"{DSM_URL}/rest/v1/sla_violations",
                json={
                    'protection_group_id': group_id,
                    'violation_type': violation_type,
                    'severity': severity,
                    'details': details,
                    'notification_sent': False
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.executor.log(f"Error recording SLA violation: {e}", "ERROR")
    
    def _resolve_sla_violations(self, group_id: str, violation_type: str):
        """Resolve any open violations of a specific type"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/sla_violations",
                params={
                    'protection_group_id': f'eq.{group_id}',
                    'violation_type': f'eq.{violation_type}',
                    'resolved_at': 'is.null'
                },
                json={'resolved_at': utc_now_iso()},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.executor.log(f"Error resolving SLA violations: {e}", "WARN")
    
    def _send_sla_alert(self, violations: List[Dict], alert_type: str):
        """Send SLA violation alert via notification system"""
        try:
            from job_executor.hmac_signing import add_signature_headers
            
            payload = {
                'notification_type': 'sla_violation_alert',
                'alert_type': alert_type,
                'violations': violations,
                'summary': f"{len(violations)} protection group(s) have {alert_type.replace('_', ' ')} issues"
            }
            
            # Base headers
            base_headers = {
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Add HMAC signature for edge function authentication
            headers = add_signature_headers(base_headers, payload)
            
            response = requests.post(
                f"{SUPABASE_URL}/functions/v1/send-notification",
                json=payload,
                headers=headers,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.ok:
                self.executor.log(f"[SLA] Alert sent for {len(violations)} violations")
                # Mark violations as notified
                for v in violations:
                    if 'group_id' in v:
                        self._mark_violation_notified(v['group_id'], alert_type)
            else:
                self.executor.log(f"[SLA] Failed to send alert: {response.status_code}", "WARN")
                
        except Exception as e:
            self.executor.log(f"Error sending SLA alert: {e}", "ERROR")
    
    def _mark_violation_notified(self, group_id: str, violation_type: str):
        """Mark violations as notification sent"""
        try:
            requests.patch(
                f"{DSM_URL}/rest/v1/sla_violations",
                params={
                    'protection_group_id': f'eq.{group_id}',
                    'violation_type': f'eq.{violation_type}',
                    'notification_sent': 'eq.false'
                },
                json={'notification_sent': True},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception:
            pass
