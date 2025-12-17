use std::env;
use std::fs;
use std::path::PathBuf;

use regex::escape;
use serde::Deserialize;

#[derive(Deserialize)]
struct CaseSuite {
    cases: Vec<CaseName>,
}

#[derive(Deserialize)]
struct CaseName {
    name: String,
}

#[derive(Deserialize)]
struct MonthSuite {
    months: Vec<MonthDefinition>,
}

#[derive(Deserialize)]
struct MonthDefinition {
    name: String,
    month: u32,
    #[serde(default)]
    locales: Vec<String>,
}

fn sanitize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "case".to_string()
    } else if out.chars().next().unwrap().is_ascii_digit() {
        format!("_{}", out)
    } else {
        out
    }
}

fn quote(value: &str) -> String {
    serde_json::to_string(value).expect("string literal")
}

fn generate_tests() -> Result<String, Box<dyn std::error::Error>> {
    let yaml_path = PathBuf::from("tests/data/issued_at_cases.yaml");
    let contents = fs::read_to_string(&yaml_path)?;
    let suite: CaseSuite = serde_yaml::from_str(&contents)?;

    let mut output =
        String::from("#[cfg(test)]\npub mod issued_at_generated_tests {\n    use super::*;\n");

    for case in suite.cases {
        let ident = sanitize(&case.name);
        output.push_str(&format!(
            "    #[test]\n    fn {}() {{\n        run_named_case(\"{}\");\n    }}\n",
            ident, case.name
        ));
    }

    output.push_str("}\n");
    Ok(output)
}

fn generate_months() -> Result<String, Box<dyn std::error::Error>> {
    let yaml_path = PathBuf::from("resources/issued_at_months.yaml");
    let contents = fs::read_to_string(&yaml_path)?;
    let suite: MonthSuite = serde_yaml::from_str(&contents)?;

    let mut pattern_parts = Vec::with_capacity(suite.months.len());
    let mut entries = String::new();
    for entry in &suite.months {
        pattern_parts.push(escape(&entry.name));
        let locales_literal = if entry.locales.is_empty() {
            "&[]".to_string()
        } else {
            let joined = entry
                .locales
                .iter()
                .map(|loc| quote(loc))
                .collect::<Vec<_>>()
                .join(", ");
            format!("&[{}]", joined)
        };
        entries.push_str(&format!(
            "    MonthVariant {{ name: {}, month: {}, locales: {} }},\n",
            quote(&entry.name),
            entry.month,
            locales_literal
        ));
    }

    let pattern_literal = quote(&pattern_parts.join("|"));
    let output = format!(
        "pub(super) static MONTH_VARIANTS: &[MonthVariant] = &[\n{entries}];\n\n",
        entries = entries
    ) + &format!(
        "pub(super) const MONTH_PATTERN: &str = {};\n",
        pattern_literal
    );
    Ok(output)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=tests/data/issued_at_cases.yaml");
    println!("cargo:rerun-if-changed=resources/issued_at_months.yaml");

    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    fs::write(
        out_dir.join("issued_at_generated_tests.rs"),
        generate_tests()?,
    )?;
    fs::write(out_dir.join("issued_at_months.rs"), generate_months()?)?;
    Ok(())
}
