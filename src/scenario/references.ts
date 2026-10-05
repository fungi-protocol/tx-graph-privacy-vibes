// The works the tour cites, in one place: the steps link to an entry by
// key (cite); the references panel and the tour's last step list them
// all (referencesHtml).
export interface Reference {
  authors: string;
  title: string;
  year: number;
  url: string;
  /** what the linked copy is, when the title alone would mislead */
  note?: string;
}

export const REFERENCES = {
  bip69: {
    authors: "K. Atlas",
    title: "BIP 69: Lexicographical Indexing of Transaction Inputs and Outputs",
    year: 2015,
    url: "https://github.com/bitcoin/bips/blob/master/bip-0069.mediawiki",
  },
  nakamoto: {
    authors: "S. Nakamoto",
    title: "Bitcoin: A Peer-to-Peer Electronic Cash System",
    year: 2008,
    url: "https://bitcoin.org/bitcoin.pdf",
    note: "§10, Privacy",
  },
  meiklejohn: {
    authors: "S. Meiklejohn, M. Pomarole, G. Jordan, K. Levchenko, D. McCoy, G. M. Voelker, S. Savage",
    title: "A Fistful of Bitcoins: Characterizing Payments Among Men with No Names",
    year: 2013,
    url: "https://cseweb.ucsd.edu/~smeiklejohn/files/imc13.pdf",
  },
  androulaki: {
    authors: "E. Androulaki, G. Karame, M. Roeschlin, T. Scherer, S. Capkun",
    title: "Evaluating User Privacy in Bitcoin",
    year: 2012,
    url: "https://eprint.iacr.org/2012/596",
  },
  moserNarayanan: {
    authors: "M. Möser, A. Narayanan",
    title: "Resurrecting Address Clustering in Bitcoin",
    year: 2022,
    url: "https://arxiv.org/abs/2107.05749",
  },
  kappos: {
    authors: "G. Kappos, H. Yousaf, R. Stütz, S. Rollet, B. Haslhofer, S. Meiklejohn",
    title: "How to Peel a Million: Validating and Expanding Bitcoin Clusters",
    year: 2022,
    url: "https://arxiv.org/abs/2205.13882",
  },
  ghesmati: {
    authors: "S. Ghesmati, A. Kern, A. Judmayer, N. Stifter, E. Weippl",
    title: "Unnecessary Input Heuristics & PayJoin Transactions",
    year: 2022,
    url: "https://eprint.iacr.org/2022/589",
  },
  nsNetflix: {
    authors: "A. Narayanan, V. Shmatikov",
    title: "Robust De-anonymization of Large Sparse Datasets",
    year: 2008,
    url: "https://arxiv.org/abs/cs/0610105",
    note: "the arXiv version is titled How To Break Anonymity of the Netflix Prize Dataset",
  },
  nsSocial: {
    authors: "A. Narayanan, V. Shmatikov",
    title: "De-anonymizing Social Networks",
    year: 2009,
    url: "https://arxiv.org/abs/0903.3276",
  },
  maurer: {
    authors: "F. K. Maurer, T. Neudecker, M. Florian",
    title: "Anonymous CoinJoin Transactions with Arbitrary Values",
    year: 2017,
    url: "https://www.comsys.rwth-aachen.de/publication/2017/2017_maurer_anonymous-coin-join-transactions-with/2017_maurer_anonymous-coin-join-transactions-with.pdf",
  },
  boltzmann: {
    authors: "LaurentMT",
    title: "Bitcoin Transactions & Privacy (part 2)",
    year: 2015,
    url: "https://gist.github.com/LaurentMT/d361bca6dc52868573a2",
    note: "the link-probability matrix behind Boltzmann",
  },
  kelenSeres: {
    authors: "D. M. Kelen, I. A. Seres",
    title: "Towards Measuring the Traceability of Cryptocurrencies",
    year: 2022,
    url: "https://arxiv.org/abs/2211.04259",
  },
  goldfeder: {
    authors: "S. Goldfeder, H. Kalodner, D. Reisman, A. Narayanan",
    title: "When the Cookie Meets the Blockchain: Privacy Risks of Web Payments via Cryptocurrencies",
    year: 2018,
    url: "https://arxiv.org/abs/1708.04748",
  },
} satisfies Record<string, Reference>;

export type RefKey = keyof typeof REFERENCES;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** an in-text citation: a plain click opens the references panel on the
 *  entry; the href is the work itself, for a new tab or a copied link */
export function cite(key: RefKey, text: string): string {
  return `<a class="cite" data-ref="${key}" href="${REFERENCES[key].url}" target="_blank" rel="noopener">${text}</a>`;
}

export function referencesHtml(): string {
  const refs: Record<string, Reference> = REFERENCES;
  return `<ol class="refs">${Object.entries(refs).map(([key, r]) =>
    `<li data-ref="${key}">${esc(r.authors)}.
      <a href="${r.url}" target="_blank" rel="noopener">${esc(r.title)}</a>, ${r.year}.${
      r.note ? ` <span class="refnote">${esc(r.note)}</span>` : ""}</li>`).join("")}</ol>`;
}
