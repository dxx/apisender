
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieRecord {
    pub id: i64,
    pub domain: String,
    pub path: String,
    pub name: String,
    pub value: String,
    pub expires_at: Option<String>,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
}

pub fn upsert(
    conn: &Connection,
    domain: &str,
    path: &str,
    name: &str,
    value: &str,
    expires_at: Option<&str>,
    secure: bool,
    http_only: bool,
    same_site: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO cookies (domain, path, name, value, expires_at, secure, http_only, same_site)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(domain, path, name) DO UPDATE SET
            value = excluded.value,
            expires_at = excluded.expires_at,
            secure = excluded.secure,
            http_only = excluded.http_only,
            same_site = excluded.same_site",
        params![
            domain,
            path,
            name,
            value,
            expires_at,
            secure as i32,
            http_only as i32,
            same_site,
        ],
    )?;
    Ok(())
}

pub fn list_by_domain(conn: &Connection, domain: &str) -> AppResult<Vec<CookieRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, domain, path, name, value, expires_at, secure, http_only, same_site
         FROM cookies WHERE domain = ?1 OR domain = ?2
         ORDER BY path DESC, name",
    )?;

    let dot_domain = format!(".{}", domain);
    let rows = stmt.query_map(params![domain, dot_domain], |row| {
        Ok(CookieRecord {
            id: row.get(0)?,
            domain: row.get(1)?,
            path: row.get(2)?,
            name: row.get(3)?,
            value: row.get(4)?,
            expires_at: row.get(5)?,
            secure: row.get::<_, i32>(6)? != 0,
            http_only: row.get::<_, i32>(7)? != 0,
            same_site: row.get(8)?,
        })
    })?;

    let mut cookies = Vec::new();
    for row in rows {
        cookies.push(row?);
    }
    Ok(cookies)
}

pub fn delete_expired(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "DELETE FROM cookies WHERE expires_at IS NOT NULL AND expires_at != '' AND expires_at < datetime('now')",
        [],
    )?;
    Ok(())
}

pub fn clear_all(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM cookies", [])?;
    Ok(())
}
