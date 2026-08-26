"use client";

import { useEffect, useState } from "react";

import styles from "./staff.module.css";

interface Reservation {
  reservationId: number;
  giftType: "free_basque" | "points_450";
  pickupDate: string;
  slot: "noon" | "night";
  status: "processing" | "reserved" | "ambiguous";
  pointsStatus: string;
  maskedPhone: string | null;
  recipientNote: string | null;
  memberNote: string | null;
}

export function StaffConsole() {
  const [staffId, setStaffId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [phones, setPhones] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/staff/session", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { staffId: string };
      setStaffId(body.staffId);
      setAuthenticated(true);
      await refreshQueue();
    });
  }, []);

  async function refreshQueue() {
    const response = await fetch("/api/staff/birthday", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { reservations: Reservation[] };
    setReservations(body.reservations);
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await postJson("/api/staff/login", { staffId, accessCode });
    setBusy(false);
    if (!response.ok) {
      setMessage("姓名或门店口令不正确，请重试。");
      return;
    }
    setAccessCode("");
    setAuthenticated(true);
    await refreshQueue();
  }

  async function registerFriendTopup(event: React.FormEvent) {
    event.preventDefault();
    let normalized: string[];
    try {
      normalized = phones.split(/\n|,/).map(normalizePhone).filter(Boolean);
    } catch {
      setMessage("手机号格式不对，请每行填写一个完整手机号。");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await postJson("/api/staff/friend-topup", { phones: normalized });
    const body = await response.json() as {
      error?: string;
      participants?: unknown[];
      rewardStatus?: "issued" | "pending";
    };
    setBusy(false);
    if (!response.ok) {
      setMessage(friendError(body.error));
      return;
    }
    setPhones("");
    setMessage(
      body.rewardStatus === "issued"
        ? `已确认 ${body.participants?.length ?? normalized.length} 位同行会员，每人的 RM10 券都已到账。`
        : `已确认 ${body.participants?.length ?? normalized.length} 位同行会员，RM10 券正在发放，请勿重复登记。`,
    );
  }

  async function actOnBirthday(reservationId: number, action: "fulfill" | "cancel") {
    const reason = action === "cancel"
      ? window.prompt("请输入取消原因（积分蛋糕会自动退回 450 分）")
      : null;
    if (action === "cancel" && (!reason || reason.trim().length < 3)) return;
    setBusy(true);
    setMessage("");
    const response = await postJson("/api/staff/birthday", action === "fulfill"
      ? { action, reservationId, staffNote: null }
      : { action, reservationId, reason: reason?.trim() });
    const body = await response.json() as { error?: string; pointsRefunded?: number; reconciliation?: boolean };
    setBusy(false);
    if (!response.ok) {
      setMessage(body.reconciliation
        ? "积分结果需要人工核对，请勿重复操作，并联系负责人查看 RES 记录。"
        : "操作没有完成，请刷新后再试。");
      await refreshQueue();
      return;
    }
    setMessage(action === "fulfill"
      ? "已标记取货完成。"
      : body.pointsRefunded ? "已取消，并退回 450 积分。" : "已取消预约。");
    await refreshQueue();
  }

  if (!authenticated) {
    return (
      <main className={styles.page}>
        <form className={styles.login} onSubmit={login}>
          <p className={styles.eyebrow}>HOT CRUSH · STAFF</p>
          <h1>门店会员权益台</h1>
          <p>请用自己的名字登录。所有履约动作会留下操作人记录。</p>
          <label>伙伴姓名<input value={staffId} onChange={(e) => setStaffId(e.target.value)} required /></label>
          <label>门店口令<input type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required /></label>
          <button disabled={busy}>{busy ? "正在进入…" : "进入权益台"}</button>
          {message && <p className={styles.message}>{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>HOT CRUSH · STAFF</p><h1>会员权益台</h1></div>
        <span>当前伙伴：{staffId}</span>
      </header>
      {message && <p className={styles.notice}>{message}</p>}
      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>好友同行储值</h2>
          <p>两人或以上完成同店储值后，每行填一个会员手机号。系统只认最近 2 小时内、相隔不超过 30 分钟且每人本金 RM100+ 的真实储值。</p>
          <form onSubmit={registerFriendTopup}>
            <label>会员手机号（2–6 人）
              <textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={6} placeholder={"+60 12 345 6789\n+60 17 234 5678"} required />
            </label>
            <button disabled={busy}>确认同行并发放每人 RM10 券</button>
          </form>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><h2>生日礼履约</h2><button className={styles.secondary} onClick={() => void refreshQueue()}>刷新</button></div>
          {reservations.length === 0 ? <p className={styles.empty}>未来 30 天暂无待处理预约。</p> : (
            <div className={styles.list}>{reservations.map((reservation) => (
              <article key={reservation.reservationId} className={styles.item}>
                <div><strong>{reservation.giftType === "points_450" ? "450 积分蛋糕" : "免费巴斯克"}</strong><span>{reservation.pickupDate} · {reservation.slot === "noon" ? "下午" : "晚上"}</span><span>{reservation.maskedPhone ?? "手机号待核对"} · {reservation.status === "ambiguous" ? "待人工核对" : "待取货"}</span></div>
                <div className={styles.actions}>
                  <button disabled={busy || reservation.status !== "reserved"} onClick={() => void actOnBirthday(reservation.reservationId, "fulfill")}>已取货</button>
                  <button className={styles.danger} disabled={busy || reservation.status !== "reserved"} onClick={() => void actOnBirthday(reservation.reservationId, "cancel")}>取消</button>
                </div>
              </article>
            ))}</div>
          )}
        </section>
      </div>
    </main>
  );
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (!compact) return "";
  const e164 = compact.startsWith("+")
    ? compact
    : compact.startsWith("60")
      ? `+${compact}`
      : compact.startsWith("0")
        ? `+60${compact.slice(1)}`
        : "";
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw new Error("invalid phone");
  return e164;
}

function friendError(error?: string): string {
  if (error === "TOPUP_NOT_UNIQUE") return "找不到唯一的近期储值：请确认两人都刚完成储值，且每人只有一笔。";
  if (error === "TOPUP_TIME_MISMATCH" || error === "STORE_MISMATCH") return "这些储值不属于同一批同行交易，请核对门店和时间。";
  if (error === "TOPUP_ALREADY_REWARDED") return "其中一笔储值已经参加过同行礼，不能重复发券。";
  return "登记没有完成，请核对手机号与储值金额后再试。";
}
