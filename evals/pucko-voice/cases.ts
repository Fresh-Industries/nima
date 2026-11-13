export const cases = [
  {
    id: "addressed",
    source: "Pucko rebuild: the meeting prototype never produced spoken replies.",
    clips: ["Citrus, can you hear me? Please reply with one short sentence."],
    expectation: "A concise audible reply, without delegating an ordinary conversational question.",
    reply: true,
  },
  {
    id: "context",
    source: "Pucko rebuild: answer an addressed question using earlier meeting context.",
    clips: [
      "We decided to let bakers create a booking link before filling in their profile.",
      "Citrus, what onboarding change did we just agree on?",
    ],
    expectation:
      "An audible reply about creating a booking link first; no invented decisions or owners.",
    reply: true,
  },
  {
    id: "passive",
    source: "Pucko rebuild: passive discussion and third-person mentions must stay quiet.",
    clips: [
      "Maybe Citrus could help us later. For now, let us discuss the bakery onboarding ourselves.",
    ],
    expectation: "No audible reply and no delegated work.",
    reply: false,
  },
  {
    id: "wake-pause",
    source:
      "Pucko voice tracing: an acoustic pause split the activation name or separated it from the request.",
    clips: ["Citrus", "Can you hear me?"],
    expectation:
      "Wait for the complete question after the activation name, then give an audible reply without delegating.",
    reply: true,
    waitForLastClip: true,
  },
  {
    id: "name-last",
    source: "Pucko 0.1.17: the activation name only worked as the first word of a request.",
    clips: [
      "We decided to let bakers create a booking link before filling in their profile.",
      "What onboarding change did we just agree on, Citrus?",
    ],
    expectation: "An audible reply about creating a booking link first.",
    reply: true,
    waitForLastClip: true,
  },
  {
    id: "follow-up",
    source: "Pucko 0.1.17: every follow-up question needed the activation name again.",
    clips: ["Citrus, name one yellow fruit in a short sentence.", "And a red one?"],
    expectation:
      "Two audible replies: a yellow fruit, then a red fruit for the follow-up asked without the name.",
    reply: true,
  },
  {
    id: "follow-up-ends",
    source: "Pucko follow-up window: talk between participants after a reply must not be answered.",
    clips: [
      "Citrus, name one yellow fruit in a short sentence.",
      "Okay, thanks. Mya, did you book the venue for Friday?",
    ],
    expectation:
      "Exactly one audible reply, about the fruit. Nothing is said about the venue or to Mya.",
    reply: true,
  },
  {
    id: "clarification",
    source:
      "Pucko 0.1.16: an ambiguous report request became a Work turn instead of a spoken clarification.",
    clips: ["Citrus, could you pull up that report?"],
    expectation: "Ask which report in a short audible reply; do not delegate an unidentified task.",
    reply: true,
  },
  {
    id: "delegate",
    source:
      "Pucko rebuild: addressed research must hand off to Bara instead of inventing work or results.",
    clips: [
      "Citrus, use Bara to research three competitors for an online bakery booking app. Report their product names and sources.",
    ],
    expectation:
      "A client delegation event, without inventing a completed result. Raw acknowledgement may race suppression; the app must gate speaker playback until Bara accepts the request.",
    reply: false,
    delegation: true,
  },
] as const;
