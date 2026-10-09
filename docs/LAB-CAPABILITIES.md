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

## Known limitations (not changed)

- Some what-if/why texts in DC-DC still quote ideal ripple ratios when ESR dominates.
- The SVPWM "dwell times" lesson step lands where T2 = 0.
- The trend shown after the last event averages switched samples (a few % on chopped voltages).
- The control lesson "Too much gain" blames the sampling delay; the real cause is the operating point moving after the reference step.
