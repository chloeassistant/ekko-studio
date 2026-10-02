import { execFileSync } from 'child_process'
import { describe, expect, it } from 'vitest'

function runPython(script: string): any {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, HERMES_AGENT_BRIDGE_WORKER_PORT_BASE: '18780', HERMES_AGENT_BRIDGE_WORKER_TRANSPORT: '' },
    })
    return JSON.parse(output)
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error([
      err.message || 'Python bridge transport script failed',
      err.stdout ? `stdout:\n${err.stdout}` : '',
      err.stderr ? `stderr:\n${err.stderr}` : '',
    ].filter(Boolean).join('\n\n'))
  }
}

describe('agent bridge worker endpoint', () => {
  it('avoids high dynamic worker port bases on Windows', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import sys
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

original_name = bridge_transport.os.name
original_env = os.environ.get("HERMES_AGENT_BRIDGE_WORKER_PORT_BASE")
try:
    bridge_transport.os.name = "nt"
    os.environ["HERMES_AGENT_BRIDGE_WORKER_PORT_BASE"] = "50813"
    endpoint = bridge_transport._worker_endpoint("default", "tcp://127.0.0.1:56618")
finally:
    bridge_transport.os.name = original_name
    if original_env is None:
        os.environ.pop("HERMES_AGENT_BRIDGE_WORKER_PORT_BASE", None)
    else:
        os.environ["HERMES_AGENT_BRIDGE_WORKER_PORT_BASE"] = original_env

port = int(endpoint.rsplit(":", 1)[1])
print(json.dumps({"endpoint": endpoint, "port": port}))
`)

    expect(result.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/)
    expect(result.port).toBeGreaterThanOrEqual(18780)
    expect(result.port).toBeLessThan(19780)
  })

  it('avoids worker ports that enter the Windows dynamic range after hash offset', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import sys
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

original_name = bridge_transport.os.name
original_env = os.environ.get("HERMES_AGENT_BRIDGE_WORKER_PORT_BASE")
try:
    bridge_transport.os.name = "nt"
    os.environ["HERMES_AGENT_BRIDGE_WORKER_PORT_BASE"] = "49000"
    endpoint = bridge_transport._worker_endpoint("default", "tcp://127.0.0.1:56618")
finally:
    bridge_transport.os.name = original_name
    if original_env is None:
        os.environ.pop("HERMES_AGENT_BRIDGE_WORKER_PORT_BASE", None)
    else:
        os.environ["HERMES_AGENT_BRIDGE_WORKER_PORT_BASE"] = original_env

port = int(endpoint.rsplit(":", 1)[1])
print(json.dumps({"endpoint": endpoint, "port": port}))
`)

    expect(result.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/)
    expect(result.port).toBeGreaterThanOrEqual(18780)
    expect(result.port).toBeLessThan(19780)
  })

  it('uses an ipc endpoint when the worker socket path fits in sun_path', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import sys
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

original_name = bridge_transport.os.name
original_gettempdir = bridge_transport.tempfile.gettempdir
original_transport = os.environ.pop("HERMES_AGENT_BRIDGE_WORKER_TRANSPORT", None)
try:
    bridge_transport.os.name = "posix"
    bridge_transport.tempfile.gettempdir = lambda: "/tmp"
    endpoint = bridge_transport._worker_endpoint("default", "ipc:///tmp/hermes-agent-bridge.sock")
finally:
    bridge_transport.os.name = original_name
    bridge_transport.tempfile.gettempdir = original_gettempdir
    if original_transport is not None:
        os.environ["HERMES_AGENT_BRIDGE_WORKER_TRANSPORT"] = original_transport

print(json.dumps({"endpoint": endpoint}))
`)

    expect(result.endpoint).toMatch(/^ipc:\/\/.*\.sock$/)
  })

  it('falls back to a TCP endpoint when the namespace dir pushes the socket path past sun_path', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import sys
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

original_name = bridge_transport.os.name
original_gettempdir = bridge_transport.tempfile.gettempdir
original_transport = os.environ.pop("HERMES_AGENT_BRIDGE_WORKER_TRANSPORT", None)
try:
    bridge_transport.os.name = "posix"
    bridge_transport.tempfile.gettempdir = lambda: "/tmp"
    deep_dir = "/" + "/".join(["deep-temp-dir"] * 12)
    endpoint = bridge_transport._worker_endpoint("default", f"ipc://{deep_dir}/hermes-agent-bridge.sock")
finally:
    bridge_transport.os.name = original_name
    bridge_transport.tempfile.gettempdir = original_gettempdir
    if original_transport is not None:
        os.environ["HERMES_AGENT_BRIDGE_WORKER_TRANSPORT"] = original_transport

print(json.dumps({"endpoint": endpoint}))
`)

    expect(result.endpoint).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/)
    const port = Number(result.endpoint.split(':').pop())
    expect(port).toBeGreaterThanOrEqual(18780)
    expect(port).toBeLessThan(19780)
  })

  it('places worker sockets next to the broker namespace socket, not under gettempdir()', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import sys
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

original_name = bridge_transport.os.name
original_gettempdir = bridge_transport.tempfile.gettempdir
original_transport = os.environ.pop("HERMES_AGENT_BRIDGE_WORKER_TRANSPORT", None)
try:
    bridge_transport.os.name = "posix"
    # A Hermes-pruned scratch dir distinct from the broker's own namespace
    # dir — the worker socket must NOT land here, only under the broker's dir.
    bridge_transport.tempfile.gettempdir = lambda: "/other-tmp-pruned-by-hermes"
    endpoint = bridge_transport._worker_endpoint("default", "ipc:///some/dir/agent-bridge.sock")
finally:
    bridge_transport.os.name = original_name
    bridge_transport.tempfile.gettempdir = original_gettempdir
    if original_transport is not None:
        os.environ["HERMES_AGENT_BRIDGE_WORKER_TRANSPORT"] = original_transport

print(json.dumps({"endpoint": endpoint}))
`)

    expect(result.endpoint).toMatch(/^ipc:\/\/\/some\/dir\/hermes-agent-bridge-workers\/[0-9a-f]{16}\.sock$/)
  })

  it('creates the worker socket directory as 0700, not under the shared broker dir', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import shutil
import stat
import sys
import tempfile
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

tmp_dir = tempfile.mkdtemp(prefix="agent-bridge-ns-")
os.chmod(tmp_dir, 0o755)
server = None
# Force a permissive umask so the test proves the code explicitly chmods
# the worker-socket directory to 0700 instead of merely inheriting a
# restrictive umask from the environment.
old_umask = os.umask(0o022)
try:
    namespace = f"ipc://{tmp_dir}/agent-bridge.sock"
    endpoint = bridge_transport._worker_endpoint("default", namespace)
    server = bridge_transport._make_listen_socket(endpoint)
    worker_dir = os.path.join(tmp_dir, "hermes-agent-bridge-workers")
    mode = stat.S_IMODE(os.stat(worker_dir).st_mode)
    print(json.dumps({"endpoint": endpoint, "mode": oct(mode)}))
finally:
    os.umask(old_umask)
    if server is not None:
        server.close()
    shutil.rmtree(tmp_dir, ignore_errors=True)
`)

    expect(result.endpoint).toMatch(/^ipc:\/\/.*hermes-agent-bridge-workers\/[0-9a-f]{16}\.sock$/)
    expect(result.mode).toBe('0o700')
  })

  it('falls back to gettempdir() when the ipc namespace has no directory component', () => {
    const result = runPython(String.raw`
import importlib.util
import json
import os
import sys
import types

bridge_runtime = types.ModuleType("bridge_runtime")
bridge_runtime._hidden_subprocess_kwargs = lambda: {}
bridge_runtime._json_line_bytes = lambda req: (json.dumps(req) + "\n").encode("utf-8")
bridge_runtime._platform_text_encoding = lambda: "utf-8"
sys.modules["bridge_runtime"] = bridge_runtime

spec = importlib.util.spec_from_file_location(
    "bridge_transport",
    "packages/server/src/modules/hermes/services/bridge/python/bridge_transport.py",
)
bridge_transport = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge_transport)

original_name = bridge_transport.os.name
original_gettempdir = bridge_transport.tempfile.gettempdir
original_transport = os.environ.pop("HERMES_AGENT_BRIDGE_WORKER_TRANSPORT", None)
try:
    bridge_transport.os.name = "posix"
    bridge_transport.tempfile.gettempdir = lambda: "/fallback-tmp"
    # A relative ipc namespace (no directory component) has an empty
    # posixpath.dirname(); must fall back to gettempdir(), not cwd.
    endpoint = bridge_transport._worker_endpoint("default", "ipc://agent-bridge.sock")
finally:
    bridge_transport.os.name = original_name
    bridge_transport.tempfile.gettempdir = original_gettempdir
    if original_transport is not None:
        os.environ["HERMES_AGENT_BRIDGE_WORKER_TRANSPORT"] = original_transport

print(json.dumps({"endpoint": endpoint}))
`)

    expect(result.endpoint).toMatch(/^ipc:\/\/\/fallback-tmp\/hermes-agent-bridge-workers\/[0-9a-f]{16}\.sock$/)
  })
})
