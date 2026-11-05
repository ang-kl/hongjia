//! A small JSON writer for the two read-only endpoints (search and the library). Values are only
//! strings and lists of strings, so a full JSON library is not needed.

/// A JSON string literal, quoted. Control characters, quotes and backslashes are escaped, and so
/// are `<`, `>`, `&` and the two Unicode line separators, so the output is safe even if a browser
/// were ever to treat it as HTML or script.
pub fn string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '<' | '>' | '&' | '\u{2028}' | '\u{2029}' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A JSON list of strings.
pub fn strings(values: &[String]) -> String {
    let items: Vec<String> = values.iter().map(|v| string(v)).collect();
    format!("[{}]", items.join(","))
}

/// A JSON object from (name, already-encoded value) pairs.
pub fn object(fields: &[(&str, String)]) -> String {
    let items: Vec<String> = fields
        .iter()
        .map(|(name, value)| format!("{}:{value}", string(name)))
        .collect();
    format!("{{{}}}", items.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_are_escaped() {
        assert_eq!(string("plain"), r#""plain""#);
        assert_eq!(string("a\"b\\c"), r#""a\"b\\c""#);
        assert_eq!(string("x\ny\u{1}"), r#""x\ny\u0001""#);
        assert_eq!(
            string("</script><b>&"),
            r#""\u003c/script\u003e\u003cb\u003e\u0026""#
        );
        assert_eq!(string("灯笼 \u{2028}"), "\"灯笼 \\u2028\"");
    }

    #[test]
    fn lists_and_objects() {
        assert_eq!(strings(&[]), "[]");
        assert_eq!(strings(&["a".into(), "b\"".into()]), r#"["a","b\""]"#);
        assert_eq!(
            object(&[("k", string("v")), ("n", strings(&["x".into()]))]),
            r#"{"k":"v","n":["x"]}"#
        );
    }
}
