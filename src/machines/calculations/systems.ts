/**
 * Electromechanical systems — explicit steady-state (or instantaneous) relations for the system assemblies of the
 * 3D Machines Lab: P = T·ω, an efficiency chain η_total = Π η_i (every η an ASSUMED example value the student sets),
 * a gear ratio ω_wheel = ω_motor / G, f = P·n/120 for a genset. Not a simulation: the EV and Drives labs simulate.
 * Tested in tests/machines-sync.test.ts.
 */

export const G_ACC = 9.81 // m/s²
export const RHO_AIR = 1.2 // kg/m³ (sea level, ~20 °C)
const SQRT3 = Math.sqrt(3)

export const radPerS = (rpm: number) => (rpm * 2 * Math.PI) / 60
export const rpmOf = (w: number) => (w * 60) / (2 * Math.PI)
/** Mechanical power on a shaft: P = T·ω [W]. */
export const shaftPower = (torque: number, w: number) => torque * w
/** Overall efficiency of stages in series: η_total = Π η_i (each 0 … 1). */
export const chainEfficiency = (etas: number[]) => etas.reduce((a, b) => a * b, 1)
const etaOk = (etas: number[]) => etas.every((e) => e > 0 && e <= 1)

/**
 * Power at each stage of a chain carrying `pIn` forward: out_k = in_k·η_k, loss_k = in_k − out_k.
 * Returns the stage powers and losses (their sum equals pIn − pOut exactly).
 */
export function powerChain(pIn: number, etas: number[]) {
  const stages: Array<{ pin: number; pout: number; loss: number }> = []
  let p = pIn
  for (const e of etas) {
    const out = p * e
    stages.push({ pin: p, pout: out, loss: p - out })
    p = out
  }
  return { stages, pout: p, loss: pIn - p }
}

// ── Genset: prime mover → alternator → load ───────────────────────────────────────────────────────────
export interface GensetIn {
  /** Engine shaft torque [N·m]. */
  torque: number
  /** Shaft speed [rpm]. */
  n: number
  poles: number
  /** ASSUMED engine (fuel → shaft) efficiency. */
  etaEngine: number
  /** ASSUMED alternator efficiency. */
  etaAlt: number
  /** Line-to-line output voltage [V]. */
  vline: number
  /** Load power factor. */
  pf: number
}
export function genset(p: GensetIn) {
  if (!(p.n > 0 && p.poles > 0 && p.torque >= 0 && etaOk([p.etaEngine, p.etaAlt]) && p.vline > 0 && p.pf > 0 && p.pf <= 1)) return null
  const w = radPerS(p.n)
  const pShaft = shaftPower(p.torque, w)
  const pFuel = pShaft / p.etaEngine
  const pElec = pShaft * p.etaAlt
  const f = (p.poles * p.n) / 120
  return {
    w,
    f,
    nFor50: (120 * 50) / p.poles,
    pFuel,
    pShaft,
    pElec,
    lossEngine: pFuel - pShaft,
    lossAlt: pShaft - pElec,
    etaTotal: chainEfficiency([p.etaEngine, p.etaAlt]),
    iLine: pElec / (SQRT3 * p.vline * p.pf),
    sApparent: pElec / p.pf,
  }
}

// ── Motor coupled to a load: linear motor characteristic vs constant + fan load ─────────────────────────
export interface MotorLoadIn {
  /** Motor stall torque Ts [N·m] (torque at ω = 0). */
  ts: number
  /** Motor no-load speed [rpm] (torque 0). */
  n0: number
  /** Constant (Coulomb / process) load torque [N·m]. */
  tc: number
  /** Fan-law coefficient k [N·m·s²/rad²]: T = k·ω². */
  kf: number
  /** Total inertia on the shaft (motor + coupling + flywheel + load) [kg·m²]. */
  j: number
}
/**
 * Motor: Tm(ω) = Ts·(1 − ω/ω0) (a DC motor at fixed voltage; an induction motor in its normal low-slip region).
 * Load: TL(ω) = Tc + k·ω². Steady state Tm = TL: k·ω² + (Ts/ω0)·ω + (Tc − Ts) = 0 → the positive root.
 * Dynamics J·dω/dt = Tm − TL: start-up acceleration α0 = (Ts − Tc)/J; linearised time constant
 * τ = J / (Ts/ω0 + 2k·ω*) about the operating point (exact for k = 0).
 */
export function motorLoad(p: MotorLoadIn) {
  if (!(p.ts > 0 && p.n0 > 0 && p.tc >= 0 && p.kf >= 0 && p.j > 0)) return null
  const w0 = radPerS(p.n0)
  const b = p.ts / w0
  if (p.tc >= p.ts) return { starts: false as const, w0, w: 0, n: 0, t: null, p: 0, alpha0: 0, tau: null, ke: 0 }
  const c = p.tc - p.ts
  const w = p.kf > 0 ? (-b + Math.sqrt(b * b - 4 * p.kf * c)) / (2 * p.kf) : -c / b
  const t = p.ts * (1 - w / w0)
  const tau = p.j / (b + 2 * p.kf * w)
  return { starts: true as const, w0, w, n: rpmOf(w), t, p: t * w, alpha0: (p.ts - p.tc) / p.j, tau, ke: 0.5 * p.j * w * w }
}

// ── Battery → inverter → motor ───────────────────────────────────────────────────────────────────────
export interface InverterMotorIn {
  vdc: number
  /** Shaft torque demanded [N·m]. */
  torque: number
  /** Motor speed [rpm]. */
  n: number
  /** SPWM modulation index (linear region 0 … 1). */
  m: number
  poles: number
  /** ASSUMED inverter efficiency. */
  etaInv: number
  /** ASSUMED motor efficiency. */
  etaMotor: number
}
/**
 * Backwards from the shaft: P_shaft = T·ω, P_ac = P_shaft/η_m, P_dc = P_ac/η_inv, I_dc = P_dc/Vdc.
 * Sine-triangle PWM (linear, m ≤ 1): fundamental line voltage V_LL,rms = (√3 / 2√2)·m·Vdc ≈ 0.612·m·Vdc.
 * A synchronous (PM) motor needs f = P·n/120 from the inverter.
 */
export function inverterMotor(p: InverterMotorIn) {
  if (!(p.vdc > 0 && p.torque >= 0 && p.n >= 0 && p.m >= 0 && p.m <= 1 && p.poles > 0 && etaOk([p.etaInv, p.etaMotor]))) return null
  const w = radPerS(p.n)
  const pShaft = shaftPower(p.torque, w)
  const pAc = pShaft / p.etaMotor
  const pDc = pAc / p.etaInv
  const vll = (SQRT3 / (2 * Math.SQRT2)) * p.m * p.vdc
  return {
    w,
    pShaft,
    pAc,
    pDc,
    idc: pDc / p.vdc,
    lossInv: pDc - pAc,
    lossMotor: pAc - pShaft,
    etaTotal: chainEfficiency([p.etaInv, p.etaMotor]),
    vll,
    f: (p.poles * p.n) / 120,
    iac: vll > 0 ? pAc / (SQRT3 * vll) : null, // per-line rms current at unity displacement factor (a lower bound)
  }
}

// ── Vehicle on a level road: motoring and regenerative braking ─────────────────────────────────────────
export interface RegenIn {
  /** Vehicle mass [kg]. */
  mass: number
  /** Speed [km/h]. */
  v: number
  /** Acceleration [m/s²]: > 0 driving, < 0 braking (all the braking by the motor). */
  a: number
  etaGear: number
  etaMotor: number
  etaInv: number
  vbatt: number
}
/**
 * Road losses neglected (an upper bound for regeneration): F = m·a, P_wheel = F·v.
 * Driving (P_wheel > 0): P_batt = P_wheel / η_chain.  Braking (P_wheel < 0): P_batt = P_wheel·η_chain (charging).
 * η_chain = η_gear·η_motor·η_inv. Kinetic energy ½·m·v²; at most η_chain of it returns to the battery.
 */
export function regen(p: RegenIn) {
  if (!(p.mass > 0 && p.v >= 0 && p.vbatt > 0 && etaOk([p.etaGear, p.etaMotor, p.etaInv]))) return null
  const v = p.v / 3.6
  const eta = chainEfficiency([p.etaGear, p.etaMotor, p.etaInv])
  const f = p.mass * p.a
  const pWheel = f * v
  const braking = pWheel < 0
  const pBatt = braking ? pWheel * eta : pWheel / eta
  const ke = 0.5 * p.mass * v * v
  return {
    v,
    eta,
    f,
    pWheel,
    braking,
    pBatt,
    ibatt: pBatt / p.vbatt,
    loss: Math.abs(pWheel - pBatt),
    ke,
    keRecoverable: ke * eta,
  }
}

// ── EV drivetrain: battery → inverter → motor → gearbox → wheels ─────────────────────────────────────
export interface EvIn {
  mass: number
  /** Vehicle speed [km/h]. */
  v: number
  /** Overall gear ratio G = ω_motor / ω_wheel. */
  gear: number
  /** Wheel radius [m]. */
  rw: number
  /** Motor torque [N·m] (≥ 0: driving). */
  tm: number
  etaGear: number
  etaMotor: number
  etaInv: number
  crr: number
  /** Drag area Cd·A [m²]. */
  cda: number
  vbatt: number
}
/**
 * ω_wheel = v / r, ω_motor = G·ω_wheel; T_wheel = G·η_gear·T_m; F = T_wheel / r;
 * F_road = m·g·Crr + ½·ρ·CdA·v² (level road); a = (F − F_road)/m;
 * P_shaft = T_m·ω_m, P_wheel = F·v = η_gear·P_shaft, P_batt = P_shaft / (η_m·η_inv).
 */
export function evDrive(p: EvIn) {
  if (!(p.mass > 0 && p.v >= 0 && p.gear > 0 && p.rw > 0 && p.tm >= 0 && p.crr >= 0 && p.cda >= 0 && p.vbatt > 0 && etaOk([p.etaGear, p.etaMotor, p.etaInv]))) return null
  const v = p.v / 3.6
  const ww = v / p.rw
  const wm = p.gear * ww
  const tw = p.gear * p.etaGear * p.tm
  const f = tw / p.rw
  const fRoll = p.mass * G_ACC * p.crr
  const fDrag = 0.5 * RHO_AIR * p.cda * v * v
  const fRoad = fRoll + fDrag
  const pShaft = p.tm * wm
  const pWheel = f * v
  const pAc = pShaft / p.etaMotor
  const pBatt = pAc / p.etaInv
  return {
    v,
    ww,
    wm,
    nWheel: rpmOf(ww),
    nMotor: rpmOf(wm),
    tw,
    f,
    fRoll,
    fDrag,
    fRoad,
    a: (f - fRoad) / p.mass,
    pShaft,
    pWheel,
    pAc,
    pBatt,
    ibatt: pBatt / p.vbatt,
    pRoad: fRoad * v,
    etaTotal: chainEfficiency([p.etaInv, p.etaMotor, p.etaGear]),
    lossInv: pBatt - pAc,
    lossMotor: pAc - pShaft,
    lossGear: pShaft - pWheel,
  }
}
