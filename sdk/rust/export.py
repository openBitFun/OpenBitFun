"""Export the SDK sources and resolve their standalone Cargo workspace."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    import tomli as tomllib

ROOT = Path(__file__).resolve().parents[2]
MEMBERS = [
    "contracts/core-types", "contracts/events", "contracts/permission-contracts",
    "contracts/runtime-ports", "execution/agent-runtime", "execution/agent-stream",
    "execution/runtime-services", "execution/tool-contracts", "execution/tool-execution",
    "adapters/ai-adapters", "services/services-core", "assembly/agent",
]
# The same fixtures are used by product compatibility tests and SDK member tests.
RESOURCES = [
    "LICENSE", "src/shared/agent-harness/wire-fixtures.json",
    "src/crates/services/legacy-migration/tests/fixtures/v0.2.19/home/projects/c--fixture-workspace/sessions/session-1",
]


def manifest(path):
    return tomllib.loads(path.read_text(encoding="utf-8"))


def inline(value):
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{json.dumps(k)} = {inline(v)}" for k, v in value.items()) + " }"
    if isinstance(value, list):
        return "[" + ", ".join(map(inline, value)) + "]"
    return json.dumps(value, ensure_ascii=False)


def checked_source(relative):
    source = ROOT
    for component in Path(relative).parts:
        source = source / component
        if source.is_symlink():
            raise ValueError(f"SDK input traverses a symbolic link: {source}")
    return source


def copy_source(src, dest):
    if src.is_symlink():
        raise ValueError(f"SDK source must not be a symbolic link: {src}")
    if src.is_dir():
        for child in sorted(src.iterdir()):
            copy_source(child, dest / child.name)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)


def dependency_tables(package):
    for table in [package, *package.get("target", {}).values()]:
        for key in ("dependencies", "build-dependencies", "dev-dependencies"):
            yield table.get(key, {})


def export(dest, offline):
    root = manifest(ROOT / "Cargo.toml")
    members = [Path("src/crates") / member for member in MEMBERS]
    allowed = {(ROOT / member).resolve() for member in members}
    inherited = set()
    for member in members:
        src = checked_source(member)
        package = manifest(src / "Cargo.toml")
        for table in dependency_tables(package):
            for alias, spec in table.items():
                options = spec if isinstance(spec, dict) else {}
                if options.get("workspace"):
                    inherited.add(alias)
                if "path" in options and (src / options["path"]).resolve() not in allowed:
                    raise ValueError(f"external path in {member}: {alias} -> {options['path']}")
        for name in ("Cargo.toml", "README.md", "build.rs", "src", "examples", "tests", "benches"):
            if (src / name).is_symlink() or (src / name).exists():
                copy_source(src / name, dest / member / name)
    for resource in RESOURCES:
        copy_source(checked_source(resource), dest / resource)
    workspace = root["workspace"]
    deps = {k: workspace["dependencies"][k] for k in sorted(inherited)}
    if any(isinstance(d, dict) and "path" in d for d in deps.values()):
        raise ValueError("workspace path dependency requires an explicit SDK member")
    sections = {
        "workspace": {"members": [p.as_posix() for p in members], "resolver": workspace["resolver"]},
        "workspace.package": workspace["package"],
        **{f"workspace.lints.{k}": v for k, v in workspace["lints"].items()},
        "workspace.dependencies": deps,
    }
    text = "".join(f"[{section}]\n" + "".join(f"{json.dumps(k)} = {inline(v)}\n" for k, v in values.items()) + "\n"
                   for section, values in sections.items())
    (dest / "Cargo.toml").write_text(text)
    # Start at the versions actually used by the product. Cargo removes packages
    # outside this workspace when resolving the new graph.
    shutil.copyfile(ROOT / "Cargo.lock", dest / "Cargo.lock")
    command = ["cargo", "metadata", "--format-version", "1"]
    if offline:
        command.append("--offline")
    subprocess.run(command, cwd=dest, stdout=subprocess.DEVNULL, check=True)
    metadata = json.loads(subprocess.check_output([*command, "--locked"], cwd=dest))
    # A different registry resolution or a dropped transitive product patch can
    # compile successfully while changing runtime behavior.
    def locked_sources(path):
        return {
            (p["name"], p["version"], p["source"], p.get("checksum"))
            for p in manifest(path)["package"] if p.get("source")
        }

    sdk_sources = locked_sources(dest / "Cargo.lock")
    drift = sdk_sources - locked_sources(ROOT / "Cargo.lock")
    if drift:
        raise ValueError(f"SDK dependency differs from the product lockfile: {sorted(drift)}")
    locked_names = {name for name, *_ in sdk_sources}
    for registry, patches in root.get("patch", {}).items():
        if patched := locked_names.intersection(patches):
            raise ValueError(f"review upstream patches for the SDK: {registry} {patched}")
    resolved = {Path(p["manifest_path"]).parent for p in metadata["packages"] if p["source"] is None}
    expected = {dest / member for member in members}
    if resolved != expected:
        raise ValueError(f"unexpected SDK dependency source: {resolved.symmetric_difference(expected)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="new directory outside the product checkout")
    parser.add_argument("--offline", action="store_true", help="resolve with the local Cargo registry cache")
    args = parser.parse_args()
    target = args.destination.absolute()
    if target.exists() or target.is_symlink() or ROOT in target.resolve().parents:
        parser.error("destination must be a new directory outside the checkout")
    with tempfile.TemporaryDirectory(dir=target.parent) as temp:
        staging = Path(temp).resolve() / "workspace"
        staging.mkdir()
        export(staging, args.offline)
        os.rename(staging, target)
    print(target)
