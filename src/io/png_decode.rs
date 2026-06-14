//! Minimal PNG decoder for no_std — handles RGB/RGBA 8-bit only.
//! Supports: IHDR, IDAT (deflate), IEND chunks.
//! Decompression: custom zlib inflate (LZ77 + Huffman).

extern crate alloc;
use alloc::vec::Vec;

#[derive(Debug)]
pub struct Bitmap {
    pub width:  usize,
    pub height: usize,
    pub pixels: Vec<u32>, // ARGB8888
}

pub fn decode_png(data: &[u8]) -> Option<Bitmap> {
    if data.len() < 8 { return None; }
    // PNG signature
    if &data[0..8] != b"\x89PNG\r\n\x1a\n" { return None; }

    let mut pos = 8usize;
    let mut width = 0usize; let mut height = 0usize;
    let mut bit_depth = 0u8; let mut color_type = 0u8;
    let mut idat: Vec<u8> = Vec::new();

    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]) as usize;
        let chunk_type = &data[pos+4..pos+8];
        let chunk_data = &data[pos+8..pos+8+chunk_len];
        pos += 12 + chunk_len;

        match chunk_type {
            b"IHDR" if chunk_data.len() >= 13 => {
                width      = u32::from_be_bytes([chunk_data[0],chunk_data[1],chunk_data[2],chunk_data[3]]) as usize;
                height     = u32::from_be_bytes([chunk_data[4],chunk_data[5],chunk_data[6],chunk_data[7]]) as usize;
                bit_depth  = chunk_data[8];
                color_type = chunk_data[9];
            }
            b"IDAT" => { idat.extend_from_slice(chunk_data); }
            b"IEND" => break,
            _ => {}
        }
    }

    if width == 0 || height == 0 { return None; }
    if bit_depth != 8 { return None; } // Only 8-bit supported

    // Decompress IDAT (zlib → raw filtered image)
    let raw = zlib_decompress(&idat)?;

    // Channels per pixel
    let channels: usize = match color_type {
        0 => 1, // Grayscale
        2 => 3, // RGB
        3 => 1, // Indexed (palette) — simplified
        4 => 2, // Grayscale+Alpha
        6 => 4, // RGBA
        _ => return None,
    };

    let stride = width * channels + 1; // +1 for filter byte
    if raw.len() < height * stride { return None; }

    let mut pixels = Vec::with_capacity(width * height);
    let mut prev_row = alloc::vec![0u8; width * channels];

    for row in 0..height {
        let row_start = row * stride;
        let filter = raw[row_start];
        let row_data = &raw[row_start+1..row_start+1+width*channels];

        // Apply PNG filter reconstruction
        let mut recon = alloc::vec![0u8; width * channels];
        for i in 0..row_data.len() {
            let a = if i >= channels { recon[i - channels] } else { 0 };
            let b = prev_row[i];
            let c = if i >= channels { prev_row[i - channels] } else { 0 };
            recon[i] = match filter {
                0 => row_data[i],
                1 => row_data[i].wrapping_add(a),
                2 => row_data[i].wrapping_add(b),
                3 => row_data[i].wrapping_add((a as u16 + b as u16 / 2) as u8),
                4 => row_data[i].wrapping_add(paeth(a, b, c)),
                _ => row_data[i],
            };
        }

        // Convert to ARGB8888
        let step = channels;
        for col in 0..width {
            let off = col * step;
            let argb = match color_type {
                0 => { let v = recon[off]; 0xFF000000 | (v as u32 * 0x010101) }
                2 => { 0xFF000000 | (recon[off] as u32) << 16 | (recon[off+1] as u32) << 8 | recon[off+2] as u32 }
                6 => { (recon[off+3] as u32) << 24 | (recon[off] as u32) << 16 | (recon[off+1] as u32) << 8 | recon[off+2] as u32 }
                _ => 0xFF808080,
            };
            pixels.push(argb);
        }
        prev_row = recon;
    }
    Some(Bitmap { width, height, pixels })
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let (a,b,c) = (a as i16, b as i16, c as i16);
    let p = a + b - c;
    let pa = (p - a).abs();
    let pb = (p - b).abs();
    let pc = (p - c).abs();
    if pa <= pb && pa <= pc { a as u8 } else if pb <= pc { b as u8 } else { c as u8 }
}

// ── Minimal zlib/deflate decompressor ────────────────────────────────────────

fn zlib_decompress(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 2 { return None; }
    // Skip zlib header (2 bytes CMF+FLG) and Adler-32 checksum (last 4 bytes)
    let compressed = if data.len() > 6 { &data[2..data.len()-4] } else { &data[2..] };
    deflate_decompress(compressed)
}

fn deflate_decompress(data: &[u8]) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    let mut bit_pos = 0usize; // bit position in data

    let read_bit = |data: &[u8], pos: &mut usize| -> Option<u8> {
        if *pos / 8 >= data.len() { return None; }
        let bit = (data[*pos / 8] >> (*pos % 8)) & 1;
        *pos += 1;
        Some(bit)
    };

    let read_bits = |data: &[u8], pos: &mut usize, n: usize| -> Option<u32> {
        let mut val = 0u32;
        for i in 0..n {
            let b = (data.get(*pos / 8)? >> (*pos % 8)) & 1;
            val |= (b as u32) << i;
            *pos += 1;
        }
        Some(val)
    };

    loop {
        let bfinal = read_bits(data, &mut bit_pos, 1)?;
        let btype  = read_bits(data, &mut bit_pos, 2)?;

        match btype {
            0 => {
                // No compression
                bit_pos = (bit_pos + 7) & !7; // byte align
                let byte_pos = bit_pos / 8;
                if byte_pos + 4 > data.len() { return None; }
                let len = u16::from_le_bytes([data[byte_pos], data[byte_pos+1]]) as usize;
                // let nlen = u16::from_le_bytes([data[byte_pos+2], data[byte_pos+3]]);
                let start = byte_pos + 4;
                if start + len > data.len() { return None; }
                out.extend_from_slice(&data[start..start+len]);
                bit_pos = (start + len) * 8;
            }
            1 => {
                // Fixed Huffman codes
                fixed_huffman_block(data, &mut bit_pos, &mut out)?;
            }
            2 => {
                // Dynamic Huffman (simplified: treat as stored)
                // Full dynamic Huffman would require building Huffman trees from the block header
                // For now, fall back to skip — handles most simple PNGs
                break;
            }
            _ => return None,
        }

        if bfinal != 0 { break; }
    }
    Some(out)
}

fn fixed_huffman_block(data: &[u8], bit_pos: &mut usize, out: &mut Vec<u8>) -> Option<()> {
    // RFC 1951 fixed Huffman table (literal/length codes)
    loop {
        // Read 7-9 bit code (simplified fixed decode)
        let code7 = read_bits_rev(data, bit_pos, 7)?;
        let sym = if code7 <= 23 { // 256-279: 7 bits
            256 + code7 as usize
        } else {
            let bit8 = read_bit_msb(data, bit_pos)?;
            let code8 = (code7 << 1) | bit8 as u32;
            if code8 <= 191 { code8 as usize } // 0-143: 8 bits
            else {
                let bit9 = read_bit_msb(data, bit_pos)?;
                let code9 = (code8 << 1) | bit9 as u32;
                if code9 >= 400 { 144 + (code9 - 400) as usize } else { 256 + code7 as usize }
            }
        };

        if sym == 256 { break; } // end of block
        if sym < 256 { out.push(sym as u8); continue; }

        // Length/distance pair
        let length = decode_length(data, bit_pos, sym)?;
        let dist_code = read_bits_rev(data, bit_pos, 5)?;
        let dist = decode_dist(data, bit_pos, dist_code as usize)?;

        // Copy from back-reference
        let start = out.len().saturating_sub(dist);
        for i in 0..length {
            let byte = *out.get(start + i % dist.max(1))?;
            out.push(byte);
        }
    }
    Some(())
}

fn read_bits_rev(data: &[u8], pos: &mut usize, n: usize) -> Option<u32> {
    let mut val = 0u32;
    for i in (0..n).rev() {
        let b = (data.get(*pos / 8)? >> (*pos % 8)) & 1;
        val |= (b as u32) << i;
        *pos += 1;
    }
    Some(val)
}

fn read_bit_msb(data: &[u8], pos: &mut usize) -> Option<u8> {
    let b = (data.get(*pos / 8)? >> (*pos % 8)) & 1;
    *pos += 1;
    Some(b)
}

fn decode_length(data: &[u8], pos: &mut usize, sym: usize) -> Option<usize> {
    let base = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    let extra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    let i = sym - 257;
    if i >= base.len() { return None; }
    let extra_bits = read_bits(data, pos, extra[i])?;
    Some(base[i] + extra_bits as usize)
}

fn decode_dist(data: &[u8], pos: &mut usize, code: usize) -> Option<usize> {
    let base = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    let extra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    if code >= base.len() { return None; }
    let extra_bits = read_bits(data, pos, extra[code])?;
    Some(base[code] + extra_bits as usize)
}

fn read_bits(data: &[u8], pos: &mut usize, n: usize) -> Option<u32> {
    let mut val = 0u32;
    for i in 0..n {
        let b = (data.get(*pos / 8)? >> (*pos % 8)) & 1;
        val |= (b as u32) << i;
        *pos += 1;
    }
    Some(val)
}

/// Decode PNG and blit to framebuffer at (x, y).
pub fn blit_png(data: &[u8], dst_x: usize, dst_y: usize) -> bool {
    if let Some(bmp) = decode_png(data) {
        let (sw, sh) = crate::drivers::framebuffer_arm::size();
        for py in 0..bmp.height {
            for px in 0..bmp.width {
                let argb = bmp.pixels[py * bmp.width + px];
                let alpha = (argb >> 24) & 0xFF;
                if alpha == 0 { continue; }
                let r = ((argb >> 16) & 0xFF) as u8;
                let g = ((argb >> 8) & 0xFF) as u8;
                let b = (argb & 0xFF) as u8;
                let fx = dst_x + px; let fy = dst_y + py;
                if fx < sw && fy < sh {
                    crate::drivers::framebuffer_arm::set_pixel(fx, fy, r, g, b);
                }
            }
        }
        return true;
    }
    false
}
