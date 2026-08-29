export const teamSearchResponse = [
  {
    team: {
      id: 1234,
      name: "Herediano",
      country: "Costa Rica",
    },
  },
];

export const competitionResponse = [
  {
    league: { id: 71, name: "Primera Division", type: "League" },
    country: { name: "Costa Rica", code: "CR" },
    seasons: [
      {
        year: 2026,
        start: "2026-07-20",
        end: "2027-05-30",
        current: true,
      },
    ],
  },
  {
    league: { id: 999, name: "Regional Cup", type: "Cup" },
    country: { name: "Costa Rica", code: "CR" },
    seasons: [
      {
        year: 2026,
        start: "2026-08-01",
        end: "2026-12-01",
        current: true,
      },
    ],
  },
];

export const fixtureResponse = [
  {
    fixture: {
      id: 5001,
      date: "2026-08-20T02:00:00-06:00",
      status: { short: "FT" },
    },
    league: { id: 71, season: 2026 },
    teams: {
      home: { id: 1234, name: "Herediano", logo: "https://img.test/1234.png" },
      away: {
        id: 2000,
        name: "Alajuelense",
        logo: "https://img.test/2000.png",
      },
    },
    goals: { home: 2, away: 1 },
  },
  {
    fixture: {
      id: 5002,
      date: "2026-09-02T20:00:00Z",
      status: { short: "NS" },
    },
    league: { id: 999, season: 2026 },
    teams: {
      home: { id: 3000, name: "Saprissa", logo: null },
      away: { id: 1234, name: "Herediano", logo: "https://img.test/1234.png" },
    },
    goals: { home: null, away: null },
  },
];
