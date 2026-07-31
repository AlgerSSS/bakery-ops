/**
 * The one country table. Both the sign-in <select> and the server-side phone
 * validator read it, so the browser can never offer a country the API rejects.
 *
 * Scope: RES itself enumerates no countries — its register/login contract takes
 * any 2-3 letter ISO code with any 1-4 digit dial code — so this list is a
 * product decision, not a technical limit. It is drawn from the markets the shop
 * actually serves: every dial code with two or more real members in RES today
 * (see res_api/output/member-probe/phone_shape.json), plus the neighbouring SEA
 * markets a Kuala Lumpur bakery covers even where RES holds no member yet.
 * The long tail of one-member codes (EG, FI, FR, AE, …) is tourist noise and is
 * deliberately left out; adding a row here is all it takes to bring one back.
 *
 * `pattern` matches the national significant number — after the dial code and
 * any trunk prefix are removed. Keep these permissive enough that a real
 * customer is never turned away: RES performs the authoritative check at
 * registration, so this is a typo guard, not an authority.
 */
export interface SupportedCountry {
  isoCode: string;
  /** Dial code, digits only, no leading "+". */
  countryCode: string;
  /** Sample national number shown in the input. */
  placeholder: string;
  /** National significant number, i.e. trunk prefix already stripped. */
  pattern: RegExp;
  /** Whether numbers are written locally with a leading 0 to be dropped. */
  trunkPrefix: boolean;
}

// Malaysia stays first: it is the home market and the default selection.
export const supportedCountries: readonly SupportedCountry[] = [
  {
    isoCode: "MY",
    countryCode: "60",
    placeholder: "12 345 6789",
    pattern: /^1\d{8,9}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "SG",
    countryCode: "65",
    placeholder: "8123 4567",
    pattern: /^[689]\d{7}$/,
    trunkPrefix: false,
  },
  {
    isoCode: "ID",
    countryCode: "62",
    placeholder: "812 3456 789",
    pattern: /^8\d{7,11}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "CN",
    countryCode: "86",
    placeholder: "186 1234 5678",
    pattern: /^1[3-9]\d{9}$/,
    trunkPrefix: false,
  },
  {
    isoCode: "HK",
    countryCode: "852",
    placeholder: "9123 4567",
    pattern: /^[4-9]\d{7}$/,
    trunkPrefix: false,
  },
  {
    isoCode: "TW",
    countryCode: "886",
    placeholder: "912 345 678",
    pattern: /^9\d{8}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "TH",
    countryCode: "66",
    placeholder: "81 234 5678",
    pattern: /^[689]\d{7,8}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "VN",
    countryCode: "84",
    placeholder: "912 345 678",
    pattern: /^[35789]\d{8}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "PH",
    countryCode: "63",
    placeholder: "917 123 4567",
    pattern: /^9\d{9}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "BN",
    countryCode: "673",
    placeholder: "712 3456",
    pattern: /^[78]\d{6}$/,
    trunkPrefix: false,
  },
  {
    isoCode: "AU",
    countryCode: "61",
    placeholder: "412 345 678",
    pattern: /^4\d{8}$/,
    trunkPrefix: true,
  },
  {
    isoCode: "US",
    countryCode: "1",
    placeholder: "202 555 0123",
    pattern: /^[2-9]\d{9}$/,
    trunkPrefix: false,
  },
] as const;

export function findSupportedCountry(
  isoCode: unknown,
): SupportedCountry | undefined {
  if (typeof isoCode !== "string") {
    return undefined;
  }
  return supportedCountries.find(
    (country) => country.isoCode === isoCode,
  );
}

/**
 * The dial code and the ISO code must belong to the same row. Validating them
 * independently would silently accept pairs like {countryCode:"60", isoCode:"CN"}
 * and route an OTP to the wrong network.
 */
export function isSupportedCountryPair(
  isoCode: unknown,
  countryCode: unknown,
): boolean {
  const country = findSupportedCountry(isoCode);
  return country !== undefined && country.countryCode === countryCode;
}

/**
 * Turn whatever the customer typed into a national significant number.
 *
 * Stripping a leading copy of the dial code is a guess, not a fact: a Thai
 * mobile legitimately starts with 6 and an Indonesian one can start with 8, so
 * slicing the dial code off unconditionally can eat real digits and send the
 * OTP to a different number. Build every plausible reading instead and keep the
 * first one the country actually accepts; fall back to the most-normalised
 * reading so the caller still shows a sensible validation error.
 */
export function normalizeNationalNumber(
  value: string,
  country: SupportedCountry,
): string {
  const digits = value.replace(/\D/g, "");
  const candidates: string[] = [];
  const consider = (candidate: string) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  for (const base of [
    digits,
    digits.startsWith(country.countryCode)
      ? digits.slice(country.countryCode.length)
      : undefined,
  ]) {
    if (base === undefined) {
      continue;
    }
    consider(base);
    if (country.trunkPrefix && base.startsWith("0")) {
      consider(base.slice(1));
    }
  }

  return (
    candidates.find((candidate) => country.pattern.test(candidate)) ??
    candidates.at(-1) ??
    digits
  );
}
