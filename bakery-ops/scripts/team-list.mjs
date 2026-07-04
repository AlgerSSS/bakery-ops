// npm run team:list — 查看 team_member 表（Lark组织架构 + 权限/推送配置）。
import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const rows = await sql`SELECT name, lark_department, role, subscriptions, active FROM team_member ORDER BY active DESC, role, name`;
console.log(`\nteam_member ${rows.length} 人（✓在职 / ✗离职）：\n`);
for (const r of rows) console.log(`  ${r.active ? '✓' : '✗'} ${String(r.name).padEnd(15)} | ${String(r.role).padEnd(9)} | subs=[${(r.subscriptions || []).join(',')}] | ${r.lark_department || '(无部门)'}`);
console.log(`\n改权限:  UPDATE team_member SET role='ops' WHERE name='XXX';`);
console.log(`改推送:  UPDATE team_member SET subscriptions=ARRAY['daily_review'] WHERE name='XXX';   -- 取消推送用 '{}'`);
console.log(`同步组织架构: npm run team:sync（daemon 每日 03:00 + 启动时也会自动同步）\n`);
await sql.end();
