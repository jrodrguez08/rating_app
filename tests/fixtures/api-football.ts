export const teamSearchResponse = [
  {
    team: {
      id: 1234,
      name: "CS Herediano",
      country: "Costa-Rica",
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

export const matchContextResponse = [
  {
    fixture: { id: 5001 },
    lineups: [
      {
        team: { id: 1234, name: "Herediano" },
        coach: {
          id: 900,
          name: "Herediano Coach",
          photo: "https://img.test/coach.png",
        },
        startXI: [
          { player: { id: 10, name: "Goalkeeper", number: 1, pos: "G" } },
          { player: { id: 11, name: "Starter Out", number: 4, pos: "D" } },
        ],
        substitutes: [
          { player: { id: 20, name: "Substitute In", number: 14, pos: "M" } },
          {
            player: { id: 21, name: "Unused Substitute", number: 18, pos: "F" },
          },
        ],
      },
      {
        team: { id: 2000, name: "Opponent" },
        coach: { id: 901, name: "Opponent Coach", photo: null },
        startXI: [
          { player: { id: 30, name: "Opponent Player", number: 1, pos: "G" } },
        ],
        substitutes: [],
      },
    ],
    events: [
      {
        time: { elapsed: 65, extra: null },
        team: { id: 1234 },
        player: { id: 11, name: "Starter Out" },
        assist: { id: 20, name: "Substitute In" },
        type: "subst",
        detail: "Substitution 1",
      },
      {
        time: { elapsed: 65, extra: null },
        team: { id: 1234 },
        player: { id: 11, name: "Starter Out" },
        assist: { id: 20, name: "Substitute In" },
        type: "subst",
        detail: "Substitution 1",
      },
    ],
    players: [
      {
        team: { id: 1234, name: "Herediano" },
        players: [
          {
            player: { id: 10, name: "Goalkeeper" },
            statistics: [
              { games: { minutes: 90, position: "G", captain: true } },
            ],
          },
          {
            player: { id: 20, name: "Substitute In" },
            statistics: [
              { games: { minutes: 25, position: "M", captain: false } },
            ],
          },
        ],
      },
      { team: { id: 2000 }, players: [] },
    ],
  },
];
