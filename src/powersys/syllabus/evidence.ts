/**
 * Verbatim excerpts of the official syllabus documents (whitespace collapsed), generated from the PDFs retrieved on
 * 2026-10-13 — see sources.ts. They exist so that tests can prove every quoted phrase in mappings.ts really appears in
 * its source. Do not edit by hand; regenerate from the official documents when a new version is published.
 */
export const GATE_EE_2027: Record<string, string> = {
  '2': 'Electric circuits Network Elements: Ideal voltage and current sources, dependent sources, R, L, C, M elements; Network solution methods: KCL, KVL, Node and Mesh analysis; Network Theorems: Thevenin’s, Norton’s, Superposition and Maximum Power Transfer theorem; Transient response of DC and AC networks, sinusoidal steady-state analysis, resonance, two port networks, balanced three phase circuits, star-delta transformation, complex power and power factor in AC circuits.',
  '3': "Electromagnetic Fields Coulomb's Law, Electric Field Intensity, Electric Flux Density, Gauss's Law, Divergence, Electric field and potential due to point, line, plane and spherical charge distributions, Effect of dielectric medium, Capacitance of simple configurations, Biot‐Savart’s law, Ampere’s law, Curl, Faraday’s law, Lorentz force, Inductance, Magnetomotive force, Reluctance, Magnetic circuits, Self and Mutual inductance of simple configurations.",
  '6': 'Power Systems Basic concepts of electrical power generation, AC and DC transmission concepts, Models and performance of transmission lines and cables, Economic Load Dispatch (with and without considering transmission losses), Series and shunt compensation, Electric field distribution and insulators, Distribution systems, Per‐unit quantities, Bus admittance matrix, Gauss- Seidel and Newton-Raphson load flow methods, Voltage and Frequency control, Power factor correction, Symmetrical components, Symmetrical and unsymmetrical fault analysis, Principles of over‐ current, differential, directional and distance protection; Circuit breakers, System stability concepts, Equal area criterion.',
}

export const VIT_EEE_2023: Record<string, { title: string; modules: Record<string, string> }> = {
  BEEE304L: {
    title: 'Power Systems Engineering',
    modules: {
      '1': 'Power Generation 6 hours Power system structure; Comparison between AC and DC power supply; Classification of power generation systems; Conventional power generation: Thermal, hydel, nuclear and pumped storage scheme.',
      '2': 'Transmission Line Parameters 10 hours Transmission line parameters: Resistance, inductance and capacitance of single and three phase lines, single and double circuits, symmetrical and unsymmetrical conductor spacing; Transposition of conductors; Method of GMD; Bundled conductors; Effect of earth on transmission line capacitance; Skin and proximity effects; Interference with neighboring circuits.',
      '3': 'Representation of Power System Components 7 hours Single-phase representation of balanced three-phase networks; One-line diagram; Modeling of power system components; Impedance and reactance diagram; Per Unit (PU) system; Complex power.',
      '4': 'Performance of Transmission Line 10 hours Voltage regulation, Transmission efficiency; Representation of transmission lines: Short, medium and long lines; ABCD constants; Ferranti effect; Corona: Critical Disruptive Voltage (CDV), practical importance; Surge impedance and surge impedance loading; Tuned power lines; Power flow through a transmission line.',
      '5': 'Mechanical Design of Overhead Transmission Lines 10 hours Line supports and conductors; Insulators: types of insulators, string insulator and string efficiency, potential distribution over a string insulator, methods of improving of string efficiency, line sag and tension: wind and ice loading effect, string chart, sag template, vibration dampers; Comparison between overhead line and underground cables, types of underground cables and its construction.',
      '6': 'Distribution Systems & Substations 8 hours Distribution System: Classification, section and size of feeders, schemes of distributor connections AC distributors; Substation design: Classification based on service and design, equipment, types of bus bar arrangements, Key diagram of 33/11 kV and 11 kV/415 V substation, optimal Substation location, earthing of substation, methods of neutral grounding.',
      '7': 'Tariff and Power Factor Correction 7 hours Load curve; Tariff: Characteristics and types; Power factor: Causes of low power factor, power factor improvement and equipment, calculation of power factor capacitance rating.',
    },
  },
  BEEE306L: {
    title: 'Power Systems Analysis',
    modules: {
      '1': 'Power System Network Modelling 6 hours Need for system analysis in planning and operation of power system; distinction between steady state and transient state; general aspects of power flow, short circuit and stability analysis; Admittance (YBUS), sparse matrix and impedance (ZBUS) matrix; Equivalent circuit of transformer with off-nominal tap ratio; Phase shifting transformers.',
      '2': 'Load Flow Analysis 7 hours Problem definition; Derivation of power flow equation; Bus classification; Po we r f l o w, Newton-Raphson and fast decoupled methods; DC load flow; P-V bus adjustment; computation of slack bus power; transmission loss and line flows.',
      '3': 'Symmetrical Short Circuit Analysis 7 hours Need for short circuit study; Approximations in modeling; Short circuit capacity; Symmetrical short circuit analysis; Algorithm for short circuit studies; Fault calculations using ZBUS.',
      '4': 'Unsymmetrical Short Circuit Analysis 6 hours Symmetrical component transformation; Positive, negative and zero sequence impedances; Unsymmetrical Faults; L-G, L-L and L-L-G fault analysis using sequence networks.',
      '5': 'Stability Analysis 6 hours Swing equation in state space form; Equal area criterion; Critical clearing angle and time; Voltage stability analysis.',
      '6': 'Real-time Monitoring and Control of Power Systems 6 hours Requirements for monitoring control and operation; Dynamics and control time scales; Supervisory Control and Data Acquisition (SCADA) system; Concepts of synchrophasors; Wide Area Monitoring Systems (WAMS); Phasor Measurement Units (PMUs); Augmentation of Wide Area Monitoring Systems (WAMS) for real time control with SCADA systems.',
      '7': 'Power System Protection 5 hours Power system protection concepts and relaying; Electromagnetic and static relays; Overcurrent and differential protection; Distance protection; Relay coordination.',
    },
  },
  BEEE401E: {
    title: 'Power Systems Protection and Switchgear',
    modules: {
      '1': 'Grounded Neutral System 4 hours Ungrounded and grounded neutral system; Types of neutral grounding; Earthing at substation and line structure',
      '2': 'Protective devices 5 hours Review of relay characteristics; Protection schemes: simple and percentage differential relay protection scheme, Distance protection scheme by simple impedance relay, mho relay and reactance relay; Protective transformers: Current transformer, Potential transformer, Characteristics',
      '3': 'Digital and Numerical Relay 5 hours Digital relay; Micro-Processor based relay; Trivector meter; Numerical Relay: Numerical relaying and algorithms; Phasor extraction; Smart relay; Smart meter',
      '4': 'Unit Protection Schemes 6 hours Generator: Stator protection, rotor protection, loss of excitation; Transformer protection from external faults, internal faults and incipient faults; Bus-bar differential protection; Transmission line protection using digital relays; Concepts of Digital protection',
      '5': 'Arc Phenomenon 4 hours Arc: Formation, Interruption, Extinction; Restriking voltage: Peak restriking voltage, Recovery voltage, rate of rise of recovery voltage, making & breaking capacity; Resistance switching: current chopping, interruption of capacitive current',
      '6': 'Circuit Breakers 4 hours DC Circuit breaking; Types of Circuit breakers: Oil, Air blast, Vacuum and SF6; Testing of circuit breakers; Type tests and Routine tests',
      '7': 'Contemporary Issues 2 hours',
    },
  },
  BEEE402L: {
    title: 'Power Systems Operation and Control',
    modules: {
      '1': 'Power System Load Characteristics 5 hours Power scenario in Indian grid; Indian Grid codes; Functions of National and regional load dispatch centres; Requirements of good power system, Necessity of voltage and frequency regulation; Automatic generation control; System load characteristics: Load curve and load duration curve, Load factor and diversity factor; Reserves; Case studies',
      '2': 'Real Power and Frequency Control 7 hours Relation between real power and frequency, Turbine speed governing mechanisms and modelling; Load Frequency Control (LFC) of single area system: Static and dynamic responses of uncontrolled and controlled cases, Control area concept; Tie line modelling; LFC of two area system: Static and dynamic responses, tie line with frequency bias control, Integration of economic despatch control with LFC',
      '3': 'Reactive Power and Voltage Control 7 hours Relation between reactive power and voltage control, Generation and absorption of reactive power, Basics of reactive power control, Automatic Voltage Regulator (AVR), Brushless AC excitation system and AVR modelling: Static and dynamic responses; Voltage drop in transmission line, Methods of reactive power control on transmission system: Concept of Tap changing transformer, Series and shunt Reactor, FACTS devices',
      '4': 'Unit Commitment 6 hours Cost function formulation, Constraints in unit commitment: spinning reserve, thermal, hydro, must run, fuel and other constraints, unit commitment solution methods: Priority-list, dynamic programming',
      '5': 'Economic Dispatch 7 hours Comparison of economic dispatch and unit commitment (UC), Incremental cost curve, co- ordination equations without loss and with loss, Economic dispatch with Linear Programming, Lambda iteration method, dynamic programming, Base point and participation factors',
      '6': 'System Security 5 hours Factors affecting power system security, security state diagram; Contingency analysis: Generation and transmission outages; State estimation; Application of power systems state estimation',
      '7': 'Energy Management System 6 hours Energy control centre, EMS functions, framework and time frame, data acquisition and control: SCADA, RTU and IED, Monitor, WAMS, PMU with GPS',
    },
  },
  BEEE404L: {
    title: 'High Voltage Engineering',
    modules: {
      '1': 'High voltages in electrical systems and electric stress: 6 Hours Levels of High voltage, Electrical insulation and Dielectrics, importance of electric field intensity in the dielectrics, Electric field stresses, gas / vacuum as insulator, estimation and control of electric stress, Surge voltage their distribution and control',
      '2': 'Conduction and breakdown in gases 6 Hours Gases as insulating media, Collision Processes, Ionization growth equation, Current growth in the presence of secondary processes, akdown in electro negative gases, time lags for breakdown, streamer theory of breakdown in gases, non-uniform field and corona discharges',
      '3': 'Conduction and breakdown in Liquid, solid dielectrics 6 Hours Liquids as insulator, conduction and breakdown in pure liquids, conduction and breakdown in commercial liquids, testing of insulating oils, breakdown in solid dielectrics, intrinsic, electromechanical and thermal breakdown in composite dielectrics',
      '4': 'Generations of high voltages and currents 6 Hours Generations of high direct current and alternating voltages, generation of impulse voltages and currents, tripping and control of impulse generators; Resonant transformer and tesla coil- generation of switching surges',
      '5': 'Measurement of high voltages and currents 6 Hours Measurement of high direct current voltages, Measurement of high ac and impulse voltages, Measurement of high current, direct, alternating and impulse, cathode ray oscillographs for impulse voltage and current measurements, measurement of dielectric constant and loss factor; Digital techniques in high voltage measurement, partial discharge measurement',
      '6': 'High voltage testing of electrical apparatus 7 Hours Testing of insulators and bushings, Testing of isolators and circuit breakers, Testing of cables, Testing of transformers, Testing of surge arrestors, radio interference measurements',
      '7': 'Over voltage and insulation coordination in electric power system: 6 Hours Natural causes for over voltages, lightning switching and temporary over voltage, Protection against over voltage, lattice diagram, and principles of insulation coordination on high voltage and extra high voltage power system, High voltage testing of electrical power apparatus as per International and Indian standards: IEC, ISO',
    },
  },
  BEEE406L: {
    title: 'FACTS and HVDC',
    modules: {
      '1': 'Concept of FACTS and HVDC 6 hours Need for transmission interconnections; Control of power flow in AC transmission lines: Types, Definitions of FACTS controllers and benefits; HVDC transmission, Comparison between HVDC and HVAC systems',
      '2': 'Shunt connected FACTS devices 7 hours Shunt compensation: Midpoint voltage regulation for line segmentation, End of line voltage support to prevent voltage instability, Improvement of transient stability; Methods of controllable VAR generations, working principles and characteristics of SVC, TCR, TSC, FC- TCR, TCR-TSC, STATCOM, Comparison between STATCOM and SVC',
      '3': 'Series connected FACTS devices 7 hours Series compensation: Concept of series capacitive compensation, voltage stability, improvement of transient stability; Variable Impedance Type Series Compensators: Working principles and characteristics of GCSC, TSSC and TCSC; Switching Converter Type Series Compensators: Working principles and characteristics of SSSC',
      '4': 'Combined Controllers 6 hours Unified Power Flow Controller: Operating principles, conventional transmission control capabilities; Interline Power Flow Controller: Operating principles and characteristics; Generalized and Multifunctional FACTS controllers',
      '5': 'Special Purpose FACTS Controllers 5 hours Torsional Oscillations in power systems; Sub-Synchronous Resonance (SSR); Design and operation of NGH-SSR damping scheme and Thyristor-Controlled Braking Resistor (TCBR); Controller coordination',
      '6': 'HVDC Transmission 7 hours CSI and VSI based HVDC systems, Components of HVDC, Principles of HVDC Control, Configuration of HVDC system, Recent trends in HVDC transmission, HVDC systems in India, Case study',
      '7': 'HVDC Links and Grounding 5 hours Types of DC links: Mono polar, Homo polar, bipolar, back-to-back HVDC connections, Multi- terminal HVDC systems, Grounding and Ground Electrodes for HVDC Systems',
    },
  },
}
