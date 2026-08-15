// 追问意图的校验层。挡的是 LLM 吐出来的脏字段直接进 SQL：
//   · hour:"下午" → item_hourly_sales.hour 是 integer 列，实测抛
//     `invalid input syntax for type integer`，整个追问挂掉（店长只看到「AI 分析暂时不可用」）
//   · hour:"14"   → SQL 能过，但 `${h}:00-${h+1}:00` 变成字符串拼接 → 标题 "14:00-141:00"
//   · compare_date 脏值 → daily_revenue.date 是 varchar，不抛、只静默返回 0 行，
//     会被当成「那天没数据」，比报错更难查
import { describe, it, expect } from "vitest";
import { parseIntent } from "../../modules/domain/forecast/ops-data-query";

const j = (o: unknown) => JSON.stringify(o);

describe("parseIntent — type", () => {
  it("认识的 type 原样保留", () => {
    for (const t of ["hourly_detail", "item_detail", "compare_days", "item_by_hour", "general"]) {
      expect(parseIntent(j({ type: t })).type).toBe(t);
    }
  });
  it("不认识的 type 降级为 general", () => {
    expect(parseIntent(j({ type: "drop_table" })).type).toBe("general");
    expect(parseIntent(j({ type: 42 })).type).toBe("general");
    expect(parseIntent(j({})).type).toBe("general");
  });
  it("JSON 坏掉 / 非对象 → general 而不是抛", () => {
    expect(parseIntent("not json").type).toBe("general");
    expect(parseIntent("").type).toBe("general");
    expect(parseIntent(j(null)).type).toBe("general");
    expect(parseIntent(j([1, 2])).type).toBe("general");
  });
  it("剥掉 ```json 围栏", () => {
    expect(parseIntent('```json\n{"type":"item_detail","item_name":"蛋挞"}\n```').item_name).toBe("蛋挞");
  });
});

describe("parseIntent — hour（撞 integer 列的那个）", () => {
  it("非数字时段一律丢弃，不让它进 SQL", () => {
    expect(parseIntent(j({ hour: "下午" })).hour).toBeUndefined();
    expect(parseIntent(j({ hour: "晚上八点" })).hour).toBeUndefined();
    expect(parseIntent(j({ hour: null })).hour).toBeUndefined();
    expect(parseIntent(j({ hour: "" })).hour).toBeUndefined();
  });
  it("数字字符串收敛成 number（否则 h+1 会变字符串拼接）", () => {
    const got = parseIntent(j({ hour: "14" })).hour;
    expect(got).toBe(14);
    expect(typeof got).toBe("number");
  });
  it("hour=0 必须保留 —— 午夜是合法时段，不能被真值判断吞掉", () => {
    expect(parseIntent(j({ hour: 0 })).hour).toBe(0);
  });
  it("越界与小数丢弃", () => {
    expect(parseIntent(j({ hour: 25 })).hour).toBeUndefined();
    expect(parseIntent(j({ hour: -1 })).hour).toBeUndefined();
    expect(parseIntent(j({ hour: 12.5 })).hour).toBeUndefined();
  });
});

describe("parseIntent — compare_date / item_name", () => {
  it("只接受 YYYY-MM-DD", () => {
    expect(parseIntent(j({ compare_date: "2026-08-05" })).compare_date).toBe("2026-08-05");
    expect(parseIntent(j({ compare_date: "上周三" })).compare_date).toBeUndefined();
    expect(parseIntent(j({ compare_date: "2026/08/05" })).compare_date).toBeUndefined();
    expect(parseIntent(j({ compare_date: 20260805 })).compare_date).toBeUndefined();
  });
  it("item_name 去空白，空串按缺失处理", () => {
    expect(parseIntent(j({ item_name: "  蛋挞  " })).item_name).toBe("蛋挞");
    expect(parseIntent(j({ item_name: "   " })).item_name).toBeUndefined();
    expect(parseIntent(j({ item_name: 123 })).item_name).toBeUndefined();
  });
});
