/**
 * CompletionDetector — extracts DONE-signal detection from WorkflowEngine
 *
 * Uses multiple pattern matching strategies for robust completion detection.
 * Separated from workflow logic for testability and single-responsibility.
 */

/**
 * Check if the manager's output signals task completion.
 *
 * Detection strategies:
 * 1. Explicit DONE markers (case-insensitive)
 * 2. Decision/status markers with completion intent
 * 3. Quality-based completion (positive signals, no negative signals)
 *
 * @param output The manager's response text
 * @returns true if the output indicates the task is complete
 */
export function isCompletionSignal(output: string): boolean {
  const normalized = output.toUpperCase().replace(/\s+/g, " ");

  // Strategy 1: Explicit DONE markers
  if (hasExplicitDoneMarker(output, normalized)) return true;

  // Strategy 2: Decision markers with completion intent
  if (hasDecisionMarker(output)) return true;

  // Strategy 3: Quality-based completion
  if (qualityIndicatesCompletion(normalized)) return true;

  return false;
}

// ── Strategy 1: Explicit DONE patterns ──

const DONE_PATTERNS = [
  /\*\*DONE\*\*/,                          // **DONE**
  /## DONE\b/,                             // ## DONE
  /#{1,6}\s+DONE\b/,                       // # DONE, ## DONE, etc.
  /\[DONE\]/,                              // [DONE]
  /\(DONE\)/,                              // (DONE)
  /\bDONE\b[:;]/,                          // DONE: or DONE;
  /^DONE\b/m,                              // DONE at start of line
  /TASK\s+COMPLETE/i,
  /TASK\s+IS\s+COMPLETE/i,
  /IMPLEMENTATION\s+COMPLETE/i,
  /FINAL\s+SUMMARY/i,
  /COMPLETED\s+SUCCESSFULLY/i,
  /SUCCESSFULLY\s+COMPLETED/i,
];

function hasExplicitDoneMarker(output: string, normalized: string): boolean {
  for (const pattern of DONE_PATTERNS) {
    if (pattern.test(output) || pattern.test(normalized)) {
      return true;
    }
  }
  return false;
}

// ── Strategy 2: Decision markers ──

const DECISION_PATTERNS = [
  /DECISION[:;\s]+DONE\b/i,
  /STATUS[:;\s]+DONE\b/i,
  /VERDICT[:;\s]+COMPLETE/i,
  /CONCLUSION[:;\s]+COMPLETE/i,
];

function hasDecisionMarker(output: string): boolean {
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(output)) return true;
  }
  return false;
}

// ── Strategy 3: Quality-based completion ──

function qualityIndicatesCompletion(normalized: string): boolean {
  // Positive signals
  const hasPositiveRating = /QUALITY\s+RATINGS?\s*[:=]?\s*(?:PASS|APPROVED|ACCEPTED)/i.test(normalized);
  const hasApprovedStatus = /\b(?:APPROVED|ACCEPTED)\b/i.test(normalized);
  const noIssues = /\bNO\s+(?:MAJOR\s+)?ISSUES?\b/i.test(normalized);
  const hasCompletionPhrase = /(?:IMPLEMENTATION\s+IS\s+COMPLETE|ALL\s+TASKS?\s+COMPLETE|WORK\s+IS\s+DONE)/i.test(normalized);

  // Negative signals that override completion
  const hasIssues = /(?:NEEDS\s+WORK|MAJOR\s+ISSUES?|BLOCKING\s+ISSUES?|CRITICAL\s+ISSUES?|REJECTED)/i.test(normalized);
  const requiresMoreCycles = /(?:MORE\s+WORK\s+NEEDED|ADDITIONAL\s+CYCLES?|CONTINUE\s+NEXT\s+CYCLE|FURTHER\s+WORK\s+REQUIRED)/i.test(normalized);

  return (hasPositiveRating || hasApprovedStatus || hasCompletionPhrase || noIssues) && !hasIssues && !requiresMoreCycles;
}
