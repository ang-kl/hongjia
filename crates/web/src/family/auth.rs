//! Secrets: random tokens, hashing, passphrases (Argon2id) and one-time enrolment codes.
//! Nothing here logs or returns a secret except to the person it belongs to.

use argon2::{Algorithm, Argon2, Params, Version};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::OnceLock;
use subtle::ConstantTimeEq;

/// Bytes from the operating system's random source.
pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("operating system random source");
    bytes
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

pub fn sha256(data: &[u8]) -> Vec<u8> {
    Sha256::digest(data).to_vec()
}

pub fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("HMAC takes any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Constant-time comparison (length is not secret here).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && bool::from(a.ct_eq(b))
}

/// A new 256-bit token as 64 hexadecimal characters.
pub fn new_token() -> String {
    hex(&random_bytes::<32>())
}

/// A token from a cookie: exactly 64 hexadecimal characters.
pub fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

// Argon2id with OWASP's recommended minimum: 19 MiB memory, 2 passes, 1 lane.
const M_COST: u32 = 19_456;
const T_COST: u32 = 2;
const P_COST: u32 = 1;

fn argon2(m: u32, t: u32, p: u32, len: usize) -> Option<Argon2<'static>> {
    Params::new(m, t, p, Some(len))
        .ok()
        .map(|params| Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

/// Stored form: `argon2id$v=19$m=19456,t=2,p=1$<salt hex>$<hash hex>`.
pub fn hash_passphrase(passphrase: &str) -> String {
    let salt = random_bytes::<16>();
    let mut out = [0u8; 32];
    argon2(M_COST, T_COST, P_COST, 32)
        .expect("valid Argon2 parameters")
        .hash_password_into(passphrase.as_bytes(), &salt, &mut out)
        .expect("Argon2 hashing");
    format!(
        "argon2id$v=19$m={M_COST},t={T_COST},p={P_COST}${}${}",
        hex(&salt),
        hex(&out)
    )
}

pub fn verify_passphrase(passphrase: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 5 || parts[0] != "argon2id" || parts[1] != "v=19" {
        return false;
    }
    let mut cost = (0u32, 0u32, 0u32);
    for item in parts[2].split(',') {
        match item.split_once('=') {
            Some(("m", v)) => cost.0 = v.parse().unwrap_or(0),
            Some(("t", v)) => cost.1 = v.parse().unwrap_or(0),
            Some(("p", v)) => cost.2 = v.parse().unwrap_or(0),
            _ => return false,
        }
    }
    let (Some(salt), Some(expected)) = (unhex(parts[3]), unhex(parts[4])) else {
        return false;
    };
    let Some(hasher) = argon2(cost.0, cost.1, cost.2, expected.len()) else {
        return false;
    };
    let mut out = vec![0u8; expected.len()];
    hasher
        .hash_password_into(passphrase.as_bytes(), &salt, &mut out)
        .is_ok()
        && ct_eq(&out, &expected)
}

/// A real hash of a throwaway value, checked when a profile has no credential so that the time
/// taken does not reveal which profiles are enrolled.
pub fn dummy_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| hash_passphrase("timing equaliser, never a real passphrase"))
}

/// Why a new passphrase is not acceptable, or None if it is.
pub fn passphrase_problem(passphrase: &str, confirm: &str, handle: &str) -> Option<&'static str> {
    let length = passphrase.chars().count();
    if length < 16 {
        return Some("Use at least 16 characters. Four unrelated words work well.");
    }
    if length > 256 {
        return Some("Use at most 256 characters.");
    }
    if passphrase != confirm {
        return Some("The two passphrases do not match.");
    }
    if passphrase.to_lowercase().contains(handle) {
        return Some("Leave your profile name out of the passphrase.");
    }
    if passphrase.chars().collect::<HashSet<_>>().len() < 6 {
        return Some("Use a more varied passphrase.");
    }
    None
}

// Crockford-style alphabet without I, L, O and U, so codes are easy to read aloud.
const CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKMNPQRSTVWXYZ0123456789";

/// A one-time enrolment code: 20 characters (100 bits) in groups of four.
pub fn new_enrolment_code() -> String {
    let bytes = random_bytes::<20>();
    let chars: Vec<char> = bytes
        .iter()
        .map(|b| CODE_ALPHABET[(*b % 32) as usize] as char)
        .collect();
    chars
        .chunks(4)
        .map(|c| c.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// Uppercase letters and digits only, so spacing, hyphens and case do not matter.
pub fn normalise_code(input: &str) -> String {
    input
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passphrase_hash_round_trip_and_format() {
        let stored = hash_passphrase("correct horse battery staple");
        assert!(stored.starts_with("argon2id$v=19$m=19456,t=2,p=1$"));
        assert!(!stored.contains("correct horse"));
        assert!(verify_passphrase("correct horse battery staple", &stored));
        assert!(!verify_passphrase("correct horse battery stapler", &stored));
        assert!(!verify_passphrase("anything", "not a hash"));
        assert_ne!(
            stored,
            hash_passphrase("correct horse battery staple"),
            "salts must differ"
        );
    }

    #[test]
    fn passphrase_rules() {
        assert!(passphrase_problem("short", "short", "beta").is_some());
        assert!(passphrase_problem("sixteen chars ok!", "different value!", "beta").is_some());
        assert!(
            passphrase_problem("beta likes long walks", "beta likes long walks", "beta").is_some()
        );
        assert!(
            passphrase_problem("aaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaa", "beta").is_some()
        );
        assert_eq!(
            passphrase_problem("river lantern cobalt", "river lantern cobalt", "beta"),
            None
        );
    }

    #[test]
    fn enrolment_codes() {
        let code = new_enrolment_code();
        assert_eq!(code.len(), 24);
        assert_eq!(code.matches('-').count(), 4);
        assert_eq!(
            normalise_code(&code.to_lowercase().replace('-', " ")),
            code.replace('-', "")
        );
        assert_ne!(new_enrolment_code(), code);
    }

    #[test]
    fn tokens_hex_and_comparison() {
        let token = new_token();
        assert!(valid_token(&token));
        assert!(!valid_token("abc"));
        assert_eq!(unhex(&hex(&[0, 15, 255])), Some(vec![0, 15, 255]));
        assert!(ct_eq(b"same", b"same"));
        assert!(!ct_eq(b"same", b"diff"));
        assert_eq!(hmac_sha256(b"k", b"x").len(), 32);
    }
}
