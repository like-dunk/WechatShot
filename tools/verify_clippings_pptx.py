#!/usr/bin/env python3
import pathlib
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
PML = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
DML = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def main():
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = pathlib.Path(temp_dir)
        zip_path = temp / "sample_images.zip"
        output_path = temp / "sample_output.pptx"
        create_sample_zip(zip_path, 33)
        subprocess.check_call([
            sys.executable,
            str(ROOT / "tools" / "generate_clippings_pptx.py"),
            str(zip_path),
            "-o",
            str(output_path),
        ], cwd=ROOT)
        validate_output(output_path)
    print("verify_clippings_pptx ok")


ASPECTS = [(120, 240), (160, 240), (240, 240), (200, 240)]


def create_sample_zip(zip_path, count):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as package:
        for index in range(1, count + 1):
            width, height = ASPECTS[index % len(ASPECTS)]
            package.writestr(f"{index:02d}.png", make_png(index, width, height))


def make_png(index, width, height):
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            row.extend(((index * 23) % 256, (x * 2) % 256, (y * 2) % 256))
        rows.append(bytes(row))
    raw = b"".join(rows)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + png_chunk(b"IDAT", zlib.compress(raw)) + png_chunk(b"IEND", b"")


def png_chunk(chunk_type, data):
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xffffffff)


def validate_output(output_path):
    with zipfile.ZipFile(output_path) as package:
        names = set(package.namelist())
        for name in ["ppt/slides/slide3.xml", "ppt/slides/slide5.xml", "ppt/slides/slide6.xml"]:
            assert name in names, f"missing {name}"
        targets = presentation_slide_targets(package)
        assert targets == ["slides/slide1.xml", "slides/slide2.xml", "slides/slide3.xml", "slides/slide5.xml", "slides/slide6.xml", "slides/slide4.xml"], targets
        pic_counts = [slide_pic_count(package, slide) for slide in ["slide3.xml", "slide5.xml", "slide6.xml"]]
        assert pic_counts == [11, 11, 11], pic_counts
        for slide in ["slide3.xml", "slide5.xml", "slide6.xml"]:
            text = slide_text(package, slide)
            assert "一页贴15长图" not in text, text
            assert "发布剪报" in text, text
            first_pic_y = first_picture_y(package, slide)
            assert first_pic_y >= 650000, first_pic_y
            assert_no_src_rect(package, slide)
            assert_contain_layout(package, slide)
        assert "ppt/media/image34.png" in names, "expected generated media image34.png"


def presentation_slide_targets(package):
    presentation = ET.fromstring(package.read("ppt/presentation.xml"))
    rels = ET.fromstring(package.read("ppt/_rels/presentation.xml.rels"))
    rel_map = {rel.attrib.get("Id"): rel.attrib.get("Target") for rel in rels.findall(PKG_REL + "Relationship")}
    return [rel_map[node.attrib.get(REL + "id")] for node in presentation.findall(".//" + PML + "sldId")]


def slide_pic_count(package, slide_file):
    root = ET.fromstring(package.read(f"ppt/slides/{slide_file}"))
    return len(root.findall(".//" + PML + "pic"))


def slide_text(package, slide_file):
    root = ET.fromstring(package.read(f"ppt/slides/{slide_file}"))
    return "".join(node.text or "" for node in root.findall(".//" + DML + "t"))


def first_picture_y(package, slide_file):
    root = ET.fromstring(package.read(f"ppt/slides/{slide_file}"))
    pic = root.find(".//" + PML + "pic")
    assert pic is not None, f"missing pic in {slide_file}"
    off = pic.find(".//" + DML + "off")
    assert off is not None, f"missing offset in {slide_file}"
    return int(off.attrib.get("y", "0"))


def assert_no_src_rect(package, slide_file):
    root = ET.fromstring(package.read(f"ppt/slides/{slide_file}"))
    src_rects = root.findall(".//" + DML + "srcRect")
    assert not src_rects, f"{slide_file} should not contain srcRect (images must show in full): {len(src_rects)} found"


def assert_contain_layout(package, slide_file):
    layout_x, layout_y = 520000, 650000
    layout_cx, layout_cy = 11150000, 5950000
    root = ET.fromstring(package.read(f"ppt/slides/{slide_file}"))
    for pic in root.findall(".//" + PML + "pic"):
        ext = pic.find(".//" + DML + "ext")
        off = pic.find(".//" + DML + "off")
        assert ext is not None and off is not None, f"{slide_file} missing pic geometry"
        cx, cy = int(ext.attrib["cx"]), int(ext.attrib["cy"])
        x, y = int(off.attrib["x"]), int(off.attrib["y"])
        assert cx > 0 and cy > 0, f"{slide_file} non-positive pic size {cx}x{cy}"
        assert x >= layout_x - 1 and y >= layout_y - 1, f"{slide_file} pic origin {x},{y} outside layout"
        assert x + cx <= layout_x + layout_cx + 1, f"{slide_file} pic exceeds layout width"
        assert y + cy <= layout_y + layout_cy + 1, f"{slide_file} pic exceeds layout height"


if __name__ == "__main__":
    main()
