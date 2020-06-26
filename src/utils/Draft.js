import similarity from 'compute-cosine-similarity';

import {
  COLOR_COMBINATIONS,
  cardCmc,
  cardColorIdentity,
  cardDevotion,
  cardName,
  cardType,
  COLOR_INCLUSION_MAP,
} from 'utils/Card';
import { csrfFetch } from 'utils/CSRF';
import {
  getRating,
  botRatingAndCombination,
  considerInCombination,
  getPickSynergy,
  isPlayableLand,
  scaleSimilarity,
  SYNERGY_SCALE,
} from 'utils/draftbots';
import { fromEntries } from 'utils/Util';

let draft = null;

export const createSeen = () => ({
  values: fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), 0])),
  synergies: fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), 0])),
  cards: fromEntries(COLOR_COMBINATIONS.map((comb) => [comb.join(''), []])),
});

let synergyMatrix;
// This function tracks the total goodness of the cards we've seen or picked in this color.
export const addSeen = (seen, cards, synergies) => {
  for (const card of cards) {
    if (card.index || card.index === 0) {
      const rating = getRating(card);
      const colors = cardColorIdentity(card);
      const colorsStr = colors.join('');
      for (const comb of COLOR_COMBINATIONS) {
        const combStr = comb.join('');
        if (COLOR_INCLUSION_MAP[combStr][colorsStr]) {
          for (const { index } of seen.cards[combStr]) {
            if (synergyMatrix[index][card.index] === null) {
              if (synergies[card.index].some((n) => n !== 0) && synergies[index].some((x) => x !== 0)) {
                const similarityValue = similarity(synergies[card.index], synergies[index]);
                synergyMatrix[card.index][index] = -Math.log(1 - scaleSimilarity(similarityValue)) / SYNERGY_SCALE;
                if (!Number.isFinite(synergyMatrix[card.index][index])) {
                  synergyMatrix[card.index][index] = 0;
                }
              } else {
                synergyMatrix[card.index][index] = 0;
              }
              synergyMatrix[index][card.index] = synergyMatrix[card.index][index];
            }
            seen.synergies[combStr] += synergyMatrix[index][card.index];
          }
          seen.cards[combStr].push(card);
          // We ignore colorless because they just reduce variance by
          // being in all color combinations.
          if (colors.length > 0) {
            seen.values[combStr] += rating;
          }
        }
      }
    }
  }
};

export function init(newDraft) {
  draft = newDraft;
  const maxIndex = Math.max(...draft.cards.map(({ index }) => index ?? 0));
  synergyMatrix = [];
  for (let i = 0; i <= maxIndex; i++) {
    synergyMatrix.push(new Array(maxIndex + 1).fill(null));
  }
  if (draft.seats[0].packbacklog.length > 0) {
    const { cards } = draft;
    for (const seat of draft.seats) {
      seat.seen = createSeen();
      seat.picked = createSeen();
      addSeen(
        seat.seen,
        seat.packbacklog[0].cards.map((cardIndex) => cards[cardIndex]),
        draft.synergies,
      );
    }
  }
}

function id() {
  return draft._id;
}

function cube() {
  return draft.cube;
}

function pack() {
  return (draft.seats[0].packbacklog[0] || { sealed: false, trash: 0, cards: [] }).cards.map(
    (cardIndex) => draft.cards[cardIndex],
  );
}

const sealed = () => draft.seats[0].packbacklog[0]?.sealed ?? false;

function packPickNumber() {
  let picks = draft.seats[draft.seats.length - 1].pickorder.length;
  let packnum = 0;

  while (
    draft.initial_state[0][packnum] &&
    picks >= draft.initial_state[0][packnum].cards.length - draft.initial_state[0][packnum].trash
  ) {
    picks -= draft.initial_state[0][packnum].cards.length - draft.initial_state[0][packnum].trash;
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

export const getSeen = (seat) => {
  return draft.seats[seat].seen;
};

export const getPicked = (seat) => {
  return draft.seats[seat].pickorder;
};

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

export const calculateBasicCounts = (cards, main, colors) => {
  // add up colors
  const symbols = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  for (const cardIndex of main) {
    for (const symbol of ['W', 'U', 'B', 'R', 'G']) {
      symbols[symbol] += cardDevotion(cards[cardIndex], symbol) ?? 0;
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
  const desiredLength = Math.floor(
    (40 * main.filter((ci) => !cardType(cards[ci]).toLowerCase().includes('land')).length) / 23,
  );
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
  // Sort nodes by distance so we can find the i-closest for i < k.
  for (let i = 0; i < nodes.length; i++) {
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
  // We're looping over every possible center for the spanning tree which likely
  // lies in the middle of an edge, not at a point.
  for (let i = 1; i < nodes.length; i++) {
    // Check the case where this node is the center.
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
        // The edge must be the center so the weights here have to stay close to each other
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
          // Same here
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
          // the next j is closer than the next i. This is technically incorrect since you
          // could have a cluster just slightly farther away on the i side but it should be
          // close enough for our purposes
        } else if (
          jInd < closestJ.length - 1 &&
          (jInd >= 0 ? closestJ[jInd + 1][0] : 0) < (iInd >= 0 ? closestI[iInd + 1][0] : 0)
        ) {
          jInd += 1;
          const [, ind] = closestJ[jInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
          // Either there are no more j's or the next i is closer than the next j
        } else if (iInd < closestI.length - 1) {
          iInd += 1;
          const [, ind] = closestI[iInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
          // no more i's so we'll try to add a j, this can only happen when there aren't k nodes.
        } else if (jInd < closestJ.length - 1) {
          jInd += 1;
          const [, ind] = closestJ[jInd];
          if (!seen.includes(ind)) {
            included += 1;
            seen.push(ind);
          }
          // no more nodes
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

export async function buildDeck(cards, cardIndices, picked, synergies, initialState, basics) {
  let nonlands = cardIndices.filter((card) => !cardType(cards[card]).toLowerCase().includes('land'));
  const lands = cardIndices.filter((card) => cardType(cards[card]).toLowerCase().includes('land'));

  const colors = botColors(cards, null, picked, null, synergies, initialState, 1, initialState[0].length);
  const sortFn = getSortFn(colors, cards);
  const inColor = nonlands.filter((item) => considerInCombination(colors, cards[item]));
  const outOfColor = nonlands.filter((item) => !considerInCombination(colors, cards[item]));

  lands.sort(sortFn);
  inColor.sort(sortFn);

  const playableLands = lands.filter((land) => isPlayableLand(colors, cards[land]));
  const unplayableLands = lands.filter((land) => !isPlayableLand(colors, cards[land]));

  // console.log(colors, inColor.length / nonlands.length, inColor.length);

  nonlands = inColor;
  let side = outOfColor;
  if (nonlands.length < 23) {
    outOfColor.sort(sortFn);
    nonlands.push(...outOfColor.splice(0, 23 - nonlands.length));
    side = [...outOfColor];
  }

  let chosen = [];
  if (synergies) {
    // 1 - synergy since we are measuring distance instead of closeness.
    const distanceFunc = (c1, c2) => 1 - similarity(synergies[c1], synergies[c2]); // + (4800 - c1.rating - c2.rating) / 2400;
    // const distanceFunc = (c1, c2) => {
    //   const vec1 = synergies[c1];
    //   const vec2 = synergies[c2];
    //   let sum = 0;
    //   for (let i = 0; i < vec1.length; i++) {
    //     sum += (vec1[i] - vec2[i]) ** 2;
    //   }
    //   return Math.sqrt(sum) + 24000 / (c1.rating + c2.rating);
    // };
    const NKernels = (n, total) => {
      let remaining = Math.min(total, nonlands.length);
      for (let i = 0; i < n; i++) {
        const floor = Math.floor(remaining / (n - i));
        remaining -= floor;
        const kernel = findShortestKSpanningTree(nonlands, distanceFunc, floor);
        chosen = chosen.concat(kernel);
        // eslint-disable-next-line no-loop-func
        nonlands = nonlands.filter((c) => !chosen.includes(c));
      }
    };
    NKernels(2, 18);
    const played = createSeen();
    addSeen(played, chosen);
    const size = Math.min(23 - chosen.length, nonlands.length);
    for (let i = 0; i < size; i++) {
      // add in new synergy data
<<<<<<< HEAD
      const scores = [];
      scores.push(
        nonlands.map((card) => getPickSynergy(colors, cards[card], played, synergies) + getRating(colors, cards[card])),
      );

||||||| 9d581e19
      const scores = [];
      scores.push(nonlands.map((card) => getPickSynergy(colors, card, played, synergies) + getRating(colors, card)));

=======
>>>>>>> fix-spanning-tree
      let best = 0;
      let bestScore = -Infinity;

      for (let j = 1; j < nonlands.length; j++) {
        const card = nonlands[j];
        const score = getPickSynergy(colors, card, played, synergies) + getRating(colors, card);
        if (score > bestScore) {
          best = j;
          bestScore = score;
        }
      }
      const current = nonlands.splice(best, 1)[0];
      addSeen(played, [current]);
      chosen.push(current);
    }
    nonlands = nonlands.filter((c) => !chosen.includes(c));
  } else {
    chosen = nonlands.sort(sortFn).slice(0, 23);
    nonlands = nonlands.slice(23);
  }

  const main = chosen.concat(playableLands.slice(0, 17));
  side.push(...playableLands.slice(17));
  side.push(...unplayableLands);
  side.push(...nonlands);

  if (basics) {
    const basicsToAdd = calculateBasicCounts(cards, main, colors);
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
  deck[0].sort((a, b) => cardName(cards[a]).localeCompare(cardName(cards[b])));

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
    if (packFrom.cards.length > 0 && bot) {
      const { cards, initial_state, synergies } = draft;
      let ratedPicks = [];
      const inPack = packFrom.length;
      const [packNum] = packPickNumber();
      for (let cardIndex = 0; cardIndex < packFrom.cards.length; cardIndex++) {
        if (cards[packFrom.cards[cardIndex]].rating) {
          ratedPicks.push(cardIndex);
        } else {
          cards[packFrom.cards[cardIndex]].rating = 1200;
          ratedPicks.push(cardIndex);
        }
      }
      ratedPicks = ratedPicks
        .map((cardIndex) => [
          botRating(cards, packFrom.cards[cardIndex], picked, seen, synergies, initial_state, inPack, packNum),
          cardIndex,
        ])
        .sort(([a], [b]) => b - a)
        .map(([, cardIndex]) => cardIndex);

      const [pickedCard] = draft.seats[botIndex].packbacklog[0].cards.splice(ratedPicks[0], 1);
      draft.seats[botIndex].pickorder.push(pickedCard);
      addSeen(picked, [cards[pickedCard]], draft.synergies);
    }
  }
}

const passPackInternal = () => {
  // check if pack is done
  if (draft.seats.every((seat) => seat.packbacklog[0].cards.length <= seat.packbacklog[0].trash)) {
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
  } else {
    const [, pickNum] = packPickNumber();
    if ((pickNum - 1) % draft.seats[0].packbacklog[0].pickAtTime !== 0) {
      return;
    }
    if (draft.unopenedPacks[0].length % 2 === 0) {
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
  }
  const { cards } = draft;
  for (const seat of draft.seats) {
    if (seat.packbacklog && seat.packbacklog.length > 0) {
      addSeen(
        seat.seen,
        seat.packbacklog[0].cards.map((cardIndex) => cards[cardIndex]),
        draft.synergies,
      );
    }
  }
};

function passPack() {
  botPicks();
  passPackInternal();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const nextPack = () => {
  const { cards } = draft;
  for (const seat of draft.seats) {
    const pickedCards = seat.packbacklog[0].cards.splice(0, seat.packbacklog[0].cards.length);
    seat.pickorder.push(...pickedCards);
    if (seat.bot) {
      addSeen(
        seat.picked,
        pickedCards.map((cardIndex) => cards[cardIndex]),
      );
    }
  }
  passPackInternal();
};

async function pick(cardIndex) {
  await sleep(0);
  const ci = draft.seats[0].packbacklog[0].cards.splice(cardIndex, 1)[0];
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
      pack: packFrom.cards.map((c) => draft.cards[c].details.name),
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
      const picked = createSeen();
      addSeen(
        picked,
        draft.seats[i].pickorder.map((cardIndex) => cards[cardIndex]),
        draft.synergies,
      );
      const colors = botColors(
        draft.cards,
        null,
        picked,
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

async function allBotsDraft(noFinish) {
  for (const seat of draft.seats) {
    seat.bot = [];
  }
  while (draft.seats[0].packbacklog.length > 0 && draft.seats[0].packbacklog[0].cards.length > 0) {
    passPack();
  }
  if (!noFinish) {
    await finish();
  }
}

export default {
  addSeen,
  createSeen,
  allBotsDraft,
  arrangePicks,
  botColors,
  buildDeck,
  calculateBasicCounts,
  cube,
  finish,
  id,
  init,
  nextPack,
  pack,
  packPickNumber,
  pick,
  considerInCombination,
  isPlayableLand,
  sealed,
};
