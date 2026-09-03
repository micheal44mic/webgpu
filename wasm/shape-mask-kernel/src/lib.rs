#![no_std]

use core::arch::wasm32;
use core::panic::PanicInfo;
use core::slice;

const ABI_VERSION: u32 = 1;
const FLAG_INVERT: u32 = 1 << 0;
const FLAG_QUANTIZE_R8: u32 = 1 << 1;

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    wasm32::unreachable()
}

#[unsafe(no_mangle)]
pub extern "C" fn shape_mask_kernel_abi_version() -> u32 {
    ABI_VERSION
}

#[inline(always)]
fn rounded_u16_to_u8(value: f64) -> u8 {
    let normalized = value / 257.0;
    if normalized <= 0.0 {
        0
    } else if normalized >= 255.0 {
        u8::MAX
    } else {
        (normalized + 0.5) as u8
    }
}

#[inline(always)]
fn floor_to_isize(value: f64) -> isize {
    let truncated = value as isize;
    if value < truncated as f64 {
        truncated - 1
    } else {
        truncated
    }
}

#[inline(always)]
fn quantized_source(value: u16, quantize_r8: bool) -> f64 {
    if quantize_r8 {
        f64::from(rounded_u16_to_u8(f64::from(value))) * 257.0
    } else {
        f64::from(value)
    }
}

#[inline(always)]
fn clamped_sample(source: &[u16], width: usize, height: usize, x: isize, y: isize) -> u16 {
    let clamped_x = x.clamp(0, width as isize - 1) as usize;
    let clamped_y = y.clamp(0, height as isize - 1) as usize;
    source[clamped_y * width + clamped_x]
}

#[inline(always)]
fn fnv1a_u16_le(source: &[u16]) -> u32 {
    let mut hash = 0x811c_9dc5_u32;
    for value in source {
        hash = (hash ^ u32::from((*value & 0xff) as u8)).wrapping_mul(0x0100_0193);
        hash = (hash ^ u32::from((*value >> 8) as u8)).wrapping_mul(0x0100_0193);
    }
    hash
}

/// Prepares the CPU derivatives of a scalar mask.
///
/// ABI preconditions are intentionally enforced by the JavaScript adapter:
/// - every pointer is inside the exported memory and does not overlap;
/// - `source_ptr` is aligned to two bytes and holds `width * height` u16 values;
/// - each non-zero output pointer holds `target_size * target_size` bytes;
/// - dimensions and their products fit in 32-bit address space.
///
/// `base_ptr` or `support_ptr` may be zero to omit that output. The source is
/// mutated only when FLAG_INVERT is set. The return value is FNV-1a over the
/// little-endian bytes of the post-inversion u16 source.
///
/// # Safety
///
/// The caller must satisfy every pointer, length, alignment, and non-overlap
/// precondition listed above for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn prepare_scalar_mask_u16(
    source_ptr: u32,
    source_width: u32,
    source_height: u32,
    target_size: u32,
    flags: u32,
    base_ptr: u32,
    support_ptr: u32,
) -> u32 {
    let width = source_width as usize;
    let height = source_height as usize;
    let target = target_size as usize;
    let source_len = width * height;
    let output_len = target * target;

    // SAFETY: the adapter owns the linear-memory layout and validates every
    // length before invoking this function.
    let source = unsafe { slice::from_raw_parts_mut(source_ptr as *mut u16, source_len) };
    if flags & FLAG_INVERT != 0 {
        for value in source.iter_mut() {
            *value = u16::MAX - *value;
        }
    }
    let identity = fnv1a_u16_le(source);

    if base_ptr == 0 && support_ptr == 0 {
        return identity;
    }

    let mut base = if base_ptr == 0 {
        None
    } else {
        // SAFETY: covered by the ABI preconditions above.
        Some(unsafe { slice::from_raw_parts_mut(base_ptr as *mut u8, output_len) })
    };
    let mut support = if support_ptr == 0 {
        None
    } else {
        // SAFETY: covered by the ABI preconditions above.
        Some(unsafe { slice::from_raw_parts_mut(support_ptr as *mut u8, output_len) })
    };
    let quantize_r8 = flags & FLAG_QUANTIZE_R8 != 0;

    if width == target && height == target {
        for (index, source_value) in source.iter().copied().enumerate() {
            let value = quantized_source(source_value, quantize_r8);
            if let Some(output) = base.as_deref_mut() {
                output[index] = rounded_u16_to_u8(value);
            }
            if let Some(output) = support.as_deref_mut() {
                output[index] = if value > 0.0 { u8::MAX } else { 0 };
            }
        }
        return identity;
    }

    let width_scale = source_width as f64 / target_size as f64;
    let height_scale = source_height as f64 / target_size as f64;
    for target_y in 0..target {
        let source_y = (target_y as f64 + 0.5) * height_scale - 0.5;
        let y0 = floor_to_isize(source_y);
        let fy = source_y - y0 as f64;
        let target_row = target_y * target;
        for target_x in 0..target {
            let source_x = (target_x as f64 + 0.5) * width_scale - 0.5;
            let x0 = floor_to_isize(source_x);
            let fx = source_x - x0 as f64;
            let top_left =
                quantized_source(clamped_sample(source, width, height, x0, y0), quantize_r8);
            let top_right = quantized_source(
                clamped_sample(source, width, height, x0 + 1, y0),
                quantize_r8,
            );
            let bottom_left = quantized_source(
                clamped_sample(source, width, height, x0, y0 + 1),
                quantize_r8,
            );
            let bottom_right = quantized_source(
                clamped_sample(source, width, height, x0 + 1, y0 + 1),
                quantize_r8,
            );
            let top = top_left + (top_right - top_left) * fx;
            let bottom = bottom_left + (bottom_right - bottom_left) * fx;
            let index = target_row + target_x;
            if let Some(output) = base.as_deref_mut() {
                output[index] = rounded_u16_to_u8(top + (bottom - top) * fy);
            }
            if let Some(output) = support.as_deref_mut() {
                output[index] = if top_left.max(top_right).max(bottom_left).max(bottom_right) > 0.0
                {
                    u8::MAX
                } else {
                    0
                };
            }
        }
    }
    identity
}
