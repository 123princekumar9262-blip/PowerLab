/**
 * The browser suites test the full workspace. A lab's first visit shows only its essentials (a setting,
 * on by default); this switches it off in every page the suite opens, before any script of the app runs.
 * The essentials view itself is checked in smoke-workspace.mjs, on a page opened without this helper.
 */
export function fullWorkspace(browser) {
  const newPage = browser.newPage.bind(browser)
  const newContext = browser.newContext.bind(browser)
  const init = (target) =>
    target.addInitScript(() => {
      try {
        if (!localStorage.getItem('pel.essentials')) localStorage.setItem('pel.essentials', '"off"')
      } catch {
        /* storage blocked: the app shows the full workspace anyway */
      }
    })
  browser.newPage = async (o) => {
    const p = await newPage(o)
    await init(p)
    return p
  }
  browser.newContext = async (o) => {
    const c = await newContext(o)
    await init(c)
    return c
  }
  return browser
}
