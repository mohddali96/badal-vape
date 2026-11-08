const { db } = require('./db');
const { seed } = require('./seed');

if (!seed(db)) console.log('Database already contains data; nothing seeded. Delete data/badal.db to reseed.');
