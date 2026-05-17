import "dotenv/config";
import { checkAndNotify } from "../modules/domain/recruitment/notifications/notification.service";
import { loadNotificationState } from "../modules/domain/recruitment/notifications/notification-state";

async function main() {
  console.log("=== 测试通知检查 ===\n");

  const stateBefore = loadNotificationState();
  console.log("当前 state:", JSON.stringify(stateBefore, null, 2));
  console.log();

  console.log("开始检查...\n");
  await checkAndNotify();

  const stateAfter = loadNotificationState();
  console.log("\n更新后 state:", JSON.stringify(stateAfter, null, 2));
}

main().catch(console.error);
