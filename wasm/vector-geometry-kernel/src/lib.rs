use std::alloc::{Layout, alloc, dealloc};
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::mem;
use std::slice;
use std::sync::Arc;

use clipper2_rust::{
    ClipType, Clipper64, EndType, FillRule, JoinType, Path64, Paths64, Point64, PolyTree64,
    inflate_paths_64,
};

const ABI_VERSION: u32 = 1;
const MAXIMUM_SUBDIVISION_DEPTH: u32 = 24;
const MITER_LIMIT: f64 = 4.0;
const METADATA_LENGTH: usize = 9;

const STATUS_OK: i32 = 0;
const STATUS_EMPTY: i32 = 1;
const STATUS_INVALID_ARGUMENT: i32 = -1;
const STATUS_GEOMETRY_FAILED: i32 = -2;
const STATUS_TRIANGULATION_FAILED: i32 = -3;
const MAXIMUM_VERB_COUNT: usize = 5_000_000;
const MAXIMUM_COORDINATE_COUNT: usize = 30_000_000;
const CANONICAL_CACHE_MAXIMUM_ENTRIES: usize = 32;
const CANONICAL_CACHE_MAXIMUM_BYTES: usize = 32 * 1024 * 1024;
const REGISTERED_PATH_MAXIMUM_BYTES: usize = 32 * 1024 * 1024;
const REGISTERED_PATHS_MAXIMUM_BYTES: usize = 32 * 1024 * 1024;
// The application works many orders of magnitude below this bound. Keeping a
// finite fixed-point envelope also proves the i128 area/cross accumulators
// cannot overflow at the public input limits.
const MAXIMUM_FIXED_COORDINATE: f64 = 100_000_000_000_000.0;

#[derive(Clone, Copy)]
struct PointD {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy)]
struct Quad {
    p0: PointD,
    p1: PointD,
    p2: PointD,
}

#[derive(Clone)]
struct PolygonGroup {
    outer: Path64,
    holes: Vec<Path64>,
}

#[derive(Clone)]
struct PolygonSet {
    groups: Vec<PolygonGroup>,
    paths: Paths64,
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

struct KernelOutput {
    vertices: Vec<f32>,
    indices: Vec<u32>,
    metadata: [f64; METADATA_LENGTH],
    error: Vec<u8>,
}

struct RegisteredPath {
    fill_rule: FillRule,
    verbs: Arc<[u8]>,
    coords: Arc<[f64]>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct CanonicalCacheKey {
    handle: u32,
    lod_bucket: u64,
    bucket_scale: u64,
    cubic_tolerance: u64,
    flatten_tolerance: u64,
    arc_sagitta_tolerance: u64,
    integer_scale: u64,
    outline_radius: u64,
}

struct CanonicalCacheEntry {
    key: CanonicalCacheKey,
    value: Arc<PolygonSet>,
    retained_bytes: usize,
}

struct KernelState {
    paths: HashMap<u32, RegisteredPath>,
    registered_path_bytes: usize,
    canonical_cache: VecDeque<CanonicalCacheEntry>,
    canonical_cache_bytes: usize,
    cache_hits: u32,
    cache_misses: u32,
    cache_evictions: u32,
}

impl KernelState {
    fn new() -> Self {
        Self {
            paths: HashMap::new(),
            registered_path_bytes: 0,
            canonical_cache: VecDeque::new(),
            canonical_cache_bytes: 0,
            cache_hits: 0,
            cache_misses: 0,
            cache_evictions: 0,
        }
    }

    fn release_path(&mut self, handle: u32) {
        if let Some(path) = self.paths.remove(&handle) {
            self.registered_path_bytes = self.registered_path_bytes.saturating_sub(
                path.verbs
                    .len()
                    .saturating_add(path.coords.len().saturating_mul(size_of::<f64>())),
            );
        }
        let mut retained = VecDeque::with_capacity(self.canonical_cache.len());
        while let Some(entry) = self.canonical_cache.pop_front() {
            if entry.key.handle == handle {
                self.canonical_cache_bytes = self
                    .canonical_cache_bytes
                    .saturating_sub(entry.retained_bytes);
            } else {
                retained.push_back(entry);
            }
        }
        self.canonical_cache = retained;
    }
}

impl KernelOutput {
    fn new() -> Self {
        Self {
            vertices: Vec::new(),
            indices: Vec::new(),
            metadata: [0.0; METADATA_LENGTH],
            error: Vec::new(),
        }
    }

    fn reset(&mut self) {
        self.vertices.clear();
        self.indices.clear();
        self.metadata.fill(0.0);
        self.error.clear();
    }

    fn fail(&mut self, message: &str) {
        self.vertices.clear();
        self.indices.clear();
        self.metadata.fill(0.0);
        self.error.clear();
        self.error.extend_from_slice(message.as_bytes());
    }
}

thread_local! {
    static OUTPUT: RefCell<KernelOutput> = RefCell::new(KernelOutput::new());
    static STATE: RefCell<KernelState> = RefCell::new(KernelState::new());
}

#[inline]
fn midpoint(first: PointD, second: PointD) -> PointD {
    PointD {
        x: (first.x + second.x) * 0.5,
        y: (first.y + second.y) * 0.5,
    }
}

#[inline]
fn subtract(first: PointD, second: PointD) -> PointD {
    PointD {
        x: first.x - second.x,
        y: first.y - second.y,
    }
}

#[inline]
fn same_point(first: PointD, second: PointD) -> bool {
    let scale = 1.0_f64
        .max(first.x.abs())
        .max(first.y.abs())
        .max(second.x.abs())
        .max(second.y.abs());
    (first.x - second.x).abs() <= f64::EPSILON * 64.0 * scale
        && (first.y - second.y).abs() <= f64::EPSILON * 64.0 * scale
}

#[inline]
fn line_as_quadratic(start: PointD, end: PointD) -> Quad {
    Quad {
        p0: start,
        p1: midpoint(start, end),
        p2: end,
    }
}

fn cubic_to_quadratics(
    p0: PointD,
    p1: PointD,
    p2: PointD,
    p3: PointD,
    maximum_error: f64,
    depth: u32,
    output: &mut Vec<Quad>,
) -> Result<(), &'static str> {
    let dx = p3.x - 3.0 * p2.x + 3.0 * p1.x - p0.x;
    let dy = p3.y - 3.0 * p2.y + 3.0 * p1.y - p0.y;
    let error_bound = dx.hypot(dy) / 6.0;
    if error_bound <= maximum_error.max(f64::EPSILON) {
        output.push(Quad {
            p0,
            p1: PointD {
                x: (3.0 * (p1.x + p2.x) - p0.x - p3.x) * 0.25,
                y: (3.0 * (p1.y + p2.y) - p0.y - p3.y) * 0.25,
            },
            p2: p3,
        });
        return Ok(());
    }
    if depth >= MAXIMUM_SUBDIVISION_DEPTH {
        return Err("Cubic approximation exceeded its subdivision limit.");
    }
    let p01 = midpoint(p0, p1);
    let p12 = midpoint(p1, p2);
    let p23 = midpoint(p2, p3);
    let p012 = midpoint(p01, p12);
    let p123 = midpoint(p12, p23);
    let middle = midpoint(p012, p123);
    cubic_to_quadratics(p0, p01, p012, middle, maximum_error, depth + 1, output)?;
    cubic_to_quadratics(middle, p123, p23, p3, maximum_error, depth + 1, output)
}

#[inline]
fn direction_within(vector: PointD, reference: PointD, tolerance: f64) -> bool {
    let vector_length = vector.x.hypot(vector.y);
    let reference_length = reference.x.hypot(reference.y);
    if vector_length <= f64::EPSILON && reference_length <= f64::EPSILON {
        return true;
    }
    if vector_length <= f64::EPSILON || reference_length <= f64::EPSILON {
        return false;
    }
    let cosine =
        (vector.x * reference.x + vector.y * reference.y) / (vector_length * reference_length);
    cosine >= tolerance.cos()
}

fn append_distinct_point(output: &mut Vec<PointD>, value: PointD) {
    if output
        .last()
        .is_some_and(|previous| previous.x == value.x && previous.y == value.y)
    {
        return;
    }
    output.push(value);
}

fn flatten_quadratic(
    curve: Quad,
    maximum_position_error: f64,
    maximum_tangent_error: f64,
    depth: u32,
    output: &mut Vec<PointD>,
) -> Result<(), &'static str> {
    let ddx = curve.p0.x - 2.0 * curve.p1.x + curve.p2.x;
    let ddy = curve.p0.y - 2.0 * curve.p1.y + curve.p2.y;
    let position_bound = ddx.hypot(ddy) * 0.25;
    let chord = subtract(curve.p2, curve.p0);
    let start_tangent = subtract(curve.p1, curve.p0);
    let end_tangent = subtract(curve.p2, curve.p1);
    let control_hull_length =
        start_tangent.x.hypot(start_tangent.y) + end_tangent.x.hypot(end_tangent.y);
    let degenerate = control_hull_length <= f64::EPSILON * 64.0;
    let tangents_acceptable = degenerate
        || (direction_within(start_tangent, chord, maximum_tangent_error)
            && direction_within(end_tangent, chord, maximum_tangent_error));
    if position_bound <= maximum_position_error && tangents_acceptable {
        append_distinct_point(output, curve.p2);
        return Ok(());
    }
    if depth >= MAXIMUM_SUBDIVISION_DEPTH {
        return Err("Quadratic flattening exceeded its subdivision limit.");
    }
    let p01 = midpoint(curve.p0, curve.p1);
    let p12 = midpoint(curve.p1, curve.p2);
    let middle = midpoint(p01, p12);
    flatten_quadratic(
        Quad {
            p0: curve.p0,
            p1: p01,
            p2: middle,
        },
        maximum_position_error,
        maximum_tangent_error,
        depth + 1,
        output,
    )?;
    flatten_quadratic(
        Quad {
            p0: middle,
            p1: p12,
            p2: curve.p2,
        },
        maximum_position_error,
        maximum_tangent_error,
        depth + 1,
        output,
    )
}

#[inline]
fn js_round_to_i64(value: f64) -> Result<i64, &'static str> {
    if !value.is_finite() {
        return Err("Vector geometry contains a non-finite coordinate.");
    }
    let rounded = (value + 0.5).floor();
    if !(-MAXIMUM_FIXED_COORDINATE..=MAXIMUM_FIXED_COORDINATE).contains(&rounded) {
        return Err("Vector fixed-point coordinate exceeds the supported kernel range.");
    }
    Ok(rounded as i64)
}

fn path_to_quadratic_contours(
    verbs: &[u8],
    coords: &[f64],
    cubic_tolerance: f64,
) -> Result<Vec<Vec<Quad>>, &'static str> {
    if coords.iter().any(|value| !value.is_finite()) {
        return Err("Vector geometry contains a non-finite coordinate.");
    }
    let coordinate_counts = [2_usize, 2, 4, 6, 0];
    let mut contours = Vec::<Vec<Quad>>::new();
    let mut coordinate_offset = 0_usize;
    let mut curves: Option<Vec<Quad>> = None;
    let mut current: Option<PointD> = None;
    let mut start: Option<PointD> = None;

    let finish = |contours: &mut Vec<Vec<Quad>>,
                  curves: &mut Option<Vec<Quad>>,
                  current: &mut Option<PointD>,
                  start: &mut Option<PointD>| {
        if let (Some(values), Some(current_value), Some(start_value)) =
            (curves.as_mut(), *current, *start)
        {
            if !same_point(current_value, start_value) {
                values.push(line_as_quadratic(current_value, start_value));
            }
            if !values.is_empty() {
                contours.push(mem::take(values));
            }
        }
        *curves = None;
        *current = None;
        *start = None;
    };

    for raw_verb in verbs {
        let verb = *raw_verb as usize;
        if verb >= coordinate_counts.len() {
            return Err("Vector path contains an invalid verb.");
        }
        let coordinate_count = coordinate_counts[verb];
        if coordinate_offset + coordinate_count > coords.len() {
            return Err("Vector path has too few coordinates for a verb.");
        }
        if verb == 0 {
            finish(&mut contours, &mut curves, &mut current, &mut start);
            let moved = PointD {
                x: coords[coordinate_offset],
                y: coords[coordinate_offset + 1],
            };
            if !moved.x.is_finite() || !moved.y.is_finite() {
                return Err("Vector geometry contains a non-finite coordinate.");
            }
            coordinate_offset += 2;
            curves = Some(Vec::new());
            current = Some(moved);
            start = Some(moved);
            continue;
        }
        if verb == 4 {
            finish(&mut contours, &mut curves, &mut current, &mut start);
            continue;
        }
        let Some(current_value) = current else {
            return Err("Vector path does not begin with MOVE.");
        };
        let Some(values) = curves.as_mut() else {
            return Err("Vector path does not begin with MOVE.");
        };
        if verb == 1 {
            let end = PointD {
                x: coords[coordinate_offset],
                y: coords[coordinate_offset + 1],
            };
            coordinate_offset += 2;
            if !same_point(current_value, end) {
                values.push(line_as_quadratic(current_value, end));
            }
            current = Some(end);
            continue;
        }
        if verb == 2 {
            let control = PointD {
                x: coords[coordinate_offset],
                y: coords[coordinate_offset + 1],
            };
            let end = PointD {
                x: coords[coordinate_offset + 2],
                y: coords[coordinate_offset + 3],
            };
            coordinate_offset += 4;
            if !same_point(current_value, control) || !same_point(control, end) {
                values.push(Quad {
                    p0: current_value,
                    p1: control,
                    p2: end,
                });
            }
            current = Some(end);
            continue;
        }
        let first_control = PointD {
            x: coords[coordinate_offset],
            y: coords[coordinate_offset + 1],
        };
        let second_control = PointD {
            x: coords[coordinate_offset + 2],
            y: coords[coordinate_offset + 3],
        };
        let end = PointD {
            x: coords[coordinate_offset + 4],
            y: coords[coordinate_offset + 5],
        };
        coordinate_offset += 6;
        if !same_point(current_value, first_control)
            || !same_point(first_control, second_control)
            || !same_point(second_control, end)
        {
            cubic_to_quadratics(
                current_value,
                first_control,
                second_control,
                end,
                cubic_tolerance,
                0,
                values,
            )?;
        }
        current = Some(end);
    }
    finish(&mut contours, &mut curves, &mut current, &mut start);
    if coordinate_offset != coords.len() {
        return Err("Vector path has an inconsistent coordinate count.");
    }
    Ok(contours)
}

fn exact_area_sign(path: &Path64) -> i8 {
    let mut twice_area = 0_i128;
    for index in 0..path.len() {
        let current = path[index];
        let next = path[(index + 1) % path.len()];
        twice_area += current.x as i128 * next.y as i128 - next.x as i128 * current.y as i128;
    }
    twice_area.signum() as i8
}

fn remove_duplicate_points(path: &Path64) -> Path64 {
    let mut cleaned = Path64::new();
    for value in path {
        if cleaned
            .last()
            .is_none_or(|previous| previous.x != value.x || previous.y != value.y)
        {
            cleaned.push(*value);
        }
    }
    if cleaned.len() > 1
        && cleaned.first().is_some_and(|first| {
            cleaned
                .last()
                .is_some_and(|last| first.x == last.x && first.y == last.y)
        })
    {
        cleaned.pop();
    }
    cleaned
}

fn normalized_ring(path: &Path64, hole: bool) -> Option<Path64> {
    let mut cleaned = remove_duplicate_points(path);
    if cleaned.len() < 3 {
        return None;
    }
    let sign = exact_area_sign(&cleaned);
    if sign == 0 {
        return None;
    }
    let wanted_sign = if hole { -1 } else { 1 };
    if sign != wanted_sign {
        cleaned.reverse();
    }
    let mut first_index = 0_usize;
    for index in 1..cleaned.len() {
        let value = cleaned[index];
        let first = cleaned[first_index];
        if value.y < first.y || (value.y == first.y && value.x < first.x) {
            first_index = index;
        }
    }
    cleaned.rotate_left(first_index);
    Some(cleaned)
}

fn ring_bounds_and_area(path: &Path64) -> (i64, i64, i64, i64, i128) {
    let mut left = i64::MAX;
    let mut top = i64::MAX;
    let mut right = i64::MIN;
    let mut bottom = i64::MIN;
    let mut twice_area = 0_i128;
    for index in 0..path.len() {
        let value = path[index];
        let next = path[(index + 1) % path.len()];
        left = left.min(value.x);
        top = top.min(value.y);
        right = right.max(value.x);
        bottom = bottom.max(value.y);
        twice_area += value.x as i128 * next.y as i128 - next.x as i128 * value.y as i128;
    }
    (left, top, right, bottom, twice_area.abs())
}

fn compare_rings(first: &Path64, second: &Path64) -> Ordering {
    let a = ring_bounds_and_area(first);
    let b = ring_bounds_and_area(second);
    a.1.cmp(&b.1)
        .then(a.0.cmp(&b.0))
        .then(a.3.cmp(&b.3))
        .then(a.2.cmp(&b.2))
        .then(b.4.cmp(&a.4))
        .then(first.len().cmp(&second.len()))
        .then_with(|| {
            for index in 0..first.len().min(second.len()) {
                let ordering = first[index]
                    .y
                    .cmp(&second[index].y)
                    .then(first[index].x.cmp(&second[index].x));
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            Ordering::Equal
        })
}

fn canonical_set_from_tree(tree: &PolyTree64) -> PolygonSet {
    fn visit_outer(tree: &PolyTree64, node_index: usize, groups: &mut Vec<PolygonGroup>) {
        let node = &tree.nodes[node_index];
        if tree.is_hole(node_index) || node.polygon().is_empty() {
            for child in node.children() {
                visit_outer(tree, *child, groups);
            }
            return;
        }
        let Some(outer) = normalized_ring(node.polygon(), false) else {
            return;
        };
        let mut holes = Vec::new();
        for child_index in node.children() {
            let child = &tree.nodes[*child_index];
            if tree.is_hole(*child_index) && !child.polygon().is_empty() {
                if let Some(hole) = normalized_ring(child.polygon(), true) {
                    holes.push(hole);
                }
                for island_index in child.children() {
                    visit_outer(tree, *island_index, groups);
                }
            } else {
                visit_outer(tree, *child_index, groups);
            }
        }
        holes.sort_by(compare_rings);
        groups.push(PolygonGroup { outer, holes });
    }

    let mut groups = Vec::new();
    for child_index in tree.root().children() {
        visit_outer(tree, *child_index, &mut groups);
    }
    groups.sort_by(|first, second| compare_rings(&first.outer, &second.outer));
    let mut paths = Paths64::new();
    let mut left = i64::MAX;
    let mut top = i64::MAX;
    let mut right = i64::MIN;
    let mut bottom = i64::MIN;
    for group in &groups {
        for ring in std::iter::once(&group.outer).chain(group.holes.iter()) {
            paths.push(ring.clone());
            for value in ring {
                left = left.min(value.x);
                top = top.min(value.y);
                right = right.max(value.x);
                bottom = bottom.max(value.y);
            }
        }
    }
    if paths.is_empty() {
        left = 0;
        top = 0;
        right = 0;
        bottom = 0;
    }
    PolygonSet {
        groups,
        paths,
        left,
        top,
        right,
        bottom,
    }
}

fn execute_clipper(
    subject: &Paths64,
    operation: ClipType,
    clip: &Paths64,
    fill_rule: FillRule,
) -> Result<PolyTree64, &'static str> {
    let mut engine = Clipper64::new();
    engine.set_preserve_collinear(false);
    engine.set_reverse_solution(false);
    engine.add_subject(subject);
    if !clip.is_empty() {
        engine.add_clip(clip);
    }
    let mut tree = PolyTree64::new();
    let mut open = Paths64::new();
    if !engine.execute_tree(operation, fill_rule, &mut tree, &mut open) {
        return Err("Vector polygon operation did not complete.");
    }
    Ok(tree)
}

fn canonical_set_from_paths(
    paths: &Paths64,
    fill_rule: FillRule,
) -> Result<PolygonSet, &'static str> {
    Ok(canonical_set_from_tree(&execute_clipper(
        paths,
        ClipType::Union,
        &Paths64::new(),
        fill_rule,
    )?))
}

fn boolean_set(
    subject: &Paths64,
    operation: ClipType,
    clip: &Paths64,
) -> Result<PolygonSet, &'static str> {
    Ok(canonical_set_from_tree(&execute_clipper(
        subject,
        operation,
        clip,
        FillRule::NonZero,
    )?))
}

fn canonicalize_path(
    verbs: &[u8],
    coords: &[f64],
    fill_rule: FillRule,
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    integer_scale: f64,
    outline_radius: f64,
) -> Result<PolygonSet, &'static str> {
    let tangent_tolerance = 0.1_f64
        .min((1.0 - (flatten_tolerance / outline_radius.max(flatten_tolerance)).min(1.0)).acos());
    let contours = path_to_quadratic_contours(verbs, coords, cubic_tolerance)?;
    let mut paths = Paths64::new();
    for contour in contours {
        if contour.is_empty() {
            continue;
        }
        let mut flattened = vec![contour[0].p0];
        for curve in contour {
            flatten_quadratic(
                curve,
                flatten_tolerance,
                tangent_tolerance,
                0,
                &mut flattened,
            )?;
        }
        let mut quantized = Path64::with_capacity(flattened.len());
        for value in flattened {
            quantized.push(Point64::new(
                js_round_to_i64(value.x * integer_scale)?,
                js_round_to_i64(value.y * integer_scale)?,
            ));
        }
        let quantized = remove_duplicate_points(&quantized);
        if quantized.len() >= 3 {
            paths.push(quantized);
        }
    }
    canonical_set_from_paths(&paths, fill_rule)
}

fn push_positive_piece(pieces: &mut Paths64, piece: Path64) {
    let mut cleaned = remove_duplicate_points(&piece);
    let sign = exact_area_sign(&cleaned);
    if cleaned.len() < 3 || sign == 0 {
        return;
    }
    if sign < 0 {
        cleaned.reverse();
    }
    pieces.push(cleaned);
}

fn right_offset(
    value: Point64,
    edge_x: i64,
    edge_y: i64,
    radius: f64,
) -> Result<Point64, &'static str> {
    let length = (edge_x as f64).hypot(edge_y as f64);
    if length <= 0.0 {
        return Err("Canonical vector contour contains a zero-length edge.");
    }
    Ok(Point64::new(
        js_round_to_i64(value.x as f64 + edge_y as f64 / length * radius)?,
        js_round_to_i64(value.y as f64 - edge_x as f64 / length * radius)?,
    ))
}

fn line_intersection(p: PointD, r: PointD, q: PointD, s: PointD) -> Option<PointD> {
    let denominator = r.x * s.y - r.y * s.x;
    let scale = r.x.hypot(r.y) * s.x.hypot(s.y);
    if denominator.abs() <= f64::EPSILON * 32.0 * scale.max(1.0) {
        return None;
    }
    let qmp = PointD {
        x: q.x - p.x,
        y: q.y - p.y,
    };
    let t = (qmp.x * s.y - qmp.y * s.x) / denominator;
    Some(PointD {
        x: p.x + t * r.x,
        y: p.y + t * r.y,
    })
}

fn expanded_set(
    canonical_fill: &PolygonSet,
    radius: f64,
    join_code: u32,
    arc_tolerance: f64,
) -> Result<PolygonSet, &'static str> {
    if radius <= 0.0 {
        return Err("Vector expansion requires a positive radius.");
    }
    if join_code == 0 || join_code == 1 {
        let join = if join_code == 0 {
            JoinType::Round
        } else {
            JoinType::Bevel
        };
        let expanded = inflate_paths_64(
            &canonical_fill.paths,
            radius,
            join,
            EndType::Polygon,
            MITER_LIMIT,
            arc_tolerance,
        );
        return canonical_set_from_paths(&expanded, FillRule::NonZero);
    }

    let mut pieces = canonical_fill.paths.clone();
    for ring in &canonical_fill.paths {
        let count = ring.len();
        if count < 3 {
            continue;
        }
        let mut edge_x = vec![0_i64; count];
        let mut edge_y = vec![0_i64; count];
        for index in 0..count {
            let start = ring[index];
            let end = ring[(index + 1) % count];
            let x = end.x - start.x;
            let y = end.y - start.y;
            if x == 0 && y == 0 {
                return Err("Canonical vector contour contains duplicate points.");
            }
            edge_x[index] = x;
            edge_y[index] = y;
            push_positive_piece(
                &mut pieces,
                vec![
                    start,
                    right_offset(start, x, y, radius)?,
                    right_offset(end, x, y, radius)?,
                    end,
                ],
            );
        }
        for index in 0..count {
            let value = ring[index];
            let previous = (index + count - 1) % count;
            let incoming_x = edge_x[previous];
            let incoming_y = edge_y[previous];
            let outgoing_x = edge_x[index];
            let outgoing_y = edge_y[index];
            let turn =
                incoming_x as i128 * outgoing_y as i128 - incoming_y as i128 * outgoing_x as i128;
            if turn <= 0 {
                continue;
            }
            let first_offset = right_offset(value, incoming_x, incoming_y, radius)?;
            let second_offset = right_offset(value, outgoing_x, outgoing_y, radius)?;
            let intersection = line_intersection(
                PointD {
                    x: first_offset.x as f64,
                    y: first_offset.y as f64,
                },
                PointD {
                    x: incoming_x as f64,
                    y: incoming_y as f64,
                },
                PointD {
                    x: second_offset.x as f64,
                    y: second_offset.y as f64,
                },
                PointD {
                    x: outgoing_x as f64,
                    y: outgoing_y as f64,
                },
            );
            if let Some(corner) = intersection.filter(|corner| {
                (corner.x - value.x as f64).hypot(corner.y - value.y as f64) <= radius * MITER_LIMIT
            }) {
                let corner_x = js_round_to_i64(corner.x)?;
                let corner_y = js_round_to_i64(corner.y)?;
                push_positive_piece(
                    &mut pieces,
                    vec![
                        value,
                        first_offset,
                        Point64::new(corner_x, corner_y),
                        second_offset,
                    ],
                );
            } else {
                push_positive_piece(&mut pieces, vec![value, first_offset, second_offset]);
            }
        }
    }
    canonical_set_from_paths(&pieces, FillRule::NonZero)
}

fn outside_outline(
    canonical_fill: &PolygonSet,
    width: f64,
    join_code: u32,
    arc_tolerance: f64,
    inner_overlap: f64,
) -> Result<Option<PolygonSet>, &'static str> {
    if width <= 0.0 {
        return Ok(None);
    }
    let expanded = expanded_set(canonical_fill, width, join_code, arc_tolerance)?;
    let contracted = if inner_overlap > 0.0 {
        inflate_paths_64(
            &canonical_fill.paths,
            -inner_overlap,
            JoinType::Miter,
            EndType::Polygon,
            MITER_LIMIT,
            arc_tolerance,
        )
    } else {
        canonical_fill.paths.clone()
    };
    if contracted.is_empty() {
        return Ok(Some(expanded));
    }
    Ok(Some(boolean_set(
        &expanded.paths,
        ClipType::Difference,
        &contracted,
    )?))
}

#[inline]
fn exact_cross_sign(first_x: i64, first_y: i64, second_x: i64, second_y: i64) -> i8 {
    let value = first_x as i128 * second_y as i128 - first_y as i128 * second_x as i128;
    value.signum() as i8
}

fn block_set(
    canonical_fill: &PolygonSet,
    vector_x: i64,
    vector_y: i64,
) -> Result<PolygonSet, &'static str> {
    if vector_x == 0 && vector_y == 0 {
        return Ok(canonical_fill.clone());
    }
    let mut pieces = canonical_fill.paths.clone();
    for ring in &canonical_fill.paths {
        for index in 0..ring.len() {
            let start = ring[index];
            let end = ring[(index + 1) % ring.len()];
            let edge_x = end.x - start.x;
            let edge_y = end.y - start.y;
            if exact_cross_sign(vector_x, vector_y, edge_x, edge_y) <= 0 {
                continue;
            }
            push_positive_piece(
                &mut pieces,
                vec![
                    start,
                    Point64::new(start.x + vector_x, start.y + vector_y),
                    Point64::new(end.x + vector_x, end.y + vector_y),
                    end,
                ],
            );
        }
    }
    canonical_set_from_paths(&pieces, FillRule::NonZero)
}

fn visible_block_set(
    canonical_fill: &PolygonSet,
    vector_x: i64,
    vector_y: i64,
    inner_overlap: f64,
) -> Result<PolygonSet, &'static str> {
    if vector_x == 0 && vector_y == 0 {
        return Ok(canonical_fill.clone());
    }
    let mut pieces: Paths64 = canonical_fill
        .paths
        .iter()
        .map(|ring| {
            ring.iter()
                .map(|value| Point64::new(value.x + vector_x, value.y + vector_y))
                .collect()
        })
        .collect();
    let mut overlap_pieces = Paths64::new();
    for ring in &canonical_fill.paths {
        for index in 0..ring.len() {
            let start = ring[index];
            let end = ring[(index + 1) % ring.len()];
            let edge_x = end.x - start.x;
            let edge_y = end.y - start.y;
            if exact_cross_sign(vector_x, vector_y, edge_x, edge_y) <= 0 {
                continue;
            }
            push_positive_piece(
                &mut pieces,
                vec![
                    start,
                    Point64::new(start.x + vector_x, start.y + vector_y),
                    Point64::new(end.x + vector_x, end.y + vector_y),
                    end,
                ],
            );
            if inner_overlap > 0.0 {
                let inner_start = right_offset(start, edge_x, edge_y, -inner_overlap)?;
                let inner_end = right_offset(end, edge_x, edge_y, -inner_overlap)?;
                push_positive_piece(
                    &mut overlap_pieces,
                    vec![inner_start, start, end, inner_end],
                );
            }
        }
    }
    let visible = canonical_set_from_paths(&pieces, FillRule::NonZero)?;
    if overlap_pieces.is_empty() {
        return Ok(visible);
    }
    let hidden_overlap = boolean_set(
        &overlap_pieces,
        ClipType::Intersection,
        &canonical_fill.paths,
    )?;
    let combined: Paths64 = visible
        .paths
        .iter()
        .chain(hidden_overlap.paths.iter())
        .cloned()
        .collect();
    canonical_set_from_paths(&combined, FillRule::NonZero)
}

fn triangulate(
    set: PolygonSet,
    integer_scale: f64,
    lod_bucket: f64,
) -> Result<KernelOutput, &'static str> {
    let mut absolute_vertices = Vec::<f64>::new();
    let mut indices = Vec::<u32>::new();
    for group in &set.groups {
        let mut flat = Vec::<f64>::new();
        let mut hole_indices = Vec::<usize>::new();
        for value in &group.outer {
            flat.push(value.x as f64 / integer_scale);
            flat.push(value.y as f64 / integer_scale);
        }
        for hole in &group.holes {
            hole_indices.push(flat.len() / 2);
            for value in hole {
                flat.push(value.x as f64 / integer_scale);
                flat.push(value.y as f64 / integer_scale);
            }
        }
        let local_indices =
            earcutr::earcut(&flat, &hole_indices, 2).map_err(|_| "Vector triangulation failed.")?;
        let deviation = earcutr::deviation(&flat, &hole_indices, 2, &local_indices);
        if !deviation.is_finite() || deviation > 1e-8 {
            return Err("Vector triangulation exceeded the accepted area deviation.");
        }
        let base = absolute_vertices.len() / 2;
        if base > u32::MAX as usize || base + flat.len() / 2 > u32::MAX as usize {
            return Err("Vector mesh exceeds the 32-bit index limit.");
        }
        absolute_vertices.extend(flat);
        indices.extend(local_indices.into_iter().map(|index| (base + index) as u32));
    }
    let absolute_left = set.left as f64 / integer_scale;
    let absolute_top = set.top as f64 / integer_scale;
    let absolute_right = set.right as f64 / integer_scale;
    let absolute_bottom = set.bottom as f64 / integer_scale;
    let origin_x = (absolute_left + absolute_right) * 0.5;
    let origin_y = (absolute_top + absolute_bottom) * 0.5;
    let mut vertices = Vec::<f32>::with_capacity(absolute_vertices.len());
    for pair in absolute_vertices.chunks_exact(2) {
        vertices.push((pair[0] - origin_x) as f32);
        vertices.push((pair[1] - origin_y) as f32);
    }
    Ok(KernelOutput {
        vertices,
        indices,
        metadata: [
            absolute_left - origin_x,
            absolute_top - origin_y,
            absolute_right - origin_x,
            absolute_bottom - origin_y,
            origin_x,
            origin_y,
            lod_bucket,
            integer_scale,
            set.paths.iter().map(Vec::len).sum::<usize>() as f64,
        ],
        error: Vec::new(),
    })
}

#[allow(clippy::too_many_arguments)]
fn validate_compile_options(
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    lod_bucket: f64,
    bucket_scale: f64,
    effect_kind: u32,
    effect_x: f64,
    effect_y: f64,
    effect_width: f64,
    join_code: u32,
) -> Result<(), &'static str> {
    if !cubic_tolerance.is_finite()
        || cubic_tolerance <= 0.0
        || !flatten_tolerance.is_finite()
        || flatten_tolerance <= 0.0
        || !arc_sagitta_tolerance.is_finite()
        || arc_sagitta_tolerance <= 0.0
        || !integer_scale.is_finite()
        || integer_scale < 1.0
        || !lod_bucket.is_finite()
        || !bucket_scale.is_finite()
        || bucket_scale <= 0.0
        || !effect_x.is_finite()
        || !effect_y.is_finite()
        || !effect_width.is_finite()
        || effect_kind > 4
        || join_code > 2
    {
        return Err("Vector geometry kernel received invalid options.");
    }
    Ok(())
}

#[inline]
fn outline_radius(effect_kind: u32, effect_width: f64) -> f64 {
    if effect_kind == 1 || effect_kind == 2 || effect_kind == 4 {
        effect_width
    } else {
        0.0
    }
}

#[allow(clippy::too_many_arguments)]
fn compile_canonical(
    canonical_fill: &PolygonSet,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    lod_bucket: f64,
    bucket_scale: f64,
    effect_kind: u32,
    effect_x: f64,
    effect_y: f64,
    effect_width: f64,
    join_code: u32,
) -> Result<Option<KernelOutput>, &'static str> {
    if (effect_kind == 1 || effect_kind == 2 || effect_kind == 4) && effect_width <= 0.0 {
        return Ok(None);
    }
    let outline_radius = outline_radius(effect_kind, effect_width);
    let arc_tolerance = js_round_to_i64(arc_sagitta_tolerance * integer_scale)?.max(1) as f64;
    let outline_inner_overlap = if outline_radius > 0.0 {
        let radius_limit = js_round_to_i64(outline_radius * integer_scale)?;
        let sample_overlap = js_round_to_i64(1.0 / bucket_scale * integer_scale)?;
        radius_limit.min(sample_overlap).max(1) as f64
    } else {
        0.0
    };
    let result = match effect_kind {
        0 => canonical_fill.clone(),
        1 => match outside_outline(
            canonical_fill,
            js_round_to_i64(effect_width * integer_scale)? as f64,
            join_code,
            arc_tolerance,
            outline_inner_overlap,
        )? {
            Some(value) => value,
            None => return Ok(None),
        },
        2 => expanded_set(
            canonical_fill,
            js_round_to_i64(effect_width * integer_scale)? as f64,
            join_code,
            arc_tolerance,
        )?,
        3 => {
            let vector_x = js_round_to_i64(effect_x * integer_scale)?;
            let vector_y = js_round_to_i64(effect_y * integer_scale)?;
            if vector_x == 0 && vector_y == 0 {
                return Ok(None);
            }
            let overlap = (js_round_to_i64(2.0 / bucket_scale * integer_scale)? as f64).max(1.0);
            visible_block_set(canonical_fill, vector_x, vector_y, overlap)?
        }
        4 => {
            let vector_x = js_round_to_i64(effect_x * integer_scale)?;
            let vector_y = js_round_to_i64(effect_y * integer_scale)?;
            let block = block_set(canonical_fill, vector_x, vector_y)?;
            match outside_outline(
                &block,
                js_round_to_i64(effect_width * integer_scale)? as f64,
                join_code,
                arc_tolerance,
                outline_inner_overlap,
            )? {
                Some(value) => value,
                None => return Ok(None),
            }
        }
        _ => return Err("Vector geometry kernel received an unknown effect."),
    };
    if result.groups.is_empty() {
        return Ok(None);
    }
    triangulate(result, integer_scale, lod_bucket).map(Some)
}

#[allow(clippy::too_many_arguments)]
fn compile(
    verbs: &[u8],
    coords: &[f64],
    fill_rule_code: u32,
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    lod_bucket: f64,
    bucket_scale: f64,
    effect_kind: u32,
    effect_x: f64,
    effect_y: f64,
    effect_width: f64,
    join_code: u32,
) -> Result<Option<KernelOutput>, &'static str> {
    if verbs.is_empty()
        || verbs.len() > MAXIMUM_VERB_COUNT
        || coords.len() > MAXIMUM_COORDINATE_COUNT
    {
        return Err("Vector geometry kernel received invalid options.");
    }
    validate_compile_options(
        cubic_tolerance,
        flatten_tolerance,
        arc_sagitta_tolerance,
        integer_scale,
        lod_bucket,
        bucket_scale,
        effect_kind,
        effect_x,
        effect_y,
        effect_width,
        join_code,
    )?;
    let outline_radius = outline_radius(effect_kind, effect_width);
    let fill_rule = if fill_rule_code == 1 {
        FillRule::EvenOdd
    } else {
        FillRule::NonZero
    };
    let canonical_fill = canonicalize_path(
        verbs,
        coords,
        fill_rule,
        cubic_tolerance,
        flatten_tolerance,
        integer_scale,
        outline_radius,
    )?;
    compile_canonical(
        &canonical_fill,
        arc_sagitta_tolerance,
        integer_scale,
        lod_bucket,
        bucket_scale,
        effect_kind,
        effect_x,
        effect_y,
        effect_width,
        join_code,
    )
}

fn canonical_retained_bytes(value: &PolygonSet) -> usize {
    let point_count = value.paths.iter().map(Vec::len).sum::<usize>();
    point_count
        .saturating_mul(32)
        .saturating_add(value.paths.len().saturating_mul(64))
        .saturating_add(value.groups.len().saturating_mul(64))
}

#[allow(clippy::too_many_arguments)]
fn registered_canonical_fill(
    handle: u32,
    lod_bucket: f64,
    bucket_scale: f64,
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    outline_radius: f64,
) -> Result<Arc<PolygonSet>, &'static str> {
    let key = CanonicalCacheKey {
        handle,
        lod_bucket: lod_bucket.to_bits(),
        bucket_scale: bucket_scale.to_bits(),
        cubic_tolerance: cubic_tolerance.to_bits(),
        flatten_tolerance: flatten_tolerance.to_bits(),
        arc_sagitta_tolerance: arc_sagitta_tolerance.to_bits(),
        integer_scale: integer_scale.to_bits(),
        outline_radius: outline_radius.to_bits(),
    };
    if let Some(value) = STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        let index = state
            .canonical_cache
            .iter()
            .position(|entry| entry.key == key)?;
        let entry = state.canonical_cache.remove(index)?;
        let value = Arc::clone(&entry.value);
        state.canonical_cache.push_back(entry);
        state.cache_hits = state.cache_hits.saturating_add(1);
        Some(value)
    }) {
        return Ok(value);
    }
    let (verbs, coords, fill_rule) = STATE
        .with(|cell| {
            let state = cell.borrow();
            state.paths.get(&handle).map(|path| {
                (
                    Arc::clone(&path.verbs),
                    Arc::clone(&path.coords),
                    path.fill_rule,
                )
            })
        })
        .ok_or("Vector path handle is not registered.")?;
    let value = Arc::new(canonicalize_path(
        &verbs,
        &coords,
        fill_rule,
        cubic_tolerance,
        flatten_tolerance,
        integer_scale,
        outline_radius,
    )?);
    let retained_bytes = canonical_retained_bytes(&value);
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        state.cache_misses = state.cache_misses.saturating_add(1);
        if retained_bytes > CANONICAL_CACHE_MAXIMUM_BYTES {
            return;
        }
        while state.canonical_cache.len() >= CANONICAL_CACHE_MAXIMUM_ENTRIES
            || state.canonical_cache_bytes.saturating_add(retained_bytes)
                > CANONICAL_CACHE_MAXIMUM_BYTES
        {
            let Some(evicted) = state.canonical_cache.pop_front() else {
                break;
            };
            state.canonical_cache_bytes = state
                .canonical_cache_bytes
                .saturating_sub(evicted.retained_bytes);
            state.cache_evictions = state.cache_evictions.saturating_add(1);
        }
        state.canonical_cache_bytes = state.canonical_cache_bytes.saturating_add(retained_bytes);
        state.canonical_cache.push_back(CanonicalCacheEntry {
            key,
            value: Arc::clone(&value),
            retained_bytes,
        });
    });
    Ok(value)
}

#[allow(clippy::too_many_arguments)]
fn compile_registered(
    handle: u32,
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    lod_bucket: f64,
    bucket_scale: f64,
    effect_kind: u32,
    effect_x: f64,
    effect_y: f64,
    effect_width: f64,
    join_code: u32,
) -> Result<Option<KernelOutput>, &'static str> {
    validate_compile_options(
        cubic_tolerance,
        flatten_tolerance,
        arc_sagitta_tolerance,
        integer_scale,
        lod_bucket,
        bucket_scale,
        effect_kind,
        effect_x,
        effect_y,
        effect_width,
        join_code,
    )?;
    if (effect_kind == 1 || effect_kind == 2 || effect_kind == 4) && effect_width <= 0.0 {
        return Ok(None);
    }
    let canonical_fill = registered_canonical_fill(
        handle,
        lod_bucket,
        bucket_scale,
        cubic_tolerance,
        flatten_tolerance,
        arc_sagitta_tolerance,
        integer_scale,
        outline_radius(effect_kind, effect_width),
    )?;
    compile_canonical(
        &canonical_fill,
        arc_sagitta_tolerance,
        integer_scale,
        lod_bucket,
        bucket_scale,
        effect_kind,
        effect_x,
        effect_y,
        effect_width,
        join_code,
    )
}

fn publish_compile_result(result: Result<Option<KernelOutput>, &'static str>) -> i32 {
    match result {
        Ok(Some(output)) => {
            OUTPUT.with(|cell| *cell.borrow_mut() = output);
            STATUS_OK
        }
        Ok(None) => STATUS_EMPTY,
        Err(message) => {
            OUTPUT.with(|cell| cell.borrow_mut().fail(message));
            if message.contains("triangulation") {
                STATUS_TRIANGULATION_FAILED
            } else {
                STATUS_GEOMETRY_FAILED
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_allocate(byte_length: u32) -> u32 {
    if byte_length == 0 {
        return 0;
    }
    let Ok(layout) = Layout::array::<u8>(byte_length as usize) else {
        return 0;
    };
    unsafe { alloc(layout) as u32 }
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_allocate_f64(element_count: u32) -> u32 {
    if element_count == 0 {
        return 0;
    }
    let Ok(layout) = Layout::array::<f64>(element_count as usize) else {
        return 0;
    };
    unsafe { alloc(layout) as u32 }
}

/// # Safety
///
/// The pointer and byte length must describe a buffer returned by
/// vector_geometry_allocate that has not already been released.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vector_geometry_deallocate(pointer: u32, byte_length: u32) {
    if pointer == 0 || byte_length == 0 {
        return;
    }
    if let Ok(layout) = Layout::array::<u8>(byte_length as usize) {
        unsafe { dealloc(pointer as *mut u8, layout) };
    }
}

/// # Safety
///
/// The pointer and element count must describe a buffer returned by
/// vector_geometry_allocate_f64 that has not already been released.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vector_geometry_deallocate_f64(pointer: u32, element_count: u32) {
    if pointer == 0 || element_count == 0 {
        return;
    }
    if let Ok(layout) = Layout::array::<f64>(element_count as usize) {
        unsafe { dealloc(pointer as *mut u8, layout) };
    }
}

/// Copies one path into kernel-owned memory. Handle zero is reserved.
///
/// # Safety
///
/// Input pointers must identify readable allocations in this module's linear
/// memory for their declared element counts.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vector_geometry_register_path(
    handle: u32,
    verbs_pointer: u32,
    verbs_length: u32,
    coords_pointer: u32,
    coords_length: u32,
    fill_rule_code: u32,
) -> i32 {
    OUTPUT.with(|cell| cell.borrow_mut().reset());
    if handle == 0
        || verbs_pointer == 0
        || verbs_length == 0
        || verbs_length as usize > MAXIMUM_VERB_COUNT
        || coords_length as usize > MAXIMUM_COORDINATE_COUNT
        || (coords_length > 0 && coords_pointer == 0)
    {
        OUTPUT.with(|cell| {
            cell.borrow_mut()
                .fail("Vector path registration is invalid.")
        });
        return STATUS_INVALID_ARGUMENT;
    }
    let verbs = unsafe { slice::from_raw_parts(verbs_pointer as *const u8, verbs_length as usize) };
    let coords: &[f64] = if coords_length == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(coords_pointer as *const f64, coords_length as usize) }
    };
    if coords.iter().any(|value| !value.is_finite()) {
        OUTPUT.with(|cell| {
            cell.borrow_mut()
                .fail("Vector geometry contains a non-finite coordinate.")
        });
        return STATUS_INVALID_ARGUMENT;
    }
    let fill_rule = if fill_rule_code == 1 {
        FillRule::EvenOdd
    } else {
        FillRule::NonZero
    };
    let retained_bytes = verbs
        .len()
        .saturating_add(coords.len().saturating_mul(size_of::<f64>()));
    if retained_bytes > REGISTERED_PATH_MAXIMUM_BYTES {
        OUTPUT.with(|cell| {
            cell.borrow_mut()
                .fail("Vector path exceeds the registered-path byte limit.")
        });
        return STATUS_INVALID_ARGUMENT;
    }
    let has_capacity = STATE.with(|cell| {
        let state = cell.borrow();
        let replaced_bytes = state.paths.get(&handle).map_or(0, |path| {
            path.verbs
                .len()
                .saturating_add(path.coords.len().saturating_mul(size_of::<f64>()))
        });
        state
            .registered_path_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(retained_bytes)
            <= REGISTERED_PATHS_MAXIMUM_BYTES
    });
    if !has_capacity {
        OUTPUT.with(|cell| {
            cell.borrow_mut()
                .fail("Vector path registry has reached its byte limit.")
        });
        return STATUS_INVALID_ARGUMENT;
    }
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        state.release_path(handle);
        state.paths.insert(
            handle,
            RegisteredPath {
                fill_rule,
                verbs: Arc::from(verbs),
                coords: Arc::from(coords),
            },
        );
        state.registered_path_bytes = state.registered_path_bytes.saturating_add(retained_bytes);
    });
    STATUS_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_release_path(handle: u32) {
    STATE.with(|cell| cell.borrow_mut().release_path(handle));
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_compile_registered(
    handle: u32,
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    lod_bucket: f64,
    bucket_scale: f64,
    effect_kind: u32,
    effect_x: f64,
    effect_y: f64,
    effect_width: f64,
    join_code: u32,
) -> i32 {
    OUTPUT.with(|cell| cell.borrow_mut().reset());
    publish_compile_result(compile_registered(
        handle,
        cubic_tolerance,
        flatten_tolerance,
        arc_sagitta_tolerance,
        integer_scale,
        lod_bucket,
        bucket_scale,
        effect_kind,
        effect_x,
        effect_y,
        effect_width,
        join_code,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_registered_path_count() -> u32 {
    STATE.with(|cell| cell.borrow().paths.len().min(u32::MAX as usize) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_registered_path_bytes() -> u32 {
    STATE.with(|cell| cell.borrow().registered_path_bytes.min(u32::MAX as usize) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_canonical_cache_entry_count() -> u32 {
    STATE.with(|cell| cell.borrow().canonical_cache.len().min(u32::MAX as usize) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_canonical_cache_bytes() -> u32 {
    STATE.with(|cell| cell.borrow().canonical_cache_bytes.min(u32::MAX as usize) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_canonical_cache_hits() -> u32 {
    STATE.with(|cell| cell.borrow().cache_hits)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_canonical_cache_misses() -> u32 {
    STATE.with(|cell| cell.borrow().cache_misses)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_canonical_cache_evictions() -> u32 {
    STATE.with(|cell| cell.borrow().cache_evictions)
}

/// Compiles one complete path directly to the GPU mesh representation.
///
/// # Safety
///
/// Both input pointers must identify non-overlapping readable allocations in
/// this module's linear memory for their declared element counts.
#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vector_geometry_compile(
    verbs_pointer: u32,
    verbs_length: u32,
    coords_pointer: u32,
    coords_length: u32,
    fill_rule: u32,
    cubic_tolerance: f64,
    flatten_tolerance: f64,
    arc_sagitta_tolerance: f64,
    integer_scale: f64,
    lod_bucket: f64,
    bucket_scale: f64,
    effect_kind: u32,
    effect_x: f64,
    effect_y: f64,
    effect_width: f64,
    join_code: u32,
) -> i32 {
    OUTPUT.with(|cell| cell.borrow_mut().reset());
    if verbs_pointer == 0 || verbs_length == 0 || (coords_length > 0 && coords_pointer == 0) {
        OUTPUT.with(|cell| cell.borrow_mut().fail("Vector input buffers are missing."));
        return STATUS_INVALID_ARGUMENT;
    }
    let verbs = unsafe { slice::from_raw_parts(verbs_pointer as *const u8, verbs_length as usize) };
    let coords: &[f64] = if coords_length == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(coords_pointer as *const f64, coords_length as usize) }
    };
    publish_compile_result(compile(
        verbs,
        coords,
        fill_rule,
        cubic_tolerance,
        flatten_tolerance,
        arc_sagitta_tolerance,
        integer_scale,
        lod_bucket,
        bucket_scale,
        effect_kind,
        effect_x,
        effect_y,
        effect_width,
        join_code,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_vertices_pointer() -> u32 {
    OUTPUT.with(|cell| cell.borrow().vertices.as_ptr() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_vertices_length() -> u32 {
    OUTPUT.with(|cell| cell.borrow().vertices.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_indices_pointer() -> u32 {
    OUTPUT.with(|cell| cell.borrow().indices.as_ptr() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_indices_length() -> u32 {
    OUTPUT.with(|cell| cell.borrow().indices.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_metadata_pointer() -> u32 {
    OUTPUT.with(|cell| cell.borrow().metadata.as_ptr() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_metadata_length() -> u32 {
    METADATA_LENGTH as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_error_pointer() -> u32 {
    OUTPUT.with(|cell| cell.borrow().error.as_ptr() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn vector_geometry_error_length() -> u32 {
    OUTPUT.with(|cell| cell.borrow().error.len() as u32)
}
