#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["ast-grep-py>=0.30.0", "mip>=1.15.0"]
# ///

from dataclasses import dataclass, field
from pathlib import Path
from typing import Set, Dict, List, NamedTuple
from subprocess import run
from functools import cache
from ast_grep_py import SgRoot
from mip import Model, xsum, minimize, BINARY
import json
import re

# Comprehensive DOM method names (not full paths, just method names for substring matching)
DOM_METHODS = [
    'createElement', 'createElementNS', 'createTextNode', 'createComment',
    'createDocumentFragment', 'importNode', 'querySelector', 'querySelectorAll',
    'getElementById', 'getElementsByClassName', 'getElementsByTagName',
    'appendChild', 'removeChild', 'replaceChild', 'insertBefore',
    'cloneNode', 'contains', 'hasChildNodes',
    'append', 'prepend', 'before', 'after', 'remove', 'replaceWith',
    'setAttribute', 'setAttributeNS', 'getAttribute', 'removeAttribute',
    'hasAttribute', 'toggleAttribute',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'focus', 'blur', 'click', 'scroll', 'scrollIntoView',
    'getBoundingClientRect', 'getClientRects',
    'matches', 'closest',
]

# DOM attributes (properties that can be read/written)
DOM_ATTRIBUTES = [
    'value', 'checked', 'selected', 'disabled', 'readonly', 'required',
    'autofocus', 'placeholder', 'maxLength', 'minLength', 'pattern',
    'accept', 'multiple', 'files', 'form', 'name', 'type',
    'id', 'className', 'classList', 'title', 'lang', 'dir',
    'hidden', 'tabIndex', 'accessKey', 'contentEditable',
    'draggable', 'spellcheck', 'translate',
    'innerHTML', 'outerHTML', 'textContent', 'innerText',
    'src', 'href', 'alt', 'width', 'height',
    'currentTime', 'duration', 'paused', 'muted', 'volume',
    'playbackRate', 'ended', 'seeking', 'readyState',
    'style', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft',
    'clientWidth', 'clientHeight', 'clientTop', 'clientLeft',
    'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft',
    'parentNode', 'parentElement', 'childNodes', 'children',
    'firstChild', 'lastChild', 'nextSibling', 'previousSibling',
    'firstElementChild', 'lastElementChild',
    'nextElementSibling', 'previousElementSibling',
    'nodeType', 'nodeName', 'nodeValue', 'ownerDocument',
    'dataset',
]

DOCUMENT_WINDOW_ATTRS = [
    'activeElement', 'body', 'head', 'documentElement',
    'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
    'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
]

ALL_DOM_PATTERNS = DOM_METHODS + DOM_ATTRIBUTES + DOCUMENT_WINDOW_ATTRS

@dataclass
class CallGraph:
    exports: Set[str] = field(default_factory=set)
    all_funcs: Set[str] = field(default_factory=set)
    calls: Dict[str, Set[str]] = field(default_factory=dict)
    dom_calls: Dict[str, Set[str]] = field(default_factory=dict)

@dataclass
class SetCoverInput:
    """Pre-processed input for set cover solver."""
    ast_candidates: tuple[str, ...]
    dom_candidates: tuple[str, ...]
    path_constraints: list[list[str]]    # Each path = AST funcs that can cover it
    leaf_dom_map: dict[str, set[str]]    # For hybrid: leaf_func → DOM APIs
    ast_scores: dict[str, float]         # For tie-breaking by dom_distance

class CallTree(NamedTuple):
    function: str
    direct_dom: tuple[str, ...] = ()
    function_calls: tuple['CallTree', ...] = ()

    @classmethod
    def from_dict(cls, data: dict) -> 'CallTree':
        return cls(
            function=data['function'],
            direct_dom=tuple(data.get('direct_dom', [])),
            function_calls=tuple(cls.from_dict(c) for c in data.get('function_calls', []))
        )

    def to_dict(self) -> dict:
        return {
            'function': self.function,
            'direct_dom': list(self.direct_dom),
            'function_calls': [c.to_dict() for c in self.function_calls]
        }

def ensure_svelte() -> Path:
    repo = Path('github-svelte')
    if not repo.exists():
        run(['git', 'clone', 'https://github.com/sveltejs/svelte', str(repo)], check=True)
    return repo


def strip_comments(content: str) -> str:
    content = re.sub(r'//.*', '', content)
    return re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

def extract_function_body(content: str, func_name: str) -> str | None:
    pattern = rf'function {re.escape(func_name)}\s*\([^)]*\)\s*\{{'
    if not (match := re.search(pattern, content)):
        return None
    start = match.end() - 1
    brace_count = 1
    for i, char in enumerate(content[start + 1 :], 1):
        if char == '{': brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0:
                return content[start : start + i + 1]
    return None

def extract_exports(index_file: Path) -> tuple[Set[str], Dict[str, str]]:
    """Extract exports and build alias map (alias → actual_name)."""
    content = strip_comments(index_file.read_text())
    exports, alias_map = set(), {}

    for match in re.finditer(r'export\s*\{([^}]+)\}', content, re.DOTALL):
        for item in match.group(1).split(','):
            parts = [p.strip() for p in item.split(' as ')]
            actual, alias = (parts[0], parts[1]) if len(parts) == 2 else (parts[0], parts[0])
            if alias and not alias.isupper():
                exports.add(alias)
                alias_map[alias] = actual

    return exports, alias_map

def canonicalize_dom_call(text: str) -> str | None:
    """
    Convert a DOM operation to its canonical form.
    E.g., 'parent_node.appendChild' -> 'element.appendChild'
         'document.createElement' -> 'document.createElement'
         'fragment.append' -> 'element.append'
    Returns None if not a DOM operation.
    """
    # Check if this contains any DOM pattern
    matching_pattern = None
    for pattern in ALL_DOM_PATTERNS:
        if pattern in text:
            matching_pattern = pattern
            break

    if not matching_pattern:
        return None

    # Determine the canonical prefix based on what the pattern is
    if matching_pattern in ['createElement', 'createElementNS', 'createTextNode',
                           'createComment', 'createDocumentFragment', 'importNode',
                           'querySelector', 'querySelectorAll', 'getElementById',
                           'getElementsByClassName', 'getElementsByTagName']:
        return f'document.{matching_pattern}'

    if matching_pattern in DOCUMENT_WINDOW_ATTRS:
        if matching_pattern in ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
                                'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset']:
            return f'window.{matching_pattern}'
        return f'document.{matching_pattern}'

    # For methods and properties that apply to nodes/elements
    if matching_pattern in ['appendChild', 'removeChild', 'replaceChild', 'insertBefore',
                            'cloneNode', 'contains', 'hasChildNodes', 'append', 'prepend',
                            'before', 'after', 'remove', 'replaceWith',
                            'firstChild', 'lastChild', 'nextSibling', 'previousSibling',
                            'firstElementChild', 'lastElementChild',
                            'nextElementSibling', 'previousElementSibling',
                            'parentNode', 'parentElement', 'childNodes', 'children',
                            'nodeType', 'nodeName', 'nodeValue', 'ownerDocument']:
        return f'node.{matching_pattern}'

    # Element-specific operations (most common)
    return f'element.{matching_pattern}'

def extract_calls(body: str) -> Set[str]:
    calls = set()
    root = SgRoot(body, 'javascript')

    # Function calls - extract the callee from call_expression
    for node in root.root().find_all(kind='call_expression'):
        children = list(node.children())
        if children:
            text = children[0].text()
            calls.add(text)

    # Member accesses (property reads)
    for node in root.root().find_all(kind='member_expression'):
        calls.add(node.text())

    # Assignment expressions (property writes) - catches element.value = x
    for node in root.root().find_all(kind='assignment_expression'):
        children = list(node.children())
        if children:
            # Left side of assignment
            left = children[0].text()
            calls.add(left)

    return calls

def build_graph(svelte: Path, exports: Set[str]) -> CallGraph:
    graph = CallGraph(exports=exports)
    client_dir = svelte / 'packages/svelte/src/internal/client'
    for js_file in client_dir.rglob('*.js'):
        content = strip_comments(js_file.read_text())
        func_matches = list(re.finditer(r'(?:export\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(', content))
        for m in func_matches:
            func_name = m.group(1)
            graph.all_funcs.add(func_name)
            if body := extract_function_body(content, func_name):
                calls = extract_calls(body)
                graph.calls[func_name] = calls
                # Canonicalize DOM calls
                dom_calls = set()
                for call in calls:
                    canonical = canonicalize_dom_call(call)
                    if canonical:
                        dom_calls.add(canonical)
                graph.dom_calls[func_name] = dom_calls
    return graph

def build_call_tree(graph: CallGraph, func: str, visited: Set[str] = None) -> CallTree:
    visited = visited or set()
    if func in visited:
        return CallTree(func)
    visited.add(func)

    # Helper to check if a call is a DOM operation
    def is_dom_call(call: str) -> bool:
        return any(pattern in call for pattern in ALL_DOM_PATTERNS)

    return CallTree(
        function=func,
        direct_dom=tuple(sorted(graph.dom_calls.get(func, set()))),
        function_calls=tuple(
            build_call_tree(graph, call, visited.copy())
            for call in sorted(graph.calls.get(func, set()))
            if call in graph.all_funcs and not is_dom_call(call)
        )
    )

@cache
def calc_dom_distance(tree: CallTree) -> int | float:
    """Calculate minimum AST layers to reach DOM (memoized).

    Returns: 0 = direct DOM | 1+ = through AST | inf = no DOM
    """
    if tree.direct_dom:
        return 0
    if not tree.function_calls:
        return float('inf')
    return 1 + min(calc_dom_distance(c) for c in tree.function_calls)

# Helpers
DOM_PREFIX = "DOM:"
make_dom_key = lambda d: f"{DOM_PREFIX}{d}"
parse_dom_key = lambda k: k[len(DOM_PREFIX):]
is_selected = lambda var: var.x > 0.5
filter_dict = lambda d, pred: {k: v for k, v in d.items() if pred(v)}
collect_funcs_in_paths = lambda paths: {f for path_list in paths.values() for path in path_list for f in path}

@cache
def flatten_tree(tree: CallTree) -> frozenset[str]:
    """Recursively collect all DOM calls in tree (memoized)."""
    return frozenset(tree.direct_dom) | frozenset().union(*(flatten_tree(c) for c in tree.function_calls))

def extract_all_paths(tree: CallTree, current_path: List[str] = None) -> List[List[str]]:
    """Extract all paths from root to DOM calls. Each path is a list of function names."""
    current_path = current_path or []
    paths = []

    # If this node has direct DOM calls, record the path to here
    if tree.direct_dom:
        paths.append(current_path + [tree.function])

    # Recurse into children
    for child in tree.function_calls:
        child_paths = extract_all_paths(child, current_path + [tree.function])
        paths.extend(child_paths)

    return paths

def expand_to_dom(graph: CallGraph):
    """Build call trees and extract coverage, paths, distances."""
    trees = {func: build_call_tree(graph, func) for func in graph.exports}

    # Compute coverage once per tree
    coverage = filter_dict({f: set(flatten_tree(t)) for f, t in trees.items()}, bool)
    paths = {f: extract_all_paths(trees[f]) for f in coverage}

    # Build trees for internal functions appearing in paths
    for func in collect_funcs_in_paths(paths) - trees.keys():
        if func in graph.all_funcs:
            trees[func] = build_call_tree(graph, func)

    # Compute dom_distance once per tree
    dom_distances = filter_dict(
        {f: calc_dom_distance(t) for f, t in trees.items()},
        lambda d: d != float('inf')
    )

    return trees, coverage, dom_distances, paths

def solve_set_cover(input: SetCoverInput, prefer_low_score: bool) -> tuple[list[str], list[str]]:
    """Pure set cover optimization - caller prepares all data."""
    m = Model()
    m.verbose = 0
    x_ast = {f: m.add_var(var_type=BINARY) for f in input.ast_candidates}
    x_dom = {make_dom_key(d): m.add_var(var_type=BINARY) for d in input.dom_candidates}

    # Coverage constraints: each path must have >= 1 AST func (or leaf DOM if hybrid)
    for path in input.path_constraints:
        ast_vars = [x_ast[f] for f in path if f in x_ast]
        leaf_func = path[-1] if path else None
        dom_vars = [x_dom[make_dom_key(d)] for d in input.leaf_dom_map.get(leaf_func, set())]
        m += xsum(ast_vars + dom_vars) >= 1

    # Phase 1: Minimize total count
    all_vars = list(x_ast.values()) + list(x_dom.values())
    m.objective = minimize(xsum(all_vars))
    m.optimize()

    # Phase 2: Among minimal solutions, prefer AST over DOM (hybrid only)
    m += xsum(all_vars) == m.objective_value
    if input.dom_candidates:
        m.objective = minimize(xsum(x_dom.values()))
        m.optimize()
        m += xsum(x_dom.values()) == m.objective_value

    # Phase 3: Tie-break by score preference
    sign = 1 if prefer_low_score else -1
    m.objective = minimize(xsum(x_ast[f] * sign * input.ast_scores[f] for f in input.ast_candidates))
    m.optimize()

    return [f for f in input.ast_candidates if is_selected(x_ast[f])], \
           [parse_dom_key(k) for k in x_dom if is_selected(x_dom[k])]

def prepare_solver_input(paths, coverage, dom_distances, ast_funcs, include_dom) -> SetCoverInput:
    """Extract and prepare all data the solver needs."""
    ast_candidates = tuple(sorted(collect_funcs_in_paths(paths) & ast_funcs))
    all_paths = [path for path_list in paths.values() for path in path_list]

    return SetCoverInput(
        ast_candidates=ast_candidates,
        dom_candidates=tuple(sorted(set.union(*coverage.values(), set()))) if include_dom else (),
        path_constraints=[[f for f in path if f in ast_candidates] for path in all_paths],
        leaf_dom_map={path[-1]: coverage.get(path[-1], set()) for path in all_paths if path} if include_dom else {},
        ast_scores={f: float(dom_distances.get(f, 0)) for f in ast_candidates}
    )

def solve_all_approaches(paths, coverage, dom_distances, ast_funcs):
    """Generate all 5 override approaches using unified solver."""
    all_dom = list(set.union(*coverage.values(), set()))

    # Configuration: (include_dom, prefer_low_score)
    configs = {
        'ast_low': (False, True),
        'ast_high': (False, False),
        'hybrid_low': (True, True),
        'hybrid_high': (True, False),
    }

    solutions = {}
    for name, (include_dom, prefer_low) in configs.items():
        solver_input = prepare_solver_input(paths, coverage, dom_distances, ast_funcs, include_dom)
        ast, dom = solve_set_cover(solver_input, prefer_low)
        if include_dom:
            solutions[f'{name}_ast'] = ast
            solutions[f'{name}_dom'] = dom
        else:
            solutions[name] = ast

    return {
        **solutions,
        'dom_only': all_dom,
        'coverage': coverage,
        'dom_distances': dom_distances,
        'all_dom': all_dom
    }

def generate_md(solution: Dict, output: Path):
    cov, dom_distances = solution['coverage'], solution['dom_distances']
    def fmt_funcs(funcs):
        lines = []
        for f in sorted(funcs):
            if f in cov:
                lines.append(f"- `$.{f}` ({len(cov[f])} DOM, dom_distance {dom_distances[f]})")
            else:
                # Internal function not in exports
                lines.append(f"- `{f}` (internal, dom_distance {dom_distances.get(f, 'N/A')})")
        return '\n'.join(lines)
    def fmt_dom(doms):
        return '\n'.join(f"- `{d}` (DOM shim)" for d in sorted(doms)) if doms else ''
    lines = [
        f"# Svelte DOM Coverage Analysis\n\n**Total DOM calls**: {len(solution['all_dom'])}\n\n",
        f"## Approach 1: AST-Only (Low-Level)\n**Total**: {len(solution['ast_low'])}\n\n{fmt_funcs(solution['ast_low'])}\n\n",
        f"## Approach 2: AST-Only (High-Level)\n**Total**: {len(solution['ast_high'])}\n\n{fmt_funcs(solution['ast_high'])}\n\n",
        f"## Approach 3: Hybrid (Low-Level)\n**Total**: {len(solution['hybrid_low_ast']) + len(solution['hybrid_low_dom'])} ({len(solution['hybrid_low_ast'])} AST + {len(solution['hybrid_low_dom'])} DOM)\n\n{fmt_funcs(solution['hybrid_low_ast'])}\n{fmt_dom(solution['hybrid_low_dom'])}\n\n",
        f"## Approach 4: Hybrid (High-Level)\n**Total**: {len(solution['hybrid_high_ast']) + len(solution['hybrid_high_dom'])} ({len(solution['hybrid_high_ast'])} AST + {len(solution['hybrid_high_dom'])} DOM)\n\n{fmt_funcs(solution['hybrid_high_ast'])}\n{fmt_dom(solution['hybrid_high_dom'])}\n\n",
        f"## Approach 5: DOM-Only\n**Total**: {len(solution['dom_only'])}\n\n{fmt_dom(solution['dom_only'])}\n"
    ]
    output.write_text(''.join(lines))

def load_call_tree():
    """Load cached call tree data if available."""
    cache = Path('dom-cover.json')
    if not cache.exists():
        return None

    trees = {f: CallTree.from_dict(d) for f, d in json.loads(cache.read_text()).items()}
    coverage = {f: set(flatten_tree(t)) for f, t in trees.items()}
    dom_distances = filter_dict(
        {f: calc_dom_distance(t) for f, t in trees.items()},
        lambda d: d != float('inf')
    )
    paths = {f: extract_all_paths(t) for f, t in trees.items()}

    return trees, coverage, dom_distances, paths

def main():
    svelte = ensure_svelte()
    exported_names, alias_map = extract_exports(svelte / 'packages/svelte/src/internal/client/index.js')

    # Use all exported functions - these are what compiled Svelte code can call
    all_actual_funcs = set(alias_map.values())

    result = load_call_tree()
    if result:
        trees, coverage, dom_distances, paths = result
    else:
        # Build graph using all exported names (for analysis)
        graph = build_graph(svelte, all_actual_funcs)
        trees, coverage, dom_distances, paths = expand_to_dom(graph)
        tree_data = {f: trees[f].to_dict() for f in coverage}
        Path('dom-cover.json').write_text(json.dumps(tree_data, indent=2))

    # Use exported functions as override candidates
    solution = solve_all_approaches(paths, coverage, dom_distances, all_actual_funcs)
    generate_md(solution, Path('dom-cover.md'))

if __name__ == '__main__':
    main()
