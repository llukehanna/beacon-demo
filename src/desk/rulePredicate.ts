/**
 * Hard-screen predicate rendering.
 *
 * `axis operator threshold`, with numeric thresholds bare and everything
 * else quoted — "employees < 10", 'coverage_model == "Generalist Focus"'.
 * Shared by /rules (the card headline and the version history) and Home's
 * pending-rules card, so the predicate an analyst reads on the home page
 * is character-identical to the one they approve.
 *
 * Returns null when any component is missing: the caller renders a
 * "malformed proposal" placeholder rather than `? ? "?"`.
 */
export function summarizePredicate(
  axis: string | undefined,
  operator: string | undefined,
  threshold: string | undefined,
): string | null {
  const a = (axis ?? "").trim();
  const o = (operator ?? "").trim();
  const t = (threshold ?? "").trim();
  if (a === "" || o === "" || t === "") {
    return null;
  }
  const rhs = /^-?\d+(\.\d+)?$/.test(t) ? t : `"${t}"`;
  return `${a} ${o} ${rhs}`;
}
