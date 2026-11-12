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
