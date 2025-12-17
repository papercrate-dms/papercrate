use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

/// Build an inline `Content-Disposition` header value for a given filename.
pub fn inline_content_disposition(filename: &str) -> Option<String> {
    if filename.is_empty() {
        return None;
    }

    let sanitized: String = filename
        .chars()
        .map(|ch| match ch {
            '"' | '\\' => '_',
            c if !c.is_ascii() => '_',
            _ => ch,
        })
        .collect();
    let encoded = utf8_percent_encode(filename, NON_ALPHANUMERIC);

    Some(format!(
        "inline; filename=\"{}\"; filename*=UTF-8''{}",
        sanitized, encoded
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn test_inline_content_disposition_header_validity() {
        // Test with a filename containing non-ASCII characters
        let filename = "Täst.pdf";
        let disposition = inline_content_disposition(filename).unwrap();
        println!("Disposition: {}", disposition);
        
        // This should fail if the sanitized part contains non-ASCII characters
        // and we try to create a HeaderValue from it.
        let result = HeaderValue::from_str(&disposition);
        
        if let Ok(val) = result {
             // Check if to_str succeeds (it should now!)
             let to_str_res = val.to_str();
             assert!(to_str_res.is_ok(), "HeaderValue::to_str should succeed for sanitized filename");
             
             let disposition_str = to_str_res.unwrap();
             assert!(disposition_str.contains("filename=\"T_st.pdf\""), "Filename should be sanitized");
             assert!(disposition_str.contains("filename*=UTF-8''T%C3%A4st%2Epdf"), "UTF-8 filename should be preserved");
        } else {
             panic!("HeaderValue rejected the string: {:?}", result.err());
        }
    }
}
