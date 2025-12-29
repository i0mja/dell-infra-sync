import unittest
import time

from job_executor.mixins.vcenter_ops import VCenterMixin


class DummyVCenter(VCenterMixin):
    """Lightweight subclass to expose mixin helpers for testing."""

    def log(self, *args, **kwargs):  # pragma: no cover - noop logger for tests
        pass


class VCenterMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.mixin = DummyVCenter()

    def test_migration_activity_counts_as_progress(self):
        """VM count unchanged but migration task activity should reset stall timer."""
        progress_state = {
            "last_vm_count": 1,
            "last_tasks": {},
            "last_progress_time": 0,
            "waiting_for_operator": False,
            "waiting_started_at": None,
        }

        updated = self.mixin._update_evacuation_progress_state(
            progress_state=progress_state,
            current_vm_count=1,
            active_tasks={"task-1": {"state": "running", "progress": 10}},
            host_in_maintenance=False,
            stall_timeout=300,
            operator_wait_timeout=900,
            now=1000,
        )

        self.assertEqual(updated["last_progress_reason"], "task_activity")
        self.assertEqual(updated["last_progress_time"], 1000)
        self.assertFalse(updated["waiting_for_operator"])

    def test_host_in_maintenance_short_circuits_stall(self):
        """If host flips to maintenance, we treat it as progress even after long stall."""
        progress_state = {
            "last_vm_count": 1,
            "last_tasks": {},
            "last_progress_time": time.time() - 1200,
            "waiting_for_operator": True,
            "waiting_started_at": time.time() - 900,
        }

        updated = self.mixin._update_evacuation_progress_state(
            progress_state=progress_state,
            current_vm_count=1,
            active_tasks={},
            host_in_maintenance=True,
            stall_timeout=300,
            operator_wait_timeout=900,
            now=time.time(),
        )

        self.assertEqual(updated["last_progress_reason"], "maintenance_mode")
        self.assertFalse(updated["waiting_for_operator"])
        self.assertGreater(updated["last_progress_time"], progress_state["last_progress_time"])

    def test_stalled_payload_contains_remaining_vms(self):
        """Stalled status payload keeps remaining VM list and empty migrations for UI."""
        progress_state = {
            "last_vm_count": 3,
            "last_tasks": {},
            "last_progress_time": time.time() - 1200,
            "waiting_for_operator": True,
            "waiting_started_at": time.time() - 900,
            "stall_duration_seconds": 900,
        }

        payload = self.mixin._build_maintenance_status_payload(
            host_name="esx01",
            vms_before=3,
            remaining_vms=[{"name": "vm-a", "power_state": "poweredOn"}],
            active_migrations=[],
            progress_state=progress_state,
            status="timeout",
            stall_duration=900,
            human_status="stalled",
        )

        self.assertEqual(payload["vms_evacuated"], 2)
        self.assertEqual(payload["vms_remaining"], [{"name": "vm-a", "power_state": "poweredOn"}])
        self.assertEqual(payload["active_migrations"], [])
        self.assertEqual(payload["stall_duration_seconds"], 900)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
