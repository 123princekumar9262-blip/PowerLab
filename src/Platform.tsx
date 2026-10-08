import { useEffect, useState } from 'react'
import { App } from './App.tsx'
import { DcdcLab } from './components/dcdc/DcdcLab.tsx'
import { LabShell } from './components/lab/LabShell.tsx'
import { PWM_TOPIC } from './topics/pwm.tsx'
import { inverterTopic } from './topics/inverters.tsx'

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
  { id: 'devices', label: 'Devices', ready: false, title: 'Planned: power semiconductor devices' },
  { id: 'drives', label: 'Drives', ready: false, title: 'Planned: motor drives' },
  { id: 'magnetics', label: 'Magnetics', ready: false, title: 'Planned: inductors and transformers' },
  { id: 'control', label: 'Control', ready: false, title: 'Planned: converter control' },
  { id: 'ev', label: 'EV', ready: false, title: 'Planned: electric-vehicle power electronics' },
  { id: 'engineering', label: 'Engineering', ready: false, title: 'Planned: losses, thermal and practical design' },
]

const ROUTED: ModuleId[] = ['dcdc', 'pwm', 'inverters']
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
