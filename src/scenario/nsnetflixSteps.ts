// Chapter 4½ (#112): behavioral matching, right after the fingerprint
// steps — because it is their next generalization. The fingerprint
// check read a wallet's habits off single coins and single
// transactions; this chapter aggregates the same public habits over a
// cluster's whole record into a feature vector, and matches clusters
// whose vectors agree. That is the Narayanan–Shmatikov statistical
// de-anonymization (the Netflix-prize paper) retold on the cluster
// graph, and it is stronger than exact fingerprint comparison
// precisely where fingerprints are similar but not identical: a
// vector tolerates noise a rule cannot. Matches are accepted through
// the shared gate (matching.ts): both clusters must pick each other,
// clear of every runner-up — contested or tied candidates stay
// unmatched. The chapter displays the live run's own match count
// rather than asserting one, and closes on the honest limits: scores
// measure resemblance, not identity, and a wrong match links
// strangers' histories exactly as a wrong change guess did.
import { type TutorialStep, type Rect } from "../ui/tutorial";

/** what the live run did, resolved by the caller: how many matches the
 *  behavioral matcher accepted, at which similarity threshold */
export interface NfRunView {
  matches: number;
  threshold: number;
}

export function nsNetflixSteps(
  clusterBounds: () => Rect,
  run: () => NfRunView,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "a-fingerprint-for-a-cluster",
      title: "A cluster's fingerprint",
      html: `<p>The last two steps read a wallet's habits off a single
        transaction. But habits belong to the <b>wallet</b>, and the
        wallet builds everything its owner spends — so the same habits
        repeat across a cluster's whole record. Collapse the map and
        take stock of what each cluster shows in public: the amounts it
        moves and when, its time-of-day rhythm, the fees it bids —
        outright, and against the day's going rate — the script types
        its coins sit on, the nLockTime its drafts carry, how its
        signatures are sized.</p>
        <p>Gather those into one profile per cluster — a <b>feature
        vector</b> — and something turns around: clustering, the
        observer's own artifact, stops diluting the evidence and starts
        <b>concentrating</b> it. Every transaction a cluster gains makes
        its profile sharper. A cluster with almost no spends is the
        exception — one data point is a coincidence, not a habit, and
        the analysis will refuse to lean on it.</p>`,
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      nf: true,
      scene: 1,
      minDay: 55,
    },
    {
      id: "matching-the-profiles",
      title: "Matching the profiles",
      html: () => {
        const r = run();
        const count = r.matches === 0
          ? `accepted <b>nothing</b> this run — abstaining is a real
            outcome, not a failure of the method`
          : `accepted <b>${r.matches} ${r.matches === 1 ? "match" : "matches"}</b> this run`;
        return `<p>Now compare the profiles <i>between</i> clusters
        (Narayanan&nbsp;&amp;&nbsp;Shmatikov again — their Netflix-prize
        result, retold on this map). Two clusters that are really one
        user's wallet wear the same habits, so their vectors agree; the
        teal links are the pairs whose agreement clears the panel's
        threshold, currently ${r.threshold.toFixed(2)}. A link is an
        ownership claim — "these two pseudonyms are one user" — and
        accepting it <b>merges</b> the clusters.</p>
        <p>Acceptance is deliberately strict: a pair is taken only when
        each cluster is the <b>other's</b> closest counterpart, and
        clearly ahead of every runner-up. A contested best — two
        candidates that fit equally well — is left unmatched rather
        than guessed at. Under that rule the matcher ${count}.</p>
        <p>Note what this buys over the last steps' rule-reading. A rule
        like "two script types means two wallets" needs the fingerprints
        to differ <i>exactly</i>; profiles trade agreement by degree, so
        they still separate — or match — wallets whose habits are
        <b>similar but not identical</b>. And no names were consulted:
        the vectors match pseudonyms to pseudonyms, straight off the
        public record.</p>`;
      },
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      nf: true,
      scene: 1,
      minDay: 55,
    },
    {
      id: "similar-not-the-same",
      title: "Similar, not the same",
      html: `<p>The honesty that came with every heuristic applies with
        extra force here. The score measures <b>resemblance, not
        identity</b>: two strangers who bought the same wallet product
        and keep similar hours genuinely look alike, and a match between
        them links two histories that never touched — the same mistake a
        wrong change guess made, at cluster scale. The strict acceptance
        rule spends the opposite error to avoid it: where candidates
        crowd together, the matcher stays silent, and real pairs go
        unclaimed. Which error to prefer is the observer's choice, not
        the record's.</p>
        <p>What should stay with you is the direction of travel. Amounts
        could be folded away, and the coming chapters fold away more —
        but <b>behavior travels with the user</b>, not with the coin.
        Every defense this story builds from here changes what
        transactions look like; none of it changes when their author
        wakes up, what fees they tolerate, or which software they run.
        The profiles are waiting on whatever the record still
        shows.</p>`,
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      nf: true,
      scene: 1,
      minDay: 55,
    },
  ];
}
