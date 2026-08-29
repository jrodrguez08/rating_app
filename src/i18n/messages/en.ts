import type { Messages } from "../messages";

export const enMessages = {
  metadata: {
    title: "Rating App",
    description:
      "Supporter ratings for the players and coaches who shape the match.",
  },
  common: {
    language: "Language",
    spanish: "Español",
    english: "English",
  },
  accessibility: {
    skipToContent: "Skip to content",
    appHome: "Rating App home",
  },
  navigation: {
    label: "Primary navigation",
    home: "Home",
    matches: "Matches",
    players: "Players",
  },
  home: {
    communityEyebrow: "Initial supporter community",
    introduction:
      "Rate the players and head coach after the final whistle. The first rating window will appear here when a match is ready.",
    noActiveRating: {
      status: "Voting closed",
      title: "No active rating",
      description:
        "The next rating will appear after a match. Only players who took part, plus the head coach, will be eligible for your ballot.",
      privacy:
        "Results stay hidden while voting is open to keep every rating independent.",
    },
  },
  footer: {
    supporting: "Built for supporters. Ready to grow club by club.",
  },
} as const satisfies Messages;
