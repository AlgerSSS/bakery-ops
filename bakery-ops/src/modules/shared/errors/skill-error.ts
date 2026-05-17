export class SkillError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly skillId?: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "SkillError";
  }
}

export class PermissionDeniedError extends SkillError {
  constructor(userId: string, permission: string) {
    super(
      `用户 ${userId} 没有权限: ${permission}`,
      "PERMISSION_DENIED",
      undefined,
      403,
    );
    this.name = "PermissionDeniedError";
  }
}

export class SkillNotFoundError extends SkillError {
  constructor(text: string) {
    super(
      `无法识别你的意图: "${text}"`,
      "SKILL_NOT_FOUND",
      undefined,
      404,
    );
    this.name = "SkillNotFoundError";
  }
}

export class MissingInputError extends SkillError {
  constructor(skillId: string, inputName: string, promptQuestion: string) {
    super(promptQuestion, "MISSING_INPUT", skillId, 400);
    this.name = "MissingInputError";
  }
}

export class UserNotRegisteredError extends SkillError {
  constructor(phone: string) {
    super(
      "你好，你的号码尚未注册。请联系管理员开通权限。",
      "USER_NOT_REGISTERED",
      undefined,
      401,
    );
    this.name = "UserNotRegisteredError";
  }
}
