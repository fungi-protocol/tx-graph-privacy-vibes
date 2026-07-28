# Drives the built page through the knob matrix (#141 slice 4e) at a
# desktop and a mobile viewport: a scripted walk covering every
# single-knob gesture from several states — view morphs both ways,
# arrangement glides, contractions under ltr/force, the ring, the
# singleton ring, the ns-social replay open/close — asserting the knob
# row's DOM state after each settle and that no page errors fire.
#
# Every transition is captured twice: the t=-1 frame (the pre-click
# settled state — the first post-click frame already hides a jump cut)
# and the settled destination. The captures under /tmp/shots are
# REVIEWABLE ARTIFACTS the VM check copies out; they are never compared
# pixelwise (chromium/font pins make image diffs flake) — assertions
# run against the DOM state only.
#
# Runs inside the NixOS VM check (checks.<linux>.browser-knobs);
# expects the app at http://127.0.0.1:8000/ and playwright's browsers
# preinstalled via PLAYWRIGHT_BROWSERS_PATH.
import os
import sys

from playwright.sync_api import sync_playwright

SHOTS = "/tmp/shots"

# label, gesture, settle ms, expected knob row after the settle:
# (view seg, layout seg, clusters checked, chord segment visible).
# The walk starts at the boot state (cards) with the tour skipped, so
# every control is revealed. Expectations recorded against the built
# page; the chord segment shows only while the map is contracted, the
# clusters checkbox only in the graph view, and grouping does NOT
# survive an exit through cards (viewStateOf(CARDS) reads unclustered).
WALK = [
    ("morph-to-graph",     "graph",   4000, ("graph", "ltr",   False, False)),
    ("rearrange-force",    "force",   3500, ("graph", "force", False, False)),
    ("contract-force-map", "check",   7000, ("graph", "force", True,  True)),
    ("map-to-band",        "ltr",     4500, ("graph", "ltr",   True,  True)),
    ("band-to-ring",       "chord",   4500, ("graph", "chord", True,  True)),
    ("ring-uncluster",     "uncheck", 4500, ("graph", "chord", False, True)),
    ("ring-recluster",     "check",   4500, ("graph", "chord", True,  True)),
    ("ns-open",            "ns",      5000, ("graph", "chord", True,  True)),
    ("ns-close",           "ns",      4000, ("graph", "chord", True,  True)),
    ("uncurl-force-map",   "force",   4500, ("graph", "force", True,  True)),
    ("exit-to-cards",      "cards",   7000, ("cards", "force", False, False)),
    ("re-enter-graph",     "graph",   7000, ("graph", "force", False, False)),
    ("to-ltr",             "ltr",     3500, ("graph", "ltr",   False, False)),
    ("contract-band",      "check",   6000, ("graph", "ltr",   True,  True)),
    ("band-uncluster",     "uncheck", 4500, ("graph", "ltr",   False, False)),
    ("exit-plain",         "cards",   5000, ("cards", "ltr",   False, False)),
]

# gestures land at the DOM level: checkbox inputs sit under styled
# labels that defeat playwright's actionability wait, and the seg
# buttons are driven the same way so the walk's timing is uniform
ACTIONS = {
    "graph": "document.querySelector('#viewtoggle button[data-v=\"graph\"]').click()",
    "cards": "document.querySelector('#viewtoggle button[data-v=\"cards\"]').click()",
    "ltr": "document.querySelector('#layoutbtn button[data-l=\"ltr\"]').click()",
    "force": "document.querySelector('#layoutbtn button[data-l=\"force\"]').click()",
    "chord": "document.querySelector('#layoutbtn button[data-l=\"chord\"]').click()",
    "check": "{const c = document.getElementById('groupcheck'); if (!c.checked) c.click()}",
    "uncheck": "{const c = document.getElementById('groupcheck'); if (c.checked) c.click()}",
    "ns": "document.getElementById('nssoc').click()",
}

KNOBS_JS = """() => {
  const on = sel => {
    const b = document.querySelector(sel + '.on');
    return b ? (b.dataset.v ?? b.dataset.l) : null;
  };
  return [
    on('#viewtoggle button'), on('#layoutbtn button'),
    document.getElementById('groupcheck').checked,
    getComputedStyle(document.querySelector('#layoutbtn button[data-l="chord"]')).display !== 'none',
  ];
}"""

VIEWPORTS = [
    ("desktop", {"width": 1400, "height": 900}),
    ("mobile", {"width": 375, "height": 812}),
]


def drive(browser, name: str, viewport: dict) -> None:
    page = browser.new_page(viewport=viewport)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8000/", wait_until="load")
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="skip the tour").first.click()
    page.wait_for_timeout(1500)

    shots = os.path.join(SHOTS, name)
    os.makedirs(shots, exist_ok=True)
    for i, (label, act, settle, expect) in enumerate(WALK):
        page.screenshot(path=f"{shots}/{i:02d}-{label}-pre.png")  # t=-1
        page.evaluate(ACTIONS[act])
        page.wait_for_timeout(settle)
        page.screenshot(path=f"{shots}/{i:02d}-{label}-post.png")
        got = tuple(page.evaluate(KNOBS_JS))
        assert got == expect, f"{name}/{label}: knobs {got}, expected {expect}"
        assert not errors, f"{name}/{label}: page errors {errors}"
    print(f"{name}: {len(WALK)} transitions clean")
    page.close()


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        for name, viewport in VIEWPORTS:
            drive(browser, name, viewport)
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
