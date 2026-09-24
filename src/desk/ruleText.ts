// The backend clips rationaleClusterSummary at a fixed character length,
// often leaving a mid-word tail followed by its own clip marker like
// "Advisory functio..." or "Common pattern: geographic footpri". We do
// two passes:
//   1. Strip any trailing "..." or "…" clip marker — the backend added
//      it AFTER cutting mid-word, so it's not a real terminator and
//      leaving it in place would leak the raw clip.
//   2. If what's left doesn't end in a real terminator, rewind to the
//      last word boundary and re-append "…".
// Strings that end in real punctuation (. ! ? " ' ) ]) are left alone.
//
// Lives outside Rules.tsx so the component file only exports components
// (react-refresh/only-export-components gates CI at zero warnings).
export const TERMINATORS = /[.!?"')\]]$/;
const CLIP_MARKER = /(?:\.\.\.|…)+$/;
export function repairTruncatedText(text: string | null | undefined): string {
  if (text === null || text === undefined) {
    return "";
  }
  let trimmed = text.trim();
  if (trimmed === "") {
    return trimmed;
  }
  // Strip the backend's clip marker before deciding whether to rewind —
  // otherwise the outer conditional treats "Advisory functio…" as a
  // proper ellipsis and leaves the mid-word cut intact.
  const wasClipped = CLIP_MARKER.test(trimmed);
  if (wasClipped) {
    trimmed = trimmed.replace(CLIP_MARKER, "").trimEnd();
    if (trimmed === "") {
      return "…";
    }
  }
  // Only trust a terminator when the backend didn't clip — a period at
  // the end of "…mid-word." is coincidence, not a real sentence ending.
  if (!wasClipped && TERMINATORS.test(trimmed)) {
    return trimmed;
  }
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace <= 0) {
    // Single unterminated token — best we can do is add an ellipsis.
    return trimmed + "…";
  }
  return trimmed.slice(0, lastSpace).trimEnd() + "…";
}
