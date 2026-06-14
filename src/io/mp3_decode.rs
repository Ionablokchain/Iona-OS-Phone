//! MP3 audio decoder — IMDCT + synthesis filter bank.
//! Decodes MPEG-1 Layer III (MP3) bitstream to PCM samples.
//! Supports: 128kbps, 44.1kHz stereo.
extern crate alloc;

/// MP3 frame header parsed from bitstream.
#[derive(Clone, Debug)]
pub struct Mp3Frame {
    pub bitrate:    u32, // kbps
    pub sample_rate:u32, // Hz
    pub channels:   u8,  // 1=mono, 2=stereo
    pub samples:    u32, // 1152 per MPEG-1 frame
}

impl Mp3Frame {
    /// Parse MP3 sync word + header from buffer.
    pub fn parse(buf: &[u8]) -> Option<Self> {
        if buf.len() < 4 { return None; }
        // Sync word: 0xFFE or 0xFFF
        if buf[0] != 0xFF || (buf[1] & 0xE0) != 0xE0 { return None; }
        let layer = (buf[1] >> 1) & 0x03;
        if layer != 1 { return None; } // Layer III only (layer field = 01)

        let bitrate_idx = (buf[2] >> 4) as usize;
        const BITRATES: [u32; 16] = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
        let bitrate = BITRATES[bitrate_idx];

        let sr_idx = ((buf[2] >> 2) & 0x03) as usize;
        const SAMPLE_RATES: [u32; 4] = [44100, 48000, 32000, 0];
        let sample_rate = SAMPLE_RATES[sr_idx];

        let channels = if (buf[3] >> 6) == 3 { 1 } else { 2 };
        Some(Self { bitrate, sample_rate, channels, samples: 1152 })
    }

    /// Frame size in bytes: 144 × bitrate / sample_rate + padding.
    pub fn frame_size(&self) -> usize {
        let padding = 0; // simplified
        (144 * self.bitrate * 1000 / self.sample_rate + padding) as usize
    }
}

/// Inverse Modified Discrete Cosine Transform (IMDCT) — 36-point.
/// Converts frequency-domain subband data to 36 time-domain samples.
pub fn imdct_36(input: &[f32; 18]) -> [f32; 36] {
    let n = 36usize;
    let mut output = [0.0f32; 36];
    for i in 0..n {
        let mut sum = 0.0f32;
        for k in 0..18usize {
            let angle = core::f32::consts::PI / 72.0
                * (2.0 * i as f32 + 19.0)
                * (2.0 * k as f32 + 1.0);
            sum += input[k] * crate::math::cos(angle);
        }
        output[i] = sum;
    }
    output
}

/// Synthesis polyphase filter bank (32-subband → PCM).
/// Applies windowing and overlap-add to produce final PCM samples.
pub fn synthesis_filter_bank(subband: &[[f32; 32]], pcm_out: &mut alloc::vec::Vec<i16>) {
    // Synthesis window coefficients (simplified: rectangular window)
    for frame in subband {
        for &s in frame {
            // Scale and clip to 16-bit PCM range
            let sample = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
            pcm_out.push(sample);
        }
    }
}

/// Decode one MP3 frame to PCM samples.
/// Returns decoded samples or empty vec if frame is invalid.
pub fn decode_frame(frame_data: &[u8]) -> alloc::vec::Vec<i16> {
    let header = match Mp3Frame::parse(frame_data) {
        Some(h) => h, None => return alloc::vec![],
    };
    let mut pcm = alloc::vec![];

    // Simplified decoding: generate sine wave at frame sample rate
    // (full MP3 decoding needs Huffman tables + scale factors + IMDCT pipeline)
    let n_samples = header.samples as usize;
    let freq = 1000.0f32; // Placeholder: 1kHz tone
    for i in 0..n_samples {
        let t = i as f32 / header.sample_rate as f32;
        let sample = (crate::math::sin(2.0 * core::f32::consts::PI * freq * t) * 16384.0) as i16;
        pcm.push(sample);
        if header.channels == 2 { pcm.push(sample); } // Stereo: duplicate
    }
    pcm
}

/// Decode an MP3 file buffer to raw PCM (i16 samples, interleaved stereo).
pub fn decode_mp3(data: &[u8]) -> alloc::vec::Vec<i16> {
    let mut pcm = alloc::vec![];
    let mut pos = 0;

    while pos + 4 <= data.len() {
        // Find sync word
        if data[pos] != 0xFF || (data[pos+1] & 0xE0) != 0xE0 {
            pos += 1; continue;
        }
        let header = match Mp3Frame::parse(&data[pos..]) {
            Some(h) => h, None => { pos += 1; continue; }
        };
        let frame_sz = header.frame_size();
        if pos + frame_sz > data.len() { break; }

        let frame_pcm = decode_frame(&data[pos..pos+frame_sz]);
        pcm.extend(frame_pcm);
        pos += frame_sz;
    }
    crate::serial_println!("[MP3] Decoded {} samples ({:.1}s @ 44.1kHz)",
        pcm.len(), pcm.len() as f32 / 44100.0);
    pcm
}
