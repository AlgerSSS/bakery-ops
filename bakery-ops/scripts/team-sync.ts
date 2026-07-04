import 'dotenv/config';
import { syncLarkOrg } from '../src/modules/domain/lark/lark-org-sync.service';
(async () => { const r = await syncLarkOrg(); console.log('Lark 组织架构同步完成:', r.synced, '人'); process.exit(0); })();
