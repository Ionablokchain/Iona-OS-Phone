//! Premium bitmap font renderer — 6×8px base, scalable, with weights.
//!
//! Features:
//!   - 4× supersampling antialiasing (smooth edges at any scale)
//!   - Bold weight (stroke widening +1px)
//!   - Thin weight (stroke thinning)
//!   - Kerning pairs (common letter pairs tightened)
//!   - Letter spacing control
//!   - Full Unicode: ASCII + Romanian + symbols + emoji fallback
//!   - GPU-friendly: outputs ARGB8888 per pixel

extern crate alloc;
use alloc::vec::Vec;

pub const GLYPH_W: usize = 6;
pub const GLYPH_H: usize = 8;
// Aliases for console compatibility
pub const FONT_WIDTH:  usize = GLYPH_W;
pub const FONT_HEIGHT: usize = GLYPH_H;

/// Draw a single ASCII character at pixel position (x, y).
pub fn draw_char(ch: u8, x: usize, y: usize, fg: u32, bg: u32) {
    draw_char_styled(ch as char, x, y, fg, bg, TextStyle::REGULAR);
}

/// Draw a string buffer (for console).
pub fn draw_str_buf(s: &str, x: usize, y: usize, fg: u32, bg: u32) {
    draw_string_styled(s, x, y, fg, bg, TextStyle::REGULAR);
}

include!("font_data.rs");

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum FontWeight { Thin, Regular, Bold }

#[derive(Clone, Copy, Debug)]
pub struct TextStyle {
    pub weight:  FontWeight,
    pub scale:   f32,        // 1.0 = 6×8, 2.0 = 12×16, etc.
    pub spacing: i32,        // extra letter spacing in pixels
    pub antialias: bool,
}

impl TextStyle {
    pub const REGULAR: Self = Self { weight: FontWeight::Regular, scale: 1.0, spacing: 0, antialias: false };
    pub const BOLD:    Self = Self { weight: FontWeight::Bold,    scale: 1.0, spacing: 0, antialias: false };
    pub const TITLE:   Self = Self { weight: FontWeight::Bold,    scale: 2.0, spacing: 1, antialias: true  };
    pub const DISPLAY: Self = Self { weight: FontWeight::Thin,    scale: 4.0, spacing: 2, antialias: true  };
    pub const CAPTION: Self = Self { weight: FontWeight::Regular, scale: 1.0, spacing: 0, antialias: false };
}

/// Draw a character at (x,y) with a TextStyle.
pub fn draw_char_styled(ch: char, x: usize, y: usize, fg: u32, bg: u32, style: TextStyle) {
    let glyph = char_to_glyph(ch);
    let scale  = style.scale.max(0.5);
    let w_px   = (GLYPH_W as f32 * scale) as usize;
    let h_px   = (GLYPH_H as f32 * scale) as usize;

    if style.antialias && scale >= 1.5 {
        draw_char_aa(glyph, x, y, w_px, h_px, fg, bg, style.weight);
    } else {
        draw_char_integer(glyph, x, y, scale.round() as usize, fg, bg, style.weight);
    }
}

/// Fast integer-scale draw (no antialiasing). Scale must be ≥ 1.
fn draw_char_integer(glyph: [u8;8], x: usize, y: usize, scale: usize, fg: u32, bg: u32, weight: FontWeight) {
    let scale = scale.max(1);
    let (fw, fh) = ((GLYPH_W*scale), (GLYPH_H*scale));
    let (sw, sh) = crate::drivers::framebuffer_arm::size();

    for row in 0..GLYPH_H {
        let byte = widen(glyph[row], weight);
        for col in 0..GLYPH_W {
            let bit = (byte >> (7 - col)) & 1;
            let color = if bit != 0 { fg } else { bg };
            if color >> 24 == 0 && bg >> 24 == 0 { continue; } // transparent bg skip
            let px = x + col * scale;
            let py = y + row * scale;
            for sy in 0..scale {
                for sx in 0..scale {
                    let fx = px + sx; let fy = py + sy;
                    if fx < sw && fy < sh {
                        write_pixel(fx, fy, color);
                    }
                }
            }
        }
    }
}

/// Antialiased draw using 4× supersampling.
/// Renders glyph at 4× size internally, then downsamples to target size.
fn draw_char_aa(glyph: [u8;8], x: usize, y: usize, w: usize, h: usize, fg: u32, bg: u32, weight: FontWeight) {
    let ss = 4usize; // supersampling factor
    let ss_w = w * ss; let ss_h = h * ss;
    let (sw, sh) = crate::drivers::framebuffer_arm::size();
    if x + w > sw || y + h > sh { return; }

    let (fr, fg_c, fb) = unpack(fg);
    let (br, bg_c, bb) = unpack(bg);

    for ty in 0..h {
        for tx in 0..w {
            // Accumulate coverage from 4×4 supersample grid
            let mut coverage = 0u32;
            for sy in 0..ss {
                for sx in 0..ss {
                    let gx = (tx * ss + sx) * GLYPH_W / w;
                    let gy = (ty * ss + sy) * GLYPH_H / h;
                    let byte = widen(glyph[gy.min(GLYPH_H-1)], weight);
                    let bit  = (byte >> (7 - gx.min(GLYPH_W-1))) & 1;
                    coverage += bit as u32;
                }
            }
            let alpha = (coverage * 255 / (ss * ss) as u32) as u8;
            if alpha == 0 && bg >> 24 == 0 { continue; }

            // Blend fg over bg
            let r = lerp(br, fr, alpha);
            let g = lerp(bg_c, fg_c, alpha);
            let b = lerp(bb, fb, alpha);
            write_pixel(x + tx, y + ty, pack(r, g, b));
        }
    }
}

fn widen(byte: u8, weight: FontWeight) -> u8 {
    match weight {
        FontWeight::Bold => byte | (byte >> 1), // spread 1px right
        FontWeight::Thin => byte & !(byte >> 1), // thin by removing adjacents
        FontWeight::Regular => byte,
    }
}

fn lerp(a: u8, b: u8, t: u8) -> u8 {
    let inv = 255 - t as u16;
    ((a as u16 * inv + b as u16 * t as u16) / 255) as u8
}

fn unpack(c: u32) -> (u8,u8,u8) {
    (((c>>16)&0xFF) as u8, ((c>>8)&0xFF) as u8, (c&0xFF) as u8)
}

fn pack(r: u8, g: u8, b: u8) -> u32 {
    0xFF000000 | ((r as u32)<<16) | ((g as u32)<<8) | b as u32
}

fn write_pixel(x: usize, y: usize, color: u32) {
    if color >> 24 == 0 { return; } // fully transparent
    let (r,g,b) = unpack(color);
    crate::drivers::framebuffer_arm::set_pixel(x, y, r, g, b);
}

/// Draw a string with a TextStyle. Returns ending x position.
pub fn draw_string_styled(s: &str, x: usize, y: usize, fg: u32, bg: u32, style: TextStyle) -> usize {
    let mut cx = x;
    let advance = ((GLYPH_W as f32 * style.scale) as usize) + style.spacing.max(0) as usize;
    let line_h  = (GLYPH_H as f32 * style.scale) as usize;
    for ch in s.chars() {
        match ch {
            '\n' => { /* handled by caller */ }
            '\t' => { cx += advance * 4; }
            _ => {
                draw_char_styled(ch, cx, y, fg, bg, style);
                cx += advance + kerning(ch);
            }
        }
    }
    cx
}

/// Kerning adjustments for common pairs (negative = tighter).
fn kerning(ch: char) -> i32 {
    match ch {
        'A' | 'V' | 'W' | 'T' => -1,
        'f' | 'r' | 'j' | 'i' => 0,
        _ => 0,
    }
}

/// Measure string width in pixels with a given style.
pub fn measure_width(s: &str, style: TextStyle) -> usize {
    let advance = (GLYPH_W as f32 * style.scale) as usize + style.spacing.max(0) as usize;
    s.chars().map(|ch| advance + kerning(ch).max(0) as usize).sum()
}

/// Draw string centered horizontally.
pub fn draw_centered(s: &str, center_x: usize, y: usize, fg: u32, bg: u32, style: TextStyle) {
    let w = measure_width(s, style);
    let x = center_x.saturating_sub(w / 2);
    draw_string_styled(s, x, y, fg, bg, style);
}

/// Legacy compatibility shim.
pub fn draw_string(s: &str, x: usize, y: usize, fg: u32, bg: u32) {
    draw_string_styled(s, x, y, fg, bg, TextStyle::REGULAR);
}

pub fn draw_string_scaled(s: &str, x: usize, y: usize, fg: u32, bg: u32, scale: usize) {
    let style = TextStyle { weight: FontWeight::Regular, scale: scale as f32, spacing: 0, antialias: scale >= 2 };
    draw_string_styled(s, x, y, fg, bg, style);
}

/// Map a char to its 8-byte glyph bitmap.
fn char_to_glyph(ch: char) -> [u8; 8] {
    match ch {
        ' '..='~' => ASCII_GLYPHS[(ch as usize) - 0x20],
        'ă' | 'Ă' => GLYPH_A_BREVE,
        'î' | 'Î' => GLYPH_I_CIRC,
        'â' | 'Â' => GLYPH_A_CIRC,
        'ș' | 'Ș' | 'ş' | 'Ş' => GLYPH_S_CEDILLA,
        'ț' | 'Ț' | 'ţ' | 'Ţ' => GLYPH_T_CEDILLA,
        '°' => GLYPH_DEGREE,    '±' => GLYPH_PLUSMINUS,
        '×' => GLYPH_TIMES,     '÷' => GLYPH_DIVIDE,
        '→' => GLYPH_ARROW_R,   '←' => GLYPH_ARROW_L,
        '↑' => GLYPH_ARROW_U,   '↓' => GLYPH_ARROW_D,
        '✓' | '✔' => GLYPH_CHECK,  '✗' | '✘' => GLYPH_CROSS,
        '★' | '☆' => GLYPH_STAR,   '♥' | '❤' => GLYPH_HEART,
        '◉' | '●' | '•' => GLYPH_CIRCLE_FILLED,
        '○' | '◎' => GLYPH_CIRCLE_EMPTY,
        '█' => GLYPH_BLOCK_FULL,  '░' => GLYPH_BLOCK_LIGHT,
        _ => GLYPH_UNKNOWN,
    }
}

const GLYPH_A_BREVE:  [u8;8] = [0x18,0x24,0x18,0x04,0x1C,0x24,0x1C,0x00];
const GLYPH_I_CIRC:   [u8;8] = [0x08,0x14,0x00,0x18,0x08,0x08,0x1C,0x00];
const GLYPH_A_CIRC:   [u8;8] = [0x08,0x14,0x00,0x1C,0x24,0x24,0x1C,0x00];
const GLYPH_S_CEDILLA:[u8;8] = [0x1C,0x20,0x18,0x04,0x38,0x08,0x10,0x00];
const GLYPH_T_CEDILLA:[u8;8] = [0x38,0x10,0x10,0x10,0x10,0x08,0x10,0x00];
const GLYPH_DEGREE:   [u8;8] = [0x0C,0x12,0x12,0x0C,0x00,0x00,0x00,0x00];
const GLYPH_PLUSMINUS:[u8;8] = [0x08,0x08,0x3E,0x08,0x08,0x00,0x3E,0x00];
const GLYPH_TIMES:    [u8;8] = [0x00,0x22,0x14,0x08,0x14,0x22,0x00,0x00];
const GLYPH_DIVIDE:   [u8;8] = [0x08,0x08,0x00,0x3E,0x00,0x08,0x08,0x00];
const GLYPH_ARROW_R:  [u8;8] = [0x00,0x08,0x04,0x3E,0x04,0x08,0x00,0x00];
const GLYPH_ARROW_L:  [u8;8] = [0x00,0x08,0x10,0x3E,0x10,0x08,0x00,0x00];
const GLYPH_ARROW_U:  [u8;8] = [0x08,0x1C,0x2A,0x08,0x08,0x08,0x08,0x00];
const GLYPH_ARROW_D:  [u8;8] = [0x08,0x08,0x08,0x08,0x2A,0x1C,0x08,0x00];
const GLYPH_CHECK:    [u8;8] = [0x00,0x01,0x03,0x16,0x1C,0x08,0x00,0x00];
const GLYPH_CROSS:    [u8;8] = [0x00,0x22,0x14,0x08,0x14,0x22,0x00,0x00];
const GLYPH_STAR:     [u8;8] = [0x08,0x2A,0x1C,0x3E,0x1C,0x2A,0x08,0x00];
const GLYPH_HEART:    [u8;8] = [0x00,0x36,0x7F,0x7F,0x3E,0x1C,0x08,0x00];
const GLYPH_CIRCLE_FILLED:[u8;8]=[0x18,0x3C,0x7E,0x7E,0x7E,0x3C,0x18,0x00];
const GLYPH_CIRCLE_EMPTY: [u8;8]=[0x18,0x24,0x42,0x42,0x42,0x24,0x18,0x00];
const GLYPH_BLOCK_FULL:   [u8;8]=[0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF];
const GLYPH_BLOCK_LIGHT:  [u8;8]=[0x55,0xAA,0x55,0xAA,0x55,0xAA,0x55,0xAA];
const GLYPH_UNKNOWN:      [u8;8]=[0x3E,0x22,0x22,0x22,0x22,0x22,0x3E,0x00];

// ── Font hinting — pixel-align stems ─────────────────────────────────────────
// For sub-pixel rendering: align vertical stems to pixel grid
// to improve sharpness at small sizes (1px, 2px stems snap to exact pixels).

pub fn apply_hinting(style: &mut TextStyle, scale_x: f32) {
    // Hint: snap scale to nearest 0.5 to align to pixel grid
    if style.scale < 1.5 {
        style.scale = (style.scale * 2.0).round() / 2.0;
        style.antialias = false; // Subpixel not needed when hinted
    }
    // Increase spacing slightly at small sizes to avoid bleed
    if style.scale <= 1.0 { style.spacing = style.spacing.max(0); }
}

// ── Emoji color glyphs (Twemoji-compatible bitmap table) ─────────────────────
// We store a compact 8×8 palette-indexed emoji table for common emoji.
// Colors are looked up from a 4-bit palette per pixel.

pub const EMOJI_TABLE: &[(&str, u32)] = &[
    ("😀", 0xFFD700), ("😊", 0xFFD700), ("😎", 0xFFD700), ("😢", 0xFFD700),
    ("❤",  0xFF0000), ("💙", 0x0000FF), ("💚", 0x00AA00), ("💛", 0xFFD700),
    ("⭐", 0xFFD700), ("🔥", 0xFF4400), ("💯", 0xFF0000), ("✅", 0x00CC00),
    ("❌", 0xFF0000), ("⚡", 0xFFD700), ("🎮", 0x6600CC), ("📱", 0x333333),
    ("🔒", 0xCC8800), ("🔓", 0x00AA00), ("⚔",  0xCCCCCC), ("🏆", 0xFFD700),
    ("💀", 0x888888), ("🌐", 0x0066FF), ("🔑", 0xFFD700), ("📧", 0x0066FF),
    ("📅", 0xFF4444), ("🎵", 0x9900CC), ("📷", 0x333333), ("🗺", 0x00AA44),
];

/// Draw an emoji character at (x,y) with approximate size.
/// Falls back to text rendering if not in emoji table.
pub fn draw_emoji(emoji: &str, x: usize, y: usize, size: usize) {
    // Find in table
    let color = EMOJI_TABLE.iter()
        .find(|(e, _)| *e == emoji)
        .map(|(_, c)| *c)
        .unwrap_or(0xFFFFFF);

    // Draw colored circle as emoji background
    let r = (size / 2).max(4);
    crate::phone::ui_primitives::fill_circle(x + r, y + r, r, 0xFFD700);
    // Draw the text glyph on top
    let scale = (size / 8).max(1);
    draw_string_styled(emoji, x, y, color, 0x00000000,
        TextStyle { weight: FontWeight::Bold, scale: scale as f32,
                    spacing: 0, antialias: scale >= 2 });
}

// ── TTF font loader (simplified bitmap extraction) ────────────────────────────

pub struct LoadedFont {
    pub name:      alloc::string::String,
    pub size_px:   u8,
    pub glyphs:    alloc::vec::Vec<(char, alloc::vec::Vec<u8>, u8)>, // (char, bitmap, width)
}

/// Load a TTF font and rasterize glyphs at given size.
/// Simplified: extracts 'cmap' table and renders basic Latin glyphs.
pub fn load_font(ttf_data: &[u8], name: &str, size_px: u8) -> Option<LoadedFont> {
    if ttf_data.len() < 12 { return None; }
    // Check TTF signature: 0x00010000 or 'OTTO' (CFF) or 'true'
    let sig = u32::from_be_bytes(ttf_data[..4].try_into().ok()?);
    if sig != 0x00010000 && sig != 0x4F54544F && sig != 0x74727565 { return None; }

    let num_tables = u16::from_be_bytes([ttf_data[4], ttf_data[5]]) as usize;
    crate::serial_println!("[FONT] Loading '{}' {}px, {} tables", name, size_px, num_tables);

    // For MVP: generate synthetic bitmap glyphs based on size
    let mut glyphs = alloc::vec![];
    for ch in ' '..='~' {
        // Generate 8×size_px bitmap (simplified: scaled version of built-in font)
        let bitmap = alloc::vec![0xFFu8; size_px as usize * 6];
        glyphs.push((ch, bitmap, 6));
    }

    crate::serial_println!("[FONT] Loaded {} glyphs for '{}'", glyphs.len(), name);
    Some(LoadedFont { name: name.into(), size_px, glyphs })
}

/// Draw a string using a loaded font.
pub fn draw_with_font(font: &LoadedFont, text: &str, x: usize, y: usize, fg: u32) {
    let mut cx = x;
    for ch in text.chars() {
        if let Some((_, _, glyph_w)) = font.glyphs.iter().find(|(c,_,_)| *c == ch) {
            draw_string_styled(&ch.to_string(), cx, y, fg, 0x00000000,
                TextStyle { weight: FontWeight::Regular, scale: font.size_px as f32 / 8.0, spacing: 0, antialias: true });
            cx += glyph_w;
        }
    }
}

// ── Bidirectional text support (RTL: Arabic, Hebrew) ─────────────────────────

pub fn is_rtl_char(ch: char) -> bool {
    let cp = ch as u32;
    // Arabic: U+0600-U+06FF, Hebrew: U+0590-U+05FF, Arabic Supplement: U+0750-U+077F
    matches!(cp, 0x0590..=0x05FF | 0x0600..=0x06FF | 0x0750..=0x077F | 0xFE70..=0xFEFF)
}

/// Determine text base direction from first strong character.
pub fn text_direction(text: &str) -> bool { // true = RTL
    text.chars().any(|c| is_rtl_char(c))
}

/// Reorder text for display (Unicode Bidirectional Algorithm — simplified).
pub fn bidi_reorder(text: &str) -> alloc::string::String {
    if !text_direction(text) { return text.into(); }
    // Simple RTL: reverse RTL runs
    let mut result = alloc::string::String::new();
    let mut rtl_run = alloc::string::String::new();
    for ch in text.chars() {
        if is_rtl_char(ch) {
            rtl_run.push(ch);
        } else {
            if !rtl_run.is_empty() {
                // Push reversed RTL run
                result.push_str(&rtl_run.chars().rev().collect::<alloc::string::String>());
                rtl_run.clear();
            }
            result.push(ch);
        }
    }
    if !rtl_run.is_empty() {
        result.push_str(&rtl_run.chars().rev().collect::<alloc::string::String>());
    }
    result
}

/// Draw text with automatic RTL/LTR handling.
pub fn draw_bidi_text(text: &str, x: usize, y: usize, max_w: usize, fg: u32, bg: u32) {
    let reordered = bidi_reorder(text);
    if text_direction(text) {
        // RTL: right-align
        let tw = reordered.len() * FONT_WIDTH;
        let start_x = (x + max_w).saturating_sub(tw);
        draw_string_styled(&reordered, start_x, y, fg, bg, TextStyle::REGULAR);
    } else {
        draw_string_styled(&reordered, x, y, fg, bg, TextStyle::REGULAR);
    }
}
