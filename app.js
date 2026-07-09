const STORAGE_KEY = "lex-and-laundry-state";
const latestMonitorReport = window.__LEX_MONITOR_REPORT__ || null;
registerServiceWorker();

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
    borough: "Queens",
    micro: "Hunters Point, Court Square, Gantry",
    commuteMinutes: 14,
    apartmentFit: 95,
    friends: 82,
    budgetFit: 80,
    twoBedFit: 88,
    summary:
      "Probably the cleanest overall fit if you want modern layouts, genuine in-unit laundry odds, and an easy Midtown East commute.",
    reasons: ["Fast commute", "Strong W/D inventory", "2BR odds beat Manhattan core"],
    watchouts:
      "Can feel tower-heavy, and some listings lean sleek rather than warm. You may need to trade neighborhood charm for apartment quality.",
  },
  {
    id: "ues",
    name: "Upper East Side",
    borough: "Manhattan",
    micro: "Lenox Hill, Yorkville",
    commuteMinutes: 18,
    apartmentFit: 74,
    friends: 58,
    budgetFit: 77,
    twoBedFit: 70,
    summary:
      "Excellent for office gravity and daily ease, especially if you stay near the Q or 4/5/6. A real contender if commute comfort keeps compounding.",
    reasons: ["Easiest Manhattan commute", "Plenty of polish", "Still feasible inside budget"],
    watchouts:
      "A lot of otherwise-good layouts hide closed or galley kitchens. Screen floor plans carefully before touring.",
  },
  {
    id: "uws",
    name: "Upper West Side",
    borough: "Manhattan",
    micro: "70s through low 100s",
    commuteMinutes: 27,
    apartmentFit: 71,
    friends: 90,
    budgetFit: 64,
    twoBedFit: 60,
    summary:
      "A lifestyle match for your social orbit and a great place to host, especially if you value closeness to UWS and Morningside friends.",
    reasons: ["Best friend proximity", "Strong home base feel", "Great entertaining neighborhood"],
    watchouts:
      "The nicest 2BR plus in-unit laundry plus open kitchen combinations get expensive quickly, and older layouts miss on kitchen flow.",
  },
  {
    id: "fort-greene",
    name: "Fort Greene / Downtown Brooklyn",
    borough: "Brooklyn",
    micro: "Fort Greene, Boerum Hill edge, Downtown",
    commuteMinutes: 29,
    apartmentFit: 79,
    friends: 84,
    budgetFit: 74,
    twoBedFit: 76,
    summary:
      "A balanced Brooklyn option if you want strong train access, good social positioning, and better odds of an office-worthy second bedroom.",
    reasons: ["Strong Atlantic terminal access", "Good social reach", "Solid modern inventory pockets"],
    watchouts:
      "The best stock moves fast, and some buildings are more 'luxury-lite' than truly spacious.",
  },
  {
    id: "prospect-heights",
    name: "Prospect Heights",
    borough: "Brooklyn",
    micro: "Vanderbilt, Underhill, Pacific edge",
    commuteMinutes: 34,
    apartmentFit: 72,
    friends: 92,
    budgetFit: 70,
    twoBedFit: 73,
    summary:
      "One of the best answers if you want Brooklyn energy, proximity to friends, and a place that feels good for dinners instead of just sleeping.",
    reasons: ["Best Brooklyn social fit", "Entertaining upside", "Real 2BR possibilities"],
    watchouts:
      "Commute is more of a commitment, especially on office-heavy weeks, and some charming stock sacrifices layout efficiency.",
  },
  {
    id: "park-slope",
    name: "Park Slope",
    borough: "Brooklyn",
    micro: "North Slope, 5th Ave, 7th Ave",
    commuteMinutes: 37,
    apartmentFit: 69,
    friends: 94,
    budgetFit: 63,
    twoBedFit: 68,
    summary:
      "A very comfortable life choice with strong social upside, but you will pay for the privilege when you insist on open kitchen plus in-unit laundry.",
    reasons: ["Closest to key friends", "Warmest home-base feel", "Great guest energy"],
    watchouts:
      "The exact apartment spec you want can easily drift into stretch territory, especially for nicer 2BRs.",
  },
  {
    id: "greenpoint",
    name: "Greenpoint / Williamsburg",
    borough: "Brooklyn",
    micro: "North Greenpoint, South Williamsburg",
    commuteMinutes: 27,
    apartmentFit: 81,
    friends: 66,
    budgetFit: 69,
    twoBedFit: 74,
    summary:
      "A good wildcard if you want strong apartment quality and a social scene, with a better chance of open-plan living than many older Manhattan options.",
    reasons: ["Good modern layouts", "Entertaining-friendly", "Decent commute balance"],
    watchouts:
      "Not as directly aligned with your existing friend map, and some commutes require more transfer tolerance.",
  },
  {
    id: "midtown-east",
    name: "Sutton Place / Midtown East",
    borough: "Manhattan",
    micro: "Beekman, Sutton, Turtle Bay edge",
    commuteMinutes: 11,
    apartmentFit: 63,
    friends: 36,
    budgetFit: 60,
    twoBedFit: 52,
    summary:
      "Incredible convenience play, but probably not the best answer if the apartment also needs to feel like your real life, not just a crash pad.",
    reasons: ["Shortest commute", "Easy office weeks", "Simple daily logistics"],
    watchouts:
      "Lower social leverage and more layouts that feel practical rather than exciting for entertaining.",
  },
];

const els = {
  salaryBase: document.querySelector("#salaryBase"),
  bonusPct: document.querySelector("#bonusPct"),
  signingBonus: document.querySelector("#signingBonus"),
  budgetTarget: document.querySelector("#budgetTarget"),
  budgetStretch: document.querySelector("#budgetStretch"),
  wfhPct: document.querySelector("#wfhPct"),
  wfhPctValue: document.querySelector("#wfhPctValue"),
  weightApartment: document.querySelector("#weightApartment"),
  weightCommute: document.querySelector("#weightCommute"),
  weightFriends: document.querySelector("#weightFriends"),
  weightBudget: document.querySelector("#weightBudget"),
  weightSpace: document.querySelector("#weightSpace"),
  weightApartmentValue: document.querySelector("#weightApartmentValue"),
  weightCommuteValue: document.querySelector("#weightCommuteValue"),
  weightFriendsValue: document.querySelector("#weightFriendsValue"),
  weightBudgetValue: document.querySelector("#weightBudgetValue"),
  weightSpaceValue: document.querySelector("#weightSpaceValue"),
  budgetBand: document.querySelector("#budgetBand"),
  monitorLastRun: document.querySelector("#monitorLastRun"),
  monitorSourceCount: document.querySelector("#monitorSourceCount"),
  monitorNewCount: document.querySelector("#monitorNewCount"),
  monitorTopScore: document.querySelector("#monitorTopScore"),
  monitorStatusCopy: document.querySelector("#monitorStatusCopy"),
  monitorFeedState: document.querySelector("#monitorFeedState"),
  monitorFeed: document.querySelector("#monitorFeed"),
  neighborhoods: document.querySelector("#neighborhoods"),
  listingForm: document.querySelector("#listingForm"),
  listingId: document.querySelector("#listingId"),
  listingTitle: document.querySelector("#listingTitle"),
  listingLink: document.querySelector("#listingLink"),
  listingNeighborhood: document.querySelector("#listingNeighborhood"),
  listingRent: document.querySelector("#listingRent"),
  listingBedrooms: document.querySelector("#listingBedrooms"),
  listingBathrooms: document.querySelector("#listingBathrooms"),
  listingSqft: document.querySelector("#listingSqft"),
  listingCommute: document.querySelector("#listingCommute"),
  listingWd: document.querySelector("#listingWd"),
  listingKitchen: document.querySelector("#listingKitchen"),
  listingGas: document.querySelector("#listingGas"),
  listingNotes: document.querySelector("#listingNotes"),
  listingDescription: document.querySelector("#listingDescription"),
  parseDescription: document.querySelector("#parseDescription"),
  saveListing: document.querySelector("#saveListing"),
  resetForm: document.querySelector("#resetForm"),
  shortlistOnly: document.querySelector("#shortlistOnly"),
  exportListings: document.querySelector("#exportListings"),
  importListings: document.querySelector("#importListings"),
  listingState: document.querySelector("#listingState"),
  listings: document.querySelector("#listings"),
  monitorTemplate: document.querySelector("#monitorTemplate"),
  neighborhoodTemplate: document.querySelector("#neighborhoodTemplate"),
  listingTemplate: document.querySelector("#listingTemplate"),
};

const storedState = loadState();

const state = {
  profile: {
    ...defaultProfile,
    ...(storedState.profile || {}),
    weights: {
      ...defaultProfile.weights,
      ...(storedState.profile?.weights || {}),
    },
  },
  listings: Array.isArray(storedState.listings) ? storedState.listings : [],
  shortlistOnly: storedState.shortlistOnly || false,
};

init();

function init() {
  populateNeighborhoodSelect();
  hydrateControls();
  bindEvents();
  render();
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      profile: state.profile,
      listings: state.listings,
      shortlistOnly: state.shortlistOnly,
    })
  );
}

function populateNeighborhoodSelect() {
  neighborhoods.forEach((neighborhood) => {
    const option = document.createElement("option");
    option.value = neighborhood.id;
    option.textContent = neighborhood.name;
    els.listingNeighborhood.append(option);
  });
}

function hydrateControls() {
  els.salaryBase.value = state.profile.salaryBase;
  els.bonusPct.value = state.profile.bonusPct;
  els.signingBonus.value = state.profile.signingBonus;
  els.budgetTarget.value = state.profile.budgetTarget;
  els.budgetStretch.value = state.profile.budgetStretch;
  els.wfhPct.value = state.profile.wfhPct;
  els.shortlistOnly.checked = state.shortlistOnly;

  els.weightApartment.value = state.profile.weights.apartment;
  els.weightCommute.value = state.profile.weights.commute;
  els.weightFriends.value = state.profile.weights.friends;
  els.weightBudget.value = state.profile.weights.budget;
  els.weightSpace.value = state.profile.weights.space;

  syncControlLabels();
}

function bindEvents() {
  const profileInputs = [
    els.salaryBase,
    els.bonusPct,
    els.signingBonus,
    els.budgetTarget,
    els.budgetStretch,
    els.wfhPct,
    els.weightApartment,
    els.weightCommute,
    els.weightFriends,
    els.weightBudget,
    els.weightSpace,
  ];

  profileInputs.forEach((input) => {
    input.addEventListener("input", () => {
      state.profile.salaryBase = parseNumber(els.salaryBase.value, defaultProfile.salaryBase);
      state.profile.bonusPct = parseNumber(els.bonusPct.value, defaultProfile.bonusPct);
      state.profile.signingBonus = parseNumber(els.signingBonus.value, defaultProfile.signingBonus);
      state.profile.budgetTarget = parseNumber(els.budgetTarget.value, defaultProfile.budgetTarget);
      state.profile.budgetStretch = parseNumber(els.budgetStretch.value, defaultProfile.budgetStretch);
      state.profile.wfhPct = parseNumber(els.wfhPct.value, defaultProfile.wfhPct);
      state.profile.weights = {
        apartment: parseNumber(els.weightApartment.value, defaultProfile.weights.apartment),
        commute: parseNumber(els.weightCommute.value, defaultProfile.weights.commute),
        friends: parseNumber(els.weightFriends.value, defaultProfile.weights.friends),
        budget: parseNumber(els.weightBudget.value, defaultProfile.weights.budget),
        space: parseNumber(els.weightSpace.value, defaultProfile.weights.space),
      };

      if (state.profile.budgetStretch < state.profile.budgetTarget) {
        state.profile.budgetStretch = state.profile.budgetTarget;
        els.budgetStretch.value = state.profile.budgetStretch;
      }

      syncControlLabels();
      saveState();
      render();
    });
  });

  els.listingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    upsertListing();
  });

  els.parseDescription.addEventListener("click", () => {
    parseListingDescription();
  });

  els.resetForm.addEventListener("click", () => {
    resetForm();
  });

  els.shortlistOnly.addEventListener("change", () => {
    state.shortlistOnly = els.shortlistOnly.checked;
    saveState();
    renderListings();
  });

  els.exportListings.addEventListener("click", exportListings);
  els.importListings.addEventListener("change", importListings);
}

function syncControlLabels() {
  els.wfhPctValue.textContent = `${state.profile.wfhPct}%`;
  els.weightApartmentValue.textContent = weightPercent("apartment");
  els.weightCommuteValue.textContent = weightPercent("commute");
  els.weightFriendsValue.textContent = weightPercent("friends");
  els.weightBudgetValue.textContent = weightPercent("budget");
  els.weightSpaceValue.textContent = weightPercent("space");
}

function weightPercent(key) {
  const normalized = normalizeWeights(state.profile.weights);
  return `${Math.round(normalized[key] * 100)}%`;
}

function normalizeWeights(rawWeights) {
  const total = Object.values(rawWeights).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    Object.entries(rawWeights).map(([key, value]) => [key, value / total])
  );
}

function render() {
  renderMonitor();
  renderBudgetBand();
  renderNeighborhoods();
  renderListings();
}

function renderMonitor() {
  if (!els.monitorFeed || !els.monitorFeedState) return;

  const report = latestMonitorReport;
  els.monitorFeed.innerHTML = "";

  if (!report) {
    els.monitorLastRun.textContent = "Waiting for first scan";
    els.monitorSourceCount.textContent = "0 active searches";
    els.monitorNewCount.textContent = "0 new listings";
    els.monitorTopScore.textContent = "No scored listings yet";
    els.monitorStatusCopy.textContent =
      "This page can show the live shortlist once the background scanner has produced its first report.";
    els.monitorFeedState.textContent =
      "No scan data has been loaded yet. Once the monitor runs, refresh this page and the live apartment feed will appear here.";
    return;
  }

  const topListings = Array.isArray(report.topListings) ? report.topListings : [];
  const newListings = Array.isArray(report.newListings) ? report.newListings : [];
  const sourceCount = report.sourcesConfigured || 0;
  const best = topListings[0] || null;

  els.monitorLastRun.textContent = report.runAt ? formatDateTime(report.runAt) : "Waiting for first scan";
  els.monitorSourceCount.textContent = `${sourceCount} active search${sourceCount === 1 ? "" : "es"}`;
  els.monitorNewCount.textContent = `${newListings.length} new listing${newListings.length === 1 ? "" : "s"}`;
  els.monitorTopScore.textContent = best
    ? `${Math.round(best.score)} in ${best.listing.neighborhoodName}`
    : "No scored listings yet";

  if (!sourceCount) {
    els.monitorStatusCopy.textContent =
      "The interface is ready, but no live saved searches are connected yet.";
    els.monitorFeedState.textContent =
      "Add live search URLs to the monitor configuration and this section becomes your first-stop apartment feed.";
    return;
  }

  if (!topListings.length) {
    els.monitorStatusCopy.textContent =
      "Saved searches are connected. The next successful scan will start filling this feed.";
    els.monitorFeedState.textContent =
      "No listings are in the scored feed yet. That usually means the scanner has not inspected live results yet or the sources are still being connected.";
    return;
  }

  if (!newListings.length) {
    els.monitorStatusCopy.textContent =
      "No fresh standout listings landed on the latest pass, so the best current options stay pinned below.";
    els.monitorFeedState.textContent =
      "Showing the strongest current apartments from the monitor. Refresh after the next background scan to check for new arrivals.";
  } else {
    els.monitorStatusCopy.textContent =
      `${newListings.length} new listing${newListings.length === 1 ? "" : "s"} passed through the latest scan. Start with the top cards below.`;
    els.monitorFeedState.textContent =
      "The feed below is ordered so you can screen likely winners fast, with screenshots and photo clues first.";
  }

  const fragment = document.createDocumentFragment();

  topListings.slice(0, 6).forEach((entry) => {
    const node = els.monitorTemplate.content.firstElementChild.cloneNode(true);
    const screenshot = resolveMonitorAssetPath(entry.listing.externalScreenshot);
    const heroImage = screenshot || entry.listing.photos?.[0] || "";

    node.querySelector(".monitor-decision").textContent = entry.label;
    node.querySelector(".monitor-name").textContent = entry.listing.title;
    node.querySelector(".monitor-subhead").textContent = `${entry.listing.neighborhoodName} • ${formatCurrency(entry.listing.price)} • ${entry.listing.commuteMinutes || "?"} min commute`;
    node.querySelector(".monitor-score").textContent = `${Math.round(entry.score)} score`;

    const hero = node.querySelector(".monitor-shot");
    if (heroImage) {
      hero.src = heroImage;
      hero.alt = `${entry.listing.title} preview`;
      hero.style.display = "block";
    }

    const photoRow = node.querySelector(".monitor-photo-row");
    (entry.listing.photos || [])
      .slice(heroImage === screenshot ? 0 : 1, 4)
      .forEach((photo) => {
        const image = document.createElement("img");
        image.className = "monitor-thumb";
        image.src = photo;
        image.alt = `${entry.listing.title} photo`;
        photoRow.append(image);
      });

    const facts = node.querySelector(".monitor-facts");
    [
      entry.listing.bedrooms !== null ? `${entry.listing.bedrooms} bed` : "Beds unknown",
      entry.listing.bathrooms ? `${entry.listing.bathrooms} bath` : null,
      entry.listing.sqft ? `${entry.listing.sqft} sf` : null,
      formatLabel("W/D", entry.listing.washerDryer),
      formatLabel("Kitchen", entry.listing.kitchenLayout),
      formatLabel("Gas", entry.listing.gasStove),
    ]
      .filter(Boolean)
      .forEach((label) => facts.append(createPill(label, "fact-pill")));

    const whyParts = [];
    if (entry.pluses?.length) {
      whyParts.push(`Signals: ${entry.pluses.join(", ")}.`);
    }
    if (entry.listing.description) {
      whyParts.push(entry.listing.description.slice(0, 240));
    }
    node.querySelector(".monitor-why").textContent = whyParts.join(" ");

    const issues = node.querySelector(".monitor-issues");
    if (entry.issues?.length) {
      entry.issues.forEach((issue) => issues.append(createPill(issue, "issue-chip")));
    } else {
      issues.append(createPill("No major flags detected", "chip"));
    }

    const link = node.querySelector(".monitor-link");
    link.href = entry.listing.url;

    fragment.append(node);
  });

  els.monitorFeed.append(fragment);
}

function renderBudgetBand() {
  const salaryBase = state.profile.salaryBase;
  const targetBonus = salaryBase * (state.profile.bonusPct / 100);
  const targetComp = salaryBase + targetBonus;
  const maxBaseRent = salaryBase / 40;
  const maxTargetRent = targetComp / 40;
  const monthlyBase = salaryBase / 12;
  const monthlyTarget = targetComp / 12;

  let budgetTone = "Your target budget is comfortably aligned with total comp.";
  if (state.profile.budgetTarget > maxBaseRent) {
    budgetTone =
      "Your target budget is above a strict base-salary-only 40x screen, so bonus treatment and landlord flexibility may matter.";
  }
  if (state.profile.budgetStretch > maxTargetRent) {
    budgetTone =
      "Your stretch budget pushes beyond a simple 40x view of base plus target bonus, so reserve it for a truly special place.";
  }

  els.budgetBand.innerHTML = `
    <strong>Comp frame:</strong> Base is ${formatCurrency(salaryBase)} and target annual comp is ${formatCurrency(targetComp)}.
    That implies about <strong>${formatCurrency(monthlyBase)}</strong> gross monthly on base and
    <strong>${formatCurrency(monthlyTarget)}</strong> gross monthly at target comp.
    A simple 40x lens lands near <strong>${formatCurrency(maxBaseRent)}</strong> on base only and
    <strong>${formatCurrency(maxTargetRent)}</strong> including target bonus. ${budgetTone}
  `;
}

function renderNeighborhoods() {
  const fragment = document.createDocumentFragment();
  const ranked = neighborhoods
    .map((neighborhood) => ({
      ...neighborhood,
      score: scoreNeighborhood(neighborhood),
    }))
    .sort((a, b) => b.score - a.score);

  els.neighborhoods.innerHTML = "";

  ranked.forEach((neighborhood, index) => {
    const node = els.neighborhoodTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".rank-pill").textContent = `Rank ${index + 1}`;
    node.querySelector(".name").textContent = neighborhood.name;
    node.querySelector(".subhead").textContent = `${neighborhood.borough} • ${neighborhood.micro}`;
    node.querySelector(".score-badge").textContent = `${Math.round(neighborhood.score)} fit`;

    const metricRow = node.querySelector(".metric-row");
    [
      `${neighborhood.commuteMinutes} min commute`,
      `${neighborhood.friends} friend score`,
      `${neighborhood.twoBedFit} 2BR odds`,
    ].forEach((label) => metricRow.append(createPill(label, "fact-pill")));

    node.querySelector(".summary").textContent = neighborhood.summary;

    const chips = node.querySelector(".reason-chips");
    neighborhood.reasons.forEach((reason) => chips.append(createPill(reason, "chip")));

    node.querySelector(".watchouts").textContent = `Watch-out: ${neighborhood.watchouts}`;
    fragment.append(node);
  });

  els.neighborhoods.append(fragment);
}

function scoreNeighborhood(neighborhood) {
  const weights = normalizeWeights(state.profile.weights);
  return (
    neighborhood.apartmentFit * weights.apartment +
    commuteScoreFromMinutes(neighborhood.commuteMinutes) * weights.commute +
    neighborhood.friends * weights.friends +
    neighborhood.budgetFit * weights.budget +
    neighborhood.twoBedFit * weights.space
  );
}

function commuteScoreFromMinutes(minutes) {
  return clamp(100 - (minutes - 10) * 2.8, 32, 100);
}

function renderListings() {
  const evaluations = state.listings
    .map((listing) => ({
      listing,
      result: scoreListing(listing),
    }))
    .filter(({ result }) => !state.shortlistOnly || result.isShortlistReady)
    .sort((a, b) => b.result.score - a.result.score);

  els.listings.innerHTML = "";

  if (!state.listings.length) {
    els.listingState.textContent =
      "No saved listings yet. Start by adding one real apartment and the tracker will surface whether it deserves your attention.";
    return;
  }

  if (!evaluations.length) {
    els.listingState.textContent =
      "You have saved listings, but none currently meet the shortlist-ready filter.";
    return;
  }

  els.listingState.textContent = `${evaluations.length} listing${evaluations.length === 1 ? "" : "s"} shown.`;

  const fragment = document.createDocumentFragment();

  evaluations.forEach(({ listing, result }) => {
    const node = els.listingTemplate.content.firstElementChild.cloneNode(true);
    const titleNode = node.querySelector(".listing-name");

    if (listing.link) {
      const anchor = document.createElement("a");
      anchor.href = listing.link;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = listing.title;
      titleNode.replaceWith(anchor);
      anchor.className = "listing-name";
    } else {
      titleNode.textContent = listing.title;
    }

    node.querySelector(".decision-badge").textContent = result.label;
    node.querySelector(".listing-subhead").textContent = `${findNeighborhood(listing.neighborhoodId)?.name || "Unknown"} • ${formatCurrency(listing.rent)}`;
    node.querySelector(".score-badge").textContent = `${Math.round(result.score)} score`;

    const facts = node.querySelector(".listing-facts");
    [
      `${listing.bedrooms} bed`,
      listing.bathrooms ? `${listing.bathrooms} bath` : null,
      listing.sqft ? `${listing.sqft} sf` : null,
      `${listing.commuteMinutes || findNeighborhood(listing.neighborhoodId)?.commuteMinutes || "?"} min commute`,
      formatLabel("W/D", listing.washerDryer),
      formatLabel("Kitchen", listing.kitchenLayout),
      formatLabel("Gas", listing.gasStove),
    ]
      .filter(Boolean)
      .forEach((label) => facts.append(createPill(label, "fact-pill")));

    const whyParts = [];
    if (result.pluses.length) {
      whyParts.push(`Why it works: ${result.pluses.join(", ")}.`);
    }
    if (listing.notes) {
      whyParts.push(`Notes: ${listing.notes}`);
    }
    node.querySelector(".listing-why").textContent = whyParts.join(" ");

    const issues = node.querySelector(".issue-list");
    if (result.issues.length) {
      result.issues.forEach((issue) => issues.append(createPill(issue, "issue-chip")));
    } else {
      issues.append(createPill("No major flags detected", "chip"));
    }

    node.querySelector(".action-edit").addEventListener("click", () => loadListingIntoForm(listing.id));
    node.querySelector(".action-delete").addEventListener("click", () => deleteListing(listing.id));

    fragment.append(node);
  });

  els.listings.append(fragment);
}

function scoreListing(listing) {
  const neighborhood = findNeighborhood(listing.neighborhoodId);
  const commuteMinutes = listing.commuteMinutes || neighborhood?.commuteMinutes || 30;
  const weights = normalizeWeights(state.profile.weights);
  const issues = [];
  const pluses = [];

  const apartmentScore = scoreApartmentFit(listing, issues, pluses);
  const budgetScore = scoreBudgetFit(listing.rent);
  const spaceScore = scoreSpaceFit(listing, pluses);
  const commuteScore = commuteScoreFromMinutes(commuteMinutes);
  const friendScore = neighborhood?.friends || 55;

  const rawScore =
    apartmentScore * weights.apartment +
    commuteScore * weights.commute +
    friendScore * weights.friends +
    budgetScore * weights.budget +
    spaceScore * weights.space;

  if (listing.rent > state.profile.budgetStretch) {
    issues.push("Above stretch budget");
  }

  const hardFail =
    listing.bedrooms < 1 ||
    listing.washerDryer === "no" ||
    listing.kitchenLayout === "galley" ||
    listing.rent > state.profile.budgetStretch;

  let label = "Watch";
  if (hardFail) {
    label = "Pass";
  } else if (rawScore >= 84) {
    label = "High Attention";
  } else if (rawScore >= 74) {
    label = "Strong Candidate";
  } else if (rawScore >= 64) {
    label = "Worth Touring";
  }

  return {
    score: rawScore,
    label,
    issues,
    pluses,
    isShortlistReady: !hardFail && rawScore >= 74,
  };
}

function scoreApartmentFit(listing, issues, pluses) {
  let total = 0;

  if (listing.washerDryer === "yes") {
    total += 38;
    pluses.push("in-unit washer/dryer");
  } else if (listing.washerDryer === "unknown") {
    total += 20;
    issues.push("Confirm in-unit washer/dryer");
  } else {
    issues.push("No in-unit washer/dryer");
  }

  switch (listing.kitchenLayout) {
    case "open":
      total += 40;
      pluses.push("open kitchen");
      break;
    case "semi-open":
      total += 28;
      pluses.push("semi-open kitchen");
      break;
    case "closed":
      total += 16;
      issues.push("Kitchen may not host well");
      break;
    case "galley":
      issues.push("Galley kitchen");
      break;
    default:
      total += 18;
      issues.push("Kitchen layout unclear");
      break;
  }

  if (listing.gasStove === "yes") {
    total += 12;
    pluses.push("gas stove");
  } else if (listing.gasStove === "unknown") {
    total += 6;
    issues.push("Confirm stove type");
  } else {
    total += 1;
  }

  if (listing.sqft) {
    if (listing.sqft >= 850) {
      total += 10;
      pluses.push("ample entertaining space");
    } else if (listing.sqft >= 700) {
      total += 6;
    } else if (listing.sqft < 600) {
      issues.push("Could feel tight for hosting");
    }
  }

  return clamp(total, 0, 100);
}

function scoreBudgetFit(rent) {
  if (!rent) return 40;
  if (rent <= state.profile.budgetTarget) {
    return clamp(100 - (state.profile.budgetTarget - rent) / 35, 84, 100);
  }
  if (rent <= state.profile.budgetStretch) {
    const overTarget = rent - state.profile.budgetTarget;
    const spread = Math.max(state.profile.budgetStretch - state.profile.budgetTarget, 1);
    return clamp(82 - (overTarget / spread) * 24, 55, 82);
  }
  const overStretch = rent - state.profile.budgetStretch;
  return clamp(48 - overStretch / 20, 0, 48);
}

function scoreSpaceFit(listing, pluses) {
  let score = 0;

  if (listing.bedrooms >= 2) {
    score += 88;
    pluses.push("real office or guest room");
  } else if (listing.bedrooms >= 1) {
    score += 64;
  } else {
    score += 0;
  }

  if (listing.bathrooms >= 2) {
    score += 6;
  }

  if (listing.sqft >= 850) {
    score += 6;
  }

  return clamp(score, 0, 100);
}

function upsertListing() {
  const listing = {
    id: els.listingId.value || crypto.randomUUID(),
    title: els.listingTitle.value.trim(),
    link: els.listingLink.value.trim(),
    neighborhoodId: els.listingNeighborhood.value,
    rent: parseNumber(els.listingRent.value, 0),
    bedrooms: parseNumber(els.listingBedrooms.value, 0),
    bathrooms: parseFloat(els.listingBathrooms.value || "0"),
    sqft: parseNumber(els.listingSqft.value, 0),
    commuteMinutes: parseNumber(els.listingCommute.value, 0),
    washerDryer: els.listingWd.value,
    kitchenLayout: els.listingKitchen.value,
    gasStove: els.listingGas.value,
    notes: els.listingNotes.value.trim(),
  };

  const existingIndex = state.listings.findIndex((item) => item.id === listing.id);

  if (existingIndex >= 0) {
    state.listings.splice(existingIndex, 1, listing);
  } else {
    state.listings.push(listing);
  }

  saveState();
  resetForm();
  renderListings();
}

function resetForm() {
  els.listingForm.reset();
  els.listingId.value = "";
  els.listingNeighborhood.value = neighborhoods[0].id;
  els.listingWd.value = "unknown";
  els.listingKitchen.value = "unknown";
  els.listingGas.value = "unknown";
  els.saveListing.textContent = "Save listing";
}

function loadListingIntoForm(id) {
  const listing = state.listings.find((item) => item.id === id);
  if (!listing) return;

  els.listingId.value = listing.id;
  els.listingTitle.value = listing.title;
  els.listingLink.value = listing.link || "";
  els.listingNeighborhood.value = listing.neighborhoodId;
  els.listingRent.value = listing.rent;
  els.listingBedrooms.value = listing.bedrooms;
  els.listingBathrooms.value = listing.bathrooms || "";
  els.listingSqft.value = listing.sqft || "";
  els.listingCommute.value = listing.commuteMinutes || "";
  els.listingWd.value = listing.washerDryer;
  els.listingKitchen.value = listing.kitchenLayout;
  els.listingGas.value = listing.gasStove;
  els.listingNotes.value = listing.notes || "";
  els.saveListing.textContent = "Update listing";
  window.scrollTo({ top: els.listingForm.offsetTop - 24, behavior: "smooth" });
}

function deleteListing(id) {
  state.listings = state.listings.filter((listing) => listing.id !== id);
  saveState();
  renderListings();
}

function parseListingDescription() {
  const text = els.listingDescription.value.toLowerCase();
  if (!text.trim()) return;

  if (text.includes("washer/dryer") || text.includes("washer dryer") || text.includes("w/d")) {
    els.listingWd.value = "yes";
  }
  if (text.includes("laundry in building") && !text.includes("in-unit")) {
    els.listingWd.value = "no";
  }
  if (
    text.includes("open kitchen") ||
    text.includes("open-concept kitchen") ||
    text.includes("island kitchen") ||
    text.includes("great room")
  ) {
    els.listingKitchen.value = "open";
  }
  if (text.includes("semi-open")) {
    els.listingKitchen.value = "semi-open";
  }
  if (text.includes("closed kitchen") || text.includes("windowed kitchen")) {
    els.listingKitchen.value = "closed";
  }
  if (text.includes("galley")) {
    els.listingKitchen.value = "galley";
  }
  if (text.includes("gas stove") || text.includes("gas range") || text.includes("gas cooktop")) {
    els.listingGas.value = "yes";
  }
  if (text.includes("electric stove") || text.includes("electric range") || text.includes("induction")) {
    els.listingGas.value = "no";
  }

  const twoBedroomMatch = text.match(/(?:^|\s)(2(?:-| )bed|two bedroom)/);
  const oneBedroomMatch = text.match(/(?:^|\s)(1(?:-| )bed|one bedroom)/);
  const studioMatch = text.match(/(?:^|\s)(studio|alcove studio|junior 1)/);

  if (twoBedroomMatch) {
    els.listingBedrooms.value = 2;
  } else if (oneBedroomMatch) {
    els.listingBedrooms.value = 1;
  } else if (studioMatch) {
    els.listingBedrooms.value = 0;
  }

  const sqftMatch = text.match(/(\d{3,4})\s*(?:sf|sq\.?\s*ft|square feet)/);
  if (sqftMatch) {
    els.listingSqft.value = Number.parseInt(sqftMatch[1], 10);
  }
}

function exportListings() {
  const payload = {
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    listings: state.listings,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lex-and-laundry-listings.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importListings(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (Array.isArray(parsed.listings)) {
        state.listings = parsed.listings;
      }
      if (parsed.profile?.weights) {
        state.profile = {
          ...state.profile,
          ...parsed.profile,
          weights: {
            ...state.profile.weights,
            ...parsed.profile.weights,
          },
        };
        hydrateControls();
      }
      saveState();
      render();
    } catch (error) {
      els.listingState.textContent = "Import failed. Please use a JSON file exported from this app.";
    } finally {
      els.importListings.value = "";
    }
  };
  reader.readAsText(file);
}

function createPill(text, className) {
  const pill = document.createElement("span");
  pill.className = className;
  pill.textContent = text;
  return pill;
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatLabel(label, value) {
  if (!value) return null;
  if (value === "yes") return `${label}: yes`;
  if (value === "no") return `${label}: no`;
  if (value === "semi-open") return `${label}: semi-open`;
  return `${label}: ${value}`;
}

function findNeighborhood(id) {
  return neighborhoods.find((item) => item.id === id);
}

function resolveMonitorAssetPath(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("monitor-output/")) return value;
  return `monitor-output/${value.replace(/^\.?\//, "")}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  });
}
