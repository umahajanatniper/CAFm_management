// =============================================================
// data.js — Seed data for IndexedDB (loaded before app.js)
// =============================================================

const sampleData = {
  projects: [
    { id: 'P001', name: 'Cancer Research', pi: 'Dr. Mahajan', students: 'AA', animals: 45, status: 'Active' },
    { id: 'P002', name: 'Diabetes Study', pi: 'Dr. Sharma', students: 'AB', animals: 32, status: 'Active' },
    { id: 'P003', name: 'Neurology Research', pi: 'Dr. Jena', students: 'AC', animals: 28, status: 'Active' }
  ],
  tasks: [
    { task: 'Change bedding - Room A', type: 'Bedding Change', assignedTo: 'AA', dueDate: '2025-10-15', status: 'Pending' },
    { task: 'Health check - Cage 12-15', type: 'Health Check', assignedTo: 'AB', dueDate: '2025-10-14', status: 'Pending' },
    { task: 'Maintenance - HVAC System', type: 'Maintenance', assignedTo: 'Admin', dueDate: '2025-10-16', status: 'In Progress' }
  ],
  animals: [
    { id: '00001', species: 'Rat', age: 12, gender: 'Male', project: 'P001', status: 'Alive', details: '-' },
    { id: '00002', species: 'Mouse', age: 8, gender: 'Female', project: 'P002', status: 'In Experiment', details: '-' },
    { id: '00003', species: 'Guinea Pig', age: 16, gender: 'Male', project: 'P003', status: 'Completed', details: 'Blood, Tissue' }
  ],
  breeding: [
    { id: 'B001', species: 'Rat', male: '00001', female: '00004', startDate: '2025-09-01', expected: '2025-10-20', status: 'Active' },
    { id: 'B002', species: 'Mouse', male: '00002', female: '00005', startDate: '2025-09-15', expected: '2025-11-05', status: 'Active' }
  ],
  reports: [
    { type: 'Ethical Approval', project: 'P001', approval: 'EA-2025-001', validUntil: '2026-10-13', status: 'Approved' },
  ]
};
