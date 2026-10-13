# UI architecture redesign — plan

Status: **Approved. Phases 1–5 implemented** (listed below). Section 1 audits the app as it was *before* the redesign (`Platform.tsx`, `LabShell`, `#dcdc` routes, phone sheets): it is history, not the current design — for that see the README and docs/WORKSPACE-SHELL-PLAN.md.
- Phase 1: global navigation, Home, Labs catalogue, landing pages, routing, READY / COMING SOON,
  Continue learning, learning path, search, Settings, responsive navigation.
- Phase 2: the universal workspace shell, with Buck as the reference.
- Phase 3: the Rectifier Lab migrated into the shell. Its physics is unchanged, and golden numbers are
  frozen in tests.

- Phase 4: the shell stabilized (one workspace contract for both labs) and the workspace simplified:
  four regions, one status line, WHY + one Explore menu.

- Phase 5: every remaining lab (DC-DC Boost and Buck-boost, PWM, Inverters, Devices, Magnetics, Control,
  Drives, Losses & Thermal, EV) moved into the same workspace; the old lab layout is gone.

Details are in docs/WORKSPACE-SHELL-PLAN.md. The app targets laptops.

Approved decisions: "Engineering" is the practice area and the thermal lab is **Losses & Thermal**;
the learning path is a recommendation in the order of §3; modes a lab does not have are hidden (no
greyed-out buttons inside a workspace, planned items appear only as COMING SOON on landing pages);
Analyze becomes an action-bar panel (Phase 4); opening a circuit runs it (no Run step, a one-time hint
replaces the 6-step guide); a hand-written hash router (`#/home`, `#/labs/...`, `#/engineering/...`,
`#/progress`, `#/settings`). The final lab grouping follows the approval: Conversion (Rectifiers, DC-DC,
PWM, Inverters), Foundations (Switching Devices, Magnetics, Control), Systems (Drives & Motors, Losses &
Thermal, EV); Power Quality is not listed for now.
Scope: navigation, information architecture, workspace structure and progressive disclosure.
The simulation engines, solvers, device models and theory are **not** in scope.
Every phase must keep all 757 unit tests and all 336 browser checks green, with the browser tests
updated only where a flow intentionally changes.

Goal: *make a very powerful engineering simulator feel extremely simple.*

---

## Contents

1. [What exists today (audit)](#1-what-exists-today-audit)
2. [Current problems](#2-current-problems)
3. [Design principles and decisions](#3-design-principles-and-decisions)
4. [Proposed information architecture](#4-proposed-information-architecture)
5. [Navigation and routes](#5-navigation-and-routes)
6. [Home dashboard](#6-home-dashboard)
7. [Lab landing pages and module hierarchy](#7-lab-landing-pages-and-module-hierarchy)
8. [The universal simulation workspace](#8-the-universal-simulation-workspace)
9. [Progressive disclosure model](#9-progressive-disclosure-model)
10. [Engineering area](#10-engineering-area)
11. [Wireframes](#11-wireframes)
12. [User journeys](#12-user-journeys)
13. [Component hierarchy and reuse](#13-component-hierarchy-and-reuse)
14. [State management](#14-state-management)
15. [Responsive strategy](#15-responsive-strategy)
16. [Accessibility](#16-accessibility)
17. [Performance](#17-performance)
18. [Testing strategy](#18-testing-strategy)
19. [Migration plan and phases](#19-migration-plan-and-phases)
20. [Risks and possible regressions](#20-risks-and-possible-regressions)
21. [Validation checklist](#21-validation-checklist)
22. [Decisions needed from you](#22-decisions-needed-from-you)

---

## 1. What exists today (audit)

### 1.1 Architecture

```
main.tsx → Platform.tsx (module bar, #hash routing by module id)
  ├─ #(none)  → App.tsx — the Rectifier lab (760 lines; own header, reducer, 7 modes)
  ├─ #dcdc    → DcdcLab → LabShell (Buck · Boost · Buck-Boost · Advanced[disabled])
  ├─ #pwm     → LabShell (PWM lab)
  ├─ #inverters → LabShell (Single-phase · Three-phase · SPWM · SVPWM)
  ├─ #devices → LabShell (MOSFET switching)
  ├─ #drives  → LabShell (DC motor drive)
  ├─ #magnetics → LabShell (Gapped inductor)
  ├─ #control → LabShell (Buck voltage loop · Boost voltage loop)
  ├─ #ev      → LabShell (EV drivetrain)
  └─ #engineering → LabShell (Losses & thermal)
```

There are **two workspace shells**:

| | Rectifier lab (`App.tsx`) | All other labs (`components/lab/LabShell.tsx`) |
|---|---|---|
| Physics | `simulation/engine.ts` + `circuits/netlist.ts` (MNA, diode/SCR search) | `converters/*` per topic (netlist engine, PWL toolkit, RK4) via the `Topic` interface |
| State | `useReducer(labReducer)` in `state/labState.ts`; modes in `state/useModes.ts` | local `useState` in `TopicLab`; params kept in a module-level `paramStore` map |
| Modes | Explore, Learn, Experiment, Predict (What-if + Sketch), Challenge, Reverse, Compare | Explore, Learn, Experiment, Predict, **Analyze** |
| Density | Beginner / Standard / Engineer, persisted (default Standard) | Beginner / Standard / Engineer, **not** persisted (default Beginner) |
| Focus mode | yes | no |
| Circuit choice | in the header: section + 6 rectifier buttons + 4 loads + "Run simulation" | sub-navigation tabs per topic |
| Right panel | tabs State · Why · Learn · Energy (+ mode tab) | state card always + badge + tabs Why · Energy/Spectrum/Bode/B–i/Zth · Inspect |
| Analysis | drawers: Measurements (sheet), Theory & equations (sheet) | Analyze **mode** (compare table, theory, tabs, convergence) |
| Inspect | toggle, then click a part → drawer | click a part → Inspect side tab |
| Events | scope "Events" view + event drawer | event markers + event card in the right column |
| Extras | Angle view, Physics Lens, step-through, With/without Dfw, "What do you want to study?" select, 6-step guide strip | Side-tab chart (Spectrum, Bode, B–i, Zth, energy), status badge |
| Scope | `components/Scope.tsx` (presets, overlay/grouped/separate, conduction shading) | `components/lab/LabScope.tsx` (lanes, add channel, zoom-to-ripple) |
| Progress | `localStorage`: lessons done, challenge stars, best prediction | none |

The rule "one simulation state per workspace" is already met in both shells. Every panel reads
the same run. Nothing in the UI computes physics. The redesign must preserve this.

### 1.2 Feature map (what must stay reachable)

| Lab | Topics / circuits | Modes and tools available today |
|---|---|---|
| **Rectifiers** | Single-phase: half-wave, center-tap, bridge. Controlled: half-wave, semi-controlled, fully controlled. Three-phase: 3-pulse, 6-pulse, 3-pulse controlled, half-controlled, fully controlled. Loads R, RL, RC, RLC. Freewheeling diode; firing angle α; source R/L; commutation overlap μ; faults | 13 lessons, 9 challenges, What-if + Sketch prediction, Reverse, Compare (two rectifiers on a declared basis), Experiment (before/after, fault injection, guided freewheel experiments), Physics Lens, Angle view, step-through, With/without Dfw, Measurements, Theory, Energy, Events |
| **DC-DC** | Buck, Boost, Buck-Boost (Advanced: planned) | 5 LabShell modes; CCM/DCM card; energy; steady state / start-up |
| **PWM** | PWM lab (carrier, reference, natural/regular sampling, bits, dead time, unipolar/bipolar) | 5 modes; Spectrum side tab |
| **Inverters** | Single-phase (half/full bridge, square/quasi-square), Three-phase six-step, SPWM, SVPWM | 5 modes; Spectrum; space-vector hexagon |
| **Devices** | MOSFET double-pulse test | 5 modes; switching-loss card |
| **Drives** | DC motor on a 1Q/2Q chopper | 5 modes; energy / power flow |
| **Magnetics** | Gapped inductor with saturation | 5 modes; B–i chart |
| **Control** | Buck and boost voltage loops (PID) | 5 modes; Bode chart |
| **EV** | Drivetrain on urban/highway cycles, 0–100 km/h | 5 modes; energy breakdown |
| **Engineering** (today) | Losses & thermal (Foster network, runaway) | 5 modes; Zth chart |
| **Power quality** | — not built | Spectra/THD exist in PWM and Inverters only |
| **Design / Fault diagnosis / Interview** | — not built | Rectifier Challenge tasks are design-like; rectifier faults exist in Experiment |

---

## 2. Current problems

Each problem was observed in the running app at 1440 px and 390 px. The screenshots were taken
during the audit.

1. **There is no home.** The app opens on the Rectifier lab. A new user lands on 32 interactive
   controls in the first 240 px:
   - 10 module tabs;
   - 2 section tabs;
   - 6 rectifier buttons;
   - 4 load buttons;
   - Run;
   - a 6-step guide.

   Nothing answers *"what can I do here?"*
2. **Ten flat, equal module tabs.** There is no grouping and no description; all are presented as
   equally ready. On a phone only 3 tabs are visible; the rest scroll off-screen with no cue.
3. **"Engineering" means two things.** Today it is the losses-and-thermal lab. The brief wants it
   to be the advanced practice area (design, faults, interview).
4. **Circuit selection is fused with the workspace.** In Rectifiers the circuit picker lives
   permanently in the workspace header, next to the modes and the density switch. Selection and
   study compete for attention all the time.
5. **Two different workspaces.** A student moving from Rectifiers to DC-DC meets:
   - different mode sets (Challenge/Reverse/Compare vs Analyze);
   - a different right panel;
   - a different place for density;
   - a different Inspect behaviour;
   - a different scope toolbar.
6. **Duplicated information.** In the Rectifier Engineer view, Vo and Io appear three times: on the
   circuit labels, in the state strip, and in the state card. The state card shows 13 value tiles
   at once. WHY exists as a tab and as a drawer. Lessons exist as a Learn mode and as a Learn tab.
7. **Analysis is in two different forms**: drawers in Rectifiers, a mode in the other labs.
8. **Topology and modulation are mixed.** In Inverters, "Single-phase · Three-phase · SPWM · SVPWM"
   are sibling tabs, mixing *what circuit* with *how it is switched*.
9. **Small screens are stacked, not reflowed.**
   - The rectifier page is 2 430 px tall at 390 px wide.
   - The circuit renders about 300 px wide.
   - The parameters are at the very bottom.
   - Mode tabs and module tabs scroll off-screen.
   - The Inverters page overflows horizontally by 3 px.
10. **Progress is invisible.**
    - Rectifier lesson completion is stored, but nothing shows it outside the lesson list.
    - Other labs record nothing.
    - There is no "continue where I left off".
11. **There is no search.** Some content is findable only by knowing where it lives, for example
    commutation overlap (a three-phase drawer tab) or SVPWM (Inverters, fourth tab).
12. **One 1 MB bundle.** Every engine loads before the first screen. A home page would pay for
    all ten labs.
13. **Uneven honesty cues.** DC-DC shows a disabled "Advanced" tab. Other unbuilt items (Power
    quality, IGBT/SiC/GaN, transformer, BLDC/PMSM/induction) simply don't exist in the UI, so the
    student cannot tell "not built" from "not there".

What already works well and must be kept:
- the dark instrument aesthetic;
- the circuit as the visual centre;
- live current paths;
- WHY cards generated from the simulation;
- SIMULATION / THEORY labelling;
- density levels;
- Focus mode;
- drawers and sheets;
- deep links.

---

## 3. Design principles and decisions

1. **Home is for navigation; the workspace is for simulation.** Home never shows a waveform,
   parameter or measurement.
2. **Choose, then study.** Circuit selection happens on the lab landing page. The workspace shows
   one circuit, plus a quiet "change circuit" control.
3. **One workspace shell for every lab.**
   - The same regions, the same mode bar order, the same action bar.
   - The same right-panel tabs, the same drawers, the same Analyze sheet.
   - Labs differ only in content.
4. **Modes are learning activities; analysis is a tool.**
   - Modes: Explore, Learn, Experiment, Predict, Challenge, Reverse, Compare.
   - **Analyze** becomes a sheet opened from the action bar in every lab. Today's LabShell Analyze
     *mode* moves there unchanged.
5. **Every piece of information has one owner** (§9.3). Other places may *link* to it, never
   repeat it.
6. **Honest status everywhere.** One catalogue file declares every lab and topic with
   `ready | in-development | coming-soon`. A unit test fails if a `ready` item does not resolve to
   a working workspace.
7. **The URL says where you are.** Lab, topic, circuit, load and mode are in the route. Back
   always works, and every place can be bookmarked, resumed and searched.
8. **No physics changes.** Workspaces keep their engines, reducers and topics.

Where this plan departs from the brief, deliberately:

| Brief | Plan | Why |
|---|---|---|
| Learning path starts with Devices | Rectifiers → DC-DC → PWM → Inverters → Devices → Magnetics → Control → Drives → Losses & Thermal → EV | The only built device lab is a nanosecond MOSFET double-pulse test (Miller plateau). It is a poor first lesson; rectifiers teach "a device conducts or not" with the least prerequisite. |
| Analyze as a mode | Analyze as a sheet (tool) | Measurements and theory belong to *any* mode. A student in Learn or Experiment should open them without leaving the activity. |
| Show all seven modes everywhere | Same order everywhere; **hide** modes a lab does not have yet (Challenge/Reverse/Compare exist only for Rectifiers) | Nine labs with three permanently disabled tabs add noise, not consistency. The order and position stay fixed. |
| "Engineering" lab of losses | Rename to **Losses & Thermal** (Labs); **Engineering** becomes the practice area | Removes the name collision (problem 3). |
| Power Quality lab | Listed as **Coming soon**, with links to the spectra that exist (PWM, Inverters) | No PF/THD-of-input-current analysis exists yet; showing it as ready would break trust. |

---

## 4. Proposed information architecture

```
POWER ELECTRONICS LAB
├─ Home                      what can I do · continue · quick start · labs · learning path · recent
├─ Labs                      every lab, grouped
│   ├─ Conversion
│   │   ├─ Rectifiers                  AC → DC                     READY
│   │   ├─ DC-DC converters            DC → DC                     READY (advanced: COMING SOON)
│   │   └─ Inverters                   DC → AC                     READY
│   ├─ Foundations
│   │   ├─ PWM                         switching and modulation    READY
│   │   ├─ Switching devices           MOSFET switching            READY (diode, SCR, IGBT, SiC, GaN: COMING SOON)
│   │   └─ Magnetics                   inductor and saturation     READY (transformer: COMING SOON)
│   └─ Systems
│       ├─ Control                     closed-loop converters      READY
│       ├─ Drives & motors             DC motor drive              READY (BLDC, PMSM, induction: COMING SOON)
│       ├─ Losses & thermal            losses → junction temp.     READY
│       ├─ EV power electronics        battery → motor → wheels    READY (battery/BMS detail: COMING SOON)
│       └─ Power quality               PF, harmonics, THD          COMING SOON
├─ Engineering               practice for advanced students
│   ├─ Challenge                       design tasks (rectifiers)   READY
│   ├─ Reverse engineering             identify a circuit          READY
│   ├─ Fault diagnosis                 find a hidden fault         COMING SOON (fault injection exists in Rectifier › Experiment)
│   ├─ Design                          requirement → validated design   COMING SOON
│   └─ Interview                       question → simulate → answer     COMING SOON
├─ Progress                  lessons done, challenges, where you left off (from local progress)
├─ Search (Ctrl/⌘ K)         labs, circuits, topics, lessons, experiments, concepts
└─ Settings                  information level (Beginner / Standard / Engineer), reduced motion
```

Statuses are honest as of commit `33c5e87`. "In development" is reserved for work actually under
way when the catalogue is edited; at the start of Phase 1 nothing is in that state.

---

## 5. Navigation and routes

### 5.1 Global navigation

```
[⏚ Power Electronics Lab]   Home   Labs ▾   Engineering   Progress         [🔍 Search  Ctrl K]  [⚙]
```

- **Brand** links to Home.
- **Labs ▾** opens a compact menu with the 3 groups and 11 labs; each row has a one-line purpose
  and a status. Clicking "Labs" itself opens the Labs page.
- **Settings ⚙** holds the information level (global, persisted) and reduced motion.
- **Inside a lab** a breadcrumb sits under the bar: `Labs › Rectifiers › Three-phase fully
  controlled bridge`.
- **In the workspace** there is also a `← Rectifiers` back link. Back always returns to the
  landing page, not to the previous parameter state.

### 5.2 Routes

An in-house hash router (about 120 lines, no dependency). Hash routing works on static hosting,
and the app already uses hashes.

| Route | Screen |
|---|---|
| `#/` | Home |
| `#/labs` | Labs index |
| `#/labs/:lab` | Lab landing page |
| `#/labs/:lab/:topic` | Workspace (Explore) |
| `#/labs/:lab/:topic/:mode` | Workspace in a mode (`learn`, `experiment`, `predict`, `challenge`, `reverse`, `compare`) |
| `?load=RL&alpha=30&lesson=…&sheet=measure` | Optional query: initial load/preset, an opened lesson, an opened sheet |
| `#/engineering`, `#/engineering/:area` | Engineering area |
| `#/progress` | Progress |
| anything else | "Page not found" with links to Home and Labs |

Lab and topic ids:
- `rectifiers/{1ph-half-wave, 1ph-center-tap, 1ph-bridge, 1ph-half-wave-scr, 1ph-semi, 1ph-bridge-scr, 3ph-3pulse, 3ph-6pulse, 3ph-3pulse-scr, 3ph-half-controlled, 3ph-bridge-scr}`
- `dcdc/{buck, boost, buck-boost}`
- `pwm/lab`
- `inverters/{1ph, 3ph, spwm, svpwm}`
- `devices/mosfet`
- `drives/dc-motor`
- `magnetics/inductor`
- `control/{buck, boost}`
- `thermal/switch`
- `ev/drivetrain`

**Redirects (old deep links keep working):** `#dcdc → #/labs/dcdc` (landing), `#pwm`,
`#inverters`, `#devices`, `#drives`, `#magnetics`, `#control`, `#ev` likewise;
`#engineering → #/labs/thermal`; empty hash → Home.

**URL vs state rule:** the URL selects the workspace (lab, topic, circuit, load, mode). The
workspace's own reducer owns everything else (parameters, cursor, channels). Parameters are **not**
mirrored into the URL, which avoids two sources of truth.

---

## 6. Home dashboard

Priority order (from the brief §40): *What can I do? → What should I learn next? → What was I
doing? → Which lab?*

1. **Hero — one activity only.**
   - *Returning user:* "Continue: Three-phase fully controlled bridge · Lesson 2 of 4 ·
     [Continue]". It comes from the last workspace visit; the lesson step is shown when one was
     open.
   - *First visit:* "Explore how power converters actually work. [Start with Rectifiers]".
2. **Quick start — "What do you want to learn?"** Six intent chips, each going to a concrete
   workspace:
   - Convert AC to DC → `rectifiers/1ph-bridge`
   - Convert a DC voltage → `dcdc/buck`
   - Generate AC → `inverters/1ph`
   - Understand switching → `pwm/lab`
   - Control a motor → `drives/dc-motor`
   - EV power electronics → `ev/drivetrain`
3. **Labs** — a compact grid of 11 cards: title, one-line purpose, status, Open. No sub-features.
4. **Learning path** (optional, collapsible) — the ten steps from §3 with ✓ done / → current /
   ○ next. "Done" means every lesson of that lab is completed; this needs lesson tracking for
   LabShell labs (Phase 5). Until then it shows only position, not completion.
5. **Recent** — at most 3 one-line links (workspace + mode).

No badges, points, streaks or XP. The one progress figure is the "Lesson n of m" on Continue.

---

## 7. Lab landing pages and module hierarchy

Every landing page has the same structure:

```
LAB TITLE                                                [status]
One-sentence purpose.
──────────────────────────────────────────────────────────────────
SECTION            topic cards (title · one line · status) → open workspace
SECTION            …
──────────────────────────────────────────────────────────────────
Learn here: n lessons · Related: links to neighbouring labs
```

Per-lab sections, mapped to what exists:

| Lab | Sections → topic cards (route) |
|---|---|
| Rectifiers | **Single-phase:** Half-wave · Center-tapped · Bridge. **Controlled (SCR):** Half-wave · Semi-controlled · Fully controlled. **Three-phase:** 3-pulse · 6-pulse bridge · 3-pulse controlled · Half-controlled · Fully controlled. **Topics:** Freewheeling diode (→ 1ph half-wave RL, Dfw on) · Firing angle (→ 1ph-bridge-scr) · Commutation overlap (→ 3ph-6pulse, Ls > 0, Measurements › Commutation) · Compare two rectifiers (→ compare mode) |
| DC-DC | **Basic:** Buck · Boost · Buck-boost. **Advanced (coming soon):** Ćuk · SEPIC · Zeta · Bidirectional |
| PWM | **Fundamentals:** PWM lab (duty, frequency, average, ripple, spectrum). **Methods:** Carrier vs DC reference → PWM lab · Sine reference (SPWM) → PWM lab · Bipolar/unipolar → PWM lab · Single pulse (quasi-square) → Inverters single-phase · SVPWM → Inverters SVPWM · Multiple pulse (coming soon) |
| Inverters | **Circuit:** Single-phase (half/full bridge) · Three-phase VSI. **Switching:** Square/quasi-square (1ph) · 180° six-step (3ph) · SPWM (1ph/3ph) · SVPWM (3ph) · 120° (coming soon). Phase 1 maps each (circuit, switching) card to today's topic. Phase 7 merges them into "pick circuit, then pick switching" inside one workspace. |
| Switching devices | **MOSFET** (ready: switching). Diode · SCR · IGBT · SiC · GaN (coming soon). Inside a device the sub-tabs are Learn · I-V · Switching · Losses · Compare, with only *Switching* ready for the MOSFET. |
| Magnetics | Inductor (ready) · Transformer (coming soon) |
| Control | **Converter loops:** Buck voltage loop · Boost voltage loop. **Concepts** (presets of the same workspaces): Open loop · P only · PID · Bode / small signal (opens the Bode tab) |
| Drives & motors | DC motor (ready) · BLDC · PMSM · Induction motor (coming soon) |
| Losses & thermal | Switch losses & junction temperature (ready). **Entry points** (presets/lessons of the same workspace): Conduction vs switching loss · Thermal impedance (Zth) · Heatsink · Power cycling · Thermal runaway |
| EV | System diagram as the landing visual: Battery → DC link → Inverter → Motor → Wheels. Drivetrain on a drive cycle (ready) · 0–100 km/h (ready preset) · Battery, BMS, DC-DC, inverter detail (coming soon) |
| Power quality | Coming soon; links to the PWM and Inverter spectra that exist |

"Entry point" cards open an existing workspace with a declared preset (parameters + channels +
an optional lesson). They are listed only when the preset already exists as a lesson or
experiment, or is trivially expressible as parameters. No new physics.

---

## 8. The universal simulation workspace

### 8.1 Regions

```
┌ Workspace bar ─────────────────────────────────────────────────────────────────────┐
│ ← Rectifiers   Three-phase fully controlled bridge · RL ▾ │ Explore Learn Experiment │
│                                                           │ Predict Challenge Reverse│
│                                                           │ Compare      ◎ Focus  ⓘ ▾│
├ Controls (left) ┬ Bench (centre) ─────────────────────────┬ Context (right) ──────────┤
│ BASIC           │ circuit (live current path)            │ [State] Why  Learn  Energy │
│ Vrms, f, R, α   │                                        │                            │
│ Load ▾          │ T1 + T6 conducting · Vo 24.6 V · Io 2.45 A │ one panel at a time     │
│ ▸ Advanced      │ [Path] [Why?] [Inspect] [Analyze ▾] [Energy] [Events]               │
├─────────────────┴────────────────────────────────────────┴───────────────────────────┤
│ Scope dock: ▶ ⟲ ◀ ▶  · channels [va][vb][vc][Vo][Io] [+ Add] · views: Waveforms | Angle | … │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Workspace bar.**
  - Back link to the landing page.
  - The circuit name, with a small "change ▾" listing the sibling topics (no full picker).
  - Load selection moves to the left panel's Basic group.
  - Mode tabs in a fixed order.
  - Focus toggle.
  - An information-level menu (ⓘ ▾) that mirrors the global setting.
- **Controls (left).** Basic parameters only. `▸ Advanced` holds:
  - device model, source impedance, L/C values, ESR;
  - solver settings, steady-state/start-up.

  These come from the existing `ParameterPanel` and `SpecList`.
- **Bench (centre).** The circuit is the focus. Under it:
  - a one-line **status line** (conducting devices, Vo, Io);
  - the **action bar**.
- **Context (right).** Tabs State · Why · Learn · Energy, one visible at a time.
  - **Learn** shows the *active* lesson. With no lesson active, it lists this topic's lessons
    with a Start button.
  - The lab-specific chart (Spectrum, Bode, B–i, Zth) is reached through **Energy** (power flow)
    or as a tab named after its chart. This keeps the existing `energyLabel` mechanism.
- **Scope dock (bottom).**
  - Transport controls.
  - Essential channels only, plus `+ Add channel`.
  - Views (Waveforms; Angle view for three-phase; With/without Dfw).

### 8.2 Action bar (identical in every lab)

`⇢ Current path · WHY? · 🔎 Inspect · Analyze ▾ (Measurements · Theory vs simulation · Theory · Numerics) · ⚡ Energy · Events`

- Path, Inspect and Events open **drawers**.
- Analyze opens a **sheet** with tabs.
- WHY and Energy select the right tab; in Focus or on mobile they open a drawer.

Nothing in the action bar grows the page height.

### 8.3 Modes (fixed order, shown when the lab has them)

| Mode | Rectifiers | Other labs | Where its panel lives |
|---|---|---|---|
| Explore | ✓ | ✓ | default |
| Learn | ✓ (13 lessons) | ✓ | Learn tab (right) + lesson stepper in the bar |
| Experiment | ✓ (before/after, faults, guided) | ✓ | right panel replaces State |
| Predict | ✓ (What-if, Sketch) | ✓ | right panel; answers hidden until revealed |
| Challenge | ✓ (9) | — hidden | right panel |
| Reverse | ✓ | — hidden | right panel; circuit hidden |
| Compare | ✓ (two rectifiers) | — hidden | full-width compare layout |

### 8.4 Focus mode

The same in every lab. It shows:
- the circuit;
- the primary waveform (one lane);
- the status line;
- play/pause;
- WHY;
- Current path.

It hides the left panel, the right panel, extra channels and the breadcrumb. Focus is a
*temporary* view; the information level is a *standing* preference.

---

## 9. Progressive disclosure model

### 9.1 The ladder

| Step | What the student does | What appears |
|---|---|---|
| **See** | opens a circuit | circuit + primary waveform + status line; it runs immediately (no separate Run step) |
| **Understand** | presses WHY? or moves the cursor | WHY card for this instant; current path |
| **Interact** | changes a Basic parameter | the same views update; nothing new appears |
| **Inspect** | clicks a component | an Inspect drawer for that part only |
| **Analyze** | opens Analyze | the Measurements / Theory vs simulation / Theory / Numerics sheet |
| **Experiment** | switches to Experiment / Predict | the mode panel replaces the State tab |
| **Master** | Challenge, Reverse, Engineering area | tasks without hand-holding |

### 9.2 Information levels (one global setting)

| | Beginner | Standard | Engineer |
|---|---|---|---|
| Left panel | Basic | Basic + Load | Basic + ▸ Advanced open |
| Circuit labels | device states only | + key values | + every value |
| State tab | headline + Vo, Io | + device states | + every instantaneous value |
| Channels | 2–3 essentials | + device/stored-energy channels | everything addable shown in `+ Add` |
| Action bar | Path · WHY · Inspect | + Analyze · Energy | + Events · numerical details |
| Side chart | — | ✓ | ✓ |

This one setting replaces the two separate density states. The rectifier key
`rectifier-lab.density` is migrated, so its existing value wins.

### 9.3 Information ownership

| Information | Owner (one home) | May link from |
|---|---|---|
| Circuit topology, live current path | Bench | — |
| Conducting devices, Vo, Io *now* | Status line (one line) | State tab expands it |
| Every instantaneous value | State tab | Inspect (per part) |
| One component's values | Inspect drawer | — |
| Waveforms | Scope dock | — |
| Measurements (averages, RMS, ripple, stresses, losses) | Analyze › Measurements | badge on Analyze when a check fails |
| Theory vs simulation | Analyze › Theory vs simulation | — |
| Equations / derivations | Analyze › Theory | WHY "equation" line |
| Causal explanation | WHY | event drawer reuses the event WHY |
| Lessons | Learn (mode + tab) | Home "Continue", Search |
| Experiments, predictions, challenges | their mode panel | Search |
| Energy flow | Energy tab | — |
| Events (switching instants) | Events drawer + scope markers | — |

Duplicates removed by this rule:
- Vo/Io printed on the circuit at Standard (kept only at Engineer);
- the 13-tile state grid (moves under "All values" in the State tab, Engineer only);
- the rectifier "Learn" tab *list* (becomes the active-lesson view);
- LabShell's Inspect side tab (becomes the Inspect drawer);
- the rectifier "What do you want to study?" select. Its eight intents become landing-page entry
  points and search entries, so none is lost.

---

## 10. Engineering area

A separate area for advanced students, never mixed into labs.

| Area | What it is | Status | Source |
|---|---|---|---|
| Challenge | task → design → simulation checks it → stars | READY (Rectifiers, 9 tasks) | `challenges/challenges.ts` |
| Reverse engineering | waveforms only → identify the circuit | READY (Rectifiers) | `reverse/reverse.ts` |
| Fault diagnosis | hidden fault → investigate → diagnose → explain → verify | COMING SOON — rectifier fault *injection* exists and is the foundation | `types/simulation.ts` `FaultSpec` |
| Design | requirements → design → components → simulation → validation → PASS / WARNING / FAIL | COMING SOON (first: 48 V → 12 V, 10 A buck) | DC-DC buck topic + measurements |
| Interview | question → simulate → your answer → evaluation → explanation | COMING SOON | lab predictions/experiments as the question bank |

In Phase 1, Challenge and Reverse cards open the Rectifier workspace in that mode. The area pages
for the coming-soon items show what they will be. They have no fake interactive content.

---

## 11. Wireframes

Text wireframes at desktop width. §15 gives the narrow-screen reflow.

### 11.1 Home

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ⏚ Power Electronics Lab    Home  Labs ▾  Engineering  Progress     🔍 Search Ctrl K  ⚙ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Interactive simulation · learn by seeing · experiment by doing                      │
│                                                                                      │
│  ┌ CONTINUE ───────────────────────────────────────────────┐                         │
│  │ Three-phase fully controlled bridge                     │                         │
│  │ Rectifiers · Learn · lesson 2 of 4      [Continue →]    │                         │
│  └─────────────────────────────────────────────────────────┘                         │
│                                                                                      │
│  WHAT DO YOU WANT TO LEARN?                                                          │
│  [Convert AC to DC] [Convert a DC voltage] [Generate AC] [Understand switching]      │
│  [Control a motor]  [EV power electronics]                                           │
│                                                                                      │
│  LABS                                                                                │
│  Conversion   ┌Rectifiers ──────┐ ┌DC-DC ───────────┐ ┌Inverters ───────┐            │
│               │AC → DC   READY  │ │DC → DC   READY  │ │DC → AC   READY  │            │
│               └─────────────────┘ └─────────────────┘ └─────────────────┘            │
│  Foundations  ┌PWM ─────────────┐ ┌Switching devices┐ ┌Magnetics ───────┐            │
│  Systems      ┌Control ┐ ┌Drives & motors┐ ┌Losses & thermal┐ ┌EV┐ ┌Power quality SOON┐│
│                                                                                      │
│  ▸ LEARNING PATH  1 ✓ Rectifiers  2 → DC-DC  3 ○ PWM  …            (collapsed)       │
│  RECENT  Buck converter · 6-pulse bridge · SCR firing angle                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Lab landing page (Rectifiers)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ⏚ Power Electronics Lab    Home  Labs ▾  Engineering  Progress          🔍       ⚙   │
│ Labs › Rectifiers                                                                    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ RECTIFIER LAB                                                                 READY  │
│ Understand how diodes and controlled devices convert AC into DC.                     │
│                                                                                      │
│ SINGLE-PHASE   [Half-wave       ] [Center-tapped    ] [Bridge            ]           │
│                 one diode, one     two windings,       four diodes, both             │
│                 half-cycle         two diodes          half-cycles                   │
│ CONTROLLED     [Half-wave SCR   ] [Semi-controlled  ] [Fully controlled  ]           │
│ THREE-PHASE    [3-pulse] [6-pulse bridge] [3-pulse SCR] [Half-controlled] [Fully ctl.]│
│ TOPICS         [Freewheeling diode] [Firing angle α] [Commutation overlap] [Compare] │
│                                                                                      │
│ Learn here: 13 lessons · 9 challenges in Engineering · Related: DC-DC, Power quality │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.3 Rectifier workspace (Standard)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ⏚ Power Electronics Lab    Home  Labs ▾  Engineering  Progress          🔍       ⚙   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ← Rectifiers  6-pulse controlled bridge ▾ │ Explore·Learn·Experiment·Predict·        │
│                                          │ Challenge·Reverse·Compare   ◎ Focus  ⓘ ▾ │
├──────────────┬──────────────────────────────────────────────┬────────────────────────┤
│ BASIC        │                                              │ [State] Why Learn Energy│
│ Vrms   230 V │            ~~~ circuit (live path) ~~~       │ T1 + T6 ON              │
│ f       50 Hz│                                              │ Vo 24.6 V   Io 2.45 A   │
│ α       30°  │                                              │ ● T1 ON ● T6 ON ✕ …     │
│ Load  RL ▾   │ T1 + T6 conducting · Vo 24.6 V · Io 2.45 A   │ ▸ All values           │
│ R, L         │ [⇢ Path][WHY?][🔎 Inspect][Analyze ▾][⚡][Events]│                      │
│ ▸ Advanced   │                                              │                         │
├──────────────┴──────────────────────────────────────────────┴────────────────────────┤
│ ▶ ⟲ ◀ ▶ 1×  │ [va][vb][vc][Vo][Io] [+ Add]  │ Waveforms · Angle view                │
│ ─────────────── scope lanes ───────────────────────────────────────────────────────  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.4 DC-DC workspace (Buck, Beginner)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← DC-DC  Buck converter ▾ │ Explore·Learn·Experiment·Predict          ◎ Focus  ⓘ ▾    │
├──────────────┬──────────────────────────────────────────────┬────────────────────────┤
│ BASIC        │        Vin ─Q1─┬─L─┬─── Vout                  │ [State] Why Learn Energy│
│ Vin    24 V  │                D1  C   R                      │ Switch ON interval      │
│ D      50 %  │                                              │ iL 2.00 A ↗  Vout 11.9 V│
│ fs   20 kHz  │ Q1 ON · iL rising · Vout 11.9 V              │ CCM                     │
│ R      6 Ω   │ [⇢ Path][WHY?][🔎 Inspect][Analyze ▾][⚡][Events]│                      │
│ ▸ Advanced   │                                              │                         │
├──────────────┴──────────────────────────────────────────────┴────────────────────────┤
│ ▶ … │ [PWM gate][Vout][iL] [+ Add]  │ Steady state · Start-up                         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.5 Learn mode

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← Rectifiers  Bridge rectifier ▾ │ Explore·[Learn]·Experiment·…        ◎ Focus  ⓘ ▾  │
│ Lesson: Full-wave bridge — both halves work        step 2 of 4   ◀ Prev  Next ▶  ✕   │
├──────────────┬──────────────────────────────────────────────┬────────────────────────┤
│ (parameters  │   circuit — the lesson places the cursor     │ [Learn] State Why Energy│
│  locked by   │   and highlights D2, D3                      │ TERMINAL b POSITIVE     │
│  the lesson) │                                              │ Text built from the     │
│              │ D2 + D3 conducting · Vo 15.6 V               │ simulation at this      │
│              │ [⇢ Path][WHY?][🔎 Inspect][Analyze ▾]        │ instant…                │
│              │                                              │ LOOK: the current path  │
├──────────────┴──────────────────────────────────────────────┴────────────────────────┤
│ scope: the lesson's channels and window                                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.6 Experiment mode

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← DC-DC  Buck converter ▾ │ Explore·Learn·[Experiment]·Predict         ◎ Focus  ⓘ ▾  │
├──────────────┬──────────────────────────────────────────────┬────────────────────────┤
│ BASIC        │   circuit                                    │ EXPERIMENT              │
│ …            │                                              │ Double the switching    │
│              │                                              │ frequency               │
│              │                                              │ 1 Predict: ( ) halves   │
│              │                                              │   ( ) unchanged ( ) …   │
│              │                                              │ [2 Run the experiment]  │
│              │                                              │ 3 Result: before | after│
│              │                                              │ 4 Why (from simulation) │
├──────────────┴──────────────────────────────────────────────┴────────────────────────┤
│ scope (shows the "after" run; [Show before] overlays it)                             │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.7 Compare mode (Rectifiers)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← Rectifiers  Compare ▾ │ Explore·…·[Compare]                                        │
│ Basis: ( ) same phase voltage (•) same output power ( ) same line voltage            │
├─────────────────────────────────────────┬────────────────────────────────────────────┤
│ A: Single-phase bridge ▾                │ B: Three-phase 6-pulse ▾                   │
│ circuit A                               │ circuit B                                  │
│ Vo, ripple, PIV, PF …                   │ Vo, ripple, PIV, PF …                      │
├─────────────────────────────────────────┴────────────────────────────────────────────┤
│ shared scope: Vo(A) vs Vo(B), shared cursor │ WHY the difference (from both runs)    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.8 Engineering area

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ⏚ Power Electronics Lab    Home  Labs ▾  [Engineering]  Progress        🔍       ⚙   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ENGINEERING                                                                          │
│ Practice like an engineer: design, diagnose, explain. For students who know the labs.│
│                                                                                      │
│ [Challenge          READY ] design tasks checked by the simulation · 9 rectifier tasks│
│ [Reverse engineering READY] identify the circuit from its waveforms                  │
│ [Fault diagnosis    SOON  ] find a hidden fault from measurements                    │
│ [Design             SOON  ] requirement → design → validated PASS/WARNING/FAIL       │
│ [Interview          SOON  ] question → simulate → answer → explanation               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. User journeys

Click counts start from Home. *Today* is measured on the current build.

**J1 — New student wants to learn rectifiers.**

| Step | Screen | Action |
|---|---|---|
| 1 | Home | "Start with Rectifiers" (or *Convert AC to DC*) |
| 2 | Rectifiers landing | "Half-wave" |
| 3 | Workspace (Beginner) | already running; the cursor sits at the first peak; a one-time hint says "Drag the cursor · press WHY?" |
| 4 | Workspace | WHY? → the WHY tab explains the conducting diode |

Result: an experiment is running after **2 clicks**. Today it takes 3 choices plus Run on a
crowded screen.

**J2 — Understand the freewheeling diode.**
- Search "freewheeling" → the result "Freewheeling diode · Rectifiers" opens the 1ph half-wave RL
  workspace with Dfw on.
- Alternatively: Rectifiers landing → Topics → Freewheeling diode.
- Then Learn → the freewheel lesson, or the existing "With / without Dfw" scope view.

Result: **2 clicks** to the circuit and **1 more** to the lesson. Today this needs knowledge of
the RL load plus the bench toggle.

**J3 — Learn the buck converter.**
- Home → *Convert a DC voltage* → Buck workspace (Beginner: circuit, PWM, Vout, iL, State, WHY).
- Learn tab → Start lesson.

Result: **2 clicks** to the lesson.

**J4 — Compare single- and three-phase rectifiers.**
- Rectifiers landing → Topics → "Compare two rectifiers".
- Compare mode opens with A = single-phase bridge and B = 6-pulse bridge, same output power.

Result: **2 clicks**; the basis is explicit.

**J5 — Advanced student wants detailed device measurements.**
- Search "6-pulse" → workspace.
- Analyze ▾ → Measurements (device stress: PIV, I_avg, I_rms per device), or click T1 → Inspect
  drawer.
- With Engineer level set once in Settings, every value channel is available under `+ Add`.

Result: **2–3 clicks**.

**J6 — Preparing for an interview.**
- *Now (with existing content):* Engineering → Challenge (rectifiers), and each lab's Predict mode,
  which asks a question, has the simulation answer, then shows the theory.
- *Later (Interview, coming soon):* Engineering → Interview → question → the simulation runs → the
  student answers → evaluation → explanation. The answer is never shown before the response.

**J7 — Designing a converter.**
- *Now:* Engineering → Challenge (rectifier design tasks with stars).
- *Later (Design, coming soon):* Engineering → Design → "48 V → 12 V, 10 A buck" → Requirements →
  choose L, C, fs → Simulate → Validation table (ripple, stress, efficiency) →
  PASS / WARNING / FAIL.

---

## 13. Component hierarchy and reuse

```
AppShell
├─ TopBar (Brand, PrimaryNav[Home, LabsMenu, Engineering, Progress], SearchButton, SettingsMenu)
├─ Breadcrumb
├─ RouteOutlet (lazy per route)
│  ├─ HomePage           ContinueCard | StartCard, QuickStart, LabGrid, LearningPath, RecentList
│  ├─ LabsPage           LabGrid (grouped)
│  ├─ LabLandingPage     LabHeader, TopicSection[TopicCard], RelatedLinks     ← driven by the catalogue
│  ├─ WorkspacePage      WorkspaceShell + adapter
│  │   ├─ WorkspaceShell
│  │   │   ├─ WorkspaceBar (BackLink, TopicSwitcher, ModeTabs, FocusToggle, LevelMenu, LessonStepper)
│  │   │   ├─ ControlsRegion      ← ParameterPanel (rectifier) | SpecList (topics)
│  │   │   ├─ BenchRegion         ← CircuitDiagram/ThreePhaseDiagram | topic.Diagram; StatusLine; ActionBar
│  │   │   ├─ ContextRegion       ← StateCard, WhyPanel, LessonPanel/LearnPanel, EnergyPanel/side chart
│  │   │   ├─ ScopeDock           ← Scope + Transport + ChannelBar | LabScope
│  │   │   └─ Overlays            ← Drawer (path, inspect, event, why, energy), Sheet (Analyze tabs)
│  │   ├─ RectifierWorkspace      adapter: App.tsx internals split into region slots; reducer unchanged
│  │   └─ TopicWorkspace          adapter: LabShell/TopicLab split into region slots; state unchanged
│  ├─ EngineeringPage, ProgressPage, NotFoundPage
└─ CommandPalette (search)
```

Reuse:
- Every existing panel component is reused as is. The adapters only decide *which region* it goes
  in.
- `ui/Drawer.tsx` is the drawer/sheet for both shells; it needs focus trap and Esc (§16).
- The two scopes (`Scope.tsx`, `LabScope.tsx`) stay separate. Merging them is out of scope
  (risk §20). Their toolbars get the same layout and naming.
- **The catalogue (`src/catalogue/catalogue.ts`)** is a new single source of data. It holds labs,
  sections, topics, statuses, routes, purposes, keywords, presets and learning-path order. Home,
  Labs, landing pages, the Labs menu, search, the learning path and the Engineering page all
  render from it.
- **The search index** is built at load time from the catalogue. It adds topic lessons and
  experiments (`topic.lessons`, `topic.experiments`), the rectifier `LESSONS` and `CHALLENGES`,
  and a small concept glossary with aliases (e.g. "THD" → PWM spectrum, Inverter spectrum;
  "commutation overlap" → 6-pulse + Measurements tab). No web search.

---

## 14. State management

| State | Owner | Persistence |
|---|---|---|
| Route (lab, topic, mode, preset query) | hash router | URL |
| Preferences (information level, reduced motion) | `PreferencesContext` | `localStorage` (`pel.prefs`); migrates `rectifier-lab.density` |
| Progress (lessons done per lab/topic, challenge stars, last activity, recent list) | `ProgressStore` (tiny module + context) | `localStorage` (`pel.progress`); reads the existing `rectifier-lab.lessons/challenges/predict` keys without breaking them |
| Simulation state (params, run, cursor, channels, drawers) | the workspace adapter: `labReducer` (rectifier) or `TopicLab` state | in memory; topic params survive topic switches (`paramStore`, as today) |
| Focus | workspace | in memory |

Rules:
1. **One run per workspace.** Circuit, scope, path, state, WHY, energy, events, Inspect and Analyze
   all read the same `result`/`Run`. Shell components receive values; they never call an engine.
2. **The URL selects, the reducer owns.** On entering a workspace route the adapter dispatches
   `chooseRectifier` / `chooseLoad` / `run` (rectifier) or sets the topic (LabShell). Parameter
   edits do not touch the URL.
3. All storage access goes through the existing guarded `utils/storage.ts`. The app must work with
   storage blocked.

---

## 15. Responsive strategy

| Width | Layout |
|---|---|
| ≥ 1280 px | four regions as in §8.1 |
| 900–1279 px | Controls collapse into a left drawer ("⚙ Parameters" button in the workspace bar); Bench + Context side by side; Scope dock full width |
| < 900 px | single column, reflowed rather than shrunk: workspace bar (back · title · ⋯) → **mode chips** (horizontal scroll with fade edges, or a select) → Bench (full width, circuit scaled to width) → status line + **icon action bar** (overflow menu) → Scope dock (full width, 2 lanes by default) → Context as a **bottom sheet** (peek shows the status line; drag up for State/Why/Learn/Energy). Parameters open as a left drawer. |
| Top bar < 900 px | brand · 🔍 · ☰. The menu sheet holds Home, Labs (grouped), Engineering, Progress and Settings |
| Home / landing < 600 px | cards in one column; quick-start chips wrap; the learning path stays collapsed |

Acceptance: no horizontal page scroll at 390 px on any route (an automated check). Touch targets
≥ 44 px. The circuit is ≥ 90 % of the viewport width on phones.

---

## 16. Accessibility

- Landmarks: `header` (top bar), `nav` (primary + breadcrumb), `main` per route, `aside` for the
  side regions. A "Skip to content" link.
- **Route changes** move focus to the page `h1` and announce the new page title (`document.title`
  is updated too).
- The top bar uses `aria-current="page"`. Mode tabs use proper `tablist`/`tab`. The status is
  text ("READY"), never colour alone.
- Drawers and sheets become dialogs: `role="dialog"`, labelled, focus trap, Esc closes, focus
  returns to the trigger. The command palette follows the WAI-ARIA combobox pattern.
- Keyboard handling:
  - the existing workspace shortcuts (Space, ←/→, Home) stay scoped to the workspace;
  - Ctrl/⌘ K opens search everywhere;
  - shortcuts never fire while typing in a field (already the rule in `App.tsx`).
- `prefers-reduced-motion` is respected, along with an explicit Settings toggle. Current-path
  animation becomes a static highlight.
- Contrast: keep the existing tokens. New status chips are validated against the surface (≥ 4.5:1
  for text).

---

## 17. Performance

- **Code-split by route.** Home, Labs, landing pages and Engineering import only the catalogue.
  Each lab's workspace (and its engine) loads with `React.lazy` when opened, with a light skeleton.
  Target: first-screen JS for Home < 200 kB gzipped (today everything loads: about 342 kB
  gzipped).
- The search index is built lazily on first open of the palette.
- No change to the simulation cost. Workspaces already memoise runs on parameters.
- Measure with the production build (`vite build` chunk report) at the end of Phase 1.

---

## 18. Testing strategy

1. **Unit tests (Vitest)**
   - Router: parse/build every route, every legacy redirect, and not-found handling.
   - Catalogue integrity:
     - every `ready` topic resolves to an existing rectifier circuit or `Topic`;
     - every route builds;
     - no `ready` item points at a placeholder;
     - every `coming-soon` item has no route into a workspace.
   - Search: ranking for the brief's examples ("freewheeling diode", "buck converter", "SVPWM",
     "commutation overlap", "THD", "SCR", "why current continues"), with results limited to the
     app's own content.
   - Progress store: migration of the existing keys, and blocked storage.
   - All 757 existing tests keep passing unchanged (physics is untouched).
2. **Browser smoke (Playwright, Edge)**
   - New `smoke-shell.mjs`:
     - Home renders in a new and a returning state;
     - every lab landing page opens, every ready card opens its workspace, back returns;
     - legacy hashes redirect;
     - search navigates;
     - Settings level persists;
     - no horizontal scroll at 390 px on every route;
     - no console errors.
   - The existing seven suites (336 checks) are kept. Only their **entry steps** change: for
     example `#dcdc` + tab click becomes `#/labs/dcdc/buck`, and the rectifier "pick + Run" becomes
     the landing page plus a card. Every assertion about simulation content stays as is.
3. **Visual verification** — after each phase, screenshots of Home, one landing page and two
   workspaces at 1440, 1024 and 390 px, saved to `scripts/out/` and inspected.
4. **Success-criteria checks** (§21): click counts from J1–J7, scripted in `smoke-shell.mjs`.

---

## 19. Migration plan and phases

Each phase ends green (tests, type check, build, all smoke suites, screenshots) and waits for your
approval.

### Phase 1 — global navigation, Home, landing pages, routing (no simulation changes)
- `src/catalogue/catalogue.ts` (labs, sections, topics, status, routes, purposes, keywords, path
  order).
- The hash router with legacy redirects; `AppShell`, `TopBar`, `Breadcrumb`, `LabsMenu`,
  `SettingsMenu` (information level).
- HomePage (Continue/Start, Quick start, Labs grid, Learning path, Recent), LabsPage,
  LabLandingPage (all 11), EngineeringPage, ProgressPage (reads existing rectifier progress),
  NotFoundPage.
- Workspaces mount at their new routes **as they are today**. The only change inside a workspace is
  an *initial selection* input:
  - the rectifier `App` accepts `{topology, device, load}` from the route and runs immediately;
  - `LabShell` already accepts `initial`.
- The current "Engineering" lab moves to `#/labs/thermal` as "Losses & thermal".
- Last-activity and recent tracking (route + label).
- Route-level code splitting.
- Responsive top bar and pages (menu sheet < 900 px).
- Tests: router, catalogue, progress unit tests; `smoke-shell.mjs`; entry-step updates in the
  existing suites.

### Phase 2 — universal workspace shell
- `WorkspaceShell` with regions, `WorkspaceBar`, `ActionBar`, `StatusLine`, `ScopeDock`, and
  Drawer/Sheet as accessible dialogs.
- Responsive reflow (drawer, bottom sheet, icon action bar).
- Built and tested with one LabShell topic (Buck) behind its route first.

### Phase 3 — Rectifier lab into the shell
- Split `App.tsx` into region slots (`RectifierWorkspace`). `labReducer`, `useModes` and every panel
  are reused.
- Remove the header circuit picker (the landing page and TopicSwitcher replace it). Load moves to
  the Basic parameters.
- The 6-step guide becomes a one-time hint.
- Focus mode is preserved.
- All rectifier smoke suites stay green with their assertions unchanged.

### Phase 4 — progressive disclosure and information ownership
- One Analyze sheet (Measurements · Theory vs simulation · Theory · Numerics) for every lab;
  LabShell's Analyze mode moves into it.
- An Inspect drawer everywhere; an Events drawer.
- Apply the ownership table (§9.3): remove the duplicate Vo/Io and the tile grid at
  Beginner/Standard.
- One global information level with migration.

### Phase 5 — learning modes
- Same mode order everywhere (unavailable modes hidden).
- Learn tab = the active lesson, with the stepper in the workspace bar.
- Lesson progress for LabShell topics (completion + last step) feeds Continue and the learning
  path.
- Search adds lessons and experiments.

### Phase 6 — DC-DC and all LabShell labs in the shell
- `TopicWorkspace` adapter for DC-DC, PWM, Inverters, Devices, Drives, Magnetics, Control, Losses &
  thermal, EV.
- Side charts (Spectrum, Bode, B–i, Zth) live in the Context region.
- Steady-state / start-up control in the Scope dock.

### Phase 7 — future modules and restructures
- Inverters "circuit → switching" single workspace.
- Power quality.
- Engineering: Fault diagnosis, Design, Interview.
- Devices: diode/SCR/IGBT/SiC/GaN.
- Motors: BLDC/PMSM/induction.
- Magnetics: transformer.

Each of these follows the same catalogue + workspace pattern, and its status changes to READY only
when its tests exist.

---

## 20. Risks and possible regressions

| Risk | Where | Mitigation |
|---|---|---|
| The 336 smoke checks depend on today's entry flows and selectors | all suites | Change only the entry steps per phase; keep the content assertions; run every suite each phase |
| Splitting the 760-line `App.tsx` breaks reducer/side-effect ordering (cursor-at-first-peak, guided progress, lens) | Phase 3 | Move JSX into slot components without moving hooks; the reducer stays in one place; a dedicated smoke run of every rectifier mode |
| URL and reducer disagree (double source of truth) | Phases 1, 3 | URL = selection only; one-way: route → dispatch on entry; parameters never in the URL |
| Keyboard conflicts (workspace Space/←/→ vs palette, drawers) | Phases 1–2 | Scope listeners to the workspace element; the palette and dialogs stop propagation |
| Lazy loading causes flashes or loses `paramStore` | Phase 1 | Skeletons sized like the final layout; `paramStore` stays at module level (it survives because the module stays loaded) |
| Renaming Engineering → Losses & thermal breaks links and memory | Phase 1 | Redirect `#engineering`; the catalogue holds both the label and an alias |
| Honest statuses drift as features land | ongoing | The catalogue-integrity test fails on a READY item without a working route |
| Mobile bottom sheet hides WHY behind gestures | Phase 2 | The peek state always shows the status line + a WHY button; a keyboard and screen-reader path via the tab list |
| The Rectifier Compare mode does not fit the four-region shell | Phase 3 | Compare gets the documented full-width layout variant of the shell |
| Information-level migration surprises existing users (rectifier default Standard, others Beginner) | Phase 4 | The persisted rectifier value wins; otherwise Beginner on first visit |
| Dev server serves stale modules after large moves | all | Restart the dev server before the smoke runs (known issue) |
| Scope canvas sizing in new containers | Phases 2, 3, 6 | Both scopes use `ResizeObserver`; screenshot checks at three widths |

---

## 21. Validation checklist

Run after every phase. Each phase is accepted when everything applicable is ✓.

- [ ] `npx tsc -b` clean; `npm run build` succeeds (chunk report recorded)
- [ ] All unit tests pass (757 + new router/catalogue/search/progress tests)
- [ ] All smoke suites pass: smoke, smoke3, smoke-fw, smoke-ctl, smoke-dcdc, smoke-inv,
      smoke-modules, smoke-shell
- [ ] Every catalogue route opens; every legacy hash redirects; Back returns to the landing page
- [ ] No horizontal scroll at 390 px on any route; screenshots at 1440 / 1024 / 390 inspected
- [ ] No console errors on any route
- [ ] Rectifier lab: every circuit × load runs; Learn, Experiment, Predict, Challenge, Reverse,
      Compare, Focus, Lens and step-through all still work
- [ ] No READY label on anything unimplemented (catalogue test)
- [ ] Success criteria (brief §52):
  - [ ] Home understandable at a glance: ≤ 1 hero, ≤ 6 quick-start chips, 11 lab cards, no
        waveforms or values on Home
  - [ ] A basic experiment is running ≤ 2 clicks from Home (J1, J3)
  - [ ] Advanced measurements ≤ 3 clicks from Home (J5)
  - [ ] WHY is reachable in 1 click from any workspace state (action bar)
  - [ ] Every existing feature in §1.2 is reachable (checked against the feature map)
  - [ ] Every screen shows where you are (breadcrumb or workspace title) and how to go back

---

## 22. Decisions needed from you

1. **Rename** today's "Engineering" lab to **Losses & thermal** and use "Engineering" for the
   practice area (Challenge, Reverse, Fault diagnosis, Design, Interview)? *Recommended.*
2. **Learning-path order:** Rectifiers → DC-DC → PWM → Inverters → Devices → Magnetics → Control →
   Drives → Losses & thermal → EV, instead of Devices first? *Recommended*, because the only device
   lab is an advanced MOSFET switching test.
3. **Modes a lab doesn't have** (Challenge/Reverse/Compare outside Rectifiers): hide them (same
   order, no gaps), or show them disabled? *Recommend hide.*
4. **Analyze** as a sheet opened from the action bar in every mode, rather than a mode?
   *Recommended.*
5. **Opening a circuit runs it immediately**, removing the separate "Run simulation" step and the
   6-step guide (replaced by a one-time hint)? *Recommended.* It changes the first-run flow the
   current rectifier smoke test checks; that test's entry steps would be updated.
6. **Router:** a small in-house hash router (no new dependency) rather than React Router?
   *Recommended.*

On approval, I will implement **Phase 1 only** and report back with tests, the build, smoke runs
and screenshots before Phase 2.
