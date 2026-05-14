#!/usr/bin/env python3
import argparse
import io
import math
import re
import struct
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

PML = "http://schemas.openxmlformats.org/presentationml/2006/main"
DML = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
NS = {"p": PML, "a": DML, "r": REL}
ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = ROOT_DIR / "发布剪报-模板(1)(1).pptx"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
LAYOUT = {
    "x": 520000,
    "y": 650000,
    "cx": 11150000,
    "cy": 5950000,
    "gap_x": 90000,
    "gap_y": 120000,
    "max_rows": 3,
    "max_cols": 15,
    "min_cell_width": 250000,
    "min_cell_height": 700000,
}

ET.register_namespace("p", PML)
ET.register_namespace("a", DML)
ET.register_namespace("r", REL)

try:
    from PIL import Image
except ImportError:
    Image = None


def main():
    args = parse_args()
    try:
        output = generate_pptx(
            zip_path=args.zip_file,
            template_path=args.template,
            output_path=args.output,
            max_per_slide=args.max_per_slide,
            max_images=args.max_images,
            title=args.title,
        )
    except Exception as error:
        print(f"生成失败：{error}", file=sys.stderr)
        return 1
    print(f"生成完成：{output['output']}")
    print(f"图片数量：{output['image_count']}")
    print(f"发布剪报页：{output['slide_count']}")
    print(f"每页图片：{', '.join(str(item) for item in output['group_sizes'])}")
    print(f"网格布局：{output['layout']['rows']}×{output['layout']['cols']}")
    print(f"文件大小：{format_bytes(output['output'].stat().st_size)}")
    return 0


def parse_args():
    parser = argparse.ArgumentParser(description="从截图图片 ZIP 生成发布剪报 PPTX")
    parser.add_argument("zip_file", type=Path, help="只包含截图图片的 ZIP 文件")
    parser.add_argument("-o", "--output", type=Path, help="输出 PPTX 路径，默认输出到 ZIP 同目录")
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE, help="PPTX 模板路径")
    parser.add_argument("--max-per-slide", type=int, default=15, help="每页最多图片数量，默认 15")
    parser.add_argument("--max-images", type=int, default=2000, help="最多处理图片数量，默认 2000；填 0 表示不限制")
    parser.add_argument("--title", default="发布剪报", help="发布剪报页标题文本")
    return parser.parse_args()


def generate_pptx(zip_path, template_path=DEFAULT_TEMPLATE, output_path=None, max_per_slide=15, max_images=2000, title="发布剪报"):
    zip_path = Path(zip_path).expanduser().resolve()
    template_path = Path(template_path).expanduser().resolve()
    if output_path is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = zip_path.with_name(f"{sanitize_filename(zip_path.stem)}_发布剪报_{timestamp}.pptx")
    else:
        output_path = Path(output_path).expanduser().resolve()
    if not zip_path.exists():
        raise FileNotFoundError(f"找不到 ZIP：{zip_path}")
    if not template_path.exists():
        raise FileNotFoundError(f"找不到模板：{template_path}")
    max_per_slide = max(1, min(int(max_per_slide or 15), LAYOUT["max_rows"] * LAYOUT["max_cols"]))
    images = read_images_from_zip(zip_path)
    if not images:
        raise ValueError("ZIP 中没有找到 png、jpg、jpeg 或 webp 图片")
    if max_images and len(images) > max_images:
        raise ValueError(f"图片数量 {len(images)} 超过限制 {max_images}；如确认本机性能足够，可加 --max-images 0 取消限制")
    page_plan = create_page_plan(images, max_per_slide)
    with zipfile.ZipFile(template_path, "r") as package:
        files = {name: package.read(name) for name in package.namelist()}
    build_pptx(files, page_plan, title)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for name, data in files.items():
            package.writestr(name, data)
    return {
        "output": output_path,
        "image_count": len(images),
        "slide_count": len(page_plan["groups"]),
        "group_sizes": [len(group) for group in page_plan["groups"]],
        "layout": page_plan["layout"],
    }


def read_images_from_zip(zip_path):
    with zipfile.ZipFile(zip_path, "r") as package:
        infos = [info for info in package.infolist() if is_image_member(info.filename)]
        infos.sort(key=lambda info: natural_key(info.filename))
        images = []
        for index, info in enumerate(infos, 1):
            data = package.read(info)
            image = normalize_image(info.filename, data)
            image["index"] = index
            images.append(image)
    return images


def is_image_member(name):
    normalized = str(name).replace("\\", "/")
    file_name = normalized.rsplit("/", 1)[-1]
    if not file_name or normalized.endswith("/") or normalized.startswith("__MACOSX/") or file_name.startswith("."):
        return False
    return Path(file_name).suffix.lower() in IMAGE_EXTENSIONS


def natural_key(value):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", str(value))]


def normalize_image(name, data):
    extension = Path(name).suffix.lower()
    if extension == ".webp":
        if Image is None:
            raise RuntimeError(f"WebP 需要安装 Pillow 后再处理：python3 -m pip install Pillow（文件：{name}）")
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return {"name": name, "data": output.getvalue(), "ext": "png", "content_type": "image/png", "width": width, "height": height}
    width, height = get_image_size(data, extension)
    if extension in {".jpg", ".jpeg"}:
        return {"name": name, "data": data, "ext": "jpeg", "content_type": "image/jpeg", "width": width, "height": height}
    return {"name": name, "data": data, "ext": "png", "content_type": "image/png", "width": width, "height": height}


def get_image_size(data, extension):
    try:
        if extension == ".png":
            return png_size(data)
        if extension in {".jpg", ".jpeg"}:
            return jpeg_size(data)
    except Exception:
        pass
    if Image is not None:
        with Image.open(io.BytesIO(data)) as image:
            return image.size
    raise ValueError("无法读取图片尺寸，请确认图片未损坏，或安装 Pillow 后重试")


def png_size(data):
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是有效 PNG")
    return struct.unpack(">II", data[16:24])


def jpeg_size(data):
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise ValueError("不是有效 JPEG")
    index = 2
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while index < len(data):
        while index < len(data) and data[index] != 0xFF:
            index += 1
        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break
        marker = data[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(data):
            break
        length = struct.unpack(">H", data[index:index + 2])[0]
        if length < 2 or index + length > len(data):
            break
        if marker in sof_markers:
            height = struct.unpack(">H", data[index + 3:index + 5])[0]
            width = struct.unpack(">H", data[index + 5:index + 7])[0]
            return width, height
        index += length
    raise ValueError("无法读取 JPEG 尺寸")


def create_page_plan(images, max_per_slide):
    max_layout = choose_layout(images, min(len(images), max_per_slide), max_per_slide)
    page_count = math.ceil(len(images) / max_layout["count"])
    group_sizes = distribute_group_sizes(len(images), page_count)
    layout = choose_layout(images, max(group_sizes), max_per_slide)
    groups = []
    offset = 0
    for size in group_sizes:
        groups.append(images[offset:offset + size])
        offset += size
    return {"layout": layout, "groups": groups}


def distribute_group_sizes(total, group_count):
    base = total // group_count
    extra = total % group_count
    return [base + (1 if index < extra else 0) for index in range(group_count)]


def choose_layout(images, target_count, max_per_slide):
    aspect = median([image["width"] / image["height"] for image in images if image.get("width") and image.get("height")])
    target = max(1, min(target_count or len(images), max_per_slide))
    best = None
    for rows in range(1, LAYOUT["max_rows"] + 1):
        for cols in range(1, LAYOUT["max_cols"] + 1):
            count = rows * cols
            if count > max_per_slide or count < target:
                continue
            cell_width = (LAYOUT["cx"] - (cols - 1) * LAYOUT["gap_x"]) / cols
            cell_height = (LAYOUT["cy"] - (rows - 1) * LAYOUT["gap_y"]) / rows
            if cell_width < LAYOUT["min_cell_width"] or cell_height < LAYOUT["min_cell_height"]:
                continue
            cell_aspect = cell_width / cell_height
            aspect_penalty = min(2, abs(math.log(cell_aspect / aspect)))
            empty_slots = count - target
            score = target * 0.055 + 0.35 - empty_slots * 0.03 - aspect_penalty * 0.45
            if best is None or score > best["score"]:
                best = {
                    **LAYOUT,
                    "rows": rows,
                    "cols": cols,
                    "count": count,
                    "cell_width": cell_width,
                    "cell_height": cell_height,
                    "score": score,
                }
    if best is None:
        cols = min(max_per_slide, 5)
        rows = math.ceil(target / cols)
        return {
            **LAYOUT,
            "rows": rows,
            "cols": cols,
            "count": rows * cols,
            "cell_width": (LAYOUT["cx"] - (cols - 1) * LAYOUT["gap_x"]) / cols,
            "cell_height": (LAYOUT["cy"] - (rows - 1) * LAYOUT["gap_y"]) / rows,
            "score": 0,
        }
    return best


def median(values):
    numbers = sorted(value for value in values if value > 0)
    if not numbers:
        return 1
    return numbers[len(numbers) // 2]


def build_pptx(files, page_plan, title):
    presentation = ET.fromstring(files["ppt/presentation.xml"])
    presentation_rels = ET.fromstring(files["ppt/_rels/presentation.xml.rels"])
    content_types = ET.fromstring(files["[Content_Types].xml"])
    slides = get_presentation_slides(presentation, presentation_rels, files)
    release_index = find_release_slide_index(slides, files)
    release_slide = slides[release_index]
    base_slide_xml = files[f"ppt/{release_slide['target']}"]
    base_slide_file = release_slide["target"].rsplit("/", 1)[-1]
    base_rels_path = f"ppt/slides/_rels/{base_slide_file}.rels"
    base_rels_xml = files[base_rels_path]
    next_slide_number = next_slide_number_from(files)
    next_slide_id = max_slide_id(presentation) + 1
    next_presentation_rel_id = next_rel_number(presentation_rels)
    next_media_number = next_media_number_from(files)
    slide_list = presentation.find(".//p:sldIdLst", NS)
    insert_position = list(slide_list).index(release_slide["node"]) + 1
    for page_index, page_images in enumerate(page_plan["groups"]):
        is_first = page_index == 0
        slide_target = release_slide["target"] if is_first else f"slides/slide{next_slide_number}.xml"
        slide_file = slide_target.rsplit("/", 1)[-1]
        rels_path = f"ppt/slides/_rels/{slide_file}.rels"
        image_links = []
        for image in page_images:
            media_name = f"image{next_media_number}.{image['ext']}"
            next_media_number += 1
            files[f"ppt/media/{media_name}"] = image["data"]
            image_links.append({**image, "rel_id": "", "target": f"../media/{media_name}"})
        slide_rels = build_slide_relationships(base_rels_xml, image_links)
        slide_xml = build_slide_xml(base_slide_xml, image_links, page_plan["layout"], title)
        files[f"ppt/{slide_target}"] = xml_bytes(slide_xml)
        files[rels_path] = xml_bytes(slide_rels)
        ensure_slide_override(content_types, f"/ppt/{slide_target}")
        if not is_first:
            rel_id = f"rId{next_presentation_rel_id}"
            next_presentation_rel_id += 1
            add_presentation_relationship(presentation_rels, rel_id, slide_target)
            slide_id_node = ET.Element(f"{{{PML}}}sldId", {"id": str(next_slide_id), f"{{{REL}}}id": rel_id})
            slide_list.insert(insert_position, slide_id_node)
            insert_position += 1
            next_slide_id += 1
            next_slide_number += 1
    ensure_image_content_types(content_types)
    files["ppt/presentation.xml"] = xml_bytes(presentation)
    files["ppt/_rels/presentation.xml.rels"] = xml_bytes(presentation_rels)
    files["[Content_Types].xml"] = xml_bytes(content_types)
    update_app_slide_count(files, len(slides) + len(page_plan["groups"]) - 1)


def get_presentation_slides(presentation, presentation_rels, files):
    rel_map = {rel.attrib.get("Id"): rel.attrib.get("Target", "") for rel in presentation_rels.findall(f"{{{PKG_REL}}}Relationship")}
    slides = []
    for node in presentation.findall(".//p:sldId", NS):
        rel_id = node.attrib.get(f"{{{REL}}}id")
        target = rel_map.get(rel_id, "")
        text = slide_text(files.get(f"ppt/{target}", b""))
        slides.append({"node": node, "rel_id": rel_id, "target": target, "text": text})
    return slides


def find_release_slide_index(slides, files):
    for index, slide in enumerate(slides):
        texts = slide_texts(files.get(f"ppt/{slide['target']}", b""))
        if any(text == "发布剪报" for text in texts):
            return index
    for index, slide in enumerate(slides):
        if slide["target"] == "slides/slide3.xml":
            return index
    raise ValueError("模板中找不到发布剪报页")


def slide_text(xml_bytes_value):
    return "".join(slide_texts(xml_bytes_value))


def slide_texts(xml_bytes_value):
    if not xml_bytes_value:
        return []
    root = ET.fromstring(xml_bytes_value)
    return [text_content(shape) for shape in root.findall(".//p:sp", NS) if text_content(shape)]


def build_slide_relationships(base_rels_xml, image_links):
    root = ET.fromstring(base_rels_xml)
    for rel in list(root.findall(f"{{{PKG_REL}}}Relationship")):
        if rel.attrib.get("Type") == IMAGE_REL_TYPE:
            root.remove(rel)
    next_rel_id = next_rel_number(root)
    for image in image_links:
        rel_id = f"rId{next_rel_id}"
        next_rel_id += 1
        image["rel_id"] = rel_id
        root.append(ET.Element(f"{{{PKG_REL}}}Relationship", {"Id": rel_id, "Type": IMAGE_REL_TYPE, "Target": image["target"]}))
    return root


def build_slide_xml(base_slide_xml, image_links, layout, title):
    root = ET.fromstring(base_slide_xml)
    remove_placeholder_shapes(root)
    update_title(root, title)
    sp_tree = root.find(".//p:spTree", NS)
    next_shape_id = max_shape_id(root) + 1
    positions = build_image_positions(image_links, layout)
    for index, image in enumerate(image_links):
        sp_tree.append(create_picture_node(next_shape_id, f"截图 {index + 1}", image["rel_id"], positions[index]))
        next_shape_id += 1
    return root


def remove_placeholder_shapes(root):
    parent_map = {child: parent for parent in root.iter() for child in parent}
    for shape in list(root.findall(".//p:sp", NS)):
        text = text_content(shape)
        if re.search(r"一页贴|长图|占位", text):
            parent = parent_map.get(shape)
            if parent is not None:
                parent.remove(shape)


def update_title(root, title):
    shapes = root.findall(".//p:sp", NS)
    title_shape = next((shape for shape in shapes if text_content(shape) == "发布剪报"), None)
    if title_shape is None:
        title_shape = next((shape for shape in shapes if "发布剪报" in text_content(shape)), None)
    if title_shape is None:
        return
    text_nodes = title_shape.findall(".//a:t", NS)
    if not text_nodes:
        return
    text_nodes[0].text = title
    for node in text_nodes[1:]:
        node.text = ""


def build_image_positions(images, layout):
    positions = []
    for index, image in enumerate(images):
        row = index // layout["cols"]
        col = index % layout["cols"]
        row_count = min(layout["cols"], len(images) - row * layout["cols"])
        row_offset = max(0, (layout["cols"] - row_count) * (layout["cell_width"] + layout["gap_x"]) / 2)
        cell_x = layout["x"] + row_offset + col * (layout["cell_width"] + layout["gap_x"])
        cell_y = layout["y"] + row * (layout["cell_height"] + layout["gap_y"])
        image_aspect = image["width"] / image["height"] if image.get("width") and image.get("height") else 1
        fit_cx, fit_cy = fit_inside_cell(image_aspect, layout["cell_width"], layout["cell_height"])
        positions.append({
            "x": round(cell_x + (layout["cell_width"] - fit_cx) / 2),
            "y": round(cell_y + (layout["cell_height"] - fit_cy) / 2),
            "cx": round(fit_cx),
            "cy": round(fit_cy),
        })
    return positions


def fit_inside_cell(image_aspect, cell_width, cell_height):
    if image_aspect <= 0:
        return cell_width, cell_height
    cell_aspect = cell_width / cell_height
    if image_aspect > cell_aspect:
        return cell_width, cell_width / image_aspect
    return cell_height * image_aspect, cell_height


def create_picture_node(shape_id, name, rel_id, position):
    xml = f'''<p:pic xmlns:p="{PML}" xmlns:a="{DML}" xmlns:r="{REL}"><p:nvPicPr><p:cNvPr id="{shape_id}" name="{xml_escape(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="{position["x"]}" y="{position["y"]}"/><a:ext cx="{position["cx"]}" cy="{position["cy"]}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'''
    return ET.fromstring(xml)


def add_presentation_relationship(root, rel_id, target):
    root.append(ET.Element(f"{{{PKG_REL}}}Relationship", {"Id": rel_id, "Type": SLIDE_REL_TYPE, "Target": target}))


def ensure_image_content_types(root):
    ensure_default_content_type(root, "png", "image/png")
    ensure_default_content_type(root, "jpg", "image/jpeg")
    ensure_default_content_type(root, "jpeg", "image/jpeg")
    ensure_default_content_type(root, "webp", "image/webp")


def ensure_default_content_type(root, extension, content_type):
    for node in root.findall(f"{{{CT}}}Default"):
        if node.attrib.get("Extension", "").lower() == extension.lower():
            return
    root.insert(0, ET.Element(f"{{{CT}}}Default", {"Extension": extension, "ContentType": content_type}))


def ensure_slide_override(root, part_name):
    for node in root.findall(f"{{{CT}}}Override"):
        if node.attrib.get("PartName") == part_name:
            return
    root.append(ET.Element(f"{{{CT}}}Override", {"PartName": part_name, "ContentType": SLIDE_CONTENT_TYPE}))


def update_app_slide_count(files, count):
    path = "docProps/app.xml"
    if path not in files:
        return
    try:
        root = ET.fromstring(files[path])
        for node in root.iter():
            if node.tag.rsplit("}", 1)[-1] == "Slides":
                node.text = str(count)
        files[path] = xml_bytes(root)
    except ET.ParseError:
        return


def next_slide_number_from(files):
    numbers = []
    for name in files:
        match = re.match(r"ppt/slides/slide(\d+)\.xml$", name)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def next_media_number_from(files):
    numbers = []
    for name in files:
        match = re.match(r"ppt/media/image(\d+)\.[^.]+$", name)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def max_slide_id(root):
    ids = [int(node.attrib.get("id", "0")) for node in root.findall(".//p:sldId", NS)]
    return max([255, *ids])


def next_rel_number(root):
    numbers = []
    for node in root.findall(f"{{{PKG_REL}}}Relationship"):
        match = re.match(r"rId(\d+)$", node.attrib.get("Id", ""), re.I)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def max_shape_id(root):
    numbers = []
    for node in root.findall(".//p:cNvPr", NS):
        try:
            numbers.append(int(node.attrib.get("id", "0")))
        except ValueError:
            pass
    return max(numbers, default=0)


def text_content(node):
    return "".join(item.text or "" for item in node.findall(".//a:t", NS)).strip()


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def xml_escape(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def sanitize_filename(value):
    return re.sub(r"[\\/:*?\"<>|\r\n\t]+", "", str(value)).strip() or "发布剪报"


def format_bytes(size):
    if size >= 1024 * 1024:
        return f"{round(size / 1024 / 1024)} MB"
    if size >= 1024:
        return f"{round(size / 1024)} KB"
    return f"{size} B"


if __name__ == "__main__":
    raise SystemExit(main())
