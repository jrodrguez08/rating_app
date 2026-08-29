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
    matchLifecycle: {
      versus: "VS",
      upcoming: {
        label: "Next match",
        title: "Next match",
        description:
          "Voting will open after the match finishes and participants are confirmed.",
      },
      live: {
        label: "Live",
        title: "Match in progress",
        description: "Come back after the final whistle to rate the team.",
      },
      preparing: {
        label: "Match finished",
        title: "Preparing the rating",
        description:
          "We are confirming participants and the head coach before opening voting.",
      },
      ready: {
        label: "Voting available",
        title: "The match is ready to rate",
        description:
          "The two-hour window is active. The ballot will arrive in the next milestone.",
      },
    },
  },
  footer: {
    supporting: "Built for supporters. Ready to grow club by club.",
  },
} as const satisfies Messages;
