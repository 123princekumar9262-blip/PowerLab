import { servoLoop } from '../../../calculations/modern.ts'
import type { CalcResult, LayerInfo, MachineContent, MachineParam, MachinePart, MachineStep, QuizItem } from '../../../types.ts'

/*
 * (Anchors of the turning parts — rotor, shaft, load — are relative to the motor axis at x = −0.7.)
 * Servo motor assembly: a PM synchronous servo motor (shaft = z axis, centred at x = −0.7) with an incremental optical
 * encoder at the rear, a load arm on the shaft, and a separate servo drive (box at x ≈ 2) holding the controller
 * board and the power stage, joined by a power cable and a feedback cable.
 */

export const SERVO_PARTS: MachinePart[] = [
  { id: 'housing', label: 'Motor housing and flange', what: 'The square frame and mounting flange of the servo motor, with the motor connector.', function: 'Holds the stator, carries its heat away and mounts the motor. The scale on the flange face shows the load-arm angle.', outer: true, explode: [0, 1.5, 0], stage: 1, anchor: [-0.7, 0.85, 0.3], related: ['stator', 'cables'] },
  { id: 'encoder-cover', label: 'Encoder cover', what: 'The round cover at the rear of the motor.', function: 'Protects the encoder from dust and light and carries the feedback connector.', outer: true, explode: [0, 0, -1.0], stage: 1, anchor: [-0.7, 0.6, -1.25], related: ['encoder'] },
  { id: 'stator', label: 'Motor stator (three-phase winding)', what: 'The laminated stator with its three-phase winding — the motor itself is a PM synchronous motor.', function: 'Makes the rotating field from the phase currents the drive supplies. The motor alone has no idea where it should go: it only converts current into torque.', explode: [0, 0, 0], stage: 3, anchor: [-1.25, -0.45, 0.62], related: ['rotor', 'cables'] },
  { id: 'rotor', label: 'Motor rotor (magnets)', what: 'A rotor with surface permanent magnets on the shaft.', function: 'Turns with the stator field; low inertia so the axis can accelerate quickly.', explode: [0, 0, 1.2], stage: 3, anchor: [0, -0.38, 0.65], related: ['stator', 'shaft'] },
  { id: 'shaft', label: 'Shaft', what: 'The motor shaft, from the encoder to the load.', function: 'Carries the torque to the load and turns the encoder disc with exactly the same angle.', explode: [0, 0, 0], stage: 3, anchor: [0, 0.12, 1.2], related: ['load', 'encoder'] },
  { id: 'encoder', label: 'Encoder (feedback sensor)', what: 'A glass disc with fine radial lines on the shaft and an optical read head.', function: 'Measures the shaft angle: the read head counts the lines passing (two channels in quadrature give 4 counts per line and the direction). This is the feedback — a sensor, not part of the motor’s torque production.', explode: [0, 0, -0.35], stage: 2, anchor: [-0.25, 0.4, -0.95], related: ['controller', 'shaft'] },
  { id: 'load', label: 'Load arm', what: 'An arm with a weight, fixed to the shaft (stands for the machine axis the servo moves).', function: 'Is moved to the commanded angle and held there against disturbances.', explode: [0, 0, 0.7], stage: 2, anchor: [0.5, 0.2, 1.45], related: ['shaft'] },
  { id: 'drive-cover', label: 'Servo drive enclosure', what: 'The housing of the servo drive (servo amplifier), with its display and connectors.', function: 'Holds the controller and the power stage; mounted in the machine cabinet, separate from the motor.', outer: true, explode: [0, 0, 1.3], stage: 1, anchor: [2.0, 1.1, 0.6], related: ['controller', 'power-stage'] },
  { id: 'controller', label: 'Controller board', what: 'The control electronics: a processor that reads the command and the encoder and runs the control loops.', function: 'Compares the commanded position with the measured one; from the error it computes a speed command, then a current (torque) command, and finally the switching pattern — position, speed and current loops nested inside each other.', explode: [0, 0, 0.7], stage: 2, anchor: [1.75, 0.55, 0.45], related: ['encoder', 'power-stage'] },
  { id: 'power-stage', label: 'Power stage (inverter)', what: 'A three-phase inverter: six power transistors on a heatsink, with DC-link capacitors.', function: 'Turns the DC link into the three phase currents the controller asks for. It handles the power; the controller only handles signals.', explode: [0, 0, 0], stage: 2, anchor: [2.25, -0.45, 0.3], related: ['controller', 'cables'] },
  { id: 'cables', label: 'Power and feedback cables', what: 'A power cable (three phases + earth) to the motor and a shielded feedback cable from the encoder.', function: 'The power cable carries the motor currents; the feedback cable carries the encoder signals back to the controller — closing the loop.', explode: [0, 0, 0], stage: 1, anchor: [0.75, 0.95, 0.35], related: ['power-stage', 'encoder'] },
]

export const SERVO_LAYERS: LayerInfo[] = [
  { id: 'current', label: 'Control loop (signals)', legend: 'Green: the command θ* into the controller and the current command to the power stage. Blue: the feedback from the encoder back to the controller. The chip shows the command, the encoder angle and their difference (the error) for the drawn arm.', conceptual: true },
  { id: 'energy', label: 'Power flow', legend: 'Orange: electrical power from the supply through the power stage and the power cable into the motor, out as mechanical power to the load.', conceptual: true },
  { id: 'rotation', label: 'Motion', legend: 'White curved arrow: the arm moves to each new commanded angle and stops there (not a constant rotation).', conceptual: false },
]

export const SERVO_STEPS: MachineStep[] = [
  {
    id: 'blocks',
    title: '1 · Four different things make a servo',
    text: 'A servo is not one part but a closed loop: the motor (makes torque), the feedback sensor (here an encoder on the motor shaft: measures the angle), the controller (compares what is wanted with what is measured) and the drive or power stage (supplies the motor currents). The motor and encoder sit on the machine; the controller and power stage sit in the drive.',
    focus: ['stator', 'rotor', 'encoder', 'controller', 'power-stage'],
    layers: [],
  },
  {
    id: 'motor',
    title: '2 · The motor only makes torque',
    text: 'The servo motor here is a permanent-magnet synchronous motor: stator winding, magnet rotor of low inertia. On its own it does not know any position — it produces torque in proportion to the current it receives. Brushed DC, BLDC and even induction motors are also used as servo motors.',
    focus: ['stator', 'rotor', 'shaft'],
    layers: ['rotation'],
    equation: 'T = kt · i   (torque from current, not position)',
  },
  {
    id: 'encoder',
    title: '3 · The encoder measures the angle',
    text: 'A disc with fine radial lines turns with the shaft; the read head counts the lines as they pass. Two channels shifted by a quarter line give the direction and 4 counts per line. Counting gives the angle; the time between counts gives the speed. Absolute encoders or resolvers give the angle directly at switch-on.',
    focus: ['encoder', 'shaft'],
    layers: ['current'],
    rotate: true,
    equation: 'counts/rev = 4 · PPR;   resolution = 360° / counts',
  },
  {
    id: 'controller',
    title: '4 · The controller compares and decides',
    text: 'The controller receives the commanded angle θ* and the measured angle θ. Their difference is the position error. The position loop turns the error into a speed command; an inner speed loop turns the speed error into a current (torque) command; an innermost current loop makes the power stage deliver it.',
    focus: ['controller', 'encoder'],
    layers: ['current'],
    rotate: true,
    equation: 'e = θ* − θ;   ω* = Kv · e',
    detail: 'Cascaded loops: current (fastest, kHz bandwidth), speed, position (slowest). Each inner loop must be faster than the one outside it.',
  },
  {
    id: 'drive',
    title: '5 · The drive delivers the power',
    text: 'The power stage is a three-phase inverter. It turns the DC link into the motor phase currents set by the controller — using the encoder angle to place them correctly in the motor (field-oriented control). Power flows only along this path; the controller and the encoder handle signals.',
    focus: ['power-stage', 'cables'],
    layers: ['energy'],
    rotate: true,
    equation: 'command (signal)  →  phase currents (power)',
  },
  {
    id: 'loop',
    title: '6 · The position loop in action',
    text: 'A new command arrives; the error is large, so the motor accelerates; as the arm approaches the target the error and the torque fall, and it settles. A disturbance pushing the arm makes an error that the loop corrects at once — the servo holds its position. Watch the chip: the encoder angle catches up with the command.',
    focus: ['load', 'encoder', 'controller'],
    layers: ['current', 'rotation'],
    rotate: true,
    equation: 'τ = 1 / Kv;   following error e = ω / Kv',
    detail: 'With an ideal inner speed loop, a proportional position loop gives a first-order approach (time constant 1/Kv) — the motion drawn here. Real axes add a speed and acceleration limit and feed-forward to cut the following error.',
  },
]

export const SERVO_PARAMS: MachineParam[] = [
  { id: 'ppr', label: 'Encoder lines per revolution (PPR)', unit: '', min: 100, max: 10000, step: 100, value: 2500 },
  { id: 'kv', label: 'Position loop gain Kv', unit: '1/s', min: 5, max: 200, step: 5, value: 50 },
  { id: 'n', label: 'Speed while moving', unit: 'rpm', min: 0, max: 3000, step: 50, value: 600 },
  { id: 'move', label: 'Move', unit: '°', min: 0, max: 360, step: 5, value: 90, level: 'standard' },
]

export function servoCalc(p: Record<string, number>): CalcResult[] {
  const r = servoLoop({ ppr: p.ppr, kv: p.kv, n: p.n, move: p.move })
  if (!r) return []
  return [
    { id: 'counts', label: 'Encoder counts per revolution', value: r.counts, unit: '', formula: 'counts = 4 · PPR  (quadrature)' },
    { id: 'res', label: 'Angular resolution', value: r.resolution, unit: '°', formula: '360° / counts' },
    { id: 'movec', label: 'Counts for the move', value: r.moveCounts, unit: '', formula: 'move / resolution' },
    { id: 'tau', label: 'Position loop time constant', value: r.tau, unit: 's', formula: 'τ = 1 / Kv', note: 'Proportional position loop with an ideal (much faster) speed loop.' },
    { id: 'settle', label: 'Settling time (2 %)', value: r.settle2, unit: 's', formula: 't ≈ 4 / Kv', note: 'First-order approach; real axes are also limited by speed and acceleration.' },
    { id: 'follow', label: 'Following error at constant speed', value: r.followDeg, unit: '°', formula: 'e = ω / Kv', note: `= ${r.followCounts.toFixed(0)} encoder counts behind the command.` },
  ]
}

export const SERVO_CONTENT: MachineContent = {
  overview: 'A servo is a motor that is told where to go and checks that it got there: a motor, a position sensor (encoder), a controller and a power stage form a closed loop. The motor makes torque; the encoder measures the angle; the controller compares command and measurement and sets the torque; the power stage delivers the current.',
  construction: 'Servo motor: here a PM synchronous motor with a low-inertia magnet rotor, square flange, motor connector, and an incremental optical encoder (slotted glass disc + read head) under a rear cover. Servo drive: an enclosure with the controller board (processor, interfaces) and the power stage (three-phase inverter on a heatsink, DC-link capacitors). A power cable and a shielded feedback cable connect them.',
  principle: 'The controller computes the error between the commanded and the measured position and drives it to zero through cascaded position, speed and current loops. Because the loop measures the actual result, it corrects for load changes and disturbances — unlike an open-loop stepper.',
  equations: [
    { expr: 'e = θ* − θ', meaning: 'Position error: command minus encoder measurement.' },
    { expr: 'ω* = Kv · e', meaning: 'Proportional position loop: the speed command grows with the error.' },
    { expr: 'τ = 1 / Kv,   t(2 %) ≈ 4 / Kv', meaning: 'First-order approach with an ideal inner speed loop.' },
    { expr: 'e_follow = ω / Kv', meaning: 'Following error while moving at constant speed ω.' },
    { expr: 'counts/rev = 4 · PPR', meaning: 'Quadrature incremental encoder resolution.' },
  ],
  assumptions: ['Ideal inner speed and current loops (much faster than the position loop).', 'Proportional position control, no feed-forward.', 'Rigid coupling between motor and load.', 'Encoder without errors or quantisation effects beyond its resolution.'],
  characteristics: ['Holds position against disturbances (stiffness set by the loop gains).', 'Follows a moving command with a lag (following error) that grows with speed.', 'High peak torque for short, fast moves.'],
  losses: ['Motor copper and iron losses.', 'Power-stage switching and conduction losses.', 'Only as much current as the load needs (unlike a stepper holding at full current).'],
  advantages: ['Accurate, fast and stiff positioning; detects and corrects errors.', 'High efficiency and dynamic performance.', 'Programmable motion (profiles, synchronisation of axes).'],
  limitations: ['More expensive and complex than a stepper (encoder, drive, tuning).', 'Loop gains must be tuned for the load; too high a gain makes it oscillate.', 'Needs the feedback: a faulty encoder stops the axis.'],
  applications: ['Industrial robots', 'CNC machine-tool axes', 'Packaging and pick-and-place machines', 'Camera gimbals and RC servos (small DC versions)'],
  misconceptions: [
    '"Servo motor" does not name a motor type: it is the role of a motor in a closed position loop — PMSM, DC or BLDC motors are all used.',
    'The encoder does not drive the motor; it only measures. The controller decides, the power stage supplies the energy.',
    'A higher loop gain is not always better: it cuts the following error but reduces the stability margin.',
  ],
  sources: ['Standard servo-drive practice (e.g. Ellis, Control System Design Guide; Younkin, Industrial Servo Control Systems).'],
}

export const SERVO_QUIZ: QuizItem[] = [
  { id: 'id-encoder', kind: 'identify', prompt: 'What is the highlighted part?', part: 'encoder', options: ['Encoder (feedback sensor)', 'Brake', 'Rotor magnets', 'Cooling fan'], answer: 0, explain: 'The encoder: a disc with fine lines and a read head that measures the shaft angle — the feedback of the loop.' },
  { id: 'id-power', kind: 'identify', prompt: 'What is the highlighted part?', part: 'power-stage', options: ['Controller board', 'Power stage (inverter)', 'Encoder', 'Motor stator'], answer: 1, explain: 'The power stage: transistors on a heatsink that turn the DC link into motor currents. The controller board only computes the commands.', misconceptions: { 0: 'The controller handles signals (command, feedback, loop calculations); the heatsink and big transistors belong to the power stage.' } },
  { id: 'match-role', kind: 'match', prompt: 'Which block compares the commanded and the measured position?', options: ['The controller', 'The encoder', 'The power stage', 'The motor'], answer: 0, explain: 'The controller computes the error θ* − θ and the commands from it. The encoder only measures; the power stage only supplies current; the motor only makes torque.' },
  { id: 'predict-load', kind: 'predict', prompt: 'A servo holds the arm at 90°. Someone pushes the arm. What does the servo do?', options: ['Increases the torque to push it back to 90°', 'Nothing: it only moves on a new command', 'It loses a step and stays at the new position'], answer: 0, explain: 'The push makes a position error; the loop raises the torque until the arm is back at the command. That is the point of the closed loop.', misconceptions: { 2: 'That is what can happen to an open-loop stepper — which has no feedback to notice it.' } },
  { id: 'predict-gain', kind: 'predict', prompt: 'The position gain Kv is doubled (the loop stays stable). The following error at constant speed…', options: ['halves', 'doubles', 'stays the same'], answer: 0, explain: 'e = ω / Kv: twice the gain, half the following error (and a faster response, τ = 1/Kv).' },
  { id: 'order-loop', kind: 'order', prompt: 'Put the signal path round the loop in order.', options: ['Position command θ*', 'Controller computes the error and a current command', 'Power stage supplies the phase currents', 'Motor makes torque and the shaft turns', 'Encoder measures the new angle and feeds it back'], answer: 0, explain: 'Command → controller → power stage → motor → encoder → back to the controller: a closed loop.' },
]
