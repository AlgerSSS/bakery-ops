import fs from "node:fs";

function unwrapToken(raw) {
  let value = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") value = parsed;
    if (parsed && typeof parsed === "object") {
      value = parsed.token ?? parsed.value ?? parsed.accessToken ?? raw;
    }
  } catch {
    // Playwright storageState normally stores the token as a plain string.
  }
  return typeof value === "string" ? value.trim() : "";
}

export function readVulcanTokenFromStorageState(file) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("RES storage state is missing or unreadable.");
  }

  const origin = Array.isArray(state?.origins)
    ? state.origins.find((entry) => entry?.origin === "https://bo.sea.restosuite.ai")
    : null;
  const tokenEntry = Array.isArray(origin?.localStorage)
    ? origin.localStorage.find(
        (entry) =>
          String(entry?.name ?? "").toLowerCase().replaceAll("-", "") ===
          "vulcantoken",
      )
    : null;
  const token = unwrapToken(tokenEntry?.value ?? "");
  if (token.length < 32) {
    throw new Error("RES storage state does not contain a usable vulcan token.");
  }
  return token;
}
