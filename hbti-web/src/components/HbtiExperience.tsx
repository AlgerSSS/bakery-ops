"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BrandHeader } from "@/components/BrandHeader";
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

const DRAFT_KEY_PREFIX = "hot-crush-hbti-draft-v1";
const DRAFT_VERSION = 1;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MEMBER_WALLET_URL =
  "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex";

type JourneyStage = "intro" | "quiz" | "result" | "details";
type ValidationState = "checking" | "valid" | "invalid" | "error";
type SubmissionState =
  | "idle"
  | "submitting"
  | "issued"
  | "processing"
  | "review"
  | "error";

interface HbtiDraft {
  version: 1;
  savedAt: number;
  answers: Partial<HbtiAnswers>;
  currentQuestion: number;
  stage: JourneyStage;
  color?: ColorChoice;
  gender?: GenderChoice;
  age?: AgeChoice;
}

interface CompletionResponse {
  status?: "issued" | "processing" | "review";
  code?: HbtiCode;
  color?: ColorChoice;
  memberWalletUrl?: string;
  reward?: {
    couponTemplateName?: string;
  };
}

interface HbtiExperienceProps {
  token: string;
}

export function HbtiExperience({ token }: HbtiExperienceProps) {
  const { locale, changeLocale } = useLocale();
  const copy = uiCopy[locale];
  const [validation, setValidation] =
    useState<ValidationState>("checking");
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
  const [rewardName, setRewardName] = useState(copy.rewardName);
  const [memberWalletUrl, setMemberWalletUrl] = useState<string>();
  const [confirmedCode, setConfirmedCode] = useState<HbtiCode>();
  const [confirmedColor, setConfirmedColor] = useState<ColorChoice>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const advanceTimerRef = useRef<number | null>(null);

  const validateInvitation = useCallback(async () => {
    setValidation("checking");

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        setValidation(
          response.status === 400 || response.status === 410
            ? "invalid"
            : "error",
        );
        return;
      }

      const payload: unknown = await response.json();
      setValidation(
        isValidSessionPayload(payload) ? "valid" : "invalid",
      );
    } catch {
      setValidation("error");
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void validateInvitation();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [validateInvitation]);

  useEffect(
    () => () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void createDraftKey(token)
      .then((nextDraftKey) => {
        if (cancelled) {
          return;
        }
        setDraftKey(nextDraftKey);
        const draft = readDraft(nextDraftKey);
        if (draft) {
          setAnswers(draft.answers);
          setCurrentQuestion(draft.currentQuestion);
          setStage(draft.stage);
          setColor(draft.color);
          setGender(draft.gender);
          setAge(draft.age);
        }
        setDraftLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setDraftLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

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
    if (validation === "checking") {
      return;
    }
    if (validation === "valid") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    const timer = window.setTimeout(
      () => headingRef.current?.focus({ preventScroll: true }),
      220,
    );

    return () => window.clearTimeout(timer);
  }, [currentQuestion, stage, submission, validation]);

  useEffect(() => {
    if (submission === "issued" && draftKey) {
      removeDraft(draftKey);
    }
  }, [draftKey, submission]);

  useEffect(() => {
    if (validation === "invalid" && draftKey) {
      removeDraft(draftKey);
    }
  }, [draftKey, validation]);

  const score = useMemo(
    () => (hasCompleteAnswers(answers) ? scoreHbti(answers) : null),
    [answers],
  );
  const result = score ? results[score.code][locale] : null;

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
    }, 420);
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

    setSubmission("submitting");
    try {
      const response = await fetch("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          answers,
          color,
          ...(gender ? { gender } : {}),
          ...(age ? { age } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 410) {
          setValidation("invalid");
        }
        setSubmission("error");
        return;
      }

      const payload = (await response.json()) as CompletionResponse;
      if (isHbtiCode(payload.code)) {
        setConfirmedCode(payload.code);
      }
      if (isColorChoice(payload.color)) {
        setConfirmedColor(payload.color);
      }
      if (payload.reward?.couponTemplateName) {
        setRewardName(payload.reward.couponTemplateName);
      }
      if (isSafeWalletUrl(payload.memberWalletUrl)) {
        setMemberWalletUrl(payload.memberWalletUrl);
      }

      if (
        payload.status === "issued" ||
        payload.status === "processing" ||
        payload.status === "review"
      ) {
        setSubmission(payload.status);
        return;
      }
      setSubmission("error");
    } catch {
      setSubmission("error");
    }
  }, [age, answers, color, gender, token]);

  useEffect(() => {
    if (submission !== "processing") {
      return;
    }
    const timer = window.setTimeout(() => {
      void submitCompletion();
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [submission, submitCompletion]);

  return (
    <main className={styles.siteShell}>
      <div className={styles.ambientWash} aria-hidden="true" />
      <div className={styles.pageFrame}>
        <BrandHeader locale={locale} onLocaleChange={changeLocale} />
        <div className={styles.journeyFrame}>
          {validation !== "valid" ? (
            <InvitationState
              state={validation}
              onRetry={validateInvitation}
              copy={copy}
              headingRef={headingRef}
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
              rewardName={rewardName}
              memberWalletUrl={memberWalletUrl}
              color={confirmedColor ?? color}
              onRetry={submitCompletion}
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
        <a className={styles.memberReturn} href={MEMBER_WALLET_URL}>
          {copy.returnToMembership}
        </a>
      </div>
    </main>
  );
}

interface CopyProp {
  copy: (typeof uiCopy)["en"];
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

function InvitationState({
  state,
  onRetry,
  copy,
  headingRef,
}: CopyProp & {
  state: ValidationState;
  onRetry: () => void;
}) {
  if (state === "checking") {
    return (
      <section className={styles.centerState} aria-live="polite">
        <div className={styles.brewLoader} aria-hidden="true">
          <i />
        </div>
        <p>{copy.validating}</p>
      </section>
    );
  }

  const isInvalid = state === "invalid";
  return (
    <section className={styles.centerState} role="alert" aria-live="assertive">
      <span className={styles.stateGlyph} aria-hidden="true">
        {isInvalid ? "↗" : "…"}
      </span>
      <h1 ref={headingRef} tabIndex={-1}>
        {isInvalid ? copy.invalidTitle : copy.networkError}
      </h1>
      <p>{isInvalid ? copy.invalidBody : copy.networkError}</p>
      {!isInvalid && (
        <button className={styles.primaryButton} type="button" onClick={onRetry}>
          {copy.retry}
        </button>
      )}
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
      <div className={styles.steamMark} aria-hidden="true">
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
      <Progress current={index + 1} total={questions.length} label={copy.questionProgress(index + 1, questions.length)} />
      <p className={styles.eyebrow}>{copy.chooseOne}</p>
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
                <span>{option.label[locale]}</span>
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
}: {
  current: number;
  total: number;
  label: string;
}) {
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
        <span style={{ width: `${(current / total) * 100}%` }} />
      </div>
      <p>{label}</p>
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
      <article className={styles.typeTicket}>
        <div className={styles.ticketNotchLeft} aria-hidden="true" />
        <div className={styles.ticketNotchRight} aria-hidden="true" />
        <header className={styles.ticketHeader}>
          <span>HBTI / {code}</span>
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

  async function prepareCard(): Promise<{
    blob: Blob;
    publicUrl: string;
  }> {
    if (!color || !resultCode || !result) {
      throw new Error("Result card is incomplete.");
    }
    const publicUrl = new URL("/", window.location.origin).toString();
    const blob = await createResultCardPng({
      code: resultCode,
      result,
      color,
      locale,
      signatureLabel: copy.signatureLabel,
      publicUrl,
    });
    return { blob, publicUrl };
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
  rewardName,
  memberWalletUrl,
  color,
  onRetry,
  copy,
  headingRef,
}: CopyProp & {
  state: Exclude<SubmissionState, "idle" | "error">;
  resultCode?: HbtiCode;
  resultName?: string;
  rewardName: string;
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
  return (
    <section className={styles.completionPanel} aria-live="polite">
      <div className={styles.giftStamp} data-issued={isIssued} aria-hidden="true">
        {isIssued ? "✓" : "…"}
      </div>
      <p className={styles.eyebrow}>
        {isIssued ? copy.successEyebrow : copy.resultEyebrow}
      </p>
      <h1 ref={headingRef} tabIndex={-1}>
        {isIssued
          ? copy.successTitle
          : isProcessing
            ? copy.processingTitle
            : copy.reviewTitle}
      </h1>
      <p className={styles.completionBody}>
        {isIssued
          ? copy.successBody
          : isProcessing
            ? copy.processingBody
            : copy.reviewBody}
      </p>
      <div className={styles.rewardCard} data-color={color ?? "neutral"}>
        <span>{copy.rewardLabel}</span>
        <strong>{rewardName || copy.rewardName}</strong>
        <p>{copy.rewardNote}</p>
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
  return <span className={styles.forwardIcon} aria-hidden="true" />;
}

function hasCompleteAnswers(
  answers: Partial<HbtiAnswers>,
): answers is HbtiAnswers {
  return questions.every((question) => {
    const value = answers[question.id];
    return question.options.some((option) => option.value === value);
  });
}

function isValidSessionPayload(
  payload: unknown,
): payload is { valid: true } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "valid" in payload &&
    payload.valid === true
  );
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

async function createDraftKey(token: string): Promise<string> {
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${DRAFT_KEY_PREFIX}:${fingerprint}`;
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
