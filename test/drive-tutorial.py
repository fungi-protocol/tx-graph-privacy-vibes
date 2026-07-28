# Drives the built page through the whole tutorial in headless chromium.
# Runs inside the NixOS VM check (checks.<linux>.browser); expects the app
# served at http://127.0.0.1:8000/ and playwright's browsers preinstalled
# via PLAYWRIGHT_BROWSERS_PATH.
import re
import sys

from playwright.sync_api import expect, sync_playwright

MUST_SEE = [
    # one landmark per tutorial chapter, in play order: reaching all of
    # them means the arc played end to end, fast-forwards and scripted
    # moments included
    "Meet Alice",  # intro (cards)
    "Two drawings, one graph",  # intro (graph bridge)
    "The neighborhood",  # the economy
    "The observer's map",  # clustering heuristics
    "A transaction built by two people",  # payjoin
    "A cluster's fingerprint",  # ns-netflix
    "Watch the matches land",  # ns-netflix replay (#26)
    "Settling up",  # net settlement
    "The shape remains",  # ns-social
    "Watch the run",  # ns-social replay modal (#11b)
    "Strangers share a transaction",  # coinjoin
    "Two coins meet",  # intersection attacks
    "Judy's rent, many ways",  # synthesis
    "Rent day",  # the game
    "The sandbox",  # finale
]

CHORD_BTN = '#layoutbtn button[data-l="chord"]'
# the reveal schedule (#116 / #141 slice 6), asserted at the steps that
# introduce each control: True = must be visible by this step, False =
# must still be hidden when it lands. Reveals are monotonic, so a False
# here means the walked path never staged the control before this step.
STAGED: dict[str, dict[str, bool]] = {
    # everything starts hidden
    "Meet Alice": {"#viewtoggle": False, "#layoutbtn": False, "#lens": False,
                   "#groupingbtn": False, "#castbtn": False, "#paramsbtn": False},
    # the bipartite slide introduces the view + layout knobs (no chord)
    "Two drawings, one graph": {"#viewtoggle": True, "#layoutbtn": True,
                                CHORD_BTN: False, "#lens": False,
                                "#groupingbtn": False, "#castbtn": False},
    # the cast panel appears with the step that names it
    "The neighborhood": {"#castbtn": True, "#paramsbtn": False, "#lens": False},
    # the first step through other eyes stages the lens cycler
    "The observer's map": {"#lens": True, CHORD_BTN: False, "#groupingbtn": False},
    # the ring's introduction stages the chord position only
    "A timeline on a circle": {CHORD_BTN: True, "#groupingbtn": False},
    # the stacking step stages the grouping checkbox
    "Shrinking the map": {"#groupingbtn": True},
    # the finale hands over the params panel
    "The sandbox": {"#paramsbtn": True},
}


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://127.0.0.1:8000/", wait_until="load")
        page.wait_for_timeout(1500)
        assert "transaction privacy vibes" in page.title(), page.title()

        seen: list[str] = []
        for _ in range(110):  # 75 steps and generous slack
            title = page.locator(".tut-title").first.inner_text().strip()
            if not seen or seen[-1] != title:
                seen.append(title)
                # the previous step opened the ns replay modal; landing
                # anywhere else must have closed it and unlocked the tape
                if len(seen) >= 2 and seen[-2] == "Watch the run":
                    expect(page.locator("#nextday")).to_be_enabled(timeout=20000)
                # the reveal-schedule knob matrix (#14): staged controls
                # visible from their introducing step on, hidden before.
                # Visible waits out the journey (the chord button also
                # gates on the map being contracted); hidden is sync
                for sel, on in STAGED.get(title, {}).items():
                    if on:
                        expect(page.locator(sel)).to_be_visible(timeout=12000)
                    else:
                        expect(page.locator(sel)).to_be_hidden()
                # #31: the coinjoin counterfactual step stays in card mode
                if title == "Many plausible pasts":
                    expect(page.locator('#viewtoggle button[data-v="cards"]'))\
                        .to_have_class(re.compile(r"\bon\b"), timeout=8000)
                # #11b: the step enters the ns replay modal on its own —
                # the tape locks while the epoch columns are up
                if title == "Watch the run":
                    expect(page.locator("#nextday")).to_be_disabled(timeout=25000)
                # #26: the step replays the greedy matching in place
                if title == "Watch the matches land":
                    if int(page.locator("#nfprog").get_attribute("max") or "0") > 0:
                        expect(page.locator("#nsnfplay")).to_have_text("pause", timeout=20000)
            done = page.get_by_role("button", name="done ✓")
            if done.count() > 0 and done.first.is_visible():
                break
            page.get_by_role("button", name="next →").first.click()
            page.wait_for_timeout(900)  # animations + fast-forwarded days
        else:
            raise AssertionError(f"tutorial never finished; saw {seen}")

        missing = [m for m in MUST_SEE if m not in seen]
        assert not missing, f"chapters never reached: {missing}; saw {seen}"

        # close the tour, then poke the live app: step a day, flip the view
        page.get_by_role("button", name="done ✓").first.click()
        page.wait_for_timeout(500)
        hud = page.locator("#hud").inner_text()
        assert "seed " in hud and "day " in hud, hud
        day_before = int(hud.split("day ")[1].split(" ")[0].strip("·").strip())
        page.locator("#nextday").click()
        page.wait_for_timeout(800)
        hud = page.locator("#hud").inner_text()
        day_after = int(hud.split("day ")[1].split(" ")[0].strip("·").strip())
        assert day_after == day_before + 1, f"{day_before} -> {day_after}"
        page.keyboard.press("v")
        page.wait_for_timeout(500)

        # exercise the strand-interpolated repartitions (#129): collapse
        # to the contracted map, cycle the arrangements (chord ring ->
        # band -> force map), toggle clustered/unclustered, and bring up
        # the ns-social columns — each transition must animate without a
        # page error
        # land in the graph view deterministically (the "v" above was a
        # blind flip and may have put cards up), then contract via the
        # clusters checkbox: 'c' only speaks in the graph view since
        # #141 slice 4d, and the chord segment renders only while the
        # map is contracted, so the checkbox must go first
        page.evaluate("document.querySelector('#viewtoggle button[data-v=\"graph\"]').click()")
        page.wait_for_timeout(1500)
        page.evaluate(
            "const c = document.getElementById('groupcheck');"
            "if (!c.checked) c.click()"
        )  # clustered band (ltr)
        page.wait_for_timeout(1200)
        # the layout picker is segmented (#140): the band, then the
        # force map, then curl up into the ring
        for seg in ("ltr", "force", "chord"):
            page.locator(f'#layoutbtn button[data-l="{seg}"]').click()
            page.wait_for_timeout(1200)
        # grouping is a checkbox (#141 slice 4d) that composes with the
        # layout: unchecking on the ring repartitions to the singleton
        # ring, rechecking walks back up the lattice — toggle it at the
        # DOM level (the label styling defeats the actionability wait)
        page.evaluate("document.getElementById('groupcheck').click()")  # singleton ring
        page.wait_for_timeout(1200)
        page.evaluate("document.getElementById('groupcheck').click()")  # clustered again
        page.wait_for_timeout(1200)
        # the checkbox input is styled (label covers it), so playwright's
        # actionability wait never passes — toggle it at the DOM level
        page.evaluate("document.getElementById('nssoc').click()")  # columns
        page.wait_for_timeout(2500)  # worker run + column transition
        page.evaluate("document.getElementById('nssoc').click()")  # back off
        page.wait_for_timeout(1200)

        assert not errors, f"page errors: {errors}"

        # #23: a mobile-viewport pass over the opening chapters — the
        # tour panel must stay inside the viewport and the next button
        # must stay reachable at every step (clamped scrollable body,
        # #78; corner layout, #72)
        mobile = browser.new_page(viewport={"width": 375, "height": 812})
        merrors: list[str] = []
        mobile.on("pageerror", lambda e: merrors.append(str(e)))
        mobile.goto("http://127.0.0.1:8000/", wait_until="load")
        mobile.wait_for_timeout(1500)
        for _ in range(25):
            nxt = mobile.get_by_role("button", name="next →").first
            expect(nxt).to_be_visible()
            bb = nxt.bounding_box()
            assert bb is not None
            assert bb["x"] >= -1 and bb["y"] >= -1, bb
            assert bb["x"] + bb["width"] <= 376, bb
            assert bb["y"] + bb["height"] <= 813, bb
            tb = mobile.locator("#tutorial").bounding_box()
            assert tb is not None
            assert tb["y"] >= -1 and tb["y"] + tb["height"] <= 813, tb
            assert tb["x"] >= -1 and tb["x"] + tb["width"] <= 376, tb
            nxt.click()
            mobile.wait_for_timeout(700)
        assert not merrors, f"mobile page errors: {merrors}"
        mobile.close()

        print(f"tutorial complete: {len(seen)} step titles, day {day_after}")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
