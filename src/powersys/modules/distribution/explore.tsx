import { useState } from 'react'
import { Seg } from '../../ui/kit.tsx'
import { AcLab } from './AcLab.tsx'
import { DcLab } from './DcLab.tsx'
import { KelvinLab } from './KelvinLab.tsx'
import { PfLab } from './PfLab.tsx'

type Tab = 'dc' | 'ac' | 'pf' | 'kelvin'

export function Explore() {
  const [tab, setTab] = useState<Tab>('dc')
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="What to explore"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'dc', label: 'DC distributor' },
            { id: 'ac', label: 'AC distributor' },
            { id: 'pf', label: 'Power-factor correction' },
            { id: 'kelvin', label: 'Conductor size (Kelvin)' },
          ]}
        />
      </div>
      {tab === 'dc' && <DcLab />}
      {tab === 'ac' && <AcLab />}
      {tab === 'pf' && <PfLab />}
      {tab === 'kelvin' && <KelvinLab />}
    </div>
  )
}
