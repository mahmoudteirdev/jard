//! Pro activation that works without a server or internet: the seller signs a small file for one
//! device, and the app checks that signature with a public key built into it. The private key
//! stays with the seller and is never in the app or in this repository.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// What the seller vouches for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct License {
    pub device: String,
    pub key: String,
    pub name: String,
    pub issued: u64,
}

/// The activation file. The license stays a string so the signed bytes are exactly what was signed.
#[derive(Serialize, Deserialize)]
struct LicenseFile {
    license: String,
    signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseError {
    /// Not an activation file at all.
    Unreadable,
    /// Changed after signing, or signed by someone else.
    BadSignature,
    /// Valid, but made for another device.
    OtherDevice,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let s = s.trim();
    if s.len() != N * 2 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// `JARD-DEV-7F2A-91C4-E3B8`, from an ID that identifies this machine. The ID itself isn't revealed.
pub fn device_code(machine_id: &str) -> String {
    let h = blake3::hash(format!("jard-device-v1:{machine_id}").as_bytes()).to_hex();
    let up = h.to_ascii_uppercase();
    format!("JARD-DEV-{}-{}-{}", &up[0..4], &up[4..8], &up[8..12])
}

/// Result of checking a typed key's shape, so the message can say exactly what is missing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KeyCheck {
    Ok { key: String },
    Short { missing: usize },
    Long { extra: usize },
    BadCharacter,
}

/// A key is JARD-XXXX-XXXX-XXXX: 12 letters and digits after the prefix. Case and dashes don't matter.
pub fn check_key(input: &str) -> KeyCheck {
    let up = input.trim().to_ascii_uppercase();
    let body = up.strip_prefix("JARD").unwrap_or(&up);
    let chars: String = body.chars().filter(|c| !matches!(c, '-' | ' ')).collect();
    if !chars.chars().all(|c| c.is_ascii_alphanumeric()) {
        return KeyCheck::BadCharacter;
    }
    match chars.len() {
        12 => KeyCheck::Ok { key: format!("JARD-{}-{}-{}", &chars[0..4], &chars[4..8], &chars[8..12]) },
        n if n < 12 => KeyCheck::Short { missing: 12 - n },
        n => KeyCheck::Long { extra: n - 12 },
    }
}

/// The seller's side: returns the text of an activation file.
pub fn issue(secret: &[u8; 32], license: &License) -> String {
    let body = serde_json::to_string(license).expect("a license always serializes");
    let signature = SigningKey::from_bytes(secret).sign(body.as_bytes());
    let file = LicenseFile { license: body, signature: hex(&signature.to_bytes()) };
    serde_json::to_string_pretty(&file).expect("a license file always serializes")
}

/// The app's side: is this file genuine, and is it for this device?
pub fn verify(public_hex: &str, file_text: &str, device: &str) -> Result<License, LicenseError> {
    let file: LicenseFile = serde_json::from_str(file_text).map_err(|_| LicenseError::Unreadable)?;
    let public = unhex::<32>(public_hex).ok_or(LicenseError::BadSignature)?;
    let key = VerifyingKey::from_bytes(&public).map_err(|_| LicenseError::BadSignature)?;
    let sig = unhex::<64>(&file.signature).ok_or(LicenseError::BadSignature)?;
    key.verify(file.license.as_bytes(), &Signature::from_bytes(&sig)).map_err(|_| LicenseError::BadSignature)?;
    let license: License = serde_json::from_str(&file.license).map_err(|_| LicenseError::Unreadable)?;
    if license.device != device {
        return Err(LicenseError::OtherDevice);
    }
    Ok(license)
}

/// Public key, as hex, for a secret key.
pub fn public_of(secret: &[u8; 32]) -> String {
    hex(SigningKey::from_bytes(secret).verifying_key().as_bytes())
}

pub fn parse_secret(text: &str) -> Option<[u8; 32]> {
    unhex::<32>(text)
}

pub fn secret_to_text(secret: &[u8; 32]) -> String {
    hex(secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: [u8; 32] = [7; 32];

    fn lic(device: &str) -> License {
        License {
            device: device.into(), key: "JARD-AAAA-BBBB-CCCC".into(), name: "محل الاختبار".into(), issued: 100
        }
    }

    #[test]
    fn a_genuine_file_for_this_device_passes() {
        let dev = device_code("machine-a");
        let text = issue(&SECRET, &lic(&dev));
        assert_eq!(verify(&public_of(&SECRET), &text, &dev), Ok(lic(&dev)));
    }

    #[test]
    fn a_file_for_another_device_fails() {
        let text = issue(&SECRET, &lic(&device_code("machine-a")));
        assert_eq!(verify(&public_of(&SECRET), &text, &device_code("machine-b")), Err(LicenseError::OtherDevice));
    }

    #[test]
    fn editing_the_file_breaks_it() {
        let dev = device_code("machine-a");
        let text = issue(&SECRET, &lic(&dev));
        let forged = text.replace("JARD-AAAA", "JARD-ZZZZ");
        assert_ne!(forged, text);
        assert_eq!(verify(&public_of(&SECRET), &forged, &dev), Err(LicenseError::BadSignature));
    }

    #[test]
    fn a_file_signed_with_another_key_fails() {
        let dev = device_code("machine-a");
        let text = issue(&[9; 32], &lic(&dev));
        assert_eq!(verify(&public_of(&SECRET), &text, &dev), Err(LicenseError::BadSignature));
    }

    #[test]
    fn junk_is_unreadable_not_a_crash() {
        for junk in ["", "hello", "{}", r#"{"license":1,"signature":2}"#] {
            assert_eq!(verify(&public_of(&SECRET), junk, "x"), Err(LicenseError::Unreadable), "{junk}");
        }
        let weird = r#"{"license":"x","signature":"zz"}"#;
        assert_eq!(verify(&public_of(&SECRET), weird, "x"), Err(LicenseError::BadSignature));
    }

    #[test]
    fn device_code_is_stable_and_hides_the_id() {
        let a = device_code("secret-machine-guid");
        assert_eq!(a, device_code("secret-machine-guid"));
        assert_ne!(a, device_code("another"));
        assert!(a.starts_with("JARD-DEV-") && a.len() == 23 && !a.contains("secret"), "{a}");
    }

    #[test]
    fn typed_keys_say_what_is_wrong() {
        let ok = KeyCheck::Ok { key: "JARD-AB12-CD34-EF56".into() };
        assert_eq!(check_key("JARD-AB12-CD34-EF56"), ok);
        assert_eq!(check_key(" jard ab12 cd34 ef56 "), ok);
        assert_eq!(check_key("AB12CD34EF56"), ok);
        assert_eq!(check_key("JARD-AB12-CD34"), KeyCheck::Short { missing: 4 });
        assert_eq!(check_key(""), KeyCheck::Short { missing: 12 });
        assert_eq!(check_key("JARD-AB12-CD34-EF56-7"), KeyCheck::Long { extra: 1 });
        assert_eq!(check_key("JARD-AB12-CD34-EF5!"), KeyCheck::BadCharacter);
    }
}
