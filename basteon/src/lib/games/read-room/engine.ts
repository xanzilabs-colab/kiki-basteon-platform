export const EMOTIONS = [
  "Left out",
  "Unsure",
  "Frustrated",
  "Proud",
] as const;

export const RESPONSES = [
  "Ask what they need, without pressure.",
  "Listen first and let them explain.",
  "Offer practical help if they want it.",
  "Give them some space and check in later.",
] as const;

export const SCENARIOS = [
  {
    prompt: "A friend arrives late to a group plan and everyone has already started.",
    contentNote: "Everyday friendship moment",
    kikiEmotion: 1,
    kikiResponse: 1,
  },
  {
    prompt: "Someone shares an idea in class, and the group quickly moves on.",
    contentNote: "Everyday school moment",
    kikiEmotion: 0,
    kikiResponse: 0,
  },
  {
    prompt: "A teammate makes a mistake during practice and goes quiet.",
    contentNote: "Everyday teamwork moment",
    kikiEmotion: 2,
    kikiResponse: 1,
  },
  {
    prompt: "A friend is excited about something they worked hard to finish.",
    contentNote: "Positive everyday moment",
    kikiEmotion: 3,
    kikiResponse: 2,
  },
  {
    prompt: "Two people make plans while a third person is nearby.",
    contentNote: "Everyday friendship moment",
    kikiEmotion: 0,
    kikiResponse: 0,
  },
  {
    prompt: "Someone says they are fine, but seems quieter than usual.",
    contentNote: "Gentle check-in moment",
    kikiEmotion: 1,
    kikiResponse: 3,
  },
] as const;

export type ReadRoomScenario = (typeof SCENARIOS)[number];

export function scenarioForRound(sessionId: string, roundNo: number): ReadRoomScenario {
  if (!Number.isInteger(roundNo) || roundNo < 1) {
    throw new RangeError("roundNo must be a positive integer");
  }
  let hash = 2166136261;
  for (const character of `${sessionId}:${roundNo}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return SCENARIOS[(hash >>> 0) % SCENARIOS.length];
}

export function isReadRoomChoice(emotion: unknown, response: unknown): boolean {
  return Number.isInteger(emotion)
    && Number(emotion) >= 0
    && Number(emotion) < EMOTIONS.length
    && Number.isInteger(response)
    && Number(response) >= 0
    && Number(response) < RESPONSES.length;
}
