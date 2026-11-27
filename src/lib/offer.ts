// Prices for buying several pieces of one product. They are totals: "2 pieces
// = 99" means two pieces cost 99 together, so the second one adds 40 when one
// piece is 59. The price for 4 pieces also sets what every piece after the
// fourth adds (4 pieces = 169 after 3 pieces = 139 means 30 for each more).
// An empty step simply carries on with what the piece before it added.
export type Offer = { price2: number | null; price3: number | null; price4: number | null };

const cents = (value: number) => Math.round(value * 100);

// What the 1st, 2nd, 3rd and 4th piece each add, in cents.
function steps(one: number, offer: Offer) {
  const added = [cents(one)];
  let total = added[0];
  for (const set of [offer.price2, offer.price3, offer.price4]) {
    const step = set === null ? added[added.length - 1] : Math.max(0, cents(set) - total);
    added.push(step);
    total += step;
  }
  return added;
}

// What the piece in this position (1 = first) adds to the bill.
export function pieceCost(one: number, offer: Offer, position: number) {
  const added = steps(one, offer);
  return added[Math.min(position, 4) - 1] / 100;
}

// What this many pieces cost together.
export function offerTotal(one: number, offer: Offer, pieces: number) {
  const added = steps(one, offer);
  let total = 0;
  for (let position = 1; position <= pieces; position++) total += added[Math.min(position, 4) - 1];
  return total / 100;
}

// True when any multi-piece price is set.
export const hasOffer = (offer: Offer) =>
  offer.price2 !== null || offer.price3 !== null || offer.price4 !== null;
