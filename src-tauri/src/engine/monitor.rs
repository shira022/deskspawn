use crate::models::config::ErrorInfo;
use std::sync::Mutex;

/// Thread-safe error collector for monitoring compilation and build errors.
pub struct ErrorMonitor {
    errors: Mutex<Vec<ErrorInfo>>,
}

impl ErrorMonitor {
    pub fn new() -> Self {
        Self {
            errors: Mutex::new(Vec::new()),
        }
    }

    pub fn add_error(&self, error: ErrorInfo) {
        if let Ok(mut errors) = self.errors.lock() {
            errors.push(error);
        }
    }

    pub fn get_all_errors(&self) -> Vec<ErrorInfo> {
        self.errors.lock().map(|e| e.clone()).unwrap_or_default()
    }

    pub fn clear_errors(&self) {
        if let Ok(mut errors) = self.errors.lock() {
            errors.clear();
        }
    }
}

impl Default for ErrorMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse Vite TypeScript error output for structured error collection.
pub fn parse_vite_errors(output: &str, monitor: &ErrorMonitor) {
    // Vite/TypeScript errors typically follow the format:
    // src/file.ts:line:col - error TS2345: message
    for line in output.lines() {
        if line.contains("error TS") || line.contains("ERROR") {
            let parts: Vec<&str> = line.splitn(3, ':').collect();
            let file_path = parts.first().map(|s| s.trim().to_string());
            let line_num = parts.get(1).and_then(|s| s.trim().parse::<u32>().ok());
            let message = parts.get(2).unwrap_or(&"").trim().to_string();

            if !message.is_empty() {
                monitor.add_error(ErrorInfo {
                    error_type: "typescript".to_string(),
                    message,
                    file_path,
                    line: line_num,
                });
            }
        }
    }
}

/// Parse cargo check output for structured error collection.
pub fn parse_cargo_errors(output: &str, monitor: &ErrorMonitor) {
    // Cargo errors follow the format:
    // error[E0425]: cannot find value `foo` in this scope
    //   --> src/main.rs:10:5
    let mut current_message = String::new();
    let mut current_file: Option<String> = None;
    let mut current_line: Option<u32> = None;

    for line in output.lines() {
        if line.starts_with("error[E") {
            // Extract the message from the error line
            if let Some(msg_start) = line.find(": ") {
                current_message = line[msg_start + 2..].to_string();
            } else {
                current_message = line.to_string();
            }
        } else if line.trim().starts_with("--> ") {
            // Extract file and line from location marker
            let loc = line.trim().trim_start_matches("--> ").trim();
            let parts: Vec<&str> = loc.splitn(2, ':').collect();
            if parts.len() >= 2 {
                current_file = Some(parts[0].trim().to_string());
                current_line = parts[1].trim().split(':').next().and_then(|s| s.parse::<u32>().ok());
            }
        } else if line.starts_with("   = ") {
            // Help/note lines - append to message
            if !current_message.is_empty() {
                current_message.push_str("; ");
                current_message.push_str(line.trim_start_matches("   = "));
            }
        } else if line.starts_with("error:") && !line.starts_with("error[E") {
            // Generic error line
            current_message = line.trim_start_matches("error:").trim().to_string();
        }

        // When we have both message and file, record and reset
        if !current_message.is_empty() && current_file.is_some() {
            monitor.add_error(ErrorInfo {
                error_type: "rust".to_string(),
                message: current_message.clone(),
                file_path: current_file.clone(),
                line: current_line,
            });
            current_message.clear();
            current_file = None;
            current_line = None;
        }
    }

    // Catch any remaining message
    if !current_message.is_empty() {
        monitor.add_error(ErrorInfo {
            error_type: "rust".to_string(),
            message: current_message,
            file_path: current_file,
            line: current_line,
        });
    }
}

/// Parse sqlx migrate output for errors.
pub fn parse_sqlx_errors(output: &str, monitor: &ErrorMonitor) {
    for line in output.lines() {
        if line.contains("error") || line.contains("ERROR") || line.contains("failed") {
            monitor.add_error(ErrorInfo {
                error_type: "sqlx".to_string(),
                message: line.to_string(),
                file_path: None,
                line: None,
            });
        }
    }
}
