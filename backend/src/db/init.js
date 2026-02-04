import { getDb, closeDb } from './database.js';

console.log('Initializing database...');
const db = getDb();
console.log('Database initialized successfully!');
console.log('Tables created: accounts, trades, imports');
closeDb();
