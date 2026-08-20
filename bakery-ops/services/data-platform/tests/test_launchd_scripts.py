from __future__ import annotations

import os
import plistlib
import subprocess
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
RUNNER = SERVICE_DIR / "run-brain-auto-ingest.sh"
INSTALLER = SERVICE_DIR / "install-brain-auto-ingest.sh"
APP_BUILDER = SERVICE_DIR / "build-brain-ingest-app.sh"
PLIST = SERVICE_DIR / "deploy" / "com.hotcrush.r6-brain-ingest.plist"


def _executable(path: Path, source: str) -> Path:
    path.write_text(source, encoding="utf-8")
    path.chmod(0o755)
    return path


def _runner_env(tmp_path: Path, *, probe_exit: int) -> tuple[dict[str, str], Path]:
    calls = tmp_path / "calls.log"
    brain = tmp_path / "brain"
    service = tmp_path / "service"
    brain.mkdir()
    service.mkdir()
    uv = _executable(
        tmp_path / "uv",
        """#!/bin/bash
printf 'uv:%s\\n' "$*" >> "$HOTCRUSH_TEST_CALLS"
if [[ "$*" == *"brainctl probe"* ]]; then
  exit "$HOTCRUSH_TEST_PROBE_EXIT"
fi
if [[ "$*" == *"brainctl auto"* ]]; then
  exit 0
fi
exit 64
""",
    )
    security = _executable(
        tmp_path / "security",
        """#!/bin/bash
echo security >> "$HOTCRUSH_TEST_CALLS"
echo fake-r6-secret
""",
    )
    env = os.environ.copy()
    env.update(
        {
            "HOTCRUSH_BRAIN_ROOT": str(brain),
            "HOTCRUSH_SERVICE_DIR": str(service),
            "HOTCRUSH_AUTO_STATE_FILE": str(tmp_path / "state.json"),
            "HOTCRUSH_UV": str(uv),
            "HOTCRUSH_SECURITY": str(security),
            "HOTCRUSH_TEST_CALLS": str(calls),
            "HOTCRUSH_TEST_PROBE_EXIT": str(probe_exit),
            "HOTCRUSH_ACCESS_TIMEOUT_SECONDS": "5",
        }
    )
    return env, calls


def test_runner_fails_before_keychain_or_upload_when_background_access_probe_fails(
    tmp_path: Path,
) -> None:
    env, calls = _runner_env(tmp_path, probe_exit=1)

    completed = subprocess.run(
        [str(RUNNER)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )

    assert completed.returncode == 77
    assert "background access probe failed" in completed.stderr
    assert "security" not in calls.read_text(encoding="utf-8")
    assert "brainctl auto" not in calls.read_text(encoding="utf-8")


def test_runner_probes_before_loading_keychain_and_running_auto(tmp_path: Path) -> None:
    env, calls = _runner_env(tmp_path, probe_exit=0)

    completed = subprocess.run(
        [str(RUNNER)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )

    assert completed.returncode == 0
    assert calls.read_text(encoding="utf-8").splitlines() == [
        f"uv:run --frozen brainctl probe {env['HOTCRUSH_BRAIN_ROOT']}",
        "security",
        (
            "uv:run --frozen brainctl auto "
            f"{env['HOTCRUSH_BRAIN_ROOT']} --state-file "
            f"{env['HOTCRUSH_AUTO_STATE_FILE']} --apply"
        ),
    ]


def _installer_env(tmp_path: Path, *, last_exit: int) -> tuple[dict[str, str], Path, Path]:
    calls = tmp_path / "launchctl.log"
    destination = tmp_path / "LaunchAgents" / PLIST.name
    trash = tmp_path / "Trash"
    log_dir = tmp_path / "Logs"
    log_dir.mkdir()
    (log_dir / "hotcrush-r6-brain-ingest.out.log").write_text(
        "previous stdout\n", encoding="utf-8"
    )
    (log_dir / "hotcrush-r6-brain-ingest.err.log").write_text(
        "previous stderr\n", encoding="utf-8"
    )
    runner = _executable(tmp_path / "runner", "#!/bin/bash\nexit 0\n")
    app_builder = _executable(
        tmp_path / "app-builder",
        """#!/bin/bash
echo built > "$HOTCRUSH_TEST_APP_BUILT"
mkdir -p "$1/Contents/MacOS"
touch "$1/Contents/MacOS/HotCrushR6BrainIngest"
chmod 755 "$1/Contents/MacOS/HotCrushR6BrainIngest"
""",
    )
    launchctl = _executable(
        tmp_path / "launchctl",
        """#!/bin/bash
printf '%s\\n' "$*" >> "$HOTCRUSH_TEST_CALLS"
if [[ "$1" == "print" ]]; then
  echo 'state = not running'
  if [[ "$HOTCRUSH_TEST_LAST_EXIT" == "0" ]]; then
    echo 'last exit code = 0'
  else
    printf 'last exit code = %s: EX_NOPERM\\n' "$HOTCRUSH_TEST_LAST_EXIT"
  fi
fi
exit 0
""",
    )
    security = _executable(tmp_path / "security", "#!/bin/bash\nexit 0\n")
    env = os.environ.copy()
    env.update(
        {
            "HOTCRUSH_LAUNCH_SOURCE": str(PLIST),
            "HOTCRUSH_RUNNER": str(runner),
            "HOTCRUSH_LAUNCH_DESTINATION": str(destination),
            "HOTCRUSH_TRASH_DIR": str(trash),
            "HOTCRUSH_LOG_DIR": str(log_dir),
            "HOTCRUSH_LAUNCHCTL": str(launchctl),
            "HOTCRUSH_SECURITY": str(security),
            "HOTCRUSH_APP_BUILDER": str(app_builder),
            "HOTCRUSH_APP_DESTINATION": str(tmp_path / "Applications" / "R6.app"),
            "HOTCRUSH_TEST_APP_BUILT": str(tmp_path / "app-built"),
            "HOTCRUSH_TEST_CALLS": str(calls),
            "HOTCRUSH_TEST_LAST_EXIT": str(last_exit),
            "HOTCRUSH_VERIFY_TIMEOUT_SECONDS": "2",
            "HOTCRUSH_VERIFY_POLL_SECONDS": "0.01",
        }
    )
    return env, destination, trash


def test_app_builder_creates_a_signed_dedicated_wrapper(tmp_path: Path) -> None:
    runner = _executable(
        tmp_path / "runner",
        "#!/bin/bash\necho wrapped-runner\nexit 23\n",
    )
    app = tmp_path / "HotCrush R6 Brain Ingest.app"

    built = subprocess.run(
        [str(APP_BUILDER), str(app), str(runner)],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )

    assert built.returncode == 0, built.stderr
    executable = app / "Contents" / "MacOS" / "HotCrushR6BrainIngest"
    embedded_runner = app / "Contents" / "Resources" / "run-brain-auto-ingest.sh"
    assert executable.stat().st_mode & 0o111
    assert embedded_runner.stat().st_mode & 0o111
    with (app / "Contents" / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    assert info["CFBundleIdentifier"] == "com.hotcrush.r6-brain-ingest"

    signature = subprocess.run(
        ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert signature.returncode == 0, signature.stderr
    wrapped = subprocess.run(
        [str(executable)],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert wrapped.returncode == 23
    assert wrapped.stdout.strip() == "wrapped-runner"


def test_launch_agent_targets_the_dedicated_app_not_a_shared_shell() -> None:
    with PLIST.open("rb") as handle:
        config = plistlib.load(handle)

    assert config["ProgramArguments"] == [
        "/Users/weiliangshao/Applications/HotCrush R6 Brain Ingest.app/Contents/MacOS/HotCrushR6BrainIngest"
    ]


def test_installer_rolls_back_agent_when_first_background_run_fails(tmp_path: Path) -> None:
    env, destination, trash = _installer_env(tmp_path, last_exit=77)

    completed = subprocess.run(
        [str(INSTALLER), "install"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert completed.returncode == 77
    assert "first background run failed" in completed.stderr
    assert not destination.exists()
    assert (trash / PLIST.name).exists()


def test_installer_keeps_agent_only_after_first_run_exits_zero(tmp_path: Path) -> None:
    env, destination, _trash = _installer_env(tmp_path, last_exit=0)

    completed = subprocess.run(
        [str(INSTALLER), "install"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert completed.returncode == 0
    assert "first background run exited 0" in completed.stdout
    assert destination.exists()
    assert Path(env["HOTCRUSH_TEST_APP_BUILT"]).read_text(encoding="utf-8").strip() == "built"
    log_dir = Path(env["HOTCRUSH_LOG_DIR"])
    assert (log_dir / "hotcrush-r6-brain-ingest.out.log").read_text(encoding="utf-8") == ""
    assert (log_dir / "hotcrush-r6-brain-ingest.err.log").read_text(encoding="utf-8") == ""
    assert len(list(log_dir.glob("hotcrush-r6-brain-ingest.out.log.*"))) == 1
    assert len(list(log_dir.glob("hotcrush-r6-brain-ingest.err.log.*"))) == 1
