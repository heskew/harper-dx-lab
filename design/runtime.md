# Runtime Isolation Options

The DX Lab needs isolated environments for each worker. The SWE agent runs
arbitrary code, installs packages, and interacts with a Harper instance. Workers
must not be able to see each other. The question is what provides that isolation.

---

## Requirements

1. **Per-worker isolation** — each worker gets its own Harper instance, filesystem,
   and network. No cross-contamination between workers.
2. **Ephemeral** — spin up, run experiment, tear down. No persistent state leaking
   between runs.
3. **Harper-compatible** — Harper runs as a Node.js process. Needs filesystem access,
   network ports (9925, 9926, 1883), and persistent storage during the run.
4. **Agent-compatible** — Claude Code (or similar) needs to execute bash commands,
   install npm packages, read/write files, and make HTTP requests to Harper.
5. **Reproducible** — same assignment + same docs should produce comparable results
   across runs, regardless of which machine hosts the worker.
6. **Low overhead** — we want to run 3-10 workers simultaneously on a single machine.
   Heavy per-worker overhead limits parallelism.

---

## Option 1: Docker Compose (plain containers)

The default option. Each worker is a `docker compose` stack with a Harper container
and a workspace container on an isolated Docker network.

**How it works:**
- Standard Docker containers sharing the host kernel
- Isolation via Linux namespaces and cgroups
- Containers communicate on a per-stack bridge network
- Workspace mounts a host directory for the SWE's code

**Pros:**
- Zero extra tooling — Docker is already installed everywhere
- Fast startup (seconds)
- Low overhead (~500MB per worker: Harper ~300MB + workspace ~200MB)
- Docker Compose natively handles multi-container stacks
- Well-understood, massive community knowledge base
- Works identically on macOS (Docker Desktop), Linux, and CI

**Cons:**
- Containers share host kernel — a kernel exploit could escape (theoretical
  for our use case since we control what runs in the containers)
- Agent has root-equivalent access inside the container
- If agent installs something that corrupts the container, other containers
  on the same Docker daemon could theoretically be affected

**Verdict: Start here.** For the DX Lab, our agents are running code we designed
(tier assignments against a known-good Harper instance). The threat model is
"agent does something weird" not "agent is adversarial." Docker Compose provides
sufficient isolation with minimal complexity.

---

## Option 2: Docker Sandboxes (microVM-backed)

Docker's new Sandboxes feature, announced late 2025 and actively developed in
early 2026. Uses microVMs under the hood — each sandbox gets its own kernel,
not just namespace isolation.

**How it works:**
- Each sandbox runs in a lightweight microVM with its own Docker daemon
- The agent runs inside the VM and can't access the host Docker daemon
- Workspace directory syncs between host and sandbox at the same path
- Built specifically for AI coding agents (Claude Code, Codex, Gemini, etc.)

**Pros:**
- Hardware-level isolation (separate kernel per sandbox)
- Built-in Docker-in-Docker — agent can run containers inside the sandbox
- Purpose-built for exactly our use case (AI agents running code)
- Network isolation with allow/deny lists
- Persists until removed, so installed packages stay across agent sessions
- Integrated with Claude Code natively

**Cons:**
- Requires macOS or Windows (Linux support is experimental/legacy container-based)
- Currently limited to whitelisted agents (Claude, Codex, Gemini, Copilot, Kiro)
- Can't run arbitrary Docker stacks inside — would need the undocumented `/vm` API
- Heavier than plain containers (microVM overhead, though small ~5MB per VM)
- New and rapidly changing — APIs may shift
- Running Harper INSIDE a sandbox requires loading the image into the sandbox's
  internal Docker daemon (docker save → docker load workflow)

**The catch for DX Lab:** Docker Sandboxes are designed for "one agent, one sandbox"
where the agent IS the Claude Code session. Our model is different — we need
Harper + workspace in the same isolated environment, with the Claude Code session
connecting from outside. The sandbox model doesn't naturally fit "run Harper as a
service inside the sandbox that the agent talks to."

**However**, the reverse-engineered `/vm` microVM API (documented by Rivet, Feb 2026)
opens this up. You can create arbitrary VMs, load images into them, and run
containers — giving you Docker Compose semantics with microVM isolation:

```bash
# Create a microVM
curl -X POST --unix-socket ~/.docker/sandboxes/sandboxd.sock \
  http://localhost/vm -d '{"agent_name": "dx-worker-1", "workspace_dir": "/path/to/worker"}'

# Load Harper image into the VM
docker save harperdb/harperdb:latest > /tmp/harper.tar
docker --host "unix://$VM_SOCK" load < /tmp/harper.tar

# Run Harper inside the VM
docker --host "unix://$VM_SOCK" run -d --name harper harperdb/harperdb:latest
```

**Verdict: Worth exploring after Phase 0.** The isolation is better than plain
Docker, and the microVM API is promising. But it adds complexity we don't need
for the pilot. Start with Docker Compose, experiment with Sandboxes once the
lab is running and we want to harden isolation for unattended overnight runs.

---

## Option 3: Nanos / NanoVMs (unikernels)

Nanos is a unikernel — a specialized single-process OS that runs one application
directly on a hypervisor (KVM on Linux, HVF on macOS). No Linux kernel, no users,
no shell, no SSH. Just your application.

**How it works:**
- `ops` tool packages your application into a minimal VM image
- Image boots directly on the hypervisor, runs one process
- No shell, no SSH, no way to interact except over the network
- Each unikernel is completely isolated — separate kernel, separate everything

**Pros:**
- Strongest possible isolation (each worker is a full VM with its own kernel)
- Extremely small footprint (can be smaller than containers)
- Fast boot times (milliseconds on bare metal)
- No attack surface — no shell, no users, no extra processes
- Can run thousands on commodity hardware
- ARM support for Apple Silicon (M1/M2/M3)

**Cons:**
- Harper would need to be packaged as a Nanos unikernel image — non-trivial,
  since Harper has complex filesystem and networking needs
- No interactivity — can't shell into it, can't run commands, can't debug live
- The SWE agent needs to interact with the filesystem (write schema, resources),
  which is fundamentally at odds with "no shell, no filesystem access"
- `ops` tooling is designed for deploying self-contained network services, not
  for interactive development environments
- Would need to figure out how the SWE agent writes files to Harper's component
  directory — there's no standard mechanism for this in unikernel land
- Much smaller community than Docker — troubleshooting is harder

**The fundamental mismatch:** Unikernels are designed for production deployment of
completed applications. The DX Lab needs interactive development environments where
an agent writes code, deploys it, tests it, modifies it, and repeats. The unikernel
model of "build image → boot → it runs or it doesn't" doesn't fit iterative
development.

**Where it WOULD fit:** Running the Experiment Ledger (a Harper instance serving the
lab's own state). This is a long-running, single-purpose Harper instance that doesn't
need interactivity. Packaging it as a Nanos unikernel would give it rock-solid
isolation and minimal overhead. But this is an optimization, not a requirement.

**Verdict: Not a fit for workers. Possible future optimization for infrastructure.**

---

## Option 4: Firecracker microVMs (raw)

What Docker Sandboxes use under the hood. You can use Firecracker directly for
maximum control over the VM lifecycle.

**How it works:**
- Firecracker creates lightweight VMs with minimal device emulation
- Each VM gets its own Linux kernel via KVM
- Boot in ~125ms, <5MB memory overhead per VM
- Up to 150 VMs per second per host

**Pros:**
- Gold standard for isolating untrusted code (AWS Lambda uses this)
- Extremely fast boot and low overhead
- Full Linux environment inside each VM — agent can do anything
- Complete isolation from host

**Cons:**
- Requires KVM (Linux only — won't work on macOS Docker Desktop)
- Needs nested virtualization in cloud (metal instances on AWS, or GCP nested virt)
- Significantly more setup than Docker Compose
- Need to build custom VM images with Harper + Node.js + tools
- No Docker Compose equivalent — you're managing VMs manually
- Networking setup (DHCP, bridges) is non-trivial

**Verdict: Overkill for Phase 0-2. Potential for k3s/CI deployment later.**
If the lab eventually runs on a Linux server or in CI, Firecracker (via Kata
Containers for Kubernetes integration) would be the right isolation boundary
for running many workers in parallel with strong isolation guarantees.

---

## Comparison Matrix

| Requirement | Docker Compose | Docker Sandbox | Nanos | Firecracker |
|---|---|---|---|---|
| Per-worker isolation | ✅ Good | ✅ Strong | ✅ Strongest | ✅ Strong |
| Ephemeral lifecycle | ✅ compose down | ✅ sandbox rm | ⚠️ Kill VM | ✅ Kill VM |
| Harper-compatible | ✅ Native | ⚠️ Image load needed | ❌ Packaging | ⚠️ Custom image |
| Agent-compatible | ✅ Full shell | ✅ Designed for it | ❌ No shell | ✅ Full Linux |
| Reproducible | ✅ Compose file | ✅ Template | ✅ Immutable image | ✅ Snapshot |
| Overhead per worker | ~500MB | ~520MB | ~50-200MB | ~50-200MB |
| macOS Apple Silicon | ✅ Docker Desktop | ✅ Docker Desktop | ⚠️ ARM support | ❌ KVM only |
| Setup complexity | Low | Medium | High | High |
| Maturity | Production | Preview (evolving) | Niche | Production |

---

## Recommended Path

```
Phase 0-1: Docker Compose
├── Start here. Zero extra tooling.
├── Sufficient isolation for designed experiments with known-good agents.
├── Works on MacBook Air, Mac Studio, CI.
└── Focus on building the lab, not the infrastructure.

Phase 2+: Evaluate Docker Sandboxes
├── Once lab is running and producing results.
├── If running unattended overnight, microVM isolation adds safety.
├── Monitor Docker Sandbox API stability.
└── The undocumented /vm API is promising but may change.

Future: Firecracker via Kata Containers (for k3s deployment)
├── When/if lab moves to always-on Linux server or k3s cluster.
├── Kata Containers wraps Firecracker in Kubernetes-native API.
├── Each worker = a namespace with Kata-isolated pods.
└── Strongest isolation for multi-tenant or CI scenarios.

Nanos: Consider for Experiment Ledger only
├── Long-running Harper instance serving lab state.
├── Doesn't need interactivity.
├── Minimal attack surface, minimal overhead.
└── Nice-to-have optimization, not critical path.
```
