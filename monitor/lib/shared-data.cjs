const defaultProfile = {
  startDate: "2026-10-13",
  office: "53rd & Lexington",
  salaryBase: 245000,
  bonusPct: 15,
  signingBonus: 130000,
  budgetTarget: 6500,
  budgetStretch: 7000,
  wfhPct: 45,
  weights: {
    apartment: 10,
    commute: 6,
    friends: 6,
    budget: 5,
    space: 6,
  },
};

const neighborhoods = [
  {
    id: "lic",
    name: "Long Island City",
    commuteMinutes: 14,
    apartmentFit: 95,
    friends: 82,
    budgetFit: 80,
    twoBedFit: 88,
    aliases: ["long island city", "lic", "hunters point", "court square", "gantry"],
  },
  {
    id: "ues",
    name: "Upper East Side",
    commuteMinutes: 18,
    apartmentFit: 74,
    friends: 58,
    budgetFit: 77,
    twoBedFit: 70,
    aliases: [
      "upper east side",
      "ues",
      "lenox hill",
      "yorkville",
      "sutton place",
      "midtown east",
      "turtle bay",
      "beekman",
    ],
  },
  {
    id: "uws",
    name: "Upper West Side",
    commuteMinutes: 27,
    apartmentFit: 71,
    friends: 90,
    budgetFit: 64,
    twoBedFit: 60,
    aliases: ["upper west side", "uws", "morningside heights", "morningside", "lincoln square"],
  },
  {
    id: "fort-greene",
    name: "Fort Greene / Downtown Brooklyn",
    commuteMinutes: 29,
    apartmentFit: 79,
    friends: 84,
    budgetFit: 74,
    twoBedFit: 76,
    aliases: ["fort greene", "downtown brooklyn", "boerum hill", "brooklyn heights", "dekalb"],
  },
  {
    id: "prospect-heights",
    name: "Prospect Heights",
    commuteMinutes: 34,
    apartmentFit: 72,
    friends: 92,
    budgetFit: 70,
    twoBedFit: 73,
    aliases: ["prospect heights", "pacific park", "vanderbilt"],
  },
  {
    id: "park-slope",
    name: "Park Slope",
    commuteMinutes: 37,
    apartmentFit: 69,
    friends: 94,
    budgetFit: 63,
    twoBedFit: 68,
    aliases: ["park slope", "north slope", "south slope"],
  },
  {
    id: "greenpoint",
    name: "Greenpoint / Williamsburg",
    commuteMinutes: 27,
    apartmentFit: 81,
    friends: 66,
    budgetFit: 69,
    twoBedFit: 74,
    aliases: ["greenpoint", "williamsburg", "east williamsburg"],
  },
];

function getNeighborhoodById(id) {
  return neighborhoods.find((neighborhood) => neighborhood.id === id) || null;
}

module.exports = {
  defaultProfile,
  getNeighborhoodById,
  neighborhoods,
};
