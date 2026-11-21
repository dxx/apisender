pub const SCHEMA_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_path TEXT NOT NULL,
    file_path TEXT,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    status INTEGER,
    duration_ms INTEGER,
    request_snapshot TEXT,
    response_snapshot TEXT,
    request_raw TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_history_workspace ON history(workspace_path);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);

CREATE TABLE IF NOT EXISTS cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '/',
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT,
    secure INTEGER NOT NULL DEFAULT 0,
    http_only INTEGER NOT NULL DEFAULT 0,
    same_site TEXT,
    UNIQUE(domain, path, name)
);

CREATE TABLE IF NOT EXISTS recent_workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    last_opened_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

/// 入参：数据库连接。
/// 出参：迁移结果。
/// 作用与流程：为旧版本数据库补齐 `history.request_raw` 列，保证新字段可用。
pub fn migrate(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let has_request_raw: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('history') WHERE name = 'request_raw'",
        [],
        |row| row.get(0),
    )?;
    if has_request_raw == 0 {
        conn.execute("ALTER TABLE history ADD COLUMN request_raw TEXT", [])?;
    }
    Ok(())
}
