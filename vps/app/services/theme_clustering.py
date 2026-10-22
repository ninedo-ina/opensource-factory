"""主题聚类与自动标签（M6-11）。

在 M3-02 的 `repo_vectors` 之上做只读主题聚类：

- 贪心质心聚类：按 Star 降序逐条归入最相似的现有主题，低于阈值则新建；
- 簇合并：对贪心产生的碎片质心再做一轮合并，减少顺序敏感；
- 关键词：簇内文档频率高、全局文档频率低的英文词 / 中文 bigram，作为主题名与标签建议；
- 主题只读、不落库；标签由 edge 在用户确认后写入 D1。

VPS 不承担多租户隔离：调用方（edge）传入当前用户的 `repoIds`，本模块只在该范围内读取。
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import MyRepository, RepoVector

# 英文停用词 + 开源项目描述中的高频泛词（不参与主题命名）
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "has",
        "have",
        "in",
        "into",
        "is",
        "it",
        "its",
        "of",
        "on",
        "or",
        "that",
        "the",
        "their",
        "this",
        "to",
        "with",
        "your",
        "you",
        "app",
        "application",
        "awesome",
        "based",
        "built",
        "cli",
        "code",
        "collection",
        "demo",
        "docs",
        "documentation",
        "example",
        "framework",
        "github",
        "http",
        "https",
        "library",
        "list",
        "modern",
        "open",
        "platform",
        "project",
        "sdk",
        "simple",
        "source",
        "starter",
        "system",
        "template",
        "test",
        "tool",
        "ui",
        "using",
        "web",
        "www",
        # 中文泛词 / 描述性词
        "一个",
        "一款",
        "使用",
        "支持",
        "项目",
        "工具",
        "平台",
        "系统",
        "框架",
        "组件",
        "可以",
        "基于",
        "以及",
        "通过",
        "进行",
        "实现",
        "提供",
        "用于",
        "开源",
        "管理",
        "应用",
        "服务",
        "功能",
        "帮助",
        "快速",
        "简单",
        "高效",
    }
)

# 常见技术缩写保留大写，其余英文词首字母大写
_ACRONYMS: dict[str, str] = {
    "ai": "AI",
    "llm": "LLM",
    "ml": "ML",
    "nlp": "NLP",
    "rag": "RAG",
    "api": "API",
    "cli": "CLI",
    "ui": "UI",
    "ux": "UX",
    "sdk": "SDK",
    "sql": "SQL",
    "css": "CSS",
    "html": "HTML",
    "http": "HTTP",
    "https": "HTTPS",
    "k8s": "K8s",
    "ci": "CI",
    "cd": "CD",
    "orm": "ORM",
    "jwt": "JWT",
    "saas": "SaaS",
    "paas": "PaaS",
    "gpu": "GPU",
    "cpu": "CPU",
    "ios": "iOS",
    "android": "Android",
    "vue": "Vue",
    "react": "React",
    "next": "Next",
    "node": "Node",
    "deno": "Deno",
    "bun": "Bun",
    "go": "Go",
    "rust": "Rust",
    "java": "Java",
    "python": "Python",
    "typescript": "TypeScript",
    "javascript": "JavaScript",
}

_LATIN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+#.\-]{1,}")
_CJK_RE = re.compile(r"[一-鿿]+")
_TAG_CLEAN_RE = re.compile(r"[^0-9a-z一-鿿+#.\-]+")
_TAG_TRIM_RE = re.compile(r"^[.\-]+|[.\-]+$")


@dataclass(frozen=True)
class ThemeOptions:
    """聚类参数（已归一化）。"""

    min_similarity: float = 0.55
    min_cluster_size: int = 2
    max_clusters: int = 12
    max_repos: int = 500
    keywords_per_theme: int = 5
    suggested_tags: int = 3

    @classmethod
    def from_settings(cls, **overrides: Any) -> "ThemeOptions":
        settings = get_settings()
        values = {
            "min_similarity": settings.THEME_MIN_SIMILARITY,
            "min_cluster_size": settings.THEME_MIN_CLUSTER_SIZE,
            "max_clusters": settings.THEME_MAX_CLUSTERS,
            "max_repos": settings.THEME_MAX_REPOS,
            "keywords_per_theme": settings.THEME_KEYWORDS_PER_THEME,
            "suggested_tags": settings.THEME_SUGGESTED_TAGS,
        }
        values.update({key: value for key, value in overrides.items() if value is not None})
        return cls(
            min_similarity=_clamp_float(values["min_similarity"], 0.0, 0.99, 0.55),
            min_cluster_size=_clamp_int(values["min_cluster_size"], 1, 50, 2),
            max_clusters=_clamp_int(values["max_clusters"], 1, 50, 12),
            max_repos=_clamp_int(values["max_repos"], 1, 2000, 500),
            keywords_per_theme=_clamp_int(values["keywords_per_theme"], 1, 12, 5),
            suggested_tags=_clamp_int(values["suggested_tags"], 0, 10, 3),
        )


@dataclass(frozen=True)
class ThemeRepo:
    """参与聚类的仓库（最小字段集）。"""

    id: str
    name: str
    description: str = ""
    summary: str = ""
    language: str = ""
    stars: int = 0
    tags: tuple[str, ...] = ()


@dataclass
class ThemeCluster:
    """一个主题簇。"""

    id: str
    name: str
    keywords: list[str]
    suggested_tags: list[str]
    repos: list[ThemeRepo]
    cohesion: float

    @property
    def repo_count(self) -> int:
        return len(self.repos)


@dataclass
class ThemeResult:
    """聚类结果（纯计算部分）。"""

    themes: list[ThemeCluster] = field(default_factory=list)
    unclustered: list[tuple[ThemeRepo, str]] = field(default_factory=list)
    total_repos: int = 0
    vectorized: int = 0
    clustered: int = 0
    model: str = ""
    backend: str = ""
    dim: int = 0


def _clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(parsed):
        return fallback
    return max(minimum, min(maximum, parsed))


def _clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ── 文本与关键词 ────────────────────────────────────────────────


def tokenize(text: str) -> list[str]:
    """英文词 + 中文 bigram 分词，过滤停用词与单字噪声。"""
    value = (text or "").lower()
    tokens: list[str] = []

    for match in _LATIN_RE.finditer(value):
        token = match.group(0).strip(".-")
        if len(token) >= 2 and token not in _STOPWORDS:
            tokens.append(token)

    for match in _CJK_RE.finditer(value):
        sequence = match.group(0)
        if len(sequence) <= 2:
            if sequence not in _STOPWORDS:
                tokens.append(sequence)
            continue
        for index in range(len(sequence) - 1):
            bigram = sequence[index : index + 2]
            if bigram not in _STOPWORDS:
                tokens.append(bigram)
        if len(sequence) <= 6 and sequence not in _STOPWORDS:
            tokens.append(sequence)

    return tokens


def normalize_tag(value: str) -> str:
    """把关键词规范化为标签：小写、空格 / 下划线转 `-`、去控制字符。"""
    text = (value or "").strip().lower().replace("_", "-").replace(" ", "-")
    text = _TAG_CLEAN_RE.sub("-", text)
    text = re.sub(r"-{2,}", "-", text)
    text = _TAG_TRIM_RE.sub("", text)
    return text[:40]


def _display_keyword(token: str) -> str:
    if re.fullmatch(r"[a-z0-9+#.\-]+", token):
        return _ACRONYMS.get(token, token[:1].upper() + token[1:])
    return token


def _repo_text(repo: ThemeRepo) -> str:
    return " ".join(
        part for part in (repo.name, repo.description, repo.summary, repo.language) if part
    )


def _global_token_df(repos: Iterable[ThemeRepo]) -> tuple[Counter[str], int]:
    counter: Counter[str] = Counter()
    total = 0
    for repo in repos:
        total += 1
        tokens = set(tokenize(_repo_text(repo)))
        tokens.update(normalize_tag(tag) for tag in repo.tags if normalize_tag(tag))
        counter.update(tokens)
    return counter, total


def extract_keywords(
    repos: Sequence[ThemeRepo],
    *,
    max_keywords: int = 5,
    global_df: Optional[Counter[str]] = None,
    global_total: int = 0,
) -> list[str]:
    """按簇内文档频率 + 标签加权 - 全局频率惩罚，抽取主题关键词。"""
    if not repos:
        return []

    total = len(repos)
    df: Counter[str] = Counter()
    tag_df: Counter[str] = Counter()
    for repo in repos:
        tokens = set(tokenize(_repo_text(repo)))
        for tag in repo.tags:
            normalized = normalize_tag(tag)
            if normalized:
                tokens.add(normalized)
                tag_df[normalized] += 1
        df.update(tokens)

    scored: list[tuple[float, int, str]] = []
    for token, count in df.items():
        if len(token) < 2:
            continue
        # 主题内至少出现在 2 个仓库（单仓库簇除外）
        if total >= 3 and count < 2:
            continue
        ratio = count / total
        global_ratio = 0.0
        if global_df and global_total > 0:
            global_ratio = global_df.get(token, 0) / global_total
        score = ratio - 0.35 * global_ratio + 0.25 * (tag_df.get(token, 0) / total)
        scored.append((score, count, token))

    scored.sort(key=lambda item: (-item[0], -item[1], item[2]))
    selected: list[str] = []
    for _, _, token in scored:
        if token in selected:
            continue
        # 避免同时选中文 bigram 与其包含的更长词（保留更长、信息量更大的那个）
        if any(token != other and token in other for other in selected):
            continue
        selected = [other for other in selected if other not in token]
        selected.append(token)
        if len(selected) >= max_keywords:
            break
    return selected


def suggest_tags(
    keywords: Sequence[str],
    repos: Sequence[ThemeRepo],
    *,
    max_tags: int = 3,
) -> list[str]:
    """从关键词生成建议标签，排除簇内所有仓库已有的标签。"""
    if max_tags <= 0:
        return []
    existing_everywhere: set[str] = set()
    if repos:
        existing_sets = [
            {normalize_tag(tag) for tag in repo.tags if normalize_tag(tag)} for repo in repos
        ]
        existing_everywhere = set.intersection(*existing_sets) if existing_sets else set()

    result: list[str] = []
    for keyword in keywords:
        tag = normalize_tag(keyword)
        if not tag or tag in result or tag in existing_everywhere:
            continue
        result.append(tag)
        if len(result) >= max_tags:
            break
    return result


def theme_name(keywords: Sequence[str], repos: Sequence[ThemeRepo]) -> str:
    """主题名：前两个关键词；无关键词时用主语言。"""
    if keywords:
        labels = [_display_keyword(keyword) for keyword in keywords[:2]]
        return " / ".join(labels)
    languages = Counter(repo.language for repo in repos if repo.language)
    if languages:
        return f"{languages.most_common(1)[0][0]} 项目"
    return "综合主题"


# ── 向量与聚类 ──────────────────────────────────────────────────


def parse_vector(raw: Any) -> Optional[list[float]]:
    try:
        values = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return None
    if not isinstance(values, list) or not values:
        return None
    try:
        return [float(item) for item in values]
    except (TypeError, ValueError):
        return None


def _normalize_vector(vector: Sequence[float]) -> Optional[list[float]]:
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm <= 0:
        return None
    return [value / norm for value in vector]


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _centroid(vectors: Sequence[Sequence[float]]) -> Optional[list[float]]:
    if not vectors:
        return None
    dim = len(vectors[0])
    sums = [0.0] * dim
    for vector in vectors:
        if len(vector) != dim:
            continue
        for index, value in enumerate(vector):
            sums[index] += value
    return _normalize_vector(sums)


def cluster_vectors(
    items: Sequence[tuple[ThemeRepo, Sequence[float]]],
    options: ThemeOptions,
    *,
    global_df: Optional[Counter[str]] = None,
    global_total: int = 0,
) -> ThemeResult:
    """贪心质心聚类 + 质心合并；返回主题与未聚类仓库。"""
    normalized: list[tuple[ThemeRepo, list[float]]] = []
    for repo, vector in items:
        unit = _normalize_vector(vector)
        if unit is not None:
            normalized.append((repo, unit))

    normalized.sort(key=lambda item: (-item[0].stars, item[0].id))

    clusters: list[dict[str, Any]] = []
    for repo, vector in normalized:
        best_index = -1
        best_score = -1.0
        for index, cluster in enumerate(clusters):
            score = _cosine(vector, cluster["centroid"])
            if score > best_score:
                best_index = index
                best_score = score
        if best_index >= 0 and best_score >= options.min_similarity:
            cluster = clusters[best_index]
            cluster["members"].append((repo, vector))
            centroid = _centroid([member_vector for _, member_vector in cluster["members"]])
            if centroid is not None:
                cluster["centroid"] = centroid
        else:
            clusters.append({"members": [(repo, vector)], "centroid": vector})

    # 质心合并：吸收贪心顺序造成的碎片（并查集）
    parent = list(range(len(clusters)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left in range(len(clusters)):
        for right in range(left + 1, len(clusters)):
            if _cosine(clusters[left]["centroid"], clusters[right]["centroid"]) >= options.min_similarity:
                union(left, right)

    merged: dict[int, list[tuple[ThemeRepo, list[float]]]] = {}
    for index, cluster in enumerate(clusters):
        merged.setdefault(find(index), []).extend(cluster["members"])

    grouped: list[dict[str, Any]] = []
    for members in merged.values():
        centroid = _centroid([vector for _, vector in members])
        if centroid is None:
            continue
        grouped.append({"members": members, "centroid": centroid})

    # 小簇 / 截断归入未聚类
    unclustered: list[tuple[ThemeRepo, str]] = []
    kept: list[dict[str, Any]] = []
    for cluster in grouped:
        if len(cluster["members"]) < options.min_cluster_size:
            unclustered.extend((repo, "singleton") for repo, _ in cluster["members"])
        else:
            kept.append(cluster)

    kept.sort(
        key=lambda cluster: (
            -len(cluster["members"]),
            -sum(repo.stars for repo, _ in cluster["members"]),
            min(repo.id for repo, _ in cluster["members"]),
        )
    )
    if len(kept) > options.max_clusters:
        for cluster in kept[options.max_clusters :]:
            unclustered.extend((repo, "overflow") for repo, _ in cluster["members"])
        kept = kept[: options.max_clusters]

    themes: list[ThemeCluster] = []
    for cluster in kept:
        members: list[tuple[ThemeRepo, list[float]]] = cluster["members"]
        repos = sorted((repo for repo, _ in members), key=lambda repo: (-repo.stars, repo.id))
        keywords = extract_keywords(
            repos,
            max_keywords=options.keywords_per_theme,
            global_df=global_df,
            global_total=global_total,
        )
        cohesion_values = [_cosine(vector, cluster["centroid"]) for _, vector in members]
        cohesion = round(sum(cohesion_values) / len(cohesion_values), 3) if cohesion_values else 0.0
        theme_id = "theme-" + hashlib.sha1(
            ",".join(sorted(repo.id for repo in repos)).encode("utf-8")
        ).hexdigest()[:12]
        themes.append(
            ThemeCluster(
                id=theme_id,
                name=theme_name(keywords, repos),
                keywords=keywords,
                suggested_tags=suggest_tags(
                    keywords, repos, max_tags=options.suggested_tags
                ),
                repos=repos,
                cohesion=cohesion,
            )
        )

    clustered = sum(theme.repo_count for theme in themes)
    return ThemeResult(
        themes=themes,
        unclustered=unclustered,
        total_repos=len(normalized),
        vectorized=len(normalized),
        clustered=clustered,
    )


# ── 数据库读取 ──────────────────────────────────────────────────


def _to_theme_repo(row: MyRepository) -> ThemeRepo:
    return ThemeRepo(
        id=row.id,
        name=row.name or "",
        description=row.description or "",
        summary=row.readme_summary or "",
        language=row.language or "",
        stars=int(row.stars or 0),
    )


def build_theme_result(
    db: Session,
    repo_ids: Sequence[str],
    options: Optional[ThemeOptions] = None,
) -> dict[str, Any]:
    """读取 VPS 镜像与向量，执行聚类并返回可序列化结果。"""
    started = time.perf_counter()
    resolved = options or ThemeOptions.from_settings()

    unique_ids: list[str] = []
    seen: set[str] = set()
    for repo_id in repo_ids:
        value = str(repo_id or "").strip()
        if value and value not in seen:
            seen.add(value)
            unique_ids.append(value)
    unique_ids = unique_ids[: resolved.max_repos]

    if not unique_ids:
        return {
            "themes": [],
            "unclustered": [],
            "stats": {
                "totalRepos": 0,
                "clusteredRepos": 0,
                "themeCount": 0,
                "coverage": 0.0,
                "vectorized": 0,
            },
            "thresholds": _thresholds(resolved),
            "model": "",
            "backend": "",
            "dim": 0,
            "generatedAt": _utcnow_iso(),
            "tookMs": 0,
        }

    repo_rows = {
        row.id: row
        for row in db.execute(select(MyRepository).where(MyRepository.id.in_(unique_ids))).scalars()
    }
    vector_rows = list(
        db.execute(
            select(RepoVector).where(
                RepoVector.source == "my", RepoVector.repo_id.in_(unique_ids)
            )
        ).scalars()
    )

    # 以出现最多的 (model, backend, dim) 为基准，混入其他维度的条目单独标记
    vector_meta = Counter((row.model, row.backend, int(row.dim or 0)) for row in vector_rows)
    dominant = vector_meta.most_common(1)[0][0] if vector_meta else ("", "", 0)
    model, backend, dim = dominant

    repos_by_id: dict[str, ThemeRepo] = {
        repo_id: _to_theme_repo(row) for repo_id, row in repo_rows.items()
    }
    vectors_by_id = {row.repo_id: row for row in vector_rows}
    items: list[tuple[ThemeRepo, list[float]]] = []
    unclustered: list[tuple[ThemeRepo, str]] = []

    for repo_id in unique_ids:
        repo = repos_by_id.get(repo_id)
        if repo is None:
            continue
        vector_row = vectors_by_id.get(repo_id)
        if vector_row is None:
            unclustered.append((repo, "no_vector"))
            continue
        if int(vector_row.dim or 0) != dim or vector_row.model != model or vector_row.backend != backend:
            unclustered.append((repo, "dim_mismatch"))
            continue
        vector = parse_vector(vector_row.vector)
        if vector is None or len(vector) != dim:
            unclustered.append((repo, "dim_mismatch"))
            continue
        items.append((repo, vector))

    global_df, global_total = _global_token_df(repos_by_id.values())
    result = cluster_vectors(
        items, resolved, global_df=global_df, global_total=global_total
    )
    result.unclustered.extend(unclustered)
    result.total_repos = len(repos_by_id)
    result.model = model
    result.backend = backend
    result.dim = dim

    coverage = round(result.clustered / result.total_repos * 100, 1) if result.total_repos else 0.0
    return {
        "themes": [
            {
                "id": theme.id,
                "name": theme.name,
                "keywords": theme.keywords,
                "suggestedTags": theme.suggested_tags,
                "repoCount": theme.repo_count,
                "cohesion": theme.cohesion,
                "repos": [
                    {
                        "id": repo.id,
                        "name": repo.name,
                        "description": repo.description,
                        "summary": repo.summary,
                        "language": repo.language,
                        "stars": repo.stars,
                        "tags": list(repo.tags),
                    }
                    for repo in theme.repos
                ],
            }
            for theme in result.themes
        ],
        "unclustered": [
            {"id": repo.id, "name": repo.name, "reason": reason}
            for repo, reason in result.unclustered
        ],
        "stats": {
            "totalRepos": result.total_repos,
            "clusteredRepos": result.clustered,
            "themeCount": len(result.themes),
            "coverage": coverage,
            "vectorized": result.vectorized,
        },
        "thresholds": _thresholds(resolved),
        "model": model,
        "backend": backend,
        "dim": dim,
        "generatedAt": _utcnow_iso(),
        "tookMs": int((time.perf_counter() - started) * 1000),
    }


def _thresholds(options: ThemeOptions) -> dict[str, Any]:
    return {
        "minSimilarity": options.min_similarity,
        "minClusterSize": options.min_cluster_size,
        "maxClusters": options.max_clusters,
    }
