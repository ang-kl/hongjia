//! D3: pictures. A JPEG, PNG or WebP upload is recognised by its first bytes (not by its name), its
//! size is read from its header, and it is shown in the document viewer as a small generated page
//! with the picture inside it as a `data:` address. The frame's opaque origin could not load a
//! hongjia.org address with the person's session, and the frame policy already allows `data:`
//! images; the page then carries the same helper as an HTML document, so every mark, drawing and
//! signature works on pictures too. The stored file never changes; "org" downloads it byte for byte.

use super::web::escape;

/// The kinds of picture accepted.
pub const TYPES: [&str; 3] = ["jpeg", "png", "webp"];

/// A picture's type and size, read from its first bytes.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Info {
    pub kind: &'static str,
    pub width: u32,
    pub height: u32,
}

impl Info {
    pub fn mime(&self) -> &'static str {
        mime(self.kind)
    }
}

/// The media type for a picture type.
pub fn mime(kind: &str) -> &'static str {
    match kind {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(*b.get(at)?) << 8 | u32::from(*b.get(at + 1)?))
}

fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(*b.get(at)?) | u32::from(*b.get(at + 1)?) << 8)
}

fn le24(b: &[u8], at: usize) -> Option<u32> {
    Some(le16(b, at)? | u32::from(*b.get(at + 2)?) << 16)
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(be16(b, at)? << 16 | be16(b, at + 2)?)
}

/// The type and size of a JPEG, PNG or WebP picture, or None when the bytes are not one of them
/// (or the header is cut short, or the size is zero or above 100000 pixels a side).
pub fn info(bytes: &[u8]) -> Option<Info> {
    let found = if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        // The first chunk is IHDR: width and height as big-endian 32-bit numbers.
        (bytes.get(12..16)? == b"IHDR").then_some(())?;
        Info {
            kind: "png",
            width: be32(bytes, 16)?,
            height: be32(bytes, 20)?,
        }
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        jpeg(bytes)?
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12)? == b"WEBP" {
        webp(bytes)?
    } else {
        return None;
    };
    ((1..=100_000).contains(&found.width) && (1..=100_000).contains(&found.height)).then_some(found)
}

/// A JPEG's size, from its first start-of-frame segment.
fn jpeg(bytes: &[u8]) -> Option<Info> {
    let mut i = 2;
    for _ in 0..10_000 {
        // Each segment starts with 0xFF (any number of fill bytes), then its marker.
        while *bytes.get(i)? != 0xFF {
            i += 1;
        }
        while *bytes.get(i)? == 0xFF {
            i += 1;
        }
        let marker = *bytes.get(i)?;
        i += 1;
        match marker {
            // Markers without a length: restarts, start of image, and TEM.
            0xD0..=0xD8 | 0x01 => continue,
            // End of image or start of scan before any frame: no size.
            0xD9 | 0xDA => return None,
            // Start of frame (baseline, progressive, lossless and so on), not DHT, JPG or DAC.
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) => {
                return Some(Info {
                    kind: "jpeg",
                    height: be16(bytes, i + 3)?,
                    width: be16(bytes, i + 5)?,
                });
            }
            _ => {
                let length = be16(bytes, i)? as usize;
                if length < 2 {
                    return None;
                }
                i += length;
            }
        }
    }
    None
}

/// A WebP's size, from its VP8, VP8L or VP8X chunk.
fn webp(bytes: &[u8]) -> Option<Info> {
    let chunk = bytes.get(12..16)?;
    let (width, height) = match chunk {
        b"VP8 " => {
            // A key frame: start code 9d 01 2a, then 14-bit width and height.
            (bytes.get(23..26)? == [0x9D, 0x01, 0x2A]).then_some(())?;
            (le16(bytes, 26)? & 0x3FFF, le16(bytes, 28)? & 0x3FFF)
        }
        b"VP8L" => {
            (*bytes.get(20)? == 0x2F).then_some(())?;
            let bits = le16(bytes, 21)? | le16(bytes, 23)? << 16;
            ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        }
        b"VP8X" => (le24(bytes, 24)? + 1, le24(bytes, 27)? + 1),
        _ => return None,
    };
    Some(Info {
        kind: "webp",
        width,
        height,
    })
}

/// Standard base64 (RFC 4648), with padding.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = u32::from(chunk[0]) << 16
            | u32::from(*chunk.get(1).unwrap_or(&0)) << 8
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> shift & 0x3F) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The page the viewer's frame shows for a picture: the picture alone, as wide as the frame, its
/// height following its own shape. The title is escaped; the picture is a `data:` address.
pub fn page(title: &str, kind: &str, width: u32, height: u32, bytes: &[u8]) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{title}</title>\n<style>html{{background:#fff}}body{{margin:0}}figure{{margin:0}}img{{display:block;width:100%;height:auto}}</style>\n</head>\n<body>\n<figure><img id=\"picture\" alt=\"{title}\" width=\"{width}\" height=\"{height}\" src=\"data:{mime};base64,{data}\"></figure>\n</body>\n</html>\n",
        title = escape(title),
        mime = mime(kind),
        data = base64(bytes),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG header for a picture of the given size (the rest of the file is not needed to read it).
    pub fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&width.to_be_bytes());
        b.extend_from_slice(&height.to_be_bytes());
        b.extend_from_slice(&[8, 2, 0, 0, 0]);
        b
    }

    #[test]
    fn pictures_are_recognised_by_their_first_bytes() {
        assert_eq!(
            info(&png_header(640, 480)),
            Some(Info {
                kind: "png",
                width: 640,
                height: 480
            })
        );
        // JPEG: SOI, an APP0 segment, then a baseline SOF0 with height 300 and width 400.
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x4A, 0x46, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01,
            0x2C, 0x01, 0x90, 0x03,
        ];
        assert_eq!(
            info(&jpeg),
            Some(Info {
                kind: "jpeg",
                width: 400,
                height: 300
            })
        );
        // A progressive JPEG (SOF2) after a DHT segment, which is not a frame.
        let progressive = [
            0xFF, 0xD8, 0xFF, 0xC4, 0x00, 0x03, 0x00, 0xFF, 0xC2, 0x00, 0x11, 0x08, 0x00, 0x10,
            0x00, 0x20, 0x03,
        ];
        assert_eq!(
            info(&progressive).map(|i| (i.width, i.height)),
            Some((32, 16))
        );
        let mut lossy = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0".to_vec();
        lossy.extend_from_slice(&[0, 0, 0, 0x9D, 0x01, 0x2A, 0x80, 0x02, 0xE0, 0x01]);
        assert_eq!(
            info(&lossy).map(|i| (i.kind, i.width, i.height)),
            Some(("webp", 640, 480))
        );
        let mut lossless = b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2f".to_vec();
        // width 100 (99 in 14 bits), height 50 (49 in the next 14 bits)
        let bits: u32 = 99 | 49 << 14;
        lossless.extend_from_slice(&bits.to_le_bytes());
        assert_eq!(
            info(&lossless).map(|i| (i.width, i.height)),
            Some((100, 50))
        );
        let mut extended = b"RIFF\0\0\0\0WEBPVP8X\0\0\0\0\0\0\0\0".to_vec();
        extended.extend_from_slice(&[0x1F, 0x03, 0x00, 0xDF, 0x01, 0x00]);
        assert_eq!(
            info(&extended).map(|i| (i.width, i.height)),
            Some((800, 480))
        );
    }

    #[test]
    fn other_files_are_not_pictures() {
        assert_eq!(info(b"<!doctype html><p>not a picture</p>"), None);
        assert_eq!(info(b""), None);
        assert_eq!(info(&png_header(640, 480)[..20]), None, "cut short");
        assert_eq!(info(&png_header(0, 480)), None, "no width");
        assert_eq!(info(&png_header(200_000, 10)), None, "too wide");
        assert_eq!(
            info(&[0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02]),
            None,
            "a scan before any frame"
        );
        assert_eq!(info(b"RIFF\0\0\0\0WAVEfmt "), None);
        assert_eq!(info(b"GIF89a\x01\x00\x01\x00"), None, "GIF is not accepted");
    }

    #[test]
    fn base64_matches_the_standard() {
        for (raw, encoded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(raw.as_bytes()), encoded);
        }
        assert_eq!(base64(&[0xFB, 0xFF, 0xBF]), "+/+/");
    }

    #[test]
    fn the_picture_page_escapes_its_title() {
        let html = page("<script>x</script> & \"q\"", "png", 3, 2, &png_header(3, 2));
        assert!(!html.contains("<script>x"));
        assert!(html.contains("<title>&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;</title>"));
        assert!(html.contains(r#"src="data:image/png;base64,iVBORw0KGgo"#));
        assert!(html.contains(r#"width="3" height="2""#));
        assert!(html.contains("<head>"), "the helper goes after <head>");
    }
}
