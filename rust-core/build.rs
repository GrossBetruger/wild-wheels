use std::{
    collections::{BTreeMap, HashSet},
    env, fs,
    path::PathBuf,
};

fn quoted_at(s: &str, start: usize) -> Option<(String, usize)> {
    let bytes = s.as_bytes();
    let mut i = start;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    let quote = *bytes.get(i)?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    i += 1;
    let mut out = String::new();
    let mut chars = s[i..].char_indices();
    while let Some((offset, ch)) = chars.next() {
        if ch == '\\' {
            if let Some((_, escaped)) = chars.next() {
                out.push(escaped);
            }
            continue;
        }
        if ch as u32 == u32::from(quote) {
            return Some((out, i + offset + 1));
        }
        out.push(ch);
    }
    None
}

fn balanced_block(s: &str, open_at: usize, open: u8, close: u8) -> Option<&str> {
    let bytes = s.as_bytes();
    if *bytes.get(open_at)? != open {
        return None;
    }
    let mut depth = 0usize;
    let mut in_quote: Option<u8> = None;
    let mut i = open_at;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                in_quote = None;
            }
        } else if b == b'\'' || b == b'"' {
            in_quote = Some(b);
        } else if b == open {
            depth += 1;
        } else if b == close {
            depth -= 1;
            if depth == 0 {
                return Some(&s[open_at + 1..i]);
            }
        }
        i += 1;
    }
    None
}

fn format_ability_title(raw: &str) -> String {
    let normalized = raw.replace(['’', '‘'], "'");
    let mut out = String::with_capacity(normalized.len());
    let mut new_word = true;
    for ch in normalized.chars() {
        if ch == ' ' || ch == '-' {
            out.push(ch);
            new_word = true;
        } else if new_word {
            out.extend(ch.to_uppercase());
            new_word = false;
        } else {
            out.extend(ch.to_lowercase());
        }
    }
    out
}

fn parse_special_abilities(source: &str) -> BTreeMap<usize, Vec<String>> {
    let mut table: BTreeMap<usize, Vec<String>> = BTreeMap::new();

    // 1. Primary ability names from `export const abilityNames = { ... }`
    let names_anchor = source
        .find("abilityNames")
        .expect("special-abilities.js must define abilityNames");
    let names_open = names_anchor
        + source[names_anchor..]
            .find('{')
            .expect("abilityNames object missing '{'");
    let names_body = balanced_block(source, names_open, b'{', b'}')
        .expect("abilityNames object missing '}'");
    let bytes = names_body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && !bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let num_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        let driver: usize = names_body[num_start..i].parse().unwrap();
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b':') {
            i += 1;
        }
        let (title, next) = quoted_at(names_body, i).expect("abilityNames entry must be quoted");
        table.entry(driver).or_default().push(format_ability_title(&title));
        i = next;
    }

    // 2. Additional abilities from `export const abilityDetails = { ... }`
    let details_anchor = source
        .find("abilityDetails")
        .expect("special-abilities.js must define abilityDetails");
    let details_open = details_anchor
        + source[details_anchor..]
            .find('{')
            .expect("abilityDetails object missing '{'");
    let details_body = balanced_block(source, details_open, b'{', b'}')
        .expect("abilityDetails object missing '}'");
    let dbytes = details_body.as_bytes();
    let mut j = 0;
    while j < dbytes.len() {
        while j < dbytes.len() && !dbytes[j].is_ascii_digit() {
            j += 1;
        }
        if j >= dbytes.len() {
            break;
        }
        let num_start = j;
        while j < dbytes.len() && dbytes[j].is_ascii_digit() {
            j += 1;
        }
        let driver: usize = details_body[num_start..j].parse().unwrap();
        let entry_open = j
            + details_body[j..]
                .find('{')
                .expect("abilityDetails entry missing '{'");
        let entry_body = balanced_block(details_body, entry_open, b'{', b'}')
            .expect("abilityDetails entry missing '}'");
        if let Some(add_at) = entry_body.find("additional") {
            if let Some(arr_rel) = entry_body[add_at..].find('[') {
                let arr_open = add_at + arr_rel;
                if let Some(arr_body) = balanced_block(entry_body, arr_open, b'[', b']') {
                    let mut search = 0;
                    while let Some(rel) = arr_body[search..].find("title") {
                        let key_end = search + rel + "title".len();
                        let after_colon = arr_body[key_end..]
                            .find(':')
                            .map(|c| key_end + c + 1)
                            .unwrap_or(arr_body.len());
                        if let Some((extra, next)) = quoted_at(arr_body, after_colon) {
                            table
                                .entry(driver)
                                .or_default()
                                .push(format_ability_title(&extra));
                            search = next;
                        } else {
                            break;
                        }
                    }
                }
            }
        }
        j = entry_open + entry_body.len() + 2;
    }

    assert!(
        !table.is_empty(),
        "special-abilities.js must list at least one specialist"
    );
    table
}

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    // Read the literal hex swatches without evaluating JavaScript. This keeps
    // native Rust and Wasm on the same palette as the browser and Node server.
    let palette = manifest_dir.join("../gameplay/player-colors.js");
    println!("cargo:rerun-if-changed={}", palette.display());
    let source = fs::read_to_string(palette).expect("Unable to read player palette");
    let colors: Vec<_> = source
        .split(['\'', '"'])
        .filter(|value| {
            value.len() == 7
                && value.starts_with('#')
                && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        })
        .collect();
    assert!(colors.len() >= 8, "The palette needs at least eight player colors");
    let distinct: HashSet<_> = colors.iter().map(|value| value.to_ascii_lowercase()).collect();
    assert_eq!(distinct.len(), colors.len(), "Player palette colors must be unique");
    fs::write(
        out_dir.join("player_colors.rs"),
        format!("pub const PLAYER_COLORS: &[&str] = &{colors:?};\n"),
    )
    .expect("Unable to generate native player palette");

    // Auto-discover every character's special abilities from gameplay/special-abilities.js
    // so new characters and abilities are included in simulations out of the box.
    let specials_path = manifest_dir.join("../gameplay/special-abilities.js");
    println!("cargo:rerun-if-changed={}", specials_path.display());
    let specials_source =
        fs::read_to_string(specials_path).expect("Unable to read special-abilities.js");
    let specials = parse_special_abilities(&specials_source);
    let mut generated = String::from("pub const SPECIAL_ABILITY_RACERS: &[(usize, &[&str])] = &[\n");
    for (driver, list) in &specials {
        generated.push_str(&format!("    ({driver}, &{list:?}),\n"));
    }
    generated.push_str("];\n");
    fs::write(out_dir.join("special_abilities.rs"), generated)
        .expect("Unable to generate special ability roster");
}
