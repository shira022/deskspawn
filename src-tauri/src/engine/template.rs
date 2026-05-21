use crate::models::config::TemplateColumn;

/// Represents a generated file with its path and content.
#[derive(Debug, Clone)]
pub struct GeneratedFile {
    pub path: String,
    pub content: String,
}

/// Holds all generated files from a CRUD template expansion.
#[derive(Debug, Clone)]
pub struct GeneratedFiles {
    pub migration: Option<GeneratedFile>,
    pub rust_code: Option<GeneratedFile>,
    pub ts_hooks: Option<GeneratedFile>,
}

impl GeneratedFiles {
    pub fn get_all_paths(&self) -> Vec<String> {
        let mut paths = Vec::new();
        if let Some(ref m) = self.migration {
            paths.push(m.path.clone());
        }
        if let Some(ref r) = self.rust_code {
            paths.push(r.path.clone());
        }
        if let Some(ref t) = self.ts_hooks {
            paths.push(t.path.clone());
        }
        paths
    }
}

/// SQL type → Rust type mapping.
fn sql_to_rust_type(sql_type: &str) -> &str {
    match sql_type.to_lowercase().as_str() {
        "integer" | "int" | "int4" | "int8" | "bigint" | "smallint" => "i64",
        "text" | "varchar" | "char" | "string" => "String",
        "boolean" | "bool" => "bool",
        "real" | "float" | "double" | "float8" => "f64",
        "blob" | "bytea" => "Vec<u8>",
        "date" | "timestamp" | "datetime" | "timestamptz" => "chrono::NaiveDateTime",
        "uuid" => "uuid::Uuid",
        "json" | "jsonb" => "serde_json::Value",
        _ => "String",
    }
}

/// SQL type → TypeScript type mapping.
fn sql_to_ts_type(sql_type: &str, nullable: bool) -> String {
    let base = match sql_type.to_lowercase().as_str() {
        "integer" | "int" | "int4" | "int8" | "bigint" | "smallint" => "number",
        "text" | "varchar" | "char" | "string" => "string",
        "boolean" | "bool" => "boolean",
        "real" | "float" | "double" | "float8" => "number",
        "blob" | "bytea" => "number[]",
        "date" | "timestamp" | "datetime" | "timestamptz" => "string",
        "uuid" => "string",
        "json" | "jsonb" => "Record<string, unknown>",
        _ => "string",
    };

    if nullable {
        format!("{} | null", base)
    } else {
        base.to_string()
    }
}

/// Generate CRUD files for a given table name and column definitions.
pub fn generate_crud_files(
    table_name: &str,
    columns: &[TemplateColumn],
) -> Result<GeneratedFiles, String> {
    if table_name.is_empty() {
        return Err("Table name cannot be empty".to_string());
    }
    if columns.is_empty() {
        return Err("At least one column is required".to_string());
    }

    let pascal_name = to_pascal_case(table_name);
    let snake_name = to_snake_case(table_name);

    let migration_sql = generate_migration_sql(table_name, columns);
    let migration_file = GeneratedFile {
        path: format!("migrations/{}_create_{}.sql", get_timestamp_prefix(), snake_name),
        content: migration_sql,
    };

    let rust_code = generate_rust_module(&pascal_name, &snake_name, columns);
    let rust_file = GeneratedFile {
        path: format!(
            "src-tauri/src/generated/{}_generated.rs",
            snake_name
        ),
        content: rust_code,
    };

    let ts_hooks = generate_ts_hooks(&pascal_name, &snake_name, columns);
    let ts_file = GeneratedFile {
        path: format!("src/hooks/use{}.ts", pascal_name),
        content: ts_hooks,
    };

    Ok(GeneratedFiles {
        migration: Some(migration_file),
        rust_code: Some(rust_file),
        ts_hooks: Some(ts_file),
    })
}

/// Generate a SQL migration file.
fn generate_migration_sql(table_name: &str, columns: &[TemplateColumn]) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "-- @deskspawn:generated table={}\n\
         -- Migration: create {} table\n",
        table_name, table_name
    ));
    lines.push(format!("CREATE TABLE IF NOT EXISTS {} (", table_name));

    let col_defs: Vec<String> = columns
        .iter()
        .map(|col| {
            let mut def = format!("    {}", col.name);
            def.push_str(&format!(" {}", col.sql_type));

            if !col.nullable {
                def.push_str(" NOT NULL");
            }

            if col.primary_key {
                def.push_str(" PRIMARY KEY");
            }

            if col.unique {
                def.push_str(" UNIQUE");
            }

            if let Some(ref default) = col.default {
                def.push_str(&format!(" DEFAULT {}", default));
            }

            if let Some(ref references) = col.references {
                def.push_str(&format!(" REFERENCES {}", references));
            }

            def
        })
        .collect();

    lines.push(col_defs.join(",\n"));
    lines.push(");".to_string());
    lines.push("-- @deskspawn:end".to_string());

    lines.join("\n") + "\n"
}

/// Generate Rust module with CRUD Tauri commands.
fn generate_rust_module(
    pascal_name: &str,
    snake_name: &str,
    columns: &[TemplateColumn],
) -> String {
    let struct_fields: String = columns
        .iter()
        .map(|col| {
            let rust_type = sql_to_rust_type(&col.sql_type);
            let optional = if col.nullable { "Option<" } else { "" };
            let close = if col.nullable { ">" } else { "" };
            format!("    pub {}: {}{}{},", col.name, optional, rust_type, close)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let select_fields: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
    let insert_cols: Vec<String> = columns
        .iter()
        .filter(|c| !c.primary_key)
        .map(|c| c.name.clone())
        .collect();
    let insert_placeholders: Vec<String> = (0..insert_cols.len())
        .map(|i| format!("${}", i + 1))
        .collect();
    let update_set: Vec<String> = insert_cols
        .iter()
        .map(|c| format!("{} = ${}", c, insert_cols.iter().position(|x| x == c).unwrap() + 1))
        .collect();

    let id_field = columns
        .iter()
        .find(|c| c.primary_key)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "id".to_string());

    let id_rust_type = columns
        .iter()
        .find(|c| c.primary_key)
        .map(|c| sql_to_rust_type(&c.sql_type))
        .unwrap_or("i64");

    format!(
        r#"// @deskspawn:generated table={snake_name}
// Auto-generated CRUD module for {pascal_name}
// Do not edit manually – changes will be overwritten.

use serde::{{Deserialize, Serialize}};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct {pascal_name} {{
{struct_fields}
}}

/// Fetch all {snake_name} records.
#[tauri::command]
pub async fn get_{snake_name}s(pool: tauri::State<'_, SqlitePool>) -> Result<Vec<{pascal_name}>, String> {{
    let rows = sqlx::query_as::<_, {pascal_name}>(
        "SELECT {select_clause} FROM {snake_name}"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| format!("Failed to fetch {snake_name}s: {{}}", e))?;
    Ok(rows)
}}

/// Fetch a single {pascal_name} by its {id_field}.
#[tauri::command]
pub async fn get_{snake_name}_by_id(
    pool: tauri::State<'_, SqlitePool>,
    id: {id_rust_type},
) -> Result<{pascal_name}, String> {{
    let row = sqlx::query_as::<_, {pascal_name}>(
        "SELECT {select_clause} FROM {snake_name} WHERE {id_field} = $1"
    )
    .bind(id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| format!("{pascal_name} not found: {{}}", e))?;
    Ok(row)
}}

/// Create a new {pascal_name} record.
#[tauri::command]
pub async fn create_{snake_name}(
    pool: tauri::State<'_, SqlitePool>,
    data: {pascal_name},
) -> Result<{pascal_name}, String> {{
    let result = sqlx::query(
        "INSERT INTO {snake_name} ({insert_cols}) VALUES ({insert_placeholders})"
    )
    {insert_binds}
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to create {snake_name}: {{}}", e))?;

    let new_id = result.last_insert_rowid();
    get_{snake_name}_by_id(pool, new_id as {id_rust_type}).await
}}

/// Update an existing {pascal_name} record.
#[tauri::command]
pub async fn update_{snake_name}(
    pool: tauri::State<'_, SqlitePool>,
    id: {id_rust_type},
    data: {pascal_name},
) -> Result<{pascal_name}, String> {{
    sqlx::query(
        "UPDATE {snake_name} SET {update_set} WHERE {id_field} = ${update_count}"
    )
    {update_binds}
    .bind(id)
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to update {snake_name}: {{}}", e))?;

    get_{snake_name}_by_id(pool, id).await
}}

/// Delete a {pascal_name} record by its {id_field}.
#[tauri::command]
pub async fn delete_{snake_name}(
    pool: tauri::State<'_, SqlitePool>,
    id: {id_rust_type},
) -> Result<(), String> {{
    sqlx::query("DELETE FROM {snake_name} WHERE {id_field} = $1")
        .bind(id)
        .execute(&*pool)
        .await
        .map_err(|e| format!("Failed to delete {snake_name}: {{}}", e))?;
    Ok(())
}}
// @deskspawn:end
"#,
        snake_name = snake_name,
        pascal_name = pascal_name,
        struct_fields = struct_fields,
        select_clause = select_fields.join(", "),
        id_field = id_field,
        id_rust_type = id_rust_type,
        insert_cols = insert_cols.join(", "),
        insert_placeholders = insert_placeholders.join(", "),
        update_set = update_set.join(", "),
        update_count = update_set.len() + 1,
        insert_binds = generate_bind_statements(columns, false),
        update_binds = generate_bind_statements(columns, true),
    )
}

/// Generate bind statements for sqlx queries.
fn generate_bind_statements(columns: &[TemplateColumn], skip_primary: bool) -> String {
    columns
        .iter()
        .filter(|c| !(skip_primary && c.primary_key))
        .map(|col| {
            if col.nullable {
                format!("    .bind(Option::<{}>::None)", sql_to_rust_type(&col.sql_type))
            } else {
                format!("    .bind(&data.{})", col.name)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Generate React hooks for CRUD operations.
fn generate_ts_hooks(
    pascal_name: &str,
    snake_name: &str,
    columns: &[TemplateColumn],
) -> String {
    let ts_fields: Vec<String> = columns
        .iter()
        .map(|c| {
            let ts_type = sql_to_ts_type(&c.sql_type, c.nullable);
            format!("  {}: {};", c.name, ts_type)
        })
        .collect();

    let ts_interface = format!(
        "export interface {} {{\n{}\n}}",
        pascal_name,
        ts_fields.join("\n"),
    );

    let id_field = columns
        .iter()
        .find(|c| c.primary_key)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "id".to_string());

    format!(
        r#"// @deskspawn:generated table={snake_name}
// Auto-generated React hooks for {pascal_name}
// Do not edit manually – changes will be overwritten.

import {{ invoke }} from "@tauri-apps/api/core";

{ts_interface}

/// Fetch all {snake_name} records.
export async function get{pascal_name}s(): Promise<{pascal_name}[]> {{
  return invoke<{pascal_name}[]>("get_{snake_name}s");
}}

/// Fetch a single {pascal_name} by ID.
export async function get{pascal_name}ById(id: number): Promise<{pascal_name}> {{
  return invoke<{pascal_name}>("get_{snake_name}_by_id", {{ {id_field}: id }});
}}

/// Create a new {pascal_name}.
export async function create{pascal_name}(data: Omit<{pascal_name}, "{id_field}">): Promise<{pascal_name}> {{
  return invoke<{pascal_name}>("create_{snake_name}", {{ data }});
}}

/// Update an existing {pascal_name}.
export async function update{pascal_name}(id: number, data: Partial<{pascal_name}>): Promise<{pascal_name}> {{
  return invoke<{pascal_name}>("update_{snake_name}", {{ id, data }});
}}

/// Delete a {pascal_name} by ID.
export async function delete{pascal_name}(id: number): Promise<void> {{
  return invoke<void>("delete_{snake_name}", {{ {id_field}: id }});
}}
// @deskspawn:end
"#,
        snake_name = snake_name,
        pascal_name = pascal_name,
        ts_interface = ts_interface,
        id_field = id_field,
    )
}

// ── Utility Functions ─────────────────────────────────────────────────────────

fn to_pascal_case(s: &str) -> String {
    s.split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                None => String::new(),
                Some(c) => c.to_uppercase().to_string() + chars.as_str(),
            }
        })
        .collect()
}

fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(c.to_lowercase().next().unwrap());
        } else {
            result.push(c);
        }
    }
    result
}

fn get_timestamp_prefix() -> String {
    chrono::Utc::now().format("%Y%m%d%H%M%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_pascal_case() {
        assert_eq!(to_pascal_case("hello_world"), "HelloWorld");
        assert_eq!(to_pascal_case("user"), "User");
    }

    #[test]
    fn test_to_snake_case() {
        assert_eq!(to_snake_case("HelloWorld"), "hello_world");
        assert_eq!(to_snake_case("User"), "user");
    }

    #[test]
    fn test_sql_to_rust_type() {
        assert_eq!(sql_to_rust_type("integer"), "i64");
        assert_eq!(sql_to_rust_type("text"), "String");
        assert_eq!(sql_to_rust_type("boolean"), "bool");
    }

    #[test]
    fn test_generate_crud_files() {
        let columns = vec![
            TemplateColumn {
                name: "id".to_string(),
                sql_type: "INTEGER".to_string(),
                rust_type: "i64".to_string(),
                ts_type: "number".to_string(),
                nullable: false,
                primary_key: true,
                unique: true,
                default: None,
                references: None,
            },
            TemplateColumn {
                name: "name".to_string(),
                sql_type: "TEXT".to_string(),
                rust_type: "String".to_string(),
                ts_type: "string".to_string(),
                nullable: false,
                primary_key: false,
                unique: false,
                default: None,
                references: None,
            },
        ];

        let files = generate_crud_files("users", &columns).unwrap();
        assert!(files.migration.is_some());
        assert!(files.rust_code.is_some());
        assert!(files.ts_hooks.is_some());

        let migration = files.migration.unwrap();
        assert!(migration.content.contains("CREATE TABLE IF NOT EXISTS users"));
        assert!(migration.content.contains("@deskspawn:generated"));
        assert!(migration.content.contains("@deskspawn:end"));
    }
}
