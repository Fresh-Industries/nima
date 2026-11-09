export function goalConversationPrompt(category: string | null): string {
  return category
    ? `I want to start a ${category.toLowerCase()} goal. Ask me one question at a time so we can work it out together, then save it when we agree on it.`
    : "I'd like to start a new goal. Ask me one question at a time to help me figure out what I want, then save it when we agree on it.";
}
