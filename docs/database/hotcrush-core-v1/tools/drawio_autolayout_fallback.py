"""Small Graphviz-backed fallback for the removed local drawio skill runtime.

It implements only the interface used by generate-drawio-blueprint.py.  The
business model, page composition, labels, colors, fields and relationships stay
in the generator; this module only computes coordinates and emits uncompressed
Draw.io XML.
"""

from __future__ import annotations

from collections import defaultdict
import math
import shlex
import subprocess
from xml.sax.saxutils import quoteattr


PX_PER_INCH = 72.0
MARGIN = 52.0


def _dot_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_dot(graph: dict) -> dict:
    """The fallback keeps the declarative graph and builds DOT in layout()."""
    return graph


def _dot_source(graph: dict) -> str:
    direction = graph.get("direction", "TB")
    ranksep = float(graph.get("ranksep", 0.85))
    nodesep = float(graph.get("nodesep", 0.55))
    lines = [
        "digraph G {",
        f"graph [rankdir={direction}, ranksep={ranksep}, nodesep={nodesep}, splines=ortho, pad=0.35, bgcolor=transparent];",
        'node [shape=box, fixedsize=true, label="", margin=0];',
        'edge [arrowsize=0.6];',
    ]
    grouped: dict[str, list[dict]] = defaultdict(list)
    ungrouped: list[dict] = []
    for item in graph["nodes"]:
        if item.get("group"):
            grouped[item["group"]].append(item)
        else:
            ungrouped.append(item)

    def node_line(item: dict) -> str:
        width = max(float(item["width"]) / PX_PER_INCH, 0.2)
        height = max(float(item["height"]) / PX_PER_INCH, 0.2)
        return f"{_dot_quote(item['id'])} [width={width:.6f}, height={height:.6f}];"

    lines.extend(node_line(item) for item in ungrouped)
    for index, (group_name, items) in enumerate(grouped.items()):
        lines.append(f"subgraph cluster_{index} {{")
        lines.append(f"label={_dot_quote(group_name)}; color=\"#CBD5E1\"; style=\"rounded,dashed\"; fontsize=12;")
        lines.extend(node_line(item) for item in items)
        lines.append("}")
    for index, item in enumerate(graph["edges"]):
        attributes = [f"id={_dot_quote('edge_' + str(index))}"]
        if "strokeOpacity=0" in item.get("style", ""):
            attributes.append("style=invis")
            attributes.append("weight=8")
        else:
            attributes.append("weight=2")
        lines.append(
            f"{_dot_quote(item['source'])} -> {_dot_quote(item['target'])} "
            f"[{', '.join(attributes)}];"
        )
    lines.append("}")
    return "\n".join(lines)


def layout(graph: dict):
    result = subprocess.run(
        ["dot", "-Tplain"],
        input=_dot_source(graph),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Graphviz layout failed: {result.stderr.strip()}")

    graph_width = 0.0
    graph_height = 0.0
    raw_nodes: dict[str, tuple[float, float]] = {}
    raw_edges: list[list[tuple[float, float]]] = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        parts = shlex.split(line)
        if parts[0] == "graph":
            graph_width = float(parts[2])
            graph_height = float(parts[3])
        elif parts[0] == "node":
            raw_nodes[parts[1]] = (float(parts[2]), float(parts[3]))
        elif parts[0] == "edge":
            point_count = int(parts[3])
            coords = parts[4:4 + point_count * 2]
            raw_edges.append([
                (float(coords[i]), float(coords[i + 1]))
                for i in range(0, len(coords), 2)
            ])

    node_by_id = {item["id"]: item for item in graph["nodes"]}
    missing = set(node_by_id) - set(raw_nodes)
    if missing:
        raise RuntimeError(f"Graphviz omitted nodes: {sorted(missing)}")
    positions = {}
    for ident, (center_x, center_y) in raw_nodes.items():
        item = node_by_id[ident]
        x = center_x * PX_PER_INCH - float(item["width"]) / 2 + MARGIN
        y = (graph_height - center_y) * PX_PER_INCH - float(item["height"]) / 2 + MARGIN
        positions[ident] = (round(x, 2), round(y, 2))
    edge_points = [
        [
            (round(x * PX_PER_INCH + MARGIN, 2), round((graph_height - y) * PX_PER_INCH + MARGIN, 2))
            for x, y in points
        ]
        for points in raw_edges
    ]
    page_height = graph_height * PX_PER_INCH + 2 * MARGIN
    return page_height, positions, edge_points


def _bounds(graph: dict, positions: dict) -> tuple[float, float, float, float]:
    min_x = min(positions[item["id"]][0] for item in graph["nodes"])
    min_y = min(positions[item["id"]][1] for item in graph["nodes"])
    max_x = max(positions[item["id"]][0] + float(item["width"]) for item in graph["nodes"])
    max_y = max(positions[item["id"]][1] + float(item["height"]) for item in graph["nodes"])
    return min_x, min_y, max_x, max_y


def route_score(graph: dict, height, positions: dict, edge_points) -> float:
    del height, edge_points
    min_x, min_y, max_x, max_y = _bounds(graph, positions)
    width = max_x - min_x
    page_height = max_y - min_y
    aspect_penalty = abs(math.log(max(width, 1.0) / max(page_height, 1.0)))
    return width * page_height * (1.0 + 0.08 * aspect_penalty)


def _object_cell(item: dict, x: float, y: float) -> str:
    attributes = [f"id={quoteattr(item['id'])}", f"label={quoteattr(item['label'])}"]
    if item.get("link"):
        attributes.append(f"link={quoteattr(item['link'])}")
    return (
        f"<object {' '.join(attributes)}>"
        f"<mxCell style={quoteattr(item['style'])} vertex=\"1\" parent=\"1\">"
        f"<mxGeometry x=\"{x:.2f}\" y=\"{y:.2f}\" width=\"{float(item['width']):.2f}\" "
        f"height=\"{float(item['height']):.2f}\" as=\"geometry\"/>"
        "</mxCell></object>"
    )


def page_cells(graph: dict, height, positions: dict, edge_points, color=False) -> str:
    del height, edge_points, color
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

    groups: dict[str, list[dict]] = defaultdict(list)
    for item in graph["nodes"]:
        if item.get("group"):
            groups[item["group"]].append(item)
    for index, (group_name, items) in enumerate(groups.items()):
        min_x = min(positions[item["id"]][0] for item in items) - 16
        min_y = min(positions[item["id"]][1] for item in items) - 34
        max_x = max(positions[item["id"]][0] + float(item["width"]) for item in items) + 16
        max_y = max(positions[item["id"]][1] + float(item["height"]) for item in items) + 16
        style = (
            "rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;align=left;"
            "fillColor=#F8FAFC;fillOpacity=35;strokeColor=#CBD5E1;dashed=1;"
            "dashPattern=5 4;fontColor=#475569;fontStyle=1;fontSize=12;spacingTop=6;spacingLeft=8;"
        )
        group_item = {
            "id": f"layout_group_{index}", "label": group_name, "style": style,
            "width": max_x - min_x, "height": max_y - min_y,
        }
        cells.append(_object_cell(group_item, min_x, min_y))

    for index, item in enumerate(graph["edges"]):
        cells.append(
            f"<mxCell id=\"layout_edge_{index}\" value={quoteattr(item.get('label', ''))} "
            f"style={quoteattr(item.get('style', ''))} edge=\"1\" parent=\"1\" "
            f"source={quoteattr(item['source'])} target={quoteattr(item['target'])}>"
            '<mxGeometry relative="1" as="geometry"/></mxCell>'
        )
    for item in graph["nodes"]:
        x, y = positions[item["id"]]
        cells.append(_object_cell(item, x, y))

    _, _, max_x, max_y = _bounds(graph, positions)
    page_width = max(int(math.ceil(max_x + MARGIN)), 1169)
    page_height = max(int(math.ceil(max_y + MARGIN)), 827)
    return (
        f'<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" '
        f'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{page_width}" '
        f'pageHeight="{page_height}" math="0" shadow="0"><root>'
        + "".join(cells)
        + "</root></mxGraphModel>"
    )


def wrap_page(cells: str, *, page_id: str, name: str) -> str:
    return f"<diagram id={quoteattr(page_id)} name={quoteattr(name)}>{cells}</diagram>\n"
