# Drives the built page through the whole tutorial in headless chromium.
# Runs inside the NixOS VM check (checks.<linux>.browser); expects the app
# served at http://127.0.0.1:8000/ and playwright's browsers preinstalled
# via PLAYWRIGHT_BROWSERS_PATH.
import sys

from playwright.sync_api import sync_playwright

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
    "Settling up",  # net settlement
    "The shape remains",  # ns-social
    "Strangers share a transaction",  # coinjoin
    "Two coins meet",  # intersection attacks
    "Judy's rent, many ways",  # synthesis
    "Rent day",  # the game
    "The sandbox",  # finale
]


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
        page.keyboard.press("c")  # collapse: clustered chord ring
        page.wait_for_timeout(1200)
        # the layout picker is segmented (#140): uncurl to the band,
        # then the force map, then back to the ring
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
        print(f"tutorial complete: {len(seen)} step titles, day {day_after}")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
