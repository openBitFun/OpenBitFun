"""Build an external Rust consumer and exercise its session against a loopback model."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

# The export is the only module loaded from the source checkout.
sys.dont_write_bytecode = True
from export import ROOT, export

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path, help="new directory outside the repository")
parser.add_argument("--offline", action="store_true")
args = parser.parse_args()
directory = args.directory.resolve()
if directory.exists() or ROOT in directory.parents:
    parser.error("pass a new directory outside the repository")
directory.mkdir()
sdk = directory / "OpenBitFun-SDK"
sdk.mkdir()
export(sdk, args.offline)
app = directory / "consumer"
(app / "src").mkdir(parents=True)
(app / "Cargo.toml").write_text('''[package]
name = "export-consumer"
version = "0.1.0"
edition = "2021"

[dependencies]
openbitfun-agent = { path = "../OpenBitFun-SDK/src/crates/assembly/agent", features = ["local"] }
anyhow = "1"
serde_json = "1"
tokio = { version = "1", features = ["rt", "macros", "time"] }
''')
shutil.copyfile(sdk / "Cargo.lock", app / "Cargo.lock")
smoke = Path(__file__).resolve().parent / "smoke"
shutil.copyfile(smoke / "main.rs", app / "src/main.rs")
shutil.copyfile(smoke / "run.mjs", app / "run.mjs")
env = os.environ.copy()
env["CARGO_TARGET_DIR"] = str(directory / "target")
# The child must not inherit an incremental target directory or compiler cache.
for var in ("RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"):
    env.pop(var, None)
# Only the registry/toolchain may be shared with the product checkout.
def sandbox_profile(runtime=False):
    if sys.platform != "darwin":
        return []
    policy = "(version 1)(allow default)"
    policy += f"(deny file-read* file-write* (subpath {json.dumps(str(ROOT))}))"
    if runtime:
        policy += '(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
    return ["sandbox-exec", "-p", policy]


flags = ["--offline"] if args.offline else []
def cargo(command, *argv, capture=False):
    return subprocess.run([*sandbox_profile(), "cargo", command, *flags, *argv], cwd=app,
                          env=env, check=True, stdout=subprocess.PIPE if capture else None)

cargo("metadata", "--format-version", "1", capture=True)
metadata = json.loads(cargo("metadata", "--locked", "--format-version", "1", capture=True).stdout)
for package in metadata["packages"]:
    if package["source"] is None:
        path = Path(package["manifest_path"]).resolve()
        if path != app / "Cargo.toml" and sdk not in path.parents:
            raise ValueError(f"external path in consumer graph: {path}")
cargo("build", "--locked")
exe = "export-consumer.exe" if os.name == "nt" else "export-consumer"
node = shutil.which("node")
if node is None:
    raise RuntimeError("Node.js is required to run the loopback fixture")
# The SDK has no product executable on PATH. Invoke only the fixture and the
# compiled consumer by absolute paths.
runtime_env = dict(env, PATH=str(directory / "empty-bin"))
(directory / "empty-bin").mkdir()
runtime_command = [
    *sandbox_profile(runtime=True), node, "run.mjs", directory / "target/debug" / exe,
]
# sandbox-exec itself must also be locatable after PATH is isolated.
if sys.platform == "darwin":
    runtime_command[0] = "/usr/bin/sandbox-exec"
subprocess.run(runtime_command, cwd=app, env=runtime_env, check=True)
