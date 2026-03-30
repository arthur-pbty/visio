import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'visio.db');
const db = new Database(dbPath);

// Initialiser la base de données
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  )
`);

export interface Room {
  id: string;
  name: string;
  created_at: string;
  last_activity: string;
  is_active: number;
}

export function createRoom(id: string, name: string): Room {
  const stmt = db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?)');
  stmt.run(id, name);
  return getRoom(id)!;
}

export function getRoom(id: string): Room | undefined {
  const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?');
  return stmt.get(id) as Room | undefined;
}

export function updateRoomActivity(id: string): void {
  const stmt = db.prepare('UPDATE rooms SET last_activity = CURRENT_TIMESTAMP WHERE id = ?');
  stmt.run(id);
}

export function closeRoom(id: string): void {
  const stmt = db.prepare('UPDATE rooms SET is_active = 0 WHERE id = ?');
  stmt.run(id);
}

export function getInactiveRooms(minutesInactive: number = 5): Room[] {
  const stmt = db.prepare(`
    SELECT * FROM rooms 
    WHERE is_active = 1 
    AND datetime(last_activity, '+' || ? || ' minutes') < datetime('now')
  `);
  return stmt.all(minutesInactive) as Room[];
}

export function cleanupInactiveRooms(): number {
  const inactiveRooms = getInactiveRooms(5);
  const stmt = db.prepare('UPDATE rooms SET is_active = 0 WHERE id = ?');
  
  for (const room of inactiveRooms) {
    stmt.run(room.id);
  }
  
  return inactiveRooms.length;
}

export default db;
