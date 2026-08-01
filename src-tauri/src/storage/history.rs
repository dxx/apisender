
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub workspace_path: String,
    pub file_path: Option<String>,
    pub method: String,
    pub url: String,
    pub status: Option<i64>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetail {
    pub entry: HistoryEntry,
    pub request_snapshot: Option<String>,
    pub response_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewHistoryEntry {
    pub workspace_path: String,
    pub file_path: Option<String>,
    pub method: String,
    pub url: String,
    pub status: Option<i64>,
    pub duration_ms: Option<i64>,
    pub request_snapshot: Option<String>,
    pub response_snapshot: Option<String>,
}

pub fn insert(conn: &Connection, entry: &NewHistoryEntry) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO history (workspace_path, file_path, method, url, status, duration_ms, request_snapshot, response_snapshot)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.workspace_path,
            entry.file_path,
            entry.method,
            entry.url,
            entry.status,
            entry.duration_ms,
            entry.request_snapshot,
            entry.response_snapshot,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_by_workspace(
    conn: &Connection,
    workspace_path: &str,
    limit: Option<i64>,
) -> AppResult<Vec<HistoryEntry>> {
    let limit = limit.unwrap_or(200);
    let mut stmt = conn.prepare(
        "SELECT id, workspace_path, file_path, method, url, status, duration_ms, created_at
         FROM history WHERE workspace_path = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![workspace_path, limit], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            workspace_path: row.get(1)?,
            file_path: row.get(2)?,
            method: row.get(3)?,
            url: row.get(4)?,
            status: row.get(5)?,
            duration_ms: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }
    Ok(entries)
}

pub fn get_detail(conn: &Connection, id: i64) -> AppResult<HistoryDetail> {
    let entry = conn.query_row(
        "SELECT id, workspace_path, file_path, method, url, status, duration_ms, created_at
         FROM history WHERE id = ?1",
        params![id],
        |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                workspace_path: row.get(1)?,
                file_path: row.get(2)?,
                method: row.get(3)?,
                url: row.get(4)?,
                status: row.get(5)?,
                duration_ms: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )?;

    let request_snapshot: Option<String> = conn.query_row(
        "SELECT request_snapshot FROM history WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;

    let response_snapshot: Option<String> = conn.query_row(
        "SELECT response_snapshot FROM history WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;

    Ok(HistoryDetail {
        entry,
        request_snapshot,
        response_snapshot,
    })
}

pub fn clear_by_workspace(conn: &Connection, workspace_path: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM history WHERE workspace_path = ?1",
        params![workspace_path],
    )?;
    Ok(())
}

pub fn delete_by_id(conn: &Connection, id: i64, workspace_path: &str) -> AppResult<bool> {
    let changed = conn.execute(
        "DELETE FROM history WHERE id = ?1 AND workspace_path = ?2",
        params![id, workspace_path],
    )?;
    Ok(changed > 0)
}
