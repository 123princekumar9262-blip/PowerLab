import { useEffect, useState } from 'react'
import { App } from './App.tsx'
import { DcdcLab } from './components/dcdc/DcdcLab.tsx'
import { LabShell } from './components/lab/LabShell.tsx'
import { PWM_TOPIC } from './topics/pwm.tsx'
import { inverterTopic } from './topics/inverters.tsx'
import { controlTopic } from './topics/control.tsx'
import { MOSFET_TOPIC } from './topics/devices.tsx'
import { DRIVE_TOPIC } from './topics/drives.tsx'
import { CORE_TOPIC } from './topics/magnetics.tsx'
import { EV_TOPIC } from './topics/ev.tsx'
import { THERMAL_TOPIC } from './topics/engineering.tsx'

const CONTROL_ENTRIES = (['buck', 'boost'] as const).map((k) => {
  const topic = controlTopic(k)
  return { id: k, label: topic.label, title: topic.title, topic }
})

const INVERTER_ENTRIES = (['1ph', '3ph', 'spwm', 'svpwm'] as const).map((k) => {
  const topic = inverterTopic(k)
  return { id: k, label: topic.label, title: topic.title, topic }
})

/**
 * Power-electronics platform shell: one module at a time. Only the modules that are built and
 * validated can be opened; the rest are shown as the roadmap (disabled), never as empty pages.
 */
type ModuleId = 'rectifiers' | 'dcdc' | 'pwm' | 'inverters' | 'devices' | 'drives' | 'magnetics' | 'control' | 'ev' | 'engineering'

const MODULES: Array<{ id: ModuleId; label: string; ready: boolean; title: string }> = [
  { id: 'rectifiers', label: 'Rectifiers', ready: true, title: 'Diode and SCR rectifiers, single- and three-phase' },
  { id: 'dcdc', label: 'DC-DC', ready: true, title: 'Switched-mode DC-DC converters: buck, boost, buck-boost' },
  { id: 'pwm', label: 'PWM', ready: true, title: 'PWM lab: carriers, references, sampling, spectrum' },
  { id: 'inverters', label: 'Inverters', ready: true, title: 'Single- and three-phase inverters, SPWM, SVPWM' },
  { id: 'devices', label: 'Devices', ready: true, title: 'Power semiconductor devices: MOSFET switching transients' },
  { id: 'drives', label: 'Drives', ready: true, title: 'Motor drives: DC motor on a one- or two-quadrant PWM chopper' },
  { id: 'magnetics', label: 'Magnetics', ready: true, title: 'Magnetics: gapped inductor, volt-seconds, saturation' },
  { id: 'control', label: 'Control', ready: true, title: 'Closed-loop control: PID voltage loops, Bode, stability' },
  { id: 'ev', label: 'EV', ready: true, title: 'Electric vehicles: drivetrain energy on a drive cycle, acceleration, regeneration' },
  { id: 'engineering', label: 'Engineering', ready: true, title: 'Engineering: switch losses, thermal impedance, power cycling, thermal runaway' },
]

const ROUTED: ModuleId[] = ['dcdc', 'pwm', 'inverters', 'control', 'devices', 'drives', 'magnetics', 'ev', 'engineering']
const fromHash = (): ModuleId => {
  const h = window.location.hash.replace('#', '').split('/')[0] as ModuleId
  return ROUTED.includes(h) ? h : 'rectifiers'
}

export function Platform() {
  const [module, setModule] = useState<ModuleId>(fromHash)
  useEffect(() => {
    const onHash = () => setModule(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const open = (m: ModuleId) => {
    setModule(m)
    const h = m === 'rectifiers' ? '' : `#${m}`
    if (window.location.hash !== h) window.history.replaceState(null, '', h || window.location.pathname)
  }
  return (
    <>
      <nav className="platform-bar" aria-label="Modules">
        <span className="platform-name">Power Electronics Lab</span>
        <div className="platform-modules" role="tablist" aria-label="Module">
          {MODULES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={module === m.id}
              disabled={!m.ready}
              className={`platform-tab ${module === m.id ? 'on' : ''}`}
              title={m.title}
              onClick={() => open(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </nav>
      {module === 'dcdc' ? (
        <DcdcLab />
      ) : module === 'devices' ? (
        <LabShell key="devices" eyebrow="Devices" entries={[{ id: 'mosfet', label: 'MOSFET switching', title: 'Double-pulse test', topic: MOSFET_TOPIC }]} />
      ) : module === 'drives' ? (
        <LabShell key="drives" eyebrow="Drives" entries={[{ id: 'dcmotor', label: 'DC motor drive', title: 'DC motor fed by a PWM chopper', topic: DRIVE_TOPIC }]} />
      ) : module === 'magnetics' ? (
        <LabShell key="magnetics" eyebrow="Magnetics" entries={[{ id: 'inductor', label: 'Gapped inductor', title: 'Gapped-core winding on a square-wave bridge', topic: CORE_TOPIC }]} />
      ) : module === 'ev' ? (
        <LabShell key="ev" eyebrow="EV" entries={[{ id: 'evdrive', label: 'EV drivetrain', title: 'Electric drivetrain on a drive cycle', topic: EV_TOPIC }]} />
      ) : module === 'engineering' ? (
        <LabShell key="engineering" eyebrow="Engineering" entries={[{ id: 'thermal', label: 'Losses & thermal', title: 'Switch losses through the thermal path', topic: THERMAL_TOPIC }]} />
      ) : module === 'control' ? (
        <LabShell key="control" eyebrow="Control" entries={CONTROL_ENTRIES} />
      ) : module === 'inverters' ? (
        <LabShell key="inv" eyebrow="Inverters" entries={INVERTER_ENTRIES} />
      ) : module === 'pwm' ? (
        <LabShell key="pwm" eyebrow="PWM" entries={[{ id: 'pwm', label: 'PWM Lab', title: 'Carriers, references, sampling and spectrum', topic: PWM_TOPIC }]} />
      ) : (
        <App />
      )}
    </>
  )
}
