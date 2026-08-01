
use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

use self::schema::SCHEMA_SQL;

pub mod schema;
pub mod history;
pub mod cookies;
pub mod recent_workspaces;

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn new(path: &std::path::Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(Db(Mutex::new(conn)))
    }

    pub fn with_handle<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&Connection) -> AppResult<T>,
    {
        let conn = self.0.lock().map_err(|e| AppError::Storage(e.to_string()))?;
        f(&conn)
    }
}

pub fn init_db(app: &AppHandle) -> AppResult<()> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Storage(format!("Failed to get app data dir: {}", e)))?;

    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("apisender.db");
    let db = Db::new(&db_path)?;
    app.manage(db);
    Ok(())
}

pub fn get_db(app: &AppHandle) -> AppResult<&Db> {
    let state = app
        .try_state::<Db>()
        .ok_or_else(|| AppError::Storage("Db not initialized".to_string()))?;
    Ok(state.inner())
}