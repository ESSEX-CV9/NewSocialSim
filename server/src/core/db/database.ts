import Database from 'better-sqlite3';

export type WorldDb = Database.Database;

export function openDb(file: string): WorldDb {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
