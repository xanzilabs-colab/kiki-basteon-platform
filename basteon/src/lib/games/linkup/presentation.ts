import type { Mode } from "./engine";

const reasonLabels: Record<string, string> = {
  wrong_start: "Starts with the wrong letter",
  wrong_end: "Ends with the wrong letter",
  not_a_word: "That word isn't in the word list",
  too_short: "That word is too short",
  mine: "Contains a mine letter",
  banned: "Contains a forbidden letter",
  repeat: "That word was already used",
  blocked: "That word isn't allowed",
  timeout: "Time ran out",
  empty: "No word was entered",
  ok: "Accepted",
};

const errorMessages: Record<string, string> = {
  answer_late: "That answer arrived after the timer ended.",
  bomb_turn_already_resolved: "That bomb turn has already been handled. The latest turn is loading.",
  letter_has_no_words: "There are no valid words for that letter. Choose another one.",
  pick_already_locked: "Your letter is already locked in.",
  not_picker: "It's the other player's turn to choose a letter.",
  match_not_found: "This match could not be found. Return to Kiki Links to start another.",
  not_authenticated: "Please sign in again to continue your match.",
  match_state_unavailable: "The latest match state could not be loaded. Your saved game is being retried.",
  invalid_request: "That move could not be processed. Please try again.",
  invalid_match_id: "This match link is invalid. Return to Kiki Links and start another.",
  action_failed: "That move could not be saved. Your entry is still here; please try again.",
};

const modeLabels: Record<Mode, string> = {
  classic: "Classic",
  minefield: "Minefield",
  chain: "Chain",
  wildcard: "Wild Card",
  bomb: "Hot Potato",
};

export function formatLinkupReason(reason: string) {
  return reasonLabels[reason] ?? "Not accepted";
}

export function formatLinkupError(error?: string, reason?: string) {
  if (error === "action_failed" && reason === "answer_insert") {
    return "Your answer couldn't be saved. It is still in the box; please try again.";
  }
  return (error && errorMessages[error]) || "That move could not be saved. Your entry is still here; please try again.";
}

export function formatLinkupMode(mode: Mode) {
  return modeLabels[mode];
}
