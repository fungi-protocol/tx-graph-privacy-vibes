# coins remember — a transaction graph privacy simulator

**A vibe-coded educational aid**, written by an AI agent (Claude) under
human direction and review. It illustrates how bitcoin transaction-graph
privacy works on a deliberately tiny, simplified model economy; nothing
here has been audited, and its numbers describe the toy town, not the
real Bitcoin network.

## What it is

A single-file, browser-based, seeded simulation of a small town paying
each other in bitcoin, built as an interactive companion to a writeup on
collaborative transaction privacy. You watch the transaction graph grow,
switch between an all-seeing view, a chain-analyst's view (common-input
clustering and change heuristics), and a participant's view — and see
what each observer can justify believing.

The guided tour builds the ideas up in order:

- what a transaction, a coin (UTXO), and change are;
- how an observer clusters coins (common-input-ownership, change
  detection) and contracts the graph into a user graph;
- how a payjoin feeds that clustering false premises — while the
  counterparty still knows everything;
- how net settlement hides amounts from outsiders — while insiders can
  solve the edge they are not on;
- how a coinjoin with denominated outputs leaves every observer with
  many plausible readings of which coins funded which outputs;
- how tracing several coins together (intersection) collapses that
  ambiguity again.

## Running it

The deliverable is one self-contained HTML file, with no runtime
dependencies and no network access:

```bash
nix build
open result/index.html
```

Development currently uses only nixpkgs-provided tools (TypeScript,
esbuild, node). That is a starting point, not a rule: dependencies are
welcome where a well-maintained library earns its keep, as long as the
build stays reproducible — pinned by a lockfile and building in the Nix
sandbox without network access.

```bash
nix develop        # toolchain shell
nix flake check    # typecheck, unit tests, determinism, build
```

Everything is deterministic from the seed: share links (right-click →
copy a reference) reproduce the exact state, view, and selection you are
looking at.
