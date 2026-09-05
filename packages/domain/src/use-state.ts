import { DomainError } from "./errors.js";
export const USE_STATES = [
  "UNSEEN",
  "REJECTED",
  "ACCEPTED_PENDING_ACTION",
  "SUCCEEDED",
  "FAILED_FINAL",
] as const;
export type UseState = (typeof USE_STATES)[number];
export type AcceptedUseState = Exclude<UseState, "UNSEEN" | "REJECTED">;
export type TransitionCause =
  "ACCEPT" | "REJECT" | "EXACT_RETRY" | "RECOVER" | "ACTION_SUCCEEDED" | "ACTION_FAILED";
export function canTransitionUse(from: UseState, to: UseState, cause: TransitionCause): boolean {
  switch (from) {
    case "UNSEEN":
      return (
        (to === "REJECTED" && cause === "REJECT") ||
        (to === "ACCEPTED_PENDING_ACTION" && cause === "ACCEPT")
      );
    case "ACCEPTED_PENDING_ACTION":
      return (
        (to === from && (cause === "EXACT_RETRY" || cause === "RECOVER")) ||
        (to === "SUCCEEDED" && cause === "ACTION_SUCCEEDED") ||
        (to === "FAILED_FINAL" && cause === "ACTION_FAILED")
      );
    case "SUCCEEDED":
    case "FAILED_FINAL":
      return to === from && cause === "EXACT_RETRY";
    case "REJECTED":
      return false;
  }
  return false;
}
export function assertUseTransition(from: UseState, to: UseState, cause: TransitionCause): void {
  if (!canTransitionUse(from, to, cause)) throw new DomainError("INVALID_STATE_TRANSITION");
}
