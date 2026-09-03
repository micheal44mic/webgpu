#![no_std]

use core::arch::wasm32;
use core::mem::size_of;
use core::panic::PanicInfo;
use core::ptr;
use core::slice;

const ABI_VERSION: u32 = 1;
const STATE_MAGIC: u32 = 0x5354_524b;
const STABILIZATION_CAPACITY: usize = 1024;
const INPUT_STRIDE: usize = 4;
const DAB_STRIDE: usize = 6;
const TAIL_STRIDE: usize = 10;
const SUMMARY_LENGTH: usize = 16;

const STATUS_OK: i32 = 0;
const STATUS_INVALID_ARGUMENT: i32 = -1;
const STATUS_INACTIVE: i32 = -2;
const STATUS_DAB_CAPACITY: i32 = -3;
const STATUS_TAIL_CAPACITY: i32 = -4;

const SPACING_FIXED: u32 = 0;
const SPACING_DIRECT_PRESSURE: u32 = 1;

const MAXIMUM_TIME_CONSTANT_MS: f64 = 160.0;
const MINIMUM_SEGMENT_LENGTH: f64 = 0.0001;
const MAXIMUM_SMOOTH_TURN_RADIANS: f64 = core::f64::consts::PI / 3.0;
const MAXIMUM_TANGENT_CORRECTION_RADIANS: f64 = core::f64::consts::PI / 12.0;
const FLATTENING_TOLERANCE_PX: f64 = 0.25;
const MAXIMUM_SUBDIVISIONS: u32 = 512;
const DIRECTION_EPSILON: f64 = 1e-7;
const ANGLE_COMPARISON_EPSILON: f64 = 1e-7;

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    wasm32::unreachable()
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CurvePlanner {
    has_previous_direction: u32,
    has_predicted_end_tangent: u32,
    previous_direction_x: f64,
    previous_direction_y: f64,
    previous_end_tangent_x: f64,
    previous_end_tangent_y: f64,
}

impl CurvePlanner {
    const fn initial() -> Self {
        Self {
            has_previous_direction: 0,
            has_predicted_end_tangent: 0,
            previous_direction_x: 1.0,
            previous_direction_y: 0.0,
            previous_end_tangent_x: 1.0,
            previous_end_tangent_y: 0.0,
        }
    }
}

#[repr(C)]
struct StrokeState {
    magic: u32,
    active: u32,
    bypassed: u32,
    spacing_mode: u32,
    head: u32,
    count: u32,
    latest_sequence: u32,
    maximum_stamps_per_segment: u32,
    amount: f64,
    time_constant_ms: f64,
    tail_duration_ms: f64,
    last_raw_x: f64,
    last_raw_y: f64,
    last_filtered_x: f64,
    last_filtered_y: f64,
    last_time_ms: f64,
    seam_x: f64,
    seam_y: f64,
    seam_pressure: f64,
    seam_time_ms: f64,
    seam_sequence: f64,
    committed_x: f64,
    committed_y: f64,
    committed_pressure: f64,
    committed_time_ms: f64,
    spacing_value: f64,
    spacing_carry: f64,
    total_dabs: u32,
    mature_count: u32,
    forced_mature_count: u32,
    maximum_tail_count: u32,
    curve_input_segments: u32,
    curve_flattened_segments: u32,
    curve_smoothed_segments: u32,
    curve_sharp_corner_bypasses: u32,
    curve: CurvePlanner,
    raw_x: [f64; STABILIZATION_CAPACITY],
    raw_y: [f64; STABILIZATION_CAPACITY],
    filtered_x: [f64; STABILIZATION_CAPACITY],
    filtered_y: [f64; STABILIZATION_CAPACITY],
    pressure: [f64; STABILIZATION_CAPACITY],
    time_ms: [f64; STABILIZATION_CAPACITY],
    sequence: [f64; STABILIZATION_CAPACITY],
}

#[derive(Clone, Copy)]
struct CurveSegment {
    start_x: f64,
    start_y: f64,
    coefficient_ax: f64,
    coefficient_ay: f64,
    coefficient_bx: f64,
    coefficient_by: f64,
    coefficient_cx: f64,
    coefficient_cy: f64,
    subdivision_count: u32,
    smoothed: bool,
    sharp_corner_bypass: bool,
}

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
    pressure: f64,
    time_ms: f64,
}

struct DabWriter<'a> {
    output: &'a mut [f64],
    capacity: usize,
    count: usize,
    overflowed: bool,
}

impl DabWriter<'_> {
    #[inline(always)]
    fn emit(&mut self, point: Point, direction_x: f64, direction_y: f64) {
        if self.count >= self.capacity {
            self.overflowed = true;
            return;
        }
        let base = self.count * DAB_STRIDE;
        self.output[base] = point.x;
        self.output[base + 1] = point.y;
        self.output[base + 2] = point.pressure;
        self.output[base + 3] = point.time_ms;
        self.output[base + 4] = direction_x;
        self.output[base + 5] = direction_y;
        self.count += 1;
    }
}

#[inline(always)]
fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

#[inline(always)]
fn normalized_amount(value: f64) -> f64 {
    if value.is_finite() {
        clamp(value, 0.0, 1.0)
    } else {
        0.0
    }
}

#[inline(always)]
fn smoothstep(progress: f64) -> f64 {
    let value = clamp(progress, 0.0, 1.0);
    value * value * (3.0 - 2.0 * value)
}

#[inline(always)]
fn linear_input_advance_factor(normalized_delta: f64) -> f64 {
    if normalized_delta < 1e-3 {
        let squared = normalized_delta * normalized_delta;
        squared
            * (0.5
                + normalized_delta
                    * (-1.0 / 6.0 + normalized_delta * (1.0 / 24.0 - normalized_delta / 120.0)))
    } else {
        normalized_delta + libm::expm1(-normalized_delta)
    }
}

#[inline(always)]
fn direct_spacing_percent(diameter: f64) -> f64 {
    const VALUES: [(f64, f64); 7] = [
        (1.0, 50.0),
        (4.0, 42.5),
        (16.0, 23.333_333_333_3),
        (28.0, 13.333_333_333_3),
        (60.0, 10.0),
        (100.0, 9.0),
        (200.0, 6.666_666_666_7),
    ];
    let normalized = if diameter.is_finite() {
        diameter.max(1.0)
    } else {
        1.0
    };
    if normalized <= VALUES[0].0 {
        return VALUES[0].1;
    }
    let mut index = 1;
    while index < VALUES.len() {
        let lower = VALUES[index - 1];
        let upper = VALUES[index];
        if normalized <= upper.0 {
            let interpolation = clamp((normalized - lower.0) / (upper.0 - lower.0), 0.0, 1.0);
            return lower.1 + (upper.1 - lower.1) * interpolation;
        }
        index += 1;
    }
    VALUES[VALUES.len() - 1].1
}

#[inline(always)]
fn direct_spacing_distance(authored_diameter: f64, pressure: f64) -> f64 {
    let diameter = if authored_diameter.is_finite() {
        authored_diameter.max(1.0)
    } else {
        1.0
    };
    let normalized_pressure = if pressure.is_finite() {
        clamp(pressure, 0.0, 1.0).max(0.01)
    } else {
        1.0
    };
    let effective = (diameter * normalized_pressure).max(1.0);
    (effective * direct_spacing_percent(effective) / 100.0).max(0.1)
}

#[inline(always)]
fn coefficient_a(start: f64, control_1: f64, control_2: f64, end: f64) -> f64 {
    -start + 3.0 * control_1 - 3.0 * control_2 + end
}

#[inline(always)]
fn coefficient_b(start: f64, control_1: f64, control_2: f64) -> f64 {
    3.0 * start - 6.0 * control_1 + 3.0 * control_2
}

#[inline(always)]
fn coefficient_c(start: f64, control_1: f64) -> f64 {
    3.0 * (control_1 - start)
}

#[inline(always)]
fn evaluate(start: f64, a: f64, b: f64, c: f64, parameter: f64) -> f64 {
    let t = clamp(parameter, 0.0, 1.0);
    ((a * t + b) * t + c) * t + start
}

fn plan_curve(
    planner: &mut CurvePlanner,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
) -> CurveSegment {
    let delta_x = end_x - start_x;
    let delta_y = end_y - start_y;
    let length = libm::hypot(delta_x, delta_y);
    let direction_x = if length > MINIMUM_SEGMENT_LENGTH {
        delta_x / length
    } else {
        1.0
    };
    let direction_y = if length > MINIMUM_SEGMENT_LENGTH {
        delta_y / length
    } else {
        0.0
    };
    let had_previous_direction = planner.has_previous_direction != 0;
    let mut start_tangent_x = direction_x;
    let mut start_tangent_y = direction_y;
    let mut end_tangent_x = direction_x;
    let mut end_tangent_y = direction_y;
    let mut raw_turn_radians = 0.0;
    let mut sharp_corner_bypass = false;
    let mut smoothed = false;

    if length > MINIMUM_SEGMENT_LENGTH && had_previous_direction {
        let direction_dot = clamp(
            planner.previous_direction_x * direction_x + planner.previous_direction_y * direction_y,
            -1.0,
            1.0,
        );
        let direction_cross =
            planner.previous_direction_x * direction_y - planner.previous_direction_y * direction_x;
        raw_turn_radians = libm::atan2(direction_cross, direction_dot);
        sharp_corner_bypass =
            raw_turn_radians.abs() > MAXIMUM_SMOOTH_TURN_RADIANS + ANGLE_COMPARISON_EPSILON;

        if sharp_corner_bypass {
            start_tangent_x = direction_x;
            start_tangent_y = direction_y;
        } else {
            let predicted_turn = raw_turn_radians * 0.5;
            let cosine = libm::cos(predicted_turn);
            let sine = libm::sin(predicted_turn);
            let expected_start_tangent_x =
                planner.previous_direction_x * cosine - planner.previous_direction_y * sine;
            let expected_start_tangent_y =
                planner.previous_direction_x * sine + planner.previous_direction_y * cosine;
            let predicted_start_dot = clamp(
                planner.previous_end_tangent_x * expected_start_tangent_x
                    + planner.previous_end_tangent_y * expected_start_tangent_y,
                -1.0,
                1.0,
            );
            let predicted_start_cross = planner.previous_end_tangent_x * expected_start_tangent_y
                - planner.previous_end_tangent_y * expected_start_tangent_x;
            let tangent_correction = libm::atan2(predicted_start_cross, predicted_start_dot).abs();
            if planner.has_predicted_end_tangent == 0
                || tangent_correction
                    > MAXIMUM_TANGENT_CORRECTION_RADIANS + ANGLE_COMPARISON_EPSILON
            {
                start_tangent_x = expected_start_tangent_x;
                start_tangent_y = expected_start_tangent_y;
            } else {
                start_tangent_x = planner.previous_end_tangent_x;
                start_tangent_y = planner.previous_end_tangent_y;
            }
            end_tangent_x = direction_x * cosine - direction_y * sine;
            end_tangent_y = direction_x * sine + direction_y * cosine;
            let start_turn = libm::atan2(
                start_tangent_x * direction_y - start_tangent_y * direction_x,
                clamp(
                    start_tangent_x * direction_x + start_tangent_y * direction_y,
                    -1.0,
                    1.0,
                ),
            );
            smoothed =
                raw_turn_radians.abs() > DIRECTION_EPSILON || start_turn.abs() > DIRECTION_EPSILON;
        }
    }

    let quarter_turn = clamp(
        raw_turn_radians.abs() * 0.25,
        0.0,
        MAXIMUM_SMOOTH_TURN_RADIANS * 0.25,
    );
    let tangent_length = if sharp_corner_bypass {
        length
    } else {
        let cosine = libm::cos(quarter_turn);
        length / (cosine * cosine).max(0.75)
    };
    let control_scale = tangent_length / 3.0;
    let control_1_x = start_x + start_tangent_x * control_scale;
    let control_1_y = start_y + start_tangent_y * control_scale;
    let control_2_x = end_x - end_tangent_x * control_scale;
    let control_2_y = end_y - end_tangent_y * control_scale;
    let coefficient_ax = coefficient_a(start_x, control_1_x, control_2_x, end_x);
    let coefficient_ay = coefficient_a(start_y, control_1_y, control_2_y, end_y);
    let coefficient_bx = coefficient_b(start_x, control_1_x, control_2_x);
    let coefficient_by = coefficient_b(start_y, control_1_y, control_2_y);
    let maximum_second_derivative =
        libm::hypot(2.0 * coefficient_bx, 2.0 * coefficient_by).max(libm::hypot(
            6.0 * coefficient_ax + 2.0 * coefficient_bx,
            6.0 * coefficient_ay + 2.0 * coefficient_by,
        ));
    let subdivision_count = if smoothed {
        clamp(
            libm::ceil(libm::sqrt(
                maximum_second_derivative / (8.0 * FLATTENING_TOLERANCE_PX),
            )),
            1.0,
            f64::from(MAXIMUM_SUBDIVISIONS),
        ) as u32
    } else {
        1
    };

    if length > MINIMUM_SEGMENT_LENGTH {
        planner.has_previous_direction = 1;
        planner.has_predicted_end_tangent =
            u32::from(had_previous_direction && !sharp_corner_bypass);
        planner.previous_direction_x = direction_x;
        planner.previous_direction_y = direction_y;
        planner.previous_end_tangent_x = end_tangent_x;
        planner.previous_end_tangent_y = end_tangent_y;
    }

    CurveSegment {
        start_x,
        start_y,
        coefficient_ax,
        coefficient_ay,
        coefficient_bx,
        coefficient_by,
        coefficient_cx: coefficient_c(start_x, control_1_x),
        coefficient_cy: coefficient_c(start_y, control_1_y),
        subdivision_count,
        smoothed,
        sharp_corner_bypass,
    }
}

#[inline(always)]
fn curve_x(segment: &CurveSegment, parameter: f64) -> f64 {
    evaluate(
        segment.start_x,
        segment.coefficient_ax,
        segment.coefficient_bx,
        segment.coefficient_cx,
        parameter,
    )
}

#[inline(always)]
fn curve_y(segment: &CurveSegment, parameter: f64) -> f64 {
    evaluate(
        segment.start_y,
        segment.coefficient_ay,
        segment.coefficient_by,
        segment.coefficient_cy,
        parameter,
    )
}

fn resample_fixed(
    segment: &CurveSegment,
    start: Point,
    end: Point,
    spacing: f64,
    initial_distance: f64,
    maximum_stamps: u32,
    writer: &mut DabWriter<'_>,
) -> f64 {
    let delta_time_ms = end.time_ms - start.time_ms;
    let mut distance_since_stamp = initial_distance;
    let mut generated = 0_u32;
    let mut limit_reached = false;
    let mut curve_start_x = start.x;
    let mut curve_start_y = start.y;
    let mut parameter_start = 0.0;
    let mut subdivision = 1_u32;

    while subdivision <= segment.subdivision_count {
        let parameter_end = f64::from(subdivision) / f64::from(segment.subdivision_count);
        let curve_end_x = if subdivision == segment.subdivision_count {
            end.x
        } else {
            curve_x(segment, parameter_end)
        };
        let curve_end_y = if subdivision == segment.subdivision_count {
            end.y
        } else {
            curve_y(segment, parameter_end)
        };
        let delta_x = curve_end_x - curve_start_x;
        let delta_y = curve_end_y - curve_start_y;
        let length = libm::hypot(delta_x, delta_y);
        let mut distance_along = 0.0;

        if length > MINIMUM_SEGMENT_LENGTH {
            let direction_x = delta_x / length;
            let direction_y = delta_y / length;
            while !limit_reached && distance_since_stamp + (length - distance_along) >= spacing {
                let distance_to_next = spacing - distance_since_stamp;
                distance_along += distance_to_next;
                let local = clamp(distance_along / length, 0.0, 1.0);
                let curve_parameter = parameter_start + (parameter_end - parameter_start) * local;
                writer.emit(
                    Point {
                        x: curve_start_x + delta_x * local,
                        y: curve_start_y + delta_y * local,
                        pressure: start.pressure
                            + (end.pressure - start.pressure) * curve_parameter,
                        time_ms: start.time_ms + delta_time_ms * curve_parameter,
                    },
                    direction_x,
                    direction_y,
                );
                distance_since_stamp = 0.0;
                generated += 1;
                if generated >= maximum_stamps {
                    limit_reached = true;
                }
            }
            distance_since_stamp += (length - distance_along).max(0.0);
        }
        curve_start_x = curve_end_x;
        curve_start_y = curve_end_y;
        parameter_start = parameter_end;
        subdivision += 1;
    }

    if limit_reached {
        distance_since_stamp % spacing
    } else {
        distance_since_stamp
    }
}

fn resample_variable(
    segment: &CurveSegment,
    start: Point,
    end: Point,
    authored_size: f64,
    initial_remaining: f64,
    maximum_stamps: u32,
    writer: &mut DabWriter<'_>,
) -> f64 {
    let delta_time_ms = end.time_ms - start.time_ms;
    let mut remaining = initial_remaining.max(0.1);
    let mut generated = 0_u32;
    let mut curve_start_x = start.x;
    let mut curve_start_y = start.y;
    let mut parameter_start = 0.0;
    let mut subdivision = 1_u32;

    while subdivision <= segment.subdivision_count {
        let parameter_end = f64::from(subdivision) / f64::from(segment.subdivision_count);
        let curve_end_x = if subdivision == segment.subdivision_count {
            end.x
        } else {
            curve_x(segment, parameter_end)
        };
        let curve_end_y = if subdivision == segment.subdivision_count {
            end.y
        } else {
            curve_y(segment, parameter_end)
        };
        let delta_x = curve_end_x - curve_start_x;
        let delta_y = curve_end_y - curve_start_y;
        let length = libm::hypot(delta_x, delta_y);
        let mut distance_along = 0.0;

        if length > MINIMUM_SEGMENT_LENGTH {
            let direction_x = delta_x / length;
            let direction_y = delta_y / length;
            while length - distance_along >= remaining {
                distance_along += remaining;
                let local = clamp(distance_along / length, 0.0, 1.0);
                let curve_parameter = parameter_start + (parameter_end - parameter_start) * local;
                let point = Point {
                    x: curve_start_x + delta_x * local,
                    y: curve_start_y + delta_y * local,
                    pressure: start.pressure + (end.pressure - start.pressure) * curve_parameter,
                    time_ms: start.time_ms + delta_time_ms * curve_parameter,
                };
                if generated < maximum_stamps {
                    writer.emit(point, direction_x, direction_y);
                    generated += 1;
                }
                remaining = direct_spacing_distance(authored_size, point.pressure).max(0.1);
            }
            remaining -= (length - distance_along).max(0.0);
        }
        curve_start_x = curve_end_x;
        curve_start_y = curve_end_y;
        parameter_start = parameter_end;
        subdivision += 1;
    }
    remaining.max(f64::EPSILON)
}

fn feed_point(state: &mut StrokeState, point: Point, writer: &mut DabWriter<'_>) {
    let normalized = Point {
        time_ms: point.time_ms.max(state.committed_time_ms),
        ..point
    };
    let start = Point {
        x: state.committed_x,
        y: state.committed_y,
        pressure: state.committed_pressure,
        time_ms: state.committed_time_ms,
    };
    let length = libm::hypot(normalized.x - start.x, normalized.y - start.y);
    if length > MINIMUM_SEGMENT_LENGTH {
        let segment = plan_curve(
            &mut state.curve,
            start.x,
            start.y,
            normalized.x,
            normalized.y,
        );
        state.curve_input_segments += 1;
        state.curve_flattened_segments += segment.subdivision_count;
        state.curve_smoothed_segments += u32::from(segment.smoothed);
        state.curve_sharp_corner_bypasses += u32::from(segment.sharp_corner_bypass);
        state.spacing_carry = if state.spacing_mode == SPACING_DIRECT_PRESSURE {
            resample_variable(
                &segment,
                start,
                normalized,
                state.spacing_value,
                state.spacing_carry,
                state.maximum_stamps_per_segment,
                writer,
            )
        } else {
            resample_fixed(
                &segment,
                start,
                normalized,
                state.spacing_value,
                state.spacing_carry,
                state.maximum_stamps_per_segment,
                writer,
            )
        };
    }
    state.committed_x = normalized.x;
    state.committed_y = normalized.y;
    state.committed_pressure = normalized.pressure;
    state.committed_time_ms = normalized.time_ms;
}

fn promote_head(state: &mut StrokeState, forced: bool, writer: &mut DabWriter<'_>) {
    let index = state.head as usize;
    let point = Point {
        x: state.filtered_x[index],
        y: state.filtered_y[index],
        pressure: state.pressure[index],
        time_ms: state.time_ms[index],
    };
    state.seam_x = point.x;
    state.seam_y = point.y;
    state.seam_pressure = point.pressure;
    state.seam_time_ms = point.time_ms;
    state.seam_sequence = state.sequence[index];
    state.head = (state.head + 1) % STABILIZATION_CAPACITY as u32;
    state.count -= 1;
    state.mature_count += 1;
    state.forced_mature_count += u32::from(forced);
    feed_point(state, point, writer);
}

#[inline(always)]
fn tail_values(state: &StrokeState, offset: usize) -> [f64; TAIL_STRIDE] {
    if offset == 0 {
        return [
            state.seam_x,
            state.seam_y,
            state.seam_pressure,
            state.seam_time_ms,
            state.seam_sequence,
            state.seam_x,
            state.seam_y,
            state.seam_x,
            state.seam_y,
            1.0,
        ];
    }
    let source = (state.head as usize + offset - 1) % STABILIZATION_CAPACITY;
    let latest = offset == state.count as usize;
    let age_ms = if latest {
        0.0
    } else {
        (state.last_time_ms - state.time_ms[source]).max(0.0)
    };
    let weight = if latest {
        0.0
    } else {
        smoothstep(age_ms / state.tail_duration_ms)
    };
    let raw_x = state.raw_x[source];
    let raw_y = state.raw_y[source];
    let filtered_x = state.filtered_x[source];
    let filtered_y = state.filtered_y[source];
    [
        raw_x + (filtered_x - raw_x) * weight,
        raw_y + (filtered_y - raw_y) * weight,
        state.pressure[source],
        state.time_ms[source],
        state.sequence[source],
        raw_x,
        raw_y,
        filtered_x,
        filtered_y,
        weight,
    ]
}

fn write_tail(state: &StrokeState, output: &mut [f64], capacity: usize) -> Result<usize, i32> {
    if state.bypassed != 0 {
        return Ok(0);
    }
    let count = state.count as usize + 1;
    if count > capacity {
        return Err(STATUS_TAIL_CAPACITY);
    }
    let mut offset = 0;
    while offset < count {
        let values = tail_values(state, offset);
        let base = offset * TAIL_STRIDE;
        output[base..base + TAIL_STRIDE].copy_from_slice(&values);
        offset += 1;
    }
    Ok(count)
}

fn write_summary(
    state: &StrokeState,
    pointer: u32,
    status: i32,
    consumed_inputs: usize,
    call_dabs: usize,
    tail_count: usize,
    finished: bool,
) {
    if pointer == 0 {
        return;
    }
    // SAFETY: the adapter reserves SUMMARY_LENGTH f64 values at this pointer.
    let output = unsafe { slice::from_raw_parts_mut(pointer as *mut f64, SUMMARY_LENGTH) };
    output[0] = f64::from(status);
    output[1] = consumed_inputs as f64;
    output[2] = call_dabs as f64;
    output[3] = f64::from(state.total_dabs);
    output[4] = f64::from(state.mature_count);
    output[5] = f64::from(state.forced_mature_count);
    output[6] = tail_count as f64;
    output[7] = f64::from(state.maximum_tail_count);
    output[8] = f64::from(state.curve_input_segments);
    output[9] = f64::from(state.curve_flattened_segments);
    output[10] = f64::from(state.curve_smoothed_segments);
    output[11] = f64::from(state.curve_sharp_corner_bypasses);
    output[12] = state.spacing_carry;
    output[13] = f64::from(state.latest_sequence);
    output[14] = state.time_constant_ms;
    output[15] = if finished { 1.0 } else { 0.0 };
}

#[unsafe(no_mangle)]
pub extern "C" fn stroke_geometry_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn stroke_geometry_state_bytes() -> u32 {
    size_of::<StrokeState>() as u32
}

/// Initializes one caller-owned stroke state.
///
/// # Safety
///
/// `state_ptr` must address a writable, correctly aligned allocation of at
/// least [`stroke_geometry_state_bytes`] bytes in this module's linear memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_geometry_begin(
    state_ptr: u32,
    amount: f64,
    spacing_mode: u32,
    spacing_value: f64,
    maximum_stamps_per_segment: u32,
    x: f64,
    y: f64,
    pressure: f64,
    time_ms: f64,
) -> i32 {
    if state_ptr == 0
        || !(state_ptr as usize).is_multiple_of(core::mem::align_of::<StrokeState>())
        || (spacing_mode != SPACING_FIXED && spacing_mode != SPACING_DIRECT_PRESSURE)
        || !x.is_finite()
        || !y.is_finite()
        || !pressure.is_finite()
        || !time_ms.is_finite()
        || !spacing_value.is_finite()
        || maximum_stamps_per_segment == 0
    {
        return STATUS_INVALID_ARGUMENT;
    }
    // SAFETY: the adapter owns a zero-overlap state allocation of the reported size.
    unsafe { ptr::write_bytes(state_ptr as *mut u8, 0, size_of::<StrokeState>()) };
    // SAFETY: alignment and allocation size are validated by the adapter contract.
    let state = unsafe { &mut *(state_ptr as *mut StrokeState) };
    let normalized = normalized_amount(amount);
    let time_constant = MAXIMUM_TIME_CONSTANT_MS * normalized * normalized;
    state.magic = STATE_MAGIC;
    state.active = 1;
    state.bypassed = u32::from(normalized == 0.0);
    state.spacing_mode = spacing_mode;
    state.maximum_stamps_per_segment = maximum_stamps_per_segment;
    state.amount = normalized;
    state.time_constant_ms = time_constant;
    state.tail_duration_ms = time_constant;
    state.last_raw_x = x;
    state.last_raw_y = y;
    state.last_filtered_x = x;
    state.last_filtered_y = y;
    state.last_time_ms = time_ms;
    state.seam_x = x;
    state.seam_y = y;
    state.seam_pressure = pressure;
    state.seam_time_ms = time_ms;
    state.committed_x = x;
    state.committed_y = y;
    state.committed_pressure = pressure;
    state.committed_time_ms = time_ms;
    state.spacing_value = if spacing_mode == SPACING_FIXED {
        spacing_value.max(0.1)
    } else {
        spacing_value.max(1.0)
    };
    state.spacing_carry = if spacing_mode == SPACING_FIXED {
        0.0
    } else {
        direct_spacing_distance(state.spacing_value, pressure)
    };
    state.total_dabs = 1;
    state.maximum_tail_count = if normalized == 0.0 { 0 } else { 1 };
    state.curve = CurvePlanner::initial();
    STATUS_OK
}

/// Updates fixed spacing between input batches without resetting its carry.
/// This is the adaptive-spacing boundary used by the interactive renderer.
///
/// # Safety
///
/// `state_ptr` must address a state previously initialized by
/// [`stroke_geometry_begin`] and remain valid for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_geometry_set_fixed_spacing(state_ptr: u32, spacing: f64) -> i32 {
    if state_ptr == 0 || !spacing.is_finite() {
        return STATUS_INVALID_ARGUMENT;
    }
    let state = unsafe { &mut *(state_ptr as *mut StrokeState) };
    if state.magic != STATE_MAGIC || state.active == 0 {
        return STATUS_INACTIVE;
    }
    if state.spacing_mode != SPACING_FIXED {
        return STATUS_INVALID_ARGUMENT;
    }
    state.spacing_value = spacing.max(0.1);
    STATUS_OK
}

/// Processes a batch and writes newly committed dabs, current tail and stats.
///
/// # Safety
///
/// Every pointer must address a correctly aligned allocation in this module's
/// linear memory large enough for its count or capacity. The state, input,
/// dab, tail and summary regions must not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_geometry_process_batch(
    state_ptr: u32,
    input_ptr: u32,
    input_count: u32,
    dab_ptr: u32,
    dab_capacity: u32,
    tail_ptr: u32,
    tail_capacity: u32,
    summary_ptr: u32,
) -> i32 {
    if state_ptr == 0 || input_ptr == 0 || dab_ptr == 0 || tail_ptr == 0 {
        return STATUS_INVALID_ARGUMENT;
    }
    // SAFETY: pointers and non-overlap are guaranteed by the adapter.
    let state = unsafe { &mut *(state_ptr as *mut StrokeState) };
    if state.magic != STATE_MAGIC || state.active == 0 {
        return STATUS_INACTIVE;
    }
    let inputs = unsafe {
        slice::from_raw_parts(input_ptr as *const f64, input_count as usize * INPUT_STRIDE)
    };
    let output = unsafe {
        slice::from_raw_parts_mut(dab_ptr as *mut f64, dab_capacity as usize * DAB_STRIDE)
    };
    let tail = unsafe {
        slice::from_raw_parts_mut(tail_ptr as *mut f64, tail_capacity as usize * TAIL_STRIDE)
    };
    let mut writer = DabWriter {
        output,
        capacity: dab_capacity as usize,
        count: 0,
        overflowed: false,
    };

    let mut input_index = 0_usize;
    while input_index < input_count as usize {
        let base = input_index * INPUT_STRIDE;
        let sample = Point {
            x: inputs[base],
            y: inputs[base + 1],
            pressure: inputs[base + 2],
            time_ms: inputs[base + 3],
        };
        if !sample.x.is_finite()
            || !sample.y.is_finite()
            || !sample.pressure.is_finite()
            || !sample.time_ms.is_finite()
        {
            write_summary(
                state,
                summary_ptr,
                STATUS_INVALID_ARGUMENT,
                input_index,
                writer.count,
                0,
                false,
            );
            return STATUS_INVALID_ARGUMENT;
        }
        let normalized_time = sample.time_ms.max(state.last_time_ms);
        if state.bypassed != 0 {
            state.latest_sequence = state.latest_sequence.wrapping_add(1);
            state.last_raw_x = sample.x;
            state.last_raw_y = sample.y;
            state.last_filtered_x = sample.x;
            state.last_filtered_y = sample.y;
            state.last_time_ms = normalized_time;
            feed_point(
                state,
                Point {
                    time_ms: normalized_time,
                    ..sample
                },
                &mut writer,
            );
            input_index += 1;
            continue;
        }

        state.latest_sequence = state.latest_sequence.wrapping_add(1);
        let delta_time_ms = normalized_time - state.last_time_ms;
        let mut next_filtered_x = state.last_filtered_x;
        let mut next_filtered_y = state.last_filtered_y;
        if delta_time_ms > 0.0 {
            let normalized_delta = delta_time_ms / state.time_constant_ms;
            let one_minus_decay = -libm::expm1(-normalized_delta);
            let advance_ms = state.time_constant_ms * linear_input_advance_factor(normalized_delta);
            let velocity_x = (sample.x - state.last_raw_x) / delta_time_ms;
            let velocity_y = (sample.y - state.last_raw_y) / delta_time_ms;
            next_filtered_x = state.last_filtered_x
                + (state.last_raw_x - state.last_filtered_x) * one_minus_decay
                + velocity_x * advance_ms;
            next_filtered_y = state.last_filtered_y
                + (state.last_raw_y - state.last_filtered_y) * one_minus_decay
                + velocity_y * advance_ms;
        }
        if state.count as usize == STABILIZATION_CAPACITY {
            promote_head(state, true, &mut writer);
        }
        let write_index = (state.head as usize + state.count as usize) % STABILIZATION_CAPACITY;
        state.raw_x[write_index] = sample.x;
        state.raw_y[write_index] = sample.y;
        state.filtered_x[write_index] = next_filtered_x;
        state.filtered_y[write_index] = next_filtered_y;
        state.pressure[write_index] = sample.pressure;
        state.time_ms[write_index] = normalized_time;
        state.sequence[write_index] = f64::from(state.latest_sequence);
        state.count += 1;
        state.last_raw_x = sample.x;
        state.last_raw_y = sample.y;
        state.last_filtered_x = next_filtered_x;
        state.last_filtered_y = next_filtered_y;
        state.last_time_ms = normalized_time;

        while state.count > 0
            && normalized_time - state.time_ms[state.head as usize] >= state.tail_duration_ms
        {
            promote_head(state, false, &mut writer);
        }
        state.maximum_tail_count = state.maximum_tail_count.max(state.count + 1);
        input_index += 1;
    }

    state.total_dabs = state.total_dabs.saturating_add(writer.count as u32);
    let tail_count = match write_tail(state, tail, tail_capacity as usize) {
        Ok(count) => count,
        Err(status) => {
            write_summary(
                state,
                summary_ptr,
                status,
                input_index,
                writer.count,
                0,
                false,
            );
            return status;
        }
    };
    let status = if writer.overflowed {
        STATUS_DAB_CAPACITY
    } else {
        STATUS_OK
    };
    write_summary(
        state,
        summary_ptr,
        status,
        input_index,
        writer.count,
        tail_count,
        false,
    );
    status
}

/// Finalizes a state and emits dabs represented by its remaining tail.
///
/// # Safety
///
/// Every pointer must address a correctly aligned allocation in this module's
/// linear memory large enough for its capacity. The state, dab, tail and
/// summary regions must not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_geometry_finish(
    state_ptr: u32,
    dab_ptr: u32,
    dab_capacity: u32,
    tail_ptr: u32,
    tail_capacity: u32,
    summary_ptr: u32,
) -> i32 {
    if state_ptr == 0 || dab_ptr == 0 || tail_ptr == 0 {
        return STATUS_INVALID_ARGUMENT;
    }
    let state = unsafe { &mut *(state_ptr as *mut StrokeState) };
    if state.magic != STATE_MAGIC || state.active == 0 {
        return STATUS_INACTIVE;
    }
    let output = unsafe {
        slice::from_raw_parts_mut(dab_ptr as *mut f64, dab_capacity as usize * DAB_STRIDE)
    };
    let tail = unsafe {
        slice::from_raw_parts_mut(tail_ptr as *mut f64, tail_capacity as usize * TAIL_STRIDE)
    };
    let mut writer = DabWriter {
        output,
        capacity: dab_capacity as usize,
        count: 0,
        overflowed: false,
    };
    let tail_count = match write_tail(state, tail, tail_capacity as usize) {
        Ok(count) => count,
        Err(status) => {
            write_summary(state, summary_ptr, status, 0, 0, 0, true);
            return status;
        }
    };
    if state.bypassed == 0 {
        let mut offset = 1_usize;
        while offset < tail_count {
            let values = tail_values(state, offset);
            feed_point(
                state,
                Point {
                    x: values[0],
                    y: values[1],
                    pressure: values[2],
                    time_ms: values[3],
                },
                &mut writer,
            );
            offset += 1;
        }
    }
    state.total_dabs = state.total_dabs.saturating_add(writer.count as u32);
    state.active = 0;
    let status = if writer.overflowed {
        STATUS_DAB_CAPACITY
    } else {
        STATUS_OK
    };
    write_summary(
        state,
        summary_ptr,
        status,
        0,
        writer.count,
        tail_count,
        true,
    );
    status
}

/// Copies a complete state into a distinct caller-owned state allocation.
///
/// # Safety
///
/// Both pointers must address correctly aligned allocations of at least
/// [`stroke_geometry_state_bytes`] bytes and the two regions must not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_geometry_copy_state(destination_ptr: u32, source_ptr: u32) -> i32 {
    if destination_ptr == 0 || source_ptr == 0 || destination_ptr == source_ptr {
        return STATUS_INVALID_ARGUMENT;
    }
    let source = unsafe { &*(source_ptr as *const StrokeState) };
    if source.magic != STATE_MAGIC {
        return STATUS_INVALID_ARGUMENT;
    }
    unsafe {
        ptr::copy_nonoverlapping(
            source_ptr as *const u8,
            destination_ptr as *mut u8,
            size_of::<StrokeState>(),
        )
    };
    STATUS_OK
}
