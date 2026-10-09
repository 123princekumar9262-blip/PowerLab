# Workspace shell — Phase 2 plan

Status: **Approved and implemented for Buck (Phase 2).** Rectifiers and the other labs are unchanged.
**Phase 3 (Rectifier migration): approved and implemented — see "Phase 3 — as built" at the end.**
**Phase 4 (stabilization + UX simplification): implemented — see "Phase 4 — as built".**
**Phase 5 (every lab in the shell): implemented — see "Phase 5 — as built" at the very end.** The app targets laptops (1024 px and up).

Approved decisions:
- **Actions:** the action bar sits under the circuit and status line on desktop and tablets, and is a
  sticky compact bar on phones.
- **Overlays:** non-blocking docks/drawers on desktop/tablet; modal, focus-trapped bottom sheets on phones,
  with the page behind them made `inert`.
- **Buck parameters:** Basic is Vin, fs, D, R; L and C are under Advanced, with unchanged values and
  lessons.
- **Numbers on the circuit:** shown only at the Engineer level.
- **Next consequence:** from the run's own next event; it is null when there is none.

## As built (Phase 2)

- **`src/workspace/`**
  - `WorkspaceShell.tsx` — regions, `WorkspaceHeader`, `ActionBar`, `Overlay` (dock / drawer / sheet),
    `usePresentation` (≥ 1024 desktop · 768–1023 tablet · < 768 phone).
  - `useTopicWorkspace.ts` — the single state: params → one run → measurements; one master cursor → state,
    view, status, WHY, next consequence. Parameter edits are deferred; cursor moves only re-read the run.
  - `panels.tsx` — ParameterPanel, CircuitView, StatusLine, WaveformPanel, WhyView, InspectView,
    EventsView, AnalyzeView (+ pure `categoryRows` / `visibleCategories`).
  - `TopicShell.tsx` — the adapter from any `Topic` to the shell.
- **`Topic` gains optional fields:** `status`, `next`, `analysis` (categories) and `parts`. Labs that don't
  set them are untouched.
- **Buck** (`buckShellTopic()` in `src/topics/dcdc.tsx`): the same simulator, with:
  - Basic/Advanced lists and the default channels Gate, Vout, iL;
  - the status line and next consequence (`dcdcStatus`, `dcdcNext` in `converters/dcdc/explain.ts` —
    wording only);
  - Analyze categories (Overview, Output, Current, Ripple, Power, Efficiency, Device stress, Theory vs
    Simulation) built from existing measurements only;
  - an inspector that adds "State now" (storing/releasing, charging/discharging) from the simulated power;
  - `DcdcDiagram minimal`: no duplicate caption, no live numbers below Engineer.
- **Routing:**
  - The catalogue flag `workspace: 'shell'` on `dc-dc/buck` sends that route to the shell.
  - Boost and Buck-boost keep the lab shell.
  - The lab shell's Buck tab, and the shell's "Change circuit ▾" menu, navigate between them by address.
- **Tests and size:**
  - Tests: `tests/workspace.test.ts` (9) and `scripts/smoke-workspace.mjs` (102 checks, six widths).
  - `smoke-dcdc`'s Buck section was rewritten for the shell, with the same physics assertions.
  - Bundle: Home +0.17 kB gzipped. Opening Buck loads about +9 kB gzipped more than before (the shell is
    lazy).

---

## Original plan (as approved)
Goal: one reusable simulation workspace that every lab can use. **Buck** is the reference
implementation. No physics changes, no new topologies, no migration of the other labs in this phase.

---

## 0. Findings that shape the plan

1. **Buck already exists and is real.** `dcdcTopic('buck')` (`src/topics/dcdc.tsx`) runs the validated
   netlist engine (shooting steady state, start-up view). It is covered by 55 buck tests and 78
   DC-DC tests. It already has:
   - lessons (2), experiments (5), predictions;
   - exact + textbook theory (12 compare rows);
   - a component inspector (`dcdcInspect`), an energy view (`DcdcEnergy`), stress/losses
     (`DcdcStress`), a duty sweep and a derivation;
   - a circuit with selectable parts and a simulation-driven current path (`DcdcDiagram`, fed by
     `DcdcState.path`).

   **So Buck integrates the actual simulator — no placeholder, no fabricated data.**
2. **The adapter boundary already exists for nine labs.** The `Topic` interface (`src/lab/types.ts`)
   is a configuration object:
   - simulate, measure, state, view, why;
   - Diagram, channels, defaultChannels, addOrder;
   - inspect, energy, analyze, lessons, experiments, predictions, eventLabel/eventWhy.

   It already separates *simulation → state → presentation*. The shell will consume it rather than
   invent a second adapter.
3. **The layout is the problem, not the data.** `LabShell` (502 lines) is one component that owns
   both the state logic and a fixed three-column layout. In that layout:
   - the right column stacks the mode panel, an event card, the state card, a badge, and tabs
     Why / Energy / Inspect;
   - Analyze is a *mode* that appends a table under the scope;
   - Current path is a checkbox;
   - the phone layout simply stacks everything (a 2,484 px page at 390 px).
4. **The rectifier lab is the outlier.** `App.tsx` (760 lines) has its own reducer (`labState.ts`),
   modes hook, scope (`Scope.tsx`), drawers (`ui/Drawer.tsx`) and Focus mode. It can be plugged in
   later through the same *slots* without touching its physics (§8).

---

## 1. Existing workspace architecture

```
WorkspacePage (Phase 1 shell: route → lazy workspace, Continue/Recent reporting)
 ├─ rectifiers  → App.tsx ─ labReducer · useModes · Header · ParameterPanel · CircuitDiagram/ThreePhaseDiagram
 │                         · Scope + Transport + ChannelBar · right tabs (State/Why/Learn/Energy)
 │                         · Drawers (path, why, energy, inspect, event, measure, theory) · Focus · Lens
 └─ 9 other labs → topicWorkspace → LabShell → TopicLab
                    state:  params (paramStore) → simulate → Run → measure → cursor → state → view/why
                    layout: dc-top (lab, topic tabs, modes incl. Analyze, level)
                            dc-lab grid 280px | 1fr | 360px
                              left   SpecList (basic) + view toggle + Reset + <details> advanced
                              centre Diagram card (+ "Show current path" checkbox) · LabScope (+ channel chips)
                              right  mode panel · event card · StateCard · badge · tabs Why/Energy/Inspect
                            Analyze mode: AnalyzePanel under the scope
```

| Concern | Today (LabShell) | Problem |
|---|---|---|
| Simulation state | one `Run` per params (memo); one `cursorTime`; derived `k`, `st`, `cards` | ✓ already one source — keep |
| Header | lab · topic tabs · 5 modes (incl. Analyze) · level | Analyze is a mode; no back link inside (the Phase 1 bar provides it) |
| Parameters | basic list + advanced `<details>` | Buck's "basic" holds six controls (L and C included) |
| State | `StateCard` always visible, 15 rows at Engineer | competes with WHY; duplicated by circuit labels |
| Status | none (the badge card plays this role, partly) | no one-line "what is happening" |
| WHY | side tab | fine; needs a "next consequence" slot |
| Inspect | side tab | should be a drawer opened from the circuit |
| Energy | side tab (topic.energy) | fine as a context tab |
| Analyze | mode, unstructured (Measurements / Theory / extra tabs / Numerics) | must become an action-bar sheet with categories |
| Events | markers + an event card in the right column | should be a drawer listing events; click → cursor |
| Current path | checkbox above the circuit | should be an action |
| Mobile | stacked columns | 2,484 px page; parameters far below |

---

## 2. Components to reuse (unchanged)

| Component | From | Role in the new shell |
|---|---|---|
| `LabScope` | components/lab | the waveform panel's plot (canvas, master cursor, event markers, zoom, lanes) |
| `SpecList` | components/lab/ParamsPanel | renders a list of `ParamSpec` inside the parameter panel |
| `StateCard` rows logic | components/lab/Panels | State tab body (level-filtered rows) |
| `WhyPanel` | components/lab/Panels | WHY tab body |
| `Inspector` | components/lab/Panels | Inspect drawer body |
| `LearnPanel`, `ExperimentPanel`, `PredictPanel` | components/lab/Modes | Learn tab / mode panels |
| `MeasureTable`, `Numerics` | components/lab/Analyze | Analyze → Theory vs Simulation |
| `DcdcDiagram`, `DcdcEnergy`, `DcdcStress`, `DcdcTheory`, `DcdcSweep`, `dcdcInspect` | components/dcdc | Buck's circuit, energy, device-stress, theory, sweep and inspector content |
| All Buck physics, measurements, explanations, lessons | converters/dcdc, converters/buck | untouched |
| Phase 1 `prefs` (information level), `progress` (Continue), router | shell/ | the workspace reads the level and reports activity as today |

---

## 3. Components to generalise

| Today | Becomes | How |
|---|---|---|
| `TopicLab`'s state logic (params, run, measure, cursor, channels, lesson, events) | `useTopicWorkspace(topic)` hook | pure state; returns one **workspace model** (§5). LabShell stays untouched until its labs migrate (no risk to 8 labs now) |
| "Show current path" checkbox | **Current path** action | toggles the circuit highlight; the drawer shows `view.path` |
| Analyze mode | **Analyze** sheet with categories | new optional `Topic.analysis` (§4.7); fallback to today's tabs for topics that don't declare categories |
| Inspect side tab | **Inspect** drawer | opened by clicking a part or the action; `topic.inspect()` content |
| Event card | **Events** drawer | lists `run.events` in the view; click → master cursor |
| Mode panel stacked in the right column | Context panel tab | Experiment / Predict show their panel as the first context tab; Learn shows the lesson in the Learn tab |
| `ui/Drawer` (rectifier) and LabShell side tabs | one `Overlay` component | side drawer (desktop) / bottom sheet (phone) |

---

## 4. New components (`src/workspace/`)

```
WorkspaceShell              layout only: regions, responsive presentation, overlay host. Knows no physics.
├── WorkspaceHeader         ← Back · LAB · Circuit ▾ (siblings) · ModeNav · level shortcut · Focus
├── ModeNav                 Explore · Learn · Experiment · Predict (+ Challenge · Reverse · Compare when the lab has them)
├── ParameterPanel          Basic · [Advanced parameters ▾] · view toggle · Reset   (drawer on phone)
├── CircuitView             frame around the topic's Diagram: selection → Inspect, path highlight
├── StatusLine              one line: "SWITCH ON · inductor charging · diode OFF"
├── ContextPanel            tabs State · Why · Learn · Energy (+ the mode's own tab)   (bottom sheet on phone)
├── WaveformPanel           LabScope + channel chips + [+ Add channel] (grouped by Voltage/Current/Control/Energy…)
├── ActionBar               Current path · WHY · Inspect · Analyze · Energy · Events
└── Overlay                 drawer / sheet host: focus management, Esc, return focus
    ├── InspectDrawer
    ├── AnalyzeSheet        Overview · Output · Current · Ripple · Power · Efficiency · Device stress · Theory vs Simulation
    ├── EventsDrawer
    └── PathDrawer
TopicWorkspaceV2            adapter: Topic + useTopicWorkspace → WorkspaceShell slots (Buck in Phase 2)
```

### 4.1 Shell contract (slot-based, physics-free)

```ts
interface WorkspaceShellProps {
  header: { back: { href: string; label: string }; lab: string; title: string
            siblings?: Array<{ id: string; label: string; href: string; current: boolean }>
            modes: Array<{ id: ModeId; label: string; href: string }>; mode: ModeId
            level: Level; onLevel(l: Level): void; focus: boolean; onFocus(on: boolean): void }
  params: ReactNode            // ParameterPanel
  circuit: ReactNode           // CircuitView(Diagram)
  status: ReactNode            // StatusLine
  context: { tabs: Array<{ id: string; label: string; render(): ReactNode }>; active: string; onTab(id: string): void }
  waveform: ReactNode          // WaveformPanel
  actions: Array<{ id: ActionId; label: string; pressed?: boolean; alert?: boolean; onClick(): void }>
  overlay: null | { id: string; title: string; kind: 'drawer' | 'sheet'; render(): ReactNode }
  onCloseOverlay(): void
}
```

The shell owns only presentation:
- the responsive regions;
- which overlay is open;
- the phone sheets;
- focus handling.

Any lab can fill the slots. The rectifier lab can fill them with its existing components (§8).

### 4.2 Header
- **Content:** `← DC-DC Converters`, then DC-DC CONVERTERS / **Buck converter ▾**, then the mode tabs.
- **Right side:** a small information-level control (writes the Phase 1 preference) and ◎ Focus.
- **Never in the header:** measurements, device states or parameters.
- **Topic switcher (▾)** lists the lab's ready topics and navigates by route. Boost and Buck-boost still
  open the current LabShell workspace in Phase 2 (§7).

### 4.3 Parameter panel
- **Basic:** only what operates the circuit. For Buck: Vin, fs, D and R.
- **Advanced parameters ▾** (closed by default; open by default at Engineer):
  - L and C;
  - device model, switch Ron, diode Vf and Ron;
  - inductor DCR, capacitor ESR;
  - periods shown, steps per period.
- **Also kept:** the CCM/DCM boundary note, Steady state / Start-up, and Reset.
- Every change flows through `setParams`, so there is one simulation state (§5).

### 4.4 Circuit view and status line
- **Circuit view.** The circuit is the centre. Component states and the current direction always come
  from `DcdcState`. Numeric labels on the circuit appear only at Engineer level (today they appear
  from Standard).
- **Clicking a part** opens Inspect for that part.
- **Current path** (action) highlights the parts in `st.path`, which come from the simulated device
  states. This is what `DcdcDiagram` already does with `showPath`; nothing is animated independently
  of the simulation.
- **Status line.** New optional `Topic.status(st): { headline: string; facts: string[] }`.
  - For Buck it is built from `DcdcState` alone, e.g. `SWITCH ON · inductor charging (iL ↗) · diode OFF`
    or `SWITCH OFF · diode freewheeling · inductor discharging`.
  - Fallback for other topics: `view.badge.text`.
  - It is one line and never a table.

### 4.5 Context panel (one tab at a time)
- **State.** The essentials at Beginner (t, switch, diode, iL, Vout, current path). More rows by level,
  using the existing `StateRow.min`.
- **Why.** `WhyPanel`: What · Why · Equation · Physical principle · What next.
  - The labels change, the existing `WhyCard` content is reused: `physics` is shown as "Physical
    principle", and `whatIf` as "What if…".
  - New optional `WhyCard.next?` ("Next consequence") is shown when present.
  - For Buck, `next` is generated from the simulated state, e.g. "iL keeps rising until the gate falls at
    t = 37.5 µs", using the run's next gate event. It is wording only, not a new calculation.
- **Learn.**
  - No lesson active: the topic's lessons, each with Start.
  - Lesson active: "STEP 2 OF 6", the step text from the simulation, Previous / Next.
  - The lesson still drives parameters, channels and the cursor as today.
- **Energy.** `topic.energy()`: stored energy in L and C plus a power-flow view (Source → Inductor →
  Load when ON; Inductor → Diode → Load when OFF). It reads `DcdcState.pin/pL/pC/pout`, existing
  simulated values.
- **Mode tab.** Experiment and Predict add their panel as the first tab ("Experiment", "Predict"). State
  and Why stay one click away.

### 4.6 Waveform panel
- **Default Buck channels:** Gate, Vout and iL (today: Gate, Vsw, iL, Vout).
- **`+ Add channel`** opens the run's available signals, grouped:
  - Voltage: Vin*, Vout, vL, vC, Vsw, vQ, vD;
  - Current: iin, iR, iL, iC, iQ, iD;
  - Control: Gate;
  - Energy: EL, EC;
  - Power: Pin, Pout.

  Only signals present in the run are listed, as the Phase 1 filter already ensures. \*Vin is a
  parameter, not a run signal. It is listed only if the run contains it; nothing is fabricated.
- **The master cursor** is `LabScope`'s, unchanged. Dragging it updates the circuit, status line,
  state, WHY, Inspect, Energy and the events highlight, all derived from `k`.
- **Phone:** 2 lanes by default, with a lane height that fits the screen.

### 4.7 Analyze sheet (action, not a mode)

New optional `Topic.analysis: Array<{ id; label; rows?: string[]; render?(ctx) }>`.
- `rows` names measurement keys. They are shown with SIMULATION values from `measure()`, and with
  the THEORY value when a compare row with that key exists.
- Categories with no available rows are hidden.
- Topics without `analysis` get today's tabs.

For Buck, using existing data only:

| Category | Rows / content |
|---|---|
| Overview | Vout avg, IL avg, mode (CCM/DCM), η |
| Output | Vout avg, ΔVout p-p, Iout avg |
| Current | IL avg, iL max/min, ΔiL p-p, IC rms |
| Ripple | ΔVout p-p, ΔiL p-p (+ the CCM/DCM boundary note) |
| Power | Pin, Pout, losses (Q, D, DCR, ESR) |
| Efficiency | η, loss breakdown |
| Device stress | the existing `DcdcStress` view (peak/RMS currents, blocking voltages) |
| Theory vs Simulation | the existing `MeasureTable` (textbook / exact), derivation, numerical checks, duty sweep |

No new measurement is computed in the UI.

### 4.8 Events drawer
- Lists `run.events` in the visible window, labelled by `topic.eventLabel`: Q1 ON/OFF, D1 ON/OFF,
  iL reaches zero.
- Selecting an event moves the master cursor to it and shows `eventWhy`.
- Shift+← → still jumps between events.

### 4.9 Focus mode (a view option)
- **Shows:** header, circuit, status line, the primary waveform (first channel lane only), the State and
  WHY tabs, and Basic parameters.
- **Hides:** Advanced parameters, secondary channels, and the Analyze and Events actions.
- **Leaving Focus** restores the previous view.

---

## 5. State flow (one simulation state)

```
route (topic, mode, query) ──► useTopicWorkspace(topic)
                                  params ─(useDeferredValue)─► simulate(params) ─► Run (memo)
                                                                     │                └─► measure(Run) ─► m (memo)
                       master cursor t ─► k = indexAt(Run, t) ─► st = state(Run, k) (memo)
                                                                     ├─► view(st) · status(st) · why(Run, st, m)
                                                                     ├─► inspect(part, st, m, Run)   (only when open)
                                                                     └─► energy(st, m, Run)          (only when its tab is open)
                       Run.events ─► Events drawer (click ─► cursor t)
                       topic.analysis + m + compare(Run, m) ─► Analyze sheet (computed only when open)
WorkspaceShell ◄── slots built from the model (no component computes electrical values)
```

Rules:
1. **One `Run` per parameter set and one cursor.** Every panel receives `st`, `m` and `Run`
   read-only. This is already true in LabShell; the hook keeps it.
2. **Update rate vs render rate.**
   - Parameter edits go through `useDeferredValue`, so sliders stay responsive while the run
     recomputes.
   - Cursor drags only recompute `st` (O(1)). The scope already draws its cursor on an overlay
     canvas.
   - Heavy children (Diagram, WHY, Energy) are memoised on `k`.
   - Analyze and Inspect compute only while open.
3. **Level.** The workspace reads `useLevel()` (Phase 1) and writes it through `setLevel`. There is no
   second level state.
4. **Reporting.** Mode, topic, lesson and level are still reported to `WorkspacePage`, so the address,
   Continue and Recent keep working.

---

## 6. Responsive strategy (same components, different presentation)

| Width | Layout |
|---|---|
| **≥ 1280** | header · [params 260] [circuit + status + action bar, flex] [context 360] · waveforms full width below. Fixed column widths; overlays float over the page (no reflow). |
| **1024–1279** | params collapse to a 48 px rail with a "Parameters" button (opens a left drawer) · circuit · context 320 · waveforms below |
| **768–1023** (tablet) | header · circuit (full width) · status · action bar · waveforms; Parameters and Context open as side drawers from header buttons |
| **< 768** (phone, 390/375) | compact header (← · title ▾ · ⋯), mode chips (scroll), **circuit → status → primary waveform → sticky action bar** at the bottom. "Parameters" (header button) and "State · Why · Learn · Energy" (action bar) open **bottom sheets**; Analyze, Inspect, Events and Path are bottom sheets too |

**Overlay behaviour.**
- **Desktop and tablet drawers are non-modal.** The circuit and cursor stay usable, as in today's
  rectifier lab. Focus moves into the drawer, Esc closes it, and focus returns to the trigger.
- **Phone bottom sheets are modal.** They have a backdrop, a focus trap, Esc and the backdrop close
  them, and focus returns to the trigger.

Acceptance:
- no horizontal page overflow at 1440, 1024, 820, 768, 390 and 375;
- touch targets ≥ 44 px on phones;
- the phone first screen shows the circuit, the status line and the start of the waveform without
  scrolling;
- the whole phone workspace is ≤ 2 screens tall;
- the context and parameters never extend the page — they are sheets.

---

## 7. Buck integration strategy

1. **Catalogue flag.** `Topic.workspace?: 'shell'` on `dc-dc/buck` only. `WorkspacePage` renders
   `TopicWorkspaceV2` for flagged topics and keeps `LabShell` for everything else.
2. **Topic switching.** The topic switcher navigates by route. Choosing Boost opens Boost in today's
   LabShell, so both shells coexist cleanly at the route boundary.
3. **Buck topic configuration** (UI only, no physics):
   - a buck-specific Basic list (Vin, fs, D, R) and Advanced list (L, C + today's advanced). The
     shared `DCDC_BASIC` for Boost/Buck-boost is unchanged;
   - default channels Gate, Vout, iL;
   - `status(st)`;
   - `analysis` categories (§4.7);
   - `WhyCard.next` wording;
   - measure labels for the extra rows (Iout, Pin, Pout, IQ peak…), formatting only.
4. **Modes.** Explore, Learn, Experiment, Predict. Analyze moves to the action bar. An old
   `…/buck/analyze` address does not exist (Phase 1 never wrote it), so there is no redirect to keep.
5. **Validation.** All Buck/DC-DC unit tests unchanged. `smoke-dcdc`'s **Buck** section is rewritten
   for the new layout with the same physics assertions (state at the cursor, WHY, path,
   measurements ✓, lessons, experiments, predictions). Its Boost/Buck-boost sections are untouched.

---

## 8. Migration strategy for Rectifiers (Phase 3, for information — not in this phase)

The shell is slot-based, so the rectifier lab plugs in **without** a Topic rewrite and without touching
`labReducer`, `useModes` or any physics:

| Slot | Rectifier source (existing) |
|---|---|
| header | `RECTIFIERS / <circuit> ▾`, 7 modes; the header circuit picker is retired (landing page + switcher) |
| params | `ParameterPanel` (+ load selector moved into Basic) |
| circuit | `CircuitDiagram` / `ThreePhaseDiagram` (Inspect + path already supported) |
| status | `stateLine(explanation)` + Vo, Io |
| context | `StateCard` · `WhyPanel` (+ Physics Lens) · `LessonPanel`/`LearnTab` · `EnergyPanel`; mode panels as the first tab |
| waveform | `Scope` + `Transport` + `ChannelBar`; Angle view / Events / With-without Dfw as waveform views |
| actions | Path · WHY · Inspect · Analyze (MeasurementsPanel + TheoryPanel as categories) · Energy · Events |
| overlays | the existing drawers re-hosted by `Overlay` |

Rectifier-specific extras stay as views or overlays: Angle view, Physics Lens, step-through, and the
Compare mode, which uses a full-width layout variant. "What do you want to study?" is retired; its
intents already exist as landing-page entry points and search.

---

## 9. Testing strategy

**Unit (Vitest, node).** These are pure functions, no DOM:
- `useTopicWorkspace` derivations exposed as pure helpers:
  - the status line for each Buck interval;
  - Analyze categories hide empty categories and only use existing keys;
  - the events list and event → cursor time;
  - overlay state transitions.
- **Buck synchronisation.** At an ON-interval and an OFF-interval sample:
  - the status line, state rows, WHY card, `inspect('l'|'c'|'q1'|'d1')`, the energy figures and
    `st.path` all agree with the run's signals at that sample;
  - the path matches the device states (Q1 ON → Vin·Q1·L·load; OFF → L·D1·load).
- **Catalogue:** the flagged topic exists and is ready.
- **All 771 existing tests unchanged.**

**Browser (`scripts/smoke-workspace.mjs`, Playwright/Edge), at 1440 · 1024 · 820 · 768 · 390 · 375.**
- **Desktop:**
  - the workspace renders;
  - Basic shows exactly Vin, fs, D, R, and Advanced opens;
  - context tabs switch, with one active;
  - each action opens its overlay and Esc closes it;
  - the waveform renders with Gate/Vout/iL and `+ Add channel` adds iC;
  - mode routes work (`/learn`, `/experiment`, `/predict`), with no Analyze mode.
- **Phone (390, 375):**
  - no horizontal overflow;
  - Parameters opens as a bottom sheet and context as a bottom sheet;
  - the action bar is visible and its targets are ≥ 44 px;
  - the waveform is visible and draggable;
  - the page height is ≤ 2 viewports.
- **State:**
  - drag the cursor from an ON point to an OFF point; then:
    - the status line flips SWITCH ON → OFF;
    - State switch/diode flip;
    - the first WHY question changes;
    - Inspect L shows iL equal to the scope readout;
    - the path highlight moves to D1;
  - clicking an event moves the cursor to that event's time.
- **Navigation:**
  - Back returns to the DC-DC landing page;
  - the topic switcher opens Boost (LabShell);
  - `#dcdc` still redirects;
  - Continue reopens Buck in Learn at the saved step.
- **Regression:** all eight existing suites (411 checks). Only `smoke-dcdc`'s Buck section changes.

**Visual.** Screenshots of:
- the desktop workspace, tablet (820/768) and phone (390/375);
- with Parameters, WHY, Inspect (inductor), Analyze and Events open.

Saved to `scripts/out/` and inspected.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Two shells coexist (LabShell for 8 labs, new shell for Buck) → duplicated state logic during the transition | `useTopicWorkspace` is new code built from TopicLab's logic. LabShell is left untouched (zero risk to 8 labs) and is retired when its labs migrate (Phase 6) |
| Buck's Basic/Advanced split or default channels change what `smoke-dcdc` and lessons expect | Buck-specific spec lists (shared `DCDC_BASIC` untouched); lessons set their own channels, so lesson steps are unaffected; the Buck smoke section is rewritten with identical physics assertions |
| A cursor drag re-renders the SVG diagram and the WHY panel → jank | memoise on `k`; deferred parameter updates; Analyze/Inspect computed only when open |
| Phone sheets hide WHY behind a gesture | the action bar always shows WHY, and the status line stays visible above the sheet's peek |
| Focus traps break the "keep using the circuit while a drawer is open" behaviour | non-modal drawers on desktop/tablet, modal sheets only on phones (§6) |
| Bundle growth | the new shell ships inside the dc-dc workspace chunk (lazy); target < +25 kB gzipped; no new libraries |
| `WhyCard.next` wording drifts from the simulation | generated only from `st` and the run's next event; a unit test checks the quoted time equals the event time |
| The analysis categories re-label existing numbers wrongly | rows reference measurement keys, labels come from `measureLabels`, and a unit test checks every key exists in `m` |

---

## 11. Decisions needed from you

1. **Action bar position.**
   - Desktop: **directly under the circuit and status line**, close to what it acts on, rather than
     below the waveforms as in the sketch.
   - Phone: a sticky bar at the bottom.

   *Recommended.*
2. **Overlay modality.** Non-modal drawers on desktop/tablet (the circuit stays usable). Modal,
   focus-trapped bottom sheets on phones. *Recommended.*
3. **Buck Basic parameters:** Vin, fs, D, R, with **L and C moved to Advanced** as your brief lists.
   (L sets the ripple, which several Buck lessons discuss; lessons set L themselves, so they are
   unaffected.) *Recommended.*
4. **Numbers on the circuit only at Engineer level** (today from Standard). Values live in State and
   Inspect. *Recommended.*
5. **"Next consequence" in WHY:** add the optional `next` line for Buck in Phase 2, generated from the
   simulated state and the next gate/diode event. *Recommended*; it adds no physics.

On approval I will implement Phase 2 in the order of your §43 steps 1–10, Buck only, then stop and
report.

---

# Phase 3 — Rectifier Lab in the workspace shell

Status: **approved and implemented** (all four decisions in P3.8 as recommended). The plan follows as
approved; "Phase 3 — as built" at the end records what was built and how it was verified.

Scope:
- **Rectifier Lab only:** all 11 circuits, the entry points (freewheeling, firing angle, commutation),
  and Compare.
- **Not touched:**
  - Buck physics, Boost and Buck-boost, the other labs.
  - Anything in `src/simulation/`, `src/circuits/`, `src/measurements/`, and the physics in
    `src/explanations/`.

## P3.0 Approach in one paragraph

The rectifier keeps its own state machine, and the shell only hosts what it already produces:
- **What stays unchanged:**
  - The state machine: `labReducer` (state/labState.ts), `useModes`, and the memos in `App.tsx`.
  - The single run: `runSimulation` → `compareWithTheory` → `explainer.state(result, cursorIndex)`.
- **What is new:** one rectifier adapter, `src/rectifier/RectifierShell.tsx`. It takes App's existing
  state, dispatch and memos and fills the `WorkspaceShell` slots with the existing rectifier components.
- **Why not a generic `Topic`:** turning the rectifier into one (as Buck is) would mean rewriting
  lessons, experiments, challenges, reverse engineering, the Physics Lens and Compare. That is a broad
  refactor and is rejected.
- **The shell gets one generic, optional addition:** a full-width `body` slot, used by Compare. Nothing
  in it is specific to rectifiers.
- **Transition:** until the last step, App.tsx renders either the old layout or `RectifierShell` from the
  same state. Every step is therefore verifiable against the old layout, which the final step deletes.

## P3.1 Migration map

"Physics" = whether the step touches any simulation, measurement or theory code. Every row is NO.

| Capability today | Shell region / action / panel | Component reused | Adapter work (RectifierShell / App) | Physics |
|---|---|---|---|---|
| Header: title, section switch (1-φ/3-φ), rectifier picker | header: back link, `RECTIFIERS` eyebrow, h1 = full circuit name, **Change circuit ▾** (11 circuits from the catalogue, grouped by section) | `WorkspaceHeader` (shell) | siblings from `labById('rectifiers').topics`; the picker and section switch are retired (landing page + Change circuit replace them) | NO |
| Load picker (in Header) | params → **Basic, first row: Load R · RL · RC · RLC** | `ParameterPanel` (+ optional `loadPicker` slot prop) | dispatch `chooseLoad`; activity reports `load` as today | NO |
| Modes: Lab · Learn · Experiment · Predict · Challenge · Reverse · Compare | header mode tabs (Explore = `lab`) | shell tabs | the `fromApp`/`toApp` mapping already exists in workspaces/rectifiers.tsx | NO |
| Density (Beginner/Standard/Engineer) | header level select | `LevelSelect` | `state.density` ↔ `level` (prefs already synced) | NO |
| Focus | header Focus toggle | shell focus | `setFocus`; the old `focus-bar` is retired | NO |
| Parameters: Basic (Vrms, f, R) / Advanced (L, C, diode model, phase, Vf, Ron, cycles, dt), α, Dfw, Ls/Rs, challenge locks | params column (desktop), left drawer (tablet), sheet (phone) | `ParameterPanel` unchanged | `editable` locks as today; issues, compute ms, samples as today | NO |
| Circuit, highlighted path, Inspect clicks, Physics Lens highlight | circuit slot | `CircuitDiagram` / `ThreePhaseDiagram` unchanged | `showPath` while the Path panel is open; `inspecting`; `onPart` opens the Inspect panel | NO |
| State strip: `stateLine`, Vo, Io, t, θ, cycle | status slot | `StatusLine` (shell) | `rectifierStatus(ex)`: headline = `stateLine(ex)`; facts = Vo, Io, θ, cycle — wording only, simulated values | NO |
| One-time hint; "simulation disagrees with theory" flag | under the status line | existing markup | same conditions as today | NO |
| Strip actions | action bar: Current path · WHY · Energy (Standard+) · Inspect · Events · Analyze (⚠ badge if the theory check fails) | `ActionBar` (shell) | the phone adds "State" automatically | NO |
| Current path drawer | panel `path` (dock) + circuit highlight | `PathPanel` | `drawer.kind === 'path'` ↔ `open === 'path'` | NO |
| Inspect drawer | panel `inspect` (dock) | `InspectPanel` + `inspectPart` | the Inspect action toggles `inspecting`; clicking a part opens the panel | NO |
| Right tabs: State, Why, Learn, Energy, active mode | context tabs: (mode panel first when not Explore) · State · WHY · Learn · Energy | `StateCard` (+ `FreewheelPanel`), `WhyPanel` (+ `FiringPanel`, Physics Lens), `LearnTab`, `EnergyPanel`, mode panels | `rightTab` ↔ `context.active`; the WHY/Energy actions select their tab | NO |
| WHY → **Next consequence** (new) | at the end of the WHY tab | `WhyPanel` `extra` slot | `rectifierNext(result, ex)`: the run's next event after the cursor (diode/SCR on-off, current stop, commutation start/end) or the next SCR **gate rising edge in the simulated gate trace**; null if none — wording only | NO |
| Physics Lens | inside the WHY tab (as today) | `PhysicsLens`, `lensStages` | unchanged | NO |
| Oscilloscope, Transport (play / step / speed), channels, presets, layout, conduction shading | waveform slot | `Transport`, `Scope`, `ChannelBar` unchanged | same props as today | NO |
| Primary views: Waveforms · Angle view · With/without Dfw | view switch in the waveform slot (same rules: Angle for 3-φ at Standard+, the Dfw comparison for freewheel circuits) | `AngleView`, `CompareView` unchanged | `scopeView` as today | NO |
| Events view (`scopeView 'events'`) + event drawer | action **Events** → panel `events`: the group list, then the detail of the selected group | `EventsView`, `EventDetail`, `explainer.event` | `selectGroup` as today; Shift+→/← unchanged; Events is no longer a waveform view | NO |
| Measurements sheet + Theory sheet | action **Analyze** → wide panel with categories: Overview · Output · Current · Ripple · Power · Device stress · Timing (Engineer) · Commutation μ (3-φ) · Theory vs Simulation | `MeasurementsPanel` summary, `MeasurementTable` (+ optional `keys` filter), `OverlapPanel`, `TheoryPanel` | categories = the existing `ROWS` keys regrouped; empty categories hidden (Efficiency only if such a row exists); `?sheet=commutation` opens Analyze → Commutation | NO |
| Step-through (freewheel circuits) | context, above the tabs (as today) | `StepThrough` | unchanged | NO |
| Predict "covered" state | circuit and waveform slots show the existing placeholders | existing markup | same `hide` condition | NO |
| Compare mode (full width) | shell `body` (generic full-width slot) | `CompareLab` unchanged | the header stays; the grid is replaced | NO |
| Route, Continue, activity | unchanged | `WorkspacePage`, `onActivity` | catalogue flag `workspace: 'shell'` on the rectifier topics | NO |

## P3.2 Component reuse map

- **Reused unchanged:**
  - Circuits: `CircuitDiagram`, `ThreePhaseDiagram`.
  - Waveforms: `Scope`, `Transport`, `ChannelBar`, `AngleView`, `CompareView`, `StepThrough`.
  - Explanation panels: `PhysicsLens`, `StateCard`, `WhyPanel`, `FiringPanel`, `FreewheelPanel`,
    `EnergyPanel`, `PathPanel`, `InspectPanel`, `LearnTab`.
  - Events and analysis: `EventsView`, `EventDetail`, `OverlapPanel`, `TheoryPanel`.
  - Modes: all six mode panels and `CompareLab`.
- **Reused with one optional, additive prop:**
  - `ParameterPanel`: `loadPicker?: ReactNode`, rendered first in Basic.
  - `MeasurementTable`: `keys?: MeasureKey[]`, which filters existing rows.
- **Shell pieces reused:** `WorkspaceShell`, `WorkspaceHeader`, `ActionBar`, `Overlay`, `StatusLine`,
  `usePresentation`.
- **Shell pieces not used for rectifiers:** the Topic-based `WaveformPanel`, `WhyView`, `AnalyzeView` and
  `EventsView` in panels.tsx, because they read a `Topic`.
- **New:**
  - `src/rectifier/RectifierShell.tsx`: the adapter (slot composition only).
  - `src/rectifier/analyze.tsx`: the category list and view, regrouping existing rows.
  - `src/explanations/status.ts`: `rectifierStatus`, `rectifierNext`, wording only.
  - `WorkspaceShell`: the optional `body` prop.
- **Retired at the end:**
  - The old App.tsx layout JSX (`state-strip`, `col-state`, `focus-bar`, `view-bar`).
  - The `Header` section/rectifier/load pickers.
  - `Drawer` usage in the rectifier, now replaced by `Overlay`.
  - The `MeasurementsPanel` tab strip; its summary becomes Overview.

## P3.3 Physics boundary map

None of these is changed in Phase 3. Display code that reads the simulation:

| Location | What it computes | Classification | Phase 3 |
|---|---|---|---|
| `runSimulation`, `compareWithTheory`, `theoryFor`, `measure` | everything numerical | physics (source of truth) | untouched |
| `explainState`, `explainEvent`, firing, freewheel, threePhase, lens, concise | wording from simulated samples and events | explanation (reads the sim) | untouched; `status.ts` adds wording only |
| `CircuitDiagram` / `ThreePhaseDiagram` | arrow/thickness scale from max abs(i); `irect` = sum of the upper devices' simulated currents | display scaling of simulated data | untouched |
| `EnergyPanel` | conservation check = sum of the simulated element powers | display arithmetic on simulated data | untouched |
| `CompareView` | a second `runSimulation` with Dfw toggled (memo on params) | counterfactual run of the same engine | untouched; the memo means cursor moves never re-run it |
| `FiringPanel` | `runSimulation` at α = 0 for reference (memo on params) | counterfactual run | untouched |
| `AngleView` | angle mapping via `threePhaseSource` | source-angle display | untouched |
| `ParameterPanel` | the √3·Vph hint | display of an input | untouched |
| `useModes`, `whatIf.ts`, `CompareLab` | extra runs for experiment snapshots, what-if, compare | same engine, different params | untouched |
| `App.initialState` | one extra run to put the cursor on the first positive peak | cursor placement | untouched |

Follow-up, documented and not part of Phase 3: lift the counterfactual runs into adapter memos, so that
closing and reopening a panel does not recompute them.

## P3.4 Test baseline (before any change)

- **Unit tests:** 780 pass. The 426 in rectifier-related files are:
  - allCircuits.limits 108; storage 85; challenges 27; threePhase 23; controlled 20;
    threePhase.controlled 19; freewheel 18; modes3 18; freewheel.modes 15; halfWaveR.engine 15;
    halfWaveR.limits 15; ui 14; fullwave 12; lessons 12; halfWaveR.measurements 11;
    halfWaveR.explanations 7; stepping 7.
- **Browser checks:** 518 pass.
  - Rectifier suites: smoke 57, smoke3 40, smoke-fw 29, smoke-ctl 36 (162).
  - Other suites: dcdc 64, inv 33, modules 87, shell 70, workspace 102.
- **Numerical golden baseline:**
  - The table below comes from `runSimulation` + `compareWithTheory` at the defaults (12 Vrms, 50 Hz,
    R 10 Ω), using the recommended cycles per load.
  - Single-phase circuits use L 50 mH and C 1000 µF; three-phase circuits use L 10 mH. α is 30°
    unless shown otherwise.
  - Step 0 freezes this table as a test.

| Configuration | Vdc | Vrms | ΔVpp | Io avg | Id pk | PIV | μ [°] | fallbacks | events | theory ✓ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1φ half-wave R | 5.05649 | 8.04240 | 16.2706 | 0.505649 | 1.62706 | 16.9706 | — | 0 | 31 | yes |
| 1φ half-wave RL | 3.72216 | 8.87031 | 31.1547 | 0.371568 | 1.01031 | 16.9706 | — | 0 | 59 | yes |
| 1φ half-wave RL + Dfw | 4.70189 | 8.05775 | 16.9706 | 0.470189 | 1.02078 | 16.2706 | — | 0 | 74 | yes |
| 1φ center-tapped R | 10.1130 | 11.3737 | 16.2706 | 1.01130 | 1.62706 | 33.2411 | — | 0 | 47 | yes |
| 1φ bridge RC | 12.1370 | 12.3612 | 7.39262 | 1.21370 | 5.21959 | 16.2706 | — | 0 | 118 | yes |
| 1φ bridge RLC | 9.40379 | 9.40761 | 0.765226 | 0.940379 | 1.17920 | 16.2706 | — | 0 | 187 | yes |
| 1φ half-wave SCR, R, α 30° | 4.75132 | 7.94204 | 16.2706 | 0.475132 | 1.62706 | 16.9706 | — | 0 | 31 | yes |
| 1φ fully controlled bridge, RL, α 45° | 6.23943 | 11.1611 | 28.9706 | 0.623944 | 0.921745 | 16.2706 | — | 0 | 93 | yes |
| 1φ semi-controlled bridge, RL, α 30° | 8.68149 | 10.6579 | 16.9706 | 0.867582 | 1.09966 | 16.2706 | — | 0 | 93 | yes |
| 3φ 3-pulse R | 13.3345 | 13.5788 | 8.48528 | 1.33345 | 1.62706 | 28.6939 | 0 | 0 | 63 | yes |
| 3φ 6-pulse R | 26.6691 | 26.6951 | 3.93803 | 2.66691 | 2.79939 | 28.6939 | 0 | 0 | 87 | yes |
| 3φ 6-pulse RL, Ls 2 mH | 25.1369 | 25.1875 | 5.10932 | 2.51294 | 2.59473 | 27.7537 | 26.0178 | 0 | 277 | yes |
| 3φ 3-pulse SCR, R, α 30° | 11.4647 | 12.5416 | 16.2706 | 1.14647 | 1.62706 | 28.6939 | — | 0 | 87 | yes |
| 3φ half-controlled, RL, α 30° | 24.7925 | 25.0745 | 14.6703 | 2.47851 | 2.72187 | 28.6939 | 0 | 0 | 202 | yes |
| 3φ fully controlled bridge, RL, α 30° | 22.9122 | 23.3383 | 14.6969 | 2.28939 | 2.48178 | 28.6939 | 0 | 0 | 202 | yes |

Device behaviour is already covered by unit tests:
- conduction and blocking per topology;
- SCR waiting for its gate, firing at α, and staying ON;
- freewheel hand-over and overlap;
- the commutation μ against theory;
- event order.

## P3.5 Risks

1. **Silent numerical drift.** Mitigation: the golden test (Step 0) runs at every step; the adapter
   never passes modified parameters.
2. **Smoke suites bound to the old DOM.**
   - The four rectifier suites use `.drawer`, `.panel-tabs`, `.strip-state`, `.view-seg`, `.focus-bar`,
     `.picker` and old button names.
   - Mitigation: update the selectors only, keeping every physics assertion and the same count or
     more; the diff is reviewed per suite.
3. **Two layouts in App.tsx during the transition.** Mitigation: one boolean, the same state and memos;
   the old branch is deleted in the final step, never edited.
4. **State mapping mismatches.** The mappings are `rightTab` ↔ context tab, `drawer` ↔ `open`,
   `scopeView 'events'` → Events panel, and `measure`/`theory` → Analyze. Mitigation: one mapping
   function each, unit-tested; deep links (`sheet=commutation`, `fw=1`, `alpha`, `ls`) are smoke-tested.
5. **Mode panels in a narrower context column.** The six mode panels were laid out for `col-state`.
   Mitigation: they keep their own markup; checked at 1440/1024/820/768/390/375.
6. **Phone circuit legibility.** The 3-φ bridge is wide. Mitigation: the existing min-width with
   horizontal scroll inside the card; a new phone renderer is a documented follow-up.
7. **Bundle size.** The rectifier chunk already exists. The shell is shared with Buck, so its cost is
   small. Home must stay unchanged (lazy) and the build warning-free.
8. **Focus and keyboard.** The Transport keys and Shift+→ must not fire inside sheets. Mitigation: the
   same dialog guard as Buck.
9. **Lesson resume / Continue / the one-time hint.** These run through the same reducer actions. A
   smoke test covers resuming a lesson.

## P3.6 Implementation sequence

After each step, the unit tests, the build and the relevant smoke suites must pass before the next step
starts.

0. **Golden test:** `tests/rectifier.golden.test.ts` freezes the P3.4 table to 6 significant digits.
   No app code.
1. **Wording helpers:** `src/explanations/status.ts`, with `rectifierStatus(ex)` and
   `rectifierNext(result, ex)`. They are tested on real samples:
   - diode conducting and blocking;
   - SCR waiting, where the next consequence is the gate edge from the trace;
   - SCR conducting;
   - freewheel;
   - 3-φ commutation;
   - no next event → null.
   No UI change.
2. **Shell `body` slot** (generic, optional). Buck untouched: re-run smoke-workspace and smoke-dcdc.
3. **Skeleton adapter `RectifierShell`:**
   - Slots: header (Change circuit, modes, level, focus), params (+ load picker in Basic), circuit,
     status, waveform (Transport + Scope + ChannelBar).
   - Context has the State tab only.
   - App.tsx renders it when the route carries `workspace: 'shell'`.
4. **Context tabs and actions:**
   - Tabs: State (+ Freewheel, StepThrough), WHY (+ Firing, Physics Lens, Next consequence), Learn,
     Energy.
   - Actions: Current path, Inspect.
5. **Analyze:** a wide panel with categories (`src/rectifier/analyze.tsx`, `MeasurementTable keys`),
   the commutation deep link and the ⚠ badge.
6. **Events:** the Events panel with group detail, and Shift+→/←.
7. **Waveform views:** Angle view, With/without Dfw.
8. **Modes:** Learn, Experiment, Predict (covered state), Challenge (locks), Reverse in the context
   column; Compare full width in `body`.
9. **Responsive pass at six widths;** the tablet drawers and phone sheets come from the shell.
10. **Retire the old layout:**
    - Delete the old JSX branch and the Header pickers.
    - Set the catalogue flag on every rectifier topic.
    - Update the selectors in the four rectifier smoke suites.
    - Add `tests/rectifier-workspace.test.ts`, covering on real samples: diode conducting and blocking,
      the SCR gate event, SCR conducting, freewheel, path, status, State, WHY, next consequence,
      Inspect, Energy, Analyze, Events, Angle view, theory vs simulation, and Compare.
    - Add `scripts/smoke-rectifier-shell.mjs`, the visual matrix at 1440/1024/820/768/390/375.
    - Build (no warnings, Home size unchanged), update the docs, and report.

## P3.7 Known limitations (planned, not regressions)

- Phone circuit: horizontal scroll inside the card, as with Buck; a dedicated phone renderer is a
  follow-up.
- Counterfactual runs (`CompareView`, `FiringPanel`) are recomputed when their panel remounts; a
  follow-up will lift them into adapter memos.
- The rectifier does not become a generic `Topic`; it consumes the shell through slots. Phase 4 can
  decide whether the other labs need more than the Topic adapter.

## P3.8 Decisions needed

1. **Adapter approach:** compose `WorkspaceShell` from the existing rectifier state (slots), and do not
   convert the rectifier into a `Topic`. *Recommended:* no physics or lesson rewrite.
2. **Events moves from a waveform view to an action-bar panel,** as with Buck; the waveform switch keeps
   Waveforms, Angle view and With/without Dfw. *Recommended.*
3. **Measurements and Theory merge into one Analyze panel** with categories (P3.1); the
   `sheet=commutation` link opens Analyze → Commutation μ. *Recommended.*
4. **Challenge and Reverse stay as rectifier workspace modes**, unchanged from Phase 1; moving them to
   Engineering only is out of scope. *Recommended.*

## Phase 3 — as built

**Physics.** No file in `src/simulation/`, `src/circuits/`, `src/measurements/` or the explainers'
physics was changed. `tests/rectifier.golden.test.ts` freezes the P3.4 table and passes unchanged.

**New:**
- `src/rectifier/RectifierShell.tsx`: the adapter. It holds no state and runs nothing. It places the lab's
  existing state, run, measurements, explanation and panels into the shell. `panelOf` / `drawerOf` map the
  shell's open panel to the lab's one drawer state.
- `src/rectifier/analyze.tsx`: the Analyze categories. They are the existing `compareWithTheory` rows
  regrouped (Overview, Output, Current, Ripple, Power & efficiency, Device stress, Timing at Engineer,
  Commutation μ for 3-φ, Theory vs Simulation with the equation cards). Empty categories are hidden, and a
  ⚠ marks a failed theory check.
- `src/explanations/status.ts`: wording only.
  - `rectifierStatus` gives the status line: the conducting devices, then Vo, Io, θ and the cycle.
  - `rectifierNext` gives WHY's next consequence. It is the next SCR gate rising edge in the simulated
    gate trace (SCRs pulsed together are named together), or else the run's next device event with the
    circuit explainer's reason. It is null when the run has none.

**Changed (UI only):**
- App.tsx keeps its reducer, memos and side effects in place and renders `RectifierShell`. The old
  layout was removed, and the file went from 760 to about 450 lines.
- The `Header` component and `ui/Drawer` are retired (deleted). Their pickers were replaced by the
  landing page, "Change circuit ▾" and the load selector in Basic. "What do you want to study?" is
  retired; its intents are entry points and search.
- `ParameterPanel` gains an optional `loadPicker` slot (Load R · RL · RC · RLC and the "Freewheeling
  diode: ON/OFF" toggle, first in Basic).
- `MeasurementTable` gains an optional `keys` filter, and `MeasureSummary` is exported from
  `MeasurementsPanel`.
- `DrawerKind` gains `'events'`, the list in the Events panel.
- The catalogue sets `workspace: 'shell'` on all 11 rectifier circuits.
- The Change circuit links keep the load, and the freewheeling diode where the target takes one.
- The header title names a fitted freewheeling diode (it was the bench title before).
- Live numbers on the circuit appear only at the Engineer level. This is the Phase 2 rule; it is done in
  CSS (`.rx-circuit--quiet text.value`), and the diagram is unchanged.
- Focus mode, as in every shell lab, keeps the circuit, State, WHY and the waveform. Analyze, Events,
  Learn and Energy step aside.
- Arrow keys don't move the cursor behind a modal sheet.

**Generic shell changes (no rectifier logic in the shell):**
- An optional full-width `body` slot, used by Compare.
- Optional `group` on the "Change circuit" siblings, which gives a sectioned menu.
- A header with more than five modes moves them to their own row on desktops narrower than 1360 px.
- The workspace root is now `<main>`. Buck had no main landmark before, so this fixes it too.

**Also fixed:**
- `DcdcSweep` memoized on a fresh `p` object, so every re-render while the sweep was shown re-ran its 17
  simulations. It is now keyed on the parameter values.
- The DC-DC smoke suite's duty-sweep click gets a 120 s timeout. 17 runs, each with its exact analytic
  solution, take about 11 s in CCM and about 22 s in DCM in Node, and longer in the dev browser. That
  existing Buck theory cost is a follow-up; it was not touched in Phase 3.

**Verification:**
- Unit tests: 817 pass. Phase 3 adds 37: 15 golden, 8 status / next-consequence, 14 workspace, all on
  real simulation samples.
- Browser checks: ten suites pass, 585 checks.
  - The four rectifier suites were ported (selectors only, every physics assertion kept): 57 / 41 / 30 /
    36.
  - New suite `smoke-rectifier-shell`: 65 checks covering 1440/1024/820/768/390/375, the entry points,
    Analyze, Events, sheets, the dialog key guard and Compare.
- Build: no warnings. Home is 268.9 kB (83.1 kB gzipped), as before. The rectifier chunk is 370 kB
  (118.5 kB gzipped) and is loaded only when a rectifier circuit opens.

**Known limitations and follow-ups:**
- Phone circuit: a minimum width of 560 px, scrolling sideways inside its card. A dedicated phone renderer
  is a follow-up.
- The counterfactual runs in `CompareView` and `FiringPanel` recompute when their panel remounts.
- The old layout's CSS (`.col-*`, `.strip-*`, `.focus-bar`, header pickers) is now unused in `index.css`.
  Removing it is a separate clean-up.
- Buck duty sweep: computing the exact solution per point is slow, especially in DCM.
- `controlled.test.ts` "theory agrees … α = 0…90°" failed once in a full parallel run and passed in
  every rerun, alone and in full. It is probably the 180 s test timeout under load; the failure message
  was not captured.

---

# Phase 4 — Universal workspace stabilization: AUDIT and PLAN

Status: **approved (all seven decisions in A11) and implemented, together with the UX simplification brief —
see "Phase 4 — as built" below.** The audit as written: The probes ran from copies placed temporarily in
`tests/`; they were deleted afterwards. Phase 5 and other labs are out of scope.

## A1. Universal shell responsibilities (today)

`WorkspaceShell` is layout-only and physics-free. It owns:
- the regions;
- the header (back, title, Change circuit, modes, level, Focus);
- the action bar and the phone's extra "State" action;
- the overlays (dock / drawer / modal sheet, focus trap, inert page);
- the responsive presentation;
- the full-width `body` slot.

It contains no lab-specific branch, and no electrical value is computed in it.

**But** most of what it shows is built twice, once per adapter:
- the actions;
- the Focus and level rules;
- the inspector, events, Analyze, energy and current-path views.

## A2. Adapter responsibilities (today)

| | Buck (`TopicShell` + `useTopicWorkspace` + `topics/dcdc.tsx`) | Rectifier (`App.tsx` + `RectifierShell.tsx`) |
|---|---|---|
| State and run | hook: params → `topic.simulate` (memo) → `measure` | `labReducer` → `runSimulation` (memo) → `compareWithTheory` |
| Cursor | `cursorTime` → `converterIndexAt` → `topic.state(run, k)` | `state.cursorTime` → `indexAtTime` → `explainer.state(result, k)` |
| Actions, Focus, levels | built in `TopicShell` | built in `RectifierShell` + App's `tabs` |
| Panels | Topic-coupled views in `panels.tsx` | the old rectifier panels, re-hosted |

## A3. Physics responsibilities

Physics stays in the domain:
- Buck: `converters/engine.ts`, `dcdc/model`, `measure`, `theory`.
- Rectifier: `simulation/`, `circuits/`, `measurements/`.

Wording comes from the explainers: `dcdc/explain.ts`, `explanations/*`, `status.ts`.

**Arithmetic found in view components, to move into pure domain functions:**
- `EnergyPanel` (rectifier) computes, from simulated signals:
  - `vL·iL`, `vC·iC` and `vDfw·iDfw`;
  - the per-element split and the conservation sum Σp.
- `DcdcEnergy` (Buck) computes:
  - `loss = pin − pL − pC − pout`;
  - the capacitor-energy bar maximum `½·C·max(Vout)²`.

Neither panel invents data, but these are power and energy derivations, and they belong in the domain and
under test.

## A4. Duplication

| Concept | Buck | Rectifier |
|---|---|---|
| Events | `panels.EventsView(w)`: list + `eventWhy` | `EventsView` (groups, filters) + `EventDetail`, drawer kinds `event` / `events` |
| Inspect | `InspectView`: part chips + rows, `InspectInfo {title, role, rows}` | `InspectPanel`, `Inspection {title, kind, rows, why}`, no chips |
| Current path | toggle → circuit highlight + path text on the status line | panel `PathPanel` (path + reasons) + highlight |
| Analyze | `AnalyzeView(w)`: SIMULATION / THEORY (exact) table + derivation, sweep, numerical checks | `RectifierAnalyze`: `MeasurementTable` (simulated, theory, error, formula, approx. rows, notes) + equation cards |
| WHY | `WhyView`: question tabs → What / Why / Equation / Principle / What-if / Next | `WhyPanel`: 5-step chain + detail + Lens + firing Q&A + Next block |
| Energy | `DcdcEnergy`: stores + "power flow now" list | `EnergyPanel`: signed ledger + stores + Σp check |
| Actions, Focus, level rules | `TopicShell` | `RectifierShell` + App `tabs` |
| Keyboard | ← → one sample, Shift + ← → event | ← → step by the Transport step mode, Space play, Home reset |

The two WHY views already share the markup (`ol.why-steps`), so one generic view barely changes either
look.

The two event types are nearly the same shape: `RunEvent` and `CircuitEvent` both have
`{id, kind, time, device?, values}`.

## A5. Inconsistencies between Buck and Rectifier

1. **Current path:** a toggle in Buck, a panel in the rectifier.
2. **Inspect:** Buck has part chips; the rectifier has none. The data types differ.
3. **Energy at Beginner:** Buck offers it; the rectifier hides it below Standard (inherited from its old
   density rule).
4. **Analyze levels:** the rectifier hides Timing below Engineer and opens the equations at Engineer. Buck
   gates nothing.
5. **Focus:**
   - Buck hides Advanced parameters and shows one channel. That channel is the *first* default, which is
     the **Gate** signal, not Vout — a bug.
   - The rectifier keeps Advanced parameters and every channel in Focus.
6. **Event → cursor:** both land on the first sample after the event. Only the rectifier verifies against
   the trace that this sample shows the new state; Buck uses `floor(t/dt)+1` unchecked.
7. **Next consequence:** both quote the time, but neither offers "go to that instant".
8. **Analyze tables:** Buck shows SIMULATION / THEORY + ✓/✗. The rectifier shows Simulated / Theory / Error /
   Formula + approximations + assumptions notes. The labels and the assumptions handling differ.
9. **Shift + ← →:** jumps to events in Buck only.
10. **Rectifier CSS (`rx-*`):** lives in the shell's `workspace.css`.

## A6. Flaky test diagnosis — `controlled.test.ts` "theory agrees … α = 0…90°"

**Investigation:**
- **Workload:** 42 full simulations (7 circuits × 3 α × Dfw on/off, 16 cycles). No randomness; no time
  dependence in the engine (`performance.now()` is used only for the reported `computeMs`).
- **Module state:**
  - The netlist cache is a `WeakMap` keyed by the run's own params object.
  - The combination-order cache is pure and never mutated by readers.
  - Vitest isolates each file.
- **Repetition:** 8 full-suite runs: **8/8 pass**, 817/817 each. Full-run wall time 43–63 s. This test
  takes 20.5–30.3 s (10.7 s alone). It drifted about 45% across a few minutes on an otherwise idle
  machine, showing how much the host varies.
- **Determinism:** the same 42 runs were executed in 5 separate processes, 2 of them concurrently. A
  SHA-256 over every trace sample and every comparison row was **bit-identical in all five**. The
  worst-case relative error (1.9%, on a widened ill-conditioned row) is identical every time. An
  assertion therefore cannot pass in one run and fail in another.
- **The failing run (2026-10-08 21:31):** that `vitest + build` command took **≈ 5 min 50 s instead of
  < 1 min**. The whole machine was running about 7× slower. At 7–8×, this test's 22–30 s reaches its
  180 s timeout. The failure message was not captured (my command filtered the output).

**Classification: B — performance / load**, triggered by host contention (E). There is no nondeterminism
(C), no isolation problem (D) and no randomness. A remains possible only in the sense that a single 42-run
test concentrates all its cost under one timeout.

**Fix (no timeout increase):**
- Split the loop into 42 `it.each` cases. Each takes about 0.5 s, gets its own timeout, and a failure
  names the exact configuration. Coverage and assertions are unchanged.
- From now on, full-suite runs keep the unfiltered output, so any failure message is captured.

## A7. Buck sweep diagnosis

Profiled with a counting wrapper (no source change), 17 points:

| Load | simulate | measure | `dcdcExact` | `expm` calls | time in `expm` |
|---|---|---|---|---|---|
| R = 6 Ω (5 DCM + 12 CCM points) | 324 ms | 6 ms | **9.9 s** | 107 154 | 8.7 s |
| R = 30 Ω (16 DCM points) | 595 ms | 4 ms | **19.3 s** | 219 847 | 17.3 s |

**Where the time goes:**
- About 90% is the 3×3 matrix exponential: about 80 µs per call.
- `dcdcExact` builds a new `affineFlow` (one `expm`) for every evaluation.
  - CCM: 2,007 per point, of which 2,001 come from sampling the cycle's extremes at 2,001 instants.
  - DCM: 13,000–17,000 per point, from the nested bisections (the periodic start voltage × the diode
    turn-off time).

**Is it repeated?**
- The 17 points have 17 distinct parameter sets and are independent; no point is computed twice. The
  re-render bug was already fixed.
- Within one DCM point, **73–80% of the `expm` calls repeat an input already computed in that point**:
  the 64-step scan grid and the bisection midpoints recur on every outer iteration. In CCM there are
  essentially no repeats.

**Safe optimizations (identical numbers):**
1. **Cache within one `dcdcExact` call,** keyed by the exact time step. It removes the repeated `expm`
   evaluations (DCM about 4× faster). Each cached flow is the very same function of the same input, so the
   results are bit-identical.
2. **Allocation-free `expm`** with the same floating-point operation order. A probe over 27,000 matrix
   entries (norms 1e-3 … 1e4) matched the current implementation exactly (`Object.is`), at **14 µs vs
   111 µs per call (≈ 8×)**. `expm.ts` is shared by 8 modules (`pwl.ts`, control, devices, drives,
   thermal, dcdc), so this speeds them all. **Needs your approval.**
3. **Responsive UI:** the sweep currently runs synchronously inside the click, blocking the page. Computing
   one point per frame, with "n / 17" progress, keeps the page responsive and gives the same values.

**Estimate:** the DCM sweep falls from about 19 s to about 1 s with options 1 + 2, or about 5 s with
option 1 alone. Then the DC-DC smoke click timeout goes back to the default. Opening Analyze in DCM gets
faster too, since it calls `dcdcExact` once.

**Not done:** replacing the exact solution, coarser sampling of the extremes, or a looser bisection.
Each would change numbers.

## A8. Change Circuit parameter preservation

Each circuit has its own address, so App remounts with route values plus defaults. Today only `load` and
`fw` travel; R, Vrms, f, L, C, α, the diode model, Ls, Rs and the simulation settings reset. Buck already
keeps its own parameters per topic in a module store (`paramStore`).

## A9. Other architectural risks

- **`panels.tsx` mixes two kinds of view:** generic ones (`StatusLine`, `WhyView`, `InspectView`) and
  Topic-coupled ones (`ParameterPanel(w)`, `WaveformPanel(w)`, `EventsView(w)`, `AnalyzeView(w)`). A
  third lab cannot reuse the Topic-coupled ones without being a Topic.
- **`RectifierShell` takes about 40 props of pre-built nodes from App:** a wide, fragile surface.
- **The phone "State" action** assumes a context tab with id `state`. That is an implicit contract.
- **Two scopes** (`LabScope`, rectifier `Scope`) and **two parameter panels** remain domain renderers. Not
  unified in Phase 4: too large, and visual.
- **The cursor contract is true but untested:** nothing checks that a cursor move does not re-run the
  simulation.
- **About 68 `index.css` classes have no direct reference.** Many are false positives built in template
  strings (`ledger-fill--${id}`, `phase-chip--a`). Only proven-dead ones may go.

**Extensibility today:** a third lab *can* plug into `WorkspaceShell` without modifying it, because the
shell is slot-based. But it would have to rebuild events, inspect, Analyze, energy, path, actions, Focus
and levels, as the rectifier did. Phase 4 moves those into the shell's generic layer.

## A10. Plan

### Contracts — `src/workspace/contract.ts` (new, small; each type used by both labs)

```ts
/** One simulation instant; moving it re-reads the stored run, it never re-runs it. */
interface WorkspaceCursor { time: number; index: number; runId: number; goTo(time: number): void }

/** Domain kinds stay domain-specific; the shell sees only this. */
interface WorkspaceEvent {
  id: string; time: number; kind: string; label: string; category: string
  device?: string; transition?: { from: string; to: string }; why?: string
}

/** From the simulated conducting devices. */
interface CurrentPath { elements: string[]; text: string; reasons: string[] }

/** Common fields + domain rows. */
interface ComponentInspection {
  id: string; title: string; kind: string; state?: string
  now: { voltage?: string; current?: string; power?: string; energy?: string }
  rows: Array<[string, string]>; why?: string
}

/** The next consequence: time is a real event's or null. */
interface NextConsequence { text: string; time: number | null }

/** state → condition → rule → equation → explanation → next. */
interface WhyExplanation {
  id: string; question: string
  steps: Array<{ stage: 'state' | 'condition' | 'rule' | 'equation' | 'explanation'; title: string; text: string }>
}

interface AnalysisRow {
  key: string; label: string; simulation: string; theory: string | null
  error: string | null; pass: boolean | null; formula?: string | null
}

/** Only categories with real rows. */
interface AnalysisCategory { id: string; label: string; rows: AnalysisRow[]; assumptions?: string[]; extra?: ReactNode }

/** Signed powers (+ absorbing, − supplying) and stored energies from the simulation. */
interface EnergyModel {
  stores: Array<{ id: string; label: string; formula: string; joules: string; fraction: number; power: string; verb: string }>
  ledger: Array<{ id: string; label: string; watts: number; text: string; note: string }>
  balance: { text: string; ok: boolean } | null
  summary?: string
}
```

`WorkspaceShell` then takes a **`WorkspaceModel`**. It is the existing slots plus the data above:
- **Kept as slots:** `header`, `params`, `circuit`, `waveform`, `body`.
- **Added as data:** `status`, `path`, `cursor`, `context` (State body, WHY body + `why` + `next`, Learn,
  mode panels), `inspector`, `events`, `analysis`, `energy`, `notice`.

The shell builds the standard actions itself (Current path · WHY · Inspect · Analyze · Energy · Events),
from what the model provides, and applies Focus and level rules once. It still never imports a lab, never
branches on one, and computes nothing electrical.

### Generic views — `src/workspace/views.tsx`

They are moved out of `panels.tsx` and extended:
- `StatusLine` + the path line with "why this path";
- `WhyView`: question tabs when more than one + steps + `NextConsequence`, with **"Go to t = …"** moving
  the master cursor to the real event;
- `InspectorView`: part chips + common block + domain rows + why;
- `EventsView`: category filter, list, detail; clicking moves the cursor to the event's sample;
- `AnalyzeView`: categories, SIMULATION / THEORY / error (+ formula at Engineer) + assumptions + extras;
- `EnergyView`: stores + signed ledger + balance.

`panels.tsx` keeps the Topic renderers (`ParameterPanel`, `CircuitView`, `WaveformPanel`).

### Adapters

- **Buck** (`TopicShell` + `topics/dcdc.tsx` + `dcdc/explain.ts`): maps its events, inspection, path, WHY
  cards (What → state, Why → condition, …), Analyze rows and a new pure `dcdcEnergy(st, m, p)` to the
  contract.
- **Rectifier** (`RectifierShell` + App): maps `CircuitEvent` + `explainer.event`, `inspectPart` (gains
  the common `now` fields and a parts list), `pathView`, `conciseWhy` / `chain` + firing / Lens as WHY
  extras, `compareWithTheory` rows + theory notes, and a new pure `rectifierEnergy(result, sample, m)`
  (moved from `EnergyPanel`). App's prop surface shrinks to the model.
- **Event → cursor:** one rule. Land on the first sample at or after the event that the trace confirms
  shows the new state. Buck gains the rectifier's confirmation step.

### Change circuit — `src/workspace/carry.ts`, about 40 lines

Last values per lab are kept in a module store, as Buck's `paramStore` already does. When a circuit opens:
- values **kept** if the destination uses them (R, Vrms/phase voltage, f, L, C, diode model, Vf, Ron,
  simulation settings; α if it has SCRs; Ls, Rs and sequence if three-phase; Dfw if supported);
- values **not used here** are listed and kept for later, never silently dropped;
- the route's explicit values (entry points: `alpha`, `ls`, `fw`, `load`) always win, so entry points and
  golden numbers are unchanged;
- a dismissible notice under the header lists what was kept and what does not apply. For example:
  "Kept: R = 20 Ω, f = 60 Hz, α = 60°. Not used by this rectifier: α (no SCRs)."
- Defaults still resets.

### Levels and Focus (one rule in the shell, honoured by both adapters)

Nothing is removed at any level; the level decides what is open or shown by default.

| | Beginner | Standard | Engineer |
|---|---|---|---|
| Parameters | Basic; Advanced closed | same | Advanced open |
| Circuit numbers | no | no | yes |
| Actions | all six (Energy too, fixing A5.3) | all six | all six |
| Analyze | every category | every category | + Formula column, assumptions and derivations open |

The rectifier's Timing tab becomes visible at every level.

**Focus** keeps the circuit, the primary waveform, State, WHY and Basic parameters. Analyze, Events,
Energy, Learn and Advanced parameters step aside. **Primary waveform** is declared by each adapter:
Buck `[gate, vout]` (fixing the Gate-only bug), Rectifier `[vin, vout]`.

**Keyboard:** Shift + ← → jumps to the previous/next event in both labs. ← → keeps each lab's step rule;
Space and Home stay rectifier Transport keys.

### Implementation sequence

Each step ends with typecheck + unit + the relevant browser suites green.

0. Record baselines (counts, timings, golden).
1. Flaky test → `it.each` per configuration; keep full output on every run.
2. Buck sweep:
   - (a) snapshot `dcdcExact` outputs for a parameter grid;
   - (b) per-call flow cache in `dcdcExact`;
   - (c) *(if approved)* allocation-free `expm` with an identity test against a frozen copy of the current
     implementation (random + real matrices, `Object.is`);
   - (d) progressive sweep UI;
   - (e) restore the default smoke timeout;
   - (f) measure before and after.
3. `contract.ts` + cursor `runId` (exposed as `data-run-id` on the workspace root for browser tests).
4. `views.tsx` (generic views); move the generic parts out of `panels.tsx`.
5. Buck adapter onto the contract (energy into `dcdcEnergy`); Buck suites green.
6. Rectifier adapter onto the contract (energy into `rectifierEnergy`); retire `PathPanel` and the
   rectifier `EventsView` / `EventDetail` / `InspectPanel` from the shell path; rectifier suites green.
7. `WorkspaceShell` renders `WorkspaceModel`: standard actions, Focus and level rules, `notice`.
8. Change circuit carry + notice.
9. Level and Focus alignment (A5.3–A5.5), Shift + ← →, event → cursor rule.
10. CSS: move `rx-*` into `src/styles/rectifier-shell.css`; remove only proven-dead `index.css` classes
    (one by one, with grep for template use, the full suite and screenshots).
11. **Tests:**
    - Unit contract tests on real runs: cursor (re-reading never calls `simulate`), events (real
      timestamps, landing sample shows the new state), path, inspector, Analyze, WHY + next, carry, levels,
      Focus.
    - Browser: run id unchanged on cursor moves and changed on a parameter change; the same Focus and
      level matrix asserted for both labs; carry notice.
    - Then all ten suites, the build, timings and screenshots.
12. Docs (this file) + README counts.

### Files I intend to change

| Area | Files |
|---|---|
| Workspace | `src/workspace/WorkspaceShell.tsx`, `panels.tsx`, `TopicShell.tsx`, `useTopicWorkspace.ts`; **new** `contract.ts`, `views.tsx`, `carry.ts` |
| Rectifier adapter | `src/rectifier/RectifierShell.tsx`, `analyze.tsx`, `src/App.tsx`, `src/workspaces/rectifiers.tsx`; **new** `src/rectifier/energy.ts`; `src/inspect/inspect.ts` (adds the common `now` fields, values from the same trace) |
| Buck adapter | `src/topics/dcdc.tsx`, `src/converters/dcdc/explain.ts` (adds `dcdcEnergy`, `dcdcPath`, event mapping — wording and arithmetic moved from the view) |
| Sweep | `src/components/dcdc/DcdcViews.tsx` (progressive sweep; `DcdcEnergy` delegates); `src/converters/dcdc/theory.ts` (**cache only**); `src/converters/expm.ts` (**only if approved; bit-identical**) |
| Types | `src/lab/types.ts` (optional `primaryChannels`, `parts`/inspection shape) |
| Styles | `src/styles/workspace.css`, **new** `src/styles/rectifier-shell.css`, `src/styles/index.css` (proven-dead rules only) |
| Tests | `tests/controlled.test.ts` (split only); **new** `tests/workspace-contract.test.ts`, `tests/expm.identity.test.ts`, `tests/dcdc-exact.snapshot.test.ts`; `scripts/smoke-workspace.mjs`, `smoke-rectifier-shell.mjs`, `smoke-dcdc.mjs` and the four rectifier suites where a view's selectors change |
| Docs | `docs/WORKSPACE-SHELL-PLAN.md`, `README.md` |

### What I will NOT change

- Any simulation, circuit, measurement or theory equation:
  - `src/simulation/`, `src/circuits/`, `src/measurements/`;
  - `converters/engine.ts`, `pwl.ts`, `dcdc/model.ts`, `dcdc/measure.ts`;
  - the theory formulas.
- The golden values.
- Other labs and topics (Boost, Buck-boost, PWM, inverters, control, devices, drives, magnetics, thermal,
  EV), the catalogue, Home and pages, the router.
- The circuit diagrams' drawing, the phone circuit, both scopes' rendering.
- Lesson, challenge and experiment content.
- Git: no commit.

## A11. Decisions needed

1. **`expm` speed-up** (shared by 8 modules; bit-identical, proven by test): approve, or keep the
   Buck-only cache (DCM sweep about 5 s instead of about 1 s). *Recommended: approve.*
2. **Current path = toggle** (highlight + path line + "why this path" reasons) in both labs. The
   rectifier's path panel is retired. *Recommended.*
3. **One generic Energy view** (signed ledger + stores + balance) for both. Buck's "power flow now" list
   becomes the ledger. *Recommended.*
4. **One generic Analyze table** (SIMULATION / THEORY / error, formula at Engineer, assumptions). The
   rectifier's approximation rows and notes go into assumptions and extras. *Recommended.*
5. **Levels never remove:** Energy at Beginner (rectifier), Timing at every level. *Recommended.*
6. **Primary waveform in Focus:** Buck `[gate, vout]`, Rectifier `[vin, vout]`. *Recommended.*
7. **Carry values between circuits within the session,** route values winning, with a notice.
   *Recommended.*

## Phase 4 — as built

### The simplified workspace (what a student sees)

| Region | Contents |
|---|---|
| Header | circuit name + "Change circuit ▾" · Explore · Learn · Experiment · "More ▾" (Predict, Challenge, Reverse, Compare) · level · back link |
| Parameters | Basic only (Buck: Vin, fs, D, R · Rectifier: load, Dfw where it fits, source, R, α when there are SCRs); Advanced folded; a sheet on phones |
| Circuit | the existing renderers, clean (live numbers at Engineer only); click a part → its inspector |
| Status line | one line from the simulated state: "SWITCH ON · inductor charging (iL rising) · diode OFF", "T1 CONDUCTING · current flows to the load" (+ Vo, Io from Standard); click → State details |
| Actions | **WHY** (primary) and **Explore ▾** — on phones a sticky bar: Parameters · WHY · Explore |
| Waveforms | the primary channels (Buck: Gate, Vout, iL · Rectifier: Vin, Vout, Io / phases + Vo + Io); "+ Add waveform"; Beginner: play / step only |

**WHY** answers in four parts — *What is happening? · Why? · Physical principle (+ equation) · What happens
next?* — read from the simulated state at the cursor; "Go to t = …" moves the cursor to the real event it
quotes; "More detail" holds the rest (Buck: other questions, what-if; Rectifier: the full causal chain,
the Physics Lens, the SCR firing Q&A). It is absent while a mode hides the answers (Predict sketch, Reverse).

**Explore ▾** holds everything else, unchanged in substance: Show current path (an overlay + the loop
under the status line, "Why this path?") · Inspect a component · State details · Energy · Switching
events · Measurements & theory · Lessons · Focus view. The side column exists only while a panel or the
current mode's activity (lesson, experiment…) is open — otherwise the circuit takes the width.

**Merged / moved:** context tabs (State · Why · Learn · Energy) → WHY + Explore; Physics Lens + firing
panel → WHY "More detail"; Measurements + Theory → "Measurements & theory"; current-path panel → overlay;
the six-button action row → WHY + Explore; Focus button → Explore; practice modes → "More".
**Removed (redundant UI only):** EnergyPanel, PathPanel, the rectifier EventsView / EventDetail /
InspectPanel, MeasurementsPanel tabs, MeasurementTable (their content is in the generic views);
110 dead CSS rules (selectors whose classes no source references, checked one by one).

### Shell, adapters, contract

- **WorkspaceShell** (layout only): regions, header with modes + "More", WHY + Explore action bar, side
  column on demand, overlays (dock / drawer / sheet), Focus view (filters `secondary` tools, hides the
  parameters column), the optional notice, `data-run-id`. No lab code, no electrical value.
- **contract.ts**: `WorkspaceCursor`, `StatusInfo`, `CurrentPath`, `WorkspaceEvent`, `NextConsequence`,
  `WhyQuestion`, `ComponentInspection`, `AnalysisRow` / `AnalysisCategory`, `EnergyModel`.
- **views.tsx** renders them for every lab: `StatusLine` (+ path), `WhyView`, `InspectorView`,
  `EventsView`, `AnalyzeView` (SIMULATION · THEORY · error, formula at Engineer, assumptions), `EnergyView`,
  `CarryNotice`.
- **Adapters** (`TopicShell` for Topics such as Buck; `RectifierShell` + App for the rectifier) translate
  domain data into those shapes; the domain produces every number: `dcdcEnergy`, `dcdcNextConsequence`
  (converters/dcdc/explain.ts); `rectifierEnergy` (explanations/energy.ts, moved unchanged out of the old
  view), `rectifierWhy`, `rectifierNextConsequence`, `rectifierStatus` (explanations/status.ts).
- **Master cursor**: one stored run per parameter set; the cursor re-reads it. `runId` changes only when
  the simulation runs again (unit test: 200 instants × every region → 0 new runs, both labs; browser:
  `data-run-id` unchanged on cursor moves, changed on a parameter change).
- **Event → cursor rule** (both labs): the first sample after the event's own time that the trace confirms
  shows the new state (Buck gained the confirmation the rectifier had). An event exactly at the end of the
  run has no later sample.
- **Energy** is a ledger of signed element powers of the same sample; Σp ≈ 0 is a real check (Buck now
  books switch, diode, winding and ESR losses individually — no element is a remainder; |Σp| ≈ 1e-16 of
  the largest power).
- **Change circuit** (`workspace/carry.ts` + `rectifier/carry.ts`): values kept where the new circuit uses
  them, the rest remembered and listed ("Not used here: α = 60° (no SCRs in this circuit)"), the address's
  own values (entry points) win.
- **Levels**: nothing is removed at any level. Beginner: Basic parameters, clean circuit, primary waveforms,
  short status, WHY. Standard: + Vo/Io in the status, waveform presets, layout, step size and speed.
  Engineer: + circuit numbers, Advanced open, formula column, assumptions and derivations open. Energy and
  Timing are available at every level in both labs.

### Performance and flaky-test findings

- **Buck duty sweep**: 19.3 s → **0.75 s** (DCM, exact solution, Node); CCM 9.9 s → 0.53 s; in the browser
  ≈ 1.05 s, computed one point per task (the click returns in ≈ 47 ms; progress "n / 17"). Two changes,
  both bit-identical: an allocation-free `expm` (same operations, same order; 80 → 5 µs per call; shared by
  every PWL module, which all got faster) and a per-call flow cache in `dcdcExact` (73–80 % of its DCM
  exponentials were repeats). Guarded by `tests/expm.identity.test.ts` (5 000 random matrices vs the frozen
  original, `Object.is`) and `tests/dcdc-exact.snapshot.test.ts` (30 cases recorded before the change). The
  smoke click timeout is back to the default. The full unit suite went from 43–63 s to ≈ 34 s.
- **Flaky controlled test**: class **B (performance / load)**, from host contention (that run took 5 min 50 s
  instead of < 1 min). Simulation results are bit-identical across processes; no isolation issue. Fixed
  structurally: 42 `it.each` cases (each ≈ 0.5 s, own time budget, failures name the circuit); no timeout
  was raised.

### Verification

- Unit tests: **910** (817 + 41 from the split + 35 bit-identity + 17 contract). Golden rectifier numbers
  unchanged.
- Browser: **10 suites, 614 checks** (Buck shell 109, rectifier shell 84, DC-DC 67, …); visual matrix
  11 views × 1440/1024/820/768/390/375: no page-wide overflow, no console errors.
- Build: no warnings; Home 269.2 kB (83.2 kB gzip, +0.1 kB); main CSS 75.6 → 67.1 kB.

### Known limitations and remaining debt

- Phone circuit: legible width with sideways scroll inside its card; a portrait renderer is a separate task.
- Two scopes (LabScope, rectifier Scope) and two parameter panels remain domain renderers.
- The LabShell (Boost, Buck-boost, other labs) still uses its own `DcdcEnergy` (loss as a remainder) until
  those labs move to the shell.
- WHY for the rectifier shows one question (the explainer's chain); Buck shows several. Both follow the
  same four parts.
- `CompareView` / `FiringPanel` counterfactual runs recompute when their panel remounts.

## Phase 5 — as built: every lab in the universal workspace shell

**Scope:** DC-DC Boost and Buck-boost, PWM lab, Inverters (single-phase, three-phase six-step, SPWM, SVPWM),
Switching Devices (MOSFET), Magnetics (gapped inductor), Control (buck and boost voltage loops), Drives
(DC motor), Losses & Thermal, EV (drivetrain, 0–100). No physics, theory or lesson content changed: every
lab is the same `Topic` it was, rendered by `TopicShell` instead of the old `LabShell`.

**What a student sees in every lab:** the same workspace as Buck and the rectifiers — header (circuit,
Change circuit, Explore · Learn · Experiment · More), Basic parameters (+ Advanced), the lab's own circuit,
one status line (the lab's state, e.g. "VOLTAGE FALL (MILLER PLATEAU)", "CLOSED LOOP REGULATING"), WHY in
four parts, one Explore menu, the waveforms.

**Generic adapter behaviour added for topics that do not provide the newer optional fields:**
- *What happens next*: the run's next detected event after the cursor in the topic's own words
  (`eventLabel`, `eventWhy`), with its real time and "Go to"; omitted when the run has none ahead (drives,
  0–100 at its end).
- *Current path*: the topic's diagram highlights it; the line under the status quotes the state's own path text.
- *The lab's own view* (`energy` + `energyLabel`): Explore lists it under its label — Energy, Spectrum, Bode,
  Zth, B–i; chart views dock wide under the circuit; the eyebrow says "Power at this instant" only for the
  shared instantaneous ledger.
- *Measurements & theory* for topics without categories: Overview (the lab's run badge/summary), one
  category per analysis tab (e.g. Spectrum, Devices, Bode), Theory vs Simulation (rows, textbook table,
  derivation, numerical checks with the convergence run).
- *State details*: the state card, the run summary/badge (Standard), Δt / sample and the steady-state and
  compute diagnostics (Engineer).
- *Focus view*: the first two default channels are the primary waveforms unless the topic names them.

**DC-DC:** Boost and Buck-boost use the same shell configuration as Buck (`dcdcShellTopic(kind)`: Basic Vin,
fs, D, R; categories; parts; energy ledger; path; next consequence). The status wording is per converter
("diode feeds the output" for boost / buck-boost instead of the buck's "diode freewheeling").

**Removed:** `components/lab/LabShell.tsx`, `workspaces/topicWorkspace.tsx`, `workspaces/dcdc-shell.tsx`, the
catalogue's `workspace: 'shell'` flag and the second loader table (every route opens the shell), the old
lab's `AnalyzePanel`, `WhyPanel` and `Inspector`, and the CSS only they used (21 rules in dcdc.css; 16 more
across the other stylesheets — each class proven unreferenced).

**Verification (laptop):** 910 unit tests; 10 browser suites, 623 checks (smoke-inv and smoke-modules now
drive the shell; smoke-modules checks WHY's four parts in every module); all 15 migrated topics opened at
1440 / 1280 / 1024 px — status, WHY, the lab's view and Measurements & theory present, every theory row ✓,
no page overflow, no console errors. Build: no warnings; Home 268.3 kB (83.1 kB gzip).

**Remaining:** some lab diagrams print their own values at every level (e.g. the EV battery and speed — the
diagram's subject); the inverter topics take 2–4.5 s to simulate on open (unchanged from before); Predict is
under "More" for every lab.

