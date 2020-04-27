import similarity from 'compute-cosine-similarity';

import { csrfFetch } from 'utils/CSRF';
import { arrayIsSubset, arrayShuffle, fromEntries } from 'utils/Util';
import { COLOR_COMBINATIONS, cardCmc, cardColorIdentity, cardDevotion, cardType } from 'utils/Card';

import { getRating, getPickSynergy, botRatingAndCombination, considerInCombination, fetchLands } from 'utils/draftbots';

let draft = null;

// This function tracks the total goodness of the cards we've seen or picked in this color.
export function addSeen(seen, cards) {
  for (const card of cards) {
    const colors = cardColorIdentity(card);
    // We ignore colorless because they just reduce variance by
    // being in all color combinations.
    if (colors.length > 0) {
      for (const comb of COLOR_COMBINATIONS) {
        if (arrayIsSubset(colors, comb)) {
          // Bad cards (under 1200) should count as 0. Above that, exponential approach to 1.
          seen[comb.join('')] += 10 ** ((card?.rating ?? 1200) / 400 - 4);
        }
      }
    }
    seen.cards.push(card);
  }
}

function init(newDraft) {
  draft = newDraft;
  for (const seat of draft.seats) {
    const { cards } = draft;
    seat.seen = fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), 0]));
    seat.seen.cards = [];
    addSeen(
      seat.seen,
      seat.packbacklog[0].map((cardIndex) => cards[cardIndex]),
    );
    seat.picked = fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), 0]));
    seat.picked.cards = [];
  }
}

function id() {
  return draft._id;
}

function cube() {
  return draft.cube;
}

function pack() {
  return (draft.seats[0].packbacklog[0] || []).map((cardIndex) => draft.cards[cardIndex]);
}

function packPickNumber() {
  let picks = draft.seats[draft.seats.length - 1].pickorder.length;
  let packnum = 0;

  while (draft.initial_state[0][packnum] && picks >= draft.initial_state[0][packnum].length) {
    picks -= draft.initial_state[0][packnum].length;
    packnum += 1;
  }

  return [packnum + 1, picks + 1];
}

function arrangePicks(picks) {
  if (!Array.isArray(picks) || picks.length !== 16) {
    throw new Error('Picks must be an array of length 16.');
  }
  draft.seats[0].drafted = picks.map((pile) =>
    pile.map((pileCard) => draft.cards.findIndex((card) => card.cardID === pileCard.cardID)),
  );
}

const botRating = (cards, card, picked, seen, synergies, initialState, inPack = 1, packNum = 1) =>
  botRatingAndCombination(cards, card, picked, seen, synergies, initialState, inPack, packNum)[0];
const botColors = (cards, card, picked, seen, synergies, initialState, inPack = 1, packNum = 1) =>
  botRatingAndCombination(cards, card, picked, seen, synergies, initialState, inPack, packNum)[1];

function getSortFn(bot, draftCards) {
  return (a, b) => {
    if (bot) {
      return getRating(bot, draftCards[b]) - getRating(bot, draftCards[a]);
    }
    return draftCards[b].rating - draftCards[a].rating;
  };
}

export const calculateBasicCounts = (main, colors) => {
  // add up colors
  const symbols = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  for (const card of main) {
    for (const symbol of ['W', 'U', 'B', 'R', 'G']) {
      symbols[symbol] += cardDevotion(card, symbol) ?? 0;
    }
  }
  const colorWeights = Object.values(symbols);
  const totalColor = colorWeights.reduce((a, b) => {
    return a + b;
  }, 0);
  const result = {};

  const landDict = {
    W: 'Plains',
    U: 'Island',
    B: 'Swamp',
    R: 'Mountain',
    G: 'Forest',
  };
  const desiredLength = Math.floor((40 * main.filter((c) => !cardType(c).toLowerCase().includes('land')).length) / 23);
  const toAdd = desiredLength - main.length;
  let added = 0;
  for (const [symbol, weight] of Object.entries(symbols)) {
    const amount = Math.floor((weight / totalColor) * toAdd);
    result[landDict[symbol]] = amount;
    added += amount;
  }
  for (let i = main.length + added; i < desiredLength; i++) {
    result[landDict[colors[i % colors.length]]] += 1;
  }
  return result;
};

const isPlayableLand = (colors, card) =>
  considerInCombination(colors, card) ||
  (fetchLands[card.details.name] && fetchLands[card.details.name].some((c) => colors.includes(c)));

const allPairsShortestPath = (distances) => {
  const result = [];
  for (let i = 0; i < distances.length; i++) {
    result.push([]);
    for (let j = 0; j < distances.length; j++) {
      result[i].push(distances[i][j]);
    }
  }
  for (let k = 0; k < distances.length; k++) {
    for (let i = 0; i < distances.length; i++) {
      for (let j = 0; j < distances.length; j++) {
        if (result[i][j] > result[i][k] + result[k][j]) {
          result[i][j] = result[i][k] + result[k][j];
        }
      }
    }
  }
  return result;
};

const findShortestKSpanningTree = (nodes, distanceFunc, k) => {
  const closest = [];
  const distancesPre = [];
  for (let i = 0; i < nodes.length; i++) {
    distancesPre.push([]);
    for (let j = 0; j < nodes.length; j++) {
      distancesPre[i].push(0);
    }
  }
  for (let i = 1; i < nodes.length; i++) {
    distancesPre.push([]);
    for (let j = 0; j < i; j++) {
      if (i !== j) {
        // Assume distance is symmetric.
        const distance = distanceFunc(nodes[i], nodes[j]);
        distancesPre[i][j] = distance;
        distancesPre[j][i] = distance;
      }
    }
  }
  const distances = allPairsShortestPath(distancesPre);
  for (let i = 0; i < nodes.length; i++) {
    // We could do this faster with Quick-Select if we need the speedup
    closest.push(
      distances[i]
        .map((distance, ind) => [distance, ind])
        .filter(([, ind]) => ind !== i)
        .sort(([a], [b]) => a - b),
    );
  }

  // Contains distance, amount from left to take, left index, and right index
  let bestDistance = Infinity;
  let bestNodes = [];
  for (let i = 1; i < nodes.length; i++) {
    if (bestDistance > closest[i][k - 2] + closest[i][k - 3]) {
      bestDistance = closest[i][k - 2] + closest[i][k - 3];
      bestNodes = closest[i].slice(0, k - 1).concat([i]);
    }
    for (let j = 0; j < i; j++) {
      const closestI = closest[i].filter(([, ind]) => ind !== j);
      const closestJ = closest[j].filter(([, ind]) => ind !== i);
      const seen = [i, j];
      const distance = distances[i][j];
      let iInd = -1;
      let jInd = -1;
      let included = 2;
      while (included < k) {
        if (
          (iInd >= 0 ? closestI[iInd][0] : 0) + distance < (jInd >= 0 ? closestJ[jInd][0] : 0) &&
          iInd < closestI.length - 1
        ) {
          iInd += 1;
          const [, ind] = closestI[iInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
        } else if (
          (jInd >= 0 ? closestJ[jInd][0] : 0) + distance < (iInd >= 0 ? closestI[iInd][0] : 0) &&
          jInd < closestJ.length - 1
        ) {
          jInd += 1;
          const [, ind] = closestJ[jInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
        } else if (
          jInd < closestJ.length - 1 &&
          (jInd >= 0 ? closestJ[jInd + 1][0] : 0) < (iInd >= 0 ? closestI[iInd][0] : 0)
        ) {
          jInd += 1;
          const [, ind] = closestJ[jInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
        } else if (iInd < closestI.length - 1) {
          iInd += 1;
          const [, ind] = closestI[iInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
        } else if (jInd < closestJ.length - 1) {
          jInd += 1;
          const [, ind] = closestJ[jInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
        } else {
          throw new Error('Not enough nodes to make a K-set.');
        }
      }
      const length = distance + (iInd >= 0 ? closestI[iInd][0] : 0) + (jInd >= 0 ? closestJ[jInd][0] : 0);
      if (length < bestDistance) {
        bestNodes = seen;
        bestDistance = length;
      }
    }
  }
  return bestNodes.map((ind) => nodes[ind]);
};

async function buildDeck(cards, cardIndices, picked, synergies, initialState, basics) {
  let nonlands = cardIndices.filter((card) => !cardType(cards[card]).toLowerCase().includes('land'));
  const lands = cardIndices.filter((card) => cardType(cards[card]).toLowerCase().includes('land'));

  const colors = botColors(cards, null, picked, null, null, synergies, initialState, 1, initialState[0].length);
  const sortFn = getSortFn(colors, cards);
  const inColor = nonlands.filter((item) => considerInCombination(colors, cards[item]));
  const outOfColor = nonlands.filter((item) => !considerInCombination(colors, cards[item]));

  lands.sort(sortFn);
  inColor.sort(sortFn);

  nonlands = inColor;
  let side = outOfColor;
  if (nonlands.length < 23) {
    outOfColor.sort(sortFn);
    nonlands.push(...outOfColor.splice(0, 23 - nonlands.length));
    side = [...outOfColor];
  }

  let chosen = [];
  if (synergies) {
    const SEEDED = 23;
    const distanceFunc = (c1, c2) => 1 - similarity(synergies[c1], synergies[c2]); // + (4800 - c1.rating - c2.rating) / 2400;
    // const distanceFunc = (c1, c2) => {
    //   const vec1 = synergies[c1.index];
    //   const vec2 = synergies[c2.index];
    //   let sum = 0;
    //   for (let i = 0; i < vec1.length; i++) {
    //     sum += (vec1[i] - vec2[i]) ** 2;
    //   }
    //   return Math.sqrt(sum) + 24000 / (c1.rating + c2.rating);
    // };
    const NKernels = (n) => {
      let remaining = Math.min(SEEDED, nonlands.length);
      for (let i = 0; i < n; i++) {
        const floor = Math.floor(remaining / (n - i));
        remaining -= floor;
        const kernel = findShortestKSpanningTree(nonlands, distanceFunc, floor);
        chosen = chosen.concat(kernel);
        // eslint-disable-next-line no-loop-func
        nonlands = nonlands.filter((c) => !chosen.includes(c));
      }
    };
    NKernels(3);
    const played = fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), 0]));
    played.cards = chosen;

    const size = Math.min(23 - chosen.length, nonlands.length);
    for (let i = 0; i < size; i++) {
      // add in new synergy data
      const scores = [];
      scores.push(nonlands.map((card) => getPickSynergy(colors, card, played, synergies) + getRating(colors, card)));

      let best = 0;

      for (let j = 1; j < nonlands.length; j++) {
        if (scores[j] > scores[best]) {
          best = j;
        }
      }
      const current = nonlands.splice(best, 1)[0];
      addSeen(played, [current]);
    }
    nonlands = nonlands.filter((c) => !chosen.includes(c));
  } else {
    chosen = nonlands.sort(sortFn).slice(0, 23);
    nonlands = nonlands.slice(23);
  }

  const playableLands = lands.filter((land) => isPlayableLand(colors, cards[land]));
  const unplayableLands = lands.filter((land) => !isPlayableLand(colors, cards[land]));

  const main = chosen.concat(playableLands.slice(0, 17));
  side.push(...playableLands.slice(17));
  side.push(...unplayableLands);
  side.push(...nonlands);

  if (basics) {
    const basicsToAdd = calculateBasicCounts(
      main.map((ci) => cards[ci]),
      colors,
    );
    for (const [basic, count] of Object.entries(basicsToAdd)) {
      for (let i = 0; i < count; i++) {
        main.push(cards.findIndex((c) => c.cardID === basics[[basic]].cardID));
      }
    }
  }
  const deck = [];
  const sideboard = [];
  for (let i = 0; i < 16; i += 1) {
    deck.push([]);
    if (i < 8) {
      sideboard.push([]);
    }
  }

  for (const cardIndex of main) {
    const card = cards[cardIndex];
    let index = Math.min(cardCmc(card) ?? 0, 7);
    if (!card.details.type.toLowerCase().includes('creature') && !card.details.type.toLowerCase().includes('basic')) {
      index += 8;
    }
    deck[index].push(cardIndex);
  }

  // sort the basic land col
  deck[0].sort((a, b) => a.details.name.localeCompare(b.details.name));

  for (const cardIndex of side) {
    sideboard[Math.min(cardCmc(cards[cardIndex]) ?? 0, 7)].push(cardIndex);
  }

  return {
    deck,
    sideboard,
    colors,
  };
}

function botPicks() {
  // make bots take one pick out of active packs
  for (let botIndex = 0; botIndex < draft.seats.length; botIndex++) {
    const {
      seen,
      picked,
      packbacklog: [packFrom],
      bot,
    } = draft.seats[botIndex];
    if (packFrom.length > 0 && bot) {
      const { cards, initial_state, synergies } = draft;
      let ratedPicks = [];
      const unratedPicks = [];
      const inPack = packFrom.length;
      const [packNum] = packPickNumber();
      for (let cardIndex = 0; cardIndex < packFrom.length; cardIndex++) {
        if (cards[packFrom[cardIndex]].rating) {
          ratedPicks.push(cardIndex);
        } else {
          unratedPicks.push(cardIndex);
        }
      }
      ratedPicks = ratedPicks
        .map((cardIndex) => [
          botRating(cards, packFrom[cardIndex], picked, seen, synergies, initial_state, inPack, packNum),
          cardIndex,
        ])
        .sort(([a], [b]) => b - a)
        .map(([, cardIndex]) => cardIndex);
      arrayShuffle(unratedPicks);

      const pickOrder = ratedPicks.concat(unratedPicks);
      const pickedCard = draft.seats[botIndex].packbacklog[0].splice(pickOrder[0], 1)[0];
      draft.seats[botIndex].pickorder.push(pickedCard);
      addSeen(picked, [cards[pickedCard]]);
    }
  }
}

function passPack() {
  botPicks();
  // check if pack is done
  if (draft.seats.every((seat) => seat.packbacklog[0].length === 0)) {
    // splice the first pack out
    for (const seat of draft.seats) {
      seat.packbacklog.splice(0, 1);
    }

    if (draft.unopenedPacks[0].length > 0) {
      // give new pack
      for (let i = 0; i < draft.seats.length; i++) {
        draft.seats[i].packbacklog.push(draft.unopenedPacks[i].shift());
      }
    }
  } else if (draft.unopenedPacks[0].length % 2 === 0) {
    // pass left
    for (let i = 0; i < draft.seats.length; i++) {
      draft.seats[(i + 1) % draft.seats.length].packbacklog.push(draft.seats[i].packbacklog.splice(0, 1)[0]);
    }
  } else {
    // pass right
    for (let i = draft.seats.length - 1; i >= 0; i--) {
      const packFrom = draft.seats[i].packbacklog.splice(0, 1)[0];
      if (i === 0) {
        draft.seats[draft.seats.length - 1].packbacklog.push(packFrom);
      } else {
        draft.seats[i - 1].packbacklog.push(packFrom);
      }
    }
  }
  const { cards } = draft;
  for (const seat of draft.seats) {
    if (seat.packbacklog && seat.packbacklog.length > 0) {
      addSeen(
        seat.seen,
        seat.packbacklog[0].map((cardIndex) => cards[cardIndex]),
      );
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pick(cardIndex) {
  await sleep(0);
  const ci = draft.seats[0].packbacklog[0].splice(cardIndex, 1)[0];
  const card = draft.cards[ci];
  const packFrom = draft.seats[0].packbacklog[0];
  draft.seats[0].pickorder.push(ci);
  passPack();
  const [packNum] = packPickNumber();
  csrfFetch(`/cube/api/draftpickcard/${draft.cube}`, {
    method: 'POST',
    body: JSON.stringify({
      draft_id: draft._id,
      pick: card.details.name,
      packNum,
      pack: packFrom.map((c) => draft.cards[c].details.name),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function finish() {
  // build bot decks
  const decksPromise = draft.seats.map(
    (seat) =>
      seat.bot &&
      buildDeck(draft.cards, seat.pickorder, seat.picked, draft.synergies, draft.initial_state, draft.basics),
  );
  const decks = await Promise.all(decksPromise);
  const { cards } = draft;

  let botIndex = 1;
  for (let i = 0; i < draft.seats.length; i++) {
    if (draft.seats[i].bot) {
      const { deck, sideboard, colors } = decks[i];
      draft.seats[i].drafted = deck;
      draft.seats[i].sideboard = sideboard;
      draft.seats[i].name = `Bot ${botIndex}: ${colors.length > 0 ? colors.join(', ') : 'C'}`;
      draft.seats[i].description = `This deck was drafted by a bot with color preference for ${colors.join('')}.`;
      botIndex += 1;
    } else {
      const picked = fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), 0]));
      picked.cards = [];
      addSeen(
        picked,
        draft.seats[i].pickorder.map((cardIndex) => cards[cardIndex]),
      );
      const colors = botColors(
        draft.cards,
        null,
        picked,
        null,
        null,
        draft.synergies,
        draft.initial_state,
        1,
        draft.initial_state[0].length,
      );
      draft.seats[i].name = `${draft.seats[i].name}: ${colors.join(', ')}`;
    }
  }

  for (const seat of draft.seats) {
    delete seat.seen;
    delete seat.picked;
  }

  for (const card of draft.cards) {
    delete card.details;
  }

  // save draft. if we fail, we fail
  await csrfFetch(`/cube/api/draftpick/${draft.cube}`, {
    method: 'POST',
    body: JSON.stringify(draft),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function allBotsDraft() {
  for (const seat of draft.seats) {
    seat.bot = [];
  }
  while (draft.seats[0].packbacklog.length > 0 && draft.seats[0].packbacklog[0].length > 0) {
    passPack();
  }
  await finish();
}

export default {
  addSeen,
  allBotsDraft,
  arrangePicks,
  botColors,
  buildDeck,
  calculateBasicCounts,
  cube,
  finish,
  id,
  init,
  pack,
  packPickNumber,
  pick,
};
