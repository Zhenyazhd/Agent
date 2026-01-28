use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tracing::info;

/// Tool definition for the agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Result of tool execution
#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub result: String,
    pub success: bool,
}

/// Available tools registry
pub struct ToolRegistry {
    tools: HashMap<String, ToolDefinition>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            tools: HashMap::new(),
        };
        registry.register_default_tools();
        registry
    }

    fn register_default_tools(&mut self) {
        // Calculator tool
        self.register(ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "calculator".to_string(),
                description: "Perform mathematical calculations. Supports basic arithmetic operations.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "Mathematical expression to evaluate, e.g., '2 + 2 * 3'"
                        }
                    },
                    "required": ["expression"]
                }),
            },
        });

        // Current time tool
        self.register(ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "get_current_time".to_string(),
                description: "Get the current date and time.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "timezone": {
                            "type": "string",
                            "description": "Timezone (optional), e.g., 'UTC', 'Europe/Moscow'"
                        }
                    },
                    "required": []
                }),
            },
        });

        // Web search simulation tool
        self.register(ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "web_search".to_string(),
                description: "Search the web for information. Returns search results.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query"
                        }
                    },
                    "required": ["query"]
                }),
            },
        });

        // Memory/notes tool
        self.register(ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "save_note".to_string(),
                description: "Save a note or piece of information for later reference.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Title of the note"
                        },
                        "content": {
                            "type": "string",
                            "description": "Content of the note"
                        }
                    },
                    "required": ["title", "content"]
                }),
            },
        });

        // Code execution tool
        self.register(ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "run_code".to_string(),
                description: "Execute code and return the result. Supports Python-like expressions.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "language": {
                            "type": "string",
                            "description": "Programming language (python, javascript)",
                            "enum": ["python", "javascript"]
                        },
                        "code": {
                            "type": "string",
                            "description": "Code to execute"
                        }
                    },
                    "required": ["language", "code"]
                }),
            },
        });
    }

    pub fn register(&mut self, tool: ToolDefinition) {
        self.tools.insert(tool.function.name.clone(), tool);
    }

    pub fn get_all(&self) -> Vec<ToolDefinition> {
        self.tools.values().cloned().collect()
    }

    pub fn get(&self, name: &str) -> Option<&ToolDefinition> {
        self.tools.get(name)
    }

    /// Execute a tool by name with given arguments
    pub async fn execute(&self, name: &str, arguments: &str) -> ToolResult {
        info!("Executing tool: {} with args: {}", name, arguments);

        let args: Value = serde_json::from_str(arguments).unwrap_or(json!({}));

        let (result, success) = match name {
            "calculator" => self.execute_calculator(&args),
            "get_current_time" => self.execute_get_time(&args),
            "web_search" => self.execute_web_search(&args).await,
            "save_note" => self.execute_save_note(&args),
            "run_code" => self.execute_run_code(&args),
            _ => (format!("Unknown tool: {}", name), false),
        };

        ToolResult {
            tool_call_id: String::new(), // Will be set by caller
            name: name.to_string(),
            result,
            success,
        }
    }

    fn execute_calculator(&self, args: &Value) -> (String, bool) {
        let expression = args.get("expression")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Simple expression evaluator
        match eval_math_expression(expression) {
            Ok(result) => (format!("{}", result), true),
            Err(e) => (format!("Error: {}", e), false),
        }
    }

    fn execute_get_time(&self, args: &Value) -> (String, bool) {
        let _timezone = args.get("timezone")
            .and_then(|v| v.as_str())
            .unwrap_or("UTC");

        let now = chrono::Utc::now();
        (now.format("%Y-%m-%d %H:%M:%S UTC").to_string(), true)
    }

    async fn execute_web_search(&self, args: &Value) -> (String, bool) {
        let query = args.get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Simulated search results (in real app, would call search API)
        let results = format!(
            "Search results for '{}':
1. [Wikipedia] {} - General information and overview
2. [Documentation] Official docs about {}
3. [Tutorial] How to work with {}
(Note: This is a simulated search. Connect a real search API for actual results.)",
            query, query, query, query
        );

        (results, true)
    }

    fn execute_save_note(&self, args: &Value) -> (String, bool) {
        let title = args.get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled");
        let content = args.get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // In real app, would persist to database
        (format!("Note saved: '{}' - {}", title, content), true)
    }

    fn execute_run_code(&self, args: &Value) -> (String, bool) {
        let language = args.get("language")
            .and_then(|v| v.as_str())
            .unwrap_or("python");
        let code = args.get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Simulated code execution (in real app, would use sandboxed interpreter)
        (format!("[{}] Code execution simulated. Code:\n{}\n\n(Note: Connect a real code sandbox for actual execution.)", language, code), true)
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Simple math expression evaluator
fn eval_math_expression(expr: &str) -> Result<f64, String> {
    let expr = expr.replace(" ", "");

    // Very basic evaluator - supports +, -, *, /
    // In production, use a proper expression parser
    let result = simple_eval(&expr)?;
    Ok(result)
}

fn simple_eval(expr: &str) -> Result<f64, String> {
    // Handle parentheses first
    let mut expr = expr.to_string();
    while let Some(start) = expr.rfind('(') {
        if let Some(end) = expr[start..].find(')') {
            let inner = &expr[start + 1..start + end];
            let inner_result = simple_eval(inner)?;
            expr = format!("{}{}{}", &expr[..start], inner_result, &expr[start + end + 1..]);
        } else {
            return Err("Mismatched parentheses".to_string());
        }
    }

    // Addition and subtraction (lowest precedence)
    if let Some(pos) = find_operator(&expr, &['+', '-']) {
        let left = simple_eval(&expr[..pos])?;
        let op = expr.chars().nth(pos).unwrap();
        let right = simple_eval(&expr[pos + 1..])?;
        return Ok(if op == '+' { left + right } else { left - right });
    }

    // Multiplication and division
    if let Some(pos) = find_operator(&expr, &['*', '/']) {
        let left = simple_eval(&expr[..pos])?;
        let op = expr.chars().nth(pos).unwrap();
        let right = simple_eval(&expr[pos + 1..])?;
        return Ok(if op == '*' { left * right } else { left / right });
    }

    // Parse number
    expr.parse::<f64>().map_err(|_| format!("Invalid number: {}", expr))
}

fn find_operator(expr: &str, ops: &[char]) -> Option<usize> {
    let chars: Vec<char> = expr.chars().collect();
    let mut depth = 0;
    for i in (0..chars.len()).rev() {
        let c = chars[i];
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ if depth == 0 && ops.contains(&c) && i > 0 => return Some(i),
            _ => {}
        }
    }
    None
}
