import type { User, UserRole } from "../shared/types";
import { PermissionDeniedError, UserNotRegisteredError } from "../shared/errors/skill-error";
import { userRepository } from "../data/repositories/user.repository";
import { logger } from "../shared/logger";

// 角色 → 权限映射
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  owner: ["*"], // 全部权限
  admin: ["*"],
  hr_manager: [
    "recruitment.use",
    "recruitment.view_contact",
    "employee.manage",
  ],
  store_manager: [
    "recruitment.use",
    "employee.manage",
    "forecast.generate",
    "forecast.apply_ai_correction",
    "forecast.export",
    "kitchen_plan.generate",
    "kitchen_plan.send",
    "supplychain.order",
    "supplychain.send",
  ],
  kitchen_manager: [
    "forecast.generate",
    "forecast.export",
    "kitchen_plan.generate",
    "kitchen_plan.send",
    "supplychain.order",
  ],
  staff: [
    "forecast.export",
    "supplychain.order",
  ],
  marketing_manager: [
    "marketing.use",
    "marketing.negotiate",
    "recruitment.use",
    "employee.manage",
  ],
  kol: [
    "marketing.use",
  ],
};

export class PermissionService {
  // 内存缓存（从 DB 加载）
  private users: Map<string, User> = new Map();
  private lidToPhone: Map<string, string> = new Map();
  private loaded = false;

  /** 从 Supabase 加载所有用户到内存缓存 */
  async loadUsers(): Promise<void> {
    const users = await userRepository.getAll();
    this.users.clear();
    this.lidToPhone.clear();
    for (const user of users) {
      if (!user.phone) continue;
      this.users.set(user.phone, user);
      if (user.lid) {
        this.lidToPhone.set(user.lid, user.phone);
      }
    }
    this.loaded = true;
    logger.info(`Loaded ${this.users.size} users from database`);
  }

  /** 兼容旧接口：手动注册用户（fallback） */
  registerUser(user: User): void {
    this.users.set(user.phone, user);
    if (user.lid) {
      this.lidToPhone.set(user.lid, user.phone);
    }
    logger.info("User registered (in-memory)", { userId: user.userId, phone: user.phone });
  }

  getUserByPhone(phone: string): User | undefined {
    return this.users.get(phone) || this.users.get(this.lidToPhone.get(phone) || "");
  }

  identifyUser(phone: string): User {
    const user = this.getUserByPhone(phone);
    if (!user) {
      throw new UserNotRegisteredError(phone);
    }
    return user;
  }

  check(user: User, requiredPermission: string): void {
    const rolePerms = ROLE_PERMISSIONS[user.role] || [];
    if (rolePerms.includes("*")) return;
    if (user.permissions.includes(requiredPermission)) return;
    if (rolePerms.includes(requiredPermission)) return;
    throw new PermissionDeniedError(user.userId, requiredPermission);
  }

  hasPermission(user: User, requiredPermission: string): boolean {
    const rolePerms = ROLE_PERMISSIONS[user.role] || [];
    if (rolePerms.includes("*")) return true;
    if (user.permissions.includes(requiredPermission)) return true;
    if (rolePerms.includes(requiredPermission)) return true;
    return false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

export const permissionService = new PermissionService();
