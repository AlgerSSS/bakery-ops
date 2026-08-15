import {
  DEFAULT_REPLAY_AUTHORITY,
  IMPLEMENTATION_STATUS,
  PHYSICAL_BACKFILL_STATUS,
  REPORT211_CONTRACT,
} from "./contract.mjs";

const status = {
  blockers: ["LIVE_READ_ONLY_REPLAY_NOT_APPROVED", "TARGET_DATABASE_WRITE_PATH_DOES_NOT_EXIST"],
  implementation_status: IMPLEMENTATION_STATUS,
  line_identity_status: DEFAULT_REPLAY_AUTHORITY.stable_line_identity.status,
  physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
  report_id: REPORT211_CONTRACT.report_id,
};

if (process.argv.length > 2) {
  process.stderr.write(`${JSON.stringify({ ...status, error: "cli_is_status_only" })}\n`);
  process.exitCode = 2;
} else {
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

