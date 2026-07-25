# Drives the built page through the whole tutorial in headless chromium.
# Runs inside the NixOS VM check (checks.<linux>.browser); expects the app
# served at http://127.0.0.1:8000/ and playwright's browsers preinstalled
# via PLAYWRIGHT_BROWSERS_PATH.
import sys

from playwright.sync_api import sync_playwright

MUST_SEE = [
    # one landmark per tutorial chapter: reaching all of them means the
    # arc played end to end, fast-forwards and scripted moments included
    "Meet Alice",
    "Two drawings, one graph",
    "The neighborhood",
    "The observer's map",
    "The neighborhood learns a trick",
    "Settling up",
    "Strangers share a transaction",
    "Two coins meet",
    "Take the controls",
    "The sandbox",
]


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto("http://127.0.0.1:8000/", wait_until="load")
        page.wait_for_timeout(1500)
        assert "coins remember" in page.title(), page.title()

        seen: list[str] = []
        for _ in range(80):  # 43 steps and generous slack
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
        page.locator("#stepday").click()
        page.wait_for_timeout(800)
        hud = page.locator("#hud").inner_text()
        day_after = int(hud.split("day ")[1].split(" ")[0].strip("·").strip())
        assert day_after == day_before + 1, f"{day_before} -> {day_after}"
        page.keyboard.press("v")
        page.wait_for_timeout(500)

        print(f"tutorial complete: {len(seen)} step titles, day {day_after}")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
