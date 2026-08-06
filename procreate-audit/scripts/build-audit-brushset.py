#!/usr/bin/env python3
"""Build deterministic Procreate rendering-audit brushes from a user export.

The script treats the supplied .brush as a ZIP/NSKeyedArchive template. It
changes only brush parameters needed by the audit, the visible name, creation
date and QuickLook thumbnails. The source file is never modified.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import plistlib
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont


APPLE_EPOCH_OFFSET = 978_307_200.0
THUMBNAIL_SIZE = (1060, 324)
COUNT_MAX = 16

# Verified against the public CSP2PC seed/mapper:
# MaxTransfer, ModulatedTransfer, RecursiveMixing.
RENDERING_FLAGS: dict[str, tuple[bool, bool, bool]] = {
    "Light Glaze": (True, False, False),
    "Uniformed Glaze": (False, False, False),
    "Intense Glaze": (True, True, True),
    "Heavy Glaze": (True, False, True),
    "Uniform Blending": (False, True, True),
    "Intense Blending": (False, False, True),
}


@dataclass(frozen=True)
class BrushSpec:
    order: int
    filename: str
    display_name: str
    mode: str
    count: int
    flow: float
    opacity: float
    experiment: str


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_zip(path: Path) -> tuple[list[zipfile.ZipInfo], dict[str, bytes]]:
    with zipfile.ZipFile(path, "r") as archive:
        infos = [copy.copy(info) for info in archive.infolist()]
        payloads = {info.filename: archive.read(info.filename) for info in infos}
    return infos, payloads


def resolve(objects: list[Any], value: Any) -> Any:
    if isinstance(value, plistlib.UID):
        return objects[value.data]
    return value


def get_root(plist: dict[str, Any]) -> tuple[list[Any], int, dict[str, Any]]:
    objects = plist["$objects"]
    root_uid = plist["$top"]["root"]
    if not isinstance(root_uid, plistlib.UID):
        raise ValueError("$top.root is not a UID")
    root_index = root_uid.data
    root = objects[root_index]
    if not isinstance(root, dict):
        raise ValueError("NSKeyedArchive root is not a dictionary")
    return objects, root_index, root


def set_name(objects: list[Any], root: dict[str, Any], name: str) -> int:
    uid = root.get("name")
    if not isinstance(uid, plistlib.UID):
        raise ValueError("Brush name is not UID-backed")
    objects[uid.data] = name
    return uid.data


def set_creation_date(objects: list[Any], root: dict[str, Any], apple_time: float) -> int:
    uid = root.get("creationDate")
    if not isinstance(uid, plistlib.UID):
        raise ValueError("Brush creationDate is not UID-backed")
    date = objects[uid.data]
    if not isinstance(date, dict) or "NS.time" not in date:
        raise ValueError("Brush creationDate does not contain NS.time")
    date["NS.time"] = apple_time
    return uid.data


def require_keys(root: dict[str, Any], keys: Iterable[str]) -> None:
    missing = sorted(set(keys) - set(root))
    if missing:
        raise KeyError(f"Template is missing required brush keys: {missing}")


def count_to_archive_value(count: int) -> float:
    if not 1 <= count <= COUNT_MAX:
        raise ValueError(f"Count must be in 1..{COUNT_MAX}")
    # Procreate stores the 1..16 discrete Count slider as a normalized 0..1.
    return (count - 1) / (COUNT_MAX - 1)


def neutral_settings(spec: BrushSpec) -> dict[str, Any]:
    max_transfer, modulated_transfer, recursive_mixing = RENDERING_FLAGS[spec.mode]

    settings: dict[str, Any] = {
        # Stroke Path and Stabilization
        "plotSpacing": 1.0,
        "plotSpacingJitter": 0.0,
        "plotJitter": 0.0,
        "plotJitterLongitudinal": 0.0,
        "plotSpacingSpeed": 0.0,
        "dynamicsFalloff": 0.0,
        "plotSmoothing": 0.0,
        "plotMovingAverageStabilization": 0.0,
        "plotFFTSmoothingAmount": 0.0,
        "plotFFTSmoothingBias": 0.0,
        "plotJitterTilt": False,
        "plotJitterLongitudinalTilt": False,
        "plotJitterRoll": False,
        "plotJitterLongitudinalRoll": False,
        # Pressure and Touch taper
        "pencilTaperStartLength": 0.0,
        "pencilTaperEndLength": 0.0,
        "pencilTaperSize": 0.0,
        "pencilTaperOpacity": 0.0,
        "pencilTaperShape": 0.0,
        "pencilTaperSizeLinked": False,
        "taperStartLength": 0.0,
        "taperEndLength": 0.0,
        "taperSize": 0.0,
        "taperOpacity": 0.0,
        "taperPressure": 0.0,
        "taperShape": 0.0,
        "taperSizeLinked": False,
        "pencilTipAnimation": False,
        # Shape: solid built-in Hard source inherited from the template
        "shapeCount": count_to_archive_value(spec.count),
        "shapeCountJitter": 0.0,
        "shapeCountTilt": False,
        "shapeCountRoll": False,
        "shapeScatter": 0.0,
        "shapeScatterRoll": False,
        "shapeRotation": 0.0,
        "shapeRandomise": False,
        "shapeFlipXJitter": False,
        "shapeFlipYJitter": False,
        "shapeAzimuth": False,
        "shapeRoll": False,
        "shapeRoundness": 1.0,
        "jitterShapeRoundness": 0.0,
        "jitterShapeRoundnessX": 0.0,
        "shapeFilter": False,
        "shapeFilterMode": 0,
        # Grain: Depth 0 makes the source neutral.
        "grainDepth": 0.0,
        "grainDepthMinimum": 0.0,
        "grainDepthJitter": 0.0,
        "grainBlendMode": 1,
        "grainBlendModeExtended": 1,
        "textureFilter": False,
        "textureFilterMode": 0,
        "textureOffsetJitter": False,
        "textureDepthTilt": False,
        "textureMovement": 0.0,
        "textureRotation": 0.0,
        "textureScale": 0.0,
        "textureZoom": 0.0,
        # Rendering
        "renderingMaxTransfer": max_transfer,
        "renderingModulatedTransfer": modulated_transfer,
        "renderingRecursiveMixing": recursive_mixing,
        "dynamicsGlazedFlow": spec.flow,
        "wetEdgesAmount": 0.0,
        "burntEdgesAmount": 0.0,
        "blendMode": 0,
        "extendedBlend": 0,
        "extendedBlend2": 0,
        "blendGammaCorrect": False,
        "alphaThreshold": False,
        "alphaThresholdAmount": 0.0,
        "legacyNormalDual": False,
        # Wet Mix: Dilution 0, Charge 100, Attack/Pull/Grade/Blur 0.
        "dynamicsMix": 0.0,
        "dynamicsLoad": 1.0,
        "dynamicsPressureMix": 0.0,
        "dynamicsWetAccumulation": 0.0,
        "dynamicsMixSoftening": 0.0,
        "dynamicsBlur": 0.0,
        "dynamicsBlurJitter": 0.0,
        "dynamicsWetnessJitter": 0.0,
        "previewWetMixEnabled": False,
        # Dynamics and Apple Pencil modifiers
        "dynamicsJitterDarkness": 0.0,
        "dynamicsJitterHue": 0.0,
        "dynamicsJitterLightness": 0.0,
        "dynamicsJitterOpacity": 0.0,
        "dynamicsJitterSaturation": 0.0,
        "dynamicsJitterSize": 0.0,
        "dynamicsJitterStrokeDarkness": 0.0,
        "dynamicsJitterStrokeHue": 0.0,
        "dynamicsJitterStrokeLightness": 0.0,
        "dynamicsJitterStrokeSaturation": 0.0,
        "dynamicsPressureBleed": 0.0,
        "dynamicsPressureBleedSpeed": 0.0,
        "dynamicsPressureBrightness": 0.0,
        "dynamicsPressureHue": 0.0,
        "dynamicsPressureOpacity": 0.0,
        "dynamicsPressureOpacitySpeed": 0.0,
        "dynamicsPressureOpacityTransfer": 0.0,
        "dynamicsPressureResponse": 0.0,
        "dynamicsPressureSaturation": 0.0,
        "dynamicsPressureSecondaryColor": 0.0,
        "dynamicsPressureShapeRoundness": 0.0,
        "dynamicsPressureShapeRoundnessMinimum": 0.0,
        "dynamicsPressureSize": 0.0,
        "dynamicsPressureSizeSpeed": 0.0,
        "dynamicsPressureSmoothing": 0.0,
        "dynamicsSpeedOpacity": 0.0,
        "dynamicsSpeedSize": 0.0,
        "dynamicsTiltBleed": 0.0,
        "dynamicsTiltBrightness": 0.0,
        "dynamicsTiltCompression": 0.0,
        "dynamicsTiltGradation": 0.0,
        "dynamicsTiltHue": 0.0,
        "dynamicsTiltOpacity": 0.0,
        "dynamicsTiltSaturation": 0.0,
        "dynamicsTiltSecondaryColor": 0.0,
        "dynamicsTiltShapeRoundness": 0.0,
        "dynamicsTiltShapeRoundnessMinimum": 0.0,
        "dynamicsTiltSize": 0.0,
        "dynamicsRollBleed": 0.0,
        "dynamicsRollBrightness": 0.0,
        "dynamicsRollHue": 0.0,
        "dynamicsRollOpacity": 0.0,
        "dynamicsRollSaturation": 0.0,
        "dynamicsRollSecondaryColor": 0.0,
        "dynamicsRollSize": 0.0,
        "attackTilt": False,
        "attackRoll": False,
        "darknessJitterTilt": False,
        "hueJitterTilt": False,
        "lightnessJitterTilt": False,
        "saturationJitterTilt": False,
        "secondaryColorJitterTilt": False,
        "maxPressureSizeClamped": False,
        # Properties and saved sidebar state
        "maxOpacity": 1.0,
        "minOpacity": 0.0,
        "paintOpacity": spec.opacity,
        "maxSize": 0.12,
        "minSize": 0.12,
        "paintSize": 0.12,
        "oriented": False,
        "stamp": False,
    }
    return settings


def make_thumbnail(spec: BrushSpec) -> bytes:
    image = Image.new("RGBA", THUMBNAIL_SIZE, (19, 22, 31, 255))
    draw = ImageDraw.Draw(image)
    font_path = Path(r"C:\Windows\Fonts\arialbd.ttf")
    if font_path.exists():
        font_big = ImageFont.truetype(str(font_path), 64)
        font_small = ImageFont.truetype(str(font_path), 35)
    else:
        font_big = ImageFont.load_default()
        font_small = ImageFont.load_default()

    mode_short = {
        "Light Glaze": "LIGHT GLAZE",
        "Uniformed Glaze": "UNIFORMED GLAZE",
        "Intense Glaze": "INTENSE GLAZE",
        "Heavy Glaze": "HEAVY GLAZE",
        "Uniform Blending": "UNIFORM BLENDING",
        "Intense Blending": "INTENSE BLENDING",
    }[spec.mode]
    accent = {
        "Light Glaze": (96, 165, 250, 255),
        "Uniformed Glaze": (82, 209, 164, 255),
        "Intense Glaze": (179, 136, 255, 255),
        "Heavy Glaze": (255, 176, 76, 255),
        "Uniform Blending": (255, 112, 153, 255),
        "Intense Blending": (255, 86, 86, 255),
    }[spec.mode]

    draw.rounded_rectangle((26, 24, 1034, 300), radius=34, fill=(27, 31, 44, 255), outline=accent, width=5)
    draw.text((58, 50), mode_short, font=font_big, fill=(247, 249, 255, 255))
    draw.text(
        (60, 151),
        f"{spec.experiment}   COUNT {spec.count}   FLOW {round(spec.flow * 100)}%   OPACITY {round(spec.opacity * 100)}%",
        font=font_small,
        fill=(210, 216, 232, 255),
    )
    draw.ellipse((888, 84, 982, 178), fill=accent)
    draw.text((908, 92), str(spec.count), font=font_big, fill=(15, 18, 25, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def mutate_archive(
    source_bytes: bytes,
    spec: BrushSpec,
    apple_time: float,
) -> tuple[bytes, dict[str, Any]]:
    original = plistlib.loads(source_bytes)
    mutated = copy.deepcopy(original)
    original_objects, original_root_index, original_root = get_root(original)
    objects, root_index, root = get_root(mutated)
    if root_index != original_root_index:
        raise AssertionError("Root index changed before mutation")

    settings = neutral_settings(spec)
    require_keys(root, settings)
    for key, value in settings.items():
        root[key] = value
    name_index = set_name(objects, root, spec.display_name)
    date_index = set_creation_date(objects, root, apple_time)

    output = plistlib.dumps(mutated, fmt=plistlib.FMT_BINARY, sort_keys=False)
    reparsed = plistlib.loads(output)
    output_objects, output_root_index, output_root = get_root(reparsed)

    if output_root_index != original_root_index:
        raise AssertionError("Root index changed after serialization")
    if len(output_objects) != len(original_objects):
        raise AssertionError("NSKeyedArchive object count changed")
    if set(output_root) != set(original_root):
        raise AssertionError("Brush root key set changed")

    intended_root_keys = set(settings) | {"name", "creationDate"}
    for key in original_root:
        if key not in intended_root_keys and output_root[key] != original_root[key]:
            raise AssertionError(f"Untargeted root field changed: {key}")
    for index, original_object in enumerate(original_objects):
        if index not in {root_index, name_index, date_index} and output_objects[index] != original_object:
            raise AssertionError(f"Untargeted NSKeyedArchive object changed: {index}")

    actual_name = resolve(output_objects, output_root["name"])
    if actual_name != spec.display_name:
        raise AssertionError("Brush name did not round-trip")
    for key, expected in settings.items():
        actual = output_root[key]
        if isinstance(expected, float):
            if not math.isclose(float(actual), expected, rel_tol=0.0, abs_tol=1e-7):
                raise AssertionError(f"{key}: {actual!r} != {expected!r}")
        elif actual != expected:
            raise AssertionError(f"{key}: {actual!r} != {expected!r}")

    report = {
        "archive_sha256": sha256(output),
        "archive_size_bytes": len(output),
        "object_count": len(output_objects),
        "root_key_count": len(output_root),
        "mode_flags": {
            "renderingMaxTransfer": output_root["renderingMaxTransfer"],
            "renderingModulatedTransfer": output_root["renderingModulatedTransfer"],
            "renderingRecursiveMixing": output_root["renderingRecursiveMixing"],
        },
        "shapeCountStored": output_root["shapeCount"],
        "shapeCountDecoded": round(output_root["shapeCount"] * 15) + 1,
        "flow": output_root["dynamicsGlazedFlow"],
        "opacity": output_root["paintOpacity"],
    }
    return output, report


def write_brush(
    source_infos: list[zipfile.ZipInfo],
    source_payloads: dict[str, bytes],
    output_path: Path,
    spec: BrushSpec,
    apple_time: float,
) -> dict[str, Any]:
    required_entries = {
        "Brush.archive",
        "Reset/Brush.archive",
        "QuickLook/Thumbnail.png",
        "Reset/QuickLook/Thumbnail.png",
        "Signature/SignaturePicture.png",
    }
    if set(source_payloads) != required_entries:
        raise ValueError(
            "Unexpected template ZIP entries. Refusing to silently add/drop files: "
            f"{sorted(source_payloads)}"
        )

    archive_bytes, archive_report = mutate_archive(
        source_payloads["Brush.archive"], spec, apple_time
    )
    reset_bytes, reset_report = mutate_archive(
        source_payloads["Reset/Brush.archive"], spec, apple_time
    )
    thumbnail = make_thumbnail(spec)
    replacements = {
        "Brush.archive": archive_bytes,
        "Reset/Brush.archive": reset_bytes,
        "QuickLook/Thumbnail.png": thumbnail,
        "Reset/QuickLook/Thumbnail.png": thumbnail,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w") as destination:
        for original_info in source_infos:
            info = copy.copy(original_info)
            payload = replacements.get(info.filename, source_payloads[info.filename])
            destination.writestr(info, payload)

    output_bytes = output_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(output_bytes), "r") as check:
        names = [info.filename for info in check.infolist()]
        if names != [info.filename for info in source_infos]:
            raise AssertionError("Brush ZIP entry order changed")
        if set(names) != required_entries:
            raise AssertionError("Brush ZIP entry set changed")
        checked = plistlib.loads(check.read("Brush.archive"))
        checked_objects, _, checked_root = get_root(checked)
        if resolve(checked_objects, checked_root["name"]) != spec.display_name:
            raise AssertionError("Final ZIP did not preserve the brush name")

    return {
        "order": spec.order,
        "file": output_path.name,
        "display_name": spec.display_name,
        "experiment": spec.experiment,
        "mode": spec.mode,
        "count": spec.count,
        "flow": spec.flow,
        "opacity": spec.opacity,
        "file_size_bytes": len(output_bytes),
        "file_sha256": sha256(output_bytes),
        "archive": archive_report,
        "reset_archive": reset_report,
    }


def build_specs() -> list[BrushSpec]:
    specs = [
        BrushSpec(
            order=0,
            filename="00_AUDIT_E1_COLOR_C1_F100_O50.brush",
            display_name="00 AUDIT E1 COLOR C1 F100 O50",
            mode="Uniformed Glaze",
            count=1,
            flow=1.0,
            opacity=0.5,
            experiment="E1 COLOR",
        )
    ]
    order = 1
    mode_codes = {
        "Light Glaze": "LIGHT",
        "Uniformed Glaze": "UNIFORMED",
        "Intense Glaze": "INTENSE_GLAZE",
        "Heavy Glaze": "HEAVY",
        "Uniform Blending": "UNIFORM_BLEND",
        "Intense Blending": "INTENSE_BLEND",
    }
    for mode in RENDERING_FLAGS:
        for count in (1, 2, 4):
            code = mode_codes[mode]
            specs.append(
                BrushSpec(
                    order=order,
                    filename=f"{order:02d}_AUDIT_E2_{code}_C{count}_F50_O50.brush",
                    display_name=f"{order:02d} {mode.upper()} C{count} F50 O50",
                    mode=mode,
                    count=count,
                    flow=0.5,
                    opacity=0.5,
                    experiment="E2 COUNT",
                )
            )
            order += 1
    return specs


def build_brushset(
    brush_paths: list[Path],
    output_path: Path,
    set_name: str,
) -> dict[str, Any]:
    brush_ids = [str(uuid.uuid4()).upper() for _ in brush_paths]
    plist_bytes = plistlib.dumps(
        {"name": set_name, "brushes": brush_ids},
        fmt=plistlib.FMT_XML,
        sort_keys=False,
    )

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as destination:
        destination.writestr("brushset.plist", plist_bytes)
        for brush_id, brush_path in zip(brush_ids, brush_paths, strict=True):
            with zipfile.ZipFile(brush_path, "r") as brush:
                for info in brush.infolist():
                    nested = copy.copy(info)
                    nested.filename = f"{brush_id}/{info.filename}"
                    destination.writestr(nested, brush.read(info.filename))

    brushset_bytes = output_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(brushset_bytes), "r") as check:
        parsed = plistlib.loads(check.read("brushset.plist"))
        if parsed != {"name": set_name, "brushes": brush_ids}:
            raise AssertionError("brushset.plist did not round-trip")
        names = set(check.namelist())
        for brush_id in brush_ids:
            expected = {
                f"{brush_id}/Brush.archive",
                f"{brush_id}/Reset/Brush.archive",
                f"{brush_id}/QuickLook/Thumbnail.png",
                f"{brush_id}/Reset/QuickLook/Thumbnail.png",
                f"{brush_id}/Signature/SignaturePicture.png",
            }
            if not expected <= names:
                raise AssertionError(f"Brushset member {brush_id} is incomplete")

    return {
        "file": output_path.name,
        "name": set_name,
        "brush_count": len(brush_paths),
        "file_size_bytes": len(brushset_bytes),
        "file_sha256": sha256(brushset_bytes),
        "brush_ids": brush_ids,
    }


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    audit_dir = script_dir.parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=audit_dir / "brush-work" / "Aerografo duro 1.original.brush",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=audit_dir / "output",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    output_dir = args.output.resolve()
    brushes_dir = output_dir / "brushes"
    output_dir.mkdir(parents=True, exist_ok=True)
    brushes_dir.mkdir(parents=True, exist_ok=True)

    source_before = source.read_bytes()
    source_hash = sha256(source_before)
    source_infos, source_payloads = read_zip(source)

    # A no-op bplist reserialization must preserve the parsed object graph.
    for archive_name in ("Brush.archive", "Reset/Brush.archive"):
        parsed = plistlib.loads(source_payloads[archive_name])
        round_trip = plistlib.loads(
            plistlib.dumps(parsed, fmt=plistlib.FMT_BINARY, sort_keys=False)
        )
        if round_trip != parsed:
            raise AssertionError(f"plistlib semantic no-op failed for {archive_name}")

    apple_time = time.time() - APPLE_EPOCH_OFFSET
    specs = build_specs()
    brush_reports: list[dict[str, Any]] = []
    brush_paths: list[Path] = []
    for spec in specs:
        path = brushes_dir / spec.filename
        brush_reports.append(
            write_brush(source_infos, source_payloads, path, spec, apple_time)
        )
        brush_paths.append(path)

    brushset_path = output_dir / "PROCREATE-RENDERING-AUDIT.brushset"
    brushset_report = build_brushset(
        brush_paths, brushset_path, "PROCREATE RENDERING AUDIT"
    )

    # Also provide the single requested AUDIT-1 brush (Uniformed, C1, F50/O50).
    audit_one_spec = BrushSpec(
        order=0,
        filename="AUDIT-1.brush",
        display_name="AUDIT-1 UNIFORMED C1 F50 O50",
        mode="Uniformed Glaze",
        count=1,
        flow=0.5,
        opacity=0.5,
        experiment="BASE",
    )
    audit_one_path = output_dir / audit_one_spec.filename
    audit_one_report = write_brush(
        source_infos, source_payloads, audit_one_path, audit_one_spec, apple_time
    )

    source_after = source.read_bytes()
    if source_after != source_before:
        raise AssertionError("Source brush was modified")

    manifest = {
        "version": 1,
        "source": {
            "file": str(source),
            "size_bytes": len(source_before),
            "sha256_before": source_hash,
            "sha256_after": sha256(source_after),
            "untouched": True,
            "zip_entries": [info.filename for info in source_infos],
        },
        "mode_flag_order": [
            "renderingMaxTransfer",
            "renderingModulatedTransfer",
            "renderingRecursiveMixing",
        ],
        "mode_flags": {
            mode: list(flags) for mode, flags in RENDERING_FLAGS.items()
        },
        "count_encoding": "(Count - 1) / 15",
        "brushset": brushset_report,
        "single_brush": audit_one_report,
        "brushes": brush_reports,
        "validation": {
            "binary_plist_noop_roundtrip": True,
            "every_archive_reparsed": True,
            "untargeted_nskeyedarchive_objects_unchanged": True,
            "zip_entry_sets_and_order_preserved": True,
            "brushset_members_complete": True,
        },
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Source untouched: {source_hash}")
    print(f"Built {len(brush_paths)} audit brushes")
    print(f"Brushset: {brushset_path}")
    print(f"Single brush: {audit_one_path}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
