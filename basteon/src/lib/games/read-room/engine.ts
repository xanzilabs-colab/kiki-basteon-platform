export const EMOTIONS = [
  "Left out",
  "Unsure",
  "Frustrated",
  "Proud",
  "Nervous",
] as const;

export const RESPONSES = [
  "Ask what they need, without pressure.",
  "Listen first and let them explain.",
  "Offer practical help if they want it.",
  "Give them some space and check in later.",
  "Ask a kind, open question.",
] as const;

export type ReadRoomScenario = {
  prompt: string;
  contentNote: string;
  emotionOptions?: readonly string[];
  responseOptions?: readonly string[];
  kikiEmotion: number;
  kikiResponse: number;
};

export const SCENARIOS: ReadRoomScenario[] = [
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
  {
    prompt: "A group project is nearly due, and one person is doing most of the tasks.",
    contentNote: "Sharing responsibility",
    emotionOptions: ["Overloaded", "Annoyed", "Concerned about fairness", "Unsure how to speak up", "Okay with the arrangement"],
    responseOptions: [
      "Ask the group to divide the remaining tasks together.",
      "Check privately how the person is feeling about the workload.",
      "Offer to take one specific task, if they would like.",
      "Suggest asking the teacher for help planning the work.",
      "Give them room to decide whether they want support.",
    ],
    kikiEmotion: 2,
    kikiResponse: 0,
  },
  {
    prompt: "A message in a group chat gets no replies, and its sender goes quiet.",
    contentNote: "Online communication",
    emotionOptions: ["Ignored", "Embarrassed", "Disappointed", "Not sure what the silence means", "Unbothered"],
    responseOptions: [
      "Send a friendly one-to-one check-in.",
      "Reply to the message and invite others to join in.",
      "Wait a little; people may be busy or offline.",
      "Ask the sender what kind of support would feel useful.",
      "Avoid guessing why nobody has replied.",
    ],
    kikiEmotion: 3,
    kikiResponse: 0,
  },
  {
    prompt: "Someone arrives at a new club and does not know anyone there yet.",
    contentNote: "Joining a new group",
    emotionOptions: ["Shy", "Curious", "Out of place", "Hopeful", "A bit overwhelmed"],
    responseOptions: [
      "Introduce yourself and ask what brought them to the club.",
      "Offer to show them where the activity is happening.",
      "Invite them to join, while making it easy to say no.",
      "Give them time to look around before approaching again.",
      "Ask another welcoming member to say hello too.",
    ],
    kikiEmotion: 0,
    kikiResponse: 0,
  },
  {
    prompt: "A friend returns something they borrowed, and it is more worn than before.",
    contentNote: "Respectful boundaries",
    emotionOptions: ["Irritated", "Disappointed", "Unsure whether to bring it up", "Understanding", "Protective of my belongings"],
    responseOptions: [
      "Explain calmly what you noticed and how you feel.",
      "Ask what happened before deciding what to do next.",
      "Talk together about borrowing expectations for next time.",
      "Take a break first if you feel too annoyed to talk.",
      "Decide whether you are comfortable lending things again.",
    ],
    kikiEmotion: 1,
    kikiResponse: 1,
  },
  {
    prompt: "A group celebrates a shared success, but one contributor is not mentioned.",
    contentNote: "Noticing everyone's effort",
    emotionOptions: ["Overlooked", "Pleased for the group", "Hurt", "Awkward", "Unsure whether anyone noticed"],
    responseOptions: [
      "Name the person's contribution when there is a natural moment.",
      "Thank the whole group and mention the different efforts involved.",
      "Check with the person privately about how they feel.",
      "Ask the group how to recognize everyone's work next time.",
      "Avoid putting them on the spot if they prefer privacy.",
    ],
    kikiEmotion: 2,
    kikiResponse: 2,
  },
  {
    prompt: "A classmate asks for help understanding a task while you are also busy.",
    contentNote: "Balancing kindness and capacity",
    emotionOptions: ["Willing to help", "Pressed for time", "Unsure what they need", "Concerned about your own work", "Glad they asked"],
    responseOptions: [
      "Say what you can help with and agree on a short time.",
      "Be honest that you are busy and suggest another resource.",
      "Ask which part is confusing before offering an explanation.",
      "Work through one example together if you both have time.",
      "Encourage them to ask the teacher for clarification too.",
    ],
    kikiEmotion: 3,
    kikiResponse: 2,
  },
  {
    prompt: "A friend changes plans at the last minute, and you had been looking forward to meeting.",
    contentNote: "Plans and expectations",
    emotionOptions: ["Let down", "Flexible", "Frustrated", "Worried something happened", "Relieved to have quiet time"],
    responseOptions: [
      "Ask if everything is okay, without assuming the reason.",
      "Say you are disappointed and suggest another time.",
      "Offer a different plan that works for both of you.",
      "Take time for yourself and talk about it later.",
      "Check whether they want help figuring out a new plan.",
    ],
    kikiEmotion: 0,
    kikiResponse: 1,
  },
];

export function scenarioForRound(sessionId: string, roundNo: number): ReadRoomScenario {
  if (!Number.isInteger(roundNo) || roundNo < 1) {
    throw new RangeError("roundNo must be a positive integer");
  }
  let hash = 2166136261;
  for (const character of sessionId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  const start = (hash >>> 0) % SCENARIOS.length;
  return SCENARIOS[(start + roundNo - 1) % SCENARIOS.length];
}

export function isReadRoomChoice(emotion: unknown, response: unknown): boolean {
  return Number.isInteger(emotion)
    && Number(emotion) >= 0
    && Number(emotion) < 5
    && Number.isInteger(response)
    && Number(response) >= 0
    && Number(response) < 5;
}
