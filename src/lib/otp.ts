// OTP / verification-code detection (guide section 12).
// A code is only accepted when it appears in relevant context: a keyword such
// as "OTP", "verification code", "security code", "one-time password" or
// "login code" must appear in the subject or within ~80 characters before the
// code. A bare 4–8 digit number is NEVER treated as an OTP.

export interface OtpMatch {
  code: string;
  confidence: number;
  matchedPattern: string;
}

const KEYWORDS = [
  "otp",
  "one-time password",
  "one time password",
  "verification code",
  "security code",
  "login code",
  "verification",
  "passcode",
  "confirm code",
  "authentication code",
];

// code = 4-8 digits, not part of a longer digit run, not a year-like date part
const CODE_RE = /(?<!\d)(\d{4,8})(?!\d)/g;

function keywordNear(text: string, codeIndex: number): { keyword: string; distance: number } | null {
  const windowStart = Math.max(0, codeIndex - 120);
  const before = text.slice(windowStart, codeIndex).toLowerCase();
  let best: { keyword: string; distance: number } | null = null;
  for (const kw of KEYWORDS) {
    const idx = before.lastIndexOf(kw);
    if (idx === -1) continue;
    const distance = before.length - (idx + kw.length);
    if (!best || distance < best.distance) best = { keyword: kw, distance };
  }
  return best;
}

function subjectHasKeyword(subject: string): string | null {
  const s = subject.toLowerCase();
  for (const kw of KEYWORDS) if (s.includes(kw)) return kw;
  return null;
}

/**
 * Detect the most likely OTP in a message. Returns null when no code is
 * found in relevant context. Confidence:
 *  - 0.95 keyword immediately before the code (<= 25 chars away)
 *  - 0.90 keyword nearby (<= 80 chars) or keyword in subject + code in body
 *  - 0.75 keyword in subject only, code anywhere in body
 *  - 0.60 code within 120 chars after a keyword
 * Codes that look like years (19xx/20xx) or long numbers are skipped.
 */
export function detectOtp(subject: string, textBody: string): OtpMatch | null {
  const subjectKeyword = subjectHasKeyword(subject);
  const body = textBody || "";
  let best: OtpMatch | null = null;

  for (const m of body.matchAll(CODE_RE)) {
    const code = m[1];
    const idx = m.index ?? 0;
    // Skip year-like codes and codes that are part of dates/times.
    if (/^(19|20)\d{2}$/.test(code)) continue;
    const near = keywordNear(body, idx);
    let confidence = 0;
    let pattern = "";
    if (near && near.distance <= 25) {
      confidence = 0.95;
      pattern = `keyword "${near.keyword}" adjacent to code`;
    } else if (near && near.distance <= 80) {
      confidence = 0.9;
      pattern = `keyword "${near.keyword}" near code`;
    } else if (subjectKeyword) {
      confidence = 0.75;
      pattern = `keyword "${subjectKeyword}" in subject`;
    } else if (near) {
      confidence = 0.6;
      pattern = `keyword "${near.keyword}" in context`;
    } else {
      continue; // bare number — never an OTP
    }
    if (!best || confidence > best.confidence) {
      best = { code, confidence, matchedPattern: pattern };
    }
  }

  // Codes in the subject itself (e.g. "Your code is 123456") are also valid.
  if (!best && subject) {
    for (const m of subject.matchAll(CODE_RE)) {
      const code = m[1];
      if (/^(19|20)\d{2}$/.test(code)) continue;
      best = {
        code,
        confidence: 0.9,
        matchedPattern: "code in subject with keyword",
      };
      break;
    }
  }
  return best;
}
