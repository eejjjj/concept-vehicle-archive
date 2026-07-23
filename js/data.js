const VEHICLES = [
  {
    id: 1,
    code: 'CV-001',
    slug: '001',
    name: 'NINEBOT EMAX',
    year: 2047,
    available: true,
    tagline: 'Atmospheric reconnaissance platform',
    description:
      'Designed for low-orbit atmospheric sampling, the Ninebot Emax operates at the threshold between sky and space. Its ion-thrust vectoring system allows silent hover over urban zones while collecting particulate data through its dorsal intake array.',
    specs: {
      'Propulsion': 'Dual Ion Vector',
      'Range': '2,400 km',
      'Crew': '1 + AI co-pilot',
      'Max Altitude': '42 km',
      'Status': 'Declassified',
    },
    tags: ['Atmospheric', 'Recon', 'Ion Drive'],
  },
  {
    id: 2,
    code: 'CV-002',
    slug: '002',
    name: 'NINEBOT NEXT',
    year: 2049,
    available: true,
    tagline: 'Urban mobility lattice node',
    description:
      'The Ninebot Next was conceived as a modular transit cell within a city-scale autonomous network. Its hexagonal chassis docks into magnetic rail corridors, reconfiguring its interior layout based on passenger density algorithms updated in real time.',
    specs: {
      'Propulsion': 'Magnetic Rail + EV',
      'Capacity': '6 passengers',
      'Network': 'Grid-7 Metro',
      'Autonomy': 'Level 5',
      'Status': 'Declassified',
    },
    tags: ['Urban', 'Modular', 'Autonomous'],
  },
  {
    id: 3,
    code: 'CV-003',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
  {
    id: 4,
    code: 'CV-004',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
  {
    id: 5,
    code: 'CV-005',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
  {
    id: 6,
    code: 'CV-006',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
  {
    id: 7,
    code: 'CV-007',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
  {
    id: 8,
    code: 'CV-008',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
  {
    id: 9,
    code: 'CV-009',
    name: 'CLASSIFIED',
    year: null,
    available: false,
  },
];

function getVehicle(id) {
  return VEHICLES.find((v) => v.id === Number(id));
}

function getVehicleBySlug(slug) {
  return VEHICLES.find((v) => v.slug === slug);
}

function vehicleUrl(v) {
  return `/${v.slug}/`;
}

function getAvailableCount() {
  return VEHICLES.filter((v) => v.available).length;
}
