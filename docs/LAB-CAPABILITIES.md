# Lab capabilities, validation and limits (Phase 6 audit)

This file states what each of the ten labs **actually simulates**, how its results are validated, and what it
does not model. It was written from a code audit of every lab plus probes that ran the real simulations
against **independent** closed-form formulas (not the app's own theory module).

Two kinds of "theory" appear in the app. Keep them apart:

- **Exact solution of the same model.** A matrix exponential, an exact Fourier integral, or quadrature of the
  same equations. It validates the numerics (time-stepping, event location, steady-state search) but cannot
  catch a modelling error.
- **Textbook relationship.** An independent formula (Vdc = 2Vm/π, Vout = D·Vin, V1 = 4Vdc/π…) under stated
  assumptions. These caught no physics error in Phase 6, and every residual difference is explained by a
  modelled effect.

Status words:

- **verified**: implemented, and checked by tests against textbook physics.
- **numerics-verified**: checked only against the exact solution of the same model.
- **partial**: works, but some of the feature is missing.
- **not modelled**: absent.

## Capability matrix

| Lab | Engine | Modelled | Validation | Not modelled / limits |
|---|---|---|---|---|
| **Rectifiers** | MNA netlist, assumed-state diode/SCR solver, bisected switching instants | <ul><li>Half-wave, center-tap, bridge, semi-bridge, 3-pulse, 6-pulse and 3φ half-controlled</li><li>Diode or SCR (α 0–180°)</li><li>R/RL/RC/RLC loads</li><li>Freewheeling diode</li><li>3φ source R/L (commutation overlap μ)</li><li>3φ faults</li><li>Real diode (Vf, Ron)</li><li>CCM/DCM</li></ul> | **verified**: <ul><li>15 golden configurations</li><li>Every theory row within 1 %</li><li>Audit probes: Vdc, Vrms, PIV, f_ripple, β, (Vm/2π)(1+cos α), (2Vm/π)cos α, 1.35·VLL·cos α — differences 0–0.2 %</li><li>μ within 2.6 %</li></ul> | <ul><li>No single-phase source inductance or faults</li><li>No back-EMF load: inversion (α > 90°) cannot be shown</li><li>SCR with RC/RLC has no theory rows</li></ul> |
| **DC-DC** | Generic switched-circuit engine; shooting steady state | <ul><li>Buck, boost, inverting buck-boost</li><li>CCM and DCM (all three)</li><li>Ideal or real devices (Ron, Vf), DCR, ESR</li><li>Start-up from rest</li></ul> | **verified**: <ul><li>D·Vin, Vin/(1−D), −D·Vin/(1−D) within 0.3 %</li><li>ΔiL within 0.6 %</li><li>DCM within 0.4 %</li><li>Pin = Pout within 0.12 %</li><li>Exact snapshot (bit-identical)</li></ul> | <ul><li>Asynchronous only (no synchronous rectifier, no dead time)</li><li>"Ideal" devices are 1 mΩ</li></ul> |
| **PWM** | Exact comparator edges; exact Fourier integrals | <ul><li>Triangle/sawtooth carrier</li><li>DC or sine reference</li><li>Natural / regular (sym, asym) sampling</li><li>N-bit quantisation</li><li>Overmodulation</li></ul> | **verified**: <ul><li>avg/RMS exact</li><li>V1 = M·Vdc/2 exact (natural)</li><li>Regular-sampling −0.64 % (the sampling delay, physical)</li></ul> | <ul><li>**Dead time shapes only the gate signals**: the lab has no load, so it cannot change vout (the parameter says so; see Inverters)</li></ul> |
| **Inverters** | Generic switched-circuit engine; shooting steady state | <ul><li>Half/full bridge square and quasi-square</li><li>Three-phase six-step</li><li>SPWM (1φ bipolar/unipolar, 3φ)</li><li>SVPWM (7-segment, overmodulation clipping)</li><li>R/RL load; ideal or real devices</li><li>Dead time (changes the voltage)</li><li>Start-up</li></ul> | **verified**: <ul><li>4Vdc/π, (4Vdc/π)cos α, (2√3/π)Vdc, m·Vdc, (√3/2)m·Vdc all within 0.01 %</li><li>6k±1 harmonics</li><li>I1 = V1/\|Z\|</li><li>SVPWM −0.6 % (sampling at the period start, physical)</li></ul> | <ul><li>SVPWM spectrum has no closed form</li><li>Device-current channels only for S1–S4 / D1–D4</li></ul> |
| **Switching Devices** | Piecewise-linear MOSFET gate/channel model; exact solution | <ul><li>Double-pulse test</li><li>Constant Cgs, Cgd, Cds</li><li>Linear transconductance, ohmic region</li><li>Miller plateau emerges</li><li>Eon/Eoff = ∫v·i</li></ul> | **numerics-verified** plus: <ul><li>td(on) exact</li><li>Plateau = Vth + (I0 + Cgd current)/gm exact</li><li>t_fv within 8 %</li><li>Eon within 10 %</li></ul> | <ul><li>No voltage-dependent Cgd</li><li>No diode reverse recovery</li><li>No stray inductance (no ringing)</li><li>No temperature</li><li>One test, not periodic</li></ul> |
| **Magnetics** | Two-slope B–H curve; shooting steady state; start-up | <ul><li>Gapped core on a square-wave bridge</li><li>Saturation</li><li>Inrush (start-up)</li><li>Winding R</li><li>B–i trajectory</li><li>Stored energy</li></ul> | **verified**: <ul><li>L = N²μ0Ae/(lg + le/μr) within 0.01 %</li><li>ΔB = V·D·T/(N·Ae) within 0.02 %</li><li>Saturation current spike exact</li><li>tSat within 1.6 %</li></ul> | No hysteresis or core loss (stated in the lab) |
| **Control** | Switched plant (netlist) plus a digital PID sampled once per period | <ul><li>Closed/open loop for buck and boost</li><li>Reference, load and line steps</li><li>Soft start</li><li>Anti-windup</li><li>Small-signal Bode</li><li>Exact stability \|λ\|max of the sampled loop</li></ul> | **verified**: <ul><li>Open-loop Vout within 0.16 %</li><li>Crossover and phase margin match the ZOH + delay formula</li><li>RHP zero R(1−D)²/(2πL) exact</li></ul> | <ul><li>Bode only at the starting operating point, without DCR (the badge uses \|λ\|max)</li><li>Integral action regulates the period-start sample, not the average</li><li>No computation delay, no ADC/PWM quantisation, no capacitor ESR</li></ul> |
| **Drives & Motors** | Switched chopper + DC motor (PWL toolkit), exact solution | <ul><li>Ra–La, k·ω, k·i, J, B, load torque</li><li>1Q and 2Q chopper</li><li>Discontinuous current</li><li>Regeneration</li><li>Soft start</li><li>Load and duty steps</li></ul> | **verified**: <ul><li>Steady ω, mean current, ΔI, d·Vdc within 1e-6</li><li>Start-up t90 within 0.3 % of the averaged model</li><li>Energy balance</li></ul> | <ul><li>No current limit</li><li>Ideal switches (no device losses)</li></ul> |
| **Losses & Thermal** | Loss formulas + linear Foster network (no electrical circuit simulated) | <ul><li>Conduction D·I²·Ron(Tj)</li><li>Switching fs·½·V·I·tsw·(1+κΔT)</li><li>3 Foster stages + heatsink</li><li>Pulsed or constant load</li><li>Runaway (b·Rth for a constant load; growth per cycle ρ for a pulsed one)</li></ul> | **verified**: <ul><li>Ta + P·Rth exact</li><li>Self-consistent Tj exact</li><li>Zth step response</li><li>Pulsed steady state exact</li><li>ρ = exact one-cycle spectral radius</li></ul> | <ul><li>Foster stages are a curve fit, not physical layers</li><li>MOSFET Ron only (no IGBT Vce, no diode loss)</li><li>Runaway temperatures grow without bound</li></ul> |
| **EV** | Vehicle dynamics + efficiency map (RK4), **not an electrical simulation** | <ul><li>Road load (drag, rolling, grade)</li><li>Torque/power envelope</li><li>Battery limit Voc²/(4Rb)</li><li>Regen limit + friction brakes</li><li>Battery Voc + Rb, SOC by charge</li><li>Drive cycles, 0–100</li></ul> | **verified**: <ul><li>Road-load power, distance, battery energy exact</li><li>t100 within 0.001 % of quadrature</li><li>Energy conserved at every sample</li></ul> | <ul><li>The "inverter" block is a constant drivetrain efficiency (no inverter physics)</li><li>Voc does not depend on SOC</li><li>No SOC limits</li></ul> |

## Fixed in Phase 6

**Physics**
- **Thermal runaway of a pulsed load.** It was judged by b·Rth ≥ 1, which is the constant-load criterion. Pulsed loads with b·Rth up to about 2.3 that are stable (one load cycle shrinks a disturbance, ρ < 1) were shown as RUNAWAY with no steady view. The test is now ρ of the exact one-cycle map (`cycleGrowth`), equal to the theory's spectral radius to 1e-9.
- **EV battery limit.** Battery current was clipped at Voc/(2Rb) while the wheel force was not, so at weak-battery settings the wheels received energy the battery never gave. Traction power is now limited to (Voc²/(4Rb) − Paux)·η, in both the simulation and the theory. Defaults are unaffected (500 kW available, 150 kW motor).

**WHY and events grounded in the run**
- "What happens next" quotes an edge exactly on the cursor's sample while the trace still shows the state before it. This uses one rule for every lab (`converters/cursor.ts`); before, such an edge was skipped.
- Whether a run repeats is declared by the topic: PWM yes, double-pulse test no. Before, it was guessed from the end samples, which marked a sawtooth PWM as non-repeating and a decayed MOSFET test as repeating.
- Markers (peaks, 100 km/h) land on their own sample. The EV peak-power cursor used to show the state one step later.
- Inverter dead time: a diode conducting with both gates OFF is explained as dead time, not as "switched to the rail". The six-step "Vdc/3 staircase" card no longer appears for SPWM/SVPWM.
- Magnetics:
  - A start-up marks every saturation entry and exit (it kept only 2 of about 12).
  - Bridge edges are explained as a voltage reversal, with the voltage applied from that instant.
- Drives: load-step and duty-step texts follow the simulated direction and outcome; the speed card uses the load after a step.
- Thermal: no "hottest instant" event for a constant load.
- Rectifiers:
  - Reverse now offers "none" for three-phase circuits.
  - Predict calls β an extinction angle only for half-wave circuits.
  - Texts no longer claim inversion the lab cannot show.
  - Compare's general advice describes the side it picks.
- Control:
  - The stability badge follows |λ|max ("STABLE · STILL SETTLING" when a stable loop is still ringing).
  - WHY says the integral action regulates the period-start sample.
  - The Bode note states its operating point.

**Learning modes**
- **Predict (topic labs):** values, waveforms, state, WHY and Explore stay covered until the prediction is checked. Before, the answer could be read off the screen.
- **Experiment:** starts from the lab's standard values, and says so when the student's values differ. Every judge and question was written for those values; from other settings several gave wrong verdicts. SVPWM-vs-SPWM no longer compares a run with itself.

**Lessons**
- Every lesson outside the Rectifier Lab (27 lessons in 9 labs) ends with a check question. It is answered once, then the right option and the explanation are shown, like the Rectifier quizzes. The checks that state a result (DCM output above the CCM value, a negative buck-boost output, ΔB independent of the gap, V1 ∝ M, a smaller ΔTj for shorter pulses) are confirmed by the simulation at the lesson's settings (`tests/lesson-checks.test.ts`).
- The Control lesson "Too much gain" no longer blames the sampling delay alone: it names the RHP zero (boost) and points to |λ|max as the exact test.

**Waveforms**
- Every scope lane is titled with its quantity and unit ("Speed [rpm]"). Lanes whose unit is not V/A/W/J used to have no unit at all.

## Fixed in Phase 7 (educational accuracy)

- **DC-DC ripple with ESR.** Texts that changed C or fs claimed ideal ripple scaling ("ripple ∝ 1/C", "falls even more") for every parameter set. With ESR the output ripple has a part, the step ESR·ΔiC, that no capacitance changes. The texts now name that part, estimated from the simulated currents (ESR·ΔiL for the buck, ESR·iL,max for boost/buck-boost; within 5 % of the simulated ripple when ESR dominates). They say "dominates" only when it exceeds half the simulated ripple, and keep the ideal statements without ESR (`rippleNote`, `tests/ripple-text.test.ts`).
- **SVPWM dwell-time lesson step.** It landed in the first switching period, whose reference is sampled at exactly 0°: T2 = sin 0 = 0, a true boundary but the wrong example. It now lands in the period sampled nearest 30° (T1, T2, T0 all non-zero). Wherever dwell times are shown, a boundary (T1 = 0 or T2 = 0) is explained: the reference lies exactly on an active vector. The angle shown is the sampled one (`svDwellText`, `svMidSectorTime`, `tests/svpwm-dwell.test.ts`).
- **Control "Too much gain".** For the boost the loop is stable at the start (24 V: fc 399 Hz, PM 80°, |λ|max 0.977) and unstable after the reference step (28 V, same gains: fc 718 Hz, PM −42°, |λ|max 1.0005). The higher duty raises the boost's gain and lowers its RHP zero. The text now gives that cause, from the model at both operating points, and agrees with the UNSTABLE badge and the never-settling plot. For the buck (stable, low margin) it explains overshoot and ringing (`gainStepText`, `tests/control-lesson.test.ts`).
- **End-of-run trend on chopped voltages.** The period average summed the samples, counting each PWM edge to a whole sample (or half). That was 1–4 % off (13.71 V for an exact 14.4 V) and the same every period. The average now follows the engine's sample convention (sample i holds (t[i−1], t[i]]) and places edges between samples at the simulator's recorded edge times. It agrees with the motor model's exact mean voltage within 0.2 % (`periodWindow`, `tests/trend-average.test.ts`). The simulation is unchanged.

## Known limitations

- The model limits in the capability matrix above (no hysteresis or core loss, constant MOSFET capacitances, the EV's constant-efficiency drivetrain, no back-EMF load in the Rectifier Lab, a Bode plot at the starting operating point…).
- Lesson checks are one question per lesson, conceptual. Only those that state a measurable result are confirmed by the simulation.

## Added 2026-10-11: the twenty former "coming soon" items

Every one is a simulation with an independent theory (the exact solution of the same model, `exactPwl` or a
hand-written mode-by-mode solution, plus textbook relations with their stated assumptions), lessons with check
questions, experiments and predictions judged by the simulation, and its own test file.

| Lab · topic | Model | Validation (simulation vs theory) | Not modelled / limits |
|---|---|---|---|
| DC-DC · Ćuk, SEPIC, Zeta | Netlist on the generic engine: Q1, D1, L1/L2 with DCR, C1, C with ESR; CCM and DCM | Exact theory: averages ≤ 1e-3, ripples ≤ 1.4e-3, timing ≤ 1.1e-4; D/(1−D) relations, VC1, ΔiL, DCM D/√Ke within 1 % | No body diode on Q1 (reverse-current case marked "not compared"); start-up window capped at 150 periods |
| DC-DC · Bidirectional | Half-bridge with antiparallel diodes, dead time, battery Eb + Rb; buck or boost direction | Averages ≤ 1.3e-3 both directions; VLV = D·VHV, IL, ΔiL | No DCM (current reverses); duty is feed-forward, no current loop |
| PWM · Multiple pulse | p equal pulses per half-cycle from a comparator, full-bridge output | Textbook Bn sum, Vrms = Vdc·√M, THD on 39 sets: error ~1e-13 | Modulator only (no load) |
| Inverters · 120° conduction | Gated IGBTs + diodes, star R / RL load, floating leg decided by the circuit; 180° option | Exact interval solution: ≤ 5e-4; R-load staircase V1 = √3·Vdc/π, THD 31.1 % | R-L textbook rows "not applicable" (stated) |
| Devices · Diode | Charge-control recovery (Lauritzen–Ma), Shockley I–V, clamped inductive commutation | Exact: ~1e-7; closed form for constant slope < 2e-3 | No capacitances (no ringing), 25 °C, no forward recovery |
| Devices · SCR | Stored-charge triggering, latching IL, holding IH, turn-off time tq, forced commutation | Exact: ~1e-5; td, latching pulse, tq closed forms < 1e-4 | IL is a behavioural threshold; no dv/dt, di/dt limits |
| Devices · IGBT | MOSFET gate/channel + hole current with lifetime τ (the tail), VCE(sat) = V0 + r·I | Exact: ≤ 6e-4; tail charge/energy ~2e-6 | Constant capacitances; ideal freewheeling diode |
| Devices · SiC MOSFET | The MOSFET model with SiC values; Ron(Tj, Vdrv) (assumed model, labelled) | As MOSFET + Qg, vDS(on) ≤ 6e-4 | Body diode in text only |
| Devices · GaN HEMT | Half-bridge, no body diode, reverse conduction vSD = Vth − Voff + Ron·I | Exact ≤ 1.7e-3; vSD ~1e-11 | No stray inductance, no dynamic Ron |
| Magnetics · Transformer | T-equivalent referred to the primary, two-slope B–H core, square or sine drive, DC offset | Exact ≤ 1e-4 (sat. ~1e-5); V2/V1, îm, ΔB, phasor solution ≤ 0.2 % | No core loss, no winding capacitance |
| Drives · BLDC | Trapezoidal EMF, Hall six-step, PWM chopping, exact diode states, RK4 + event bisection | Exact sector solution: speed ≤ 0.03 % (six-step); textbook speed 6–15 % high (explained) | Ideal Halls, open-loop duty, ideal switches |
| Drives · PMSM | d–q model, FOC with current/speed PI, current limit, field weakening; averaged inverter (stated) | Exact (matrix exponential) dynamics < 0.1 %; steady d–q ≤ 0.5 % | No switching ripple, continuous-time controllers |
| Drives · Induction motor | αβ flux model, DOL or V/f, RK4 | Equivalent circuit at settled points ~1e-6; breakdown and start criteria confirmed | Sinusoidal supply (no inverter switching), no iron loss/saturation |
| EV · Battery & BMS | Series cells, OCV(SOC) + R0 + RC pairs, spread, coulomb counting, cut-off, CC-CV, passive balancing | Exact solution: SOC < 1e-6, events within 1e-5 s | No temperature/ageing/hysteresis; bleed current large (stated) |
| EV · DC-DC stage | Synchronous SiC boost, dead time, duty found by the simulation, switching loss post-processed | Exact PWL model ~1e-5; textbook 2–5 % | No core loss, gate drive or recovery |
| Practice · Fault, Design, Interview | Real rectifier / DC-DC / topic simulations | tests/practice.test.ts: every answer judged by the simulation | Rectifier links cannot carry R, C, Vrms |

The Lab guide (52 pages, `src/guide/`) quotes only values confirmed by `tests/guide.test.ts`.
