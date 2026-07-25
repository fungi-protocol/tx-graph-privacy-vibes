// Headless runner: exercises the deterministic core outside the browser and
// prints a digest. The determinism flake check pins its output at a golden
// seed; as the engine grows, its state gets folded into the digest so any
// accidental nondeterminism (or unintended behaviour change) trips the check.
import { Rng } from "../core/prng";
import { fnv1a } from "../core/digest";
import { Economy } from "./economy";

function main(): void {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--seed");
  const seed = i >= 0 ? argv[i + 1] ?? "golden" : "golden";

  const rng = new Rng(seed);
  const parts: string[] = [];
  for (let k = 0; k < 10_000; k++) parts.push(rng.u32().toString(36));
  const agents = rng.fork("agents");
  for (let k = 0; k < 100; k++) parts.push(String(agents.poisson(2.5)));

  // the full economy at the pinned seed: every transaction, coin value,
  // and event folds into the digest, so any behaviour change trips the check
  const eco = new Economy(seed);
  eco.runTo(130);
  const world = [eco.chain.describe(),
    ...eco.events.map((e) => `${e.day}/${e.tid}/${e.form}/${e.memo}`)];

  // wallet-shape characterization: execution realism means wallets hold a
  // spread of coins instead of collapsing into one endlessly peeled coin,
  // and some spends take more than one input — pinned so a regression in
  // coin selection trips the check like any other behaviour change
  const held = new Map<number, number>();
  for (const c of eco.chain.utxos()) {
    if (c.owner !== null) held.set(c.owner, (held.get(c.owner) ?? 0) + 1);
  }
  const sizes = [...held.values()].sort((a, b) => a - b);
  // collaborative forms take several inputs by design; the realism metric
  // is how often a plain one-payer spend does
  const unil = eco.events.filter((e) => e.form === "unilateral" && !e.memo.startsWith("batch"));
  const multi = unil.filter((e) => eco.chain.txs.get(e.tid)!.inputs.length >= 2).length;

  console.log(`seed ${seed}`);
  console.log(`rng-digest ${fnv1a(parts.join(","))}`);
  console.log(`economy-digest day ${eco.day} txs ${eco.chain.order.length} ${fnv1a(world.join(";"))}`);
  console.log(`wallets min ${sizes[0]} median ${sizes[Math.floor(sizes.length / 2)]} multi-input spends ${multi}/${unil.length}`);
}

main();
