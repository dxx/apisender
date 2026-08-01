
use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::storage::{cookies as cookies_db, Db};

pub fn get_cookies_for_host(db: &Db, host: &str) -> AppResult<HashMap<String, String>> {
    if host.is_empty() {
        return Ok(HashMap::new());
    }
    let conn = db
        .0
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let records = cookies_db::list_by_domain(&conn, host)?;
    Ok(records
        .into_iter()
        .map(|c| (c.name, c.value))
        .collect())
}

pub fn upsert_cookie(
    db: &Db,
    domain: &str,
    path: &str,
    name: &str,
    value: &str,
    expires_at: Option<&str>,
    secure: bool,
    http_only: bool,
    same_site: Option<&str>,
) -> AppResult<()> {
    let conn = db
        .0
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    cookies_db::upsert(
        &conn,
        domain,
        path,
        name,
        value,
        expires_at,
        secure,
        http_only,
        same_site,
    )
}

pub fn cleanup_expired(db: &Db) -> AppResult<()> {
    let conn = db
        .0
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    cookies_db::delete_expired(&conn)
}

#[allow(dead_code)]
pub fn clear_all(db: &Db) -> AppResult<()> {
    let conn = db
        .0
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    cookies_db::clear_all(&conn)
}
