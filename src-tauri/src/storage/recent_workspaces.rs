
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub path: String,
    pub name: String,
    pub last_opened_at: String,
}

pub fn upsert(conn: &Connection, path: &str, name: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO recent_workspaces (path, name, last_opened_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            last_opened_at = datetime('now')",
        params![path, name],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, limit: Option<i64>) -> AppResult<Vec<RecentWorkspace>> {
    let limit = limit.unwrap_or(10);
    let mut stmt = conn.prepare(
        "SELECT path, name, last_opened_at FROM recent_workspaces
         ORDER BY last_opened_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(RecentWorkspace {
            path: row.get(0)?,
            name: row.get(1)?,
            last_opened_at: row.get(2)?,
        })
    })?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }
    Ok(entries)
}

pub fn remove(conn: &Connection, path: &str) -> AppResult<()> {
    conn.execute("DELETE FROM recent_workspaces WHERE path = ?1", params![path])?;
    Ok(())
}
