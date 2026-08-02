"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BrandHeader } from "@/components/BrandHeader";
import { MemberSignIn } from "@/components/MemberSignIn";
import { questions } from "@/content/questions";
import { results } from "@/content/results";
import type {
  HbtiAnswerValue,
  HbtiAnswers,
  HbtiCode,
  HbtiQuestion,
} from "@/content/types";
import {
  ageChoices,
  colorChoices,
  genderChoices,
  isGiftTemplateName,
  type AgeChoice,
  type ColorChoice,
  type GenderChoice,
  uiCopy,
} from "@/content/ui";
import { scoreHbti } from "@/lib/hbti/scoring";
import {
  createResultCardPng,
  createResultShareText,
} from "@/lib/share/result-card";

import styles from "./hbti.module.css";
import { useLocale } from "./useLocale";

// v2：题目从 6 题扩到 13 题（每轴三票多数决）。v1 草稿只有 q1–q6，
// 恢复后 hasCompleteAnswers 必然为 false，若它停在 result/details 阶段
// 就会还原到一个算不出分数的页面。直接换键让旧草稿失效、从头答，
// 比带着半份答案走进坏分支干净。
const DRAFT_KEY_PREFIX = "hot-crush-hbti-draft-v2";
const DRAFT_VERSION = 2;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MEMBER_WALLET_URL =
  "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex";

type JourneyStage = "intro" | "quiz" | "result" | "details";
type AuthState = "checking" | "signedOut" | "signedIn" | "error";
type SubmissionState =
  | "idle"
  | "submitting"
  | "issued"
  // 答完了但周边已发完。是终态，不是错误——人格照常出，只是没有券。
  | "unrewarded"
  | "processing"
  | "review"
  | "demo"
  | "error";

interface HbtiDraft {
  version: 2;
  savedAt: number;
  answers: Partial<HbtiAnswers>;
  currentQuestion: number;
  stage: JourneyStage;
  color?: ColorChoice;
  gender?: GenderChoice;
  age?: AgeChoice;
}

interface CompletionResponse {
  status?: "issued" | "unrewarded" | "processing" | "review";
  code?: HbtiCode;
  color?: ColorChoice;
  memberWalletUrl?: string;
  reward?: {
    couponTemplateName?: string;
  };
}

interface AuthenticatedMember {
  maskedPhone: string;
  draftKey: string;
}

interface SessionResponse {
  authenticated?: boolean;
  maskedPhone?: string;
  draftKey?: string;
}

export function HbtiExperience({ demoMode = false }: { demoMode?: boolean }) {
  const { locale, changeLocale } = useLocale();
  const copy = uiCopy[locale];
  const [authState, setAuthState] = useState<AuthState>(
    demoMode ? "signedIn" : "checking",
  );
  const [member, setMember] = useState<AuthenticatedMember | undefined>(
    demoMode
      ? { maskedPhone: "", draftKey: "public-demo" }
      : undefined,
  );
  const [stage, setStage] = useState<JourneyStage>("intro");
  const [answers, setAnswers] = useState<Partial<HbtiAnswers>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [color, setColor] = useState<ColorChoice | undefined>();
  const [gender, setGender] = useState<GenderChoice | undefined>();
  const [age, setAge] = useState<AgeChoice | undefined>();
  const [draftKey, setDraftKey] = useState<string>();
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [submission, setSubmission] =
    useState<SubmissionState>("idle");
  // 存的是 RES 的原始券模板名，不是显示名。翻译推迟到渲染时做——
  // 存翻译结果的话，顾客在结果页切语言，卡片上的礼物名会冻在上一个语言。
  const [rewardTemplateName, setRewardTemplateName] = useState<string>();
  const [memberWalletUrl, setMemberWalletUrl] = useState<string>();
  const [confirmedCode, setConfirmedCode] = useState<HbtiCode>();
  const [confirmedColor, setConfirmedColor] = useState<ColorChoice>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const advanceTimerRef = useRef<number | null>(null);

  const checkSession = useCallback(async () => {
    setAuthState("checking");

    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) {
        setMember(undefined);
        setAuthState("signedOut");
        return;
      }
      if (!response.ok) {
        setAuthState("error");
        return;
      }
      const payload = (await response.json()) as SessionResponse;
      if (
        payload.authenticated === true &&
        typeof payload.maskedPhone === "string" &&
        typeof payload.draftKey === "string"
      ) {
        setMember({
          maskedPhone: payload.maskedPhone,
          draftKey: payload.draftKey,
        });
        setAuthState("signedIn");
        return;
      }
      setMember(undefined);
      setAuthState("signedOut");
    } catch {
      setAuthState("error");
    }
  }, []);

  useEffect(() => {
    if (demoMode) {
      return;
    }
    const timer = window.setTimeout(() => {
      void checkSession();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [checkSession, demoMode]);

  useEffect(
    () => () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (authState !== "signedIn" || !member) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nextDraftKey = createDraftStorageKey(member.draftKey);
      const draft = nextDraftKey ? readDraft(nextDraftKey) : null;
      setDraftKey(nextDraftKey);
      setAnswers(draft?.answers ?? {});
      setCurrentQuestion(draft?.currentQuestion ?? 0);
      setStage(draft?.stage ?? "intro");
      setColor(draft?.color);
      setGender(draft?.gender);
      setAge(draft?.age);
      setSubmission("idle");
      setConfirmedCode(undefined);
      setConfirmedColor(undefined);
      setMemberWalletUrl(undefined);
      setDraftLoaded(Boolean(nextDraftKey));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authState, member]);

  useEffect(() => {
    if (!draftLoaded || !draftKey || submission === "issued") {
      return;
    }

    const draft: HbtiDraft = {
      version: DRAFT_VERSION,
      savedAt: Date.now(),
      answers,
      currentQuestion,
      stage,
      ...(color ? { color } : {}),
      ...(gender ? { gender } : {}),
      ...(age ? { age } : {}),
    };
    writeDraft(draftKey, draft);
  }, [
    age,
    answers,
    color,
    currentQuestion,
    draftKey,
    draftLoaded,
    gender,
    stage,
    submission,
  ]);

  useEffect(() => {
    if (authState === "checking") {
      return;
    }
    if (authState === "signedIn") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    const timer = window.setTimeout(
      () => headingRef.current?.focus({ preventScroll: true }),
      220,
    );

    return () => window.clearTimeout(timer);
  }, [authState, currentQuestion, stage, submission]);

  useEffect(() => {
    if (submission === "issued" && draftKey) {
      removeDraft(draftKey);
    }
  }, [draftKey, submission]);

  const score = useMemo(
    () => (hasCompleteAnswers(answers) ? scoreHbti(answers) : null),
    [answers],
  );
  const result = score ? results[score.code][locale] : null;

  const acceptCompletion = useCallback((payload: CompletionResponse) => {
    if (isHbtiCode(payload.code)) {
      setConfirmedCode(payload.code);
    }
    if (isColorChoice(payload.color)) {
      setConfirmedColor(payload.color);
    }
    if (payload.reward?.couponTemplateName) {
      setRewardTemplateName(payload.reward.couponTemplateName);
    }
    if (isSafeWalletUrl(payload.memberWalletUrl)) {
      setMemberWalletUrl(payload.memberWalletUrl);
    }
    if (
      payload.status === "issued" ||
      payload.status === "unrewarded" ||
      payload.status === "processing" ||
      payload.status === "review"
    ) {
      setSubmission(payload.status);
      return true;
    }
    return false;
  }, []);

  function chooseAnswer(
    question: HbtiQuestion,
    value: HbtiAnswerValue,
  ) {
    setAnswers(
      (previous) =>
        ({ ...previous, [question.id]: value }) as Partial<HbtiAnswers>,
    );
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
    }
    const questionIndex = questions.findIndex(
      ({ id }) => id === question.id,
    );
    advanceTimerRef.current = window.setTimeout(() => {
      if (questionIndex === questions.length - 1) {
        setStage("result");
      } else {
        setCurrentQuestion(questionIndex + 1);
      }
      advanceTimerRef.current = null;
    }, 220);
  }

  function goNext() {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (!answers[questions[currentQuestion].id]) {
      return;
    }
    if (currentQuestion === questions.length - 1) {
      setStage("result");
      return;
    }
    setCurrentQuestion((index) => index + 1);
  }

  function goBack() {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (stage === "details") {
      setStage("result");
      return;
    }
    if (stage === "result") {
      setCurrentQuestion(questions.length - 1);
      setStage("quiz");
      return;
    }
    if (stage === "quiz" && currentQuestion > 0) {
      setCurrentQuestion((index) => index - 1);
      return;
    }
    setStage("intro");
  }

  const submitCompletion = useCallback(async () => {
    if (!color || !hasCompleteAnswers(answers)) {
      return;
    }

    if (demoMode) {
      const demoScore = scoreHbti(answers);
      setConfirmedCode(demoScore.code);
      setConfirmedColor(color);
      setSubmission("demo");
      return;
    }

    setSubmission("submitting");
    try {
      const response = await fetch("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          color,
          ...(gender ? { gender } : {}),
          ...(age ? { age } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setMember(undefined);
          setAuthState("signedOut");
        }
        setSubmission("error");
        return;
      }

      const payload = (await response.json()) as CompletionResponse;
      if (acceptCompletion(payload)) {
        return;
      }
      setSubmission("error");
    } catch {
      setSubmission("error");
    }
  }, [acceptCompletion, age, answers, color, demoMode, gender]);

  const pollCompletionStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/complete/status", {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) {
        setMember(undefined);
        setAuthState("signedOut");
        setSubmission("error");
        return;
      }
      if (!response.ok) {
        return;
      }
      acceptCompletion((await response.json()) as CompletionResponse);
    } catch {
      // Keep the safe processing state; the next read-only poll can retry.
    }
  }, [acceptCompletion]);

  const changeAccount = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return;
    }

    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setMember(undefined);
    setAuthState("signedOut");
    setStage("intro");
    setAnswers({});
    setCurrentQuestion(0);
    setColor(undefined);
    setGender(undefined);
    setAge(undefined);
    setDraftKey(undefined);
    setDraftLoaded(false);
    setSubmission("idle");
    setRewardTemplateName(undefined);
    setMemberWalletUrl(undefined);
    setConfirmedCode(undefined);
    setConfirmedColor(undefined);
  }, []);

  useEffect(() => {
    if (submission !== "processing") {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    const pollAgain = async () => {
      await pollCompletionStatus();
      if (!cancelled) {
        timer = window.setTimeout(() => {
          void pollAgain();
        }, 2_500);
      }
    };

    timer = window.setTimeout(() => {
      void pollAgain();
    }, 2_500);

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [pollCompletionStatus, submission]);

  return (
    <main className={styles.siteShell}>
      <div className={styles.ambientWash} aria-hidden="true" />
      <div className={styles.pageFrame}>
        <BrandHeader locale={locale} onLocaleChange={changeLocale} />
        {demoMode ? (
          <div className={styles.demoChip} role="status">
            <span aria-hidden="true">✦</span>
            <div>
              <strong>{copy.demoModeTitle}</strong>
              <p>{copy.demoModeBody}</p>
            </div>
          </div>
        ) : authState === "signedIn" && member ? (
          <div className={styles.memberChip}>
            <span aria-hidden="true">✓</span>
            <div role="status">
              <strong>{copy.memberLinked}</strong>
              <p>{copy.memberLinkedBody(member.maskedPhone)}</p>
            </div>
            <button type="button" onClick={() => void changeAccount()}>
              {copy.changePhone}
            </button>
          </div>
        ) : null}
        <div className={styles.journeyFrame}>
          {authState === "checking" || authState === "error" ? (
            <AccountCheckState
              state={authState}
              onRetry={checkSession}
              copy={copy}
              headingRef={headingRef}
            />
          ) : authState === "signedOut" ? (
            <MemberSignIn
              copy={copy}
              headingRef={headingRef}
              onAuthenticated={(authenticatedMember) => {
                setMember(authenticatedMember);
                setAuthState("signedIn");
              }}
            />
          ) : submission !== "idle" && submission !== "error" ? (
            <CompletionState
              state={submission}
              resultCode={confirmedCode ?? score?.code}
              resultName={
                confirmedCode
                  ? results[confirmedCode][locale].name
                  : result?.name
              }
              rewardTemplateName={rewardTemplateName}
              memberWalletUrl={memberWalletUrl}
              color={confirmedColor ?? color}
              onRetry={pollCompletionStatus}
              copy={copy}
              headingRef={headingRef}
            />
          ) : stage === "intro" ? (
            <Intro
              hasDraft={Object.keys(answers).length > 0}
              onBegin={() => {
                setCurrentQuestion(0);
                setStage("quiz");
              }}
              copy={copy}
              headingRef={headingRef}
            />
          ) : stage === "quiz" ? (
            <QuestionStep
              key={questions[currentQuestion].id}
              question={questions[currentQuestion]}
              index={currentQuestion}
              selected={answers[questions[currentQuestion].id]}
              onChoose={chooseAnswer}
              onBack={goBack}
              onNext={goNext}
              copy={copy}
              locale={locale}
              headingRef={headingRef}
            />
          ) : stage === "result" && score && result ? (
            <ResultStep
              code={score.code}
              result={result}
              onBack={goBack}
              onContinue={() => setStage("details")}
              onRetake={() => {
                setCurrentQuestion(0);
                setStage("quiz");
              }}
              copy={copy}
              headingRef={headingRef}
            />
          ) : (
            <DetailsStep
              color={color}
              gender={gender}
              age={age}
              resultCode={score?.code}
              result={result}
              submission={submission}
              onColor={setColor}
              onGender={setGender}
              onAge={setAge}
              onBack={goBack}
              onSubmit={submitCompletion}
              copy={copy}
              locale={locale}
              headingRef={headingRef}
            />
          )}
        </div>
        {/* 钱包出口只在开场页与结果页出现。
            原先它对所有非登出态渲染,于是答题页底部同时有「下一题」「返回」
            「返回会员账户」三个动作抢注意力,还第二次重复了圆圈箭头图案;
            它那 44px+ 的页脚也是 320x740 上第 13 题溢出的一部分成因。
            已发券的完成态本身带有自己的钱包 CTA,不需要这个。 */}
        {!demoMode &&
          authState !== "signedOut" &&
          (stage === "intro" || stage === "result") && (
            <a className={styles.memberReturn} href={MEMBER_WALLET_URL}>
              {copy.returnToMembership}
            </a>
          )}
      </div>
    </main>
  );
}

interface CopyProp {
  copy: (typeof uiCopy)["en"];
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

function AccountCheckState({
  state,
  onRetry,
  copy,
  headingRef,
}: CopyProp & {
  state: Extract<AuthState, "checking" | "error">;
  onRetry: () => void;
}) {
  if (state === "checking") {
    return (
      <section className={styles.centerState} aria-live="polite">
        <div className={styles.brewLoader} aria-hidden="true">
          <i />
        </div>
        <p>{copy.checkingAccount}</p>
      </section>
    );
  }

  return (
    <section className={styles.centerState} role="alert" aria-live="assertive">
      <span className={styles.stateGlyph} aria-hidden="true">
        …
      </span>
      <h1 ref={headingRef} tabIndex={-1}>
        {copy.authErrorTitle}
      </h1>
      <p>{copy.authNetworkError}</p>
      <button className={styles.primaryButton} type="button" onClick={onRetry}>
        {copy.retry}
      </button>
    </section>
  );
}

function Intro({
  hasDraft,
  onBegin,
  copy,
  headingRef,
}: CopyProp & { hasDraft: boolean; onBegin: () => void }) {
  return (
    <section className={styles.introPanel}>
      <div
        className={styles.steamMark}
        data-brand-mark="arrow"
        aria-hidden="true"
      >
        <i />
        <i />
        <i />
      </div>
      <p className={styles.eyebrow}>{copy.introEyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1} className={styles.introTitle}>
        {copy.introTitle}
      </h1>
      <p className={styles.introBody}>{copy.introBody}</p>
      <div className={styles.introMeta}>
        <span>{copy.introTime}</span>
        <span>{copy.introReward}</span>
      </div>
      <button className={styles.primaryButton} type="button" onClick={onBegin}>
        {hasDraft ? copy.resume : copy.begin}
        <ForwardIcon />
      </button>
      {hasDraft && <p className={styles.savedNote}>{copy.saved}</p>}
    </section>
  );
}

function QuestionStep({
  question,
  index,
  selected,
  onChoose,
  onBack,
  onNext,
  copy,
  locale,
  headingRef,
}: CopyProp & {
  question: HbtiQuestion;
  index: number;
  selected?: HbtiAnswerValue;
  onChoose: (question: HbtiQuestion, value: HbtiAnswerValue) => void;
  onBack: () => void;
  onNext: () => void;
  locale: keyof typeof uiCopy;
}) {
  return (
    <section className={styles.questionPanel}>
      <Progress
        current={index + 1}
        total={questions.length}
        label={copy.questionProgress(index + 1, questions.length)}
        flavor={copy.questionProgressFlavor(index + 1, questions.length)}
      />
      <p className={styles.eyebrow}>{copy.chooseOne[question.id]}</p>
      <h1
        id={`question-${question.id}`}
        ref={headingRef}
        tabIndex={-1}
        className={styles.questionTitle}
      >
        {question.prompt[locale]}
      </h1>
      <fieldset
        className={styles.questionFieldset}
        aria-labelledby={`question-${question.id}`}
      >
        <legend className={styles.srOnly}>{question.prompt[locale]}</legend>
        <div
          className={styles.answerGrid}
          data-count={question.options.length}
        >
          {question.options.map((option) => {
            const isSelected = option.value === selected;
            return (
              <button
                type="button"
                className={styles.answerCard}
                data-selected={isSelected}
                aria-pressed={isSelected}
                key={option.value}
                onClick={() => onChoose(question, option.value)}
              >
                <span className={styles.answerEmoji} aria-hidden="true">
                  {option.emoji}
                </span>
                <span className={styles.answerLabel}>
                  {option.label[locale]}
                </span>
                <span className={styles.answerCheck} aria-hidden="true">
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <nav
        className={styles.stepActions}
        aria-label={copy.questionNavigationLabel}
      >
        <button className={styles.backButton} type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> {copy.back}
        </button>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={!selected}
          onClick={onNext}
        >
          {copy.next} <ForwardIcon />
        </button>
      </nav>
    </section>
  );
}

function Progress({
  current,
  total,
  label,
  flavor,
}: {
  current: number;
  total: number;
  /** 字面表述,给屏幕阅读器 */
  label: string;
  /** 烘焙口径,只给眼睛看 */
  flavor: string;
}) {
  // 连续进度条：13 题时分段小药丸会换行成三排，很难看。
  // 用一条填充式进度条，宽度按 current/total 走；role/aria-* 原样保留。
  const percent = Math.round((current / total) * 100);
  return (
    <div className={styles.progressWrap}>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={label}
      >
        <span
          className={styles.progressFill}
          style={{ width: `${percent}%` }}
          aria-hidden="true"
        />
      </div>
      {/* 可见的烘焙口径计数是装饰:进度已由上面的 progressbar 用字面文案播报,
          这里再念一遍「第 9 炉」只会让人听着猜自己答到第几题。 */}
      <p aria-hidden="true">{flavor}</p>
    </div>
  );
}

function ResultStep({
  code,
  result,
  onBack,
  onContinue,
  onRetake,
  copy,
  headingRef,
}: CopyProp & {
  code: HbtiCode;
  result: (typeof results)[HbtiCode]["en"];
  onBack: () => void;
  onContinue: () => void;
  onRetake: () => void;
}) {
  return (
    <section className={styles.resultPanel}>
      <button className={styles.topBack} type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> {copy.back}
      </button>
      <p className={styles.eyebrow}>{copy.resultEyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1} className={styles.resultLead}>
        {copy.resultTitle}
      </h1>
      <article
        className={styles.typeTicket}
        data-surface="result-lightbox"
      >
        <div className={styles.ticketNotchLeft} aria-hidden="true" />
        <div className={styles.ticketNotchRight} aria-hidden="true" />
        {/* 票头左侧从「HBTI / HSDA」改成「配方编号 HSDA」:同一串字母,
            读成配方号而不是测评代码。零额外高度。
            没有做「火候」「出炉时间」—— 结果数据里只有 code / name / traits /
            description / signatureOrder,那两项没有对应事实,编出来就是造假。 */}
        <header className={styles.ticketHeader}>
          <span>
            {copy.recipeNoLabel} {code}
          </span>
          <span>HOT CRUSH</span>
        </header>
        <div
          className={styles.typeCode}
          aria-label={copy.hbtiTypeLabel(code)}
        >
          {code.split("").map((letter, index) => (
            <span key={`${letter}-${index}`}>{letter}</span>
          ))}
        </div>
        <h2>{result.name}</h2>
        {/* 「配料」小标题:同样四个特征,加了标签就从标签堆读成配方单。
            试过放同一行首位以省高度,反而更差 —— 英文/马来文的标签会挤掉
            横向空间,标签行从 1 行变 2 行,整页 867/889 比独立一行的 853 还高。 */}
        <p className={styles.traitsLabel}>{copy.traitsLabel}</p>
        <div className={styles.traitLine}>
          {result.traits.map((trait) => (
            <span key={trait}>{trait}</span>
          ))}
        </div>
        <p className={styles.resultDescription}>{result.description}</p>
        <div className={styles.signatureOrder}>
          <span>{copy.signatureLabel}</span>
          <strong>{result.signatureOrder}</strong>
        </div>
      </article>
      <button
        className={styles.primaryButton}
        type="button"
        onClick={onContinue}
      >
        {copy.discoverGift} <ForwardIcon />
      </button>
      <button className={styles.textButton} type="button" onClick={onRetake}>
        {copy.retake}
      </button>
    </section>
  );
}

function DetailsStep({
  color,
  gender,
  age,
  resultCode,
  result,
  submission,
  onColor,
  onGender,
  onAge,
  onBack,
  onSubmit,
  copy,
  locale,
  headingRef,
}: CopyProp & {
  color?: ColorChoice;
  gender?: GenderChoice;
  age?: AgeChoice;
  resultCode?: HbtiCode;
  result: (typeof results)[HbtiCode]["en"] | null;
  submission: SubmissionState;
  onColor: (color: ColorChoice) => void;
  onGender: (gender: GenderChoice | undefined) => void;
  onAge: (age: AgeChoice | undefined) => void;
  onBack: () => void;
  onSubmit: () => void;
  locale: keyof typeof uiCopy;
}) {
  const isSubmitting = submission === "submitting";
  const [cardAction, setCardAction] = useState<
    "idle" | "saving" | "sharing" | "saved" | "shared" | "copied" | "error"
  >("idle");
  const preparedCardRef = useRef<{
    key: string;
    blob: Blob;
    publicUrl: string;
  } | null>(null);

  async function prepareCard(): Promise<{
    blob: Blob;
    publicUrl: string;
  }> {
    if (!color || !resultCode || !result) {
      throw new Error("Result card is incomplete.");
    }
    const publicUrl = new URL("/", window.location.origin).toString();
    const key = `${resultCode}:${color}:${locale}:${publicUrl}`;
    if (preparedCardRef.current?.key === key) {
      return preparedCardRef.current;
    }
    const blob = await createResultCardPng({
      code: resultCode,
      result,
      color,
      locale,
      signatureLabel: copy.signatureLabel,
      publicUrl,
    });
    preparedCardRef.current = { key, blob, publicUrl };
    return preparedCardRef.current;
  }

  async function saveCard() {
    setCardAction("saving");
    try {
      const { blob } = await prepareCard();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `hot-crush-${resultCode?.toLowerCase() ?? "hbti"}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      setCardAction("saved");
    } catch {
      setCardAction("error");
    }
  }

  async function shareCard() {
    setCardAction("sharing");
    try {
      const { blob, publicUrl } = await prepareCard();
      if (!resultCode || !result) {
        throw new Error("Result card is incomplete.");
      }
      const title = `HBTI ${resultCode} · ${result.name}`;
      const text = createResultShareText({
        code: resultCode,
        result,
        signatureLabel: copy.signatureLabel,
      });
      const file = new File(
        [blob],
        `hot-crush-${resultCode.toLowerCase()}.png`,
        { type: "image/png" },
      );

      if (typeof navigator.share === "function") {
        const shareData: ShareData = { title, text, url: publicUrl };
        if (
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] })
        ) {
          shareData.files = [file];
        }
        await navigator.share(shareData);
        setCardAction("shared");
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          `${title}\n${text}\n${publicUrl}`,
        );
        setCardAction("copied");
        return;
      }
      throw new Error("Sharing is unavailable.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setCardAction("idle");
        return;
      }
      setCardAction("error");
    }
  }

  return (
    <section className={styles.detailsPanel}>
      <button className={styles.topBack} type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> {copy.back}
      </button>
      <p className={styles.eyebrow}>{copy.detailsEyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1} className={styles.detailsTitle}>
        {copy.detailsTitle}
      </h1>
      <p className={styles.detailsBody}>{copy.detailsBody}</p>

      {resultCode && result && (
        <article
          className={styles.resultColorPreview}
          data-color={color ?? "neutral"}
          data-testid="result-colour-preview"
        >
          <header>
            <span>HBTI / {resultCode}</span>
            <span>HOT CRUSH</span>
          </header>
          <div>
            <strong>{resultCode}</strong>
            <span>{result.name}</span>
          </div>
          <p>{result.signatureOrder}</p>
        </article>
      )}

      <fieldset className={styles.detailFieldset}>
        <legend>{copy.colorLabel}</legend>
        <div className={styles.colorGrid}>
          {colorChoices.map((choice) => (
            <button
              type="button"
              className={styles.colorChoice}
              data-color={choice}
              data-selected={color === choice}
              aria-pressed={color === choice}
              key={choice}
              onClick={() => onColor(choice)}
            >
              <span aria-hidden="true" />
              {copy.colors[choice]}
            </button>
          ))}
        </div>
        {!color && <p className={styles.fieldHint}>{copy.colorHint}</p>}
      </fieldset>

      {color && resultCode && result && (
        <div className={styles.cardActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={cardAction === "saving"}
            onClick={() => void saveCard()}
          >
            {copy.saveCard}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={cardAction === "sharing"}
            onClick={() => void shareCard()}
          >
            {copy.shareCard}
          </button>
        </div>
      )}
      {cardAction !== "idle" &&
        cardAction !== "saving" &&
        cardAction !== "sharing" && (
          <p
            className={
              cardAction === "error"
                ? styles.inlineError
                : styles.cardActionStatus
            }
            role={cardAction === "error" ? "alert" : "status"}
          >
            {cardAction === "saved"
              ? copy.cardSaved
              : cardAction === "shared"
                ? copy.cardShared
                : cardAction === "copied"
                  ? copy.shareCopied
                  : copy.cardActionError}
          </p>
        )}

      <div className={styles.optionalFields}>
        <label>
          <span>
            {copy.genderLabel} <small>{copy.optional}</small>
          </span>
          <select
            value={gender ?? ""}
            onChange={(event) =>
              onGender(
                event.target.value
                  ? (event.target.value as GenderChoice)
                  : undefined,
              )
            }
          >
            <option value="">—</option>
            {genderChoices.map((choice) => (
              <option value={choice} key={choice}>
                {copy.genders[choice]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            {copy.ageLabel} <small>{copy.optional}</small>
          </span>
          <select
            value={age ?? ""}
            onChange={(event) =>
              onAge(
                event.target.value
                  ? (event.target.value as AgeChoice)
                  : undefined,
              )
            }
          >
            <option value="">—</option>
            {ageChoices.map((choice) => (
              <option value={choice} key={choice}>
                {copy.ages[choice]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.privacyNote}>
        <p>{copy.privacySummary}</p>
        {age === "under-18" && <p>{copy.minorPrivacyNote}</p>}
      </div>

      {submission === "error" && (
        <p className={styles.inlineError} role="alert">
          {copy.networkError}
        </p>
      )}
      <button
        className={styles.primaryButton}
        type="button"
        disabled={!color || isSubmitting}
        onClick={onSubmit}
      >
        {isSubmitting ? copy.sendingGift : copy.sendGift}
        {!isSubmitting && <ForwardIcon />}
      </button>
    </section>
  );
}

function CompletionState({
  state,
  resultCode,
  resultName,
  rewardTemplateName,
  memberWalletUrl,
  color,
  onRetry,
  copy,
  headingRef,
}: CopyProp & {
  state: Exclude<SubmissionState, "idle" | "error">;
  resultCode?: HbtiCode;
  resultName?: string;
  /** RES 的原始券模板名；显示名在这里现算，见下方 giftDisplayName。 */
  rewardTemplateName?: string;
  memberWalletUrl?: string;
  color?: ColorChoice;
  onRetry: () => void;
}) {
  if (state === "submitting") {
    return (
      <section className={styles.centerState} aria-live="polite">
        <div className={styles.brewLoader} aria-hidden="true">
          <i />
        </div>
        <p>{copy.sendingGift}</p>
      </section>
    );
  }

  const isIssued = state === "issued";
  const isProcessing = state === "processing";
  const isDemo = state === "demo";
  const isSoldOut = state === "unrewarded";
  // 券模板名是后台的内部字符串（"HBTI Gift · Rose Fridge Magnet"），不能直接给顾客看。
  // 认不出来时退回兜底文案，而不是把原字符串漏出去——万一后台改名，顾客看到的是
  // 一句得体的话，不是一行内部标识。
  const giftDisplayName =
    rewardTemplateName && isGiftTemplateName(rewardTemplateName)
      ? copy.giftNames[rewardTemplateName]
      : copy.rewardName;
  return (
    <section className={styles.completionPanel} aria-live="polite">
      <div
        className={styles.giftStamp}
        data-issued={isIssued || isDemo}
        aria-hidden="true"
      >
        {isIssued || isDemo ? "✓" : "…"}
      </div>
      <p className={styles.eyebrow}>
        {isDemo
          ? copy.demoCompleteEyebrow
          : isIssued
            ? copy.successEyebrow
            : isSoldOut
              ? copy.giftSoldOutEyebrow
              : copy.resultEyebrow}
      </p>
      <h1 ref={headingRef} tabIndex={-1}>
        {isDemo
          ? copy.demoCompleteTitle
          : isIssued
            ? copy.successTitle
            : isSoldOut
              ? copy.giftSoldOutTitle
              : isProcessing
                ? copy.processingTitle
                : copy.reviewTitle}
      </h1>
      <p className={styles.completionBody}>
        {isDemo
          ? copy.demoCompleteBody
          : isIssued
            ? copy.successBody
            : isSoldOut
              ? copy.giftSoldOutBody
              : isProcessing
                ? copy.processingBody
                : copy.reviewBody}
      </p>
      <div
        className={styles.rewardCard}
        data-surface="reward-receipt"
        data-color={color ?? "neutral"}
      >
        <span>
          {isDemo
            ? copy.demoRewardLabel
            : isSoldOut
              ? copy.giftSoldOutLabel
              : copy.rewardLabel}
        </span>
        <strong>{isSoldOut ? copy.giftSoldOutName : giftDisplayName}</strong>
        <p>
          {isDemo
            ? copy.demoRewardNote
            : isSoldOut
              ? copy.giftSoldOutNote
              : copy.rewardNote}
        </p>
      </div>
      {resultCode && resultName && (
        <div
          className={styles.resultReceipt}
          data-color={color ?? "neutral"}
        >
          <span>{resultCode}</span>
          <strong>{resultName}</strong>
        </div>
      )}
      {isIssued && memberWalletUrl && (
        <a className={styles.primaryButton} href={memberWalletUrl}>
          {copy.openWallet} <ForwardIcon />
        </a>
      )}
      {isProcessing && (
        <button className={styles.backButton} type="button" onClick={onRetry}>
          {copy.retry}
        </button>
      )}
    </section>
  );
}

function ForwardIcon() {
  return (
    <span
      className={styles.forwardIcon}
      data-brand-arrow="true"
      aria-hidden="true"
    />
  );
}

function hasCompleteAnswers(
  answers: Partial<HbtiAnswers>,
): answers is HbtiAnswers {
  return questions.every((question) => {
    const value = answers[question.id];
    return question.options.some((option) => option.value === value);
  });
}

function isSafeWalletUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "f4klzbmr9n2d.m.sea.restosuite.ai"
    );
  } catch {
    return false;
  }
}

function isHbtiCode(value: unknown): value is HbtiCode {
  return typeof value === "string" && value in results;
}

function isColorChoice(value: unknown): value is ColorChoice {
  return (
    typeof value === "string" &&
    colorChoices.some((choice) => choice === value)
  );
}

function createDraftStorageKey(draftKey: string): string | undefined {
  return /^[A-Za-z0-9_-]{16,128}$/.test(draftKey)
    ? `${DRAFT_KEY_PREFIX}:${draftKey}`
    : undefined;
}

function readDraft(storageKey: string): HbtiDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isDraft(parsed)) {
      removeDraft(storageKey);
      return null;
    }
    return parsed;
  } catch {
    removeDraft(storageKey);
    return null;
  }
}

function writeDraft(storageKey: string, draft: HbtiDraft): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // The quiz remains usable when storage is disabled or full.
  }
}

function removeDraft(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Storage availability must never block the customer journey.
  }
}

function isDraft(value: unknown): value is HbtiDraft {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== DRAFT_VERSION ||
    !("savedAt" in value) ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt > Date.now() ||
    Date.now() - value.savedAt > DRAFT_TTL_MS ||
    !("answers" in value) ||
    typeof value.answers !== "object" ||
    value.answers === null ||
    !("currentQuestion" in value) ||
    typeof value.currentQuestion !== "number" ||
    !Number.isInteger(value.currentQuestion) ||
    value.currentQuestion < 0 ||
    value.currentQuestion >= questions.length ||
    !("stage" in value) ||
    !["intro", "quiz", "result", "details"].includes(String(value.stage))
  ) {
    return false;
  }

  const answerRecord = value.answers as Record<string, unknown>;
  const answersAreValid = questions.every((question) => {
    const answer = answerRecord[question.id];
    return (
      answer === undefined ||
      question.options.some((option) => option.value === answer)
    );
  });
  if (!answersAreValid) {
    return false;
  }

  const candidate = value as Partial<HbtiDraft>;
  return (
    (candidate.color === undefined ||
      colorChoices.includes(candidate.color)) &&
    (candidate.gender === undefined ||
      genderChoices.includes(candidate.gender)) &&
    (candidate.age === undefined || ageChoices.includes(candidate.age))
  );
}
